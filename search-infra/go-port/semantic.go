package main

// 语义融合 (对齐 TS fusion.ts fuseSemantic + embed.ts TfEmbedder + credibility.ts)
// fuse(URL 去重+RRF+权威三层) → spam 双档 → 语义去重(TF hash, 错误不阻塞) → domainCap 贪心 → 重编 rank。

import (
	_ "embed"
	"encoding/json"
	"math"
	"strings"
)

// ---------- TF hash embedder (词 + CJK bigram; FNV-1a 32bit → 512 桶; L2 归一化) ----------
const embedDim = 512

var cjkRange = func(r rune) bool {
	return (r >= 0x3400 && r <= 0x4dbf) || (r >= 0x4e00 && r <= 0x9fff) || (r >= 0xf900 && r <= 0xfaff) || (r >= 0x3040 && r <= 0x30ff)
}

func embedTokens(s string) []string {
	var out []string
	for _, run := range splitRe.Split(strings.ToLower(s), -1) {
		if run == "" {
			continue
		}
		rs := []rune(run)
		isCJK := false
		for _, r := range rs {
			if cjkRange(r) {
				isCJK = true
				break
			}
		}
		if isCJK {
			out = append(out, run) // 整词保底
			for i := 0; i+1 < len(rs); i++ {
				out = append(out, string(rs[i:i+2]))
			}
		} else {
			out = append(out, run)
		}
	}
	return out
}

func fnvBucket(token string) int {
	h := uint32(0x811c9dc5)
	for _, c := range token {
		h ^= uint32(c)
		h *= 0x01000193
	}
	return int(h % embedDim)
}

func tfVector(s string) []float64 {
	v := make([]float64, embedDim)
	toks := embedTokens(s)
	if len(toks) == 0 {
		return v
	}
	for _, t := range toks {
		v[fnvBucket(t)]++
	}
	norm := 0.0
	for _, x := range v {
		norm += x * x
	}
	norm = math.Sqrt(norm)
	if norm > 0 {
		for i := range v {
			v[i] /= norm
		}
	}
	return v
}

func cosine(a, b []float64) float64 {
	dot := 0.0
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	for i := 0; i < n; i++ {
		dot += a[i] * b[i]
	}
	return math.Max(-1, math.Min(1, dot))
}

// ---------- credibility (硬屏蔽/强降权; 数据 data/authority/credibility.json) ----------
//
//go:embed data/authority/credibility.json
var credibilityJSON []byte

var spamBlockedDomains, spamDownweightDomains = func() ([]string, []string) {
	var cred struct {
		Blocked    []string `json:"blocked"`
		Downweight []string `json:"downweight"`
	}
	if err := json.Unmarshal(credibilityJSON, &cred); err != nil {
		return []string{}, []string{}
	}
	return cred.Blocked, cred.Downweight
}()

const spamDownweightPenalty = -1.2

func matchSpamList(u string, table []string) string {
	host := hostOf(u)
	if host == "" {
		return ""
	}
	for _, d := range table {
		if host == d || strings.HasSuffix(host, "."+d) {
			return d
		}
	}
	return ""
}

// ---------- phase AK: 注册域近似(eTLD+1) — domainCap 计数粒度 ----------
var twoLevelTLDs = map[string]bool{
	"co.uk": true, "org.uk": true, "gov.uk": true, "ac.uk": true, "co.jp": true, "or.jp": true,
	"ne.jp": true, "ac.jp": true, "com.cn": true, "net.cn": true, "org.cn": true, "gov.cn": true,
	"edu.cn": true, "co.kr": true, "or.kr": true, "com.au": true, "net.au": true, "org.au": true,
	"com.hk": true, "org.hk": true, "com.tw": true, "org.tw": true, "com.br": true, "com.mx": true,
	"co.in": true, "co.nz": true, "co.za": true, "com.sg": true, "co.il": true,
}

func registrableDomain(hostname string) string {
	parts := strings.Split(strings.TrimPrefix(strings.ToLower(hostname), "www."), ".")
	if len(parts) <= 2 {
		return strings.Join(parts, ".")
	}
	last2 := strings.Join(parts[len(parts)-2:], ".")
	if twoLevelTLDs[last2] {
		return strings.Join(parts[len(parts)-3:], ".")
	}
	return last2
}

