// b36-restage.mjs — b36 阶段①: nogold@20 案集新窗复核(二进制同参重跑)
// 目的: b34win 采集于前日, 上游换血(churn)可能已翻案。逐案重跑分三类:
//   RESOLVED@1   — 新窗 hit@1(churn 翻正, 退出探针)
//   MOVED@k      — 证据出现但在 2-20 位(召回已恢复, 排序层问题, 退出探针记档)
//   STILL-NOGOLD — 新窗仍 top-20 零证据(进阶段②逐引擎探针)
// 环境: 外层 shell 须先 export SC_RERANK=1 + 三件套路径(与 b34win 采集同组), 本脚本补
//       SC_NO_CACHE=1 + 独立 SC_DATA_DIR(冷目录, 等价窗口采集条件)。
// 输出: /tmp/eval-rerank/b36-restage.jsonl (断点续跑: done set 按 q 去重)
// 用法: node scripts/b36-restage.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import url from "node:url";

const DIR = url.fileURLToPath(new URL("./", import.meta.url));
const CASES = DIR + "b36-legprobe-cases.json";
const OUT = "/tmp/eval-rerank/b36-restage.jsonl";
const BIN = "/home/z/my-project/search-tool-rnd/go-port/search-core-go";
const DATA_DIR = "/tmp/eval-rerank-data-b36";
fs.mkdirSync(DATA_DIR, { recursive: true });

const STOP = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "season", "seasons", "episode", "episodes", "the", "and", "was", "were", "has", "have", "had"]);
function matchEvidence(hay, answers) {
  for (const a of answers) {
    const al = a.toLowerCase();
    if (al.length > 1 && hay.includes(al)) return { by: "verbatim", ans: a };
  }
  for (const a of answers) {
    const toks = a.toLowerCase().split(/[^a-z0-9]+/).filter(t => t && ((t.length >= 4 && !STOP.has(t)) || /^\d+$/.test(t)));
    if (toks.length === 0) continue;
    if (toks.every(t => hay.includes(t))) return { by: "tokenAND", ans: toks.join("+") };
  }
  return null;
}

const cases = JSON.parse(fs.readFileSync(CASES, "utf8"));
const done = new Set();
if (fs.existsSync(OUT)) {
  for (const line of fs.readFileSync(OUT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).q); } catch { /* 半行 */ }
  }
}
const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* busy */ } };

console.log(`== b36 阶段① 复核: ${cases.length} 案 (已完成 ${done.size} 跳过) ==`);
let nRun = 0;
for (const c of cases) {
  if (done.has(c.q)) continue;
  const t0 = Date.now();
  const p = spawnSync(BIN, ["search", c.q, "--json", "true", "--topn", "20", "--timeout", "20000"], {
    timeout: 120_000, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, SC_DATA_DIR: DATA_DIR, SC_NO_CACHE: "1" },
  });
  const wallMs = Date.now() - t0;
  let out = null;
  try { out = JSON.parse(p.stdout); } catch { /* stderr 落 row */ }
  const row = { dataset: c.dataset, q: c.q, answers: c.answers, wallMs };
  if (!out || !Array.isArray(out.refs)) {
    row.err = (p.stderr || p.stdout || "no json").slice(0, 200);
    row.refs = [];
    row.cls = "ERR";
  } else {
    row.refs = out.refs.map((r, i) => ({
      rank: i + 1, title: r.title || "", snippet: r.snippet || "", url: r.url,
      score: r.score, engines: r.engines,
    }));
    const hays = row.refs.map(r => `${r.title}\n${r.snippet}`.toLowerCase());
    let firstHit = 0, m = null;
    for (let i = 0; i < hays.length; i++) {
      const mm = matchEvidence(hays[i], c.answers);
      if (mm) { firstHit = i + 1; m = mm; break; }
    }
    row.hitRank = firstHit || null;
    row.matchedBy = m ? m.by : null;
    row.matchedAns = m ? m.ans : null;
    row.cls = firstHit === 1 ? "RESOLVED@1" : firstHit >= 2 ? `MOVED@${firstHit}` : "STILL-NOGOLD";
  }
  fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
  nRun++;
  console.log(`${(row.cls || "ERR").padEnd(12)} ${String(row.wallMs).padStart(5)}ms ${c.q.slice(0, 56)}`);
  sleep(700);
}
// 汇总(含历史行)
const all = fs.readFileSync(OUT, "utf8").trim().split("\n").map(JSON.parse);
const tally = {};
for (const r of all) tally[r.cls] = (tally[r.cls] || 0) + 1;
console.log(`\n复核完成: 本次跑 ${nRun}, 总 ${all.length}`);
console.log(Object.entries(tally).map(([k, v]) => `${k}=${v}`).join("  "));
