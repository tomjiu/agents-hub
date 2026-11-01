package main

// 探针第 12 批测试: openreview/inaturalist/pubdev/openfoodfacts + wikidata 清账
// 黄金样本纪律: fixture 形状/字段值全部取自 2026-09-05 实弹响应(/tmp/probe-b12/shapes/ + 轮2/轮3 实测), 不靠记忆。

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// ---------- openreview ----------
// 实弹 "retrieval augmented generation" 首条评审笔记(无 title, content.summary) + CJK "强化学习" DBLP 记录
// (title/authors 数组) + 同 forum 多评审去重(融合层 URL 去重错位盲区的车道内防线) + 空 forum/无题无文跳过
const openreviewGolden = `{"notes":[
{"forum":"AYJPbSoAyO","content":{"summary":{"value":"This paper focuses on solving the in-context hallucination problem of Parallel Context Extension (PCE) in Retrieval-Augmented Generation (RAG) scenarios."},"rating":{"value":"6: Weak Accept"},"confidence":{"value":"4: You are confident"}}},
{"forum":"AYJPbSoAyO","content":{"summary":{"value":"Second review of the same paper with different wording and score."}}},
{"forum":"SNDaAsjiu5","content":{"title":{"value":"多智能体强化学习综述 (Overview on Multi-agent Reinforcement Learning)"},"venue":{"value":"计算机科学 2019"},"authors":{"value":["Wei Du","Shifei Ding"]},"authorids":{"value":["~Shifei_Ding1"]}}},
{"forum":"","content":{"title":{"value":"no forum"}}},
{"forum":"EMPTYNOTE","content":{"venue":{"value":"no title no body"}}}]}`

