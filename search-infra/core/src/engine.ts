/**
 * SearchCore 顶层编排 (v0-spec §2)
 * search(): Planner → Router(allSettled 并行) → Fusion(双阈值语义融合 v0.2) → 预算
 * fetch():  Fetcher(缓存原文+focus 读时过滤)
 * research(): Research Loop 状态机(v0.2, 5角度并行+双预算池+6问反思+三保险停止+断点恢复)
 */
import { loadConfig, type CoreConfig } from "./config.js";
import { Cache, type CacheSearchHit } from "./cache.js";
import { Journal } from "./journal.js";
import { HealthTracker } from "./providers/base.js";
import { Router } from "./router.js";
import { Fetcher } from "./fetcher.js";
import { plan } from "./planner.js";
import { laneLegProviders } from "./domains.js";
import { fuseSemantic } from "./fusion.js";
import { detectCategory, detectCommunityIntent, mergeExternalAuthority } from "./authority.js";
import { FallbackEmbedder, OpenAIEmbedder } from "./embed.js";
import type { ResearchLoop, ResearchOptions, ResearchResult, ResearchEvent } from "./research.js";
import type {
  SearchOptions, SearchResult, FetchOptions, FetchResult,
  Reference, PlannerDecision,
} from "./types.js";

export interface CoreDeps {
  config?: Partial<CoreConfig>;
  /** 测试注入 */
  fetchImpl?: typeof fetch;
  /** 测试注入: 预构建的 embedder(research/融合用) */
  embedder?: FallbackEmbedder;
}

export class SearchCore {
  readonly cfg: CoreConfig;
  readonly cache: Cache;
  readonly health: HealthTracker;
  readonly router: Router;
  readonly fetcher: Fetcher;
  readonly embedder: FallbackEmbedder;
  #journal?: Journal;
  #researchP?: Promise<ResearchLoop>;

