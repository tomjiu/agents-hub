package main

// 探针第 8 批: tvmaze/itunes/steam/gbif/openfda/federalregister/courtlistener
// 新域: tv/podcast/games/species/legal/drug — DOMAIN_TABLE 17→23 域
// 黄金样本纪律: fixture 形状/字段值全部取自 2026-09-05 实弹响应(/tmp/probe-b8/shapes/), 不靠记忆。
// 关账台账(第 8 批): gbooks(Google Books 匿名 429×2, 共享配额池耗尽不可控)/jikan(504×2 上游
// MAL 拒连 Jikan 服务本身)/openfoodfacts(fields 参数即 503, 无参数 548KB 肥响应, 工程面不划算)/
// lobsters(fetch failed×3 连接层拒)/devto(q 参数无效=默认流, forem 内部 search 端点 0 条)。
// tvmaze 探针间歇失败归因: Node undici 无 happy-eyeballs, 本机 IPv4 路径劣化时卡死;
// Go net.Dialer 原生 RFC 8305 双栈回退免疫, 车道侧无需特殊处理(curl 与 Go 实弹验证)。

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// ---------- tvmaze (剧集库; 官方无认证无严格限流) ----------
type tvShow struct {
	ID        int64    `json:"id"`
	URL       string   `json:"url"`
	Name      string   `json:"name"`
	Type      string   `json:"type"`
	Language  string   `json:"language"`
	Genres    []string `json:"genres"`
	Status    string   `json:"status"`
	Premiered string   `json:"premiered"`
	Ended     string   `json:"ended"`
	Rating    struct {
		Average float64 `json:"average"`
	} `json:"rating"`
	Summary string `json:"summary"`
}

