package main

// S3 语义效果 (issue #3 实施阶段): 词法证据门 + 版本适用性信号 + 来源构成摘要。
//
// 1) 词法证据门 (TS core/src/relevance.ts lexical-evidence-v1 逐字对齐迁入):
//    查询词(去通用词/操作符/URL)至少 40%(≥2) 出现在 title+snippet+path 才入池 —
//    修复 S0-F2(词重合但无关结果, 如 "python list comprehension recipes cooking" 命中纯烹饪页)。
//    v2(Go 领先): 复数折叠 + 50% 证据下限; TS lexical-evidence-v1 挂账同步。
//    诚实边界: 这是保守词法证据下限, 不是语义相关性或事实核验。
// 2) 版本适用性: 查询带明确版本而 ref 标题/URL 呈现不同主版本 → 只标注(versionMismatch), 不剔除;
//    "当前版本问题不能把旧版本当默认行为"由调用方结合标注判断。
// 3) 来源构成: authority 层 SourceKind 计数(官方/社区/未知), 附在 quality meta 供透明诊断。

import (
	"net/url"
	"regexp"
	"strings"

	"golang.org/x/text/unicode/norm"
)

// genericTerms 与 TS GENERIC 集合逐字对齐(检索算子/泛词不构成相关性证据)
var genericTerms = map[string]bool{
	"the": true, "a": true, "an": true, "of": true, "in": true, "on": true, "for": true, "to": true,
	"and": true, "or": true, "is": true, "are": true, "was": true, "were": true, "what": true,
	"how": true, "why": true, "when": true, "which": true, "who": true, "with": true, "at": true,
	"by": true, "from": true, "about": true, "official": true, "documentation": true, "docs": true,
	"guide": true, "tutorial": true, "overview": true, "latest": true, "best": true,
	"的": true, "了": true, "是": true, "在": true, "和": true, "与": true,
	"怎么": true, "如何": true, "什么": true, "官方": true, "文档": true, "教程": true,
}

// foldPlural 轻量复数折叠(len>3 且非 ss 结尾才剥尾 s):
// recipes→recipe / comprehensions→comprehension / lists→list。
// 无词干化野心, 只为词法证据消除单复数漏配; 泛词过滤在折叠前做(docs 仍被滤)。
func foldPlural(token string) string {
	if len(token) > 3 && strings.HasSuffix(token, "s") && !strings.HasSuffix(token, "ss") && !strings.HasSuffix(token, "us") && !strings.HasSuffix(token, "is") {
		return token[:len(token)-1]
	}
	return token
}

func relevanceTerms(text string) []string {
	seen := map[string]bool{}
	var out []string
	for _, t := range embedTokens(norm.NFKC.String(text)) {
		if len([]rune(t)) > 1 && !genericTerms[t] {
			t = foldPlural(t)
			if !seen[t] {
				seen[t] = true
				out = append(out, t)
			}
		}
	}
	return out
}

var queryOperatorRe = regexp.MustCompile(`(?i)(?:site|filetype|intitle|inurl):[^\s]+`)
var queryUrlRe = regexp.MustCompile(`(?i)https?://[^\s]+`)
var snippetPrefixRe = regexp.MustCompile(`^\[[^\]]+\]\s*`)

type evidenceVerdict struct {
	Accepted bool
	Matched  []string
	Required int
	Terms    int
}

// relevanceEvidence 单条 ref 的词法证据评估(TS relevanceEvidence 同款语义)
func relevanceEvidence(query string, ref Reference) evidenceVerdict {
	queryText := queryUrlRe.ReplaceAllString(queryOperatorRe.ReplaceAllString(query, ""), "")
	wanted := relevanceTerms(queryText)
	path := ""
	if u, err := url.Parse(ref.URL); err == nil {
		if p, err := url.PathUnescape(u.EscapedPath()); err == nil {
			path = p
		} else {
			path = u.EscapedPath()
		}
	}
	snippet := snippetPrefixRe.ReplaceAllString(ref.Snippet, "")
	hay := map[string]bool{}
	for _, t := range relevanceTerms(ref.Title + " " + snippet + " " + path) {
		hay[t] = true
	}
	verdict := evidenceVerdict{Terms: len(wanted)}
	switch {
	case len(wanted) == 0:
		verdict.Required = 0
	case len(wanted) == 1:
		verdict.Required = 1
	default:
		// S3 (Go 领先, lexical-evidence-v2): 40%→50% 下限。
		// S0-F2 实测: "python list comprehension recipes cooking" 5 词查询下,
		// 40% 下限(2词)放行纯烹饪页(recipes+cooking 词重合); 50%(3词)拒绝之,
		// python 页(python+list+comprehension)仍入池。TS 侧挂账同步。
		n := (len(wanted) + 1) / 2 // ceil(0.5*n)
		if n < 2 {
			n = 2
		}
		verdict.Required = n
	}
	for _, t := range wanted {
		if hay[t] {
			verdict.Matched = append(verdict.Matched, t)
		}
	}
	verdict.Accepted = verdict.Required > 0 && len(verdict.Matched) >= verdict.Required
	return verdict
}

