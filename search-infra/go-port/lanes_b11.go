package main

// 探针第 11 批: mangadex/lrclib/pubchem/usgsquakes/endoflife/frankfurter
// 新域: manga/lyrics/chemistry/quakes(窄意图域, usgsquakes 独占) — DOMAIN_TABLE 32→36 域, laneRegistry 80→86
// 域加强: devops(+endoflife 版本 EOL) finance(+frankfurter 法币汇率)
// 黄金样本纪律: fixture 形状/字段值全部取自 2026-09-05 实弹响应(/tmp/probe-b11/shapes/), 不靠记忆。
// 关账台账(第 11 批): imdbot(workers 代理服务端 500 error_code=103, Node+curl 双证死)/
// scryfall(403 rule=restricted IP 级限制, 官方 FAQ 区块页)/
// dictionaryapi(api.dictionaryapi.dev Node undici 12s 超时+curl -m 15 同死, 传输层本机不可达, 批 8 方法学)/
// nagerdate(v3 仅按国家/年份列举节假日无关键词搜索, biorxiv 日期列举同款模板失配)/
// mankier(explain 端点单 ref 纯文本, 检索价值弱)/rfc-editor(搜索页 Nuxt SPA 客户端渲染无服务端结果行)。
// 意图解析型先例: openmeteo(地点锚+双腿)。本批三腿沿用: usgsquakes(地震窄词面, 忽略 q 拉最新强震)/
// endoflife(all.json 产品 slug 匹配+产品腿)/frankfurter(currencies 币码提取+latest 腿)。
// 载荷注意: lrclib 无 limit 参数, 单响应 107-270KB(<1MB cap), parse 只取前 max 条。

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

