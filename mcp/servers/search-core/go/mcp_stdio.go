package main

// MCP stdio server (对齐 TS mcp.ts 工具面; 协议 = MCP stdio transport, 行分隔 JSON-RPC 2.0)
// P4 注册已实现工具: search / fetch / search_providers / cache_stats。
// 诚实边界: TS 侧 research/x_search/search_cache 与渐进披露目录搜索工具属 P5/持久化缓存
// 范围, 实现前不注册(不做假实现)。协议面: initialize / tools/list / tools/call。

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
)

type mcpTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

func mcpTools() []mcpTool {
	obj := func(props map[string]any, required ...string) map[string]any {
		schema := map[string]any{"type": "object", "properties": props}
		if len(required) > 0 {
			schema["required"] = required
		}
		return schema
	}
	str := func(desc string) map[string]any { return map[string]any{"type": "string", "description": desc} }
	num := func(desc string) map[string]any { return map[string]any{"type": "number", "description": desc} }
	return []mcpTool{
		{
			Name: "search",
			Description: "Multi-engine web search: plans the query, fans out to keyless engines in parallel, " +
				"then fuses results with 3-tier authority boosting, spam filtering and semantic dedup. " +
				"Returns ranked refs (url/title/snippet/engines). Zero API keys required.",
			InputSchema: obj(map[string]any{
				"query":     str("Search query (any language; CJK auto-routes to zh sources)"),
				"engines":   map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Optional engine subset (default: all keyless lanes)"},
				"freshness": str("day/week/month/year; default any"),
				"lang":      str("Force language code (e.g. zh); auto-detected otherwise"),
				"top_n":     num("Max fused results (default 20)"),
				"count":     num("Result count 1-20 (host contract: Magpie v0.1.3062+ web_search count; alias of top_n, used only when top_n is omitted; default unchanged when neither is passed)"),
			}, "query"),
		},
		{
			Name: "fetch",
			Description: "Fetch a page and extract readable text with SSRF protection (private nets blocked, " +
				"manual redirect re-validation). Use focus to return only matching passages (~90% token saving); " +
				"otherwise returns head-truncated text.",
			InputSchema: obj(map[string]any{
				"url":       str("http(s) URL to fetch"),
				"focus":     str("Return only passages matching this query (hit + adjacent segments)"),
				"max_chars": num("Output char budget, default 8000"),
				"adjacent":  num("Segments to extend around hits, default 1"),
			}, "url"),
		},
		{
			Name:        "search_providers",
			Description: "List search engines with health stats (ok/fail, avg latency, circuit state). Use it to diagnose quality degradation.",
			InputSchema: obj(map[string]any{}),
		},
		{
			Name:        "research",
			Description: "Deep research loop: decomposes the query into up to 5 parallel angles, searches each loop with reference/fetch dual budgets, extracts quoted facts from focused fetches, scores 6 reflection questions (facts/coverage/authority/freshness/multi-source/usability), stops on strict-or-relaxed pass / max-loops (degraded, not blocked) / budget / convergence. Citations [n] are exit-validated 100% resolvable. Resumable via run_id journal replay. Slow (30-120s) — use ONLY when one-shot search is not enough.",
			InputSchema: obj(map[string]any{
				"query":            str("Research question"),
				"preset":           str("summary | report | deep (explicit budget presets; per-field overridable)"),
				"max_loops":        num("Hard loop cap (default 3)"),
				"min_facts":        num("Q1 fact-count threshold (default 6)"),
				"fetch_budget":     num("Full-text fetch budget across all loops (default 12)"),
				"reference_budget": num("Reference pool cap (default 120)"),
				"strict":           map[string]any{"type": "boolean", "description": "Require all 6 reflection questions to pass (default: relaxed Q1+Q2)"},
				"angles":           map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Custom angles (default: query-signal picked from the angle pool)"},
			}, "query"),
		},
		{
			Name:        "x_search",
			Description: "Search X/Twitter posts via degraded chain: official API (if key) parallel Guest GraphQL (anonymous, queryId self-healing rotation) parallel keyless site:x.com engines, then oEmbed full-text enhancement of top statuses. Each layer fails independently without blocking others.",
			InputSchema: obj(map[string]any{
				"query": str("Search query for X/Twitter posts"),
				"top_n": num("Max results (default 20)"),
			}, "query"),
		},
		{
			Name:        "search_cache",
			Description: "Full-text search over pages ALREADY FETCHED on this machine (cache-as-search-corpus, v0.5). Instant, offline, zero cost — trigram index (CJK needs >=3 chars; shorter falls back to substring). Use it to re-find something you fetched earlier, or as last resort when network engines are all failing. Hits return url/title/snippet; pair with fetch(url, focus=...) to re-read.",
			InputSchema: obj(map[string]any{
				"query": str("Full-text query over the local page corpus"),
				"limit": num("Max hits (default 10)"),
			}, "query"),
		},
		{
			Name:        "cache_stats",
			Description: "Counters snapshot: registered lanes + persistent cache corpus stats (pages indexed, chars, cached searches, db bytes). Use it to diagnose quality degradation.",
			InputSchema: obj(map[string]any{}),
		},
	}
}

