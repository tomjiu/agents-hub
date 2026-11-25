// ---------- 主流引擎批(c) google/baidu 车道 + bingweb 广告过滤 (2026-11-25) ----------
// 黄金样本纪律: Baidu/墙页样本取自当批实弹响应 (work/probe-engines/ 归档:
// baidu-m.html / g-plain.html), 仅裁剪 favicon/样式噪音保结构; google 成功路径与
// bing 广告位为公开标记结构构造样本 (干净 IP 实弹不可得, 来源差异如实注记)。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  google, baidu, googleIsWallPage, decodeGoogleHref, parseBaiduMobileHTML,
} from "../providers/major-engines.js";
import { bingweb } from "../providers/keyless-apis.js";
import type { SearchOptions } from "../types.js";
import type { SearchCtx } from "../providers/base.js";

function ctxWith(fetchImpl: (url: string) => Promise<Response>, opts?: Partial<SearchOptions>): SearchCtx {
  return {
    fetchImpl: fetchImpl as never,
    signal: AbortSignal.timeout(10000),
    ua: "test-ua",
    opts: { maxResults: 10, ...opts } as SearchOptions,
  };
}

// ---------- google: 墙检测 (实弹签名) ----------

test("google: 墙页三签名检测 (实弹 g-plain.html 签名)", () => {
  // 实弹 JS 壳页签名: meta-refresh → enablejs?sei=...
  const jsShell =
    '<html><head><title>Google Search</title><meta content="0;url=&quot;https://www.google.com/search?q=x&amp;sei=7FUGa__jGtSQvr0P1abfoAw&quot;" http-equiv="refresh"><noscript><meta content="0;url=&quot;https://www.google.com/search?q=x&amp;enablejs?sei=7FUGa__jGtSQvr0P1abfoAw&quot;" http-equiv="refresh"></noscript></head><body></body></html>';
  assert.ok(googleIsWallPage(jsShell), "enablejs signature must be detected");
  assert.ok(googleIsWallPage('<a href="/sorry/index?continue=x">sorry</a>'), "/sorry/ signature");
  assert.ok(googleIsWallPage('<div class="RBdMVb">Update your browser</div>'), "deprecated-browser page");
  assert.ok(!googleIsWallPage("<html><body>normal page about updates</body></html>"), "normal page not flagged");
});

test("google: 墙页 → blocked 如实抛错 (不静默返空)", async () => {
  const wallHtml =
    '<html><head><title>Google Search</title><meta content="0;url=&quot;https://www.google.com/search?q=x&amp;enablejs?sei=1&quot;" http-equiv="refresh"></head><body></body></html>';
  const ctx = ctxWith(async () => new Response(wallHtml, { status: 200 }));
  await assert.rejects(() => google.search("model context protocol", ctx), /blocked \(IP-reputation wall/);
});

// ---------- google: href 解码 ----------

test("google: /url?q= 解码 + 自家域 host 级判据", () => {
  assert.equal(
    decodeGoogleHref("/url?q=https://modelcontextprotocol.io/intro&sa=U"),
    "https://modelcontextprotocol.io/intro",
  );
  assert.equal(decodeGoogleHref("https://example.com/direct"), "https://example.com/direct");
  assert.equal(decodeGoogleHref("https://books.google.com/x"), "", "google-internal dropped");
  assert.equal(decodeGoogleHref("/url?q=/search?q=inner"), "", "non-http target dropped");
});

// ---------- google: SERP 解析 + Sponsored 过滤 (构造样本, 结构对齐公开 SERP 标记) ----------

const googleSERP = `<html><body><div id="search"><div id="rso">
<div class="g"><div data-snhf="1"><a href="/url?q=https://modelcontextprotocol.io/docs/getting-started&amp;sa=U"><br><h3>Getting started - Model Context Protocol</h3><div><div class="VwiC3b">Learn how to connect MCP clients and servers.</div></div></a></div></div>
<div class="g"><a href="https://zhuanlan.zhihu.com/p/29001189476"><h3>MCP (Model Context Protocol)，一篇就够了</h3><div class="VwiC3b">MCP 全称是 Model Context Protocol，是一个开放协议。</div></a></div>
<div class="g"><div class="uEierd"><a href="https://ad.example.com/store"><h3>Lowe's Store Locator</h3></a><span>Sponsored</span></div></div>
<div class="g"><a href="https://books.google.com/books?id=x"><h3>Google Books internal</h3></a></div>
</div></div></body></html>`;

test("google: SERP 解析 — Sponsored 赞助块与自家域被过滤", async () => {
  const ctx = ctxWith(async () => new Response(googleSERP, { status: 200 }));
  const refs = await google.search("model context protocol", ctx);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].url, "https://modelcontextprotocol.io/docs/getting-started");
  assert.ok(refs[0].title.includes("Getting started"));
  assert.ok((refs[0].snippet ?? "").includes("MCP clients"));
  assert.equal(refs[1].url, "https://zhuanlan.zhihu.com/p/29001189476");
  assert.ok(refs.every((r) => r.engines[0] === "google" && r.kind === "web"));
  assert.ok(refs.every((r) => !r.url.includes("ad.example.com") && !r.url.includes("books.google.com")));
});

