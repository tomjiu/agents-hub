/**
 * v0.2 测试: Research Loop 状态机
 * - 注入 fake provider + fake fetchImpl(页面含 focus 词,quote 可抽)
 * - 覆盖: 快速收敛 / max_loops 降级 / fetch 预算停 / 断点恢复(replay+续跑) /
 *         引用出口校验 100% / 单角度失败不阻塞
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type CoreConfig } from "../config.js";
import { Cache } from "../cache.js";
import { HealthTracker } from "../providers/base.js";
import { Router } from "../router.js";
import { Fetcher } from "../fetcher.js";
import { ResearchLoop, ResearchState, reflect, decide } from "../research.js";
import { auditCitations } from "../citations.js";
import type { Provider, SearchCtx } from "../providers/base.js";
import type { Reference } from "../types.js";

const QUERY = "vector database landscape";
const ANGLES = ["definition", "comparison"];

let urlCounter = 0;

/** fake provider: 每个 search 产 n 条新 URL;可按 query 关键词选择性失败/空手
 *  snippet/title 回显 query(真实引擎行为: 结果含角度关键词 → slot 归角可判定) */
function fakeProvider(opts: { perSearch: number; emptyFor?: string }): Provider {
  return {
    name: "fake",
    needsKey: false,
    isConfigured: () => true,
    async search(query: string, _ctx: SearchCtx): Promise<Reference[]> {
      if (opts.emptyFor && query.toLowerCase().includes(opts.emptyFor)) return [];
      const out: Reference[] = [];
      for (let i = 0; i < opts.perSearch; i++) {
        urlCounter++;
        const n = urlCounter;
        out.push({
          url: `https://p.test/doc/${n}`,
          title: `${query} — doc ${n}`,
          snippet: `${query} overview part ${n}`,
          engines: ["fake"],
          rank: i + 1,
        });
      }
      return out;
    },
  };
}

/** 页面内容包含 query 词 + angle 词 → focus 必命中;段落 >40 chars → quote 有效 */
function pageFor(query: string, angle: string): string {
  const words = [...new Set([...query.split(/\s+/), angle])].join(", ");
  const para = (k: number) =>
    `Paragraph ${k}: the ${words} discussion continues here with enough length to survive the quote threshold check easily. ` +
    `It mentions ${angle} of ${query} in detail number ${k}.`;
  return `<html><head><title>Doc ${angle}</title></head><body><article>` +
    [1, 2, 3, 4].map(para).map((p) => `<p>${p}</p>`).join("") +
    `</article></body></html>`;
}

function makeDeps(dir: string, providerOpts: { perSearch: number; emptyFor?: string } = { perSearch: 2 }) {
  const cfg: CoreConfig = loadConfig({
    dataDir: dir,
    engines: ["fake"],
    timeoutMs: 2000,
    ssrf: "off", // 离线测试: 跳过 DNS/私网判定,fetch 由注入的 fetchImpl 承接
    x: { guestEnabled: false },
    research: { maxLoops: 3, minFacts: 3, referenceBudget: 50, fetchBudget: 10, fetchPerLoop: 4, strict: false },
  } as never);
  const cache = new Cache(dir);
  const health = new HealthTracker(cache);
  const router = new Router({ config: cfg, health, cache, providers: [fakeProvider(providerOpts)] });
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = String(url instanceof Request ? url.url : url);
    const m = u.match(/\/doc\/(\d+)/);
    if (!m) throw new Error(`unexpected url ${u}`);
    return new Response(pageFor(QUERY, "definition"), { status: 200, headers: { "Content-Type": "text/html" } });
  }) as unknown as typeof fetch;
  const fetcher = new Fetcher(cfg, cache, undefined, fetchImpl);
  const loop = new ResearchLoop({ config: cfg, router, fetcher, cache }, dir);
  return { cfg, cache, health, router, fetcher, loop };
}

