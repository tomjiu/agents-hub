package main

// 探针第 10 批: thecocktaildb/wikivoyage/uniprot/openvsx/jetbrains/wpplugins/snapcraft
// 新域: drinks/travel/ide-ext/wordpress — DOMAIN_TABLE 28→32 域, laneRegistry 73→80
// 域加强: species(+uniprot 蛋白词面) devops(+snapcraft snap 包词面)
// 黄金样本纪律: fixture 形状/字段值全部取自 2026-09-05 实弹响应(/tmp/probe-b10/shapes/), 不靠记忆。
// 关账台账(第 10 批): boardgamegeek(XML API2 401 应用层鉴权, 浏览器 UA 同样 401)/
// reliefweb(v2 API 匿名 403 "not using an approved appname", appname 需人工申请)/
// gdelt(curl 12s 超时 0 字节, 传输层归因=本机网络不可达, 批 8 方法学应用)/
// homebrew(formulae.brew.sh/api/search.json 404, 批 5 "无 API" 关账维持, 复核 1 请求成本)/
// softwareheritage(200 但返回 Anubis 挑战页 "Oh noes!", AUR 同族指纹级挑战)。
// 遗留清账: rubygems 熔断查因(批 9 挂账 ok=0/fail=7) — 根因=含中文词面全灭(API 返回 []
// → parse 报 no results parsed → fail×6 开熔断); 修复=asciiFace→longestASCIIToken 双级
// 降级 + 词面性空结果归零防熔断污染(openfda 惯例), 见 lanes_registries.go。
// 载荷注意: wpplugins 单响应 95-134KB(fixed fields 无瘦身参数, <1MB cap); snapcraft 50KB;
// uniprot 实弹 617KB→fields 瘦身后 4.2KB(fields=accession,id,protein_name,organism_name,length)。

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// b10HumanCount: 活跃安装/下载量紧凑计数("4000000"→"4.0M")
func b10HumanCount(n int64) string {
	switch {
	case n >= 1e9:
		return fmt.Sprintf("%.1fB", float64(n)/1e9)
	case n >= 1e6:
		return fmt.Sprintf("%.1fM", float64(n)/1e6)
	case n >= 1e3:
		return fmt.Sprintf("%.1fK", float64(n)/1e3)
	}
	return fmt.Sprintf("%d", n)
}

