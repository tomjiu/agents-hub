package main

// 开发者生态车道 P2: npm / github / mdn(web affinity 门) / stackexchange

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ---------- npm ----------
type npmResp struct {
	Objects []struct {
		Package struct {
			Name        string `json:"name"`
			Version     string `json:"version"`
			Description string `json:"description"`
			Date        string `json:"date"`
			Links       struct {
				Npm      string `json:"npm"`
				Homepage string `json:"homepage"`
			} `json:"links"`
			Keywords  []string `json:"keywords"`
			Publisher struct {
				Username string `json:"username"`
			} `json:"publisher"`
			Score struct {
				Final  float64 `json:"final"`
				Detail struct {
					Popularity float64 `json:"popularity"`
				} `json:"detail"`
			} `json:"score"`
		} `json:"package"`
	} `json:"objects"`
}

func parseNpm(data []byte, max int) ([]Reference, error) {
	var d npmResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("npm: bad json: %w", err)
	}
	var out []Reference
	for _, o := range d.Objects {
		p := o.Package
		if p.Name == "" {
			continue
		}
		meta := []string{}
		if p.Score.Final != 0 {
			meta = append(meta, fmt.Sprintf("score %.2f", p.Score.Final))
		}
		if p.Score.Detail.Popularity != 0 {
			meta = append(meta, fmt.Sprintf("pop %.0f", p.Score.Detail.Popularity*100))
		}
		if p.Publisher.Username != "" {
			meta = append(meta, "by "+p.Publisher.Username)
		}
		if len(p.Keywords) > 0 {
			kws := p.Keywords
			if len(kws) > 4 {
				kws = kws[:4]
			}
			meta = append(meta, "kw: "+strings.Join(kws, ", "))
		}
		desc := ""
		if p.Description != "" {
			desc = " · " + p.Description
		}
		u := fmt.Sprintf("https://www.npmjs.com/package/%s", p.Name)
		if strings.HasPrefix(p.Links.Npm, "http") {
			u = p.Links.Npm
		}
		out = append(out, Reference{
			URL: u, Title: clampText(p.Name+"@"+p.Version, 200),
			Snippet: clampText("[npm] "+strings.Join(meta, " · ")+desc, 400),
			Engines: []string{"npm"}, Published: p.Date, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("npm: no results parsed")
	}
	return out, nil
}

func laneNpm(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://registry.npmjs.org/-/v1/search", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("text", opts.Query)
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
		return nil, fmt.Errorf("npm http %d", resp.StatusCode)
	}
	return parseNpm([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- github (api.github.com keyless; TS 版此腿不抛空, 空也合法返回) ----------
type githubResp struct {
	Items []struct {
		HTMLURL         string `json:"html_url"`
		FullName        string `json:"full_name"`
		Description     string `json:"description"`
		PushedAt        string `json:"pushed_at"`
		StargazersCount int    `json:"stargazers_count"`
	} `json:"items"`
}

func parseGithub(data []byte, max int) []Reference {
	var d githubResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil
	}
	var out []Reference
	for _, r := range d.Items {
		stars := ""
		if r.StargazersCount > 0 {
			stars = fmt.Sprintf(" (★%d)", r.StargazersCount)
		}
		out = append(out, Reference{
			URL: r.HTMLURL, Title: r.FullName,
			Snippet: clampText(r.Description+stars, 400),
			Engines: []string{"github"}, Published: r.PushedAt, Kind: "github",
		})
		if len(out) >= max {
			break
		}
	}
	return out
}

func laneGithub(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/search/repositories", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("q", opts.Query)
	q.Set("per_page", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	q.Set("sort", "best-match")
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("github http %d", resp.StatusCode)
	}
	return parseGithub([]byte(readAllString(resp.Body)), opts.MaxResults), nil
}

// ---------- mdn (web affinity 门: 无关题面返回空数组不抛错, TS 同款) ----------
var webAffinitySubstr = []string{
	"css", "html", "javascript", "typescript", "browser", "浏览器", "网页", "前端",
	"fetch", "http", "websocket", "canvas", "svg", "node", "react", "vue", "angular", "svelte", "xhr", "ajax",
}
var webAffinityWord = regexp.MustCompile(`\b(js|ts|web|dom)\b`)

func hasWebAffinity(query string) bool {
	low := strings.ToLower(query)
	for _, t := range webAffinitySubstr {
		if strings.Contains(low, t) {
			return true
		}
	}
	return webAffinityWord.MatchString(low)
}

type mdnResp struct {
	Documents []struct {
		Title   string `json:"title"`
		MdnURL  string `json:"mdn_url"`
		Summary string `json:"summary"`
	} `json:"documents"`
}

func parseMdn(data []byte, max int) ([]Reference, error) {
	var d mdnResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("mdn: bad json: %w", err)
	}
	var out []Reference
	for _, doc := range d.Documents {
		if doc.MdnURL == "" || doc.Title == "" {
			continue
		}
		out = append(out, Reference{
			URL: "https://developer.mozilla.org" + doc.MdnURL, Title: clampText(doc.Title, 200),
			Snippet: clampText(doc.Summary, 400), Engines: []string{"mdn"}, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneMdn(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	if !hasWebAffinity(opts.Query) {
		return []Reference{}, nil
	}
	locale := "en-US"
	if opts.Lang != "" && strings.Split(strings.ToLower(opts.Lang), "-")[0] == "zh" {
		locale = "zh-CN"
	}
	req, err := http.NewRequestWithContext(ctx, "GET", "https://developer.mozilla.org/api/v1/search", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("q", opts.Query)
	q.Set("locale", locale)
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("mdn http %d", resp.StatusCode)
	}
	data := readAllString(resp.Body)
	var probe mdnResp
	if err := json.Unmarshal([]byte(data), &probe); err != nil {
		return nil, fmt.Errorf("mdn: no documents field parsed (api drift?)")
	}
	return parseMdn([]byte(data), opts.MaxResults)
}

// ---------- stackexchange (api 常强制 gzip, Go transport 自动处理) ----------
type stackexchangeResp struct {
	Items []struct {
		Title            string   `json:"title"`
		Link             string   `json:"link"`
		Score            int      `json:"score"`
		AnswerCount      int      `json:"answer_count"`
		IsAnswered       bool     `json:"is_answered"`
		Tags             []string `json:"tags"`
		LastActivityDate int64    `json:"last_activity_date"`
	} `json:"items"`
}

func parseStackexchange(data []byte, max int) ([]Reference, error) {
	var d stackexchangeResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("stackexchange: bad json: %w", err)
	}
	var out []Reference
	for _, it := range d.Items {
		if !strings.HasPrefix(it.Link, "http") || it.Title == "" {
			continue
		}
		ans := "open"
		if it.IsAnswered {
			ans = "answered ✓"
		}
		meta := []string{ans}
		if it.Score != 0 {
			meta = append(meta, fmt.Sprintf("%d score", it.Score))
		}
		if it.AnswerCount != 0 {
			meta = append(meta, fmt.Sprintf("%d answers", it.AnswerCount))
		}
		if len(it.Tags) > 0 {
			tags := it.Tags
			if len(tags) > 4 {
				tags = tags[:4]
			}
			meta = append(meta, "tags: "+strings.Join(tags, ", "))
		}
		published := ""
		if it.LastActivityDate > 0 {
			published = time.Unix(it.LastActivityDate, 0).UTC().Format("2006-01-02T15:04:05Z")
		}
		out = append(out, Reference{
			URL: it.Link, Title: clampText(decodeEntities(it.Title), 200),
			Snippet: clampText("[SO] "+strings.Join(meta, " · "), 400),
			Engines: []string{"stackexchange"}, Published: published, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("stackexchange: no results parsed")
	}
	return out, nil
}

func laneStackexchange(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.stackexchange.com/2.3/search/advanced", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("order", "desc")
	q.Set("sort", "relevance")
	q.Set("q", opts.Query)
	q.Set("site", "stackoverflow")
	q.Set("pagesize", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	if k := os.Getenv("SC_STACKEXCHANGE_KEY"); k != "" {
		q.Set("key", k)
	}
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("stackexchange http %d", resp.StatusCode)
	}
	return parseStackexchange([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- phase AL: aur / flathub ----------

// aurSignalRe AUR 信号守卫: 显式 Arch 生态词才进线 — RPC type=search 是包名子串匹配,
// 自然语言句打上去全是噪音(pypi 名直取纪律的守卫变体)。
var aurSignalRe = regexp.MustCompile(`(?:^|[^\p{L}])(aur|pacman|yay|arch)(?:[^\p{L}]|$)`)

// laneAur AUR(Arch User Repository) RPC v5: /rpc/?v=5&type=search&arg={锚}。
// phase AL 探针: search-core UA→Anubis 挑战页; 浏览器 UA→200 JSON 945ms(laneUABrowser override)。
// 形状: {resultcount, results[]{Name,Description,Version,NumVotes}}; resultcount=0 合法空。
func laneAur(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	low := strings.ToLower(opts.Query)
	if !aurSignalRe.MatchString(low) {
		return []Reference{}, nil // 无 Arch 生态信号合法空零请求
	}
	anchor := extractProjectAnchor(opts.Query)
	if anchor == "" {
		return []Reference{}, nil
	}
	u := "https://aur.archlinux.org/rpc/?v=5&type=search&arg=" + url.QueryEscape(anchor)
	req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
	req.Header.Set("User-Agent", laneUABrowser)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("aur http %d", resp.StatusCode)
	}
	// Anubis 挑战页识别(实弹抓获: 200 + HTML 而非 JSON) — 显式报错交熔断, 不当真结果
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	trimmed := strings.TrimSpace(string(body))
	if strings.HasPrefix(trimmed, "<") {
		return nil, fmt.Errorf("aur anubis challenge page")
	}
	var d struct {
		ResultCount int `json:"resultcount"`
		Results     []struct {
			Name        string `json:"Name"`
			Description string `json:"Description"`
			Version     string `json:"Version"`
			NumVotes    int    `json:"NumVotes"`
		} `json:"results"`
	}
	if err := json.Unmarshal([]byte(trimmed), &d); err != nil {
		return nil, err
	}
	return parseAur(d), nil
}

func parseAur(d struct {
	ResultCount int `json:"resultcount"`
	Results     []struct {
		Name        string `json:"Name"`
		Description string `json:"Description"`
		Version     string `json:"Version"`
		NumVotes    int    `json:"NumVotes"`
	} `json:"results"`
}) []Reference {
	out := make([]Reference, 0, len(d.Results))
	for i, r := range d.Results {
		if i >= 8 {
			break
		}
		if r.Name == "" {
			continue
		}
		snip := r.Description
		if r.NumVotes > 0 {
			snip += " · " + strconv.Itoa(r.NumVotes) + " votes"
		}
		out = append(out, Reference{
			URL:       "https://aur.archlinux.org/packages/" + r.Name,
			Title:     r.Name + " " + r.Version,
			Snippet:   snip,
			Engines:   []string{"aur"},
			Authority: "aur.archlinux.org",
			Kind:      "devops",
		})
	}
	return out
}

// laneFlathub Linux 应用商店(Flathub, Meilisearch 后端): POST /api/v2/search {"query": q}。
// phase AL 探针: 200 812ms(注意 body 键是 query 不是 search, 422 已踩), {hits[]{app_id,name,summary}}。
func laneFlathub(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	body, _ := json.Marshal(map[string]any{"query": opts.Query, "hitsPerPage": 8})
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://flathub.org/api/v2/search", strings.NewReader(string(body)))
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("flathub http %d", resp.StatusCode)
	}
	var d struct {
		Hits []struct {
			AppID   string `json:"app_id"`
			Name    string `json:"name"`
			Summary string `json:"summary"`
		} `json:"hits"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&d); err != nil {
		return nil, err
	}
	return parseFlathub(d), nil
}

func parseFlathub(d struct {
	Hits []struct {
		AppID   string `json:"app_id"`
		Name    string `json:"name"`
		Summary string `json:"summary"`
	} `json:"hits"`
}) []Reference {
	out := make([]Reference, 0, len(d.Hits))
	for _, h := range d.Hits {
		if h.AppID == "" {
			continue
		}
		out = append(out, Reference{
			URL:       "https://flathub.org/apps/" + h.AppID,
			Title:     h.Name,
			Snippet:   h.Summary,
			Engines:   []string{"flathub"},
			Authority: "flathub.org",
			Kind:      "devops",
		})
		if len(out) >= 8 {
			break
		}
	}
	return out
}
