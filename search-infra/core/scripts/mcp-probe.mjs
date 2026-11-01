// MCP stdio 探针: initialize → tools/list(应只有 Direct 工具) → tool_search("deep research")
// → tools/list(research 应激活) → tools/call research(迷你预算) — 渐进披露全流程验证
import { spawn } from "node:child_process";

const child = spawn("node", ["dist/mcp.js"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const pending = new Map();
child.stdout.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {
      console.log("RAW:", line.slice(0, 200));
    }
  }
});
child.stderr.on("data", (d) => console.error("STDERR:", d.toString().slice(0, 200)));
child.on("exit", (c) => console.log("exit", c));

const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
const call = (id, method, params) =>
  new Promise((resolve) => {
    pending.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, params });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await sleep(200);
await call(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "0" } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });

const list1 = await call(2, "tools/list", {});
console.log("TOOLS(vanilla):", list1.result.tools.map((t) => t.name).join(", "));

const found = await call(3, "tools/call", { name: "tool_search", arguments: { query: "deep research loop citations" } });
const fd = JSON.parse(found.result.content[0].text);
console.log("TOOL_SEARCH matches:", fd.matches.map((m) => `${m.name}(${m.score})`).join(", "));
console.log("TOOL_SEARCH newly_activated:", fd.newly_activated);

const list2 = await call(4, "tools/list", {});
console.log("TOOLS(after):", list2.result.tools.map((t) => t.name).join(", "));

// 激活后的 research 工具真的可调用(迷你预算,禁网也该返回结构化失败或空跑)
const res = await call(5, "tools/call", {
  name: "research",
  arguments: { query: "mcp protocol adoption", max_loops: 1, fetch_budget: 2, min_facts: 3 },
});
const rd = JSON.parse(res.result.content[0].text);
console.log("RESEARCH run:", rd.run_id, "stop:", JSON.stringify(rd.stop), "facts:", rd.facts.length);
console.log("RESEARCH report head:", (rd.report ?? "").split("\n")[0]);

console.log("--- killing ---");
child.kill();
process.exit(0);
