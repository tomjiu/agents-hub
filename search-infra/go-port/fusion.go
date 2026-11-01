package main

// 融合层 P1(fusion-lite+): RRF×10 + lex×1.5 + titleBonus×0.25 + consensus 0.35×min(n-1,2)
// 逐字对齐 TS core/src/fusion.ts 的 tokenize/STOP/lexicalScore/titleAllTermsBonus/urlNorm/主公式与 tie-break。
// P1 未移植: 三层权威提权/domainCap/语义去重/keyTermPresent 页面守卫(P3 范围, 见 PLAN.md)。

import (
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"
)

// ---------- tokenize(STOP 表与 TS 逐字一致) ----------
var stopWords = map[string]bool{
	"the": true, "a": true, "an": true, "of": true, "in": true, "on": true, "for": true,
	"to": true, "and": true, "or": true, "is": true, "are": true, "was": true, "were": true,
	"what": true, "how": true, "why": true, "when": true, "which": true, "who": true,
	"with": true, "at": true, "by": true, "from": true, "about": true,
	// b18 外部基准(NQ/TriviaQA)排序头部批: 疑问骨架假亲和实锤 —
	// "In baseball, where do the Orioles come from?" 的 where/do/come 骨架词面被
	// 学术论文标题高频模式("Where do X come from?")完整命中, 词面覆盖压过主题词,
	// 无关论文压顶 Orioles 词条(rank1/2 全论文)。骨架词无主题定位价值:
	// where/whom/whose 疑问副词族 + do/does 助动词 + come(骨架动词)。
	// 保守不加: did(DID 去中心化身份主题冲突)/will(Will Smith 人名)/
	// 情态动词族(can/may...)与 have 族(Have-Nots 剧名) — 观察项。
	"where": true, "whom": true, "whose": true, "do": true, "does": true, "come": true,
	"的": true, "了": true, "是": true, "在": true, "和": true, "与": true, "有": true,
	"对": true, "怎么": true, "如何": true, "什么": true, "为什么": true, "哪个": true,
}

var splitRe = regexp.MustCompile(`[^\p{L}\p{N}]+`)

// b15 质量抽检(第一性根因): tokenize 对 CJK 无分词 — 连续中文 title 整句成单一 token,
// 与 query 词永不交集 → 中文题 lex 恒 0, 排序退化成纯 rrf, SEO 首页碾压真结果
// (实测: 高血压题 metacpan 垃圾 0.758 压顶, 含"荟萃分析"真结果 0.164 垫底; 富士山题
// keenable SEO 首页 0.90 > pixabay 真结果 0.54)。修法 = CJK 长段(>2 rune) bigram 切分,
// 词中可匹配("荟萃分析" ∩ "最新系统综述和" = {萃分,分析} 级), 英文/数字 token 不变。
func cjkBigram(t string, r []rune) []string {
	out := make([]string, 0, len(r))
	for i := 0; i+2 <= len(r); i++ {
		out = append(out, string(r[i:i+2]))
	}
	return out
}

func isCJKToken(t string, r []rune) bool {
	if len(r) < 2 {
		return false
	}
	for _, c := range r {
		if !(c >= 0x4e00 && c <= 0x9fff) { // CJK 统一表意区(混排字母/数字段不切)
			return false
		}
	}
	return true
}

func tokenize(s string) []string {
	parts := splitRe.Split(strings.ToLower(s), -1)
	out := make([]string, 0, len(parts))
	for _, t := range parts {
		r := []rune(t)
		if len(r) > 1 && !stopWords[t] {
			if isCJKToken(t, r) && len(r) > 2 {
				out = append(out, cjkBigram(t, r)...)
			} else {
				out = append(out, t)
			}
		}
	}
	return out
}

func uniqueTerms(tokens []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(tokens))
	for _, t := range tokens {
		if !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	return out
}

