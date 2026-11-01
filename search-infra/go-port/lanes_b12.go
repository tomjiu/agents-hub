package main

// 探针第 12 批: openreview/inaturalist/pubdev/openfoodfacts 四车道 + wikidata 全短语清账
// 域加强(无新域): academic(+openreview CS/ML 会议评审与 DBLP 记录) species(+inaturalist 俗名/观察数)
//                packages(+pubdev dart/flutter 语言空白, packageLangSignals +dart/flutter 裁腿)
//                food(+openfoodfacts 加工食品营养, themealdb 纯食谱与食品商品互补)
// laneRegistry 86→90; DOMAIN_TABLE 36 域不变(四域各 +1 腿)。
// 黄金样本纪律: fixture 形状/字段值全部取自 2026-09-05 实弹响应(/tmp/probe-b12/shapes/), 不靠记忆。
// 关账台账(第 12 批, 4 接 8 关):
//   coinpaprika(轮1 200 后全 402 payment_required, 免费档 soft_limit 名存实亡, coingecko 独守 crypto)/
//   restcountries(v3.1 全线 deprecated 返回 success:false, 新 host api.restcountries.com 401 authKeyMissing 鉴权墙)/
//   semanticscholar(无 key 共享池饱和: 首发 429+退避重试 429, 无法承诺可用性; academic 已有 openalex/crossref/arxiv 覆盖)/
//   searchcode(codesearch_I/J 均 404 page not found, 公共代码搜索 API 已死)/
//   nixos(前端 SPA HTML 壳 1.7KB 无服务端结果 + backend api bonsai.io 401, 双证死, rfc-editor 同案)/
//   deezer(403 Access Denied Akamai 边缘 IP 级, Node+curl 双证, scryfall 同案)/
//   lobsters(传输层 fetch failed+curl 10s 超时 0 字节, 本机不可达, gdelt 同案)/
//   gitlab(轮2 去 order_by 侥幸 200, 轮3 复测 403 Blocked 反爬页, 不稳定不可承诺)/
//   openfoodfacts api/v2 search(search_terms 参数被忽略: count=4729421 全库量+任意产品固定列表, "牛奶"与 nutella 同返回,
//     remotive 陷阱; 幸存形态=cgi/search.pl 传统端点 count=1031 真过滤)。
// 清账(批 11 挂账): wikidata 全短语失败 — 实弹取证 wbsearchentities search="who is linus torvalds"→search:[](0 命中)
//   而 "linus torvalds"→Q34253 直中/中文"東京"→Q1490 直中; 根因=实体搜索只匹配 label/alias, 整句自然语言全灭。
//   修法=意图词剥离重查(b11StripLyricIntent 同款)+asciiFace 降级+词面性空结果合法归零防熔断污染(rubygems 惯例)。

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// ---------- openreview (CS/ML 会议评审与论文记录; notes 异构双形态) ----------
// b12OVValue 宽容解包: content.*.value 通常是字符串, 但 authors 是数组(取首元), 其余形态静默忽略 —
// 硬解 string 会让整条 notes 单元反序列化报错(json.Unmarshal 首错上抛)。
type b12OVValue struct{ S string }

func (v *b12OVValue) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		v.S = s
		return nil
	}
	var arr []string
	if err := json.Unmarshal(b, &arr); err == nil && len(arr) > 0 {
		v.S = arr[0]
	}
	return nil // 对象/数字/布尔等非串形态: 合法忽略
}

type b12OVField struct {
	Value b12OVValue `json:"value"`
}