function tmp(): { dir: string; clean: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "sc-res-"));
  return { dir, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

test("research: converges after loop 1 (relaxed Q1+Q2 pass), citations 100% resolvable", async () => {
  const { dir, clean } = tmp();
  try {
    const { loop } = makeDeps(dir);
    const r = await loop.run(QUERY, { angles: ANGLES, minFacts: 3, maxLoops: 3 });
    assert.equal(r.stop.reason, "converged");
    assert.equal(r.loops.length, 1);
    assert.ok(r.facts.length >= 3, `facts=${r.facts.length}`);
    // 出口校验: report 里所有 [n] 都在 registry
    const audit = auditCitations(r.report, new Map(r.registry));
    assert.equal(audit.ok, true, `unknown: ${audit.unknown}`);
    // 报告结构: 角度分节 + 引用尾注
    assert.match(r.report, new RegExp(ANGLES[0]));
    assert.match(r.report, /## 引用/);
    // 事实按角度归属
    assert.ok(r.facts.some((f) => f.angle === ANGLES[0]));
    assert.ok(r.facts.some((f) => f.angle === ANGLES[1]));
  } finally {
    clean();
  }
});

test("research: max_loops degraded exit carries partial facts, not blocked", async () => {
  const { dir, clean } = tmp();
  try {
    // comparison 角度永远空手 → Q2 永不过 → 必然跑到 max_loops
    const { loop } = makeDeps(dir, { perSearch: 2, emptyFor: "comparison" });
    const r = await loop.run(QUERY, { angles: ANGLES, minFacts: 3, maxLoops: 2 });
    assert.equal(r.stop.reason, "max_loops");
    assert.equal(r.loops.length, 2);
    assert.equal(r.loops[1].decision, "MAX_LOOPS_DEGRADED");
    assert.ok(r.facts.length >= 1, "facts collected before degrade");
    assert.ok(r.report.length > 100);
  } finally {
    clean();
  }
});

test("research: fetch budget stop (双预算池之 fetch 池)", async () => {
  const { dir, clean } = tmp();
  try {
    const { loop } = makeDeps(dir, { perSearch: 4 }); // 池子宽,fetch 预算小
    const r = await loop.run(QUERY, {
      angles: ANGLES, minFacts: 20, fetchBudget: 2, fetchPerLoop: 4, maxLoops: 5, referenceBudget: 200,
    });
    assert.equal(r.stop.reason, "budget");
    assert.equal(r.stats.fetchUsed, 2);
    assert.ok(r.loops[r.loops.length - 1].decision === "BUDGET_STOP");
  } finally {
    clean();
  }
});

test("research: reference budget caps pool (双预算池之 reference 池)", async () => {
  const { dir, clean } = tmp();
  try {
    const { loop } = makeDeps(dir, { perSearch: 6 });
    const r = await loop.run(QUERY, {
      angles: ANGLES, minFacts: 100, fetchBudget: 1, fetchPerLoop: 1,
      referenceBudget: 8, maxLoops: 2,
    });
    assert.ok(r.refs.length <= 8, `refs=${r.refs.length}`);
    assert.ok(r.stats.refBudgetDropped > 0, "budget dropped should be counted");
  } finally {
    clean();
  }
});

test("research: resume of finished run replays from journal (no re-run)", async () => {
  const { dir, clean } = tmp();
  try {
    const { loop } = makeDeps(dir);
    const r1 = await loop.run(QUERY, { angles: ANGLES, minFacts: 3, maxLoops: 3 });
    const r2 = await loop.resume(r1.runId);
    assert.equal(r2.resumed, true);
    assert.equal(r2.stop.reason, "converged");
    assert.equal(r2.loops.length, r1.loops.length, "no new loops on finished run");
    assert.equal(r2.facts.length, r1.facts.length);
    // refId 稳定
    assert.deepEqual(r2.refs.map((x) => x.refId), r1.refs.map((x) => x.refId));
  } finally {
    clean();
  }
});

test("research: resume from PARTIAL journal continues from next loop", async () => {
  const { dir, clean } = tmp();
  try {
    const { loop } = makeDeps(dir);
    const runId = "partial-test";
    mkdirSync(join(dir, "journal"), { recursive: true });
    const ev = (o: Record<string, unknown>): string => JSON.stringify({ ts: 1, ...o }) + "\n";
    const journal =
      ev({ event: "start", query: QUERY, angles: ANGLES, strict: false,
        opts: { maxLoops: 2, minFacts: 3, referenceBudget: 50, fetchBudget: 10, fetchPerLoop: 4 } }) +
      ev({ event: "loop_start", loop: 1, queries: [] }) +
      ev({ event: "angle_done", loop: 1, angle: "definition", query: "q1", found: 2, added: 2,
        refs: [
          { url: "https://p.test/doc/901", title: "Doc 901", snippet: "vector database landscape 901", engines: ["fake"], refId: 1 },
          { url: "https://p.test/doc/902", title: "Doc 902", snippet: "vector database landscape 902", engines: ["fake"], refId: 2 },
        ] });
    writeFileSync(join(dir, "journal", `research-${runId}.jsonl`), journal);
    const r = await loop.resume(runId);
    assert.equal(r.resumed, true);
    // pool 里的 refId 1,2 保持稳定,新 URL 从 3 续编
    assert.deepEqual(r.refs.filter((x) => x.url.includes("901") || x.url.includes("902")).map((x) => x.refId).sort(), [1, 2]);
    assert.ok(r.refs.every((x) => x.refId !== undefined));
    assert.ok(r.loops.length >= 2, `loops=${r.loops.length}`);
    const audit = auditCitations(r.report, new Map(r.registry));
    assert.equal(audit.ok, true);
  } finally {
    clean();
  }
});

test("research: one angle starving does not kill the run (ODR or-True 修复)", async () => {
  const { dir, clean } = tmp();
  try {
    const { loop } = makeDeps(dir, { perSearch: 3, emptyFor: "comparison" });
    const r = await loop.run(QUERY, { angles: ANGLES, minFacts: 2, maxLoops: 1 });
    // comparison 空手但 definition 产出 → 报告仍生成,Q2<1 明示覆盖缺口
    assert.ok(r.facts.length >= 2);
    assert.match(r.report, /本角度未获得可引用事实/);
  } finally {
    clean();
  }
});

test("research: reflect scoring + decide unit sanity", () => {
  const st = new ResearchState("unit");
  st.query = QUERY;
  st.angles = ANGLES;
  st.opts = { maxLoops: 3, minFacts: 4, referenceBudget: 50, fetchBudget: 10, fetchPerLoop: 4 };
  st.facts = [
    { refId: 1, url: "https://a/1", title: "t", angle: "definition", quote: "q", domain: "arxiv.org", tier: 1, published: "2025-06" },
    { refId: 2, url: "https://b/2", title: "t", angle: "definition", quote: "q", domain: "blog.dev", tier: 3, published: "2026-01" },
    { refId: 3, url: "https://c/3", title: "t", angle: "comparison", quote: "q", domain: "github.com", tier: 2, published: "2026-02" },
  ];
  const s = reflect(st);
  assert.ok(Math.abs(s.q1Facts - 0.75) < 1e-9); // 3 facts / minFacts 4
  assert.equal(s.q2Coverage, 1);    // 两个角度都有事实
  assert.equal(s.q3Authority, 1);   // 有 tier1
  assert.equal(s.q4Freshness, 1);   // 有近 2 年日期
  assert.ok(s.q5MultiSource >= 0.5);
  assert.ok(s.q6Usable < 1);        // comparison 只有 1 条
  // loop1 判定: q1 0.75 < 1 → CONTINUE
  st.loops.push({ loop: 1, queries: [], newUrls: 3, fetched: 0, reflect: s, decision: "CONTINUE" });
  assert.equal(decide(st, s, 1), "CONTINUE");
  // facts 补足后 EXIT
  st.facts.push({ refId: 4, url: "https://d/4", title: "t", angle: "comparison", quote: "q", domain: "x.org", tier: 3, published: "2026-03" });
  const s2 = reflect(st);
  assert.equal(s2.q1Facts, 1);
  assert.equal(decide(st, s2, 1), "EXIT");
});
