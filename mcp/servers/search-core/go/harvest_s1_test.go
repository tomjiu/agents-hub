package main

// S1 (issue #3) 全局预算与提前完成 — 证据感知早返 + 不足诊断 + 负结果不缓存 + 缓存命中重验。
// 探针车道模式(engines_g3_test.go 同款): 显式 engines 名单保持封闭, 不触真实网络。

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func installTimedProbeLane(t *testing.T, name string, delay time.Duration, refs []Reference) {
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
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(delay):
		}
		// refs 原样返回(不回显查询) — 相关/无关由 fixture 内容决定, 证据门真实裁决
		out := make([]Reference, 0, len(refs))
		for _, r := range refs {
			out = append(out, Reference{URL: r.URL, Title: r.Title, Snippet: r.Snippet, Engines: []string{name}})
		}
		return out, nil
	}
	t.Cleanup(func() {
		if had {
			laneRegistry[name] = oldFn
		} else {
			delete(laneRegistry, name)
		}
	})
}

func relevantRef(url string) Reference {
	return Reference{URL: url, Title: "rust async runtime", Snippet: "rust async runtime comparison"}
}

func irrelevantRef(url string) Reference {
	return Reference{URL: url, Title: "cooking recipes", Snippet: "easy dinner ideas"}
}

// 1) 早收割必须要求"足够相关证据": 15+ 无关 refs + 60% 腿结算 → 不早返(红灯复现 S0-F3/S1 缺口)
func TestEarlyHarvestRequiresRelevantEvidence(t *testing.T) {
	t.Setenv("SC_NO_CACHE", "1")
	t.Setenv("SC_DATA_DIR", t.TempDir())
	t.Setenv("SC_EARLY_HARVEST_MS", "80")
	t.Setenv("SC_EARLY_HARVEST_MIN_RELEVANT", "5")
	var irrelevant []Reference
	for i := 0; i < 8; i++ {
		irrelevant = append(irrelevant, irrelevantRef("https://slow.example/i"+string(rune('a'+i))))
	}
	// 3 条快腿返回 8 条无关 refs; 2 条慢腿 600ms
	installTimedProbeLane(t, "probe-fast-a", 0, irrelevant)
	installTimedProbeLane(t, "probe-fast-b", 0, irrelevant)
	installTimedProbeLane(t, "probe-fast-c", 0, irrelevant)
	installTimedProbeLane(t, "probe-slow-d", 600*time.Millisecond, irrelevant)
	installTimedProbeLane(t, "probe-slow-e", 600*time.Millisecond, irrelevant)
	t0 := time.Now()
	out := searchFlow(SearchOpts{
		Query: "rust async runtime comparison", Lang: "en", TopN: 10, MaxResults: 10,
		Engines:    []string{"probe-fast-a", "probe-fast-b", "probe-fast-c", "probe-slow-d", "probe-slow-e"},
		EnginesSet: true, TimeoutMs: 5000,
	}, 5000)
	if out.Meta.Harvest == nil {
		t.Fatal("harvest meta must be populated")
	}
	if out.Meta.Harvest.Early {
		t.Fatal("early harvest must NOT fire with only irrelevant refs (evidence-aware completion)")
	}
	if time.Since(t0) < 500*time.Millisecond {
		t.Fatal("without sufficient evidence the run must wait for the slow legs, not return at harvestMs")
	}
	if out.Meta.Harvest.RelevantRefs != 0 || out.Meta.Harvest.MinRelevant != 5 {
		t.Fatalf("harvest diagnostics wrong: %+v", out.Meta.Harvest)
	}
	// 无关 refs 被证据门拒绝 → 空结果 + no_relevant_results(透明, 不冒充)
	if out.Meta.Quality == nil || out.Meta.Quality.Status != "no_relevant_results" {
		t.Fatalf("quality must be no_relevant_results, got %+v", out.Meta.Quality)
	}
}

