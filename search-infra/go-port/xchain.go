package main

// X/Twitter 搜索降级链 (对齐 TS xchain.ts v0.2 — dsh[10] xfallback.js 设计的独立实现)
//  - keyword/semantic → 多免费引擎 site:x.com → 对 top 1-2 status URL 做 oEmbed 全文增强
//  - Guest GraphQL: x.com 匿名 web bearer(前端公开值) + guest token(磁盘缓存 2h)
//  - 自愈三件套: GraphQL 失效时从 x.com JS bundle 重提取轮换的 queryId(xfallback.js:182)、
//    guest token 401/403 重铸、HTML 实体全量解码
// 链路: 官方 API(有 key) ∥ Guest GraphQL ∥ keyless site: 引擎 → allSettled 合并 → oEmbed 增强
// 纪律: 每层独立超时+熔断, 单层失败不阻塞其他层; 对抗部分(queryId)带轮换自愈。

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
)

// x.com 前端公开匿名 bearer(dsh[10] "x.com 前端公开值"; 开源工具通用公开常量)
const publicWebBearer = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"

const guestTTLSeconds = 2 * 3600 // dsh[10]: guest token 磁盘缓存 2h
const queryIdTTLSeconds = 24 * 3600

type xChainConfig struct {
	BearerToken  string // X_BEARER_TOKEN; 不配则跳过官方层
	GuestEnabled bool   // 默认开(SC_X_GUEST=0 关)
	UserAgent    string
	ContactEmail string // 复用 polite 通道惯例(此处未用, 形状对齐)
}

func loadXChainConfig() xChainConfig {
	return xChainConfig{
		BearerToken:  os.Getenv("X_BEARER_TOKEN"),
		GuestEnabled: os.Getenv("SC_X_GUEST") != "0",
		UserAgent:    defaultUA,
	}
}

// xKv guest token / queryId 磁盘缓存(dataDir/x-kv.json, TS 走 SQLite kv 同语义)
type xKv struct {
	kv *kvStore
}

func newXKv(dataDir string) *xKv {
	k := &xKv{kv: newKvStore(dataDir)}
	if dataDir != "" {
		k.kv.path = joinPath(dataDir, "x-kv.json")
	}
	return k
}

func (x *xKv) getJson(key string) (at int64, value string, ok bool) {
	raw, found := x.kv.get(key)
	if !found {
		return 0, "", false
	}
	var m struct {
		At    int64  `json:"at"`
		Value string `json:"value"`
	}
	if json.Unmarshal([]byte(raw), &m) != nil {
		return 0, "", false
	}
	return m.At, m.Value, true
}

func (x *xKv) setJson(key, value string) {
	b, _ := json.Marshal(map[string]any{"at": time.Now().UnixMilli(), "value": value})
	x.kv.set(key, string(b))
}

func (x *xKv) invalidate(key string) {
	x.kv.set(key, `{"at":0,"value":""}`)
}

func joinPath(dir, name string) string {
	if dir == "" {
		return name
	}
	return dir + "/" + name
}

// ---------- 工具 ----------

var namedEntities = regexp.MustCompile(`&(amp|lt|gt|quot|#39|apos|nbsp);`)

// xDecodeEntities dsh[10] 自愈三件套之一: HTML 实体全量解码(含数字/十六进制实体,
// 比 htmlx.go 的 named-only 版全 — TS xchain.ts 与 base.ts 本就是两个实现)
func xDecodeEntities(s string) string {
	s = namedEntities.ReplaceAllStringFunc(s, func(m string) string {
		switch m {
		case "&amp;":
			return "&"
		case "&lt;":
			return "<"
		case "&gt;":
			return ">"
		case "&quot;":
			return "\""
		case "&#39;", "&apos;":
			return "'"
		case "&nbsp;":
			return " "
		}
		return m
	})
	s = numEntityRe.ReplaceAllStringFunc(s, func(m string) string {
		d, _ := strconvAtoi(numEntityRe.FindStringSubmatch(m)[1])
		return string(rune(d))
	})
	s = hexEntityRe.ReplaceAllStringFunc(s, func(m string) string {
		h := hexEntityRe.FindStringSubmatch(m)[1]
		var n int64
		fmt.Sscanf(h, "%x", &n)
		return string(rune(n))
	})
	return s
}

