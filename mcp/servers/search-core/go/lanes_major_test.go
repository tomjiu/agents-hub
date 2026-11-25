package main

// 主流引擎车道测试 (google / baidu / bingweb 广告过滤增强, 2026-11-25 批)
// 黄金样本纪律: Baidu/墙页样本取自当批实弹响应 (/home/z/my-project/work/probe-engines/
// 归档: baidu-m.html / g-plain.html), 仅裁剪 favicon/样式表噪音保结构;
// Google 成功路径与 Bing 经典广告位为公开标记结构构造样本 (干净 IP 实弹不可得, 来源差异如实注记);
// bingweb 基础解析/解码/守卫测试见 lanes_bing_web_test.go (批 23), 本文件只补广告过滤场景。

import (
	"strings"
	"testing"

	"github.com/PuerkitoBio/goquery"
)

// ---------- Bing: SERP 解析 + 广告过滤 ----------
// 样本骨架取自实弹 b1.html (ensearch=1 干净 SERP): li.b_algo > b_tpcn(站点卡)+h2>a+b_caption;
// 广告位两形态按公开标记结构构造: (a) li.b_ad 容器包内层 b_algo (经典顶层广告),
// (b) li.b_algo 内嵌 b_adSlug 徽标 (2026 无 b_ad 容器的变体)。
const bingSERP = `<ol id="b_results">
<li class="b_algo" data-id iid=SERP.5325><div class="b_tpcn"><a class="tilk" aria-label="zhihu.com" RedirectUrl="" href="https://www.bing.com/ck/a?!&amp;&amp;p=873464702699cfc285a47cf6dd5e67fc014725ef772e770db3d6d437c1ae201eJmltdHM9MTc5NTQ3ODQwMA&amp;ptn=3&amp;u=a1aHR0cHM6Ly96aHVhbmxhbi56aGlodS5jb20vcC8yOTAwMTE4OTQ3Ng&amp;ntb=1" h="ID=SERP,5126.1"><div class="tptxt"><div class="tptt">zhihu.com</div></div></a></div><h2><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=873464702699cfc285a47cf6dd5e67fc014725ef772e770db3d6d437c1ae201eJmltdHM9MTc5NTQ3ODQwMA&amp;ptn=3&amp;u=a1aHR0cHM6Ly96aHVhbmxhbi56aGlodS5jb20vcC8yOTAwMTE4OTQ3Ng&amp;ntb=1" h="ID=SERP,5126.2">MCP (Model Context Protocol)，一篇就够了。 - 知乎</a></h2><div class="b_caption"><p class="b_lineclamp2">MCP 全称是 Model Context Protocol, 一个开放协议。</p></div></li>
<li class="b_algo" data-id iid=SERP.5326><h2><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=d9ded107a9c519c466e70c6531017e67fcf53b4837d24f8eec21ac62ba23e715fdJmltdHM9MTc5NTQ3ODQwMA&amp;ptn=3&amp;u=a1aHR0cHM6Ly9tb2RlbGNvbnRleHRwcm90b2NvbC5pby9kb2NzLzIwMjYtMDctMjgvZ2V0dGluZy1zdGFydGVkL2ludHJv&amp;ntb=1">What is the Model Context Protocol (MCP)?</a></h2><div class="b_caption"><p class="b_lineclamp2">Model Context Protocol (MCP) is an open protocol.</p></div></li>
<li class="b_ans"><div class="b_ansTitle">Instant answer (not a result)</div></li>
<li class="b_ad b_adTop"><ul><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=ad&amp;u=a1aHR0cHM6Ly93d3cuZXhhbXBsZS5jb20vYWQ=">Sponsored store locator example</a></h2><div class="b_adSlug"><span>Ad</span></div></li></ul></li>
<li class="b_algo"><div class="b_adSlug"><span aria-label="Advertisement">Ad</span></div><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=ad2&amp;u=a1aHR0cHM6Ly93d3cuZXhhbXBsZS5jb20vYWQy">Inline ad variant (no b_ad container)</a></h2></li>
<li class="b_pag"><a>Next page</a></li>
</ol>`

