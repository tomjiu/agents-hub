#!/usr/bin/env node
/**
 * zh 面实测: 智谱 key 到底还缺不缺? (用户质询"上述源不包含中文吗?")
 * 同尺对照: 5 个中文题, core 全链路 vs z-ai 托管聚合
 * - 打标共用 authority/credibility 清单(同一把尺)
 * - 关注: zh 腿出勤(keenable/sov2ex/wikipedia zh/mdn zh-CN/bingrss) + L1 关键词命中 + 灌水站
 * 原始 JSON 落 /tmp/zh-check/ 不入仓, 结论抄 docs
 */
import { SearchCore } from "../dist/index.js";
import { matchAuthority } from "../dist/authority.js";
import { matchSpamBlocked, matchSpamDownweight } from "../dist/credibility.js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

fs.mkdirSync("/tmp/zh-check", { recursive: true });

const CASES = [
  { q: "python asyncio 教程", expect: ["asyncio", "教程"] },            // 对照轮原始 miss 题
  { q: "向量数据库 怎么选", expect: ["milvus", "向量"] },               // phase Y 翻绿题
  { q: "rust 入门 学习路线", expect: ["rust", "入门"] },                // 中文教程池深度探针
  { q: "docker compose 配置 报错", expect: ["docker", "compose"] },     // 编程+报错意图
  { q: "pydantic v2 迁移", expect: ["pydantic"] },                      // 垂直框架中文资料
];

const ZH_LEG_SIGNATURES = ["keenable", "sov2ex", "wikipedia", "mdn", "bingrss", "searxng"];

const core = new SearchCore();

function grade(refs) {
  return refs.slice(0, 10).map((r) => ({
    host: (() => { try { return new URL(r.url).host; } catch { return "?"; } })(),
    title: (r.title ?? "").slice(0, 60),
    auth: !!matchAuthority(r.url),
    spam: !!matchSpamBlocked(r.url),
    dw: !!matchSpamDownweight(r.url),
  }));
}

function expectHit(refs, expect) {
  const blob = refs.slice(0, 10).map((r) => `${r.title} ${r.url} ${r.snippet ?? ""}`).join(" ").toLowerCase();
  return expect.some((k) => blob.includes(k.toLowerCase()));
}

async function zaiSearch(query) {
  const t0 = Date.now();
  const out = `/tmp/zh-check/zai-${Buffer.from(query).toString("hex").slice(0, 12)}.json`;
  const r = spawnSync("z-ai", ["function", "-n", "web_search", "-a", JSON.stringify({ query, num: 10 }), "-o", out], { timeout: 30000 });
  const ms = Date.now() - t0;
  if (r.status !== 0) return { ms, refs: [], err: String(r.stderr).slice(0, 100) };
  try {
    const arr = JSON.parse(fs.readFileSync(out, "utf8"));
    return { ms, refs: (Array.isArray(arr) ? arr : []).map((x) => ({ url: x.url ?? "", title: x.name ?? "", snippet: x.snippet ?? "" })) };
  } catch (e) { return { ms, refs: [], err: String(e).slice(0, 100) }; }
}

console.log("=== zh 面实测: 智谱 key 还缺不缺? ===\n");
let coreWin = 0, zaiWin = 0, tie = 0;
for (const c of CASES) {
  const t0 = Date.now();
  const res = await core.search(c.q, { noCache: true, topN: 10 });
  const coreMs = Date.now() - t0;
  const g = grade(res.refs ?? []);
  const used = res.meta?.enginesUsed ?? res.enginesUsed ?? [];
  const zhLegs = used.filter((e) => ZH_LEG_SIGNATURES.includes(e));
  const coreHit = expectHit(res.refs ?? [], c.expect);
  const coreSpam = g.filter((x) => x.spam).length;
  const coreAuth = g.filter((x) => x.auth).length;

  const z = await zaiSearch(c.q);
  const zg = grade(z.refs);
  const zaiHit = expectHit(z.refs, c.expect);
  const zaiSpam = zg.filter((x) => x.spam).length;
  const zaiAuth = zg.filter((x) => x.auth).length;

  if (coreHit && !zaiHit) coreWin++;
  else if (zaiHit && !coreHit) zaiWin++;
  else tie++;

  console.log(`## ${c.q}  expect=${JSON.stringify(c.expect)}`);
  console.log(`  core  L1=${coreHit ? "HIT" : "MISS"} ${coreMs}ms 出勤=${used.join("+")} zh腿=${zhLegs.join("+") || "-"} auth=${coreAuth} spamBlocked=${coreSpam} degraded=${res.meta?.degraded}`);
  console.log(`        top5: ${g.slice(0, 5).map((x) => x.host).join(" | ")}`);
  console.log(`  z-ai  L1=${zaiHit ? "HIT" : "MISS"} ${z.ms}ms(含冷启) auth=${zaiAuth} spam=${zaiSpam}`);
  console.log(`        top5: ${zg.slice(0, 5).map((x) => x.host).join(" | ")}`);
  console.log("");
}

console.log(`=== 判分: core ${coreWin} vs zai ${zaiWin} (平 ${tie}) ===`);