var numEntityRe = regexp.MustCompile(`&#(\d+);`)
var hexEntityRe = regexp.MustCompile(`&#x([0-9a-fA-F]+);`)

func strconvAtoi(s string) (int, error) {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return n, fmt.Errorf("bad digit")
		}
		n = n*10 + int(c-'0')
	}
	return n, nil
}

// xFetch JSON fetch 助手(对齐 TS jfetch)
func xFetch(client *http.Client, ua, url string, headers map[string]string, timeoutMs int, out any) error {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", ua)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()
	res, err := client.Do(req.WithContext(ctx))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return fmt.Errorf("http %d for %s", res.StatusCode, hostOf(url))
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return err
	}
	return json.Unmarshal(b, out)
}

// ---------- 层 1: 官方 API(有 Bearer 才参与) ----------

func xOfficialLayer(cfg xChainConfig, client *http.Client, query string, maxResults int) ([]Reference, error) {
	if cfg.BearerToken == "" {
		return nil, fmt.Errorf("no bearer configured")
	}
	n := maxResults
	if n > 100 {
		n = 100
	}
	if n < 10 {
		n = 10
	}
	apiURL := fmt.Sprintf("https://api.x.com/2/tweets/search/recent?query=%s&max_results=%d&tweet.fields=created_at&expansions=author_id&user.fields=username",
		url.QueryEscape(query), n)
	var resp struct {
		Data []struct {
			ID        string `json:"id"`
			Text      string `json:"text"`
			CreatedAt string `json:"created_at"`
			AuthorID  string `json:"author_id"`
		} `json:"data"`
		Includes struct {
			Users []struct {
				ID       string `json:"id"`
				Username string `json:"username"`
			} `json:"users"`
		} `json:"includes"`
	}
	if err := xFetch(client, cfg.UserAgent, apiURL, map[string]string{"Authorization": "Bearer " + cfg.BearerToken}, 8000, &resp); err != nil {
		return nil, err
	}
	users := map[string]string{}
	for _, u := range resp.Includes.Users {
		users[u.ID] = u.Username
	}
	var out []Reference
	for _, tw := range resp.Data {
		sn := users[tw.AuthorID]
		u := fmt.Sprintf("https://x.com/i/web/status/%s", tw.ID)
		title := "x.com status"
		if sn != "" {
			u = fmt.Sprintf("https://x.com/%s/status/%s", sn, tw.ID)
			title = "@" + sn
		}
		out = append(out, Reference{
			URL: u, Title: title,
			Snippet:   clampText(xDecodeEntities(tw.Text), 400),
			Engines:   []string{"x-official"},
			Kind:      "x",
			Published: tw.CreatedAt,
		})
	}
	return out, nil
}

// ---------- 层 2: Guest GraphQL(queryId 轮换自愈) ----------

