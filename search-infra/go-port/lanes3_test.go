package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// ---------- phase AL 黄金样本(parse 纯函数) ----------

func TestParseZenodo(t *testing.T) {
	j := `{"hits":{"hits":[
                {"id":10057114,"doi":"10.5281/zenodo.6786796","doi_url":"https://doi.org/10.5281/zenodo.6786796",
                 "metadata":{"title":"Abstract Machines Workshop","description":"<p>Slides &amp; <b>code</b> for the workshop.</p>","publication_date":"2023-11-03"}},
                {"id":2,"doi":"","doi_url":"","metadata":{"title":"No DOI record","description":"x","publication_date":"2024-01-01"}}]}}`
	var d struct {
		Hits struct {
			Hits []struct {
				ID       int64  `json:"id"` // 实弹抓获: Zenodo id 是 number 不是 string
				DOI      string `json:"doi"`
				DOIURL   string `json:"doi_url"`
				Metadata struct {
					Title           string `json:"title"`
					Description     string `json:"description"`
					PublicationDate string `json:"publication_date"`
				} `json:"metadata"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := json.Unmarshal([]byte(j), &d); err != nil {
		t.Fatal(err)
	}
	refs := parseZenodo(d)
	if len(refs) != 2 {
		t.Fatalf("want 2 refs, got %d", len(refs))
	}
	if refs[0].URL != "https://doi.org/10.5281/zenodo.6786796" {
		t.Fatalf("doi_url priority failed: %s", refs[0].URL)
	}
	if refs[1].URL != "https://zenodo.org/records/2" {
		t.Fatalf("id fallback failed: %s", refs[1].URL)
	}
	if strings.Contains(refs[0].Snippet, "<") || !strings.Contains(refs[0].Snippet, "& code") {
		t.Fatalf("html strip failed: %q", refs[0].Snippet)
	}
	if refs[0].Published != "2023-11-03" || refs[0].Authority != "zenodo.org" {
		t.Fatalf("meta fields wrong: %+v", refs[0])
	}
}

func TestParseDoaj(t *testing.T) {
	j := `{"total":198468,"results":[
                {"id":"abc123","bibjson":{"title":"E2ETrADS","abstract":"End-to-end driving","year":"2025",
                 "link":[{"type":"fulltext","url":"https://journal.example/fulltext"},{"type":"other","url":"https://x"}]}}]}`
	var d struct {
		Total   int `json:"total"`
		Results []struct {
			ID      string `json:"id"`
			Bibjson struct {
				Title    string `json:"title"`
				Abstract string `json:"abstract"`
				Year     string `json:"year"`
				Link     []struct {
					Type string `json:"type"`
					URL  string `json:"url"`
				} `json:"link"`
			} `json:"bibjson"`
		} `json:"results"`
	}
	if err := json.Unmarshal([]byte(j), &d); err != nil {
		t.Fatal(err)
	}
	refs := parseDoaj(d)
	if len(refs) != 1 {
		t.Fatalf("want 1 ref, got %d", len(refs))
	}
	if refs[0].URL != "https://journal.example/fulltext" {
		t.Fatalf("fulltext link priority failed: %s", refs[0].URL)
	}
	if refs[0].Published != "2025" || refs[0].Authority != "doaj.org" {
		t.Fatalf("meta fields wrong: %+v", refs[0])
	}
}

func TestParseDoajNoFulltext(t *testing.T) {
	j := `{"results":[{"id":"xyz","bibjson":{"title":"T","link":[{"type":"other","url":"https://x"}]}}]}`
	var d struct {
		Total   int `json:"total"`
		Results []struct {
			ID      string `json:"id"`
			Bibjson struct {
				Title    string `json:"title"`
				Abstract string `json:"abstract"`
				Year     string `json:"year"`
				Link     []struct {
					Type string `json:"type"`
					URL  string `json:"url"`
				} `json:"link"`
			} `json:"bibjson"`
		} `json:"results"`
	}
	if err := json.Unmarshal([]byte(j), &d); err != nil {
		t.Fatal(err)
	}
	refs := parseDoaj(d)
	if refs[0].URL != "https://doaj.org/article/xyz" {
		t.Fatalf("article id fallback failed: %s", refs[0].URL)
	}
}

func TestParseMetacpan(t *testing.T) {
	j := `{"hits":{"hits":[{"_source":{"name":"Catalyst-Runtime-5.80008","abstract":"The elegant MVC framework","author":"BOBTFISH","date":"2009-04-20T00:00:00","distribution":"Catalyst-Runtime"}}]}}`
	var d struct {
		Hits struct {
			Hits []struct {
				Source struct {
					Name         string `json:"name"`
					Abstract     string `json:"abstract"`
					Author       string `json:"author"`
					Date         string `json:"date"`
					Distribution string `json:"distribution"`
				} `json:"_source"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := json.Unmarshal([]byte(j), &d); err != nil {
		t.Fatal(err)
	}
	refs := parseMetacpan(d)
	if len(refs) != 1 || refs[0].URL != "https://metacpan.org/dist/Catalyst-Runtime" {
		t.Fatalf("metacpan parse failed: %+v", refs)
	}
	if refs[0].Snippet != "The elegant MVC framework" {
		t.Fatalf("abstract not kept: %q", refs[0].Snippet)
	}
}

func TestParseRepologyDedup(t *testing.T) {
	j := `[{"repo":"debian_12","visiblename":"wget","version":"1.21.3","status":"newest"},
              {"repo":"debian_12","visiblename":"wget","version":"1.21.2","status":"legacy"},
              {"repo":"arch","visiblename":"wget","version":"1.24.0","status":"newest"}]`
	var entries []struct {
		Repo        string `json:"repo"`
		VisibleName string `json:"visiblename"`
		Version     string `json:"version"`
		Status      string `json:"status"`
	}
	if err := json.Unmarshal([]byte(j), &entries); err != nil {
		t.Fatal(err)
	}
	refs := parseRepology(entries, "wget")
	if len(refs) != 2 {
		t.Fatalf("repo dedup failed: want 2, got %d", len(refs))
	}
	if refs[0].Snippet != "debian_12 · 1.21.3 · newest" {
		t.Fatalf("snippet shape wrong: %q", refs[0].Snippet)
	}
	if refs[0].URL != "https://repology.org/project/wget/versions" {
		t.Fatalf("url shape wrong: %s", refs[0].URL)
	}
}

func TestParseAur(t *testing.T) {
	j := `{"resultcount":2,"results":[
                {"Name":"youtube-dl-git","Description":"A small tool","Version":"2023.12.22-1","NumVotes":42},
                {"Name":"","Description":"broken","Version":"","NumVotes":0}]}`
	var d struct {
		ResultCount int `json:"resultcount"`
		Results     []struct {
			Name        string `json:"Name"`
			Description string `json:"Description"`
			Version     string `json:"Version"`
			NumVotes    int    `json:"NumVotes"`
		} `json:"results"`
	}
	if err := json.Unmarshal([]byte(j), &d); err != nil {
		t.Fatal(err)
	}
	refs := parseAur(d)
	if len(refs) != 1 {
		t.Fatalf("want 1 valid ref (empty Name skipped), got %d", len(refs))
	}
	if refs[0].URL != "https://aur.archlinux.org/packages/youtube-dl-git" || !strings.Contains(refs[0].Snippet, "42 votes") {
		t.Fatalf("aur ref wrong: %+v", refs[0])
	}
}

func TestParseFlathub(t *testing.T) {
	j := `{"hits":[{"app_id":"org.openshot.OpenShot","name":"OpenShot Video Editor","summary":"An easy to use editor"}],"totalHits":3323}`
	var d struct {
		Hits []struct {
			AppID   string `json:"app_id"`
			Name    string `json:"name"`
			Summary string `json:"summary"`
		} `json:"hits"`
	}
	if err := json.Unmarshal([]byte(j), &d); err != nil {
		t.Fatal(err)
	}
	refs := parseFlathub(d)
	if len(refs) != 1 || refs[0].URL != "https://flathub.org/apps/org.openshot.OpenShot" {
		t.Fatalf("flathub parse failed: %+v", refs)
	}
}

// ---------- 守卫与合法空(零请求纪律) ----------

func TestLaneGuards(t *testing.T) {
	// repology: 无版本意图 → 空, 不发请求(client=nil 证明零请求)
	refs, err := laneRepology(nil, SearchOpts{Query: "wget the tool"}, nil)
	if err != nil || len(refs) != 0 {
		t.Fatalf("repology no-intent must be legal-empty: %v %v", refs, err)
	}
	// aur: 无 arch 生态信号 → 空
	refs, err = laneAur(nil, SearchOpts{Query: "best video editor 2026"}, nil)
	if err != nil || len(refs) != 0 {
		t.Fatalf("aur no-signal must be legal-empty: %v %v", refs, err)
	}
	// aur: 有信号但锚全被排除集吃掉(aur/arch/linux/version/latest 均排除) → 空
	refs, err = laneAur(nil, SearchOpts{Query: "aur arch linux version latest"}, nil)
	if err != nil || len(refs) != 0 {
		t.Fatalf("aur anchor-exhausted must be legal-empty: %v %v", refs, err)
	}
}

func TestExtractProjectAnchor(t *testing.T) {
	cases := []struct{ q, want string }{
		{"what is the latest version of python", "python"},
		{"wget 版本", "wget"},
		{"aur install chrome", "chrome"},
		{"最新版本的 nodejs", "nodejs"},
	}
	for _, c := range cases {
		if got := extractProjectAnchor(c.q); got != c.want {
			t.Errorf("anchor(%q) = %q, want %q", c.q, got, c.want)
		}
	}
}

// ---------- 接线锁 ----------

func TestRegistryCountAL(t *testing.T) {
	if len(laneRegistry) != 90 { // 86 + 批12 openreview/inaturalist/pubdev/openfoodfacts
		t.Fatalf("registry want 90, got %d", len(laneRegistry))
	}
	for _, name := range []string{"zenodo", "doaj", "metacpan", "repology", "flathub"} {
		if _, ok := laneRegistry[name]; !ok {
			t.Fatalf("lane %q not registered", name)
		}
	}
	if _, ok := laneRegistry["aur"]; ok {
		t.Fatal("aur must NOT be registered (anubis TLS-fingerprint challenge, phase AL 关账)")
	}
	if p := domainTable["packages"].apiProviders; len(p) != 10 || p[5] != "metacpan" || p[6] != "repology" || p[7] != "nuget" || p[8] != "hex" || p[9] != "pubdev" { // 批12 +pubdev
		t.Fatalf("packages apiProviders wrong: %v", p)
	}
	if p := domainTable["devops"].apiProviders; len(p) != 6 || p[1] != "flathub" || p[2] != "arch" || p[3] != "artifacthub" || p[4] != "snapcraft" || p[5] != "endoflife" { // 批11 +endoflife
		t.Fatalf("devops apiProviders wrong: %v", p)
	}
	if p := domainTable["academic"].apiProviders; len(p) != 12 || p[11] != "openreview" { // 批12 +openreview
		t.Fatalf("academic apiProviders wrong: %v", p)
	}
	// perl 信号裁腿锁: "perl 包" 裁到 metacpan 单腿
	if got := condensePackagesLeg("perl 包推荐", domainTable["packages"].apiProviders); len(got) != 1 || got[0] != "metacpan" {
		t.Fatalf("perl condense failed: %v", got)
	}
}