// ---------- phase AF: 页面级守卫(域名命中但页面缺查询关键 token → 提权清零) ----------
func isASCIIPrintable(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if c < 0x21 || c > 0x7e {
			return false
		}
	}
	return true
}

func keyTermPresent(query, u, title, snippet string) bool {
	terms := uniqueTerms(tokenize(query))
	if len(terms) == 0 {
		return true // 无可判定 → 放行(不打压)
	}
	var pool []string
	for _, t := range terms {
		if isASCIIPrintable(t) {
			pool = append(pool, t)
		}
	}
	if len(pool) == 0 {
		pool = terms
	}
	hay := strings.ToLower(title + " " + snippet + " " + u)
	var present []string
	for _, k := range pool {
		if strings.Contains(hay, k) {
			present = append(present, k)
		}
	}
	if len(present) == 0 {
		return false
	}
	maxLen := 0
	for _, t := range pool {
		if len(t) > maxLen {
			maxLen = len(t)
		}
	}
	for _, k := range present {
		if len(k) == maxLen {
			return true
		}
	}
	// phase AI 多证据放行: 长锚缺席但命中 ≥2 个其他查询 token
	return len(present) >= 2
}

// ---------- b37: snippet 合并判据(查询关键 token 命中数优先, 次取长度) ----------
// 批 36 五级血脉追踪坐实: fuseV3 URL 合并与 TF 去重同用 len(snippet) 更长者胜, 证据短句
// (常直答)被同页/孪生页长样板 snippet 覆盖 → 交付 title+snippet 零证据
// (dedup-text-superseded 3 案 + fuse-text-superseded 2 案, 其中快腿纯融合层 2 案与收割无关;
// 修复空间定界: 融合层上限 6/74≈8% miss@1, b34win 口径)。
// 判据: b37TermHits(查询关键 token 命中数, 与 keyTermPresent 同词表纪律: tokenize 停用词
// 过滤 + ASCII printable 池)多者胜; 打平(含双 0)回退长度规则 = 与旧行为逐字节一致 →
// 健康案零漂移, 只有"证据被长样板覆盖"的形态改判。长度规则同时污染 lex/守卫输入,
// 证据 snippet 胜出后 keyTermPresent 更可能为真 → 权威守卫方向性自洽。
func b37TermHits(text, query string) int {
	if text == "" {
		return 0
	}
	terms := uniqueTerms(tokenize(query))
	if len(terms) == 0 {
		return 0
	}
	var pool []string
	for _, t := range terms {
		if isASCIIPrintable(t) {
			pool = append(pool, t)
		}
	}
	if len(pool) == 0 {
		pool = terms // CJK 查询: bigram token Contains 可判
	}
	hay := strings.ToLower(text)
	n := 0
	for _, k := range pool {
		if strings.Contains(hay, k) {
			n++
		}
	}
	return n
}

// b37SnippetBetter: cur 是否应取代 old 作为合并后交付 snippet。
// keyTerm=false 恒走旧长度规则(回退开关/探针对照); true 走命中数优先。
func b37SnippetBetter(old, cur, query string, keyTerm bool) bool {
	if !keyTerm {
		return len(cur) > len(old)
	}
	oh, ch := b37TermHits(old, query), b37TermHits(cur, query)
	if oh != ch {
		return ch > oh
	}
	return len(cur) > len(old) // 打平: 旧规则 tiebreak, 严格大于保首现稳定
}

// ---------- 融合主公式 v3(权威三层 max-not-sum + catFrontrow + 页面守卫) ----------
type fuseOpts struct {
	topN            int
	query           string
	authorityBoost  float64 // 全局层分(缺省 0.75; TS fuseSemantic 不转发 engine 层传入值, 忠实保持)
	topic           string
	category        string
	lang            string
	communityIntent bool
	domainCap       int
	b37KeyTermMerge bool // 批 37: snippet 合并查询词命中优先(SC_B37_MERGE=0 回退旧行为)
}

const categorySFrontrow = 2.0 // phase AI 类目正主前排(只作用于命中的类目表 s 档)

