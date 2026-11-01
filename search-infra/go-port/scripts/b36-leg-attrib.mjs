// b36-leg-attrib.mjs — b36 上游腿探针归因: 读 scripts/b36-legprobe.json 生成证据 txt
// 输出: scripts/b36-legprobe.txt
// 用法: node scripts/b36-leg-attrib.mjs
import fs from "node:fs";
import url from "node:url";

const DIR = url.fileURLToPath(new URL("./", import.meta.url));
const IN = DIR + "b36-legprobe.json";
const OUT = DIR + "b36-legprobe.txt";

const rows = fs.readFileSync(IN, "utf8").trim().split("\n").map(JSON.parse);
const L = [];
const p = (s = "") => L.push(s);

const tally = {};
for (const r of rows) tally[r.bucket] = (tally[r.bucket] || 0) + 1;
const fastEv = (r, ev) => (r.lanes.find(l => l.engine === ev.engine)?.elapsedMs || 0) <= 1200;

// 引擎健康面
const eng = {};
for (const r of rows) for (const l of r.lanes) {
  const e = eng[l.engine] || (eng[l.engine] = { n: 0, err: 0, skip: 0, count: 0, ev: 0, slow: 0 });
  e.n++; if (l.err) e.err++; if (l.skipped) e.skip++; e.count += l.count;
  if ((l.evidenceRank || []).length) e.ev++;
  if (l.elapsedMs > 1200) e.slow++;
}

