package main

// 探针第 7 批测试: artifacthub/nasaimages/musicbrainz/mozaddons/thespacedevs
// 黄金样本纪律: fixture 形状/字段值全部取自 2026-09-05 实弹响应(/tmp/probe-b7/shapes/), 不靠记忆。

import (
	"context"
	"net/http"
	"testing"
)

// ---------- artifacthub ----------
const artifacthubGolden = `{"packages":[
{"package_id":"7918f2cb-0742-4993-b58a-673129604cf6","name":"kube-prometheus-stack","normalized_name":"kube-prometheus-stack","category":4,"logo_image_id":"0503add5-3fce-4b63-bbf3-b9f649512a86","stars":1233,"official":true,"description":"kube-prometheus-stack collects Kubernetes manifests, Grafana dashboards, and Prometheus rules combined with documentation and scripts.","version":"89.2.2","app_version":"v0.93.1","license":"Apache-2.0","deprecated":false,"ts":1788552526,"repository":{"url":"https://prometheus-community.github.io/helm-charts","organization_name":"prometheus","name":"prometheus-community"}},
{"name":"legacy-chart","normalized_name":"legacy-chart","version":"1.0.0","description":"old chart","stars":0,"official":false,"license":"","deprecated":true,"repository":{"organization_name":"someone","name":"someone-repo"}}
]}`

