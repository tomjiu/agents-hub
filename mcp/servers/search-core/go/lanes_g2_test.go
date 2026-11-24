package main

// G2 (issue #3 评论): 引擎原生协议形状与漂移检测 — 离线 fixture 口径。
// 纪律: 本地 fixture 锁定"我们发送什么/如何解析"的契约; 公网真实可达性
// 由 live probe 另测 (本沙箱出网受阻: DDG 202 软封, Mojeek/Yahoo 连接失败,
// 证据见 scripts/G2-PROTOCOL-NOTES.md), 不以 fixture 冒充公网验证。

import (
	"net/url"
	"testing"
)

// ---------- DDG: 请求表单形状 (协议契约) ----------

func TestBuildDdgFormFirstPage(t *testing.T) {
	form := buildDdgForm(SearchOpts{Query: "go 1.25 release", Lang: "zh-cn", Freshness: "month"}, nil)
	// 首页契约: q/b/kl/df 四字段, POST x-www-form-urlencoded
	if form.Get("q") != "go 1.25 release" {
		t.Fatalf("q=%q", form.Get("q"))
	}
	if form.Get("b") != "" {
		t.Fatalf("b=%q want empty", form.Get("b"))
	}
	if form.Get("kl") != "zh-cn" {
		t.Fatalf("kl=%q", form.Get("kl"))
	}
	if form.Get("df") == "" {
		t.Fatal("freshness=month must map df")
	}
}

func TestBuildDdgFormNoFreshnessNoLang(t *testing.T) {
	form := buildDdgForm(SearchOpts{Query: "q"}, nil)
	if form.Get("df") != "" || form.Get("kl") != "" {
		t.Fatalf("empty lang/freshness must not emit params: %v", form)
	}
}

// 后续页: 会话状态字段回传 + 查询替换; 不携带的首页字段 (b) 不伪造
func TestBuildDdgFormNextPageSession(t *testing.T) {
	next := &ddgPageState{form: url.Values{
		"s": {"30"}, "dc": {"1"}, "o": {"json"}, "api": {"/d.js"}, "v": {"q"},
		"kl": {"wt-wt"}, "df": {""},
	}}
	form := buildDdgForm(SearchOpts{Query: "rust async", Lang: "en-us", Freshness: ""}, next)
	if form.Get("s") != "30" || form.Get("dc") != "1" || form.Get("o") != "json" {
		t.Fatalf("session fields must round-trip: %v", form)
	}
	if form.Get("q") != "rust async" {
		t.Fatalf("q must be replaced with current query: %q", form.Get("q"))
	}
	if form.Get("kl") != "en-us" {
		t.Fatalf("kl must be updated to current lang: %q", form.Get("kl"))
	}
	if form.Get("df") != "" {
		t.Fatalf("no freshness → df removed, got %q", form.Get("df"))
	}
}

// ---------- DDG: 下一页状态解析 (markup fixture: html.duckduckgo.com 分页表单) ----------

const ddgNextPageFixture = `<!DOCTYPE html><html><body>
<div class="result results_links results_links_deep web-result">
<div class="links_main links_deep result__body">
<h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgo.dev%2Fdoc%2Fgo1.25">Go 1.25 Release Notes</a></h2>
<a class="result__snippet" href="...">The latest Go release...</a>
</div></div>
<div class="nav-link">
<form method="post" action="/html/">
<input type="submit" class="btn btn--alt" value="Next">
<input type="hidden" name="s" value="30">
<input type="hidden" name="dc" value="1">
<input type="hidden" name="o" value="json">
<input type="hidden" name="api" value="/d.js">
<input type="hidden" name="v" value="q">
<input type="hidden" name="kl" value="wt-wt">
</form></div></body></html>`

func TestParseDdgNextPagePresent(t *testing.T) {
	st := parseDdgNextPage(ddgNextPageFixture)
	if st == nil {
		t.Fatal("next-page form must parse")
	}
	if st.form.Get("s") != "30" || st.form.Get("dc") != "1" {
		t.Fatalf("session fields: %v", st.form)
	}
}

