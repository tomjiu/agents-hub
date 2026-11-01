package main

import (
	"strings"
	"testing"
)

// ---------- HTML 车道 ----------
func TestParseDdgHTML(t *testing.T) {
	html := `<html><body>
	<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdoc">Title One</a><a class="result__snippet">snip 1</a></div>
	<div class="web-result"><a class="result__a" href="https://direct.example/2">Title Two</a><a class="result__snippet">snip 2</a></div>
	</body></html>`
	refs := parseDdgHTML(html, 10)
	if len(refs) != 2 {
		t.Fatalf("want 2, got %d", len(refs))
	}
	if refs[0].URL != "https://example.com/doc" {
		t.Fatalf("uddg decode failed: %s", refs[0].URL)
	}
	if refs[1].URL != "https://direct.example/2" {
		t.Fatalf("direct href failed: %s", refs[1].URL)
	}
}

func TestDecodeDdgHrefEmpty(t *testing.T) {
	if decodeDdgHref("") != "" || decodeDdgHref("javascript:void(0)") != "" {
		t.Fatal("bad href must decode to empty")
	}
}

func TestDecodeYahooHref(t *testing.T) {
	if got := decodeYahooHref("https://r.search.yahoo.com/_ylt=xxx/RU=https%3A%2F%2Freal.example%2Fa/RK=2/RS=yyy"); got != "https://real.example/a" {
		t.Fatalf("RU decode failed: %s", got)
	}
	if got := decodeYahooHref("https://direct.example"); got != "https://direct.example" {
		t.Fatalf("direct pass-through failed: %s", got)
	}
}

func TestParseMojeekHTML(t *testing.T) {
	html := `<ul class="results-standard"><li><a class="title" href="https://m.example/1">M1</a><p class="s">desc</p></li></ul>`
	refs := parseMojeekHTML(html, 10)
	if len(refs) != 1 || refs[0].URL != "https://m.example/1" || refs[0].Snippet != "desc" {
		t.Fatalf("mojeek parse mismatch: %+v", refs)
	}
}

// ---------- 独立索引车道 ----------
func TestParseMarginalia(t *testing.T) {
	data := []byte(`{"results":[{"url":"https://mg.example/1","title":"t","description":"d"}]}`)
	refs, err := parseMarginalia(data, 10)
	if err != nil || len(refs) != 1 {
		t.Fatalf("marginalia parse failed: %v %v", refs, err)
	}
	if _, err := parseMarginalia([]byte(`{"results":[]}`), 10); err == nil {
		t.Fatal("empty must throw")
	}
}

func TestParseWibyDescriptionPriority(t *testing.T) {
	data := []byte(`[{"URL":"https://w.example/1","Title":"t &#39;q&#39;","Snippet":"nav noise 2026-01-01 menu","Description":"real desc"}]`)
	refs, err := parseWiby(data, 10)
	if err != nil || len(refs) != 1 {
		t.Fatal("wiby parse failed")
	}
	if refs[0].Snippet != "real desc" {
		t.Fatalf("Description must beat Snippet: %q", refs[0].Snippet)
	}
	if refs[0].Title != "t 'q'" {
		t.Fatalf("entity decode failed: %q", refs[0].Title)
	}
}

func TestParseMwmblValueJoin(t *testing.T) {
	data := []byte(`[{"url":"https://mw.example/1","title":[{"value":"he","is_bold":true},{"value":"llo"}],"extract":[{"value":"ex"}]}]`)
	refs, err := parseMwmbl(data, 10)
	if err != nil || len(refs) != 1 || refs[0].Title != "hello" || refs[0].Snippet != "ex" {
		t.Fatalf("mwmbl join mismatch: %+v", refs)
	}
}

