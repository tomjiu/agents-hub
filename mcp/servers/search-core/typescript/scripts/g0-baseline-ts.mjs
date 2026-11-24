// G0 基线 (issue #3 评论 G0): TS 侧同输入资源测量 — 与 Go 侧 g0_baseline_test.go 对照。
// 纪律: 本地合成输入; 公网 SERP/真实推理如实 NOT_MEASURED, 不冒充。
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { extractHtml } from "../dist/focus.js";

const out = {
  probe: "ts",
  node: process.version,
  numCPU: navigator.hardwareConcurrency || null,
  dateUTC: new Date().toISOString(),
};

function pct(xs) {
  const v = [...xs].sort((a, b) => a - b);
  return {
    p50: v[Math.floor((v.length - 1) * 0.5)],
    p95: v[Math.floor((v.length - 1) * 0.95)],
    n: v.length,
  };
}
function rssKB() {
  return Math.round(process.memoryUsage.rss() / 1024);
}
function cpuMs() {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
}
function gc() {
  if (global.gc) {
    global.gc();
    global.gc();
  }
}

// ---------- 1) 密集 HTML 提取: 1MB / 2MB ----------
for (const mb of [1, 2]) {
  const html = readFileSync(`/tmp/g0-dense-${mb}mb.html`, "utf8");
  gc();
  const rss0 = rssKB();
  const cpu0 = cpuMs();
  const times = [];
  let peakRss = rss0;
  for (let i = 0; i < 7; i++) {
    const t0 = performance.now();
    const ex = extractHtml(html);
    times.push(Math.round(performance.now() - t0));
    if (!ex.text) throw new Error(`${mb}MB: empty text`);
    peakRss = Math.max(peakRss, rssKB());
  }
  out[`dense${mb}MB`] = {
    inputBytes: html.length,
    wallMs: pct(times),
    cpuMs: Math.round(cpuMs() - cpu0),
    rssKBDelta: peakRss - rss0,
    peakRSSKB: peakRss,
  };
}

// ---------- 2) 8 并发解析 (JS 单线程 → 串行对照口径) ----------
const html1 = readFileSync("/tmp/g0-dense-1mb.html", "utf8");
gc();
const rss0 = rssKB();
const t0 = performance.now();
const walls = [];
for (let i = 0; i < 8; i++) {
  const s = performance.now();
  extractHtml(html1);
  walls.push(Math.round(performance.now() - s));
}
out.concurrent8x1MB = {
  totalWallMs: Math.round(performance.now() - t0),
  perTaskMs: pct(walls),
  rssKBDelta: rssKB() - rss0,
  note: "Node 单线程事件循环 → 8 任务为串行执行 (无并行排队), 与 Go 信号量并发口径差异如实记录",
};

// ---------- 3) 长跑漂移 (泄漏检测): 300 次 256KB ----------
const small = html1.slice(0, 256 * 1024);
gc();
const rssBefore = rssKB();
for (let i = 0; i < 300; i++) {
  extractHtml(small);
}
gc();
out.longRun300x256KB = {
  rssKBBefore: rssBefore,
  rssKBAfter: rssKB(),
  rssKBDrift: rssKB() - rssBefore,
  note: "Node heap 页归还策略与 Go 不同; rssDrift 不直接等于泄漏",
};

// ---------- 4) MCP stdio 空闲: spawn + initialize + tools/list ----------
const t1 = Date.now();
const r = spawnSync(process.execPath, ["dist/mcp.js"], {
  input:
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"g0","version":"0"}}}\n' +
    '{"jsonrpc":"2.0","method":"notifications/initialized"}\n' +
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
  encoding: "utf8",
  timeout: 30000,
});
out.mcpStdioIdle = {
  spawnToExitMs: Date.now() - t1,
  responseLines: (r.stdout || "").trim().split("\n").filter(Boolean).length,
  exitStatus: r.status,
};

out.notMeasured = [
  "realSERP (公网质量/延迟): 本探针为本地合成资源基线",
  "cacheSQLite 冷/热: TS 侧缓存层在 Go 侧单独测量 (SQLite 口径相同)",
  "harvestCancel: TS 侧 25ms 轮询语义, Go 侧事件驱动 — 只对资源口径对照",
];

console.log(JSON.stringify(out, null, 2));
