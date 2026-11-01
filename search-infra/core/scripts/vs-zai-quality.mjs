/**
 * vs-zai-quality.mjs — 全面性×质量双维同尺对照 (第 7 采样, 用户点名"全面性和质量")
 *
 * 与 vs-zai-compare.mjs(第 1-6 采样, L1 命中制)的区别:
 *   本脚本把两边的 top-10 都用同一套三层数据逐 URL 打标, 量四个此前没量过的维度:
 *   质量:  ① 分档分布(s/a/b/g 档位在 top-10 的个数, s 档进 top-5 的个数=排序质量)
 *          ② spam 交叉(csdn 家族等硬屏蔽单两边同查)
 *   全面性: ③ 独占源(一方有另一方没有的域名数——"谁看到了对方看不到的互联网")
 *          ④ 来源类型覆盖(kind=official/community/media/expert/reference 的桶数; phase AF 起用
 *            classifySourceKind 推导 — 条目显式 kind > 域名模式 > 表缺省, 两侧同一把尺)
 *
 * 诚实口径(沿袭):
 *   - 尺子是我们自己的三层数据(authority.ts), 对 z-ai 有自引偏差——用 L1 关键词+spam 交叉+
 *     独占源人工复核三条对冲, 结论只谈方向不谈精度。
 *   - z-ai 侧耗时含 CLI 冷启动; 我方 topic 由题面给定(等价 planner 决策), category 走
 *     detectCategory 运行时(与生产同路径)。
 *   - 原始 JSON 只落 /tmp 不入仓, stdout 抄结论。
 *
 * 用法: node scripts/vs-zai-quality.mjs [--quick(4 题)] [--cases <题库.mjs>] [--label <采样批次名>]
 *   --cases  外挂题库模块(export const CASES = [...], 条目形状同内置 CASES, 可带 category 强制指认)
 *   --label  stdout 汇总头批次名(默认沿用内置 9 题)
 */
import { SearchCore } from "../dist/index.js";
import {
  matchAuthority, matchTopicAuthority, matchCategoryAuthority,
  detectCategory, detectCommunityIntent, classifySourceKind,
} from "../dist/authority.js";
import { matchSpamBlocked, matchSpamDownweight } from "../dist/credibility.js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const CASES = [
  { q: "python asyncio 教程", topic: "programming", lang: "zh", expect: ["asyncio"], type: "zh-tutorial" },
  { q: "react server components vs client components", topic: "programming", expect: ["server components"], type: "en-programming" },
  { q: "kubernetes pod disruption budget best practices", topic: "devops", expect: ["disruption"], type: "devops" },
  { q: "postgresql jsonb 索引优化", topic: null, expect: ["jsonb"], type: "databases-zh" },
  { q: "transformer attention is all you need paper", topic: "academic", expect: ["1706.03762", "vaswani", "attention"], type: "academic" },
  { q: "who invented the world wide web", topic: "entities", expect: ["berners-lee", "tim berners"], type: "fact" },
  { q: "heartbleed openssl vulnerability explained", topic: null, expect: ["heartbleed"], type: "security" },
  { q: "民法典 诉讼时效 法律 规定", topic: null, lang: "zh", expect: ["诉讼时效"], type: "zh-legal" },
  { q: "向量数据库 milvus faiss 对比", topic: null, lang: "zh", expect: ["milvus"], type: "zh-tech" },
];

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "?"; } };
const hasCJK = (s) => /[\u4e00-\u9fff]/.test(String(s));
const hasAny = (text, expects) => {
  const low = String(text).toLowerCase();
  return expects.find((e) => low.includes(e.toLowerCase())) ?? null;
};
const TIER_RANK = { s: 3, a: 2, b: 1 };

/**
 * 单边打标: 同一套三层数据量任何一方的 top-10。
 * 每条 URL: tier = topic/category 取最强(s>a>b), 都没中但全局表命中 → "g", 否则 null。
 * kind 来自 classifySourceKind(条目显式 kind 优先, 否则域名模式/表缺省推导) — 补密度后指标有判别力。
 */
