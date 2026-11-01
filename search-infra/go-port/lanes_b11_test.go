package main

// 探针第 11 批测试: mangadex/lrclib/pubchem/usgsquakes/endoflife/frankfurter
// 黄金样本纪律: fixture 形状/字段值全部取自 2026-09-05 实弹响应(/tmp/probe-b11/shapes/), 不靠记忆。

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// ---------- mangadex ----------
// 实弹 one piece 首条(One Piece Academy) + 实弹 frieren Cinnamoroll(仅 ja-ro 主标题, en 在 altTitles)
const mangadexGolden = `{"result":"ok","response":"collection","data":[
{"id":"b70113a5-32a3-44e8-a28f-0e88392808ba","type":"manga","attributes":{
"title":{"en":"One Piece Academy"},
"altTitles":[{"ja":"ONE PIECE学園"},{"ja-ro":"One Piece Gakuen"},{"en":"One Piece School"}],
"description":{"en":"A spin off where the One Piece cast goes to a big academy & lives modern lives.","vi":"One Piece phiên bản học đường"},
"originalLanguage":"ja","status":"ongoing","year":2019,"contentRating":"safe",
"tags":[{"id":"391b0423","type":"tag","attributes":{"name":{"en":"Action"},"group":"genre"}},{"id":"4d32cc48","type":"tag","attributes":{"name":{"en":"Comedy"},"group":"genre"}},{"id":"87cc87cd","type":"tag","attributes":{"name":{"en":"Adventure"},"group":"genre"}},{"id":"caaa44eb","type":"tag","attributes":{"name":{"en":"School Life"},"group":"theme"}}]}},
{"id":"d1e038c4-d931-4525-9b1b-b943e2a7d7e1","type":"manga","attributes":{
"title":{"ja-ro":"Frieren Cinnamoroll Kamigata"},
"altTitles":[{"pt-br":"Fern Amarra o Cabelo de Frieren."},{"en":"Fern ties Frieren's hair"},{"ja":"フリーレンシナモロール髪型"}],
"description":{},"status":"completed","year":2026,"contentRating":"safe",
"tags":[{"id":"0234a31e","type":"tag","attributes":{"name":{"en":"Oneshot"},"group":"format"}},{"id":"4d32cc48","type":"tag","attributes":{"name":{"en":"Comedy"},"group":"genre"}}]}},
{"id":"","type":"manga","attributes":{"title":{"en":"No ID"}}}]}`

