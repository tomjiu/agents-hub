package main

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// fetcher 单测(对齐 TS src/test/fetcher.test.ts 的 mock 策略):
// transport 注入拦截 HTTP, URL 用白名单端口形态(ssrf=off + 白名单域) — 不发真实网络。

type stubCall struct {
	status int
	ct     string
	body   string
}

// stubTransport 按 URL 精确匹配返回预设响应(TS mkFetcher 的 Go 对等物)
type stubTransport struct {
	urls  []string
	calls []stubCall
	seen  []string
}

func (s *stubTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	s.seen = append(s.seen, req.URL.String())
	idx := len(s.seen) - 1
	if idx >= len(s.calls) {
		return nil, fmt.Errorf("stub: unexpected request %s", req.URL)
	}
	c := s.calls[idx]
	body := c.body
	rec := &http.Response{
		StatusCode: c.status,
		Header:     http.Header{"Content-Type": []string{c.ct}},
		Body:       ioNopCloser(strings.NewReader(body)),
		Request:    req,
	}
	return rec, nil
}

func mkStub(cfg FetchConfig, calls []stubCall) (*Fetcher, *stubTransport) {
	st := &stubTransport{calls: calls}
	return NewFetcherWithTransport(cfg, nil, st), st
}

func testFetchConfig(ssrf string) FetchConfig {
	return FetchConfig{
		UserAgent:    "test-ua",
		MaxPageBytes: 2000000,
		BudgetChars:  60000,
		SSRF:         ssrf,
	}
}

func TestFetcherRunExtractAndNoFocus(t *testing.T) {
	page := "<html><head><title>T1</title></head><body><article><p>hello world line</p><p>second para</p></article></body></html>"
	f, _ := mkStub(testFetchConfig("off"), []stubCall{
		{200, "text/html; charset=utf-8", page},
		{200, "text/html; charset=utf-8", page},
	})
	r := f.Run("https://example.com/page", FetchOptions{}, nil)
	if r.Status != 200 || r.Title != "T1" {
		t.Fatalf("status/title: %+v", r)
	}
	if !strings.Contains(r.Text, "hello world line") || !strings.Contains(r.Text, "second para") {
		t.Fatalf("正文提取缺失: %q", r.Text)
	}
	if r.FromCache {
		t.Fatal("首抓不应来自缓存")
	}
	// 二次抓取走进程内缓存(stub 只登记了 2 次调用, 若真发第 2 次请求会报错)
	r2 := f.Run("https://example.com/page", FetchOptions{}, nil)
	if !r2.FromCache {
		t.Fatal("二次抓取应命中缓存")
	}
}

func TestFetcherRedirectFollow(t *testing.T) {
	f, st := mkStub(testFetchConfig("off"), []stubCall{
		{302, "", ""}, // Location 头由 stub 无法精确设置 — 见下(用原生 header map)
	})
	_ = f
	_ = st
	// 302 的 Location 头需要定制: 用内联 transport
	tr := &seqTransport{responses: []fakeResp{
		{status: 302, headers: map[string]string{"Location": "https://example.com/final"}},
		{status: 200, ct: "text/html", body: "<html><body><p>final page text</p></body></html>"},
	}}
	f2 := NewFetcherWithTransport(testFetchConfig("off"), nil, tr)
	r := f2.Run("https://example.com/start", FetchOptions{}, nil)
	if !strings.Contains(r.Text, "final page text") {
		t.Fatalf("重定向后应抓到最终页: %+v", r)
	}
	if len(tr.seen) != 2 || !strings.HasSuffix(tr.seen[1], "/final") {
		t.Fatalf("应逐跳跟随到 /final: %v", tr.seen)
	}
}

func TestFetcherAntiBotWall(t *testing.T) {
	f, _ := mkStub(testFetchConfig("off"), []stubCall{
		{200, "text/html", "<html><body>captcha</body></html>"}, // 短页 + 拦截词
	})
	r := f.Run("https://example.com/guard", FetchOptions{}, nil)
	if !strings.Contains(r.Text, "blocked by anti-bot wall") {
		t.Fatalf("反爬墙应判失败: %q", r.Text)
	}
}

func TestFetcherFocusSaving(t *testing.T) {
	var b strings.Builder
	b.WriteString("<html><body>")
	for i := 0; i < 220; i++ { // 全文 > maxChars 8000; 句末标点(TS 切句依赖标点+空白)
		b.WriteString("<p>filler filler filler filler filler filler filler.</p>")
		if i == 110 {
			b.WriteString("<p>secret sauce keyword lives here.</p>")
		}
	}
	b.WriteString("</body></html>")
	f, _ := mkStub(testFetchConfig("off"), []stubCall{
		{200, "text/html", b.String()},
	})
	r := f.Run("https://example.com/long", FetchOptions{Focus: "secret sauce keyword"}, nil)
	if len(r.Segments) == 0 {
		t.Fatalf("focus 模式应有命中段: %+v", r)
	}
	if !strings.Contains(strings.Join(r.Segments, "\n"), "secret sauce keyword") {
		t.Fatalf("命中段缺失: %v", r.Segments)
	}
	if r.SavedPct != nil && *r.SavedPct < 0.5 {
		t.Fatalf("省 token 比例应显著: %v", *r.SavedPct)
	}
}

