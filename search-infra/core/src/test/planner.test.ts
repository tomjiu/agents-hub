import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, splitComparison } from "../planner.js";

test("planner: simple web query", () => {
  // v0.6 起编程词命中域名表(走 domain lane), 这里换中性 query 保住 simple web 语义
  const d = plan("general knowledge about world history");
  assert.equal(d.complexity, "simple");
  assert.equal(d.route, "web");
  assert.deepEqual(d.queries, ["general knowledge about world history"]);
});

test("planner: x route by keywords", () => {
  const d = plan("Elon 推特 上关于 GPT-5 的讨论");
  assert.equal(d.route, "x");
});

test("planner: github route", () => {
  const d = plan("sqlite-vec github");
  assert.equal(d.route, "github");
});

test("planner: research hints", () => {
  const d = plan("深度研究 2026 年 AI coding agent 的技术格局");
  assert.equal(d.complexity, "research");
  assert.equal(d.researchHint, true);
});

test("planner: long query is research", () => {
  const d = plan("x".repeat(130));
  assert.equal(d.complexity, "research");
});

test("planner: comparison split (A vs B)", () => {
  const d = plan("bun vs deno");
  assert.equal(d.complexity, "multi");
  assert.ok(d.queries.includes("bun"));
  assert.ok(d.queries.includes("deno"));
  assert.ok(d.queries.includes("bun vs deno")); // 原查询保留
});

test("planner: comparison split (比较A和B)", () => {
  const d = plan("比较 sqlite-vec 和 lancedb");
  assert.equal(d.complexity, "multi");
  assert.ok(d.queries.length >= 2);
});

test("planner: multi question sentences", () => {
  const d = plan("什么是 BM25?它和向量检索的区别?哪个性价比高");
  assert.equal(d.complexity, "multi");
});

test("splitComparison: 和 pattern", () => {
  const parts = splitComparison("比较 RRF 和 weighted fusion 的差异");
  assert.ok(parts.includes("RRF"));
  assert.ok(parts.includes("weighted fusion"));
});

// ---------- phase AA: 查询语言自动检测 ----------

test("planner: zh 检测 — CJK≥2 → lang=zh(中英混排题也命中)", () => {
  assert.equal(plan("python asyncio 教程").lang, "zh");
  assert.equal(plan("向量数据库 milvus faiss 对比").lang, "zh");
});

test("planner: zh 检测 — 纯英文/单 CJK 字不触发(防误伤)", () => {
  assert.equal(plan("rust crate async runtime tokio").lang, undefined);
  assert.equal(plan("milvus 是什么").lang, "zh"); // 3 CJK
});