// extractSearchQueryId 从 x.com 前端 JS bundle 提取 SearchTimeline 的 queryId(dsh[10]:182 轮换自愈)
func extractSearchQueryId(client *http.Client, ua string, xkv *xKv) (string, error) {
	req, _ := http.NewRequest("GET", "https://x.com/home", nil)
	req.Header.Set("User-Agent", ua)
	req.Header.Set("Accept", "text/html")
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	res, err := client.Do(req.WithContext(ctx))
	cancel()
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return "", fmt.Errorf("x.com home http %d", res.StatusCode)
	}
	b, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	home := string(b)
	bundleRe := regexp.MustCompile(`https://abs\.twimg\.com/responsive-web/client-web[^"']+\.js`)
	var srcs []string
	seen := map[string]bool{}
	for _, m := range bundleRe.FindAllString(home, -1) {
		if !seen[m] {
			seen[m] = true
			srcs = append(srcs, m)
		}
	}
	score := func(s string) int {
		switch {
		case strings.Contains(s, "main."):
			return 0
		case strings.Contains(s, "api"):
			return 1
		case strings.Contains(s, "search"):
			return 2
		}
		return 3
	}
	sort.SliceStable(srcs, func(i, j int) bool { return score(srcs[i]) < score(srcs[j]) })
	if len(srcs) > 3 {
		srcs = srcs[:3]
	}
	if len(srcs) == 0 {
		return "", fmt.Errorf("no bundle scripts found on x.com home")
	}
	searchTimelineRe := regexp.MustCompile(`SearchTimeline`)
	queryIdRe := regexp.MustCompile(`queryId["':\s]+([0-9a-f]{64})`)
	for _, src := range srcs {
		req, _ := http.NewRequest("GET", src, nil)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		res, err := client.Do(req.WithContext(ctx))
		if err != nil {
			cancel()
			continue // 下一个 bundle
		}
		b, _ := io.ReadAll(io.LimitReader(res.Body, 12<<20))
		res.Body.Close()
		cancel()
		js := string(b)
		for _, loc := range searchTimelineRe.FindAllStringIndex(js, -1) {
			lo := loc[0] - 250
			if lo < 0 {
				lo = 0
			}
			window := js[lo:loc[0]]
			ids := queryIdRe.FindAllStringSubmatch(window, -1)
			if len(ids) > 0 {
				qid := ids[len(ids)-1][1]
				xkv.setJson("x:queryId", qid)
				return qid, nil
			}
		}
	}
	return "", fmt.Errorf("SearchTimeline queryId not found in bundles")
}

func (x *xKv) guestToken(client *http.Client, ua string) (string, error) {
	if at, v, ok := x.getJson("x:guest_token"); ok && time.Now().UnixMilli()-at < guestTTLSeconds*1000 && v != "" {
		return v, nil
	}
	var resp struct {
		GuestToken string `json:"guest_token"`
	}
	req, _ := http.NewRequest("POST", "https://api.x.com/1.1/guest/activate.json", nil)
	req.Header.Set("Authorization", "Bearer "+publicWebBearer)
	req.Header.Set("User-Agent", ua)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	res, err := client.Do(req.WithContext(ctx))
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return "", fmt.Errorf("http %d for api.x.com", res.StatusCode)
	}
	b, _ := io.ReadAll(res.Body)
	if json.Unmarshal(b, &resp) != nil || resp.GuestToken == "" {
		return "", fmt.Errorf("guest activate: bad payload")
	}
	x.setJson("x:guest_token", resp.GuestToken)
	return resp.GuestToken, nil
}

func (x *xKv) queryId(client *http.Client, ua string) (string, error) {
	if at, v, ok := x.getJson("x:queryId"); ok && time.Now().UnixMilli()-at < queryIdTTLSeconds*1000 && v != "" {
		return v, nil
	}
	return extractSearchQueryId(client, ua, x)
}

var gqlFeatures = map[string]bool{
	"rweb_tipjar_consumption_enabled":                                         true,
	"responsive_web_graphql_exclude_directive_enabled":                        true,
	"verified_phone_label_enabled":                                            false,
	"creator_subscriptions_tweet_preview_api_enabled":                         true,
	"responsive_web_graphql_timeline_navigation_enabled":                      true,
	"responsive_web_graphql_skip_user_profile_image_extensions_enabled":       false,
	"c9s_tweet_anatomy_moderator_badge_enabled":                               true,
	"articles_preview_enabled":                                                true,
	"responsive_web_edit_tweet_api_enabled":                                   true,
	"graphql_is_translatable_rweb_tweet_is_translatable_enabled":              true,
	"view_counts_everywhere_api_enabled":                                      true,
	"longform_notetweets_consumption_enabled":                                 true,
	"responsive_web_twitter_article_tweet_consumption_enabled":                true,
	"tweet_awards_web_tipping_enabled":                                        false,
	"freedom_of_speech_not_reach_fetch_enabled":                               true,
	"standardized_nudges_misinfo":                                             true,
	"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
	"rweb_video_timestamps_enabled":                                           true,
	"longform_notetweets_rich_text_read_enabled":                              true,
	"longform_notetweets_inline_media_enabled":                                true,
	"responsive_web_enhance_cards_enabled":                                    false,
}

