package main

import (
	"testing"
)

// ---------- 融合计分(对齐 TS fusion.test 语义) ----------
func TestFuseConsensusRanksFirst(t *testing.T) {
	lanes := []laneResult{
		{Name: "keenable", Refs: []Reference{
			{URL: "http://a.example/x", Title: "alpha doc", Snippet: "alpha"},
			{URL: "http://b.example/y", Title: "beta doc", Snippet: "beta"},
		}},
		{Name: "bingrss", Refs: []Reference{
			{URL: "http://b.example/y", Title: "beta doc", Snippet: "beta"},
		}},
	}
	fused := fuse("beta doc", lanes, 20)
	if len(fused) == 0 {
		t.Fatal("no fused refs")
	}
	// b 双引擎: rrf=(1/61+1/61)*10 + consensus 0.35 + titleBonus 0.25 > a 单引擎
	if fused[0].URL != "http://b.example/y" {
		t.Fatalf("consensus ref should rank first, got %s (scores: %v)", fused[0].URL, fused)
	}
}

func TestTokenizeZhAndStop(t *testing.T) {
	got := tokenize("npm 使用教程 的")
	// b15 bigram 语义: npm 保留, CJK 长段"使用教程"切 [使用,用教,教程], 的(stop)剔除, 单字剔除
	hasNpm, hasShiYong, hasJiaoCheng, hasStop := false, false, false, false
	for _, t := range got {
		switch t {
		case "npm":
			hasNpm = true
		case "使用":
			hasShiYong = true
		case "教程":
			hasJiaoCheng = true
		case "的":
			hasStop = true
		}
	}
	if !hasNpm || !hasShiYong || !hasJiaoCheng || hasStop {
		t.Fatalf("tokenize zh mismatch: %v", got)
	}
}

func TestLexicalScoreTitleDoubleWeight(t *testing.T) {
	// title 计两次: title 独有词也算命中
	s := lexicalScore("tokio async", "tokio runtime", "some snippet")
	if s != 0.5 {
		t.Fatalf("expected 0.5 (tokio hit, async miss), got %v", s)
	}
}

func TestURLNormTrackersSortedTrailingSlash(t *testing.T) {
	// TS 语义: tracker 丢完后若字符串以 / 结尾才去尾斜杠(带 query 的 /b/?a=1 不动)
	a := urlNorm("https://Example.com/b/?utm_source=x")
	b := urlNorm("https://example.com/b")
	if a != b {
		t.Fatalf("norm mismatch:\n a=%s\n b=%s", a, b)
	}
	withQuery := urlNorm("https://Example.com/b/?b=2&a=1")
	if withQuery != "https://example.com/b/?a=1&b=2" {
		t.Fatalf("param sort mismatch: %s", withQuery)
	}
	root := urlNorm("https://example.com/")
	if root != "https://example.com/" {
		t.Fatalf("root trailing slash must survive: %s", root)
	}
}

// ---------- 车道 parse 纯函数(不打网络) ----------
func TestParseKeenable(t *testing.T) {
	data := []byte(`{"results":[{"url":"https://x.example/1","title":"t1","snippet":"s1","description":"","published_at":"2026-01-01"},{"url":"ftp://bad","title":"skip"},{"url":"https://x.example/2","title":"t2","snippet":"","description":"d2"}]}`)
	refs, err := parseKeenable(data, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs, got %d", len(refs))
	}
	if refs[1].Snippet != "d2" {
		t.Fatalf("snippet fallback to description failed: %q", refs[1].Snippet)
	}
}

func TestParseKeenableEmpty(t *testing.T) {
	if _, err := parseKeenable([]byte(`{"results":[]}`), 10); err == nil {
		t.Fatal("empty results must throw (TS 同款合法空判别)")
	}
}

func TestParseRssItemsAndGuard(t *testing.T) {
	xml := []byte(`<?xml version="1.0"?><rss version="2.0"><channel><item><title>t1 &amp; &#39;x&#39;</title><link>https://a.example/1</link><description>d1</description></item><item><title>t2</title><link>https://b.example/2</link><description>d2</description></item></channel></rss>`)
	refs, err := parseRssItems(xml, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 items, got %d", len(refs))
	}
	if refs[0].Title != "t1 & 'x'" {
		t.Fatalf("entity decode mismatch: %q", refs[0].Title)
	}
	// 漂移守卫: HTML 挑战页必须抛错
	if _, err := parseRssItems([]byte("<html><body>blocked</body></html>"), 10); err == nil {
		t.Fatal("markup drift must throw")
	}
}

func TestParseSearxngAntibotPageIsInstanceFailure(t *testing.T) {
	// searx.be 教训: 伪 200 + HTML 挑战页 → 解析失败 = 实例不可用(不是引擎坏)
	if _, err := parseSearxng([]byte("<html>anubis challenge</html>"), 10); err == nil {
		t.Fatal("antibot page must be parse failure")
	}
}

func TestParseWikipedia(t *testing.T) {
	data := []byte(`{"pages":[{"key":"Docker_(software)","title":"Docker (software)","description":"container platform","excerpt":"<span>docker</span> is..."}]}`)
	refs, err := parseWikipedia("en", data, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].URL != "https://en.wikipedia.org/wiki/Docker_(software)" {
		t.Fatalf("wiki parse mismatch: %+v", refs)
	}
	if refs[0].Snippet != "container platform" {
		t.Fatalf("description must beat excerpt: %q", refs[0].Snippet)
	}
}