func TestParseAnysearchBusinessCode(t *testing.T) {
	if _, err := parseAnysearch([]byte(`{"code":403,"message":"denied"}`), 10); err == nil {
		t.Fatal("code!=0 must throw")
	}
	refs, err := parseAnysearch([]byte(`{"code":0,"data":{"results":[{"url":"https://a.example/1","title":"t"}]}}`), 10)
	if err != nil || len(refs) != 1 || refs[0].Title != "t" {
		t.Fatal("anysearch parse failed")
	}
}

func TestParseFirecrawlDriftGuard(t *testing.T) {
	if _, err := parseFirecrawl([]byte(`{"success":true}`), 10); err == nil {
		t.Fatal("missing data.web must throw (api drift)")
	}
}

func TestParseSov2ex(t *testing.T) {
	data := []byte(`{"hits":[{"_source":{"id":123,"title":"v2 post","content":"c","created":"2026-01-01"}}]}`)
	refs, err := parseSov2ex(data, 10)
	if err != nil || len(refs) != 1 || refs[0].URL != "https://www.v2ex.com/t/123" {
		t.Fatalf("sov2ex parse mismatch: %+v", refs)
	}
}

// ---------- 开发者生态车道 ----------
func TestParseNpm(t *testing.T) {
	data := []byte(`{"objects":[{"package":{"name":"left-pad","version":"1.3.0","description":"s","score":{"final":0.87,"detail":{"popularity":0.92}},"links":{"npm":"https://www.npmjs.com/package/left-pad"}}}]}`)
	refs, err := parseNpm(data, 10)
	if err != nil || len(refs) != 1 {
		t.Fatal("npm parse failed")
	}
	if !strings.Contains(refs[0].Snippet, "score 0.87") || !strings.Contains(refs[0].Snippet, "pop 92") {
		t.Fatalf("npm meta mismatch: %q", refs[0].Snippet)
	}
}

func TestParseGithubStars(t *testing.T) {
	data := []byte(`{"items":[{"html_url":"https://github.com/a/b","full_name":"a/b","description":"d","stargazers_count":1234,"pushed_at":"2026-01-01"}]}`)
	refs := parseGithub(data, 10)
	if len(refs) != 1 || !strings.Contains(refs[0].Snippet, "★1234") {
		t.Fatalf("github parse mismatch: %+v", refs)
	}
	// TS 同款: github 空结果不抛错
	if refs := parseGithub([]byte(`{"items":[]}`), 10); len(refs) != 0 {
		t.Fatal("empty items must return empty, not throw")
	}
}

func TestHasWebAffinity(t *testing.T) {
	if !hasWebAffinity("react hooks tutorial") || !hasWebAffinity("js fetch 教程") {
		t.Fatal("affinity positives failed")
	}
	if hasWebAffinity("docker compose restart policy") {
		t.Fatal("non-web query must not have affinity")
	}
}

func TestParseStackexchange(t *testing.T) {
	data := []byte(`{"items":[{"title":"q &amp; a","link":"https://stackoverflow.com/q/1","score":42,"answer_count":3,"is_answered":true,"tags":["go","json"],"last_activity_date":1767225600}]}`)
	refs, err := parseStackexchange(data, 10)
	if err != nil || len(refs) != 1 {
		t.Fatal("stackexchange parse failed")
	}
	if refs[0].Title != "q & a" {
		t.Fatalf("entity decode failed: %q", refs[0].Title)
	}
	if !strings.Contains(refs[0].Snippet, "answered ✓") || !strings.Contains(refs[0].Snippet, "42 score") {
		t.Fatalf("meta mismatch: %q", refs[0].Snippet)
	}
}

