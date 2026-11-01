// MCP 实战探针 (v0.7 出口实战化) — 真网络全流程:
//   initialize(新协议 2025-06-18) → tools/list(Direct 3) → tools/call search 实搜(通用+域名路由)
//   → fetch focus 实抓 → tool_search 激活 search_providers → tools/list(4) → search_providers 健康
// 与 mcp-probe.mjs(渐进披露机制验证,禁网可跑)互补:本探针证明"这双眼睛真的能看见实时网络"。
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
      console.log("RAW:", line.slice(0, 160));
    }
  }
});
child.stderr.on("data", (d) => {
  const s = d.toString().trim();
  if (s) console.error("STDERR:", s.slice(0, 160));
});
child.on("exit", (c) => console.log("exit", c));

const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
const call = (id, method, params, timeoutMs = 120000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timeout ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    send({ jsonrpc: "2.0", id, method, params });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parse = (m) => JSON.parse(m.result.content[0].text);

await sleep(200);

// 1) 握手 — 用比老探针新的协议版本(2025-06-18),看 SDK 协商结果
const t0 = Date.now();
const init = await call(1, "initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "probe-real", version: "0.7.0" },
});
console.log("INIT negotiated protocolVersion:", init.result?.protocolVersion,
  "| server:", init.result?.serverInfo?.name, init.result?.serverInfo?.version,
  `(${Date.now() - t0}ms)`);
send({ jsonrpc: "2.0", method: "notifications/initialized" });

// 2) 工具清单 — 应只有 Direct 3 件
const list1 = await call(2, "tools/list", {});
console.log("TOOLS(direct):", list1.result.tools.map((t) => t.name).join(", "));

// 3) 真实搜索 A — 通用 query(应走通用池多引擎并联+融合)
const t1 = Date.now();
const sa = await call(3, "tools/call", { name: "search", arguments: { query: "model context protocol specification 2025", top_n: 5 } });
const da = parse(sa);
console.log(`SEARCH-A general: ${da.refs.length} refs in ${da.meta.elapsed_ms}ms (wall ${Date.now() - t1}ms)`,
  "| engines:", (da.meta.engines_used ?? []).join("+") || "-",
  "| route:", da.meta.route, "| complexity:", da.meta.complexity);
for (const r of da.refs.slice(0, 2)) console.log(`   [${r.refId}] ${r.title?.slice(0, 70)}  ${r.url.slice(0, 70)}`);

// 4) 真实搜索 B — 域名路由 query(含 packages 主题关键词连续子串 "rust crate" → crates.io API 腿)
const t2 = Date.now();
const sb = await call(4, "tools/call", { name: "search", arguments: { query: "rust crate async runtime", top_n: 5 } });
const db = parse(sb);
console.log(`SEARCH-B routed: ${db.refs.length} refs in ${db.meta.elapsed_ms}ms (wall ${Date.now() - t2}ms)`,
  "| route:", db.meta.route, "| engines:", (db.meta.engines_used ?? []).join("+") || "-");
for (const r of db.refs.slice(0, 2)) console.log(`   [${r.refId}] ${r.title?.slice(0, 70)}  ${r.url.slice(0, 70)}`);

// 5) fetch focus — 拿搜索 A 首条 URL 实抓,只回命中段
const firstUrl = da.refs[0]?.url;
if (firstUrl) {
  const t3 = Date.now();
  try {
    const f = await call(5, "tools/call", { name: "fetch", arguments: { url: firstUrl, focus: "specification", max_chars: 3000 } }, 45000);
    const df = parse(f);
    console.log(`FETCH focus: ${df.returned_chars}/${df.text_length} chars (saved ${df.saved_pct ?? "?"}%), from_cache=${df.from_cache}, wall ${Date.now() - t3}ms`);
  } catch (e) {
    console.log("FETCH focus: FAIL —", String(e.message).slice(0, 100), "(单工具失败不阻断,与出口降级语义一致)");
  }
} else {
  console.log("FETCH focus: SKIP (search A 无结果)");
}

// 6) 渐进披露 — tool_search 激活 search_providers
const ts = await call(6, "tools/call", { name: "tool_search", arguments: { query: "engine health circuit state" } });
const dt = parse(ts);
console.log("TOOL_SEARCH newly_activated:", dt.newly_activated.join(", ") || "(none)");

// 7) 工具清单应变为 4 件
const list2 = await call(7, "tools/list", {});
console.log("TOOLS(after):", list2.result.tools.map((t) => t.name).join(", "));

// 8) 引擎健康快照 — 29 provider 注册面
const sp = await call(8, "tools/call", { name: "search_providers", arguments: {} });
const dp = parse(sp);
const provs = dp.providers ?? [];
const okN = provs.filter((p) => (p.ok ?? 0) > 0).length;
const openN = provs.filter((p) => p.circuitOpen).length;
console.log(`PROVIDERS: ${provs.length} registered, ${okN} with ok>0, ${openN} circuit open`);
console.log("   busiest:", provs.filter((p) => p.ok > 0).sort((a, b) => b.ok - a.ok).slice(0, 4)
  .map((p) => `${p.name} ${p.ok}ok/${p.fail}fail ${p.avgLatencyMs}ms`).join(" | "));

child.kill();
console.log("PROBE-DONE");
