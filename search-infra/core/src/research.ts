/**
 * Research Loop (v0.2) — v0-spec §4.7 深度研究状态机
 *
 * 证据来源(报告编号按 reports/NN-*.md):
 *  - [06] Trae deep-research.js: 5 角度并行搜索 → URL 去重预算(fetchSlots+relRank, 低相关先丢) → 事实抽取 → 综合;
 *         双预算池思想: reference(元数据,便宜)/fetch(全文,贵) 分池计费
 *  - [07] WorkBuddy deep-research engine.md: 6 步状态机 Decompose→Search→Extract→Reflect→Decide→Snapshot;
 *         6 问量化反思(逐问回答,不允许合并);max_loops 硬上限,达上限 MAX_LOOPS_DEGRADED 降级不阻塞;
 *         无 source 的事实剔除;CONTINUE 只针对未通过项生成追问
 *  - [11] ODR stop condition 三保险: 显式信号/隐式信号/硬上限;反面教材 `or True` 吞错 —
 *         本实现: 单角度失败只降级该角度(绝不全局终止),连续整轮全灭才停,错误全量入 journal
 *  - 断点恢复: journal 事件流即状态,replay 重建(Trae[06] journal.jsonl 思想),resume 从断点继续
 *
 * 无 LLM 合成: 默认输出结构化 markdown(角度分节+引用尾注),synthesizer 钩子留给 LLM 版。
 * 出口校验: 引用 [n] 100% 可回溯(citations.enforceCitations strict),验收口径。
 */
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CoreConfig } from "./config.js";
import type { Router } from "./router.js";
import type { Fetcher } from "./fetcher.js";
import type { Cache } from "./cache.js";
import type { Journal } from "./journal.js";
import type { Reference } from "./types.js";
import { lexicalScore } from "./fusion.js";
import { hostOf } from "./governor.js";
import {
  buildCitationRegistry, enforceCitations, renderCitations,
  type CitationRegistry,
} from "./citations.js";
import type { Embedder } from "./embed.js";

// ---------- 公开类型 ----------

export interface ResearchOptions {
  maxLoops?: number;        // WorkBuddy[07] max_loops 硬上限
  minFacts?: number;        // Q1 阈值
  referenceBudget?: number; // 双预算池之元数据池(便宜,可多拿) [06]
  fetchBudget?: number;     // 双预算池之全文池(贵,按相关度抢 slot) [06]
  fetchPerLoop?: number;
  strict?: boolean;         // true=6 问全过(Q3 权威源/Q4 时效硬门槛);false=Q1+Q2
  angles?: string[];        // 自定义角度(缺省按查询信号从角度池选,v0.8 STORM-lite)
  freshness?: "day" | "week" | "month" | "year" | "any";
  domains?: { allow?: string[]; block?: string[] };
  noCache?: boolean;
  /** v0.8 预算预设(gpt-researcher 报告类型 × Morphic Quick/Adaptive 同构,显式预算表): summary<report<deep;逐字段可覆盖 */
  preset?: ResearchPreset;
  /** LLM 合成钩子;缺省结构化 markdown */
  synthesize?: (input: SynthesisInput) => Promise<string>;
  embedder?: Embedder;
}

export type ResearchPreset = "summary" | "report" | "deep";

/**
 * v0.8 预算预设表(gpt-researcher 报告类型/预算拓扑 + Morphic Quick/Adaptive 分档的同构物;
 * 差异: 两家都没把预算写成年表,我们把三档预算显式化可审查)。report=不覆盖(用 config 默认)。
 * deep 档预算参考 gpt-researcher deep 拓扑(breadth=3×depth=2×concurrency=4, deep_research.py:244-249)放大后的单 run 等效量。
 */
export const RESEARCH_PRESETS: Record<Exclude<ResearchPreset, "report">, Partial<ResearchOptions> & Pick<ResearchOptions, "maxLoops" | "minFacts" | "referenceBudget" | "fetchBudget" | "fetchPerLoop">> & Record<"report", Partial<Record<string, never>>> = {
  summary: { maxLoops: 1, minFacts: 4, referenceBudget: 60, fetchBudget: 4, fetchPerLoop: 4 },
  report: {},
  deep: { maxLoops: 5, minFacts: 10, referenceBudget: 240, fetchBudget: 24, fetchPerLoop: 6 },
};

export interface SynthesisInput {
  query: string;
  angles: string[];
  facts: Fact[];
  registry: CitationRegistry;
  loops: LoopRecord[];
}

export interface Fact {
  refId: number;
  url: string;
  title: string;
  angle: string;
  quote: string;
  domain: string;
  tier: 1 | 2 | 3;
  published?: string;
}

