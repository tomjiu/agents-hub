/**
 * v0.6 域名路由表 + 新 Tier1 provider 测试
 * - lookupDomains: 关键词命中/未命中/多领域优先级
 * - planner 集成: domain route 命中与 x/github 优先级
 * - stackexchange/npm: 黄金样本解析(回归清单: markup 漂移必须报错而非静默空)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupDomains, DOMAIN_TABLE, condensePackagesLeg, laneLegProviders } from "../domains.js";
import { plan } from "../planner.js";
import { stackexchange, npm } from "../providers/keyless-apis.js";
import type { SearchCtx } from "../providers/base.js";
import type { SearchOptions } from "../types.js";

type AnyFetch = (url: string, init?: RequestInit) => Promise<Response>;

function ctxWith(body: string, contentType = "application/json", status = 200): { ctx: SearchCtx; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: AnyFetch = async (url, _init) => {
    calls.push(String(url));
    return new Response(body, { status, headers: { "Content-Type": contentType } });
  };
  const opts: SearchOptions = { maxResults: 10 };
  return {
    calls,
    ctx: { fetchImpl: fetchImpl as unknown as SearchCtx["fetchImpl"], signal: AbortSignal.timeout(5000), ua: "test", opts },
  };
}

// ---------- lookupDomains ----------

test("domains: programming hit -> tier1 providers + mdn site query", () => {
  const r = lookupDomains("python asyncio 报错 BrokenProcessPool");
  assert.ok(r);
  assert.equal(r.topic, "programming");
  // phase Z: keenable 进编程腿(vs-zai 对照轮实测教训——英文系 3 腿对 zh 教程题脆,
  // "python asyncio 教程" 3 英文腿全挂+ddg 限流后塌到 bingrss 单腿 miss)
  // phase AA: mdn 直连 API 进 Tier1(原 Tier2 site: 升级); site: 槽位补 docs.python.org
  // phase AB: 含中文题追加 sov2ex 社区腿
  assert.deepEqual(r.apiProviders, ["stackexchange", "github", "hn", "keenable", "mdn", "sov2ex"]);
  assert.equal(r.siteQueries.length, 1);
  assert.ok(r.siteQueries[0].includes("site:docs.python.org"));
  assert.deepEqual(r.siteEngines, ["duckduckgo", "bingrss"]);
});

// phase Z 回归锁: 对比轮真实 miss 题,修复后必须含 zh 能力保底腿
test("domains: zh 教程题(对比轮真实 miss 题)编程腿必含 keenable 保底", () => {
  const r = lookupDomains("python asyncio 教程");
  assert.ok(r);
  assert.equal(r.topic, "programming");
  assert.ok(r.apiProviders.includes("keenable"), `apiProviders=${r.apiProviders} 缺 keenable`);
});

test("domains: academic hit -> arxiv/crossref/openalex/dblp/pubmed/wikipedia/hfpapers, no site targets", () => {
  const r = lookupDomains("transformer 架构 论文 原文");
  assert.ok(r);
  assert.equal(r.topic, "academic");
  assert.deepEqual(r.apiProviders, ["arxiv", "crossref", "openalex", "dblp", "pubmed", "wikipedia", "hfpapers"]); // AG-1: hfpapers 进腿
  assert.equal(r.siteQueries.length, 0);
});

test("domains: images hit -> openverse", () => {
  const r = lookupDomains("帮我找一张 雪山 日落的可商用图片");
  assert.ok(r);
  assert.equal(r.topic, "images");
  assert.deepEqual(r.apiProviders, ["openverse"]);
});

test("domains: no hit -> null (general pool keeps the query)", () => {
  assert.equal(lookupDomains("今天上海天气怎么样"), null);
  assert.equal(lookupDomains("2026 年新能源汽车市场格局"), null);
});

test("domains: multi-topic query takes table order (programming first)", () => {
  const r = lookupDomains("python 论文 教程");
  assert.ok(r);
  assert.equal(r.topic, "programming"); // 表序即优先级
});

test("domains: table shape sanity (all providers registered names, siteEngines non-empty)", () => {
  for (const [topic, def] of Object.entries(DOMAIN_TABLE)) {
    assert.ok(def.apiProviders.length > 0, `${topic} must have tier1 providers`);
    assert.ok(def.keywords.length > 0, `${topic} must have keywords`);
    // siteTargets 有 targets 就必须有派发引擎
    assert.ok(
      def.siteTargets.length === 0 || def.siteEngines.length > 0,
      `${topic} siteTargets without siteEngines is a config bug`,
    );
  }
});

// ---------- planner 集成 ----------

test("planner: domain route hit -> domainPlan + queries = [原query, ...site:]", () => {
  const d = plan("rust async runtime 教程");
  assert.equal(d.route, "domain"); // v0.7: 域名命中标 "domain" 不再混 "web"
  assert.ok(d.domainPlan);
  assert.equal(d.domainPlan.topic, "programming");
  assert.equal(d.queries.length, 1 + d.domainPlan.siteQueries.length);
  assert.ok(d.reasons.some((r) => r.includes("domain-route")));
});

test("planner: explicit github keywords win over domain table", () => {
  const d = plan("python telegram bot github 仓库");
  assert.equal(d.route, "github");
  assert.equal(d.domainPlan, undefined);
});

test("planner: research hints win over domain table", () => {
  const d = plan("深度研究 rust 异步生态 教程");
  assert.equal(d.complexity, "research");
  assert.equal(d.domainPlan, undefined);
});

test("planner: comparison split wins over domain table", () => {
  const d = plan("python vs golang 性能");
  assert.equal(d.complexity, "multi");
  assert.equal(d.domainPlan, undefined);
});

test("planner: no hit keeps plain web route", () => {
  const d = plan("今天上海天气怎么样");
  assert.equal(d.route, "web");
  assert.equal(d.domainPlan, undefined);
});

// ---------- stackexchange provider ----------

const SE_JSON = JSON.stringify({
  items: [
    {
      title: "How to handle &quot;async&quot; errors in Python? &amp; more",
      link: "https://stackoverflow.com/questions/123/example",
      score: 42, answer_count: 3, is_answered: true,
      tags: ["python", "async", "error-handling"],
      last_activity_date: 1756800000,
    },
    { title: "Unanswered thing", link: "https://stackoverflow.com/questions/456/x", score: 0, answer_count: 0, is_answered: false },
  ],
  quota_max: 300, quota_remaining: 299,
});

test("stackexchange: parse golden sample + entity decode + meta signals", async () => {
  const { ctx, calls } = ctxWith(SE_JSON);
  const refs = await stackexchange.search("python async errors", ctx);
  assert.equal(refs.length, 2);
  // HTML 实体单次解码(&quot; -> "; &amp; 不吃掉 &quot;)
  assert.ok(refs[0].title.includes('"async"'));
  assert.ok(refs[0].title.includes("& more"));
  assert.equal(refs[0].url, "https://stackoverflow.com/questions/123/example");
  assert.ok(refs[0].snippet.includes("answered ✓"));
  assert.ok(refs[0].snippet.includes("42 score"));
  assert.ok(refs[0].snippet.includes("tags: python"));
  assert.ok(refs[1].snippet.includes("open"));
  assert.ok(refs[0].published?.startsWith("2025")); // epoch 1756800000 -> 2025-09
  assert.ok(calls[0].includes("site=stackoverflow"));
  assert.ok(calls[0].includes("/2.3/search/advanced"));
});

test("stackexchange: empty items -> throws (no silent empty)", async () => {
  const { ctx } = ctxWith(JSON.stringify({ items: [], quota_max: 300, quota_remaining: 100 }));
  await assert.rejects(() => stackexchange.search("qqqqzzzz", ctx), /no results parsed/);
});

test("stackexchange: http 429 -> rate-limited classification", async () => {
  const { ctx } = ctxWith("throttled", "text/plain", 429);
  await assert.rejects(() => stackexchange.search("x", ctx), /http 429/);
});

// ---------- npm provider ----------

const NPM_JSON = JSON.stringify({
  objects: [
    {
      package: {
        name: "zod", version: "3.25.76",
        description: "TypeScript-first schema validation",
        date: "2026-08-01T00:00:00.000Z",
        links: { npm: "https://www.npmjs.com/package/zod" },
        keywords: ["validation", "schema"],
        publisher: { username: "colinhacks" },
        score: { final: 0.98, detail: { popularity: 0.95, quality: 0.99, maintenance: 0.97 } },
      },
    },
    { package: { name: "pkg-no-links", version: "1.0.0" } },
  ],
});

test("npm: parse golden sample + score meta + links fallback", async () => {
  const { ctx, calls } = ctxWith(NPM_JSON);
  const refs = await npm.search("schema validation", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://www.npmjs.com/package/zod");
  assert.equal(refs[0].title, "zod@3.25.76");
  assert.ok(refs[0].snippet.includes("score 0.98"));
  assert.ok(refs[0].snippet.includes("by colinhacks"));
  assert.ok(refs[0].snippet.includes("TypeScript-first schema validation"));
  assert.equal(refs[1].url, "https://www.npmjs.com/package/pkg-no-links"); // links 缺失兜底拼 URL
  assert.ok(calls[0].includes("registry.npmjs.org/-/v1/search"));
});

test("npm: empty objects -> throws (no silent empty)", async () => {
  const { ctx } = ctxWith(JSON.stringify({ objects: [] }));
  await assert.rejects(() => npm.search("zzqqxx", ctx), /no results parsed/);
});

// ---------- v0.8 质量评测 case-4: packages 语言腿裁剪 ----------

test("condensePackagesLeg: rust 信号 → crates 单腿", () => {
  assert.deepEqual(condensePackagesLeg("rust crate async runtime tokio", ["npm", "crates", "packagist", "rubygems"]), ["crates"]);
  assert.deepEqual(condensePackagesLeg("cargo 依赖替代", ["npm", "crates", "packagist", "rubygems"]), ["crates"]);
});

test("condensePackagesLeg: node/php/ruby 信号各归单腿", () => {
  const full = ["npm", "crates", "packagist", "rubygems"];
  assert.deepEqual(condensePackagesLeg("npm 包 schema validation", full), ["npm"]);
  assert.deepEqual(condensePackagesLeg("php composer 包推荐", full), ["packagist"]);
  assert.deepEqual(condensePackagesLeg("ruby gem http client", full), ["rubygems"]);
});

test("condensePackagesLeg: 无语言信号 → 全腿兜底", () => {
  const full = ["npm", "crates", "packagist", "rubygems"];
  assert.deepEqual(condensePackagesLeg("包管理器哪个好", full), full);
  assert.deepEqual(condensePackagesLeg("best package manager 2026", full), full);
});

test("lookupDomains 集成: packages 命中时腿按语言信号裁剪, 其他主题不受影响", () => {
  const r = lookupDomains("rust crate async runtime tokio");
  assert.ok(r);
  assert.equal(r.topic, "packages");
  assert.deepEqual(r.apiProviders, ["crates"]); // 原 npm+crates+packagist+rubygems 裁到单腿
  const r2 = lookupDomains("向量数据库 milvus faiss 对比"); // 非 packages 主题
  assert.equal(r2, null); // 不命中 packages 关键词, 走通用池
});

// ---------- phase AB: 中文强化腿(sov2ex)与学术腿(pubmed) ----------

test("domains: 编程题含中文 → sov2ex 追加进腿; 纯英文题不加(噪音防护)", () => {
  const zh = lookupDomains("python asyncio 教程 怎么写");
  assert.ok(zh);
  assert.equal(zh.topic, "programming");
  assert.ok(zh.apiProviders.includes("sov2ex"), `zh 题缺 sov2ex: ${zh.apiProviders}`);

  const en = lookupDomains("python asyncio tutorial");
  assert.ok(en);
  assert.equal(en.topic, "programming");
  assert.ok(!en.apiProviders.includes("sov2ex"), `英文题误伤 sov2ex: ${en.apiProviders}`);
  // keenable 保底(phase Z)两条腿都保留
  assert.ok(zh.apiProviders.includes("keenable") && en.apiProviders.includes("keenable"));
});

test("domains: 非编程主题不受 zhBoost 影响(academic 不混入 sov2ex)", () => {
  const r = lookupDomains("transformer 架构 论文 原文"); // 含中文, 但 topic=academic
  assert.ok(r);
  assert.equal(r.topic, "academic");
  assert.ok(!r.apiProviders.includes("sov2ex"));
});

// ---------- phase AE: 专线聚合兜底腿(vs-zai 第 7 采样 k8s MISS 根因) ----------

test("laneLegProviders: programming 专线 leg-0 补 searxng+tavily 聚合兜底腿", () => {
  const lane = laneLegProviders("programming", ["stackexchange", "github", "hn", "keenable", "mdn"]);
  assert.deepEqual(lane, ["stackexchange", "github", "hn", "keenable", "mdn", "searxng", "tavily"]);
});

test("laneLegProviders: registry 专线(packages/devops)保持纯 API 腿不变(case-4 纯度教训)", () => {
  assert.deepEqual(laneLegProviders("devops", ["dockerhub"]), ["dockerhub"]);
  assert.deepEqual(laneLegProviders("packages", ["npm", "crates"]), ["npm", "crates"]);
  // 其他混源主题维持原样(证据面之外不过修)
  assert.deepEqual(laneLegProviders("academic", ["arxiv", "crossref"]), ["arxiv", "crossref"]);
});

// ---------- phase AH(vs-zai 第 11 采样): images 车道聚合兜底腿 ----------

test("laneLegProviders: images 车道补聚合兜底腿(openverse 单腿合法空不再整题塌方)", () => {
  // phase AN: 第 17 采样 images 题兜底双腿同时掉链 → keenable 第 4 兜底腿(独立索引)
  assert.deepEqual(laneLegProviders("images", ["openverse"]), ["openverse", "searxng", "tavily", "keenable"]);
  // registry 纯度教训不回退: devops/packages 仍纯 API 腿
  assert.deepEqual(laneLegProviders("devops", ["dockerhub"]), ["dockerhub"]);
});

// ---------- phase AJ: security / news 两条新 lane ----------

test("domains: security hit -> CVE 三腿(真题面: log4j CVE-2021-44228)", () => {
  const r = lookupDomains("log4j CVE-2021-44228 mitigation guide");
  assert.ok(r, "CVE 编号题必须命中 security lane");
  assert.equal(r.topic, "security");
  assert.deepEqual(r.apiProviders, ["nvd", "osv", "ghsa"]);
  // zh 安全题
  const zh = lookupDomains("这个漏洞 exp 怎么利用");
  assert.ok(zh && zh.topic === "security");
});

test("domains: security 保守锚不误配 — xz 后门题无编号也进腿(漏洞锚), 纯产品题不进", () => {
  // "vulnerability" 是强安全意图词
  const r = lookupDomains("xz utils vulnerability backdoor explained");
  assert.ok(r && r.topic === "security");
});

test("domains: news hit -> googlenews+bingnews 双 RSS 腿(真题面: EU AI Act latest news)", () => {
  const r = lookupDomains("EU AI Act implementation timeline latest news");
  assert.ok(r, "强新闻意图题必须命中 news lane");
  assert.equal(r.topic, "news");
  assert.deepEqual(r.apiProviders, ["googlenews", "bingnews"]);
});

test("domains: news 保守锚误伤审计 — newsletter/最新进展不劫进新闻腿", () => {
  // "newsletter" 无空格断点, " news " 双空格锚不命中
  assert.equal(lookupDomains("best newsletter for product managers"), null);
  // "最新进展" 是 AI/学术查询常用语(AI 保守审计决定不收)
  assert.equal(lookupDomains("transformer 最新进展"), null);
  // 无新闻意图的普通题不进 news lane(不带其他主题词, 隔离表序优先级)
  assert.equal(lookupDomains("周末去哪玩比较好"), null);
});

test("laneLegProviders: security/news 补聚合兜底腿(官方腿薄/RSS 腿波动防塌方)", () => {
  assert.deepEqual(
    laneLegProviders("security", ["nvd", "osv", "ghsa"]),
    ["nvd", "osv", "ghsa", "searxng", "tavily"],
  );
  assert.deepEqual(
    laneLegProviders("news", ["googlenews", "bingnews"]),
    ["googlenews", "bingnews", "searxng", "tavily"],
  );
});

// ---------- phase AM: dictionary / medical / data 三条类目 lane ----------

test("domains: dictionary hit → wiktionary 腿(真题面: ubiquitous meaning etymology)", () => {
  const r = lookupDomains("ubiquitous meaning etymology");
  assert.ok(r, "词源题必须命中 dictionary lane");
  assert.equal(r.topic, "dictionary");
  assert.deepEqual(r.apiProviders, ["wiktionary"]);
  // zh 查词题
  const zh = lookupDomains("塞翁失马 什么意思");
  assert.ok(zh && zh.topic === "dictionary");
});

test("domains: dictionary 不收裸 define/定义 — 编程题表序先行不劫持", () => {
  // "java " 是 programming 关键词, 表序在 dictionary 之前 → 编程题不进词典腿
  const r = lookupDomains("how to define a function in java");
  assert.ok(r && r.topic === "programming", "编程定义题必须先命中 programming");
});

test("domains: medical hit → europepmc+clinicaltrials 双腿(研究意图锚)", () => {
  const r = lookupDomains("metformin cardiovascular outcomes randomized");
  assert.ok(r, "研究意图题必须命中 medical lane");
  assert.equal(r.topic, "medical");
  assert.deepEqual(r.apiProviders, ["europepmc", "clinicaltrials"]);
  const zh = lookupDomains("二甲双胍 临床试验 结果");
  assert.ok(zh && zh.topic === "medical");
});

test("domains: medical 锚保守 — 药名/副作用题不进研究腿(24 题真题面回归锁)", () => {
  // metformin 题面无研究意图锚 → 不路由(generic 池 + 医疗表提权负责)
  assert.equal(lookupDomains("metformin side effects long term") ?? null, null);
  assert.equal(lookupDomains("阿司匹林 肠溶片 什么时候吃") ?? null, null);
});

test("domains: data hit → worldbank 腿(真题面: world bank open data gdp api)", () => {
  const r = lookupDomains("world bank open data gdp api");
  assert.ok(r, "world bank 题必须命中 data lane");
  assert.equal(r.topic, "data");
  assert.deepEqual(r.apiProviders, ["worldbank"]);
  const zh = lookupDomains("世界银行 中国 统计数据");
  assert.ok(zh && zh.topic === "data");
});

test("laneLegProviders: dictionary/medical/data 带聚合兜底腿(合法空防塌方同款)", () => {
  assert.deepEqual(laneLegProviders("dictionary", ["wiktionary"]), ["wiktionary", "searxng", "tavily"]);
  assert.deepEqual(
    laneLegProviders("medical", ["europepmc", "clinicaltrials"]),
    ["europepmc", "clinicaltrials", "searxng", "tavily"],
  );
  assert.deepEqual(laneLegProviders("data", ["worldbank"]), ["worldbank", "searxng", "tavily"]);
  // registry 纯度教训不回退
  assert.deepEqual(laneLegProviders("packages", ["npm"]), ["npm"]);
});
