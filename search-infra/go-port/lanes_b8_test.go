package main

// 探针第 8 批测试: tvmaze/itunes/steam/gbif/openfda/federalregister/courtlistener
// 黄金样本纪律: fixture 形状/字段值全部取自 2026-09-05 实弹响应(/tmp/probe-b8/shapes/), 不靠记忆。

import (
	"context"
	"net/http"
	"testing"
)

// ---------- tvmaze ----------
const tvmazeGolden = `[{"score":1.1848221,"show":{"id":169,"url":"https://www.tvmaze.com/shows/169/breaking-bad","name":"Breaking Bad","type":"Scripted","language":"English","genres":["Drama","Crime","Thriller"],"status":"Ended","runtime":60,"premiered":"2008-01-20","ended":"2019-10-11","rating":{"average":9.2},"summary":"<p><b>Breaking Bad</b> follows protagonist Walter White, a chemistry teacher who lives in New Mexico.</p>"}},
{"score":0.9,"show":{"id":0,"url":"","name":"No URL Show","type":"Scripted"}}]`

func TestParseTvmaze(t *testing.T) {
	refs, err := parseTvmaze([]byte(tvmazeGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref (空 url 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://www.tvmaze.com/shows/169/breaking-bad" {
		t.Fatalf("tvmaze url: %s", r.URL)
	}
	if r.Kind != "tv" || r.Authority != "api.tvmaze.com" {
		t.Fatalf("tvmaze kind/authority: %s/%s", r.Kind, r.Authority)
	}
	want := "Scripted · Drama, Crime, Thriller · 2008-01-20–2019-10-11 · ★9.2 · Breaking Bad follows protagonist Walter White, a chemistry teacher who lives in New Mexico."
	if r.Snippet != want {
		t.Fatalf("tvmaze snippet:\n got %s\nwant %s", r.Snippet, want)
	}
}

// ---------- itunes ----------
const itunesGolden = `{"resultCount":2,"results":[
{"wrapperType":"track","kind":"podcast","artistId":1407853848,"collectionId":1294077820,"trackId":1294077820,"collectionName":"Syntax Error","trackName":"Syntax Error","artistName":"Creative Genius FM","trackViewUrl":"https://podcasts.apple.com/us/podcast/syntax-error/id1294077820?uo=4","primaryGenreName":"Technology","releaseDate":"2018-11-23T17:00:00Z","trackCount":120,"trackTimeMillis":2106000},
{"wrapperType":"track","kind":"podcast","trackName":"No View URL","artistName":"X"}]}`

func TestParseItunes(t *testing.T) {
	refs, err := parseItunes([]byte(itunesGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref (空 trackViewUrl 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://podcasts.apple.com/us/podcast/syntax-error/id1294077820?uo=4" {
		t.Fatalf("itunes url: %s", r.URL)
	}
	if r.Kind != "podcast" || r.Authority != "podcasts.apple.com" {
		t.Fatalf("itunes kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "Syntax Error" {
		t.Fatalf("itunes title: %s", r.Title) // collectionName 优先
	}
	if r.Snippet != "Creative Genius FM · Technology · 120 集" {
		t.Fatalf("itunes snippet: %s", r.Snippet)
	}
	if r.Published != "2018-11-23" {
		t.Fatalf("itunes published: %s", r.Published)
	}
}

// ---------- steam ----------
const steamGolden = `{"total":10,"items":[
{"type":"app","name":"Portal 2","id":620,"price":{"currency":"USD","initial":999,"final":999},"tiny_image":"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/capsule_sm_120.jpg"},
{"type":"app","name":"Discounted Game","id":999,"price":{"currency":"USD","initial":5999,"final":2999}},
{"type":"app","name":"No ID Game","id":0,"price":null}]}`

func TestParseSteam(t *testing.T) {
	refs, err := parseSteam([]byte(steamGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs (id=0 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://store.steampowered.com/app/620/" {
		t.Fatalf("steam url: %s", r.URL)
	}
	if r.Kind != "games" || r.Authority != "store.steampowered.com" {
		t.Fatalf("steam kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Snippet != "app · USD 9.99" {
		t.Fatalf("steam snippet: %s", r.Snippet) // 无折扣原价
	}
	if refs[1].Snippet != "app · USD 59.99 → 29.99" {
		t.Fatalf("steam r1 snippet: %s", refs[1].Snippet) // 折扣价对
	}
}

// ---------- gbif ----------
const gbifGolden = `{"offset":0,"limit":5,"endOfRecords":false,"count":21079,"results":[
{"key":335094696,"datasetKey":"8bc819e8-4358-416a-b75e-d4b6ed7e0352","nubKey":1926324,"parentKey":3350,"kingdom":"Animalia","phylum":"Arthropoda","order":"Lepidoptera","family":"Lycaenidae","genus":"Quercusia","species":"Quercusia quercus","scientificName":"Quercusia quercus (Linnaeus, 1758)","canonicalName":"Quercusia quercus","synonym":false},
{"key":335094700,"nubKey":1926324,"scientificName":"Quercusia quercus var. dupe","canonicalName":"Quercusia quercus","kingdom":"Animalia","synonym":true},
{"key":5,"nubKey":0,"scientificName":"No Nub Taxon","canonicalName":"No Nub Taxon","kingdom":"Plantae","synonym":true,"vernacularName":"栎属"},
{"key":0,"scientificName":"No Key Taxon"}]}`

func TestParseGbif(t *testing.T) {
	refs, err := parseGbif([]byte(gbifGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs (key=0 跳过 + 同 nubKey 去重), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://www.gbif.org/species/1926324" {
		t.Fatalf("gbif url: %s", r.URL) // nubKey 优先, 缺则 key
	}
	if r.Kind != "species" || r.Authority != "www.gbif.org" {
		t.Fatalf("gbif kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "Quercusia quercus" {
		t.Fatalf("gbif title: %s", r.Title)
	}
	want := "Quercusia quercus (Linnaeus, 1758) · Animalia > Arthropoda > Lepidoptera > Lycaenidae"
	if r.Snippet != want {
		t.Fatalf("gbif snippet:\n got %s\nwant %s", r.Snippet, want)
	}
	if refs[1].Title != "No Nub Taxon (栎属)" {
		t.Fatalf("gbif r1 title: %s", refs[1].Title) // key 兜底 + 俗名拼接
	}
	if refs[1].URL != "https://www.gbif.org/species/5" || refs[1].Snippet != "No Nub Taxon · Plantae · synonym" {
		t.Fatalf("gbif r1: %s / %s", refs[1].URL, refs[1].Snippet)
	}
}

// ---------- openfda ----------
const openfdaGolden = `{"meta":{"disclaimer":"openFDA drug label","results":{"skip":0,"limit":3,"total":2}},"results":[
{"id":"8c45ef1f-f708-485b-bc20-60aa87ce6289","indications_and_usage":["1 INDICATIONS AND USAGE Naproxen tablets are indicated for relief of rheumatoid arthritis."],"dosage_and_administration":["2.1 Important Dosage Information"],"effective_time":"20260129","openfda":{"application_number":["ANDA111"],"brand_name":["Naproxen"],"generic_name":["NAPROXEN"],"manufacturer_name":["A-S Medication Solutions"],"route":["ORAL"]}},
{"id":"empty-brand","openfda":{"brand_name":[],"generic_name":[]}}]}`

func TestParseOpenfda(t *testing.T) {
	refs, err := parseOpenfda([]byte(openfdaGolden), 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref (brand/generic 全空跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=Naproxen" {
		t.Fatalf("openfda url: %s", r.URL) // DailyMed 搜索页闭环
	}
	if r.Kind != "drug" || r.Authority != "open.fda.gov" {
		t.Fatalf("openfda kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "Naproxen" {
		t.Fatalf("openfda title: %s", r.Title)
	}
	want := "NAPROXEN · A-S Medication Solutions · ORAL · 1 INDICATIONS AND USAGE Naproxen tablets are indicated for relief of rheumatoid arthritis."
	if r.Snippet != want {
		t.Fatalf("openfda snippet:\n got %s\nwant %s", r.Snippet, want)
	}
	if r.Published != "2026-01-29" {
		t.Fatalf("openfda published: %s", r.Published) // YYYYMMDD → YYYY-MM-DD
	}
}

// ---------- federalregister ----------
const federalregisterGolden = `{"description":"Documents matching 'artificial intelligence'","count":1558,"total_pages":50,"next_page_url":"https://www.federalregister.gov/api/v1/documents","results":[
{"title":"NIST Artificial Intelligence Consortium","html_url":"https://www.federalregister.gov/documents/2026/05/29/2026-10779/nist-artificial-intelligence-consortium","abstract":"The National Institute of Standards and Technology (NIST) previously announced the formation of the AISIC.","publication_date":"2026-05-29","type":"Notice","agencies":[{"raw_name":"DEPARTMENT OF COMMERCE","name":"Commerce Department","id":54}]},
{"title":"","html_url":"https://www.federalregister.gov/x","abstract":"no title","publication_date":"","type":"Notice","agencies":[]}]}`

func TestParseFederalregister(t *testing.T) {
	refs, err := parseFederalregister([]byte(federalregisterGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref (空 title 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://www.federalregister.gov/documents/2026/05/29/2026-10779/nist-artificial-intelligence-consortium" {
		t.Fatalf("federalregister url: %s", r.URL)
	}
	if r.Kind != "legal" || r.Authority != "federalregister.gov" {
		t.Fatalf("federalregister kind/authority: %s/%s", r.Kind, r.Authority)
	}
	want := "Notice · Commerce Department · The National Institute of Standards and Technology (NIST) previously announced the formation of the AISIC."
	if r.Snippet != want {
		t.Fatalf("federalregister snippet:\n got %s\nwant %s", r.Snippet, want)
	}
	if r.Published != "2026-05-29" {
		t.Fatalf("federalregister published: %s", r.Published)
	}
}

// ---------- courtlistener ----------
const courtlistenerGolden = `{"count":110959,"next":"https://www.courtlistener.com/api/rest/v4/search/?cursor=x","results":[
{"absolute_url":"/opinion/10307218/miranda-v-kennedy/","caseName":"Miranda v. Kennedy","caseNameFull":"","citation":["125 F.4th 23"],"citeCount":3,"cluster_id":10307218,"court":"Court of Appeals for the First Circuit","court_citation_string":"1st Cir.","dateFiled":"2025-01-03","docketNumber":"22-1652","status":"Published","suitNature":"Civil Rights"},
{"caseName":"","absolute_url":"/opinion/1/x/","court":"X Court"}]}`

func TestParseCourtlistener(t *testing.T) {
	refs, err := parseCourtlistener([]byte(courtlistenerGolden), 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref (空 caseName 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://www.courtlistener.com/opinion/10307218/miranda-v-kennedy/" {
		t.Fatalf("courtlistener url: %s", r.URL) // absolute_url 相对路径补前缀
	}
	if r.Kind != "legal" || r.Authority != "www.courtlistener.com" {
		t.Fatalf("courtlistener kind/authority: %s/%s", r.Kind, r.Authority)
	}
	want := "1st Cir. · Published · 125 F.4th 23 · No. 22-1652 · Civil Rights · 3 cites"
	if r.Snippet != want {
		t.Fatalf("courtlistener snippet:\n got %s\nwant %s", r.Snippet, want)
	}
	if r.Published != "2025-01-03" {
		t.Fatalf("courtlistener published: %s", r.Published)
	}
}

// ---------- 接线锁: planner 路由 + 注册面 ----------
func TestPlannerB8Routes(t *testing.T) {
	cases := []struct {
		q    string
		want string
	}{
		{"breaking bad 第几季", "tvmaze"},
		{"推荐一部美剧", "tvmaze"},
		{"英语学习 podcast", "itunes"},
		{"好用的播客推荐", "itunes"},
		{"steam 上好玩的游戏推荐", "steam"},
		{"best pc game 2025", "steam"},
		{"银杏的学名是什么", "gbif"},
		{"大熊猫的物种分类 taxonomy", "gbif"},
		{"美国联邦法规查询 data privacy", "federalregister"},
		{"miranda 判例 case law", "courtlistener"},
		{"阿司匹林药品说明书", "openfda"},
		{"aspirin dosage 用药", "openfda"},
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
	for _, q := range []string{"最新新闻", "weather tomorrow 天气", "npm 包推荐", "kubernetes 部署"} {
		if route := lookupDomains(q); route != nil {
			for _, narrow := range []string{"tvmaze", "itunes", "steam", "gbif", "openfda", "courtlistener"} {
				if containsStr(route.apiProviders, narrow) {
					t.Fatalf("q=%q 误引窄域腿 %s: %v", q, narrow, route.apiProviders)
				}
			}
		}
	}
}

func TestB8Registered(t *testing.T) {
	for _, name := range []string{"tvmaze", "itunes", "steam", "gbif", "openfda", "federalregister", "courtlistener"} {
		if _, ok := laneRegistry[name]; !ok {
			t.Fatalf("laneRegistry 缺 %s", name)
		}
	}
	if len(laneRegistry) != 90 { // 86 + openreview/inaturalist/pubdev/openfoodfacts(批12)
		t.Fatalf("laneRegistry 总数: got %d want 90", len(laneRegistry))
	}
}

// ---------- 守卫回归: 窄域 lane 在拒连 transport 下不得 panic ----------
type b8DenyTransport struct{}

func (b8DenyTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, context.Canceled
}

func TestB8LanesNotPanicked(t *testing.T) {
	client := &http.Client{Transport: b8DenyTransport{}}
	opts := SearchOpts{Query: "test", MaxResults: 5}
	ctx := context.Background()
	for _, fn := range []LaneFn{laneTvmaze, laneItunes, laneSteam, laneGbif, laneOpenfda, laneFederalregister, laneCourtlistener} {
		_, _ = fn(ctx, opts, client) // transport 拒绝合法 err, 只验不 panic
	}
}