func TestParseArtifacthub(t *testing.T) {
	refs, err := parseArtifacthub([]byte(artifacthubGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs, got %d", len(refs))
	}
	r := refs[0]
	// 页面 URL 构造: 实弹 200 闭环验证过的 /packages/helm/{organization_name}/{normalized_name}
	if r.URL != "https://artifacthub.io/packages/helm/prometheus/kube-prometheus-stack" {
		t.Fatalf("artifacthub url: %s", r.URL)
	}
	if r.Kind != "devops" || r.Authority != "artifacthub.io" {
		t.Fatalf("artifacthub kind/authority: %s/%s", r.Kind, r.Authority)
	}
	want := "kube-prometheus-stack collects Kubernetes manifests, Grafana dashboards, and Prometheus rules combined with documentation and scripts. · 89.2.2 · 1233 stars · Apache-2.0 · official"
	if r.Snippet != want {
		t.Fatalf("artifacthub snippet:\n got %s\nwant %s", r.Snippet, want)
	}
	if refs[1].Snippet != "old chart · 1.0.0 · DEPRECATED" {
		t.Fatalf("artifacthub r1 snippet: %s", refs[1].Snippet) // 无 stars/license, 带 DEPRECATED
	}
}

// ---------- nasaimages ----------
const nasaimagesGolden = `{"collection":{"version":"1.1","items":[
{"href":"https://images-assets.nasa.gov/image/jsc2007e034221/collection.json","data":[{"album":["KSC_50th_Anniversary"],"center":"JSC","date_created":"1969-07-11T00:00:00Z","description":"Personnel atop the 402-ft. Mobile Service Structure look back at the Apollo 11 spacecraft as the tower is moved away during a Countdown Demonstration Test.","keywords":["Apollo","Apollo 11","Launch"],"media_type":"image","nasa_id":"jsc2007e034221","title":"Apollo 11 spacecraft pre-launch"}],"links":[{"href":"https://images-assets.nasa.gov/image/jsc2007e034221/jsc2007e034221~medium.jpg","rel":"alternate","render":"image","width":975,"size":176000,"height":1280}]},
{"data":[{"nasa_id":"","title":"no id"}]}
]}}`

func TestParseNasaimages(t *testing.T) {
	refs, err := parseNasaimages([]byte(nasaimagesGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref (空 nasa_id 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://images.nasa.gov/details/jsc2007e034221" {
		t.Fatalf("nasaimages url: %s", r.URL)
	}
	if r.Kind != "image" || r.Authority != "images.nasa.gov" {
		t.Fatalf("nasaimages kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Published != "1969-07-11" {
		t.Fatalf("nasaimages published: %s", r.Published) // ISO 截日期
	}
	if r.Title != "Apollo 11 spacecraft pre-launch" {
		t.Fatalf("nasaimages title: %s", r.Title)
	}
}

// ---------- musicbrainz ----------
const musicbrainzGolden = `{"created":"2026-09-05T03:14:19.908Z","count":21568,"offset":0,"recordings":[
{"id":"46fe768c-7b38-4147-9f02-815b9f0759e2","score":100,"artist-credit-id":"b9de567b-a601-352f-8285-998bcd9e4cae","title":"Bohemian Rhapsody","length":130400,"disambiguation":"live, 1992-04-20: Wembley Stadium, London, UK","video":null,"artist-credit":[{"joinphrase":" + ","name":"Queen","artist":{"id":"0383dadf-2a4e-4d10-a46a-e9e041da8eb3","name":"Queen","sort-name":"Queen"}}],"releases":[{"title":"The Freddie Mercury Tribute"}],"first-release-date":""},
{"id":"b7d4a1be-6f7a-4c1f-a1f7-4e0e5d6f6f6f","score":95,"title":"Bohemian Rhapsody","length":355000,"disambiguation":"","artist-credit":[{"name":"","artist":{"name":"Queen"}}],"releases":[{"title":"A Night at the Opera","date":"1975-10-31"}],"first-release-date":"1975-10-31"}
]}`

func TestParseMusicbrainz(t *testing.T) {
	refs, err := parseMusicbrainz([]byte(musicbrainzGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs, got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://musicbrainz.org/recording/46fe768c-7b38-4147-9f02-815b9f0759e2" {
		t.Fatalf("musicbrainz url: %s", r.URL)
	}
	if r.Kind != "music" || r.Authority != "musicbrainz.org" {
		t.Fatalf("musicbrainz kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "Bohemian Rhapsody — Queen" {
		t.Fatalf("musicbrainz title: %s", r.Title) // artist 拼接
	}
	// disambiguation + release(无 date) + length 130400ms → 2:10
	want := "live, 1992-04-20: Wembley Stadium, London, UK · The Freddie Mercury Tribute · 2:10"
	if r.Snippet != want {
		t.Fatalf("musicbrainz snippet:\n got %s\nwant %s", r.Snippet, want)
	}
	if refs[1].Snippet != "A Night at the Opera (1975-10-31) · 5:55" {
		t.Fatalf("musicbrainz r1 snippet: %s", refs[1].Snippet) // date 拼接 + 355000ms→5:55
	}
	if refs[1].Published != "1975-10-31" {
		t.Fatalf("musicbrainz published: %s", refs[1].Published)
	}
}

// ---------- mozaddons ----------
const mozaddonsGolden = `{"page_size":25,"page_count":96,"count":2389,"results":[
{"id":2616012,"guid":"@jsonviewernickprogramm","name":{"ru":"JSON Viewer"},"summary":{"ru":"Просмотр JSON файлов прямо в браузере"},"default_locale":"ru","url":"https://addons.mozilla.org/en-US/firefox/addon/json-viewer-nick/","type":"extension","average_daily_users":802,"weekly_downloads":9,"created":"2019-12-21T06:20:23Z","last_updated":"2025-01-05T19:21:06Z"},
{"id":2838196,"name":{"en-US":"Lock Adblock"},"summary":{"zh-CN":"拦截广告"},"default_locale":"en-US","url":"https://addons.mozilla.org/en-US/firefox/addon/lock-adblock/","type":"extension","average_daily_users":13138,"weekly_downloads":0,"created":"2024-03-24T10:15:37Z"},
{"id":99,"name":{"xx":""},"summary":{},"default_locale":"xx","url":"","type":"extension"}
]}`

func TestParseMozaddons(t *testing.T) {
	refs, err := parseMozaddons([]byte(mozaddonsGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("want 2 refs (空 url 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://addons.mozilla.org/en-US/firefox/addon/json-viewer-nick/" {
		t.Fatalf("mozaddons url: %s", r.URL)
	}
	if r.Kind != "browser-ext" || r.Authority != "addons.mozilla.org" {
		t.Fatalf("mozaddons kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "JSON Viewer" {
		t.Fatalf("mozaddons title: %s", r.Title) // default_locale=ru 择优
	}
	if refs[0].Snippet != "Просмотр JSON файлов прямо в браузере · 802 users · 9 downloads/week" {
		t.Fatalf("mozaddons snippet: %s", refs[0].Snippet)
	}
	if refs[1].Title != "Lock Adblock" || refs[1].Snippet != "拦截广告 · 13138 users" {
		t.Fatalf("mozaddons r1: %s / %s", refs[1].Title, refs[1].Snippet) // en-US 择优 + 无 weekly 不追加
	}
}

// ---------- thespacedevs ----------
const thespacedevsGolden = `{"count":122,"next":null,"previous":null,"results":[
{"id":"153ef8ef-b12b-43f4-a4bf-05b225c0cd37","url":"https://ll.thespacedevs.com/2.2.0/launch/153ef8ef-b12b-43f4-a4bf-05b225c0cd37/","slug":"falcon-9-block-5-starlink-group-15-24","name":"Falcon 9 Block 5 | Starlink Group 15-24","status":{"id":1,"name":"Go for Launch","abbrev":"Go"},"last_updated":"2026-08-28T18:41:46Z","net":"2026-09-06T10:59:00Z","window_end":"2026-09-06T14:59:00Z","window_start":"2026-09-06T10:59:00Z","probability":null,"launch_service_provider":{"id":121,"name":"SpaceX"},"rocket":{"configuration":{"full_name":"Falcon 9 Block 5"}},"pad":{"location":{"name":"Vandenberg SFB, CA, USA"},"name":"Space Launch Complex 4E"},"mission":{"description":"","type":"Communications"}},
{"id":"no-url","name":"No URL Launch","url":"","status":{"name":"TBD"}}
]}`

func TestParseThespacedevs(t *testing.T) {
	refs, err := parseThespacedevs([]byte(thespacedevsGolden), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref (空 url 跳过), got %d", len(refs))
	}
	r := refs[0]
	if r.URL != "https://ll.thespacedevs.com/2.2.0/launch/153ef8ef-b12b-43f4-a4bf-05b225c0cd37/" {
		t.Fatalf("thespacedevs url: %s", r.URL) // 网页 404, 规范可达页=响应自带 API 条目页
	}
	if r.Kind != "space" || r.Authority != "ll.thespacedevs.com" {
		t.Fatalf("thespacedevs kind/authority: %s/%s", r.Kind, r.Authority)
	}
	if r.Title != "Falcon 9 Block 5 | Starlink Group 15-24" {
		t.Fatalf("thespacedevs title: %s", r.Title)
	}
	want := "Go for Launch · 2026-09-06T10:59:00Z UTC · SpaceX · Vandenberg SFB, CA, USA"
	if r.Snippet != want {
		t.Fatalf("thespacedevs snippet:\n got %s\nwant %s", r.Snippet, want)
	}
	if r.Published != "2026-09-06" {
		t.Fatalf("thespacedevs published: %s", r.Published)
	}
}

// ---------- 接线锁: planner 路由 + 注册面 ----------
func TestPlannerB7Routes(t *testing.T) {
	cases := []struct {
		q    string
		want string
	}{
		{"helm chart 推荐 prometheus", "artifacthub"},
		{"best helm redis", "artifacthub"},
		{"nasa 火星照片", "nasaimages"},
		{"bohemian rhapsody 这首歌", "musicbrainz"},
		{"好用的歌词查询 music", "lrclib"}, // 批11: 歌词词面移交 lyrics 域(专源 lrclib 优于录音库)
		{"firefox 扩展 拦截广告", "mozaddons"},
		{"starship 下次发射", "thespacedevs"},
		{"falcon 9 launch window", "thespacedevs"},
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
	// 反例: 泛词不得引出窄域腿(防烧限流配额)
	for _, q := range []string{"最新新闻", "weather tomorrow 天气"} {
		if route := lookupDomains(q); route != nil {
			if containsStr(route.apiProviders, "thespacedevs") || containsStr(route.apiProviders, "musicbrainz") {
				t.Fatalf("q=%q 误引窄域腿: %v", q, route.apiProviders)
			}
		}
	}
}

func TestB7Registered(t *testing.T) {
	for _, name := range []string{"artifacthub", "nasaimages", "musicbrainz", "mozaddons", "thespacedevs"} {
		if _, ok := laneRegistry[name]; !ok {
			t.Fatalf("laneRegistry 缺 %s", name)
		}
	}
}

// ---------- 守卫回归: 窄域 lane 在拒连 transport 下不得 panic ----------
type b7DenyTransport struct{}

func (b7DenyTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, context.Canceled
}

func TestB7LanesNotPanicked(t *testing.T) {
	client := &http.Client{Transport: b7DenyTransport{}}
	opts := SearchOpts{Query: "test", MaxResults: 5}
	ctx := context.Background()
	for _, fn := range []LaneFn{laneArtifacthub, laneNasaimages, laneMusicbrainz, laneMozaddons, laneThespacedevs} {
		_, _ = fn(ctx, opts, client) // transport 拒绝合法 err, 只验不 panic
	}
}
