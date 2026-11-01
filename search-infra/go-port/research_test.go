package main

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// citations/research/xchain 单测(对齐 TS citations.test/research.test 语义)

func TestAuditCitations(t *testing.T) {
	reg := CitationRegistry{1: {URL: "https://a", Title: "A"}, 2: {URL: "https://b", Title: "B"}}
	audit := auditCitations("事实一 [1] 事实二 [2] 事实三 [1] 幻觉 [99]", reg)
	if len(audit.Cited) != 3 || audit.Cited[0] != 1 || audit.Cited[2] != 99 {
		t.Fatalf("cited 去重升序(含幻觉 99): %v", audit.Cited)
	}
	if len(audit.Unknown) != 1 || audit.Unknown[0] != 99 {
		t.Fatalf("unknown: %v", audit.Unknown)
	}
	if audit.OK {
		t.Fatal("含幻觉引用应不 OK")
	}
	if len(audit.Unused) != 0 {
		t.Fatalf("unused: %v", audit.Unused)
	}
}

func TestEnforceCitationsStrictAndStrip(t *testing.T) {
	reg := CitationRegistry{1: {URL: "https://a", Title: "A"}}
	if _, _, err := enforceCitations("x [1] y [42]", reg, true); err == nil {
		t.Fatal("strict 应抛错")
	}
	stripped, audit, err := enforceCitations("x [1] y [42]", reg, false)
	if err != nil || !audit.OK {
		t.Fatalf("strip 应放行: %v %v", err, audit)
	}
	if stripped != "x [1] y " {
		t.Fatalf("strip 剔除未注册引用: %q", stripped)
	}
}

func TestRenderCitations(t *testing.T) {
	reg := CitationRegistry{2: {URL: "https://b", Title: "B"}, 1: {URL: "https://a", Title: "A"}}
	out := renderCitations(reg)
	lines := strings.Split(out, "\n")
	if !strings.HasPrefix(lines[0], "[1]") || !strings.Contains(lines[0], "https://a") {
		t.Fatalf("升序渲染: %q", lines[0])
	}
	if !strings.HasPrefix(lines[1], "[2]") {
		t.Fatalf("升序渲染: %q", lines[1])
	}
}

func TestSelectAnglesForcedAndSignals(t *testing.T) {
	// 强制角度永远保留
	a := selectAngles("docker 是什么")
	if a[0] != "定义与概念" {
		t.Fatalf("强制角度应在首位: %v", a)
	}
	if len(a) != 5 {
		t.Fatalf("默认选满 5 角度: %v", a)
	}
	// signals 命中优先: "对比" 信号 → 对比与替代入选
	b := selectAngles("k8s vs docker 哪个好")
	has := false
	for _, x := range b {
		if x == "对比与替代" {
			has = true
		}
	}
	if !has {
		t.Fatalf("信号角度应入选: %v", b)
	}
	// 自定义角度直传(不走池)
	if len(selectAngles("x")) != 5 {
		t.Fatal("池选应 5 个")
	}
}

func TestTierOf(t *testing.T) {
	cases := map[string]int{
		"arxiv.org": 1, "export.arxiv.org": 1, "www.nature.com": 1,
		"github.com": 2, "en.wikipedia.org": 2, "developer.mozilla.org": 2,
		"example.com": 3, "blog.csdn.net": 3,
	}
	for d, want := range cases {
		if got := tierOf(d); got != want {
			t.Errorf("tierOf(%q)=%d want %d", d, got, want)
		}
	}
}

func newTinyState() *ResearchState {
	s := newResearchState("test-run")
	s.Opts = researchBudgets{MaxLoops: 3, MinFacts: 4, ReferenceBudget: 5, FetchBudget: 3, FetchPerLoop: 2}
	s.Angles = []string{"定义与概念", "对比与替代"}
	s.Query = "test"
	return s
}

