package main

// Fetcher (对齐 TS core/src/fetcher.ts v0-spec §4.4): 安全抓取 + 缓存 + focus 提取流程
// - redirect: manual 逐跳过 SSRF 守卫(防重定向到内网)
// - 抓回正文→原文入缓存→focus 读时过滤(dsh[10] 缓存原文设计)
// - WorkBuddy[07] 口径: >15k 才值得提炼 → 不带 LLM, 直接 focus 段裁剪
// 诚实差异: TS 页面缓存是 SQLite 持久化(跨进程); Go 侧 P4 用进程内 TTL 缓存
// (serve/MCP 常驻形态等效; CLI 单发形态每次冷 — 持久化缓存列 P4.5 待办, README 留档)。

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const defaultUA = "search-core/0.5 (+https://github.com/mmqz/search-tool-rnd)"

var uaBlockedHints = []string{"captcha", "unusual traffic", "access denied"}

// FetchConfig 对齐 TS CoreConfig 抓取相关字段子集
type FetchConfig struct {
	UserAgent      string
	ContactEmail   string
	BlockedDomains []string
	FakeIpCidrs    []string
	MaxPageBytes   int    // 默认 2_000_000
	BudgetChars    int    // 默认 60000
	SSRF           string // strict(默认) / allowPrivate / off
}

func loadFetchConfig() FetchConfig {
	cfg := FetchConfig{
		UserAgent:    defaultUA,
		MaxPageBytes: 2000000,
		BudgetChars:  60000,
		SSRF:         "strict",
	}
	if v := os.Getenv("SC_UA"); v != "" {
		cfg.UserAgent = v
	}
	if v := os.Getenv("SC_CONTACT_EMAIL"); v != "" {
		cfg.ContactEmail = v
	}
	if v := os.Getenv("SC_BLOCKED_DOMAINS"); v != "" {
		for _, d := range strings.Split(v, ",") {
			if d = strings.TrimSpace(d); d != "" {
				cfg.BlockedDomains = append(cfg.BlockedDomains, d)
			}
		}
	}
	if v := os.Getenv("SC_FAKE_IP_CIDRS"); v != "" {
		for _, d := range strings.Split(v, ",") {
			if d = strings.TrimSpace(d); d != "" {
				cfg.FakeIpCidrs = append(cfg.FakeIpCidrs, d)
			}
		}
	}
	if v := os.Getenv("SC_MAX_PAGE_BYTES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.MaxPageBytes = n
		}
	}
	if v := os.Getenv("SC_BUDGET_CHARS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.BudgetChars = n
		}
	}
	if v := os.Getenv("SC_SSRF"); v != "" {
		cfg.SSRF = v
	}
	return cfg
}

// ---------- 进程内页面缓存(诚实差异见文件头) ----------

type pageCacheEntry struct {
	status int
	ct     string
	title  string
	text   string
	at     time.Time
}

type pageCache struct {
	mu   sync.Mutex
	ttl  time.Duration
	data map[string]pageCacheEntry
}

func newPageCache() *pageCache {
	return &pageCache{ttl: 900 * time.Second, data: map[string]pageCacheEntry{}}
}

func (c *pageCache) get(u string, ttl time.Duration) (pageCacheEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.data[u]
	if !ok {
		return e, false
	}
	if time.Since(e.at) > ttl {
		delete(c.data, u)
		return e, false
	}
	return e, true
}

func (c *pageCache) put(u string, status int, ct, title, text string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.data) > 500 { // 简单上限防常驻进程膨胀(TS 由 SQLite 磁盘承担)
		c.data = map[string]pageCacheEntry{}
	}
	c.data[u] = pageCacheEntry{status: status, ct: ct, title: title, text: text, at: time.Now()}
}

// ---------- Fetcher ----------