// ---------- Baidu: SERP 解析 + 广告/运营位过滤 ----------
// 样本骨架取自实弹 baidu-m.html (m.baidu.com/s SSR): div.c-result[data-log JSON mu=真实URL] >
// h3.cosc-title 标题 + <!--s-data:{summaryData}--> 注释摘要; 运营位(recommend_list)与
// 广告位(baidu.php 跳转壳 / ec-tuiguang 标识 / 独立"广告"文本节点)按实弹+公开标记构造。
const baiduSERP = `<html><body><div id="results">
<div class="c-result result" srcid='www_index' new_srcid='1599' order='5' tpl='www_index' data-log='{"fm":"alop","ensrcid":"www_index","order":5,"mu":"https://baijiahao.baidu.com/s?id=1882633051717784746&amp;wfr=spider&amp;for=pc"}' nr='1'><div class="c-result-content"><div data-module="title" role="title"><h3 class="cosc-title title_4utjm cos-line-clamp-1 "><span class="cosc-title-a cosc-title-md "><span class="cosc-title-slot"><span class="tts-b-hl "><!--s-text-->出门问问 TicNote 正式开放 MCP,让记录的信息进入...<!--/s-text--></span></span></span></h3></div><div data-module="summary-multi-image"><!--s-data:{"summaryData":{"generalLines":[{"isEncoding":true,"prefixTime":"前天15:25","clamp":3,"limitLen":"220","data":[{"text":"MCP即模型<em>上下文</em>协议（Model Context Protocol），可以理解为连接AI Agent与外部数据、工具及服务的标准化接口。"}],"not_struct":true}]}}--></div></div></div>
<div class="c-result result" srcid='www_index' order='7' tpl='www_index' data-log='{"fm":"alop","order":7,"mu":"https://zhuanlan.zhihu.com/p/30862107395"}' nr='1'><div class="c-result-content"><div data-module="title"><h3 class="cosc-title"><span class="cosc-title-a"><span class="cosc-title-slot"><span class="tts-b-hl">MCP:让AI更好地理解你的意图 - 知乎</span></span></span></h3></div><div data-module="summary"><!--s-data:{"summaryData":{"generalLines":[{"data":[{"text":"Model Context Protocol 是由 Anthropic 公司推出的开放协议。"}]}]}}--></div></div></div>
<div class="c-result result" srcid='34689' order='2' tpl='recommend_list_san' data-log='{"fm":"alop","order":2,"mu":"http://34689.recommend_list.baidu.com"}' nr='1'><div class="c-result-content"><h3 class="c-title c-fwb">大家还在搜</h3></div></div>
<div class="c-result result" srcid='ad' order='1' tpl='www_index' data-log='{"fm":"alop","order":1,"mu":"http://m.baidu.com/baidu.php?url=ad-target.example.com%2Fstore"}' nr='1'><div class="c-result-content"><h3 class="cosc-title">Lowe's 门店查询 - 就近门店地址</h3></div></div>
<div class="c-result result" srcid='ad2' order='8' tpl='www_index' data-log='{"fm":"alop","order":8,"mu":"https://ad.example.com/insurance"}' nr='1'><div class="c-result-content"><h3 class="cosc-title">保险报价测评</h3><span class="ec-tuiguang-label">广告</span></div></div>
</div></body></html>`

func TestParseBaiduHTML(t *testing.T) {
	refs := parseBaiduHTML(baiduSERP, 10)
	if len(refs) != 2 {
		t.Fatalf("want 2 organic refs (widget/ads filtered), got %d: %+v", len(refs), refs)
	}
	if refs[0].URL != "https://baijiahao.baidu.com/s?id=1882633051717784746&wfr=spider&for=pc" {
		t.Fatalf("mu entity-decode failed: %s", refs[0].URL)
	}
	if !strings.Contains(refs[0].Title, "出门问问") {
		t.Fatalf("title wrong: %q", refs[0].Title)
	}
	if !strings.Contains(refs[0].Snippet, "Model Context Protocol") || strings.Contains(refs[0].Snippet, "<em>") {
		t.Fatalf("s-data snippet extract/em-strip failed: %q", refs[0].Snippet)
	}
	if refs[1].URL != "https://zhuanlan.zhihu.com/p/30862107395" {
		t.Fatalf("second mu wrong: %s", refs[1].URL)
	}
	if refs[1].Engines[0] != "baidu" {
		t.Fatalf("engine attribution wrong: %+v", refs[1])
	}
}

func TestParseBaiduHTMLCaptchaWall(t *testing.T) {
	// 实弹: www.baidu.com/s 直连返回 "百度安全验证" 挑战页; 302 → wappass 同判
	wall := `<html><head><title>百度安全验证</title></head><body></body></html>`
	if refs := parseBaiduHTML(wall, 10); refs != nil {
		t.Fatalf("captcha wall must parse to nil (caller classifies), got %d", len(refs))
	}
	if refs := parseBaiduHTML(`<div>foo wappass.baidu.com bar</div>`, 10); refs != nil {
		t.Fatalf("wappass redirect signature must parse to nil, got %d", len(refs))
	}
}