func mcpCallTool(name string, args map[string]any) (string, bool) {
	return mcpCallToolCtx(context.Background(), name, args)
}

func mcpCallToolCtx(ctx context.Context, name string, args map[string]any) (string, bool) {
	switch name {
	case "search":
		query, _ := args["query"].(string)
		if strings.TrimSpace(query) == "" {
			return "error: query required", true
		}
		timeout := 6000
		opts := SearchOpts{Query: query, Lang: strArg(args, "lang"), TopN: 20, MaxResults: 10, TimeoutMs: timeout}
		opts.TopN = resolveTopN(args)
		if fr := strArg(args, "freshness"); fr != "" {
			opts.Freshness = fr
		}
		if raw, ok := args["engines"].([]any); ok {
			opts.EnginesSet = true // 显式提供 (含空数组): 空名单 = 零请求契约
			for _, e := range raw {
				if s, ok := e.(string); ok {
					opts.Engines = append(opts.Engines, s)
				}
			}
		}
		out := searchFlowCtx(ctx, opts, timeout)
		b, _ := json.Marshal(out)
		return string(b), false
	case "fetch":
		rawURL, _ := args["url"].(string)
		if strings.TrimSpace(rawURL) == "" {
			return "error: url required", true
		}
		opts := FetchOptions{Focus: strArg(args, "focus")}
		if v := numArg(args, "max_chars"); v > 0 {
			opts.MaxChars = v
		}
		if v := numArg(args, "adjacent"); v > 0 {
			opts.Adjacent = v
		}
		f := newFetcherForMcp()
		b, _ := json.Marshal(f.Run(rawURL, opts, f.policyFor(nil, nil)))
		return string(b), false
	case "search_providers":
		health := NewHealthTracker(dataDir())
		names := make([]string, 0, len(laneRegistry))
		for n := range laneRegistry {
			names = append(names, n)
		}
		b, _ := json.Marshal(health.All(names))
		return string(b), false
	case "research":
		query, _ := args["query"].(string)
		if strings.TrimSpace(query) == "" {
			return "error: query required", true
		}
		opts := ResearchOptions{Preset: strArg(args, "preset")}
		if v := numArg(args, "max_loops"); v > 0 {
			opts.MaxLoops = v
		}
		if v := numArg(args, "min_facts"); v > 0 {
			opts.MinFacts = v
		}
		if v := numArg(args, "fetch_budget"); v > 0 {
			opts.FetchBudget = v
		}
		if v := numArg(args, "reference_budget"); v > 0 {
			opts.ReferenceBudget = v
		}
		opts.Strict, _ = args["strict"].(bool)
		if raw, ok := args["angles"].([]any); ok {
			for _, a := range raw {
				if s2, ok := a.(string); ok {
					opts.Angles = append(opts.Angles, s2)
				}
			}
		}
		fetcher := newPersistentFetcher(nil)
		loop := NewResearchLoop(dataDir(), fetcher)
		res, err := loop.Run(query, opts, nil)
		if err != nil {
			return "error: " + err.Error(), true
		}
		b, _ := json.Marshal(res)
		return string(b), false
	case "x_search":
		query, _ := args["query"].(string)
		if strings.TrimSpace(query) == "" {
			return "error: query required", true
		}
		topN := 20
		if v := numArg(args, "top_n"); v > 0 {
			topN = v
		}
		b, _ := json.Marshal(xSearchCore(query, topN))
		return string(b), false
	case "search_cache":
		query, _ := args["query"].(string)
		if strings.TrimSpace(query) == "" {
			return "error: query required", true
		}
		limit := 10
		if v := numArg(args, "limit"); v > 0 {
			limit = v
		}
		b, _ := json.Marshal(searchCacheQuery(query, limit))
		return string(b), false
	case "cache_stats":
		b, _ := json.Marshal(map[string]any{
			"lanes": len(laneRegistry),
			"cache": cacheStatsSnapshot(),
		})
		return string(b), false
	}
	return "error: unknown tool: " + name, true
}