func TestParseDdgNextPageAbsent(t *testing.T) {
	// 尾页/无表单 → nil (合法尾页, 不是错误, 不误判"无结果")
	if st := parseDdgNextPage("<html><body>no form here</body></html>"); st != nil {
		t.Fatalf("no next form must be nil, got %v", st.form)
	}
	if st := parseDdgNextPage(""); st != nil {
		t.Fatal("empty body must be nil")
	}
}

// ---------- DDG: 分页预算有界 ----------

func TestDdgMaxPagesBounded(t *testing.T) {
	t.Setenv("SC_DDG_MAX_PAGES", "99")
	if p := ddgMaxPages(); p != 2 {
		t.Fatalf("over-bound must clamp to 2, got %d", p)
	}
	t.Setenv("SC_DDG_MAX_PAGES", "1")
	if p := ddgMaxPages(); p != 1 {
		t.Fatalf("explicit 1 must be honored, got %d", p)
	}
	t.Setenv("SC_DDG_MAX_PAGES", "")
	if p := ddgMaxPages(); p != 2 {
		t.Fatalf("default 2, got %d", p)
	}
}

// ---------- Yahoo: consent 墙显式分类 (不误判无结果) ----------

func TestIsYahooConsentPage(t *testing.T) {
	// nil resp + 空 body: 无签名 → 不是 consent (不崩溃)
	if isYahooConsentPage(nil, "") {
		t.Fatal("nil resp + empty body must not be flagged consent")
	}
	// consent 域名在 body
	if !isYahooConsentPage(nil, `<html><body>redirect to consent.yahoo.com/collectConsent</body></html>`) {
		t.Fatal("consent.yahoo.com in body must be detected")
	}
	// GDPR 双标记
	if !isYahooConsentPage(nil, `<div id="gppd"><button>consent</button></div>`) {
		t.Fatal("gppd+consent markers must be detected")
	}
	// 正常结果页不误报
	if isYahooConsentPage(nil, `<ol><li><div class="compTitle"><a href="https://example.com">result</a></div></li></ol>`) {
		t.Fatal("normal result page must not be flagged")
	}
}

func TestClassifyYahooConsent(t *testing.T) {
	// consent 墙 → blocked 不可重试 (不自动解验证/同意)
	status, retryable := classifyFailure("yahoo consent page (EU consent wall, not search results)")
	if status != "blocked" || retryable {
		t.Fatalf("consent must classify blocked/non-retryable, got %s/%v", status, retryable)
	}
}

// ---------- 失败分类矩阵 (429/403/挑战/伪200语义) ----------

func TestClassifyFailureMatrix(t *testing.T) {
	cases := []struct {
		msg       string
		status    string
		retryable bool
	}{
		{"ddg http 429", "rate_limited", true},
		{"engine http 202 soft-block", "rate_limited", true},
		{"http 403 forbidden", "blocked", false},
		{"captcha challenge page", "blocked", false},
		{"context deadline exceeded", "timeout", true},
		{"http 401 unauthorized", "auth", false},
		{"quota exceeded", "quota", false},
	}
	for _, c := range cases {
		s, r := classifyFailure(c.msg)
		if s != c.status || r != c.retryable {
			t.Fatalf("classify(%q) = %s/%v want %s/%v", c.msg, s, r, c.status, c.retryable)
		}
	}
}

// ---------- Mojeek: 请求参数形状 ----------

func TestMojeekRequestShape(t *testing.T) {
	// Mojeek 契约: GET /search?q=...&lang=...; lang 为空不携带
	// (lane 内联构造, 这里锁定 parse 层的 URL 前置契约)
	if u := absoluteUrl("https://www.mojeek.com/search", "/search?q=x"); u != "https://www.mojeek.com/search?q=x" {
		t.Fatalf("mojeek absolute url: %s", u)
	}
}
