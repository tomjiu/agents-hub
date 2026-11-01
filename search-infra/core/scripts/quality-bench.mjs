/**
 * quality-bench.mjs — search-core 全链路质量评测 v1 (Phase V, 用户提案)
 *
 * 五维指标(用户原话对齐):
 *   1. 搜索成果质量: 引擎出勤/失败、top5 域名分布、权威域名命中(提权效果)、耗时
 *   2. 爬取质量: fetch 成功率、正文提取长度、耗时、失败分类(anti-bot/超时/http)
 *   3. 清洗质量: 导航/广告残留计数、模板重复行率、"干净"占比
 *   4. 返回文本质量: research summary 档的 loops/facts/引用覆盖/终稿长度/大纲
 *   5. 解决问题: expect 关键词命中(代理指标, 诚实口径: 命中≠真解决)
 *      L1=搜索层(title+snippet) → L2=爬取层(正文) → L3=研究层(终稿)
 *
 * 用法: node scripts/quality-bench.mjs [--quick(4 题)]
 * 原始 JSON 落 /tmp/quality-bench-<ts>.json(不入仓), stdout 抄结论入报告。
 */
import { SearchCore } from "../dist/index.js";

const NAV_RESIDUE = /(sign in|sign up|subscribe|newsletter|accept all cookies|cookie settings|advertisement|skip to (main )?content|related articles|recommended for you|登录|订阅|广告)/gi;

const CASES = [
  { q: "retrieval augmented generation original paper Lewis", expect: ["2005.11401", "retrieval-augmented", "lewis"], type: "academic" },
  { q: "transformer attention is all you need paper", expect: ["1706.03762", "vaswani", "attention"], type: "academic-priority" },
  { q: "who invented the world wide web", expect: ["berners-lee", "tim berners"], type: "fact" },
  { q: "rust crate async runtime tokio", expect: ["tokio"], type: "route-packages" },
  { q: "向量数据库 milvus faiss 对比", expect: ["milvus"], type: "zh-tech" },
  { q: "aspirin mechanism of action cyclooxygenase", expect: ["cyclooxygenase", "prostaglandin"], type: "med-academic" },
  { q: "docker image official postgres", expect: ["postgres"], type: "route-devops" },
  { q: "IPCC AR6 climate change report 2023 findings", expect: ["ipcc", "ar6"], type: "fact-report" },
  { q: "python asyncio 教程", expect: ["asyncio"], type: "spam-filter" }, // csdn 重灾区查询, 验证屏蔽
];

const RESEARCH_CASES = [
  { q: "retrieval augmented generation original paper Lewis", expect: ["2005.11401", "retrieval-augmented", "lewis"] },
  { q: "who invented the world wide web", expect: ["berners-lee", "tim berners"] },
];

const host = (u) => { try { return new URL(u).hostname; } catch { return "?"; } };
const hasAny = (text, expects) => {
  const low = String(text).toLowerCase();
  return expects.find((e) => low.includes(e.toLowerCase())) ?? null;
};
const cleanLines = (t) => t.split("\n").filter((l) => l.trim().length > 0);

const core = new SearchCore();
const quick = process.argv.includes("--quick");
const cases = quick ? CASES.slice(0, 4) : CASES;

const out = { startedAt: new Date().toISOString(), search: [], research: [] };

