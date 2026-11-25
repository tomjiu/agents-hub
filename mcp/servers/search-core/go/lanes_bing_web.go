package main

// bingweb: Bing 网页搜索 HTML 车道 (2026-11-25 无 key 主流引擎扩源, issue #3)。
//
// 背景实测 (2026-11-25, 香港阿里云出口 IP):
//   - google.com/search 直连 = JS 壳页 (noscript 的 /httpservice/retry/enablejs
//     重试也是「啟用 JavaScript」死路), 与 IP 地域无关, 维持 G2 BLOCKED 判定;
//     合法 Google 通路 = keyed SERP API (serper/serpapi 车道)。
//   - baidu.com/s 直连 = 「百度安全验证」(首探偶通后稳定拦截, 数据中心 IP 标记)。
//   - bing.com/search HTML 直连 = 可用: 自报 laneUA 亦通过 (实测 10 条干净结果),
//     中文/英文/freshness=week 均实测可用。但同 IP 连续 ~15-20 次快速请求后触发
//     两级软封:
//       (a) 垃圾注入伪 200: 结构完整 (b_algo 照常) 但结果与查询零相关
//           (Lowe's 门店/酒店/学校页随机注入, q 回写仍正确);
//       (b) 零结果: b_algo 消失 (同期 RSS 通道零 item)。
//     两级都由车道内守卫识别 (零词面命中守卫 + 漂移守卫), 如实抛错交熔断冷却,
//     不把垃圾当结果返回。
//
// 结果 URL: bing.com/ck/a?!...&u=a1<base64url> 重定向包裹; u 值剥 "a1" 前缀后
// base64url 解码得真实 URL (解出相对路径 = bing 站内垂直链接, 非 web 结果, 丢弃)。
// 正文摘要在 div.b_caption p 或 p.b_lineclamp*(两形态均见实测样本)。

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

// ---------- ck/a 重定向解码 ----------

// decodeBingClick: bing.com/ck/a 链接 → 真实 URL; 非 ck/a 直链原样;
// u 缺失/解码失败/解出非 http (站内垂直) → "" (调用方丢弃)。
func decodeBingClick(href string) string {
	if href == "" {
		return ""
	}
	if !strings.Contains(href, "/ck/a") {
		if strings.HasPrefix(href, "http") {
			return href
		}
		return ""
	}
	u, err := url.Parse(href)
	if err != nil {
		return ""
	}
	raw := u.Query().Get("u")
	if !strings.HasPrefix(raw, "a1") {
		return ""
	}
	dec, err := base64.RawURLEncoding.DecodeString(raw[2:])
	if err != nil {
		dec, err = base64.URLEncoding.DecodeString(raw[2:])
		if err != nil {
			return ""
		}
	}
	target := string(dec)
	if !strings.HasPrefix(target, "http") {
		return "" // /images/search 等站内垂直链接
	}
	return target
}

// ---------- HTML 解析 ----------

// bingWebIsAdItem: 经典广告位判据 (2026-11-25 主流引擎批, 用户口径"广告一般有标识"):
//  1. li class 含 b_ad (广告容器, 含顶层 b_adTop; 内层再像 b_algo 也整体是广告)
//  2. 块内含 b_adSlug (Ad 徽标容器)
//  3. b_attribution 内 b_adLink (Ad 徽标链接形态)
func bingWebIsAdItem(el *goquery.Selection) bool {
	if cls, _ := el.Attr("class"); strings.Contains(cls, "b_ad") {
		return true
	}
	if el.Find(".b_adSlug").Length() > 0 {
		return true
	}
	if el.Find(".b_attribution .b_adLink").Length() > 0 {
		return true
	}
	return false
}

// parseBingWebHTML: li.b_algo → h2>a(标题+ck/a 链接) + b_caption/b_lineclamp(摘要)。
// 零 b_algo 块 → nil (调用方结合 b_no 标记区分合法空 vs 漂移)。
func parseBingWebHTML(htmlBody string, max int) []Reference {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(htmlBody))
	if err != nil {
		return nil
	}
	var out []Reference
	// 顶层直接子 li 选择 (2026-11-25 主流引擎批实弹): 经典广告位包在 li.b_ad
	// 容器里, 内层条目同样带 b_algo class — 全文档选择会误收广告; 只取 #b_results
	// 顶层子节点, 再按 class 前缀锁 b_algo (跳过 b_ans/b_pag/b_msg)。
	doc.Find("#b_results").ChildrenFiltered("li").Each(func(_ int, el *goquery.Selection) {
		if cls, _ := el.Attr("class"); !strings.HasPrefix(cls, "b_algo") {
			return
		}
		if bingWebIsAdItem(el) {
			return
		}
		a := el.Find("h2 a").First()
		href, _ := a.Attr("href")
		u := decodeBingClick(href)
		if u == "" {
			return
		}
		snippet := el.Find("div.b_caption p").First().Text()
		if strings.TrimSpace(snippet) == "" {
			snippet = el.Find("p[class^=b_lineclamp]").First().Text()
		}
		out = append(out, Reference{
			URL: u, Title: clampText(a.Text(), 200), Snippet: clampText(snippet, 400),
			Engines: []string{"bingweb"}, Kind: "web",
		})
	})
	// goquery Each 回调内 return 不终止迭代, 统一尾部截断
	if len(out) > max {
		out = out[:max]
	}
	return out
}

