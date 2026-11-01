/**
 * Router 行为测试: allSettled 容错 / 熔断 / x 路由 (全部 mock fetch)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cache } from "../cache.js";
import { HealthTracker } from "../providers/base.js";
import { Router, buildProviders } from "../router.js";
import { loadConfig } from "../config.js";
import type { SearchOptions } from "../types.js";

function tmpCore() {
  const dir = mkdtempSync(join(tmpdir(), "sc-router-"));
  const cache = new Cache(dir);
  const health = new HealthTracker(cache);
  return { dir, cache, health };
}

const OPTS: SearchOptions = { timeoutMs: 3000 };

test("buildProviders wires config into slots", () => {
  const cfg = loadConfig({ dataDir: mkdtempSync(join(tmpdir(), "sc-cfg-")), searxng: { baseUrl: "https://s.x" }, brave: { apiKey: "k" } });
  const ps = buildProviders(cfg);
  const byName = new Map(ps.map((p) => [p.name, p]));
  assert.equal(byName.get("searxng")!.isConfigured(), true);
  assert.equal(byName.get("brave")!.isConfigured(), true);
  // phase AB: tavily keyless 车道常在(有 key 走 Bearer, 无 key 走官方匿名车道) → 恒 configured
  assert.equal(byName.get("tavily")!.isConfigured(), true);
  assert.equal(byName.get("duckduckgo")!.isConfigured(), true);
  // phase AB: 新成员注册检查(anysearch 默认池/firecrawl 显式/pubmed+sov2ex 域路由)
  for (const n of ["anysearch", "firecrawl", "pubmed", "sov2ex"]) {
    assert.ok(byName.has(n), `缺新 provider: ${n}`);
    assert.equal(byName.get(n)!.isConfigured(), true, `${n} 应免 key 在线`);
  }
});

test("router: one engine failing does not break others (allSettled)", async () => {
  const { dir, cache, health } = tmpCore();
  try {
    const cfg = loadConfig({ dataDir: dir, engines: ["ddg-ok", "ddg-fail"], timeoutMs: 3000 });
    const okP = {
      name: "ddg-ok",
      needsKey: false,
      isConfigured: () => true,
      search: async () => [{ url: "https://ok.io/1", title: "OK", snippet: "s", engines: ["ddg-ok"] }],
    };
    const failP = {
      name: "ddg-fail",
      needsKey: false,
      isConfigured: () => true,
      search: async () => {
        throw new Error("boom 503");
      },
    };
    const router = new Router({ config: cfg, health, providers: [okP, failP] });
    const { refs, used, failed } = await router.run("q", OPTS, ["ddg-ok", "ddg-fail"]);
    assert.deepEqual(used, ["ddg-ok"]);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].name, "ddg-fail");
    assert.match(failed[0].error, /boom 503/);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].url, "https://ok.io/1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cache.close();
  }
});

test("router: unconfigured engines are skipped; circuit-open skipped", async () => {
  const { dir, cache, health } = tmpCore();
  try {
    const cfg = loadConfig({ dataDir: dir, timeoutMs: 3000 });
    const offP = {
      name: "off-engine",
      needsKey: true,
      isConfigured: () => false,
      search: async () => [],
    };
    const hotP = {
      name: "hot-engine",
      needsKey: false,
      isConfigured: () => true,
      search: async () => [{ url: "https://hot.io/1", title: "H", snippet: "", engines: ["hot-engine"] }],
    };
    const router = new Router({ config: cfg, health, providers: [offP, hotP] });
    for (let i = 0; i < 6; i++) health.record("hot-engine", false, 5, "err"); // 触发熔断
    const { used } = await router.run("q", OPTS, ["off-engine", "hot-engine"]);
    assert.deepEqual(used, [], "both skipped");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cache.close();
  }
});

test("health: 6 consecutive failures opens circuit", async () => {
  const { dir, cache, health } = tmpCore();
  try {
    for (let i = 0; i < 6; i++) health.record("dead-engine", false, 10, "err");
    assert.equal(health.isOpen("dead-engine"), true);
    health.record("dead-engine", true, 10); // 一次成功即恢复
    assert.equal(health.isOpen("dead-engine"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cache.close();
  }
});

test("router.runX: sets kind=x on refs (v0.2 chain → keyless layer)", async () => {
  const { dir, cache, health } = tmpCore();
  try {
    const cfg = loadConfig({
      dataDir: dir, engines: ["duckduckgo"], timeoutMs: 3000,
      // v0.2: 关掉 guest 层,只走 keyless(测试无网络)
      x: { guestEnabled: false },
    });
    const router = new Router({
      config: cfg,
      health,
      fetchImpl: (async () =>
        new Response(
          `<html><body><div class="result"><h2 class="result__title"><a class="result__a" href="https://x.com/user/status/1">A post on X</a></div></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        )) as never,
    });
    const { refs, used } = await router.runX("grok build", OPTS, "tweets");
    // v0.2: used 是层名(x-keyless),refs engines 带 x-keyless: 前缀
    assert.ok(used.includes("x-keyless"), `used should contain x-keyless, got ${used}`);
    assert.ok(refs.length >= 1);
    assert.equal(refs[0].kind, "x");
    assert.ok(refs[0].engines.some((e) => e.startsWith("x-keyless:")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cache.close();
  }
});
