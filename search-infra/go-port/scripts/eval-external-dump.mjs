// eval-external-dump.mjs — 重排实验取数: 全量 refs 落盘(与 eval-external.mjs 同口径抽样)
// 区别: ① topn=20 (重排池深度余量, 顺带测 gold 落在 11-20 的比例)
//       ② 每题存完整 refs[](rank/title/snippet/url/score/engines/authority), 供离线重放重排变体
// 输出: /tmp/eval-rerank/{ds}-dump.jsonl
// 用法: node scripts/eval-external-dump.mjs [--dataset nq|triviaqa] [--sample 100] [--part 1..4]
// 分段: 环境会清理后台进程, 仿 eval-external.mjs 按 part 前台分段跑, done set(q 去重)断点续跑
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BIN = "/home/z/my-project/search-tool-rnd/go-port/search-core-go";
const DATA_DIR = "/tmp/eval-rerank-data";
const DATASETS = {
  nq: "/tmp/nq-open-dev.jsonl",
  triviaqa: "/tmp/triviaqa-dev.jsonl",
};

const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? parseInt(process.argv[i + 1], 10) : d; };
const argStr = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const DS = argStr("--dataset", "nq");
const SAMPLE = argOf("--sample", 100);
const PARTS = 4;
const PART = argOf("--part", 0); // 0=全量一次跑(前台短跑可用), 1..4=分段
if (!DATASETS[DS]) { console.error(`--dataset 须在 ${Object.keys(DATASETS).join("|")}`); process.exit(1); }

const OUT = `/tmp/eval-rerank/${DS}-dump.jsonl`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const rows = fs.readFileSync(DATASETS[DS], "utf8").trim().split("\n").map(JSON.parse)
  .map(r => ({ q: r.question, answers: r.answer }))
  .sort((a, b) => (a.q < b.q ? -1 : a.q > b.q ? 1 : 0)); // 稳定序, 与 eval-external 一致
let sampled = rows.filter((r, i) => i % Math.ceil(rows.length / SAMPLE) === 0).slice(0, SAMPLE);
if (PART >= 1) sampled = sampled.filter((_, i) => i % PARTS === PART - 1);

const done = new Set();
if (fs.existsSync(OUT)) {
  for (const line of fs.readFileSync(OUT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).q); } catch { /* 半行 */ }
  }
}

// --- 匹配器(与 eval-external.mjs 逐字一致) ---
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

const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* busy */ } };

console.log(`== dump ${DS}${PART ? ` part ${PART}/${PARTS}` : ""}: ${sampled.length} 题 (sample=${SAMPLE}, 已完成 ${done.size} 跳过) ==`);
let nRun = 0;
for (const c of sampled) {
  if (done.has(c.q)) continue;
  const t0 = Date.now();
  const p = spawnSync(BIN, ["search", c.q, "--json", "true", "--topn", "20", "--timeout", "20000"], {
    timeout: 120_000, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, SC_DATA_DIR: DATA_DIR, SC_NO_CACHE: "1" },
  });
  const wallMs = Date.now() - t0;
  let out = null;
  try { out = JSON.parse(p.stdout); } catch { /* stderr 落 row */ }

  const row = { q: c.q, answers: c.answers, wallMs };
  if (!out || !Array.isArray(out.refs)) {
    row.err = (p.stderr || p.stdout || "no json").slice(0, 200);
    row.refs = [];
  } else {
    row.refs = out.refs.map((r, i) => ({
      // b30 修复: rank 按数组序重编号 — 数组序=交付序=eval 口径。b27 重排上线后二进制输出的
      // rank 字段残留融合层旧值(1,2,5,4,3...), 直接信任会把 gold@1 算回重排前的序(本批实弹抓获,
      // gold@1 假性回落 53.1%→36.7%)。rank 字段语义自 b30 起统一为交付序。
      rank: i + 1, title: r.title || "", snippet: r.snippet || "", url: r.url,
      score: r.score, engines: r.engines, authority: r.authority || "",
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
  }
  fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
  nRun++;
  const mark = row.hitRank ? `HIT@${row.hitRank}` : "MISS";
  console.log(`${mark.padEnd(7)} ${String(row.wallMs).padStart(5)}ms ${c.q.slice(0, 58)}`);
  sleep(700);
}
console.log(`\n${DS} dump done: ${nRun} 题 -> ${OUT}`);
