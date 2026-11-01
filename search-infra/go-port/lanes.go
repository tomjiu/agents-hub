package main

// 车道层 P1: keenable / bingrss / searxng / wikipedia
// 契约逐字实抄自 TS core/src/providers/keyless-apis.ts + searxng.ts(2026-09-04)。
// 设计: fetch(网络)与 parse(纯函数)分离 — parse 可被单测直接覆盖, 不打真网络。

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const laneUA = "search-core/0.5 (+https://github.com/mmqz/search-tool-rnd)"

// laneResult 对齐 TS allSettled 报账语义: 腿失败带 err 不阻塞全局
type laneResult struct {
	Name    string
	Refs    []Reference
	Err     error
	Skipped bool
}

// LaneFn 签名: 每腿拿 ctx(带超时)与 opts, 返回该腿引用列表
type LaneFn func(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error)

var laneRegistry = map[string]LaneFn{
	"keenable":        laneKeenable,
	"bingrss":         laneBingrss,
	"searxng":         laneSearxng,
	"wikipedia":       laneWikipedia,
	"duckduckgo":      laneDuckduckgo,
	"mojeek":          laneMojeek,
	"yahoo":           laneYahoo,
	"marginalia":      laneMarginalia,
	"wiby":            laneWiby,
	"mwmbl":           laneMwmbl,
	"anysearch":       laneAnysearch,
	"firecrawl":       laneFirecrawl,
	"sov2ex":          laneSov2ex,
	"npm":             laneNpm,
	"github":          laneGithub,
	"mdn":             laneMdn,
	"stackexchange":   laneStackexchange,
	"arxiv":           laneArxiv,
	"crossref":        laneCrossref,
	"bingnews":        laneBingnews,
	"googlenews":      laneGooglenews,
	"hn":              laneHN,
	"openverse":       laneOpenverse,
	"crates":          laneCrates,
	"packagist":       lanePackagist,
	"rubygems":        laneRubygems,
	"huggingface":     laneHuggingface,
	"dockerhub":       laneDockerhub,
	"openalex":        laneOpenalex,
	"wayback":         laneWayback,
	"wikirev":         laneWikirev,
	"dblp":            laneDblp,
	"wikidata":        laneWikidata,
	"pubmed":          lanePubmed,
	"nominatim":       laneNominatim,
	"zenodo":          laneZenodo,
	"doaj":            laneDoaj,
	"metacpan":        laneMetacpan,
	"repology":        laneRepology,
	"flathub":         laneFlathub,
	"pypi":            lanePypi,
	"hfpapers":        laneHfpapers,
	"nvd":             laneNvd,
	"osv":             laneOsv,
	"ghsa":            laneGhsa,
	"wiktionary":      laneWiktionary,
	"europepmc":       laneEuropepmc,
	"clinicaltrials":  laneClinicaltrials,
	"worldbank":       laneWorldbank,
	"nuget":           laneNuget,
	"hex":             laneHex,
	"arch":            laneArch,
	"inspirehep":      laneInspirehep,
	"openaire":        laneOpenaire,
	"commonswiki":     laneCommonswiki,
	"openmeteo":       laneOpenmeteo,
	"artifacthub":     laneArtifacthub,
	"nasaimages":      laneNasaimages,
	"musicbrainz":     laneMusicbrainz,
	"mozaddons":       laneMozaddons,
	"thespacedevs":    laneThespacedevs,
	"tvmaze":          laneTvmaze,
	"itunes":          laneItunes,
	"steam":           laneSteam,
	"gbif":            laneGbif,
	"openfda":         laneOpenfda,
	"federalregister": laneFederalregister,
	"courtlistener":   laneCourtlistener,
	"coingecko":       laneCoingecko,
	"themealdb":       laneThemealdb,
	"kitsu":           laneKitsu,
	"thesportsdb":     laneThesportsdb,
	"standardebooks":  laneStandardebooks,
	"thecocktaildb":   laneCocktaildb,
	"wikivoyage":      laneWikivoyage,
	"uniprot":         laneUniprot,
	"openvsx":         laneOpenvsx,
	"jetbrains":       laneJetbrains,
	"wpplugins":       laneWpplugins,
	"snapcraft":       laneSnapcraft,
	"mangadex":        laneMangadex,
	"lrclib":          laneLrclib,
	"pubchem":         lanePubchem,
	"usgsquakes":      laneUsgsQuakes,
	"endoflife":       laneEndoflife,
	"frankfurter":     laneFrankfurter,
	"openreview":      laneOpenreview,
	"inaturalist":     laneInaturalist,
	"pubdev":          lanePubdev,
	"openfoodfacts":   laneOpenfoodfacts,
}

