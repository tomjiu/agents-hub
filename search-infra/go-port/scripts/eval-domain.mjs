// eval-domain.mjs — 全领域评测执行器 (36 域 × 80 题)
// 用法: node scripts/eval-domain.mjs [--part 1..4]
//   - 分 4 段轮转执行(单段 ~20 题, 规避单命令超时); 结果逐题追加 /tmp/eval-domain/results.jsonl
//   - 断点续跑: 已在结果文件中的 q 自动跳过, 重跑同段安全
//   - SC_DATA_DIR 指向干净目录(b12 批"缓存干扰复验"教训), 题与题 sleep 1.2s 护限流车道
// 产出行: {q, domain, expect, hit, hitWord, nRefs, uniqDom, refs:[{title,url,engines}],
//          enginesUsed, enginesFailed, elapsedMs, wallMs, err}
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CASES } from "./eval-domain-cases.mjs";

const BIN = "/home/z/my-project/search-tool-rnd/go-port/search-core-go";
const DATA_DIR = "/tmp/eval-domain-data";
const OUT = "/tmp/eval-domain/results.jsonl";
const PARTS = 4;

const partIdx = process.argv.indexOf("--part");
const PART = partIdx > -1 ? parseInt(process.argv[partIdx + 1], 10) : 1;
if (!(PART >= 1 && PART <= PARTS)) { console.error(`--part 须在 1..${PARTS}`); process.exit(1); }

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const done = new Set();
if (fs.existsSync(OUT)) {
  for (const line of fs.readFileSync(OUT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).q); } catch { /* 尾部半行: 忽略 */ }
  }
}

const host = (u) => { try { return new URL(u).hostname; } catch { return "?"; } };
const slice = CASES.filter((_, i) => i % PARTS === PART - 1);
const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* busy */ } };

console.log(`== eval part ${PART}/${PARTS}: ${slice.length} 题 (已完成 ${done.size} 跳过) ==`);
let nHit = 0, nRun = 0;

for (const c of slice) {
  if (done.has(c.q)) { console.log(`SKIP [${c.domain}] ${c.q}`); continue; }
  const t0 = Date.now();
  const p = spawnSync(BIN, ["search", c.q, "--json", "true", "--topn", "10", "--timeout", "20000"], {
    timeout: 120_000, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, SC_DATA_DIR: DATA_DIR },
  });
  const wallMs = Date.now() - t0;
  let out = null;
  try { out = JSON.parse(p.stdout); } catch { /* stderr 落 row */ }

  const row = { q: c.q, domain: c.domain, expect: c.expect };
  if (!out || !Array.isArray(out.refs)) {
    row.err = (p.stderr || p.stdout || "no json").slice(0, 200);
    row.nRefs = 0; row.hit = false;
  } else {
    const refs = out.refs;
    const hay = refs.map(r => `${r.title}\n${r.snippet}`).join("\n").toLowerCase();
    const hitWord = c.expect.find(e => hay.includes(e.toLowerCase())) ?? null;
    row.hit = hitWord !== null;
    row.hitWord = hitWord;
    row.nRefs = refs.length;
    row.uniqDom = new Set(refs.map(r => host(r.url))).size;
    row.refs = refs.map(r => ({ title: (r.title || "").slice(0, 120), url: r.url, engines: r.engines || [] }));
    row.enginesUsed = out.enginesUsed || [];
    row.enginesFailed = out.enginesFailed || [];
    row.elapsedMs = out.elapsedMs ?? wallMs;
    row.wallMs = wallMs;
  }
  fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
  nRun++; if (row.hit) nHit++;
  const mark = row.hit ? "HIT " : "MISS";
  console.log(`${mark} [${c.domain}] ${c.q} → ${row.hitWord ?? "—"} (refs=${row.nRefs}, ${row.enginesUsed ? row.enginesUsed.length + "lanes" : "ERR"}, ${wallMs}ms)`);
  sleep(1200);
}
console.log(`\npart ${PART} done: 本段 ${nHit}/${nRun} hit, 累计 ${[...done].length + nRun}/${CASES.length}`);
