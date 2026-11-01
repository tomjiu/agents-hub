package main

// 引用出口校验 (对齐 TS citations.ts, v0-spec §3.3/§6 验收口径):
// 输出文本中的 [n] 必须全部可回溯到引用注册表 — 幻觉引用零容忍。
// strict: 有幻觉引用抛错(验收口径); strip: 剔除幻觉引用后放行并标注("宁可少引用不可假引用")。

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
)

type CitationEntry struct {
	URL   string `json:"url"`
	Title string `json:"title"`
}

// CitationRegistry refId → 引用元数据;输出前建好, 输出后校验
type CitationRegistry map[int]CitationEntry

func buildCitationRegistry(refs []Reference) CitationRegistry {
	m := CitationRegistry{}
	for _, r := range refs {
		if r.RefID != 0 {
			if _, ok := m[r.RefID]; !ok {
				m[r.RefID] = CitationEntry{URL: r.URL, Title: r.Title}
			}
		}
	}
	return m
}

type CitationAudit struct {
	Cited   []int `json:"cited"`   // 文本中出现的引用编号(去重升序)
	Unknown []int `json:"unknown"` // 出现了但注册表里没有 — 幻觉引用
	Unused  []int `json:"unused"`  // 注册表里从未被引用(仅提示, 不算失败)
	OK      bool  `json:"ok"`
}

var citeRe = regexp.MustCompile(`\[(\d{1,3})\]`)

// auditCitations 扫描文本中的 [n] 引用并对注册表核验
func auditCitations(text string, registry CitationRegistry) CitationAudit {
	seen := map[int]bool{}
	for _, m := range citeRe.FindAllStringSubmatch(text, -1) {
		n, _ := strconv.Atoi(m[1])
		seen[n] = true
	}
	cited := make([]int, 0, len(seen))
	for n := range seen {
		cited = append(cited, n)
	}
	sort.Ints(cited)
	unknown := []int{}
	for _, n := range cited {
		if _, ok := registry[n]; !ok {
			unknown = append(unknown, n)
		}
	}
	unused := []int{}
	for n := range registry {
		if !seen[n] {
			unused = append(unused, n)
		}
	}
	sort.Ints(unused)
	return CitationAudit{Cited: cited, Unknown: unknown, Unused: unused, OK: len(unknown) == 0}
}

// enforceCitations strict 校验失败返回 error(调用方必须修);
// strip 把未注册 [n] 替换为空并在 audit 报告。
func enforceCitations(text string, registry CitationRegistry, strict bool) (string, CitationAudit, error) {
	audit := auditCitations(text, registry)
	if audit.OK {
		return text, audit, nil
	}
	if strict {
		return "", audit, fmt.Errorf(
			"citation exit validation failed: %v not in registry (cited=%d, registry=%d)",
			audit.Unknown, len(audit.Cited), len(registry))
	}
	stripped := citeRe.ReplaceAllStringFunc(text, func(full string) string {
		m := citeRe.FindStringSubmatch(full)
		n, _ := strconv.Atoi(m[1])
		if _, ok := registry[n]; ok {
			return full
		}
		return ""
	})
	audit.OK = true
	return stripped, audit, nil
}

// renderCitations 引用列表渲染(markdown 尾注格式)
func renderCitations(registry CitationRegistry) string {
	ids := make([]int, 0, len(registry))
	for id := range registry {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	lines := make([]string, 0, len(ids))
	for _, id := range ids {
		r := registry[id]
		lines = append(lines, fmt.Sprintf("[%d] %s — %s", id, r.Title, r.URL))
	}
	return joinLines(lines)
}
