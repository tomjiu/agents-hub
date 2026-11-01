package main

// HTML 解析车道 P2: duckduckgo(三件套) / mojeek / yahoo
// 选择器逐字对齐 TS(cheerio→goquery 1:1); markup 漂移抛错交健康统计, 不静默返空。

import (
	"context"
	"fmt"
	"math/rand"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

// ---------- duckduckgo(反爬三件套: 限速门 + 202 软封检测 + 空结果退避重试) ----------
func decodeDdgHref(href string) string {
	if href == "" {
		return ""
	}
	h := absoluteUrl("https://duckduckgo.com", href)
	if strings.Contains(h, "/l/?") {
		if u, err := url.Parse(h); err == nil {
			if target := u.Query().Get("uddg"); target != "" {
				return target
			}
		}
	}
	if strings.HasPrefix(h, "http") {
		return h
	}
	return ""
}

func parseDdgHTML(html string, max int) []Reference {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil
	}
	var out []Reference
	doc.Find(".result, .web-result").Each(func(_ int, el *goquery.Selection) {
		a := el.Find("a.result__a").First()
		href, _ := a.Attr("href")
		u := decodeDdgHref(href)
		if u == "" {
			return
		}
		snippet := el.Find(".result__snippet").First().Text()
		out = append(out, Reference{
			URL: u, Title: clampText(a.Text(), 200), Snippet: clampText(snippet, 400),
			Engines: []string{"duckduckgo"}, Kind: "web",
		})
		if len(out) >= max {
			return
		}
	})
	return out
}

func ddgAttempt(ctx context.Context, client *http.Client, opts SearchOpts) ([]Reference, string, error) {
	ddgGate()
	form := url.Values{
		"q":  {opts.Query},
		"b":  {""},
		"kl": {opts.Lang},
		"df": {ddgFreshness(opts.Freshness)},
	}
	req, err := http.NewRequestWithContext(ctx, "POST", "https://html.duckduckgo.com/html/", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "text/html")
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 202 {
		// 软封签名: 202+空页伪装"无结果"; 走重试/健康统计, 绝不当真结果返回
		return nil, "", nil
	}
	if resp.StatusCode != 200 {
		return nil, "", fmt.Errorf("ddg http %d", resp.StatusCode)
	}
	body := readAllString(resp.Body)
	return parseDdgHTML(body, opts.MaxResults), body, nil
}

func laneDuckduckgo(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	refs, html, err := ddgAttempt(ctx, client, opts)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		// 空结果/202 = 限速信号(10-c: 单次退避重试, 再挂交熔断); gate 关闭时跳过真实等待
		backoff := time.Duration(0)
		if ddgMinIntervalMs() > 0 {
			backoff = time.Duration(1200+rand.Intn(800)) * time.Millisecond
			t := time.Now().Add(backoff)
			select {
			case <-time.After(time.Until(t)):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		refs, html, err = ddgAttempt(ctx, client, opts)
		if err != nil {
			return nil, err
		}
	}
	if len(refs) == 0 && !strings.Contains(html, "result") {
		return nil, fmt.Errorf("ddg: no results parsed (markup drift or soft-block?)")
	}
	if len(refs) > opts.MaxResults {
		refs = refs[:opts.MaxResults]
	}
	return refs, nil
}

// ---------- mojeek ----------
func parseMojeekHTML(html string, max int) []Reference {
	doc, _ := goquery.NewDocumentFromReader(strings.NewReader(html))
	var out []Reference
	doc.Find("ul.results-standard li, li.result").Each(func(_ int, el *goquery.Selection) {
		a := el.Find("a.title, h2 a").First()
		u, _ := a.Attr("href")
		if !strings.HasPrefix(u, "http") {
			return
		}
		out = append(out, Reference{
			URL: u, Title: clampText(a.Text(), 200),
			Snippet: clampText(el.Find("p.s, p.sc").First().Text(), 400),
			Engines: []string{"mojeek"}, Kind: "web",
		})
		if len(out) >= max {
			return
		}
	})
	return out
}

func laneMojeek(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://www.mojeek.com/search", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("q", opts.Query)
	if opts.Lang != "" {
		q.Set("lang", opts.Lang)
	}
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "text/html")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("mojeek http %d", resp.StatusCode)
	}
	out := parseMojeekHTML(readAllString(resp.Body), opts.MaxResults)
	if len(out) == 0 {
		return nil, fmt.Errorf("mojeek: no results parsed (markup drift?)")
	}
	return out, nil
}

// ---------- yahoo ----------
func decodeYahooHref(href string) string {
	if href == "" {
		return ""
	}
	if strings.HasPrefix(href, "http") && !strings.Contains(href, "r.search.yahoo.com") {
		return href
	}
	// /RU=([^/]+)/ 内嵌 base64/url 编码真实链接
	if i := strings.Index(href, "/RU="); i >= 0 {
		rest := href[i+4:]
		if j := strings.Index(rest, "/"); j >= 0 {
			if dec, err := url.QueryUnescape(rest[:j]); err == nil && strings.HasPrefix(dec, "http") {
				return dec
			}
		}
	}
	return ""
}

func parseYahooHTML(html string, max int) []Reference {
	doc, _ := goquery.NewDocumentFromReader(strings.NewReader(html))
	var out []Reference
	seen := map[string]bool{}
	doc.Find("div#web ol li div.compTitle, li div.compTitle").Each(func(_ int, el *goquery.Selection) {
		a := el.Find("a").First()
		href, _ := a.Attr("href")
		u := decodeYahooHref(href)
		if u == "" || seen[u] {
			return
		}
		seen[u] = true
		cap := el.Closest("li").Find("div.compText, p").First().Text()
		out = append(out, Reference{
			URL: u, Title: clampText(a.Text(), 200), Snippet: clampText(cap, 400),
			Engines: []string{"yahoo"}, Kind: "web",
		})
		if len(out) >= max {
			return
		}
	})
	return out
}

func laneYahoo(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://search.yahoo.com/search", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("p", opts.Query)
	q.Set("n", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "text/html")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("yahoo http %d", resp.StatusCode)
	}
	out := parseYahooHTML(readAllString(resp.Body), opts.MaxResults)
	if len(out) == 0 {
		return nil, fmt.Errorf("yahoo: no results parsed (markup drift?)")
	}
	return out, nil
}
