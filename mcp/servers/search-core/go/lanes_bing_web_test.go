package main

// bingweb 车道测试 (2026-11-25 扩源, 红先绿后):
// - 黄金样本解析锁 (testdata/bingweb-sample-en.html, 2026-11-25 实弹抓取, 10 条干净结果)
// - 垃圾注入负样本锁 (testdata/bingweb-sample-garbage.html, 同日 IP 软封实弹形态:
//   结构完整但结果与查询零相关 — Lowe's 门店页注入, 伪 200)
// - decodeBingClick 变体 / mkt·freshness 映射 / 合法空(b_no) / 漂移守卫
// - 注册门禁 94→95 (扩源提交前实测红: want 94, got 95)

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func bingGolden(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile("testdata/bingweb-sample-en.html")
	if err != nil {
		t.Skipf("golden sample missing: %v", err)
	}
	return string(data)
}

func bingGarbageSample(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile("testdata/bingweb-sample-garbage.html")
	if err != nil {
		t.Skipf("garbage sample missing: %v", err)
	}
	return string(data)
}

func TestParseBingWebGolden(t *testing.T) {
	refs := parseBingWebHTML(bingGolden(t), 10)
	if len(refs) != 10 {
		t.Fatalf("want 10 refs, got %d", len(refs))
	}
	// 首结果: MCP 官方文档 (干净样本实弹抓取时的第 1 条)
	if !strings.Contains(refs[0].Title, "Model Context Protocol") {
		t.Errorf("first title = %q, want MCP doc title", refs[0].Title)
	}
	if refs[0].URL != "https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro" {
		t.Errorf("first url = %q, want decoded MCP doc url", refs[0].URL)
	}
	if !strings.HasPrefix(refs[0].URL, "http") || strings.Contains(refs[0].URL, "bing.com/ck") {
		t.Errorf("url not decoded from ck/a redirect: %q", refs[0].URL)
	}
	for _, r := range refs {
		if r.Engines[0] != "bingweb" || r.Kind != "web" {
			t.Errorf("engine/kind = %v/%v", r.Engines, r.Kind)
		}
		if !strings.HasPrefix(r.URL, "http") || strings.Contains(r.URL, "bing.com/ck") {
			t.Errorf("undecoded or relative url: %q", r.URL)
		}
		if strings.TrimSpace(r.Title) == "" {
			t.Errorf("empty title for %q", r.URL)
		}
	}
	// 至少一半结果带非空 snippet (b_caption/b_lineclamp 双形态)
	withSnippet := 0
	for _, r := range refs {
		if strings.TrimSpace(r.Snippet) != "" {
			withSnippet++
		}
	}
	if withSnippet < 5 {
		t.Errorf("only %d/10 refs have snippets", withSnippet)
	}
}

func TestParseBingWebMaxClamp(t *testing.T) {
	refs := parseBingWebHTML(bingGolden(t), 3)
	if len(refs) != 3 {
		t.Fatalf("max clamp: want 3, got %d", len(refs))
	}
}

func TestDecodeBingClickVariants(t *testing.T) {
	// 真实样本里的 ck/a 形态: u=a1 + base64url("https://modelcontextprotocol.io/...")
	enc := "a1aHR0cHM6Ly9leGFtcGxlLmNvbS9wYWdl"
	got := decodeBingClick("https://www.bing.com/ck/a?!&&p=abc&u=" + enc + "&ntpcnt=1")
	if got != "https://example.com/page" {
		t.Errorf("ck/a decode = %q", got)
	}
	// 带 padding 的变体
	got = decodeBingClick("https://www.bing.com/ck/a?!&&u=a1aHR0cDovL2IuaW8v")
	if got != "http://b.io/" {
		t.Errorf("padded decode = %q", got)
	}
	// 解出站内垂直链接 → 丢弃
	got = decodeBingClick("https://www.bing.com/ck/a?!&&u=a1L2ltYWdlcy9zZWFyY2g_cT10ZXN0")
	if got != "" {
		t.Errorf("internal vertical link should drop, got %q", got)
	}
	// 非 ck/a 的 http 直链 → 原样
	if decodeBingClick("https://plain.example/x") != "https://plain.example/x" {
		t.Errorf("plain passthrough failed")
	}
	// 空 / 非 http 相对链接
	if decodeBingClick("") != "" || decodeBingClick("/search?q=x") != "" {
		t.Errorf("empty/relative should drop")
	}
	// u 无 a1 前缀
	if decodeBingClick("https://www.bing.com/ck/a?!&&u=zzabc") != "" {
		t.Errorf("non-a1 prefix should drop")
	}
}

func TestBingGarbageGuardRefusesInjection(t *testing.T) {
	// 负样本: 同日 IP 软封实弹形态 — 结构完整但 Lowe's/酒店页与查询零相关
	refs := parseBingWebHTML(bingGarbageSample(t), 10)
	if len(refs) == 0 {
		t.Fatal("garbage sample should still parse structurally (that is the trap)")
	}
	err := bingGarbageGuard("model context protocol anthropic", refs)
	if err == nil {
		t.Fatal("garbage injection must be refused, got nil")
	}
	if !strings.Contains(err.Error(), "garbage injection") {
		t.Errorf("error should name the signature: %v", err)
	}
}

