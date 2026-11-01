// HTTP/SSE 探针: 起 serve-http(随机端口) → /health → /search → POST /research(SSE 流)
// 验证 WorkBuddy[07] agentic_search 式事件流端到端可用
import { spawn } from "node:child_process";

const PORT = 18971;
const child = spawn("node", ["dist/cli.js", "serve-http", "--port", String(PORT)], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, SC_DATA_DIR: "/tmp/sc-http-probe-" + Date.now(), SC_SSRF: "off", SC_X_GUEST: "0" },
});
child.stderr.on("data", (d) => console.error("SRV:", d.toString().trim().slice(0, 160)));
child.on("exit", (c) => console.log("server exit", c));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(800);

// 1) health
const h = await fetch(`http://127.0.0.1:${PORT}/health`);
console.log("HEALTH:", h.status, JSON.stringify(await h.json()));

// 2) stats
const s = await fetch(`http://127.0.0.1:${PORT}/stats`);
console.log("STATS:", s.status, Object.keys(await s.json()).join(","));

// 3) POST /research — SSE 流(无网络引擎 → 角度全失败也应正常出事件与 result)
const res = await fetch(`http://127.0.0.1:${PORT}/research`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "test query offline", max_loops: 1, fetch_budget: 2, min_facts: 3 }),
});
console.log("RESEARCH status:", res.status, "content-type:", res.headers.get("content-type"));
const reader = res.body.getReader();
const dec = new TextDecoder();
let sse = "";
let events = 0;
const seen = new Set();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  sse += dec.decode(value);
  for (const m of sse.matchAll(/event: (.+)\ndata: (.+)\n\n/g)) {
    events++;
    seen.add(m[1]);
    if (m[1] === "result") {
      const r = JSON.parse(m[2]);
      console.log("SSE result: runId=", r.runId, "stop=", JSON.stringify(r.stop), "facts=", r.facts);
    }
    if (m[1] === "error") console.log("SSE error event:", m[2].slice(0, 120));
  }
}
console.log("SSE events total:", events, "types:", [...seen].sort().join(","));
console.log("--- killing ---");
child.kill();
process.exit(0);
