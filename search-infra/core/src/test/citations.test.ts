/**
 * v0.2 测试: 引用出口校验(v0-spec §6 验收: 引用出口校验 100%)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCitationRegistry, auditCitations, enforceCitations, renderCitations,
} from "../citations.js";
import type { Reference } from "../types.js";

const registry = buildCitationRegistry([
  { refId: 1, url: "https://a.com/1", title: "A", snippet: "", engines: ["e"] },
  { refId: 2, url: "https://b.com/2", title: "B", snippet: "", engines: ["e"] },
  { refId: 5, url: "https://c.com/5", title: "C", snippet: "", engines: ["e"] },
]);

test("audit: all cited refs resolvable → ok", () => {
  const a = auditCitations("事实一 [1]，事实二 [2]。", registry);
  assert.equal(a.ok, true);
  assert.deepEqual(a.cited, [1, 2]);
  assert.deepEqual(a.unknown, []);
  assert.deepEqual(a.unused, [5]);
});

test("audit: hallucinated refId detected", () => {
  const a = auditCitations("看起来很像引用 [3] 与 [99]", registry);
  assert.equal(a.ok, false);
  assert.deepEqual(a.unknown, [3, 99]);
});

test("enforce strict: throws on unknown ref", () => {
  assert.throws(() => enforceCitations("x [7]", registry), /citation exit validation failed/);
});

test("enforce strip: removes hallucinated, keeps valid, still ok", () => {
  const { text, audit } = enforceCitations("好 [1] 坏 [7] 尾 [2]", registry, { mode: "strip" });
  assert.equal(audit.ok, true);
  assert.equal(text, "好 [1] 坏  尾 [2]");
});

test("render: deterministic numbered list", () => {
  const s = renderCitations(registry);
  assert.equal(s.split("\n").length, 3);
  assert.match(s, /^\[1\] A — https:\/\/a\.com\/1\n\[2\] B/);
});