func TestAdmitRefBudgetAndStableId(t *testing.T) {
	s := newTinyState()
	for i := 0; i < 5; i++ {
		ok := s.admitRef(Reference{URL: "https://a/" + string(rune('a'+i)), Title: "x"})
		if !ok {
			t.Fatalf("第 %d 个应入池(预算 5)", i+1)
		}
	}
	if !s.admitRef(Reference{URL: "https://a/a", Title: "x"}) {
		t.Fatal("已存在 URL 应确认(不占新位)")
	}
	if s.admitRef(Reference{URL: "https://a/overflow", Title: "y"}) {
		t.Fatal("池满应拒绝")
	}
	if s.Stats.RefBudgetDropped != 1 {
		t.Fatalf("dropped 计数: %d", s.Stats.RefBudgetDropped)
	}
	ids := map[int]bool{}
	for _, r := range s.Pool {
		if r.RefID == 0 || ids[r.RefID] {
			t.Fatalf("refId 应稳定唯一: %+v", r)
		}
		ids[r.RefID] = true
	}
}

func TestReflectAndDecideConvergence(t *testing.T) {
	s := newTinyState()
	// 空 facts: Q1=0 Q2=0 → CONTINUE(未到 maxLoops)
	scores := reflectScores(s)
	if scores.Q1Facts != 0 || scores.Q2Coverage != 0 {
		t.Fatalf("空态分数: %+v", scores)
	}
	if d := decide(s, scores, 1); d != "CONTINUE" {
		t.Fatalf("空态应 CONTINUE: %s", d)
	}
	// 填满足量事实(2 角度各 2 条, 4 条 >= minFacts, 双域名)
	s.Facts = []Fact{
		{RefID: 1, Angle: "定义与概念", Domain: "a.com", Tier: 3},
		{RefID: 2, Angle: "定义与概念", Domain: "b.com", Tier: 3},
		{RefID: 3, Angle: "对比与替代", Domain: "a.com", Tier: 3},
		{RefID: 4, Angle: "对比与替代", Domain: "b.com", Tier: 3},
	}
	scores = reflectScores(s)
	if scores.Q1Facts != 1 || scores.Q2Coverage != 1 || scores.Q5MultiSrc != 1 || scores.Q6Usable != 1 {
		t.Fatalf("满态分数: %+v", scores)
	}
	// relaxed: Q1+Q2 过 → EXIT
	if d := decide(s, scores, 1); d != "EXIT" {
		t.Fatalf("relaxed 应 EXIT: %s", d)
	}
	// strict: Q3 权威不足 → 不 EXIT
	s.Strict = true
	if d := decide(s, scores, 1); d == "EXIT" {
		t.Fatal("strict 下 Q3=0 不应 EXIT")
	}
}

func TestDecideMaxLoopsAndBudget(t *testing.T) {
	s := newTinyState()
	scores := reflectScores(s) // 全 0
	if d := decide(s, scores, 3); d != "MAX_LOOPS_DEGRADED" {
		t.Fatalf("loop>=maxLoops 应降级: %s", d)
	}
	s2 := newTinyState()
	s2.Stats.FetchUsed = 3 // fetchBudget=3
	if d := decide(s2, scores, 1); d != "BUDGET_STOP" {
		t.Fatalf("预算尽应 BUDGET_STOP: %s", d)
	}
}

func TestStateApplyReplay(t *testing.T) {
	s := newResearchState("replay")
	s.Angles = []string{"定义与概念"}
	s.Opts = researchBudgets{3, 4, 10, 3, 2}
	s.apply(map[string]any{"event": "start", "query": "q", "angles": []any{"定义与概念"}, "strict": false, "opts": map[string]any{"maxLoops": float64(3), "minFacts": float64(4), "referenceBudget": float64(10), "fetchBudget": float64(3), "fetchPerLoop": float64(2)}})
	s.apply(map[string]any{"event": "loop_start", "loop": float64(1), "queries": []any{}})
	s.apply(map[string]any{"event": "angle_done", "loop": float64(1), "angle": "定义与概念", "query": "q", "found": float64(1), "refs": []any{map[string]any{"url": "https://a", "title": "A", "refId": float64(1)}}})
	s.apply(map[string]any{"event": "fetch_done", "loop": float64(1), "angle": "定义与概念", "ref": map[string]any{"url": "https://a", "title": "A", "refId": float64(1)}, "quote": "some long enough quote text here"})
	s.apply(map[string]any{"event": "reflect", "loop": float64(1), "scores": map[string]any{"q1Facts": 0.25}})
	s.apply(map[string]any{"event": "decide", "loop": float64(1), "decision": "CONTINUE"})
	if s.Query != "q" || len(s.Loops) != 1 || len(s.Facts) != 1 || s.Stats.FetchUsed != 1 {
		t.Fatalf("replay 状态: q=%s loops=%d facts=%d fetchUsed=%d", s.Query, len(s.Loops), len(s.Facts), s.Stats.FetchUsed)
	}
	if s.Loops[0].Reflect.Q1Facts != 0.25 || s.Loops[0].Decision != "CONTINUE" {
		t.Fatalf("replay reflect/decision: %+v", s.Loops[0])
	}
	if s.Facts[0].Tier != tierOf("a") { // hostOf("https://a")="a"
		t.Fatal("replay tier 计算")
	}
}