func parseTvmaze(data []byte, max int) ([]Reference, error) {
	var d []struct {
		Score float64 `json:"score"`
		Show  tvShow  `json:"show"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("tvmaze: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, it := range d {
		s := it.Show
		if s.URL == "" || s.Name == "" {
			continue
		}
		snip := s.Type
		if len(s.Genres) > 0 {
			snip += " · " + strings.Join(s.Genres, ", ")
		}
		if s.Premiered != "" {
			if s.Ended != "" {
				snip += " · " + s.Premiered + "–" + s.Ended
			} else {
				snip += " · " + s.Premiered + "– · " + s.Status
			}
		} else if s.Status != "" {
			snip += " · " + s.Status
		}
		if s.Rating.Average > 0 {
			snip += fmt.Sprintf(" · ★%.1f", s.Rating.Average)
		}
		if body := stripHtmlSnip(s.Summary, 240); body != "" {
			snip += " · " + body
		}
		out = append(out, Reference{
			URL:       s.URL,
			Title:     clampText(s.Name, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"tvmaze"},
			Authority: "api.tvmaze.com",
			Kind:      "tv",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

// tvmaze 搜索是 AND 语义且对中文修饰词全灭(实弹: "breaking bad 第几季"→[], 纯中文"黑镜"→命中多语言别名库)。
// 降级策略: 全词空结果且存在 ASCII 词面时, 用 ASCII 词面重查一次(腿内最多 2 请求, 6s 内合规)。
func asciiFace(q string) string {
	parts := strings.Fields(q)
	var keep []string
	for _, p := range parts {
		isASCII := true
		for _, r := range p {
			if r > 0x7f {
				isASCII = false
				break
			}
		}
		if isASCII {
			keep = append(keep, p)
		}
	}
	return strings.Join(keep, " ")
}

func laneTvmaze(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, int, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.tvmaze.com/search/shows", nil)
		p := req.URL.Query()
		p.Set("q", q)
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, 0, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, resp.StatusCode, fmt.Errorf("tvmaze http %d", resp.StatusCode)
		}
		refs, err := parseTvmaze([]byte(readAllString(resp.Body)), opts.MaxResults)
		return refs, 200, err
	}
	refs, _, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		// b13: 意图词剥离("breaking bad tv series seasons how many"→"breaking bad",
		// "权力的游戏 剧集 第几季"→"权力的游戏", 后者靠 tvmaze 多语言别名库)
		if s := b13StripIntent(opts.Query, b13TVIntentRe); s != "" && s != opts.Query {
			refs, _, err = fetch(s)
		}
	}
	if len(refs) == 0 {
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			refs, _, err = fetch(face) // 混合词全灭→ASCII 词面重查
		}
	}
	return refs, err
}

// ---------- itunes (Apple 播客搜索; ~20 req/min 上限, 腿内单请求天然合规) ----------
type itunesResp struct {
	ResultCount int `json:"resultCount"`
	Results     []struct {
		WrapperType      string `json:"wrapperType"`
		Kind             string `json:"kind"`
		CollectionName   string `json:"collectionName"`
		TrackName        string `json:"trackName"`
		ArtistName       string `json:"artistName"`
		TrackViewURL     string `json:"trackViewUrl"`
		PrimaryGenreName string `json:"primaryGenreName"`
		ReleaseDate      string `json:"releaseDate"`
		TrackCount       int64  `json:"trackCount"`
		TrackTimeMillis  int64  `json:"trackTimeMillis"`
	} `json:"results"`
}

func parseItunes(data []byte, max int) ([]Reference, error) {
	var d itunesResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("itunes: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, r := range d.Results {
		title := r.CollectionName
		if title == "" {
			title = r.TrackName
		}
		if title == "" || r.TrackViewURL == "" {
			continue
		}
		snip := r.ArtistName
		if r.PrimaryGenreName != "" {
			snip += " · " + r.PrimaryGenreName
		}
		if r.TrackCount > 0 {
			snip += fmt.Sprintf(" · %d 集", r.TrackCount)
		}
		ref := Reference{
			URL:       r.TrackViewURL,
			Title:     clampText(title, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"itunes"},
			Authority: "podcasts.apple.com",
			Kind:      "podcast",
		}
		if len(r.ReleaseDate) >= 10 {
			ref.Published = r.ReleaseDate[:10]
		}
		out = append(out, ref)
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneItunes(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://itunes.apple.com/search", nil)
	q := req.URL.Query()
	q.Set("term", opts.Query)
	q.Set("media", "podcast")
	q.Set("limit", fmt.Sprintf("%d", min(opts.MaxResults, 8)))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	// 注意: itunes 返回 content-type text/javascript, 体为 JSON — Go 侧不看 CT 直接 Unmarshal
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("itunes http %d", resp.StatusCode)
	}
	return parseItunes([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- steam (Valve 商店搜索; 实弹确认仅英文词面, 中文词自然 0 结果=正常降级) ----------
type steamResp struct {
	Total int `json:"total"`
	Items []struct {
		Type  string `json:"type"`
		Name  string `json:"name"`
		ID    int64  `json:"id"`
		Price *struct {
			Currency string `json:"currency"`
			Initial  int64  `json:"initial"`
			Final    int64  `json:"final"`
		} `json:"price"`
		TinyImage string `json:"tiny_image"`
	} `json:"items"`
}

func parseSteam(data []byte, max int) ([]Reference, error) {
	var d steamResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("steam: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, it := range d.Items {
		if it.ID == 0 || it.Name == "" {
			continue
		}
		snip := "game"
		if it.Type != "" {
			snip = it.Type
		}
		if it.Price != nil && it.Price.Initial > 0 {
			if it.Price.Final < it.Price.Initial {
				snip += fmt.Sprintf(" · %s %.2f → %.2f", it.Price.Currency,
					float64(it.Price.Initial)/100, float64(it.Price.Final)/100)
			} else {
				snip += fmt.Sprintf(" · %s %.2f", it.Price.Currency, float64(it.Price.Final)/100)
			}
		}
		out = append(out, Reference{
			URL:       fmt.Sprintf("https://store.steampowered.com/app/%d/", it.ID),
			Title:     clampText(it.Name, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"steam"},
			Authority: "store.steampowered.com",
			Kind:      "games",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneSteam(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://store.steampowered.com/api/storesearch/", nil)
		p := req.URL.Query()
		p.Set("term", q)
		p.Set("cc", "US")
		p.Set("l", "en")
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("steam http %d", resp.StatusCode)
		}
		return parseSteam([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	refs, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		// b13: 意图词剥离("best pc game deal on steam"→"steam", "steam 游戏 打折 买游戏"→"steam")
		if s := b13StripIntent(opts.Query, b13GamesIntentRe); s != "" && s != opts.Query {
			refs, err = fetch(s)
		}
	}
	if len(refs) == 0 {
		if tok := longestASCIIToken(opts.Query); tok != "" && tok != opts.Query {
			refs, err = fetch(tok) // 长词面兜底(thesportsdb 惯例)
		}
	}
	return refs, err
}

// ---------- gbif (全球生物多样性设施; 物种 backbone 搜索, 俗名单值 string) ----------
type gbifResp struct {
	Count   int64 `json:"count"`
	Results []struct {
		Key            int64  `json:"key"`
		NubKey         int64  `json:"nubKey"`
		ScientificName string `json:"scientificName"`
		CanonicalName  string `json:"canonicalName"`
		Kingdom        string `json:"kingdom"`
		Phylum         string `json:"phylum"`
		Class          string `json:"class"`
		Order          string `json:"order"`
		Family         string `json:"family"`
		VernacularName string `json:"vernacularName"`
		Synonym        bool   `json:"synonym"`
	} `json:"results"`
}

func parseGbif(data []byte, max int) ([]Reference, error) {
	var d gbifResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("gbif: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	seen := map[string]bool{} // backbone 多记录同 nubKey(实弹: 同物种×5 全同 URL), 同 URL 只留首条
	for _, r := range d.Results {
		spKey := r.NubKey
		if spKey == 0 {
			spKey = r.Key
		}
		name := r.CanonicalName
		if name == "" {
			name = r.ScientificName
		}
		if name == "" || spKey == 0 {
			continue
		}
		u := fmt.Sprintf("https://www.gbif.org/species/%d", spKey)
		if seen[u] {
			continue
		}
		seen[u] = true
		title := name
		if r.VernacularName != "" {
			title += " (" + r.VernacularName + ")"
		}
		snip := r.ScientificName
		// 分类链: 界→科 窄化定位
		var chain []string
		for _, v := range []string{r.Kingdom, r.Phylum, r.Class, r.Order, r.Family} {
			if v != "" {
				chain = append(chain, v)
			}
		}
		if len(chain) > 0 {
			snip += " · " + strings.Join(chain, " > ")
		}
		if r.Synonym {
			snip += " · synonym"
		}
		out = append(out, Reference{
			URL:       u,
			Title:     clampText(title, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"gbif"},
			Authority: "www.gbif.org",
			Kind:      "species",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneGbif(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.gbif.org/v1/species/search", nil)
	q := req.URL.Query()
	// 实弹: 中文疑问修饰词拉长查询引入噪声("银杏的学名是什么"把 Ginkgo 挤出 top3, "银杏"→第3位),
	// 车道侧剥离疑问后缀, 只留物种词面
	query := opts.Query
	for _, suf := range []string{"的学名是什么", "的学名是什么？", "是什么意思", "是什么", "的学名", "的拉丁名", "学名", "拉丁名"} {
		query = strings.TrimSuffix(query, suf)
	}
	q.Set("q", query)
	q.Set("rank", "SPECIES")
	q.Set("status", "ACCEPTED")
	q.Set("limit", fmt.Sprintf("%d", min(opts.MaxResults, 8)))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("gbif http %d", resp.StatusCode)
	}
	return parseGbif([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- openfda (药品标签库; 字段全为 []string 取首元素; 无详情页→DailyMed 搜索页闭环) ----------
type openfdaResp struct {
	Results []struct {
		ID                      string   `json:"id"`
		IndicationsAndUsage     []string `json:"indications_and_usage"`
		DosageAndAdministration []string `json:"dosage_and_administration"`
		WarningsAndCautions     []string `json:"warnings_and_cautions"`
		EffectiveTime           string   `json:"effective_time"`
		Openfda                 struct {
			BrandName        []string `json:"brand_name"`
			GenericName      []string `json:"generic_name"`
			ManufacturerName []string `json:"manufacturer_name"`
			Route            []string `json:"route"`
		} `json:"openfda"`
	} `json:"results"`
}

func firstStr(arr []string) string {
	for _, s := range arr {
		if s != "" {
			return s
		}
	}
	return ""
}

func parseOpenfda(data []byte, max int) ([]Reference, error) {
	var d openfdaResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("openfda: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, r := range d.Results {
		brand := firstStr(r.Openfda.BrandName)
		generic := firstStr(r.Openfda.GenericName)
		if brand == "" && generic == "" {
			continue
		}
		title := brand
		if title == "" {
			title = generic
		}
		snip := generic
		if m := firstStr(r.Openfda.ManufacturerName); m != "" {
			snip += " · " + m
		}
		if rt := firstStr(r.Openfda.Route); rt != "" {
			snip += " · " + rt
		}
		if ind := firstStr(r.IndicationsAndUsage); ind != "" {
			snip += " · " + ind
		}
		// 闭环: DailyMed(NIH 官方标签库) 按品牌名搜索, 页面可达
		ref := Reference{
			URL:       fmt.Sprintf("https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=%s", urlPathEscape(brand)),
			Title:     clampText(title, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"openfda"},
			Authority: "open.fda.gov",
			Kind:      "drug",
		}
		if len(r.EffectiveTime) == 8 { // YYYYMMDD → YYYY-MM-DD
			ref.Published = r.EffectiveTime[:4] + "-" + r.EffectiveTime[4:6] + "-" + r.EffectiveTime[6:8]
		}
		out = append(out, ref)
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneOpenfda(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(term string) ([]Reference, int, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.fda.gov/drug/label.json", nil)
		p := req.URL.Query()
		p.Set("search", term)
		p.Set("limit", fmt.Sprintf("%d", min(opts.MaxResults, 3))) // 单条标签全文长, limit 控肥度
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, 0, err
		}
		defer resp.Body.Close()
		if resp.StatusCode == 404 {
			return []Reference{}, 404, nil // openFDA 惯例: 无命中返回 404, 语义=零结果非故障
		}
		if resp.StatusCode == 400 {
			return []Reference{}, 400, nil // 实弹: 中文词面报 400(词面问题非临时故障), 归零结果防熔断污染
		}
		if resp.StatusCode != 200 {
			return nil, resp.StatusCode, fmt.Errorf("openfda http %d", resp.StatusCode)
		}
		refs, err := parseOpenfda([]byte(readAllString(resp.Body)), opts.MaxResults)
		return refs, 200, err
	}
	// b13 P2: 先剥后查+原词兜底(openFDA 全文 OR 语义, "ibuprofen drug label dosage"
	// 原词有结果但是 SILICEA 类噪声=答非所问, 空结果才剥词的模式无效);
	// 剥后词面再字段化(brand/generic) — 实弹: 全文 search=ibuprofen 返回 Etodolac
	// (相互作用章节含 "ibuprofen" 字样), 字段化精确命中 Ibuprofen 本尊
	if s := b13StripIntent(opts.Query, b13DrugIntentRe); s != "" && s != opts.Query {
		fielded := fmt.Sprintf(`(openfda.brand_name:"%s" OR openfda.generic_name:"%s")`, s, s)
		srefs, _, serr := fetch(fielded)
		if serr == nil && len(srefs) > 0 {
			return srefs, nil
		}
	}
	refs, _, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			refs, _, err = fetch(face) // 实弹: openFDA 无中文索引, 混词 400 → ASCII 词面重查
		}
	}
	return refs, err
}

// ---------- federalregister (美国联邦公报; fields 裁剪生效 5-8KB, 质量极高) ----------
type fedRegResp struct {
	Count   int64 `json:"count"`
	Results []struct {
		Title           string `json:"title"`
		HTMLURL         string `json:"html_url"`
		Abstract        string `json:"abstract"`
		PublicationDate string `json:"publication_date"`
		Type            string `json:"type"`
		Agencies        []struct {
			Name    string `json:"name"`
			RawName string `json:"raw_name"`
		} `json:"agencies"`
	} `json:"results"`
}

func parseFederalregister(data []byte, max int) ([]Reference, error) {
	var d fedRegResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("federalregister: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, r := range d.Results {
		if r.Title == "" || r.HTMLURL == "" {
			continue
		}
		snip := r.Type
		var ags []string
		for _, a := range r.Agencies {
			n := a.Name
			if n == "" {
				n = a.RawName
			}
			if n != "" {
				ags = append(ags, n)
			}
		}
		if len(ags) > 0 {
			snip += " · " + strings.Join(ags, ", ")
		}
		if r.Abstract != "" {
			snip += " · " + r.Abstract
		}
		ref := Reference{
			URL:       r.HTMLURL,
			Title:     clampText(r.Title, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"federalregister"},
			Authority: "federalregister.gov",
			Kind:      "legal",
		}
		if len(r.PublicationDate) >= 10 {
			ref.Published = r.PublicationDate[:10]
		}
		out = append(out, ref)
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneFederalregister(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(term string) ([]Reference, int, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://www.federalregister.gov/api/v1/documents.json", nil)
		p := req.URL.Query()
		p.Set("conditions[term]", term)
		p.Set("per_page", fmt.Sprintf("%d", min(opts.MaxResults, 8)))
		for _, f := range []string{"title", "html_url", "abstract", "publication_date", "type", "agencies"} {
			p.Add("fields[]", f)
		}
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, 0, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, resp.StatusCode, fmt.Errorf("federalregister http %d", resp.StatusCode)
		}
		refs, err := parseFederalregister([]byte(readAllString(resp.Body)), opts.MaxResults)
		return refs, 200, err
	}
	refs, _, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			refs, _, err = fetch(face) // 实弹: FR 全文索引无中文, 中文混词 count=0 → ASCII 词面重查
		}
	}
	return refs, err
}

// ---------- courtlistener (美国判例 v4 匿名; absolute_url 相对路径补前缀; 长尾 1.3-3.9s 6s 腿内) ----------
type courtListenerResp struct {
	Count   int64 `json:"count"`
	Results []struct {
		CaseName            string   `json:"caseName"`
		Court               string   `json:"court"`
		CourtCitationString string   `json:"court_citation_string"`
		AbsoluteURL         string   `json:"absolute_url"`
		DateFiled           string   `json:"dateFiled"`
		DocketNumber        string   `json:"docketNumber"`
		Status              string   `json:"status"`
		Citations           []string `json:"citation"`
		SuitNature          string   `json:"suitNature"`
		CiteCount           int64    `json:"citeCount"`
	} `json:"results"`
}

func parseCourtlistener(data []byte, max int) ([]Reference, error) {
	var d courtListenerResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("courtlistener: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, r := range d.Results {
		if r.CaseName == "" || r.AbsoluteURL == "" {
			continue
		}
		snip := r.CourtCitationString
		if snip == "" {
			snip = r.Court
		}
		if r.Status != "" {
			snip += " · " + r.Status
		}
		if len(r.Citations) > 0 && r.Citations[0] != "" {
			snip += " · " + r.Citations[0]
		}
		if r.DocketNumber != "" {
			snip += " · No. " + r.DocketNumber
		}
		if r.SuitNature != "" {
			snip += " · " + r.SuitNature
		}
		if r.CiteCount > 0 {
			snip += fmt.Sprintf(" · %d cites", r.CiteCount)
		}
		ref := Reference{
			URL:       "https://www.courtlistener.com" + r.AbsoluteURL,
			Title:     clampText(r.CaseName, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"courtlistener"},
			Authority: "www.courtlistener.com",
			Kind:      "legal",
		}
		if len(r.DateFiled) >= 10 {
			ref.Published = r.DateFiled[:10]
		}
		out = append(out, ref)
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneCourtlistener(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(term string) ([]Reference, int, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://www.courtlistener.com/api/rest/v4/search/", nil)
		p := req.URL.Query()
		p.Set("q", term)
		p.Set("type", "o") // opinions
		p.Set("limit", fmt.Sprintf("%d", min(opts.MaxResults, 5)))
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, 0, err
		}
		defer resp.Body.Close()
		if resp.StatusCode == 429 {
			return nil, 429, fmt.Errorf("courtlistener http 429 (匿名限流, 熔断器累积)")
		}
		if resp.StatusCode != 200 {
			return nil, resp.StatusCode, fmt.Errorf("courtlistener http %d", resp.StatusCode)
		}
		refs, err := parseCourtlistener([]byte(readAllString(resp.Body)), opts.MaxResults)
		return refs, 200, err
	}
	refs, _, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			refs, _, err = fetch(face) // 判例库纯英文, 中文混词 0 结果 → ASCII 词面重查
		}
	}
	return refs, err
}
