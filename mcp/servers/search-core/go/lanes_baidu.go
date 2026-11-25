package main

// 百度移动端车道 (中文搜索主力补全, 2026-11-25 实弹探针批):
// 直连 https://m.baidu.com/s?word=... 抓 SERP 并转成可读 Reference。
//
// 实弹定论 (probe 2026-11-25, HK 出口 IP):
//  1. 桌面端 www.baidu.com/s 直连 → "百度安全验证" JS 挑战页 (referer/cookie/BaiduSpider
//     UA 全试过, 均墙); 移动端 m.baidu.com/s 首请求返回真 SERP (400KB, 10 结果块)。
//  2. 连续请求很快触发图形验证码 (302 → wappass.baidu.com/static/captcha/): 本车道
//     如实归类 blocked, 不自动解题 (对齐 Yahoo consent-wall 的授权边界纪律), 并以
//     进程级限速门 (SC_BAIDU_MIN_INTERVAL_MS, 默认 5000ms) 降低触发面。
//  3. 结果块: div.c-result + data-log JSON 的 mu 字段 = 真实目标 URL (绕过
//     m.baidu.com/from=... 跳转壳); 标题 h3.cosc-title; 摘要在 <!--s-data:--> 注释
//     的 summaryData.generalLines[].data[].text (SSR 数据, 客户端渲染源)。
//  4. 广告过滤 (用户口径"这种一般有标识"): mu 命中 baidu.php/eclick 跳转壳、块内
//     ec-tuiguang/baidu-tuiguang 广告标 class、独立"广告"文本徽标 — 三把尺全过滤;
//     recommend_list 等运营位组件按 srcid 摘除。

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

// baiduMobileUA: 移动端 SERP 才有稳定的 SSR 结构 (桌面端直接给验证页)
const baiduMobileUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"

var (
	baiduResultTagRe = regexp.MustCompile(`(?s)<div[^>]*class="c-result result"[^>]*>`)
	baiduDataLogRe   = regexp.MustCompile(`data-log='([^']*)'`)
	baiduH3Re        = regexp.MustCompile(`(?s)<h3[^>]*>(.*?)</h3>`)
	baiduSDataRe     = regexp.MustCompile(`(?s)<!--s-data:(\{"summaryData".*?)-->`)
	baiduTagRe       = regexp.MustCompile(`<[^>]+>`)
	// 广告标识: ec-tuiguang/baidu-tuiguang 标签 class + 独立“广告”文本节点徽标
	// (>广告< 整节点匹配, 防误伤摘要里正常讨论广告业务的词面)
	baiduAdLabelRe  = regexp.MustCompile(`ec-tuiguang|baidu-tuiguang|>\s*广告\s*<`)
	baiduWidgetMuRe = regexp.MustCompile(`recommend_list\.baidu\.com|note_lead\.baidu\.com`)
)

// baiduIsAdMu: 广告跳转壳判据 (百度经典广告走 baidu.php / eclick 中转)
func baiduIsAdMu(mu string) bool {
	return strings.Contains(mu, "baidu.php") || strings.Contains(mu, "eclick.baidu.com")
}

// baiduSummaryFromSData: s-data 注释 JSON → 摘要文本 (拼接 generalLines 的 text 段)
func baiduSummaryFromSData(raw string) string {
	var d struct {
		SummaryData struct {
			GeneralLines []struct {
				Data []struct {
					Text string `json:"text"`
				} `json:"data"`
			} `json:"generalLines"`
		} `json:"summaryData"`
	}
	if err := json.Unmarshal([]byte(raw), &d); err != nil {
		return ""
	}
	var parts []string
	for _, ln := range d.SummaryData.GeneralLines {
		for _, seg := range ln.Data {
			if seg.Text != "" {
				parts = append(parts, seg.Text)
			}
		}
	}
	return strings.Join(parts, " ")
}

