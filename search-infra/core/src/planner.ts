/**
 * Query Planner v0.1 — 规则版复杂度路由 (v0-spec §4.1)
 * v0.1 只做: 复杂度分级 + 路由(web/x/github) + multi 拆分。
 * LLM 改写/角度并行/澄清为 v0.2 (接口预留: PlannerDecision 可直接承载)。
 * Planner 失败不阻塞 —— 调用方 catch 后退化为 [原 query] + web 路由。
 * phase AA(对照轮增量): plan() 包一层查询语言自动检测(原 planBase 不动, 零风险)。
 */
import type { PlannerDecision } from "./types.js";
import { lookupDomains } from "./domains.js";

const RESEARCH_HINTS = [
  "深度研究", "研究一下", "调研", "全面分析", "综述", "深度分析", "系统分析",
  "deep research", "in-depth", "state of the art", "survey", "landscape",
  "来龙去脉", "发展历程", "优缺点对比", "可行性",
];
const MULTI_HINTS = [
  " 对比 ", " 比较 ", " vs ", " versus ", " 哪个", " 差异", " 区别", " 不同点",
];
const X_HINTS = ["site:x.com", "site:twitter.com", "推特", "推文", "twitter 上", "x 上", "x.com"];
const GH_HINTS = ["github", "开源仓库", "开源实现", "repo:", "源码仓库"];

/**
 * phase AA(对照轮增量): 查询语言自动检测 → decision.lang。
 * 中文路由能力(wikipedia zh 子域/googlenews hl-gl-ceid/mdn locale)早已在 provider 层就绪,
 * 但 opts.lang 只能调用方手动传 — 普通 search 没人传, 中文路由永远不触发。
 * 规则: CJK 字符 ≥2 → "zh"(单字误伤风险高不触发); 调用方显式 opts.lang 优先(engine 层合并)。
 * 对照轮实测教训: "python asyncio 教程"这类中英混排题, 中文面是关键增量。
 */
export function plan(query: string): PlannerDecision {
  const decision = planBase(query);
  const cjk = (query.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (cjk >= 2) decision.lang = "zh";
  return decision;
}

function planBase(query: string): PlannerDecision {
  const q = query.trim();
  const low = q.toLowerCase();
  const reasons: string[] = [];

  // 路由判断(优先级: x > github > web)
  if (X_HINTS.some((h) => low.includes(h))) {
    reasons.push("x-related keywords");
    return { complexity: "simple", queries: [q], route: "x", reasons };
  }
  if (GH_HINTS.some((h) => low.includes(h))) {
    reasons.push("github-related keywords");
    return { complexity: "simple", queries: [q], route: "github", reasons };
  }

  // research 判断
  if (RESEARCH_HINTS.some((h) => low.includes(h)) || q.length > 120) {
    reasons.push("research keywords/length");
    return {
      complexity: "research",
      queries: [q],
      route: "web",
      reasons,
      researchHint: true, // v0.2 实现 research loop;v0.1 退化为单轮并行
    };
  }

  // multi 判断: 对比句式拆分 "A vs B" / "比较A和B"
  for (const h of MULTI_HINTS) {
    const idx = low.indexOf(h.trim());
    if (idx !== -1) {
      reasons.push(`multi-comparison pattern "${h.trim()}"`);
      const parts = splitComparison(q);
      if (parts.length >= 2) {
        return { complexity: "multi", queries: parts, route: "web", reasons };
      }
    }
  }

  // 多问句拆分
  const questions = q.split(/[?？]/).map((s) => s.trim()).filter((s) => s.length > 4);
  if (questions.length >= 2) {
    reasons.push(`${questions.length} question sentences`);
    return { complexity: "multi", queries: questions, route: "web", reasons };
  }

  // v0.6 域名路由: 查表命中 → 领域专线(Tier1 免 key API 直连 + Tier2 site: 查询)。
  // 放在 x/github/research/multi 之后: 显式深研究("综述")与对比拆分优先级更高,
  // 普通领域查询("python 报错")才走专线。未命中 → 走原 simple web。
  const dr = lookupDomains(q);
  if (dr) {
    reasons.push(`domain-route: ${dr.topic} (tier1: ${dr.apiProviders.join("/")})`);
    return {
      complexity: "simple",
      queries: [q, ...dr.siteQueries],
      route: "domain", // v0.7: 域名命中不再标 "web"(MCP meta.route 可读出专线;topic 看 domainPlan/reasons)
      reasons,
      domainPlan: {
        topic: dr.topic,
        apiProviders: dr.apiProviders,
        siteQueries: dr.siteQueries,
        siteEngines: dr.siteEngines,
      },
    };
  }

  return { complexity: "simple", queries: [q], route: "web", reasons };
}

/** "比较 A 和 B" → ["A", "B"](连原 query 一起交给引擎,Fusion 自然聚合) */
export function splitComparison(q: string): string[] {
  const m = q.match(/(?:比较|对比|区别|差异)[:：]?\s*(.+?)(?:\s*(?:和|与|跟|vs|及)\s*(.+?))?(?:的)?(?:差异|区别|优缺点|哪个好)?[?？。!！]?$/);
  if (m) {
    const a = m[1]?.trim();
    const b = m[2]?.trim();
    if (a && b) return [a, b, q];
  }
  const vs = q.split(/\s+vs\.?\s+|\s+versus\s+/i).map((s) => s.trim()).filter(Boolean);
  if (vs.length >= 2 && vs.length <= 4) return [...vs, q];
  return [];
}