// ---------- thecocktaildb (鸡尾酒库; themealdb 姊妹站 test key "1"; 实弹仅英文词面) ----------
func parseCocktaildb(data []byte, max int) ([]Reference, error) {
	var d struct {
		Drinks []struct {
			IDDrink        string  `json:"idDrink"`
			StrDrink       string  `json:"strDrink"`
			StrCategory    *string `json:"strCategory"`
			StrGlass       *string `json:"strGlass"`
			StrIngredient1 string  `json:"strIngredient1"`
			StrIngredient2 string  `json:"strIngredient2"`
			StrIngredient3 string  `json:"strIngredient3"`
		} `json:"drinks"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("thecocktaildb: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, c := range d.Drinks {
		if c.IDDrink == "" || c.StrDrink == "" {
			continue
		}
		var parts []string
		if c.StrCategory != nil && *c.StrCategory != "" {
			parts = append(parts, *c.StrCategory)
		}
		if c.StrGlass != nil && *c.StrGlass != "" {
			parts = append(parts, *c.StrGlass)
		}
		var ings []string
		for _, ing := range []string{c.StrIngredient1, c.StrIngredient2, c.StrIngredient3} {
			if ing != "" {
				ings = append(ings, ing)
			}
		}
		if len(ings) > 0 {
			parts = append(parts, strings.Join(ings, " / "))
		}
		snip := strings.Join(parts, " · ")
		slug := strings.ToLower(strings.ReplaceAll(c.StrDrink, " ", "-"))
		out = append(out, Reference{
			URL:       "https://www.thecocktaildb.com/drink/" + c.IDDrink + "-" + url.PathEscape(slug),
			Title:     clampText(c.StrDrink, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"thecocktaildb"},
			Authority: "thecocktaildb.com",
			Kind:      "drinks",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneCocktaildb(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://www.thecocktaildb.com/api/json/v1/1/search.php", nil)
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
			return nil, fmt.Errorf("thecocktaildb http %d", resp.StatusCode)
		}
		return parseCocktaildb([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	refs, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		// b13: 意图词剥离("mojito cocktail recipe ingredients"→"mojito")
		if s := b13StripIntent(opts.Query, b13DrinksIntentRe); s != "" && s != opts.Query {
			refs, err = fetch(s)
		}
	}
	if len(refs) == 0 {
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			refs, err = fetch(face) // 纯英文语料库: 中文修饰词全灭→ASCII 词面重查
		}
	}
	return refs, err
}

// ---------- wikivoyage (旅行指南; MediaWiki action API; 实弹繁体"東京"45 hits 中文可用) ----------
func parseWikivoyage(data []byte, max int) ([]Reference, error) {
	var d struct {
		Query struct {
			Search []struct {
				Title     string `json:"title"`
				PageID    int64  `json:"pageid"`
				Wordcount int64  `json:"wordcount"`
				Snippet   string `json:"snippet"`
			} `json:"search"`
		} `json:"query"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("wikivoyage: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, e := range d.Query.Search {
		if e.Title == "" || e.PageID == 0 {
			continue
		}
		out = append(out, Reference{
			URL:       "https://en.wikivoyage.org/wiki/" + url.PathEscape(e.Title),
			Title:     clampText(e.Title, 200),
			Snippet:   clampText(stripHtmlSnip(e.Snippet, 200), 400), // 实弹带 <span class="searchmatch"> 高亮+&quot; 实体
			Engines:   []string{"wikivoyage"},
			Authority: "en.wikivoyage.org",
			Kind:      "travel",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneWikivoyage(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://en.wikivoyage.org/w/api.php", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("action", "query")
	q.Set("list", "search")
	q.Set("srsearch", opts.Query)
	q.Set("format", "json")
	q.Set("srlimit", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("wikivoyage http %d", resp.StatusCode)
	}
	return parseWikivoyage([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- uniprot (蛋白质库; 实弹 617KB→fields 瘦身 4.2KB; reviewed:true 收敛 Swiss-Prot 精选) ----------
func parseUniprot(data []byte, max int) ([]Reference, error) {
	var d struct {
		Results []struct {
			PrimaryAccession string `json:"primaryAccession"`
			UniProtkbID      string `json:"uniProtkbId"`
			Organism         struct {
				ScientificName string `json:"scientificName"`
				CommonName     string `json:"commonName"`
			} `json:"organism"`
			ProteinDescription struct {
				RecommendedName struct {
					FullName struct {
						Value string `json:"value"`
					} `json:"fullName"`
				} `json:"recommendedName"`
			} `json:"proteinDescription"`
			Sequence struct {
				Length int64 `json:"length"`
			} `json:"sequence"`
		} `json:"results"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("uniprot: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, e := range d.Results {
		if e.PrimaryAccession == "" {
			continue
		}
		title := e.ProteinDescription.RecommendedName.FullName.Value
		if title == "" {
			title = e.UniProtkbID
		}
		if title == "" {
			continue
		}
		var parts []string
		if e.Organism.ScientificName != "" {
			parts = append(parts, e.Organism.ScientificName)
		}
		if e.Organism.CommonName != "" {
			parts = append(parts, e.Organism.CommonName)
		}
		if e.Sequence.Length > 0 {
			parts = append(parts, fmt.Sprintf("%d aa", e.Sequence.Length))
		}
		out = append(out, Reference{
			URL:       "https://www.uniprot.org/uniprotkb/" + url.PathEscape(e.PrimaryAccession),
			Title:     clampText(title, 200),
			Snippet:   clampText(strings.Join(parts, " · "), 400),
			Engines:   []string{"uniprot"},
			Authority: "uniprot.org",
			Kind:      "species",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneUniprot(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://rest.uniprot.org/uniprotkb/search", nil)
		p := req.URL.Query()
		p.Set("query", q+" AND reviewed:true")
		p.Set("format", "json")
		p.Set("size", fmt.Sprintf("%d", min(opts.MaxResults, 25)))
		p.Set("fields", "accession,id,protein_name,organism_name,length")
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		// 实弹: uniprot 回 gzip 体未被 transport 透明解压(bad json \x1f 魔数), 显式 identity 要纯 JSON
		req.Header.Set("Accept-Encoding", "identity")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("uniprot http %d", resp.StatusCode)
		}
		return parseUniprot([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	refs, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			refs, err = fetch(face) // 英文语料库: 中文修饰词全灭→ASCII 词面重查
		}
	}
	return refs, err
}

// ---------- openvsx (VS Code 扩展开放市场; response url 是 API 链接, 规范页=extension/{ns}/{name}) ----------
func parseOpenvsx(data []byte, max int) ([]Reference, error) {
	var d struct {
		Extensions []struct {
			Namespace     string `json:"namespace"`
			Name          string `json:"name"`
			DisplayName   string `json:"displayName"`
			Description   string `json:"description"`
			DownloadCount int64  `json:"downloadCount"`
			Version       string `json:"version"`
			Deprecated    bool   `json:"deprecated"`
		} `json:"extensions"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("openvsx: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, e := range d.Extensions {
		if e.Namespace == "" || e.Name == "" {
			continue
		}
		if e.Deprecated {
			continue // 弃用扩展不出(实弹字段)
		}
		title := e.DisplayName
		if title == "" {
			title = e.Name
		}
		snip := e.Description
		if e.DownloadCount > 0 {
			if snip != "" {
				snip += " · "
			}
			snip += "↓" + b10HumanCount(e.DownloadCount)
		}
		out = append(out, Reference{
			URL:       "https://open-vsx.org/extension/" + e.Namespace + "/" + e.Name,
			Title:     clampText(title, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"openvsx"},
			Authority: "open-vsx.org",
			Kind:      "ide-ext",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneOpenvsx(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://open-vsx.org/api/-/search", nil)
	p := req.URL.Query()
	p.Set("query", opts.Query)
	p.Set("size", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	req.URL.RawQuery = p.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("openvsx http %d", resp.StatusCode)
	}
	return parseOpenvsx([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- jetbrains (JetBrains 插件市场; ct=application/graphql+json 但 body 是纯 JSON) ----------
func parseJetbrains(data []byte, max int) ([]Reference, error) {
	var d struct {
		Plugins []struct {
			ID        int64  `json:"id"`
			Name      string `json:"name"`
			Link      string `json:"link"`
			Preview   string `json:"preview"`
			Downloads int64  `json:"downloads"`
			Vendor    struct {
				Name string `json:"name"`
			} `json:"vendor"`
		} `json:"plugins"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("jetbrains: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, p := range d.Plugins {
		if p.ID == 0 || p.Name == "" || !strings.HasPrefix(p.Link, "/plugin/") {
			continue
		}
		snip := strings.Join(strings.Fields(p.Preview), " ")
		if p.Downloads > 0 {
			if snip != "" {
				snip += " · "
			}
			snip += "↓" + b10HumanCount(p.Downloads)
		}
		if p.Vendor.Name != "" {
			snip += " · " + p.Vendor.Name
		}
		out = append(out, Reference{
			URL:       "https://plugins.jetbrains.com" + p.Link,
			Title:     clampText(p.Name, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"jetbrains"},
			Authority: "plugins.jetbrains.com",
			Kind:      "ide-ext",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneJetbrains(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://plugins.jetbrains.com/api/searchPlugins", nil)
	p := req.URL.Query()
	p.Set("search", opts.Query)
	p.Set("size", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	req.URL.RawQuery = p.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("jetbrains http %d", resp.StatusCode)
	}
	return parseJetbrains([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- wpplugins (WordPress.org 插件目录; 1.2 API 固定字段无瘦身参数, 单响应 95-134KB) ----------
func parseWpplugins(data []byte, max int) ([]Reference, error) {
	var d struct {
		Plugins []struct {
			Name             string `json:"name"`
			Slug             string `json:"slug"`
			Version          string `json:"version"`
			ShortDescription string `json:"short_description"`
			Rating           int64  `json:"rating"`
			ActiveInstalls   int64  `json:"active_installs"`
		} `json:"plugins"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("wpplugins: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, p := range d.Plugins {
		if p.Slug == "" || p.Name == "" {
			continue
		}
		snip := p.ShortDescription
		if p.Rating > 0 {
			if snip != "" {
				snip += " · "
			}
			snip += fmt.Sprintf("★%d%%", p.Rating)
		}
		if p.ActiveInstalls > 0 {
			snip += " · " + b10HumanCount(p.ActiveInstalls) + "+ active"
		}
		out = append(out, Reference{
			URL:       "https://wordpress.org/plugins/" + url.PathEscape(p.Slug),
			Title:     clampText(p.Name, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"wpplugins"},
			Authority: "wordpress.org",
			Kind:      "wordpress",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneWpplugins(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.wordpress.org/plugins/info/1.2/", nil)
		p := req.URL.Query()
		p.Set("action", "query_plugins")
		p.Set("request[search]", q)
		p.Set("request[per_page]", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("wpplugins http %d", resp.StatusCode)
		}
		return parseWpplugins([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	refs, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			refs, err = fetch(face) // 英文语料库: 中文修饰词全灭→ASCII 词面重查
		}
	}
	return refs, err
}

// ---------- snapcraft (Snap 商店; v1 search 端点需 Snap-Device-Series 头; 点名 snap 无规范页→优先 links.website) ----------
func parseSnapcraft(data []byte, max int) ([]Reference, error) {
	var d struct {
		Embedded struct {
			Package []struct {
				Name          string `json:"name"`
				Title         string `json:"title"`
				Summary       string `json:"summary"`
				DeveloperName string `json:"developer_name"`
				Links         struct {
					Website []string `json:"website"`
				} `json:"links"`
			} `json:"clickindex:package"`
		} `json:"_embedded"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("snapcraft: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, s := range d.Embedded.Package {
		if s.Name == "" {
			continue
		}
		title := s.Title
		if title == "" {
			title = s.Name
		}
		var page string
		if len(s.Links.Website) > 0 && strings.HasPrefix(s.Links.Website[0], "http") {
			page = s.Links.Website[0] // 实弹: 点名 snap(firefox.mozilla) 无 snapcraft.io 规范页(404), 开发者站点为可达页
		} else if !strings.Contains(s.Name, ".") {
			page = "https://snapcraft.io/" + url.PathEscape(s.Name)
		} else {
			continue // 无可达页: 不出死链
		}
		snip := s.Summary
		if s.DeveloperName != "" {
			if snip != "" {
				snip += " · "
			}
			snip += s.DeveloperName
		}
		out = append(out, Reference{
			URL:       page,
			Title:     clampText(title, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"snapcraft"},
			Authority: "snapcraft.io",
			Kind:      "devops",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneSnapcraft(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.snapcraft.io/api/v1/snaps/search", nil)
		p := req.URL.Query()
		p.Set("q", q)
		p.Set("series", "16")
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Snap-Device-Series", "16") // 实弹: 缺此头 404
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("snapcraft http %d", resp.StatusCode)
		}
		return parseSnapcraft([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	refs, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			refs, err = fetch(face) // 英文语料库: 中文修饰词全灭→ASCII 词面重查
		}
	}
	return refs, err
}
