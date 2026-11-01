package main

// 探针第 7 批: artifacthub/nasaimages/musicbrainz/mozaddons/thespacedevs
// 黄金样本纪律: fixture 形状/字段值全部取自 2026-09-05 实弹响应(/tmp/probe-b7/), 不靠记忆。
// 关账台账(第 7 批): openlibrary(5/5 持续超时>9s)/archiveorg(持续超时)/zbmath(1/2 超时方差比
// maven 更差)/pubchem(name lookup 非 relevance 搜索, autocomplete 400)/usgs(无 query 语义)/
// oeis(CF 403, 同 AUR 案)/fatcat(超时, 归档疑案)/biorxiv(只支持日期浏览无关键词搜索)。

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// ---------- artifacthub (helm chart 聚合, kind=0 过滤; 页面 URL 已实弹 200 闭环) ----------
type ahPackage struct {
	Name           string `json:"name"`
	NormalizedName string `json:"normalized_name"`
	Version        string `json:"version"`
	Description    string `json:"description"`
	Stars          int64  `json:"stars"`
	Official       bool   `json:"official"`
	License        string `json:"license"`
	Deprecated     bool   `json:"deprecated"`
	Repository     struct {
		OrganizationName string `json:"organization_name"`
		Name             string `json:"name"`
	} `json:"repository"`
}

type ahResp struct {
	Packages []ahPackage `json:"packages"`
}

