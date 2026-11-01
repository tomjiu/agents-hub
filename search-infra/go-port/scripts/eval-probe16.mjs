// eval-probe16.mjs — 批 16 泛化探针评测执行器 (72 题, 题库外新题)
// 用法: node scripts/eval-probe16.mjs [--part 1..4]
//   - 与 eval-domain.mjs 同构, 差异: 题库换 probe16 + SC_NO_CACHE=1(b15 教训:
//     SC_DATA_DIR 缓存固化会造成假阴性, 评测应永久绕缓存) + 独立落盘 /tmp/eval-probe16
// 产出行: {q, domain, expect, hit, hitWord, nRefs, uniqDom, top1:{title,url}, refs, enginesUsed...}
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CASES } from "./eval-probe16-cases.mjs";

const BIN = "/home/z/my-project/search-tool-rnd/go-port/search-core-go";
const DATA_DIR = "/tmp/eval-probe16-data";
const OUT = "/tmp/eval-probe16/results.jsonl";
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

console.log(`== probe16 part ${PART}/${PARTS}: ${slice.length} 题 (已完成 ${done.size} 跳过) ==`);
let nHit = 0, nRun = 0;

for (const c of slice) {
  if (done.has(c.q)) { console.log(`SKIP [${c.domain}] ${c.q}`); continue; }
  const t0 = Date.now();
  const p = spawnSync(BIN, ["search", c.q, "--json", "true", "--topn", "10", "--timeout", "20000"], {
    timeout: 120_000, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, SC_DATA_DIR: DATA_DIR, SC_NO_CACHE: "1" },
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
    row.top1 = refs[0] ? { title: (refs[0].title || "").slice(0, 120), url: refs[0].url } : null;
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
console.log(`\nprobe16 part ${PART} done: 本段 ${nHit}/${nRun} hit, 累计 ${[...done].length + nRun}/${CASES.length}`);