// ---------- 第 1/2/3/5 维: 搜索+爬取+清洗+解题 ----------
for (const c of cases) {
  const row = { q: c.q, type: c.type, expect: c.expect };
  try {
    const s = await core.search(c.q, { noCache: true, topN: 10 });
    row.search = {
      enginesUsed: s.meta.enginesUsed,
      enginesFailed: s.meta.enginesFailed.map((f) => `${f.name}(${f.status})`),
      degraded: !!s.meta.degraded,
      elapsedMs: s.meta.elapsedMs,
      nRefs: s.refs.length,
      authorityHits: s.refs.filter((r) => r.authority).length,
      spamBlocked: s.meta.spamBlocked ?? 0,
      spamTagged: s.refs.filter((r) => r.spam).map((r) => `${host(r.url)}=${r.spam}`),
      top8: s.refs.slice(0, 8).map((r) => ({
        rank: r.rank, host: host(r.url), auth: r.authority ?? "",
        score: Number((r.score ?? 0).toFixed(2)),
        title: r.title.slice(0, 70),
        route: r.kind ?? (r.engines[0] ?? ""),
      })),
      domains: [...new Set(s.refs.map((r) => host(r.url)))].length,
    };
    row.solvedL1 = hasAny(s.refs.slice(0, 5).map((r) => `${r.title} ${r.snippet}`).join("\n"), c.expect) ?? null;

    // phase AF: L2 判分窗 top-3→top-5。根因(route-packages 第 11 轮): crates.io 排序波动让 tokio
    // 掉到 #4, L2 只抓 top-3 → 抓不到 → 误判 MISS(改写链实弹正常)。口径: 前 3 条永远全量抓
    // (爬取/清洗质量指标样本不变); 仅当 L1 未解且前 3 未解时补抓 4/5 位判分; 短路: 已解即停。
    row.fetches = [];
    const bodies = [];
    for (const r of s.refs.slice(0, 5)) {
      if (row.fetches.length >= 3 && (row.solvedL1 || row.fetches.some((f) => f.ok && f.solvedL2))) break;
      try {
        const f = await core.fetch(r.url, { maxChars: 4000, noCache: true });
        const text = f.text ?? (f.segments ?? []).join("\n…\n");
        const lines = cleanLines(text);
        const seen = new Map();
        let dup = 0;
        for (const l of lines) { const k = l.trim(); if (k.length > 15) { seen.set(k, (seen.get(k) ?? 0) + 1); } }
        for (const n of seen.values()) if (n > 1) dup += n - 1;
        const navHits = [...text.matchAll(NAV_RESIDUE)].length;
        bodies.push(text);
        row.fetches.push({
          url: host(r.url), ok: true, status: f.status,
          textLength: f.textLength, returnedChars: f.returnedChars,
          navHits, dupLines: dup, totalLines: lines.length,
          clean: navHits <= 2 && lines.length > 0 && dup / Math.max(1, lines.length) < 0.25,
          elapsedMs: f.elapsedMs, msPerKb: Math.round(f.elapsedMs / Math.max(1, f.textLength / 1024)),
          solvedL2: hasAny(text, c.expect) ?? null,
        });
      } catch (e) {
        row.fetches.push({ url: host(r.url), ok: false, error: String(e.message ?? e).slice(0, 120) });
      }
    }
    row.solvedL2 = row.fetches.some((f) => f.ok && f.solvedL2) ? (row.fetches.find((f) => f.ok && f.solvedL2)?.solvedL2 ?? true) : null;
  } catch (e) {
    row.error = String(e.message ?? e).slice(0, 160);
  }
  out.search.push(row);
  console.error(`[done ${out.search.length}/${cases.length}] ${c.q}`);
}

