// eval-external.mjs — 批 17/18 外部基准评测: 现成开放域 QA 数据集直跑搜索内核
// 数据集(b18 起参数化):
//   nq       — NQ-open dev (Google, 3610 题, /tmp/nq-open-dev.jsonl)
//   triviaqa — TriviaQA rc.nocontext validation 抽样 (/tmp/triviaqa-dev.jsonl, fetch-triviaqa.mjs 产出)
// 口径: 与自建评测同构 — 答案证据出现在 top-k title+snippet 即 HIT, 但多档记录:
//   hit@1 / hit@3 / hit@10 + matchedBy(答案串/答案token集), 归因留料
// 匹配规则(宽松度两档, 防 "one/how many" 类高频词虚中):
//   verbatim: 任一答案串完整出现(lower 子串)
//   tokenAND: 最短答案串的分词中, 全部长度>=4 或纯数字的 token 都出现
// 用法: node scripts/eval-external.mjs [--part 1..4] [--sample 200] [--dataset nq|triviaqa]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PARTS = 4;

const argOf = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? parseInt(process.argv[i + 1], 10) : d; };
const argStr = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
// --bin: 显式二进制路径 (b27 起 A/B 同一二进制切 SC_RERANK 环境变量, 防旧构建误用)
const BIN = argStr("--bin", "/home/z/my-project/search-tool-rnd/go-port/search-core-go");
const DATA_DIR = "/tmp/eval-external-data";
const DATASETS = {
  nq: "/tmp/nq-open-dev.jsonl",
  triviaqa: "/tmp/triviaqa-dev.jsonl",
};
const PART = argOf("--part", 1);
const SAMPLE = argOf("--sample", 200);
const DS = argStr("--dataset", "nq");
// --out: 独立产物路径(b25 同题对齐实验: sample=100 复现 dump 题集, 避免与标准 eval 的 done set 互串)
const OUT = argStr("--out", `/tmp/eval-external/${DS}.jsonl`);
if (!DATASETS[DS]) { console.error(`--dataset 须在 ${Object.keys(DATASETS).join("|")}`); process.exit(1); }
if (!(PART >= 1 && PART <= PARTS)) { console.error(`--part 须在 1..${PARTS}`); process.exit(1); }

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

// --- 数据集加载 + 定种子抽样(稳定序等距, 可复现) ---
const rows = fs.readFileSync(DATASETS[DS], "utf8").trim().split("\n").map(JSON.parse)
  .map(r => ({ q: r.question, answers: r.answer }))
  .sort((a, b) => (a.q < b.q ? -1 : a.q > b.q ? 1 : 0)); // 稳定序
const sampled = rows.filter((r, i) => i % Math.ceil(rows.length / SAMPLE) === 0).slice(0, SAMPLE);
const slice = sampled.filter((_, i) => i % PARTS === PART - 1);

// --- 匹配器 ---
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

const done = new Set();
if (fs.existsSync(OUT)) {
  for (const line of fs.readFileSync(OUT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).q); } catch { /* 半行 */ }
  }
}
const host = (u) => { try { return new URL(u).hostname; } catch { return "?"; } };
const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* busy */ } };

console.log(`== eval-external ${DS} part ${PART}/${PARTS}: ${slice.length} 题 (sample=${SAMPLE}, 已完成 ${done.size} 跳过) ==`);
let nRun = 0, h1 = 0, h3 = 0, h10 = 0;

for (const c of slice) {
  if (done.has(c.q)) { continue; }
  const t0 = Date.now();
  const p = spawnSync(BIN, ["search", c.q, "--json", "true", "--topn", "10", "--timeout", "20000"], {
    timeout: 120_000, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, SC_DATA_DIR: DATA_DIR, SC_NO_CACHE: "1" },
  });
  const wallMs = Date.now() - t0;
  let out = null;
  try { out = JSON.parse(p.stdout); } catch { /* stderr 落 row */ }

  const row = { q: c.q, answers: c.answers };
  if (!out || !Array.isArray(out.refs)) {
    row.err = (p.stderr || p.stdout || "no json").slice(0, 200);
    row.nRefs = 0; row.hit10 = false;
  } else {
    const refs = out.refs;
    let firstHit = 0, m = null;
    const hays = refs.map(r => `${r.title}\n${r.snippet}`.toLowerCase());
    for (let i = 0; i < hays.length; i++) {
      const mm = matchEvidence(hays[i], c.answers);
      if (mm) { firstHit = i + 1; m = mm; break; }
    }
    row.hit10 = firstHit > 0;
    row.hitRank = firstHit || null;
    row.matchedBy = m ? m.by : null;
    row.matchedAns = m ? m.ans : null;
    row.nRefs = refs.length;
    row.uniqDom = new Set(refs.map(r => host(r.url))).size;
    row.top1 = refs[0] ? { title: (refs[0].title || "").slice(0, 120), url: refs[0].url } : null;
    row.enginesUsed = out.enginesUsed || [];
  }
  fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
  nRun++;
  if (row.hitRank === 1) h1++;
  if (row.hitRank && row.hitRank <= 3) h3++;
  if (row.hit10) h10++;
  const mark = row.hit10 ? `HIT@${row.hitRank}` : "MISS";
  console.log(`${mark.padEnd(6)} ${c.q.slice(0, 60)} → ${row.matchedAns ?? "—"}`);
  sleep(900);
}
console.log(`\n${DS} part ${PART} done: hit@1=${h1}/${nRun} hit@3=${h3}/${nRun} hit@10=${h10}/${nRun}`);
