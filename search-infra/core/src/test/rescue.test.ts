/**
 * phase AH(vs-zai 第 11 采样, 24 题全量): 零结果抢救腿行为测试
 *
 * 实测翻车面(github 专项窄腿全灭 → 1ms 零 refs; images 单腿合法空 → 整题塌方):
 *   本文件锁三类行为:
 *   1. 窄腿全失败(refs=0) → 聚合器抢救轮出勤, refs>0 + meta.rescued=true;
 *   2. 正常出勤(refs>0) → 不触发抢救(零开销, meta.rescued 虚缺);
 *   3. 用户 engines 排除的引擎不被抢救强注入(engines=[窄腿] → 抢救自动失效, 空结果原语义)。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SearchCore } from "../engine.js";

// ddg 全局限速门(进程级 lastDdgAt, 默认 3s 间隔)跨测试泄漏 → 腿睡满 gate 才发请求,
// 轮询循环等到软截止+迟到排水(第 11 采样 rescue 测试实测 3003ms)。测试注入 0 关门。
process.env.SC_DDG_MIN_INTERVAL_MS = "0";

function fakeFetchFactory(blockHosts: string[]) {
  return async (url: string | URL): Promise<Response> => {
    const u = String(url);
    if (blockHosts.some((h) => u.includes(h))) return new Response("forbidden", { status: 403 });
    if (u.includes("/search?") && u.includes("format=json")) {
      return Response.json({
        results: [{ url: "https://example.org/rescued", title: "rescued hit", content: "github actions cache docker layers" }],
      });
    }
    if (u.includes("api.keenable.ai")) {
      return Response.json({
        results: [{ url: "https://example.org/khit", title: "keenable hit", description: "github actions cache" }],
      });
    }
    return new Response("not found", { status: 404 });
  };
}

test("rescue: github 窄腿全灭 → 聚合器抢救轮出勤(refs>0 + meta.rescued)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc-rescue-"));
  try {
    const core = new SearchCore({
      config: {
        dataDir: dir,
        engines: ["github", "duckduckgo", "mojeek", "searxng", "keenable"],
        keySlots: "off", timeoutMs: 800, softDeadlineMs: 3000, earlyHarvestMs: 0,
      } as never,
      fetchImpl: fakeFetchFactory(["api.github.com", "duckduckgo", "mojeek"]) as never,
    });
    // "github" 关键词 → planner route=github → 窄腿 [github, duckduckgo, mojeek] 全 403 → refs=0 → 抢救
    const r = await core.search("github actions cache docker layers", { noCache: true });
    assert.equal(r.meta.rescued, true, "抢救轮应标记 meta.rescued");
    assert.ok(r.refs.length > 0, "抢救后应有结果");
    assert.ok(
      r.meta.enginesUsed.some((e) => e === "searxng" || e === "keenable"),
      `出勤应含聚合器, 实际 ${JSON.stringify(r.meta.enginesUsed)}`,
    );
    core.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rescue: 正常出勤不触发抢救(零开销)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc-rescue-"));
  try {
    const core = new SearchCore({
      config: {
        dataDir: dir,
        engines: ["searxng", "keenable"],
        keySlots: "off", timeoutMs: 800, softDeadlineMs: 3000, earlyHarvestMs: 0,
      } as never,
      fetchImpl: fakeFetchFactory([]) as never,
    });
    const r = await core.search("some normal query", { noCache: true });
    assert.equal(r.meta.rescued, false, "refs>0 不应触发抢救");
    assert.ok(r.refs.length > 0);
    core.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rescue: 用户 engines 排除聚合器 → 抢救自动失效(空结果原语义)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc-rescue-"));
  try {
    const core = new SearchCore({
      config: {
        dataDir: dir,
        engines: ["github", "duckduckgo", "mojeek"],
        keySlots: "off", timeoutMs: 800, softDeadlineMs: 3000, earlyHarvestMs: 0,
      } as never,
      fetchImpl: fakeFetchFactory(["api.github.com", "duckduckgo", "mojeek"]) as never,
    });
    const r = await core.search("github actions cache docker layers", { noCache: true });
    assert.equal(r.meta.rescued, false, "聚合器被用户排除 → 无抢救轮");
    assert.equal(r.refs.length, 0, "保持空结果原语义(尊重用户配置)");
    core.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