  constructor(deps: CoreDeps = {}) {
    this.cfg = loadConfig(deps.config as Partial<CoreConfig> | undefined);
    this.cache = new Cache(this.cfg.dataDir);
    this.health = new HealthTracker(this.cache);
    this.#journal = new Journal(this.cfg.dataDir);
    // phase AD: 权威表外挂覆盖(SC_AUTHORITY_JSON/file.authorityOverride) — 本地改表不改代码; 坏配置内部跳过
    const ext = mergeExternalAuthority(this.cfg.authorityOverride);
    if (ext.topics || ext.categories || ext.skipped) {
      this.#journal.write("authority_override", ext);
    }
    this.router = new Router({
      config: this.cfg,
      health: this.health,
      journal: this.#journal,
      cache: this.cache,
      fetchImpl: deps.fetchImpl,
    });
    this.fetcher = new Fetcher(this.cfg, this.cache, this.#journal, deps.fetchImpl);
    this.embedder = deps.embedder ?? new FallbackEmbedder(() => {
      const e = this.cfg.embedding;
      return e?.baseUrl && e?.model
        ? new OpenAIEmbedder({ baseUrl: e.baseUrl, apiKey: e.apiKey, model: e.model, fetchImpl: deps.fetchImpl })
        : undefined;
    });
  }

  /** 懒加载(v0.8.1 内存优化): 纯 search 场景零 research 模块内存; 首次 deepResearch/resumeResearch 才动态 import */
  #getResearch(): Promise<ResearchLoop> {
    if (!this.#researchP) {
      this.#researchP = import("./research.js").then(
        (m) => new m.ResearchLoop({
          config: this.cfg, router: this.router, fetcher: this.fetcher,
          cache: this.cache, journal: this.#journal,
        }, this.cfg.dataDir),
      );
    }
    return this.#researchP;
  }

  async search(rawQuery: string, opts: SearchOptions = {}): Promise<SearchResult & { planner: PlannerDecision }> {
    const t0 = Date.now();
    this.cache.kvIncr("stat:search_total");
    const decision = plan(rawQuery);
    this.#journal?.write("planner", { query: rawQuery, decision });

    // 缓存(简单查询才缓存;multi 的组合查询缓存命中率低)
    const cacheable = decision.complexity === "simple" && !opts.noCache;
    // phase AA: 调用方显式 opts.lang 优先; 未传时用 planner 检测结果(zh 题自动切 zh 源腿)
    const runOpts = !opts.lang && decision.lang ? { ...opts, lang: decision.lang } : opts;
    const cacheKey = Cache.hash(JSON.stringify({
      q: decision.queries, r: decision.route, o: {
        f: runOpts.freshness, l: runOpts.lang, m: runOpts.maxResults, t: runOpts.topN,
        d: runOpts.domains, e: runOpts.engines,
      },
    }));
    if (cacheable) {
      const hit = this.cache.getSearch(cacheKey);
      if (hit) {
        this.cache.kvIncr("stat:search_cache_hit");
        const h = hit as SearchResult;
        return { ...h, meta: { ...h.meta, fromCache: true, elapsedMs: Date.now() - t0 }, planner: decision };
      }
    }

    // 多子查询: 逐个并行跑(dsh[10] SECONDARY_VARIANTS 廉价池思想)
    const engineForRoute = decision.route === "github" ? ["github", "duckduckgo", "mojeek"]
      : decision.route === "x" ? undefined /* runX 自己挑 */
        : opts.engines;

    // v0.6 域名路由分腿: 第 1 条子查询(原 query)走 Tier1 免 key API 专线,
    // 其余 site: 子查询走 siteEngines 通用引擎; 各腿独立熔断/健康, fusion 照旧聚合。
    const dp = decision.domainPlan;
    // phase AE(vs-zai 第 7 采样): leg-0 经 laneLegProviders — programming 专线补聚合兜底腿,
    // registry 专线(packages/devops)保持纯 API 腿; site: 子查询腿不变。
    const legEngines: (string[] | undefined)[] = dp
      ? decision.queries.map((_q, i) => (i === 0 ? laneLegProviders(dp.topic, dp.apiProviders) : dp.siteEngines))
      : decision.queries.map(() => engineForRoute);

    const batches = await Promise.all(
      decision.queries.map((q, i) =>
        decision.route === "x"
          ? this.router.runX(q, runOpts, "tweets")
          : this.router.run(q, runOpts, legEngines[i]),
      ),
    );

    // phase AH(vs-zai 第 11 采样, 24 题全量): 零结果抢救腿 — 实测两类管线级空手而归:
    //   ① github 专项窄腿(github/duckduckgo/mojeek)在熔断冷却期 3 腿全 skipped → 1ms 零 refs;
    //   ② images 专线 openverse 单腿合法空 → 整题塌方。
    // 修复: allRefs===0 且非 x 路由时, 用健康 keyless 聚合器(searxng/tavily/keenable)再试一轮。
    // 纪律: 已出勤/失败/跳过的引擎不重试(attempted 过滤); 软截止压缩到 min(原值, 3s) —
    //   抢救是兜底不是第二轮全量; 抢救腿再失败 → 行为回到空结果(真断网无额外伤害);
    //   正常查询 refs>0 时零开销(不触发)。
    let rescueBatches: typeof batches = [];
    if (batches.every((b) => b.refs.length === 0) && decision.route !== "x") {
      const attempted = new Set([
        ...batches.flatMap((b) => b.used),
        ...batches.flatMap((b) => b.failed.map((f) => f.name)),
        ...batches.flatMap((b) => (b.skipped ?? []).map((s) => s.name)),
      ]);
      // 尊重用户 engines 配置: 用户显式排除的引擎不被抢救腿强注入(engines=[] → 抢救自动失效)
      const allowed = new Set(this.cfg.engines);
      const rescueLegs = ["searxng", "tavily", "keenable"].filter((e) => !attempted.has(e) && allowed.has(e));
      if (rescueLegs.length) {
        this.#journal?.write("zero_ref_rescue", { query: rawQuery, legs: rescueLegs });
        try {
          rescueBatches = [await this.router.run(rawQuery, { ...runOpts, softDeadlineMs: Math.min(runOpts.softDeadlineMs ?? this.cfg.softDeadlineMs, 3000) }, rescueLegs)];
        } catch { /* 抢救失败不吞掉主流程: 保持空结果原语义 */ }
      }
    }

    const used = [...new Set([...batches, ...rescueBatches].flatMap((b) => b.used))];
    const failed = [...batches, ...rescueBatches].flatMap((b) => b.failed);
    const skipped = [...batches, ...rescueBatches].flatMap((b) => b.skipped ?? []);
    const allRefs: Reference[] = [...batches, ...rescueBatches].flatMap((b) => b.refs);

    // v0.2 语义融合: URL 去重+RRF → 相关过滤(可选) → embedding 去重(>0.75 合并)
    // v0.8 质量评测(quality-bench case-3)发现: 通用查询里学术域名全量强提权会把
    // 事实型查询的字面命中论文顶过真正的答案页(wiki) → topic 感知分档:
    // academic 专线 0.75(反超"标题党多命中一个词"), 通用 0.4(仅同层微调)。
    // v0.8 case-4 二次发现: domainCap 对单源专线是误伤(crates 腿 10 条全 crates.io 域,
    // cap=3 裁掉 7 成连头部包都丢) → packages/devops registry 专线保 0。
    // phase AC 实测教训(docker compose 题): s 档(1.2)上线后混源主题里 mdn 单源多条
    // 同域页全 +1.2 → cap=0 下 MDN 霸屏 MISS → programming/academic 混源主题恢复 3。
    // phase AC: 三层权威(全局兜底/主题分档/意图类别)+zh 守卫+社区意图翻转, 检测在 authority.ts,
    // 传参在融合层生效(召回面不变 — 用户"召回/质量分层"架构指令)。
    const { refs, meta: fuseMeta } = await fuseSemantic(allRefs, {
      query: rawQuery, topN: opts.topN ?? 20, embedder: this.embedder,
      authorityBoost: decision.domainPlan?.topic === "academic" ? 0.75 : 0.4,
      domainCap: decision.domainPlan
        ? (decision.domainPlan.topic === "packages" || decision.domainPlan.topic === "devops" ? 0 : 3)
        : 3,
      topic: decision.domainPlan?.topic,
      category: detectCategory(rawQuery) ?? undefined,
      lang: runOpts.lang,
      communityIntent: detectCommunityIntent(rawQuery),
    });

    const result: SearchResult = {
      query: rawQuery,
      refs,
      meta: {
        enginesUsed: used,
        enginesFailed: failed,
        enginesSkipped: skipped,
        elapsedMs: Date.now() - t0,
        fromCache: false,
        // v0.4 降级信号: 多腿全灭或大面积缺席时告知调用方
        degraded: batches.some((b) => b.degraded) || rescueBatches.length > 0,
        // phase AH 零结果抢救腿出勤标记(诚实可见)
        rescued: rescueBatches.length > 0,
        // v0.8 置信度筛选: 被硬屏蔽剔除的内容农场条数(透明可审计)
        spamBlocked: fuseMeta.spamBlocked,
        // phase AF 页面级守卫: 权威提权被清零的条数(域名对但页面对不是查询要的)
        authorityGuarded: fuseMeta.authorityGuarded,
      },
    };
    this.#journal?.write("fusion", {
      used, failed: failed.length, fused: refs.length,
      dedupMerged: fuseMeta.dedupMerged, relevanceDropped: fuseMeta.relevanceDropped,
      embedder: fuseMeta.embedder, embedderFailed: fuseMeta.embedderFailed,
      authorityGuarded: fuseMeta.authorityGuarded,
    });
    if (cacheable) this.cache.putSearch(cacheKey, result);
    return { ...result, planner: decision };
  }

  async xSearch(query: string, kind = "tweets", opts: SearchOptions = {}): Promise<SearchResult & { planner: PlannerDecision }> {
    const decision: PlannerDecision = {
      complexity: "simple", queries: [query], route: "x",
      reasons: ["explicit x_search call"],
    };
    const t0 = Date.now();
    const { refs, used, failed } = await this.router.runX(query, opts, kind);
    // x 结果同域是特性(twitter/x.com), 多样性 cap 不适用
    const { refs: fused } = await fuseSemantic(refs, { query, topN: opts.topN ?? 20, embedder: this.embedder, domainCap: 0 });
    for (const r of fused) r.kind = "x";
    return {
      query, refs: fused, planner: decision,
      meta: { enginesUsed: used, enginesFailed: failed, elapsedMs: Date.now() - t0, fromCache: false },
    };
  }

  async fetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
    this.cache.kvIncr("stat:fetch_total");
    return this.fetcher.run(url, opts, this.fetcher.policyFor(opts_noDomains(opts), undefined));
  }

  /** v0.2: Research Loop(状态机详情见 research.ts;进度事件经 onEvent 外抛) */
  async deepResearch(
    query: string,
    opts: ResearchOptions = {},
    onEvent?: (e: ResearchEvent) => void,
  ): Promise<ResearchResult> {
    this.cache.kvIncr("stat:research_total");
    return (await this.#getResearch()).run(query, opts, onEvent);
  }

  /** v0.2: 断点恢复(journal replay → 从未完成循环继续) */
  async resumeResearch(runId: string, opts: ResearchOptions = {}, onEvent?: (e: ResearchEvent) => void): Promise<ResearchResult> {
    this.cache.kvIncr("stat:research_total");
    return (await this.#getResearch()).resume(runId, opts, onEvent);
  }

  /**
   * v0.5 缓存即搜索面(wigolo[09] Top3): 全文搜已抓页面语料 — 重复查询/网络引擎全灭时秒回本地。
   * FTS5 trigram 为主(中文 ≥3 字), 短 query/索引缺失走 LIKE 兜底。
   */
  searchCache(query: string, limit = 10): CacheSearchHit[] {
    this.cache.kvIncr("stat:cache_search_total");
    return this.cache.searchPages(query, limit);
  }

  providers() {
    return this.router.listProviders();
  }

  stats() {
    return {
      ...this.cache.stats(),
      counters: {
        searchTotal: Number(this.cache.kvGet("stat:search_total") ?? 0),
        searchCacheHits: Number(this.cache.kvGet("stat:search_cache_hit") ?? 0),
        cacheSearchTotal: Number(this.cache.kvGet("stat:cache_search_total") ?? 0),
        fetchTotal: Number(this.cache.kvGet("stat:fetch_total") ?? 0),
        researchTotal: Number(this.cache.kvGet("stat:research_total") ?? 0),
      },
    };
  }

  clearSearchCache() {
    this.cache.clearSearchCache();
  }

  close() {
    this.cache.close();
  }
}

function opts_noDomains(_o: FetchOptions): string[] | undefined {
  return undefined; // v0.1: fetch 不带 run 级 allow;黑名单已走全局
}
