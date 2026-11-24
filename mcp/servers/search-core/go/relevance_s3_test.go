package main

// S3 (issue #3) 词法证据门 + 版本适用性信号测试。
// S0-F2 复现: 查询 "python list comprehension recipes cooking" 的词重合但无关结果
// (纯烹饪页)必须被拒绝; python 页面保留。fixture 来自 s0-baseline 题集 Q6 语义。

import (
	"testing"
)

func refOf(url, title, snippet string) Reference {
	return Reference{URL: url, Title: title, Snippet: snippet}
}

// S0-F2 红灯场景: 词重合但无关结果必须被证据门拒绝
func TestEvidenceGateRejectsWordOverlapIrrelevant(t *testing.T) {
	query := "python list comprehension recipes cooking"
	refs := []Reference{
		// python 相关页(证据: python + comprehension/list) — 保留
		refOf("https://docs.python.org/3/tutorial/datastructures.html", "List Comprehensions — Python 3 documentation", "List comprehensions provide a concise way to create lists in python"),
		refOf("https://stackoverflow.com/questions/20639180", "python list comprehension explained", "how does a python list comprehension work with conditions"),
		// 纯烹饪页(词重合: recipes/cooking, 但缺 python/list/comprehension) — 拒绝
		refOf("https://www.allrecipes.com/recipe/15891", "Easy Cooking Recipes for Beginners", "our best cooking recipes for quick weeknight dinners"),
		refOf("https://tasty.co/recipe/pasta", "15 Easy Recipes", "quick cooking recipes anyone can make tonight"),
	}
	kept, q, relevant := applyEvidenceGate(query, []laneResult{{Name: "t", Refs: refs}})
	if len(kept[0].Refs) != 2 {
		t.Fatalf("cooking pages must be rejected, kept=%d: %+v", len(kept[0].Refs), kept[0].Refs)
	}
	if q.Rejected != 2 || q.Evaluated != 4 {
		t.Fatalf("quality counters wrong: rejected=%d evaluated=%d", q.Rejected, q.Evaluated)
	}
	if q.Reasons["insufficient_query_evidence"] != 2 {
		t.Fatalf("reasons wrong: %+v", q.Reasons)
	}
	if q.Status != "candidate_results" || q.Policy != "lexical-evidence-v2" {
		t.Fatalf("status/policy wrong: %s/%s", q.Status, q.Policy)
	}
	if relevant != 2 {
		t.Fatalf("relevant=%d", relevant)
	}
}

// 全部无关 → no_relevant_results(透明降级, 不是假成功)
func TestEvidenceGateAllIrrelevant(t *testing.T) {
	kept, q, relevant := applyEvidenceGate("rust async runtime", []laneResult{{Name: "t", Refs: []Reference{
		refOf("https://x.example/a", "gardening tips", "planting seasonal flowers"),
	}}})
	if len(kept[0].Refs) != 0 || relevant != 0 {
		t.Fatal("all irrelevant refs must be dropped")
	}
	if q.Status != "no_relevant_results" {
		t.Fatalf("status=%s", q.Status)
	}
}

// 检索算子/site:/URL 不构成相关性证据(TS 对齐)
func TestEvidenceGateOperatorsNotEvidence(t *testing.T) {
	// 查询只剩 site: 算子与 URL → 去除后无查询词 → no_query_terms
	_, q, _ := applyEvidenceGate("site:docs.python.org", []laneResult{{Name: "t", Refs: []Reference{
		refOf("https://docs.python.org/x", "docs.python.org page", "docs.python.org content"),
	}}})
	if q.Reasons["no_query_terms"] != 1 {
		t.Fatalf("operator-only query must be no_query_terms, got %+v", q.Reasons)
	}
}

// 中文查询: CJK bigram 证据
func TestEvidenceGateCJK(t *testing.T) {
	refs := []Reference{
		refOf("https://zh.example/a", "SQLite WAL 模式并发写入", "SQLite WAL 模式支持并发读写"),
		refOf("https://zh.example/b", "今日菜谱推荐", "好吃的家常菜做法"),
	}
	kept, q, _ := applyEvidenceGate("sqlite wal 并发写入", []laneResult{{Name: "t", Refs: refs}})
	if len(kept[0].Refs) != 1 {
		t.Fatalf("CJK irrelevant page must be rejected, kept=%d", len(kept[0].Refs))
	}
	if q.Status != "candidate_results" {
		t.Fatalf("status=%s", q.Status)
	}
}

// 版本适用性: 查询带版本, ref 呈现不同主版本 → 标注不剔除
func TestVersionSignalsFlagsDifferentMajor(t *testing.T) {
	vc := versionSignals("node 26 sqlite documentation", []Reference{
		{RefID: 1, URL: "https://nodejs.org/docs/v26.0/api/sqlite.html", Title: "Node.js 26 SQLite docs"},
		{RefID: 2, URL: "https://nodejs.org/docs/v18/api/sqlite.html", Title: "Node.js 18 SQLite docs"},
		{RefID: 3, URL: "https://nodejs.org/docs/latest/api/sqlite.html", Title: "Node.js latest SQLite"},
	})
	if vc == nil || vc.QueryVersion != "26" {
		t.Fatalf("query version detection wrong: %+v", vc)
	}
	if len(vc.Flagged) != 1 || vc.Flagged[0].RefID != 2 || vc.Flagged[0].RefVersion != "18" {
		t.Fatalf("only the v18 ref must be flagged, got %+v", vc.Flagged)
	}
	if vc.Flagged[0].Reason != "different_major_version" {
		t.Fatalf("reason wrong: %s", vc.Flagged[0].Reason)
	}
}

// 无版本查询 → 不做版本标注(nil)
func TestVersionSignalsNoQueryVersion(t *testing.T) {
	if vc := versionSignals("sqlite wal mode", []Reference{{RefID: 1, URL: "https://x/v3", Title: "v3 docs"}}); vc != nil {
		t.Fatal("no query version → nil check")
	}
}

// 来源构成: authority 层 SourceKind 计数(官方/社区/未知)
func TestSourceMixCounts(t *testing.T) {
	m := sourceMix([]Reference{
		{SourceKind: "official"}, {SourceKind: "official"}, {SourceKind: "community"}, {},
	})
	if m["official"] != 2 || m["community"] != 1 || m["unknown"] != 1 {
		t.Fatalf("source mix wrong: %+v", m)
	}
}