func parseOpenreview(data []byte, max int) ([]Reference, error) {
	var d struct {
		Notes []struct {
			Forum   string                `json:"forum"`
			Content map[string]b12OVField `json:"content"`
		} `json:"notes"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("openreview: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	seen := map[string]bool{}
	for _, n := range d.Notes {
		if n.Forum == "" {
			continue
		}
		// 同 forum 多条评审去重(endoflife 教训: 同规范页多 ref 会被融合层 URL 去重+长 snippet 胜出跨条目错位)
		if seen[n.Forum] {
			continue
		}
		seen[n.Forum] = true
		title := n.Content["title"].Value.S
		body := n.Content["abstract"].Value.S
		if body == "" {
			body = n.Content["summary"].Value.S // 评审笔记无 abstract, summary 即评审意见摘要
		}
		if title == "" {
			if body == "" {
				continue // 无题无文无解析价值
			}
			title = clampText(body, 120) // 评审笔记: 意见摘要头部作标题
		}
		out = append(out, Reference{
			URL:       "https://openreview.net/forum?id=" + url.QueryEscape(n.Forum),
			Title:     clampText(title, 200),
			Snippet:   clampText(stripHtmlSnip(body, 300), 400),
			Engines:   []string{"openreview"},
			Authority: "openreview.net",
			Kind:      "academic",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneOpenreview(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api2.openreview.net/notes/search", nil)
	p := req.URL.Query()
	p.Set("term", opts.Query)
	p.Set("limit", fmt.Sprintf("%d", min(opts.MaxResults, 20)))
	req.URL.RawQuery = p.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("openreview http %d", resp.StatusCode)
	}
	return parseOpenreview([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- inaturalist (物种观察库; 中英词面双通: 隼→Falconiformes, gyrfalcon→Falco rusticolus) ----------
func parseInaturalist(data []byte, max int) ([]Reference, error) {
	var d struct {
		Results []struct {
			ID                  int64  `json:"id"`
			Rank                string `json:"rank"`
			Name                string `json:"name"`
			PreferredCommonName string `json:"preferred_common_name"`
			ObservationsCount   int64  `json:"observations_count"`
			Extinct             bool   `json:"extinct"`
			IsActive            bool   `json:"is_active"`
		} `json:"results"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("inaturalist: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, t := range d.Results {
		if t.ID == 0 || t.Name == "" || !t.IsActive {
			continue
		}
		title := t.PreferredCommonName
		if title == "" {
			title = t.Name // 高阶元(order/family)常无俗名, 学名兜底
		} else {
			title += " (" + t.Name + ")"
		}
		snip := "rank " + t.Rank
		if t.ObservationsCount > 0 {
			snip += fmt.Sprintf(" · %d observations", t.ObservationsCount)
		}
		if t.Extinct {
			snip += " · 已灭绝"
		}
		out = append(out, Reference{
			URL:       "https://www.inaturalist.org/taxa/" + fmt.Sprintf("%d", t.ID),
			Title:     clampText(title, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"inaturalist"},
			Authority: "www.inaturalist.org",
			Kind:      "species",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneInaturalist(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.inaturalist.org/v1/taxa", nil)
		p := req.URL.Query()
		p.Set("q", q)
		p.Set("per_page", fmt.Sprintf("%d", min(opts.MaxResults, 10)))
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("inaturalist http %d", resp.StatusCode)
		}
		return parseInaturalist([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	// 实弹抓获: 意图词混入 taxa 索引("falcon taxonomy"→0, "隼 物种"→Life/Animalia 根元垃圾)
	// → 先剥离物种意图词再查(lrclib 歌词意图词同款), 中文俗名保留(实弹 隼→Falconiformes 直中);
	// b13: 剥后词面命中中文明星物种别名表则换英文俗名直查(taxa 索引不含中文, q=大熊猫 返回人气兜底垃圾);
	// 剩余词面全灭时 asciiFace 降级一次
	q := b13SpeciesQuery(opts.Query)
	refs, err := fetch(q)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			refs, err = fetch(face)
		}
	}
	return refs, err
}

// b12TaxonIntentRe 物种意图词(域词面与 taxa 索引冲突, 先剥离); "分类"裸词在内(仅 inaturalist 腿内使用, 无跨域影响)
var b12TaxonIntentRe = regexp.MustCompile(`(?i)(taxonomy|scientific\s+name|classification|物种|学名|拉丁名|分类学|生物分类|动植物分类|分类)`)

func b12StripTaxonIntent(q string) string {
	stripped := strings.TrimSpace(strings.Join(strings.Fields(b12TaxonIntentRe.ReplaceAllString(q, " ")), " "))
	return stripped
}

// ---------- pubdev (pub.dev Dart/Flutter 包; 双腿: search 名单 → 详情 top3) ----------
func parsePubdevSearch(data []byte, max int) ([]string, error) {
	var d struct {
		Packages []struct {
			Package string `json:"package"`
		} `json:"packages"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("pubdev: bad json: %w", err)
	}
	names := make([]string, 0, max)
	for _, p := range d.Packages {
		if p.Package == "" {
			continue
		}
		names = append(names, p.Package)
		if len(names) >= max {
			break
		}
	}
	return names, nil
}

func parsePubdevDetail(data []byte, name string) (*Reference, error) {
	var d struct {
		Name   string `json:"name"`
		Latest struct {
			Version string `json:"version"`
			Pubspec struct {
				Description string `json:"description"`
			} `json:"pubspec"`
		} `json:"latest"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("pubdev: bad json: %w", err)
	}
	if d.Name == "" {
		return nil, fmt.Errorf("pubdev: no results parsed")
	}
	if name == "" {
		name = d.Name
	}
	snip := d.Latest.Pubspec.Description
	if snip == "" {
		snip = "Dart / Flutter package"
	}
	if d.Latest.Version != "" {
		snip += " · latest " + d.Latest.Version
	}
	return &Reference{
		URL:       "https://pub.dev/packages/" + url.PathEscape(name),
		Title:     clampText(name, 200),
		Snippet:   clampText(snip, 400),
		Engines:   []string{"pubdev"},
		Authority: "pub.dev",
		Kind:      "packages",
	}, nil
}

func lanePubdev(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	search := func(q string) ([]string, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://pub.dev/api/search", nil)
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
			return nil, fmt.Errorf("pubdev http %d", resp.StatusCode)
		}
		return parsePubdevSearch([]byte(readAllString(resp.Body)), min(opts.MaxResults, 5))
	}
	// 实弹: 包名索引纯英文, CJK 混合词原词命中率差 → ASCII 词面优先替代原词主查(同时省一次请求;
	// q=flutter 本身返回 pub.dev 真实热度榜, 属正当排序非固定列表陷阱); 纯 CJK 词面合法空零请求
	q := opts.Query
	if face := asciiFace(q); face != q {
		if face == "" {
			return []Reference{}, nil // 纯 CJK: 包名索引纯英文, 必为 favorites 固定列表/空
		}
		q = face
	}
	names, err := search(q)
	if err != nil {
		return nil, err
	}
	if len(names) == 0 {
		return []Reference{}, nil // 词面性空合法归零防熔断(rubygems 惯例)
	}
	// 详情腿 top3(thesportsdb 腿内多请求先例; search 仅回包名, 描述必须二跳)
	out := make([]Reference, 0, min(len(names), 3))
	for _, name := range names {
		if len(out) >= 3 {
			break
		}
		req, _ := http.NewRequestWithContext(ctx, "GET",
			"https://pub.dev/api/packages/"+url.PathEscape(name), nil)
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err // 详情腿第一跳失败按腿失败报账
		}
		body := readAllString(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 {
			// 单包 404 等词面性失败: 裸 ref 兜底不塌方(包名本身就有导航价值)
			out = append(out, Reference{
				URL: "https://pub.dev/packages/" + url.PathEscape(name), Title: clampText(name, 200),
				Snippet: "Dart / Flutter package", Engines: []string{"pubdev"},
				Authority: "pub.dev", Kind: "packages",
			})
			continue
		}
		ref, err := parsePubdevDetail([]byte(body), name)
		if err != nil {
			out = append(out, Reference{
				URL: "https://pub.dev/packages/" + url.PathEscape(name), Title: clampText(name, 200),
				Snippet: "Dart / Flutter package", Engines: []string{"pubdev"},
				Authority: "pub.dev", Kind: "packages",
			})
			continue
		}
		out = append(out, *ref)
	}
	return out, nil
}

// ---------- openfoodfacts (加工食品营养; cgi/search.pl 传统端点, v2 search 参数无效见头部关账台账) ----------
func parseOpenfoodfacts(data []byte, max int) ([]Reference, error) {
	var d struct {
		Products []struct {
			ProductName string `json:"product_name"`
			Brands      string `json:"brands"`
			URL         string `json:"url"`
			Quantity    string `json:"quantity"`
		} `json:"products"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("openfoodfacts: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, p := range d.Products {
		if p.URL == "" || p.ProductName == "" {
			continue
		}
		var parts []string
		if p.Brands != "" {
			parts = append(parts, p.Brands)
		}
		if p.Quantity != "" {
			parts = append(parts, p.Quantity)
		}
		out = append(out, Reference{
			URL:       p.URL,
			Title:     clampText(p.ProductName, 200),
			Snippet:   clampText(strings.Join(parts, " · "), 400),
			Engines:   []string{"openfoodfacts"},
			Authority: "world.openfoodfacts.org",
			Kind:      "food",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneOpenfoodfacts(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://world.openfoodfacts.org/cgi/search.pl", nil)
		p := req.URL.Query()
		p.Set("search_terms", q)
		p.Set("json", "1")
		p.Set("page_size", fmt.Sprintf("%d", min(opts.MaxResults, 10)))
		p.Set("fields", "product_name,brands,url,quantity")
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		// 503=官方站瞬时过载(实弹轮1 撞过, 数分钟后自愈), 按腿失败报账交熔断
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("openfoodfacts http %d", resp.StatusCode)
		}
		return parseOpenfoodfacts([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	refs, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		// 实弹: 商品名索引以英欧语料为主, 中文修饰词 asciiFace 降级一次(themealdb 惯例)
		if face := asciiFace(opts.Query); face != "" && face != opts.Query {
			refs, err = fetch(face)
		}
	}
	return refs, err
}

// ---------- wikidata 清账: 实体意图词剥离(b11StripLyricIntent 同款) ----------
// "who is linus torvalds"→"linus torvalds"; "founder of linux"→"linux";
// "东京 人口"→"东京"; "林纳斯 是谁"→"林纳斯"。长形态在前防截胡(是什么人 > 什么人)。
// b16 泛化探针补年份: "population of Japan 2024" 剥意图词后残留 "Japan 2024",
// wbsearchentities 对含年份数字串 0 结果(curl 实锤), 孤立 19xx/20xx 是实体定位噪声。
var b12EntityIntentRe = regexp.MustCompile(`(?i)(who\s+is|who\s+was|who\s+are|what\s+is|what\s+was|what\s+are|founder\s+of|ceo\s+of|cto\s+of|population\s+of|capital\s+of|\bwho\b|\bwhat\b|founder|ceo|cto|population|capital|是谁|是什么人|什么人|创始人|创办人|的首都|的人口|首都|人口|\b(?:19|20)\d{2}\b)`)

func b12StripEntityIntent(q string) string {
	stripped := strings.TrimSpace(strings.Join(strings.Fields(b12EntityIntentRe.ReplaceAllString(q, " ")), " "))
	// b18 外部基准(NQ-open)补虚词: "who is the founder of the ubuntu project" 剥意图词后
	// 残留 "the of the ubuntu project"(虚词噪声, wbsearchentities 0 结果 → 纯路零输出)。
	// 实体定位语境下英文虚词无定位价值, 剥除后 "ubuntu project" → Q381 直中, 意图 enrich
	// P112 → "创始人 Mark Shuttleworth" 直答闭环(NQ-open 实弹取证)。
	// 虚词剥空返回空串: 纯虚词残渣("the who" 剥 "who"/"the")不值得实体重查;
	// 能命中的实体原词已在主 fetch 命中, 走到 fallback 说明原词本就 0 结果。
	noised := strings.TrimSpace(strings.Join(strings.Fields(b12IntentStopwordRe.ReplaceAllString(stripped, " ")), " "))
	return noised
}

var b12IntentStopwordRe = regexp.MustCompile(`(?i)\b(the|a|an|of|in|on|at|to|for|by|with|from|is|was|are|were|do|does|did|their|his|her|its)\b`)