func parseArtifacthub(data []byte, max int) ([]Reference, error) {
	var d ahResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("artifacthub: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, p := range d.Packages {
		if p.Name == "" || p.NormalizedName == "" || p.Repository.OrganizationName == "" {
			continue // 缺 org 归一化名则页面 URL 不可构造, 跳过
		}
		snip := p.Description
		if p.Version != "" {
			snip += " · " + p.Version
		}
		if p.Stars > 0 {
			snip += fmt.Sprintf(" · %d stars", p.Stars)
		}
		if p.License != "" {
			snip += " · " + p.License
		}
		if p.Official {
			snip += " · official"
		}
		if p.Deprecated {
			snip += " · DEPRECATED"
		}
		out = append(out, Reference{
			URL:       fmt.Sprintf("https://artifacthub.io/packages/helm/%s/%s", p.Repository.OrganizationName, p.NormalizedName),
			Title:     clampText(p.Name, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"artifacthub"},
			Authority: "artifacthub.io",
			Kind:      "devops",
		})
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneArtifacthub(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://artifacthub.io/api/v1/packages/search", nil)
	q := req.URL.Query()
	q.Set("q", opts.Query)
	q.Set("limit", fmt.Sprintf("%d", min(opts.MaxResults, 8)))
	q.Set("kind", "0") // helm; 响应无 kind 字段, 过滤后 URL 构造才闭环(实弹 200 验证)
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("artifacthub http %d", resp.StatusCode)
	}
	return parseArtifacthub([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- nasaimages (NASA 图像库; images.nasa.gov 详情页为规范 URL) ----------
type nasaItem struct {
	Href string `json:"href"`
	Data []struct {
		NasaID      string   `json:"nasa_id"`
		Title       string   `json:"title"`
		Description string   `json:"description"`
		DateCreated string   `json:"date_created"`
		Keywords    []string `json:"keywords"`
	} `json:"data"`
}

type nasaResp struct {
	Collection struct {
		Items []nasaItem `json:"items"`
	} `json:"collection"`
}

func parseNasaimages(data []byte, max int) ([]Reference, error) {
	var d nasaResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("nasaimages: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, it := range d.Collection.Items {
		if len(it.Data) == 0 || it.Data[0].NasaID == "" {
			continue
		}
		m := it.Data[0]
		ref := Reference{
			URL:       "https://images.nasa.gov/details/" + m.NasaID,
			Title:     clampText(m.Title, 200),
			Snippet:   clampText(m.Description, 400),
			Engines:   []string{"nasaimages"},
			Authority: "images.nasa.gov",
			Kind:      "image",
		}
		if len(m.DateCreated) >= 10 {
			ref.Published = m.DateCreated[:10]
		}
		out = append(out, ref)
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneNasaimages(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://images-api.nasa.gov/search", nil)
	q := req.URL.Query()
	q.Set("q", opts.Query)
	q.Set("media_type", "image")
	q.Set("page_size", fmt.Sprintf("%d", min(opts.MaxResults, 8)))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("User-Agent", laneUA)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("nasaimages http %d", resp.StatusCode)
	}
	return parseNasaimages([]byte(readAllString(resp.Body)), opts.MaxResults)
}

// ---------- musicbrainz (录音库; TOS 1 req/s — 腿语义天然单请求合规) ----------
type mbRecording struct {
	ID             string `json:"id"`
	Score          int    `json:"score"`
	Title          string `json:"title"`
	Disambiguation string `json:"disambiguation"`
	Length         int64  `json:"length"` // ms
	FirstRelease   string `json:"first-release-date"`
	ArtistCredit   []struct {
		Name   string `json:"name"`
		Artist struct {
			Name string `json:"name"`
		} `json:"artist"`
	} `json:"artist-credit"`
	Releases []struct {
		Title string `json:"title"`
		Date  string `json:"date"`
	} `json:"releases"`
}

type mbResp struct {
	Recordings []mbRecording `json:"recordings"`
}

func parseMusicbrainz(data []byte, max int) ([]Reference, error) {
	var d mbResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("musicbrainz: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, r := range d.Recordings {
		if r.ID == "" || r.Title == "" {
			continue
		}
		var artists []string
		for _, ac := range r.ArtistCredit {
			n := ac.Artist.Name
			if n == "" {
				n = ac.Name
			}
			if n != "" {
				artists = append(artists, n)
			}
		}
		title := r.Title
		if len(artists) > 0 {
			title += " — " + strings.Join(artists, ", ")
		}
		snip := r.Disambiguation
		if len(r.Releases) > 0 {
			rel := r.Releases[0].Title
			if r.Releases[0].Date != "" {
				rel += " (" + r.Releases[0].Date + ")"
			}
			if snip != "" {
				snip += " · "
			}
			snip += rel
		}
		if r.Length > 0 {
			if snip != "" {
				snip += " · "
			}
			snip += fmt.Sprintf("%d:%02d", r.Length/60000, (r.Length/1000)%60000%60)
		}
		ref := Reference{
			URL:       "https://musicbrainz.org/recording/" + r.ID,
			Title:     clampText(title, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"musicbrainz"},
			Authority: "musicbrainz.org",
			Kind:      "music",
		}
		if r.FirstRelease != "" {
			ref.Published = r.FirstRelease
		}
		out = append(out, ref)
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneMusicbrainz(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://musicbrainz.org/ws/2/recording", nil)
		p := req.URL.Query()
		p.Set("query", q)
		p.Set("fmt", "json")
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
			return nil, fmt.Errorf("musicbrainz http %d", resp.StatusCode)
		}
		return parseMusicbrainz([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	q := opts.Query
	if s := b13StripIntent(q, b13MusicIntentRe); s != "" && s != q {
		q = s // b13: "周杰伦 晴天 专辑 这首歌"→"周杰伦 晴天"(修饰词稀释 recording 索引)
	}
	refs, err := fetch(q)
	if err != nil {
		return nil, err
	}
	// b13: 原唱优先重排 — artist 含歌手词面的条目提前(评测: 翻唱版冒充原唱)
	return b13MusicReorder(refs, q), err
}

// ---------- mozaddons (Firefox 扩展; name/summary 是本地化对象需择优) ----------
type amoL10n map[string]string

// pick: default_locale > en-US > zh-CN > 首个非空值
func (l amoL10n) pick(defaultLocale string) string {
	if s, ok := l[defaultLocale]; ok && s != "" {
		return s
	}
	for _, k := range []string{"en-US", "zh-CN"} {
		if s, ok := l[k]; ok && s != "" {
			return s
		}
	}
	for _, v := range l {
		if v != "" {
			return v
		}
	}
	return ""
}

type amoAddon struct {
	ID                int64          `json:"id"`
	Slug              string         `json:"slug"`
	Name              amoL10n        `json:"name"`
	Summary           amoL10n        `json:"summary"`
	DefaultLocale     string         `json:"default_locale"`
	URL               string         `json:"url"`
	Type              string         `json:"type"`
	AverageDailyUsers int64          `json:"average_daily_users"`
	WeeklyDownloads   int64          `json:"weekly_downloads"`
	Created           string         `json:"created"`
	LastUpdated       string         `json:"last_updated"`
	Ratings           map[string]any `json:"ratings"`
}

type amoResp struct {
	Results []amoAddon `json:"results"`
}

func parseMozaddons(data []byte, max int) ([]Reference, error) {
	var d amoResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("mozaddons: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, a := range d.Results {
		title := a.Name.pick(a.DefaultLocale)
		if title == "" || a.URL == "" {
			continue
		}
		snip := a.Summary.pick(a.DefaultLocale)
		if a.AverageDailyUsers > 0 {
			snip += fmt.Sprintf(" · %d users", a.AverageDailyUsers)
		}
		if a.WeeklyDownloads > 0 {
			snip += fmt.Sprintf(" · %d downloads/week", a.WeeklyDownloads)
		}
		ref := Reference{
			URL:       a.URL,
			Title:     clampText(title, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"mozaddons"},
			Authority: "addons.mozilla.org",
			Kind:      "browser-ext",
		}
		if len(a.Created) >= 10 {
			ref.Published = a.Created[:10]
		}
		out = append(out, ref)
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneMozaddons(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://addons.mozilla.org/api/v5/addons/search/", nil)
		p := req.URL.Query()
		p.Set("q", q)
		p.Set("page_size", fmt.Sprintf("%d", min(opts.MaxResults, 8))) // 实弹: limit 参数无效, 正确参数名 page_size
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("mozaddons http %d", resp.StatusCode)
		}
		return parseMozaddons([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	// b13: 先剥后查+原词兜底(AMO 对 "firefox 扩展 广告拦截 推荐" 原词返回通用扩展=答非所问,
	// 非零结果, 空结果才剥词的模式在这里无效) — 剥后 "广告拦截" 直中中文拦截扩展, 实弹取证;
	// 剥后词面为空(纯实体词)或剥查空结果时回落原词
	if s := b13StripIntent(opts.Query, b13BrowserExtIntentRe); s != "" && s != opts.Query {
		srefs, serr := fetch(s)
		if serr == nil && len(srefs) > 0 {
			return srefs, nil
		}
	}
	refs, err := fetch(opts.Query)
	return refs, err
}

// ---------- thespacedevs (发射任务表; 匿名限流 15 req/h 由熔断器兜底, 域窄词面即守卫) ----------
// 网页 URL 实弹 404, 规范可达页为响应自带 API 条目页(真实 JSON 文档页)。
type tsLaunch struct {
	ID     string `json:"id"`
	Slug   string `json:"slug"`
	Name   string `json:"name"`
	URL    string `json:"url"`
	Status struct {
		Name   string `json:"name"`
		Abbrev string `json:"abbrev"`
	} `json:"status"`
	Net                   string `json:"net"` // 净发射时刻 ISO(惯例名就叫 net)
	LaunchServiceProvider struct {
		Name string `json:"name"`
	} `json:"launch_service_provider"`
	Rocket struct {
		Configuration struct {
			FullName string `json:"full_name"`
		} `json:"configuration"`
	} `json:"rocket"`
	Pad struct {
		Location struct {
			Name string `json:"name"`
		} `json:"location"`
		Name string `json:"name"`
	} `json:"pad"`
	Mission struct {
		Description string `json:"description"`
		Type        string `json:"type"`
	} `json:"mission"`
}

type tsResp struct {
	Results []tsLaunch `json:"results"`
}

func parseThespacedevs(data []byte, max int) ([]Reference, error) {
	var d tsResp
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("thespacedevs: bad json: %w", err)
	}
	out := make([]Reference, 0, max)
	for _, l := range d.Results {
		if l.Name == "" || l.URL == "" {
			continue
		}
		snip := l.Status.Name
		if l.Net != "" {
			snip += " · " + l.Net + " UTC"
		}
		if l.LaunchServiceProvider.Name != "" {
			snip += " · " + l.LaunchServiceProvider.Name
		}
		if l.Pad.Location.Name != "" {
			snip += " · " + l.Pad.Location.Name
		}
		ref := Reference{
			URL:       l.URL,
			Title:     clampText(l.Name, 200),
			Snippet:   clampText(snip, 400),
			Engines:   []string{"thespacedevs"},
			Authority: "ll.thespacedevs.com",
			Kind:      "space",
		}
		if len(l.Net) >= 10 {
			ref.Published = l.Net[:10]
		}
		out = append(out, ref)
		if len(out) >= max {
			break
		}
	}
	return out, nil
}

func laneThespacedevs(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
	fetch := func(q string) ([]Reference, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://ll.thespacedevs.com/2.2.0/launch/upcoming/", nil)
		p := req.URL.Query()
		p.Set("search", q)
		p.Set("limit", fmt.Sprintf("%d", min(opts.MaxResults, 5)))
		p.Set("hide_recent_previous", "true")
		req.URL.RawQuery = p.Encode()
		req.Header.Set("User-Agent", laneUA)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode == 429 {
			return nil, fmt.Errorf("thespacedevs http 429 (匿名限流 15 req/h)") // 熔断器会累积
		}
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("thespacedevs http %d", resp.StatusCode)
		}
		return parseThespacedevs([]byte(readAllString(resp.Body)), opts.MaxResults)
	}
	refs, err := fetch(opts.Query)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		// b13: 意图词剥离+中文火箭别名("SpaceX falcon 9 next rocket launch"→"SpaceX falcon 9",
		// "长征五号 火箭 发射任务 计划"→"长征五号"→别名"Long March 5")
		if s := b13SpaceQuery(opts.Query); s != "" && s != opts.Query {
			refs, err = fetch(s)
		}
	}
	if len(refs) == 0 {
		if tok := longestASCIIToken(opts.Query); tok != "" && tok != opts.Query {
			refs, err = fetch(tok) // 长词面兜底("falcon"→ Falcon 系列全中)
		}
	}
	return refs, err
}