// ---------- baidu: 移动端 SERP 解析 (实弹 baidu-m.html 骨架) + 广告/运营位过滤 ----------

const baiduSERP = `<html><body><div id="results">
<div class="c-result result" srcid='www_index' new_srcid='1599' order='5' tpl='www_index' data-log='{"fm":"alop","ensrcid":"www_index","order":5,"mu":"https://baijiahao.baidu.com/s?id=1882633051717784746&amp;wfr=spider&amp;for=pc"}' nr='1'><div class="c-result-content"><div data-module="title" role="title"><h3 class="cosc-title title_4utjm cos-line-clamp-1 "><span class="cosc-title-a cosc-title-md "><span class="cosc-title-slot"><span class="tts-b-hl "><!--s-text-->出门问问 TicNote 正式开放 MCP,让记录的信息进入...<!--/s-text--></span></span></span></h3></div><div data-module="summary-multi-image"><!--s-data:{"summaryData":{"generalLines":[{"isEncoding":true,"prefixTime":"前天15:25","clamp":3,"limitLen":"220","data":[{"text":"MCP即模型<em>上下文</em>协议（Model Context Protocol），可以理解为连接AI Agent与外部数据、工具及服务的标准化接口。"}],"not_struct":true}]}}--></div></div></div>
<div class="c-result result" srcid='www_index' order='7' tpl='www_index' data-log='{"fm":"alop","order":7,"mu":"https://zhuanlan.zhihu.com/p/30862107395"}' nr='1'><div class="c-result-content"><div data-module="title"><h3 class="cosc-title"><span class="cosc-title-a"><span class="cosc-title-slot"><span class="tts-b-hl">MCP:让AI更好地理解你的意图 - 知乎</span></span></span></h3></div><div data-module="summary"><!--s-data:{"summaryData":{"generalLines":[{"data":[{"text":"Model Context Protocol 是由 Anthropic 公司推出的开放协议。"}]}]}}--></div></div></div>
<div class="c-result result" srcid='34689' order='2' tpl='recommend_list_san' data-log='{"fm":"alop","order":2,"mu":"http://34689.recommend_list.baidu.com"}' nr='1'><div class="c-result-content"><h3 class="c-title c-fwb">大家还在搜</h3></div></div>
<div class="c-result result" srcid='ad' order='1' tpl='www_index' data-log='{"fm":"alop","order":1,"mu":"http://m.baidu.com/baidu.php?url=ad-target.example.com%2Fstore"}' nr='1'><div class="c-result-content"><h3 class="cosc-title">Lowe's 门店查询 - 就近门店地址</h3></div></div>
<div class="c-result result" srcid='ad2' order='8' tpl='www_index' data-log='{"fm":"alop","order":8,"mu":"https://ad.example.com/insurance"}' nr='1'><div class="c-result-content"><h3 class="cosc-title">保险报价测评</h3><span class="ec-tuiguang-label">广告</span></div></div>
</div></body></html>`;

test("baidu: 移动端 SERP 解析 — 实弹 mu 提取 + 广告/运营位过滤", () => {
  const refs = parseBaiduMobileHTML(baiduSERP, 10);
  assert.equal(refs.length, 2, `want 2 organic (widget/ads filtered), got ${refs.length}`);
  assert.equal(refs[0].url, "https://baijiahao.baidu.com/s?id=1882633051717784746&wfr=spider&for=pc");
  assert.ok(refs[0].title.includes("出门问问"));
  assert.ok((refs[0].snippet ?? "").includes("Model Context Protocol"));
  assert.ok(!(refs[0].snippet ?? "").includes("<em>"), "em tags stripped from s-data snippet");
  assert.equal(refs[1].url, "https://zhuanlan.zhihu.com/p/30862107395");
  assert.ok(refs.every((r) => r.engines[0] === "baidu" && r.kind === "web"));
});