func TestFetcherUnsupportedContentType(t *testing.T) {
	f, _ := mkStub(testFetchConfig("off"), []stubCall{
		{200, "application/octet-stream", "binary"},
	})
	r := f.Run("https://example.com/bin", FetchOptions{}, nil)
	if !strings.Contains(r.Text, "unsupported content-type") {
		t.Fatalf("不支持的内容类型应报错: %q", r.Text)
	}
}

func TestFetcherCratesApiRewriteEndToEnd(t *testing.T) {
	crateJSON := `{"crate":{"name":"tokio","description":"An event-driven, non-blocking I/O platform.","max_stable_version":"1.47.1","license":"MIT","repository":"https://github.com/tokio-rs/tokio","downloads":987654321}}`
	f, st := mkStub(testFetchConfig("off"), []stubCall{
		{200, "application/json", crateJSON},
	})
	r := f.Run("https://crates.io/crates/tokio", FetchOptions{}, nil)
	if len(st.seen) != 1 || !strings.Contains(st.seen[0], "crates.io/api/v1/crates/tokio") {
		t.Fatalf("应请求 API 端点而非 SPA 页: %v", st.seen)
	}
	if r.Title != "tokio" || !strings.Contains(r.Text, "event-driven, non-blocking I/O") || !strings.Contains(r.Text, "1.47.1") {
		t.Fatalf("crates 人读摘要异常: %+v", r)
	}
	if len(r.Text) > 2000 {
		t.Fatalf("摘要不应是原始大 JSON: %d", len(r.Text))
	}
}

func TestCratesApiRewriteAndText(t *testing.T) {
	name, api, ok := cratesApiRewrite("https://crates.io/crates/serde")
	if !ok || name != "serde" || api != "https://crates.io/api/v1/crates/serde" {
		t.Fatalf("crates 改写失败: %q %q %v", name, api, ok)
	}
	if _, _, ok := cratesApiRewrite("https://crates.io/crates/serde/versions"); ok {
		t.Fatal("非裸 crate 页不应改写")
	}
	if _, _, ok := cratesApiRewrite("https://lib.rs/crates/tokio"); ok {
		t.Fatal("非 crates.io 域不应改写")
	}
	mt := cratesApiText(`{"crate":{"name":"serde","description":"serialization","max_stable_version":"1.0.0","license":"MIT","downloads":123}}`, "serde")
	if mt == nil || !strings.Contains(mt.text, "latest: 1.0.0") || !strings.Contains(mt.text, "license: MIT") {
		t.Fatalf("crates 摘要异常: %+v", mt)
	}
}

func TestDoiOf(t *testing.T) {
	cases := map[string]string{
		"https://doi.org/10.1056/NEJMoa2034577":                      "10.1056/NEJMoa2034577",
		"http 403 for https://doi.org/10.1016/S0040-4020(97)80046-7": "10.1016/S0040-4020(97)80046-7",
		"no doi here": "",
	}
	for in, want := range cases {
		if got := doiOf(in); got != want {
			t.Errorf("doiOf(%q)=%q want %q", in, got, want)
		}
	}
}

func TestSSRFBlocksPrivateRedirect(t *testing.T) {
	// strict 模式: 127.0.0.1 是私网(IP 字面量, LookupIPAddr 直返), 必拦
	f := NewFetcher(testFetchConfig("strict"), nil)
	r := f.Run("http://127.0.0.1:8080/x", FetchOptions{}, nil)
	if !strings.Contains(r.Text, "ssrf:") && !strings.Contains(r.Text, "private address blocked") && !strings.Contains(r.Text, "dns fail") {
		t.Fatalf("strict 模式应拦私网: %q", r.Text)
	}
}

func TestPageCacheTTLExpiry(t *testing.T) {
	c := newPageCache()
	c.put("u", 200, "text/html", "t", "body")
	if _, ok := c.get("u", time.Minute); !ok {
		t.Fatal("1min TTL 内应命中")
	}
	if _, ok := c.get("u", -time.Hour); ok { // 负 TTL: time.Since > ttl 恒真 → 过期
		t.Fatal("负 TTL 应立即过期")
	}
}

// ---------- 顺序响应 transport(重定向测试用) ----------

type fakeResp struct {
	status  int
	ct      string
	body    string
	headers map[string]string
}

type seqTransport struct {
	responses []fakeResp
	seen      []string
}

func (s *seqTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	idx := len(s.seen)
	s.seen = append(s.seen, req.URL.String())
	if idx >= len(s.responses) {
		return nil, fmt.Errorf("seq: unexpected request %s", req.URL)
	}
	r := s.responses[idx]
	h := http.Header{}
	for k, v := range r.headers {
		h.Set(k, v)
	}
	if r.ct != "" {
		h.Set("Content-Type", r.ct)
	}
	return &http.Response{
		StatusCode: r.status,
		Header:     h,
		Body:       ioNopCloser(strings.NewReader(r.body)),
		Request:    req,
	}, nil
}

// ioNopCloser: stub 响应的 Body 包装
func ioNopCloser(r *strings.Reader) io.ReadCloser { return io.NopCloser(r) }