func TestBuildOutline(t *testing.T) {
	facts := []Fact{
		{Angle: "A", URL: "https://arxiv.org/1", Tier: 1},
		{Angle: "A", URL: "https://b.com/2", Tier: 3},
		{Angle: "A", URL: "https://b.com/3", Tier: 3},
		{Angle: "B", URL: "https://c.com/4", Tier: 3},
	}
	out := buildOutline([]string{"A", "B"}, facts)
	if out[0].Facts != 3 || out[0].Tier1Facts != 1 {
		t.Fatalf("outline 统计: %+v", out[0])
	}
	if len(out[0].Domains) != 2 || out[0].Domains[0] != "b.com" {
		t.Fatalf("主域降序: %v", out[0].Domains)
	}
	if out[1].Facts != 1 {
		t.Fatalf("outline B: %+v", out[1])
	}
}

func TestXDecodeEntities(t *testing.T) {
	cases := map[string]string{
		"a&amp;b":          "a&b",
		"&amp;quot;":       "&quot;", // 单次解码语义
		"&#39;":            "'",
		"a&#x27;b":         "a'b",
		"&#x4e2d;&#x6587;": "中文",
		"&nbsp;x":          " x",
	}
	for in, want := range cases {
		if got := xDecodeEntities(in); got != want {
			t.Errorf("xDecodeEntities(%q)=%q want %q", in, got, want)
		}
	}
}

func TestXChainMergeAndSort(t *testing.T) {
	// 合并去重 + 排序逻辑通过轻量链跑: keyless 层注入固定 refs, official/guest 层报错
	cfg := xChainConfig{GuestEnabled: false} // 无 bearer, guest 关
	client := &http.Client{Timeout: 1 * time.Second}
	xkv := newXKv(t.TempDir())
	health := NewHealthTracker(t.TempDir())
	keylessRefs := []Reference{
		{URL: "https://x.com/a/status/1", Title: "t1", Snippet: "s1", Engines: []string{"duckduckgo"}},
		{URL: "https://x.com/b/status/2", Title: "t2", Snippet: "s2", Engines: []string{"duckduckgo"}, Published: "Tue Jun 01 12:00:00 +0000 2024"},
		{URL: "https://x.com/a/status/1?utm_src=x", Title: "t1-dup", Snippet: "s1-longer snippet merged here", Engines: []string{"mojeek"}},
	}
	res := xSearchChain(cfg, client, xkv, health, "test q", func(sq string) []Reference {
		if !strings.Contains(sq, "site:x.com") {
			t.Fatalf("site query 形状: %s", sq)
		}
		return keylessRefs
	})
	// 大小写归一合并后应 2 条; 佐证多(2 引擎)在前
	if len(res.Refs) != 2 {
		t.Fatalf("合并后应 2 条: %d", len(res.Refs))
	}
	if len(res.Refs[0].Engines) != 2 {
		t.Fatalf("佐证多在前: %+v", res.Refs[0])
	}
	if res.Refs[0].Snippet != "s1-longer snippet merged here" {
		t.Fatalf("去重应保留较长 snippet: %q", res.Refs[0].Snippet)
	}
	for _, r := range res.Refs {
		if r.Kind != "x" || !strings.HasPrefix(r.Engines[0], "x-keyless:") {
			t.Fatalf("keyless 标记: %+v", r)
		}
	}
	if len(res.Used) != 1 || res.Used[0] != "x-keyless" {
		t.Fatalf("used: %v", res.Used)
	}
	// official 无 bearer 不参与, guest 关闭 → failed 无记录
	if len(res.Failed) != 0 {
		t.Fatalf("failed: %v", res.Failed)
	}
}