type FetchOptions struct {
	Focus      string
	MaxChars   int `json:"maxChars,omitempty"` // 默认 8000
	Adjacent   int `json:"adjacent,omitempty"` // 默认 1
	NoCache    bool
	TTLSeconds int `json:"ttlSeconds,omitempty"` // 默认 900
}

type FetchResult struct {
	URL           string   `json:"url"`
	Title         string   `json:"title,omitempty"`
	Status        int      `json:"status"`
	FromCache     bool     `json:"fromCache"`
	TextLength    int      `json:"textLength"`
	ReturnedChars int      `json:"returnedChars"`
	SavedPct      *float64 `json:"savedPct,omitempty"`
	Segments      []string `json:"segments,omitempty"`
	Text          string   `json:"text,omitempty"`
	ElapsedMs     int64    `json:"elapsedMs"`
}

type fetchSafeResult struct {
	finalURL    string
	status      int
	contentType string
	body        string
}

type Fetcher struct {
	cfg       FetchConfig
	cache     *pageCache
	pageStore *Cache // v0.5: SQLite 持久页面缓存(跨进程; nil=仅进程内)
	journal   *Journal
	client    *http.Client
	transport http.RoundTripper // 可注入(对齐 TS fetchImpl 注入测试策略; nil=默认)
}

func NewFetcher(cfg FetchConfig, journal *Journal) *Fetcher {
	return NewFetcherWithTransport(cfg, journal, nil)
}

// NewFetcherWithTransport transport 注入: 测试用 stub 拦截 HTTP(对齐 TS mkFetcher mock 策略),
// 生产传 nil 用默认 transport。redirect manual 语义由 CheckRedirect 保留(注入 transport 也生效)。
func NewFetcherWithTransport(cfg FetchConfig, journal *Journal, tr http.RoundTripper) *Fetcher {
	client := &http.Client{
		// redirect: manual 逐跳 — 重定向由 fetchSafe 自己过 SSRF 守卫
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	if tr != nil {
		client.Transport = tr // 测试注入(对齐 TS fetchImpl)
	}
	return &Fetcher{
		cfg:       cfg,
		cache:     newPageCache(),
		journal:   journal,
		transport: tr,
		client:    client,
	}
}

func (f *Fetcher) policyFor(runBlock, runAllow []string) *DomainPolicy {
	return &DomainPolicy{GlobalBlocked: f.cfg.BlockedDomains, Block: runBlock, Allow: runAllow}
}

// cratesApiRewrite phase AD: crates.io 裸页是 SPA(空文本) → 官方 API 端点直取。
// 仅改写裸 crate 页; 其他 crates 路径不动。
var cratesRe = regexp.MustCompile(`^/crates/([^/]+)/?$`)

func cratesApiRewrite(rawURL string) (name, apiUrl string, ok bool) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Hostname() != "crates.io" {
		return "", "", false
	}
	m := cratesRe.FindStringSubmatch(u.Path)
	if m == nil {
		return "", "", false
	}
	name = m[1]
	if dn, err := url.PathUnescape(m[1]); err == nil {
		name = dn
	}
	return name, fmt.Sprintf("https://crates.io/api/v1/crates/%s", url.PathEscape(m[1])), true
}

var doiReA = regexp.MustCompile(`(?i)doi\.org/(10\.\d{4,9}/[^\s"&?#]+)/?`)
var doiReB = regexp.MustCompile(`(?i)\b(10\.\d{4,9}/[^\s"&?#]+)$`)

// doiOf 从 url/错误信息里提 DOI(doi.org 链接或裸 DOI 结尾)
func doiOf(s string) string {
	m := doiReA.FindStringSubmatch(s)
	if m == nil {
		m = doiReB.FindStringSubmatch(s)
	}
	if m == nil {
		return ""
	}
	if d, err := url.PathUnescape(m[1]); err == nil {
		return d
	}
	return m[1]
}

