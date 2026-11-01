// fetch-nq.mjs — 从 HF datasets-server API 轻量拉取 NQ-open validation (google-research-datasets/nq_open)
// 批 17 首次接入时是临时拉取未入仓, 本文件补齐(与 fetch-triviaqa.mjs 同构)。
// 输出: /tmp/nq-open-dev.jsonl — {question, answer:[...]} 与 eval-external.mjs 加载格式一致
import fs from "node:fs";

const OUT = "/tmp/nq-open-dev.jsonl";
const TARGET = 3610; // NQ-open validation 全量
const PAGE = 100;
const API = (off) =>
  `https://datasets-server.huggingface.co/rows?dataset=google-research-datasets%2Fnq_open&config=nq_open&split=validation&offset=${off}&length=${PAGE}`;

const rows = [];
for (let off = 0; off < TARGET; off += PAGE) {
  const res = await fetch(API(off), { headers: { "User-Agent": "sc-eval/1.0" } });
  if (!res.ok) { console.error(`fetch ${off} fail: ${res.status}`); process.exit(1); }
  const j = await res.json();
  if (!j.rows || !j.rows.length) { console.error(`no rows at ${off}`); break; }
  for (const r of j.rows) {
    const q = r.row.question, answers = r.row.answer || [];
    if (q && answers.length) rows.push({ question: q, answer: answers });
  }
  if (off % 500 === 0) console.log(`offset ${off}: total ${rows.length}`);
}
fs.writeFileSync(OUT, rows.map(r => JSON.stringify(r)).join("\n") + "\n");
console.log(`== nq-open: ${rows.length} rows -> ${OUT}`);
