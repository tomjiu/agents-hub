package main

// 新闻/社区/图片车道 P2: bingnews(可解码跳转) / googlenews(不可解码跳转) / hn / openverse
// 空结果纪律: bingnews 有效 RSS 零 item = 合法空; hn/openverse 空抛错/返空的差异逐字对齐 TS。

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// ---------- bingnews (item link 是 apiclick 跳转, 内嵌 url= 参数可解码真实出版方链接) ----------
type bingNewsDoc struct {
	XMLName xml.Name `xml:"rss"`
	Channel struct {
		Items []rssItem `xml:"item"`
	} `xml:"channel"`
}

var apiclickURLRe = regexp.MustCompile(`[?&]url=([^&]+)`)

func parseBingNews(xmlData []byte, max int) ([]Reference, error) {
	if !strings.Contains(string(xmlData), "<rss") && !strings.Contains(string(xmlData), "<channel") {
		return nil, fmt.Errorf("bingnews: markup drift (blocked or non-RSS)")
	}
	var doc bingNewsDoc
	if err := xml.Unmarshal(xmlData, &doc); err != nil {
		return nil, fmt.Errorf("bingnews: parse: %w", err)
	}
	var out []Reference
	for _, it := range doc.Channel.Items {
		if !strings.HasPrefix(it.Link, "http") || it.Title == "" {
			continue
		}
		u := it.Link
		if m := apiclickURLRe.FindStringSubmatch(it.Link); m != nil {
			if real, err := url.QueryUnescape(m[1]); err == nil && strings.HasPrefix(real, "http") {
				u = real
			}
		}
		out = append(out, Reference{
			URL: u, Title: clampText(it.Title, 200), Snippet: clampText(it.Description, 400),
			Engines: []string{"bing-news"}, Kind: "news",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil // 有效 RSS 零 item = 合法空(TS 同款)
}

func laneBingnews(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://www.bing.com/news/search", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("q", opts.Query)
	q.Set("format", "RSS")
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/rss+xml, application/xml, text/xml")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("bingnews http %d", resp.StatusCode)
	}
	return parseBingNews([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- googlenews (hl/gl/ceid 主语言码路由; 跳转不可解码, link 保原样) ----------
func laneGooglenews(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	primary := "en"
	if opts.Lang != "" {
		if p := strings.Split(strings.ToLower(opts.Lang), "-")[0]; p != "" {
			primary = p
		}
	}
	hl, gl, ceid := "en-US", "US", "US:en"
	switch primary {
	case "zh":
		hl, gl, ceid = "zh-CN", "CN", "CN:zh-Hans"
	case "en":
		// 默认值
	default:
		hl, gl, ceid = primary, strings.ToUpper(primary), fmt.Sprintf("%s:%s", strings.ToUpper(primary), primary)
	}
	req, err := http.NewRequestWithContext(ctx, "GET", "https://news.google.com/rss/search", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("q", opts.Query) // when:1d / site: 运算符可直接拼在 query 里(10-a 实测)
	q.Set("hl", hl)
	q.Set("gl", gl)
	q.Set("ceid", ceid)
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/rss+xml, application/xml, text/xml")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("googlenews http %d", resp.StatusCode)
	}
	xmlData := readAllString(resp.Body)
	// 根守卫在 parseRssItems 内(与 TS googlenews 外置 guard 语义等价: 非 RSS=漂移抛错)
	out, err := parseRssItems([]byte(xmlData), opts.MaxResults)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Kind = "news"
	}
	return out, nil
}

// ---------- hn (Algolia API) ----------
type hnResp struct {
	Hits []struct {
		Title       string  `json:"title"`
		URL         *string `json:"url"`
		ObjectID    string  `json:"objectID"`
		Points      *int    `json:"points"`
		NumComments *int    `json:"num_comments"`
		Author      string  `json:"author"`
		CreatedAt   string  `json:"created_at"`
	} `json:"hits"`
}

func parseHN(data []byte, max int) ([]Reference, error) {
	var d hnResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("hn: bad json: %w", err)
	}
	var out []Reference
	for _, h := range d.Hits {
		u := fmt.Sprintf("https://news.ycombinator.com/item?id=%s", h.ObjectID)
		if h.URL != nil && strings.HasPrefix(*h.URL, "http") {
			u = *h.URL
		}
		stat := []string{}
		if h.Points != nil {
			stat = append(stat, fmt.Sprintf("%d pts", *h.Points))
		}
		if h.NumComments != nil {
			stat = append(stat, fmt.Sprintf("%d comments", *h.NumComments))
		}
		if h.Author != "" {
			stat = append(stat, "by "+h.Author)
		}
		title := h.Title
		if title == "" {
			title = "(untitled)"
		}
		out = append(out, Reference{
			URL: u, Title: clampText(title, 200),
			Snippet: clampText("[HN] "+strings.Join(stat, " · "), 400),
			Engines: []string{"hn"}, Published: h.CreatedAt, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("hn: no results parsed")
	}
	return out, nil
}

func laneHN(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://hn.algolia.com/api/v1/search", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("query", opts.Query)
	q.Set("tags", "story")
	q.Set("hitsPerPage", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("hn http %d", resp.StatusCode)
	}
	return parseHN([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- openverse (CC 图片, kind:image; 空=合法空返 []) ----------
type openverseResp struct {
	Results []struct {
		URL               string `json:"url"`
		Title             string `json:"title"`
		ForeignLandingURL string `json:"foreign_landing_url"`
		License           string `json:"license"`
		LicenseVersion    string `json:"license_version"`
		Provider          string `json:"provider"`
		Creator           string `json:"creator"`
	} `json:"results"`
}

func parseOpenverse(data []byte, max int) []Reference {
	var d openverseResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil
	}
	var out []Reference
	for _, r := range d.Results {
		if !strings.HasPrefix(r.URL, "http") {
			continue
		}
		title := r.Title
		if title == "" {
			title = "untitled image"
		}
		lic := strings.ToUpper(r.License)
		snippet := fmt.Sprintf("[image] %s · CC-%s", r.ForeignLandingURL, lic)
		if r.LicenseVersion != "" {
			snippet += " " + r.LicenseVersion
		}
		if r.Provider != "" {
			snippet += " · " + r.Provider
		}
		if r.Creator != "" {
			snippet += " by " + r.Creator
		}
		out = append(out, Reference{
			URL: r.URL, Title: clampText(title, 200), Snippet: clampText(snippet, 400),
			Engines: []string{"openverse"}, Kind: "image",
		})
		if len(out) >= max {
			break
		}
	}
	return out
}

func laneOpenverse(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.openverse.org/v1/images/", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("q", opts.Query)
	q.Set("page_size", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("openverse http %d", resp.StatusCode)
	}
	return parseOpenverse([]byte(readAllString(resp.Body)), opts.MaxResults), nil
}