// ---------- 学术车道 ----------
func TestParseArxiv(t *testing.T) {
	atom := []byte(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
	<entry><id>http://arxiv.org/abs/1706.03762v7</id><title>Attention Is All You Need</title>
	<summary>We propose the Transformer.</summary><published>2017-06-12</published>
	<link href="https://arxiv.org/abs/1706.03762v7" type="text/html"/>
	<author><name>Vaswani</name></author><author><name>Shazeer</name></author></entry></feed>`)
	refs, err := parseArxiv(atom, 10)
	if err != nil || len(refs) != 1 {
		t.Fatal("arxiv parse failed")
	}
	if !strings.HasPrefix(refs[0].Snippet, "Vaswani, Shazeer · ") {
		t.Fatalf("authors prefix mismatch: %q", refs[0].Snippet)
	}
}

func TestParseCrossrefDoiFallback(t *testing.T) {
	data := []byte(`{"message":{"items":[{"DOI":"10.1234/x","title":[],"author":[{"given":"A","family":"B"}],"issued":{"date-parts":[[2024]]},"is-referenced-by-count":7}]}}`)
	refs, err := parseCrossref(data, 10)
	if err != nil || len(refs) != 1 {
		t.Fatal("crossref parse failed")
	}
	if refs[0].URL != "https://doi.org/10.1234/x" {
		t.Fatalf("doi fallback failed: %s", refs[0].URL)
	}
	if !strings.Contains(refs[0].Snippet, "[paper] A B · 2024 · cited 7") {
		t.Fatalf("meta join mismatch: %q", refs[0].Snippet)
	}
}

// ---------- 新闻/社区/图片车道 ----------
func TestParseBingNewsApiclick(t *testing.T) {
	xml := []byte(`<rss><channel><item><title>n1</title><link>https://www.bing.com/news/apiclick.aspx?ref=Ex&amp;url=https%3a%2f%2fnews.example%2f1</link><description>d</description></item></channel></rss>`)
	refs, err := parseBingNews(xml, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].URL != "https://news.example/1" {
		t.Fatalf("apiclick decode failed: %+v", refs)
	}
	if refs[0].Kind != "news" {
		t.Fatal("bingnews kind must be news")
	}
	// 有效 RSS 零 item = 合法空(不抛错)
	if refs, err := parseBingNews([]byte(`<rss><channel></channel></rss>`), 10); err != nil || len(refs) != 0 {
		t.Fatal("legal empty must not throw")
	}
}

func TestParseHNUriFallback(t *testing.T) {
	data := []byte(`{"hits":[{"title":"Ask HN","objectID":"424242","points":100,"num_comments":50,"author":"pg","created_at":"2026-01-01"},{"title":"no url","url":null,"objectID":"1"}]}`)
	refs, err := parseHN(data, 10)
	if err != nil || len(refs) != 2 {
		t.Fatal("hn parse failed")
	}
	if !strings.Contains(refs[0].Snippet, "100 pts · 50 comments · by pg") {
		t.Fatalf("hn stat mismatch: %q", refs[0].Snippet)
	}
	if refs[1].URL != "https://news.ycombinator.com/item?id=1" {
		t.Fatalf("objectID fallback failed: %s", refs[1].URL)
	}
}

func TestParseOpenverseImageKind(t *testing.T) {
	data := []byte(`{"results":[{"url":"https://img.example/1.jpg","title":"photo","foreign_landing_url":"https://land.example/1","license":"by","license_version":"4.0","provider":"flickr","creator":"someone"}]}`)
	refs := parseOpenverse(data, 10)
	if len(refs) != 1 || refs[0].Kind != "image" {
		t.Fatal("openverse kind must be image")
	}
	if !strings.Contains(refs[0].Snippet, "CC-BY 4.0 · flickr by someone") {
		t.Fatalf("license line mismatch: %q", refs[0].Snippet)
	}
}

// ---------- freshness 映射 ----------
func TestFreshnessMaps(t *testing.T) {
	if ddgFreshness("month") != "m" || searxngFreshness("week") != "week" || keenableFreshness("year") != "365d" {
		t.Fatal("freshness map mismatch")
	}
	if ddgFreshness("any") != "" || keenableFreshness("any") != "" {
		t.Fatal("any must map to empty (no param)")
	}
}
