package main

// 探针第 9 批测试: coingecko/themealdb/kitsu/thesportsdb/standardebooks
// 黄金样本纪律: fixture 形状/字段值全部取自 2026-09-05 实弹响应(/tmp/probe-b9/shapes/), 不靠记忆。

import (
	"context"
	"net/http"
	"testing"
)

// ---------- coingecko ----------
const coingeckoGolden = `{"coins":[
{"id":"bitcoin","name":"Bitcoin","api_symbol":"bitcoin","symbol":"BTC","market_cap_rank":1,"thumb":"https://coin-images.coingecko.com/coins/images/1/thumb/bitcoin.png","large":"https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png"},
{"id":"wrapped-bitcoin","name":"Wrapped Bitcoin","api_symbol":"wrapped-bitcoin","symbol":"WBTC","market_cap_rank":16},
{"id":"no-rank-coin","name":"No Rank Coin","symbol":"NRC","market_cap_rank":0},
{"id":"","name":"No ID","symbol":"X"}],
"exchanges":[],"icos":[],"categories":[],"nfts":[]}`

func TestParseCoingecko(t *testing.T) {
	refs, err := parseCoingecko([]byte(coingeckoGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 3 {
		t.Fatalf("want 3 refs (空 id 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://www.coingecko.com/en/coins/bitcoin" {
		t.Fatalf("coingecko url: %s", r.URL)
	}
	if r.Kind != "finance" || r.Authority != "coingecko.com" {
		t.Fatalf("coingecko kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Snippet != "BTC · rank #1" {
		t.Fatalf("coingecko snippet: %s", r.Snippet)
	}
	if refs[2].Snippet != "NRC" {
		t.Fatalf("coingecko 无 rank snippet: %s", refs[2].Snippet)
	}
}

// ---------- themealdb ----------
const themealdbGolden = `{"meals":[
{"idMeal":"52795","strMeal":"Chicken Handi","strMealAlternate":null,"strCategory":"Chicken","strArea":"India","strInstructions":"Take a large pot or wok, big enough to cook all the chicken. Heat the butter."},
{"idMeal":"52819","strMeal":"No Category Meal","strCategory":null,"strArea":null,"strInstructions":""},
{"idMeal":"","strMeal":"No ID Meal"}]}`

const themealdbNull = `{"meals":null}`

func TestParseThemealdb(t *testing.T) {
	refs, err := parseThemealdb([]byte(themealdbGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs (空 idMeal 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://www.themealdb.com/meal/52795" {
		t.Fatalf("themealdb url: %s", r.URL)
	}
	if r.Kind != "food" || r.Authority != "themealdb.com" {
		t.Fatalf("themealdb kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "Chicken Handi" {
		t.Fatalf("themealdb title: %s", r.Title)
	}
	want := "Chicken · India · Take a large pot or wok, big enough to cook all the chicken. Heat the butter."
	if r.Snippet != want {
		t.Fatalf("themealdb snippet:\n got %s\nwant %s", r.Snippet, want)
	}
	// 实弹: 中文词面返回 {"meals":null} — 正常空结果不是错误
	nullRefs, err := parseThemealdb([]byte(themealdbNull), 8)
	if err != nil || len(nullRefs) != 0 {
		t.Fatalf("themealdb meals null: err=%v refs=%d", err, len(nullRefs))
	}
}

// ---------- kitsu ----------
const kitsuGolden = `{"data":[
{"id":"1","type":"anime","attributes":{"createdAt":"2013-02-20T16:00:13.609Z","slug":"cowboy-bebop","synopsis":"In the year 2071, humanity has colonized several of the planets and moons of the solar system.","canonicalTitle":"Cowboy Bebop","averageRating":"82.27","startDate":"1998-04-03","subtype":"TV","status":"finished","episodeCount":26}},
{"id":"2","type":"anime","attributes":{"slug":"no-title-anime","canonicalTitle":""}},
{"id":"3","type":"anime","attributes":{"slug":"","canonicalTitle":"No Slug"}}],
"meta":{"count":3}}`

func TestParseKitsu(t *testing.T) {
	refs, err := parseKitsu([]byte(kitsuGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref (空 slug/canonicalTitle 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://kitsu.io/anime/cowboy-bebop" {
		t.Fatalf("kitsu url: %s", r.URL)
	}
	if r.Kind != "anime" || r.Authority != "kitsu.io" {
		t.Fatalf("kitsu kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "Cowboy Bebop" {
		t.Fatalf("kitsu title: %s", r.Title)
	}
	want := "TV · finished · 26 集 · 1998-04-03 · ★82.27 · In the year 2071, humanity has colonized several of the planets and moons of the solar system."
	if r.Snippet != want {
		t.Fatalf("kitsu snippet:\n got %s\nwant %s", r.Snippet, want)
	}
}

// ---------- thesportsdb ----------
const thesportsdbGolden = `{"teams":[
{"idTeam":"134867","idESPN":"0","strTeam":"Los Angeles Lakers","strLeague":"NBA","strSport":"Basketball","intFormedYear":"1947","strStadium":"Crypto.com Arena","strDescriptionEN":"The Los Angeles Lakers are an American professional basketball team based in Los Angeles."},
{"idTeam":"0","strTeam":"No ID Team","strLeague":"X"},
{"idTeam":"999","strTeam":"Minimal Team","strLeague":"Y League","strSport":"","intFormedYear":"0","strStadium":"","strDescriptionEN":""}]}`

const thesportsdbNull = `{"teams":null}`

func TestParseThesportsdb(t *testing.T) {
	refs, err := parseThesportsdb([]byte(thesportsdbGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs (idTeam=0 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://www.thesportsdb.com/team/134867" {
		t.Fatalf("thesportsdb url: %s", r.URL)
	}
	if r.Kind != "sport" || r.Authority != "www.thesportsdb.com" {
		t.Fatalf("thesportsdb kind/authority: %s/%s", r.Kind, r.Authority)
	}
	want := "NBA · Basketball · est.1947 · Crypto.com Arena · The Los Angeles Lakers are an American professional basketball team based in Los Angeles."
	if r.Snippet != want {
		t.Fatalf("thesportsdb snippet:\n got %s\nwant %s", r.Snippet, want)
	}
	if refs[1].Snippet != "Y League" {
		t.Fatalf("thesportsdb 最小字段 snippet: %s", refs[1].Snippet) // year=0 不出 est.
	}
	// 实弹: 无命中词返回 {"teams":null} — 正常空结果不是错误
	nullRefs, err := parseThesportsdb([]byte(thesportsdbNull), 8)
	if err != nil || len(nullRefs) != 0 {
		t.Fatalf("thesportsdb teams null: err=%v refs=%d", err, len(nullRefs))
	}
}

// ---------- standardebooks (HTML) ----------
const standardebooksGolden = `<ol class="ebooks-list grid">
<li typeof="schema:Book" about="/ebooks/arthur-conan-doyle/the-casebook-of-sherlock-holmes"><div class="thumbnail-container"><a href="/ebooks/arthur-conan-doyle/the-casebook-of-sherlock-holmes"><picture><img src="/images/covers/x.jpg"/></picture></a></div><p>The Casebook of Sherlock Holmes</p><p>Arthur Conan Doyle</p></li>
<li typeof="schema:Book" about="/ebooks/arthur-conan-doyle/his-last-bow"><p>His Last Bow</p><p>Arthur Conan Doyle</p></li>
<li typeof="schema:Book" about=""><p>No Path Book</p><p>X</p></li>
<li typeof="schema:Book" about="/ebooks/a/empty-title"><p></p><p>X</p></li>
</ol>`

func TestParseStandardebooks(t *testing.T) {
	refs := parseStandardebooks(standardebooksGolden, 8)
	if len(refs) != 2 {
		t.Fatalf("want 2 refs (空 about/空 title 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://standardebooks.org/ebooks/arthur-conan-doyle/the-casebook-of-sherlock-holmes" {
		t.Fatalf("standardebooks url: %s", r.URL)
	}
	if r.Kind != "books" || r.Authority != "standardebooks.org" {
		t.Fatalf("standardebooks kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "The Casebook of Sherlock Holmes" {
		t.Fatalf("standardebooks title: %s", r.Title)
	}
	if r.Snippet != "作者 Arthur Conan Doyle" {
		t.Fatalf("standardebooks snippet: %s", r.Snippet)
	}
}

// ---------- 接线锁: planner 路由 + 注册面 ----------
func TestPlannerB9Routes(t *testing.T) {
	cases := []struct {
		q    string
		want string
	}{
		{"比特币价格走势", "coingecko"},
		{"ethereum staking 收益", "coingecko"},
		{"web3 是什么", "coingecko"},
		{"红烧肉的菜谱", "themealdb"},
		{"chicken recipe", "themealdb"},
		{"进击的巨人 动漫", "kitsu"},
		{"推荐的番剧", "kitsu"},
		{"NBA 球队资料 Lakers", "thesportsdb"},
		{"英超球队介绍", "thesportsdb"},
		{"夏洛克名著电子书", "standardebooks"},
		{"public domain books 经典文学", "standardebooks"},
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
	// 反例: 泛词不得引出窄域腿(防烧限流配额/防错域)
	for _, q := range []string{"最新新闻", "method 调用报错", "css 动画教程", "npm 包推荐", "kubernetes 部署"} {
		if route := lookupDomains(q); route != nil {
			for _, narrow := range []string{"coingecko", "themealdb", "kitsu", "thesportsdb", "standardebooks"} {
				if containsStr(route.apiProviders, narrow) {
					t.Fatalf("q=%q 误引窄域腿 %s: %v", q, narrow, route.apiProviders)
				}
			}
		}
	}
}

func TestB9Registered(t *testing.T) {
	for _, name := range []string{"coingecko", "themealdb", "kitsu", "thesportsdb", "standardebooks"} {
		if _, ok := laneRegistry[name]; !ok {
			t.Fatalf("laneRegistry 缺 %s", name)
		}
	}
	if len(laneRegistry) != 90 { // 86 + 批12 4 车道(锁移至批12)
		t.Fatalf("laneRegistry 总数: got %d want 90", len(laneRegistry))
	}
}

// ---------- 守卫回归: 窄域 lane 在拒连 transport 下不得 panic ----------
type b9DenyTransport struct{}

func (b9DenyTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, context.Canceled
}

func TestB9LanesNotPanicked(t *testing.T) {
	client := &http.Client{Transport: b9DenyTransport{}}
	opts := SearchOpts{Query: "test", MaxResults: 5}
	ctx := context.Background()
	for _, fn := range []LaneFn{laneCoingecko, laneThemealdb, laneKitsu, laneThesportsdb, laneStandardebooks} {
		_, _ = fn(ctx, opts, client) // transport 拒绝合法 err, 只验不 panic
	}
}
