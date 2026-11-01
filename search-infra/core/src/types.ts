/**
 * search-core v0.1 — 核心类型
 * 对应 design/v0-spec.md §3.3 统一引用体系:
 * 搜索结果不自成协议,统一 Reference 结构(Trae 报告[05]的启发)。
 * v0.4: 失败标注契约(wigolo[09] 学走,字段名自起):
 * 引擎失败不再是裸字符串,调用方能区分"等会儿重试"和"别试了换引擎"。
 */
import type { SourceKind } from "./authority.js";

/** 引擎失败/跳过的分类信号 (v0.4, 对应失败标注契约) */
export type EngineStatus =
  | "rate_limited"   // 429/202 软封类: 对方在说"慢点", 自愈快, 该退避重试
  | "blocked"        // 403/挑战页/验证码: 别硬碰, 冷却拉长
  | "quota"          // 432/433/402: 额度烧完, 本月/充值前没戏
  | "auth"           // 401/key 无效: 用户得修 key
  | "timeout"        // 超时/软截止剔除: 可以再试
  | "error"          // 其余(网络错/解析错/5xx): 默认可重试
  | "circuit_open";  // 跳过原因: 熔断中(出现在 skipped 里)

export interface EngineSkip {
  name: string;
  status: "circuit_open" | "quota_exhausted" | "not_configured";
  detail?: string;
}

export type Kind = "web" | "x" | "github" | "news" | "image" | "archive" | "geo";

/** 统一引用结构 (v0-spec §3.3) */
export interface Reference {
  /** 出口编号,由引擎统一分配 (1-based) */
  refId?: number;
  url: string;
  title: string;
  snippet: string;
  /** 哪些引擎返回了它 (fusion 合并后) */
  engines: string[];
  /** 融合得分 (RRF + 词法相关性) */
  score?: number;
  rank?: number;
  kind?: Kind;
  /** 引擎提供的发布时间 (ISO 或原文) */
  published?: string;
  /** v0.8 权威域名命中标注 (authority.ts 表内域名, 如 "arxiv.org") */
  authority?: string;
  /** phase AF 来源类型标注 (classifySourceKind 推导: official/community/media/expert/reference; 纯元数据不参与排序) */
  sourceKind?: SourceKind;
  /** phase AF 页面级守卫触发标注: 域名命中权威表但页面缺查询关键 token → 提权被清零 */
  authorityGuarded?: boolean;
  /** v0.8 置信度降权标注 (credibility.ts 降权表域名, 如 "ehow.com"); 硬屏蔽条不会出现在结果里 */
  spam?: string;
  /** phase AG-4: 许可证字段(registry 系 API 本就返回时透传, 如 pypi "Apache-2.0"); 其余源诚实不带 */
  license?: string;
}

export type Freshness = "day" | "week" | "month" | "year" | "any";

export interface SearchOptions {
  freshness?: Freshness;
  lang?: string;
  /** 每引擎结果数上限,默认 10 */
  maxResults?: number;
  /** 融合后保留条数,默认 20 */
  topN?: number;
  domains?: { allow?: string[]; block?: string[] };
  /** 显式指定引擎列表(覆盖默认/健康度选择) */
  engines?: string[];
  /** 单引擎超时 ms,默认 12000 (v0-spec §4.2: 12s Promise.race 剔除慢腿) */
  timeoutMs?: number;
  /** v0.4: 软截止 ms —— 到点先收割已完成引擎,慢腿剔除;0=关闭;默认取 config(6000) */
  softDeadlineMs?: number;
  noCache?: boolean;
}

export interface EngineFailure {
  name: string;
  error: string;
  elapsedMs: number;
  /** v0.4 失败标注: 分类信号(见 EngineStatus), 调用方据此决定重试策略 */
  status: EngineStatus;
  /** true=过会儿再试有意义; false=换引擎/人工介入 */
  retryable: boolean;
}

