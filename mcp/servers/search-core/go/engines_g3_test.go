package main

// G3 (issue #3 评论, S2 修复迁入): engines 名单契约 —
// 1) 显式空名单 = 零请求 (不触网, 不触发任何腿, 如实空结果);
// 2) 用户名单约束所有路由 (domain/github 专项腿与恢复腿不再绕过 — S0-F1 的 Go 侧修复);
// 3) 名单全排除专项腿时用户名单优先, 不静默丢腿。

import (
	"context"
	"net/http"
	"net/url"
	"sync"
	"testing"
)

// probeLane: 记录调用的探针车道
var probeMu sync.Mutex
var probeCalls map[string]int

func installProbeLane(t *testing.T, name string) {
	t.Helper()
	probeMu.Lock()
	if probeCalls == nil {
		probeCalls = map[string]int{}
	}
	probeMu.Unlock()
	oldFn, had := laneRegistry[name]
	laneRegistry[name] = func(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
		probeMu.Lock()
		probeCalls[name]++
		probeMu.Unlock()
		return []Reference{{URL: "https://probe.example/" + name, Title: name, Snippet: "s", Engines: []string{name}}}, nil
	}
	t.Cleanup(func() {
		if had {
			laneRegistry[name] = oldFn
		} else {
			delete(laneRegistry, name)
		}
	})
}

func probeCount(name string) int {
	probeMu.Lock()
	defer probeMu.Unlock()
	return probeCalls[name]
}

// 1) 显式空名单 → 零请求
func TestEnginesEmptyListZeroRequests(t *testing.T) {
	t.Setenv("SC_NO_CACHE", "1")
	t.Setenv("SC_DATA_DIR", t.TempDir())
	for _, n := range []string{"duckduckgo", "mojeek", "wikipedia", "keenable", "bingrss"} {
		installProbeLane(t, n)
	}
	out := searchFlow(SearchOpts{
		Query: "rust async runtime comparison", Lang: "en", TopN: 10, MaxResults: 10,
		Engines: []string{}, EnginesSet: true, TimeoutMs: 2000,
	}, 2000)
	if len(out.Refs) != 0 {
		t.Fatalf("empty engines list must yield zero refs, got %d", len(out.Refs))
	}
	for _, n := range []string{"duckduckgo", "mojeek", "wikipedia", "keenable", "bingrss"} {
		if c := probeCount(n); c != 0 {
			t.Fatalf("engine %s must not be called (%d calls) — zero-request contract broken", n, c)
		}
	}
}

// 未提供 engines 键 (EnginesSet=false, nil) → 默认路由照常 (不误伤默认行为)。
// 用 entities 域路由 ("capital of france" → wikidata+keenable+duckduckgo),
// 全部腿探针化保持封闭 (不触真实网络)。
func TestEnginesAbsentRunsDefaultRoute(t *testing.T) {
	t.Setenv("SC_NO_CACHE", "1")
	t.Setenv("SC_DATA_DIR", t.TempDir())
	t.Setenv("SC_EARLY_HARVEST_MS", "0")
	decision := plan("what is the capital of france")
	if decision.route != "domain" || decision.domainPlan == nil {
		t.Skipf("planner route=%s", decision.route)
	}
	for _, n := range []string{"wikidata", "keenable", "duckduckgo"} {
		installProbeLane(t, n)
	}
	out := searchFlow(SearchOpts{
		Query: "what is the capital of france", Lang: "en", TopN: 5, MaxResults: 5,
		TimeoutMs: 3000,
	}, 3000)
	if probeCount("wikidata") == 0 {
		t.Fatal("default route (no engines key) must still run its lanes")
	}
	if len(out.Refs) == 0 {
		t.Fatal("probe lane result must flow back")
	}
}

// 2) 用户名单约束 github 路由 (S0-F1: 修复前 github 腿绕过名单)
func TestEnginesAllowlistConstrainsGithubRoute(t *testing.T) {
	t.Setenv("SC_NO_CACHE", "1")
	t.Setenv("SC_DATA_DIR", t.TempDir())
	// github 路由查询 (planner 对 github.com 域查询路由 github)
	query := "github.com/golang/go issue search"
	decision := plan(query)
	if decision.route != "github" {
		t.Skipf("planner route=%s (not github) — 需用真实 github 路由查询", decision.route)
	}
	for _, n := range []string{"github", "duckduckgo", "mojeek", "wikipedia"} {
		installProbeLane(t, n)
	}
	searchFlow(SearchOpts{
		Query: query, Lang: "en", TopN: 10, MaxResults: 10,
		Engines: []string{"wikipedia"}, EnginesSet: true, TimeoutMs: 3000,
	}, 3000)
	for _, banned := range []string{"github", "duckduckgo", "mojeek"} {
		if c := probeCount(banned); c != 0 {
			t.Fatalf("route engines %s must be constrained by user allowlist (%d calls) — S0-F1 regression", banned, c)
		}
	}
	if probeCount("wikipedia") == 0 {
		t.Fatal("allowlisted engine must run as user-list fallback")
	}
}

// 3) 名单保留子集: github 路由但名单含 duckduckgo → 只跑 duckduckgo
func TestEnginesAllowlistPartialSubset(t *testing.T) {
	t.Setenv("SC_NO_CACHE", "1")
	t.Setenv("SC_DATA_DIR", t.TempDir())
	query := "github.com/golang/go issue search"
	decision := plan(query)
	if decision.route != "github" {
		t.Skipf("planner route=%s", decision.route)
	}
	for _, n := range []string{"github", "duckduckgo", "mojeek"} {
		installProbeLane(t, n)
	}
	out := searchFlow(SearchOpts{
		Query: query, Lang: "en", TopN: 10, MaxResults: 10,
		Engines: []string{"duckduckgo"}, EnginesSet: true, TimeoutMs: 3000,
	}, 3000)
	if c := probeCount("duckduckgo"); c == 0 {
		t.Fatal("allowlisted duckduckgo must run")
	}
	for _, banned := range []string{"github", "mojeek"} {
		if c := probeCount(banned); c != 0 {
			t.Fatalf("%s must be excluded by allowlist (%d calls)", banned, c)
		}
	}
	if len(out.Refs) == 0 {
		t.Fatal("probe results must flow back")
	}
	_ = url.Values{}
}
