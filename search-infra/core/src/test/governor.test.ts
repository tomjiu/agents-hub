import { test } from "node:test";
import assert from "node:assert/strict";
import { Budget, BudgetExceededError, checkDomain, validateUrl, domainMatch } from "../governor.js";
import { Cache } from "../cache.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------- Budget ----------

test("Budget: charge/tryCharge/exceeded", () => {
  const b = new Budget(1000);
  b.charge(400, "a");
  assert.ok(b.tryCharge(400, "b"));
  assert.equal(b.remaining, 200);
  assert.equal(b.tryCharge(500, "c"), false);
  assert.throws(() => b.charge(500, "c"), BudgetExceededError);
  assert.equal(b.ledger.length, 2);
});

// ---------- 域名治理 ----------

test("domainMatch + checkDomain: global/run/allowlist", () => {
  assert.ok(domainMatch("seo-farm.example.com", "example.com"));
  assert.ok(domainMatch("example.com", "example.com"));
  assert.ok(!domainMatch("notexample.com", "example.com"));

  const policy = { globalBlocked: ["spam.io"], block: ["banned.dev"], allow: ["good.org", "ok.net"] };
  assert.ok(checkDomain("https://a.spam.io/x", policy)?.includes("global"));
  assert.ok(checkDomain("https://banned.dev/y", policy)?.includes("run"));
  assert.ok(checkDomain("https://unknown.site/z", policy)?.includes("allowlist"));
  assert.equal(checkDomain("https://good.org/p", policy), null);
});

// ---------- URL/SSRF ----------

test("validateUrl: protocol/port/size", () => {
  assert.ok("error" in validateUrl("file:///etc/passwd"));
  assert.ok("error" in validateUrl("http://127.0.0.1:22/x"));
  assert.ok("error" in validateUrl("not a url"));
  const ok = validateUrl("https://example.com/page");
  assert.ok(!("error" in ok));
});

test("assertResolvableSafe: blocks localhost via DNS", async () => {
  const { assertResolvableSafe } = await import("../governor.js");
  const r = await assertResolvableSafe(new URL("http://localhost:80/x"));
  assert.ok("error" in r, "localhost must be blocked");
  // fake-ip 豁免: 198.18.0.5 属 Clash TUN fake-ip 段
  const r2 = await assertResolvableSafe(new URL("http://example.com/"), {
    fakeIpCidrs: ["198.18.0.0/15"],
  });
  assert.ok(!("error" in r2) || !r2.error.includes("private"), "public domain resolves fine");
});

// ---------- Cache ----------

test("Cache: page ttl + search cache + kv counters", () => {
  const dir = mkdtempSync(join(tmpdir(), "sc-test-"));
  try {
    const c = new Cache(dir);
    c.putPage("https://a.com", 200, "text/html", "A", "hello world".repeat(10));
    assert.ok(c.getPage("https://a.com", 900));
    assert.equal(c.getPage("https://a.com", -1), null); // TTL 过期
    assert.ok(c.peekPage("https://a.com")); // 存在性不受 TTL 影响

    c.putSearch("k1", { refs: [1, 2] });
    assert.deepEqual(c.getSearch("k1"), { refs: [1, 2] });
    assert.equal(c.getSearch("k1", -1), null);

    assert.equal(c.kvIncr("hits"), 1);
    assert.equal(c.kvIncr("hits"), 2);
    c.clearSearchCache();
    assert.equal(c.getSearch("k1"), null);
    const st = c.stats();
    assert.ok(st.pages === 1 && st.pageChars > 0);
    c.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