func TestParseMangadex(t *testing.T) {
	refs, err := parseMangadex([]byte(mangadexGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs (空 id 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://mangadex.org/title/b70113a5-32a3-44e8-a28f-0e88392808ba" {
		t.Fatalf("mangadex url: %s", r.URL)
	}
	if r.Kind != "manga" || r.Authority != "mangadex.org" {
		t.Fatalf("mangadex kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "One Piece Academy" {
		t.Fatalf("mangadex title: %s", r.Title)
	}
	if !strings.HasPrefix(r.Snippet, "A spin off where the One Piece cast") {
		t.Fatalf("mangadex snippet 前缀: %s", r.Snippet)
	}
	if !strings.Contains(r.Snippet, " · Action/Comedy/Adventure") || !strings.Contains(r.Snippet, " · ongoing") || !strings.Contains(r.Snippet, " · 2019") {
		t.Fatalf("mangadex snippet 元数据: %s", r.Snippet)
	}
	// 标题择优: 仅 ja-ro 主标题 → altTitles 的 en 胜出(实弹形状)
	if refs[1].Title != "Fern ties Frieren's hair" {
		t.Fatalf("mangadex altTitles en 择优: %s", refs[1].Title)
	}
	// description 为空 map → 摘要从标签起, 无前导分隔符
	if refs[1].Snippet != "Oneshot/Comedy · completed · 2026" {
		t.Fatalf("mangadex 空 desc 摘要: %s", refs[1].Snippet)
	}
}

// ---------- lrclib ----------
// 实弹"晴天 周杰伦"首条 + 同曲多版本去重(实弹 shape of you 同 trackName+artistName 多条) + 纯音乐
const lrclibGolden = `[
{"id":7976416,"name":"晴天","trackName":"晴天","artistName":"周杰伦","albumName":"晴天","duration":270.0,"instrumental":false,"plainLyrics":"故事的小黃花\n從出生那年就飄著\n童年的盪鞦韆\n隨記憶一直晃到現在","syncedLyrics":"[00:29.30] 故事的小黃花"},
{"id":7976417,"name":"晴天","trackName":"晴天","artistName":"周杰伦","albumName":"晴天","duration":270.0,"instrumental":false,"plainLyrics":"故事的小黃花","syncedLyrics":"[00:29.30] 故事的小黃花"},
{"id":35538591,"name":"hello adele","trackName":"hello","artistName":"Adele","albumName":"25","duration":295.0,"instrumental":true,"plainLyrics":""},
{"id":0,"name":"no id","trackName":"No ID","artistName":"X","albumName":"","duration":0,"instrumental":false,"plainLyrics":"x"}]`

func TestParseLrclib(t *testing.T) {
	refs, err := parseLrclib([]byte(lrclibGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 { // 同曲+同歌手去重(7976417), id=0 跳过
		t.Fatalf("want 2 refs, got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://lrclib.net/track/7976416" {
		t.Fatalf("lrclib url: %s", r.URL)
	}
	if r.Kind != "lyrics" || r.Authority != "lrclib.net" {
		t.Fatalf("lrclib kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "晴天 — 周杰伦" {
		t.Fatalf("lrclib title: %s", r.Title)
	}
	// 歌词预览取前两行非空 + 专辑
	want := "故事的小黃花 / 從出生那年就飄著 · 晴天"
	if r.Snippet != want {
		t.Fatalf("lrclib snippet:\n got %s\nwant %s", r.Snippet, want)
	}
	if refs[1].Title != "hello — Adele" {
		t.Fatalf("lrclib title 2: %s", refs[1].Title)
	}
	if refs[1].Snippet != "纯音乐 (Instrumental) · 25" {
		t.Fatalf("lrclib instrumental snippet: %s", refs[1].Snippet)
	}
}

// ---------- pubchem ----------
// 实弹 glucose 属性响应(轮 2)
const pubchemGolden = `{"PropertyTable":{"Properties":[{"CID":5793,"MolecularFormula":"C6H12O6","MolecularWeight":"180.16","IUPACName":"(3R,4S,5S,6R)-6-(hydroxymethyl)oxane-2,3,4,5-tetrol"}]}}`

func TestParsePubchem(t *testing.T) {
	refs, err := parsePubchem([]byte(pubchemGolden), "glucose", 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref, got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://pubchem.ncbi.nlm.nih.gov/compound/5793" {
		t.Fatalf("pubchem url: %s", r.URL)
	}
	if r.Kind != "chemistry" || r.Authority != "pubchem.ncbi.nlm.nih.gov" {
		t.Fatalf("pubchem kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "glucose (C6H12O6)" {
		t.Fatalf("pubchem title: %s", r.Title)
	}
	want := "CID 5793 · C6H12O6 · MW 180.16 · IUPAC (3R,4S,5S,6R)-6-(hydroxymethyl)oxane-2,3,4,5-tetrol"
	if r.Snippet != want {
		t.Fatalf("pubchem snippet:\n got %s\nwant %s", r.Snippet, want)
	}
}

func TestPubchemAnchor(t *testing.T) {
	cases := []struct {
		q    string
		want string
	}{
		{"glucose 分子式", "glucose"},
		{"caffeine molecular formula", "caffeine"},
		{"aspirin 的分子量是多少", "aspirin"},
		{"分子式是什么", ""},            // 纯中文: pubchem 名直查 404(实弹), 合法空
		{"molecular formula", ""}, // 纯意图词
	}
	for _, c := range cases {
		if got := b11ChemAnchor(c.q); got != c.want {
			t.Fatalf("b11ChemAnchor(%q)=%q want %q", c.q, got, c.want)
		}
	}
}

// ---------- usgsquakes ----------
// 实弹 minmagnitude=6 首条(Alaska M6.3, tsunami=1, alert=green)
const usgsGolden = `{"type":"FeatureCollection","features":[
{"type":"Feature","properties":{"mag":6.3,"place":"84 km SSW of Nikolski, Alaska","time":1788434244056,"url":"https://earthquake.usgs.gov/earthquakes/eventpage/us7000tdvt","tsunami":1,"alert":"green","magType":"mww","title":"M 6.3 - 84 km SSW of Nikolski, Alaska"},"geometry":{"type":"Point","coordinates":[-169.4088,52.2579,35]},"id":"us7000tdvt"},
{"type":"Feature","properties":{"mag":6.2,"place":"South Sandwich Islands region","time":1788392817617,"url":"https://earthquake.usgs.gov/earthquakes/eventpage/us7000tdrv","tsunami":0,"alert":"","title":"M 6.2 - South Sandwich Islands region"},"geometry":{"type":"Point"},"id":"us7000tdrv"},
{"type":"Feature","properties":{"mag":0,"place":"","time":0,"url":"","title":""},"id":"empty"}]}`

func TestParseUsgsQuakes(t *testing.T) {
	refs, err := parseUsgsQuakes([]byte(usgsGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs (空 url 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://earthquake.usgs.gov/earthquakes/eventpage/us7000tdvt" {
		t.Fatalf("usgs url: %s", r.URL)
	}
	if r.Kind != "geo" || r.Authority != "earthquake.usgs.gov" {
		t.Fatalf("usgs kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "M 6.3 - 84 km SSW of Nikolski, Alaska" {
		t.Fatalf("usgs title: %s", r.Title)
	}
	// 实弹时间戳 1788434244056ms → UTC 2026-09-03; tsunami=1 + alert
	want := "84 km SSW of Nikolski, Alaska · M6.3 · 2026-09-03 · 海啸预警 · alert:green"
	if r.Snippet != want {
		t.Fatalf("usgs snippet:\n got %s\nwant %s", r.Snippet, want)
	}
	if strings.Contains(refs[1].Snippet, "海啸") || strings.Contains(refs[1].Snippet, "alert:") {
		t.Fatalf("usgs snippet 2 无 tsunami/alert 不得拼空段: %s", refs[1].Snippet)
	}
}

func TestUsgsQuakeGuard(t *testing.T) {
	for _, q := range []string{"最近地震", "最新地震", "今天地震", "近期地震", "recent earthquake", "latest earthquakes", "earthquake today"} {
		if !b11QuakeWordRe.MatchString(q) {
			t.Fatalf("guard 应命中: %s", q)
		}
	}
	// 泛词不收: 历史/成因/科普类误引会把意图解析型车道变成答非所问
	for _, q := range []string{"日本地震历史", "地震是怎么形成的", "地震带分布", "css 动画教程"} {
		if b11QuakeWordRe.MatchString(q) {
			t.Fatalf("guard 不得命中: %s", q)
		}
	}
}

// ---------- endoflife ----------
// 实弹 python.json 前 3 cycle + go.json 1.25 已 eol 形态(eol 为字符串/布尔双形态)
const eolGolden = `[
{"cycle":"3.14","releaseDate":"2025-10-07","eol":"2030-10-31","latest":"3.14.7","latestReleaseDate":"2026-08-05","pep":"PEP-0745","lts":false,"support":"2027-10-01"},
{"cycle":"3.13","releaseDate":"2024-10-07","eol":"2029-10-31","latest":"3.13.15","latestReleaseDate":"2026-08-05","pep":"PEP-0719","lts":false,"support":"2026-10-01"},
{"cycle":"1.25","releaseDate":"2025-08-12","eol":false,"latest":"1.25.14","latestReleaseDate":"2026-08-19","lts":false}]`

func TestParseEndoflife(t *testing.T) {
	refs, err := parseEndoflife([]byte(eolGolden), "python", 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 { // 产品页单 ref 聚合(同 URL 多 ref 会被融合层错位合并, 实弹抓获)
		t.Fatalf("want 1 ref, got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://endoflife.date/python" {
		t.Fatalf("eol url: %s", r.URL)
	}
	if r.Kind != "devops" || r.Authority != "endoflife.date" {
		t.Fatalf("eol kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "python 版本支持与 EOL (最新 3.14.7)" {
		t.Fatalf("eol title: %s", r.Title)
	}
	want := "3.14 · latest 3.14.7 · EOL 2030-10-31 · 支持 2027-10-01 / 3.13 · latest 3.13.15 · EOL 2029-10-31 · 支持 2026-10-01 / 1.25 · latest 1.25.14 · EOL 在役"
	if r.Snippet != want {
		t.Fatalf("eol snippet:\n got %s\nwant %s", r.Snippet, want)
	}
}

func TestEolSlug(t *testing.T) {
	slugs := []string{"python", "go", "nodejs", "django", "windows", "ubuntu"}
	cases := []struct {
		q    string
		want string
	}{
		{"python eol 还支持多久", "python"},
		{"golang eol 时间", "go"}, // 别名表
		{"nodejs end of life", "nodejs"},
		{"ubuntu lts 生命周期", "ubuntu"},
		{"eol", ""},         // 无产品词面
		{"quantum eol", ""}, // 非产品 slug
	}
	for _, c := range cases {
		if got := b11EolSlug(c.q, slugs); got != c.want {
			t.Fatalf("b11EolSlug(%q)=%q want %q", c.q, got, c.want)
		}
	}
}

func TestEolGuard(t *testing.T) {
	for _, q := range []string{"python eol", "python end of life", "版本支持", "停止维护", "python 还支持多久", "nodejs support until"} {
		if !b11EolWordRe.MatchString(q) {
			t.Fatalf("guard 应命中: %s", q)
		}
	}
	for _, q := range []string{"python 教程", "rust 入门", "npm 包推荐"} {
		if b11EolWordRe.MatchString(q) {
			t.Fatalf("guard 不得命中: %s", q)
		}
	}
}

// ---------- frankfurter ----------
// 实弹 USD latest 响应
const fxGolden = `{"amount":1.0,"base":"USD","date":"2026-09-04","rates":{"CNY":6.7109,"EUR":0.86044}}`

var fxValid = map[string]string{
	"USD": "United States Dollar", "CNY": "Chinese Renminbi Yuan", "JPY": "Japanese Yen",
	"EUR": "Euro", "GBP": "British Pound", "HKD": "Hong Kong Dollar", "AUD": "Australian Dollar",
	"CHF": "Swiss Franc", "CAD": "Canadian Dollar", "KRW": "South Korean Won",
	"NOK": "Norwegian Krone", "SEK": "Swedish Krona",
}

func TestParseFrankfurter(t *testing.T) {
	refs, err := parseFrankfurter([]byte(fxGolden), "USD", []string{"CNY", "EUR"}, fxValid, 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs, got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://frankfurter.dev/2026-09-04/USD/CNY" {
		t.Fatalf("fx url: %s", r.URL)
	}
	if r.Kind != "finance" || r.Authority != "frankfurter.dev" {
		t.Fatalf("fx kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "1 USD = 6.7109 CNY" {
		t.Fatalf("fx title: %s", r.Title)
	}
	want := "ECB 参考汇率 2026-09-04 · United States Dollar ↔ Chinese Renminbi Yuan"
	if r.Snippet != want {
		t.Fatalf("fx snippet:\n got %s\nwant %s", r.Snippet, want)
	}
}

func TestFxCodes(t *testing.T) {
	cases := []struct {
		q    string
		want []string
	}{
		{"USD to CNY 汇率", []string{"USD", "CNY"}},
		{"usd 换 cny", []string{"USD", "CNY"}},
		{"美元兑日元", []string{"USD", "JPY"}},
		{"人民币换美元", []string{"CNY", "USD"}}, // 位置序: 人民币在前
		{"澳元兑美元", []string{"AUD", "USD"}},
		{"澳大利亚元兑美元", []string{"AUD", "USD"}}, // 长别名胜出, 不重复提码
		{"gbp jpy exchange rate", []string{"GBP", "JPY"}},
		{"人民币汇率", []string{"CNY"}}, // 单币提码合法, 币对不足由 lane 层归零
		{"比特币汇率", nil},             // 币名不在 ECB 官方集
	}
	for _, c := range cases {
		got := b11FxCodes(c.q, fxValid)
		if len(got) != len(c.want) {
			t.Fatalf("b11FxCodes(%q)=%v want %v", c.q, got, c.want)
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Fatalf("b11FxCodes(%q)=%v want %v", c.q, got, c.want)
			}
		}
	}
}

func TestFxGuard(t *testing.T) {
	for _, q := range []string{"美元兑日元 汇率", "usd to cny exchange rate", "人民币汇率换算", "currency converter"} {
		if !b11FxWordRe.MatchString(q) {
			t.Fatalf("guard 应命中: %s", q)
		}
	}
	for _, q := range []string{"bitcoin 价格", "去美国旅游攻略", "最新新闻"} {
		if b11FxWordRe.MatchString(q) {
			t.Fatalf("guard 不得命中: %s", q)
		}
	}
}

// 实弹抓获: "晴天 歌词"全灭(意图词混入曲名索引) → 意图词剥离重查(gbif 疑问后缀剥离同款)
func TestStripLyricIntent(t *testing.T) {
	cases := []struct {
		q    string
		want string
	}{
		{"晴天 歌词", "晴天"},
		{"shape of you lyrics", "shape of you"},
		{"晴天 歌词是什么", "晴天"},
		{"歌词", ""},           // 全剥光 → 不重查
		{"周杰伦 晴天", "周杰伦 晴天"}, // 无意图词原样(指针不同亦可, lane 判 != 才重查)
	}
	for _, c := range cases {
		if got := b11StripLyricIntent(c.q); got != c.want {
			t.Fatalf("b11StripLyricIntent(%q)=%q want %q", c.q, got, c.want)
		}
	}
}

// ---------- 路由锁 ----------
func TestPlannerB11Routes(t *testing.T) {
	cases := []struct {
		q    string
		want string
	}{
		{"frieren 漫画", "mangadex"},
		{"漫画推荐", "mangadex"},
		{"晴天 歌词", "lrclib"},
		{"shape of you lyrics", "lrclib"},
		{"glucose 分子式", "pubchem"},
		{"caffeine molar mass", "pubchem"},
		{"python eol 版本支持", "endoflife"},
		{"python 还支持多久", "endoflife"},
		{"最近地震", "usgsquakes"},
		{"earthquake today", "usgsquakes"},
		{"USD to CNY 汇率", "frankfurter"},
		{"美元兑日元 汇率", "frankfurter"},
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
	// 反例: 泛词不得引出窄域腿(防烧配额/防错域); "日本地震历史"须引 geo 但不得带 usgsquakes 由守卫归零
	for _, q := range []string{"最新新闻", "css 动画教程", "npm 包推荐", "红烧肉的菜谱", "日本地震历史"} {
		if route := lookupDomains(q); route != nil {
			for _, narrow := range []string{"mangadex", "lrclib", "pubchem", "usgsquakes", "endoflife", "frankfurter"} {
				if containsStr(route.apiProviders, narrow) {
					t.Fatalf("q=%q 误引窄域腿 %s: %v", q, narrow, route.apiProviders)
				}
			}
		}
	}
	// "bitcoin 价格" 合法引 finance(coingecko 承接); frankfurter 随域挂载但 lane 守卫归零, 其余新腿不得出现
	if route := lookupDomains("bitcoin 价格"); route != nil {
		if !containsStr(route.apiProviders, "coingecko") {
			t.Fatalf("bitcoin 价格 应引 finance/coingecko: %v", route.apiProviders)
		}
		for _, narrow := range []string{"mangadex", "lrclib", "pubchem", "usgsquakes", "endoflife"} {
			if containsStr(route.apiProviders, narrow) {
				t.Fatalf("bitcoin 价格 误引 %s: %v", narrow, route.apiProviders)
			}
		}
	}
	// "日本地震历史"不引任何域(泛"地震"不收为域词面的设计验证, 走 web 通用池)
	if route := lookupDomains("日本地震历史"); route != nil && containsStr(route.apiProviders, "usgsquakes") {
		t.Fatalf("日本地震历史 不得引出 usgsquakes: %v", route.apiProviders)
	}
}

// ---------- 注册锁 ----------
func TestB11Registered(t *testing.T) {
	for _, name := range []string{"mangadex", "lrclib", "pubchem", "usgsquakes", "endoflife", "frankfurter"} {
		if _, ok := laneRegistry[name]; !ok {
			t.Fatalf("laneRegistry 缺 %s", name)
		}
	}
	if len(laneRegistry) != 90 { // 86 + openreview/inaturalist/pubdev/openfoodfacts(批12)
		t.Fatalf("laneRegistry 总数: got %d want 90", len(laneRegistry))
	}
}

// ---------- 守卫回归: 窄域 lane 在拒连 transport 下不得 panic ----------
type b11DenyTransport struct{}

func (b11DenyTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, context.Canceled
}

func TestB11LanesNotPanicked(t *testing.T) {
	client := &http.Client{Transport: b11DenyTransport{}}
	opts := SearchOpts{Query: "test", MaxResults: 5}
	ctx := context.Background()
	for _, fn := range []LaneFn{laneMangadex, laneLrclib, lanePubchem, laneUsgsQuakes, laneEndoflife, laneFrankfurter} {
		_, _ = fn(ctx, opts, client) // transport 拒绝合法 err, 只验不 panic
	}
	// 意图解析型守卫: 非意图词零请求直接空
	empty, err := laneUsgsQuakes(ctx, SearchOpts{Query: "python 教程", MaxResults: 5}, client)
	if err != nil || len(empty) != 0 {
		t.Fatalf("usgsquakes 非地震意图应合法空: err=%v refs=%v", err, empty)
	}
	empty, err = laneEndoflife(ctx, SearchOpts{Query: "python 教程", MaxResults: 5}, client)
	if err != nil || len(empty) != 0 {
		t.Fatalf("endoflife 无 eol 意图应合法空: err=%v refs=%v", err, empty)
	}
	empty, err = laneFrankfurter(ctx, SearchOpts{Query: "bitcoin 价格", MaxResults: 5}, client)
	if err != nil || len(empty) != 0 {
		t.Fatalf("frankfurter 无汇率意图应合法空: err=%v refs=%v", err, empty)
	}
	empty, err = lanePubchem(ctx, SearchOpts{Query: "分子式是什么", MaxResults: 5}, client)
	if err != nil || len(empty) != 0 {
		t.Fatalf("pubchem 纯中文无锚应合法空: err=%v refs=%v", err, empty)
	}
}