test("baidu: 验证墙 (百度安全验证/wappass) = 解析为空, 车道层如实 blocked", async () => {
  assert.equal(parseBaiduMobileHTML('<html><title>百度安全验证</title></html>', 10).length, 0);
  const ctxWall = ctxWith(async () => new Response('<html><title>百度安全验证</title></html>', { status: 200 }));
  await assert.rejects(() => baidu.search("国产大模型", ctxWall), /blocked \(captcha wall/);
});

test("baidu: wappass 302 跟随后 res.url 判墙", async () => {
  // Node Response 构造器不接受 url 参数; fetch 跟随重定向后 res.url 由 fetch 设置。
  // 测试以子类 getter 模拟 fetch 跟随 302 后的最终 URL 形态。
  class WappassResponse extends Response {
    // Response.url 是原型属性; 用 defineProperty 覆盖实例值模拟 fetch 跟随后的最终 URL
    constructor() {
      super("<html>captcha</html>", { status: 200 });
      Object.defineProperty(this, "url", {
        value: "https://wappass.baidu.com/static/captcha/tuxing_v2.html",
      });
    }
  }
  const ctxRedirect = ctxWith(async () => new WappassResponse());
  await assert.rejects(() => baidu.search("装修", ctxRedirect), /wappass redirect/);
});

// ---------- bingweb: 广告过滤增强 (批(c); 基础解析/守卫测试见 providers.test.ts) ----------

const bingWebAdSERP = `<ol id="b_results">
<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=873464702699cfc285a47cf6dd5e67fc014725ef772e770db3d6d437c1ae201eJmltdHM9MTc5NTQ3ODQwMA&amp;ptn=3&amp;u=a1aHR0cHM6Ly96aHVhbmxhbi56aGlodS5jb20vcC8yOTAwMTE4OTQ3Ng&amp;ntb=1">MCP (Model Context Protocol)，一篇就够了。 - 知乎</a></h2><div class="b_caption"><p class="b_lineclamp2">MCP protocol context model open standard</p></div></li>
<li class="b_ans"><div class="b_ansTitle">Instant answer</div></li>
<li class="b_ad b_adTop"><ul><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=ad&amp;u=a1aHR0cHM6Ly93d3cuZXhhbXBsZS5jb20vYWQ=">Sponsored store locator</a></h2><div class="b_adSlug"><span>Ad</span></div></li></ul></li>
<li class="b_algo"><div class="b_adSlug"><span>Ad</span></div><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=ad2&amp;u=a1aHR0cHM6Ly93d3cuZXhhbXBsZS5jb20vYWQy">Inline ad variant</a></h2></li>
<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=d9ded107a9c519c466e70c6531017e67fcf53b4837d24f8eec21ac62ba23e715fdJmltdHM9MTc5NTQ3ODQwMA&amp;ptn=3&amp;u=a1aHR0cHM6Ly9tb2RlbGNvbnRleHRwcm90b2NvbC5pby9kb2NzLzIwMjYtMDctMjgvZ2V0dGluZy1zdGFydGVkL2ludHJv&amp;ntb=1">What is the Model Context Protocol (MCP)?</a></h2><div class="b_caption"><p class="b_lineclamp2">Model Context Protocol MCP open standard</p></div></li>
<li class="b_pag"><a>Next</a></li>
</ol>`;

test("bingweb: 广告过滤 — b_ad 容器/内联 b_adSlug 徽标被滤, ensearch 参数 (非 CJK)", async () => {
  const calls: string[] = [];
  const ctx = ctxWith(async (url: string) => {
    calls.push(url);
    return new Response(bingWebAdSERP, { status: 200 });
  });
  const refs = await bingweb.search("model context protocol", ctx);
  assert.equal(refs.length, 2, `ads/ans/pag must be filtered, got ${refs.length}`);
  assert.equal(refs[0].url, "https://zhuanlan.zhihu.com/p/29001189476");
  assert.equal(refs[1].url, "https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro");
  assert.ok(refs.every((r) => !r.url.includes("example.com")), "no ad leaks");
  const u = new URL(calls[0]);
  assert.equal(u.searchParams.get("ensearch"), "1", "ensearch=1 for non-CJK query");
});

test("bingweb: CJK 查询不带 ensearch (实弹反噬品牌词垃圾页)", async () => {
  const calls: string[] = [];
  const ctx = ctxWith(async (url: string) => {
    calls.push(url);
    return new Response(bingWebAdSERP, { status: 200 });
  }, { lang: "zh" });
  await bingweb.search("国产大模型排行榜", ctx);
  const u = new URL(calls[0]);
  assert.equal(u.searchParams.get("ensearch"), null, "CJK query must not carry ensearch");
});
