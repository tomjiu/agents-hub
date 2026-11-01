// b36-derive-cases.mjs — 从 b34win dump 推导 nogold@20 案集(D 桶召回缺口, b36 上游腿探针输入)
// 定义与 analyze-miss-structure.mjs 一致: miss@1 且 hitRank===null(top-20 内零证据)。
// deep 子类(gold@11-20)不进本批 — b35 pool20 已量化(+1pp 不 ship), 与召回探针无重叠。
// 输出: scripts/b36-legprobe-cases.json (dataset/q/answers/窗口 rank1 摘要)
// 用法: node scripts/b36-derive-cases.mjs
import fs from "node:fs";

const WIN = { nq: "/tmp/eval-rerank/nq-dump-b34win.jsonl", triviaqa: "/tmp/eval-rerank/triviaqa-dump-b34win.jsonl" };
const OUT = new URL("./b36-legprobe-cases.json", import.meta.url).pathname;

const cases = [];
for (const [ds, path] of Object.entries(WIN)) {
  if (!fs.existsSync(path)) { console.error(`缺窗口 dump: ${path}`); process.exit(1); }
  const rows = fs.readFileSync(path, "utf8").trim().split("\n").map(JSON.parse);
  const hit1 = rows.filter(r => r.hitRank === 1).length;
  const deep = rows.filter(r => r.hitRank >= 11).length; // deep 子类: 证据在 11-20(b35 pool20 已量化)
  const nogold = rows.filter(r => !r.hitRank); // dump 的 hitRank=null 即 top-20 零证据(b34win topn=20)
  const mid = rows.filter(r => r.hitRank >= 2 && r.hitRank <= 10).length;
  console.log(`${ds}: rows=${rows.length} hit@1=${hit1} 证据@2-10=${mid} deep@11-20=${deep} nogold@20=${nogold.length} (miss@1=${rows.length - hit1}, D桶(nogold+deep)占比=${((nogold.length + deep) / (rows.length - hit1) * 100).toFixed(1)}%)`);
  for (const r of nogold) {
    cases.push({
      dataset: ds, q: r.q, answers: r.answers,
      winRank1: r.refs?.[0] ? { url: r.refs[0].url, title: (r.refs[0].title || "").slice(0, 120) } : null,
      winWallMs: r.wallMs ?? null,
    });
  }
}
fs.writeFileSync(OUT, JSON.stringify(cases, null, 1));
console.log(`\ncases=${cases.length} -> ${OUT}`);