func fuseV3(lanes []laneResult, o fuseOpts) []Reference {
	topN := o.topN
	if topN == 0 {
		topN = 20
	}
	// 单遍扁平化 + 引擎内 1 基名次(TS rankInEngine 语义); P1 的 0 基差在此修正口径
	type flatRef struct {
		Reference
		rank int
	}
	var flat []flatRef
	rankInEngine := map[string]int{}
	for _, lr := range lanes {
		for _, r := range lr.Refs {
			eng := "?"
			if len(r.Engines) > 0 {
				eng = r.Engines[0]
			}
			rankInEngine[eng]++
			flat = append(flat, flatRef{Reference: r, rank: rankInEngine[eng]})
		}
	}
	byURL := map[string]*fusedRef{}
	var order []string
	for _, fr := range flat {
		key := urlNorm(fr.URL)
		if !strings.HasPrefix(key, "http") {
			continue
		}
		if ex, ok := byURL[key]; ok {
			for _, e := range fr.Engines {
				if !containsStr(ex.Engines, e) {
					ex.Engines = append(ex.Engines, e)
				}
			}
			if b37SnippetBetter(ex.Snippet, fr.Snippet, o.query, o.b37KeyTermMerge) {
				ex.Snippet = fr.Snippet
			}
			if ex.Title == "" && fr.Title != "" {
				ex.Title = fr.Title
			}
			ex.engineRanks = append(ex.engineRanks, fr.rank)
		} else {
			nr := fr.Reference
			nr.URL = key
			nr.Engines = append([]string{}, fr.Engines...)
			byURL[key] = &fusedRef{Reference: nr, engineRanks: []int{fr.rank}}
			order = append(order, key)
		}
	}
	var fused []Reference
	for _, key := range order {
		fr := byURL[key]
		rrf := 0.0
		best := fr.engineRanks[0]
		for _, rank := range fr.engineRanks {
			rrf += 1.0 / float64(60+rank)
			if rank < best {
				best = rank
			}
		}
		lex := lexicalScore(o.query, fr.Title, fr.Snippet)
		consensus := 0.35 * float64(min(len(fr.Engines)-1, 2))
		titleBonus := titleAllTermsBonus(o.query, fr.Title) * 0.25
		// 权威三层: 全局兜底 / 主题分档 / 意图类别 — 取最强计一次分(max-not-sum)
		globalAuthority := matchAuthority(fr.URL)
		var topicMatch, catMatch *authorityHit
		if o.topic != "" {
			topicMatch = matchTopicAuthority(fr.URL, o.topic, o.lang, o.communityIntent)
		}
		if o.category != "" {
			catMatch = matchCategoryAuthority(fr.URL, o.category, o.lang, o.communityIntent)
		}
		tiered := topicMatch
		if catMatch != nil && (tiered == nil || catMatch.Boost > tiered.Boost) {
			tiered = catMatch
		}
		globalBoost := 0.0
		if globalAuthority != "" {
			globalBoost = o.authorityBoost
			if globalBoost == 0 {
				globalBoost = 0.75
			}
		}
		catFrontrow := 0.0
		if catMatch != nil && catMatch.Entry.Tier == "s" {
			catFrontrow = categorySFrontrow
		}
		matchedBoost := globalBoost
		if tiered != nil && tiered.Boost > matchedBoost {
			matchedBoost = tiered.Boost
		}
		if catFrontrow > matchedBoost {
			matchedBoost = catFrontrow
		}
		authorityDomain := globalAuthority
		if tiered != nil {
			authorityDomain = tiered.Domain
		}
		pageHit := keyTermPresent(o.query, fr.URL, fr.Title, fr.Snippet)
		ab := 0.0
		if pageHit {
			ab = matchedBoost
		}
		fr.Score = rrf*10 + lex*1.5 + consensus + titleBonus + ab
		fr.BestRank = best
		fr.Authority = authorityDomain
		if authorityDomain != "" {
			var entry *AuthorityEntry
			if tiered != nil {
				entry = &tiered.Entry
			} else {
				entry = &AuthorityEntry{Domain: authorityDomain}
			}
			fr.SourceKind = classifySourceKind(fr.URL, entry)
			if !pageHit {
				fr.AuthorityGuarded = true
			}
		}
		fused = append(fused, fr.Reference)
	}
	sortByScore(fused)
	if len(fused) > 100 {
		fused = fused[:100] // 宽池(TS fuseSemantic 内层 topN:100)
	}
	return fused
}

