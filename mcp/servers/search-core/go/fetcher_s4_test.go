package main

// S4 (issue #3) focused fetch 可靠性: 登录墙/JS 壳/同意墙透明拒绝(不编造正文)、
// 抓取方式/原-最终 URL/缓存命中透明记录。
// 模式: stub transport + SSRF off(与 fetcher_test.go 同款; SSRF 守卫语义在 governor 测试覆盖)。

import (
	"strings"
	"testing"
)

var s4NormalBody = "<html><head><title>Rust async runtime guide</title></head><body><p>" +
	strings.Repeat("tokio runtime async await tasks details ", 200) + "</p></body></html>"

// 登录墙: 200 + 短文本 + "sign in to continue" → Blocked=login_wall, 不编造正文
func TestFetcherRejectsLoginWall(t *testing.T) {
	f, _ := mkStub(testFetchConfig("off"), []stubCall{{status: 200, ct: "text/html",
		body: "<html><head><title>Sign in to continue</title></head><body>Please sign in to read the full article.</body></html>"}})
	res := f.Run("https://paywalled.example/article", FetchOptions{MaxChars: 4000}, nil)
	if res.Blocked != "login_wall" {
		t.Fatalf("login wall must be transparently rejected, blocked=%q text=%q", res.Blocked, res.Text)
	}
	if !strings.HasPrefix(res.Text, "fetch blocked: login_wall") {
		t.Fatalf("text must be the transparent refusal note, got %q", res.Text)
	}
	if res.ReturnedChars != 0 || res.Segments != nil {
		t.Fatal("no article content may be returned for a blocked shell page")
	}
	if res.Via != "direct" {
		t.Fatalf("via must be recorded: %q", res.Via)
	}
}

// JS 空壳 → js_shell
func TestFetcherRejectsJsShell(t *testing.T) {
	f, _ := mkStub(testFetchConfig("off"), []stubCall{{status: 200, ct: "text/html",
		body: "<html><head><title>App</title></head><noscript>You need to enable JavaScript to run this app.</noscript></html>"}})
	res := f.Run("https://spa.example/app", FetchOptions{}, nil)
	if res.Blocked != "js_shell" {
		t.Fatalf("js shell must be rejected, blocked=%q", res.Blocked)
	}
}

// 同意墙 → consent_wall
func TestFetcherRejectsConsentWall(t *testing.T) {
	f, _ := mkStub(testFetchConfig("off"), []stubCall{{status: 200, ct: "text/html",
		body: "<html><head><title>Before you continue</title></head><body>consent to continue to the site</body></html>"}})
	res := f.Run("https://consent.example/news", FetchOptions{}, nil)
	if res.Blocked != "consent_wall" {
		t.Fatalf("consent wall must be rejected, blocked=%q", res.Blocked)
	}
}

// 正常正文 → 无 blocked, focus 段返回, via=direct
func TestFetcherNormalPagePasses(t *testing.T) {
	f, _ := mkStub(testFetchConfig("off"), []stubCall{{status: 200, ct: "text/html", body: s4NormalBody}})
	res := f.Run("https://guide.example/rust", FetchOptions{Focus: "tokio", MaxChars: 3000}, nil)
	if res.Blocked != "" {
		t.Fatalf("normal page must not be classified as shell, blocked=%q", res.Blocked)
	}
	if len(res.Segments) == 0 && res.Text == "" {
		t.Fatal("normal page must return content")
	}
	if res.Via != "direct" {
		t.Fatalf("via must be direct, got %q", res.Via)
	}
}

// 缓存命中: 第二次抓取 FromCache=true, 不再走网络(缓存复用不算当前网络成功, FromCache 透明)
func TestFetcherCacheHitTransparency(t *testing.T) {
	f, st := mkStub(testFetchConfig("off"), []stubCall{{status: 200, ct: "text/html", body: s4NormalBody}})
	r1 := f.Run("https://guide.example/cached", FetchOptions{}, nil)
	r2 := f.Run("https://guide.example/cached", FetchOptions{}, nil)
	if len(st.seen) != 1 {
		t.Fatalf("second fetch must hit the in-process cache, network calls=%d", len(st.seen))
	}
	if !r2.FromCache || r1.FromCache {
		t.Fatalf("fromCache must be transparent: r1=%v r2=%v", r1.FromCache, r2.FromCache)
	}
	if r2.Text != r1.Text {
		t.Fatal("cached text must be stable across fetches of the same URL")
	}
}

// 缓存的壳页同样被拒绝(历史壳页不得因缓存复用伪装成当前成功正文)
func TestFetcherCachedShellStillRejected(t *testing.T) {
	f, _ := mkStub(testFetchConfig("off"), []stubCall{{status: 200, ct: "text/html",
		body: "<html><head><title>Sign in to continue</title></head><body>Please sign in to read the full article.</body></html>"}})
	r1 := f.Run("https://paywalled.example/cached-shell", FetchOptions{}, nil)
	r2 := f.Run("https://paywalled.example/cached-shell", FetchOptions{}, nil)
	if r1.Blocked != "login_wall" || r2.Blocked != "login_wall" {
		t.Fatalf("shell pages must be rejected on both live and cached paths: %q/%q", r1.Blocked, r2.Blocked)
	}
	if !r2.FromCache {
		t.Fatal("second call should have come from cache (and still be rejected)")
	}
}

// 403 → 透明错误, 不编造正文
func TestFetcher403Transparent(t *testing.T) {
	f, _ := mkStub(testFetchConfig("off"), []stubCall{{status: 403, ct: "text/html", body: "forbidden"}})
	res := f.Run("https://blocked.example/doc", FetchOptions{}, nil)
	if !strings.HasPrefix(res.Text, "fetch error:") {
		t.Fatalf("403 must return a transparent fetch error, got %q", res.Text)
	}
	if res.Blocked != "" {
		t.Fatalf("403 walks the error path; shell classification only guards 200 pseudo-bodies, got blocked=%q", res.Blocked)
	}
}
