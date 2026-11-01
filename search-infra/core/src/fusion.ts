/**
 * Fusion & Dedup (v0-spec §4.3)
 * 1. URL 归一化去重(ODR[11] keep_first)
 * 2. RRF 粗排: score = Σ 1/(60+engineRank)
 * 3. 词法相关性修正(v0.1 双信号)
 * 4. (v0.2) embedding 双阈值 (Perplexica[12] 方案):
 *    - 相关过滤: query↔ref 相似度 < threshold(默认关,开=0.5) → 丢弃
 *    - 语义去重: ref↔ref 相似度 > 0.75 → 合并(不同 URL 的转载/同稿)
 *    - 失败语义: embedder 挂 → similarity=1 全部放行(baseSearch.ts:73-86 教训)
 */
import type { Reference } from "./types.js";
import { cosine, TF_EMBEDDER, type Embedder } from "./embed.js";
import { matchAuthority, matchTopicAuthority, matchCategoryAuthority, classifySourceKind } from "./authority.js";
import { matchSpamBlocked, matchSpamDownweight, SPAM_DOWNWEIGHT_PENALTY } from "./credibility.js";

/** URL 归一化: 去追踪参数/fragment/尾斜杠,host 小写; v0.3 补 MetaSearchMCP[deep] 具名追踪参数 + query 参数排序(参数乱序可合并) */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    const TRACKERS = /^(utm_.*|ref_.*|fbclid|gclid|igshid|mc_cid|mc_eid|dclid|gclsrc|mkt_tok|msclkid|twclid|yclid)$/i;
    const drop: string[] = [];
    u.searchParams.forEach((_, k) => {
      if (TRACKERS.test(k)) drop.push(k);
    });
    drop.forEach((k) => u.searchParams.delete(k));
    // query 参数键值对排序(归一化后不同引擎给的参数顺序差异可合并)
    const pairs = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    u.search = "";
    for (const [k, v] of pairs) u.searchParams.append(k, v);
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return raw;
  }
}

const STOP = new Set([
  "the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "is", "are", "was", "were",
  "what", "how", "why", "when", "which", "who", "with", "at", "by", "from", "about",
  "的", "了", "是", "在", "和", "与", "有", "对", "怎么", "如何", "什么", "为什么", "哪个",
]);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** 词法相关性: title 权重 2x,命中词比例 0-1 */
export function lexicalScore(query: string, title: string, snippet: string): number {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return 0;
  const hay = tokenize(title + " " + title + " " + snippet); // title 计两次
  const hit = new Set<string>();
  for (const t of terms) if (hay.includes(t)) hit.add(t);
  return hit.size / terms.length;
}

/**
 * 页面级相关性守卫(phase AF): 查询关键 token 在 title/snippet/url 任一出现才保留权威提权。
 * 根因(vs-zai 第 7 采样): s 档是域级提权, 域名对≠页面对 — asyncio 题 MDN zh 教程页×3 进 top5,
 * 页面内容与 asyncio 无关, 域名分 1.2 压过真正的官方面。
 * 关键 token 选取: 有 ASCII token 时取最长 ASCII(技术词锚, 抗 zh 长词噪音: "npm 使用教程"锚 npm
 * 而非中文长 run); 纯 zh 查询取最长 run(子串包含可命中派生词)。
 * 判定用子串而非词边界: fail-open — 子串误报(js→json)方向是"保留提权"(安全侧), 词边界误伤
 * 官方短标题页是有害侧。
 *
 * phase AI 多证据放行(vs-zai 第 12 采样诊断): 最长锚是单一启发式, 多概念查询会锚到语义次要的
 * 长词(如 log4j CVE 题锚到 "mitigation" → rapid7 官方分析页含 log4j+cve+44228 却被清零;
 * 个人信息保护法题锚到长 run → cac.gov.cn 数据跨境专页被清零, 不清零即 #1)。放行规则收紧后
 * 加一条多证据通道: 长锚缺席但页面命中 ≥2 个其他查询 token → 仍算切题(保留提权)。
 * 回归安全: asyncio MDN 错页在查询 token 零命中(present=0) → 仍 false; 单 token 池(如 "npm 使用
 * 教程" 锚 npm)无第二个证据 → 语义不变。
 */
export function keyTermPresent(query: string, url: string, title: string, snippet: string): boolean {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return true; // 无可判定 → 放行(不打压)
  const ascii = terms.filter((t) => /^[\x21-\x7e]+$/.test(t));
  const pool = ascii.length > 0 ? ascii : terms;
  const hay = `${title} ${snippet} ${url}`.toLowerCase();
  const present = pool.filter((k) => hay.includes(k));
  if (present.length === 0) return false;
  const maxLen = Math.max(...pool.map((t) => t.length));
  if (present.some((k) => k.length === maxLen)) return true;
  // phase AI 多证据放行: 长锚缺席但命中 ≥2 个其他查询 token
  return present.length >= 2;
}

