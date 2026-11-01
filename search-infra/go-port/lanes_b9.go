package main

// 探针第 9 批: coingecko/themealdb/kitsu/thesportsdb/standardebooks
// 新域: finance/food/anime/sport/books — DOMAIN_TABLE 23→28 域, laneRegistry 68→73
// 黄金样本纪律: fixture 形状/字段值全部取自 2026-09-05 实弹响应(/tmp/probe-b9/shapes/), 不靠记忆。
// 关账台账(第 9 批): oeis(CF 403 复验维持)/gbooks(429 配额池复验维持)/openlibrary(连接超时
// 复验维持)/jikan(上游 MAL 拒连复验维持, Kitsu 作 anime 替代接入)/relevantxkcd(API 端点 404 已死)/
// remotive(search 参数无效——golang/kubernetes 两查询返回相同 18 条固定列表, 不可用作搜索)/
// poetrydb(通配语法 404, 精确匹配语义弱 + 2.8s 慢, 价值低)。
// 守卫决策: coingecko 免费档限频极严(实测连打 5 次 第 5 次即 429)——依赖 crypto 窄词面守卫
// 天然限流, 腿内单请求合规; thesportsdb 免费档(test key "3")同理依赖 sport 窄词面。

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

// ---------- coingecko (加密货币搜索; 免费档限频严, crypto 窄词面守卫) ----------
type cgCoin struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Symbol        string `json:"symbol"`
	MarketCapRank int64  `json:"market_cap_rank"`
}