func guestSearchOnce(client *http.Client, ua, queryId, query, guestToken string) ([]Reference, error) {
	variables, _ := json.Marshal(map[string]any{
		"rawQuery": query, "count": 20, "querySource": "typed_query", "product": "Latest",
	})
	features, _ := json.Marshal(gqlFeatures)
	apiURL := fmt.Sprintf("https://x.com/i/api/graphql/%s/SearchTimeline?variables=%s&features=%s",
		queryId, url.QueryEscape(string(variables)), url.QueryEscape(string(features)))
	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("Authorization", "Bearer "+publicWebBearer)
	req.Header.Set("x-guest-token", guestToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-twitter-active-user", "yes")
	req.Header.Set("x-twitter-client-language", "en")
	req.Header.Set("User-Agent", ua)
	ctx, cancel := context.WithTimeout(context.Background(), 9*time.Second)
	defer cancel()
	res, err := client.Do(req.WithContext(ctx))
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, fmt.Errorf("guest gql http %d", res.StatusCode)
	}
	b, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	var js struct {
		Data struct {
			SearchByRawQuery struct {
				SearchTimeline struct {
					Timeline struct {
						Entries []struct {
							Content struct {
								EntryType   string `json:"entryType"`
								ItemContent struct {
									TweetResults struct {
										Result struct {
											RestID string `json:"rest_id"`
											Legacy struct {
												FullScreen string `json:"full_text"`
												CreatedAt  string `json:"created_at"`
											} `json:"legacy"`
											Core struct {
												UserResults struct {
													Result struct {
														Legacy struct {
															ScreenName string `json:"screen_name"`
														} `json:"legacy"`
														Core2 struct {
															ScreenName string `json:"screen_name"`
														} `json:"core"`
													} `json:"result"`
												} `json:"user_results"`
											} `json:"core"`
											Tweet *struct {
												RestID string `json:"rest_id"`
												Legacy struct {
													FullScreen string `json:"full_text"`
													CreatedAt  string `json:"created_at"`
												} `json:"legacy"`
											} `json:"tweet"`
										} `json:"result"`
									} `json:"tweet_results"`
								} `json:"itemContent"`
							} `json:"content"`
						} `json:"entries"`
					} `json:"timeline"`
				} `json:"search_timeline"`
			} `json:"search_by_raw_query"`
		} `json:"data"`
	}
	if json.Unmarshal(b, &js) != nil {
		return nil, fmt.Errorf("guest gql: bad payload")
	}
	var out []Reference
	for _, e := range js.Data.SearchByRawQuery.SearchTimeline.Timeline.Entries {
		if e.Content.EntryType != "TimelineTimelineItem" {
			continue
		}
		result := e.Content.ItemContent.TweetResults.Result
		if result.RestID == "" && result.Tweet != nil {
			result.RestID = result.Tweet.RestID
			result.Legacy.FullScreen = result.Tweet.Legacy.FullScreen
			result.Legacy.CreatedAt = result.Tweet.Legacy.CreatedAt
		}
		id := result.RestID
		text := result.Legacy.FullScreen
		if id == "" || text == "" {
			continue
		}
		sn := result.Core.UserResults.Result.Core2.ScreenName
		if sn == "" {
			sn = result.Core.UserResults.Result.Legacy.ScreenName
		}
		u := fmt.Sprintf("https://x.com/i/web/status/%s", id)
		title := "x.com status"
		if sn != "" {
			u = fmt.Sprintf("https://x.com/%s/status/%s", sn, id)
			title = "@" + sn
		}
		out = append(out, Reference{
			URL: u, Title: title,
			Snippet:   clampText(xDecodeEntities(text), 400),
			Engines:   []string{"x-guest"},
			Kind:      "x",
			Published: result.Legacy.CreatedAt,
		})
	}
	return out, nil
}

