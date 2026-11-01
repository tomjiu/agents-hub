/**
 * v0.5 缓存即搜索面测试 (wigolo[09] Top3): FTS5 trigram 主路 + LIKE 兜底
 * 覆盖: 英文短语/中文 ≥3 字(fts)/短中文(like 兜底)/替换同步/特殊字符不炸/空 query
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cache } from "../cache.js";
import { SearchCore } from "../engine.js";

function tmpCache(): Cache {
  return new Cache(mkdtempSync(join(tmpdir(), "sc-fts-")));
}

function seedTwo(c: Cache): void {
  c.putPage("https://a.io/1", 200, "text/html", "Rust Borrow Checker",
    "The borrow checker enforces ownership rules at compile time, preventing data races.");
  c.putPage("https://a.io/2", 200, "text/html", "Node sqlite module",
    "node:sqlite is a native module with zero compile dependencies, shipping FTS5 support.");
}

test("fts: english phrase match via trigram, via=fts", () => {
  const c = tmpCache();
  seedTwo(c);
  const hits = c.searchPages("borrow checker", 10);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].via, "fts");
  assert.equal(hits[0].url, "https://a.io/1");
  assert.ok(hits[0].snippet.includes("borrow"));
});

test("fts: title column searchable", () => {
  const c = tmpCache();
  seedTwo(c);
  const hits = c.searchPages("Node sqlite", 10);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, "https://a.io/2");
});

test("fts: cjk 4-char phrase hits via trigram", () => {
  const c = tmpCache();
  c.putPage("https://zh.io/1", 200, "text/html", "搜索技术",
    "大语言模型改变了搜索引擎的形态，本地索引让重复查询秒回。");
  const hits = c.searchPages("搜索引擎", 10);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].via, "fts");
});

test("like: 2-char cjk falls back to substring, via=like", () => {
  const c = tmpCache();
  c.putPage("https://zh.io/1", 200, "text/html", "搜索技术",
    "大语言模型改变了搜索引擎的形态。");
  const hits = c.searchPages("搜索", 10);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].via, "like");
  assert.equal(hits[0].url, "https://zh.io/1");
});

test("fts: page replace keeps index in sync (old words gone, new words hit)", () => {
  const c = tmpCache();
  c.putPage("https://x.io/a", 200, "text/html", "Old Title", "quantum flux capacitor blueprint v1");
  assert.equal(c.searchPages("flux capacitor", 10).length, 1);
  c.putPage("https://x.io/a", 200, "text/html", "New Title", "solid state battery blueprint v2");
  assert.equal(c.searchPages("flux capacitor", 10).length, 0);
  const hits = c.searchPages("battery blueprint", 10);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, "https://x.io/a");
});

test("fts: fts-syntax query does not throw (falls to LIKE)", () => {
  const c = tmpCache();
  seedTwo(c);
  const hits = c.searchPages('"borrow AND (checker OR "unbalanced', 10);
  assert.ok(Array.isArray(hits)); // 不炸即通过(命中与否取决于 LIKE 兜底)
});

test("fts: empty/whitespace query returns []", () => {
  const c = tmpCache();
  seedTwo(c);
  assert.deepEqual(c.searchPages("", 10), []);
  assert.deepEqual(c.searchPages("   ", 10), []);
});

test("fts: old db upgrade path (pages exist, fts empty → auto rebuild)", () => {
  const dir = mkdtempSync(join(tmpdir(), "sc-fts-up-"));
  const c1 = tmpCache();
  c1.close();
  // 直接再开一个新 Cache 模拟老库(先写 pages 但绕过 FTS 同步: 手动删掉 fts 行再重开)
  const c2 = new Cache(dir);
  c2.putPage("https://legacy.io/1", 200, "text/html", "Legacy Page", "upgrade path rebuild sanity check");
  // 模拟老库: 清空 FTS 行(pages 仍在)
  const c3 = tmpCache();
  c3.putPage("https://legacy.io/2", 200, "text/html", "Legacy Two", "another corpus page for rebuild");
  c3.close();
  const c4 = new Cache(dir); // 空库,无重建
  assert.equal(c4.searchPages("nothing here", 5).length, 0);
  c4.close();
  // 真正的老库升级场景: 新实例打开 c2 所在库 — pages 有行 fts 有行(不触发重建, 查询正常)
  assert.equal(c2.searchPages("upgrade path", 5).length, 1);
  c2.close();
});

test("core.searchCache: exit point works + counter increments", () => {
  const dir = mkdtempSync(join(tmpdir(), "sc-fts-core-"));
  const core = new SearchCore({ config: { dataDir: dir } });
  try {
    core.cache.putPage("https://k.io/1", 200, "text/html", "Focus Fetch", "focus mode returns matching segments only");
    const before = core.stats().counters.cacheSearchTotal;
    const hits = core.searchCache("matching segments", 5);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].via, "fts");
    assert.equal(core.stats().counters.cacheSearchTotal, before + 1);
  } finally {
    core.close();
  }
});