// QualityMeta 词法证据门输出(TS FuseSemanticMeta.quality 形状 + S3 扩展)
type QualityMeta struct {
	Status       string         `json:"status"` // candidate_results | no_relevant_results
	Evaluated    int            `json:"evaluated"`
	Rejected     int            `json:"rejected"`
	Reasons      map[string]int `json:"reasons"`
	Policy       string         `json:"policy"` // lexical-evidence-v1
	VersionCheck *VersionCheck  `json:"versionCheck,omitempty"`
	SourceMix    map[string]int `json:"sourceMix,omitempty"`
	RelevantRefs int            `json:"relevantRefs"`
}

// applyEvidenceGate 对腿结果应用证据门: 返回过滤后的腿副本(原腿不动)、quality meta、相关 ref 数
func applyEvidenceGate(query string, lanes []laneResult) ([]laneResult, QualityMeta, int) {
	q := QualityMeta{Reasons: map[string]int{}, Policy: "lexical-evidence-v2"}
	out := make([]laneResult, len(lanes))
	relevant := 0
	for i, lr := range lanes {
		fl := lr
		fl.Refs = nil
		for _, r := range lr.Refs {
			v := relevanceEvidence(query, r)
			q.Evaluated++
			if v.Accepted {
				fl.Refs = append(fl.Refs, r)
				relevant++
			} else {
				q.Rejected++
				reason := "insufficient_query_evidence"
				if v.Terms == 0 {
					reason = "no_query_terms"
				}
				q.Reasons[reason]++
			}
		}
		out[i] = fl
	}
	q.RelevantRefs = relevant
	if relevant > 0 {
		q.Status = "candidate_results"
	} else {
		q.Status = "no_relevant_results"
	}
	return out, q, relevant
}

// ---------- 版本适用性信号(只标注, 不剔除) ----------

type VersionFlag struct {
	RefID        int    `json:"refId"`
	QueryVersion string `json:"queryVersion"`
	RefVersion   string `json:"refVersion"`
	Reason       string `json:"reason"`
}

type VersionCheck struct {
	QueryVersion string        `json:"queryVersion,omitempty"`
	Flagged      []VersionFlag `json:"flagged,omitempty"`
}

var versionTokenRe = regexp.MustCompile(`\bv?(\d+(?:\.\d+)+(?:-[0-9A-Za-z.]+)?|\d+)\b`)

func majorOf(version string) string {
	parts := strings.SplitN(version, ".", 2)
	return parts[0]
}

func firstVersionToken(text string) string {
	for _, m := range versionTokenRe.FindAllStringSubmatch(text, -1) {
		if len(m[1]) >= 2 || strings.Contains(m[1], ".") { // 单数字太宽(如 "top 10") — 至少两位或多段
			return m[1]
		}
	}
	return ""
}

// versionSignals 查询版本 vs ref 版本主段不一致 → 标注(旧版本/实验分支不当默认答案的透明线索)
func versionSignals(query string, refs []Reference) *VersionCheck {
	qv := firstVersionToken(queryOperatorRe.ReplaceAllString(query, ""))
	if qv == "" {
		return nil
	}
	vc := &VersionCheck{QueryVersion: qv}
	for _, r := range refs {
		rv := firstVersionToken(r.Title + " " + r.URL)
		if rv == "" {
			continue
		}
		if majorOf(rv) != majorOf(qv) {
			vc.Flagged = append(vc.Flagged, VersionFlag{
				RefID: r.RefID, QueryVersion: qv, RefVersion: rv, Reason: "different_major_version",
			})
		}
	}
	return vc
}

// sourceMix authority 层 SourceKind 构成(官方/社区/未知) — S3 来源透明诊断
func sourceMix(refs []Reference) map[string]int {
	m := map[string]int{}
	for _, r := range refs {
		k := strings.ToLower(strings.TrimSpace(r.SourceKind))
		if k == "" {
			k = "unknown"
		}
		m[k]++
	}
	return m
}

// refsOf 腿结果摊平(证据门/版本信号/来源构成共用)
func refsOf(lanes []laneResult) []Reference {
	var out []Reference
	for _, lr := range lanes {
		out = append(out, lr.Refs...)
	}
	return out
}