// ---------- 词法相关性: title 权重 2x, 命中词比例 0-1(TS 同款) ----------
func lexicalScore(query, title, snippet string) float64 {
	terms := uniqueTerms(tokenize(query))
	if len(terms) == 0 {
		return 0
	}
	haySet := map[string]bool{}
	for _, t := range tokenize(title + " " + title + " " + snippet) { // title 计两次
		haySet[t] = true
	}
	hit := 0
	for _, t := range terms {
		if haySet[t] {
			hit++
		}
	}
	return float64(hit) / float64(len(terms))
}

// ---------- 全词命中 title 独立加分(词边界切分, 抗 "react"→"reactive" 误伤) ----------
func titleAllTermsBonus(query, title string) float64 {
	terms := uniqueTerms(tokenize(query))
	if len(terms) == 0 {
		return 0
	}
	haySet := map[string]bool{}
	for _, t := range tokenize(title) {
		haySet[t] = true
	}
	for _, t := range terms {
		if !haySet[t] {
			return 0
		}
	}
	return 1
}

// ---------- URL 归一化(TS urlNorm 同款): 去 hash/主机小写/丢 tracker 参数/参数排序/去尾斜杠 ----------
var trackerRe = regexp.MustCompile(`^(utm_.*|ref_.*|fbclid|gclid|igshid|mc_cid|mc_eid|dclid|gclsrc|mkt_tok|msclkid|twclid|yclid)$`)

func urlNorm(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	u.Fragment = ""
	u.Host = strings.ToLower(u.Host)
	q := u.Query()
	keys := make([]string, 0, len(q))
	for k := range q {
		if trackerRe.MatchString(k) {
			keys = append(keys, k)
		}
	}
	for _, k := range keys {
		q.Del(k)
	}
	// Encode() 自动按键名字典序排序(对齐 TS 的参数排序合并意图; 多值内序差异如实保留)
	u.RawQuery = q.Encode()
	s := u.String()
	if strings.HasSuffix(s, "/") && u.Path != "/" {
		s = strings.TrimSuffix(s, "/")
	}
	return s
}

// ---------- 融合主公式 ----------
type fusedRef struct {
	Reference
	engineRanks []int
}

func fuse(query string, lanes []laneResult, topN int) []Reference {
	byURL := map[string]*fusedRef{}
	var order []string
	for _, lr := range lanes {
		for rank, r := range lr.Refs {
			key := urlNorm(r.URL)
			if fr, ok := byURL[key]; ok {
				for _, eng := range r.Engines {
					if !containsStr(fr.Engines, eng) {
						fr.Engines = append(fr.Engines, eng)
					}
				}
				if fr.Title == "" && r.Title != "" {
					fr.Title = r.Title
				}
				fr.engineRanks = append(fr.engineRanks, rank)
			} else {
				nr := r
				nr.URL = key
				nr.Engines = append([]string{}, r.Engines...)
				byURL[key] = &fusedRef{Reference: nr, engineRanks: []int{rank}}
				order = append(order, key)
			}
		}
	}
	fused := make([]Reference, 0, len(order))
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
		lex := lexicalScore(query, fr.Title, fr.Snippet)
		consensus := 0.35 * float64(min(len(fr.Engines)-1, 2))
		titleBonus := titleAllTermsBonus(query, fr.Title) * 0.25
		fr.Score = rrf*10 + lex*1.5 + consensus + titleBonus
		fr.BestRank = best
		fused = append(fused, fr.Reference)
	}
	// 显式 tie-break(同分保引擎内最佳排名, 结果确定可复现; TS 同款)
	sort.SliceStable(fused, func(i, j int) bool {
		if fused[i].Score != fused[j].Score {
			return fused[i].Score > fused[j].Score
		}
		return fused[i].BestRank < fused[j].BestRank
	})
	if len(fused) > topN {
		fused = fused[:topN]
	}
	return fused
}

func containsStr(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

var _ = fmt.Sprintf // 保持 import 对齐(P1 暂未用 fmt 时可删)