// ---------- Google: 墙页检测 (实弹) + SERP 解析 (构造样本) ----------

func TestGoogleIsWallPage(t *testing.T) {
	// 实弹 g-plain.html 的 JS 壳页签名 (2026-11-25, HK 出口):
	// meta-refresh → enablejs?sei=...
	jsShell := `<html><head><title>Google Search</title><meta content="0;url=&quot;https://www.google.com/search?q=x&amp;sei=7FUGa__jGtSQvr0P1abfoAw&quot;" http-equiv="refresh"><noscript><meta content="0;url=&quot;https://www.google.com/search?q=x&amp;enablejs?sei=7FUGa__jGtSQvr0P1abfoAw&quot;" http-equiv="refresh"></noscript></head><body></body></html>`
	if !googleIsWallPage(jsShell) {
		t.Fatal("JS-shell signature (enablejs) must be detected as wall")
	}
	if !googleIsWallPage(`<html><a href="/sorry/index?continue=x">sorry</a></html>`) {
		t.Fatal("/sorry/ signature must be detected as wall")
	}
	if !googleIsWallPage(`<html><div class="RBdMVb">Update your browser</div></html>`) {
		t.Fatal("deprecated-browser page must be detected as wall")
	}
	if googleIsWallPage(`<html><body>normal page about updates</body></html>`) {
		t.Fatal("normal page must not be flagged")
	}
	// 墙页 → parseGoogleHTML 返回 nil (不是"无结果")
	if refs := parseGoogleHTML(jsShell, 10); refs != nil {
		t.Fatalf("wall page must parse to nil, got %d", len(refs))
	}
}

func TestDecodeGoogleHref(t *testing.T) {
	if got := decodeGoogleHref("/url?q=https://modelcontextprotocol.io/intro&sa=U"); got != "https://modelcontextprotocol.io/intro" {
		t.Fatalf("url?q decode failed: %s", got)
	}
	if got := decodeGoogleHref("https://example.com/direct"); got != "https://example.com/direct" {
		t.Fatalf("direct link must pass: %s", got)
	}
	if got := decodeGoogleHref("https://books.google.com/x"); got != "" {
		t.Fatalf("google-internal link must be dropped: %s", got)
	}
	if got := decodeGoogleHref("/url?q=/search?q=inner"); got != "" {
		t.Fatalf("non-http target must be dropped: %s", got)
	}
}

// 构造样本 (干净 IP 实弹不可得, 来源差异注记; 结构对齐公开 SERP 标记):
// div#search > div.g > a[href] + h3 + div.VwiC3b; 赞助块带 Sponsored 徽标。
const googleSERP = `<html><body><div id="search"><div id="rso">
<div class="g"><div data-snhf="1"><a href="/url?q=https://modelcontextprotocol.io/docs/getting-started&amp;sa=U"><br><h3>Getting started - Model Context Protocol</h3><div><div class="VwiC3b">Learn how to connect MCP clients and servers.</div></div></a></div></div>
<div class="g"><a href="https://zhuanlan.zhihu.com/p/29001189476"><h3>MCP (Model Context Protocol)，一篇就够了</h3><div class="VwiC3b">MCP 全称是 Model Context Protocol，是一个开放协议。</div></a></div>
<div class="g"><div class="uEierd"><a href="https://ad.example.com/store"><h3>Lowe's Store Locator</h3></a><span>Sponsored</span></div></div>
<div class="g"><a href="https://books.google.com/books?id=x"><h3>Google Books internal</h3></a></div>
</div></div></body></html>`

func TestParseGoogleHTML(t *testing.T) {
	refs := parseGoogleHTML(googleSERP, 10)
	if len(refs) != 2 {
		t.Fatalf("want 2 refs (sponsored + google-internal dropped), got %d: %+v", len(refs), refs)
	}
	if refs[0].URL != "https://modelcontextprotocol.io/docs/getting-started" {
		t.Fatalf("url?q decode failed: %s", refs[0].URL)
	}
	if !strings.Contains(refs[0].Title, "Getting started") {
		t.Fatalf("title wrong: %q", refs[0].Title)
	}
	if !strings.Contains(refs[0].Snippet, "MCP clients") {
		t.Fatalf("snippet wrong: %q", refs[0].Snippet)
	}
	if refs[1].URL != "https://zhuanlan.zhihu.com/p/29001189476" {
		t.Fatalf("direct href failed: %s", refs[1].URL)
	}
	if refs[0].Engines[0] != "google" || refs[0].Kind != "web" {
		t.Fatalf("engine attribution wrong: %+v", refs[0])
	}
	for _, r := range refs {
		if strings.Contains(r.URL, "ad.example.com") || strings.Contains(r.URL, "books.google.com") {
			t.Fatalf("sponsored/internal leaked: %+v", r)
		}
	}
}

