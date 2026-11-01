package main

// 独立索引/实验性车道 P2: marginalia(双端点) / wiby / mwmbl(identity) / anysearch / firecrawl / sov2ex

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
)

// ---------- marginalia (api2 主端点 + legacy 回退, 双挂才交健康统计) ----------
type marginaliaResp struct {
	Results []struct {
		URL         string  `json:"url"`
		Title       string  `json:"title"`
		Description string  `json:"description"`
		Quality     float64 `json:"quality"`
	} `json:"results"`
}

func parseMarginalia(data []byte, max int) ([]Reference, error) {
	var d marginaliaResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("marginalia: bad json: %w", err)
	}
	var out []Reference
	for _, r := range d.Results {
		if !strings.HasPrefix(r.URL, "http") {
			continue
		}
		out = append(out, Reference{
			URL: r.URL, Title: clampText(r.Title, 200), Snippet: clampText(r.Description, 400),
			Engines: []string{"marginalia"}, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("marginalia: no results parsed")
	}
	return out, nil
}

func laneMarginalia(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	count := min(opts.MaxResults, 20)
	var lastErr error
	// 主端点 api2(API-Key 头, key 缺省 public)
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api2.marginalia-search.com/search", nil)
	if err == nil {
		q := req.URL.Query()
		q.Set("query", opts.Query)
		q.Set("count", fmt.Sprintf("%d", count))
		q.Set("dc", "3")
		req.URL.RawQuery = q.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		req.Header.Set("API-Key", "public") // SC_MARGINALIA_KEY 覆盖(P4 key 插槽)
		if resp, err := client.Do(req); err == nil {
			if resp.StatusCode == 200 {
				out, perr := parseMarginalia([]byte(readAllString(resp.Body)), opts.MaxResults)
				resp.Body.Close()
				if perr == nil {
					return out, nil
				}
				lastErr = perr
			} else {
				resp.Body.Close()
				lastErr = fmt.Errorf("marginalia http %d", resp.StatusCode)
			}
		} else {
			lastErr = err
		}
	}
	// 回退旧公开端点(同形 JSON, 解析代码不用改; dc 参数旧 API 同名同义)
	req2, err2 := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("https://api.marginalia.nu/public/search/%s?dc=3", urlPathEscape(opts.Query)), nil)
	if err2 != nil {
		return nil, fmt.Errorf("marginalia api2+legacy both failed (api2: %v; legacy: %v)", lastErr, err2)
	}
	req2.Header.Set("User-Agent", laneUA)
	req2.Header.Set("Accept", "application/json")
	resp2, err2 := client.Do(req2)
	if err2 != nil {
		return nil, fmt.Errorf("marginalia api2+legacy both failed (api2: %v; legacy: %v)", lastErr, err2)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != 200 {
		return nil, fmt.Errorf("marginalia api2+legacy both failed (api2: %v; legacy: http %d)", lastErr, resp2.StatusCode)
	}
	out2, perr2 := parseMarginalia([]byte(readAllString(resp2.Body)), opts.MaxResults)
	if perr2 != nil {
		return nil, fmt.Errorf("marginalia api2+legacy both failed (api2: %v; legacy: %v)", lastErr, perr2)
	}
	return out2, nil
}

func urlPathEscape(s string) string { return strings.ReplaceAll(urlQueryEscape(s), "+", "%20") }

// ---------- wiby (古典独立网; Description 是人工真摘要, Snippet 混导航仅兜底) ----------
type wibyItem struct {
	URL         string `json:"URL"`
	Title       string `json:"Title"`
	Snippet     string `json:"Snippet"`
	Description string `json:"Description"`
}

func parseWiby(data []byte, max int) ([]Reference, error) {
	var items []wibyItem
	if err := json.Unmarshal(data, &items); err != nil {
		return nil, fmt.Errorf("wiby: bad json: %w", err)
	}
	var out []Reference
	for _, r := range items {
		if !strings.HasPrefix(r.URL, "http") || r.Title == "" {
			continue
		}
		snippet := r.Description
		if snippet == "" {
			snippet = stripHtml(r.Snippet)
		}
		out = append(out, Reference{
			URL: r.URL, Title: clampText(decodeEntities(r.Title), 200), Snippet: clampText(decodeEntities(snippet), 400),
			Engines: []string{"wiby"}, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("wiby: no results parsed")
	}
	return out, nil
}

func laneWiby(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://wiby.me/json/", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("q", opts.Query)
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("wiby http %d", resp.StatusCode)
	}
	return parseWiby([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- mwmbl (⚠ 参数名是 s, 用 q 得 422(10-a 实测); gzip 流不规范需 identity) ----------
type mwmblItem struct {
	URL   string `json:"url"`
	Title []struct {
		Value  string `json:"value"`
		IsBold bool   `json:"is_bold"`
	} `json:"title"`
	Extract []struct {
		Value  string `json:"value"`
		IsBold bool   `json:"is_bold"`
	} `json:"extract"`
}

func parseMwmbl(data []byte, max int) ([]Reference, error) {
	var items []mwmblItem
	if err := json.Unmarshal(data, &items); err != nil {
		return nil, fmt.Errorf("mwmbl: bad json: %w", err)
	}
	var out []Reference
	for _, r := range items {
		if !strings.HasPrefix(r.URL, "http") {
			continue
		}
		title := ""
		for _, t := range r.Title {
			title += t.Value
		}
		if title == "" {
			continue
		}
		extract := ""
		for _, e := range r.Extract {
			extract += e.Value
		}
		out = append(out, Reference{
			URL: r.URL, Title: clampText(title, 200), Snippet: clampText(extract, 400),
			Engines: []string{"mwmbl"}, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("mwmbl: no results parsed")
	}
	return out, nil
}

func laneMwmbl(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://mwmbl.org/api/v1/search", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("s", opts.Query) // ⚠ 参数名是 s
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Encoding", "identity") // gzip 流不规范
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("mwmbl http %d", resp.StatusCode)
	}
	return parseMwmbl([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- anysearch (POST JSON, code!==0=业务错) ----------
type anysearchResp struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		Results []struct {
			Title   string `json:"title"`
			URL     string `json:"url"`
			Snippet string `json:"snippet"`
			Content string `json:"content"`
		} `json:"results"`
	} `json:"data"`
}

func parseAnysearch(data []byte, max int) ([]Reference, error) {
	var d anysearchResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("anysearch: bad json: %w", err)
	}
	if d.Code != 0 {
		return nil, fmt.Errorf("anysearch code=%d %s", d.Code, d.Message)
	}
	var out []Reference
	for _, r := range d.Data.Results {
		if r.URL == "" {
			continue
		}
		title := r.Title
		if title == "" {
			title = r.URL
		}
		snippet := r.Snippet
		if snippet == "" {
			snippet = r.Content
		}
		out = append(out, Reference{
			URL: r.URL, Title: clampText(title, 200), Snippet: clampText(snippet, 400),
			Engines: []string{"anysearch"}, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("anysearch: no results parsed")
	}
	return out, nil
}

func laneAnysearch(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	body, _ := json.Marshal(map[string]string{"query": opts.Query})
	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.anysearch.com/v1/search", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("anysearch http %d", resp.StatusCode)
	}
	return parseAnysearch([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- firecrawl (keyless 常在; 配 apiKey 自动升级付费车道) ----------
type firecrawlResp struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
	Data    struct {
		Web []struct {
			URL         string `json:"url"`
			Title       string `json:"title"`
			Description string `json:"description"`
		} `json:"web"`
	} `json:"data"`
}

func parseFirecrawl(data []byte, max int) ([]Reference, error) {
	var d firecrawlResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("firecrawl: bad json: %w", err)
	}
	if d.Success == false && d.Error != "" {
		return nil, fmt.Errorf("firecrawl error: %s", d.Error)
	}
	var out []Reference
	for _, r := range d.Data.Web {
		if r.URL == "" {
			continue
		}
		title := r.Title
		if title == "" {
			title = r.URL
		}
		out = append(out, Reference{
			URL: r.URL, Title: clampText(title, 200), Snippet: clampText(r.Description, 400),
			Engines: []string{"firecrawl"}, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("firecrawl: no results parsed")
	}
	return out, nil
}

func laneFirecrawl(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	body, _ := json.Marshal(map[string]any{"query": opts.Query, "limit": min(opts.MaxResults, 20)})
	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.firecrawl.dev/v2/search", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Content-Type", "application/json")
	// Bearer 仅在配了 key 时(FIRECRAWL_API_KEY, P4 key 插槽统一)
	if k := os.Getenv("FIRECRAWL_API_KEY"); k != "" {
		req.Header.Set("Authorization", "Bearer "+k)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("firecrawl http %d", resp.StatusCode)
	}
	return parseFirecrawl([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- sov2ex (V2Ex 站内搜索) ----------
type sov2exResp struct {
	Hits []struct {
		Source struct {
			ID      int    `json:"id"`
			Title   string `json:"title"`
			Content string `json:"content"`
			Created string `json:"created"`
		} `json:"_source"`
	} `json:"hits"`
}

func parseSov2ex(data []byte, max int) ([]Reference, error) {
	var d sov2exResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("sov2ex: bad json: %w", err)
	}
	var out []Reference
	for _, h := range d.Hits {
		s := h.Source
		if s.ID == 0 || s.Title == "" {
			continue
		}
		out = append(out, Reference{
			URL: fmt.Sprintf("https://www.v2ex.com/t/%d", s.ID), Title: clampText(s.Title, 200),
			Snippet: clampText(s.Content, 400), Engines: []string{"sov2ex"},
			Published: s.Created, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("sov2ex: no results parsed")
	}
	return out, nil
}

func laneSov2ex(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://www.sov2ex.com/api/search", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("q", opts.Query)
	q.Set("size", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("sov2ex http %d", resp.StatusCode)
	}
	return parseSov2ex([]byte(readAllString(resp.Body)), opts.MaxResults)
}