export interface ReflectScores {
  q1Facts: number;       // 事实数量达标吗 (>=minFacts)
  q2Coverage: number;    // 必搜维度覆盖吗 (每角度 >=1 事实)
  q3Authority: number;   // 权威源足够吗 (Tier1 >=1 → 1;Tier2 → 0.5)
  q4Freshness: number;   // 时效性达标吗 (<=2y → 1;未知 → 0.5)
  q5MultiSource: number; // 多源支撑吗 (>=2 域名支撑的角度比例)
  q6Usable: number;      // 后续能用吗 (每角度 >=2 事实可写 What/Why/Next)
}

export interface LoopRecord {
  loop: number;
  queries: { angle: string; query: string; found: number; error?: string }[];
  newUrls: number;
  fetched: number;
  reflect: ReflectScores;
  decision: "EXIT" | "CONTINUE" | "MAX_LOOPS_DEGRADED" | "BUDGET_STOP" | "CONVERGED" | "ALL_ANGLES_FAILED";
}

export interface ResearchStats {
  refPoolUsed: number;
  refBudgetDropped: number;
  fetchUsed: number;
  fetchErrors: number;
  angleErrors: number;
  loops: number;
  elapsedMs: number;
}

export type ResearchStopReason = "converged" | "budget" | "max_loops" | "all_angles_failed" | "completed";

/** v0.8 研究大纲条目(STORM 大纲骨架的无 LLM 版): 角度→事实统计+权威分布+主要来源域 */
export interface ResearchOutlineEntry {
  angle: string;
  facts: number;
  tier1Facts: number;
  domains: string[]; // 按事实数降序前 2
}

export interface ResearchResult {
  runId: string;
  resumed: boolean;
  query: string;
  angles: string[];
  facts: Fact[];
  refs: Reference[];        // 全量引用池(带稳定 refId)
  loops: LoopRecord[];
  report: string;           // 引用出口校验后的终稿
  registry: [number, { url: string; title: string }][];
  stop: { reason: ResearchStopReason; detail: string };
  strict: boolean;
  stats: ResearchStats;
  journalPath: string;
  outline: ResearchOutlineEntry[]; // v0.8: 大纲骨架(消费方可直接渲染分节)
}

export interface ResearchEvent {
  type: "start" | "loop_start" | "angle_done" | "angle_error" | "fetch_done" | "fetch_error"
      | "reflect" | "decide" | "stop" | "report" | "resume";
  loop?: number;
  [k: string]: unknown;
}

// ---------- 常量 ----------

const NOW_YEAR = new Date().getFullYear();

/** 5 角度模板(Trae[06] 5 角度并行的规则版;角度名会作为检索词注入) — v0.8 扩为角度池 */
export const DEFAULT_ANGLES: { name: string; query: (q: string) => string; signals?: RegExp[] }[] = [
  { name: "定义与概念", query: (q) => `${q} 是什么 定义 核心概念` },
  { name: "现状与进展", query: (q) => `${q} 最新进展 现状 ${NOW_YEAR}` },
  { name: "对比与替代", query: (q) => `${q} 对比 优缺点 替代方案`, signals: [/对比|比较|vs\b|versus|替代|哪个好|alternative|选哪个/i] },
  { name: "数据与案例", query: (q) => `${q} 数据 案例 统计 benchmark`, signals: [/数据|统计|案例|benchmark|多少|占比|份额/i] },
  { name: "批评与风险", query: (q) => `${q} 问题 风险 局限性 criticism`, signals: [/风险|问题|争议|批评|坑|limitation|criticism|downside/i] },
  { name: "教程与实践", query: (q) => `${q} 教程 实践 最佳实践 how to`, signals: [/怎么|如何|how to|教程|指南|入门|报错|错误|install|配置|部署|deploy/i] },
  { name: "历史与背景", query: (q) => `${q} 历史 起源 发展背景`, signals: [/历史|起源|发展|由来|背景|history|origin/i] },
  { name: "生态与工具", query: (q) => `${q} 工具 生态 库 框架`, signals: [/工具|生态|库|框架|library|framework|sdk|生态圈/i] },
];

/**
 * v0.8 STORM-lite 角度选择(无 LLM 的视角模板近似;真身= persona_generator.py L134-155:
 * 默认 3 persona + 强制前置 "Basic fact writer" 兜底)。同构映射:
 *  - 强制角度= "定义与概念"(basic fact writer 的规则版,永远保留)
 *  - persona 按话题生成 → 我们按查询信号从角度池选(signals 命中优先)
 *  - 剩余名额按池序填满到 5(STORM 视角数 3-4,我们保持既有 5 角度预算口径)
 */
export function selectAngles(query: string): string[] {
  const forced = DEFAULT_ANGLES[0].name; // 定义与概念 = basic fact writer
  const picked = new Set<string>([forced]);
  for (const tpl of DEFAULT_ANGLES) {
    if (picked.size >= 5) break;
    if (tpl.signals?.some((re) => re.test(query))) picked.add(tpl.name);
  }
  for (const tpl of DEFAULT_ANGLES) {
    if (picked.size >= 5) break;
    picked.add(tpl.name);
  }
  return [...picked];
}