// ---------- keenable (POST JSON 公共路, X-Keenable-Title 必填) ----------
type keenableResult struct {
	Results []struct {
		URL         string `json:"url"`
		Title       string `json:"title"`
		Snippet     string `json:"snippet"`
		Description string `json:"description"`
		PublishedAt string `json:"published_at"`
	} `json:"results"`
}

func parseKeenable(data []byte, max int) ([]Reference, error) {
	var d keenableResult
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("keenable: bad json: %w", err)
	}
	out := make([]Reference, 0, len(d.Results))
	for _, r := range d.Results {
		if !strings.HasPrefix(r.URL, "http") || r.Title == "" {
			continue
		}
		snippet := r.Snippet
		if snippet == "" {
			snippet = r.Description // description 官方样本有值但实测常空; snippet 是正文摘录优先
		}
		out = append(out, Reference{
			URL: r.URL, Title: clampText(r.Title, 200), Snippet: clampText(snippet, 400),
			Engines: []string{"keenable"}, Published: r.PublishedAt, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("keenable: no results parsed")
	}
	return out, nil
}

func laneKeenable(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	count := min(opts.MaxResults, 50) // 官方 max_results 1-50
	bodyMap := map[string]any{"query": opts.Query, "max_results": count}
	if pa := keenableFreshness(opts.Freshness); pa != "" {
		bodyMap["published_after"] = pa
	}
	body, _ := json.Marshal(bodyMap)
	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.keenable.ai/v1/search/public", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	// 公共路必须自报应用名(缺了 400 Missing app identifier) — TS 同款
	req.Header.Set("X-Keenable-Title", "search-core")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 400 {
		return nil, fmt.Errorf("keenable http 400 (public lane: X-Keenable-Title missing?)")
	} else if resp.StatusCode == 401 {
		return nil, fmt.Errorf("keenable http 401 (bad api key)")
	} else if resp.StatusCode == 429 {
		return nil, fmt.Errorf("keenable http 429 (rate limited: public lane 1000/h shared per IP)")
	} else if resp.StatusCode != 200 {
		return nil, fmt.Errorf("keenable http %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return parseKeenable(data, opts.MaxResults)
}

// ---------- bingrss (GET format=rss, 零封锁机会主义通道) ----------
type rssItem struct {
	Title       string `xml:"title"`
	Link        string `xml:"link"`
	Description string `xml:"description"`
}
type rssDoc struct {
	XMLName xml.Name `xml:"rss"`
	Channel struct {
		Items []rssItem `xml:"item"`
	} `xml:"channel"`
}

func parseRssItems(xmlData []byte, max int) ([]Reference, error) {
	// 根标记漂移守卫(TS 同款): 无 rss 根 = 被封或漂移, 抛错(不是合法空)
	if !bytes.Contains(xmlData, []byte("<rss")) {
		return nil, fmt.Errorf("bingrss: markup drift (blocked or non-RSS)")
	}
	var doc rssDoc
	if err := xml.Unmarshal(xmlData, &doc); err != nil {
		return nil, fmt.Errorf("bingrss: parse: %w", err)
	}
	out := make([]Reference, 0, len(doc.Channel.Items))
	for _, it := range doc.Channel.Items {
		if !strings.HasPrefix(it.Link, "http") || it.Title == "" {
			continue
		}
		out = append(out, Reference{
			URL: it.Link, Title: clampText(it.Title, 200),
			Snippet: clampText(it.Description, 400),
			Engines: []string{"bing-rss"}, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneBingrss(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://www.bing.com/search", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("q", opts.Query)
	q.Set("format", "rss")
	q.Set("count", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/rss+xml, application/xml, text/xml")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("bingrss http %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	out, err := parseRssItems(data, opts.MaxResults)
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("bingrss: no items parsed (blocked or markup drift?)")
	}
	return out, nil
}

// ---------- searxng (GET format=json, 实例链回退; 反爬页伪 200 = 实例不可用) ----------
var searxngInstances = []string{"https://search.mectov.my.id", "https://sx.xo.st"}

type searxngResult struct {
	Results []struct {
		URL     string `json:"url"`
		Title   string `json:"title"`
		Content string `json:"content"`
	} `json:"results"`
}

func parseSearxng(data []byte, max int) ([]Reference, error) {
	var d searxngResult
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("non-json response (antibot page?): %w", err)
	}
	out := make([]Reference, 0, len(d.Results))
	for _, r := range d.Results {
		if !strings.HasPrefix(r.URL, "http") {
			continue
		}
		out = append(out, Reference{
			URL: r.URL, Title: clampText(r.Title, 200), Snippet: clampText(r.Content, 400),
			Engines: []string{"searxng"}, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneSearxng(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	var lastErr error
	for _, base := range searxngInstances {
		req, err := http.NewRequestWithContext(ctx, "GET", base+"/search", nil)
		if err != nil {
			lastErr = err
			continue
		}
		q := req.URL.Query()
		q.Set("q", opts.Query)
		q.Set("format", "json")
		if opts.Lang != "" {
			q.Set("language", strings.Split(opts.Lang, "-")[0])
		}
		if tr := searxngFreshness(opts.Freshness); tr != "" {
			q.Set("time_range", tr)
		}
		req.URL.RawQuery = q.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("%s: %w", base, err)
			continue
		}
		data, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = fmt.Errorf("%s: %w", base, err)
			continue
		}
		if resp.StatusCode != 200 {
			lastErr = fmt.Errorf("%s http %d", base, resp.StatusCode)
			continue
		}
		out, err := parseSearxng(data, opts.MaxResults)
		if err != nil {
			lastErr = fmt.Errorf("%s: %w", base, err) // JSON 解析失败=实例不可用, 不是引擎坏
			continue
		}
		if len(out) == 0 {
			lastErr = fmt.Errorf("%s: no results field (drift?)", base)
			continue
		}
		return out, nil
	}
	return nil, fmt.Errorf("searxng all instances failed; last: %v", lastErr)
}

// ---------- wikipedia (REST v1, description 优先; lang 主语言码路由) ----------
type wikiResult struct {
	Pages []struct {
		Key         string `json:"key"`
		Title       string `json:"title"`
		Excerpt     string `json:"excerpt"`
		Description string `json:"description"`
	} `json:"pages"`
}

var htmlTagRe = regexp.MustCompile(`<[^>]*>`)

func stripHtml(s string) string { return htmlTagRe.ReplaceAllString(s, "") }

func parseWikipedia(lang string, data []byte, max int) ([]Reference, error) {
	var d wikiResult
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("wikipedia: bad json: %w", err)
	}
	out := make([]Reference, 0, len(d.Pages))
	for _, p := range d.Pages {
		key := p.Key
		if key == "" {
			key = strings.ReplaceAll(p.Title, " ", "_")
		}
		snippet := p.Description // description 一句话描述比 excerpt(含 searchmatch HTML)干净; excerpt 兜底
		if snippet == "" {
			snippet = stripHtml(p.Excerpt)
		}
		out = append(out, Reference{
			URL:     fmt.Sprintf("https://%s.wikipedia.org/wiki/%s", lang, key),
			Title:   clampText(p.Title, 200),
			Snippet: clampText(snippet, 400),
			Engines: []string{"wikipedia"}, Kind: "web",
		})
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("wikipedia: no results parsed")
	}
	return out, nil
}

func laneWikipedia(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	// "zh-CN"/"en-US" 取主语言码; 缺省 en(TS 同款)
	lang := "en"
	if opts.Lang != "" {
		if p := strings.Split(strings.ToLower(opts.Lang), "-")[0]; p != "" {
			lang = p
		}
	}
	u := fmt.Sprintf("https://%s.wikipedia.org/w/rest.php/v1/search/page?q=%s&limit=%d",
		lang, urlQueryEscape(opts.Query), min(opts.MaxResults, 20))
	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("wikipedia http %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return parseWikipedia(lang, data, opts.MaxResults)
}

// urlQueryEscape 直接透传 url.QueryEscape
func urlQueryEscape(s string) string { return url.QueryEscape(s) }

// runLanes allSettled 语义: 全并行, 腿失败报账不阻塞(TS router 同款)
func runLanes(opts SearchOpts, client *http.Client) []laneResult {
	names := opts.Engines
	if len(names) == 0 {
		for name := range laneRegistry {
			names = append(names, name)
		}
		sortStrings(names)
	}
	results := make([]laneResult, len(names))
	done := make(chan int, len(names))
	for i, name := range names {
		go func(i int, name string) {
			fn, ok := laneRegistry[name]
			if !ok {
				// TS router 语义: 未注册/未配置引擎跳过不塌方(skipped 报账)
				results[i] = laneResult{Name: name, Err: nil, Refs: nil, Skipped: true}
				done <- i
				return
			}
			tCtx, cancel := context.WithTimeout(context.Background(), time.Duration(opts.TimeoutMs)*time.Millisecond)
			defer cancel()
			refs, err := fn(tCtx, opts, client)
			results[i] = laneResult{Name: name, Refs: refs, Err: err}
			done <- i
		}(i, name)
	}
	for range names {
		<-done
	}
	return results
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

// ---------- phase AL 新车道共享设施 ----------

// laneUABrowser AUR 专用 UA: 官方 RPC 前置的 Anubis 反爬对 search-core UA 发挑战页,
// 浏览器 UA 直放(phase AL 探针实证: search-core UA→"Oh noes!" 挑战页, 浏览器 UA→200 JSON 945ms)。
// 诚实偏差: 仅此车道 override, 其余车道统一 laneUA; Anubis 策略若加严由熔断兜底。
const laneUABrowser = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

// anchorStopExt 锚提取扩展排除集(停用词表之外的意图词): 防止 "latest version of X" 类
// 查询的锚落在 version/latest/package 等意图词上打无效请求(pypi 名直取纪律的延伸)。
var anchorStopExt = map[string]bool{
	"version": true, "latest": true, "package": true, "packages": true,
	"install": true, "installing": true, "update": true, "upgrade": true,
	"linux": true, "arch": true, "aur": true, "pacman": true, "yay": true,
	"flatpak": true, "flathub": true, "app": true, "apps": true,
	"repology": true, "metacpan": true, "cpan": true, "perl": true,
	"zenodo": true, "doaj": true, "download": true, "release": true,
}

var asciiWordRe = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*$`)

// extractProjectAnchor 从查询提取项目名锚: tokenize 复用(小写+停用词+去单字符)再过
// ASCII 词形与意图词排除集, 最长锚胜出(detectCategory 同消歧纪律)。
// 无可用锚返回 "" — 调用方按 pypi/CVE 名直取纪律合法空零请求。
func extractProjectAnchor(query string) string {
	best := ""
	for _, t := range tokenize(query) {
		if !asciiWordRe.MatchString(t) || anchorStopExt[t] {
			continue
		}
		if len(t) > len(best) {
			best = t
		}
	}
	return best
}

// stripHtmlSnip 富文本摘要剥离(Zenodo description 为 HTML, DOAJ title 带 <bold> 高亮):
// 去 tag → named+数字实体双解码(htmlx.decodeEntities + xchain.xDecodeEntities) → 压缩空白 → 截断。
func stripHtmlSnip(s string, max int) string {
	s = htmlTagRe.ReplaceAllString(s, " ")
	s = decodeEntities(s)
	s = xDecodeEntities(s)
	s = strings.Join(strings.Fields(s), " ")
	if len([]rune(s)) > max {
		r := []rune(s)
		s = string(r[:max]) + "…"
	}
	return s
}
