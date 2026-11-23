/**
 * Engine Router (v0-spec §4.2)
 * - allSettled 全并行,单引擎 timeout(signal),慢腿剔除不阻塞
 * - v0.4 软截止: 到点先收割已完成的引擎,慢腿主动断开不再干等(用户体感延迟≈最快引擎群)
 * - 健康熔断 2.0: 按失败分类差异化阈值/冷却 + 半开探针冷却翻倍(见 providers/base.ts)
 * - v0.4 额度门: key 引擎插槽(tavily/brave/exa)本地月度计数,用尽自动跳过→免 key 池天然接管
 * - x_search 路由: site:x.com 降级方案第一层(dsh[10] 四层降级链的 v0.1 部分)
 */
import type { Reference, SearchOptions, EngineFailure, EngineSkip, Freshness } from "./types.js";
import type { Provider, FetchImpl, SearchCtx } from "./providers/base.js";
import { HealthTracker, classifyFailure } from "./providers/base.js";
import { QuotaTracker } from "./quota.js";
import {filterEvidence} from "./relevance.js";
import { searxng } from "./providers/searxng.js";
import { duckduckgo } from "./providers/duckduckgo.js";
import { mojeek } from "./providers/mojeek.js";
import { yahoo } from "./providers/yahoo.js";
import { brave, tavily, exa, github } from "./providers/api.js";
// v0.3 免 key 扩池(targets-search.md P0): marginalia(api2)/openverse/hn/wikipedia/bingrss + arxiv/crossref/mwmbl/googlenews
import {
  marginalia, openverse, hn, wikipedia, bingrss, arxiv, crossref, mwmbl, googlenews, wiby, keenable,
} from "./providers/keyless-apis.js";
// phase AA 对照轮增量: MDN 官方文档直连 API(编程主题 Tier1; documents=[] 合法空不熔断)
import { mdn } from "./providers/keyless-apis.js";
// v0.5 时间机器双 provider(MiroThinker 裁决"值得抄"落地): wayback 快照时间线 / wikirev 修订历史
import { wayback, wikirev } from "./providers/timemachine.js";
// v0.8 外部 MCP 搜索连接器(gpt-researcher RETRIEVER=mcp 思想): 配了才注册
import { buildMcpConnectors } from "./providers/mcp-connector.js";
// v0.6 域名表 Tier1 新人: stackexchange(免 key 300/天) + npm(包名垂直)
import { stackexchange, npm } from "./providers/keyless-apis.js";
// phase AB(免 Key 增量轮): anysearch(托管聚合,默认池)/firecrawl(keyless 聚合,显式启用)/sov2ex(中文社区,编程题中文腿)
import { anysearch, firecrawl, sov2ex } from "./providers/keyless-apis.js";
// v0.7 注册表与垂直资产层: 包管理器四兄弟/开发者资产/学术双补/实体背景(全部免 key 官方 API)
import {
  crates, packagist, rubygems, huggingface, dockerhub, openalex, dblp, wikidata, nominatim,
} from "./providers/registries.js";
// phase AB: pubmed(生物医学文献 eutils 两步式, academic 腿)
import { pubmed } from "./providers/registries.js";
// phase AG-1: pypi(包元数据直取+license) / hfpapers(HF Papers AI 论文搜索)
import { pypi, hfpapers } from "./providers/registries.js";
// phase AJ: 安全三腿 nvd/osv/ghsa(CVE 编号直取官方元数据, 无编号合法空) + bingnews(新闻垂直 RSS)
import { nvd, osv, ghsa } from "./providers/registries.js";
// phase AM: 词典/医学研究/数据 类目官方面(探针第 4 批, 全部免 key)
import { wiktionary, europepmc, clinicaltrials, worldbank } from "./providers/registries.js";
import { bingnews } from "./providers/keyless-apis.js";
import type { CoreConfig } from "./config.js";
import type { Journal } from "./journal.js";
import type { Cache } from "./cache.js";

export interface RouterDeps {
  config: CoreConfig;
  health: HealthTracker;
  journal?: Journal;
  fetchImpl?: FetchImpl;
  /** v0.2: xchain 的 kv 持久化用 */
  cache?: Cache;
  /** 测试注入: 覆盖默认 provider 集 */
  providers?: Provider[];
  /** v0.4: 测试注入额度计数器(默认按 config 建) */
  quota?: QuotaTracker;
}

/** 额度管控表: 配置里的月度额度 → QuotaTracker(0/缺省 = 不管控) */
function quotaLimits(cfg: CoreConfig): Record<string, number> {
  const out: Record<string, number> = {};
  if (cfg.tavily?.monthlyQuota) out.tavily = cfg.tavily.monthlyQuota;
  if (cfg.brave?.monthlyQuota) out.brave = cfg.brave.monthlyQuota;
  if (cfg.exa?.monthlyQuota) out.exa = cfg.exa.monthlyQuota;
  return out;
}

