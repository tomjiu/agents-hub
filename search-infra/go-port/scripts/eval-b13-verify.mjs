// eval-b13-verify.mjs — 批 13 P0 修复验收: 8 真空洞域 16 题复测
// 题面与 expect 完全复用 eval-domain-cases.mjs(口径纵向可比), 只跑 domain ∈ 8 域。
// 结果独立落盘 /tmp/eval-b13/verify.jsonl(不污染基线 results.jsonl); 断点续跑同款。
// 验收线: HIT ≥ 10/16 (修复前 0/16)。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CASES } from "./eval-domain-cases.mjs";

const BIN = "/home/z/my-project/search-tool-rnd/go-port/search-core-go";
const DATA_DIR = "/tmp/eval-b13-data";
const OUT = "/tmp/eval-b13/verify.jsonl";
const DOMAINS = ["tv", "games", "manga", "sport", "drinks", "space", "books", "geo"];
const GATE = 10;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const done = new Map();
if (fs.existsSync(OUT)) {
  for (const line of fs.readFileSync(OUT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); done.set(r.q, r); } catch { /* 尾部半行 */ }
  }
}

const slice = CASES.filter(c => DOMAINS.includes(c.domain));
const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* busy */ } };

console.log(`== b13 verify: ${slice.length} 题 × 8 域 (已完成 ${done.size} 跳过), 验收线 ${GATE}/16 ==`);
let nHit = 0, nRun = 0;

for (const c of slice) {
  if (done.has(c.q)) {
    const r = done.get(c.q);
    nHit += r.hit ? 1 : 0; nRun++;
    console.log(`${r.hit ? "HIT " : "MISS"} [缓存] [${c.domain}] ${c.q} → ${r.hitWord ?? "—"} (refs=${r.nRefs})`);
    continue;
  }
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
    row.uniqDom = new Set(refs.map(r => { try { return new URL(r.url).hostname; } catch { return "?"; } })).size;
    row.refEngines = refs.map(r => (r.engines || []).join("+")).filter(e => e.includes("tvmaze") || e.includes("steam") || e.includes("mangadex") || e.includes("thesportsdb") || e.includes("thecocktaildb") || e.includes("thespacedevs") || e.includes("standardebooks") || e.includes("nominatim"));
    row.enginesFailed = out.enginesFailed || [];
    row.wallMs = wallMs;
  }
  fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
  nRun++; if (row.hit) nHit++;
  const mark = row.hit ? "HIT " : "MISS";
  console.log(`${mark} [${c.domain}] ${c.q} → ${row.hitWord ?? "—"} (refs=${row.nRefs}, b13lane=${row.refEngines?.length ?? 0}, ${wallMs}ms)`);
  sleep(1200);
}
console.log(`\n== b13 verify done: ${nHit}/${nRun} (基线 0/16, 验收线 ${GATE}/16) → ${nHit >= GATE ? "PASS ✓" : "FAIL ✗"} ==`);
process.exit(nHit >= GATE ? 0 : 2);
