// fetch-triviaqa.mjs — 批 18-C: 从 HF datasets-server API 轻量拉取 TriviaQA rc.nocontext validation
// 目标: 200 题问句+答案串(含 aliases), 转成与 NQ-open 同构的 {question, answer:[...]} jsonl
// 输出: /tmp/triviaqa-dev.jsonl (与 eval-external.mjs 的 NQ 加载格式一致)
import fs from "node:fs";

const OUT = "/tmp/triviaqa-dev.jsonl";
const TARGET = 200;
const PAGE = 100;
const API = (off) =>
  `https://datasets-server.huggingface.co/rows?dataset=mandarjoshi%2Ftrivia_qa&config=rc.nocontext&split=validation&offset=${off}&length=${PAGE}`;

const rows = [];
for (let off = 0; off < TARGET; off += PAGE) {
  const res = await fetch(API(off), { headers: { "User-Agent": "sc-eval/1.0" } });
  if (!res.ok) { console.error(`fetch ${off} fail: ${res.status}`); process.exit(1); }
  const j = await res.json();
  if (!j.rows || !j.rows.length) { console.error(`no rows at ${off}`); break; }
  for (const r of j.rows) {
    const q = r.row.question, a = r.row.answer || {};
    const answers = [a.value, ...(a.aliases || [])].filter(Boolean);
    if (q && answers.length) rows.push({ question: q, answer: [...new Set(answers)] });
  }
  console.log(`offset ${off}: +${j.rows.length} (total ${rows.length})`);
}
fs.writeFileSync(OUT, rows.map(r => JSON.stringify(r)).join("\n") + "\n");
console.log(`== triviaqa: ${rows.length} rows -> ${OUT}`);