func sortByScore(rs []Reference) {
	for i := 1; i < len(rs); i++ {
		for j := i; j > 0 && (rs[j].Score > rs[j-1].Score || (rs[j].Score == rs[j-1].Score && rs[j].BestRank < rs[j-1].BestRank)); j-- {
			rs[j], rs[j-1] = rs[j-1], rs[j]
		}
	}
}

// ---------- fuseSemantic: fuse → spam 双档 → 语义去重 → domainCap 贪心 ----------
type semanticMeta struct {
	DedupMerged      int
	RelevanceDropped int
	Embedder         string
	EmbedderFailed   bool
	SpamBlocked      int
	AuthorityGuarded int
}

func fuseSemantic(lanes []laneResult, o fuseOpts, topN int) ([]Reference, semanticMeta) {
	meta := semanticMeta{Embedder: "-"}
	base := fuseV3(lanes, fuseOpts{
		query: o.query, topN: 100, // 先取宽池, 语义阶段裁剪
		topic: o.topic, category: o.category, lang: o.lang, communityIntent: o.communityIntent,
		authorityBoost: 0.75, // TS: fuseSemantic 不转发 engine 的 authorityBoost → fuse 缺省 0.75(忠实保持)
	})
	// spam 双档: 硬屏蔽剔除 / 强降权标注
	kept0 := make([]Reference, 0, len(base))
	for _, r := range base {
		if d := matchSpamList(r.URL, spamBlockedDomains); d != "" {
			meta.SpamBlocked++
			continue
		}
		if d := matchSpamList(r.URL, spamDownweightDomains); d != "" {
			r.Spam = d
			r.Score += spamDownweightPenalty
		}
		kept0 = append(kept0, r)
	}
	// spam 介入过才重排(与 TS 同款条件)
	if meta.SpamBlocked > 0 {
		sortByScore(kept0)
	} else {
		for _, r := range kept0 {
			if r.Spam != "" {
				sortByScore(kept0)
				break
			}
		}
	}
	cur := kept0
	// 语义去重(TF hash; 任何错误不阻塞 → 等效全放行)
	if len(cur) > 1 {
		vecs := make([][]float64, len(cur))
		for i, r := range cur {
			vecs[i] = tfVector(r.Title + " " + r.Snippet)
		}
		type keptPair struct {
			ref Reference
			vec []float64
		}
		var kept []keptPair
		for i, r := range cur {
			twin := -1
			for j, k := range kept {
				if cosine(k.vec, vecs[i]) > 0.75 {
					twin = j
					break
				}
			}
			if twin >= 0 {
				meta.DedupMerged++
				t := &kept[twin].ref
				for _, e := range r.Engines {
					if !containsStr(t.Engines, e) {
						t.Engines = append(t.Engines, e)
					}
				}
				if b37SnippetBetter(t.Snippet, r.Snippet, o.query, o.b37KeyTermMerge) {
					t.Snippet = r.Snippet
				}
				if t.Title == "" && r.Title != "" {
					t.Title = r.Title
				}
				if r.Published > t.Published {
					t.Published = r.Published
				}
			} else {
				kept = append(kept, keptPair{ref: r, vec: vecs[i]})
			}
		}
		cur = make([]Reference, 0, len(kept))
		for _, k := range kept {
			cur = append(cur, k.ref)
		}
		meta.Embedder = "tf-hash"
	}
	// domainCap 贪心(排序后单注册域最多 cap 条; 0=关闭; 治单一权威源霸屏)
	domainCap := o.domainCap // 调用方恒传显式值(TS engine 恒传 0 或 3); 0=关闭(packages/devops 域名纯度)
	if domainCap > 0 {
		seen := map[string]int{}
		capped := make([]Reference, 0, topN)
		for _, r := range cur {
			h := "?"
			if host := hostOf(r.URL); host != "" {
				h = registrableDomain(host)
			}
			n := seen[h]
			if n >= domainCap {
				continue
			}
			seen[h] = n + 1
			capped = append(capped, r)
			if len(capped) >= topN {
				break
			}
		}
		cur = capped
	}
	if len(cur) > topN {
		cur = cur[:topN]
	}
	for i := range cur {
		cur[i].Rank = i + 1
		cur[i].RefID = i + 1
	}
	for _, r := range cur {
		if r.AuthorityGuarded {
			meta.AuthorityGuarded++
		}
	}
	return cur, meta
}
