/**
 * v0.8 测试: mcp-connector(外部 MCP 搜索连接器) + STORM-lite 角度选择 + research preset + outline
 * 证据来源: analysis/gpt-researcher/source(gpt_researcher/mcp/* RETRIEVER=mcp 思想)
 *          analysis/storm/source(knowledge_storm/storm_wiki/modules/persona_generator.py 强制兜底视角)
 * 连接器测试用 test/fixtures/fake-mcp-server.mjs(手写 JSON-RPC stdio,零依赖)离线全链路。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { McpConnectorProvider, pickToolByHeuristic, normalizeToolResult } from "../providers/mcp-connector.js";
import type { SearchCtx } from "../providers/base.js";
import { DEFAULT_ANGLES, selectAngles, buildOutline, RESEARCH_PRESETS } from "../research.js";
import type { Fact } from "../research.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-mcp-server.mjs");

function liveCtx(): SearchCtx {
  return { fetchImpl: fetch, signal: AbortSignal.timeout(15000), ua: "test", opts: { maxResults: 10 } as SearchCtx["opts"] };
}

// ---------- mcp-connector: 离线全链路(真子进程 stdio) ----------

test("mcp-connector: stdio 连接→工具调用→Tavily 形状归一化为 Reference[]", async () => {
  const p = new McpConnectorProvider({ name: "fake", command: process.execPath, args: [FIXTURE] });
  try {
    assert.equal(p.name, "mcp:fake");
    assert.equal(p.keySlot, true); // 与 tavily 同语义: 配置即自动并联
    const refs = await p.search("rust async", liveCtx());
    assert.equal(refs.length, 2);
    assert.equal(refs[0].title, "Result A for rust async");
    assert.equal(refs[0].url, "https://example.org/a");
    assert.equal(refs[0].snippet, "snippet alpha with details");
    assert.deepEqual(refs[0].engines, ["mcp:fake"]);
    assert.equal(refs[0].published, "2026-08-01");
  } finally {
    await p.close(); // 不关会钉住 stdio 管道,测试进程无法退出
  }
});

test("mcp-connector: 空结果抛错(与其他 provider 语义一致,router 记健康/熔断)", async () => {
  const p = new McpConnectorProvider({
    name: "empty", command: process.execPath, args: [FIXTURE],
    env: { EMPTY: "1" },
  });
  try {
    await assert.rejects(() => p.search("anything", liveCtx()), /returned 0 results/);
  } finally {
    await p.close();
  }
});

test("mcp-connector: 启发式选工具(search 类优先,平手取短名)", async () => {
  const p = new McpConnectorProvider({
    name: "multi", command: process.execPath, args: [FIXTURE],
    env: { SECOND_TOOL: "1" },
  });
  try {
    const refs = await p.search("q", liveCtx());
    assert.equal(refs.length, 2); // helper_tool 不会返回这个形状,能搜到说明选中的是 web_search
  } finally {
    await p.close();
  }
});

test("mcp-connector: 显式 tool 名不存在时报错并列出可用工具", async () => {
  const p = new McpConnectorProvider({
    name: "bad", command: process.execPath, args: [FIXTURE],
    tool: "nonexistent",
  });
  try {
    await assert.rejects(() => p.search("q", liveCtx()), /not found.*web_search/s);
  } finally {
    await p.close();
  }
});

test("mcp-connector: pickToolByHeuristic 纯函数(无 search 类工具返回 undefined)", () => {
  assert.equal(pickToolByHeuristic([{ name: "helper_tool", description: "misc" }]), undefined);
  const picked = pickToolByHeuristic([
    { name: "zzz_helper", description: "search the web too" },
    { name: "web_search", description: "search" },
  ]);
  assert.equal(picked?.name, "web_search");
});

test("mcp-connector: normalizeToolResult 接受数组/信封/纯文本三形状", () => {
  const direct = normalizeToolResult("mcp:x", [{ title: "t", url: "https://a.b/c", snippet: "s" }]);
  assert.equal(direct.length, 1);
  const enveloped = normalizeToolResult("mcp:x", { content: [{ type: "text", text: JSON.stringify({ results: [{ title: "t2", href: "https://a.b/d", body: "s2" }] }) }] });
  assert.equal(enveloped[0].url, "https://a.b/d");
  const plain = normalizeToolResult("mcp:x", { content: [{ type: "text", text: "just some text" }] });
  assert.equal(plain.length, 1);
  assert.equal(plain[0].url, "");
});

// ---------- STORM-lite 角度选择(persona_generator.py 强制兜底视角的规则版) ----------

test("selectAngles: 强制保留 定义与概念(basic fact writer 兜底)+按信号选+池序补满", () => {
  const a = selectAngles("rust 入门教程 怎么安装配置");
  assert.ok(a.includes("定义与概念"), "basic fact 角度必须强制保留");
  assert.ok(a.includes("教程与实践"), "how-to 信号应命中教程角度");
  assert.equal(a.length, 5, "保持既有 5 角度预算口径");
  assert.equal(new Set(a).size, a.length, "角度不重复");
});

test("selectAngles: 无信号 query 回落池序前 5(兼容旧行为)", () => {
  const a = selectAngles(" quantum computing ");
  assert.deepEqual(a, DEFAULT_ANGLES.slice(0, 5).map((t) => t.name));
});

test("selectAngles: 对比信号命中 对比与替代", () => {
  const a = selectAngles("postgres vs mysql 哪个好");
  assert.ok(a.includes("对比与替代"));
});

// ---------- research preset(gpt-researcher 报告类型预算表显式化) ----------

test("RESEARCH_PRESETS: summary 最省/deep 最大/report 不覆盖", () => {
  assert.equal(RESEARCH_PRESETS.summary.maxLoops, 1);
  assert.equal(RESEARCH_PRESETS.summary.fetchBudget, 4);
  assert.equal(RESEARCH_PRESETS.deep.maxLoops, 5);
  assert.equal(RESEARCH_PRESETS.deep.fetchBudget, 24);
  assert.equal(RESEARCH_PRESETS.deep.minFacts, 10);
  assert.deepEqual(RESEARCH_PRESETS.report, {});
});

// ---------- outline(STORM 大纲骨架的无 LLM 版) ----------

test("buildOutline: 角度→事实数/tier1 数/前2来源域,坏 URL 不炸", () => {
  const facts: Fact[] = [
    { refId: 1, url: "https://arxiv.org/abs/1", title: "t", angle: "定义与概念", quote: "q" } as Fact,
    { refId: 2, url: "https://blog.example.com/x", title: "t", angle: "定义与概念", quote: "q" } as Fact,
    { refId: 3, url: "https://github.com/a/b", title: "t", angle: "对比与替代", quote: "q" } as Fact,
    { refId: 4, url: "not a url", title: "t", angle: "对比与替代", quote: "q" } as Fact,
  ];
  const outline = buildOutline(["定义与概念", "对比与替代"], facts);
  assert.equal(outline.length, 2);
  assert.equal(outline[0].facts, 2);
  assert.equal(outline[0].tier1Facts, 1); // arxiv.org = TIER1
  assert.equal(outline[1].facts, 2);
  assert.equal(outline[1].tier1Facts, 0);
  assert.ok(outline[0].domains.includes("arxiv.org"));
});

// ---------- phase AB: mcp-connector argsTemplate + 数组片段归一化 ----------

import { buildToolArgsFromTemplate, buildToolArgsHeuristic } from "../providers/mcp-connector.js";

test("mcp-connector: argsTemplate 深替换 — 字符串/数组/嵌套对象全递归, ${query} 全量替换", () => {
  const args = buildToolArgsFromTemplate(
    { objective: "web search: ${query}", search_queries: ["${query}", "more ${query}"], nested: { inner: "${query}", n: 3 }, flag: true },
    "python asyncio",
  );
  assert.deepEqual(args, {
    objective: "web search: python asyncio",
    search_queries: ["python asyncio", "more python asyncio"],
    nested: { inner: "python asyncio", n: 3 },
    flag: true,
  });
  // 非字符串值原样保留
  assert.equal((args.nested as { n: number }).n, 3);
  assert.equal(args.flag, true);
});

test("mcp-connector: 启发式拼法抽出后语义不变(query 键 + count 键)", () => {
  const a = buildToolArgsHeuristic({ countKey: "max_results", countKey2: "q" }, "hello", 8);
  assert.deepEqual(a, { q: "hello", max_results: 8 });
  const b = buildToolArgsHeuristic({}, "hello", 8);
  assert.deepEqual(b, { query: "hello" });
});

test("mcp-connector: normalizeToolResult 接受 Parallel 形状 — excerpts 数组连接成 snippet", () => {
  const res = {
    content: [{
      type: "text",
      text: JSON.stringify({
        search_id: "s1",
        results: [
          { url: "https://docs.python.org/3/library/asyncio.html", title: "asyncio — Asynchronous I/O", publish_date: null, excerpts: ["Hello World", "The Python Standard Library"] },
        ],
      }),
    }],
  };
  const refs = normalizeToolResult("mcp:parallel", res);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].url, "https://docs.python.org/3/library/asyncio.html");
  assert.equal(refs[0].snippet, "Hello World / The Python Standard Library");
});
