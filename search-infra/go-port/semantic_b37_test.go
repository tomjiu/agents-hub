package main

// b37 单测: snippet 合并判据(查询关键 token 命中数优先, 次取长度) 三形态。
// 背景: 批 36 五级血脉追踪坐实 fuseV3 URL 合并与 TF 去重"长 snippet 胜出"覆盖证据文本
// (FUSION-LOSS 6/21 案)。判据设计红线: 打平(含双 0)回退长度规则 = 与旧行为逐字节一致,
// 只有"证据被长样板覆盖"形态改判 → 健康案零漂移。

import (
	"strings"
	"testing"
)

// b37Q: 5 个 ASCII 查询词(manages/bureau/land/management/acres; who 是停用词被 tokenize 剔除)
const b37Q = "who manages the bureau of land management acres"

func TestB37SnippetMerge(t *testing.T) {
	// 形态①: 证据短句(命中 5) vs 长样板(命中 3) — 命中数优先, 短句胜
	evidence := "The Bureau of Land Management manages over 247.3 million acres."
	boiler := "The bureau of land and resources management publishes annual reports, land surveys, management plans, and other documents about public lands, recreation, and conservation across many agencies and bureaus worldwide."
	if got := b37TermHits(evidence, b37Q); got != 5 {
		t.Fatalf("b37TermHits(证据)=%d, 期望 5", got)
	}
	if got := b37TermHits(boiler, b37Q); got != 3 {
		t.Fatalf("b37TermHits(样板)=%d, 期望 3", got)
	}
	if !b37SnippetBetter(boiler, evidence, b37Q, true) {
		t.Fatalf("形态①失败: 证据 snippet 应胜出")
	}
	// 同一对, 旧规则: 长样板胜(回归锚 — 长度规则语义未动)
	if !b37SnippetBetter(evidence, boiler, b37Q, false) {
		t.Fatalf("旧规则回归锚失败: 长 snippet 应胜")
	}

	// 形态②: 命中数打平 → 回退长度规则(与旧行为一致)
	longTie := strings.Repeat("x", 200) + " bureau land"
	shortTie := "bureau land " + strings.Repeat("y", 50)
	if b37SnippetBetter(longTie, shortTie, b37Q, true) {
		t.Fatalf("形态②失败: 命中打平时长 snippet 应保持胜出")
	}
	if !b37SnippetBetter(shortTie, longTie, b37Q, true) {
		t.Fatalf("形态②失败: 更长 challenger 应胜")
	}

	// 形态③: 双方 0 命中 → 纯长度规则(=旧行为)
	if !b37SnippetBetter("short", "a much longer snippet with no query terms at all", b37Q, true) {
		t.Fatalf("形态③失败: 双 0 命中时应按长度规则")
	}

	// 形态④: 命中与长度全等 → 不换(严格大于, 保首现稳定)
	same := "bureau land management"
	if b37SnippetBetter(same, same, b37Q, true) {
		t.Fatalf("形态④失败: 全等时不得替换")
	}

	// 形态⑤: CJK 查询 — ASCII 池空回退全词表(tokenize bigram), Contains 可判
	cjkQ := "高血压 最新 系统综述"
	if got := b37TermHits("降压药对高血压患者的疗效", cjkQ); got < 2 {
		t.Fatalf("形态⑤失败: CJK bigram 命中数=%d, 期望 ≥2", got)
	}
	if b37TermHits("totally unrelated english text", cjkQ) != 0 {
		t.Fatalf("形态⑤失败: 无关文本应为 0 命中")
	}
}