// ---------- Bing 广告过滤增强 (2026-11-25 主流引擎批; 基础解析见 lanes_bing_web_test.go) ----------
// 广告位两形态按公开标记结构构造: (a) li.b_ad 容器包内层 b_algo (经典顶层广告),
// (b) li.b_algo 内嵌 b_adSlug 徽标 (无 b_ad 容器变体)。顶层子节点选择 + 广告判据
// 双闸下, 两形态都必须被滤除, 干净结果不受影响。
const bingWebAdSERP = `<ol id="b_results">
<li class="b_algo" data-id iid=SERP.5325><h2><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=873464702699cfc285a47cf6dd5e67fc014725ef772e770db3d6d437c1ae201eJmltdHM9MTc5NTQ3ODQwMA&amp;ptn=3&amp;u=a1aHR0cHM6Ly96aHVhbmxhbi56aGlodS5jb20vcC8yOTAwMTE4OTQ3Ng&amp;ntb=1">MCP (Model Context Protocol)，一篇就够了。 - 知乎</a></h2><div class="b_caption"><p class="b_lineclamp2">MCP 全称是 Model Context Protocol, 一个开放协议。</p></div></li>
<li class="b_ans"><div class="b_ansTitle">Instant answer (not a result)</div></li>
<li class="b_ad b_adTop"><ul><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=ad&amp;u=a1aHR0cHM6Ly93d3cuZXhhbXBsZS5jb20vYWQ=">Sponsored store locator example</a></h2><div class="b_adSlug"><span>Ad</span></div></li></ul></li>
<li class="b_algo"><div class="b_adSlug"><span aria-label="Advertisement">Ad</span></div><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=ad2&amp;u=a1aHR0cHM6Ly93d3cuZXhhbXBsZS5jb20vYWQy">Inline ad variant (no b_ad container)</a></h2></li>
<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=d9ded107a9c519c466e70c6531017e67fcf53b4837d24f8eec21ac62ba23e715fdJmltdHM9MTc5NTQ3ODQwMA&amp;ptn=3&amp;u=a1aHR0cHM6Ly9tb2RlbGNvbnRleHRwcm90b2NvbC5pby9kb2NzLzIwMjYtMDctMjgvZ2V0dGluZy1zdGFydGVkL2ludHJv&amp;ntb=1">What is the Model Context Protocol (MCP)?</a></h2><div class="b_caption"><p class="b_lineclamp2">Model Context Protocol (MCP) is an open protocol.</p></div></li>
<li class="b_pag"><a>Next page</a></li>
</ol>`

func TestParseBingWebAdFiltering(t *testing.T) {
	refs := parseBingWebHTML(bingWebAdSERP, 10)
	if len(refs) != 2 {
		t.Fatalf("want 2 organic refs (ads/ans/pag filtered), got %d: %+v", len(refs), refs)
	}
	if refs[0].URL != "https://zhuanlan.zhihu.com/p/29001189476" {
		t.Fatalf("live ck/a URL decode failed: %s", refs[0].URL)
	}
	if refs[1].URL != "https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro" {
		t.Fatalf("second live URL decode failed: %s", refs[1].URL)
	}
	for _, r := range refs {
		if strings.Contains(r.URL, "example.com") {
			t.Fatalf("ad leaked into results: %+v", r)
		}
	}
}

func TestBingWebIsAdItem(t *testing.T) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(bingWebAdSERP))
	if err != nil {
		t.Fatal(err)
	}
	var adCount, organicCount int
	doc.Find("#b_results").ChildrenFiltered("li").Each(func(_ int, li *goquery.Selection) {
		if !strings.HasPrefix(func() string { c, _ := li.Attr("class"); return c }(), "b_algo") {
			return
		}
		if bingWebIsAdItem(li) {
			adCount++
		} else {
			organicCount++
		}
	})
	// 顶层 b_algo 三条: 知乎+MCP官方(organic) + 内联 b_adSlug 广告(ad)。
	// b_ad 容器(class="b_ad b_adTop")在 class 前缀闸已被丢弃, 不会进入 bingWebIsAdItem;
	// 广告容器的内层 b_algo 是嵌套节点, 顶层选择天然不收 (parseBingWebHTML 双闸之一)。
	if adCount != 1 || organicCount != 2 {
		t.Fatalf("ad filter wrong: ads=%d organic=%d (want 1/2)", adCount, organicCount)
	}
}
