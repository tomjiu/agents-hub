package main

// 探针第 10 批测试: thecocktaildb/wikivoyage/uniprot/openvsx/jetbrains/wpplugins/snapcraft + rubygems 清账
// 黄金样本纪律: fixture 形状/字段值全部取自 2026-09-05 实弹响应(/tmp/probe-b10/shapes/), 不靠记忆。

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// ---------- thecocktaildb ----------
const cocktaildbGolden = `{"drinks":[
{"idDrink":"11007","strDrink":"Margarita","strDrinkAlternate":null,"strTags":"IBA,ContemporaryClassic","strVideo":null,"strCategory":"Ordinary Drink","strIBA":"Contemporary Classics","strAlcoholic":"Alcoholic","strGlass":"Cocktail glass","strIngredient1":"Tequila","strIngredient2":"Triple sec","strIngredient3":"Lime juice","strIngredient4":"Salt","strIngredient5":null},
{"idDrink":"","strDrink":"No ID Drink"},
{"idDrink":"99999","strDrink":"","strCategory":"X"}]}`

const cocktaildbNull = `{"drinks":null}`

func TestParseCocktaildb(t *testing.T) {
	refs, err := parseCocktaildb([]byte(cocktaildbGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref (空 idDrink/strDrink 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://www.thecocktaildb.com/drink/11007-margarita" {
		t.Fatalf("cocktaildb url: %s", r.URL)
	}
	if r.Kind != "drinks" || r.Authority != "thecocktaildb.com" {
		t.Fatalf("cocktaildb kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "Margarita" {
		t.Fatalf("cocktaildb title: %s", r.Title)
	}
	want := "Ordinary Drink · Cocktail glass · Tequila / Triple sec / Lime juice"
	if r.Snippet != want {
		t.Fatalf("cocktaildb snippet:\n got %s\nwant %s", r.Snippet, want)
	}
	// 实弹: 无命中词返回 {"drinks":null} — 正常空结果不是错误(themealdb 同款)
	nullRefs, err := parseCocktaildb([]byte(cocktaildbNull), 8)
	if err != nil || len(nullRefs) != 0 {
		t.Fatalf("cocktaildb drinks null: err=%v refs=%d", err, len(nullRefs))
	}
}

// ---------- wikivoyage ----------
const wikivoyageGolden = `{"batchcomplete":"","continue":{"sroffset":5,"continue":"-||"},"query":{"searchinfo":{"totalhits":294},"search":[
{"ns":0,"title":"Kyoto","pageid":18579,"size":62983,"wordcount":8968,"snippet":"<span class=\"searchmatch\">Kyoto</span> is a huge city with several district articles that contain information about specific sights, restaurants, and accommodation. <span class=\"searchmatch\">Kyōto</span> (京都) was the","timestamp":"2026-09-03T03:37:32Z"},
{"ns":0,"title":"","pageid":1,"snippet":"no title"},
{"ns":0,"title":"No ID","pageid":0,"snippet":"zero pageid"}]}}`

func TestParseWikivoyage(t *testing.T) {
	refs, err := parseWikivoyage([]byte(wikivoyageGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref (空 title/pageid=0 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://en.wikivoyage.org/wiki/Kyoto" {
		t.Fatalf("wikivoyage url: %s", r.URL)
	}
	if r.Kind != "travel" || r.Authority != "en.wikivoyage.org" {
		t.Fatalf("wikivoyage kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "Kyoto" {
		t.Fatalf("wikivoyage title: %s", r.Title)
	}
	// 实弹 snippet 带 <span class="searchmatch"> 高亮 — stripHtmlSnip 剥离后保留正文与 CJK
	if !strings.HasPrefix(r.Snippet, "Kyoto is a huge city") {
		t.Fatalf("wikivoyage snippet 前缀: %s", r.Snippet)
	}
	if strings.Contains(r.Snippet, "<span") || strings.Contains(r.Snippet, "searchmatch") {
		t.Fatalf("wikivoyage snippet 未剥离 HTML: %s", r.Snippet)
	}
	if !strings.Contains(r.Snippet, "京都") {
		t.Fatalf("wikivoyage snippet 丢失 CJK: %s", r.Snippet)
	}
}

// ---------- uniprot ----------
const uniprotGolden = `{"results":[
{"entryType":"UniProtKB reviewed (Swiss-Prot)","primaryAccession":"P01308","secondaryAccessions":["Q5EEX2"],"uniProtkbId":"INS_HUMAN","organism":{"scientificName":"Homo sapiens","commonName":"Human","taxonId":9606},"proteinDescription":{"recommendedName":{"fullName":{"value":"Insulin"}}},"sequence":{"length":110}},
{"entryType":"UniProtKB reviewed (Swiss-Prot)","primaryAccession":"P42212","uniProtkbId":"GFP_AEQVI","organism":{"scientificName":"Aequorea victoria"},"proteinDescription":{"recommendedName":{"fullName":{"value":"GFP"}}},"sequence":{"length":238}},
{"entryType":"X","primaryAccession":"","uniProtkbId":"NO_ACC"},
{"entryType":"UniProtKB reviewed (Swiss-Prot)","primaryAccession":"Q9XXXX","uniProtkbId":"","proteinDescription":{},"sequence":{"length":0}}]}`

func TestParseUniprot(t *testing.T) {
	refs, err := parseUniprot([]byte(uniprotGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs (空 accession/无名字跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://www.uniprot.org/uniprotkb/P01308" {
		t.Fatalf("uniprot url: %s", r.URL)
	}
	if r.Kind != "species" || r.Authority != "uniprot.org" {
		t.Fatalf("uniprot kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "Insulin" {
		t.Fatalf("uniprot title: %s", r.Title)
	}
	want := "Homo sapiens · Human · 110 aa"
	if r.Snippet != want {
		t.Fatalf("uniprot snippet:\n got %s\nwant %s", r.Snippet, want)
	}
	if refs[1].Title != "GFP" {
		t.Fatalf("uniprot refs[1] title: %s", refs[1].Title)
	}
}

// ---------- openvsx ----------
const openvsxGolden = `{"offset":0,"totalSize":453,"extensions":[
{"averageRating":4.5,"deprecated":false,"description":"Rust language support for Visual Studio Code","displayName":"rust-analyzer","downloadCount":6720147,"name":"rust-analyzer","namespace":"rust-lang","url":"https://open-vsx.org/api/rust-lang/rust-analyzer","version":"0.4.3038"},
{"deprecated":true,"displayName":"Deprecated Ext","description":"old","downloadCount":10,"name":"old-ext","namespace":"old-ns"},
{"deprecated":false,"displayName":"No NS","description":"","downloadCount":5,"name":"noname","namespace":""}]}`

func TestParseOpenvsx(t *testing.T) {
	refs, err := parseOpenvsx([]byte(openvsxGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref (deprecated=true/空 namespace 跳过), got %d", len(refs))
	}
	r := refs[0]
	// 响应自带 url 是 API 链接(/api/...), 规范页=extension/{ns}/{name}(实弹 200 验证)
	if r.URL != "https://open-vsx.org/extension/rust-lang/rust-analyzer" {
		t.Fatalf("openvsx url: %s", r.URL)
	}
	if r.Kind != "ide-ext" || r.Authority != "open-vsx.org" {
		t.Fatalf("openvsx kind/authority: %s/%s", r.Kind, r.Authority)
	}
	want := "Rust language support for Visual Studio Code · ↓6.7M"
	if r.Snippet != want {
		t.Fatalf("openvsx snippet:\n got %s\nwant %s", r.Snippet, want)
	}
}

// ---------- jetbrains ----------
const jetbrainsGolden = `{"plugins":[
{"id":6954,"xmlId":"org.jetbrains.kotlin","link":"/plugin/6954-kotlin","name":"Kotlin","preview":"Provides language support for Kotlin, a modern programming language designed to make developers happier. Getting Started Public Slack Issue tracker.","downloads":37733283,"vendor":{"name":"JetBrains s.r.o."}},
{"id":0,"name":"No ID","link":"/plugin/0-no","preview":""},
{"id":999,"name":"Bad Link","link":"javascript:void(0)","preview":""}]}`

func TestParseJetbrains(t *testing.T) {
	refs, err := parseJetbrains([]byte(jetbrainsGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref (id=0/非 /plugin/ link 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://plugins.jetbrains.com/plugin/6954-kotlin" {
		t.Fatalf("jetbrains url: %s", r.URL)
	}
	if r.Kind != "ide-ext" || r.Authority != "plugins.jetbrains.com" {
		t.Fatalf("jetbrains kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "Kotlin" {
		t.Fatalf("jetbrains title: %s", r.Title)
	}
	want := "Provides language support for Kotlin, a modern programming language designed to make developers happier. Getting Started Public Slack Issue tracker. · ↓37.7M · JetBrains s.r.o."
	if r.Snippet != want {
		t.Fatalf("jetbrains snippet:\n got %s\nwant %s", r.Snippet, want)
	}
}

// ---------- wpplugins ----------
const wppluginsGolden = `{"info":{"page":1,"pages":50,"results":7781},"plugins":[
{"name":"Rank Math SEO – AI SEO Tools to Dominate SEO Rankings","slug":"seo-by-rank-math","version":"1.0.277.2","author":"<a href=\"https://profiles.wordpress.org/rankmath/\">Rank Math SEO</a>","short_description":"Grow your organic traffic and AI visibility with powerful SEO tools, XML sitemaps, Schema automation, and built-in AI SEO, all in one place.","rating":96,"active_installs":4000000},
{"name":"No Slug","slug":"","version":"1.0"},
{"name":"Zero Meta","slug":"zero-meta","version":"1.0","short_description":"just a plugin","rating":0,"active_installs":0}]}`

func TestParseWpplugins(t *testing.T) {
	refs, err := parseWpplugins([]byte(wppluginsGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs (空 slug 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://wordpress.org/plugins/seo-by-rank-math" {
		t.Fatalf("wpplugins url: %s", r.URL)
	}
	if r.Kind != "wordpress" || r.Authority != "wordpress.org" {
		t.Fatalf("wpplugins kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "Rank Math SEO – AI SEO Tools to Dominate SEO Rankings" {
		t.Fatalf("wpplugins title: %s", r.Title)
	}
	want := "Grow your organic traffic and AI visibility with powerful SEO tools, XML sitemaps, Schema automation, and built-in AI SEO, all in one place. · ★96% · 4.0M+ active"
	if r.Snippet != want {
		t.Fatalf("wpplugins snippet:\n got %s\nwant %s", r.Snippet, want)
	}
	if refs[1].Snippet != "just a plugin" {
		t.Fatalf("wpplugins 零 meta snippet: %s", refs[1].Snippet)
	}
}

// ---------- snapcraft ----------
const snapcraftGolden = `{"_embedded":{"clickindex:package":[
{"name":"firefox.mozilla","title":"firefox","summary":"Mozilla Firefox web browser","developer_name":"Mozilla","links":{"website":["https://www.mozilla.org/firefox/"]}},
{"name":"plain-snap","title":"Plain Snap","summary":"A plain snap","developer_name":"","links":{}},
{"name":"dotted.no-website","title":"Dotted","summary":"no website link","developer_name":"X","links":{}}]}}`

func TestParseSnapcraft(t *testing.T) {
	refs, err := parseSnapcraft([]byte(snapcraftGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs (点名无 website 跳过—防死链), got %d", len(refs))
	}
	r := refs[0]
	// 实弹: 点名 snap(firefox.mozilla) 无 snapcraft.io 规范页(404), 用 links.website[0] 可达页
	if r.URL != "https://www.mozilla.org/firefox/" {
		t.Fatalf("snapcraft url: %s", r.URL)
	}
	if r.Kind != "devops" || r.Authority != "snapcraft.io" {
		t.Fatalf("snapcraft kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "firefox" {
		t.Fatalf("snapcraft title: %s", r.Title)
	}
	if r.Snippet != "Mozilla Firefox web browser · Mozilla" {
		t.Fatalf("snapcraft snippet: %s", r.Snippet)
	}
	if refs[1].URL != "https://snapcraft.io/plain-snap" {
		t.Fatalf("snapcraft 纯名回退 url: %s", refs[1].URL)
	}
}

// ---------- rubygems 清账锁(批 9 挂账: 词面性空结果不再报错) ----------
func TestRubygemsZeroResultNoError(t *testing.T) {
	refs, err := parseRubygems([]byte(`[]`), 8)
	if err != nil {
		t.Fatalf("rubygems 空数组不应报错(熔断根因已修): %v", err)
	}
	if len(refs) != 0 {
		t.Fatalf("rubygems 空数组 refs: %d", len(refs))
	}
	refs, err = parseRubygems([]byte(`[{"name":"rails","version":"8.1.3.1","info":"Ruby on Rails is a full-stack web framework.","downloads":784110012,"project_uri":"https://rubygems.org/gems/rails"}]`), 8)
	if err != nil || len(refs) != 1 {
		t.Fatalf("rubygems 正常解析: err=%v refs=%d", err, len(refs))
	}
	if refs[0].URL != "https://rubygems.org/gems/rails" {
		t.Fatalf("rubygems url: %s", refs[0].URL)
	}
}

// ---------- 接线锁: planner 路由 + 注册面 ----------
func TestPlannerB10Routes(t *testing.T) {
	cases := []struct {
		q    string
		want string
	}{
		{"margarita 鸡尾酒配方", "thecocktaildb"},
		{"mojito cocktail recipe", "thecocktaildb"},
		{"东京旅行攻略", "wikivoyage"},
		{"kyoto things to do in", "wikivoyage"},
		{"推荐 vscode 插件", "openvsx"},
		{"best vscode extension", "openvsx"},
		{"pycharm 插件推荐", "jetbrains"},
		{"最好的 wordpress 插件", "wpplugins"},
		{"woocommerce 支付插件", "wpplugins"},
		{"胰岛素蛋白质结构", "uniprot"},
		{"GFP protein structure", "uniprot"},
		{"snapcraft 好用吗", "snapcraft"},
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
	// 反例: 泛词不得引出窄域腿(防烧配额/防错域)
	for _, q := range []string{"最新新闻", "css 动画教程", "npm 包推荐", "bitcoin 价格", "红烧肉的菜谱", "蛋白粉推荐"} {
		if route := lookupDomains(q); route != nil {
			for _, narrow := range []string{"thecocktaildb", "wikivoyage", "openvsx", "jetbrains", "wpplugins", "uniprot", "snapcraft"} {
				if containsStr(route.apiProviders, narrow) {
					t.Fatalf("q=%q 误引窄域腿 %s: %v", q, narrow, route.apiProviders)
				}
			}
		}
	}
}

func TestB10Registered(t *testing.T) {
	for _, name := range []string{"thecocktaildb", "wikivoyage", "uniprot", "openvsx", "jetbrains", "wpplugins", "snapcraft"} {
		if _, ok := laneRegistry[name]; !ok {
			t.Fatalf("laneRegistry 缺 %s", name)
		}
	}
	if len(laneRegistry) != 90 { // 86 + openreview/inaturalist/pubdev/openfoodfacts(批12)
		t.Fatalf("laneRegistry 总数: got %d want 90", len(laneRegistry))
	}
}

// ---------- 守卫回归: 窄域 lane 在拒连 transport 下不得 panic ----------
type b10DenyTransport struct{}

func (b10DenyTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, context.Canceled
}

func TestB10LanesNotPanicked(t *testing.T) {
	client := &http.Client{Transport: b10DenyTransport{}}
	opts := SearchOpts{Query: "test", MaxResults: 5}
	ctx := context.Background()
	for _, fn := range []LaneFn{laneCocktaildb, laneWikivoyage, laneUniprot, laneOpenvsx, laneJetbrains, laneWpplugins, laneSnapcraft, laneRubygems} {
		_, _ = fn(ctx, opts, client) // transport 拒绝合法 err, 只验不 panic
	}
}
