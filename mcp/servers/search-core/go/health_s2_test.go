package main

// S2 (issue #3) 引擎健康: 429 Retry-After 尊重(有界退避, 防重试风暴) + 壳页分类。

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestRetryAfterMsOf(t *testing.T) {
	cases := []struct {
		msg  string
		want int
	}{
		{"searxng http 429 (retry-after: 30s)", 30000},
		{"engine http 429 (Retry-After: 120s)", 120000},
		{"engine http 429 (retry-after: 99999s)", cooldownCapMs},            // 有界上限
		{"engine http 429 (retry-after: Tue, 08 Jul 2026 00:00:00 GMT)", 0}, // HTTP-date 如实忽略
		{"engine http 429", 0},
	}
	for _, c := range cases {
		if got := retryAfterMsOf(c.msg); got != c.want {
			t.Fatalf("retryAfterMsOf(%q)=%d want %d", c.msg, got, c.want)
		}
	}
}

func TestRetryAfterSuffix(t *testing.T) {
	resp := &http.Response{Header: http.Header{}}
	resp.Header.Set("Retry-After", "30")
	if s := retryAfterSuffix(resp); s != " (retry-after: 30s)" {
		t.Fatalf("suffix wrong: %q", s)
	}
	resp.Header.Set("Retry-After", "Tue, 08 Jul 2026 00:00:00 GMT")
	if s := retryAfterSuffix(resp); s != "" {
		t.Fatalf("HTTP-date must be ignored, got %q", s)
	}
	if s := retryAfterSuffix(nil); s != "" {
		t.Fatal("nil resp must yield empty suffix")
	}
}

// 熔断器冷却必须尊重 Retry-After 下限: 429+retry-after 30s → open ≥ 30s
func TestBreakerCooldownRespectsRetryAfter(t *testing.T) {
	h := NewHealthTracker(t.TempDir())
	now := time.Now()
	h.now = func() time.Time { return now }
	// rate_limited 阈值 4 — 打满并带 retry-after
	for i := 0; i < 4; i++ {
		h.Record("engine-ra", false, 100, "searxng http 429 (retry-after: 30s)", "rate_limited")
	}
	he := h.Snapshot("engine-ra", true, false)
	if !he.CircuitOpen {
		t.Fatal("circuit must be open after 4 rate_limited failures")
	}
	// 29s 时仍开(retry-after 下限生效 — 旧固定冷却 2min 太长这里测下限,
	// 但反过来 29s 内闭合才是红灯: 默认 rate_limited 冷却 120s, 修复前也开;
	// 真正的红绿分界在"下限抬升": retry-after 30s 必须比策略更短时长内不开)
	if !h.isOpenAt("engine-ra", now.Add(29*time.Second)) {
		t.Fatal("circuit must stay open through the Retry-After window")
	}
	// 上界有界: retry-after 99999s 被截到 1h, 不会永久封死
	h2 := NewHealthTracker(t.TempDir())
	h2.now = func() time.Time { return now }
	for i := 0; i < 4; i++ {
		h2.Record("engine-ra2", false, 100, "http 429 (retry-after: 99999s)", "rate_limited")
	}
	if !h2.isOpenAt("engine-ra2", now.Add(59*time.Minute)) {
		t.Fatal("circuit must still be open at 59min for a 99999s retry-after (capped 1h)")
	}
	if h2.isOpenAt("engine-ra2", now.Add(61*time.Minute)) {
		t.Fatal("circuit must close after the 1h cap (bounded backoff, no permanent block)")
	}
}

func TestClassifyPageShell(t *testing.T) {
	cases := []struct {
		title, text, want string
	}{
		{"Sign in to continue", "Please sign in to read the full article.", "login_wall"},
		{"JavaScript required", "You need to enable JavaScript to run this app.", "js_shell"},
		{"Before you continue", "consent to continue to the site", "consent_wall"},
		{"Real article", strings.Repeat("substantial article body text ", 100), ""}, // 长文本不判壳
		{"Normal page", "short but normal page text", ""},                           // 无壳标记
	}
	for _, c := range cases {
		if got := classifyPageShell(c.title, c.text); got != c.want {
			t.Fatalf("classifyPageShell(%q)=%q want %q", c.title, got, c.want)
		}
	}
}