func parseCoingecko(data []byte, max int) ([]Reference, error) {
	var d struct {
		Coins []cgCoin `json:"coins"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("coingecko: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, c := range d.Coins {
		if c.ID == "" || c.Name == "" {
			continue
		}
		snip := c.Symbol
		if c.MarketCapRank > 0 {
			snip += fmt.Sprintf(" · rank #%d", c.MarketCapRank)
		}
		out = append(out, Reference{
			URL:       "https://www.coingecko.com/en/coins/" + c.ID,
			Title:     clampText(c.Name, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"coingecko"},
			Authority: "coingecko.com",
			Kind:      "finance",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneCoingecko(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.coingecko.com/api/v3/search", nil)
		p := req.URL.Query()
		p.Set("query", q)
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("coingecko http %d", resp.StatusCode)
		}
		return parseCoingecko([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	refs, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		// b14: 英文意图词未剥("bitcoin coin price today" 全串 /search 0 结果, curl 实测
		// 裸 bitcoin 直中) — b13 模式插在 asciiFace 之前, 剥 price/today/coin 类域意图词
		if face := b13StripIntent(opts.Query, b13FinanceIntentRe); face != "" && face != opts.Query {
			refs, err = fetch(face)
		}
	}
	if len(refs) == 0 {
		// 限频极严(5 连打即 429): 降级重查仅此一次机会, asciiFace 剥离中文修饰词
		// ("bitcoin 价格"→"bitcoin"), 无 ASCII 词面则不动(纯中文对币名索引注定 0)
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			refs, err = fetch(face)
		}
	}
	return refs, err
}

// ---------- themealdb (食谱库; 实弹确认仅英文词面, 中文 null=正常降级) ----------
func parseThemealdb(data []byte, max int) ([]Reference, error) {
	var d struct {
		Meals []struct {
			IDMeal          string `json:"idMeal"`
			StrMeal         string `json:"strMeal"`
			StrCategory     string `json:"strCategory"`
			StrArea         string `json:"strArea"`
			StrInstructions string `json:"strInstructions"`
		} `json:"meals"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("themealdb: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, m := range d.Meals {
		if m.IDMeal == "" || m.StrMeal == "" {
			continue
		}
		snip := m.StrCategory
		if m.StrArea != "" {
			snip += " · " + m.StrArea
		}
		if body := strings.Join(strings.Fields(m.StrInstructions), " "); body != "" {
			snip += " · " + body
		}
		out = append(out, Reference{
			URL:       "https://www.themealdb.com/meal/" + m.IDMeal,
			Title:     clampText(m.StrMeal, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"themealdb"},
			Authority: "themealdb.com",
			Kind:      "food",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneThemealdb(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://www.themealdb.com/api/json/v1/1/search.php", nil)
		p := req.URL.Query()
		p.Set("s", q)
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("themealdb http %d", resp.StatusCode)
		}
		return parseThemealdb([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	refs, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			refs, err = fetch(face) // 纯英文语料库: 中文修饰词全灭→ASCII 词面重查
		}
	}
	return refs, err
}

// ---------- kitsu (动漫库; Jikan/MAL 关账替代; JSON:API; 2.3-4.8s 慢源腿超时内) ----------
type ktAttr struct {
	Slug           string `json:"slug"`
	CanonicalTitle string `json:"canonicalTitle"`
	Synopsis       string `json:"synopsis"`
	AverageRating  string `json:"averageRating"`
	StartDate      string `json:"startDate"`
	Subtype        string `json:"subtype"`
	Status         string `json:"status"`
	EpisodeCount   int64  `json:"episodeCount"`
}

func parseKitsu(data []byte, max int) ([]Reference, error) {
	var d struct {
		Data []struct {
			Attributes ktAttr `json:"attributes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("kitsu: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, it := range d.Data {
		a := it.Attributes
		if a.Slug == "" || a.CanonicalTitle == "" {
			continue
		}
		snip := a.Subtype
		if a.Status != "" {
			snip += " · " + a.Status
		}
		if a.EpisodeCount > 0 {
			snip += fmt.Sprintf(" · %d 集", a.EpisodeCount)
		}
		if a.StartDate != "" {
			snip += " · " + a.StartDate
		}
		if a.AverageRating != "" {
			snip += " · ★" + a.AverageRating
		}
		if body := stripHtmlSnip(a.Synopsis, 240); body != "" {
			snip += " · " + body
		}
		out = append(out, Reference{
			URL:       "https://kitsu.io/anime/" + a.Slug,
			Title:     clampText(a.CanonicalTitle, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"kitsu"},
			Authority: "kitsu.io",
			Kind:      "anime",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneKitsu(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://kitsu.io/api/edge/anime", nil)
		p := req.URL.Query()
		p.Set("filter[text]", q)
		p.Set("page[limit]", fmt.Sprintf("%d", min(opts.MaxResults, 8)))
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/vnd.api+json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("kitsu http %d", resp.StatusCode)
		}
		return parseKitsu([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	refs, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		// b13 P2: 意图词剥离("进击的巨人 动漫 追番 推荐"→"进击的巨人")
		if s := b13StripIntent(opts.Query, b13AnimeIntentRe); s != "" && s != opts.Query {
			refs, err = fetch(s)
		}
	}
	if len(refs) == 0 {
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			refs, err = fetch(face) // 多语言别名库但日文罗马字语料: 中文修饰词全灭→ASCII 重查
		}
	}
	return refs, err
}

// ---------- thesportsdb (体育球队库; 免费档 test key "3" 30 req/min, sport 窄词面守卫) ----------
func parseThesportsdb(data []byte, max int) ([]Reference, error) {
	var d struct {
		Teams []struct {
			IDTeam           string `json:"idTeam"`
			StrTeam          string `json:"strTeam"`
			StrLeague        string `json:"strLeague"`
			StrSport         string `json:"strSport"`
			IntFormedYear    string `json:"intFormedYear"`
			StrStadium       string `json:"strStadium"`
			StrDescriptionEN string `json:"strDescriptionEN"`
		} `json:"teams"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("thesportsdb: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, t := range d.Teams {
		if t.IDTeam == "" || t.IDTeam == "0" || t.StrTeam == "" {
			continue // idTeam "0"=API 无效条目形态(与 gbif key=0 同模式)
		}
		snip := t.StrLeague
		if t.StrSport != "" {
			snip += " · " + t.StrSport
		}
		if t.IntFormedYear != "" && t.IntFormedYear != "0" {
			snip += " · est." + t.IntFormedYear
		}
		if t.StrStadium != "" {
			snip += " · " + t.StrStadium
		}
		if body := strings.Join(strings.Fields(t.StrDescriptionEN), " "); body != "" {
			snip += " · " + body
		}
		out = append(out, Reference{
			URL:       "https://www.thesportsdb.com/team/" + t.IDTeam,
			Title:     clampText(t.StrTeam, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"thesportsdb"},
			Authority: "www.thesportsdb.com",
			Kind:      "sport",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneThesportsdb(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://www.thesportsdb.com/api/v1/json/3/searchteams.php", nil)
		p := req.URL.Query()
		p.Set("t", q)
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("thesportsdb http %d", resp.StatusCode)
		}
		return parseThesportsdb([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	refs, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		// b13: 意图词剥离("NBA team lakers roster profile"→"NBA lakers",
		// 仍非队名子串时由下方 longestASCIIToken 兜底→"lakers")
		if s := b13StripIntent(opts.Query, b13SportIntentRe); s != "" && s != opts.Query {
			refs, err = fetch(s)
		}
	}
	// 二级降级(实弹抓获): API 是「查询词必须为队名子串」语义, 混合词 ASCII 全词面
	// 仍可能 0("NBA Lakers"不是"Los Angeles Lakers"子串)→ 再用最长 ASCII token
	// 重查一次("NBA Lakers"→"Lakers"✓)。腿内最多 3 请求, 免费档 30/min 可承受。
	if len(refs) == 0 {
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			if refs, err = fetch(face); err == nil && len(refs) == 0 {
				if tok := longestASCIIToken(opts.Query); tok != "" && tok != face {
					refs, err = fetch(tok)
				}
			}
		}
	}
	return refs, err
}

// longestASCIIToken: 纯 ASCII token 中最长者(≥3 字母), 供球队短别名降级("NBA Lakers"→"Lakers")
func longestASCIIToken(q string) string {
	best := ""
	for _, p := range strings.Fields(q) {
		isASCII := true
		for _, r := range p {
			if r > 0x7f {
				isASCII = false
				break
			}
		}
		if isASCII && len(p) >= 3 && len(p) > len(best) {
			best = p
		}
	}
	return best
}

// ---------- standardebooks (公版书库; HTML 车道: li[typeof=schema:Book] about=路径, p0=书名 p1=作者) ----------
func parseStandardebooks(html string, max int) []Reference {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil
	}
	var out []Reference
	doc.Find(`li[typeof="schema:Book"]`).Each(func(_ int, el *goquery.Selection) {
		path, _ := el.Attr("about")
		if path == "" || !strings.HasPrefix(path, "/ebooks/") {
			return
		}
		ps := el.Find("p")
		title := strings.TrimSpace(ps.Eq(0).Text())
		author := strings.TrimSpace(ps.Eq(1).Text())
		if title == "" {
			return
		}
		snip := author
		if snip != "" {
			snip = "作者 " + snip
		}
		out = append(out, Reference{
			URL:       "https://standardebooks.org" + path,
			Title:     clampText(title, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"standardebooks"},
			Authority: "standardebooks.org",
			Kind:      "books",
		})
		if len(out) >= max {
			return
		}
	})
	return out
}

func laneStandardebooks(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, string, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://standardebooks.org/ebooks", nil)
		p := req.URL.Query()
		p.Set("query", q)
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "text/html")
		resp, err := client.Do(req)
		if err != nil {
			return nil, "", err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, "", fmt.Errorf("standardebooks http %d", resp.StatusCode)
		}
		body := readAllString(resp.Body)
		return parseStandardebooks(body, opts.MaxResults), body, nil
	}
	refs, _, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		// b13: 意图词剥离("pride and prejudice public domain ebook"→"pride and prejudice")
		if s := b13StripIntent(opts.Query, b13BooksIntentRe); s != "" && s != opts.Query {
			refs, _, err = fetch(s)
		}
	}
	if len(refs) == 0 {
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			refs, _, err = fetch(face) // 公版书英文语料: 中文修饰词全灭→ASCII 词面重查
		}
	}
	return refs, err
}
