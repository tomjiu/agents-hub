package main

// 扩源 2026-11-25 (issue #3 下一阶段 W4): serper + serpapi keyed Google 车道。
// 背景: google.com 直连从本环境实测为 JS 壳页(0 可解析外链)/lite 表单壳, 维持 G2 BLOCKED
// 判定不绕过; 合法 Google 通路 = 用户自有 Key 的 SERP API。协议来源:
// @guotree/magpie-websearch PROVIDERS.md (Serper/SerpApi 协议注记, 2026-11 已验证行为):
//   - Serper: POST https://google.serper.dev/search, header X-API-KEY, body {q, num(<=10), hl, tbs};
//     响应 organic[]{title,link,snippet,date}; 单页 10 条; 支持 tbs 时效筛选。
//   - SerpApi: GET https://serpapi.com/search?q=&api_key=, 响应 organic_results[]{title,link,snippet,date};
//     Google 2025-09 废弃 num 参数, 不传 count, 本地截断。
// 门控: 无 Key 不入默认池(不产生失败腿); 显式点名而无 Key 透明报错; 有 Key 入池。
// 无 Key 不实弹, fixture 锁协议形状; tbs 映射 day/week/month/year → qdr:d/w/m/y (Google 语法)。

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// keyedLaneEnv: 车道名 → Key 环境变量 (providers 面板/池门控共用)
var keyedLaneEnv = map[string]string{
	"serper":  "SERPER_API_KEY",
	"serpapi": "SERPAPI_API_KEY",
}

// laneHasKey: keyed 车道是否已配置 Key
func laneHasKey(name string) bool {
	env, ok := keyedLaneEnv[name]
	return ok && strings.TrimSpace(os.Getenv(env)) != ""
}

// googleTBS: freshness → Google tbs 时效参数
func googleTBS(freshness string) string {
	switch strings.ToLower(strings.TrimSpace(freshness)) {
	case "day":
		return "qdr:d"
	case "week":
		return "qdr:w"
	case "month":
		return "qdr:m"
	case "year":
		return "qdr:y"
	}
	return ""
}

// ---------- serper ----------

type serperResp struct {
	Organic []struct {
		Title   string `json:"title"`
		Link    string `json:"link"`
		Snippet string `json:"snippet"`
		Date    string `json:"date"`
	} `json:"organic"`
}

func parseSerper(data []byte, max int) ([]Reference, error) {
	var d serperResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("serper: bad json: %w", err)
	}
	var out []Reference
	for _, r := range d.Organic {
		if !strings.HasPrefix(r.Link, "http") {
			continue
		}
		title := r.Title
		if title == "" {
			title = r.Link
		}
		out = append(out, Reference{
			URL: r.Link, Title: clampText(title, 200), Snippet: clampText(r.Snippet, 400),
			Engines: []string{"serper"}, Published: r.Date, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("serper: no organic results")
	}
	return out, nil
}

func laneSerper(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	key := strings.TrimSpace(os.Getenv("SERPER_API_KEY"))
	if key == "" {
		return nil, fmt.Errorf("serper: SERPER_API_KEY not set (keyed Google lane; set the env to enable)")
	}
	num := opts.MaxResults
	if num > 10 { // Serper 单页上限 10
		num = 10
	}
	body := map[string]any{"q": opts.Query, "num": num}
	if opts.Lang != "" {
		body["hl"] = strings.Split(opts.Lang, "-")[0]
	}
	if tbs := googleTBS(opts.Freshness); tbs != "" {
		body["tbs"] = tbs
	}
	payload, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, "POST", "https://google.serper.dev/search", strings.NewReader(string(payload)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-KEY", key)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("serper http %d%s", resp.StatusCode, retryAfterSuffix(resp))
	}
	data, err := ReadBounded(resp.Body, maxAPIBodyBytes)
	if err != nil {
		return nil, fmt.Errorf("serper: read: %w", err)
	}
	return parseSerper(data, opts.MaxResults)
}

// ---------- serpapi ----------

type serpapiResp struct {
	OrganicResults []struct {
		Title   string `json:"title"`
		Link    string `json:"link"`
		Snippet string `json:"snippet"`
		Date    string `json:"date"`
	} `json:"organic_results"`
	OrganicResultsState string `json:"organic_results_state"`
}

func parseSerpapi(data []byte, max int) ([]Reference, error) {
	var d serpapiResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("serpapi: bad json: %w", err)
	}
	// "Fully empty" 是合法空搜索而非协议错误 (magpie-websearch 同判); 但本 lane 契约:
	// 空结果对上层是 no results 错误(与其他 lane 的 no results parsed 一致, 不负缓存)
	var out []Reference
	for _, r := range d.OrganicResults {
		if !strings.HasPrefix(r.Link, "http") {
			continue
		}
		title := r.Title
		if title == "" {
			title = r.Link
		}
		out = append(out, Reference{
			URL: r.Link, Title: clampText(title, 200), Snippet: clampText(r.Snippet, 400),
			Engines: []string{"serpapi"}, Published: r.Date, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("serpapi: no organic results (state=%s)", d.OrganicResultsState)
	}
	return out, nil
}

func laneSerpapi(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	key := strings.TrimSpace(os.Getenv("SERPAPI_API_KEY"))
	if key == "" {
		return nil, fmt.Errorf("serpapi: SERPAPI_API_KEY not set (keyed Google lane; set the env to enable)")
	}
	q := url.Values{}
	q.Set("q", opts.Query)
	q.Set("api_key", key)
	if opts.Lang != "" {
		q.Set("hl", strings.Split(opts.Lang, "-")[0])
	}
	if tbs := googleTBS(opts.Freshness); tbs != "" {
		q.Set("tbs", tbs)
	}
	req, err := http.NewRequestWithContext(ctx, "GET", "https://serpapi.com/search?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", laneUA)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("serpapi http %d%s", resp.StatusCode, retryAfterSuffix(resp))
	}
	data, err := ReadBounded(resp.Body, maxAPIBodyBytes)
	if err != nil {
		return nil, fmt.Errorf("serpapi: read: %w", err)
	}
	return parseSerpapi(data, opts.MaxResults)
}