func TestParseOpenreview(t *testing.T) {
	refs, err := parseOpenreview([]byte(openreviewGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 { // 同 forum 去重(-1) + 空 forum/无题无文跳过(-2)
		t.Fatalf("want 2 refs, got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://openreview.net/forum?id=AYJPbSoAyO" {
		t.Fatalf("openreview url: %s", r.URL)
	}
	if r.Kind != "academic" || r.Authority != "openreview.net" {
		t.Fatalf("openreview kind/authority: %s/%s", r.Kind, r.Authority)
	}
	// 评审笔记无 title: 意见摘要头部作标题(120 rune 截断)
	if !strings.HasPrefix(r.Title, "This paper focuses on solving the in-context hallucination") {
		t.Fatalf("openreview title: %s", r.Title)
	}
	if !strings.HasPrefix(r.Snippet, "This paper focuses on solving") {
		t.Fatalf("openreview snippet: %s", r.Snippet)
	}
	// DBLP 记录: title 直用; authors 数组宽容解包不炸反序列化
	if refs[1].Title != "多智能体强化学习综述 (Overview on Multi-agent Reinforcement Learning)" {
		t.Fatalf("openreview dblp title: %s", refs[1].Title)
	}
}

// authors 数组形态单独锁: 整条 content 反序列化不得因数组而失败
func TestOpenreviewAuthorsArray(t *testing.T) {
	refs, err := parseOpenreview([]byte(`{"notes":[{"forum":"AUTH1","content":{"title":{"value":"T"},"authors":{"value":["A","B"]}}}]}`), 8)
	if err != nil {
		t.Fatalf("authors 数组形态不得反序列化失败: %v", err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref, got %d", len(refs))
	}
}

// ---------- inaturalist ----------
// 实弹 falcon 前 2 条(order Falconiformes + genus Falco, 均带 preferred_common_name) + 停用/灭绝形态
const inaturalistGolden = `{"total_results":211,"page":1,"per_page":5,"results":[
{"id":67570,"rank":"order","rank_level":40,"name":"Falconiformes","preferred_common_name":"Falcons and Caracaras","observations_count":594811,"extinct":false,"is_active":true,"ancestry":"48460/1/2/355675/3"},
{"id":4638,"rank":"genus","rank_level":30,"name":"Falco","preferred_common_name":"Typical Falcons","observations_count":465331,"extinct":false,"is_active":true},
{"id":9999,"rank":"species","rank_level":10,"name":"Falco punctatus","preferred_common_name":"Mauritius Kestrel","observations_count":1200,"extinct":true,"is_active":true},
{"id":8888,"rank":"species","rank_level":10,"name":"Falco inactive","preferred_common_name":"","observations_count":10,"extinct":false,"is_active":false}]}`

func TestParseInaturalist(t *testing.T) {
	refs, err := parseInaturalist([]byte(inaturalistGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 3 { // is_active=false 跳过
		t.Fatalf("want 3 refs, got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://www.inaturalist.org/taxa/67570" {
		t.Fatalf("inaturalist url: %s", r.URL)
	}
	if r.Kind != "species" || r.Authority != "www.inaturalist.org" {
		t.Fatalf("inaturalist kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "Falcons and Caracaras (Falconiformes)" {
		t.Fatalf("inaturalist title: %s", r.Title)
	}
	if r.Snippet != "rank order · 594811 observations" {
		t.Fatalf("inaturalist snippet: %s", r.Snippet)
	}
	// 无俗名高阶元: 学名兜底(实弹 order/family 均带 pcn, 属守卫形态)
	if refs[1].Title != "Typical Falcons (Falco)" {
		t.Fatalf("inaturalist title 2: %s", refs[1].Title)
	}
	if !strings.HasSuffix(refs[2].Snippet, " · 已灭绝") {
		t.Fatalf("inaturalist extinct 标记: %s", refs[2].Snippet)
	}
}

// ---------- pubdev ----------
// 实弹 ocr 搜索首位 cunning_document_scanner + 详情 flutter_riverpod latest 3.4.3
const pubdevSearchGolden = `{"packages":[{"package":"cunning_document_scanner"},{"package":"google_mlkit_text_recognition"},{"package":"ocr_text_scanner"}],"next":"https://pub.dev/api/search?q=ocr&page=2"}`

func TestParsePubdevSearch(t *testing.T) {
	names, err := parsePubdevSearch([]byte(pubdevSearchGolden), 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != 3 || names[0] != "cunning_document_scanner" {
		t.Fatalf("pubdev search names: %v", names)
	}
}

const pubdevDetailGolden = `{"name":"flutter_riverpod","latest":{"version":"3.4.3","pubspec":{"name":"flutter_riverpod","description":"A reactive caching and data-binding framework. Riverpod makes working with asynchronous code easier."}},"versions":[{"version":"0.0.1-pre","pubspec":{"description":"A new Flutter package project."}}]}`

func TestParsePubdevDetail(t *testing.T) {
	ref, err := parsePubdevDetail([]byte(pubdevDetailGolden), "flutter_riverpod")
	if err != nil {
		t.Fatal(err)
	}
	if ref.URL != "https://pub.dev/packages/flutter_riverpod" {
		t.Fatalf("pubdev url: %s", ref.URL)
	}
	if ref.Kind != "packages" || ref.Authority != "pub.dev" {
		t.Fatalf("pubdev kind/authority: %s/%s", ref.Kind, ref.Authority)
	}
	if ref.Title != "flutter_riverpod" {
		t.Fatalf("pubdev title: %s", ref.Title)
	}
	if ref.Snippet != "A reactive caching and data-binding framework. Riverpod makes working with asynchronous code easier. · latest 3.4.3" {
		t.Fatalf("pubdev snippet: %s", ref.Snippet)
	}
}

// ---------- openfoodfacts ----------
// 实弹 cgi/search.pl nutella(2026-09-05 实测: count 为字符串 "1031" 真过滤; fields 含 url 时产品对象带 url/quantity,
// 首条 quantity 为空串, 无尾随分隔符; v2 search 参数无效见关账台账)
const openfoodfactsGolden = `{"count":"1031","page":"1","page_count":3,"page_size":3,"products":[
{"brands":"Nutella, Ferrero, Yum yum","product_name":"Nutella","quantity":"","url":"https://world.openfoodfacts.org/product/3017620422003/nutella"},
{"brands":"Nutella","product_name":"Nutella","quantity":"1 kg","url":"https://world.openfoodfacts.org/product/3017620425035/nutella"},
{"brands":"Nutella, Ferrero","product_name":"Nutella","quantity":"825 g","url":"https://world.openfoodfacts.org/product/3017620429484/nutella"}],"skip":0}`

func TestParseOpenfoodfacts(t *testing.T) {
	refs, err := parseOpenfoodfacts([]byte(openfoodfactsGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 3 {
		t.Fatalf("want 3 refs, got %d", len(refs))
	}
	r := refs[0]
	if r.Kind != "food" || r.Authority != "world.openfoodfacts.org" {
		t.Fatalf("openfoodfacts kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.URL != "https://world.openfoodfacts.org/product/3017620422003/nutella" {
		t.Fatalf("openfoodfacts url: %s", r.URL)
	}
	if r.Title != "Nutella" {
		t.Fatalf("openfoodfacts title: %s", r.Title)
	}
	if r.Snippet != "Nutella, Ferrero, Yum yum" { // quantity 空串: 无尾随 " · "
		t.Fatalf("openfoodfacts snippet: %s", r.Snippet)
	}
	if refs[1].Snippet != "Nutella · 1 kg" {
		t.Fatalf("openfoodfacts snippet 2: %s", refs[1].Snippet)
	}
}

// ---------- wikidata 清账: 实体意图词剥离 ----------
func TestStripEntityIntent(t *testing.T) {
	cases := []struct {
		q    string
		want string
	}{
		{"who is linus torvalds", "linus torvalds"}, // 实弹败因句, 修法直中 Q34253
		{"who was alan turing", "alan turing"},
		{"founder of linux", "linux"},
		{"ceo of openai", "openai"},
		{"population of tokyo", "tokyo"},
		{"东京 人口", "东京"},
		{"林纳斯 是谁", "林纳斯"},
		{"linus torvalds", "linus torvalds"}, // 纯实体名原样(不重查)
		{"population", ""},                   // 全剥光 → 不重查
		{"who", ""},
		{"东京", "东京"},
	}
	for _, c := range cases {
		if got := b12StripEntityIntent(c.q); got != c.want {
			t.Fatalf("b12StripEntityIntent(%q)=%q want %q", c.q, got, c.want)
		}
	}
}

// ---------- inaturalist: 物种意图词剥离(端到端实弹抓获的意图词混入缺口) ----------
func TestStripTaxonIntent(t *testing.T) {
	cases := []struct {
		q    string
		want string
	}{
		{"falcon taxonomy", "falcon"}, // 实弹: 全短语 0 命中, 剥离后直中
		{"隼 物种", "隼"},                 // 实弹: 不剥离则返回 Life/Animalia 根元垃圾
		{"falcon scientific name", "falcon"},
		{"猎鹰 分类学", "猎鹰"},
		{"falcon", "falcon"}, // 无意图词原样
		{"taxonomy", ""},     // 全剥光 → 用原词查(空结果合法)
	}
	for _, c := range cases {
		if got := b12StripTaxonIntent(c.q); got != c.want {
			t.Fatalf("b12StripTaxonIntent(%q)=%q want %q", c.q, got, c.want)
		}
	}
}

// ---------- 路由锁 ----------
func TestPlannerB12Routes(t *testing.T) {
	cases := []struct {
		q    string
		want string
	}{
		{"retrieval augmented generation 论文", "openreview"}, // academic 加强
		{"falcon taxonomy", "inaturalist"},                  // species 加强
		{"隼 物种", "inaturalist"},
		{"flutter 状态管理库推荐", "pubdev"},     // packages dart/flutter 信号裁腿
		{"dart 包推荐", "pubdev"},            // packages dart 信号
		{"nutella 营养成分", "openfoodfacts"}, // food 加强(新增词面)
		{"花生酱 配料表", "openfoodfacts"},
	}
	for _, c := range cases {
		route := lookupDomains(c.q)
		if route == nil {
			t.Fatalf("q=%q 未命中任何域", c.q)
			continue
		}
		if !containsStr(route.apiProviders, c.want) {
			t.Fatalf("q=%q providers=%v 缺 %s", c.q, route.apiProviders, c.want)
		}
	}
	// dart/flutter 信号裁腿: 命中后只留 pubdev, 不带 npm 等泛腿
	if route := lookupDomains("flutter 状态管理库推荐"); route != nil {
		if containsStr(route.apiProviders, "npm") || containsStr(route.apiProviders, "crates") {
			t.Fatalf("flutter 信号应裁腿至 pubdev: %v", route.apiProviders)
		}
	}
	// 反例: 泛词不得引出新腿(openfoodfacts 随 food 域级挂载不算窄腿, 菜谱题空结果合法)
	for _, q := range []string{"css 动画教程", "bitcoin 价格", "npm 包推荐", "最新新闻"} {
		if route := lookupDomains(q); route != nil {
			for _, narrow := range []string{"openreview", "inaturalist", "pubdev", "openfoodfacts"} {
				if containsStr(route.apiProviders, narrow) {
					t.Fatalf("q=%q 误引新腿 %s: %v", q, narrow, route.apiProviders)
				}
			}
		}
	}
}

// ---------- 注册锁 ----------
func TestB12Registered(t *testing.T) {
	for _, name := range []string{"openreview", "inaturalist", "pubdev", "openfoodfacts"} {
		if _, ok := laneRegistry[name]; !ok {
			t.Fatalf("laneRegistry 缺 %s", name)
		}
	}
	if len(laneRegistry) != 90 { // 86 + openreview/inaturalist/pubdev/openfoodfacts(批12)
		t.Fatalf("laneRegistry 总数: got %d want 90", len(laneRegistry))
	}
}

// ---------- 拒连回归: 新车道 + wikidata 清账路径在拒连 transport 下不得 panic ----------
type b12DenyTransport struct{}

func (b12DenyTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, context.Canceled
}

func TestB12LanesNotPanicked(t *testing.T) {
	client := &http.Client{Transport: b12DenyTransport{}}
	opts := SearchOpts{Query: "test", MaxResults: 5}
	ctx := context.Background()
	for _, fn := range []LaneFn{laneOpenreview, laneInaturalist, lanePubdev, laneOpenfoodfacts, laneWikidata} {
		_, _ = fn(ctx, opts, client) // transport 拒绝合法 err, 只验不 panic
	}
	// 意图词剥离不触发网络: 纯意图词查询经拒连 client 仍应正常走完降级链返回(err 或空均为合法, 不 panic)
	_, _ = laneWikidata(ctx, SearchOpts{Query: "who is linus torvalds", MaxResults: 5}, client)
}

// TestStripEntityIntentYears b16 泛化探针: 孤立年份是实体定位噪声
// ("population of Japan 2024" 剥意图词后残留 "Japan 2024", wbsearchentities 0 结果)
func TestStripEntityIntentYears(t *testing.T) {
	cases := []struct {
		q, want string
	}{
		{"population of Japan 2024", "Japan"},
		{"founder of Tesla 2025", "Tesla"},
		{"2024", ""},                   // 纯年份剥光 → 不重查
		{"东京 2024 人口", "东京"},           // 年份混排
		{"Tesla l2024", "Tesla l2024"}, // 非孤立数字不剥(\b 守卫)
		// b18 虚词剥除: 意图词剥离后残留英文虚词噪声, wbsearchentities 0 结果
		{"who is the founder of the ubuntu project", "ubuntu project"},
		{"who is the ceo of apple inc", "apple inc"},
		{"the who", ""}, // 纯意图词/虚词剥光 → 不重查(守卫)
	}
	for _, c := range cases {
		if got := b12StripEntityIntent(c.q); got != c.want {
			t.Errorf("b12StripEntityIntent(%q)=%q want %q", c.q, got, c.want)
		}
	}
}
