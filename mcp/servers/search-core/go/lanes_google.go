package main

// Google 直连车道 (主流引擎补全, 2026-11-25 实弹探针批):
// 直连 https://www.google.com/search 抓 HTML 并转成可读 Reference — 用户口径
// "直接访问域名的方式然后转成可读格式"。
//
// 实弹定论 (probe 2026-11-25, HK 数据中心出口 IP):
//  1. curl 直连 (全 UA 矩阵: Chrome/Firefox/Edge/Lynx/Android/iPhone × gbv/lite/
//     udm14/client=firefox-b-d/CONSENT cookie/HTTP1.1): 一律 47KB JS 壳页
//     (meta-refresh → enablejs?sei=...), 正文零结果。
//  2. 真 Chromium (Playwright 1.57 headless) 渲染: JS 挑战页自动跳 /sorry/index
//     ("your computer may be sending automated queries") — IP 信誉墙, 浏览器级
//     指纹也过不去, 本沙箱出口不可用。
//  3. 结论: 本车道在"干净 IP"环境 (用户本机/住宅出口) 下可用, 在被标记出口上
//     以诚实错误归类 blocked (enablejs/sorry 壳页签名), 不静默返空、不自动解题 —
//     对齐 Yahoo consent-wall 的授权边界纪律。Google 内容在墙内仍可经 googlenews
//     (RSS, 实弹可用) 覆盖新闻意图。
//  4. 解析契约: 服务端渲染 SERP 的 div#search 容器内 h3+a[href] 结果块;
//     /url?q= 跳转解码; "Sponsored" 赞助块过滤 (广告标识, 用户口径)。
//     墙检测样本取自实弹 g-plain.html; 成功路径样本为按公开标记结构构造的最小
//     SERP (干净 IP 实弹不可得, 样本来源差异在此如实注记)。

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"
)

// googleBrowserUA: Google 对 bot UA 直接 403/壳页; 浏览器 UA 是直连前提
const googleBrowserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

// googleIsWallPage: 实弹墙页签名 (2026-11-25, g-plain.html/g-pw.html 归档):
//  1. meta-refresh → enablejs?sei=... (JS 壳页, curl 路径)
//  2. /sorry/ 路径 (真浏览器渲染路径的自动化查询墙)
//  3. "Update your browser" 弃用浏览器页 (Lynx/老 UA 路径)
func googleIsWallPage(html string) bool {
	return strings.Contains(html, "enablejs") ||
		strings.Contains(html, "/sorry/") ||
		strings.Contains(html, "Update your browser")
}

// decodeGoogleHref: /url?q=<target>&... 跳转壳 → 真实 URL; 直接外链原样返回;
// google 内部路径 (books/news/maps/support...) 返回 "" (不是搜索结果目标)。
func decodeGoogleHref(href string) string {
	if href == "" {
		return ""
	}
	if strings.HasPrefix(href, "/url") {
		if u, err := url.Parse(href); err == nil {
			if target := u.Query().Get("q"); strings.HasPrefix(target, "http") {
				return target
			}
		}
		return ""
	}
	if strings.HasPrefix(href, "http") && !googleInternalHost(href) {
		return href
	}
	return ""
}

// googleInternalHost: google 自家域 (books/news/maps/support/各国 TLD) 判据 —
// 域名级匹配 (host == google.* 或 *.google.*), 防子串误伤 (如 notgoogle.com)。
func googleInternalHost(href string) bool {
	u, err := url.Parse(href)
	if err != nil {
		return false
	}
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	return host == "google.com" || strings.HasPrefix(host, "google.") ||
		strings.HasSuffix(host, ".google.com") || strings.Contains(host, ".google.")
}

// parseGoogleHTML: Google SERP → Reference (纯函数, 黄金样本可测)。
// 选择器: div#search 下 div.g / div[data-snhf] / div.MjjYud 结果块 (三代标记
// 并存); 每块取 h3 标题 + 主链接 + .VwiC3b 摘要; Sponsored 赞助块整体跳过。
func parseGoogleHTML(html string, max int) []Reference {
	if googleIsWallPage(html) {
		return nil // 墙页不是"无结果", 调用方负责归类
	}
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil
	}
	var out []Reference
	seen := map[string]bool{}
	root := doc.Find("div#search")
	if root.Length() == 0 {
		root = doc.Find("div#rso")
	}
	if root.Length() == 0 {
		return nil
	}
	root.Find("div.g, div[data-snhf], div.MjjYud").Each(func(_ int, el *goquery.Selection) {
		// 赞助块 (广告): Sponsored 徽标 / uEierd 赞助容器 — 全跳过
		if el.Find("span:contains('Sponsored')").Length() > 0 || el.HasClass("uEierd") {
			return
		}
		h := el.Find("h3").First()
		a := el.Find("a[href]").First()
		if h.Length() == 0 || a.Length() == 0 {
			return
		}
		href, _ := a.Attr("href")
		u := decodeGoogleHref(href)
		if u == "" || seen[u] {
			return
		}
		seen[u] = true
		snippet := strings.TrimSpace(el.Find("div.VwiC3b, div[data-sncf], div.IsZvec").First().Text())
		out = append(out, Reference{
			URL: u, Title: clampText(h.Text(), 200), Snippet: clampText(snippet, 400),
			Engines: []string{"google"}, Kind: "web",
		})
		if len(out) >= max {
			return
		}
	})
	return out
}

// ---------- Google 限速门 (ddgGate 同款结构; Google 封禁累积, 默认 3s) ----------
var (
	googleGateMu  sync.Mutex
	googleLastAt  time.Time
	googleGateJit = func() time.Duration { return time.Duration(time.Now().UnixNano()%250) * time.Millisecond }
)

func googleMinIntervalMs() int {
	if v := os.Getenv("SC_GOOGLE_MIN_INTERVAL_MS"); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil && n >= 0 {
			return n
		}
	}
	return 3000
}

func googleGate() {
	googleGateMu.Lock()
	defer googleGateMu.Unlock()
	wait := googleLastAt.Add(time.Duration(googleMinIntervalMs()) * time.Millisecond).Sub(time.Now())
	if wait > 0 {
		time.Sleep(wait + googleGateJit())
	}
	googleLastAt = time.Now()
}

// laneGoogle: 直连域名 + 可读格式转换; 墙页/空结果如实抛错交健康统计。
func laneGoogle(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	googleGate()
	req, err := http.NewRequestWithContext(ctx, "GET", "https://www.google.com/search", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("q", opts.Query)
	q.Set("num", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	q.Set("hl", "en")
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", googleBrowserUA)
	req.Header.Set("Accept", "text/html")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("google http %d%s", resp.StatusCode, retryAfterSuffix(resp))
	}
	body := readAllString(resp.Body)
	if googleIsWallPage(body) {
		return nil, fmt.Errorf("google: blocked (IP-reputation wall: enablejs/sorry shell page)")
	}
	out := parseGoogleHTML(body, opts.MaxResults)
	if len(out) == 0 {
		return nil, fmt.Errorf("google: no results parsed (markup drift or blocked?)")
	}
	return out, nil
}
