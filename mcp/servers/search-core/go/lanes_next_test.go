package main

// 2026-11-25 扩源测试 (issue #3 下一阶段 W1-W4):
//   - W1 parallel/tinyfish 匿名 MCP 车道: 传输层(SSE/JSON 双形状, httptest 本地服务)、
//     parse 锁定 (fixture 保真自 2026-11-25 实弹抓取 /tmp/live → catalog/audit)
//   - W2 searxngBases(): SC_SEARXNG_URL 自部署实例优先, 未设回落公共池
//   - W3 resolveTopN(): Magpie v0.1.3062+ 宿主 count 契约 (1-20, top_n 优先)
//   - W4 keyed Google lane: 无 Key 透明报错, 有 Key 可用性门控
// 红先绿后: 门禁 90→94 在扩源提交前实测红 (want 90, got 94), 本文件为新增覆盖。

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ---------- W1: 传输层 ----------

// callAnonMCPServer: 本地 JSON-RPC 服务, envelope 形状可选 SSE/JSON/structuredContent
func callAnonMCPServer(t *testing.T, contentType string, handler http.HandlerFunc) {
	t.Helper()
	srv := httptest.NewServer(handler)
	defer srv.Close()
	client := &http.Client{}
	raw, err := callAnonymousMCP(context.Background(), client, srv.URL, "web_search",
		map[string]any{"objective": "q", "search_queries": []string{"q"}}, nil)
	if err != nil {
		t.Fatalf("callAnonymousMCP: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("inner payload not json: %v (raw=%s)", err, string(raw))
	}
	if payload["search_id"] != "sid_1" {
		t.Fatalf("want search_id sid_1, got %v", payload["search_id"])
	}
}

func TestCallAnonMCPJSONResponse(t *testing.T) {
	inner := `{"search_id":"sid_1","results":[{"url":"https://x.org/a","title":"A","excerpts":["e1"]}]}`
	esc, _ := json.Marshal(inner)
	body := `{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":` + string(esc) + `}]}}`
	callAnonMCPServer(t, "application/json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	})
}

func TestCallAnonMCPSSEResponse(t *testing.T) {
	// Parallel 实测形状: "event: message\ndata: {jsonrpc...}" (2026-11-25 实弹抓取)
	inner := `{"search_id":"sid_1","results":[]}`
	esc, _ := json.Marshal(inner)
	env := `{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":` + string(esc) + `}]}}`
	callAnonMCPServer(t, "text/event-stream", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: message\ndata: " + env + "\n\n"))
	})
}

func TestCallAnonMCPStructuredContent(t *testing.T) {
	env := `{"jsonrpc":"2.0","id":1,"result":{"structuredContent":{"search_id":"sid_1"}}}`
	callAnonMCPServer(t, "application/json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(env))
	})
}

func TestCallAnonMCPJSONRPCError(t *testing.T) {
	// JSON-RPC 错误 = 错误而非空结果 (magpie-websearch 同契约)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"rate limited"}}`))
	}))
	defer srv.Close()
	_, err := callAnonymousMCP(context.Background(), srv.Client(), srv.URL, "web_search", nil, nil)
	if err == nil || !strings.Contains(err.Error(), "-32000") {
		t.Fatalf("want jsonrpc error surfaced, got %v", err)
	}
}

func TestCallAnonMCPHTTP429(t *testing.T) {
	// 429 透传状态码 (熔断器治理入口)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(429)
	}))
	defer srv.Close()
	_, err := callAnonymousMCP(context.Background(), srv.Client(), srv.URL, "web_search", nil, nil)
	if err == nil || !strings.Contains(err.Error(), "429") {
		t.Fatalf("want http 429 error, got %v", err)
	}
}

func TestStripSSE(t *testing.T) {
	// 非 SSE 文本误含 "data:" 字样时回退原文 (保守)
	plain := []byte(`{"note":"data: inside string"}`)
	if string(stripSSE(plain)) != string(plain) {
		t.Fatalf("plain json must pass through")
	}
	sse := []byte("event: message\r\ndata: {\"a\":1}\r\n\r\n")
	if string(stripSSE(sse)) != `{"a":1}` {
		t.Fatalf("sse strip got %s", stripSSE(sse))
	}
}

// ---------- W1: parse 锁定 (fixture 保真自实弹) ----------