// fetchSafe 逐跳安全抓取, 返回最终 URL + 内容(SSRF 模式由 cfg.SSRF 控制)
func (f *Fetcher) fetchSafe(rawURL string, policy *DomainPolicy, timeoutMs int) (fetchSafeResult, error) {
	if timeoutMs <= 0 {
		timeoutMs = 20000
	}
	ssrfOpts := SsrfOptions{FakeIpCidrs: f.cfg.FakeIpCidrs, AllowPrivate: f.cfg.SSRF == "allowPrivate"}
	current := rawURL
	var res *http.Response
	finalCancel := func() {} // 成功响应的 ctx cancel 延迟到 body 读完

	for hop := 0; hop < 5; hop++ {
		// ssrf=off: 仅协议/端口/域名校验, 不做 DNS(测试/离线环境)
		var safe string
		var err error
		if f.cfg.SSRF == "off" {
			safe, err = validateUrl(current, policy)
		} else {
			safe, err = safeFetchUrl(current, policy, ssrfOpts)
		}
		if err != nil {
			return fetchSafeResult{}, fmt.Errorf("ssrf: %v", err)
		}
		req, err := http.NewRequest("GET", safe, nil)
		if err != nil {
			return fetchSafeResult{}, err
		}
		req.Header.Set("User-Agent", f.cfg.UserAgent)
		req.Header.Set("Accept", "text/html,application/xhtml+xml,text/*;q=0.8,*/*;q=0.5")
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
		res, err = f.client.Do(req.WithContext(ctx))
		if err != nil {
			cancel()
			return fetchSafeResult{}, err
		}
		if res.StatusCode == 301 || res.StatusCode == 302 || res.StatusCode == 303 ||
			res.StatusCode == 307 || res.StatusCode == 308 {
			loc := res.Header.Get("Location")
			if loc == "" {
				res.Body.Close()
				cancel()
				break
			}
			base, _ := url.Parse(safe)
			ref, err2 := url.Parse(loc)
			if err2 != nil {
				res.Body.Close()
				cancel()
				break
			}
			current = base.ResolveReference(ref).String()
			res.Body.Close()
			cancel()
			continue
		}
		finalCancel = cancel // 成功响应: cancel 延迟到 body 读完(与 TS AbortSignal.timeout 生效域对齐)
		break
	}
	if res == nil {
		return fetchSafeResult{}, fmt.Errorf("fetch failed: no response")
	}
	defer finalCancel()
	defer res.Body.Close()
	sizeCap := f.cfg.MaxPageBytes
	// 超大页截断而不是失败(全文缓存价值仍在) — 只取前 maxPageBytes
	bodyBytes, _ := io.ReadAll(io.LimitReader(res.Body, int64(sizeCap)))
	body := strings.ToValidUTF8(string(bodyBytes), "\uFFFD") // TS TextDecoder fatal:false 对齐
	return fetchSafeResult{finalURL: current, status: res.StatusCode, contentType: res.Header.Get("Content-Type"), body: body}, nil
}

// fetchExtract 抓取+提取一条龙(供 OA 回退重用; crates 元数据在参数里带)
type extractResult struct {
	status      int
	contentType string
	text        string
	title       string
	finalURL    string
}

