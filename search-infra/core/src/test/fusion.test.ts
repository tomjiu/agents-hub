import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl, fuse, lexicalScore } from "../fusion.js";
import type { Reference } from "../types.js";

test("normalizeUrl: strips utm/fragment/trailing slash", () => {
  assert.equal(
    normalizeUrl("https://Example.com/a/b/?utm_source=x&utm_campaign=y#frag"),
    "https://example.com/a/b",
  );
  assert.equal(normalizeUrl("https://example.com/"), "https://example.com/");
});

test("fuse: dedup across engines + RRF + multi-engine boost", () => {
  const engineLists: Reference[] = [
    { url: "https://a.com/1", title: "Rust async guide", snippet: "tokio runtime", engines: ["duckduckgo"] },
    { url: "https://a.com/1", title: "Rust async guide", snippet: "longer snippet about tokio runtime internals", engines: ["brave"] },
    { url: "https://b.com/2", title: "Rust async guide", snippet: "dup title", engines: ["brave"] },
    { url: "https://a.com/1?utm_source=x&utm_campaign=y#frag", title: "Rust async guide", snippet: "dup after normalize", engines: ["yahoo"] },
  ];
  const out = fuse(engineLists, { query: "rust async guide", topN: 10 });
  // a.com/1 出现 3 次(含 utm 变体)应合并为 1 条,engines 去重为 3
  const a = out.find((r) => r.url === "https://a.com/1");
  assert.ok(a, "a.com/1 should exist");
  assert.equal(a!.engines.length, 3);
  assert.equal(a!.snippet, "longer snippet about tokio runtime internals"); // 保留最长 snippet
  // 多引擎命中的 a.com/1 应排在单引擎的 b.com/2 前
  assert.ok(a!.rank! < out.find((r) => r.url === "https://b.com/2")!.rank!);
  // refId 连续编号
  assert.equal(out[0].refId, 1);
});

test("fuse: topN cap", () => {
  const many: Reference[] = [];
  for (let i = 0; i < 30; i++) {
    many.push({ url: `https://s.com/${i}`, title: `t${i}`, snippet: "s", engines: ["searxng"] });
  }
  assert.equal(fuse(many, { query: "t", topN: 20 }).length, 20);
});

test("lexicalScore: title weighted, CJK terms", () => {
  const hi = lexicalScore("sqlite 向量检索", "sqlite 向量检索实战", "无关内容无关内容");
  const lo = lexicalScore("sqlite 向量检索", "完全无关", "也是无关");
  assert.ok(hi > lo);
  assert.equal(lo, 0);
});
