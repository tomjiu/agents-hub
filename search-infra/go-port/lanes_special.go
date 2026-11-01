package main

// P2-c: 学术补腿/实体/地理/包精确/安全三腿/词典/医学/数据 — 13 车道
// dblp/wikidata/pubmed/nominatim/pypi/hfpapers/nvd/osv/ghsa/wiktionary/europepmc/clinicaltrials/worldbank

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
)

var cveIdRe = regexp.MustCompile(`(?i)\bCVE-\d{4}-\d{4,7}\b`)

func extractCveId(query string) string {
	if m := cveIdRe.FindString(query); m != "" {
		return strings.ToUpper(m)
	}
	return ""
}

func firstLang(opts SearchOpts) string {
	if opts.Lang == "" {
		return "en"
	}
	if p := strings.Split(strings.ToLower(opts.Lang), "-")[0]; p != "" {
		return p
	}
	return "en"
}

// ---------- dblp (CS 会议目录; author 单对象/数组双形) ----------
type dblpResp struct {
	Result struct {
		Hits struct {
			Hit []struct {
				Info struct {
					Title   string `json:"title"`
					URL     string `json:"url"`
					EE      string `json:"ee"`
					Venue   string `json:"venue"`
					Year    string `json:"year"`
					Authors struct {
						Author json.RawMessage `json:"author"`
					} `json:"authors"`
				} `json:"info"`
			} `json:"hit"`
		} `json:"hits"`
	} `json:"result"`
}

func dblpAuthors(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var one struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &one); err == nil && one.Text != "" {
		return one.Text // 单对象形
	}
	var many []struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &many); err != nil {
		return ""
	}
	var names []string
	for _, x := range many {
		if x.Text != "" {
			names = append(names, x.Text)
		}
		if len(names) >= 2 {
			break
		}
	}
	return strings.Join(names, ", ")
}