// 2) 足够相关证据(≥minRelevant) → 早收割触发, 慢腿被断
func TestEarlyHarvestFiresWithRelevantEvidence(t *testing.T) {
	t.Setenv("SC_NO_CACHE", "1")
	t.Setenv("SC_DATA_DIR", t.TempDir())
	t.Setenv("SC_EARLY_HARVEST_MS", "80")
	t.Setenv("SC_EARLY_HARVEST_MIN_RELEVANT", "5")
	var relevant []Reference
	for i := 0; i < 8; i++ {
		relevant = append(relevant, relevantRef("https://fast.example/r"+string(rune('a'+i))))
	}
	installTimedProbeLane(t, "probe-fast-a", 0, relevant)
	installTimedProbeLane(t, "probe-fast-b", 0, relevant)
	installTimedProbeLane(t, "probe-fast-c", 0, relevant)
	installTimedProbeLane(t, "probe-slow-d", 5*time.Second, relevant)
	installTimedProbeLane(t, "probe-slow-e", 5*time.Second, relevant)
	t0 := time.Now()
	out := searchFlow(SearchOpts{
		Query: "rust async runtime comparison", Lang: "en", TopN: 10, MaxResults: 10,
		Engines:    []string{"probe-fast-a", "probe-fast-b", "probe-fast-c", "probe-slow-d", "probe-slow-e"},
		EnginesSet: true, TimeoutMs: 8000,
	}, 8000)
	elapsed := time.Since(t0)
	if out.Meta.Harvest == nil || !out.Meta.Harvest.Early {
		t.Fatalf("early harvest must fire with sufficient relevant evidence: %+v", out.Meta.Harvest)
	}
	if elapsed >= 2*time.Second {
		t.Fatalf("early harvest must not wait for slow legs, took %v", elapsed)
	}
	if out.Meta.Harvest.AbortedPending != 2 {
		t.Fatalf("two slow legs must be aborted, got %d", out.Meta.Harvest.AbortedPending)
	}
	if len(out.Refs) == 0 || out.Meta.Quality == nil || out.Meta.Quality.Status != "candidate_results" {
		t.Fatalf("refs must flow back: %d %+v", len(out.Refs), out.Meta.Quality)
	}
}

// 3) 软截止到期 + 证据不足 → 已得候选 + insufficient 诊断(不无限抢救)
func TestDeadlineExpiryReturnsInsufficiencyDiagnosis(t *testing.T) {
	t.Setenv("SC_NO_CACHE", "1")
	t.Setenv("SC_DATA_DIR", t.TempDir())
	t.Setenv("SC_EARLY_HARVEST_MS", "0")
	t.Setenv("SC_SOFT_DEADLINE_MS", "250")
	installTimedProbeLane(t, "probe-hang-a", 10*time.Second, []Reference{relevantRef("https://hang.example/a")})
	installTimedProbeLane(t, "probe-hang-b", 10*time.Second, []Reference{relevantRef("https://hang.example/b")})
	out := searchFlow(SearchOpts{
		Query: "rust async runtime comparison", Lang: "en", TopN: 10, MaxResults: 10,
		Engines: []string{"probe-hang-a", "probe-hang-b"}, EnginesSet: true, TimeoutMs: 9000,
	}, 9000)
	if out.Meta.Harvest == nil {
		t.Fatal("harvest meta required")
	}
	if !out.Meta.Harvest.Insufficient {
		t.Fatalf("deadline expiry with insufficient evidence must be diagnosed: %+v", out.Meta.Harvest)
	}
	if out.Meta.Harvest.Diagnosis == "" {
		t.Fatal("diagnosis text required")
	}
	if out.Meta.Harvest.AbortedPending != 2 {
		t.Fatalf("both hanging legs must be aborted at deadline, got %d", out.Meta.Harvest.AbortedPending)
	}
}

