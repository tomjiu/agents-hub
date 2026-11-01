package main

// P2 共享助手: 实体解码/绝对 URL/DDG 限速门/freshness 映射
// 契约与纪律逐字对齐 TS(keyless-apis.ts decodeEntities / duckduckgo.ts 三件套 / base.ts absoluteUrl)

import (
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// readAllString 读尽响应体
func readAllString(r io.Reader) string {
	b, err := io.ReadAll(r)
	if err != nil {
		return ""
	}
	return string(b)
}

// decodeEntities 对齐 TS: &amp; 最后解, 保证 "&amp;quot;" 单次解码成 "&quot;"
func decodeEntities(s string) string {
	r := strings.NewReplacer(
		"&lt;", "<", "&gt;", ">", "&quot;", "\"",
		"&#39;", "'", "&apos;", "'",
		"&amp;", "&", // 最后解
	)
	return r.Replace(s)
}

// absoluteUrl 对齐 TS base.ts: 相对链补全
func absoluteUrl(base, href string) string {
	if href == "" {
		return ""
	}
	if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") {
		return href
	}
	u, err := url.Parse(href)
	if err != nil {
		return ""
	}
	b, err := url.Parse(base)
	if err != nil {
		return ""
	}
	return b.ResolveReference(u).String()
}

// ---------- freshness 映射(ddg/keenable/searxng 各有自家词汇, 各车道内处理) ----------
// ddg: day→d week→w month→m year→y
func ddgFreshness(f string) string {
	switch f {
	case "day":
		return "d"
	case "week":
		return "w"
	case "month":
		return "m"
	case "year":
		return "y"
	}
	return ""
}

// searxng: time_range day/week/month/year
func searxngFreshness(f string) string {
	switch f {
	case "day", "week", "month", "year":
		return f
	}
	return ""
}

// keenable: published_after 相对增量 1d/7d/30d/365d
func keenableFreshness(f string) string {
	switch f {
	case "day":
		return "1d"
	case "week":
		return "7d"
	case "month":
		return "30d"
	case "year":
		return "365d"
	}
	return ""
}

// ---------- DDG 限速门(三件套之一, 进程全局状态; TS 同款) ----------
var (
	ddgGateMu  sync.Mutex
	ddgLastAt  time.Time
	ddgGateJit = func() time.Duration { return time.Duration(time.Now().UnixNano()%250) * time.Millisecond } // 0-250ms jitter
)

func ddgMinIntervalMs() int {
	if v := os.Getenv("SC_DDG_MIN_INTERVAL_MS"); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil && n >= 0 {
			return n
		}
	}
	return 3000
}

func ddgGate() {
	ddgGateMu.Lock()
	defer ddgGateMu.Unlock()
	wait := ddgLastAt.Add(time.Duration(ddgMinIntervalMs()) * time.Millisecond).Sub(time.Now())
	if wait > 0 {
		time.Sleep(wait + ddgGateJit()) // 随机化间隔: 数十 ms 级 jitter, 避免多进程同频(10-c 社区绕法)
	}
	ddgLastAt = time.Now()
}
