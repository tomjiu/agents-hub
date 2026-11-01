/**
 * authority.test.ts — 权威域名优先 v0.8
 * 覆盖: 域名段精确匹配(子域命中/伪装域不命中/非 http 不崩) + fuse 提权排序 + authorityBoost=0 关闭
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTHORITY_DOMAINS, matchAuthority, classifySourceKind, type AuthorityEntry } from "../authority.js";
import { SPAM_BLOCKED_DOMAINS, SPAM_DOWNWEIGHT_DOMAINS } from "../credibility.js";
import { fileURLToPath } from "node:url";
import { fuse } from "../fusion.js";
import type { Reference } from "../types.js";

test("matchAuthority: 裸域名命中", () => {
  assert.equal(matchAuthority("https://arxiv.org/abs/2005.11401"), "arxiv.org");
  assert.equal(matchAuthority("https://www.nature.com/articles/s41586-024-1"), "nature.com");
});

test("matchAuthority: 子域命中(ieeeexplore/link.springer/pubmed)", () => {
  assert.equal(matchAuthority("https://ieeexplore.ieee.org/document/9"), "ieee.org");
  assert.equal(matchAuthority("https://link.springer.com/chapter/10.1007/1"), "springer.com");
  assert.equal(matchAuthority("https://pubmed.ncbi.nlm.nih.gov/12345/"), "ncbi.nlm.nih.gov");
  assert.equal(matchAuthority("https://pmc.ncbi.nlm.nih.gov/articles/PMC1/"), "ncbi.nlm.nih.gov");
});

test("matchAuthority: 后缀伪装域不命中(段精确)", () => {
  assert.equal(matchAuthority("https://fake-arxiv.org/abs/1"), null);
  assert.equal(matchAuthority("https://notarxiv.org/abs/1"), null);
  assert.equal(matchAuthority("https://ieee.org.evil.example/1"), null);
});

test("matchAuthority: 大写 host 与非法 URL", () => {
  assert.equal(matchAuthority("https://ARXIV.ORG/abs/1"), "arxiv.org");
  assert.equal(matchAuthority("not a url"), null);
});

test("表完整性: 无重复/全小写/无协议前缀", () => {
  const set = new Set(AUTHORITY_DOMAINS);
  assert.equal(set.size, AUTHORITY_DOMAINS.length, "域名不应重复");
  for (const d of AUTHORITY_DOMAINS) {
    assert.equal(d, d.toLowerCase(), `${d} 应全小写`);
    assert.ok(!d.includes("/") && !d.includes(":"), `${d} 应是纯域名`);
    assert.ok(d.includes("."), `${d} 应带 TLD 点`);
  }
  assert.ok(AUTHORITY_DOMAINS.includes("arxiv.org"), "首批必须含学术站 arxiv.org");
  assert.ok(AUTHORITY_DOMAINS.includes("wikipedia.org"), "事实型查询最优源 wikipedia 必须在表");
});

function ref(url: string, title: string, engine = "duckduckgo", snippet = ""): Reference {
  return { url, title, snippet, engines: [engine] };
}

test("fuse 提权: 权威结果排名前移且带 authority 标注", () => {
  // CSDN 转载排引擎第 1, arXiv 原文排引擎第 5(词法同分) — 提权后应反超
  // phase AF 页面级守卫: 真实 arXiv 结果的摘要必含查询关键 token(transformer), 夹具同步真实形状
  const list: Reference[] = [
    ref("https://blog.csdn.net/transformer-详解", "transformer attention 详解", "duckduckgo"),
    ref("https://seo-site.example/transformer", "transformer attention guide", "duckduckgo"),
    ref("https://forum.example.com/t/transformer", "transformer attention question", "duckduckgo"),
    ref("https://arxiv.org/abs/1706.03762", "Attention Is All You Need", "duckduckgo",
      "The dominant sequence transduction models are based on Transformers; we propose a new transformer architecture"),
  ];
  const out = fuse(list, { query: "transformer attention paper" });
  const arxivIdx = out.findIndex((r) => r.url.includes("arxiv.org"));
  assert.ok(arxivIdx === 0, `arXiv 应提权到第 1, 实际第 ${arxivIdx + 1}`);
  assert.equal(out[0].authority, "arxiv.org");
  assert.equal(out.find((r) => r.url.includes("csdn"))?.authority, undefined);
});

test("fuse 弱提权(0.4): 事实型查询里字面强相关的非权威页不被反超", () => {
  // quality-bench case-3 教训: 通用查询弱提权 → 标题党(多命中一个词)应保持在前
  const list: Reference[] = [
    ref("https://en.wikipedia.org/wiki/World_Wide_Web", "World Wide Web"), // 命中 web (1/3 lex), 但权威 +0.4
    ref("https://random-blog.example.com/world-wide-web-history", "who invented the world wide web facts"), // 命中 3/3 lex, 非权威
  ];
  const out = fuse(list, { query: "who invented the world wide web", authorityBoost: 0.4 });
  assert.equal(out[0].url.includes("wikipedia"), false,
    "0.4 弱提权不应反超全词命中的非权威页(0.75 才能反超一个词差)");
  assert.equal(out.find((r) => r.url.includes("wikipedia"))?.authority, "wikipedia.org");
});

test("fuse authorityBoost=0: 关闭提权, 顺序回落引擎序", () => {
  const list: Reference[] = [
    ref("https://blog.csdn.net/transformer", "transformer attention 详解", "duckduckgo"),
    ref("https://arxiv.org/abs/1706.03762", "Attention Is All You Need", "duckduckgo"),
  ];
  const out = fuse(list, { query: "transformer attention paper", authorityBoost: 0 });
  assert.equal(out[0].url.includes("csdn"), true, "关闭后 CSDN(引擎第 1)应保持在前");
  // 关闭时不应标注 authority(信号归零, 不误导消费方)
  assert.equal(out.find((r) => r.url.includes("arxiv"))?.authority, "arxiv.org",
    "标注仍保留(matchAuthority 与 boost 独立), 消费方可见");
});

// ---------- phase AC: 三层权威(主题分档/意图类别/zh 守卫/社区意图) ----------

import {
  TIER_BOOST, TOPIC_AUTHORITY, CATEGORY_AUTHORITY,
  matchTopicAuthority, matchCategoryAuthority, detectCategory, detectCommunityIntent,
} from "../authority.js";

test("matchTopicAuthority: 分档提权值(s=1.2/a=0.75/b=0.4)", () => {
  assert.equal(matchTopicAuthority("https://docs.python.org/3/library/asyncio.html", "programming")?.boost, 1.2);
  assert.equal(matchTopicAuthority("https://github.com/tokio-rs/tokio", "programming")?.boost, 0.75);
  assert.equal(matchTopicAuthority("https://runoob.com/python/python-asyncio.html", "programming", "zh")?.boost, 0.4);
  assert.equal(matchTopicAuthority("https://crates.io/crates/tokio", "packages")?.boost, 1.2);
});

test("matchTopicAuthority: zh 守卫 — 英文题中文站零提权, 中文题生效", () => {
  // 英文题: runoob(zh 条目)不提权; 中文题: 提权
  assert.equal(matchTopicAuthority("https://runoob.com/x", "programming", "en"), null);
  assert.ok(matchTopicAuthority("https://runoob.com/x", "programming", "zh"));
  // 无 lang 参数(未检测)同样不触发 zh 条目 — 宁缺勿错
  assert.equal(matchTopicAuthority("https://runoob.com/x", "programming"), null);
});

test("matchTopicAuthority: 段精确与未知 topic", () => {
  assert.equal(matchTopicAuthority("https://fake-docs.python.org.evil.com/x", "programming"), null);
  assert.equal(matchTopicAuthority("https://liaoxuefeng.com/x", "不存在的topic"), null);
  // 子域命中: zhuanlan.zhihu.com 应命中 zhihu.com 条目
  assert.ok(matchTopicAuthority("https://zhuanlan.zhihu.com/p/123", "programming", "zh"));
});

test("matchTopicAuthority: 社区意图翻转 — kind=community 升 s 档, official 不动", () => {
  const normal = matchTopicAuthority("https://stackoverflow.com/q/123", "programming", "en", false);
  const flipped = matchTopicAuthority("https://stackoverflow.com/q/123", "programming", "en", true);
  assert.equal(normal?.boost, 0.75);
  assert.equal(flipped?.boost, 1.2, "讨论意图下社区源提到 s 档(用户点名: 讨论类查询社区反超文档)");
  // 官方文档不受翻转影响
  const docFlipped = matchTopicAuthority("https://docs.python.org/3/", "programming", "en", true);
  assert.equal(docFlipped?.boost, 1.2);
});

test("matchCategoryAuthority: 意图表提权 + zh 守卫", () => {
  const hit = matchCategoryAuthority("https://www.reuters.com/article/1", "news");
  assert.equal(hit?.boost, 1.2, "通讯社 s 档");
  assert.equal(matchCategoryAuthority("https://www.reuters.com/article/1", "不存在的cat"), null);
  // 中文新闻 zh 守卫: 英文查询不提权
  assert.equal(matchCategoryAuthority("https://www.thepaper.cn/1", "news", "en"), null);
  assert.ok(matchCategoryAuthority("https://www.thepaper.cn/1", "news", "zh"));
});

test("detectCategory: 意图关键词命中与不误伤", () => {
  assert.equal(detectCategory("OpenAI 最新新闻"), "news");
  assert.equal(detectCategory("log4j CVE 漏洞 分析"), "security");
  assert.equal(detectCategory("向量数据库 是什么"), "databases");
  assert.equal(detectCategory("react 组件库 推荐"), "design");
  assert.equal(detectCategory("python asyncio 教程"), null, "编程查询不该被意图表误伤(主题表管它)");
});

test("detectCategory: phase AI 最长关键词胜出消歧 + 检测召回补齐(vs-zai r12 诊断回归锁)", () => {
  // 消歧: "open data"(9) > "gdp"(3) → data 胜, finance 不再抢跑
  assert.equal(detectCategory("world bank open data gdp api"), "data");
  assert.equal(detectCategory("open data statistics portal"), "data");
  // 召回补齐: r12 评测 6/10 类目题运行时 null → 类目权威层生产路径系统性失活
  assert.equal(detectCategory("federal reserve interest rate decision 2026"), "finance");
  assert.equal(detectCategory("mysql utf8mb4 collation difference"), "databases");
  assert.equal(detectCategory("个人信息保护法 数据跨境 规定"), "legal");
  assert.equal(detectCategory("metformin side effects long term"), "medical");
  assert.equal(detectCategory("design tokens figma vs tailwind comparison"), "design");
  assert.equal(detectCategory("khan academy linear algebra course"), "education");
  assert.equal(detectCategory("阿司匹林 肠溶片 什么时候吃"), "medical");
  // 更长锚优先: "sql 注入" 落 security, 裸 "sql" 落 databases
  assert.equal(detectCategory("sql 注入 防御措施"), "security");
  assert.equal(detectCategory("sql 查询优化技巧"), "databases");
  // 不误伤: 新词不污染非类目查询
  assert.equal(detectCategory("of course how to learn programming"), null);
  assert.equal(detectCategory("rust lifetimes explained with examples"), null);
  assert.equal(detectCategory("依赖注入 容器 原理"), null, "\"注入\"裸词不收, 依赖注入是编程概念");
});

test("detectCommunityIntent: 讨论类查询命中, 事实类不误伤", () => {
  assert.equal(detectCommunityIntent("rust 开发者怎么看 tokio 的未来"), true);
  assert.equal(detectCommunityIntent("what do you think about rust async"), true);
  assert.equal(detectCommunityIntent("python asyncio 教程"), false);
  assert.equal(detectCommunityIntent("redis 持久化配置"), false);
});

test("三层表完整性: 全小写/纯域名/表内无重复/zh 条目有 kind 或至少可定位", () => {
  for (const [name, table] of [["topic", TOPIC_AUTHORITY], ["category", CATEGORY_AUTHORITY]] as const) {
    for (const [key, entries] of Object.entries(table)) {
      const seen = new Set<string>();
      for (const { domain, tier } of entries) {
        assert.ok(!domain.includes("/") && !domain.includes(":") && !domain.includes(" "),
          `${name}[${key}] ${domain} 应是纯域名`);
        assert.equal(domain, domain.toLowerCase(), `${name}[${key}] ${domain} 应全小写`);
        assert.ok(domain.includes("."), `${name}[${key}] ${domain} 应带点`);
        assert.ok(tier in TIER_BOOST, `${name}[${key}] ${domain} tier 非法`);
        assert.ok(!seen.has(domain), `${name}[${key}] ${domain} 表内重复`);
        seen.add(domain);
      }
    }
  }
});

// ---------- phase AD: 外挂覆盖(SC_AUTHORITY_JSON) ----------

import { mergeExternalAuthority } from "../authority.js";

test("mergeExternalAuthority: 追加新域 + 同域覆盖 tier", () => {
  // 新域追加
  let r = mergeExternalAuthority(JSON.stringify({
    topics: { programming: [{ domain: "example-unittest-doc.dev", tier: "a" }] },
  }));
  assert.equal(r.topics, 1);
  const added = matchTopicAuthority("https://example-unittest-doc.dev/guide", "programming");
  assert.equal(added?.boost, 0.75);
  // 同域覆盖: a → s
  r = mergeExternalAuthority(JSON.stringify({
    topics: { programming: [{ domain: "example-unittest-doc.dev", tier: "s" }] },
  }));
  assert.equal(matchTopicAuthority("https://example-unittest-doc.dev/guide", "programming")?.boost, 1.2);
  assert.equal(r.topics, 1, "同域重声明计一次覆盖");
});

test("mergeExternalAuthority: 非法域跳过 + 坏 JSON 整体跳过不阻塞", () => {
  const r = mergeExternalAuthority(JSON.stringify({
    topics: { programming: [{ domain: "not a domain!!", tier: "s" }, { domain: "ok-unittest.dev" }] },
  }));
  assert.equal(r.skipped, 1);
  assert.ok(matchTopicAuthority("https://ok-unittest.dev/x", "programming"), "合法条目仍应入表(缺 tier 落 b 档)");
  const bad = mergeExternalAuthority("{not-json");
  assert.deepEqual(bad, { topics: 0, categories: 0, skipped: 1 });
  assert.deepEqual(mergeExternalAuthority(undefined), { topics: 0, categories: 0, skipped: 0 });
});

test("mergeExternalAuthority: 意图表 categories 同样可外挂", () => {
  mergeExternalAuthority(JSON.stringify({
    categories: { news: [{ domain: "unittest-news.example", tier: "a" }] },
  }));
  assert.equal(matchCategoryAuthority("https://unittest-news.example/a", "news")?.boost, 0.75);
});

// ---------- phase AF: kind 补密度(classifySourceKind) ----------

test("classifySourceKind: 条目显式 kind 最优先", () => {
  // stackoverflow 条目显式 kind=community(模式也能推出, 双保险)
  assert.equal(classifySourceKind("https://stackoverflow.com/q/123", { domain: "stackoverflow.com" }), "community");
  // 完整条目透传: caniuse 显式 kind=reference
  assert.equal(classifySourceKind("https://caniuse.com/mdn-api", { domain: "caniuse.com", kind: "reference" }), "reference");
  // 契约: 部分条目(丢了显式 kind)且不在模式/表缺省盖范围内 → 诚实 null, 不猜
  assert.equal(classifySourceKind("https://caniuse.com/mdn-api", { domain: "caniuse.com" }), null);
});

test("classifySourceKind: 表内条目缺省推导 — s 档官方域=official/news 表=media/dictionary=reference", () => {
  // programming s 档无 kind → official
  assert.equal(classifySourceKind("https://docs.python.org/3/library/asyncio.html", { domain: "docs.python.org" }), "official");
  // news 表无 kind 条目 → media
  assert.equal(classifySourceKind("https://www.reuters.com/tech", { domain: "reuters.com" }), "media");
  // dictionary 表 → reference
  assert.equal(classifySourceKind("https://merriam-webster.com/dict/test", { domain: "merriam-webster.com" }), "reference");
  // 无条目但子域命中表内域名(zai 侧同尺)
  assert.equal(classifySourceKind("https://docs.python.org/3/library/asyncio.html"), "official");
});

test("classifySourceKind: 域名模式优先于表缺省 — github=community 而非 official(翻转语义不泄漏)", () => {
  // github.com 在 programming 表无显式 kind(表缺省=official), 但域名模式判 community — 模式优先
  assert.equal(classifySourceKind("https://github.com/tokio-rs/tokio", { domain: "github.com" }), "community");
  // 关键纪律: 排序语义不动 — 翻转只认显式 kind, github 在社区意图下仍 0.75(不升 1.2)
  assert.equal(matchTopicAuthority("https://github.com/tokio-rs/tokio", "programming", undefined, true)?.boost, 0.75);
  // 对照: stackoverflow 显式 kind=community, 翻转升 1.2
  assert.equal(matchTopicAuthority("https://stackoverflow.com/q/1", "programming", undefined, true)?.boost, 1.2);
});

test("classifySourceKind: 表外 URL — 社区/媒体/参考库模式命中, 未知域诚实 null", () => {
  assert.equal(classifySourceKind("https://www.reddit.com/r/rust/comments/abc/"), "community");
  assert.equal(classifySourceKind("https://en.wikipedia.org/wiki/Async/await"), "reference");
  assert.equal(classifySourceKind("https://www.forbes.com/sites/x/2026/"), "media");
  assert.equal(classifySourceKind("https://random-unittest-site.example/page"), null);
  // 全局表兜底: arxiv=official(学术第一方)
  assert.equal(classifySourceKind("https://arxiv.org/abs/1706.03762", { domain: "arxiv.org" }), "official");
  assert.equal(classifySourceKind("https://en.wikipedia.org/wiki/Async/await", { domain: "wikipedia.org" }), "reference");
});

// ---------- phase AG-3: 表数据外置(JSON 单一真源, loader 不丢不改) ----------

test("AG-3 外置表: data JSON 与内存表逐条一致(loader 零丢改) + 空表主题保留", async () => {
  const { readFileSync } = await import("node:fs");
  const rd = (f: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../data/authority/${f}`, import.meta.url)), "utf8"));

  const globalJson = rd("global.json") as { domains: string[] };
  assert.deepEqual(globalJson.domains, AUTHORITY_DOMAINS); // 顺序敏感的逐条一致

  // 注: 同文件更早的 mergeExternalAuthority 测试会向模块级表追加外挂条目(合法覆盖路径),
  // 所以这里守"JSON ⊆ 内存"方向: JSON 每条都要在内存表里逐条相等(loader 零丢改), 内存可多不可少。
  const topicsJson = rd("topics.json") as { topics: Record<string, AuthorityEntry[]> };
  for (const [k, list] of Object.entries(topicsJson.topics)) {
    const mem = TOPIC_AUTHORITY[k] ?? [];
    assert.ok(mem.length >= list.length, `topics.${k} 内存表比 JSON 短(${mem.length} < ${list.length})`);
    for (let i = 0; i < list.length; i++) {
      assert.deepEqual(mem[i], list[i], `topics.${k}[${i}] 有丢改`);
    }
  }
  assert.deepEqual(Object.keys(topicsJson.topics), Object.keys(TOPIC_AUTHORITY)); // images 空表占位也保留
  assert.ok(TOPIC_AUTHORITY["programming"].length >= 50, "大表意外缩水=加载路径损坏");

  const catJson = rd("categories.json") as { categories: Record<string, AuthorityEntry[]> };
  for (const [k, list] of Object.entries(catJson.categories)) {
    const mem = CATEGORY_AUTHORITY[k] ?? [];
    assert.ok(mem.length >= list.length, `categories.${k} 内存表比 JSON 短`);
    for (let i = 0; i < list.length; i++) {
      assert.deepEqual(mem[i], list[i], `categories.${k}[${i}] 有丢改`);
    }
  }

  const credJson = rd("credibility.json") as { blocked: string[]; downweight: string[] };
  assert.deepEqual(credJson.blocked, SPAM_BLOCKED_DOMAINS);
  assert.deepEqual(credJson.downweight, SPAM_DOWNWEIGHT_DOMAINS);
  assert.ok(SPAM_BLOCKED_DOMAINS.includes("csdn.net"), "用户点名站不得意外丢失");
});