/**
 * v0.8 大纲骨架(STORM 大纲模块的无 LLM 版;真身= outline_generation.py draft→对话→refine 两段式,
 * 依赖 LLM — 我们退化为"角度即节"的确定性骨架 + 逐节事实/权威/来源域统计)。
 * STORM "节名即 query" 的对应物: 我们的角度名本来就会注入检索词(research #drive angleQueries)。
 */
export function buildOutline(angles: string[], facts: Fact[]): ResearchOutlineEntry[] {
  return angles.map((angle) => {
    const fs = facts.filter((f) => f.angle === angle);
    const domainCount = new Map<string, number>();
    let tier1Facts = 0;
    for (const f of fs) {
      try {
        const host = hostOf(f.url);
        if (tierOf(host) === 1) tier1Facts++;
        domainCount.set(host, (domainCount.get(host) ?? 0) + 1);
      } catch { /* 无效 URL 不进域统计 */ }
    }
    return {
      angle,
      facts: fs.length,
      tier1Facts,
      domains: [...domainCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([d]) => d),
    };
  });
}

/** 权威域分层(WorkBuddy[07] Q3 的规则版;小而保守,宁缺勿滥) */
const TIER1_DOMAINS = [
  "arxiv.org", "ieee.org", "acm.org", "nature.com", "science.org",
  "gov.cn", "stats.gov.cn", "who.int", "un.org", "worldbank.org", "imf.org",
  "nist.gov", "nasa.gov", "noaa.gov", "europa.eu", "oecd.org",
];
const TIER2_DOMAINS = [
  "github.com", "wikipedia.org", "stackoverflow.com", "mdn.dev", "developer.mozilla.org",
  "reuters.com", "apnews.com", "bbc.com", "nature.com", "springer.com", "sciencedirect.com",
  "mckinsey.com", "gartner.com", "forrester.com", "stanford.edu", "mit.edu", "harvard.edu",
];

function tierOf(domain: string): 1 | 2 | 3 {
  if (TIER1_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) return 1;
  if (TIER2_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) return 2;
  return 3;
}

// ---------- 状态(journal 事件流即状态,resume 靠 replay) ----------

interface JournalEvent {
  ts: number;
  event: string;
  [k: string]: unknown;
}

export class ResearchState {
  runId: string;
  query = "";
  angles: string[] = [];
  strict = false;
  opts: Required<Pick<ResearchOptions, "maxLoops" | "minFacts" | "referenceBudget" | "fetchBudget" | "fetchPerLoop">> =
    { maxLoops: 3, minFacts: 6, referenceBudget: 120, fetchBudget: 12, fetchPerLoop: 4 };
  pool = new Map<string, Reference>();      // normalizedUrl -> ref(带稳定 refId)
  facts: Fact[] = [];
  fetchedUrls = new Set<string>();
  loops: LoopRecord[] = [];
  stop?: { reason: ResearchStopReason; detail: string };
  report?: string;
  stats = {
    refPoolUsed: 0, refBudgetDropped: 0, fetchUsed: 0,
    fetchErrors: 0, angleErrors: 0, loops: 0, elapsedMs: 0,
  };
  #nextRefId = 1;