// ---------- 垃圾注入守卫 ----------

// bingGarbageGuard: Bing 垃圾注入软封的词面守卫 (伪 200 反制, 2026-11-25 实测形态)。
// 判据: 查询 ≥2 独立词项, 且全部结果的 title×2+snippet 对查询词项零命中
// (lexicalScore=0) → 判垃圾注入, 抛错交熔断。任一结果命中 ≥1 词项 → 合法放行
// (宽松通过: 宁可漏判交 fusion 层质量门, 不误杀真结果)。
// <2 词项查询 (单词/纯停用词) 无法判 → 放行, 由上层 lexical evidence gate 兜底。
func bingGarbageGuard(query string, refs []Reference) error {
	terms := uniqueTerms(tokenize(query))
	if len(terms) < 2 || len(refs) == 0 {
		return nil
	}
	for _, r := range refs {
		if lexicalScore(query, r.Title, r.Snippet) > 0 {
			return nil
		}
	}
	return fmt.Errorf("bingweb: garbage injection suspected (0/%d query terms hit across %d results) — soft-block signature, refusing", len(terms), len(refs))
}

// ---------- 参数映射 ----------

// bingMarket: lane 语言码 → Bing mkt 市场。已知码映射, 未知码返回 "" (让 Bing
// 按出口 IP 自决, 不猜市场)。实测: 不带 mkt 时 HK 出口对英文词面也回中文市场结果
// (Cambridge 词典中文页), 对英文查询显式 mkt=en-US 更对题。
func bingMarket(lang string) string {
	switch strings.ToLower(strings.TrimSpace(lang)) {
	case "", "en":
		return "en-US"
	case "zh":
		return "zh-CN"
	case "ja":
		return "ja-JP"
	case "ko":
		return "ko-KR"
	case "fr":
		return "fr-FR"
	case "de":
		return "de-DE"
	case "es":
		return "es-ES"
	case "ru":
		return "ru-RU"
	}
	return ""
}

// bingFreshness: 官方文档值 day/week/month; year 无对应词汇 → "" (不限时, 如实
// 不猜自定义区间语法)。
func bingFreshness(f string) string {
	switch f {
	case "day", "week", "month":
		return f
	}
	return ""
}

// ---------- 车道 ----------

// laneBingwebURL: 车道端点 (包级 var, httptest 注入点; 生产缺省 bing.com/search)
var laneBingwebURL = "https://www.bing.com/search"

func laneBingweb(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", laneBingwebURL, nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("q", opts.Query)
	q.Set("count", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	// ensearch=1 仅非 CJK 查询 (2026-11-25 主流引擎批 6 连抓实弹: mkt=en-US 单独
	// 携带时单词查询仍返回毒化页(MCP→Target 门店×10); ensearch=1 两连抓全干净。
	// CJK 查询加 ensearch 实弹反噬出品牌词垃圾页(国产大模型→"Bing"品牌结果)。
	// 注: 词面守卫对 <2 词项查询放行, ensearch 恰补这个洞)
	if !cjkRe.MatchString(opts.Query) {
		q.Set("ensearch", "1")
	}
	if m := bingMarket(opts.Lang); m != "" {
		q.Set("mkt", m)
	}
	if opts.Lang != "" {
		q.Set("setlang", opts.Lang)
	}
	if f := bingFreshness(opts.Freshness); f != "" {
		q.Set("freshness", f)
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
		return nil, fmt.Errorf("bingweb http %d", resp.StatusCode)
	}
	body := readAllString(resp.Body)
	// 漂移守卫: 无 b_algo 结构时, b_no (Bing 官方"无结果"块) = 合法空;
	// 两者皆无 = 被封/挑战页/改版, 抛错进健康统计 (不静默空手)。
	if !strings.Contains(body, "b_algo") {
		if strings.Contains(body, "b_no") {
			return []Reference{}, nil
		}
		return nil, fmt.Errorf("bingweb: markup drift (blocked or challenge page)")
	}
	out := parseBingWebHTML(body, opts.MaxResults)
	if len(out) == 0 {
		return nil, fmt.Errorf("bingweb: no results parsed (markup drift?)")
	}
	if err := bingGarbageGuard(opts.Query, out); err != nil {
		return nil, err
	}
	return out, nil
}