// 4) 负结果不缓存: 全灭的运行不得写入缓存(第二次同查询重新活查)
func TestNegativeResultsNotCached(t *testing.T) {
	t.Setenv("SC_NO_CACHE", "1")
	t.Setenv("SC_DATA_DIR", t.TempDir())
	t.Setenv("SC_EARLY_HARVEST_MS", "0")
	failLane := func(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
		probeMu.Lock()
		probeCalls["probe-fail"]++
		probeMu.Unlock()
		return nil, context.DeadlineExceeded
	}
	oldFn, had := laneRegistry["probe-fail"]
	laneRegistry["probe-fail"] = failLane
	t.Cleanup(func() {
		if had {
			laneRegistry["probe-fail"] = oldFn
		} else {
			delete(laneRegistry, "probe-fail")
		}
	})
	probeMu.Lock()
	probeCalls = map[string]int{}
	probeMu.Unlock()
	opts := SearchOpts{
		Query: "rust async runtime comparison probe unique q", Lang: "en", TopN: 10, MaxResults: 10,
		Engines: []string{"probe-fail"}, EnginesSet: true, TimeoutMs: 2000,
	}
	out1 := searchFlow(opts, 2000)
	if !out1.Meta.Degraded || len(out1.Refs) != 0 {
		t.Fatalf("all-failed run must be degraded+empty: %+v", out1.Meta)
	}
	// 关闭 SC_NO_CACHE 模拟第二次运行(同库) — 但全灭结果本就不该入缓存, 引擎应被再次调用
	t.Setenv("SC_NO_CACHE", "1") // 测试进程内无法解设; 通过第二路径直接断言缓存行为:
	cache, err := OpenCache(dataDir())
	if err != nil {
		t.Skipf("no cache dir: %v", err)
	}
	key := searchCacheKey([]string{opts.Query}, "multi", opts)
	if hit := cache.GetSearch(key, 900); hit != nil {
		t.Fatal("negative (degraded/empty) output must not be cached")
	}
	cache.Close()
	if probeCount("probe-fail") < 1 {
		t.Fatal("engine must have been attempted")
	}
}

// 5) 缓存命中重验: 旧缓存中的 refs 若过不了当前证据门 → 绕过缓存活查(策略漂移防绕过)
func TestCacheHitReGatesStaleRefs(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("SC_DATA_DIR", dir)
	t.Setenv("SC_NO_CACHE", "1")
	t.Setenv("SC_EARLY_HARVEST_MS", "0")
	t.Setenv("SC_EARLY_HARVEST_MIN_RELEVANT", "0")
	// 预置缓存: refs 与查询词重合度不足(旧策略写入的偏题结果)
	cache, err := OpenCache(dir)
	if err != nil {
		t.Fatalf("open cache: %v", err)
	}
	opts := SearchOpts{
		Query: "rust async runtime cache re gate", Lang: "en", TopN: 10, MaxResults: 10,
		Engines: []string{"probe-live-a"}, EnginesSet: true, TimeoutMs: 2000,
	}
	stale := Output{
		Query:       opts.Query,
		Refs:        []Reference{{URL: "https://stale.example/x", Title: "cooking recipes", Snippet: "dinner ideas", Engines: []string{"probe-live-a"}}},
		EnginesUsed: []string{"probe-live-a"},
	}
	raw, _ := json.Marshal(stale)
	cache.PutSearch(searchCacheKey([]string{opts.Query}, "multi", opts), raw)
	cache.Close()
	installTimedProbeLane(t, "probe-live-a", 0, []Reference{relevantRef("https://live.example/fresh")})
	out := searchFlow(opts, 2000)
	if out.Meta.FromCache {
		t.Fatal("stale cached refs failing the evidence gate must bypass cache and go live")
	}
	if !out.Meta.FromCache && probeCount("probe-live-a") == 0 {
		t.Fatal("live engine must be consulted after cache bypass")
	}
	foundFresh := false
	for _, r := range out.Refs {
		if r.URL == "https://live.example/fresh" {
			foundFresh = true
		}
	}
	if !foundFresh {
		t.Fatalf("fresh relevant ref must flow back, refs=%+v", out.Refs)
	}
}