// ---------- mangadex (漫画库; JSON:API; title 匹配含各语 altTitles, 实弹中文"葬送的芙莉莲"直中) ----------
func parseMangadex(data []byte, max int) ([]Reference, error) {
	var d struct {
		Data []struct {
			ID         string `json:"id"`
			Attributes struct {
				Title       map[string]string   `json:"title"`
				AltTitles   []map[string]string `json:"altTitles"`
				Description map[string]string   `json:"description"`
				Tags        []struct {
					Attributes struct {
						Name map[string]string `json:"name"`
					} `json:"attributes"`
				} `json:"tags"`
				Status string `json:"status"`
				Year   int64  `json:"year"`
			} `json:"attributes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("mangadex: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, m := range d.Data {
		if m.ID == "" {
			continue
		}
		a := m.Attributes
		// 标题择优: title.en → altTitles 的 en → title 任意首值(实弹 ja-ro 开场)
		title := a.Title["en"]
		if title == "" {
			for _, alt := range a.AltTitles {
				if alt["en"] != "" {
					title = alt["en"]
					break
				}
			}
		}
		if title == "" {
			for _, v := range a.Title {
				if v != "" {
					title = v
					break
				}
			}
		}
		if title == "" {
			continue
		}
		// 摘要: description.en 兜底任意语种 → 标签(≤3) · 状态 · 年份; 空 desc 不留前导分隔符
		snip := a.Description["en"]
		if snip == "" {
			for _, v := range a.Description {
				if v != "" {
					snip = v
					break
				}
			}
		}
		snip = stripHtmlSnip(snip, 200)
		var parts []string
		if snip != "" {
			parts = append(parts, snip)
		}
		var tags []string
		for _, t := range a.Tags {
			if n := t.Attributes.Name["en"]; n != "" {
				tags = append(tags, n)
			}
			if len(tags) >= 3 {
				break
			}
		}
		if len(tags) > 0 {
			parts = append(parts, strings.Join(tags, "/"))
		}
		if a.Status != "" {
			parts = append(parts, a.Status)
		}
		if a.Year > 0 {
			parts = append(parts, fmt.Sprintf("%d", a.Year))
		}
		snip = strings.Join(parts, " · ")
		out = append(out, Reference{
			URL:       "https://mangadex.org/title/" + url.PathEscape(m.ID),
			Title:     clampText(title, 200),
			Snippet:   clampText(strings.TrimSpace(snip), 400),
			Engines:   []string{"mangadex"},
			Authority: "mangadex.org",
			Kind:      "manga",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneMangadex(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.mangadex.org/manga", nil)
		p := req.URL.Query()
		p.Set("title", q)
		p.Set("limit", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
		p.Set("contentRating[]", "safe") // 实弹: 免参数全分级返回, safe 收敛家庭友好
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("mangadex http %d", resp.StatusCode)
		}
		return parseMangadex([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	refs, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		// b13: 意图词剥离("one piece manga latest chapter"→"one piece",
		// "葬送的芙莉莲 漫画 连载"→"葬送的芙莉莲", 后者靠多语 altTitles 直中)
		if s := b13StripIntent(opts.Query, b13MangaIntentRe); s != "" && s != opts.Query {
			refs, err = fetch(s)
		}
	}
	if len(refs) == 0 {
		// 标题索引为多语 altTitles 但命中偏英日, 中文修饰词混入可能全灭("芙莉莲 动画"→asciiFace)
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			refs, err = fetch(face)
		}
	}
	return refs, err
}

// ---------- lrclib (歌词库; 无 limit 参数单响应 107-270KB, parse 只取前 max; 规范页 /track/{id}) ----------
func parseLrclib(data []byte, max int) ([]Reference, error) {
	var d []struct {
		ID           int64  `json:"id"`
		TrackName    string `json:"trackName"`
		ArtistName   string `json:"artistName"`
		AlbumName    string `json:"albumName"`
		Instrumental bool   `json:"instrumental"`
		PlainLyrics  string `json:"plainLyrics"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("lrclib: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	seen := map[string]bool{}
	for _, t := range d {
		if t.ID == 0 || t.TrackName == "" {
			continue
		}
		key := t.TrackName + "\x1f" + t.ArtistName // 实弹: 同曲 plain/synced 多版本, 按曲+歌手去重
		if seen[key] {
			continue
		}
		seen[key] = true
		snip := "纯音乐 (Instrumental)"
		if !t.Instrumental && t.PlainLyrics != "" {
			var lines []string
			for _, ln := range strings.Split(t.PlainLyrics, "\n") {
				if ln = strings.TrimSpace(ln); ln != "" {
					lines = append(lines, ln)
				}
				if len(lines) >= 2 {
					break
				}
			}
			snip = strings.Join(lines, " / ")
		}
		if t.AlbumName != "" {
			snip += " · " + t.AlbumName
		}
		title := t.TrackName
		if t.ArtistName != "" {
			title += " — " + t.ArtistName
		}
		out = append(out, Reference{
			URL:       "https://lrclib.net/track/" + fmt.Sprintf("%d", t.ID),
			Title:     clampText(title, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"lrclib"},
			Authority: "lrclib.net",
			Kind:      "lyrics",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneLrclib(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://lrclib.net/api/search", nil)
		p := req.URL.Query()
		p.Set("q", q)
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("lrclib http %d", resp.StatusCode)
		}
		return parseLrclib([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	refs, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		// 实弹: "晴天 歌词"全灭(意图词混入曲名索引) → 剥离歌词意图词重查(gbif 疑问后缀剥离同款);
		// 英文曲库远大于中文, 混合词再 asciiFace 降级一次
		if stripped := b11StripLyricIntent(opts.Query); stripped != "" && stripped != opts.Query {
			refs, err = fetch(stripped)
		}
		if len(refs) == 0 {
			if face := asciiFace(opts.Query); face != "" && face != opts.Query {
				refs, err = fetch(face)
			}
		}
	}
	return refs, err
}

// b11StripLyricIntent: 剥离歌词意图词("晴天 歌词"→"晴天"; gbif 疑问后缀剥离同款); 全剥光则返回 ""
var b11LyricIntentRe = regexp.MustCompile(`(?i)(歌词|歌詞|lyrics?|是什么|查询|原唱|谁唱的)`)

func b11StripLyricIntent(q string) string {
	stripped := strings.TrimSpace(strings.Join(strings.Fields(b11LyricIntentRe.ReplaceAllString(q, " ")), " "))
	return stripped
}

// ---------- pubchem (化合物属性; PUG REST 精确名直查, 实弹中文"葡萄糖"404 → 仅 ASCII 词面) ----------
// 化学锚提取: 排除意图词后的最长 ASCII token("glucose 分子式"→glucose; 纯中文→"" 合法空零请求)
var b11ChemStop = map[string]bool{
	"molecular": true, "formula": true, "weight": true, "mass": true, "structure": true,
	"compound": true, "chemistry": true, "chemical": true, "molecule": true, "molar": true,
	"the": true, "what": true, "how": true, "much": true, "molecules": true, "of": true,
}

func b11ChemAnchor(q string) string {
	best := ""
	for _, t := range tokenize(q) {
		if !asciiWordRe.MatchString(t) || b11ChemStop[t] {
			continue
		}
		if len(t) > len(best) {
			best = t
		}
	}
	return best
}

func parsePubchem(data []byte, anchor string, max int) ([]Reference, error) {
	var d struct {
		PropertyTable struct {
			Properties []struct {
				CID              int64  `json:"CID"`
				MolecularFormula string `json:"MolecularFormula"`
				MolecularWeight  string `json:"MolecularWeight"`
				IUPACName        string `json:"IUPACName"`
			} `json:"Properties"`
		} `json:"PropertyTable"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("pubchem: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, p := range d.PropertyTable.Properties {
		if p.CID == 0 {
			continue
		}
		snip := "CID " + fmt.Sprintf("%d", p.CID)
		if p.MolecularFormula != "" {
			snip += " · " + p.MolecularFormula
		}
		if p.MolecularWeight != "" {
			snip += " · MW " + p.MolecularWeight
		}
		if p.IUPACName != "" {
			snip += " · IUPAC " + p.IUPACName
		}
		title := anchor
		if p.MolecularFormula != "" {
			title += " (" + p.MolecularFormula + ")"
		}
		out = append(out, Reference{
			URL:       "https://pubchem.ncbi.nlm.nih.gov/compound/" + fmt.Sprintf("%d", p.CID),
			Title:     clampText(title, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"pubchem"},
			Authority: "pubchem.ncbi.nlm.nih.gov",
			Kind:      "chemistry",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func lanePubchem(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	anchor := b11ChemAnchor(opts.Query)
	if anchor == "" {
		return []Reference{}, nil // 无 ASCII 化学锚合法空(纯中文词面 pubchem 名直查 404, 实弹)
	}
	req, _ := http.NewRequestWithContext(ctx, "GET",
		"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/"+url.PathEscape(anchor)+"/property/MolecularFormula,MolecularWeight,IUPACName/JSON", nil)
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Encoding", "identity") // uniprot 惯例: 显式 identity 要纯 JSON
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		// 实弹: 非化合物词面 → PUGREST.NotFound; 词面性 404 归零防熔断污染(openfda 惯例)
		return []Reference{}, nil
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("pubchem http %d", resp.StatusCode)
	}
	return parsePubchem([]byte(readAllString(resp.Body)), anchor, opts.MaxResults)
}

// ---------- usgsquakes (USGS 最新强震; 意图解析型: 窄词面守卫 + 忽略 q 拉 minmagnitude=6) ----------
var b11QuakeWordRe = regexp.MustCompile(`(?i)(最近地震|最新地震|今天地震|昨夜地震|最新震情|近期地震|recent earthquakes?|latest earthquakes?|earthquake today|earthquakes this week)`)

func parseUsgsQuakes(data []byte, max int) ([]Reference, error) {
	var d struct {
		Features []struct {
			Properties struct {
				Mag     float64 `json:"mag"`
				Place   string  `json:"place"`
				Time    int64   `json:"time"`
				URL     string  `json:"url"`
				Title   string  `json:"title"`
				Alert   string  `json:"alert"`
				Tsunami int64   `json:"tsunami"`
			} `json:"properties"`
		} `json:"features"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("usgsquakes: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, f := range d.Features {
		p := f.Properties
		if p.URL == "" || (p.Title == "" && p.Mag == 0) {
			continue
		}
		title := p.Title
		if title == "" {
			title = fmt.Sprintf("M %.1f - %s", p.Mag, p.Place)
		}
		snip := p.Place
		if snip != "" && p.Mag > 0 {
			snip += fmt.Sprintf(" · M%.1f", p.Mag)
		}
		if p.Time > 0 {
			snip += " · " + time.UnixMilli(p.Time).UTC().Format("2006-01-02")
		}
		if p.Tsunami == 1 {
			snip += " · 海啸预警"
		}
		if p.Alert != "" {
			snip += " · alert:" + p.Alert
		}
		out = append(out, Reference{
			URL:       p.URL,
			Title:     clampText(title, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"usgsquakes"},
			Authority: "earthquake.usgs.gov",
			Kind:      "geo",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneUsgsQuakes(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	// 意图解析型: API 无关键词参数(FDSN 仅时间/震级/范围过滤), 窄词面守卫防通用查询误烧请求
	if !b11QuakeWordRe.MatchString(opts.Query) {
		return []Reference{}, nil
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://earthquake.usgs.gov/fdsnws/event/1/query", nil)
	p := req.URL.Query()
	p.Set("format", "geojson")
	p.Set("minmagnitude", "6")
	p.Set("orderby", "time")
	p.Set("limit", fmt.Sprintf("%d", min(opts.MaxResults, 8)))
	req.URL.RawQuery = p.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("usgsquakes http %d", resp.StatusCode)
	}
	return parseUsgsQuakes([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- endoflife (版本 EOL; 双腿: all.json 产品 slug 匹配 → /api/{slug}.json) ----------
var b11EolWordRe = regexp.MustCompile(`(?i)(eol|end of life|endoflife|生命周期|停止维护|停止支持|还支持|版本支持|维护到|support until|still supported)`)

var b11EolAlias = map[string]string{
	"golang": "go", "node": "nodejs", "nodejs": "nodejs", "node.js": "nodejs",
	"python3": "python", "py": "python", "golang1": "go",
}

func b11EolSlug(q string, slugs []string) string {
	slugSet := map[string]bool{}
	for _, s := range slugs {
		slugSet[s] = true
	}
	best := ""
	for _, t := range tokenize(q) {
		cand := t
		if a, ok := b11EolAlias[t]; ok {
			cand = a
		}
		if slugSet[cand] && len(cand) > len(best) {
			best = cand
		}
	}
	return best
}

func b11EolStr(v any) string {
	switch t := v.(type) {
	case bool:
		if !t {
			return "在役"
		}
		return "eol"
	case string:
		return t
	}
	return ""
}

// b11EolCycle endoflife cycle 条目(eol/support 为布尔|字符串双形态, 实弹 go.json/python.json)
type b11EolCycle struct {
	Cycle             string `json:"cycle"`
	ReleaseDate       string `json:"releaseDate"`
	Eol               any    `json:"eol"`
	Latest            string `json:"latest"`
	LatestReleaseDate string `json:"latestReleaseDate"`
	Support           any    `json:"support"`
	LTS               bool   `json:"lts"`
}

func parseEndoflife(data []byte, slug string, max int) ([]Reference, error) {
	var d []b11EolCycle
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("endoflife: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	// 产品页单 ref 聚合(实弹抓获: 各 cycle 共享同一规范页 URL, 多 ref 会被融合层
	// 按URL去重+"长 snippet 胜出"跨条目错位); 单 ref 紧凑串联前 3 cycle 才是正确形态
	var parts []string
	firstLatest := ""
	for _, c := range d {
		if c.Cycle == "" {
			continue
		}
		seg := c.Cycle
		if c.Latest != "" {
			seg += " · latest " + c.Latest
		}
		if e := b11EolStr(c.Eol); e != "" {
			seg += " · EOL " + e
		}
		if s := b11EolStr(c.Support); s != "" {
			seg += " · 支持 " + s
		}
		if c.LTS {
			seg += " · LTS"
		}
		parts = append(parts, seg)
		if firstLatest == "" {
			firstLatest = c.Latest
		}
		if len(parts) >= 3 {
			break
		}
	}
	if len(parts) == 0 {
		return out, nil
	}
	title := slug + " 版本支持与 EOL"
	if firstLatest != "" {
		title += " (最新 " + firstLatest + ")"
	}
	out = append(out, Reference{
		URL:       "https://endoflife.date/" + url.PathEscape(slug),
		Title:     clampText(title, 200),
		Snippet:   clampText(strings.Join(parts, " / "), 400),
		Engines:   []string{"endoflife"},
		Authority: "endoflife.date",
		Kind:      "devops",
	})
	return out, nil
}

func laneEndoflife(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	// 意图解析型: 双腿成本(all.json 6KB+产品腿), 窄词面守卫防通用查询误烧
	if !b11EolWordRe.MatchString(opts.Query) {
		return []Reference{}, nil
	}
	fetchBody := func(u string) ([]byte, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("endoflife http %d", resp.StatusCode)
		}
		return []byte(readAllString(resp.Body)), nil
	}
	body, err := fetchBody("https://endoflife.date/api/all.json")
	if err != nil {
		return nil, err
	}
	var slugs []string
	if err := json.Unmarshal(body, &slugs); err != nil {
		return nil, fmt.Errorf("endoflife all: bad json: %w", err)
	}
	slug := b11EolSlug(opts.Query, slugs)
	if slug == "" {
		return []Reference{}, nil // 查询无产品词面合法空(零第二腿)
	}
	// 第二腿直取字节流交 parse, 消除中间 struct 再编解码错位(实弹抓获: title 与 snippet 值跨 cycle 错位)
	body2, err := fetchBody("https://endoflife.date/api/" + url.PathEscape(slug) + ".json")
	if err != nil {
		return nil, err
	}
	return parseEndoflife(body2, slug, opts.MaxResults)
}

// ---------- frankfurter (ECB 法币参考汇率; 双腿: currencies 币码提取 → latest) ----------
var b11FxWordRe = regexp.MustCompile(`(?i)(汇率|兑换|换算|exchange rate|currency|forex)`)

// 中文币名别名(实弹 /v1/currencies ECB 官方币种集; RUB 2022-03 起 ECB 停发不收)
var b11FxAlias = []struct {
	alias string
	code  string
}{
	{"瑞士法郎", "CHF"}, {"新加坡元", "SGD"}, {"澳大利亚元", "AUD"}, {"澳大利亚币", "AUD"},
	{"人民币", "CNY"}, {"新西兰元", "NZD"}, {"菲律宾比索", "PHP"}, {"墨西哥比索", "MXN"},
	{"土耳其里拉", "TRY"}, {"南非兰特", "ZAR"}, {"印度卢比", "INR"}, {"印尼盾", "IDR"},
	{"美元", "USD"}, {"美金", "USD"}, {"英镑", "GBP"}, {"欧元", "EUR"}, {"日元", "JPY"},
	{"韩元", "KRW"}, {"港币", "HKD"}, {"港元", "HKD"}, {"澳元", "AUD"}, {"加元", "CAD"},
	{"瑞郎", "CHF"}, {"泰铢", "THB"}, {"林吉特", "MYR"}, {"兹罗提", "PLN"}, {"福林", "HUF"},
	{"克朗", ""}, // 多国克朗歧义: 单独出现不提码, 需搭配前缀(挪威/瑞典/丹麦/捷克/冰岛)
	{"挪威克朗", "NOK"}, {"瑞典克朗", "SEK"}, {"丹麦克朗", "DKK"}, {"捷克克朗", "CZK"}, {"冰岛克朗", "ISK"},
}

// b11FxCodes: 从查询提取 ISO 币码(按出现位置序); lowerTokens 匹配 /v1/currencies 键, 中文别名扫描
func b11FxCodes(q string, valid map[string]string) []string {
	low := strings.ToLower(q)
	type hit struct {
		pos  int
		code string
	}
	var hits []hit
	seen := map[string]bool{}
	add := func(code string, pos int) {
		if code == "" || seen[code] {
			return
		}
		seen[code] = true
		hits = append(hits, hit{pos, code})
	}
	// 中文别名: 最长优先防"澳元"吃掉"澳大利亚元"——按位置序扫描, 同位置长别名胜
	for _, a := range b11FxAlias {
		if a.code == "" {
			continue
		}
		if p := strings.Index(low, a.alias); p >= 0 {
			// 前缀歧义守卫: "澳元"命中但同一位置有更长别名("澳大利亚元")时弃短
			longer := false
			for _, b := range b11FxAlias {
				if b.code != "" && len(b.alias) > len(a.alias) && strings.HasPrefix(low[p:], b.alias) {
					longer = true
					break
				}
			}
			if !longer {
				add(a.code, p)
			}
		}
	}
	// ASCII 币码: 3 字母 token 命中 /v1/currencies 键(大小写不敏感)
	for _, t := range tokenize(q) {
		if len(t) == 3 {
			if name, ok := valid[strings.ToUpper(t)]; ok && name != "" {
				add(strings.ToUpper(t), strings.Index(low, t))
			}
		}
	}
	sort.Slice(hits, func(i, j int) bool { return hits[i].pos < hits[j].pos })
	out := make([]string, 0, len(hits))
	for _, h := range hits {
		out = append(out, h.code)
	}
	return out
}

func parseFrankfurter(data []byte, base string, symbols []string, names map[string]string, max int) ([]Reference, error) {
	var d struct {
		Base  string             `json:"base"`
		Date  string             `json:"date"`
		Rates map[string]float64 `json:"rates"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("frankfurter: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, sym := range symbols {
		rate, ok := d.Rates[sym]
		if !ok || rate == 0 {
			continue
		}
		baseName := names[base]
		symName := names[sym]
		snip := "ECB 参考汇率 " + d.Date
		if baseName != "" {
			snip += " · " + baseName
		}
		if symName != "" {
			snip += " ↔ " + symName
		}
		out = append(out, Reference{
			URL:       "https://frankfurter.dev/" + d.Date + "/" + url.PathEscape(d.Base) + "/" + url.PathEscape(sym),
			Title:     clampText(fmt.Sprintf("1 %s = %g %s", d.Base, rate, sym), 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"frankfurter"},
			Authority: "frankfurter.dev",
			Kind:      "finance",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneFrankfurter(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	// 意图解析型: 双腿成本, 窄词面守卫(汇率/兑换/exchange rate)防通用查询误烧
	if !b11FxWordRe.MatchString(opts.Query) {
		return []Reference{}, nil
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.frankfurter.dev/v1/currencies", nil)
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("frankfurter http %d", resp.StatusCode)
	}
	var names map[string]string
	if err := json.Unmarshal([]byte(readAllString(resp.Body)), &names); err != nil {
		return nil, fmt.Errorf("frankfurter currencies: bad json: %w", err)
	}
	codes := b11FxCodes(opts.Query, names)
	if len(codes) < 2 {
		return []Reference{}, nil // 币对不足合法空("人民币汇率"无目标币, 单币不予默认对)
	}
	base := codes[0]
	symbols := codes[1:]
	if len(symbols) > 3 {
		symbols = symbols[:3]
	}
	req2, _ := http.NewRequestWithContext(ctx, "GET", "https://api.frankfurter.dev/v1/latest", nil)
	p := req2.URL.Query()
	p.Set("base", base)
	p.Set("symbols", strings.Join(symbols, ","))
	req2.URL.RawQuery = p.Encode()
	req2.Header.Set("User-Agent", laneUA)
	req2.Header.Set("Accept", "application/json")
	resp2, err := client.Do(req2)
	if err != nil {
		return nil, err
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != 200 {
		return nil, fmt.Errorf("frankfurter latest http %d", resp2.StatusCode)
	}
	return parseFrankfurter([]byte(readAllString(resp2.Body)), base, symbols, names, opts.MaxResults)
}