func (f *Fetcher) fetchExtract(rawURL string, policy *DomainPolicy, cratesName, cratesAPI string) (extractResult, error) {
	var r fetchSafeResult
	var err error
	if cratesAPI != "" {
		r, err = f.fetchSafe(cratesAPI, policy, 0)
	} else {
		r, err = f.fetchSafe(rawURL, policy, 0)
	}
	if err != nil {
		return extractResult{}, err
	}
	ct := strings.ToLower(r.contentType)
	if !(strings.Contains(ct, "html") || strings.Contains(ct, "text") ||
		strings.Contains(ct, "json") || ct == "") {
		return extractResult{}, fmt.Errorf("unsupported content-type: %s", ct)
	}
	lowBody := strings.ToLower(r.body)
	if len(lowBody) > 4000 {
		lowBody = lowBody[:4000]
	}
	if strings.Contains(ct, "html") && len(lowBody) < 2500 {
		for _, h := range uaBlockedHints {
			if strings.Contains(lowBody, h) {
				return extractResult{}, fmt.Errorf("blocked by anti-bot wall (captcha/denied)")
			}
		}
	}
	if strings.Contains(ct, "json") {
		// phase AD: crates API JSON → 人读摘要(裸 JSON 太臃); 其他 JSON 原文返回
		if cratesAPI != "" {
			if crateMeta := cratesApiText(r.body, cratesName); crateMeta != nil {
				return extractResult{r.status, r.contentType, crateMeta.text, crateMeta.title, r.finalURL}, nil
			}
		}
		return extractResult{r.status, r.contentType, r.body, "", r.finalURL}, nil
	}
	ex := extractHtml(r.body)
	if ex.Text == "" {
		return extractResult{r.status, r.contentType, "", ex.Title, r.finalURL}, fmt.Errorf("empty text extracted")
	}
	return extractResult{r.status, r.contentType, ex.Text, ex.Title, r.finalURL}, nil
}

type metaText struct {
	text  string
	title string
}

