#!/usr/bin/env node
// 端到端冒烟测试：依次调用所有 MCP 工具，验证整条链路。
//
//   $env:ZAI_TOKEN="..."; node scripts/smoke.mjs
//
// 会真的创建会话并发送消息（消耗一次 Agent Mode 额度），
// 所以默认只读工具先跑，写工具用 --write 显式开启。

import { spawn } from "node:child_process";

const IMAGE = process.env.ZAI_IMAGE || "zai-bridge:latest";
const TOKEN = process.env.ZAI_TOKEN;
const WITH_WRITE = process.argv.includes("--write");

if (!TOKEN) {
  console.error("需要设置 ZAI_TOKEN");
  process.exit(2);
}

const IN = '\n';

function rpc(id, method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

// 一次性跑完：把请求全部写进去，读回所有响应后按 id 归类
function run(reqs) {
  return new Promise((resolve, reject) => {
    const p = spawn("docker", ["run", "-i", "--rm", "-e", "ZAI_TOKEN=" + TOKEN, IMAGE], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      const byId = new Map();
      for (const line of out.split(IN)) {
        const t = line.trim();
        if (!t.startsWith("{")) continue;
        try {
          const m = JSON.parse(t);
          if (m.id !== undefined) byId.set(m.id, m);
        } catch {}
      }
      resolve({ byId, code, err });
    });
    // Send requests sequentially; dependent wait/get must not overtake send.
    let cursor=0,buffer="";
    const sendNext=()=>{if(cursor>=reqs.length){p.stdin.end();return};p.stdin.write(reqs[cursor]+IN)};
    p.stdout.on("data",d=>{buffer+=d.toString();let i;while((i=buffer.indexOf(IN))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+IN.length);try{const response=JSON.parse(line);if(response.id===JSON.parse(reqs[cursor]||"{}").id){cursor++;sendNext()}}catch{}}});
    sendNext();
  });
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? "✓ " : "✗ ") + name + (detail ? "  " + detail : ""));
}

const handshake = [
  rpc(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1" },
  }),
  rpc(2, "tools/list", {}),
  rpc(3, "tools/call", { name: "list_chats", arguments: { limit: 3 } }),
  rpc(4, "tools/call", { name: "get_usage", arguments: {} }),
  rpc(5, "tools/call", { name: "list_files", arguments: {} }),
  rpc(6, "tools/call", { name: "list_chats", arguments: { limit: 1 } }),
  rpc(7, "tools/call", { name: "list_tags", arguments: {} }),
  rpc(8, "tools/call", { name: "list_chats", arguments: { search: "a" } }),
];

const { byId, code } = await run(handshake);
check("进程正常退出", code === 0, "exit=" + code);

const init = byId.get(1);
check("initialize 握手", !!init?.result?.serverInfo?.name, init?.result?.serverInfo?.version);

const tools = byId.get(2)?.result?.tools ?? [];
const names = tools.map((t) => t.name);
const expected = [
  "list_chats", "get_chat", "get_messages", "create_chat", "send_message",
  "wait_for_reply", "get_usage", "list_files", "download_file", "upload_file",
  "delete_file", "list_chat_files", "download_chat_file", "list_tags",
  "rename_chat", "pin_chat", "archive_chat", "delete_chat", "list_models",
];
const missing = expected.filter((n) => !names.includes(n));
check("工具清单完整", missing.length === 0, missing.length ? "缺: " + missing.join(",") : names.length + " 个");

const text = (id) => byId.get(id)?.result?.content?.[0]?.text ?? "";
const isErr = (id) => !!byId.get(id)?.result?.isError;

check("list_chats", !isErr(3) && text(3).includes("会话"), text(3).split(IN)[0]);
check("get_usage", !isErr(4) && text(4).includes("token"), text(4).split(IN).find((l) => l.includes("今日")));
check("list_files", !isErr(5) && text(5).includes("云盘"), text(5).split(IN)[0]);
check("list_tags", !isErr(7) && (text(7).includes("标签") || text(7).includes("还没有")), text(7).split(IN)[0]);
check("list_chats 搜索", !isErr(8) && text(8).includes("搜索"), text(8).split(IN)[0]);

// 用第一个会话验证会话产物工具（没产物也算通过，只要不报错）
const firstChat = (text(6).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [])[0];
if (firstChat) {
  const f = await run([
    rpc(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1" } }),
    rpc(2, "tools/call", { name: "list_chat_files", arguments: { chat_id: firstChat } }),
  ]);
  const t = f.byId.get(2)?.result?.content?.[0]?.text ?? "";
  check("list_chat_files", !f.byId.get(2)?.result?.isError, t.split(IN)[0]);
}

if (WITH_WRITE) {
  const w = await run([
    rpc(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1" } }),
    rpc(2, "tools/call", { name: "create_chat", arguments: { title: "冒烟测试", message: "只回复两个字：收到" } }),
  ]);
  const createText = w.byId.get(2)?.result?.content?.[0]?.text ?? "";
  const chatID = (createText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [])[0];
  check("create_chat", !!chatID, chatID || createText.slice(0, 80));

  if (chatID) {
    const w2 = await run([
      rpc(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1" } }),
      rpc(2, "tools/call", { name: "send_message", arguments: { chat_id: chatID, message: "只回复两个字：收到", wait: false } }),
      rpc(3, "tools/call", { name: "wait_for_reply", arguments: { chat_id: chatID, timeout_seconds: 150, poll_ms: 3000 } }),
      rpc(4, "tools/call", { name: "get_messages", arguments: { chat_id: chatID, limit: 4 } }),
    ]);
    const sendText = w2.byId.get(2)?.result?.content?.[0]?.text ?? "";
    check("send_message", !w2.byId.get(2)?.result?.isError && /state: (running|completed)/.test(sendText), sendText.split(IN)[0]);
    const waitText = w2.byId.get(3)?.result?.content?.[0]?.text ?? "";
    check("wait_for_reply", /assistant/.test(waitText), waitText.split(IN).slice(0, 2).join(" "));
    const msgsText = w2.byId.get(4)?.result?.content?.[0]?.text ?? "";
    check("get_messages 含真实内容", msgsText.includes("收到"), "有内容");

    // 清理：删掉本次创建的测试会话，避免污染账户
    const d = await run([
      rpc(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1" } }),
      rpc(2, "tools/call", { name: "delete_chat", arguments: { chat_id: chatID, confirm: true } }),
    ]);
    const delText = d.byId.get(2)?.result?.content?.[0]?.text ?? "";
    check("delete_chat 清理", delText.includes("已删除"), delText.split(IN)[0]);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(IN + "---");
console.log(failed.length === 0 ? "全部通过（" + results.length + " 项）" : "失败 " + failed.length + " 项：" + failed.map((f) => f.name).join(", "));
process.exit(failed.length === 0 ? 0 : 1);