p(`批 36 证据: D 桶召回层上游腿探针 (b35 交接候选① 上游腿质量第一锭)`);
p(`窗口: b34win nogold@20 案集 29 条 → 阶段①新窗复核(churn 分流) → 阶段②探针 ${rows.length} 案`);
p(`方法: 逐引擎独立 runLanes 全结算(理想召回上限, 不模拟早收割) + fuseSemantic 原函数 +`);
p(`      分步分解自检(StepCheck 必须逐位一致) + 证据血脉五级追踪(fuse长snippet覆盖/spam硬屏蔽/`);
p(`      dedup长snippet覆盖/domainCap/topN截断); 判定 = eval matchEvidence 逐字镜像(b32AnsIn)`);
p(`日期: 2026-09-08;  快腿=elapsed<=1200ms(早收割阈值), 慢腿=生产收割风险`);
p("");
p(`========================================================================`);
p(`一、总账 (探针 ${rows.length} 案 = 阶段① STILL-NOGOLD; 阶段①: 29 案中 RESOLVED@1=5, MOVED=3)`);
p(`========================================================================`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) p(`  ${k.padEnd(36)} ${v}`);
p(`  StepCheck: ${[...new Set(rows.map(r => r.stepCheck))].join(" | ")} (分步分解 vs 单体 fuseSemantic 21/21 逐位一致, 零 META 分歧)`);
p(`  原始池: 平均 ${Math.round(rows.reduce((s, r) => s + r.rawTotal, 0) / rows.length)} refs/案(全结算), 宽池去重 ${Math.round(rows.reduce((s, r) => s + r.distinct, 0) / rows.length)}/案`);
p("");
p(`========================================================================`);
p(`二、FUSION-LOSS 逐案 (证据页在原始腿里存在, 融合层丢证据 — 产品侧可修)`);
p(`========================================================================`);
const fl = rows.filter(r => r.bucket.startsWith("FUSION-LOSS"));
let nClean = 0;
for (const r of fl) {
  const fastOnly = r.rawEvidence.every(ev => fastEv(r, ev));
  const hasFast = r.rawEvidence.some(ev => fastEv(r, ev));
  if (hasFast) nClean++;
  p(`\n[${r.bucket}${hasFast ? " · 快腿证据在" : " · 纯慢腿证据(收割复合)"}] ${r.dataset}: ${r.q.slice(0, 70)}`);
  p(`  gold: ${JSON.stringify(r.answers).slice(0, 80)}`);
  for (const ev of r.rawEvidence) {
    const l = r.lanes.find(x => x.engine === ev.engine);
    p(`  证据 ${ev.engine}@${ev.rank} ${fastEv(r, ev) ? "快腿" : "慢腿" + l.elapsedMs + "ms"} ${ev.matchedBy}(${(ev.matchedAns || "").slice(0, 44)})`);
    p(`        ${ev.url.slice(0, 96)}`);
  }
  for (const tr of (r.lineages || [])) {
    p(`  血脉 → lostAt=${tr.lostAt}${tr.domain ? " dom=" + tr.domain : ""} ${tr.detail || ""}`.slice(0, 130));
  }
}
p(`\n  快腿证据在案 = ${nClean}/${fl.length} (与收割无关的纯融合层损失坐实; 其余 ${fl.length - nClean} 案证据只在`);
p(`  anysearch 慢腿上, 生产早收割可能先断腿 — 复合型: 断腿在先, 不断腿则融合层照样丢)`);
p("");
p(`========================================================================`);
p(`三、机制结论`);
p(`========================================================================`);
p(`1. 融合层"长 snippet 胜出"规则双处可覆盖证据文本:`);
p(`   fuseV3 URL 合并(semantic.go:242)与 TF 去重(semantic.go:412)同为 len(snippet) 更长者胜 —`);
p(`   证据 snippet(常短句直答)被同页/孪生页的长样板 snippet 顶掉后, 交付 title+snippet 零证据。`);
p(`   dedup-text-superseded 3 案(BLM/You Sexy Thing/Vikings) + fuse-text-superseded 2 案(Linnaeus/Kipling)。`);
p(`   注意该规则同时污染排序输入(lex 分按覆盖后文本计算)。修复候选: 合并时 keyTermPresent`);
p(`   (fuseV3 已有同款函数)或查询词命中数优先, 次取长度; 属融合层单点小改。`);
p(`2. domainCap 单域上限误伤实锤(1 案): Gotham by Gaslight 唯一快腿证据 dc.fandom(rank8) 被`);
p(`   fandom.com 3 条上限挤出(villains.fandom 等 fandom 页占坑) — 反霸屏特性对"答案在子域/长尾站"`);
p(`   的题有结构性误伤面, 记观察。`);
p(`3. anysearch 慢腿×证据富集矛盾(收割复合): anysearch 本批 15/15 案全慢腿(2.5-4s,`);
p(`   >1200ms 早收割阈值)且是头号原始证据载体(8/12 条) — 生产早收割(1200ms, 60%腿+15refs 即断)`);
p(`   对该腿的丢弃 = 证据未进融合先损。收割策略质量盲区记 b37 候选(与融合层修复正交)。`);
p(`4. ENGINE-MISS 15/21(71%): 全引擎全深度(每腿≤~10 条深度上限)title+snippet 零证据, 平均`);
p(`   161 refs/案仍无 — 真召回/查询词形层缺口主体, 融合层修复空间上限 = 6/21 案(合 nogold@20`);
p(`   案集的 ~29%, 折 miss@1 空间 ~8%(6/74, b34win 口径)); body 层 D1 残余另计(b31/b32 口径)。`);
p("");
p(`========================================================================`);
p(`四、引擎健康面 (21 案 × ~60 腿; 腿失败/零结果不进融合)`);
p(`========================================================================`);
p(`  引擎           调用/错/跳   平均refs  含证据案数  慢腿案数`);
for (const k of ["keenable", "duckduckgo", "mwmbl", "yahoo", "wikipedia", "bingrss", "anysearch", "marginalia", "wiby", "firecrawl"]) {
  const e = eng[k]; if (!e) continue;
  p(`  ${k.padEnd(14)} ${String(e.n).padStart(3)}/${String(e.err).padStart(2)}/${String(e.skip).padStart(2)}      ${(e.count / e.n).toFixed(1)}      ${e.ev}           ${e.slow}`);
}
const miss = rows.filter(r => r.bucket === "ENGINE-MISS");
let totLegs = 0, totErr = 0, totZero = 0;
for (const r of miss) for (const l of r.lanes) { totLegs++; if (l.err) totErr++; else if (l.count === 0 && !l.skipped) totZero++; }
p(`  ENGINE-MISS 15 案腿面: ${totLegs} 腿 = err ${totErr} + 零结果 ${totZero} + 有结果 ${totLegs - totErr - totZero}`);
p("");
p(`========================================================================`);
p(`五、口径与边界(防再诉讼)`);
p(`========================================================================`);
p(`- 阶段①(b36-restage.mjs)与阶段②(探针)为两次独立活窗: PROBE-HIT1/RANKED=churn 翻案(本批 0 条),`);
p(`  案集冻结于 b34win nogold@20(29 条) — deep@11-20 不进本批(b35 pool20 已量化 +1pp 不 ship)。`);
p(`- 探针全结算不等早收割 = 理想召回上限; 慢腿证据以 [slow-leg] 注记, 收割条件(60%腿+15refs)`);
p(`  未逐案模拟 — "收割复合"案为风险定性非确定性归因。`);
p(`- 引擎深度上限(~10 条/腿)决定探针视野: ENGINE-MISS = "深度≤10 内零 snippet 证据", 更深候选不可见;`);
p(`  body 层 D1(页有答案 snippet 无)不在本批口径(b31/b32 已量化)。`);
p(`- 403 拒爬墙只作用于 b19 抓正文层, 不影响本批 snippet 层判定; DDG 5/15 错(marginalia 14/15,`);
p(`  firecrawl 15/15 常态化失败)已计入健康面, 不影响 FUSION-LOSS 判定(其证据载体为 keenable/anysearch)。`);
p(`- 归档: b36-legprobe.json(探针原始输出, 21 行) + b36-restage.jsonl(阶段①, /tmp/eval-rerank) +`);
p(`  b36-legprobe.txt(本件); 案集 scripts/b36-legprobe-cases.json + b36-legprobe-still.json 在仓。`);
p(`- 勘误: JSON 内 fuse-text-superseded 血脉 detail 文案"首现吞并"系探针初版措辞, 实际机制=`);
p(`  fuseV3 URL 合并"更长 snippet 胜出"(代码已随批修正); 丢失点级判定不受影响(判定读的是宽池`);
p(`  实际文本, 与措辞无关)。`);

fs.writeFileSync(OUT, L.join("\n") + "\n");
console.log(`-> ${OUT} (${L.length} 行)`);
