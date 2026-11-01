#!/usr/bin/env node
/**
 * phase AD 实弹探针: 落地页改写链 + geo 腿 + 权威表外挂
 * 原始输出只落 /tmp/phase-ad(不入仓), 只抄结论。
 */
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SearchCore } from "../dist/index.js";

const dir = mkdtempSync(join(tmpdir(), "phase-ad-"));
const core = new SearchCore({ config: { dataDir: dir, ssrf: "allowPrivate", timeoutMs: 15000 } });
const t0 = Date.now();

// 1) crates.io SPA → API 直取(老 L2 失败主力)
try {
  const r = await core.fetch("https://crates.io/crates/tokio");
  console.log(`[1] crates fetch OK ${r.textLength}ch title=${r.title} :: ${r.text.slice(0, 120).replace(/\n/g, " ")}`);
} catch (e) {
  console.log(`[1] crates fetch FAIL: ${e.message}`);
}

// 2) doi 403 → OpenAlex OA 直链回退(bench 老失败: sciencedirect 403)
try {
  const r = await core.fetch("https://doi.org/10.1016/S0040-4020(97)80046-7");
  console.log(`[2] doi OA fallback OK ${r.textLength}ch title=${(r.title ?? "").slice(0, 60)} :: ${r.text.slice(0, 100).replace(/\n/g, " ")}`);
} catch (e) {
  console.log(`[2] doi fetch FAIL(回退也没救活): ${e.message}`);
}

// 3) geo 腿: nominatim 实弹(规划器路由 + 出勤)
try {
  const r = await core.search("故宫 在哪", { topN: 5 });
  console.log(`[3] geo search used=${r.meta.enginesUsed.join("+")} route=${r.planner.route}/${r.planner.domainPlan?.topic ?? "-"} top1=${r.refs[0]?.url ?? "-"} (${r.refs[0]?.kind ?? "-"})`);
} catch (e) {
  console.log(`[3] geo search FAIL: ${e.message}`);
}

// 4) SC_AUTHORITY_JSON 外挂(独立 core + env)
const { execFileSync } = await import("node:child_process");
const envScript = `
import { SearchCore } from "../dist/index.js";
import { TOPIC_AUTHORITY, matchTopicAuthority } from "../dist/authority.js";
const hit = matchTopicAuthority("https://my-internal-docs.unittest.example/guide", "programming");
console.log(JSON.stringify({ boost: hit?.boost ?? null }));
`;
try {
  const out = execFileSync("node", ["--input-type=module", "-e", `
    process.env.SC_AUTHORITY_JSON = JSON.stringify({ topics: { programming: [{ domain: "my-internal-docs.unittest.example", tier: "s" }] } });
    ${"" /* env 必须在 import 前设 — 换成直接调用 mergeExternalAuthority 的方式 */} 
    const { mergeExternalAuthority, matchTopicAuthority } = await import("${join(process.cwd(), "dist/authority.js")}");
    mergeExternalAuthority(process.env.SC_AUTHORITY_JSON);
    const hit = matchTopicAuthority("https://my-internal-docs.unittest.example/guide", "programming");
    console.log(JSON.stringify({ boost: hit?.boost ?? null }));
  `], { encoding: "utf8", cwd: process.cwd() });
  console.log(`[4] SC_AUTHORITY_JSON 外挂: ${out.trim().split("\n").pop()}`);
} catch (e) {
  console.log(`[4] SC_AUTHORITY_JSON FAIL: ${e.message.slice(0, 120)}`);
}

// 5) journal 证据(fetch_rewrite_crate_api / fetch_oa_fallback 事件在案)
try {
  const jdir = join(dir, "journal");
  const files = readdirSync(jdir);
  let rewrite = 0, oa = 0;
  for (const f of files) {
    const txt = readFileSync(join(jdir, f), "utf8");
    rewrite += (txt.match(/fetch_rewrite_crate_api/g) ?? []).length;
    oa += (txt.match(/fetch_oa_fallback/g) ?? []).length;
  }
  console.log(`[5] journal 证据: rewrite_crate_api=${rewrite} oa_fallback=${oa}`);
} catch (e) {
  console.log(`[5] journal 读取 FAIL: ${e.message}`);
}

console.log(`--- probe done in ${((Date.now() - t0) / 1000).toFixed(1)}s (raw dir ${dir}) ---`);
core.close();