// parseBaiduHTML: m.baidu.com SERP → Reference (纯函数, 黄金样本可测)。
func parseBaiduHTML(html string, max int) []Reference {
	if strings.Contains(html, "百度安全验证") || strings.Contains(html, "wappass.baidu.com") {
		return nil // 验证墙不是"无结果", 调用方负责归类
	}
	var out []Reference
	seen := map[string]bool{}
	tags := baiduResultTagRe.FindAllStringIndex(html, -1)
	for i, loc := range tags {
		tag := html[loc[0]:loc[1]]
		dl := baiduDataLogRe.FindStringSubmatch(tag)
		if dl == nil {
			continue
		}
		var logj struct {
			MU string `json:"mu"`
		}
		if err := json.Unmarshal([]byte(dl[1]), &logj); err != nil || logj.MU == "" {
			continue
		}
		mu := decodeEntities(logj.MU)
		if !strings.HasPrefix(mu, "http") {
			continue
		}
		// 运营位组件 (大家还在搜/词卡/笔记导流) 不是搜索结果
		if baiduWidgetMuRe.MatchString(mu) {
			continue
		}
		// 广告: 跳转壳 + 标识 class 双判据
		if baiduIsAdMu(mu) {
			continue
		}
		if seen[mu] {
			continue
		}
		// 块体 = 本标签结束到下一个结果块
		end := len(html)
		if i+1 < len(tags) {
			end = tags[i+1][0]
		}
		block := html[loc[1]:end]
		if baiduAdLabelRe.MatchString(block) {
			continue
		}
		// 标题
		title := ""
		if th := baiduH3Re.FindStringSubmatch(block); th != nil {
			title = strings.TrimSpace(decodeEntities(baiduTagRe.ReplaceAllString(th[1], "")))
		}
		if title == "" {
			continue
		}
		// 摘要: s-data 注释 SSR JSON 优先
		snippet := ""
		if sd := baiduSDataRe.FindStringSubmatch(block); sd != nil {
			snippet = baiduSummaryFromSData(sd[1])
		}
		snippet = strings.TrimSpace(decodeEntities(baiduTagRe.ReplaceAllString(snippet, "")))
		seen[mu] = true
		out = append(out, Reference{
			URL: mu, Title: clampText(title, 200), Snippet: clampText(snippet, 400),
			Engines: []string{"baidu"}, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	return out
}

// ---------- 百度限速门 (ddgGate 同款结构; 验证码来得快, 默认 5s) ----------
var (
	baiduGateMu  sync.Mutex
	baiduLastAt  time.Time
	baiduGateJit = func() time.Duration { return time.Duration(time.Now().UnixNano()%250) * time.Millisecond }
)

func baiduMinIntervalMs() int {
	if v := os.Getenv("SC_BAIDU_MIN_INTERVAL_MS"); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil && n >= 0 {
			return n
		}
	}
	return 5000
}

func baiduGate() {
	baiduGateMu.Lock()
	defer baiduGateMu.Unlock()
	wait := baiduLastAt.Add(time.Duration(baiduMinIntervalMs()) * time.Millisecond).Sub(time.Now())
	if wait > 0 {
		time.Sleep(wait + baiduGateJit())
	}
	baiduLastAt = time.Now()
}

// laneBaidu: 移动端直连; 验证墙/空结果如实抛错交健康统计。
func laneBaidu(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	baiduGate()
	req, err := http.NewRequestWithContext(ctx, "GET", "https://m.baidu.com/s", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("word", opts.Query)
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", baiduMobileUA)
	req.Header.Set("Accept", "text/html")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	// 302 → wappass 验证码: Go 默认跟随重定向后最终 URL 可判 (Yahoo consent 同款手法)
	if resp.Request != nil && resp.Request.URL != nil && strings.Contains(resp.Request.URL.Host, "wappass") {
		return nil, fmt.Errorf("baidu: blocked (captcha wall, wappass redirect)")
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("baidu http %d%s", resp.StatusCode, retryAfterSuffix(resp))
	}
	body := readAllString(resp.Body)
	if strings.Contains(body, "百度安全验证") {
		return nil, fmt.Errorf("baidu: blocked (captcha wall page)")
	}
	out := parseBaiduHTML(body, opts.MaxResults)
	if len(out) == 0 {
		return nil, fmt.Errorf("baidu: no results parsed (markup drift or blocked?)")
	}
	return out, nil
}