// cratesApiText phase AD: crates API JSON → 人读摘要(字段缺失诚实留空, 不造假)
func cratesApiText(body, fallbackName string) *metaText {
	var j struct {
		Crate map[string]any `json:"crate"`
	}
	if err := json.Unmarshal([]byte(body), &j); err != nil {
		return nil // 非 JSON → 回落原文路径
	}
	c := j.Crate
	name := fallbackName
	if v, ok := c["name"].(string); ok && v != "" {
		name = v
	}
	str := func(k string) string {
		if v, ok := c[k].(string); ok {
			return v
		}
		if v, ok := c[k].(float64); ok {
			return strconv.FormatFloat(v, 'f', -1, 64)
		}
		return ""
	}
	latest := str("max_stable_version")
	if latest == "" {
		latest = str("max_version")
	}
	lines := []string{
		"# " + name + " (crates.io)",
		str("description"),
		"latest: " + orDash(latest),
		"license: " + orDash(str("license")),
		"repository: " + orDash(str("repository")),
		"documentation: " + orDash(str("documentation")),
		"downloads: " + str("downloads") + "  updated: " + orDash(str("updated_at")),
	}
	var keep []string
	for _, l := range lines {
		if l != "" && !strings.HasSuffix(l, ": -") {
			keep = append(keep, l)
		}
	}
	return &metaText{text: strings.Join(keep, "\n"), title: name}
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

// resolveOaLanding doi.org 落地 403(ssrn/wiley 类出版商反爬) → OpenAlex 按 DOI 查 OA 直链,
// 失败换 Unpaywall 通道。双通道全挂返回空(不掩盖原始错)。
func (f *Fetcher) resolveOaLanding(doi string, policy *DomainPolicy) string {
	mailto := f.cfg.ContactEmail
	m := ""
	if mailto != "" {
		m = "?mailto=" + url.QueryEscape(mailto)
	}
	// OpenAlex 文档形态: /works/https://doi.org/{doi} — 裸斜杠(不 encodeURIComponent)。
	// 实弹教训(2026-09-03): 匿名池当日额度烧光时带 mailto 也 429 → 必须有第二通道。
	if r, err := f.fetchSafe("https://api.openalex.org/works/https://doi.org/"+doi+m, policy, 10000); err == nil {
		var j struct {
			BestOaLocation *struct {
				LandingPageURL *string `json:"landing_page_url"`
				PdfURL         *string `json:"pdf_url"`
			} `json:"best_oa_location"`
			PrimaryLocation *struct {
				LandingPageURL *string `json:"landing_page_url"`
			} `json:"primary_location"`
		}
		if json.Unmarshal([]byte(r.body), &j) == nil {
			if j.BestOaLocation != nil && j.BestOaLocation.LandingPageURL != nil && *j.BestOaLocation.LandingPageURL != "" {
				return *j.BestOaLocation.LandingPageURL
			}
			if j.PrimaryLocation != nil && j.PrimaryLocation.LandingPageURL != nil && *j.PrimaryLocation.LandingPageURL != "" {
				return *j.PrimaryLocation.LandingPageURL
			}
			if j.BestOaLocation != nil && j.BestOaLocation.PdfURL != nil && *j.BestOaLocation.PdfURL != "" {
				return *j.BestOaLocation.PdfURL
			}
		}
	}
	if mailto == "" {
		return "" // Unpaywall email 必填, 没配 contactEmail 就到此为止
	}
	if r, err := f.fetchSafe("https://api.unpaywall.org/v2/"+url.PathEscape(doi)+"?email="+url.QueryEscape(mailto), policy, 10000); err == nil {
		var j struct {
			BestOaLocation *struct {
				URL             *string `json:"url"`
				URLForLandingPg *string `json:"url_for_landing_page"`
				URLForPdf       *string `json:"url_for_pdf"`
			} `json:"best_oa_location"`
		}
		if json.Unmarshal([]byte(r.body), &j) == nil && j.BestOaLocation != nil {
			b := j.BestOaLocation
			if b.URLForLandingPg != nil && *b.URLForLandingPg != "" {
				return *b.URLForLandingPg
			}
			if b.URL != nil && *b.URL != "" {
				return *b.URL
			}
			if b.URLForPdf != nil && *b.URLForPdf != "" {
				return *b.URLForPdf
			}
		}
	}
	return "" // 双通道全挂 → 调用方抛原始错
}

// Run 完整 fetch 工具流: 缓存→抓取→提取→focus→预算 (对齐 TS Fetcher.run)
func (f *Fetcher) Run(rawURL string, opts FetchOptions, policy *DomainPolicy) FetchResult {
	t0 := time.Now()
	if opts.MaxChars <= 0 {
		opts.MaxChars = 8000
	}
	if opts.TTLSeconds <= 0 {
		opts.TTLSeconds = 900
	}
	ttl := time.Duration(opts.TTLSeconds) * time.Second
	budget := NewBudget(f.cfg.BudgetChars)

	fromCache := false
	status := 200
	title := ""
	var text string

	if !opts.NoCache {
		if f.pageStore != nil {
			if row := f.pageStore.GetPage(rawURL, int64(opts.TTLSeconds)); row != nil {
				fromCache = true
				status = 200
				title = row.Title
				text = row.Text
			}
		}
		if !fromCache {
			if e, ok := f.cache.get(rawURL, ttl); ok {
				fromCache = true
				status = e.status
				title = e.title
				text = e.text
			}
		}
	}
	if !fromCache {
		if f.journal != nil {
			f.journal.Write("fetch", map[string]any{"url": rawURL, "cache": "miss"})
		}
		// phase AD: 落地页改写链 — crates SPA→API 直取; doi 403/SPA 假 200 空文本→OA 直链回退
		cratesName, cratesAPI, isCrate := cratesApiRewrite(rawURL)
		if isCrate && f.journal != nil {
			f.journal.Write("fetch_rewrite_crate_api", map[string]any{"from": rawURL, "to": cratesAPI})
		}
		x, err := f.fetchExtract(rawURL, policy, cratesName, cratesAPI)
		if err != nil {
			msg := err.Error()
			// 403(出版商反爬)与 empty text(SPA 假 200)都是"落地页拿不到正文", doi 在手就走 OA 回退
			var doi string
			if regexp.MustCompile(`\b403\b|empty text extracted`).MatchString(msg) {
				doi = doiOf(rawURL)
				if doi == "" {
					doi = doiOf(msg)
				}
			}
			if doi == "" {
				return FetchResult{URL: rawURL, Status: 0, ElapsedMs: msSince(t0),
					Text: "fetch error: " + msg}
			}
			oa := f.resolveOaLanding(doi, policy)
			// 自环守卫: Unpaywall 老记录的 OA 落地可能就是 doi.org 原链(实弹在案 2026-09-03)
			if oa == "" || strings.TrimSuffix(oa, "/") == strings.TrimSuffix(rawURL, "/") {
				return FetchResult{URL: rawURL, Status: 0, ElapsedMs: msSince(t0),
					Text: "fetch error: " + msg}
			}
			if f.journal != nil {
				f.journal.Write("fetch_oa_fallback", map[string]any{"doi": doi, "via": oa, "cause": truncStr(msg, 80)})
			}
			x, err = f.fetchExtract(oa, policy, "", "")
			if err != nil {
				return FetchResult{URL: rawURL, Status: 0, ElapsedMs: msSince(t0),
					Text: "fetch error: " + err.Error()}
			}
		}
		status, text, title = x.status, x.text, x.title
		f.cache.put(rawURL, status, x.contentType, title, text)
		if f.pageStore != nil {
			f.pageStore.PutPage(rawURL, status, x.contentType, title, text) // v0.5: 入 FTS 语料
		}
	}

	textLength := len([]rune(text))
	_ = budget.Charge(opts.MaxChars, "fetch:"+truncStr(rawURL, 80))
	if f.journal != nil {
		f.journal.Write("fetch_done", map[string]any{"url": rawURL, "textLength": textLength, "fromCache": fromCache})
	}
	savedPct := func(returned int) *float64 {
		v := 1 - float64(returned)/float64(textLength)
		if v < 0 {
			v = 0
		}
		return &v
	}

	if opts.Focus != "" {
		segments := extractFocus(text, opts.Focus, opts.MaxChars, opts.Adjacent)
		if segments != nil {
			returnedChars := len([]rune(strings.Join(segments, "\n…\n")))
			return FetchResult{
				URL: rawURL, Title: title, Status: status, FromCache: fromCache,
				TextLength: textLength, ReturnedChars: returnedChars,
				SavedPct: savedPct(returnedChars), Segments: segments,
				ElapsedMs: msSince(t0),
			}
		}
		// focus 无命中 → 降级: 返回头部截断(明确标注)
		runes := []rune(text)
		n := opts.MaxChars
		if n > len(runes) {
			n = len(runes)
		}
		return FetchResult{
			URL: rawURL, Title: title, Status: status, FromCache: fromCache,
			TextLength: textLength, ReturnedChars: n,
			SavedPct: savedPct(n), Text: string(runes[:n]),
			ElapsedMs: msSince(t0),
		}
	}

	// 无 focus: 头部截断返回
	runes := []rune(text)
	n := opts.MaxChars
	if n > len(runes) {
		n = len(runes)
	}
	out := string(runes[:n])
	return FetchResult{
		URL: rawURL, Title: title, Status: status, FromCache: fromCache,
		TextLength: textLength, ReturnedChars: n,
		SavedPct: savedPct(n), Text: out,
		ElapsedMs: msSince(t0),
	}
}

func msSince(t time.Time) int64 { return time.Since(t).Milliseconds() }

func truncStr(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// newPersistentFetcher 三出口共用工厂: fetcher + SQLite 持久页面缓存(v0.5 口径, CLI/MCP/HTTP 一致)。
// journal 可为 nil(MCP 工具面); 常驻出口(MCP/serve-http)不 Close — db 生命周期=进程生命周期,
// CLI 短进程退出即释放。pageStore 挂载失败时优雅降级为进程内缓存(诚实语义: nil=仅进程内)。
func newPersistentFetcher(journal *Journal) *Fetcher {
	f := NewFetcher(loadFetchConfig(), journal)
	if pc, err := OpenCache(dataDir()); err == nil {
		f.pageStore = pc // v0.5: 页面缓存持久化(SQLite, 跨进程)
	}
	return f
}