/**
 * phase AI 类目正主前排(vs-zai 第 12 采样诊断): 查询命中类目 且 条目来自该类目表且为 s 档时,
 * 提权从 1.2 提到 2.0 — 类目型查询("谁是正主")的 s 档官方源应进前排。
 * 量化依据: dev.mysql.com 在池排 #10 差 +0.9 进 top1; federalreserve 差 +0.3 丢 #1;
 * 2.0(=1.2+0.8) 两题均翻正且有余量。只作用于【命中的类目表】s 档(主题表/全局表/其他类目不动),
 * AF 页面守卫仍然生效(页面不切题照样清零), domainCap 照常防霸屏 — 三道关全部保留。
 */
const CATEGORY_S_FRONTROW = 2.0;

// ---------- phase AK: 注册域近似(eTLD+1)——domainCap 计数粒度修复 ----------
// 常见两级 TLD 白名单(不带 PSL 依赖的务实近似); 命中取三段, 其余取两段, www 剥离。
// 例子: sports.yahoo.co.jp→yahoo.co.jp / en.wikipedia.org→wikipedia.org / a.example.com→example.com
const TWO_LEVEL_TLDS = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "co.jp", "or.jp", "ne.jp", "ac.jp",
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "co.kr", "or.kr",
  "com.au", "net.au", "org.au", "com.hk", "org.hk", "com.tw", "org.tw",
  "com.br", "com.mx", "co.in", "co.nz", "co.za", "com.sg", "co.il",
]);

export function registrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const last2 = parts.slice(-2).join(".");
  if (TWO_LEVEL_TLDS.has(last2)) return parts.slice(-3).join(".");
  return last2;
}

/** 全词命中 title 独立加分(MetaSearchMCP[deep]: 词边界切分, 抗 "react"→"reactive" 误伤) */
export function titleAllTermsBonus(query: string, title: string): number {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return 0;
  const hay = new Set(tokenize(title));
  return terms.every((t) => hay.has(t)) ? 1 : 0;
}

export interface FuseOptions {
  topN?: number;
  query: string;
  /** v0.8 权威域名提权分(默认 0.75); 0=关闭。命中表内域名加此项并标注 ref.authority */
  authorityBoost?: number;
  /** phase AC 主题表: 域路由命中 topic 时启用 TOPIC_AUTHORITY 分档提权 */
  topic?: string;
  /** phase AC 意图表: detectCategory( query ) 命中的类别, 不改路由只影响排序 */
  category?: string;
  /** phase AC zh 守卫: entry.lang==="zh" 只在 "zh" 时生效(planner 自动检测或调用方显式传) */
  lang?: string;
  /** phase AC 社区意图: "找讨论/观点"查询时 kind=community 条目升 s 档 */
  communityIntent?: boolean;
}

/**
 * 融合输入: 每引擎按序返回的 Reference 数组
 * 输出: 全局 refId 编号 + 排序后的扁平列表
 */
