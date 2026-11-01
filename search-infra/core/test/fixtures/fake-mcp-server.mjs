// 测试夹具: 手写 JSON-RPC stdio MCP server(零依赖,不 import SDK)
import { appendFileSync } from "node:fs";
// 行为: initialize/tools list/tools call;env EMPTY=1 返回空结果;SECOND_TOOL=1 多给一个干扰工具
// 用途: mcp-connector.test.ts 用 StdioClientTransport 拉起本进程,离线验证连接器全链路
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
const send = (o) => { if (process.env.DEBUG_LOG) appendFileSync(process.env.DEBUG_LOG, "OUT: " + JSON.stringify(o) + "\n"); process.stdout.write(JSON.stringify(o) + "\n"); };

const tools = [{ name: "web_search", description: "Search the web for current information", inputSchema: { type: "object", properties: { query: { type: "string" }, max_results: { type: "number" } }, required: ["query"] } }];
if (process.env.SECOND_TOOL === "1") {
  tools.push({ name: "helper_tool", description: "Does something else entirely", inputSchema: { type: "object", properties: { input: { type: "string" } } } });
}

rl.on("line", (line) => {
  if (process.env.DEBUG_LOG) appendFileSync(process.env.DEBUG_LOG, line + "\
");
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined || msg.id === null) return; // notification(注意 id=0 是合法 JSON-RPC id,falsy 陷阱)
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-search", version: "1.0.0" } } });
  } else if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools } });
  } else if (method === "tools/call") {
    const q = params?.arguments?.query ?? "";
    const n = Number(params?.arguments?.max_results ?? 2);
    const results = process.env.EMPTY === "1" ? [] : [
      { title: `Result A for ${q}`, url: "https://example.org/a", content: "snippet alpha with details", published_date: "2026-08-01" },
      { title: `Result B for ${q}`, url: "https://example.com/b", content: "snippet beta" },
    ].slice(0, Math.max(0, n));
    send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ results }) }] } });
  } else {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } });
  }
});
rl.on("close", () => process.exit(0));

// 自毁保险丝: 测试万一没关连接,60s 后自杀不悬挂 CI
setTimeout(() => process.exit(0), 60000).unref();
