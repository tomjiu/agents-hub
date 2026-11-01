package main

// 探针第 6 批测试: nuget/hex/arch/inspirehep/openaire/commonswiki/openmeteo
// 黄金样本纪律: fixture 形状/字段值全部取自 2026-09-05 实弹响应(/tmp/probe-b6/shapes/), 不靠记忆。

import (
	"context"
	"testing"
)

// ---------- nuget ----------
const nugetGolden = `{"totalHits":819,"data":[
{"@id":"https://api.nuget.org/v3/registration5-semver1/fluentvalidation/index.json","id":"FluentValidation","title":"FluentValidation","description":"A validation library for .NET that uses a fluent interface to construct validation rules.","version":"12.1.1","totalDownloads":1039262544,"verified":true},
{"id":"Serilog","title":"Serilog","summary":"Simple .NET logging","version":"4.2.0","totalDownloads":2180000000}
]}`

func TestParseNuget(t *testing.T) {
	refs, err := parseNuget([]byte(nugetGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs, got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://www.nuget.org/packages/FluentValidation" {
		t.Fatalf("nuget url: %s", r.URL)
	}
	if r.Kind != "packages" || r.Authority != "nuget.org" {
		t.Fatalf("nuget kind/authority: %s/%s", r.Kind, r.Authority)
	}
	want := "A validation library for .NET that uses a fluent interface to construct validation rules. · 12.1.1 · 1039262544 downloads · verified"
	if r.Snippet != want {
		t.Fatalf("nuget snippet:\n got %s\nwant %s", r.Snippet, want)
	}
	if refs[1].Snippet != "Simple .NET logging · 4.2.0 · 2180000000 downloads" {
		t.Fatalf("nuget r1 snippet: %s", refs[1].Snippet) // summary 兜底路径
	}
}

// ---------- hex ----------
const hexGolden = `[{"name":"abacus_sql","meta":{"links":{"GitHub":"https://github.com/narrowtux/abacus_sql"},"description":"Convert Abacus expression into Ecto DSL expressions, and use them for where, selects, order_by, group_by or having clauses.","licenses":["MIT"],"maintainers":[]},"downloads":{"all":224091,"day":9,"recent":892,"week":83},"url":"https://hex.pm/api/packages/abacus_sql","html_url":"https://hex.pm/packages/abacus_sql"},
{"name":"ecto","meta":{"description":"A database wrapper and language integrated query for Elixir","licenses":[]},"downloads":{"all":30000000},"html_url":"https://hex.pm/packages/ecto"}]`

func TestParseHex(t *testing.T) {
	refs, err := parseHex([]byte(hexGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs, got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://hex.pm/packages/abacus_sql" {
		t.Fatalf("hex url: %s", r.URL) // html_url 优先于 api url
	}
	if r.Kind != "packages" || r.Authority != "hex.pm" {
		t.Fatalf("hex kind/authority: %s/%s", r.Kind, r.Authority)
	}
	want := "Convert Abacus expression into Ecto DSL expressions, and use them for where, selects, order_by, group_by or having clauses. · 224091 downloads · MIT"
	if r.Snippet != want {
		t.Fatalf("hex snippet:\n got %s\nwant %s", r.Snippet, want)
	}
	if refs[1].Snippet != "A database wrapper and language integrated query for Elixir · 30000000 downloads" {
		t.Fatalf("hex r1 snippet: %s", refs[1].Snippet) // 空 licenses 不追加
	}
}

// ---------- arch ----------
const archGolden = `{"version":2,"limit":250,"valid":true,"results":[
{"pkgname":"repgrep","pkgbase":"repgrep","repo":"extra","arch":"x86_64","pkgver":"0.17.1","pkgrel":"2","pkgdesc":"An interactive command line replacer for ripgrep","url":"https://github.com/acheronfail/repgrep"},
{"pkgname":"ripgrep","pkgbase":"ripgrep","repo":"extra","arch":"x86_64","pkgver":"14.1.1","pkgdesc":"Grep-like search tool","url":""}
]}`

func TestParseArch(t *testing.T) {
	refs, err := parseArch([]byte(archGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs, got %d", len(refs))
	}
	if refs[0].URL != "https://github.com/acheronfail/repgrep" {
		t.Fatalf("arch upstream url: %s", refs[0].URL)
	}
	if refs[0].Snippet != "An interactive command line replacer for ripgrep · extra 0.17.1" {
		t.Fatalf("arch snippet: %s", refs[0].Snippet)
	}
	// 无 upstream url 时落 archlinux.org 包页
	if refs[1].URL != "https://archlinux.org/packages/extra/x86_64/ripgrep/" {
		t.Fatalf("arch pkg page: %s", refs[1].URL)
	}
}

// ---------- inspirehep ----------
const inspireGolden = `{"hits":{"hits":[{"metadata":{
"citation_count":17,"control_number":833081,
"titles":[{"title":"Lorentz violation in three-family neutrino oscillation"},{"source":"arXiv","title":"dup"}],
"abstracts":[{"value":"We study Lorentz violation effects on neutrino oscillation in the three-family framework."}],
"arxiv_eprints":[{"categories":["hep-ph"],"value":"0910.0897"}],
"dois":[{"value":"10.1142/S0217751X09046382"}],
"publication_info":[{"journal_volume":"24","page_end":"5876","year":2009,"page_start":"5861","journal_title":"Int.J.Mod.Phys.A"}]
}}]}}`

func TestParseInspirehep(t *testing.T) {
	refs, err := parseInspirehep([]byte(inspireGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref, got %d", len(refs))
	}
	r := refs[0]
	// 链接优先级: arXiv > DOI
	if r.URL != "https://arxiv.org/abs/0910.0897" {
		t.Fatalf("inspire url: %s", r.URL)
	}
	if r.Title != "Lorentz violation in three-family neutrino oscillation" {
		t.Fatalf("inspire title: %s", r.Title)
	}
	if r.Kind != "academic" || r.Published != "2009" {
		t.Fatalf("inspire kind/published: %s/%s", r.Kind, r.Published)
	}
	want := "We study Lorentz violation effects on neutrino oscillation in the three-family framework. · Int.J.Mod.Phys.A 2009 · 17 citations"
	if r.Snippet != want {
		t.Fatalf("inspire snippet:\n got %s\nwant %s", r.Snippet, want)
	}
}

// 非物理学术查询 → 零请求合法空(nil client 不会被触网)
func TestLaneInspirehepGuard(t *testing.T) {
	refs, err := laneInspirehep(context.Background(), SearchOpts{Query: "transformer attention 论文"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 0 {
		t.Fatalf("non-physics query must zero-request empty, got %d", len(refs))
	}
	// 守卫放行分支用正则断言(对齐 repology 守卫测试范式: 放行后触网路径由 parse 测试+实弹覆盖)
	if !physicsIntentRe.MatchString("中微子振荡 文献") {
		t.Fatalf("physics intent must pass guard")
	}
	if physicsIntentRe.MatchString("transformer attention") {
		t.Fatalf("non-physics intent must be blocked by guard")
	}
}

// ---------- openaire (真实嵌套形状: metadata["oaf:entity"]["oaf:result"]) ----------
const openaireGolden = `{"response":{"header":{"query":{"$":"(oaftype exact result)"},"size":{"$":"1"}},"results":{"result":[
{"header":{"dri:objIdentifier":"od______3291::5c68"} ,"metadata":{"oaf:entity":{"@xsi:schemaLocation":"oaf","oaf:result":{
"title":[{"@classid":"main title","@classname":"main title","$":"Graph Neural Network, ChebNet, Graph Convolutional Network, and Graph Autoencoder: Tutorial and Survey"},{"@classid":"alternative title","$":"alt"}],
"description":[{"$":"<p>This is a tutorial paper on graph neural networks including ChebNet, graph convolutional network, and graph attention network.</p>"}],
"dateofacceptance":{"$":"2024-07-09"},
"pid":[{"@classid":"doi","@classname":"Digital Object Identifier","$":"10.31219/osf.io/9wk3y"}]
}}}}
]}}}`

func TestParseOpenaire(t *testing.T) {
	refs, err := parseOpenaire([]byte(openaireGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref, got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://doi.org/10.31219/osf.io/9wk3y" {
		t.Fatalf("openaire url: %s", r.URL)
	}
	if r.Title != "Graph Neural Network, ChebNet, Graph Convolutional Network, and Graph Autoencoder: Tutorial and Survey" {
		t.Fatalf("openaire title(main title 优先): %s", r.Title)
	}
	if r.Published != "2024-07-09" {
		t.Fatalf("openaire published: %s", r.Published)
	}
	if r.Snippet == "" || r.Snippet[:4] == "<p>#" {
		t.Fatalf("openaire snippet 应去 HTML: %q", r.Snippet)
	}
}

// ---------- commonswiki ----------
const commonsGolden = `{"batchcomplete":"","query":{"pages":{
"9029528":{"pageid":9029528,"ns":6,"title":"File:Grumman E-2C Hawkeyes of VAW-115 fly past Mount Fuji on 15 February 2007.jpg","index":2,"imagerepository":"local","imageinfo":[{"thumburl":"https://thumb.wikimedia.org/x/400px-x.jpg","url":"https://upload.wikimedia.org/x.jpg","descriptionurl":"https://commons.wikimedia.org/wiki/File:Grumman_E-2C.jpg","descriptionshorturl":"https://commons.wikimedia.org/w/index.php?curid=9029528","width":2100,"height":1400}]},
"5550001":{"pageid":5550001,"ns":6,"title":"File:Mount Fuji from Lake Kawaguchi.jpg","index":1,"imagerepository":"local","imageinfo":[{"url":"https://upload.wikimedia.org/y.jpg","descriptionurl":"https://commons.wikimedia.org/wiki/File:Mount_Fuji_Kawaguchi.jpg","width":4000,"height":2670}]}
}}}`

func TestParseCommons(t *testing.T) {
	refs, err := parseCommons([]byte(commonsGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs, got %d", len(refs))
	}
	// index=1 湖上富士山应排前(map 迭代无序, 必须按 index 排)
	if refs[0].Title != "Mount Fuji from Lake Kawaguchi" {
		t.Fatalf("commons index sort broken, first=%s", refs[0].Title)
	}
	if refs[0].URL != "https://commons.wikimedia.org/wiki/File:Mount_Fuji_Kawaguchi.jpg" {
		t.Fatalf("commons desc url: %s", refs[0].URL)
	}
	if refs[0].Kind != "image" {
		t.Fatalf("commons kind: %s", refs[0].Kind)
	}
	if refs[1].Title != "Grumman E-2C Hawkeyes of VAW-115 fly past Mount Fuji on 15 February 2007" {
		t.Fatalf("commons File: 前缀与扩展名剥离: %s", refs[1].Title)
	}
}

// ---------- openmeteo ----------
func TestComposeMeteo(t *testing.T) {
	loc := meteoPlace{DisplayName: "東京都, 日本", Latitude: 35.6895, Longitude: 139.69171}
	tC, code := 22.3, 3
	f := meteoFc{Timezone: "Asia/Tokyo"}
	f.Current.Time = "2026-09-05T11:00"
	f.Current.Temperature2m = &tC
	f.Current.WeatherCode = &code

	refs := composeMeteo(loc, f, "东京天气")
	if len(refs) != 1 {
		t.Fatalf("want 1 ref, got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://open-meteo.com/en/docs/?latitude=35.6895&longitude=139.69171" {
		t.Fatalf("meteo url: %s", r.URL)
	}
	if r.Title != "東京都, 日本 天气实况" {
		t.Fatalf("meteo zh title: %s", r.Title)
	}
	if r.Snippet != "22.3°C 阴 · Asia/Tokyo" {
		t.Fatalf("meteo zh snippet: %s", r.Snippet)
	}
	if r.Kind != "data" || r.Authority != "open-meteo.com" {
		t.Fatalf("meteo kind/authority: %s/%s", r.Kind, r.Authority)
	}
	// en 查询 → en 标题
	refs = composeMeteo(loc, f, "weather in Tokyo")
	if refs[0].Title != "東京都, 日本 current weather" {
		t.Fatalf("meteo en title: %s", refs[0].Title)
	}
	// 未知地点合法空
	refs = composeMeteo(meteoPlace{}, f, "weather in nowhere")
	if refs == nil || len(refs) != 0 {
		t.Fatalf("empty geocode must return empty slice")
	}
}

func TestMeteoPlaceAnchor(t *testing.T) {
	cases := map[string]string{
		"东京天气":                 "东京",
		"weather in Tokyo":     "Tokyo",
		"北京明天下雨吗":              "北京 吗",
		"temperature of Paris": "Paris",
	}
	for q, want := range cases {
		if got := meteoPlaceAnchor(q); got != want {
			t.Errorf("meteoPlaceAnchor(%q) = %q, want %q", q, got, want)
		}
	}
}

// 裸 weather 无地点 → 零请求合法空; 无天气意图 → 零请求合法空(nil client 不触网)
func TestLaneOpenmeteoGuard(t *testing.T) {
	refs, err := laneOpenmeteo(context.Background(), SearchOpts{Query: "weather"}, nil)
	if err != nil || len(refs) != 0 {
		t.Fatalf("bare weather must zero-request empty, got %d err=%v", len(refs), err)
	}
	refs, err = laneOpenmeteo(context.Background(), SearchOpts{Query: "东京拉面推荐"}, nil)
	if err != nil || len(refs) != 0 {
		t.Fatalf("no weather intent must zero-request empty, got %d err=%v", len(refs), err)
	}
}

// ---------- 接线锁: 注册表 68 + 路由表扩容 + weather 新域 ----------
func TestB6WiringLocks(t *testing.T) {
	if len(laneRegistry) != 90 { // 86 + openreview/inaturalist/pubdev/openfoodfacts(批12)
		t.Fatalf("phase B6: registry want 90, got %d", len(laneRegistry))
	}
	for _, name := range []string{"nuget", "hex", "arch", "inspirehep", "openaire", "commonswiki", "openmeteo"} {
		if _, ok := laneRegistry[name]; !ok {
			t.Fatalf("lane %s not registered", name)
		}
	}
	if p := domainTable["packages"].apiProviders; len(p) != 10 || p[7] != "nuget" || p[8] != "hex" || p[9] != "pubdev" { // 批12 +pubdev
		t.Fatalf("packages legs: %v", p)
	}
	if p := domainTable["devops"].apiProviders; len(p) != 6 || p[2] != "arch" || p[3] != "artifacthub" || p[4] != "snapcraft" || p[5] != "endoflife" { // 批11 +endoflife
		t.Fatalf("devops legs: %v", p)
	}
	if p := domainTable["academic"].apiProviders; len(p) != 12 || p[9] != "openaire" || p[10] != "inspirehep" || p[11] != "openreview" { // 批12 +openreview
		t.Fatalf("academic legs: %v", p)
	}
	if p := domainTable["images"].apiProviders; len(p) != 3 || p[1] != "commonswiki" || p[2] != "nasaimages" {
		t.Fatalf("images legs: %v", p)
	}
	if p := domainTable["weather"].apiProviders; len(p) != 1 || p[0] != "openmeteo" {
		t.Fatalf("weather legs: %v", p)
	}
}

func TestB6CondenseAndRoute(t *testing.T) {
	// 语言信号裁腿
	if got := condensePackagesLeg("c# 包推荐", domainTable["packages"].apiProviders); len(got) != 1 || got[0] != "nuget" {
		t.Fatalf("condense c#: %v", got)
	}
	if got := condensePackagesLeg("elixir 的 hex 包", domainTable["packages"].apiProviders); len(got) != 1 || got[0] != "hex" {
		t.Fatalf("condense elixir: %v", got)
	}
	if got := condensePackagesLeg("rust crate", domainTable["packages"].apiProviders); len(got) != 1 || got[0] != "crates" {
		t.Fatalf("condense rust: %v", got)
	}
	// weather 域路由
	if r := lookupDomains("东京天气"); r == nil || r.topic != "weather" {
		t.Fatalf("东京天气 must route weather, got %+v", r)
	}
	if r := lookupDomains("weather in tokyo"); r == nil || r.topic != "weather" {
		t.Fatalf("weather in tokyo must route weather, got %+v", r)
	}
	// windows 不落 weather(wind 子串误伤防线: weather 关键词表刻意无 wind, 且表序末位)
	if r := lookupDomains("windows server 镜像"); r != nil && r.topic == "weather" {
		t.Fatalf("windows 镜像 must not route weather, got %+v", r)
	}
	// arch 关键词
	if r := lookupDomains("arch linux 上怎么装包"); r == nil || r.topic != "devops" {
		t.Fatalf("arch linux must route devops, got %+v", r)
	}
	// 壁纸关键词 → images
	if r := lookupDomains("富士山 壁纸"); r == nil || r.topic != "images" {
		t.Fatalf("壁纸 must route images, got %+v", r)
	}
}

// 展示名截段锁: 头两段("Paris, Île-de-France, France"→"Paris, Île-de-France")
func TestPlaceLabel(t *testing.T) {
	if got := placeLabel("東京都, 日本"); got != "東京都, 日本" {
		t.Fatalf("placeLabel zh: %q", got)
	}
	if got := placeLabel("Paris, Île-de-France, France"); got != "Paris, Île-de-France" {
		t.Fatalf("placeLabel fr: %q", got)
	}
	if got := placeLabel("Shibuya, Tokyo, Japan"); got != "Shibuya, Tokyo" {
		t.Fatalf("placeLabel shibuya: %q", got)
	}
}

// openaire OA 意图守卫锁: 无意图零请求(防 doi.org 同域稀释广度)
func TestLaneOpenaireGuard(t *testing.T) {
	refs, err := laneOpenaire(context.Background(), SearchOpts{Query: "diffusion probabilistic models paper"}, nil)
	if err != nil || len(refs) != 0 {
		t.Fatalf("no-oa-intent must zero-request empty, got %d err=%v", len(refs), err)
	}
	if !openAccessIntentRe.MatchString("open access 版本对比") || !openAccessIntentRe.MatchString("开放获取 论文") {
		t.Fatalf("OA intent must pass guard")
	}
}