export function fuse(engineLists: Reference[], opts: FuseOptions): Reference[] {
  const topN = opts.topN ?? 20;
  const byUrl = new Map<string, Reference & { engineRanks: number[] }>();

  let engineIdx = 0;
  let prevEngine: string | null = null;
  const rankInEngine = new Map<string, number>();

  for (const r of engineLists) {
    const eng = r.engines[0] ?? "?";
    if (eng !== prevEngine) {
      engineIdx++;
      prevEngine = eng;
    }
    const rank = (rankInEngine.get(eng) ?? 0) + 1;
    rankInEngine.set(eng, rank);

    const key = normalizeUrl(r.url);
    if (!key.startsWith("http")) continue;
    const existing = byUrl.get(key);
    if (existing) {
      if (!existing.engines.includes(eng)) existing.engines.push(eng);
      if (r.snippet.length > existing.snippet.length) existing.snippet = r.snippet;
      if (!existing.title && r.title) existing.title = r.title;
      existing.engineRanks.push(rank);
    } else {
      byUrl.set(key, { ...r, url: key, engineRanks: [rank] });
    }
  }

  const fused = [...byUrl.values()].map((r) => {
    const rrf = r.engineRanks.reduce((acc, rank) => acc + 1 / (60 + rank), 0);
    const lex = lexicalScore(opts.query, r.title, r.snippet);
    // v0.3: 共识加权(MetaSearchMCP[deep] consensus 思想, 上限 3 路) — 多引擎独立返回是强权威信号
    const consensusBoost = 0.35 * Math.min(r.engines.length - 1, 2);
    const titleBonus = titleAllTermsBonus(opts.query, r.title) * 0.25;
    // v0.8: 权威域名提权(用户提案"优先域名") — 只提权不屏蔽, 命中者在 ref.authority 标注
    // 0.75 = 大于一个词的 lex 全命中差(0.5), 小于两个词(1.0): 无关学术页仍压不过强相关结果
    // phase AC: 三层权威取最强计一次分(全局兜底 / 主题分档 / 意图类别), 非叠加 — 同域多层命中不双计
    const globalAuthority = matchAuthority(r.url);
    const topicMatch = opts.topic ? matchTopicAuthority(r.url, opts.topic, opts.lang, opts.communityIntent) : null;
    const catMatch = opts.category ? matchCategoryAuthority(r.url, opts.category, opts.lang, opts.communityIntent) : null;
    const tiered = [topicMatch, catMatch].filter((m): m is NonNullable<typeof m> => !!m)
      .sort((a, b) => b.boost - a.boost)[0] ?? null;
    const globalBoost = globalAuthority ? (opts.authorityBoost ?? 0.75) : 0;
    // phase AI 类目正主前排: URL 命中【查询所命中类目】表的 s 档 → 前排档(catMatch 非空 ⇒ tiered 非空)
    const catFrontrow = catMatch?.entry.tier === "s" ? CATEGORY_S_FRONTROW : 0;
    const matchedBoost = Math.max(tiered?.boost ?? 0, catFrontrow, globalBoost);
    const authorityDomain = tiered?.domain ?? globalAuthority;
    // phase AF 页面级守卫: 域名命中但页面不含查询关键 token → 提权清零(只压分不剔除, 页面仍靠 RRF/词法竞争)
    const pageHit = keyTermPresent(opts.query, r.url, r.title, r.snippet);
    const authorityBoost = pageHit ? matchedBoost : 0;
    return {
      ...r,
      score: rrf * 10 + lex * 1.5 + consensusBoost + titleBonus + authorityBoost,
      bestRank: Math.min(...r.engineRanks),
      ...(authorityDomain ? { authority: authorityDomain } : {}),
      // phase AF: 来源类型标注(纯元数据) + 守卫触发标注(透明可审计)
      ...(authorityDomain ? { sourceKind: classifySourceKind(r.url, tiered?.entry ?? { domain: authorityDomain }) ?? undefined } : {}),
      ...(authorityDomain && !pageHit ? { authorityGuarded: true } : {}),
    };
  });

  // v0.3: 显式 tie-break(MetaSearchMCP[deep]): 同分保引擎内最佳排名, 结果确定可复现
  fused.sort((a, b) => b.score - a.score || a.bestRank - b.bestRank);
  return fused.slice(0, topN).map((r, i) => {
    const { engineRanks: _drop, bestRank: _drop2, ...rest } = r;
    return { ...rest, rank: i + 1, refId: i + 1 };
  });
}

// ---------- v0.2: embedding 双阈值 (Perplexica[12]) ----------

export interface FuseSemanticOptions extends FuseOptions {
  /** query↔ref 相关过滤阈值(Perplexica 口径 0.5);undefined = 关闭 */
  relevanceThreshold?: number;
  /** ref↔ref 语义去重阈值(Perplexica 口径 0.75);undefined = 用默认 0.75 */
  dedupThreshold?: number;
  /** 语义阶段 embedder;缺省本地 TF(hash-trust,零网络) */
  embedder?: Embedder;
  /** v0.8 域名多样性: 单域名进结果上限(默认 3, 治单一权威源霸屏); 0=关闭 */
  domainCap?: number;
}

export interface FuseSemanticMeta {
  dedupMerged: number;
  relevanceDropped: number;
  embedder: string;
  embedderFailed: boolean;
  /** v0.8 置信度筛选: 硬屏蔽剔除条数(内容农场/点名灌水站) */
  spamBlocked: number;
  /** phase AF 页面级守卫: 权威提权被清零的条数(域名命中但页面缺查询关键 token) */
  authorityGuarded: number;
}

/**
 * 语义融合 = fuse(URL 去重+RRF) → 相关过滤 → 语义去重 → 重编 refId。
 * embedder 任何错误都不阻塞: 相关过滤跳过、去重跳过(等效 similarity=1 放行)。
 */