export function buildProviders(cfg: CoreConfig): Provider[] {
  searxng.config = { baseUrl: cfg.searxng?.baseUrl, engines: cfg.searxng?.engines, instances: cfg.searxng?.instances };
  brave.config = { apiKey: cfg.brave?.apiKey };
  tavily.config = { apiKey: cfg.tavily?.apiKey, baseUrl: cfg.tavily?.baseUrl };
  exa.config = { apiKey: cfg.exa?.apiKey };
  firecrawl.config = { apiKey: cfg.firecrawl?.apiKey };
  crossref.config = { email: cfg.contactEmail };
  openalex.config = { email: cfg.contactEmail };
  pubmed.config = { email: cfg.contactEmail };
  return [
    searxng, duckduckgo, mojeek, yahoo,
    marginalia, hn, wikipedia, bingrss, arxiv, crossref, wiby, keenable,
    anysearch, // 默认池 13 引擎(phase AB: 托管聚合免 key 车道, 独立索引覆盖增量)
    // (tavily 在 keySlots=auto 下无 key 也自动并入默认池——phase AB keyless 车道, 探针连打 6 发全 200)
    openverse, mwmbl, googlenews, // 显式 engines 启用(图片/备胎/新闻)
    firecrawl, // phase AB: 显式 engines/research 启用(keyless 聚合; 描述带 markdown 噪音, 待 bench 观察升池)
    wayback, wikirev, // 显式 engines 启用(时间机器: query 是 URL/词条名不是关键词)
    stackexchange, npm, sov2ex, // 显式 engines/域名路由启用(编程垂直; sov2ex 仅中文题进腿)
    crates, packagist, rubygems, // 显式 engines/域名路由启用(packages 主题: 跨语言包搜索)
    pypi, // phase AG-1: 显式/域名路由启用(packages 主题: 包名精确查询+license; 非包名合法空)
    hfpapers, // phase AG-1: 显式/域名路由启用(academic 主题: HF Papers AI 论文面)
    huggingface, dockerhub, // 显式 engines/域名路由启用(ai-models/devops 主题)
    openalex, dblp, pubmed, // 显式 engines/域名路由启用(academic 主题: 被引数+CS 会议+生物医学)
    wikidata, // 显式 engines/域名路由启用(entities 主题: 实体背景/消歧)
    nominatim, // phase AD: 显式/域名路由启用(geo 主题: OSM 地理编码, 空结果=合法空)
    mdn, // phase AA: 显式/域名路由启用(web 官方文档面: locale 跟随查询语言)
    nvd, osv, ghsa, // phase AJ: 显式/域名路由启用(security 主题三腿: CVE 编号元数据直取; 非编号题合法空)
    bingnews, // phase AJ: 显式/域名路由启用(news 主题腿: 新闻垂直 RSS, apiclick 内嵌真实出版方链接)
    wiktionary, europepmc, clinicaltrials, worldbank, // phase AM: 显式/域名路由启用(dictionary/medical/data 类目官方面)
    brave, tavily, exa, github,
    ...buildMcpConnectors(cfg.mcpConnectors), // v0.8: 外部 MCP 搜索连接器(配了才注册; phase AB argsTemplate 支持任意参数形状)
  ];
}

const byName = (ps: Provider[]) => new Map(ps.map((p) => [p.name, p]));

export class Router {
  #providers: Map<string, Provider>;
  #cfg: CoreConfig;
  #health: HealthTracker;
  #journal?: Journal;
  #fetchImpl: FetchImpl;
  #cache?: Cache;
  #quota: QuotaTracker;

  constructor(deps: RouterDeps) {
    this.#cfg = deps.config;
    this.#health = deps.health;
    this.#journal = deps.journal;
    this.#fetchImpl = deps.fetchImpl ?? fetch;
    this.#cache = deps.cache;
    this.#quota = deps.quota ?? new QuotaTracker(deps.cache ?? null, quotaLimits(deps.config));
    this.#providers = byName(deps.providers ?? buildProviders(deps.config));
  }