function gradeSide(results, c) {
  const category = c.category ?? detectCategory(c.q);
  const commIntent = detectCommunityIntent(c.q);
  let top5s = 0;
  const tierCounts = { s: 0, a: 0, b: 0, g: 0, none: 0 };
  const kinds = new Set();
  const blocked = [], downweight = [];
  const zhCount = results.filter((r) => hasCJK(r.title) || hasCJK(r.snippet)).length;
  const marked = results.map((r, i) => {
    const t = c.topic ? matchTopicAuthority(r.url, c.topic, c.lang, commIntent) : null;
    const g = category ? matchCategoryAuthority(r.url, category, c.lang, commIntent) : null;
    const best = [t, g].filter(Boolean).sort((a, b) => b.boost - a.boost)[0] ?? null;
    const glob = !best && matchAuthority(r.url) ? "g" : null;
    const tier = best ? best.entry.tier : glob;
    if (tier) tierCounts[tier]++;
    else tierCounts.none++;
    if (tier === "s" && i < 5) top5s++;
    const kindOf = classifySourceKind(r.url, best ? { domain: best.entry.domain, kind: best.entry.kind } : null);
    if (kindOf) kinds.add(kindOf);
    const b = matchSpamBlocked(r.url), d = matchSpamDownweight(r.url);
    if (b) blocked.push(host(r.url));
    if (d) downweight.push(host(r.url));
    return { url: r.url, tier: tier ?? null, kind: kindOf };
  });
  return {
    category, commIntent, tierCounts, top5s, kinds: [...kinds],
    blocked, downweight, zhCount, marked,
    uniqueDomains: [...new Set(results.map((r) => host(r.url)))],
  };
}

function zaiSearch(q, tag) {
  const out = `/tmp/vs-zai-quality-${tag}.json`;
  const t0 = Date.now();
  const p = spawnSync("z-ai", ["function", "-n", "web_search", "-a", JSON.stringify({ query: q, num: 10 }), "-o", out], { timeout: 60_000, encoding: "utf8" });
  const wallMs = Date.now() - t0;
  if (p.status !== 0 || !fs.existsSync(out)) return { ok: false, error: (p.stderr || p.stdout || "no output").slice(-160), wallMs };
  try {
    const arr = JSON.parse(fs.readFileSync(out, "utf8"));
    return { ok: true, wallMs, n: arr.length, results: arr.map((r) => ({ url: r.url, title: r.name ?? "", snippet: r.snippet ?? "" })) };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e).slice(0, 160), wallMs };
  }
}

const core = new SearchCore();
const quick = process.argv.includes("--quick");
let cases = quick ? CASES.slice(0, 4) : CASES;
const casesIdx = process.argv.indexOf("--cases");
if (casesIdx > -1 && process.argv[casesIdx + 1]) {
  const mod = await import(pathToFileURL(process.argv[casesIdx + 1]));
  if (!Array.isArray(mod.CASES)) throw new Error("--cases module must export const CASES = [...]");
  cases = mod.CASES;
}
const labelIdx = process.argv.indexOf("--label");
const label = labelIdx > -1 && process.argv[labelIdx + 1] ? process.argv[labelIdx + 1] : "第 7 采样: 全面性×质量双维, 同题同尺";
const out = { startedAt: new Date().toISOString(), label, cases: [] };

for (const c of cases) {
  const row = { q: c.q, type: c.type, topic: c.topic, expect: c.expect };
  // --- A: search-core ---
  try {
    const t0 = Date.now();
    const s = await core.search(c.q, { noCache: true, topN: 10 });
    row.core = {
      ok: true, elapsedMs: s.meta.elapsedMs, wallMs: Date.now() - t0,
      enginesUsed: s.meta.enginesUsed, nRefs: s.refs.length,
      spamBlockedDropped: s.meta.spamBlocked ?? 0,
      results: s.refs.slice(0, 10).map((r) => ({ url: r.url, title: r.title, snippet: r.snippet })),
    };
  } catch (e) {
    row.core = { ok: false, error: String(e.message ?? e).slice(0, 160) };
  }
  // --- B: z-ai web_search ---
  row.zai = zaiSearch(c.q, String(cases.indexOf(c)));

  // --- 同尺判分 ---
  for (const side of ["core", "zai"]) {
    const d = row[side];
    if (!d?.ok) { d.l1 = false; continue; }
    d.top5Text = d.results.slice(0, 5).map((r) => `${r.title} ${r.snippet}`).join("\n");
    d.l1 = hasAny(d.top5Text, c.expect) ?? null;
    Object.assign(d, gradeSide(d.results, c));
  }
  // --- 全面性: 独占源 + 重叠 ---
  if (row.core.ok && row.zai.ok) {
    const cd = new Set(row.core.uniqueDomains), zd = new Set(row.zai.uniqueDomains);
    const coreOnly = [...cd].filter((x) => !zd.has(x));
    const zaiOnly = [...zd].filter((x) => !cd.has(x));
    row.exclusive = {
      coreOnly, zaiOnly,
      coreOnlyN: coreOnly.length, zaiOnlyN: zaiOnly.length,
      jaccard: Number(([...cd].filter((x) => zd.has(x)).length / new Set([...cd, ...zd]).size).toFixed(2)),
    };
  }
  out.cases.push(row);
  const cl = row.core.ok ? (row.core.l1 ? "HIT" : "miss") : "ERR";
  const zl = row.zai.ok ? (row.zai.l1 ? "HIT" : "miss") : "ERR";
  console.error(`[done ${out.cases.length}/${cases.length}] ${c.q} core=${cl} zai=${zl}`);
}