// resolveTopN (2026-11-25 W3): Magpie v0.1.3062+ 宿主 count 契约 (1-20)。
// top_n 优先(本体参数); count 是宿主别名, 仅 top_n 未传时生效
// 且 clamp 到 [1,20] 不放大数据面; 两参都未传保持默认 20
// (不因宿主默认 6 压低现有默认)。
func resolveTopN(args map[string]any) int {
	if v := numArg(args, "top_n"); v > 0 {
		return v
	}
	if v := numArg(args, "count"); v > 0 {
		if v > 20 {
			v = 20
		}
		return v
	}
	return 20
}

func strArg(args map[string]any, key string) string {
	v, _ := args[key].(string)
	return v
}

// newFetcherForMcp 可注入(MCP fetch 工具测试用)
var newFetcherForMcp = func() *Fetcher { return newPersistentFetcher(nil) }

func numArg(args map[string]any, key string) int {
	switch v := args[key].(type) {
	case float64:
		return int(v)
	case string:
		n, _ := strconv.Atoi(v)
		return n
	}
	return 0
}

// serveMcpStdio 行分隔 JSON-RPC 2.0 主循环(MCP stdio transport)
func serveMcpStdio() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	out := bufio.NewWriter(os.Stdout)
	var inflight sync.WaitGroup // G3: 退出前等待在飞调用完成 (防与定向 Flush 竞态)
	defer out.Flush()           // LIFO: 先 Wait 后 Flush
	defer inflight.Wait()

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var req struct {
			JSONRPC string          `json:"jsonrpc"`
			ID      json.RawMessage `json:"id"`
			Method  string          `json:"method"`
			Params  struct {
				Name      string          `json:"name"`
				Arguments json.RawMessage `json:"arguments"`
				// initialize 参数
				ProtocolVersion string          `json:"protocolVersion"`
				ClientInfo      json.RawMessage `json:"clientInfo"`
				// notifications/cancelled 参数
				RequestID json.RawMessage `json:"requestId"`
				Reason    string          `json:"reason"`
			} `json:"params"`
		}
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			writeMcpError(out, nil, -32700, "parse error")
			continue
		}
		isNotification := len(req.ID) == 0 || string(req.ID) == "null"
		switch req.Method {
		case "initialize":
			ver := req.Params.ProtocolVersion
			if ver == "" {
				ver = "2024-11-05"
			}
			writeMcpResult(out, req.ID, map[string]any{
				"protocolVersion": ver,
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo":      map[string]any{"name": "search-core-go", "version": "0.8.1-go"},
			})
		case "notifications/initialized":
			// 无响应
		case "ping":
			if !isNotification {
				writeMcpResult(out, req.ID, map[string]any{})
			}
		case "tools/list":
			writeMcpResult(out, req.ID, map[string]any{"tools": mcpTools()})
		case "notifications/cancelled":
			// G3: MCP 取消 — 取消在飞调用的 ctx; 已结算的请求忽略 (协议允许竞态)
			cancelMcpRequest(req.Params.RequestID)
		case "tools/call":
			args := map[string]any{}
			if len(req.Params.Arguments) > 0 {
				_ = json.Unmarshal(req.Params.Arguments, &args)
			}
			// G3: 异步派发 — 长搜索不阻塞后续请求/取消通知的读取
			inflight.Add(1)
			go func(id json.RawMessage, name string, a map[string]any) {
				defer inflight.Done()
				dispatchMcpCall(out, id, name, a)
			}(req.ID, req.Params.Name, args)
		default:
			if !isNotification {
				writeMcpError(out, req.ID, -32601, "method not found: "+req.Method)
			}
		}
	}
}

