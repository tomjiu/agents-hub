/**
 * fusion3.test.ts — phase AI: 类目正主前排(CATEGORY_S_FRONTROW) + 页面守卫多证据放行
 *
 * 背景(vs-zai 第 12 采样 24 题全量): s 档 top10 21 vs 21 平, 但 s 档进 top5 12 vs 17 落后。
 * ai-top5-diagnose.mjs 拆解出三个根因:
 *   ① 类目表缺口(categories.json 只扩不缩补齐: europa.eu/厂商安全域/medlineplus);
 *   ② 类目 s 档提权 1.2 不够(dev.mysql.com 在池 #10 差 +0.9; federalreserve 差 +0.3 丢 #1);
 *   ③ AF 页面守卫单长锚误伤(rapid7 含 log4j+cve+44228 缺 "mitigation" 被清零; cac.gov.cn
 *      数据跨境专页缺长 run 被清零 — 不清零即 #1)。
 * 本文件锁 ②(CATEGORY_S_FRONTROW=2.0 作用域)与 ③(多证据放行语义)。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fuseSemantic, keyTermPresent, lexicalScore } from "../fusion.js";
import { matchCategoryAuthority } from "../authority.js";
import type { Reference } from "../types.js";

const mkRef = (url: string, title: string, snippet: string, engine = "e1"): Reference => ({
  url, title, snippet, engines: [engine],
});

// ---------- AI-2: keyTermPresent 多证据放行 ----------

test("keyTermPresent 多证据放行: 长锚缺席但命中 ≥2 个其他查询 token → 放行", () => {
  // rapid7 log4shell 分析页: 查询长锚是 "mitigation"(10), 页面缺, 但含 log4j+cve+44228(3 个证据)
  assert.equal(
    keyTermPresent(
      "log4j CVE-2021-44228 mitigation guide",
      "https://rapid7.com/blog/log4shell/",
      "Log4Shell CVE-2021-44228 analysis",
      "log4j vulnerability details",
    ), true, "多证据(log4j+cve+44228)应放行官方厂商页",
  );
  // 只有 1 个非长锚证据("guide") → 不放行(宁缺勿滥)
  assert.equal(
    keyTermPresent(
      "log4j CVE-2021-44228 mitigation guide",
      "https://rapid7.com/careers/",
      "Buying guide",
      "career page",
    ), false, "单证据(guide)不放行",
  );
});

test("keyTermPresent 多证据放行: AF 回归锁不破 — asyncio MDN 错页仍被守卫", () => {
  // MDN JS 异步教程页: 查询 token 零命中(present=0) → false(多证据通道救不了零命中)
  assert.equal(
    keyTermPresent("python asyncio 教程", "https://developer.mozilla.org/zh-CN/docs/Learn/JavaScript/Asynchronous", "异步编程概述", "JavaScript 异步编程入门"),
    false, "零命中仍 false(AF 第 7 采样回归锁)",
  );
  // 只有 python 一个证据(<2) → 仍 false
  assert.equal(
    keyTermPresent("python asyncio 教程", "https://developer.mozilla.org/zh-CN/docs/Learn/Python", "Python 概述", "Python 入门"),
    false, "单证据(python)不放行 — 防止 python 教程页蹭 asyncio 提权",
  );
  // 长锚命中语义不变
  assert.equal(
    keyTermPresent("python asyncio 教程", "https://docs.python.org/3/library/asyncio.html", "官方文档", ""),
    true,
  );
});

test("keyTermPresent 多证据放行: 纯 zh 多 run 查询 — cac.gov.cn 数据跨境专页放行", () => {
  // "个人信息保护法 数据跨境 规定": 长 run=个人信息保护法(7); 页面缺长 run 但含 数据跨境+规定
  assert.equal(
    keyTermPresent("个人信息保护法 数据跨境 规定", "https://cac.gov.cn/2024-01/c_出口规定.htm", "数据出境安全评估规定", "数据跨境 规定"),
    true, "zh 双证据(数据跨境+规定)放行官方专页",
  );
  // 单证据(仅"规定")不放行
  assert.equal(
    keyTermPresent("个人信息保护法 数据跨境 规定", "https://cac.gov.cn/misc.htm", "一般规定", "常见规定"),
    false, "zh 单证据不放行",
  );
});

// ---------- AI-1: 类目正主前排(CATEGORY_S_FRONTROW=2.0) ----------

test("fuseSemantic: 类目 s 档前排 — dev.mysql.com 反超垃圾博客(mysql utf8mb4 题根因回归锁)", async () => {
  // 池形状来自 ai-top5-diagnose 实测: 垃圾博客 lex 高分集群, dev.mysql 官方文档页在池尾
  const refs = [
    mkRef("https://monpg.app/blog/utf8mb4", "mysql utf8mb4 collation difference explained", "mysql utf8mb4 collation difference guide", "searxng"),
    mkRef("https://quantumwarp.com/kb/utf8mb4", "mysql utf8mb4 collation difference notes", "mysql utf8mb4 collation difference", "tavily"),
    mkRef("https://dev.mysql.com/doc/refman/8.0/en/charset-unicode-utf8mb4.html", "MySQL 8.0 Reference Manual: utf8mb4", "mysql utf8mb4 collation 差异说明", "keenable"),
  ];
  const { refs: fused } = await fuseSemantic(refs, {
    query: "mysql utf8mb4 collation difference", category: "databases",
  });
  assert.equal(fused[0].url.includes("dev.mysql.com"), true, "类目 s 档前排应让 mysql 官方文档反超垃圾博客");
  assert.equal(fused[0].authority, "mysql.com");
  // s 档前排分应 ≥ 2.0(而非原 1.2)
  const mysqlRef = fused[0];
  const lex = lexicalScore("mysql utf8mb4 collation difference", mysqlRef.title, mysqlRef.snippet);
  const nonAuthorityPart = (mysqlRef.score ?? 0) - lex * 1.5;
  assert.ok(nonAuthorityPart >= 2.0, `非权威部分应含 2.0 前排档, 实际 ${nonAuthorityPart.toFixed(2)}`);
});

test("fuseSemantic: 前排作用域 — a 档类目条目/主题表条目/无类目查询 都不提前排", async () => {
  // a 档类目条目(rapid7 security 表 a 档): 不提前排, 保持 0.75
  const aRefs = [
    mkRef("https://randomblog.example.com/log4j", "log4j CVE-2021-44228 mitigation guide", "log4j cve 44228 mitigation guide", "searxng"),
    mkRef("https://rapid7.com/blog/log4shell/", "Log4Shell CVE-2021-44228 analysis", "log4j vulnerability cve 44228", "tavily"),
  ];
  const aOut = await fuseSemantic(aRefs, { query: "log4j CVE-2021-44228 mitigation guide", category: "security" });
  const rapid = aOut.refs.find((r) => r.url.includes("rapid7.com"))!;
  const lexR = lexicalScore("log4j CVE-2021-44228 mitigation guide", rapid.title, rapid.snippet);
  const rrfPart = 10 / 61; // 两腿各自引擎内 rank 1 → RRF 相同
  const rapidBoost = (rapid.score ?? 0) - lexR * 1.5 - rrfPart;
  assert.ok(Math.abs(rapidBoost - 0.75) < 0.02, `a 档提权=0.75(实际 ${rapidBoost.toFixed(3)}), 不应获得前排 2.0`);
  assert.equal(rapid.authorityGuarded, undefined, "多证据放行: rapid7 不应被守卫清零");
  assert.ok(
    (aOut.refs.find((r) => r.url.includes("randomblog"))?.score ?? 0) <= (rapid.score ?? 0) + 0.01,
    "0.75 提权后 rapid7 与完美词法博客同一量级(不霸榜也不被埋没)",
  );

  // 主题表 s 档(programming/MDN)不在类目通道: 无 category 时保持 1.2(AC 标定不动)
  const tRefs = [
    mkRef("https://developer.mozilla.org/en-US/docs/Web/JavaScript", "JavaScript guide", "javascript reference", "searxng"),
    mkRef("https://randomblog.example.com/js", "JavaScript guide tutorial", "javascript guide tutorial", "tavily"),
  ];
  const tOut = await fuseSemantic(tRefs, { query: "javascript guide", topic: "programming" });
  const mdn = tOut.refs.find((r) => r.url.includes("developer.mozilla.org"))!;
  const lexM = lexicalScore("javascript guide", mdn.title, mdn.snippet);
  // 扣除 RRF(10/61) 与 titleBonus(全词命中 0.25)
  const mdnBoost = (mdn.score ?? 0) - lexM * 1.5 - 10 / 61 - 0.25;
  assert.ok(Math.abs(mdnBoost - 1.2) < 0.02, `主题 s 档保持 1.2 档(实际 ${mdnBoost.toFixed(2)}), 不被类目前排误伤`);
});

test("fuseSemantic: 前排与 AF 守卫叠加 — 类目 s 档页面不切题仍清零", async () => {
  // mysql.com 域但页面与查询无关(php 连接问题页蹭 utf8mb4 题): 守卫清零, 前排不救错页
  const refs = [
    mkRef("https://dev.mysql.com/doc/connector-php/en/undefined-function.html", "PHP connect function", "php mysql connect undefined", "searxng"),
    mkRef("https://blog.example.com/utf8mb4-collation", "mysql utf8mb4 collation difference", "utf8mb4 collation difference guide", "tavily"),
  ];
  const { refs: fused, meta } = await fuseSemantic(refs, {
    query: "mysql utf8mb4 collation difference", category: "databases",
  });
  assert.equal(fused[0].url.includes("blog.example.com"), true, "错页即使类目 s 档也应被守卫清零让位");
  const guarded = fused.find((r) => r.url.includes("dev.mysql.com"));
  assert.equal(guarded?.authorityGuarded, true, "错页应带守卫标注");
  assert.equal(meta.authorityGuarded, 1);
});

test("matchCategoryAuthority: phase AI 新增条目在表内(只扩不缩)", () => {
  // news 面官方机构(vs-zai r12 对方 .europa.eu 密度)
  assert.equal(matchCategoryAuthority("https://ai-act-service-desk.ec.europa.eu/x", "news")?.entry.tier, "s");
  // security 面厂商官方(r12 对方 rapid7/crowdstrike 全上)
  assert.equal(matchCategoryAuthority("https://rapid7.com/blog/x", "security")?.entry.tier, "a");
  assert.equal(matchCategoryAuthority("https://www.crowdstrike.com/blog/x", "security")?.entry.tier, "a");
  // medical 面患者权威(medlineplus.gov 独立域不被 nlm.nih.gov 子域覆盖)
  assert.equal(matchCategoryAuthority("https://medlineplus.gov/druginfo/x", "medical")?.entry.tier, "a");
  // education 第一方正主升级
  assert.equal(matchCategoryAuthority("https://www.khanacademy.org/math/x", "education")?.entry.tier, "s");
});