export interface SearchResult {
  query: string;
  refs: Reference[];
  meta: {
    enginesUsed: string[];
    enginesFailed: EngineFailure[];
    /** v0.4: 因熔断/额度耗尽/未配置而跳过的引擎(wigolo 诚实契约) */
    enginesSkipped?: EngineSkip[];
    elapsedMs: number;
    fromCache: boolean;
    /** v0.4 降级信号: 出勤引擎不到一半或全灭 → true, agent 应降低对结果的信任 */
    degraded?: boolean;
    /** v0.8 置信度筛选: 硬屏蔽剔除的内容农场条数(csdn/百家号/搜狐/文库爬虫站等) */
    spamBlocked?: number;
    /** phase AF 页面级守卫: 权威提权被清零的条数(域名命中但页面缺查询关键 token) */
    authorityGuarded?: number;
    /** phase AH 零结果抢救腿: 全腿空手后聚合器兜底轮是否出勤(诚实可见) */
    rescued?: boolean;
    /** 省下的输出 token 估算(chars): 输出只带 snippet,不带全文 */
    journal?: string;
  };
}

export interface FetchOptions {
  /** focus 查询: 命中段+邻接段提取 (v0-spec §4.4 Focus Fetch) */
  focus?: string;
  /** 输出字符预算,默认 8000 (Codex[09] 10k-token 级截断口径) */
  maxChars?: number;
  /** 命中段前后各扩展几段,默认 1 */
  adjacent?: number;
  noCache?: boolean;
  /** 缓存 TTL 秒,默认 900 (WorkBuddy[07]/Claude[08] 15min 口径) */
  ttlSeconds?: number;
}

export interface FetchResult {
  url: string;
  title?: string;
  status: number;
  fromCache: boolean;
  /** 提取的全文长度(chars) */
  textLength: number;
  /** 实际返回字符数 */
  returnedChars: number;
  /** 省掉的比例 0-1 (focus 模式) */
  savedPct?: number;
  /** focus 命中段 */
  segments?: string[];
  /** 无 focus 时返回的(截断后)全文 */
  text?: string;
  elapsedMs: number;
}

/** Planner 决策 (v0-spec §4.1; v0.1 为规则版,LLM 版为可插拔接口) */
export interface PlannerDecision {
  complexity: "simple" | "multi" | "research";
  /** 拆分/变体后的子查询 */
  queries: string[];
  route: "web" | "x" | "github" | "domain";
  reasons: string[];
  /** v0.1 提示: research 模式在 v0.2 才有实现 */
  researchHint?: boolean;
  /**
   * phase AA(对照轮增量): 查询语言自动检测(CJK≥2 → "zh")。
   * engine 层合并进 opts.lang(调用方显式传参优先), 流到 provider 层触发中文路由
   * (wikipedia zh 子域 / googlenews hl-gl-ceid / mdn locale=zh-CN)。
   */
  lang?: string;
  /**
   * v0.6 域名路由(用户提案"AI 维护动态域名表"落地, 见 src/domains.ts):
   * 查表命中时记录领域专线 — 第 1 条子查询走 apiProviders 免 key API 直连,
   * 其余(siteQueries)走 siteEngines 通用引擎。core.search 据此分腿。
   */
  domainPlan?: {
    topic: string;
    apiProviders: string[];
    siteQueries: string[];
    siteEngines: string[];
  };
}

export interface ProviderHealth {
  name: string;
  configured: boolean;
  needsKey: boolean;
  ok: number;
  fail: number;
  avgLatencyMs: number;
  lastError?: string;
  lastOkAt?: number;
  /** v0.4: 最近一次失败分类(rate_limited/blocked/quota/auth/timeout/error) */
  lastStatus?: string;
  /** v0.4: 当前熔断中 */
  circuitOpen?: boolean;
  /** phase AC 额度可见性: 仅受 QuotaTracker 管控的引擎返回(余量/是否耗尽/月度重置时间) */
  quota?: {
    used: number;
    limit: number;
    remaining: number;
    exhausted: boolean;
    resetsAt: string;
  };
}
