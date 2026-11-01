/**
 * Live smoke test: 真实引擎连通性(受网络环境影响,不作为 CI 门禁)
 * 用法: npm run smoke
 */
import { SearchCore } from "../engine.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sc-smoke-"));
const core = new SearchCore({
  config: {
    dataDir: dir,
    // v0.3 扩池 smoke: 本环境 DDG/Mojeek TCP 不可达(7-c 实测); wikipedia 已解掑(10-a 破案=UA 政策,
    // DEFAULT_UA 已修); arxiv 共享 IP 可能 429(失败会打印不阻塞); crossref/新闻垂直验证
    engines: ["yahoo", "marginalia", "hn", "bingrss", "wikipedia", "arxiv", "crossref", "wiby", "keenable"],
    timeoutMs: 15000,
  },
});

async function main() {
  console.log("=== providers ===");
  for (const p of core.providers()) {
    console.log(`  ${p.name} configured=${p.configured}`);
  }

  console.log("\n=== search: 'sqlite-vec vector search' ===");
  const t0 = Date.now();
  const r = await core.search("sqlite-vec vector search extension", { topN: 8 });
  console.log(`planner: ${r.planner.complexity}/${r.planner.route}`);
  console.log(`engines used: ${r.meta.enginesUsed.join("+") || "none"}  failed: ${r.meta.enginesFailed.map((f) => `${f.name}(${f.error.slice(0, 40)})`).join("; ") || "none"}`);
  console.log(`fused refs: ${r.refs.length}  elapsed: ${r.meta.elapsedMs}ms (total ${Date.now() - t0}ms)`);
  for (const ref of r.refs.slice(0, 5)) {
    console.log(`  [${ref.refId}] ${ref.title.slice(0, 60)}  (${ref.engines.join(",")})`);
    console.log(`       ${ref.url.slice(0, 90)}`);
  }

  if (r.refs.length > 0) {
    const target = r.refs[0].url;
    console.log(`\n=== fetch (focus) : ${target.slice(0, 70)} ===`);
    try {
      const f = await core.fetch(target, { focus: "vector search extension", maxChars: 4000 });
      console.log(`title: ${f.title ?? "-"}`);
      console.log(`text=${f.textLength}ch returned=${f.returnedChars}ch saved=${f.savedPct !== undefined ? Math.round(f.savedPct * 100) + "%" : "-"} cache=${f.fromCache} ${f.elapsedMs}ms`);
      if (f.segments?.length) {
        console.log(`segments[0]: ${f.segments[0].slice(0, 200)}...`);
      }
      // 二次 focus 同一页: 应命中缓存并省 token (dsh 缓存原文设计)
      const f2 = await core.fetch(target, { focus: "installation usage", maxChars: 4000 });
      console.log(`second focus: cache=${f2.fromCache} returned=${f2.returnedChars}ch (cache reuse OK)`);
    } catch (e) {
      console.log(`fetch failed (network env may block): ${(e as Error).message.slice(0, 120)}`);
    }
  }

  console.log("\n=== x_search (v0.2 degrade chain: official∥guest∥keyless+oEmbed) ===");
  const x = await core.xSearch("grok build release", "tweets", { topN: 5 });
  console.log(`layers used: ${x.meta.enginesUsed.join("+") || "none"}  failed: ${x.meta.enginesFailed.map((f) => `${f.name}(${f.error.slice(0, 40)})`).join("; ") || "none"}  refs: ${x.refs.length}  ${x.meta.elapsedMs}ms`);
  for (const ref of x.refs.slice(0, 3)) {
    console.log(`  [${ref.refId}] ${ref.title}  (${ref.engines.join(",")})`);
    console.log(`       ${ref.url.slice(0, 90)}`);
  }

  console.log("\n=== research mini-run (maxLoops=1, fetchBudget=2) ===");
  const t1 = Date.now();
  const rr = await core.deepResearch("sqlite vector search extension landscape", {
    maxLoops: 1, fetchBudget: 2, fetchPerLoop: 2, minFacts: 2, referenceBudget: 30,
  }, (e) => {
    if (e.type === "angle_done") console.log(`  [${e.angle}] found=${e.found} new=${e.added}`);
    if (e.type === "fetch_done") console.log(`  [fetch] ${String(e.url).slice(0, 70)}`);
    if (e.type === "reflect") console.log(`  [reflect] facts=${e.facts}`);
  });
  console.log(`runId: ${rr.runId}  stop: ${rr.stop.reason} (${rr.stop.detail})  ${Date.now() - t1}ms`);
  console.log(`facts: ${rr.facts.length}  pool: ${rr.refs.length}  loops: ${rr.loops.length}`);
  console.log(`journal: ${rr.journalPath}`);
  console.log(`report head:\n${rr.report.split("\n").slice(0, 12).join("\n")}`);
  console.log(`\n=== resume replay of finished run (should not re-run) ===`);
  const rz = await core.resumeResearch(rr.runId);
  console.log(`resumed=${rz.resumed} loops=${rz.loops.length} facts=${rz.facts.length} stop=${rz.stop.reason}`);

  console.log("\n=== stats ===");
  console.log(JSON.stringify(core.stats(), null, 1));
}

main()
  .catch((e) => {
    console.error("smoke error:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => {
    core.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });
