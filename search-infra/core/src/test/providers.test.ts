/**
 * Provider 黄金样本测试: mock fetchImpl,验证各引擎解析器
 * (回归清单 v0-spec §5: markup 漂移必须报错而非静默空结果)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
// DDG 限速门关闭(测试无真实间隔; gate 读 env 是函数级,任意时机设置生效)
process.env.SC_DDG_MIN_INTERVAL_MS = "0";
import { duckduckgo, decodeDdgHref } from "../providers/duckduckgo.js";
import { yahoo, decodeYahooHref } from "../providers/yahoo.js";
import { mojeek } from "../providers/mojeek.js";
import { searxng } from "../providers/searxng.js";
import { github, tavily } from "../providers/api.js";
import type { SearchCtx } from "../providers/base.js";
import type { SearchOptions } from "../types.js";

type AnyFetch = (url: string, init?: RequestInit) => Promise<Response>;

function ctxWith(body: string, contentType = "text/html", status = 200): { ctx: SearchCtx; calls: string[] } {
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

const DDG_HTML = `<html><body>
<div class="result web-result">
  <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Frust&amp;rut=xyz">Rust lang home</a></h2>
  <a class="result__snippet" href="#">A systems programming language that runs blazingly fast.</a>
</div>
<div class="result">
  <h2 class="result__title"><a class="result__a" href="https://direct.example.com/page2">Direct link result</a></h2>
  <a class="result__snippet" href="#">Snippet two here.</a>
</div></body></html>`;

test("duckduckgo: parse golden sample + uddg decode", async () => {
  const { ctx, calls } = ctxWith(DDG_HTML);
  const refs = await duckduckgo.search("rust lang", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://example.org/rust");
  assert.ok(refs[0].title.includes("Rust lang home"));
  assert.ok(refs[0].snippet.includes("blazingly fast"));
  assert.ok(calls[0].startsWith("https://html.duckduckgo.com/html/"));
});

test("decodeDdgHref variants", () => {
  assert.equal(decodeDdgHref("//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.io%2Fb"), "https://a.io/b");
  assert.equal(decodeDdgHref("https://plain.com/x"), "https://plain.com/x");
  assert.equal(decodeDdgHref(""), "");
});

const YAHOO_HTML = `<html><body><div id="web"><ol>
<li><div class="compTitle"><a href="https://r.search.yahoo.com/_ylt=abc/RU=https%3a%2f%2fresult.io%2fpage/RK=2/RS=xyz">Result One</a></div>
<div class="compText"><p>Description one for the page.</p></div></li>
<li><div class="compTitle"><a href="https://clean.example.com/direct">Direct Result</a></div>
<div class="compText"><p>Description two.</p></div></li>
</ol></div></body></html>`;

test("yahoo: parse golden sample + RU= decode", async () => {
  const { ctx } = ctxWith(YAHOO_HTML);
  const refs = await yahoo.search("test", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://result.io/page");
  assert.equal(refs[1].url, "https://clean.example.com/direct");
});

test("decodeYahooHref variants", () => {
  assert.equal(decodeYahooHref("https://r.search.yahoo.com/_ylt=a/RU=https%3a%2f%2fx.io%2f1/RK=2"), "https://x.io/1");
  assert.equal(decodeYahooHref("https://plain.io/"), "https://plain.io/");
});

const MOJEEK_HTML = `<html><body><ul class="results-standard">
<li><h2><a class="title" href="https://mojeek-result.io/a">Mojeek hit one</a></h2><p class="s">Snippet for hit one.</p></li>
<li><h2><a class="title" href="https://mojeek-result.io/b">Hit two</a></h2><p class="sc">Snippet two.</p></li>
</ul></body></html>`;

test("mojeek: parse golden sample", async () => {
  const { ctx } = ctxWith(MOJEEK_HTML);
  const refs = await mojeek.search("q", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://mojeek-result.io/a");
});

test("searxng: json api golden sample", async () => {
  searxng.config = { baseUrl: "https://searx.example.home" };
  const { ctx, calls } = ctxWith(
    JSON.stringify({ results: [{ url: "https://r.io/1", title: "T1", content: "C1", publishedDate: "2026-01-01" }] }),
    "application/json",
  );
  const refs = await searxng.search("q", ctx);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].title, "T1");
  assert.equal(refs[0].published, "2026-01-01");
  assert.ok(calls[0].includes("format=json"));
});

test("searxng: phase AB 多实例链后 isConfigured 恒 true(内置兜底); 显式空名单才可关", () => {
  searxng.config = {};
  assert.equal(searxng.isConfigured(), true); // 内置兜底链常在
  searxng.config = { baseUrl: "https://x" };
  assert.equal(searxng.isConfigured(), true);
  searxng.config = { instances: [] }; // 用户显式禁用兜底链且无自建 → 不配置
  assert.equal(searxng.isConfigured(), false);
});

test("github: repositories golden sample", async () => {
  const { ctx, calls } = ctxWith(
    JSON.stringify({ items: [{ html_url: "https://github.com/a/b", full_name: "a/b", description: "desc", stargazers_count: 123, pushed_at: "2026-08-01T00:00:00Z" }] }),
    "application/json",
  );
  const refs = await github.search("sqlite vec", ctx);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].kind, "github");
  assert.ok(refs[0].snippet!.includes("★123"));
  assert.ok(calls[0].includes("api.github.com"));
});

test("markup drift: parser throws instead of silent empty (regression)", async () => {
  const { ctx } = ctxWith("<html><body>totally not a search page</body></html>");
  await assert.rejects(() => duckduckgo.search("q", ctx), /no results parsed/);
  await assert.rejects(() => mojeek.search("q", ctx), /no results parsed/);
  await assert.rejects(() => yahoo.search("q", ctx), /no results parsed/);
});

// ---------- v0.3 免 key 扩池 golden 样本(targets-search.md P0, 响应取自 2026-09-02/03 实测) ----------

import {
  marginalia, openverse, hn, wikipedia, bingrss, arxiv, crossref, mwmbl, googlenews, wiby, keenable, mdn, bingnews,
} from "../providers/keyless-apis.js";

test("marginalia: json golden sample (api2 新端点 + 旧端点 fallback)", async () => {
  const body = JSON.stringify({
    license: "CC-BY-NC-SA 4.0",
    results: [
      { url: "https://www.sophiajt.com/rls-alpha-2/", title: "Rust Language Server Alpha 2 Release", description: "Rust Language Server Alpha 2 Release. March 02, 2017.", quality: 3.41 },
    ],
  });
  // 主路: api2.marginalia-search.com(2025-12-08 新 API)
  const { ctx, calls } = ctxWith(body, "application/json");
  const refs = await marginalia.search("rust language", ctx);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].url, "https://www.sophiajt.com/rls-alpha-2/");
  assert.equal(refs[0].kind, "web");
  assert.ok(calls[0].includes("api2.marginalia-search.com/search"), calls[0]);
  assert.ok(calls[0].includes("dc=3"), "dc=3 源头每域上限与 domainCap 对齐");

  // api2 5xx → 旧端点 fallback(同形 JSON)
  const calls2: string[] = [];
  let n = 0;
  const fetch2 = async (url: string) => {
    calls2.push(String(url));
    n++;
    return new Response(n === 1 ? "err" : body, { status: n === 1 ? 503 : 200, headers: { "Content-Type": "application/json" } });
  };
  const ctx2 = { ...ctxWith(body).ctx, fetchImpl: fetch2 as never };
  const refs2 = await marginalia.search("rust language", ctx2);
  assert.equal(refs2.length, 1);
  assert.ok(calls2[1].includes("api.marginalia.nu/public/search/"), calls2.join("|"));

  // 双端点全挂 → 抛错交熔断
  const fetch3 = async () => new Response("err", { status: 503 });
  const ctx3 = { ...ctxWith(body).ctx, fetchImpl: fetch3 as never };
  await assert.rejects(() => marginalia.search("rust language", ctx3), /both failed/);
});

test("wiby: json array golden sample, Description 优先 Snippet 兑底", async () => {
  const body = JSON.stringify([
    {
      URL: "https://blog.ari.lt/b/reflection-petrapixels-2nd-indie-web-contest/",
      Title: "Blog - ari.lt - Reflection on PetraPixel&#39;s 2nd Indie Web Contest",
      Snippet: "skip | 2025-12-31 15:04:57 GMT | visitor | 7 min read home | stats | donate | comment | website | microblog | src",
      Description: "Reflection on PetraPixel&#39;s 2nd Indie Web Contest by Arija A.",
    },
    {
      URL: "https://frutigeraeroarchive.org/blog/posts/26_07_2025",
      Title: "Get Started On The Indie Web",
      Snippet: "ntact Get <b>started</b>",
    },
  ]);
  const { ctx, calls } = ctxWith(body, "application/json");
  const refs = await wiby.search("indie web", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://blog.ari.lt/b/reflection-petrapixels-2nd-indie-web-contest/");
  // Description 是真摘要, Snippet 的导航噪声(日期/菜单)不进库
  assert.ok(refs[0].snippet!.startsWith("Reflection on PetraPixel"));
  assert.ok(!refs[0].snippet!.includes("home | stats"));
  // 无 Description 时回退 Snippet 去 HTML
  assert.ok(refs[1].snippet!.includes("Get started"));
  assert.ok(calls[0].startsWith("https://wiby.me/json/"), calls[0]);
  assert.ok(calls[0].includes("q=indie"), calls[0]);
});

test("keenable: public lane golden, title header + snippet priority + freshness delta", async () => {
  const body = JSON.stringify({
    query: "rust async runtime tokio",
    mode: "realtime",
    results: [
      { title: "Rust Async Runtimes: Tokio vs async-std vs smol 2026", url: "https://rustify.rs/articles/rust-async-runtimes-tokio-vs-async-std-2026", description: "", snippet: "Unless you have a specific reason to avoid Tokio, use Tokio", published_at: "2026-06-11T00:00:00Z", acquired_at: "2026-08-20T01:42:13Z" },
      { title: "tokio-rs/tokio", url: "https://github.com/tokio-rs/tokio", snippet: "A runtime for writing reliable, asynchronous applications" },
    ],
  });
  const inits: RequestInit[] = [];
  const calls: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    inits.push(init ?? {});
    return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const ctx = { ...ctxWith(body, "application/json").ctx, fetchImpl: fetchImpl as never };
  const refs = await keenable.search("rust async runtime tokio", { ...ctx, opts: { ...ctx.opts, freshness: "month" } });
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://rustify.rs/articles/rust-async-runtimes-tokio-vs-async-std-2026");
  // description 空时 snippet 顶上(探针实测 description 常空)
  assert.ok(refs[0].snippet!.startsWith("Unless you have a specific reason"));
  assert.equal(refs[0].published, "2026-06-11T00:00:00Z");
  // 公共路: /v1/search/public + X-Keenable-Title 自报家门
  assert.ok(calls[0].includes("/v1/search/public"), calls[0]);
  const hdrs = inits[0].headers as Record<string, string>;
  assert.ok(hdrs["X-Keenable-Title"], "public lane 必须带应用名头");
  assert.equal(hdrs["X-API-Key"], undefined);
  assert.ok(String(inits[0].body).includes("published_after") && String(inits[0].body).includes("30d"), "freshness=month → published_after=30d");
  assert.ok(String(inits[0].body).includes("max_results"));
});

test("keenable: key lane upgrade (SC_KEENABLE_KEY → /v1/search + X-API-Key)", async () => {
  process.env.SC_KEENABLE_KEY = "keen_test";
  try {
    const { ctx, calls } = ctxWith(JSON.stringify({ results: [{ title: "t", url: "https://a.io", description: "d" }] }), "application/json");
    const refs = await keenable.search("q", ctx);
    assert.equal(refs.length, 1);
    assert.ok(calls[0].endsWith("/v1/search"), calls[0]);
    assert.ok(!calls[0].includes("/public"));
  } finally {
    delete process.env.SC_KEENABLE_KEY; // 不污染其他测试
  }
});

test("tavily: baseUrl 可指 Tavily 兼容网关(Hikari), 默认官方端点不变", async () => {
  const body = JSON.stringify({ results: [{ url: "https://a.io", title: "t", content: "c" }] });
  const calls: string[] = [];
  const fetchImpl = async (url: string, _init?: RequestInit) => {
    calls.push(String(url));
    return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const ctx = { ...ctxWith(body, "application/json").ctx, fetchImpl: fetchImpl as never };
  const saved = tavily.config;
  try {
    // 网关路线: SC_TAVILY_BASE_URL 注入(config.baseUrl)
    tavily.config = { apiKey: "th-test", baseUrl: "https://tavily.ivanli.cc/api/tavily" };
    await tavily.search("q", ctx);
    assert.equal(calls[0], "https://tavily.ivanli.cc/api/tavily/search", calls[0]);
    // 默认路线: 不配 baseUrl → 官方端点
    tavily.config = { apiKey: "tvly-test" };
    await tavily.search("q", ctx);
    assert.equal(calls[1], "https://api.tavily.com/search", calls[1]);
    // 尾斜杠容忍
    tavily.config = { apiKey: "k", baseUrl: "https://gw.example.com/api/tavily/" };
    await tavily.search("q", ctx);
    assert.equal(calls[2], "https://gw.example.com/api/tavily/search", calls[2]);
  } finally {
    tavily.config = saved;
  }
});

// ---------- Openverse (CC 图片搜索) golden 见下 ----------

test("openverse: image golden sample, kind=image + license in snippet", async () => {
  const { ctx, calls } = ctxWith(
    JSON.stringify({
      result_count: 240,
      results: [
        {
          title: "Cat Fish 2",
          foreign_landing_url: "https://www.flickr.com/photos/x/3481540500",
          url: "https://live.staticflickr.com/3313/3481540500_c846c62863_b.jpg",
          license: "by", license_version: "2.0", provider: "flickr", creator: "admiller",
        },
      ],
    }),
    "application/json",
  );
  const refs = await openverse.search("cat", ctx);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].kind, "image");
  assert.equal(refs[0].url, "https://live.staticflickr.com/3313/3481540500_c846c62863_b.jpg");
  assert.ok(refs[0].snippet!.includes("flickr.com/photos/x/3481540500"));
  assert.ok(refs[0].snippet!.includes("CC-BY 2.0"));
  assert.ok(calls[0].includes("api.openverse.org/v1/images/"));
});

test("openverse: 零命中=合法空返回[](phase AH: throw 会给 images 唯一腿熔断计败)", async () => {
  const { ctx } = ctxWith(JSON.stringify({ result_count: 0, results: [] }), "application/json");
  const refs = await openverse.search("unsplash pexels free stock photos api comparison", ctx);
  assert.deepEqual(refs, []);
});

test("hn: story golden sample, external url + fallback to item page", async () => {
  const { ctx } = ctxWith(
    JSON.stringify({
      hits: [
        { objectID: "1", title: "Why Discord is switching from Go to Rust", url: "https://blog.discordapp.com/why-rust", points: 1200, num_comments: 400, author: "someone", created_at: "2026-01-01T00:00:00Z" },
        { objectID: "2", title: "Ask HN: favorite editor?", url: null, points: 5, num_comments: 30, author: "a2", created_at: "2026-02-01T00:00:00Z" },
      ],
    }),
    "application/json",
  );
  const refs = await hn.search("rust discord", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://blog.discordapp.com/why-rust");
  assert.equal(refs[1].url, "https://news.ycombinator.com/item?id=2");
  assert.ok(refs[0].snippet!.includes("1200 pts"));
  assert.equal(refs[0].published, "2026-01-01T00:00:00Z");
});

test("wikipedia: REST v1 golden sample, description snippet + lang routing", async () => {
  // 10-a: 403 破案=UA 政策非协议; REST v1 响应带 description(比 excerpt 干净)和 key(slug)
  const { ctx, calls } = ctxWith(
    JSON.stringify({
      pages: [
        { id: 29414838, key: "Rust_(programming_language)", title: "Rust (programming language)", excerpt: "<span class=\"searchmatch\">Rust</span> is a general-purpose language.", description: "General-purpose programming language" },
        { id: 1, key: "Rust", title: "Rust", excerpt: "Oxide film.", description: null as unknown as string },
      ],
    }),
    "application/json",
  );
  const refs = await wikipedia.search("rust language", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://en.wikipedia.org/wiki/Rust_(programming_language)");
  assert.ok(refs[0].snippet!.startsWith("General-purpose programming language"));
  assert.ok(!refs[0].snippet!.includes("<span"));
  // description 缺失时回退 excerpt 去 HTML
  assert.ok(refs[1].snippet!.startsWith("Oxide film."));

  const zh = ctxWith(JSON.stringify({ pages: [{ key: "鏽", title: "鏽" }] }), "application/json");
  const zctx = { ...zh.ctx, opts: { ...zh.ctx.opts, lang: "zh-CN" } };
  await wikipedia.search("rust", zctx);
  assert.ok(zh.calls[0].startsWith("https://zh.wikipedia.org/"));
  assert.ok(zh.calls[0].includes("/w/rest.php/v1/search/page"), zh.calls[0]);
});

test("bingrss: xml golden sample", async () => {
  const rss = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>Bing: q</title>
<item><title>Result One &amp; More</title><link>https://result-one.io/page</link><description>Desc with <b>html</b> inside.</description><pubDate>Tue, 01 Sep 2026 00:00:00 GMT</pubDate></item>
<item><title>Result Two</title><link>https://result-two.io/</link><description>Desc two.</description></item>
</channel></rss>`;
  const { ctx } = ctxWith(rss, "application/rss+xml");
  const refs = await bingrss.search("q", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://result-one.io/page");
  assert.ok(refs[0].title.includes("& More"));
  assert.ok(!refs[0].snippet!.includes("<b>"));
  assert.ok(refs[0].snippet!.startsWith("[bing-rss]"));
  assert.ok(refs[0].published);
});

test("arxiv: atom xml golden sample (10-a 实测形状)", async () => {
  const atom = `<?xml version='1.0'?><feed xmlns="http://www.w3.org/2005/Atom">
  <entry><id>http://arxiv.org/abs/1706.03762v7</id><title>Attention Is All You Need</title>
  <summary>The dominant sequence transduction models are based on RNNs...</summary>
  <published>2017-06-12T17:57:34Z</published>
  <author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author>
  <link href="https://arxiv.org/abs/1706.03762v7" type="text/html"/>
  <link href="https://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf" title="pdf"/></entry>
  </feed>`;
  const { ctx, calls } = ctxWith(atom, "application/atom+xml");
  const refs = await arxiv.search("attention transformer", ctx);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].url, "https://arxiv.org/abs/1706.03762v7");
  assert.equal(refs[0].title, "Attention Is All You Need");
  assert.ok(refs[0].snippet!.includes("Vaswani"));
  assert.equal(refs[0].published, "2017-06-12T17:57:34Z");
  assert.ok(calls[0].includes("export.arxiv.org/api/query"));
  assert.ok(calls[0].includes("search_query=all%3A"));
});

test("crossref: works golden sample, cited count in snippet + mailto polite pool", async () => {
  const { ctx, calls } = ctxWith(
    JSON.stringify({
      message: {
        items: [
          { DOI: "10.1109/iccv.2021.00986", title: ["Swin Transformer"], URL: "https://doi.org/10.1109/iccv.2021.00986",
            author: [{ given: "Ze", family: "Liu" }], issued: { "date-parts": [[2021]] },
            "container-title": ["ICCV"], "is-referenced-by-count": 30104 },
        ],
      },
    }),
    "application/json",
  );
  const refs = await crossref.search("swin transformer", ctx);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].url, "https://doi.org/10.1109/iccv.2021.00986");
  assert.ok(refs[0].snippet!.includes("cited 30104"));
  assert.ok(refs[0].snippet!.includes("Liu"));
  assert.ok(refs[0].snippet!.includes("ICCV"));
  assert.ok(calls[0].includes("api.crossref.org/works"));
  assert.ok(!calls[0].includes("mailto="), "无 email 配置时不带 mailto");

  // 配了 contactEmail → mailto 进 polite pool
  crossref.config = { email: "research@example.org" };
  const { ctx: ctx2, calls: calls2 } = ctxWith(JSON.stringify({ message: { items: [] } }), "application/json");
  await assert.rejects(() => crossref.search("q", ctx2), /no items parsed/);
  assert.ok(calls2[0].includes("mailto=research%40example.org"));
  crossref.config = {};
});

test("mwmbl: golden sample, bold-array flattening + s param", async () => {
  const { ctx, calls } = ctxWith(
    JSON.stringify([
      { url: "https://en.wikipedia.org/wiki/Test",
        title: [{ value: "Tes", is_bold: false }, { value: "t", is_bold: true }],
        extract: [{ value: "Look up ", is_bold: false }, { value: "test", is_bold: true }, { value: " in Wiktionary.", is_bold: false }] },
    ]),
    "application/json",
  );
  const refs = await mwmbl.search("test", ctx);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].title, "Test");
  assert.equal(refs[0].snippet, "Look up test in Wiktionary.");
  assert.ok(calls[0].includes("mwmbl.org/api/v1/search?s=test"), calls[0]);
});

test("googlenews: rss golden sample, kind=news + zh lang routing", async () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>AI - Google 新闻</title>
<item><title>Headline One - Reuters</title><link>https://news.google.com/rss/articles/CBMi?oc=5</link><description>Desc &lt;b&gt;html&lt;/b&gt;.</description><pubDate>Tue, 01 Sep 2026 00:00:00 GMT</pubDate><source>Reuters</source></item>
</channel></rss>`;
  // 默认 lang=en → US:en; kind=news
  const { ctx, calls } = ctxWith(rss, "application/rss+xml");
  const refs = await googlenews.search("ai", ctx);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].kind, "news");
  assert.ok(refs[0].title.includes("Reuters"));
  assert.ok(!refs[0].snippet!.includes("<b>"));
  assert.ok(refs[0].published);
  assert.ok(calls[0].includes("news.google.com/rss/search"));
  assert.ok(calls[0].includes("ceid=US%3Aen"), calls[0]);

  // opts.lang=zh-CN → CN:zh-Hans
  const zh = ctxWith(rss, "application/rss+xml");
  const zctx = { ...zh.ctx, opts: { ...zh.ctx.opts, lang: "zh-CN" } };
  await googlenews.search("人工智能", zctx);
  assert.ok(zh.calls[0].includes("ceid=CN%3Azh-Hans"), zh.calls[0]);
  assert.ok(zh.calls[0].includes("hl=zh-CN"), zh.calls[0]);
});

test("googlenews: valid RSS zero item = legal empty (AH openverse same lesson, news lane prerequisite)", async () => {
  const { ctx } = ctxWith("<rss><channel><title>empty</title></channel></rss>", "application/rss+xml");
  assert.deepEqual(await googlenews.search("niche topic nobody covered", ctx), []);
  // 根标记缺失(被挑战页/改版)仍抛错交熔断
  const { ctx: ctxHtml } = ctxWith("<html><body>challenge</body></html>", "text/html");
  await assert.rejects(() => googlenews.search("ai", ctxHtml), /markup drift/);
});

test("bingnews: apiclick url= decode real publisher link + kind=news; zero item legal empty; HTML drift throws", async () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>EU AI Act</title>
<item><title>AI Act deadline nears - Onrec</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fwww.onrec.com%2fnews%2feu-ai-act-hiring&amp;c=1</link><description>High-risk hiring rules changed.</description><pubDate>Wed, 02 Sep 2026 17:00:00 GMT</pubDate><News:Source>Onrec</News:Source></item>
</channel></rss>`;
  const { ctx } = ctxWith(rss, "application/rss+xml");
  const refs = await bingnews.search("EU AI Act news", ctx);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].url, "https://www.onrec.com/news/eu-ai-act-hiring", "apiclick 内嵌真实出版方链接应被解码");
  assert.equal(refs[0].kind, "news");
  assert.ok(refs[0].published);

  // 零 item 有效 RSS = 合法空
  const { ctx: ctxEmpty } = ctxWith("<rss><channel><title>none</title></channel></rss>", "application/rss+xml");
  assert.deepEqual(await bingnews.search("obscure niche news", ctxEmpty), []);

  // 被挑战页 = 形状漂移抛错
  const { ctx: ctxHtml } = ctxWith("<html><body>challenge page</body></html>", "text/html");
  await assert.rejects(() => bingnews.search("ai", ctxHtml), /markup drift/);
});

test("keyless-apis: empty results throw (regression)", async () => {
  // phase AH: openverse 移出本锁 — 空命中=合法空返回 [](与 pypi 同纪律, 单腿车道不当熔断计败); 独立断言在上方
  // phase AJ: googlenews 同款移出(有效 RSS 零 item = 合法空, news lane 接线前提); 独立断言在下方
  for (const p of [marginalia, hn, wikipedia, arxiv, crossref, mwmbl, wiby, keenable]) {
    const { ctx } = ctxWith(p === arxiv ? "<feed></feed>" : p === bingrss ? "<rss><channel></channel></rss>" : "{}", "application/json");
    await assert.rejects(() => p.search("q", ctx), /no (results|items|entries) parsed/);
  }
  const { ctx } = ctxWith("<rss><channel></channel></rss>", "application/rss+xml");
  await assert.rejects(() => bingrss.search("q", ctx), /no items parsed/);
});

test("ddg: 202 soft-block retried then surfaces as failure, not fake empty", async () => {
  const calls: string[] = [];
  const fetch202 = async (url: string) => {
    calls.push(String(url));
    return new Response("", { status: 202 });
  };
  const ctx = { ...ctxWith("").ctx, fetchImpl: fetch202 as never };
  await assert.rejects(() => duckduckgo.search("q", ctx), /no results parsed/);
  assert.equal(calls.length, 2, "202 空页触发单次退避重试");
});

// ---------- phase AA: MDN 官方文档直连 ----------

test("mdn: golden — documents[] 映射(url 拼接/summary 摘要/locale 跟随查询语言)", async () => {
  const body = JSON.stringify({
    documents: [
      { title: "Fetch API", mdn_url: "/zh-CN/docs/Web/API/Fetch_API", summary: "Fetch 接口用于获取资源", locale: "zh-cn", score: 21.8, popularity: 0.13 },
      { title: "Using the Fetch API", mdn_url: "/zh-CN/docs/Web/API/Fetch_API/Using_Fetch", summary: "如何使用 Fetch", locale: "zh-cn" },
    ],
  });
  const calls: string[] = [];
  const fetchImpl = async (url: string) => { calls.push(String(url)); return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }); };
  const ctx = { ...ctxWith(body, "application/json").ctx, fetchImpl: fetchImpl as never };
  // opts.lang=zh → locale=zh-CN(planner zh 检测经 engine 合并后流到这里)
  const refs = await mdn.search("fetch API", { ...ctx, opts: { ...ctx.opts, lang: "zh" } });
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://developer.mozilla.org/zh-CN/docs/Web/API/Fetch_API");
  assert.equal(refs[0].title, "Fetch API");
  assert.ok(refs[0].snippet!.includes("Fetch 接口"));
  assert.ok(calls[0].includes("locale=zh-CN"), calls[0]);
  // 无 lang → en-US
  await mdn.search("fetch API", { ...ctx, opts: { ...ctx.opts, lang: undefined } });
  assert.ok(calls[1].includes("locale=en-US"), calls[1]);
});

test("mdn: documents=[] 合法空(web 亲和题)不抛不熔断", async () => {
  const body = JSON.stringify({ documents: [], metadata: { took_ms: 4 }, suggestions: [{ text: "async", total: { value: 243 } }] });
  const ctx = ctxWith(body, "application/json").ctx;
  const refs = await mdn.search("css grid layout", ctx);
  assert.deepEqual(refs, []);
});

// ---------- phase AE: web 亲和守卫(vs-zai 第 7 采样 k8s MISS 根因之一) ----------

test("mdn: web 亲和守卫 — 非 web 编程题不发请求直接合法空(k8s/asyncio/pg 实证题)", async () => {
  let called = 0;
  const fetchImpl: AnyFetch = async () => { called++; return new Response("{}", { status: 200 }); };
  const ctx = { ...ctxWith("{}", "application/json").ctx, fetchImpl: fetchImpl as never };
  assert.deepEqual(await mdn.search("kubernetes pod disruption budget best practices", ctx), []);
  assert.deepEqual(await mdn.search("python asyncio 教程", ctx), []);
  assert.deepEqual(await mdn.search("postgresql jsonb 索引优化", ctx), []);
  assert.deepEqual(await mdn.search("rust cargo 依赖 报错", ctx), []);
  assert.equal(called, 0, "守卫命中不得发起网络请求");
});

test("mdn: web 亲和守卫 — 短词词边界(json 不误配 js/webhook 不误配 web)", async () => {
  let called = 0;
  const body = JSON.stringify({ documents: [] });
  const fetchImpl: AnyFetch = async () => { called++; return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }); };
  const ctx = { ...ctxWith(body, "application/json").ctx, fetchImpl: fetchImpl as never };
  // "json" 含 "js" 子串但守卫用词边界 → 不出腿; "webhook" 同理
  assert.deepEqual(await mdn.search("json schema 校验 报错", ctx), []);
  assert.deepEqual(await mdn.search("webhook 配置 教程", ctx), []);
  assert.equal(called, 0);
  // 真短词命中 → 出腿(\bjs\b/\bweb\b)
  assert.deepEqual(await mdn.search("js fetch abort 教程", ctx), []);
  assert.equal(called, 1, "web token 命中应照常出腿");
});

test("mdn: 响应缺 documents 字段(API 形状漂移)必须抛错交熔断", async () => {
  const ctx = ctxWith(JSON.stringify({ unexpected: true }), "application/json").ctx;
  await assert.rejects(() => mdn.search("fetch", ctx), /documents/);
});

// ---------- phase AB 免 Key 增量轮 golden(响应形状取自 2026-09-03 实测) ----------

import { anysearch, firecrawl, sov2ex } from "../providers/keyless-apis.js";
import { pubmed } from "../providers/registries.js";
import { searxng as searxngProvider, DEFAULT_SEARXNG_INSTANCES } from "../providers/searxng.js";

test("tavily: 无 key 无 baseUrl → keyless 匿名车道(带模式头, 不带 Authorization)", async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: AnyFetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify({ results: [{ url: "https://r.io/1", title: "T", content: "c" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const opts: SearchOptions = { maxResults: 5 };
  const ctx = { fetchImpl: fetchImpl as unknown as SearchCtx["fetchImpl"], signal: AbortSignal.timeout(5000), ua: "test", opts };
  const saved = { ...tavily.config };
  tavily.config = {}; // 无 key 无网关
  try {
    const refs = await tavily.search("q", ctx);
    assert.equal(refs.length, 1);
    const h = (seen[0].init?.headers ?? {}) as Record<string, string>;
    assert.equal(h["X-Tavily-Access-Mode"], "keyless");
    assert.ok(!("Authorization" in h), "keyless 车道不得带 Authorization");
    assert.ok(seen[0].url.startsWith("https://api.tavily.com/search"));
  } finally {
    tavily.config = saved;
  }
});

test("tavily: 有 key → Bearer 车道(不带 keyless 头)", async () => {
  const seen: { init?: RequestInit }[] = [];
  const fetchImpl: AnyFetch = async (_url, init) => {
    seen.push({ init });
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const opts: SearchOptions = { maxResults: 5 };
  const ctx = { fetchImpl: fetchImpl as unknown as SearchCtx["fetchImpl"], signal: AbortSignal.timeout(5000), ua: "test", opts };
  const saved = { ...tavily.config };
  tavily.config = { apiKey: "tvly-k" };
  try {
    await tavily.search("q", ctx);
    const h = (seen[0].init?.headers ?? {}) as Record<string, string>;
    assert.equal(h.Authorization, "Bearer tvly-k");
    assert.ok(!("X-Tavily-Access-Mode" in h));
  } finally {
    tavily.config = saved;
  }
});

test("anysearch: golden — code=0 data.results 映射", async () => {
  const body = JSON.stringify({
    code: 0, message: "success", request_id: "r1",
    data: { results: [
      { title: "A Conceptual Overview of asyncio", url: "https://docs.python.org/3/howto/x.html", snippet: "mental model", content: "full text" },
      { title: "Guide", url: "https://realpython.com/async-io-python/", snippet: "hands-on" },
    ] },
  });
  const { ctx, calls } = ctxWith(body, "application/json");
  const refs = await anysearch.search("python asyncio tutorial", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://docs.python.org/3/howto/x.html");
  assert.equal(refs[0].snippet, "mental model");
  assert.ok(calls[0].startsWith("https://api.anysearch.com/v1/search"));
});

test("anysearch: code!=0 与空结果都必须抛错(不静默)", async () => {
  const { ctx: c1 } = ctxWith(JSON.stringify({ code: 429, message: "rate limited" }), "application/json");
  await assert.rejects(() => anysearch.search("q", c1), /code=429/);
  const { ctx: c2 } = ctxWith(JSON.stringify({ code: 0, data: { results: [] } }), "application/json");
  await assert.rejects(() => anysearch.search("q", c2), /no results parsed/);
});

test("firecrawl: golden — success/data.web 映射 + markdown 噪音截断", async () => {
  const body = JSON.stringify({
    success: true,
    data: { web: [
      { url: "https://docs.python.org/3/howto/a-conceptual-overview-of-asyncio.html", title: "A Conceptual Overview of asyncio", description: "# heading\n- " + "noise ".repeat(200), position: 1 },
      { url: "https://r.io/2", title: "Two", description: "clean" },
    ] },
  });
  const { ctx, calls } = ctxWith(body, "application/json");
  const refs = await firecrawl.search("python asyncio", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[1].snippet, "clean");
  assert.ok(refs[0].snippet.length <= 400, "markdown 噪音必须被 clamp");
  assert.ok(calls[0].startsWith("https://api.firecrawl.dev/v2/search"));
});

test("firecrawl: success=false 与缺 data.web 形状漂移必须抛错", async () => {
  const { ctx: c1 } = ctxWith(JSON.stringify({ success: false, error: "rate limit" }), "application/json");
  await assert.rejects(() => firecrawl.search("q", c1), /rate limit/);
  const { ctx: c2 } = ctxWith(JSON.stringify({ success: true, data: {} }), "application/json");
  await assert.rejects(() => firecrawl.search("q", c2), /data\.web/);
});

test("sov2ex: golden — hits._source 映射到 v2ex 主题 URL", async () => {
  const body = JSON.stringify({
    took: 12, total: 51399,
    hits: [{ _score: 2.1, _id: "a", _source: { id: 1035318, title: "向量存储数据库该如何选择？", content: "RAG 场景", created: "2024-04-24T08:08:01", member: "sirz" } }],
  });
  const { ctx, calls } = ctxWith(body, "application/json");
  const refs = await sov2ex.search("向量数据库", ctx);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].url, "https://www.v2ex.com/t/1035318");
  assert.equal(refs[0].title, "向量存储数据库该如何选择？");
  assert.equal(refs[0].published, "2024-04-24T08:08:01");
  assert.ok(calls[0].includes("sovv2ex") === false && calls[0].includes("sov2ex.com/api/search"));
});

test("pubmed: golden — esearch→esummary 两步式(缺 idlist 抛错)", async () => {
  const bodies = [
    JSON.stringify({ esearchresult: { idlist: ["39123456", "39000001"] } }),
    JSON.stringify({ result: {
      "39123456": { title: "CRISPR Gene Editing Advances", fulljournalname: "Nature", pubdate: "2024 Jan 15", sortfirstauthor: "Zhang F" },
      "39000001": { title: "Second Paper", fulljournalname: "Cell", pubdate: "2023 Dec" },
    } }),
  ];
  const calls: string[] = [];
  const fetchImpl: AnyFetch = async (url) => {
    calls.push(String(url));
    return new Response(bodies[calls.length - 1], { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const opts: SearchOptions = { maxResults: 10 };
  const ctx = { fetchImpl: fetchImpl as unknown as SearchCtx["fetchImpl"], signal: AbortSignal.timeout(5000), ua: "test", opts };
  const refs = await pubmed.search("crispr gene editing", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://pubmed.ncbi.nlm.nih.gov/39123456/");
  assert.ok(refs[0].snippet.includes("[pubmed] Nature"));
  assert.ok(calls[0].includes("esearch.fcgi") && calls[1].includes("esummary.fcgi"));

  const { ctx: empty } = ctxWith(JSON.stringify({ esearchresult: { idlist: [] } }), "application/json");
  await assert.rejects(() => pubmed.search("q", empty), /no results parsed/);
});

test("searxng: 多实例回退链 — 首实例伪 200 HTML 换下一家, 全灭抛最后错", async () => {
  const calls: string[] = [];
  const fetchImpl: AnyFetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      // searx.be 教训: 伪 200 + 反爬挑战页(非 JSON)
      return new Response("<html><body>verify you are human</body></html>", { status: 200, headers: { "Content-Type": "text/html" } });
    }
    return new Response(JSON.stringify({ results: [{ url: "https://ok.io/1", title: "OK", content: "c" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const opts: SearchOptions = { maxResults: 5 };
  const ctx = { fetchImpl: fetchImpl as unknown as SearchCtx["fetchImpl"], signal: AbortSignal.timeout(5000), ua: "test", opts };
  const saved = { ...searxngProvider.config };
  searxngProvider.config = {}; // 用内置兜底链
  try {
    const refs = await searxngProvider.search("q", ctx);
    assert.equal(refs[0].url, "https://ok.io/1");
    assert.equal(calls.length, 2, "第一实例失败后必须换下一实例");
    assert.ok(calls[0].includes(DEFAULT_SEARXNG_INSTANCES[0].replace("https://", "")));
  } finally {
    searxngProvider.config = saved;
  }

  // 全灭: 抛最后一个错误(显式置空 config, 防前序测试的 {instances:[]} 残留)
  searxngProvider.config = {};
  const failFetch: AnyFetch = async () => new Response("<html>bot</html>", { status: 200, headers: { "Content-Type": "text/html" } });
  const ctx2 = { fetchImpl: failFetch as unknown as SearchCtx["fetchImpl"], signal: AbortSignal.timeout(5000), ua: "test", opts: { maxResults: 5 } as SearchOptions };
  try {
    await assert.rejects(() => searxngProvider.search("q", ctx2), /non-json|instances failed/);
  } finally {
    searxngProvider.config = saved;
  }
});

test("searxng: 自建 baseUrl 永远排链首(SC_SEARXNG_BASE_URL 优先于公共兜底)", async () => {
  const calls: string[] = [];
  const fetchImpl: AnyFetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const opts: SearchOptions = { maxResults: 5 };
  const ctx = { fetchImpl: fetchImpl as unknown as SearchCtx["fetchImpl"], signal: AbortSignal.timeout(5000), ua: "test", opts };
  const saved = { ...searxngProvider.config };
  searxngProvider.config = { baseUrl: "https://my-own.example" };
  try {
    // 空 results 数组对 SERP 引擎算"实例没给出货", 换下一实例; 全空才抛
    await assert.rejects(() => searxngProvider.search("q", ctx), /no results field|0 results/);
    assert.ok(calls[0].startsWith("https://my-own.example/search"), "自建必须第一枪");
    assert.ok(calls.length >= 2, "空 results 数组对 SERP 引擎算失败, 换下一实例");
  } finally {
    searxngProvider.config = saved;
  }
});
