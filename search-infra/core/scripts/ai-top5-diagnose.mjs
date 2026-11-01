/**
 * ai-top5-diagnose.mjs — phase AI 立项诊断: s 档进 top5 密度短板的根因量化
 *
 * 背景(vs-zai 附录 F 第 12 采样): s 档 top10 21 vs 21 平, 但 s 档进 top5 12 vs 17 落后。
 * 落后面: security(cisa/microsoft/rapid7 官方全上 vs 我方博客面)/finance(federalreserve×2 第一
 * vs maseconomics/cnbc)/news(.europa.eu 密度)/databases(dev.mysql 没进 top5)/zh-legal(正主第一率)。
 *
 * 本脚本把 core top-10 逐 URL 拆解分数构成, 量化"官方源离 top5 还差几分":
 *   score = rrf*10 + lex*1.5 + consensus + titleBonus + authorityBoost
 *   可直接算出: lex(词法) / authority(权威提权, 含 AF 页面守卫模拟) 
 *   residual = score - lex*1.5 - authorityBoost  (= rrf*10 + consensus + titleBonus, 引擎共识位)
 * 再做提升模拟: s 档条目加 delta 后重排, 找"至少 1 条 s 进 top5"的最小 delta。
 *
 * 诚实口径: residual 是近似(引擎明细 rank 不出 SearchCore 边界), 但对"差多少分"的方向判断足够;
 * 原始 JSON 只落 /tmp 不入仓。
 */
import { SearchCore } from "../dist/index.js";
import {
  matchAuthority, matchTopicAuthority, matchCategoryAuthority,
  detectCategory, detectCommunityIntent, TIER_BOOST,
} from "../dist/authority.js";
import { lexicalScore, keyTermPresent } from "../dist/fusion.js";
import fs from "node:fs";

// 附录 F 落后 5 面 + 平手面代表, 每题 category 与 vs-zai-cases-full20 同口径
const CASES = [
  { q: "log4j CVE-2021-44228 mitigation guide", category: "security", expect: ["log4j", "44228"] },
  { q: "federal reserve interest rate decision 2026", category: "finance", expect: ["fed", "rate"] },
  { q: "EU AI Act implementation timeline latest news", category: "news", expect: ["ai act"] },
  { q: "mysql utf8mb4 collation difference", category: "databases", expect: ["utf8mb4"] },
  { q: "个人信息保护法 数据跨境 规定", category: "legal", lang: "zh", expect: ["个人信息保护", "跨境"] },
  { q: "metformin side effects long term", category: "medical", expect: ["metformin"] },
  { q: "design tokens figma vs tailwind comparison", category: "design", expect: ["figma", "design token"] },
];

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "?"; } };

const core = new SearchCore();
const report = [];

for (const c of CASES) {
  const s = await core.search(c.q, { noCache: true, topN: 20 });
  const commIntent = detectCommunityIntent(c.q);
  const top10 = s.refs.slice(0, 10).map((r, i) => {
    const cat = matchCategoryAuthority(r.url, c.category, c.lang, commIntent);
    const top = c.topic ? matchTopicAuthority(r.url, c.topic, c.lang, commIntent) : null;
    const tiered = [top, cat].filter(Boolean).sort((a, b) => b.boost - a.boost)[0] ?? null;
    const glob = matchAuthority(r.url);
    // 与 fuse() 同构(engine.ts: authorityBoost=academic 0.75 else 0.4):
    // globalBoost = 全局命中 ? 0.4 : 0; matched = tiered ? max(tiered, globalBoost) : globalBoost
    const globalBoost = glob ? 0.4 : 0;
    const pageHit = keyTermPresent(c.q, r.url, r.title, r.snippet);
    const authBoost = (tiered ? Math.max(tiered.boost, globalBoost) : globalBoost) * (pageHit ? 1 : 0);
    const lex = lexicalScore(c.q, r.title, r.snippet);
    const residual = (r.score ?? 0) - lex * 1.5 - authBoost; // rrf*10+consensus+titleBonus 近似
    return {
      rank: i + 1, host: host(r.url), score: +(r.score ?? 0).toFixed(3),
      lex: +lex.toFixed(2), auth: +authBoost.toFixed(2), residual: +residual.toFixed(3),
      tier: tiered?.entry.tier ?? (glob ? "g" : null),
      entry: tiered?.entry.domain ?? glob ?? null,
      guarded: !pageHit,
    };
  });
  // 提升模拟: 对 tiered s 档条目逐档加 delta 重排, 找最小 delta 使 s 条目进 top5
  const sim = [];
  for (const delta of [0, 0.3, 0.6, 0.9, 1.2, 1.8]) {
    const re = top10.map((x) => ({ ...x, sim: x.score + (x.tier === "s" ? delta : 0) }));
    re.sort((a, b) => b.sim - a.sim);
    const firstS = re.findIndex((x) => x.tier === "s");
    sim.push({ delta, sInTop5: re.slice(0, 5).filter((x) => x.tier === "s").length, firstSRank: firstS < 0 ? null : firstS + 1 });
  }
  report.push({ q: c.q, category: c.category, lang: c.lang ?? "en", top10, sim });
  console.error(`[done] ${c.q}`);
}

// ---- stdout 结论(只抄结论, 原始落 /tmp) ----
console.log("=== AI 诊断: s 档进 top5 密度短板拆解 ===\n");
for (const r of report) {
  console.log(`## ${r.q}  [${r.category}/${r.lang}]`);
  for (const x of r.top10.slice(0, 8)) {
    console.log(`  #${x.rank} ${x.host.padEnd(34)} score=${String(x.score).padEnd(6)} lex=${String(x.lex).padEnd(5)} auth=${String(x.auth).padEnd(5)} resid=${String(x.residual).padEnd(6)} tier=${x.tier ?? "-"} ${x.guarded ? "GUARDED" : ""}`);
  }
  console.log(`  模拟(s档+delta): ${r.sim.map((x) => `Δ${x.delta}→top5s=${x.sInTop5}(first#${x.firstSRank ?? "-"})`).join("  ")}`);
  console.log("");
}

const out = `/tmp/ai-top5-diagnose-${Date.now()}.json`;
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.error(`raw saved: ${out} (NOT committed)`);