// ---------- 汇总 ----------
const C = out.cases.filter((r) => r.core?.ok), Z = out.cases.filter((r) => r.zai?.ok);
const both = out.cases.filter((r) => r.core?.ok && r.zai?.ok);
const avg = (arr, f) => (arr.reduce((a, r) => a + f(r), 0) / Math.max(1, arr.length));
const sum = {
  n: out.cases.length,
  quality: {
    core: {
      l1: C.filter((r) => r.core.l1).length,
      sTotal: C.reduce((a, r) => a + r.core.tierCounts.s, 0),
      top5sTotal: C.reduce((a, r) => a + r.core.top5s, 0),
      authorityAny: C.reduce((a, r) => a + r.core.tierCounts.s + r.core.tierCounts.a + r.core.tierCounts.b + r.core.tierCounts.g, 0),
      blockedInTop10: C.reduce((a, r) => a + r.core.blocked.length, 0),
      spamDropped: C.reduce((a, r) => a + (r.core.spamBlockedDropped ?? 0), 0),
      avgMs: Math.round(avg(C, (r) => r.core.elapsedMs)),
    },
    zai: {
      l1: Z.filter((r) => r.zai.l1).length,
      sTotal: Z.reduce((a, r) => a + r.zai.tierCounts.s, 0),
      top5sTotal: Z.reduce((a, r) => a + r.zai.top5s, 0),
      authorityAny: Z.reduce((a, r) => a + r.zai.tierCounts.s + r.zai.tierCounts.a + r.zai.tierCounts.b + r.zai.tierCounts.g, 0),
      blockedInTop10: Z.reduce((a, r) => a + r.zai.blocked.length, 0),
      downweightInTop10: Z.reduce((a, r) => a + r.zai.downweight.length, 0),
      avgMs: Math.round(avg(Z, (r) => r.zai.wallMs)),
    },
  },
  comprehensiveness: {
    core: { uniqueDomainAvg: +avg(C, (r) => r.core.uniqueDomains.length).toFixed(1), coreOnlyAvg: +avg(both, (r) => r.exclusive.coreOnlyN).toFixed(1), kindBucketAvg: +avg(C, (r) => r.core.kinds.length).toFixed(1) },
    zai: { uniqueDomainAvg: +avg(Z, (r) => r.zai.uniqueDomains.length).toFixed(1), zaiOnlyAvg: +avg(both, (r) => r.exclusive.zaiOnlyN).toFixed(1), kindBucketAvg: +avg(Z, (r) => r.zai.kinds.length).toFixed(1) },
    jaccardAvg: +avg(both, (r) => r.exclusive.jaccard).toFixed(2),
  },
  zhFace: {
    zhCases: out.cases.filter((r) => r.core?.ok && hasCJK(r.q)).map((r) => ({
      q: r.q, coreZh: r.core.zhCount, zaiZh: r.zai.zhCount ?? null,
    })),
  },
};

console.log(`=== SUMMARY (${label}) ===`);
console.log(JSON.stringify(sum, null, 2));
console.log("=== PER-CASE ===");
for (const r of out.cases) {
  console.log(`\n## ${r.q} [${r.type}] category=${r.core?.category ?? r.zai?.category ?? "-"} expect=${JSON.stringify(r.expect)}`);
  for (const [side, label] of [["core", "core"], ["zai", "z-ai "]]) {
    const d = r[side];
    if (!d?.ok) { console.log(`  ${label} ERROR: ${d?.error ?? "?"}`); continue; }
    const t = d.tierCounts;
    const ms = side === "core" ? `${d.elapsedMs}ms` : `${d.wallMs}ms(含冷启)`;
    console.log(`  ${label} L1=${d.l1 ? "HIT(" + d.l1 + ")" : "miss"} ${ms} tier[s/a/b/g]=${t.s}/${t.a}/${t.b}/${t.g} top5s=${d.top5s} kinds=[${d.kinds.join(",") || "-"}] uniqDom=${d.uniqueDomains.length}${side === "core" ? ` spamDropped=${d.spamBlockedDropped ?? 0}` : ` blocked=${d.blocked.join(",") || "-"} dw=${d.downweight.join(",") || "-"}`}`);
    console.log(`      top5=${d.results.slice(0, 5).map((x) => host(x.url)).join(" | ")}`);
  }
  if (r.exclusive) console.log(`  exclusives core+${r.exclusive.coreOnlyN}(${r.exclusive.coreOnly.slice(0, 4).join(",")}) zai+${r.exclusive.zaiOnlyN}(${r.exclusive.zaiOnly.slice(0, 4).join(",")}) jaccard=${r.exclusive.jaccard}`);
}

const outPath = `/tmp/vs-zai-quality-${Date.now()}.json`;
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.error(`\nraw saved: ${outPath} (NOT committed)`);
