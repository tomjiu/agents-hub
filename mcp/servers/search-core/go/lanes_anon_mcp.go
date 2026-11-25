package main

// 扩源 2026-11-25 (issue #3 下一阶段 W1): parallel + tinyfish 匿名 MCP 车道。
// 协议来源: @guotree/magpie-websearch v0.7.3 PROVIDERS.md 已验证行为 + 本仓 2026-11-25 实弹复核
// (catalog/audit/search-next-providers-2026-11-25.json):
//   - Parallel: POST https://mcp.parallel.ai/mcp, JSON-RPC tools/call "web_search",
//     arguments {objective, search_queries[]}; 无 initialize 的单次调用; 响应 SSE 或 JSON;
//     公开搜索上限 20 条, 匿名仅 fast 模式; 结果 url/title/publish_date/excerpts[]。
//   - TinyFish: POST https://agent.tinyfish.ai/mcp, header X-TinyFish-Access-Mode: keyless,
//     JSON-RPC tools/call "search", arguments {query}; 响应 JSON 或 SSE;
//     web/news 匿名可用(research_paper 需 Key); 结果 position/site_name/snippet/title/url。
// 免 Key 直入默认池; 429/超时经熔断器治理(与其他 lane 同纪律)。
// JSON-RPC 错误 = 错误而非空结果(magpie-websearch 同契约); 无 keyed 升级路径(REST 通道
// 未在本环境实弹验证, 挂账待真实 Key 后评估, 不做未验证协议)。

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// ---------- 匿名 MCP 传输: 无 initialize 的单次 tools/call ----------

// anonMCPResult: JSON-RPC 响应信封 (content[].text 或 structuredContent)
type anonMCPResult struct {
	Result struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		StructuredContent json.RawMessage `json:"structuredContent"`
	} `json:"result"`
	Error *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// stripSSE: SSE 流("event: message\ndata: {...}")提取 data: 行拼接为 JSON 文本。
// 纯 JSON 响应原样返回 (两家端点实测: Parallel 回 SSE, TinyFish 回纯 JSON, 文档允许两者)。
func stripSSE(body []byte) []byte {
	s := string(body)
	if !strings.Contains(s, "data:") {
		return body
	}
	var b strings.Builder
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.HasPrefix(line, "data:") {
			b.WriteString(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	out := []byte(b.String())
	if json.Valid(out) {
		return out
	}
	return body // 非 SSE 内容误含 "data:" 字样时回退原文
}

// callAnonymousMCP: 单次 tools/call, 返回内层搜索 payload 原始 JSON。
// 提取次序: structuredContent → content[0].text 再解码一次 JSON (双层解码, magpie-websearch
// search-results.mjs 同策略)。text 非 JSON 时原样返回字节(由调用方判定形状)。
func callAnonymousMCP(ctx context.Context, client *http.Client, endpoint, tool string, arguments map[string]any, extraHeaders map[string]string) (json.RawMessage, error) {
	payload := map[string]any{
		"jsonrpc": "2.0", "id": 1,
		"method": "tools/call",
		"params": map[string]any{"name": tool, "arguments": arguments},
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("%s http %d%s", tool, resp.StatusCode, retryAfterSuffix(resp))
	}
	data, err := ReadBounded(resp.Body, maxAPIBodyBytes)
	if err != nil {
		return nil, fmt.Errorf("%s: read: %w", tool, err)
	}
	data = stripSSE(data)
	var env anonMCPResult
	if err := json.Unmarshal(data, &env); err != nil {
		return nil, fmt.Errorf("%s: bad jsonrpc envelope: %w", tool, err)
	}
	if env.Error != nil {
		return nil, fmt.Errorf("%s jsonrpc %d: %s", tool, env.Error.Code, env.Error.Message)
	}
	if len(env.Result.StructuredContent) > 0 {
		return env.Result.StructuredContent, nil
	}
	for _, c := range env.Result.Content {
		if c.Type != "text" || c.Text == "" {
			continue
		}
		inner := []byte(c.Text)
		if json.Valid(inner) {
			return json.RawMessage(inner), nil
		}
		return inner, nil
	}
	return nil, fmt.Errorf("%s: empty mcp content", tool)
}

// ---------- parallel ----------

type parallelPayload struct {
	SearchID string `json:"search_id"`
	Results  []struct {
		URL         string   `json:"url"`
		Title       string   `json:"title"`
		PublishDate string   `json:"publish_date"`
		Excerpts    []string `json:"excerpts"`
	} `json:"results"`
}

func parseParallel(raw json.RawMessage, max int) ([]Reference, error) {
	var d parallelPayload
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, fmt.Errorf("parallel: bad payload: %w", err)
	}
	var out []Reference
	for _, r := range d.Results {
		if !strings.HasPrefix(r.URL, "http") {
			continue
		}
		title := r.Title
		if title == "" {
			title = r.URL
		}
		// excerpts 以空行连接 (magpie-websearch 同策略), clampText 统一截断
		snippet := clampText(strings.Join(r.Excerpts, "\n\n"), 400)
		out = append(out, Reference{
			URL: r.URL, Title: clampText(title, 200), Snippet: snippet,
			Engines: []string{"parallel"}, Published: r.PublishDate, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("parallel: no results parsed")
	}
	return out, nil
}

func laneParallel(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	n := opts.MaxResults
	if n > 20 { // 公开搜索上限 20 (Parallel 官方文档)
		n = 20
	}
	raw, err := callAnonymousMCP(ctx, client, "https://mcp.parallel.ai/mcp", "web_search",
		map[string]any{"objective": opts.Query, "search_queries": []string{opts.Query}}, nil)
	if err != nil {
		return nil, err
	}
	return parseParallel(raw, n)
}

// ---------- tinyfish ----------

type tinyfishPayload struct {
	Results []struct {
		Position int    `json:"position"`
		SiteName string `json:"site_name"`
		Snippet  string `json:"snippet"`
		Title    string `json:"title"`
		URL      string `json:"url"`
	} `json:"results"`
}

func parseTinyfish(raw json.RawMessage, max int) ([]Reference, error) {
	var d tinyfishPayload
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, fmt.Errorf("tinyfish: bad payload: %w", err)
	}
	var out []Reference
	for _, r := range d.Results {
		if !strings.HasPrefix(r.URL, "http") {
			continue
		}
		title := r.Title
		if title == "" {
			title = r.URL
		}
		out = append(out, Reference{
			URL: r.URL, Title: clampText(title, 200), Snippet: clampText(r.Snippet, 400),
			Engines: []string{"tinyfish"}, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("tinyfish: no results parsed")
	}
	return out, nil
}

func laneTinyfish(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	raw, err := callAnonymousMCP(ctx, client, "https://agent.tinyfish.ai/mcp", "search",
		map[string]any{"query": opts.Query},
		map[string]string{"X-TinyFish-Access-Mode": "keyless"})
	if err != nil {
		return nil, err
	}
	return parseTinyfish(raw, opts.MaxResults)
}