  constructor(runId?: string) {
    this.runId = runId ?? `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  }

  get registry(): CitationRegistry {
    return buildCitationRegistry([...this.pool.values()]);
  }

  /** 给 ref 分配/确认稳定 refId;池满(referenceBudget)返回 false */
  admitRef(ref: Reference): boolean {
    const url = ref.url;
    if (this.pool.has(url)) return true;
    if (this.pool.size >= this.opts.referenceBudget) {
      this.stats.refBudgetDropped++;
      return false;
    }
    const assigned: Reference = { ...ref, refId: ref.refId ?? this.#nextRefId++ };
    this.#nextRefId = Math.max(this.#nextRefId, (assigned.refId ?? 0) + 1);
    this.pool.set(url, assigned);
    this.stats.refPoolUsed++;
    return true;
  }

  /** replay: 事件→状态(顺序敏感;live 跑与 replay 走同一套赋值逻辑) */
  apply(ev: JournalEvent): void {
    switch (ev.event) {
      case "start":
        this.query = ev.query as string;
        this.angles = ev.angles as string[];
        this.strict = ev.strict as boolean;
        this.opts = ev.opts as typeof this.opts;
        break;
      case "loop_start":
        this.loops.push({
          loop: ev.loop as number,
          queries: (ev.queries as LoopRecord["queries"]) ?? [],
          newUrls: ev.newUrls as number ?? 0,
          fetched: 0,
          reflect: { q1Facts: 0, q2Coverage: 0, q3Authority: 0, q4Freshness: 0, q5MultiSource: 0, q6Usable: 0 },
          decision: "CONTINUE",
        });
        this.stats.loops = Math.max(this.stats.loops, ev.loop as number);
        break;
      case "angle_done": {
        const loop = this.loops[this.loops.length - 1];
        const refs = ev.refs as Reference[];
        let added = 0;
        for (const r of refs) {
          const before = this.pool.size;
          if (this.admitRef(r)) added += this.pool.size - before;
        }
        loop.queries.push({
          angle: ev.angle as string, query: ev.query as string,
          found: refs.length, error: ev.error as string | undefined,
        });
        loop.newUrls += added;
        break;
      }
      case "angle_error": {
        const loop = this.loops[this.loops.length - 1];
        loop.queries.push({
          angle: ev.angle as string, query: ev.query as string, found: 0, error: ev.error as string,
        });
        this.stats.angleErrors++;
        break;
      }
      case "fetch_done": {
        const loop = this.loops[this.loops.length - 1];
        const ref = ev.ref as Reference;
        this.fetchedUrls.add(ref.url);
        this.stats.fetchUsed++;
        loop.fetched++;
        const domain = hostOf(ref.url);
        this.facts.push({
          refId: ref.refId!, url: ref.url, title: ref.title,
          angle: ev.angle as string, quote: ev.quote as string,
          domain, tier: tierOf(domain), published: ref.published,
        });
        break;
      }
      case "fetch_error":
        this.stats.fetchErrors++;
        break;
      case "reflect": {
        const loop = this.loops[this.loops.length - 1];
        loop.reflect = ev.scores as ReflectScores;
        break;
      }
      case "decide": {
        const loop = this.loops[this.loops.length - 1];
        loop.decision = ev.decision as LoopRecord["decision"];
        break;
      }
      case "stop":
        this.stop = ev as unknown as { reason: ResearchStopReason; detail: string };
        break;
      case "report":
        this.report = ev.text as string;
        break;
      case "resume":
        break; // 标记事件,不承载状态
    }
  }
}

// ---------- 6 问反思(WorkBuddy[07] 规则化) ----------

export function reflect(state: ResearchState): ReflectScores {
  const facts = state.facts;
  const angles = state.angles;
  const byAngle = new Map<string, Fact[]>();
  for (const a of angles) byAngle.set(a, []);
  for (const f of facts) byAngle.get(f.angle)?.push(f);

  // Q1 事实数量: >=minFacts → 1,否则线性比例
  const q1 = Math.min(1, facts.length / state.opts.minFacts);
  // Q2 维度覆盖: 每个角度 >=1 事实
  const covered = angles.filter((a) => (byAngle.get(a)?.length ?? 0) >= 1).length;
  const q2 = angles.length ? covered / angles.length : 0;
  // Q3 权威源: Tier1>=1 → 1;否则 Tier2>=1 → 0.5;否则 0
  const q3 = facts.some((f) => f.tier === 1) ? 1 : facts.some((f) => f.tier === 2) ? 0.5 : 0;
  // Q4 时效: 有 <=2 年的 published → 1;全无日期 → 0.5(中性);全老 → 0
  const dated = facts.filter((f) => f.published);
  let q4 = 0.5;
  if (dated.length > 0) {
    const twoYearsAgo = Date.now() - 2 * 365.25 * 24 * 3600 * 1000;
    q4 = dated.some((f) => {
      const t = Date.parse(f.published!);
      return !Number.isNaN(t) && t >= twoYearsAgo;
    }) ? 1 : 0;
  }
  // Q5 多源支撑: >=2 个独立域名支撑的角度占比(冲突检测的规则化替代)
  const multi = angles.filter((a) => new Set((byAngle.get(a) ?? []).map((f) => f.domain)).size >= 2).length;
  const q5 = angles.length ? multi / angles.length : 0;
  // Q6 可用性: 每角度 >=2 事实(可写 What/Why/Next)的比例
  const rich = angles.filter((a) => (byAngle.get(a)?.length ?? 0) >= 2).length;
  const q6 = angles.length ? rich / angles.length : 0;

  return { q1Facts: q1, q2Coverage: q2, q3Authority: q3, q4Freshness: q4, q5MultiSource: q5, q6Usable: q6 };
}

export function decide(state: ResearchState, scores: ReflectScores, loop: number): LoopRecord["decision"] {
  // strict: 6 问全过(WorkBuddy[07] gap_check_strict: strict)
  if (state.strict) {
    const pass = scores.q1Facts >= 1 && scores.q2Coverage >= 1 && scores.q3Authority >= 1 &&
      scores.q4Freshness >= 1 && scores.q5MultiSource >= 0.5 && scores.q6Usable >= 0.6;
    if (pass) return "EXIT";
  } else {
    // relaxed(默认): Q1 事实数 + Q2 维度覆盖 — 硬收敛信号(Q3/Q4 属质量门槛,免费引擎不保证)
    if (scores.q1Facts >= 1 && scores.q2Coverage >= 1) return "EXIT";
  }
  if (loop >= state.opts.maxLoops) return "MAX_LOOPS_DEGRADED"; // 降级出报告,不阻塞 [07]
  if (state.stats.fetchUsed >= state.opts.fetchBudget) return "BUDGET_STOP";
  const cur = state.loops[state.loops.length - 1];
  if (cur && cur.newUrls === 0 && loop > 1) return "CONVERGED"; // 零新 URL → 无新信息
  if (cur && cur.queries.length > 0 && cur.queries.every((q) => q.error)) return "ALL_ANGLES_FAILED";
  return "CONTINUE";
}

// ---------- Research Loop 主类 ----------

export interface ResearchDeps {
  config: CoreConfig;
  router: Router;
  fetcher: Fetcher;
  cache: Cache;
  journal?: Journal;       // 全局 run journal(观测用)
  fetchImpl?: typeof fetch;
}

export class ResearchLoop {
  #deps: ResearchDeps;
  #dir: string;

  constructor(deps: ResearchDeps, dataDir: string) {
    this.#deps = deps;
    this.#dir = join(dataDir, "journal");
  }

  #filePath(runId: string): string {
    return join(this.#dir, `research-${runId}.jsonl`);
  }

  #append(runId: string, ev: Record<string, unknown>): void {
    try {
      mkdirSync(this.#dir, { recursive: true });
      appendFileSync(this.#filePath(runId), JSON.stringify({ ts: Date.now(), ...ev }) + "\n");
    } catch { /* journal 失败不影响主链路 */ }
  }

  /** 新开研究 */
  async run(query: string, opts: ResearchOptions = {}, onEvent?: (e: ResearchEvent) => void): Promise<ResearchResult> {
    const state = new ResearchState();
    const cfg = this.#deps.config.research;
    // v0.8: preset 先于逐字段合并(preset 表 → cfg 默认;显式 opts 永远最高优先)
    const preset = RESEARCH_PRESETS[opts.preset ?? "report"];
    state.opts = {
      maxLoops: opts.maxLoops ?? (preset.maxLoops as number | undefined) ?? cfg.maxLoops,
      minFacts: opts.minFacts ?? (preset.minFacts as number | undefined) ?? cfg.minFacts,
      referenceBudget: opts.referenceBudget ?? (preset.referenceBudget as number | undefined) ?? cfg.referenceBudget,
      fetchBudget: opts.fetchBudget ?? (preset.fetchBudget as number | undefined) ?? cfg.fetchBudget,
      fetchPerLoop: opts.fetchPerLoop ?? (preset.fetchPerLoop as number | undefined) ?? cfg.fetchPerLoop,
    };
    state.strict = opts.strict ?? cfg.strict;
    // v0.8 STORM-lite: 缺省不再固定 5 角度,按查询信号从角度池选("定义与概念"永远保留)
    state.angles = opts.angles ?? selectAngles(query);
    state.query = query;

    this.#append(state.runId, {
      event: "start", query, angles: state.angles, strict: state.strict, opts: state.opts,
    });
    onEvent?.({ type: "start", query, angles: state.angles, runId: state.runId, strict: state.strict });

    const result = await this.#drive(state, opts, false, onEvent);
    return result;
  }

  /** 断点恢复: replay journal → 继续未完成的循环 */
  async resume(runId: string, opts: ResearchOptions = {}, onEvent?: (e: ResearchEvent) => void): Promise<ResearchResult> {
    const path = this.#filePath(runId);
    if (!existsSync(path)) throw new Error(`research run not found: ${runId}`);
    const state = new ResearchState(runId);
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try { state.apply(JSON.parse(line) as JournalEvent); } catch { /* 坏行跳过 */ }
    }
    onEvent?.({ type: "resume", runId, events: lines.length, loopsDone: state.loops.length });
    this.#append(runId, { event: "resume", events: lines.length });

    if (state.stop && state.report) {
      return this.#buildResult(state, true); // 已完成: 直接重建结果
    }
    // 覆盖部分参数(预算允许扩大续跑)
    if (opts.maxLoops) state.opts.maxLoops = Math.max(state.opts.maxLoops, opts.maxLoops);
    if (opts.fetchBudget) state.opts.fetchBudget = Math.max(state.opts.fetchBudget, opts.fetchBudget);
    if (opts.referenceBudget) state.opts.referenceBudget = Math.max(state.opts.referenceBudget, opts.referenceBudget);
    return this.#drive(state, opts, true, onEvent);
  }

  /** 状态机驱动: 循环 [角度并行搜索 → 抢 fetch slot → 抽事实 → 反思 → 决策] */
  async #drive(
    state: ResearchState,
    opts: ResearchOptions,
    resumed: boolean,
    onEvent?: (e: ResearchEvent) => void,
  ): Promise<ResearchResult> {
    const t0 = Date.now();
    const router = this.#deps.router;
    const fetcher = this.#deps.fetcher;
    let consecutiveAllFail = 0;

    for (let loop = state.loops.length + 1; loop <= state.opts.maxLoops; loop++) {
      // --- 1. 角度查询生成(loop1 用角度模板;loop2+ 对未覆盖角度追加原始 query 变体) ---
      const covered = new Set(state.facts.map((f) => f.angle));
      const angleQueries = state.angles.map((angle) => {
        const tpl = DEFAULT_ANGLES.find((a) => a.name === angle);
        const base = tpl ? tpl.query(state.query) : `${state.query} ${angle}`;
        return { angle, query: covered.has(angle) && loop > 1 ? `${state.query} ${angle}` : base };
      });
      state.loops.push({
        loop, queries: [], newUrls: 0, fetched: 0,
        reflect: { q1Facts: 0, q2Coverage: 0, q3Authority: 0, q4Freshness: 0, q5MultiSource: 0, q6Usable: 0 },
        decision: "CONTINUE",
      });
      state.stats.loops = loop;
      this.#append(state.runId, {
        event: "loop_start", loop,
        queries: angleQueries.map((a) => ({ angle: a.angle, query: a.query })),
      });
      onEvent?.({ type: "loop_start", loop, angles: angleQueries });

      // --- 2. 五角度并行搜索(单角度失败只降级该角度 — 修 ODR[11] or True 反面教材) ---
      const searchOpts = {
        freshness: opts.freshness, domains: opts.domains, noCache: opts.noCache, topN: 30,
      } as const;
      const settled = await Promise.allSettled(
        angleQueries.map(async (aq) => {
          const r = await router.run(aq.query, searchOpts);
          return { aq, ...r };
        }),
      );
      for (const s of settled) {
        if (s.status === "fulfilled") {
          const { aq, refs } = s.value;
          const before = state.pool.size;
          const admitted: Reference[] = [];
          for (const r of refs) {
            const rr: Reference = { ...r, url: r.url };
            if (state.admitRef(rr)) admitted.push(state.pool.get(rr.url) ?? rr);
          }
          const added = state.pool.size - before;
          const cur = state.loops[state.loops.length - 1];
          cur.newUrls += added;
          cur.queries.push({ angle: aq.angle, query: aq.query, found: refs.length });
          this.#append(state.runId, {
            event: "angle_done", loop, angle: aq.angle, query: aq.query,
            found: refs.length, added,
            refs: admitted.map((r) => ({ url: r.url, title: r.title, snippet: r.snippet, engines: r.engines, refId: r.refId, published: r.published, rank: r.rank, score: r.score })),
          });
          onEvent?.({ type: "angle_done", loop, angle: aq.angle, found: refs.length, added, poolSize: state.pool.size });
        } else {
          const aq = angleQueries[settled.indexOf(s)];
          const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
          state.stats.angleErrors++;
          state.loops[state.loops.length - 1].queries.push({
            angle: aq.angle, query: aq.query, found: 0, error: msg.slice(0, 200),
          });
          this.#append(state.runId, { event: "angle_error", loop, angle: aq.angle, query: aq.query, error: msg.slice(0, 200) });
          onEvent?.({ type: "angle_error", loop, angle: aq.angle, error: msg.slice(0, 120) });
        }
      }

      // --- 3. fetchSlots: 按 slot 得分抢全文预算(低分先丢,Trae[06] fetchSlots+relRank) ---
      const fetchRemaining = state.opts.fetchBudget - state.stats.fetchUsed;
      const perLoop = Math.min(state.opts.fetchPerLoop, fetchRemaining);
      const slots = this.#pickSlots(state, perLoop);
      if (slots.length > 0) {
        const fetchSettled = await Promise.allSettled(
          slots.map(async (slot) => {
            const focus = `${state.query} ${slot.angle}`;
            const fr = await fetcher.run(slot.ref.url, { focus, maxChars: 6000, adjacent: 1 }, fetcher.policyFor(opts.domains?.block, opts.domains?.allow));
            return { slot, fr };
          }),
        );
        for (const fs of fetchSettled) {
          const cur = state.loops[state.loops.length - 1];
          state.stats.fetchUsed++; // 预算按"尝试"计费: 无论成败 slot 都消耗了 [06]
          if (fs.status === "fulfilled") {
            const { slot, fr } = fs.value;
            const quote = (fr.segments?.[0] ?? fr.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
            if (quote.length < 40) {
              // 引用无实质内容 → 不算事实(WorkBuddy[07]: 无 source/无内容剔除)
              state.stats.fetchErrors++;
              this.#append(state.runId, { event: "fetch_error", loop, url: slot.ref.url, error: "quote too short after focus" });
              continue;
            }
            state.fetchedUrls.add(slot.ref.url);
            cur.fetched++;
            const domain = hostOf(slot.ref.url);
            state.facts.push({
              refId: slot.ref.refId!, url: slot.ref.url, title: slot.ref.title,
              angle: slot.angle, quote, domain, tier: tierOf(domain), published: slot.ref.published,
            });
            this.#append(state.runId, {
              event: "fetch_done", loop, angle: slot.angle,
              ref: { url: slot.ref.url, title: slot.ref.title, refId: slot.ref.refId, published: slot.ref.published },
              quote,
            });
            onEvent?.({ type: "fetch_done", loop, angle: slot.angle, url: slot.ref.url, refId: slot.ref.refId });
          } else {
            state.stats.fetchErrors++;
            const msg = fs.reason instanceof Error ? fs.reason.message : String(fs.reason);
            this.#append(state.runId, { event: "fetch_error", loop, url: "unknown", error: msg.slice(0, 200) });
            onEvent?.({ type: "fetch_error", loop, error: msg.slice(0, 120) });
          }
        }
      }

      // --- 4. 反思(6 问) + 决策 ---
      const scores = reflect(state);
      state.loops[state.loops.length - 1].reflect = scores;
      this.#append(state.runId, { event: "reflect", loop, scores });
      onEvent?.({ type: "reflect", loop, scores, facts: state.facts.length, pool: state.pool.size });

      const decision = decide(state, scores, loop);
      state.loops[state.loops.length - 1].decision = decision;
      this.#append(state.runId, { event: "decide", loop, decision });
      onEvent?.({ type: "decide", loop, decision });

      const allFailed = state.loops[state.loops.length - 1].queries.length > 0 &&
        state.loops[state.loops.length - 1].queries.every((q) => q.error);
      consecutiveAllFail = allFailed ? consecutiveAllFail + 1 : 0;

      const stopMap: Record<LoopRecord["decision"], ResearchStopReason | null> = {
        EXIT: "converged",
        MAX_LOOPS_DEGRADED: "max_loops",
        BUDGET_STOP: "budget",
        CONVERGED: "converged",
        ALL_ANGLES_FAILED: null, // 由连续全灭计数决定
        CONTINUE: null,
      };
      const reason = stopMap[decision];
      if (reason) {
        const detail = decision === "MAX_LOOPS_DEGRADED"
          ? `max_loops=${state.opts.maxLoops} reached; degraded output with ${state.facts.length} facts [07]`
          : decision === "BUDGET_STOP"
            ? `fetch budget ${state.opts.fetchBudget} exhausted; ${state.facts.length} facts from ${state.pool.size} refs`
            : decision === "CONVERGED"
              ? `no new urls in loop ${loop}; ${state.facts.length} facts`
              : `reflection passed (${state.strict ? "strict" : "relaxed"}); ${state.facts.length} facts`;
        state.stop = { reason, detail };
        this.#append(state.runId, { event: "stop", reason, detail });
        onEvent?.({ type: "stop", reason, detail });
        break;
      }
      if (consecutiveAllFail >= 2) {
        state.stop = {
          reason: "all_angles_failed",
          detail: `all angle searches failed in ${consecutiveAllFail} consecutive loops; engines likely blocked/network down; ${state.facts.length} facts so far`,
        };
        this.#append(state.runId, { event: "stop", ...state.stop });
        onEvent?.({ type: "stop", ...state.stop });
        break;
      }
    }

    if (!state.stop) {
      state.stop = {
        reason: state.facts.length > 0 ? "max_loops" : "all_angles_failed",
        detail: `loop budget reached after resume/limits; ${state.facts.length} facts`,
      };
      this.#append(state.runId, { event: "stop", ...state.stop });
    }

    state.stats.elapsedMs = Date.now() - t0;
    const report = await this.#synthesize(state, opts, onEvent);
    return this.#buildResult(state, resumed, report);
  }

  /**
   * fetchSlot 分配: 覆盖率感知的公平轮转(Trae[06] fetchSlots+relRank 的覆盖增强版)
   * - 每个角度的候选按 slotScore 降序排队;轮转从各队列各取一个,直到填满 count
   * - 动机: Q2(维度覆盖)是停止条件,偏科分配会拉长循环浪费预算;公平份额最大化单轮覆盖
   * - slotScore = 词法相关(query+angle) *2 + 多引擎佐证 + 头部排名加成
   */
  #pickSlots(state: ResearchState, count: number): { ref: Reference; angle: string; slotScore: number }[] {
    if (count <= 0) return [];
    const byAngle = new Map<string, { ref: Reference; angle: string; slotScore: number }[]>();
    for (const angle of state.angles) byAngle.set(angle, []);
    for (const ref of state.pool.values()) {
      if (state.fetchedUrls.has(ref.url) || ref.refId === undefined) continue;
      let bestAngle = state.angles[0] ?? "general";
      let bestScore = -1;
      for (const angle of state.angles) {
        const s = lexicalScore(`${state.query} ${angle}`, ref.title, ref.snippet);
        if (s > bestScore) { bestScore = s; bestAngle = angle; }
      }
      const multiBoost = ref.engines.length > 1 ? 0.15 : 0;
      const queue = byAngle.get(bestAngle);
      if (queue) queue.push({ ref, angle: bestAngle, slotScore: bestScore * 2 + multiBoost + (ref.rank && ref.rank <= 5 ? 0.1 : 0) });
    }
    for (const q of byAngle.values()) q.sort((a, b) => b.slotScore - a.slotScore);
    // 轮转弹取: 每轮各队列出队一个
    const picked: { ref: Reference; angle: string; slotScore: number }[] = [];
    let round = 0;
    while (picked.length < count) {
      let progressed = false;
      for (const angle of state.angles) {
        if (picked.length >= count) break;
        const q = byAngle.get(angle)!;
        if (q.length > round) {
          picked.push(q[round]);
          progressed = true;
        }
      }
      if (!progressed) break;
      round++;
    }
    return picked;
  }

  /** 合成: LLM 钩子或结构化 markdown;出口校验 — [n] 100% 可回溯(验收口径) */
  async #synthesize(state: ResearchState, opts: ResearchOptions, onEvent?: (e: ResearchEvent) => void): Promise<string> {
    const registry = state.registry;
    let text: string;
    if (opts.synthesize) {
      text = await opts.synthesize({
        query: state.query, angles: state.angles, facts: state.facts, registry, loops: state.loops,
      });
    } else {
      text = this.#defaultReport(state);
    }
    // 出口校验(v0-spec §6 验收: 引用出口校验 100%): 先 strict;LLM 钩子产出幻觉引用时降级 strip + 标注
    let validated: string;
    try {
      validated = enforceCitations(text, registry, { mode: "strict" }).text;
    } catch {
      const { text: stripped, audit } = enforceCitations(text, registry, { mode: "strip" });
      validated = stripped + `\n\n> ⚠ 引用出口校验: 剔除未注册引用 [${audit.unknown.join(",")}](幻觉引用零容忍)\n`;
    }
    state.report = validated;
    this.#append(state.runId, { event: "report", text: validated, chars: validated.length });
    onEvent?.({ type: "report", chars: validated.length });
    return validated;
  }

  #defaultReport(state: ResearchState): string {
    const byAngle = new Map<string, Fact[]>();
    for (const a of state.angles) byAngle.set(a, []);
    for (const f of state.facts) byAngle.get(f.angle)?.push(f);

    const lines: string[] = [];
    lines.push(`# 研究报告: ${state.query}`);
    lines.push("");
    const last = state.loops[state.loops.length - 1];
    lines.push(
      `> 轮数 ${state.loops.length} | 事实 ${state.facts.length} 条 / 引用池 ${state.pool.size} | ` +
      `停止: ${state.stop?.reason ?? "completed"} (${state.stop?.detail ?? ""}) | ` +
      `反思 Q1=${last?.reflect.q1Facts.toFixed(2)} Q2=${last?.reflect.q2Coverage.toFixed(2)}` +
      ` Q3=${last?.reflect.q3Authority} Q4=${last?.reflect.q4Freshness} Q5=${last?.reflect.q5MultiSource.toFixed(2)} Q6=${last?.reflect.q6Usable.toFixed(2)}`,
    );
    lines.push("");
    for (const angle of state.angles) {
      const facts = byAngle.get(angle) ?? [];
      lines.push(`## ${angle}`);
      if (facts.length === 0) {
        lines.push(`- (本角度未获得可引用事实 — 覆盖缺口,见反思 Q2)`);
      } else {
        for (const f of facts) {
          lines.push(`- ${f.quote} [${f.refId}]`);
        }
      }
      lines.push("");
    }
    lines.push(`## 引用`);
    lines.push(renderCitations(state.registry));
    return lines.join("\n");
  }

  #buildResult(state: ResearchState, resumed: boolean, report?: string): ResearchResult {
    const refs = [...state.pool.values()].sort((a, b) => (a.refId ?? 0) - (b.refId ?? 0));
    const registry = state.registry;
    return {
      runId: state.runId,
      resumed,
      query: state.query,
      angles: state.angles,
      facts: state.facts,
      refs,
      loops: state.loops,
      report: report ?? state.report ?? this.#defaultReport(state),
      registry: [...registry.entries()].map(([k, v]) => [k, v] as [number, { url: string; title: string }]),
      stop: state.stop ?? { reason: "completed", detail: "" },
      strict: state.strict,
      stats: { ...state.stats },
      journalPath: this.#filePath(state.runId),
      outline: buildOutline(state.angles, state.facts), // v0.8 STORM 骨架
    };
  }
}

