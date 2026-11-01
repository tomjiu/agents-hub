/**
 * v0.4 行为测试: 失败分类器 / 熔断 2.0(分类阈值+半开翻倍) / QuotaTracker / 软截止 / key 插槽自动并联
 * (wigolo[09] 失败标注契约 + 10-b Tavily 三档状态码的落地回归)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cache } from "../cache.js";
import { HealthTracker, classifyFailure } from "../providers/base.js";
import { QuotaTracker } from "../quota.js";
import { Router } from "../router.js";
import { loadConfig } from "../config.js";
import type { SearchOptions, EngineStatus } from "../types.js";
import type { Provider, SearchCtx } from "../providers/base.js";

function tmpCache() {
  const dir = mkdtempSync(join(tmpdir(), "sc-b2-"));
  return { dir, cache: new Cache(dir) };
}

const OPTS: SearchOptions = { timeoutMs: 5000 };

function mkProvider(name: string, fn: (q: string, signal: AbortSignal) => Promise<number>, keySlot = false): Provider {
  return {
    name,
    needsKey: false,
    keySlot,
    isConfigured: () => true,
    search: async (q: string, ctx: SearchCtx) => {
      const n = await fn(q, ctx.signal);
      return Array.from({ length: n }, (_, i) => ({
        url: `https://${name}.io/${i}`, title: name, snippet: "", engines: [name],
      }));
    },
  };
}

// ---------- classifyFailure ----------

test("classifyFailure: 六类失败各自归位", () => {
  const cases: [string, EngineStatus, boolean][] = [
    ["ddg http 429 (rate limited)", "rate_limited", true],
    ["ddg http 202 (soft-block empty page)", "rate_limited", true],
    ["please reduce rate of requests", "rate_limited", true],
    ["tavily http 432 (plan quota exceeded)", "quota", false],
    ["tavily http 433 (payg quota exceeded)", "quota", false],
    ["http 402 payment required", "quota", false],
    ["tavily http 401 (unauthorized invalid api key)", "auth", false],
    ["github http 403", "blocked", false],
    ["captcha / unusual traffic detected", "blocked", false],
    ["anubis challenge page", "blocked", false],
    ["This operation was aborted", "timeout", true],
    ["socket hang up (ETIMEDOUT)", "timeout", true],
    ["boom 503", "error", true],
    ["unexpected markup: parser failed", "error", true],
  ];
  for (const [msg, status, retryable] of cases) {
    const got = classifyFailure(msg);
    assert.equal(got.status, status, `msg=${msg}`);
    assert.equal(got.retryable, retryable, `msg=${msg}`);
  }
});

// ---------- 熔断 2.0 ----------

test("熔断2.0: blocked 两连败即熔断15分钟; error 仍需六连败", () => {
  const { dir, cache } = tmpCache();
  try {
    const h = new HealthTracker(cache);
    for (let i = 0; i < 2; i++) h.record("bl", false, 10, "github http 403");
    assert.equal(h.isOpen("bl"), true, "blocked 2 连败应熔断");
    const st = JSON.parse(cache.kvGet("health:bl")!);
    assert.ok(st.openUntil - Date.now() > 14 * 60 * 1000, "冷却≈15min");

    const h2 = new HealthTracker(cache);
    for (let i = 0; i < 5; i++) h2.record("er", false, 10, "boom 503");
    assert.equal(h2.isOpen("er"), false, "error 5 连败不应熔断");
    h2.record("er", false, 10, "boom 503");
    assert.equal(h2.isOpen("er"), true, "error 6 连败应熔断");
    const st2 = JSON.parse(cache.kvGet("health:er")!);
    assert.ok(st2.openUntil - Date.now() > 9 * 60 * 1000, "冷却≈10min");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cache.close();
  }
});

test("熔断2.0: 换失败类别连败计数重置", () => {
  const { dir, cache } = tmpCache();
  try {
    const h = new HealthTracker(cache);
    h.record("m", false, 10, "http 403 blocked");       // blocked 计 1
    h.record("m", false, 10, "boom 503");                // 换类 → error 计 1
    h.record("m", false, 10, "http 403 blocked");        // 换类 → blocked 计 1(重置)
    assert.equal(h.isOpen("m"), false, "三类各 1 次都不该熔断");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cache.close();
  }
});

test("熔断2.0: 半开探针失败 → 冷却翻倍; 成功 → 全复位", () => {
  const { dir, cache } = tmpCache();
  try {
    const h = new HealthTracker(cache);
    for (let i = 0; i < 2; i++) h.record("hb", false, 10, "http 403");
    // 手动把冷却期拨到过去(模拟时间流逝到半开探针窗口)
    const st = JSON.parse(cache.kvGet("health:hb")!);
    const firstCooldown = st.cooldownMs as number;
    st.openUntil = Date.now() - 1;
    cache.kvSet("health:hb", JSON.stringify(st));

    h.record("hb", false, 10, "http 403"); // 半开探针又栽
    const st2 = JSON.parse(cache.kvGet("health:hb")!);
    assert.equal(st2.cooldownMs, firstCooldown * 2, "冷却应翻倍");

    // 再拨时间 → 成功 → 全复位
    st2.openUntil = Date.now() - 1;
    cache.kvSet("health:hb", JSON.stringify(st2));
    h.record("hb", true, 10);
    const st3 = JSON.parse(cache.kvGet("health:hb")!);
    assert.equal(st3.openUntil, 0);
    assert.equal(st3.cooldownMs, 0);
    assert.equal(st3.streakCount, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cache.close();
  }
});

// ---------- QuotaTracker ----------

test("QuotaTracker: 计数到顶判死 + 432 一票标记 + 月度滚动重置", () => {
  const { dir, cache } = tmpCache();
  try {
    const q = new QuotaTracker(cache, { tavily: 3 });
    assert.equal(q.governed("tavily"), true);
    assert.equal(q.governed("mojeek"), false);
    assert.equal(q.allow("mojeek"), true, "不受管控的引擎永远放行");

    q.record("tavily"); q.record("tavily");
    assert.equal(q.allow("tavily"), true);
    assert.equal(q.snapshot("tavily")!.remaining, 1);
    q.record("tavily");
    assert.equal(q.allow("tavily"), false, "3/3 用完判死");
    assert.equal(q.snapshot("tavily")!.exhausted, true);

    // 一票标记: 高额度引擎被 432 砸中当月直接死
    const q2 = new QuotaTracker(cache, { brave: 1000 });
    q2.exhaust("brave");
    assert.equal(q2.allow("brave"), false);

    // 月度滚动: 改写记录月份 → 自动重置
    const rec = JSON.parse(cache.kvGet("quota:tavily")!);
    rec.month = "2000-01";
    cache.kvSet("quota:tavily", JSON.stringify(rec));
    assert.equal(q.allow("tavily"), true, "跨月应重置");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cache.close();
  }
});

// ---------- Router: 软截止 ----------

test("Router 软截止: 到点收割快腿,慢腿标记 timeout 不再干等", async () => {
  const { dir, cache } = tmpCache();
  try {
    const cfg = loadConfig({ dataDir: dir, softDeadlineMs: 60, timeoutMs: 10_000, keySlots: "off" });
    const health = new HealthTracker(cache);
    const fast = mkProvider("fast", async () => 1);
    const slow = mkProvider("slow", async (_q, signal) => {
      // 信号感知型慢腿: 软截止 abort 时立刻拒绝(模拟真网络被断)
      await new Promise<never>((_res, rej) => {
        const t = setTimeout(() => rej(new Error("slow finally done")), 10_000);
        signal.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted by soft deadline")); }, { once: true });
      });
      return 0;
    });
    const router = new Router({ config: cfg, health, cache, providers: [fast, slow] });
    const t0 = Date.now();
    const { refs, used, failed, degraded } = await router.run("q", OPTS, ["fast", "slow"]);
    const dt = Date.now() - t0;
    assert.ok(dt < 2000, `应在软截止附近返回(实际 ${dt}ms)`);
    assert.deepEqual(used, ["fast"]);
    assert.equal(refs.length, 1);
    const slowF = failed.find((f) => f.name === "slow");
    assert.ok(slowF, "慢腿应出现在 failed");
    assert.equal(slowF!.status, "timeout");
    assert.equal(slowF!.retryable, true);
    assert.equal(degraded, false, "2 腿去 1 = 50% 未到降级线");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cache.close();
  }
});

// ---------- Router: AG-2 早收割 ----------

test("Router 早收割: 到点后 60% 腿结算+refs 够 → 断慢腿交付,不等满软截止", async () => {
  const { dir, cache } = tmpCache();
  try {
    // 软截止 6s(默认量级) + 早收割 300ms: 3 条快腿各回 8 条(refs=24≥15), 1 条慢腿挂死
    const cfg = loadConfig({ dataDir: dir, softDeadlineMs: 6000, earlyHarvestMs: 300, timeoutMs: 10_000, keySlots: "off" });
    const health = new HealthTracker(cache);
    const fasts = ["f1", "f2", "f3"].map((n) => mkProvider(n, async () => 8));
    const slow = mkProvider("slow", async (_q, signal) => {
      await new Promise<never>((_res, rej) => {
        const t = setTimeout(() => rej(new Error("slow finally done")), 10_000);
        signal.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted by early harvest")); }, { once: true });
      });
      return 0;
    });
    const router = new Router({ config: cfg, health, cache, providers: [...fasts, slow] });
    const t0 = Date.now();
    const { refs, used, failed, degraded } = await router.run("q", OPTS, ["f1", "f2", "f3", "slow"]);
    const dt = Date.now() - t0;
    assert.ok(dt < 2000, `早收割应在 300ms 量级返回(实际 ${dt}ms), 不能等满 6s 软截止`);
    assert.deepEqual(used, ["f1", "f2", "f3"]);
    assert.equal(refs.length, 24);
    const slowF = failed.find((f) => f.name === "slow");
    assert.ok(slowF, "被断慢腿应出现在 failed");
    assert.equal(slowF!.status, "timeout");
    assert.equal(slowF!.retryable, true);
    assert.equal(degraded, false, "4 腿去 3 = 75% 在场");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cache.close();
  }
});

test("Router 早收割: 证据不足(refs<15)不触发,软截止兜底语义不变", async () => {
  const { dir, cache } = tmpCache();
  try {
    // 快腿只回 2 条(refs=2<15) → 早收割条件不满足 → 等满软截止(这里 250ms 量级)
    const cfg = loadConfig({ dataDir: dir, softDeadlineMs: 250, earlyHarvestMs: 50, timeoutMs: 10_000, keySlots: "off" });
    const health = new HealthTracker(cache);
    const fast = mkProvider("fast", async () => 2);
    const slow = mkProvider("slow", async (_q, signal) => {
      await new Promise<never>((_res, rej) => {
        const t = setTimeout(() => rej(new Error("slow finally done")), 10_000);
        signal.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted by soft deadline")); }, { once: true });
      });
      return 0;
    });
    const router = new Router({ config: cfg, health, cache, providers: [fast, slow] });
    const t0 = Date.now();
    await router.run("q", OPTS, ["fast", "slow"]);
    const dt = Date.now() - t0;
    assert.ok(dt >= 250, `refs 不足时不得提前收割(实际 ${dt}ms, 应≥softDeadline 250ms)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cache.close();
  }
});

// ---------- Router: 额度门 + 432 一票标记 ----------

test("Router 额度门: 插槽额度用尽自动跳过,免 key 池照常出结果", async () => {
  const { dir, cache } = tmpCache();
  try {
    const cfg = loadConfig({ dataDir: dir, keySlots: "off", softDeadlineMs: 0 });
    const health = new HealthTracker(cache);
    const quota = new QuotaTracker(cache, { slotp: 1 });
    const keyless = mkProvider("keyless-ok", async () => 2);
    const slot = mkProvider("slotp", async () => 1, true);
    const router = new Router({ config: cfg, health, cache, providers: [keyless, slot], quota });

    const r1 = await router.run("q", OPTS, ["keyless-ok", "slotp"]);
    assert.deepEqual(r1.used.sort(), ["keyless-ok", "slotp"]);
    assert.equal(r1.skipped.length, 0);

    const r2 = await router.run("q", OPTS, ["keyless-ok", "slotp"]);
    assert.deepEqual(r2.used, ["keyless-ok"], "额度尽后插槽被跳过");
    assert.equal(r2.skipped[0].status, "quota_exhausted");
    assert.match(r2.skipped[0].detail ?? "", /limit 1/);
    assert.equal(r2.refs.length, 2, "免 key 池结果不受影响");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cache.close();
  }
});

test("Router: 插槽引擎返回 432 → failed 标 quota + 当月一票判死", async () => {
  const { dir, cache } = tmpCache();
  try {
    const cfg = loadConfig({ dataDir: dir, keySlots: "off", softDeadlineMs: 0 });
    const health = new HealthTracker(cache);
    const quota = new QuotaTracker(cache, { tavilyfake: 100 });
    const ok = mkProvider("ok", async () => 1);
    const dead = mkProvider("tavilyfake", async () => {
      throw new Error("tavily http 432 (plan quota exceeded)");
    }, true);
    const router = new Router({ config: cfg, health, cache, providers: [ok, dead], quota });

    const r1 = await router.run("q", OPTS, ["ok", "tavilyfake"]);
    assert.equal(r1.failed[0].status, "quota");
    assert.equal(r1.failed[0].retryable, false);
    assert.equal(quota.allow("tavilyfake"), false, "432 应一票判死");

    const r2 = await router.run("q", OPTS, ["ok", "tavilyfake"]);
    assert.deepEqual(r2.used, ["ok"]);
    // quota 类失败阈值=1 → 熔断(30min)先于额度门生效,诚实原因应是 circuit_open;
    // 两条保险都亮灯: allow() 仍为 false(上面已断言)
    assert.ok(
      ["circuit_open", "quota_exhausted"].includes(r2.skipped[0]?.status ?? ""),
      `实际 ${r2.skipped[0]?.status}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cache.close();
  }
});

// ---------- Router: key 插槽自动并联 + degraded ----------

test("Router 插槽自动并联: 默认池时可用插槽自动加入;off 或额度尽则不加入", async () => {
  const { dir, cache } = tmpCache();
  try {
    const keyless = mkProvider("k-ok", async () => 1);
    const slot = mkProvider("slotp", async () => 1, true);

    const cfgAuto = loadConfig({ dataDir: dir, engines: ["k-ok"], keySlots: "auto", softDeadlineMs: 0 });
    const routerAuto = new Router({
      config: cfgAuto, health: new HealthTracker(cache), cache, providers: [keyless, slot],
      quota: new QuotaTracker(cache, { slotp: 100 }),
    });
    // 注: 上面 quota map 已被前一个测试文件级共享? 不——每次 tmpCache 独立。这里 slotp 有额度 → 自动并入
    const r1 = await routerAuto.run("q", OPTS); // 未点名 → 默认池 + 自动并联
    assert.deepEqual(r1.used.sort(), ["k-ok", "slotp"]);

    const cfgOff = loadConfig({ dataDir: dir, engines: ["k-ok"], keySlots: "off", softDeadlineMs: 0 });
    const routerOff = new Router({
      config: cfgOff, health: new HealthTracker(cache), cache, providers: [keyless, slot],
      quota: new QuotaTracker(cache, { slotp: 100 }),
    });
    const r2 = await routerOff.run("q", OPTS);
    assert.deepEqual(r2.used, ["k-ok"], "keySlots=off 不自动并联");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cache.close();
  }
});

test("Router degraded: 大面积缺席时给出降级信号", async () => {
  const { dir, cache } = tmpCache();
  try {
    const cfg = loadConfig({ dataDir: dir, keySlots: "off", softDeadlineMs: 0 });
    const health = new HealthTracker(cache);
    const ok = mkProvider("ok", async () => 1);
    const bad1 = mkProvider("bad1", async () => { throw new Error("github http 403"); });
    const bad2 = mkProvider("bad2", async () => { throw new Error("http 403"); });
    const router = new Router({ config: cfg, health, cache, providers: [ok, bad1, bad2] });
    const { degraded, failed } = await router.run("q", OPTS, ["ok", "bad1", "bad2"]);
    assert.equal(degraded, true, "3 腿只剩 1 → 降级");
    assert.equal(failed.length, 2);
    assert.ok(failed.every((f) => f.status === "blocked" && !f.retryable));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cache.close();
  }
});

// ---------- phase AC: 额度可见性(listProviders 透出 quota 快照) ----------

test("Router listProviders: 受控引擎透出 quota 余量/耗尽/重置时间, 非受控无该字段", async () => {
  const { dir, cache } = tmpCache();
  try {
    const cfg = loadConfig({ dataDir: dir, keySlots: "off", softDeadlineMs: 0 });
    const health = new HealthTracker(cache);
    const quota = new QuotaTracker(cache, { slotp: 2 });
    const slot = mkProvider("slotp", async () => 1, true);
    const free = mkProvider("free-p", async () => 1, false);
    const router = new Router({ config: cfg, health, cache, providers: [free, slot], quota });

    let snap = router.listProviders().find((p) => p.name === "slotp");
    assert.ok(snap?.quota, "受控引擎应有 quota 快照");
    assert.equal(snap.quota!.limit, 2);
    assert.equal(snap.quota!.used, 0);
    assert.equal(snap.quota!.exhausted, false);
    assert.ok(snap.quota!.resetsAt, "应带月度重置时间");
    assert.equal(router.listProviders().find((p) => p.name === "free-p")?.quota, undefined,
      "非受控引擎不应有 quota 字段(诚实口径: 没登记就没额度语义)");

    await router.run("q", OPTS, ["slotp", "free-p"]);
    await router.run("q", OPTS, ["slotp"]);
    snap = router.listProviders().find((p) => p.name === "slotp");
    assert.equal(snap!.quota!.used, 2);
    assert.equal(snap!.quota!.exhausted, true, "计数到顶应标 exhausted");
    assert.equal(snap!.quota!.remaining, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    cache.close();
  }
});
