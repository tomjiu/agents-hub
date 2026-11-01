/**
 * v0.2 测试: X 降级链(xchain) — queryId 提取/自愈、层降级、oEmbed 增强
 * 全部离线: fetchImpl 注入假响应。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import { Cache } from "../cache.js";
import { HealthTracker } from "../providers/base.js";
import { xSearchChain, extractSearchQueryId } from "../xchain.js";
import type { XChainDeps } from "../xchain.js";
import type { Reference } from "../types.js";

const HEX64 = "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8";

function tmpDir(): { dir: string; clean: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "sc-x-"));
  return { dir, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("xchain: extractSearchQueryId finds 64-hex queryId near SearchTimeline in bundle", async () => {
  const { dir, clean } = tmpDir();
  try {
    const cache = new Cache(dir);
    const cfg = loadConfig({ dataDir: dir, engines: [] } as never);
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      if (u.startsWith("https://x.com/home")) {
        return new Response(
          `<html><script src="https://abs.twimg.com/responsive-web/client-web/main.9f8e7d.js"></script></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      if (u.includes("main.9f8e7d.js")) {
        const js = `window.tweetUtils={};__chunk={operationType:"query",queryId:"${HEX64}",operationName:"SearchTimeline",endpoint:"/i/api/graphql"};`;
        return new Response(js, { status: 200, headers: { "Content-Type": "application/javascript" } });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const deps: XChainDeps = {
      config: cfg, cache, health: new HealthTracker(cache),
      fetchImpl, runKeyless: async () => ({ refs: [], used: [], failed: [] }),
    };
    const qid = await extractSearchQueryId(deps);
    assert.equal(qid, HEX64);
    // 缓存命中: 二次调用不再 fetch
    const qid2 = await extractSearchQueryId(deps);
    assert.equal(qid2, HEX64);
    cache.close();
  } finally {
    clean();
  }
});

test("xchain: guest layer fails → keyless still returns (层间独立,不阻塞)", async () => {
  const { dir, clean } = tmpDir();
  try {
    const cache = new Cache(dir);
    const cfg = loadConfig({
      dataDir: dir, engines: [], x: { guestEnabled: true },
    } as never);
    const keylessRef: Reference = {
      url: "https://x.com/someone/status/123456", title: "@someone",
      snippet: "short snippet only", engines: ["duckduckgo"], kind: "x",
    };
    const fetchImpl = (async () => new Response("denied", { status: 403 })) as unknown as typeof fetch;
    const health = new HealthTracker(cache);
    const deps: XChainDeps = {
      config: cfg, cache, health, fetchImpl,
      runKeyless: async () => ({ refs: [keylessRef], used: ["duckduckgo"], failed: [] }),
    };
    const r = await xSearchChain("test query", {}, deps);
    assert.ok(r.used.includes("x-keyless"));
    assert.ok(r.failed.some((f) => f.name === "x-guest"), `failed=${JSON.stringify(r.failed)}`);
    assert.equal(r.refs.length, 1);
    // 熔断计数已记
    assert.ok(health.snapshot("x-guest", true, false).fail >= 1);
    cache.close();
  } finally {
    clean();
  }
});

test("xchain: oEmbed enhances keyless statuses with longer text", async () => {
  const { dir, clean } = tmpDir();
  try {
    const cache = new Cache(dir);
    const cfg = loadConfig({ dataDir: dir, engines: [], x: { guestEnabled: false } } as never);
    const keylessRef: Reference = {
      url: "https://x.com/someone/status/777", title: "@someone",
      snippet: "short", engines: ["duckduckgo"], kind: "x",
    };
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      if (u.includes("cdn.syndication.twimg.com/tweet-result")) {
        return jsonResponse({ text: "This is the FULL tweet text fetched via syndication oEmbed endpoint, much longer than the search snippet.", created_at: "2026-05-01T00:00:00Z" });
      }
      return new Response("no", { status: 404 });
    }) as unknown as typeof fetch;
    const deps: XChainDeps = {
      config: cfg, cache, health: new HealthTracker(cache), fetchImpl,
      runKeyless: async () => ({ refs: [keylessRef], used: ["duckduckgo"], failed: [] }),
    };
    const r = await xSearchChain("q", {}, deps);
    assert.equal(r.refs.length, 1);
    assert.match(r.refs[0].snippet, /FULL tweet text/);
    assert.ok(r.refs[0].engines.includes("x-oembed"));
    cache.close();
  } finally {
    clean();
  }
});

test("xchain: official layer with Bearer token parses recent search", async () => {
  const { dir, clean } = tmpDir();
  try {
    const cache = new Cache(dir);
    const cfg = loadConfig({
      dataDir: dir, engines: [], x: { guestEnabled: false, bearerToken: "TESTBEARER" },
    } as never);
    let sawAuth = "";
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url instanceof Request ? url.url : url);
      if (u.includes("/2/tweets/search/recent")) {
        sawAuth = String((init?.headers as Record<string, string>).Authorization ?? "");
        return jsonResponse({
          data: [
            { id: "1001", text: "official API tweet text about things", created_at: "2026-08-01T10:00:00Z", author_id: "u1" },
          ],
          includes: { users: [{ id: "u1", username: "official_user" }] },
        });
      }
      return new Response("no", { status: 404 });
    }) as unknown as typeof fetch;
    const deps: XChainDeps = {
      config: cfg, cache, health: new HealthTracker(cache), fetchImpl,
      runKeyless: async () => ({ refs: [], used: [], failed: [] }),
    };
    const r = await xSearchChain("q", {}, deps);
    assert.equal(sawAuth, "Bearer TESTBEARER");
    assert.ok(r.used.includes("x-official"));
    assert.equal(r.refs.length, 1);
    assert.equal(r.refs[0].url, "https://x.com/official_user/status/1001");
    cache.close();
  } finally {
    clean();
  }
});