func parseDblp(data []byte, max int) ([]Reference, error) {
	var d dblpResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("dblp: bad json: %w", err)
	}
	var out []Reference
	for _, h := range d.Result.Hits.Hit {
		i := h.Info
		if i.Title == "" {
			continue
		}
		u := "https://dblp.org"
		if strings.HasPrefix(i.EE, "http") {
			u = i.EE
		} else if strings.HasPrefix(i.URL, "http") {
			u = i.URL
		}
		meta := []string{}
		if i.Venue != "" {
			meta = append(meta, i.Venue)
		}
		if i.Year != "" {
			meta = append(meta, i.Year)
		}
		if a := dblpAuthors(i.Authors.Author); a != "" {
			meta = append(meta, a)
		}
		published := ""
		if i.Year != "" {
			published = i.Year + "-01-01"
		}
		out = append(out, Reference{
			URL: u, Title: clampText(i.Title, 200),
			Snippet: clampText("[dblp] "+strings.Join(meta, " · "), 400),
			Engines: []string{"dblp"}, Published: published, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("dblp: no results parsed")
	}
	return out, nil
}

func laneDblp(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://dblp.org/search/publ/api", nil)
	q := req.URL.Query()
	q.Set("q", opts.Query)
	q.Set("format", "json")
	q.Set("h", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("dblp http %d", resp.StatusCode)
	}
	return parseDblp([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- wikidata (实体搜索; wbsearchentities) ----------
type wikidataResp struct {
	Search []struct {
		ID          string `json:"id"`
		Label       string `json:"label"`
		Description string `json:"description"`
		ConceptURI  string `json:"concepturi"`
	} `json:"search"`
}

func laneWikidata(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://www.wikidata.org/w/api.php", nil)
		q2 := req.URL.Query()
		q2.Set("action", "wbsearchentities")
		q2.Set("search", q)
		q2.Set("language", firstLang(opts))
		q2.Set("format", "json")
		q2.Set("limit", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
		q2.Set("origin", "*")
		req.URL.RawQuery = q2.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("wikidata http %d", resp.StatusCode)
		}
		var d wikidataResp
		if err := json.Unmarshal([]byte(readAllString(resp.Body)), &d); err != nil {
			return nil, fmt.Errorf("wikidata: bad json: %w", err)
		}
		var out []Reference
		for _, e := range d.Search {
			if e.ID == "" || e.Label == "" {
				continue
			}
			u := e.ConceptURI
			if u == "" {
				u = "https://www.wikidata.org/wiki/" + e.ID
			}
			desc := e.Description
			if desc == "" {
				desc = "(no description)"
			}
			out = append(out, Reference{
				URL: u, Title: clampText(e.Label+" ("+e.ID+")", 200),
				Snippet: clampText("[wikidata] "+desc, 400),
				Engines: []string{"wikidata"}, Kind: "web",
			})
			if len(out) >= opts.MaxResults {
				break
			}
		}
		return out, nil
	}
	refs, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		// 批 11 挂账清账(实弹取证): 全短语 "who is linus torvalds" 进实体搜索词面 search:[](0 命中),
		// 剥离意图词后 "linus torvalds"→Q34253 直中; 再 asciiFace 降级一次;
		// 仍空=词面性空结果合法归零防熔断污染(rubygems/openfda 惯例, 原实现 error 上抛致熔断误开)
		if stripped := b12StripEntityIntent(opts.Query); stripped != "" && stripped != opts.Query {
			refs, err = fetch(stripped)
		}
		if len(refs) == 0 {
			if face := asciiFace(opts.Query); face != "" && face != opts.Query {
				refs, err = fetch(face)
			}
		}
		if len(refs) == 0 {
			return []Reference{}, nil
		}
	}
	// b13 P1-a: top-1 实体 claims 直答("对而不答"→"对且答") — "华为 创始人 是谁"
	// 命中 Huawei Q160120 后补取 P112 → snippet 追加 " · 创始人 任正非 (Ren Zhengfei)";
	// "capital of Australia" 命中 Australia Q408 → " · 首都 Canberra"。enrich 失败静默降级。
	// b16 泛化探针意图感知化: 查询携带答案意图词(创始人/人口/首都…)时, 批量取 top-3
	// claims 找携带该属性的实体直答 — "特斯拉 创始人 是谁" 模糊匹配 top-1 是
	// Nikola Tesla(人), Tesla 公司(带 P112)在第 2 位, 原 top-1-only 路径丢失直答。
	if len(refs) > 0 {
		lang := firstLang(opts)
		if pid := b13QueryIntentPID(opts.Query); pid != "" {
			qids, idxByQID := []string{}, map[string]int{}
			for i, r := range refs {
				if i >= 3 {
					break
				}
				if m := b13QIDRe.FindStringSubmatch(r.Title); m != nil {
					qids = append(qids, m[1])
					idxByQID[m[1]] = i
				}
			}
			if hitQID, extra := b13EnrichEntityClaimsIntent(ctx, client, qids, lang, pid); hitQID != "" && extra != "" {
				i := idxByQID[hitQID]
				refs[i].Snippet = clampText(refs[i].Snippet+extra, 400)
			}
		} else if m := b13QIDRe.FindStringSubmatch(refs[0].Title); m != nil {
			if extra := b13EnrichEntityClaims(ctx, client, m[1], lang); extra != "" {
				refs[0].Snippet = clampText(refs[0].Snippet+extra, 400)
			}
		}
	}
	return refs, nil
}

// ---------- pubmed (esearch→esummary 两跳; polite tool/email) ----------
func lanePubmed(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	politeness := map[string]bool{}
	_ = politeness
	// esearch
	req1, _ := http.NewRequestWithContext(ctx, "GET", "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", nil)
	q1 := req1.URL.Query()
	q1.Set("db", "pubmed")
	q1.Set("term", opts.Query)
	q1.Set("retmode", "json")
	q1.Set("retmax", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	q1.Set("tool", "search-core")
	if email := osGetenv2("SC_CONTACT_EMAIL"); email != "" {
		q1.Set("email", email)
	}
	req1.URL.RawQuery = q1.Encode()
	req1.Header.Set("User-Agent", laneUA)
	req1.Header.Set("Accept", "application/json")
	r1, err := client.Do(req1)
	if err != nil {
		return nil, err
	}
	var d1 struct {
		Esearchresult struct {
			Idlist []string `json:"idlist"`
		} `json:"esearchresult"`
	}
	err = json.Unmarshal([]byte(readAllString(r1.Body)), &d1)
	r1.Body.Close()
	if err != nil {
		return nil, fmt.Errorf("pubmed esearch: bad json: %w", err)
	}
	if r1.StatusCode != 200 {
		return nil, fmt.Errorf("pubmed esearch http %d", r1.StatusCode)
	}
	ids := d1.Esearchresult.Idlist
	if len(ids) == 0 {
		return nil, fmt.Errorf("pubmed: no results parsed")
	}
	// esummary
	req2, _ := http.NewRequestWithContext(ctx, "GET", "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", nil)
	q2 := req2.URL.Query()
	q2.Set("db", "pubmed")
	q2.Set("retmode", "json")
	q2.Set("id", strings.Join(ids, ","))
	q2.Set("tool", "search-core")
	if email := osGetenv2("SC_CONTACT_EMAIL"); email != "" {
		q2.Set("email", email)
	}
	req2.URL.RawQuery = q2.Encode()
	req2.Header.Set("User-Agent", laneUA)
	req2.Header.Set("Accept", "application/json")
	r2, err := client.Do(req2)
	if err != nil {
		return nil, err
	}
	defer r2.Body.Close()
	if r2.StatusCode != 200 {
		return nil, fmt.Errorf("pubmed esummary http %d", r2.StatusCode)
	}
	var d2 struct {
		Result map[string]struct {
			Title           string `json:"title"`
			FullJournalName string `json:"fulljournalname"`
			Booktitle       string `json:"booktitle"`
			Pubdate         string `json:"pubdate"`
			Sortfirstauthor string `json:"sortfirstauthor"`
			Lastauthor      string `json:"lastauthor"`
		} `json:"result"`
	}
	if err := json.Unmarshal([]byte(readAllString(r2.Body)), &d2); err != nil {
		return nil, fmt.Errorf("pubmed esummary: bad json: %w", err)
	}
	var out []Reference
	for _, id := range ids {
		s, ok := d2.Result[id]
		if !ok || s.Title == "" {
			continue
		}
		journal := s.FullJournalName
		if journal == "" {
			journal = s.Booktitle
		}
		author := s.Sortfirstauthor
		if author == "" {
			author = s.Lastauthor
		}
		meta := []string{}
		if journal != "" {
			meta = append(meta, journal)
		}
		if s.Pubdate != "" {
			meta = append(meta, s.Pubdate)
		}
		if author != "" {
			meta = append(meta, author)
		}
		out = append(out, Reference{
			URL: fmt.Sprintf("https://pubmed.ncbi.nlm.nih.gov/%s/", id), Title: clampText(s.Title, 200),
			Snippet: clampText("[pubmed] "+strings.Join(meta, " · "), 400),
			Engines: []string{"pubmed"}, Published: s.Pubdate, Kind: "web",
		})
		if len(out) >= opts.MaxResults {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("pubmed: no results parsed")
	}
	return out, nil
}

func osGetenv2(k string) string { return os.Getenv(k) }

// ---------- nominatim (OSM 地理编码; 空结果合法空) ----------
func laneNominatim(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://nominatim.openstreetmap.org/search", nil)
		p := req.URL.Query()
		p.Set("q", q)
		p.Set("format", "jsonv2")
		p.Set("limit", fmt.Sprintf("%d", min(opts.MaxResults, 10)))
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("nominatim http %d", resp.StatusCode)
		}
		var rows []struct {
			OsmType     string `json:"osm_type"`
			OsmID       *int64 `json:"osm_id"`
			Lat         string `json:"lat"`
			Lon         string `json:"lon"`
			DisplayName string `json:"display_name"`
			Type        string `json:"type"`
			Class       string `json:"class"`
		}
		if err := json.Unmarshal([]byte(readAllString(resp.Body)), &rows); err != nil {
			return nil, fmt.Errorf("nominatim: bad json: %w", err)
		}
		var out []Reference
		for _, p := range rows {
			if p.DisplayName == "" || p.OsmType == "" || p.OsmID == nil {
				continue
			}
			out = append(out, Reference{
				URL:     fmt.Sprintf("https://www.openstreetmap.org/%s/%d", p.OsmType, *p.OsmID),
				Title:   clampText(p.DisplayName, 200),
				Snippet: clampText(fmt.Sprintf("[geo] %s/%s @ %s,%s", p.Class, p.Type, p.Lat, p.Lon), 400),
				Engines: []string{"nominatim"}, Kind: "geo",
			})
			if len(out) >= opts.MaxResults {
				break
			}
		}
		return out, nil // 空=合法空
	}
	refs, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		// b13: 意图词剥离("where is Eiffel Tower coordinates"→"Eiffel Tower",
		// "西湖 在哪 位置 坐标"→"西湖" — nominatim 中文地理编码原生可中)
		if s := b13StripIntent(opts.Query, b13GeoIntentRe); s != "" && s != opts.Query {
			refs, err = fetch(s)
		}
	}
	return refs, err
}

// ---------- pypi (JSON API 包名精确查询; 非包名查询合法空零请求) ----------
var pypiNameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,99}$`)

func lanePypi(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	name := strings.ToLower(strings.TrimSpace(opts.Query))
	if !pypiNameRe.MatchString(name) {
		return []Reference{}, nil
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://pypi.org/pypi/"+name+"/json", nil)
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return []Reference{}, nil
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("pypi http %d", resp.StatusCode)
	}
	var d struct {
		Info struct {
			Name           string `json:"name"`
			Version        string `json:"version"`
			Summary        string `json:"summary"`
			License        string `json:"license"`
			RequiresPython string `json:"requires_python"`
		} `json:"info"`
		URLs []struct {
			UploadTime string `json:"upload_time"`
		} `json:"urls"`
	}
	if err := json.Unmarshal([]byte(readAllString(resp.Body)), &d); err != nil {
		return nil, fmt.Errorf("pypi: bad json: %w", err)
	}
	if d.Info.Name == "" {
		return nil, fmt.Errorf("pypi: no results parsed")
	}
	v := d.Info.Version
	meta := []string{}
	if v != "" {
		meta = append(meta, "v"+v)
	}
	if d.Info.License != "" {
		meta = append(meta, "license: "+d.Info.License)
	}
	if len(d.URLs) > 0 && d.URLs[0].UploadTime != "" {
		meta = append(meta, "published "+d.URLs[0].UploadTime[:10])
	}
	summary := ""
	if d.Info.Summary != "" {
		summary = " · " + d.Info.Summary
	}
	title := d.Info.Name
	if v != "" {
		title = d.Info.Name + "@" + v
	}
	published := ""
	if len(d.URLs) > 0 {
		published = d.URLs[0].UploadTime
	}
	return []Reference{{
		URL: fmt.Sprintf("https://pypi.org/project/%s/", d.Info.Name), Title: clampText(title, 200),
		Snippet: clampText("[pypi] "+strings.Join(meta, " · ")+summary, 400),
		Engines: []string{"pypi"}, Published: published, Kind: "web",
	}}, nil
}

// ---------- hfpapers (HF Papers AI 论文面) ----------
func laneHfpapers(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	// b13 P2: 慢腿 8s 短截止(冷跑实测 11-20s)
	ctx, cancel := b13SlowLegCtx(ctx)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://huggingface.co/api/papers/search", nil)
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
		return nil, fmt.Errorf("hfpapers http %d", resp.StatusCode)
	}
	var d []struct {
		Paper *struct {
			ID          string `json:"id"`
			Title       string `json:"title"`
			Summary     string `json:"summary"`
			PublishedAt string `json:"publishedAt"`
		} `json:"paper"`
	}
	if err := json.Unmarshal([]byte(readAllString(resp.Body)), &d); err != nil {
		return nil, fmt.Errorf("hfpapers: bad json: %w", err)
	}
	var out []Reference
	for _, x := range d {
		p := x.Paper
		if p == nil || p.ID == "" || p.Title == "" {
			continue
		}
		summary := ""
		if p.Summary != "" {
			s := []rune(p.Summary)
			if len(s) > 160 {
				s = s[:160]
			}
			summary = " · " + string(s)
		}
		out = append(out, Reference{
			URL: "https://huggingface.co/papers/" + p.ID, Title: clampText(p.Title, 200),
			Snippet: clampText(fmt.Sprintf("[hf-paper] arXiv:%s%s", p.ID, summary), 400),
			Engines: []string{"hfpapers"}, Published: p.PublishedAt, Kind: "web",
		})
		if len(out) >= opts.MaxResults {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("hfpapers: no results parsed")
	}
	return out, nil
}

// ---------- 安全三腿: nvd / osv / ghsa (CVE 编号直取, 无编号合法空零请求) ----------
func laneNvd(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	cve := extractCveId(opts.Query)
	if cve == "" {
		return []Reference{}, nil
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://services.nvd.nist.gov/rest/json/cves/2.0", nil)
	q := req.URL.Query()
	q.Set("cveId", cve)
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return []Reference{}, nil
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("nvd http %d", resp.StatusCode)
	}
	var d struct {
		Vulnerabilities []struct {
			CVE struct {
				ID           string `json:"id"`
				Published    string `json:"published"`
				Descriptions []struct {
					Lang  string `json:"lang"`
					Value string `json:"value"`
				} `json:"descriptions"`
				Metrics struct {
					V31 []struct {
						CvssData struct {
							BaseScore float64 `json:"baseScore"`
						} `json:"cvssData"`
					} `json:"cvssMetricV31"`
					V30 []struct {
						CvssData struct {
							BaseScore float64 `json:"baseScore"`
						} `json:"cvssData"`
					} `json:"cvssMetricV30"`
				} `json:"metrics"`
			} `json:"cve"`
		} `json:"vulnerabilities"`
	}
	if err := json.Unmarshal([]byte(readAllString(resp.Body)), &d); err != nil {
		return nil, fmt.Errorf("nvd: bad json: %w", err)
	}
	if len(d.Vulnerabilities) == 0 || d.Vulnerabilities[0].CVE.ID == "" {
		return nil, fmt.Errorf("nvd: no results parsed")
	}
	v := d.Vulnerabilities[0].CVE
	desc := ""
	for _, dd := range v.Descriptions {
		if dd.Lang == "en" {
			desc = dd.Value
			break
		}
	}
	firstSentence := desc
	if i := strings.Index(desc, ". "); i >= 0 {
		firstSentence = desc[:i]
	}
	scoreLine := ""
	var score float64
	if len(v.Metrics.V31) > 0 {
		score = v.Metrics.V31[0].CvssData.BaseScore
	} else if len(v.Metrics.V30) > 0 {
		score = v.Metrics.V30[0].CvssData.BaseScore
	}
	if score != 0 {
		scoreLine = fmt.Sprintf(" · CVSS %v", score)
	}
	return []Reference{{
		URL:     "https://nvd.nist.gov/vuln/detail/" + v.ID,
		Title:   clampText(v.ID+": "+firstSentence, 200),
		Snippet: clampText("[nvd] "+desc+scoreLine, 400),
		Engines: []string{"nvd"}, Published: v.Published, Kind: "web",
	}}, nil
}

func laneOsv(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	cve := extractCveId(opts.Query)
	if cve == "" {
		return []Reference{}, nil
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.osv.dev/v1/vulns/"+cve, nil)
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return []Reference{}, nil
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("osv http %d", resp.StatusCode)
	}
	var d struct {
		ID       string   `json:"id"`
		Summary  string   `json:"summary"`
		Details  string   `json:"details"`
		Aliases  []string `json:"aliases"`
		Modified string   `json:"modified"`
	}
	if err := json.Unmarshal([]byte(readAllString(resp.Body)), &d); err != nil {
		return nil, fmt.Errorf("osv: bad json: %w", err)
	}
	if d.ID == "" {
		return nil, fmt.Errorf("osv: no results parsed")
	}
	aliases := ""
	if len(d.Aliases) > 0 {
		a := d.Aliases
		if len(a) > 3 {
			a = a[:3]
		}
		aliases = " · aliases: " + strings.Join(a, ", ")
	}
	title := cve
	if d.Summary != "" {
		title = cve + ": " + d.Summary
	}
	details := ""
	if d.Details != "" {
		details = " · " + d.Details
	}
	return []Reference{{
		URL: "https://osv.dev/vulnerability/" + cve, Title: clampText(title, 200),
		Snippet: clampText("[osv] "+d.Summary+details+aliases, 400),
		Engines: []string{"osv"}, Published: d.Modified, Kind: "web",
	}}, nil
}

func laneGhsa(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	cve := extractCveId(opts.Query)
	if cve == "" {
		return []Reference{}, nil
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/advisories", nil)
	q := req.URL.Query()
	q.Set("cve_id", cve)
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("ghsa http %d", resp.StatusCode)
	}
	var list []struct {
		GhsaID      string `json:"ghsa_id"`
		HTMLURL     string `json:"html_url"`
		Summary     string `json:"summary"`
		Severity    string `json:"severity"`
		PublishedAt string `json:"published_at"`
		CVSS        *struct {
			Score *float64 `json:"score"`
		} `json:"cvss"`
	}
	if err := json.Unmarshal([]byte(readAllString(resp.Body)), &list); err != nil {
		return nil, fmt.Errorf("ghsa: bad json: %w", err)
	}
	if len(list) == 0 || list[0].GhsaID == "" {
		return []Reference{}, nil // TS: a 不存在 → return []
	}
	a := list[0]
	u := "https://github.com/advisories/" + a.GhsaID
	if strings.HasPrefix(a.HTMLURL, "http") {
		u = a.HTMLURL
	}
	title := a.Summary
	if title == "" {
		title = cve
	}
	title = title + " (" + a.GhsaID + ")"
	sev := "?"
	if a.Severity != "" {
		sev = a.Severity
	}
	cvss := ""
	if a.CVSS != nil && a.CVSS.Score != nil {
		cvss = fmt.Sprintf(" · CVSS %v", *a.CVSS.Score)
	}
	return []Reference{{
		URL: u, Title: clampText(title, 200),
		Snippet: clampText(fmt.Sprintf("[ghsa] severity: %s%s · %s", sev, cvss, cve), 400),
		Engines: []string{"ghsa"}, Published: a.PublishedAt, Kind: "web",
	}}, nil
}

// ---------- wiktionary (en+zh 双语; CJK→zh.wiktionary; 零命中合法空) ----------
// b15 质量抽检: wiktionary 对 "ubiquitous meaning etymology" 整串 srsearch 返回 dopeness/
// félkövér 随机词条(原词有结果但答非所问, browser-ext 同款病灶) — 先剥意图词后查裸词,
// 剥光/剥后零命中时原词兜底
func laneWiktionary(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	// b15 质量抽检: wiktionary 对 "ubiquitous meaning etymology" 整串 srsearch 返回 dopeness/
	// félkövér 随机词条(原词有结果但答非所问, browser-ext 同款病灶) — 先剥意图词后查裸词,
	// 剥光/剥后零命中时原词兜底
	fetch := func(q string) ([]Reference, error) {
		h := "en.wiktionary.org"
		if cjkRe.MatchString(q) {
			h = "zh.wiktionary.org"
		}
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://"+h+"/w/api.php", nil)
		qp := req.URL.Query()
		qp.Set("action", "query")
		qp.Set("format", "json")
		qp.Set("list", "search")
		qp.Set("srsearch", q)
		qp.Set("srlimit", fmt.Sprintf("%d", min(opts.MaxResults, 10)))
		req.URL.RawQuery = qp.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("wiktionary http %d", resp.StatusCode)
		}
		var d struct {
			Query struct {
				Search []struct {
					Title   string `json:"title"`
					Snippet string `json:"snippet"`
				} `json:"search"`
			} `json:"query"`
		}
		if err := json.Unmarshal([]byte(readAllString(resp.Body)), &d); err != nil {
			return nil, fmt.Errorf("wiktionary: bad json: %w", err)
		}
		var out []Reference
		for _, hit := range d.Query.Search {
			if hit.Title == "" {
				continue
			}
			out = append(out, Reference{
				URL:     "https://" + h + "/wiki/" + urlPathEscape(hit.Title),
				Title:   clampText(hit.Title, 200),
				Snippet: clampText("[wiktionary] "+stripHtml(hit.Snippet), 400),
				Engines: []string{"wiktionary"}, Kind: "web",
			})
			if len(out) >= opts.MaxResults {
				break
			}
		}
		return out, nil // 零命中合法空
	}
	face := b13StripIntent(opts.Query, b13DictionaryIntentRe)
	if face != "" && face != opts.Query {
		refs, err := fetch(face) // 先剥后查: 裸词直中词条
		if err == nil && len(refs) > 0 {
			return refs, nil
		}
	}
	return fetch(opts.Query) // 原词兜底
}

// ---------- europepmc (PMID/PMC/DOI 直链; 零命中合法空) ----------
func laneEuropepmc(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://www.ebi.ac.uk/europepmc/webservices/rest/search", nil)
	q := req.URL.Query()
	q.Set("query", opts.Query)
	q.Set("format", "json")
	q.Set("pageSize", fmt.Sprintf("%d", min(opts.MaxResults, 25)))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("europepmc http %d", resp.StatusCode)
	}
	var d struct {
		ResultList struct {
			Result []struct {
				Title        string `json:"title"`
				AuthorString string `json:"authorString"`
				JournalTitle string `json:"journalTitle"`
				PubYear      string `json:"pubYear"`
				DOI          string `json:"doi"`
				PMID         string `json:"pmid"`
				PMCID        string `json:"pmcid"`
				IsOpenAccess string `json:"isOpenAccess"`
			} `json:"result"`
		} `json:"resultList"`
	}
	if err := json.Unmarshal([]byte(readAllString(resp.Body)), &d); err != nil {
		return nil, fmt.Errorf("europepmc: bad json: %w", err)
	}
	var out []Reference
	for _, r := range d.ResultList.Result {
		if r.Title == "" {
			continue
		}
		meta := []string{}
		for _, v := range []string{r.AuthorString, r.JournalTitle, r.PubYear} {
			if v != "" {
				meta = append(meta, v)
			}
		}
		if r.IsOpenAccess == "Y" {
			meta = append(meta, "OA")
		}
		u := "https://europepmc.org"
		if r.PMID != "" {
			u = "https://europepmc.org/article/MED/" + r.PMID
		} else if r.PMCID != "" {
			u = "https://europepmc.org/article/PMC/" + r.PMCID
		} else if r.DOI != "" {
			u = "https://doi.org/" + r.DOI
		}
		published := ""
		if r.PubYear != "" {
			published = r.PubYear + "-01-01"
		}
		out = append(out, Reference{
			URL: u, Title: clampText(r.Title, 200),
			Snippet: clampText("[europepmc] "+strings.Join(meta, " · "), 400),
			Engines: []string{"europepmc"}, Published: published, Kind: "web",
		})
		if len(out) >= opts.MaxResults {
			break
		}
	}
	return out, nil
}

// ---------- clinicaltrials (NCT 直链; 零命中合法空) ----------
func laneClinicaltrials(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://clinicaltrials.gov/api/v2/studies", nil)
	q := req.URL.Query()
	q.Set("query.term", opts.Query)
	q.Set("pageSize", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	q.Set("fields", "NCTId,BriefTitle,OverallStatus,Condition,EnrollmentCount")
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("clinicaltrials http %d", resp.StatusCode)
	}
	var d struct {
		Studies []struct {
			ProtocolSection struct {
				IdentificationModule struct {
					NctID      string `json:"nctId"`
					BriefTitle string `json:"briefTitle"`
				} `json:"identificationModule"`
				StatusModule struct {
					OverallStatus string `json:"overallStatus"`
				} `json:"statusModule"`
				ConditionsModule struct {
					Conditions []string `json:"conditions"`
				} `json:"conditionsModule"`
			} `json:"protocolSection"`
		} `json:"studies"`
	}
	if err := json.Unmarshal([]byte(readAllString(resp.Body)), &d); err != nil {
		return nil, fmt.Errorf("clinicaltrials: bad json: %w", err)
	}
	var out []Reference
	for _, s := range d.Studies {
		p := s.ProtocolSection
		if p.IdentificationModule.NctID == "" {
			continue
		}
		nct := p.IdentificationModule.NctID
		cond := ""
		if len(p.ConditionsModule.Conditions) > 0 {
			cond = p.ConditionsModule.Conditions[0]
		}
		parts := []string{nct}
		if p.StatusModule.OverallStatus != "" {
			parts = append(parts, p.StatusModule.OverallStatus)
		}
		if cond != "" {
			parts = append(parts, cond)
		}
		title := p.IdentificationModule.BriefTitle
		if title == "" {
			title = nct
		}
		out = append(out, Reference{
			URL: "https://clinicaltrials.gov/study/" + nct, Title: clampText(title, 200),
			Snippet: clampText("[clinicaltrials] "+strings.Join(parts, " · "), 400),
			Engines: []string{"clinicaltrials"}, Kind: "web",
		})
		if len(out) >= opts.MaxResults {
			break
		}
	}
	return out, nil
}

// ---------- worldbank (指标码+国家码小保守映射; 未知指标合法空零请求) ----------
type wbIndicator struct {
	keys  []string
	code  string
	label string
}

var wbIndicators = []wbIndicator{
	{[]string{"gdp", "国内生产总值", "经济总量"}, "NY.GDP.MKTP.CD", "GDP"},
	{[]string{"gni", "人均收入"}, "NY.GNP.PCAP.CD", "GNI per capita"},
	{[]string{"population", "人口"}, "SP.POP.TOTL", "Population"},
	{[]string{"inflation", "通胀", "通货膨胀"}, "FP.CPI.TOTL.ZG", "Inflation"},
	{[]string{"unemployment", "失业率"}, "SL.UEM.TOTL.ZS", "Unemployment"},
	{[]string{"co2", "碳排放"}, "EN.ATM.CO2E.PC", "CO2 per capita"},
}

var wbCountries = []struct {
	keys []string
	iso  string
}{
	{[]string{"china", "chinese", "中国"}, "CN"},
	{[]string{"united states", "usa", "america", "美国"}, "US"},
	{[]string{"japan", "日本"}, "JP"},
	{[]string{"india", "印度"}, "IN"},
	{[]string{"germany", "德国"}, "DE"},
	{[]string{"united kingdom", "britain", "英国"}, "GB"},
	{[]string{"russia", "俄罗斯"}, "RU"},
	{[]string{"korea", "韩国"}, "KR"},
	{[]string{"brazil", "巴西"}, "BR"},
	{[]string{"world", "global", "全球", "世界"}, "WLD"},
}

func laneWorldbank(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	low := strings.ToLower(opts.Query)
	// 指标: 最长关键词所属指标胜出(与 detectCategory 同消歧纪律)
	var ind *wbIndicator
	bestLen := 0
	for i := range wbIndicators {
		clsLen := 0
		for _, k := range wbIndicators[i].keys {
			if len(k) > clsLen && strings.Contains(low, k) {
				clsLen = len(k)
			}
		}
		if clsLen > bestLen {
			ind = &wbIndicators[i]
			bestLen = clsLen
		}
	}
	if ind == nil {
		return []Reference{}, nil // 未知指标合法空零请求
	}
	cIso := "WLD"
	for _, c := range wbCountries {
		for _, k := range c.keys {
			if strings.Contains(low, k) {
				cIso = c.iso
				break
			}
		}
	}
	yearRe := regexp.MustCompile(`\b(19|20)\d{2}\b`)
	nowY := 2026
	date := fmt.Sprintf("%d:%d", nowY-5, nowY)
	if ym := yearRe.FindString(low); ym != "" {
		var y int
		fmt.Sscanf(ym, "%d", &y)
		date = fmt.Sprintf("%d:%d", y-2, y)
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("https://api.worldbank.org/v2/country/%s/indicator/%s", cIso, ind.code), nil)
	q := req.URL.Query()
	q.Set("format", "json")
	q.Set("per_page", "6")
	q.Set("date", date)
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return []Reference{}, nil
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("worldbank http %d", resp.StatusCode)
	}
	var data []json.RawMessage
	if err := json.Unmarshal([]byte(readAllString(resp.Body)), &data); err != nil {
		return nil, fmt.Errorf("worldbank: bad json: %w", err)
	}
	if len(data) < 2 {
		return []Reference{}, nil
	}
	var rows []struct {
		Date    string   `json:"date"`
		Value   *float64 `json:"value"`
		Country *struct {
			ID    string `json:"id"`
			Value string `json:"value"`
		} `json:"country"`
	}
	if err := json.Unmarshal(data[1], &rows); err != nil {
		return nil, fmt.Errorf("worldbank: bad rows: %w", err)
	}
	if len(rows) == 0 {
		return []Reference{}, nil // 合法空
	}
	var pts []string
	for _, r := range rows {
		if r.Value != nil {
			pts = append(pts, fmt.Sprintf("%s: %v", r.Date, *r.Value))
		}
		if len(pts) >= 4 {
			break
		}
	}
	countryName := cIso
	if rows[0].Country != nil && rows[0].Country.Value != "" {
		countryName = rows[0].Country.Value
	}
	loc := cIso
	if rows[0].Country != nil && rows[0].Country.ID != "" {
		loc = rows[0].Country.ID
	}
	body := strings.Join(pts, " · ")
	if body == "" {
		body = "no data in window"
	}
	return []Reference{{
		URL:     fmt.Sprintf("https://data.worldbank.org/indicator/%s?locations=%s", ind.code, loc),
		Title:   clampText(countryName+" "+ind.label+" — World Bank", 200),
		Snippet: clampText("[worldbank] "+body, 400),
		Engines: []string{"worldbank"}, Kind: "web",
	}}, nil
}

// ---------- 探针第 6 批: commonswiki/openmeteo ----------
// 探针实测(2026-09-05): commons 4/4 稳 200(648-835ms); open-meteo geocode+forecast
// 两腿 6/6 全 200(255-1058ms, 无间隔连发触发限频→腿内天然带一次 geocode 限频安全)。

// ---------- commonswiki (Wikimedia Commons 自由媒体图库, File 命名空间全文搜) ----------
type commonsResp struct {
	Query struct {
		Pages map[string]struct {
			PageID    int64  `json:"pageid"`
			Title     string `json:"title"`
			Index     int    `json:"index"`
			ImageInfo []struct {
				URL            string `json:"url"`
				DescriptionURL string `json:"descriptionurl"`
				Width          int    `json:"width"`
				Height         int    `json:"height"`
			} `json:"imageinfo"`
		} `json:"pages"`
	} `json:"query"`
}

func parseCommons(data []byte, max int) ([]Reference, error) {
	var d commonsResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("commons: bad json: %w", err)
	}
	// map 迭代无序: 按 index 排序对齐搜索相关度
	type page = struct {
		PageID    int64  `json:"pageid"`
		Title     string `json:"title"`
		Index     int    `json:"index"`
		ImageInfo []struct {
			URL            string `json:"url"`
			DescriptionURL string `json:"descriptionurl"`
			Width          int    `json:"width"`
			Height         int    `json:"height"`
		} `json:"imageinfo"`
	}
	pages := make([]page, 0, len(d.Query.Pages))
	for _, p := range d.Query.Pages {
		pages = append(pages, p)
	}
	for i := 1; i < len(pages); i++ {
		for j := i; j > 0 && pages[j].Index < pages[j-1].Index; j-- {
			pages[j], pages[j-1] = pages[j-1], pages[j]
		}
	}
	out := make([]Reference, 0, max)
	for _, p := range pages {
		if p.Title == "" || len(p.ImageInfo) == 0 {
			continue
		}
		ii := p.ImageInfo[0]
		u := ii.DescriptionURL
		if u == "" {
			u = ii.URL
		}
		name := strings.TrimPrefix(p.Title, "File:")
		if dot := strings.LastIndex(name, "."); dot > 0 {
			name = name[:dot] // 去扩展名噪音
		}
		dim := ""
		if ii.Width > 0 && ii.Height > 0 {
			dim = fmt.Sprintf(" · %d×%d", ii.Width, ii.Height)
		}
		out = append(out, Reference{
			URL:       u,
			Title:     clampText(name, 200),
			Snippet:   clampText("Wikimedia Commons 自由许可媒体"+dim, 400),
			Engines:   []string{"commonswiki"},
			Authority: "commons.wikimedia.org",
			Kind:      "image",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneCommonswiki(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://commons.wikimedia.org/w/api.php", nil)
	q := req.URL.Query()
	q.Set("action", "query")
	q.Set("generator", "search")
	q.Set("gsrsearch", opts.Query)
	q.Set("gsrnamespace", "6") // File 命名空间
	q.Set("gsrlimit", fmt.Sprintf("%d", min(opts.MaxResults, 8)))
	q.Set("prop", "imageinfo")
	q.Set("iiprop", "url")
	q.Set("format", "json")
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("commons http %d", resp.StatusCode)
	}
	return parseCommons([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- openmeteo (天气实况双腿车道: geocode 定位 → forecast 实况) ----------
// 天气意图词(路由层 weather 域关键词之外的行内二次守卫)
var weatherWordRe = regexp.MustCompile(`(?i)(weather|forecast|temperature|humidity|天气|气温|温度|预报|降水|降雨|下雨|下雪|湿度)`)

// 地点锚提取: 剥天气词/时间词/介词, 余量即地点
var weatherStripRe = regexp.MustCompile(`(?i)(weather|forecast|temperature|humidity|rain|snow|wind|today|tomorrow|now|current|天气|气温|温度|预报|降水|降雨|下雪|下雨|湿度|今天|明天|现在|此刻)\s*`)

func meteoPlaceAnchor(query string) string {
	s := weatherStripRe.ReplaceAllString(query, " ")
	fields := strings.Fields(s)
	keep := make([]string, 0, len(fields))
	for _, f := range fields {
		low := strings.ToLower(f)
		if low == "in" || low == "at" || low == "of" || low == "的" {
			continue // 介词噪音
		}
		keep = append(keep, f)
	}
	return strings.Join(keep, " ")
}

// WMO weather_code 释义(WMO 4677)
var wmoDesc = map[int]string{
	0: "晴", 1: "基本晴", 2: "局部多云", 3: "阴",
	45: "雾", 48: "雾凇",
	51: "小毛毛雨", 53: "毛毛雨", 55: "大毛毛雨", 56: "冻毛毛雨", 57: "强冻毛毛雨",
	61: "小雨", 63: "中雨", 65: "大雨", 66: "冻雨", 67: "强冻雨",
	71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
	80: "小阵雨", 81: "阵雨", 82: "强阵雨", 85: "小阵雪", 86: "阵雪",
	95: "雷暴", 96: "雷暴伴冰雹", 99: "强雷暴伴冰雹",
}

func wmoText(code int) string {
	if s, ok := wmoDesc[code]; ok {
		return s
	}
	return fmt.Sprintf("WMO %d", code)
}

// meteoPlace 腿1 定位结果(Nominatim): 简体/繁体/英文地名全覆盖, 自带相关度排序
// (open-meteo 自家 geocoding 中文索引只认繁体, 简体"东京"仅命中村庄 — 实弹关账)
type meteoPlace struct {
	DisplayName string  `json:"display_name"`
	Latitude    float64 `json:"lat,string"`
	Longitude   float64 `json:"lon,string"`
}

// placeLabel 展示名: display_name 逗号分段的头两段("東京都, 日本"; "Paris, Île-de-France, France"→"Paris, Île-de-France")
func placeLabel(displayName string) string {
	parts := strings.Split(displayName, ",")
	if len(parts) <= 2 {
		return strings.TrimSpace(displayName)
	}
	return strings.TrimSpace(parts[0] + ", " + strings.TrimSpace(parts[1]))
}

type meteoFc struct {
	Timezone string `json:"timezone"`
	Current  struct {
		Time          string   `json:"time"`
		Temperature2m *float64 `json:"temperature_2m"`
		WeatherCode   *int     `json:"weather_code"`
	} `json:"current"`
}

// composeMeteo 纯函数组装: geocode+forecast 双样本 → 单条实况引用
func composeMeteo(loc meteoPlace, f meteoFc, qLang string) []Reference {
	if loc.DisplayName == "" {
		return []Reference{}
	}
	place := placeLabel(loc.DisplayName)
	title := place + " 天气实况"
	if !cjkRe.MatchString(qLang) {
		title = place + " current weather"
	}
	snip := ""
	if f.Current.Temperature2m != nil {
		snip = fmt.Sprintf("%.1f°C", *f.Current.Temperature2m)
	}
	if f.Current.WeatherCode != nil {
		snip += " " + wmoText(*f.Current.WeatherCode)
	}
	if f.Timezone != "" {
		snip += " · " + f.Timezone
	}
	return []Reference{{
		URL:       fmt.Sprintf("https://open-meteo.com/en/docs/?latitude=%v&longitude=%v", loc.Latitude, loc.Longitude),
		Title:     clampText(title, 200),
		Snippet:   clampText(snip, 400),
		Engines:   []string{"openmeteo"},
		Authority: "open-meteo.com",
		Kind:      "data",
	}}
}

func laneOpenmeteo(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	if !weatherWordRe.MatchString(opts.Query) && !strings.Contains(strings.ToLower(opts.Query), "open-meteo") {
		return []Reference{}, nil // 无天气意图合法空零请求
	}
	place := meteoPlaceAnchor(opts.Query)
	if place == "" {
		return []Reference{}, nil // 无地点锚合法空(如裸 "weather")
	}
	// 腿1: Nominatim 定位(简体"东京"直接命中東京都; open-meteo geocoding 简繁字形墙关账)
	geoReq, _ := http.NewRequestWithContext(ctx, "GET", "https://nominatim.openstreetmap.org/search", nil)
	gq := geoReq.URL.Query()
	gq.Set("q", place)
	gq.Set("format", "json")
	gq.Set("limit", "1")
	geoReq.URL.RawQuery = gq.Encode()
	geoReq.Header.Set("User-Agent", laneUA) // Nominatim 政策: 自标识 UA + 低频, 天气题低频合规
	geoResp, err := client.Do(geoReq)
	if err != nil {
		return nil, err
	}
	defer geoResp.Body.Close()
	if geoResp.StatusCode != 200 {
		return nil, fmt.Errorf("openmeteo geocode http %d", geoResp.StatusCode)
	}
	var places []meteoPlace
	if err := json.NewDecoder(geoResp.Body).Decode(&places); err != nil {
		return nil, fmt.Errorf("openmeteo geocode bad json: %w", err)
	}
	if len(places) == 0 {
		return []Reference{}, nil // 未知地点合法空
	}
	loc := places[0]
	// 腿2: forecast
	fcReq, _ := http.NewRequestWithContext(ctx, "GET", "https://api.open-meteo.com/v1/forecast", nil)
	fq := fcReq.URL.Query()
	fq.Set("latitude", fmt.Sprintf("%v", loc.Latitude))
	fq.Set("longitude", fmt.Sprintf("%v", loc.Longitude))
	fq.Set("current", "temperature_2m,weather_code")
	fq.Set("timezone", "auto")
	fcReq.URL.RawQuery = fq.Encode()
	fcReq.Header.Set("User-Agent", laneUA)
	fcResp, err := client.Do(fcReq)
	if err != nil {
		return nil, err
	}
	defer fcResp.Body.Close()
	if fcResp.StatusCode != 200 {
		return nil, fmt.Errorf("openmeteo forecast http %d", fcResp.StatusCode)
	}
	var f meteoFc
	if err := json.NewDecoder(fcResp.Body).Decode(&f); err != nil {
		return nil, fmt.Errorf("openmeteo forecast bad json: %w", err)
	}
	return composeMeteo(loc, f, opts.Query), nil
}