// guestLayer 自愈逻辑 — 401/403 重铸 token; queryId 失效(http 4xx) → 重提取
func guestLayer(cfg xChainConfig, client *http.Client, xkv *xKv, health *HealthTracker, query string) ([]Reference, error) {
	// 熔断判定(x-guest 共用 health 面)
	if health.IsOpen("x-guest") {
		return nil, fmt.Errorf("circuit_open: x-guest cooling down")
	}
	token, err := xkv.guestToken(client, cfg.UserAgent)
	if err != nil {
		health.Record("x-guest", false, 0, err.Error(), "")
		return nil, err
	}
	qid, err := xkv.queryId(client, cfg.UserAgent)
	if err != nil {
		health.Record("x-guest", false, 0, err.Error(), "")
		return nil, err
	}
	refs, err := guestSearchOnce(client, cfg.UserAgent, qid, query, token)
	if err != nil {
		msg := err.Error()
		http4xx := regexp.MustCompile(`http 40[134]`)
		if http4xx.MatchString(msg) {
			xkv.invalidate("x:guest_token")
			freshToken, err2 := xkv.guestToken(client, cfg.UserAgent)
			if err2 != nil {
				health.Record("x-guest", false, 0, err2.Error(), "")
				return nil, err2
			}
			if regexp.MustCompile(`http 40[04]`).MatchString(msg) {
				freshQid, err3 := extractSearchQueryId(client, cfg.UserAgent, xkv)
				if err3 != nil {
					health.Record("x-guest", false, 0, err3.Error(), "")
					return nil, err3
				}
				refs, err = guestSearchOnce(client, cfg.UserAgent, freshQid, query, freshToken)
			} else {
				refs, err = guestSearchOnce(client, cfg.UserAgent, qid, query, freshToken)
			}
		}
	}
	if err != nil {
		// queryId 缓存可能是坏的: 清掉后整体重试一次
		msg := err.Error()
		if regexp.MustCompile(`http 40[034]`).MatchString(msg) {
			if _, _, ok := xkv.getJson("x:queryId"); ok {
				xkv.invalidate("x:queryId")
				token, e1 := xkv.guestToken(client, cfg.UserAgent)
				if e1 == nil {
					if qid, e2 := extractSearchQueryId(client, cfg.UserAgent, xkv); e2 == nil {
						if refs2, e3 := guestSearchOnce(client, cfg.UserAgent, qid, query, token); e3 == nil {
							health.Record("x-guest", true, 0, "", "")
							return refs2, nil
						}
					}
				}
			}
		}
		health.Record("x-guest", false, 0, err.Error(), "")
		return nil, err
	}
	health.Record("x-guest", true, 0, "", "")
	return refs, nil
}

// ---------- oEmbed 全文增强(dsh[10]: 对 top status URL 增强 snippet) ----------

func oembedEnhance(cfg xChainConfig, client *http.Client, ref Reference) Reference {
	m := regexp.MustCompile(`/status(?:es)?/(\d+)`).FindStringSubmatch(ref.URL)
	if m == nil {
		return ref
	}
	var js struct {
		Text      string `json:"text"`
		CreatedAt string `json:"created_at"`
	}
	apiURL := fmt.Sprintf("https://cdn.syndication.twimg.com/tweet-result?id=%s&lang=en&token=a", m[1])
	if err := xFetch(client, cfg.UserAgent, apiURL, nil, 6000, &js); err != nil {
		return ref // 增强失败保持原 snippet
	}
	if js.Text != "" && len(js.Text) > len(ref.Snippet) {
		ref.Snippet = clampText(xDecodeEntities(js.Text), 400)
		if ref.Published == "" {
			ref.Published = js.CreatedAt
		}
		has := false
		for _, e := range ref.Engines {
			if e == "x-oembed" {
				has = true
			}
		}
		if !has {
			ref.Engines = append(ref.Engines, "x-oembed")
		}
	}
	return ref
}

// ---------- 链编排 ----------

type xChainResult struct {
	Refs   []Reference
	Used   []string
	Failed []EngineFailureInfo
}

type EngineFailureInfo struct {
	Name      string `json:"name"`
	Error     string `json:"error"`
	ElapsedMs int64  `json:"elapsedMs"`
	Status    string `json:"status"`
}