  /** Undefined uses automatic routing; an explicit array is a provider allowlist, including []. */
  normalizeEngines(value: unknown): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 100 || value.some(n => typeof n !== "string" || !n || n !== n.trim())) {
      throw new Error("Invalid engines: expected up to 100 nonempty exact provider names");
    }
    for (const name of value) if (!this.#providers.has(name)) throw new Error("Unknown engine: " + name);
    return [...new Set(value)].sort();
  }

  get quota(): QuotaTracker {
    return this.#quota;
  }

  listProviders() {
    // phase AC 额度可见性: 受控引擎透出 used/remaining/exhausted/resetsAt(用户问"额度满了怎么办" — 先能看见)
    return [...this.#providers.values()].map((p) => {
      const snap = this.#health.snapshot(p.name, p.isConfigured(), p.needsKey);
      const q = this.#quota.snapshot(p.name);
      return q ? { ...snap, quota: q } : snap;
    });
  }

  /**
   * 并行执行多引擎搜索 (v0.4: 软截止+额度门+插槽自动并联+失败标注)。
   * @param engineNames planner引擎清单；undefined用默认池，[]不出勤；opts.engines优先且严格限制provider选择。
   */
  async run(query: string, opts: SearchOptions, engineNames?: string[], evidenceQuery?: string): Promise<{
    refs: Reference[];
    used: string[];
    failed: EngineFailure[];
    /** v0.4: 因熔断/额度尽/未配置而没出场的引擎 */
    skipped: EngineSkip[];
    /** v0.4: 出勤引擎不到一半或全灭 → 调用方应降低对结果信任 */
    degraded: boolean;
  }> {
    const callerSelection = this.normalizeEngines(opts.engines);
    const selection = callerSelection ?? this.normalizeEngines(engineNames);
    const explicit = selection !== undefined;
    const names = selection !== undefined ? [...selection] : [...this.#cfg.engines].filter(Boolean);
    const finite = (v: number | undefined, fallback: number) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
    const timeoutMs = Math.max(1, Math.min(120000, finite(opts.timeoutMs ?? this.#cfg.timeoutMs, 12000)));
    const softMs = Math.min(timeoutMs, finite(opts.softDeadlineMs ?? this.#cfg.softDeadlineMs, 6000));
    const recoveryMs = Math.min(timeoutMs, Math.max(softMs, finite(opts.recoveryDeadlineMs ?? this.#cfg.recoveryDeadlineMs, softMs)));

    // v0.4 key 插槽自动并联: 走默认池(未显式点名)时,已配 key 且额度未尽的插槽引擎自动加入;
    // 额度用尽后 allow() 返回 false → 不加入 → 免 key 池接管(回落零代码)
    if (!explicit && this.#cfg.keySlots === "auto") {
      for (const p of this.#providers.values()) {
        if (p.keySlot && p.isConfigured() && this.#quota.allow(p.name) && !names.includes(p.name)) {
          names.push(p.name);
        }
      }
    }

    const skipped: EngineSkip[] = [];
    const seen = new Set<string>();
    const active = names
      .map((n) => this.#providers.get(n))
      .filter((p): p is Provider => !!p)
      .filter((p) => {
        if (seen.has(p.name)) return false; // 显式清单重复点名去重
        seen.add(p.name);
        if (!p.isConfigured()) {
          skipped.push({ name: p.name, status: "not_configured" });
          return false;
        }
        if (this.#health.isOpen(p.name)) {
          skipped.push({ name: p.name, status: "circuit_open", detail: "breaker cooling down" });
          this.#journal?.write("engine_skip_circuit_open", { engine: p.name });
          return false;
        }
        if (this.#quota.governed(p.name) && !this.#quota.allow(p.name)) {
          skipped.push({
            name: p.name, status: "quota_exhausted",
            detail: `monthly quota used up (limit ${this.#quota.limitOf(p.name)}), keyless pool takes over`,
          });
          this.#journal?.write("engine_skip_quota", { engine: p.name });
          return false;
        }
        return true;
      });

    const used: string[] = [];
    const failed: EngineFailure[] = [];
    const allRefs: Reference[] = [];
    let pending = active.length;
    const states = new Map(active.map(p => [p.name, { reported: false }]));
    const controller = new AbortController();
    const started = Date.now();
    // Completion bookkeeping owns health writes. Late/uncooperative providers are ignored.
    const collectors = active.map(p => {
      const ctx: SearchCtx = {fetchImpl:this.#fetchImpl,signal:controller.signal,ua:this.#cfg.userAgent,
        opts:{...opts,timeoutMs,softDeadlineMs:softMs,recoveryDeadlineMs:recoveryMs}};
      const settle = (refs?: Reference[], error?: unknown) => {
        const state = states.get(p.name)!;
        if (state.reported) return;
        state.reported = true; pending--;
        const elapsedMs = Date.now()-started;
        if (refs) {
          used.push(p.name); allRefs.push(...refs);
          this.#health.record(p.name,true,elapsedMs);
          this.#quota.record(p.name);
          this.#journal?.write("engine_result",{engine:p.name,count:refs.length,ms:elapsedMs});
        } else {
          const msg = error instanceof Error ? error.message : String(error);
          const cls = classifyFailure(msg);
          this.#health.record(p.name,false,elapsedMs,msg,cls.status);
          if (cls.status === "quota" && this.#quota.governed(p.name)) this.#quota.exhaust(p.name);
          failed.push({name:p.name,error:msg.slice(0,200),elapsedMs,...cls});
          this.#journal?.write("engine_error",{engine:p.name,error:msg.slice(0,200),ms:elapsedMs,...cls});
        }
      };
      return Promise.resolve().then(()=>p.search(query,ctx)).then(refs=>settle(refs),error=>settle(undefined,error));
    });
    const attempted = active.length;
    const harvestMs = finite(this.#cfg.earlyHarvestMs,0);
    let cause: "early_harvest" | "soft_deadline" | "hard_deadline" | undefined;
    while (pending > 0) {
      const elapsed = Date.now()-started;
      // Legacy raw Router callers retain their counting semantics. SearchCore supplies raw intent.
      const evidence = evidenceQuery === undefined ? allRefs : filterEvidence(evidenceQuery,allRefs).refs;
      const count = new Set(evidence.map(r=>r.url)).size;
      const enough = attempted-pending >= Math.ceil(attempted*.6) && count >= 15;
      if (elapsed >= timeoutMs) {cause="hard_deadline";break;}
      if (softMs > 0 && harvestMs > 0 && elapsed >= harvestMs && enough) {cause="early_harvest";break;}
      if (softMs > 0 && elapsed >= softMs &&
          (evidenceQuery === undefined || count > 0 || elapsed >= recoveryMs)) {cause="soft_deadline";break;}
      await new Promise(resolve=>setTimeout(resolve,Math.max(1,Math.min(25,timeoutMs-elapsed))));
    }
    if (pending > 0 && cause) {
      const elapsedMs = Date.now()-started;
      // Mark before abort: an abort-aware provider must not duplicate bookkeeping or poison health.
      for (const [name,state] of states) if (!state.reported) {
        state.reported = true;
        const error = cause.replaceAll("_"," ")+": aborted after "+elapsedMs+"ms";
        failed.push({name,error,elapsedMs,status:"timeout",retryable:true,cancellation:cause});
        if (cause === "hard_deadline") this.#health.record(name,false,elapsedMs,error,"timeout");
      }
      this.#journal?.write("soft_deadline",{aborted:pending,softMs,recoveryMs,cause,earlyHarvest:cause==="early_harvest"});
      controller.abort(new Error(cause));
    }
    // Each collector handles rejection; do not await providers which ignore cancellation.
    void collectors;

    const degraded = attempted > 0 && (used.length === 0 || used.length / attempted < 0.5);
    return { refs: allRefs, used, failed, skipped, degraded };
  }

  /**
   * X 搜索 v0.2: 完整降级链 (xchain.ts)
   * 官方 API(有 key) ∥ Guest GraphQL(queryId 轮换自愈) ∥ site:x.com keyless → oEmbed 增强
   * 链模块整体异常时回落 v0.1 纯 site: 路由(永不空手)。
   */
  async runX(query: string, opts: SearchOptions, kind: string): Promise<{
    refs: Reference[];
    used: string[];
    failed: EngineFailure[];
    skipped: EngineSkip[];
    degraded: boolean;
  }> {
    const selection = this.normalizeEngines(opts.engines);
    if (selection !== undefined) {
      // Do not run official/guest/oEmbed layers outside an explicit provider allowlist.
      const siteQuery = query.includes("site:x.com") || query.includes("site:twitter.com")
        ? query : query + " (site:x.com OR site:twitter.com)";
      const result = await this.run(siteQuery, { ...opts, engines: selection });
      return { ...result, refs: result.refs.map(ref => ({ ...ref, kind: "x" as const })) };
    }
    try {
      const { xSearchChain } = await import("./xchain.js");
      const result = await xSearchChain(query, opts, {
        config: this.#cfg,
        cache: this.#cache ?? (this.#health.backingCache as unknown as Cache),
        health: this.#health,
        journal: this.#journal,
        fetchImpl: this.#fetchImpl,
        runKeyless: (siteQuery, o) => this.run(siteQuery, o),
      });
      const refs = result.refs.map((r) => ({ ...r, kind: "x" as const }));
      if (kind === "users") {
        refs.sort((a, b) => Number(/^@?\w{1,15}$|on X/.test(b.title)) - Number(/^@?\w{1,15}$|on X/.test(a.title)));
      }
      return { refs, used: result.used, failed: result.failed, skipped: [], degraded: false };
    } catch {
      // 链模块异常 → v0.1 降级路径(site: 免 key 引擎)
      const siteQuery = `${query} (site:x.com OR site:twitter.com)`;
      const keyless = ["duckduckgo", "mojeek", "yahoo", ...(this.#cfg.searxng ? ["searxng"] : [])];
      const { refs, used, failed, skipped, degraded } = await this.run(siteQuery, opts, keyless);
      for (const r of refs) r.kind = "x";
      return { refs, used, failed, skipped, degraded };
    }
  }
}