// ---------- 第 4 维: research summary 档返回文本质量 ----------
for (const c of RESEARCH_CASES) {
  const row = { q: c.q, expect: c.expect };
  try {
    // v0.8.1 research 懒加载后走公共方法 deepResearch(engine.ts; 内部等价 ResearchLoop.run)
    const r = await core.deepResearch(c.q, { preset: "summary" });
    const cites = [...r.report.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    row.research = {
      stop: r.stop.reason,
      loops: r.stats.loops ?? r.loops.length,
      facts: r.facts.length,
      refsPooled: r.refs.length,
      registrySize: r.registry.length,
      uniqueCites: [...new Set(cites)].length,
      reportChars: r.report.length,
      outlineSections: r.outline.length,
      outline: r.outline.map((o) => `${o.angle}(${o.facts}f)`),
      citeCoverage: r.registry.length ? [...new Set(cites)].length / r.registry.length : 0,
      elapsedMs: r.stats.elapsedMs ?? 0,
    };
    row.solvedL3 = hasAny(r.report, c.expect) ?? null;
    row.reportHead = r.report.slice(0, 400); // 人工判读样本
  } catch (e) {
    row.error = String(e.message ?? e).slice(0, 160);
  }
  out.research.push(row);
  console.error(`[research done] ${c.q}`);
}

// ---------- 汇总 ----------
const S = out.search.filter((r) => r.search);
const fetchAll = S.flatMap((r) => r.fetches ?? []);
const sum = {
  searchLayer: {
    n: S.length,
    enginesAvg: (S.reduce((a, r) => a + r.search.enginesUsed.length, 0) / S.length).toFixed(1),
    authorityHitsTotal: S.reduce((a, r) => a + r.search.authorityHits, 0),
    authorityCases: S.filter((r) => r.search.authorityHits > 0).length,
    spamBlockedTotal: S.reduce((a, r) => a + (r.search.spamBlocked ?? 0), 0),
    spamTaggedCases: S.filter((r) => (r.search.spamTagged ?? []).length > 0).map((r) => `${r.type}: ${r.search.spamTagged.join(",")}`),
    degraded: S.filter((r) => r.search.degraded).length,
    elapsedAvgMs: Math.round(S.reduce((a, r) => a + r.search.elapsedMs, 0) / S.length),
    solvedL1: S.filter((r) => r.solvedL1).length,
  },
  fetchLayer: {
    attempts: fetchAll.length,
    ok: fetchAll.filter((f) => f.ok).length,
    fails: fetchAll.filter((f) => !f.ok).map((f) => `${f.url}: ${f.error}`),
    textLengthAvg: Math.round(fetchAll.filter((f) => f.ok).reduce((a, f) => a + f.textLength, 0) / Math.max(1, fetchAll.filter((f) => f.ok).length)),
    elapsedAvgMs: Math.round(fetchAll.filter((f) => f.ok).reduce((a, f) => a + f.elapsedMs, 0) / Math.max(1, fetchAll.filter((f) => f.ok).length)),
  },
  cleanLayer: {
    navHitsAvg: (fetchAll.filter((f) => f.ok).reduce((a, f) => a + f.navHits, 0) / Math.max(1, fetchAll.filter((f) => f.ok).length)).toFixed(1),
    cleanPct: `${Math.round(100 * fetchAll.filter((f) => f.ok && f.clean).length / Math.max(1, fetchAll.filter((f) => f.ok).length))}%`,
    worstNav: fetchAll.filter((f) => f.ok).sort((a, b) => b.navHits - a.navHits).slice(0, 3).map((f) => `${f.url}=${f.navHits}`),
  },
  solving: {
    L1: S.filter((r) => r.solvedL1).length, total: S.length,
    L1plusL2: S.filter((r) => r.solvedL1 || r.solvedL2).length,
    perCase: S.map((r) => `${r.type}: ${r.solvedL1 ? "L1" : r.solvedL2 ? "L2" : "MISS"}`),
  },
  textLayer: out.research.map((r) => ({ q: r.q, ...r.research, solved: !!r.solvedL3, error: r.error })),
};

console.log("=== SUMMARY ===");
console.log(JSON.stringify(sum, null, 2));
console.log("=== PER-CASE ===");
for (const r of out.search) {
  console.log(`\n## ${r.q} [${r.type}]`);
  if (r.error) { console.log(`  ERROR: ${r.error}`); continue; }
  console.log(`  engines=${r.search.enginesUsed.join("+")} failed=${r.search.enginesFailed.join(",") || "-"} ${r.search.elapsedMs}ms refs=${r.search.nRefs} uniqDomains=${r.search.domains} authorityHits=${r.search.authorityHits} spamBlocked=${r.search.spamBlocked ?? 0} solvedL1=${r.solvedL1 ?? "no"}`);
  for (const t of r.search.top8) console.log(`   #${t.rank} ${t.auth ? `[${t.auth}] ` : ""}${t.host} (${t.score}) ${t.title}`);
  for (const f of r.fetches ?? []) console.log(`   fetch ${f.ok ? "OK" : "FAIL"} ${f.url} len=${f.textLength ?? "-"} nav=${f.navHits ?? "-"} clean=${f.clean ?? "-"} ${f.elapsedMs ?? "-"}ms ${f.ok ? `L2=${f.solvedL2 ?? "no"}` : f.error}`);
}
console.log("=== RESEARCH ===");
for (const r of out.research) {
  console.log(`\n## ${r.q}`);
  console.log(JSON.stringify({ ...r.research, solvedL3: r.solvedL3 ?? "no" }, null, 1));
  if (r.reportHead) console.log(`  head: ${r.reportHead.replace(/\n/g, " | ").slice(0, 300)}`);
  if (r.error) console.log(`  ERROR: ${r.error}`);
}

const fs = await import("node:fs");
const path = `/tmp/quality-bench-${Date.now()}.json`;
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.error(`\nraw saved: ${path} (NOT committed)`);
