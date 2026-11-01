package main

// 学术车道 P2: arxiv (Atom XML) / crossref (JSON, polite pool mailto)

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// ---------- arxiv (官方 courtesy 1 req/3s, 429 显式报错) ----------
type arxivFeed struct {
	XMLName xml.Name `xml:"feed"`
	Entries []struct {
		ID        string `xml:"id"`
		Title     string `xml:"title"`
		Summary   string `xml:"summary"`
		Published string `xml:"published"`
		Links     []struct {
			Href string `xml:"href,attr"`
			Type string `xml:"type,attr"`
		} `xml:"link"`
		Authors []struct {
			Name string `xml:"name"`
		} `xml:"author"`
	} `xml:"entry"`
}

func parseArxiv(data []byte, max int) ([]Reference, error) {
	var feed arxivFeed
	if err := xml.Unmarshal(data, &feed); err != nil {
		return nil, fmt.Errorf("arxiv: bad xml: %w", err)
	}
	var out []Reference
	for _, e := range feed.Entries {
		abs := e.ID
		for _, l := range e.Links {
			if l.Type == "text/html" && strings.HasPrefix(l.Href, "http") {
				abs = l.Href
				break
			}
		}
		if !strings.HasPrefix(abs, "http") || strings.TrimSpace(e.Title) == "" {
			continue
		}
		authors := make([]string, 0, 3)
		for i, a := range e.Authors {
			if i >= 3 {
				break
			}
			authors = append(authors, strings.TrimSpace(a.Name))
		}
		authorPrefix := ""
		if len(authors) > 0 {
			authorPrefix = strings.Join(authors, ", ") + " · "
		}
		published := strings.TrimSpace(e.Published)
		out = append(out, Reference{
			URL: abs, Title: clampText(strings.TrimSpace(e.Title), 200),
			Snippet: clampText(authorPrefix+strings.TrimSpace(e.Summary), 400),
			Engines: []string{"arxiv"}, Published: published, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("arxiv: no entries parsed (markup drift?)")
	}
	return out, nil
}

func laneArxiv(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://export.arxiv.org/api/query", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("search_query", "all:"+opts.Query)
	q.Set("sortBy", "relevance")
	q.Set("max_results", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/atom+xml, application/xml, text/xml")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 429 {
		return nil, fmt.Errorf("arxiv http 429 (official courtesy 1 req/3s; backoff required)")
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("arxiv http %d", resp.StatusCode)
	}
	return parseArxiv([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- crossref (mailto polite pool; SC_CONTACT_EMAIL) ----------
type crossrefResp struct {
	Message struct {
		Items []struct {
			DOI    string   `json:"DOI"`
			Title  []string `json:"title"`
			URL    string   `json:"URL"`
			Author []struct {
				Given  string `json:"given"`
				Family string `json:"family"`
			} `json:"author"`
			Issued struct {
				DateParts [][]int `json:"date-parts"`
			} `json:"issued"`
			ContainerTitle      []string `json:"container-title"`
			IsReferencedByCount int      `json:"is-referenced-by-count"`
		} `json:"items"`
	} `json:"message"`
}

func parseCrossref(data []byte, max int) ([]Reference, error) {
	var d crossrefResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("crossref: bad json: %w", err)
	}
	var out []Reference
	for _, it := range d.Message.Items {
		title := ""
		if len(it.Title) > 0 {
			title = it.Title[0]
		}
		if title == "" {
			title = it.DOI
		}
		if title == "" {
			continue
		}
		authors := make([]string, 0, 3)
		for i, a := range it.Author {
			if i >= 3 {
				break
			}
			name := strings.TrimSpace(strings.TrimSpace(a.Given) + " " + strings.TrimSpace(a.Family))
			if name != "" {
				authors = append(authors, name)
			}
		}
		authorStr := strings.Join(authors, ", ")
		year := ""
		if len(it.Issued.DateParts) > 0 && len(it.Issued.DateParts[0]) > 0 {
			year = fmt.Sprintf("%d", it.Issued.DateParts[0][0])
		}
		meta := []string{}
		if authorStr != "" {
			meta = append(meta, authorStr)
		}
		if len(it.ContainerTitle) > 0 && it.ContainerTitle[0] != "" {
			meta = append(meta, it.ContainerTitle[0])
		}
		if year != "" {
			meta = append(meta, year)
		}
		if it.IsReferencedByCount != 0 {
			meta = append(meta, fmt.Sprintf("cited %d", it.IsReferencedByCount))
		}
		u := fmt.Sprintf("https://doi.org/%s", it.DOI)
		if strings.HasPrefix(it.URL, "http") {
			u = it.URL
		}
		out = append(out, Reference{
			URL: u, Title: clampText(title, 200),
			Snippet: clampText("[paper] "+strings.Join(meta, " · "), 400),
			Engines: []string{"crossref"}, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("crossref: no items parsed (markup drift?)")
	}
	return out, nil
}

func laneCrossref(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.crossref.org/works", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("query", opts.Query)
	q.Set("rows", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	q.Set("select", "DOI,title,URL,author,issued,container-title,is-referenced-by-count")
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
		return nil, fmt.Errorf("crossref http %d", resp.StatusCode)
	}
	return parseCrossref([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- phase AL: zenodo / doaj ----------

// laneZenodo Zenodo 研究产出库(数据集/软件/报告/预印本归档): /api/records?q=&size=8。
// phase AL 探针: 200 三连发 446-804ms, hits.hits[]{metadata.title/description/publication_date, doi, doi_url}。
// 与 openalex/crossref 互补面: 研究数据集与软件的 DOI 存档(openalex 不收)。
func laneZenodo(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	// b13 P2: 慢腿 8s 短截止(冷跑实测 11-20s, 拖满软截止烧 fallback 扩腿)
	ctx, cancel := b13SlowLegCtx(ctx)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://zenodo.org/api/records", nil)
	q := req.URL.Query()
	q.Set("q", opts.Query)
	q.Set("size", "8")
	q.Set("sort", "bestmatch")
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("zenodo http %d", resp.StatusCode)
	}
	var d struct {
		Hits struct {
			Hits []struct {
				ID       int64  `json:"id"` // 探针实证: Zenodo id 是 number
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
	if err := json.NewDecoder(resp.Body).Decode(&d); err != nil {
		return nil, err
	}
	return parseZenodo(d), nil
}

func parseZenodo(d struct {
	Hits struct {
		Hits []struct {
			ID       int64  `json:"id"`
			DOI      string `json:"doi"`
			DOIURL   string `json:"doi_url"`
			Metadata struct {
				Title           string `json:"title"`
				Description     string `json:"description"`
				PublicationDate string `json:"publication_date"`
			} `json:"metadata"`
		} `json:"hits"`
	} `json:"hits"`
}) []Reference {
	out := make([]Reference, 0, len(d.Hits.Hits))
	for _, h := range d.Hits.Hits {
		m := h.Metadata
		if m.Title == "" {
			continue
		}
		u := h.DOIURL
		if u == "" {
			u = "https://zenodo.org/records/" + strconv.FormatInt(h.ID, 10)
		}
		out = append(out, Reference{
			URL:       u,
			Title:     m.Title,
			Snippet:   stripHtmlSnip(m.Description, 240),
			Engines:   []string{"zenodo"},
			Published: m.PublicationDate,
			Authority: "zenodo.org",
			Kind:      "academic",
		})
	}
	return out
}

// laneDoaj 开放期刊文章目录(DOAJ): /api/search/articles/{q}。
// phase AL 探针: 200 三连发 2317-3558ms(偏慢但 6s 软截止内), results[]{bibjson{title,abstract,year,link[]}}。
func laneDoaj(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	u := "https://doaj.org/api/search/articles/" + url.PathEscape(opts.Query) + "?pageSize=8"
	req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("doaj http %d", resp.StatusCode)
	}
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
	if err := json.NewDecoder(resp.Body).Decode(&d); err != nil {
		return nil, err
	}
	return parseDoaj(d), nil
}

func parseDoaj(d struct {
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
}) []Reference {
	out := make([]Reference, 0, len(d.Results))
	for _, r := range d.Results {
		b := r.Bibjson
		if b.Title == "" {
			continue
		}
		u := ""
		for _, l := range b.Link {
			if l.Type == "fulltext" && l.URL != "" {
				u = l.URL
				break
			}
		}
		if u == "" {
			u = "https://doaj.org/article/" + r.ID
		}
		out = append(out, Reference{
			URL:       u,
			Title:     stripHtmlSnip(b.Title, 200), // DOAJ title 带 <bold> 搜索高亮标签(实弹抓获)
			Snippet:   stripHtmlSnip(b.Abstract, 240),
			Engines:   []string{"doaj"},
			Published: b.Year,
			Authority: "doaj.org",
			Kind:      "academic",
		})
	}
	return out
}

// ---------- 探针第 6 批: inspirehep/openaire ----------
// 探针实测(2026-09-05): inspirehep 4/4 稳 200(239-828ms, fields 参数瘦身 2MB→20KB);
// openaire 4/4 稳 200(586ms-1.1s, OAF 嵌套 JSON)。

// ---------- inspirehep (高能物理文献库; 物理意图守卫防学术题噪音腿) ----------
var physicsIntentRe = regexp.MustCompile(`(?i)(physic|hep[-_ ]|particle|quark|neutrino|higgs|qcd|qft|quantum field|dark matter|cosmolog|gravit|superconduc|collider|astrophys|black hole|物理|粒子|夸克|中微子|暗物质|宇宙学|量子场|引力波|核物理|超导|对撞机|黑洞)`)

func laneInspirehep(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	low := strings.ToLower(opts.Query)
	if !strings.Contains(low, "inspire") && !physicsIntentRe.MatchString(low) {
		return []Reference{}, nil // 非物理意图合法空零请求
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://inspirehep.net/api/literature", nil)
	q := req.URL.Query()
	q.Set("q", opts.Query)
	q.Set("size", fmt.Sprintf("%d", min(opts.MaxResults, 8)))
	q.Set("fields", "titles,abstracts,arxiv_eprints,dois,publication_info,citation_count")
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("inspirehep http %d", resp.StatusCode)
	}
	return parseInspirehep([]byte(readAllString(resp.Body)), opts.MaxResults)
}

type inspireMeta struct {
	Titles []struct {
		Title string `json:"title"`
	} `json:"titles"`
	Abstracts []struct {
		Value string `json:"value"`
	} `json:"abstracts"`
	ArxivEprints []struct {
		Value string `json:"value"`
	} `json:"arxiv_eprints"`
	Dois []struct {
		Value string `json:"value"`
	} `json:"dois"`
	PublicationInfo []struct {
		JournalTitle string `json:"journal_title"`
		Year         int    `json:"year"`
	} `json:"publication_info"`
	CitationCount int `json:"citation_count"`
	ControlNumber int `json:"control_number"`
}

func parseInspirehep(data []byte, max int) ([]Reference, error) {
	var d struct {
		Hits struct {
			Hits []struct {
				Meta inspireMeta `json:"metadata"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("inspirehep: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, h := range d.Hits.Hits {
		m := h.Meta
		if len(m.Titles) == 0 || m.Titles[0].Title == "" {
			continue
		}
		// 链接优先级: arXiv > DOI > INSPIRE 记录页
		u := fmt.Sprintf("https://inspirehep.net/literature/%d", m.ControlNumber)
		if len(m.ArxivEprints) > 0 && m.ArxivEprints[0].Value != "" {
			u = "https://arxiv.org/abs/" + m.ArxivEprints[0].Value
		} else if len(m.Dois) > 0 && m.Dois[0].Value != "" {
			u = "https://doi.org/" + m.Dois[0].Value
		}
		snip := ""
		if len(m.Abstracts) > 0 {
			snip = stripHtmlSnip(m.Abstracts[0].Value, 300)
		}
		meta := ""
		if len(m.PublicationInfo) > 0 && m.PublicationInfo[0].JournalTitle != "" {
			meta = m.PublicationInfo[0].JournalTitle
			if m.PublicationInfo[0].Year > 0 {
				meta += fmt.Sprintf(" %d", m.PublicationInfo[0].Year)
			}
		}
		if m.CitationCount > 0 {
			meta = fmt.Sprintf("%s · %d citations", meta, m.CitationCount)
		}
		if snip != "" && meta != "" {
			snip = snip + " · " + meta
		} else if meta != "" {
			snip = meta
		}
		ref := Reference{
			URL:       u,
			Title:     clampText(m.Titles[0].Title, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"inspirehep"},
			Authority: "inspirehep.net",
			Kind:      "academic",
		}
		if len(m.PublicationInfo) > 0 && m.PublicationInfo[0].Year > 0 {
			ref.Published = strconv.Itoa(m.PublicationInfo[0].Year)
		}
		out = append(out, ref)
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

// ---------- openaire (EU 开放科学聚合; OAF 嵌套 JSON, 只收带 DOI 的条目) ----------
// OA 意图守卫: refs 全为 doi.org 链接, 与 crossref 同域重叠 — 仅 OA 意图出勤(差异化定位,
// 对齐 repology 版本意图/inspirehep 物理意图守卫模式; 实测防 uniqDom 稀释)
var openAccessIntentRe = regexp.MustCompile(`(?i)(open[- ]?access|开放获取|open access|openaire)`)

func laneOpenaire(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	if !openAccessIntentRe.MatchString(opts.Query) {
		return []Reference{}, nil // 无 OA 意图合法空零请求
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.openaire.eu/search/publications", nil)
	q := req.URL.Query()
	q.Set("keywords", opts.Query)
	q.Set("size", fmt.Sprintf("%d", min(opts.MaxResults, 8)))
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
		return nil, fmt.Errorf("openaire http %d", resp.StatusCode)
	}
	return parseOpenaire([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// oafStr 提取 OAF 字段的 "$" 文本(map/数组/字符串三态容错)
func oafStr(v any) string {
	switch t := v.(type) {
	case map[string]any:
		if s, ok := t["$"].(string); ok {
			return s
		}
	case []any:
		if len(t) > 0 {
			return oafStr(t[0])
		}
	case string:
		return t
	}
	return ""
}

// oafTitle 取 main title 优先, 无则首个
func oafTitle(v any) string {
	arr, ok := v.([]any)
	if !ok {
		return oafStr(v)
	}
	for _, it := range arr {
		if m, ok := it.(map[string]any); ok {
			if c, _ := m["@classid"].(string); c == "main title" {
				if s, _ := m["$"].(string); s != "" {
					return s
				}
			}
		}
	}
	return oafStr(v)
}

func parseOpenaire(data []byte, max int) ([]Reference, error) {
	var d map[string]any
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("openaire: bad json: %w", err)
	}
	resp, _ := d["response"].(map[string]any)
	results, _ := resp["results"].(map[string]any)
	items, _ := results["result"].([]any)
	out := make([]Reference, 0, max)
	for _, it := range items {
		r, ok := it.(map[string]any)
		if !ok {
			continue
		}
		md, _ := r["metadata"].(map[string]any)
		entity, _ := md["oaf:entity"].(map[string]any)
		res, _ := entity["oaf:result"].(map[string]any)
		if res == nil {
			continue
		}
		title := oafTitle(res["title"])
		if title == "" {
			continue
		}
		// 只收带 DOI 的条目: 无 DOI 无稳定链接, 宁缺毋滥
		doi := ""
		if pid, ok := res["pid"]; ok {
			doi = oafStr(pid)
		}
		if doi == "" {
			continue
		}
		snip := stripHtmlSnip(oafStr(res["description"]), 300)
		if snip == "" {
			snip = oafStr(res["publisher"]) // 无描述条目: 出版方兜底(实弹: 多数 OSF/期刊条目无 description)
		}
		date := oafStr(res["dateofacceptance"])
		if date != "" {
			if snip != "" {
				snip = snip + " · " + date
			} else {
				snip = date
			}
		}
		out = append(out, Reference{
			URL:       "https://doi.org/" + doi,
			Title:     clampText(title, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"openaire"},
			Authority: "openaire.eu",
			Kind:      "academic",
			Published: date,
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}
