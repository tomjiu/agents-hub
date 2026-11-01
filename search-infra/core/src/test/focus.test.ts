import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractHtml, splitSegments, extractFocus } from "../focus.js";

const here = dirname(fileURLToPath(import.meta.url));

const PAGE = `<!doctype html><html><head><title>Vector DB Guide</title>
<style>.x{color:red}</style><script>var t=1;</script></head>
<nav>Home | Pricing | Login</nav>
<article>
<h2>sqlite-vec overview</h2>
<p>sqlite-vec is a SQLite extension for vector search. It supports brute-force and quantized scans. ${"Detail sentence. ".repeat(10)}</p>
<p>The bge-m3 embedding model produces dense vectors suitable for sqlite-vec storage. Remote embedding APIs batch requests for indexing pipelines with progress tracking and cancellation support for long running jobs.</p>
<p>Pricing for managed vector databases varies by region and replica count. Enterprise plans include SLA guarantees, dedicated throughput tiers and cross region replication features.</p>
<p>Comparing brute-force scans against ANN indexes: brute-force is exact but linear in corpus size, while ANN trades recall for latency with HNSW or IVF families of algorithms.</p>
<p>Deployment options include in-process extensions, sidecar services and managed cloud offerings. Each option differs in operational complexity, upgrade cadence and failure isolation guarantees.</p>
<p>Query rewriting before retrieval improves recall when user queries are verbose or conversational. A cheap model can rewrite the query into keyword style variants before vector search runs.</p>
<p>Backups and snapshotting strategies matter for local-first databases. Copying the database file while a write transaction is in flight can produce torn snapshots that fail to open later.</p>
<p>Tokenization choices affect multilingual retrieval quality. Character n-grams handle CJK text without word segmentation, while subword tokenizers need language specific models.</p>
</article>
<footer>© 2026</footer></body></html>`;

test("extractHtml: strips scripts/nav/footer, keeps article text", () => {
  const ex = extractHtml(PAGE);
  assert.equal(ex.title, "Vector DB Guide");
  assert.ok(ex.text.includes("sqlite-vec is a SQLite extension"));
  assert.ok(!ex.text.includes("var t=1"));
  assert.ok(!ex.text.includes("© 2026"));
  assert.ok(!ex.text.includes("Pricing | Login"));
});

test("splitSegments: paragraph+sentence aware, ~300 chars", () => {
  const ex = extractHtml(PAGE);
  const segs = splitSegments(ex.text);
  assert.ok(segs.length >= 3);
  for (const s of segs) assert.ok(s.length <= 400, `segment too long: ${s.length}`);
});

test("extractFocus: hit+adjacent segments, big saving, misses return null", () => {
  const ex = extractHtml(PAGE);
  const full = ex.text;
  const hits = extractFocus(full, "bge-m3 embedding sqlite-vec", 8000, 1);
  assert.ok(hits, "should hit");
  const joined = hits!.join("\n");
  assert.ok(joined.includes("bge-m3"), "focused output contains the hit");
  assert.ok(joined.length < full.length * 0.9, "should save meaningful tokens");
  // 完全无命中
  assert.equal(extractFocus(full, "量子引力 波函数坍缩", 8000, 1), null);
});

test("extractFocus: budget respected on repeated-term stuffing", () => {
  const text = ("keyword stuffing segment. " + "spam ".repeat(60) + "\n\n").repeat(30) +
    "final relevant segment about BM25 ranking function.";
  const out = extractFocus(text, "BM25 ranking", 1500, 0);
  assert.ok(out, "hit expected");
  assert.ok(out!.join("").length <= 1600 + 350, "budget roughly respected");
});

test("fixture page: end-to-end extract+focus", () => {
  const html = readFileSync(join(here, "fixtures", "sample-page.html"), "utf8");
  const ex = extractHtml(html);
  assert.ok(ex.title.includes("Perplexica"));
  const segs = extractFocus(ex.text, "SearXNG engines parameter", 3000, 1);
  assert.ok(segs);
  assert.ok(segs!.join(" ").includes("SearXNG"));
});