export async function fuseSemantic(
  engineLists: Reference[],
  opts: FuseSemanticOptions,
): Promise<{ refs: Reference[]; meta: FuseSemanticMeta }> {
  const meta: FuseSemanticMeta = {
    dedupMerged: 0, relevanceDropped: 0, embedder: "-", embedderFailed: false, spamBlocked: 0, authorityGuarded: 0,
  };
  const base = fuse(engineLists, {
    query: opts.query, topN: 100, // 先取宽池,语义阶段裁剪
    // phase AC: 三层权威参数透传(主题/意图/语言/社区意图)
    topic: opts.topic, category: opts.category, lang: opts.lang, communityIntent: opts.communityIntent,
  });

  // v0.8 置信度筛选(用户提案"屏蔽 csdn/百家号/搜狐等灌水站"):
  // 硬屏蔽剔除+计数; 降权档 -1.2 后重排(保后续语义去重的贪心顺序语义)
  const kept0: Reference[] = [];
  for (const r of base) {
    if (matchSpamBlocked(r.url)) { meta.spamBlocked++; continue; }
    const d = matchSpamDownweight(r.url);
    if (d) {
      r.spam = d;
      r.score = (r.score ?? 0) + SPAM_DOWNWEIGHT_PENALTY;
    }
    kept0.push(r);
  }
  if (meta.spamBlocked > 0 || kept0.some((r) => r.spam)) {
    kept0.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }
  let cur = kept0;

  const embedder = opts.embedder ?? TF_EMBEDDER;
  const dedupThreshold = opts.dedupThreshold ?? 0.75;

  try {
    // 1) 相关性过滤(可选)
    if (opts.relevanceThreshold !== undefined && cur.length > 0) {
      const texts = [opts.query, ...cur.map((r) => `${r.title} ${r.snippet}`)];
      const vecs = await embedder.embed(texts);
      meta.embedder = embedder.name;
      const [qv] = vecs;
      cur = cur.filter((r, i) => cosine(qv, vecs[i + 1]) >= opts.relevanceThreshold!);
      meta.relevanceDropped = base.length - cur.length;
    }

    // 2) 语义去重(贪心: 得分高者先占位,后来者与其比较)
    if (cur.length > 1) {
      const texts = cur.map((r) => `${r.title} ${r.snippet}`);
      const vecs = await embedder.embed(texts);
      meta.embedder = embedder.name;
      const kept: { ref: Reference; vec: number[] }[] = [];
      for (let i = 0; i < cur.length; i++) {
        const twin = kept.find((k) => cosine(k.vec, vecs[i]) > dedupThreshold);
        if (twin) {
          meta.dedupMerged++;
          const t = twin.ref;
          for (const e of cur[i].engines) if (!t.engines.includes(e)) t.engines.push(e);
          if ((cur[i].snippet?.length ?? 0) > (t.snippet?.length ?? 0)) t.snippet = cur[i].snippet;
          if (!t.title && cur[i].title) t.title = cur[i].title;
          if ((cur[i].published ?? "") > (t.published ?? "")) t.published = cur[i].published;
        } else {
          kept.push({ ref: cur[i], vec: vecs[i] });
        }
      }
      cur = kept.map((k) => k.ref);
    }
  } catch {
    // embedding 失败 → 放行置信度过滤后的结果(垃圾站仍被屏蔽, Perplexica[12] 失败语义)
    meta.embedderFailed = true;
    cur = kept0;
  }

  const topN = opts.topN ?? 20;
  // v0.8 域名多样性(用户提案"治单一权威源霸屏"): 排序后贪心挑选, 单域最多 domainCap 条
  // phase AK 修复(第 14 采样实证): cap 原按 hostname 计数, sports/baseball/weather.yahoo.co.jp
  // 三个不同主机各领各的配额 → yahoo.co.jp 集群×4 绕过 cap=3(security 题 top2-5 全是它)。
  // AC 治理意图是"单源霸屏"——子域集群是同一来源。改按注册域(近似 eTLD+1)计数:
  // 常见两级 TLD 白名单取三段, 其余取两段; www 前缀剥离。
  // 诚实边界: github.io/blogspot.com 等自由托管平台的跨用户子域现在共享 cap=3
  // (免费平台 junk 集群常见, 收紧方向正确); 未收录的两级 TLD 会被并成一段(近似可接受)。
  const domainCap = opts.domainCap ?? 3;
  const capped: Reference[] = [];
  if (domainCap > 0) {
    const seen = new Map<string, number>();
    for (const r of cur) {
      let h = "?";
      try { h = registrableDomain(new URL(r.url).hostname); } catch { /* 计入 ? 域 */ }
      const n = seen.get(h) ?? 0;
      if (n >= domainCap) continue;
      seen.set(h, n + 1);
      capped.push(r);
      if (capped.length >= topN) break;
    }
    cur = capped;
  }
  const out = cur.slice(0, topN).map((r, i) => ({ ...r, rank: i + 1, refId: i + 1 }));
  meta.authorityGuarded = out.filter((r) => r.authorityGuarded).length;
  return { refs: out, meta };
}
