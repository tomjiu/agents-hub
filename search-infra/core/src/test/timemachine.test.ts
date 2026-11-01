/**
 * v0.5 时间机器双 provider 测试: wayback(CDX 快照时间线) / wikirev(维基修订历史)
 * 覆盖: 黄金样本解析/快照直链拼装/非法 query 教学抛错/空库诚实返回/HTTP 错误/URL 输入剥离
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { wayback, wikirev } from "../providers/timemachine.js";
import type { SearchCtx } from "../providers/base.js";
import type { SearchOptions } from "../types.js";

type AnyFetch = (url: string, init?: RequestInit) => Promise<Response>;

function ctxWith(body: string, status = 200, contentType = "application/json"): { ctx: SearchCtx; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: AnyFetch = async (url, _init) => {
    calls.push(String(url));
    return new Response(body, { status, headers: { "Content-Type": contentType } });
  };
  const opts: SearchOptions = { maxResults: 10 };
  return {
    calls,
    ctx: { fetchImpl: fetchImpl as unknown as SearchCtx["fetchImpl"], signal: AbortSignal.timeout(5000), ua: "test", opts },
  };
}

// ---------- wayback ----------

const CDX_GOLDEN = JSON.stringify([
  ["timestamp", "original", "statuscode", "mimetype"],
  ["20240115093000", "https://example.com/", "200", "text/html"],
  ["20240210120000", "https://example.com/", "200", "text/html; charset=utf-8"],
]);

test("wayback: CDX golden sample → snapshot direct links, kind=archive", async () => {
  const { ctx } = ctxWith(CDX_GOLDEN);
  const refs = await wayback.search("https://example.com/", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://web.archive.org/web/20240115093000/https://example.com/");
  assert.ok(refs[0].title!.includes("example.com"));
  assert.ok(refs[0].title!.includes("@ 2024-01-15 09:30"));
  assert.equal(refs[0].kind, "archive");
  assert.equal(refs[0].published, "2024-01-15 09:30");
  assert.ok(refs[0].snippet!.includes("text/html"));
  assert.deepEqual(refs[0].engines, ["wayback"]);
});

test("wayback: bare domain accepted, request params correct", async () => {
  const { ctx, calls } = ctxWith(CDX_GOLDEN);
  await wayback.search("example.com", ctx);
  assert.ok(calls[0].startsWith("https://web.archive.org/cdx/search/cdx?"));
  assert.ok(calls[0].includes("url=example.com"));
  assert.ok(calls[0].includes("collapse=timestamp%3A6"));
  assert.ok(calls[0].includes("filter=statuscode%3A200"));
});

test("wayback: keyword input gets teaching error (not silent 0)", async () => {
  const { ctx } = ctxWith("[]");
  await assert.rejects(
    () => wayback.search("rust lang frameworks", ctx),
    /not a URL\/domain/,
  );
});

test("wayback: empty archive = honest [] (no throw, no breaker pollution)", async () => {
  const { ctx } = ctxWith("[]");
  const refs = await wayback.search("https://never-archived.io/page", ctx);
  assert.deepEqual(refs, []);
});

test("wayback: http 500 throws", async () => {
  const { ctx } = ctxWith("oops", 500);
  await assert.rejects(() => wayback.search("https://example.com/", ctx), /cdx http 500/);
});

// ---------- wikirev ----------

const REV_GOLDEN = JSON.stringify({
  revisions: [
    // REST v1 实探: user 是 {id, name} 对象
    { id: 1000001, timestamp: "2024-01-15T10:30:00Z", user: { id: 42, name: "editor_a" }, comment: "fix typo", size: 52000, delta: 120 },
    { id: 1000002, timestamp: "2023-11-02T08:00:00Z", user: { id: 43, name: "editor_b" }, comment: "add citation", size: 51880, delta: -40 },
  ],
});

test("wikirev: golden sample → oldid permalinks, kind=archive", async () => {
  const { ctx } = ctxWith(REV_GOLDEN);
  const refs = await wikirev.search("Python (programming language)", ctx);
  assert.equal(refs.length, 2);
  assert.ok(refs[0].url!.includes("oldid=1000001"));
  assert.ok(refs[0].url!.startsWith("https://en.wikipedia.org/w/index.php?title=Python"));
  assert.ok(refs[0].title!.includes("rev 1000001"));
  assert.equal(refs[0].kind, "archive");
  assert.ok(refs[0].snippet!.includes("editor_a"));
  assert.ok(refs[0].snippet!.includes("+120"));
});

test("wikirev: full wiki URL input stripped to title (en default)", async () => {
  const { ctx, calls } = ctxWith(REV_GOLDEN);
  await wikirev.search("https://en.wikipedia.org/wiki/Rust_(programming_language)", ctx);
  // URL 里的词条被剥出并回填进 REST history 路径(空格按规范编码 %20)
  assert.ok(calls[0].startsWith("https://en.wikipedia.org/w/rest.php/v1/page/Rust%20(programming%20language)/"));
  assert.ok(calls[0].includes("history"));
});
test("wikirev: opts.lang routes language subdomain", async () => {
  const { ctx, calls } = ctxWith(REV_GOLDEN);
  const opts: SearchOptions = { maxResults: 10, lang: "zh-CN" };
  const zhCtx: SearchCtx = { ...ctx, opts };
  await wikirev.search("Rust (programming language)", zhCtx);
  assert.ok(calls[0].startsWith("https://zh.wikipedia.org/"));
});

test("wikirev: nonexistent page → 404 with helpful message", async () => {
  const { ctx } = ctxWith("not found", 404);
  await assert.rejects(
    () => wikirev.search("This_Page_Does_Not_Exist_Xyz", ctx),
    /404.*not found/,
  );
});

test("wikirev: empty revisions = honest []", async () => {
  const { ctx } = ctxWith(JSON.stringify({ revisions: [] }));
  const refs = await wikirev.search("Some Page", ctx);
  assert.deepEqual(refs, []);
});

test("wikirev: empty title input rejected", async () => {
  const { ctx } = ctxWith(REV_GOLDEN);
  await assert.rejects(() => wikirev.search("   ", ctx), /article name|wiki URL/);
});