// mcpOutMu: stdout 写入互斥 (G3 异步派发后主循环与调用 goroutine 共享 writer)
var mcpOutMu sync.Mutex

func writeMcpResult(w *bufio.Writer, id json.RawMessage, result any) {
	if len(id) == 0 {
		id = json.RawMessage("null")
	}
	b, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
	mcpOutMu.Lock()
	defer mcpOutMu.Unlock()
	fmt.Fprintln(w, string(b))
	w.Flush()
}

func writeMcpError(w *bufio.Writer, id json.RawMessage, code int, msg string) {
	if len(id) == 0 {
		id = json.RawMessage("null")
	}
	mcpOutMu.Lock()
	defer mcpOutMu.Unlock()
	b, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0", "id": id,
		"error": map[string]any{"code": code, "message": msg},
	})
	fmt.Fprintln(w, string(b))
	w.Flush()
}

// ---------- G3: 按请求取消的异步调用 ----------

var mcpReqMu sync.Mutex
var mcpReqCancels = map[string]context.CancelFunc{}

func mcpReqKey(id json.RawMessage) string { return string(id) }

func registerMcpRequest(id json.RawMessage, cancel context.CancelFunc) {
	mcpReqMu.Lock()
	defer mcpReqMu.Unlock()
	mcpReqCancels[mcpReqKey(id)] = cancel
}

func cancelMcpRequest(id json.RawMessage) {
	mcpReqMu.Lock()
	cancel, ok := mcpReqCancels[mcpReqKey(id)]
	if ok {
		delete(mcpReqCancels, mcpReqKey(id))
	}
	mcpReqMu.Unlock()
	if ok {
		cancel()
	}
}

func finishMcpRequest(id json.RawMessage) {
	mcpReqMu.Lock()
	delete(mcpReqCancels, mcpReqKey(id))
	mcpReqMu.Unlock()
}

// dispatchMcpCall: 单次 tools/call 的异步执行 (ctx 可被 notifications/cancelled 取消)
func dispatchMcpCall(out *bufio.Writer, id json.RawMessage, name string, args map[string]any) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if !isNotificationID(id) {
		registerMcpRequest(id, cancel)
		defer finishMcpRequest(id)
	}
	text, isErr := mcpCallToolCtx(ctx, name, args)
	content := map[string]any{"type": "text", "text": text}
	var result any
	if isErr {
		result = map[string]any{"content": []any{content}, "isError": true}
	} else {
		result = map[string]any{"content": []any{content}, "isError": false}
	}
	writeMcpResult(out, id, result)
}

func isNotificationID(id json.RawMessage) bool {
	return len(id) == 0 || string(id) == "null"
}
