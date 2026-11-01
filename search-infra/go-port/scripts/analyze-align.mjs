// analyze-align.mjs — 批 25: dump 层(上游 refs, 注入前) vs eval 层(完整链路, 注入后) 同题对齐归因
// 数据: 同一题集(sample=100 步长) 的 {ds}-dump.jsonl(hitRank@top20, 引擎层 snippet) 与
//       align100 eval 产物(hitRank@top10, 注入后最终 snippet), 按 q 精确对齐。
// 归因交叉表(对齐可行动杠杆):
//   dump@1    -> eval@1   注入层无损(应 100%)
//   dump@1    -> eval miss 异常降级(排序层 b23+ 改动回退面哨兵)
//   dump@2-10 -> eval@1   注入/排序层净转化(注入层已吃掉的存量)
//   dump@2-10 -> eval miss 注入层残留(批 26 候选精确规模, 渲染人工裁决)
//   dump@11-20-> eval hit  池深题被注入/窗口救回
//   dump 无gold-> eval@1   注入层神奇救援(正文有答案引擎snippet无)
//   dump 无gold-> eval miss 纯检索缺口(不可动存量, 方法论下限)
// 注意: dump 与 align eval 是两次独立跑(隔 ~30-60min), b24 已证腿结构小时级剧变,
//       交叉差值含窗口漂移成分, 裁决时以结构性大类为准、个例为辅。
import fs from "node:fs";

const argStr = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const PAIRS = [
  { label: "NQ-open", dump: "/tmp/eval-rerank/nq-dump.jsonl", evalF: "/tmp/eval-external/nq-align100.jsonl" },
  { label: "TriviaQA", dump: "/tmp/eval-rerank/triviaqa-dump.jsonl", evalF: "/tmp/eval-external/tqa-align100.jsonl" },
];

let review = "";
function reviewLine(s) { review += s + "\n"; }

for (const { label, dump, evalF } of PAIRS) {
  const dRows = new Map(fs.readFileSync(dump, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse).map(r => [r.q, r]));
  const eRows = new Map(fs.readFileSync(evalF, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse).map(r => [r.q, r]));
  const cells = { d1e1: [], d1h2: [], d1miss: [], d210e1: [], d210h2: [], d210miss: [], d1120e: [], d1120miss: [], d0e1: [], d0miss: [] };
  for (const [q, d] of dRows) {
    const e = eRows.get(q);
    if (!e) continue;
    const dr = d.hitRank || 0; // 0=无, 1..20
    const er = e.hitRank || 0; // 0=无, 1..10
    if (dr === 1) (er === 1 ? cells.d1e1 : er >= 2 ? cells.d1h2 : cells.d1miss).push({ q, d, e });
    else if (dr >= 2 && dr <= 10) (er === 1 ? cells.d210e1 : er >= 2 ? cells.d210h2 : cells.d210miss).push({ q, d, e });
    else if (dr >= 11) (er > 0 ? cells.d1120e : cells.d1120miss).push({ q, d, e });
    else (er === 1 ? cells.d0e1 : cells.d0miss).push({ q, d, e });
  }
  const n = Object.values(cells).reduce((s, a) => s + a.length, 0);
  console.log(`\n==== ${label}: 对齐 ${n} 题 ====
dump@1 -> eval@1          ${String(cells.d1e1.length).padStart(3)}   (注入层无损)
dump@1 -> eval hit@2+     ${String(cells.d1h2.length).padStart(3)}   (窗口漂移换页降位, 非产品回退)
dump@1 -> eval miss       ${String(cells.d1miss.length).padStart(3)}   (真降级: 产品bug哨兵)
dump@2-10 -> eval@1       ${String(cells.d210e1.length).padStart(3)}   (注入/排序净转化到 rank1)
dump@2-10 -> eval hit@2+  ${String(cells.d210h2.length).padStart(3)}   (位次保持: 注入不改排序, 排序层存量)
dump@2-10 -> eval miss    ${String(cells.d210miss.length).padStart(3)}   (真残留: 批26候选)
dump@11-20 -> eval hit    ${String(cells.d1120e.length).padStart(3)}   / miss ${cells.d1120miss.length}   (池深)
dump 无gold -> eval@1     ${String(cells.d0e1.length).padStart(3)}   (神奇救援: 正文有snippet无)
dump 无gold -> eval miss  ${String(cells.d0miss.length).padStart(3)}   (纯检索缺口: 不可动存量)`);

  const render = (tag, list, note) => {
    reviewLine(`\n######## ${label} — ${tag} ${list.length} 条 ${note} ########`);
    for (const { q, d, e } of list) {
      const g = d.hitRank ? d.refs[d.hitRank - 1] : null;
      reviewLine(`\n[${tag}] Q: ${q}\n  dump: gold@${d.hitRank || "-"} | eval: ${e.hitRank ? `hit@${e.hitRank}` : "miss"}${e.matchedAns ? ` (${e.matchedAns})` : ""}`);
      reviewLine(`  rank1(dump): ${d.refs[0] ? d.refs[0].title : "-"}\n    snip: ${d.refs[0] ? d.refs[0].snippet.slice(0, 180).replace(/\n/g, " ") : "-"}`);
      if (g) reviewLine(`  gold页(dump): ${g.title}\n    snip: ${g.snippet.slice(0, 180).replace(/\n/g, " ")}`);
      if (e.top1) reviewLine(`  rank1(eval): ${e.top1.title}`);
    }
  };
  render("真残留", cells.d210miss, "(dump@2-10 但 eval 完全 miss)");
  render("位次保持", cells.d210h2, "(dump@2-10 且 eval hit@2+: gold 位次稳定, 排序层存量)");
  render("漂移降位", cells.d1h2, "(dump@1 但 eval hit@2+: 窗口换页, 非产品回退)");
  render("真降级", cells.d1miss, "(dump@1 但 eval miss: 产品bug哨兵)");
  render("缺口", cells.d0miss, "(双miss: 纯检索缺口)");
  render("神奇", cells.d0e1, "(dump 无gold 但 eval hit@1)");
}

fs.writeFileSync("/tmp/eval-rerank/align-review-b25.txt", review);
console.log(`\n复核文件: /tmp/eval-rerank/align-review-b25.txt`);
