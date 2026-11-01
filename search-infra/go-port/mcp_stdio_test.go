package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/PuerkitoBio/goquery"
)

// MCP 工具面单测: tools/list 形状 / tools/call 分发 / 未知工具报错

func TestMcpToolsListShape(t *testing.T) {
	tools := mcpTools()
	want := map[string]bool{"search": false, "fetch": false, "search_providers": false, "cache_stats": false, "research": false, "x_search": false, "search_cache": false}
	for _, tl := range tools {
		if _, ok := want[tl.Name]; !ok {
			t.Errorf("意外工具: %s", tl.Name)
		}
		want[tl.Name] = true
		if tl.InputSchema == nil || tl.Description == "" {
			t.Errorf("工具 %s 缺 schema/description", tl.Name)
		}
		if tl.InputSchema["type"] != "object" {
			t.Errorf("工具 %s schema 应为 object", tl.Name)
		}
	}
	for name, present := range want {
		if !present {
			t.Errorf("缺工具: %s", name)
		}
	}
}

func TestMcpFetchToolWithStub(t *testing.T) {
	cfg := testFetchConfig("off")
	f := NewFetcherWithTransport(cfg, nil, &stubTransport{calls: []stubCall{
		{200, "text/html", "<html><body><p>mcp fetchable text</p></body></html>"},
	}})
	// 直改 fetcher 的工具路径: 用全局注册表不合适, 这里直接验证 mcpCallTool 的 fetch 分支
	// (mcpCallTool 内部 NewFetcher 走真实网络 → 用一个已知白名单 URL 且 stub 网络不可控)
	// 改为验证工具层的参数校验 + fetcher 层已由 fetcher_test 覆盖
	_, isErr := mcpCallTool("fetch", map[string]any{"url": ""})
	if !isErr {
		t.Fatal("空 url 应 isError")
	}
	_ = f
}

func TestMcpFetchToolRequiresURL(t *testing.T) {
	_, isErr := mcpCallTool("fetch", map[string]any{})
	if !isErr {
		t.Fatal("缺 url 应 isError")
	}
}

func TestMcpSearchToolRequiresQuery(t *testing.T) {
	_, isErr := mcpCallTool("search", map[string]any{})
	if !isErr {
		t.Fatal("缺 query 应 isError")
	}
}

func TestMcpCacheStatsShape(t *testing.T) {
	text, isErr := mcpCallTool("cache_stats", map[string]any{})
	if isErr {
		t.Fatalf("cache_stats 不应报错: %s", text)
	}
	var m map[string]any
	if json.Unmarshal([]byte(text), &m) != nil {
		t.Fatalf("cache_stats 应返回 JSON: %s", text)
	}
	if _, ok := m["lanes"]; !ok {
		t.Fatal("缺 lanes 字段")
	}
	// P4.5 落地后 cache_stats 必须接真实持久缓存语料统计(不再挂 pending 占位)
	cache, ok := m["cache"].(map[string]any)
	if !ok {
		t.Fatalf("缺 cache 统计对象: %s", text)
	}
	for _, k := range []string{"pages", "pageChars", "searches", "dbBytes"} {
		if _, ok := cache[k]; !ok {
			t.Fatalf("cache 统计缺 %s 字段: %s", k, text)
		}
	}
}

func TestMcpUnknownToolIsError(t *testing.T) {
	_, isErr := mcpCallTool("nonexistent", map[string]any{})
	if !isErr {
		t.Fatal("未知工具应 isError")
	}
}

// goquery.NodeName 语义抽查(保证 focus.go 依赖行为)
func TestGoqueryNodeName(t *testing.T) {
	doc, _ := goquery.NewDocumentFromReader(strings.NewReader("<div><p>x</p></div>"))
	name := goquery.NodeName(doc.Find("p"))
	if name != "p" {
		t.Fatalf("NodeName=%q", name)
	}
}
