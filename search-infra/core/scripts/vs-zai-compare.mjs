/**
 * vs-zai-compare.mjs — search-core vs 托管聚合搜索(我方 AI 内置 web_search)同题对照 (Phase Z, 用户提案)
 *
 * 用户原话: "没有跑一轮进行测试和你之间搜索的进行对比"
 *
 * 口径(诚实优先):
 *   - 同题集: 复用 quality-bench.mjs 的 9 例(含 fact/学术/路由/中文/灌水重灾区), 关键词判分完全一致
 *   - 同一把尺子: 两边都用 authority.ts 的 16 权威域 + credibility.ts 的灌水清单打标
 *   - 只比搜索层(L1, top-5 关键词命中), 不含爬取层 —— 两边都只回 snippet, 比爬取对 z-ai 不公平
 *   - 单样本/题, 真网络无缓存, 有波动; z-ai 侧耗时含 CLI/SDK 冷启动(约 1-2s), 只做方向性参考
 *   - z-ai 后端是黑盒(托管聚合), 不知其上游池; 我们赢在可控(可路由/可屏蔽/可自托管), 不赢在神秘
 *
 * 用法: node scripts/vs-zai-compare.mjs [--quick(4 题)]
 * 原始 JSON 落 /tmp/vs-zai-<ts>.json(不入仓), stdout 抄结论入报告。
 */
import { SearchCore } from "../dist/index.js";
import { matchAuthority } from "../dist/authority.js";
import { matchSpamBlocked, matchSpamDownweight } from "../dist/credibility.js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const CASES = [
  { q: "retrieval augmented generation original paper Lewis", expect: ["2005.11401", "retrieval-augmented", "lewis"], type: "academic" },
  { q: "transformer attention is all you need paper", expect: ["1706.03762", "vaswani", "attention"], type: "academic-priority" },
  { q: "who invented the world wide web", expect: ["berners-lee", "tim berners"], type: "fact" },
  { q: "rust crate async runtime tokio", expect: ["tokio"], type: "route-packages" },
  { q: "向量数据库 milvus faiss 对比", expect: ["milvus"], type: "zh-tech" },
  { q: "aspirin mechanism of action cyclooxygenase", expect: ["cyclooxygenase", "prostaglandin"], type: "med-academic" },
  { q: "docker image official postgres", expect: ["postgres"], type: "route-devops" },
  { q: "IPCC AR6 climate change report 2023 findings", expect: ["ipcc", "ar6"], type: "fact-report" },
  { q: "python asyncio 教程", expect: ["asyncio"], type: "spam-filter" }, // csdn 重灾区, 验证屏蔽差异
];

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "?"; } };
const hasAny = (text, expects) => {
  const low = String(text).toLowerCase();
  return expects.find((e) => low.includes(e.toLowerCase())) ?? null;
};

/** 统一打标: 用同一份 authority/spam 清单量任何一方的 results */
function grade(results) {
  return {
    authorityHits: results.filter((r) => matchAuthority(r.url)).length,
    blockedPresent: results.filter((r) => matchSpamBlocked(r.url)).map((r) => host(r.url)),
    downweightPresent: results.filter((r) => matchSpamDownweight(r.url)).map((r) => host(r.url)),
    domains: [...new Set(results.map((r) => host(r.url)))],
  };
}

/** z-ai web_search: 托管聚合, spawn CLI(含冷启动), 结果 {url,name,snippet,host_name,rank} */
function zaiSearch(q, tag) {
  const out = `/tmp/vs-zai-${tag}.json`;
  const t0 = Date.now();
  const p = spawnSync("z-ai", ["function", "-n", "web_search", "-a", JSON.stringify({ query: q, num: 10 }), "-o", out], { timeout: 60_000, encoding: "utf8" });
  const wallMs = Date.now() - t0;
  if (p.status !== 0 || !fs.existsSync(out)) return { ok: false, error: (p.stderr || p.stdout || "no output").slice(-160), wallMs };
  try {
    const arr = JSON.parse(fs.readFileSync(out, "utf8"));
    return {
      ok: true, wallMs, n: arr.length,
      results: arr.map((r) => ({ url: r.url, title: r.name ?? "", snippet: r.snippet ?? "" })),
    };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e).slice(0, 160), wallMs };
  }
}

const core = new SearchCore();
const quick = process.argv.includes("--quick");
const cases = quick ? CASES.slice(0, 4) : CASES;
const out = { startedAt: new Date().toISOString(), cases: [] };

