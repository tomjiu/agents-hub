package main

// HTML 解析车道 P2: duckduckgo(三件套) / mojeek / yahoo
// 选择器逐字对齐 TS(cheerio→goquery 1:1); markup 漂移抛错交健康统计, 不静默返空。

import (
	"context"
	"fmt"
	"math/rand"
	"net/http"
	"net/url"
	"strconv"
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

// ddgPageState: 分页/会话令牌的显式状态 (G2, issue #3 评论):
// 来自响应中下一页表单的隐藏字段 (s=偏移, dc=请求计数等)。
// 缺失/过期 → 停止翻页且如实报告, 不误判为"无结果"。
type ddgPageState struct {
	form url.Values // 下一页需要回传的完整表单字段
}

// parseDdgNextPage: 从响应 HTML 提取下一页表单状态 (nav 表单的隐藏 input)。
// 无下一页表单→ nil (合法尾页, 非错误)。
func parseDdgNextPage(html string) *ddgPageState {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil
	}
	// 下一页入口: .nav-link 含式表单 (历史版本为 a.result-link 的 GET 参数);
	// 两种形态都提取 s/dc 等字段, 缺 s 视为无下一页。
	form := url.Values{}
	found := false
	doc.Find("form input[type=hidden]").Each(func(_ int, el *goquery.Selection) {
		name, _ := el.Attr("name")
		val, _ := el.Attr("value")
		if name == "" {
			return
		}
		form.Set(name, val)
		found = true
	})
	if !found || form.Get("s") == "" {
		return nil
	}
	return &ddgPageState{form: form}
}

// buildDdgForm: 构造请求表单 (第一页 vs 后续页结合会话状态) — 纯函数, 协议形犲可测
func buildDdgForm(opts SearchOpts, next *ddgPageState) url.Values {
	if next != nil {
		// 会话延续: 回传上一页给的字段并替换查询本身
		form := url.Values{}
		for k, vs := range next.form {
			form[k] = append([]string{}, vs...)
		}
		form.Set("q", opts.Query)
		if opts.Lang != "" {
			form.Set("kl", opts.Lang)
		}
		if df := ddgFreshness(opts.Freshness); df != "" {
			form.Set("df", df)
		} else {
			form.Del("df")
		}
		return form
	}
	return url.Values{
		"q":  {opts.Query},
		"b":  {""},
		"kl": {opts.Lang},
		"df": {ddgFreshness(opts.Freshness)},
	}
}

func ddgAttempt(ctx context.Context, client *http.Client, opts SearchOpts, next *ddgPageState) ([]Reference, string, *ddgPageState, error) {
	ddgGate()
	form := buildDdgForm(opts, next)
	req, err := http.NewRequestWithContext(ctx, "POST", "https://html.duckduckgo.com/html/", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, "", nil, err
	}
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "text/html")
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 202 {
		// 软封签名: 202+空页伪装"无结果"; 走重试/健康统计, 绝不当真结果返回
		return nil, "", nil, nil
	}
	if resp.StatusCode != 200 {
		return nil, "", nil, fmt.Errorf("ddg http %d", resp.StatusCode)
	}
	body := readAllString(resp.Body)
	return parseDdgHTML(body, opts.MaxResults), body, parseDdgNextPage(body), nil
}

// ddgMaxPages: 分页上限 (有界预算, 防翻页风暴; 默认 2 页)
func ddgMaxPages() int {
	if v := strings.TrimSpace(getenvDefault("SC_DDG_MAX_PAGES", "2")); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p >= 1 && p <= 5 {
			return p
		}
	}
	return 2
}

func laneDuckduckgo(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	var all []Reference
	nextPage := (*ddgPageState)(nil) // 第一页: 无会话状态
	maxPages := ddgMaxPages()
	for page := 0; page < maxPages; page++ {
		refs, html, next, err := ddgAttempt(ctx, client, opts, nextPage)
		if err != nil {
			return nil, err
		}
		if len(refs) == 0 && page == 0 {
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
			refs, html, next, err = ddgAttempt(ctx, client, opts, nextPage)
			if err != nil {
				return nil, err
			}
		}
		if len(refs) == 0 && len(all) == 0 && !strings.Contains(html, "result") {
			return nil, fmt.Errorf("ddg: no results parsed (markup drift or soft-block?)")
		}
		all = append(all, refs...)
		if len(all) >= opts.MaxResults || next == nil {
			break // 预算已满 或 无下一页会话状态 (合法尾页)
		}
		nextPage = next
	}
	if len(all) > opts.MaxResults {
		all = all[:opts.MaxResults]
	}
	return all, nil
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
	body := readAllString(resp.Body)
	// G2: 欧盟同意墙检测 — consent 页不是"无结果", 显式归类 blocked 不重试,
	// 不自动解 cookie/点击同意 (扩大采集权限需用户授权)
	if isYahooConsentPage(resp, body) {
		return nil, fmt.Errorf("yahoo consent page (EU consent wall, not search results)")
	}
	out := parseYahooHTML(body, opts.MaxResults)
	if len(out) == 0 {
		return nil, fmt.Errorf("yahoo: no results parsed (markup drift?)")
	}
	return out, nil
}

// isYahooConsentPage: 同意墙签名 — 重定向到 consent.yahoo.com 或页面含 consent 表单
func isYahooConsentPage(resp *http.Response, body string) bool {
	if resp != nil && resp.Request != nil && resp.Request.URL != nil {
		if strings.Contains(resp.Request.URL.Host, "consent.") {
			return true
		}
	}
	if strings.Contains(body, "consent.yahoo.com") {
		return true
	}
	// GDPR 同意弹窗标记 (空页即无结果页面同时含两个标记才判 consent, 防误报)
	return strings.Contains(body, "gppd") && strings.Contains(body, "consent")
}