// TestB37FuseV3URLMerge: 同 URL 多引擎合并 — 证据 snippet 应在开旗时胜出, 关旗时旧规则胜出。
func TestB37FuseV3URLMerge(t *testing.T) {
	evidence := "The Bureau of Land Management manages over 247.3 million acres of land."
	boiler := "bureau of land and resources management annual reports and land surveys and management plans and public documents about lands and agencies"
	lanes := []laneResult{
		{Name: "e1", Refs: []Reference{{URL: "https://example.gov/wiki/BLM", Title: "BLM", Snippet: boiler, Engines: []string{"e1"}}}},
		{Name: "e2", Refs: []Reference{{URL: "https://example.gov/wiki/BLM/", Title: "BLM", Snippet: evidence, Engines: []string{"e2"}}}},
	}
	// 开旗: URL 合并(e2 的证据 snippet 命中更多) → 证据胜出
	got := fuseV3(lanes, fuseOpts{query: b37Q, topN: 20, b37KeyTermMerge: true})
	if len(got) != 1 {
		t.Fatalf("URL 合并应出 1 条, got %d", len(got))
	}
	if !strings.Contains(got[0].Snippet, "247.3 million") {
		t.Fatalf("开旗失败: 合并后 snippet 应为证据文本, got %q", got[0].Snippet)
	}
	// 关旗: 旧长度规则 → 样板胜出(回归锚)
	gotLegacy := fuseV3(lanes, fuseOpts{query: b37Q, topN: 20, b37KeyTermMerge: false})
	if gotLegacy[0].Snippet != boiler {
		t.Fatalf("关旗回归锚失败: 应保留长样板, got %q", gotLegacy[0].Snippet)
	}
}

// TestB37DedupMerge: TF 去重孪生吸收 — 保留行应在开旗时采纳被吸收行的证据 snippet。
// 构造: 保留行 A=长样板(重复词抬长度, 命中 0), 吸收行 B=更短但带查询词(命中 2),
// 词表高重叠保 cosine>0.75 触发孪生; 旧规则 A 的长样板胜(不被替换), 新规则采纳 B。
func TestB37DedupMerge(t *testing.T) {
	const w1 = "bibliographical"
	const w2 = "chronologizer"
	const w3 = "lexicographical"
	const w4 = "paleontological"
	const w5 = "seismological"
	const w6 = "meteorological"
	aTitle := "Reference Works"
	bTitle := "Reference Works"
	aSnip := w1 + " " + w2 + " " + w3 + " " + w4 + " " + w5 + " " + w6 + " " + w1 + " " + w2 // 8 token, 长
	bSnip := w1 + " " + w2 + " " + w3 + " " + w4 + " " + w5 + " bureau land"                 // 更短, 带查询词
	const dedupQ = "bureau land"
	// 自检: 孪生判定(cos>0.75)确实触发, 且 B 确实比 A 短
	if c := cosine(tfVector(aTitle+" "+aSnip), tfVector(bTitle+" "+bSnip)); c <= 0.75 {
		t.Fatalf("fixture 自检失败: 孪生 cosine=%v 应 >0.75", c)
	}
	if len(bSnip) >= len(aSnip) {
		t.Fatalf("fixture 自检失败: B(%d) 应比 A(%d) 短", len(bSnip), len(aSnip))
	}
	lanes := []laneResult{
		{Name: "e1", Refs: []Reference{
			{URL: "https://a.example/works", Title: aTitle, Snippet: aSnip, Engines: []string{"e1"}},
			{URL: "https://b.example/works", Title: bTitle, Snippet: bSnip, Engines: []string{"e1"}},
		}},
	}
	// 开旗: 证据行(b.example, lex 高→保留方)保住证据; 被吸收行 a.example 长样板不再覆盖它。
	// (b36 真实丢失形态的镜像: 高分行持长样板时证据被覆盖; 本 fixture 反转角色 — 保留方
	// 持证据短句, 被吸收方持长样板 → 旧规则下被覆盖=丢失形态复现, 新规则下命中数优先=救援)
	got, _ := fuseSemantic(lanes, fuseOpts{query: dedupQ, topN: 20, b37KeyTermMerge: true}, 20)
	if len(got) != 1 || got[0].URL != "https://b.example/works" {
		t.Fatalf("去重应保留 b.example(证据行 lex 高) 1 条, got %+v", got)
	}
	if got[0].Snippet != bSnip {
		t.Fatalf("开旗失败: 证据 snippet 应保留, got %q", got[0].Snippet)
	}
	// 关旗: 旧规则长样板覆盖证据文本(b36 丢失形态复现锚)
	gotLegacy, _ := fuseSemantic(lanes, fuseOpts{query: dedupQ, topN: 20, b37KeyTermMerge: false}, 20)
	if gotLegacy[0].URL != "https://b.example/works" || gotLegacy[0].Snippet != aSnip {
		t.Fatalf("关旗回归锚失败: 长样板应覆盖证据(丢失形态), got url=%s snip=%q", gotLegacy[0].URL, gotLegacy[0].Snippet)
	}
}