for (const c of cases) {
  const row = { q: c.q, type: c.type, expect: c.expect };
  // --- A: search-core ---
  try {
    const t0 = Date.now();
    const s = await core.search(c.q, { noCache: true, topN: 10 });
    row.core = {
      ok: true, elapsedMs: s.meta.elapsedMs, wallMs: Date.now() - t0,
      enginesUsed: s.meta.enginesUsed, nRefs: s.refs.length,
      results: s.refs.slice(0, 10).map((r) => ({ url: r.url, title: r.title, snippet: r.snippet })),
      spamBlockedDropped: s.meta.spamBlocked ?? 0,
      degraded: !!s.meta.degraded,
    };
  } catch (e) {
    row.core = { ok: false, error: String(e.message ?? e).slice(0, 160) };
  }
  // --- B: z-ai web_search ---
  const tag = String(cases.indexOf(c));
  row.zai = zaiSearch(c.q, tag);

  // --- 同尺判分 ---
  for (const side of ["core", "zai"]) {
    const d = row[side];
    if (!d?.ok) { d.l1 = false; continue; }
    d.top5Text = d.results.slice(0, 5).map((r) => `${r.title} ${r.snippet}`).join("\n");
    d.l1 = hasAny(d.top5Text, c.expect) ?? null;
    Object.assign(d, grade(d.results));
  }
  // 重叠度(top-10 域名级 Jaccard + URL 交集)
  if (row.core.ok && row.zai.ok) {
    const cd = new Set(row.core.domains), zd = new Set(row.zai.domains);
    const inter = [...cd].filter((x) => zd.has(x));
    row.overlap = {
      domainJaccard: Number((inter.length / new Set([...cd, ...zd]).size).toFixed(2)),
      urlInter: row.core.results.filter((r) => row.zai.results.some((z) => z.url === r.url)).length,
      sharedDomains: inter,
    };
  }
  out.cases.push(row);
  console.error(`[done ${out.cases.length}/${cases.length}] ${c.q} core=${row.core.ok ? (row.core.l1 ? "L1" : "-") : "ERR"} zai=${row.zai.ok ? (row.zai.l1 ? "L1" : "-") : "ERR"}`);
}

// ---------- 汇总 ----------
const C = out.cases.filter((r) => r.core?.ok), Z = out.cases.filter((r) => r.zai?.ok);
const both = out.cases.filter((r) => r.core?.ok && r.zai?.ok);
const sum = {
  n: out.cases.length,
  core: {
    ok: C.length, l1: C.filter((r) => r.core.l1).length,
    elapsedAvgMs: Math.round(C.reduce((a, r) => a + r.core.elapsedMs, 0) / Math.max(1, C.length)),
    authorityAvg: (C.reduce((a, r) => a + r.core.authorityHits, 0) / Math.max(1, C.length)).toFixed(1),
    blockedInRefs: C.reduce((a, r) => a + r.core.blockedPresent.length, 0),
    spamDroppedTotal: C.reduce((a, r) => a + (r.core.spamBlockedDropped ?? 0), 0),
    domainAvg: (C.reduce((a, r) => a + r.core.domains.length, 0) / Math.max(1, C.length)).toFixed(1),
  },
  zai: {
    ok: Z.length, l1: Z.filter((r) => r.zai.l1).length,
    wallAvgMs: Math.round(Z.reduce((a, r) => a + r.zai.wallMs, 0) / Math.max(1, Z.length)),
    authorityAvg: (Z.reduce((a, r) => a + r.zai.authorityHits, 0) / Math.max(1, Z.length)).toFixed(1),
    blockedPresentTotal: Z.reduce((a, r) => a + r.zai.blockedPresent.length, 0),
    downweightPresentTotal: Z.reduce((a, r) => a + r.zai.downweightPresent.length, 0),
    domainAvg: (Z.reduce((a, r) => a + r.zai.domains.length, 0) / Math.max(1, Z.length)).toFixed(1),
  },
  headToHead: {
    bothWin: both.filter((r) => r.core.l1 && r.zai.l1).length,
    coreOnly: both.filter((r) => r.core.l1 && !r.zai.l1).map((r) => r.type),
    zaiOnly: both.filter((r) => !r.core.l1 && r.zai.l1).map((r) => r.type),
    bothMiss: both.filter((r) => !r.core.l1 && !r.zai.l1).map((r) => r.type),
    domainJaccardAvg: (both.reduce((a, r) => a + r.overlap.domainJaccard, 0) / Math.max(1, both.length)).toFixed(2),
  },
};

console.log("=== SUMMARY (search-core vs z-ai web_search, 同题同尺) ===");
console.log(JSON.stringify(sum, null, 2));
console.log("=== PER-CASE ===");
for (const r of out.cases) {
  console.log(`\n## ${r.q} [${r.type}]  expect=${JSON.stringify(r.expect)}`);
  for (const [side, label] of [["core", "core"], ["zai", "z-ai "]]) {
    const d = r[side];
    if (!d?.ok) { console.log(`  ${label} ERROR: ${d?.error ?? "?"}`); continue; }
    console.log(`  ${label} L1=${d.l1 ? "HIT(" + d.l1 + ")" : "miss"} ${label === "core" ? `${d.elapsedMs}ms engines=${(d.enginesUsed ?? []).join("+")}` : `${d.wallMs}ms(含冷启)`} auth=${d.authorityHits} blocked=${d.blockedPresent.join(",") || "-"}${side === "core" ? ` spamDropped=${d.spamBlockedDropped ?? 0}` : ` dw=${d.downweightPresent.join(",") || "-"}`} top5=${d.results.slice(0, 5).map((x) => host(x.url)).join(" | ")}`);
  }
  if (r.overlap) console.log(`  overlap jaccard=${r.overlap.domainJaccard} urlInter=${r.overlap.urlInter} shared=${r.overlap.sharedDomains.join(",") || "-"}`);
}

const outPath = `/tmp/vs-zai-${Date.now()}.json`;
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.error(`\nraw saved: ${outPath} (NOT committed)`);