// xSearchChain 层编排: allSettled 合并 → 去重 → 排序 → oEmbed 增强
func xSearchChain(cfg xChainConfig, client *http.Client, xkv *xKv, health *HealthTracker,
	query string, runKeyless func(siteQuery string) []Reference) xChainResult {

	type layerResult struct {
		name string
		refs []Reference
		err  error
	}
	var layers []struct {
		name string
		run  func() ([]Reference, error)
	}
	if cfg.BearerToken != "" {
		layers = append(layers, struct {
			name string
			run  func() ([]Reference, error)
		}{"x-official", func() ([]Reference, error) { return xOfficialLayer(cfg, client, query, 10) }})
	}
	if cfg.GuestEnabled && !health.IsOpen("x-guest") {
		layers = append(layers, struct {
			name string
			run  func() ([]Reference, error)
		}{"x-guest", func() ([]Reference, error) { return guestLayer(cfg, client, xkv, health, query) }})
	}
	siteQuery := query + " (site:x.com OR site:twitter.com)"
	keylessNames := []string{"duckduckgo", "mojeek", "yahoo"}
	layers = append(layers, struct {
		name string
		run  func() ([]Reference, error)
	}{"x-keyless", func() ([]Reference, error) {
		refs := runKeyless(siteQuery)
		if refs == nil {
			refs = []Reference{}
		}
		return refs, nil
	}})
	_ = keylessNames

	out := make(chan layerResult, len(layers))
	for _, l := range layers {
		go func(name string, run func() ([]Reference, error)) {
			refs, err := run()
			out <- layerResult{name, refs, err}
		}(l.name, l.run)
	}

	var failed []EngineFailureInfo
	used := []string{}
	byURL := map[string]*Reference{}
	var order []string
	for i := 0; i < len(layers); i++ {
		r := <-out
		if r.err == nil {
			used = append(used, r.name)
			health.Record(r.name, true, 0, "", "")
			for _, ref := range r.refs {
				// keyless 层引擎名前缀标记
				if r.name == "x-keyless" {
					for j, e := range ref.Engines {
						ref.Engines[j] = "x-keyless:" + e
					}
					ref.Kind = "x"
				}
				key := urlNorm(ref.URL)
				if ex, ok := byURL[key]; ok {
					for _, e := range ref.Engines {
						if !containsStr(ex.Engines, e) {
							ex.Engines = append(ex.Engines, e)
						}
					}
					if len(ref.Snippet) > len(ex.Snippet) {
						ex.Snippet = ref.Snippet
					}
				} else {
					nr := ref
					nr.URL = key
					byURL[key] = &nr
					order = append(order, key)
				}
			}
		} else {
			msg := r.err.Error()
			cls, _ := classifyFailure(msg)
			failed = append(failed, EngineFailureInfo{Name: r.name, Error: truncStr(msg, 200), Status: cls})
			health.Record(r.name, false, 0, msg, cls)
		}
	}

	refs := make([]Reference, 0, len(order))
	for _, k := range order {
		refs = append(refs, *byURL[k])
	}
	// 排序: 引擎佐证多在前, 官方/guest 全文层优先
	sort.SliceStable(refs, func(i, j int) bool { return len(refs[i].Engines) > len(refs[j].Engines) })
	// oEmbed 增强: 只对没有全文的 keyless 来源, 取 top 2(dsh[10] 口径)
	needEnhance := []int{}
	for i, r := range refs {
		if len(needEnhance) >= 2 {
			break
		}
		allKeyless := len(r.Engines) > 0
		for _, e := range r.Engines {
			if !strings.HasPrefix(e, "x-keyless") {
				allKeyless = false
				break
			}
		}
		if allKeyless {
			needEnhance = append(needEnhance, i)
		}
	}
	emap := map[string]Reference{}
	for _, i := range needEnhance {
		enhanced := oembedEnhance(cfg, client, refs[i])
		emap[enhanced.URL] = enhanced
		if containsStr(enhanced.Engines, "x-oembed") {
			if !containsStr(used, "x-oembed") {
				used = append(used, "x-oembed")
			}
		}
	}
	for i := range refs {
		if e, ok := emap[refs[i].URL]; ok {
			refs[i] = e
		}
	}
	return xChainResult{Refs: refs, Used: used, Failed: failed}
}