func TestBingGarbageGuardPassesRelevant(t *testing.T) {
	refs := parseBingWebHTML(bingGolden(t), 10)
	if err := bingGarbageGuard("model context protocol", refs); err != nil {
		t.Fatalf("clean results must pass guard: %v", err)
	}
	// 任一结果命中 ≥1 词项即放行 (宽松纪律)
	if err := bingGarbageGuard("model context protocol anthropropic rareterm", refs); err != nil {
		t.Fatalf("partial overlap must pass (fusion quality gate owns the rest): %v", err)
	}
	// <2 词项查询无法判 → 放行
	if err := bingGarbageGuard("mcp", refs); err != nil {
		t.Fatalf("single-term query cannot be judged, must pass: %v", err)
	}
	if err := bingGarbageGuard("how to do", refs); err != nil {
		t.Fatalf("stopword-only query must pass: %v", err)
	}
}

func TestBingMarketMapping(t *testing.T) {
	cases := map[string]string{
		"":    "en-US",
		"en":  "en-US",
		"zh":  "zh-CN",
		"ja":  "ja-JP",
		"ko":  "ko-KR",
		"fr":  "fr-FR",
		"de":  "de-DE",
		"es":  "es-ES",
		"ru":  "ru-RU",
		"xx":  "", // 未知码不猜市场
		" eN": "en-US",
	}
	for in, want := range cases {
		if got := bingMarket(in); got != want {
			t.Errorf("bingMarket(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBingFreshnessMapping(t *testing.T) {
	for f, want := range map[string]string{
		"day": "day", "week": "week", "month": "month",
		"year": "", "any": "", "": "",
	} {
		if got := bingFreshness(f); got != want {
			t.Errorf("bingFreshness(%q) = %q, want %q", f, got, want)
		}
	}
}

func TestLaneBingwebRequestShape(t *testing.T) {
	// httptest: 校验请求参数形状 (q/count/mkt/setlang/freshness) + UA 自报
	var gotQuery, gotUA string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		gotUA = r.Header.Get("User-Agent")
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(bingGolden(t)))
	}))
	defer srv.Close()

	orig := laneBingwebURL
	laneBingwebURL = srv.URL
	defer func() { laneBingwebURL = orig }()

	client := &http.Client{Timeout: 5 * time.Second}
	opts := SearchOpts{Query: "model context protocol", Lang: "zh", MaxResults: 8, Freshness: "week"}
	refs, err := laneBingweb(context.Background(), opts, client)
	if err != nil {
		t.Fatalf("lane: %v", err)
	}
	if len(refs) == 0 {
		t.Fatal("want refs")
	}
	if !strings.Contains(gotQuery, "q=model+context+protocol") {
		t.Errorf("query param missing: %s", gotQuery)
	}
	if !strings.Contains(gotQuery, "count=8") {
		t.Errorf("count param missing: %s", gotQuery)
	}
	if !strings.Contains(gotQuery, "mkt=zh-CN") {
		t.Errorf("mkt param missing: %s", gotQuery)
	}
	if !strings.Contains(gotQuery, "setlang=zh") {
		t.Errorf("setlang param missing: %s", gotQuery)
	}
	if !strings.Contains(gotQuery, "freshness=week") {
		t.Errorf("freshness param missing: %s", gotQuery)
	}
	if gotUA != laneUA {
		t.Errorf("UA = %q, want self-identifying laneUA", gotUA)
	}
}

func TestLaneBingwebLegitEmptyAndDrift(t *testing.T) {
	// b_no = Bing 官方无结果块 → 合法空 (不抛错, 不进熔断)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`<html><body><ol id="b_results"><li class="b_no">There are no results for <strong>zzqqxx obscure</strong>. <a>Try different words</a></li></ol></body></html>`))
	}))
	defer srv.Close()
	orig := laneBingwebURL
	laneBingwebURL = srv.URL
	defer func() { laneBingwebURL = orig }()
	client := &http.Client{Timeout: 5 * time.Second}
	refs, err := laneBingweb(context.Background(), SearchOpts{Query: "zzqqxx obscure", MaxResults: 5}, client)
	if err != nil {
		t.Fatalf("b_no legit empty must not error: %v", err)
	}
	if len(refs) != 0 {
		t.Fatalf("b_no must be empty, got %d", len(refs))
	}

	// 挑战页/改版 = 漂移抛错
	srv2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`<html><body>Some challenge or consent wall</body></html>`))
	}))
	defer srv2.Close()
	laneBingwebURL = srv2.URL
	if _, err := laneBingweb(context.Background(), SearchOpts{Query: "test", MaxResults: 5}, client); err == nil {
		t.Fatal("markup drift must error")
	} else if !strings.Contains(err.Error(), "markup drift") {
		t.Errorf("drift error naming: %v", err)
	}
}

func TestLaneBingwebGarbageRefusedEndToEnd(t *testing.T) {
	// 端到端: 垃圾注入页(结构完整) → 车道整体拒绝 (不是把垃圾当结果返回)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(bingGarbageSample(t)))
	}))
	defer srv.Close()
	orig := laneBingwebURL
	laneBingwebURL = srv.URL
	defer func() { laneBingwebURL = orig }()
	client := &http.Client{Timeout: 5 * time.Second}
	_, err := laneBingweb(context.Background(), SearchOpts{Query: "model context protocol anthropic", MaxResults: 10}, client)
	if err == nil || !strings.Contains(err.Error(), "garbage injection") {
		t.Fatalf("end-to-end garbage must be refused with signature, got: %v", err)
	}
}

func TestRegistryGate95Bingweb(t *testing.T) {
	if len(laneRegistry) != 95 { // 94 + bingweb(2026-11-25 无 key 主流引擎扩源)
		t.Fatalf("registry want 95, got %d", len(laneRegistry))
	}
	if laneRegistry["bingweb"] == nil {
		t.Fatal("bingweb not registered")
	}
}