func TestParseParallel(t *testing.T) {
	// 2026-11-25 实弹形状: search_id/results[]{url,title,publish_date,excerpts[]}
	fixture := `{"search_id":"search_x","results":[
                {"url":"https://sqlite.org/wal.html","title":"Write-Ahead Logging","publish_date":"2024-01-02","excerpts":["WAL provides more concurrency","Readers do not block writers"]},
                {"url":"not-http","title":"bad","excerpts":["x"]},
                {"url":"https://example.org/b","title":"","excerpts":[]}
        ]}`
	refs, err := parseParallel(json.RawMessage(fixture), 10)
	if err != nil {
		t.Fatalf("parseParallel: %v", err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs (non-http dropped), got %d", len(refs))
	}
	if refs[0].URL != "https://sqlite.org/wal.html" || refs[0].Engines[0] != "parallel" {
		t.Fatalf("ref0 wrong: %+v", refs[0])
	}
	if refs[0].Published != "2024-01-02" {
		t.Fatalf("publish_date not mapped: %q", refs[0].Published)
	}
	if !strings.Contains(refs[0].Snippet, "\n\n") {
		t.Fatalf("excerpts must join with blank line, got %q", refs[0].Snippet)
	}
	if refs[1].Title != "https://example.org/b" {
		t.Fatalf("empty title falls back to url, got %q", refs[1].Title)
	}
	if _, err := parseParallel(json.RawMessage(`{"results":[]}`), 10); err == nil {
		t.Fatalf("empty results must error (no negative cache)")
	}
}

func TestParseParallelMaxCap(t *testing.T) {
	fixture := `{"results":[` +
		`{"url":"https://a/1","title":"1"},{"url":"https://a/2","title":"2"},{"url":"https://a/3","title":"3"}]}`
	refs, err := parseParallel(json.RawMessage(fixture), 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want max cap 2, got %d", len(refs))
	}
}

func TestParseTinyfish(t *testing.T) {
	// 2026-11-25 实弹形状: results[]{position,site_name,snippet,title,url}
	fixture := `{"query":"q","results":[
                {"position":1,"site_name":"sqlite.org","snippet":"WAL mode allows concurrent readers","title":"SQLite: WAL","url":"https://sqlite.org/wal.html"},
                {"position":2,"site_name":"","snippet":"","title":"","url":"javascript:void(0)"}
        ]}`
	refs, err := parseTinyfish(json.RawMessage(fixture), 10)
	if err != nil {
		t.Fatalf("parseTinyfish: %v", err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref (non-http dropped), got %d", len(refs))
	}
	if refs[0].Engines[0] != "tinyfish" || refs[0].Snippet == "" {
		t.Fatalf("ref wrong: %+v", refs[0])
	}
	if _, err := parseTinyfish(json.RawMessage(`{"results":[]}`), 10); err == nil {
		t.Fatalf("empty results must error")
	}
}

// ---------- W2: searxng 自部署 ----------

func TestSearxngBasesCustom(t *testing.T) {
	t.Setenv("SC_SEARXNG_URL", "http://127.0.0.1:8888, https://sx.example.org/ ")
	got := searxngBases()
	if len(got) != 2 || got[0] != "http://127.0.0.1:8888" || got[1] != "https://sx.example.org" {
		t.Fatalf("custom bases wrong: %v", got)
	}
}

func TestSearxngBasesFallback(t *testing.T) {
	t.Setenv("SC_SEARXNG_URL", "")
	if got := searxngBases(); len(got) != len(searxngInstances) {
		t.Fatalf("unset env must fall back to public pool, got %v", got)
	}
}

// ---------- W3: resolveTopN (Magpie count 契约) ----------

func TestResolveTopN(t *testing.T) {
	cases := []struct {
		name string
		args map[string]any
		want int
	}{
		{"default", map[string]any{}, 20},
		{"top_n priority", map[string]any{"top_n": float64(15), "count": float64(6)}, 15},
		{"count alias", map[string]any{"count": float64(6)}, 6},
		{"count clamp high", map[string]any{"count": float64(100)}, 20},
		{"count clamp min", map[string]any{"count": float64(0)}, 20}, // 0=未提供语义
		{"count string form", map[string]any{"count": "8"}, 8},       // numArg 字符串路径
	}
	for _, c := range cases {
		if got := resolveTopN(c.args); got != c.want {
			t.Errorf("%s: resolveTopN=%d want %d", c.name, got, c.want)
		}
	}
}

func TestMCPToolSchemaHasCount(t *testing.T) {
	// schema 暴露 count: Magpie v0.1.3062+ 宿主传入不再被静默丢弃
	for _, tool := range mcpTools() {
		if tool.Name != "search" {
			continue
		}
		props, ok := tool.InputSchema["properties"].(map[string]any)
		if !ok {
			t.Fatal("search tool has no properties")
		}
		if _, ok := props["count"]; !ok {
			t.Fatal("search tool schema missing count parameter")
		}
		if _, ok := props["top_n"]; !ok {
			t.Fatal("search tool schema must keep top_n")
		}
		return
	}
	t.Fatal("search tool not found")
}

// ---------- W4: keyed Google lanes ----------

func TestParseSerper(t *testing.T) {
	fixture := `{"organic":[
                {"title":"SQLite WAL","link":"https://sqlite.org/wal.html","snippet":"Write-ahead logging","date":"2024-01-01"},
                {"title":"no link","link":"","snippet":"dropped"}
        ]}`
	refs, err := parseSerper([]byte(fixture), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].Engines[0] != "serper" || refs[0].Published != "2024-01-01" {
		t.Fatalf("serper refs wrong: %+v", refs)
	}
	if _, err := parseSerper([]byte(`{"organic":[]}`), 10); err == nil {
		t.Fatal("empty organic must error")
	}
}

func TestParseSerpapi(t *testing.T) {
	fixture := `{"organic_results":[
                {"title":"SQLite WAL","link":"https://sqlite.org/wal.html","snippet":"Write-ahead logging","date":"2024-01-01"}
        ],"organic_results_state":"Showing results for query"}`
	refs, err := parseSerpapi([]byte(fixture), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].Engines[0] != "serpapi" {
		t.Fatalf("serpapi refs wrong: %+v", refs)
	}
	if _, err := parseSerpapi([]byte(`{"organic_results":[],"organic_results_state":"Fully empty"}`), 10); err == nil {
		t.Fatal("fully empty must surface as no-results error (no negative cache)")
	}
}

func TestKeyedLaneNoKeyTransparentError(t *testing.T) {
	// 显式点名而无 Key: 透明报错 (不静默空/不伪造)
	t.Setenv("SERPER_API_KEY", "")
	t.Setenv("SERPAPI_API_KEY", "")
	ctx := context.Background()
	if _, err := laneSerper(ctx, SearchOpts{Query: "q"}, &http.Client{}); err == nil || !strings.Contains(err.Error(), "SERPER_API_KEY") {
		t.Fatalf("serper without key must name the env, got %v", err)
	}
	if _, err := laneSerpapi(ctx, SearchOpts{Query: "q"}, &http.Client{}); err == nil || !strings.Contains(err.Error(), "SERPAPI_API_KEY") {
		t.Fatalf("serpapi without key must name the env, got %v", err)
	}
	if laneHasKey("serper") || laneHasKey("serpapi") {
		t.Fatal("laneHasKey must be false without keys")
	}
}

func TestKeyedLaneHasKey(t *testing.T) {
	t.Setenv("SERPER_API_KEY", " test-key ")
	if !laneHasKey("serper") {
		t.Fatal("laneHasKey(serper) with key set must be true")
	}
	if laneHasKey("nonexistent") {
		t.Fatal("unknown lane never keyed")
	}
}

func TestGoogleTBS(t *testing.T) {
	cases := map[string]string{"day": "qdr:d", "week": "qdr:w", "month": "qdr:m", "year": "qdr:y", "any": "", "": ""}
	for in, want := range cases {
		if got := googleTBS(in); got != want {
			t.Errorf("googleTBS(%q)=%q want %q", in, got, want)
		}
	}
}

// ---------- 注册完整性 ----------

func TestNextLanesRegistered(t *testing.T) {
	for _, name := range []string{"parallel", "tinyfish", "serper", "serpapi"} {
		if _, ok := laneRegistry[name]; !ok {
			t.Errorf("lane %s not registered", name)
		}
	}
	if len(keyedLaneEnv) != 2 {
		t.Errorf("keyedLaneEnv want 2 entries, got %d", len(keyedLaneEnv))
	}
}
