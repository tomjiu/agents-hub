package main

// P2-b: 包注册表 6 车道 + 时间机器 2 车道
// crates/packagist/rubygems/huggingface/dockerhub/openalex/wayback/wikirev

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
)

// ---------- crates (route-packages 主腿; 排序波动 AF 教训在 L2 判分窗处理) ----------
type cratesResp struct {
	Crates []struct {
		Name           string   `json:"name"`
		Description    string   `json:"description"`
		Downloads      *int     `json:"downloads"`
		DefaultVersion string   `json:"default_version"`
		Keywords       []string `json:"keywords"`
		UpdatedAt      string   `json:"updated_at"`
	} `json:"crates"`
}

func parseCrates(data []byte, max int) ([]Reference, error) {
	var d cratesResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("crates: bad json: %w", err)
	}
	var out []Reference
	for _, c := range d.Crates {
		if c.Name == "" {
			continue
		}
		meta := []string{}
		if c.DefaultVersion != "" {
			meta = append(meta, "v"+c.DefaultVersion)
		}
		if c.Downloads != nil {
			meta = append(meta, fmt.Sprintf("%d downloads", *c.Downloads))
		}
		if len(c.Keywords) > 0 {
			kws := c.Keywords
			if len(kws) > 4 {
				kws = kws[:4]
			}
			meta = append(meta, "kw: "+strings.Join(kws, ", "))
		}
		desc := ""
		if c.Description != "" {
			desc = " · " + c.Description
		}
		title := c.Name
		if c.DefaultVersion != "" {
			title = c.Name + "@" + c.DefaultVersion
		}
		out = append(out, Reference{
			URL: "https://crates.io/crates/" + c.Name, Title: clampText(title, 200),
			Snippet: clampText("[crates] "+strings.Join(meta, " · ")+desc, 400),
			Engines: []string{"crates"}, Published: c.UpdatedAt, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("crates: no results parsed")
	}
	return out, nil
}

func laneCrates(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://crates.io/api/v1/crates", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("q", opts.Query)
	q.Set("sort", "downloads")
	q.Set("per_page", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("crates http %d", resp.StatusCode)
	}
	return parseCrates([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- packagist ----------
type packagistResp struct {
	Results []struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		URL         string `json:"url"`
		Downloads   *int   `json:"downloads"`
		Favers      *int   `json:"favers"`
	} `json:"results"`
}

func parsePackagist(data []byte, max int) ([]Reference, error) {
	var d packagistResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("packagist: bad json: %w", err)
	}
	var out []Reference
	for _, r := range d.Results {
		if r.Name == "" {
			continue
		}
		meta := []string{}
		if r.Downloads != nil {
			meta = append(meta, fmt.Sprintf("%d downloads", *r.Downloads))
		}
		if r.Favers != nil {
			meta = append(meta, fmt.Sprintf("%d★", *r.Favers))
		}
		desc := ""
		if r.Description != "" {
			desc = " · " + r.Description
		}
		u := fmt.Sprintf("https://packagist.org/packages/%s", r.Name)
		if strings.HasPrefix(r.URL, "http") {
			u = r.URL
		}
		out = append(out, Reference{
			URL: u, Title: clampText(r.Name, 200),
			Snippet: clampText("[packagist] "+strings.Join(meta, " · ")+desc, 400),
			Engines: []string{"packagist"}, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("packagist: no results parsed")
	}
	return out, nil
}

func lanePackagist(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://packagist.org/search.json", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("q", opts.Query)
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("packagist http %d", resp.StatusCode)
	}
	return parsePackagist([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- rubygems ----------
type rubygemsResp []struct {
	Name       string `json:"name"`
	Version    string `json:"version"`
	Info       string `json:"info"`
	Downloads  *int   `json:"downloads"`
	ProjectURI string `json:"project_uri"`
}

func parseRubygems(data []byte, max int) ([]Reference, error) {
	var d rubygemsResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("rubygems: bad json: %w", err)
	}
	var out []Reference
	for _, g := range d {
		if g.Name == "" {
			continue
		}
		dl := "n/a"
		if g.Downloads != nil {
			dl = fmt.Sprintf("%d downloads", *g.Downloads)
		}
		info := ""
		if g.Info != "" {
			info = " · " + g.Info
		}
		u := fmt.Sprintf("https://rubygems.org/gems/%s", g.Name)
		if strings.HasPrefix(g.ProjectURI, "http") {
			u = g.ProjectURI
		}
		title := g.Name
		if g.Version != "" {
			title = g.Name + "@" + g.Version
		}
		out = append(out, Reference{
			URL: u, Title: clampText(title, 200),
			Snippet: clampText("[rubygems] "+dl+info, 400),
			Engines: []string{"rubygems"}, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	// 批 10 查因(批 9 挂账: 熔断 ok=0/fail=7): 实弹证明 API 形状未变且存活,
	// 根因=含中文词面全灭("ruby 哪个 http 客户端包好"→[])。空数组是词面性零结果
	// 而非故障, 不再报错(归零防熔断污染, openfda 惯例) — 降级重查在 laneRubygems。
	return out, nil
}

func laneRubygems(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, err := http.NewRequestWithContext(ctx, "GET", "https://rubygems.org/api/v1/search.json", nil)
		if err != nil {
			return nil, err
		}
		qv := req.URL.Query()
		qv.Set("query", q)
		req.URL.RawQuery = qv.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("rubygems http %d", resp.StatusCode)
		}
		return parseRubygems([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	refs, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		// 批 10 修复: 全词空→asciiFace 剥离中文修饰词("ruby 哪个 http 客户端包好"→"ruby http")
		// →仍空→longestASCIIToken 二级降级(thesportsdb 同模式); 实弹: 中文混合词 [], 英文句/短词命中
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			r2, err2 := fetch(face)
			if err2 != nil {
				return nil, err2
			}
			refs = r2
			if len(refs) == 0 {
				if tok := longestASCIIToken(opts.Query); tok != "" && tok != face {
					r3, err3 := fetch(tok)
					if err3 != nil {
						return nil, err3
					}
					refs = r3
				}
			}
		}
		// 降级后仍空 = 词面问题非故障, 归零防熔断污染(openfda 惯例)
		if len(refs) == 0 {
			return []Reference{}, nil
		}
	}
	return refs, nil
}

// ---------- huggingface ----------
type hfResp []struct {
	ID        string `json:"id"`
	Likes     *int   `json:"likes"`
	Downloads *int   `json:"downloads"`
}

func parseHuggingface(data []byte, max int) ([]Reference, error) {
	var d hfResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("huggingface: bad json: %w", err)
	}
	var out []Reference
	for _, m := range d {
		if m.ID == "" {
			continue
		}
		meta := []string{}
		if m.Downloads != nil {
			meta = append(meta, fmt.Sprintf("%d downloads", *m.Downloads))
		}
		out = append(out, Reference{
			URL: "https://huggingface.co/" + m.ID, Title: clampText(m.ID, 200),
			Snippet: clampText("[hf] "+strings.Join(meta, " · "), 400),
			Engines: []string{"huggingface"}, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("huggingface: no results parsed")
	}
	return out, nil
}

func laneHuggingface(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	// b14: HF search 对自然语言多词中文串 0 结果(curl 实测) — b13 模式接线:
	// 原词空 → 剥域意图词(b13HFIntentRe)重查一次(裸 "bert"/"llm 2025" 各 5 中)
	fetch := func(q string) ([]Reference, error) {
		req, err := http.NewRequestWithContext(ctx, "GET", "https://huggingface.co/api/models", nil)
		if err != nil {
			return nil, err
		}
		qp := req.URL.Query()
		qp.Set("search", q)
		qp.Set("limit", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
		qp.Set("sort", "downloads")
		qp.Set("direction", "-1")
		req.URL.RawQuery = qp.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("huggingface http %d", resp.StatusCode)
		}
		return parseHuggingface([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	refs, err := fetch(opts.Query)
	if (err != nil || len(refs) == 0) && len(opts.Query) > 0 {
		if face := b13StripIntent(opts.Query, b13HFIntentRe); face != "" && face != opts.Query {
			var e2 error
			refs, e2 = fetch(face)
			if e2 == nil {
				err = nil // 剥词重查成功则不携带原词错误
			}
		}
	}
	return refs, err
}

// ---------- dockerhub (v0.8 实抓 bug: repo_name 有时自带 namespace) ----------
type dockerhubResp struct {
	Results []struct {
		RepoName         string `json:"repo_name"`
		RepoOwner        string `json:"repo_owner"`
		ShortDescription string `json:"short_description"`
		StarCount        *int   `json:"star_count"`
		PullCount        *int   `json:"pull_count"`
		IsOfficial       bool   `json:"is_official"`
	} `json:"results"`
}

func parseDockerhub(data []byte, max int) ([]Reference, error) {
	var d dockerhubResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("dockerhub: bad json: %w", err)
	}
	var out []Reference
	for _, r := range d.Results {
		if r.RepoName == "" {
			continue
		}
		name := r.RepoName
		official := r.IsOfficial
		meta := []string{}
		if r.StarCount != nil {
			meta = append(meta, fmt.Sprintf("★%d", *r.StarCount))
		}
		if r.PullCount != nil {
			meta = append(meta, fmt.Sprintf("%d pulls", *r.PullCount))
		}
		if official {
			meta = append(meta, "official")
		}
		desc := ""
		if r.ShortDescription != "" {
			desc = " · " + r.ShortDescription
		}
		var u, title string
		switch {
		case official:
			u = "https://hub.docker.com/_/" + name
		case strings.Contains(name, "/"):
			u = "https://hub.docker.com/r/" + name
		default:
			owner := r.RepoOwner
			if owner == "" {
				owner = "library"
			}
			u = "https://hub.docker.com/r/" + owner + "/" + name
		}
		switch {
		case official && !strings.Contains(name, "/"):
			title = "library/" + name
		case strings.Contains(name, "/") || official:
			title = name
		default:
			prefix := "library/"
			if r.RepoOwner != "" {
				prefix = r.RepoOwner + "/"
			}
			title = prefix + name
		}
		out = append(out, Reference{
			URL: u, Title: clampText(title, 200),
			Snippet: clampText("[dockerhub] "+strings.Join(meta, " · ")+desc, 400),
			Engines: []string{"dockerhub"}, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("dockerhub: no results parsed")
	}
	return out, nil
}

func laneDockerhub(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://hub.docker.com/v2/search/repositories/", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("query", opts.Query)
	q.Set("page_size", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("dockerhub http %d", resp.StatusCode)
	}
	return parseDockerhub([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- openalex (学术 works; polite mailto; OA 链优先) ----------
type openalexResp struct {
	Results []struct {
		DisplayName     string `json:"display_name"`
		DOI             string `json:"doi"`
		PublicationYear *int   `json:"publication_year"`
		PublicationDate string `json:"publication_date"`
		CitedByCount    *int   `json:"cited_by_count"`
		PrimaryLocation *struct {
			LandingPageURL string `json:"landing_page_url"`
			Source         *struct {
				DisplayName string `json:"display_name"`
			} `json:"source"`
		} `json:"primary_location"`
		Authorships []struct {
			Author *struct {
				DisplayName string `json:"display_name"`
			} `json:"author"`
		} `json:"authorships"`
		OpenAccess *struct {
			IsOA  bool   `json:"is_oa"`
			OaURL string `json:"oa_url"`
		} `json:"open_access"`
	} `json:"results"`
}

func parseOpenalex(data []byte, max int) ([]Reference, error) {
	var d openalexResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("openalex: bad json: %w", err)
	}
	var out []Reference
	for _, w := range d.Results {
		if w.DisplayName == "" {
			continue
		}
		venue := ""
		if w.PrimaryLocation != nil && w.PrimaryLocation.Source != nil {
			venue = w.PrimaryLocation.Source.DisplayName
		}
		authors := []string{}
		for _, a := range w.Authorships {
			if a.Author != nil && a.Author.DisplayName != "" {
				authors = append(authors, a.Author.DisplayName)
			}
			if len(authors) >= 2 {
				break
			}
		}
		oa := ""
		if w.OpenAccess != nil && w.OpenAccess.IsOA {
			oa = "OA"
		}
		meta := []string{}
		if w.PublicationYear != nil {
			meta = append(meta, fmt.Sprintf("%d", *w.PublicationYear))
		}
		if w.CitedByCount != nil {
			meta = append(meta, fmt.Sprintf("%d citations", *w.CitedByCount))
		}
		if venue != "" {
			meta = append(meta, venue)
		}
		if len(authors) > 0 {
			meta = append(meta, strings.Join(authors, ", "))
		}
		if oa != "" {
			meta = append(meta, oa)
		}
		u := "https://openalex.org"
		if w.PrimaryLocation != nil && strings.HasPrefix(w.PrimaryLocation.LandingPageURL, "http") {
			u = w.PrimaryLocation.LandingPageURL
		} else if w.OpenAccess != nil && strings.HasPrefix(w.OpenAccess.OaURL, "http") {
			u = w.OpenAccess.OaURL
		} else if w.DOI != "" {
			u = "https://doi.org/" + strings.Replace(w.DOI, "https://doi.org/", "", 1)
		}
		published := w.PublicationDate
		if published == "" && w.PublicationYear != nil {
			published = fmt.Sprintf("%d-01-01", *w.PublicationYear)
		}
		out = append(out, Reference{
			URL: u, Title: clampText(w.DisplayName, 200),
			Snippet: clampText("[openalex] "+strings.Join(meta, " · "), 400),
			Engines: []string{"openalex"}, Published: published, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("openalex: no results parsed")
	}
	return out, nil
}

func laneOpenalex(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.openalex.org/works", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("search", opts.Query)
	q.Set("per-page", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	if mailto := os.Getenv("SC_CONTACT_EMAIL"); mailto != "" {
		q.Set("mailto", mailto)
	}
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("openalex http %d", resp.StatusCode)
	}
	return parseOpenalex([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- 时间机器: wayback (CDX; 非链接形状题面拒收) ----------
var looksLikeUrlRe = regexp.MustCompile(`^[\w-]+(\.[\w-]+)+(/\S*)?$`)

func looksLikeUrlOrDomain(q string) bool {
	if strings.HasPrefix(strings.ToLower(q), "http://") || strings.HasPrefix(strings.ToLower(q), "https://") {
		return true
	}
	return looksLikeUrlRe.MatchString(strings.TrimSpace(q))
}

func laneWayback(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	q := strings.TrimSpace(opts.Query)
	if !looksLikeUrlOrDomain(q) {
		return nil, fmt.Errorf("wayback: %q is not a URL/domain — wayback is a time machine, pass an address like \"example.com/page\" (keyword search belongs to other engines)", clampText(q, 60))
	}
	req, err := http.NewRequestWithContext(ctx, "GET", "https://web.archive.org/cdx/search/cdx", nil)
	if err != nil {
		return nil, err
	}
	qv := req.URL.Query()
	qv.Set("url", q)
	qv.Set("output", "json")
	qv.Set("fl", "timestamp,original,statuscode,mimetype")
	qv.Set("filter", "statuscode:200")
	qv.Set("collapse", "timestamp:6")
	qv.Set("limit", fmt.Sprintf("%d", min(opts.MaxResults, 50)))
	req.URL.RawQuery = qv.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("wayback cdx http %d", resp.StatusCode)
	}
	var rows [][]any
	if err := json.Unmarshal([]byte(readAllString(resp.Body)), &rows); err != nil {
		return nil, fmt.Errorf("wayback: bad json: %w", err)
	}
	if len(rows) == 0 {
		return []Reference{}, nil
	}
	header := make([]string, 0, len(rows[0]))
	for _, h := range rows[0] {
		header = append(header, strings.ToLower(fmt.Sprintf("%v", h)))
	}
	ti, oi := -1, -1
	si, mi := -1, -1
	for i, h := range header {
		switch h {
		case "timestamp":
			ti = i
		case "original":
			oi = i
		case "statuscode":
			si = i
		case "mimetype":
			mi = i
		}
	}
	if ti < 0 || oi < 0 {
		return nil, fmt.Errorf("wayback: unexpected CDX header (markup drift?)")
	}
	var out []Reference
	for _, row := range rows[1:] {
		cellStr := func(i int) string {
			if i < 0 || i >= len(row) {
				return ""
			}
			return strings.TrimSuffix(strings.TrimPrefix(fmt.Sprintf("%v", row[i]), "["), "]")
		}
		ts := cellStr(ti)
		original := cellStr(oi)
		if len(ts) != 14 || !isDigits(ts) || !strings.HasPrefix(original, "http") {
			continue
		}
		snapshot := fmt.Sprintf("https://web.archive.org/web/%s/%s", ts, original)
		when := fmt.Sprintf("%s-%s-%s %s:%s", ts[0:4], ts[4:6], ts[6:8], ts[8:10], ts[10:12])
		meta := []string{"200"}
		if si >= 0 && si < len(row) {
			if mt := cellStr(mi); mt != "" {
				meta = append(meta, strings.Split(mt, ";")[0])
			}
		}
		out = append(out, Reference{
			URL: snapshot, Title: clampText(original+" @ "+when, 200),
			Snippet: clampText("[snapshot] "+strings.Join(meta, " · "), 400),
			Engines: []string{"wayback"}, Published: when, Kind: "archive",
		})
		if len(out) >= opts.MaxResults {
			break
		}
	}
	return out, nil
}

func isDigits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return len(s) > 0
}

// ---------- wikirev (REST v1 历史页; user 是对象不是字符串(2026-09-03 实探)) ----------
var wikiURLRe = regexp.MustCompile(`(?i)wikipedia\.org/wiki/([^?#]+)`)

func extractPageTitle(q string) string {
	s := strings.TrimSpace(q)
	if m := wikiURLRe.FindStringSubmatch(s); m != nil {
		if dec, err := urlQueryUnescape(m[1]); err == nil {
			s = dec
		} else {
			s = m[1]
		}
	}
	return strings.TrimSpace(strings.ReplaceAll(s, "_", " "))
}

func urlQueryUnescape(s string) (string, error) { return url.QueryUnescape(s) }

type wikirevResp struct {
	Revisions []struct {
		ID        int    `json:"id"`
		Timestamp string `json:"timestamp"`
		User      *struct {
			Name string `json:"name"`
		} `json:"user"`
		Comment string `json:"comment"`
		Size    *int   `json:"size"`
		Delta   *int   `json:"delta"`
	} `json:"revisions"`
}

func parseWikirev(lang, title string, data []byte, max int) []Reference {
	var d wikirevResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil
	}
	if len(d.Revisions) == 0 {
		return []Reference{}
	}
	var out []Reference
	for _, r := range d.Revisions {
		u := fmt.Sprintf("https://%s.wikipedia.org/w/index.php?title=%s&oldid=%d",
			lang, urlQueryEscape(strings.ReplaceAll(title, " ", "_")), r.ID)
		when := strings.Replace(strings.Replace(r.Timestamp, "T", " ", 1), "Z", "", 1)
		meta := []string{}
		if r.User != nil && r.User.Name != "" {
			meta = append(meta, r.User.Name)
		}
		if r.Size != nil {
			meta = append(meta, fmt.Sprintf("%d bytes", *r.Size))
		}
		if r.Delta != nil {
			meta = append(meta, fmt.Sprintf("%+d", *r.Delta))
		}
		comment := ""
		if r.Comment != "" {
			comment = " · " + r.Comment
		}
		out = append(out, Reference{
			URL: u, Title: clampText(title+" rev "+fmt.Sprintf("%d", r.ID), 200),
			Snippet: clampText("[revision] "+strings.Join(meta, " · ")+comment, 400),
			Engines: []string{"wikirev"}, Published: when, Kind: "archive",
		})
		if len(out) >= max {
			break
		}
	}
	return out
}

func laneWikirev(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	title := extractPageTitle(opts.Query)
	if title == "" || len(title) > 300 {
		return nil, fmt.Errorf("wikirev: %q — pass a Wikipedia article name or wiki URL (this is an edit-history lookup, not keyword search)", clampText(opts.Query, 60))
	}
	lang := "en"
	if opts.Lang != "" {
		if p := strings.Split(strings.ToLower(opts.Lang), "-")[0]; p != "" {
			lang = p
		}
	}
	u := fmt.Sprintf("https://%s.wikipedia.org/w/rest.php/v1/page/%s/history", lang, urlPathEscape(title))
	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("limit", fmt.Sprintf("%d", min(opts.MaxResults, 50)))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return nil, fmt.Errorf("wikirev http 404 (page %q not found on %s.wikipedia)", clampText(title, 60), lang)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("wikirev http %d", resp.StatusCode)
	}
	return parseWikirev(lang, title, []byte(readAllString(resp.Body)), opts.MaxResults), nil
}

// ---------- phase AL: metacpan / repology ----------

// laneMetacpan MetaCPAN releases ES API(Perl 生态): /v1/release/_search?q=&size=8。
// phase AL 探针: 200 三连发 281-373ms, hits.hits[]._source{name,abstract,date,distribution}。
func laneMetacpan(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	// b15 质量抽检: metacpan ES 对纯 CJK query 做单字 OR 匹配返回无关 Perl 包
	// (实锤: "高血压 荟萃分析"→Tiezi-Robot-Parser, abstract 含中文单字命中) —
	// Perl 生态语料 ASCII-only, 无 ASCII 词面的查询必然垃圾, 直接跳过(b12 pubdev 先例)
	if longestASCIIToken(opts.Query) == "" {
		return nil, fmt.Errorf("metacpan: skip cjk-only query (ascii-only corpus)")
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://fastapi.metacpan.org/v1/release/_search", nil)
	q := req.URL.Query()
	q.Set("q", opts.Query)
	q.Set("size", "8")
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("metacpan http %d", resp.StatusCode)
	}
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
	if err := json.NewDecoder(resp.Body).Decode(&d); err != nil {
		return nil, err
	}
	return parseMetacpan(d), nil
}

func parseMetacpan(d struct {
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
}) []Reference {
	out := make([]Reference, 0, len(d.Hits.Hits))
	for _, h := range d.Hits.Hits {
		s := h.Source
		if s.Name == "" {
			continue
		}
		dist := s.Distribution
		if dist == "" {
			dist = s.Name
		}
		out = append(out, Reference{
			URL:       "https://metacpan.org/dist/" + dist,
			Title:     s.Name,
			Snippet:   s.Abstract,
			Engines:   []string{"metacpan"},
			Published: s.Date,
			Authority: "metacpan.org",
			Kind:      "packages",
		})
	}
	return out
}

// versionIntentRe 版本意图守卫: 查询含版本语义才打 repology(名直取纪律, 防自然语言题零请求浪费)。
var versionIntentRe = regexp.MustCompile(`(latest|newest|version|版本|update|upgrade|release)`)

// laneRepology 跨 repo 包版本聚合: /api/v1/project/{anchor} 按项目名直取(pypi/CVE 名直取纪律)。
// phase AL 探针: 200 三连发 1328-1541ms, 数组形 entries{repo,visiblename,version,status}。
func laneRepology(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	low := strings.ToLower(opts.Query)
	if !strings.Contains(low, "repology") && !versionIntentRe.MatchString(low) {
		return []Reference{}, nil // 无版本意图合法空零请求
	}
	anchor := extractProjectAnchor(opts.Query)
	if anchor == "" {
		return []Reference{}, nil
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://repology.org/api/v1/project/"+url.PathEscape(anchor), nil)
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return []Reference{}, nil // 未知项目合法空
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("repology http %d", resp.StatusCode)
	}
	var entries []struct {
		Repo        string `json:"repo"`
		VisibleName string `json:"visiblename"`
		Version     string `json:"version"`
		Status      string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		return nil, err
	}
	return parseRepology(entries, anchor), nil
}

func parseRepology(entries []struct {
	Repo        string `json:"repo"`
	VisibleName string `json:"visiblename"`
	Version     string `json:"version"`
	Status      string `json:"status"`
}, anchor string) []Reference {
	out := make([]Reference, 0, 8)
	seen := map[string]bool{}
	for _, e := range entries {
		if seen[e.Repo] {
			continue // 每 repo 一条, 防同一包上百 repo 刷屏
		}
		seen[e.Repo] = true
		name := e.VisibleName
		if name == "" {
			name = anchor
		}
		snip := e.Repo
		if e.Version != "" {
			snip += " · " + e.Version
		}
		if e.Status != "" {
			snip += " · " + e.Status
		}
		out = append(out, Reference{
			URL:       "https://repology.org/project/" + anchor + "/versions",
			Title:     name,
			Snippet:   snip,
			Engines:   []string{"repology"},
			Authority: "repology.org",
			Kind:      "packages",
		})
		if len(out) >= 8 {
			break
		}
	}
	return out
}

// ---------- 探针第 6 批 (phase AM/Go): nuget/hex/arch ----------
// 探针实测(2026-09-05): nuget azuresearch 4/4 稳 200(206-876ms); hex 4/4(268-363ms);
// arch 4/4(442ms-2.9s)。maven(solrsearch 40% 超时)/conda(3-10s 慢)/debian(API 404) 关账。

// ---------- nuget (.NET 包生态) ----------
type nugetResp struct {
	TotalHits int `json:"totalHits"`
	Data      []struct {
		ID             string `json:"id"` // 包 ID(如 FluentValidation), 也用于拼 nuget.org 主页链接
		Title          string `json:"title"`
		Description    string `json:"description"`
		Summary        string `json:"summary"`
		Version        string `json:"version"`
		TotalDownloads int64  `json:"totalDownloads"`
		Verified       bool   `json:"verified"`
	} `json:"data"`
}

func parseNuget(data []byte, max int) ([]Reference, error) {
	var d nugetResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("nuget: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, r := range d.Data {
		if r.ID == "" {
			continue
		}
		title := r.Title
		if title == "" {
			title = r.ID
		}
		snip := r.Description
		if snip == "" {
			snip = r.Summary
		}
		meta := r.Version
		if r.TotalDownloads > 0 {
			meta += fmt.Sprintf(" · %d downloads", r.TotalDownloads)
		}
		if r.Verified {
			meta += " · verified"
		}
		if snip != "" && meta != "" {
			snip = snip + " · " + meta
		} else if meta != "" {
			snip = meta
		}
		out = append(out, Reference{
			URL:       "https://www.nuget.org/packages/" + r.ID,
			Title:     clampText(title, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"nuget"},
			Authority: "nuget.org",
			Kind:      "packages",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return []Reference{}, nil // 无命中合法空
	}
	return out, nil
}

func laneNuget(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://azuresearch-usnc.nuget.org/query", nil)
	q := req.URL.Query()
	q.Set("q", opts.Query)
	q.Set("take", fmt.Sprintf("%d", min(opts.MaxResults, 10)))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("nuget http %d", resp.StatusCode)
	}
	return parseNuget([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- hex.pm (Elixir 包生态) ----------
type hexPkg struct {
	Name string `json:"name"`
	Meta struct {
		Description string   `json:"description"`
		Licenses    []string `json:"licenses"`
	} `json:"meta"`
	Downloads struct {
		All int64 `json:"all"`
	} `json:"downloads"`
	HTMLURL string `json:"html_url"`
	URL     string `json:"url"`
}

func parseHex(data []byte, max int) ([]Reference, error) {
	var pkgs []hexPkg
	if err := json.Unmarshal(data, &pkgs); err != nil {
		return nil, fmt.Errorf("hex: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, p := range pkgs {
		if p.Name == "" {
			continue
		}
		snip := p.Meta.Description
		if p.Downloads.All > 0 {
			snip += fmt.Sprintf(" · %d downloads", p.Downloads.All)
		}
		if len(p.Meta.Licenses) > 0 {
			snip += " · " + strings.Join(p.Meta.Licenses, ",")
		}
		u := p.HTMLURL
		if u == "" {
			u = p.URL
		}
		out = append(out, Reference{
			URL:       u,
			Title:     clampText(p.Name, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"hex"},
			Authority: "hex.pm",
			Kind:      "packages",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneHex(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://hex.pm/api/packages", nil)
	q := req.URL.Query()
	q.Set("search", opts.Query)
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("hex http %d", resp.StatusCode)
	}
	return parseHex([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- Arch Linux 官方包(发行版注册表; AUR 是另一关账案不涉此) ----------
type archResp struct {
	Results []struct {
		PkgName string `json:"pkgname"`
		Repo    string `json:"repo"`
		Arch    string `json:"arch"`
		PkgVer  string `json:"pkgver"`
		PkgDesc string `json:"pkgdesc"`
		URL     string `json:"url"`
	} `json:"results"`
}

func parseArch(data []byte, max int) ([]Reference, error) {
	var d archResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("arch: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, r := range d.Results {
		if r.PkgName == "" {
			continue
		}
		u := r.URL
		if !strings.HasPrefix(u, "http") {
			u = "https://archlinux.org/packages/" + r.Repo + "/" + r.Arch + "/" + r.PkgName + "/"
		}
		snip := r.PkgDesc + " · " + r.Repo + " " + r.PkgVer
		out = append(out, Reference{
			URL:       u,
			Title:     clampText(r.PkgName, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"arch"},
			Authority: "archlinux.org",
			Kind:      "packages",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneArch(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://archlinux.org/packages/search/json/", nil)
	q := req.URL.Query()
	q.Set("q", opts.Query)
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("arch http %d", resp.StatusCode)
	}
	return parseArch([]byte(readAllString(resp.Body)), opts.MaxResults)
}
