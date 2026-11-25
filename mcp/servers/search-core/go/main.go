package main

// CLI 入口(P4): search-core-go <command>
//   search "query" [--lang zh] [--topn 20] [--engines a,b] [--timeout 6000] [--freshness month]
//   fetch URL [--focus "..."] [--max-chars 8000] [--adjacent 1]
//   providers / stats / serve(MCP stdio) / serve-http [--port 8787]
// JSON 输出形状与 TS `search --json` 可对照; allSettled 语义 + fusion v3 计分。
// 引擎流(P3-b): plan → 路由分腿 → 并行 → fuseSemantic; P4 接线 journal + health 熔断。

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// parseFlags 对齐 TS cli.ts parseFlags: flag 可后置, 位置参数不终止解析
func parseFlags(argv []string) ([]string, map[string]string) {
	var positional []string
	flags := map[string]string{}
	for i := 0; i < len(argv); i++ {
		a := argv[i]
		if strings.HasPrefix(a, "--") {
			key := strings.TrimPrefix(a, "--")
			next := ""
			if i+1 < len(argv) && !strings.HasPrefix(argv[i+1], "--") {
				next = argv[i+1]
				i++
				flags[key] = next
			} else {
				flags[key] = "true"
			}
			continue
		}
		positional = append(positional, a)
	}
	return positional, flags
}

func dataDir() string {
	if v := os.Getenv("SC_DATA_DIR"); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".search-core")
}

// searchFlow 引擎流(P3-b 逻辑原样抽出, P4 接 journal+health): plan → 路由分腿 → 并行 → 融合
// searchFlowCtx: 带父 ctx 的搜索 (调用方取消/超时传递; G3 MCP cancel 线)
func searchFlowCtx(parent context.Context, opts SearchOpts, timeoutMs int) Output {
	out := searchFlowInner(parent, opts, timeoutMs)
	return out
}

func searchFlow(opts SearchOpts, timeoutMs int) Output {
	return searchFlowInner(context.Background(), opts, timeoutMs)
}

func searchFlowInner(parent context.Context, opts SearchOpts, timeoutMs int) Output {
	journal := NewJournal(dataDir(), os.Getenv("SC_JOURNAL") != "0")
	health := NewHealthTracker(dataDir())
	defer journal.Write("run_end", map[string]any{})

	decision := plan(opts.Query)
	if opts.Lang == "" {
		opts.Lang = decision.lang // planner 自动 zh 路由(显式 --lang 优先)
	}
	journal.Write("planner", map[string]any{
		"route": decision.route, "complexity": decision.complexity,
		"queries": decision.queries, "topic": decision.domainPlan,
	})
	// b13 收尾取证(travel 20s 归因改判): 上游黑洞(DDG 对本出口 IP 挂连接不回包)拖满软超时,
	// 整体 Timeout 只兜底不快败 → Transport 级三层快超时: dial 5s/TLS 5s/响应头 10s,
	// 黑洞型上游 5-10s 快败交熔断, 正常慢腿(响应头后大 body)不受影响; zenodo/hfpapers 8s ctx 截止仍先触发。
	client := &http.Client{
		Timeout: time.Duration(timeoutMs) * time.Millisecond,
		Transport: &http.Transport{
			DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
		},
	}
	t0 := time.Now()

	// v0.5 搜索结果缓存(key = sha24(queries+route+opts 形状, TS JSON.stringify 逐字段对齐)
	cacheable := decision.complexity == "simple" && os.Getenv("SC_NO_CACHE") != "1"
	var cache *Cache
	var cacheKey string
	if cacheable {
		cache, _ = OpenCache(dataDir())
	}
	if cache != nil {
		cacheKey = searchCacheKey(decision.queries, decision.route, opts)
		if hit := cache.GetSearch(cacheKey, 900); hit != nil {
			var out Output
			if json.Unmarshal(hit, &out) == nil && out.Query != "" {
				// S3 (issue #3): 缓存命中重跑证据门 — 旧记录/策略漂移不得绕过
				// (TS engine.ts 命中证据检查对齐; 有拒绝 → 当未命中, 走活查)。
				reGated, reQuality, reKept := applyEvidenceGate(opts.Query, []laneResult{{Name: "cache", Refs: out.Refs}})
				if reQuality.Rejected == 0 && (reQuality.Evaluated == 0 || reKept > 0 || len(out.Refs) == 0) {
					out.Refs = refsOf(reGated)
					if reQuality.Evaluated > 0 {
						qm := reQuality
						out.Meta.Quality = &qm
					}
					out.Meta.FromCache = true
					out.ElapsedMs = time.Since(t0).Milliseconds()
					cache.KvIncr("stat:search_cache_hit", 1)
					cache.Close()
					return out
				}
				journal.Write("cache_bypass_evidence", map[string]any{"rejected": reQuality.Rejected})
			}
		}
		cache.KvIncr("stat:search_total", 1)
	}

	// 腿编排: domainPlan → leg0=laneLegProviders + site 腿; github 路由 → 三腿; 否则调用方 engines/全池
	// G3 (S0-F1 修复迁入): 用户 engines 名单约束所有路由 (含 domain/github
	// 专项腿与恢复腿), 不再绕过; 显式空名单 = 零请求 (不发任何外联请求)。
	if opts.EnginesSet && len(opts.Engines) == 0 {
		// 零请求契约: 如实返回空结果 + 说明, 不触发任何腿
		journal.Write("engines_empty_zero_request", map[string]any{"route": decision.route})
		out := Output{Query: opts.Query, Refs: []Reference{}, EnginesUsed: []string{}, EnginesFailed: []string{}}
		out.Meta.FromCache = false
		out.ElapsedMs = time.Since(t0).Milliseconds()
		return out
	}
	var legSets []legSet
	if decision.route == "domain" && decision.domainPlan != nil {
		dp := decision.domainPlan
		leg0 := laneLegProviders(dp.topic, opts.Query, dp.apiProviders)
		leg0 = constrainEngines(leg0, opts)
		for i, sq := range dp.siteQueries {
			eng := dp.siteEngines[i%len(dp.siteEngines)] // 少于 siteTargets 时循环复用
			if opts.EnginesSet && !engineAllowed(eng, opts.Engines) {
				continue
			}
			legSets = append(legSets, legSet{query: sq, engines: []string{eng}})
		}
		// 专项腿全部被名单排除 → 用户名单优先 (不静默丢腿):
		// 回退为用户名单与原始查询的通用腿
		if len(leg0) > 0 {
			legSets = append([]legSet{{query: decision.queries[0], engines: leg0}}, legSets...)
		} else if opts.EnginesSet && len(legSets) == 0 && len(opts.Engines) > 0 {
			legSets = append(legSets, legSet{query: opts.Query, engines: opts.Engines})
		}
	} else if decision.route == "github" {
		gh := constrainEngines([]string{"github", "duckduckgo", "mojeek"}, opts)
		if len(gh) > 0 {
			legSets = append(legSets, legSet{query: opts.Query, engines: gh})
		} else if opts.EnginesSet && len(opts.Engines) > 0 {
			legSets = append(legSets, legSet{query: opts.Query, engines: opts.Engines})
		}
	} else {
		engines := opts.Engines
		if len(engines) == 0 {
			for name := range laneRegistry {
				// 熔断冷却期跳过(TS router skipped=circuit_open 语义)
				if health.IsOpen(name) {
					continue
				}
				// b14 收尾: searxng 默认摘出 web 全池 — 两公共实例 SEO 污染实锤
				// (77 题 732 refs 仅贡献 4 条且全垃圾: "高血压"→"高"字词条/高德地图);
				// lane 注册保留(lanes=90 门禁), SC_ENABLE_SEARXNG=1 可开回试健康。
				// 2026-11-25 W2: SC_SEARXNG_URL 自部署实例(SearXNG/RustXNG, 均说 SearXNG 形状
				// /search?format=json)时重新入池 — 自部署实例是用户自己的鱼塘, 不在公共污染池证据范围
				if name == "searxng" && os.Getenv("SC_ENABLE_SEARXNG") == "" && strings.TrimSpace(os.Getenv("SC_SEARXNG_URL")) == "" {
					journal.Write("engine_skip_searxng_pooled", map[string]any{"reason": "seo-poisoned public instances"})
					continue
				}
				// 2026-11-25 W4: keyed Google lane(serper/serpapi) 无 Key 不入默认池 —
				// 不产生失败腿/不外联; 显式 --engines 点名时 lane 内部透明报错; 有 Key 即入池
				if envVar, ok := keyedLaneEnv[name]; ok && strings.TrimSpace(os.Getenv(envVar)) == "" {
					journal.Write("engine_skip_key_required", map[string]any{"engine": name, "keyEnv": envVar})
					continue
				}
				engines = append(engines, name)
			}
		} else {
			var alive []string
			for _, e := range engines {
				if health.IsOpen(e) {
					journal.Write("engine_skip_circuit_open", map[string]any{"engine": e})
					continue
				}
				alive = append(alive, e)
			}
			engines = alive
		}
		legSets = append(legSets, legSet{query: opts.Query, engines: engines})
	}

	// 并行执行所有腿 + 早收割轮询(TS router.ts v0.4/AG-2 语义逐条对齐):
	// 到 earlyHarvestMs(默认 1200)后, 若(结算腿 >= ceil(60% × 总腿) 且 refs>=15)则立即断慢腿交付;
	// 条件不满足继续等(边缘对齐轮询), 软截止(默认 6000)仍是无条件上限兜底。0=关。
	// 被断慢腿以 timeout 身份进 failed(TS 失败标注契约), journal 记 soft_deadline 事件。
	harvestMs := 1200
	if v := os.Getenv("SC_EARLY_HARVEST_MS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			harvestMs = n
		}
	}
	softMs := timeoutMs
	if v := os.Getenv("SC_SOFT_DEADLINE_MS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			softMs = n
		}
	}
	type legSlot struct {
		settled bool
		results []laneResult
	}
	attempted := 0
	for _, ls := range legSets {
		attempted += len(ls.engines)
	}
	slots := make([]legSlot, attempted)
	var mu sync.Mutex
	// G1-6: run 级 ctx — 收割退出时取消所有在飞腿(超时后网络/任务不存活);
	// 结算走事件通知 (settleCh), 不再 25ms 轮询。
	runCtx, runCancel := context.WithCancel(parent)
	defer runCancel()
	settleCh := make(chan struct{}, attempted)
	idx := 0
	for _, ls := range legSets {
		for _, e := range ls.engines {
			go func(i int, q, e string) {
				lo := opts
				lo.Query = q
				lo.Engines = []string{e}
				lt0 := time.Now()
				rs := runLanesCtx(runCtx, lo, client)
				dt := time.Since(lt0).Milliseconds()
				mu.Lock()
				slots[i].settled = true
				slots[i].results = rs
				mu.Unlock()
				settleCh <- struct{}{}
				for _, lr := range rs {
					if lr.Err != nil {
						msg := lr.Err.Error()
						status, _ := classifyFailure(msg)
						health.Record(lr.Name, false, dt, msg, status)
						journal.Write("engine_error", map[string]any{"engine": lr.Name, "error": msg, "elapsedMs": dt, "status": status})
					} else {
						health.Record(lr.Name, true, dt, "", "")
						journal.Write("engine_result", map[string]any{"engine": lr.Name, "count": len(lr.Refs), "elapsedMs": dt})
					}
				}
			}(idx, ls.query, e)
			idx++
		}
	}
	// 收割循环(G1-6: 事件驱动 — 结算即醒, 边缘(earlyHarvest/软截止)走定时器;
	// 语义与 TS 25ms 轮询逐条对齐: 60% 腿 + refs>=15 早收割, 软截止无条件兜底)
	ht0 := time.Now()
	minRefs := 15
	// S1 (issue #3): 早收割从"纯计数"改为"足够相关证据"——
	// 少量词命中/词重合但无关的 refs 不再自动认为任务完成(不无限抢救, 软截止仍兜底)。
	// SC_EARLY_HARVEST_MIN_RELEVANT=0 回退旧纯计数语义。
	minRelevant := 5
	if v := os.Getenv("SC_EARLY_HARVEST_MIN_RELEVANT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			minRelevant = n
		}
	}
	degradedEarly := false
	settledCount := 0
	snapshot := func() (pending, totalRefs, relevantRefs int) {
		mu.Lock()
		defer mu.Unlock()
		for i := 0; i < attempted; i++ {
			if !slots[i].settled {
				pending++
			}
			for _, lr := range slots[i].results {
				totalRefs += len(lr.Refs)
				for _, r := range lr.Refs {
					if minRelevant == 0 {
						break // 旧语义: 不做相关性评估
					}
					if relevanceEvidence(opts.Query, r).Accepted {
						relevantRefs++
					}
				}
			}
		}
		return pending, totalRefs, relevantRefs
	}
	for settledCount < attempted {
		pending, totalRefs, relevantRefs := snapshot()
		if pending <= 0 {
			break // 全部结算, 正常出
		}
		elapsed := time.Since(ht0).Milliseconds()
		// S1 修复: earlyHarvest 边缘必须始终排程(min(harvestMs, softMs)),
		// 语义对齐 TS 25ms 轮询 — 足够与否在边缘重估, 而不是在这里短路。
		// 旧代码在 enough 变真后把 nextEdge 推到软截止, 导致早收割永不触发(红灯:
		// TestEarlyHarvestFiresWithRelevantEvidence 全腿等到 5s 才结算)。
		nextEdge := int64(softMs)
		if harvestMs > 0 {
			nextEdge = int64(math.Min(float64(harvestMs), float64(softMs)))
		}
		waitMs := nextEdge - elapsed
		if waitMs < 1 {
			waitMs = 1
		}
		select {
		case <-settleCh:
			settledCount++
			continue
		case <-time.After(time.Duration(waitMs) * time.Millisecond):
		}
		// 边缘到点: 重估收割条件
		pending, totalRefs, relevantRefs = snapshot()
		if pending <= 0 {
			break // 全部结算, 正常出
		}
		elapsed = time.Since(ht0).Milliseconds()
		enough := (attempted-pending) >= int(math.Ceil(float64(attempted)*0.6)) && totalRefs >= minRefs &&
			(minRelevant == 0 || relevantRefs >= minRelevant)
		if harvestMs > 0 && elapsed >= int64(harvestMs) && enough {
			degradedEarly = true
			break // 早收割
		}
		if elapsed >= int64(softMs) {
			break // 软截止兜底(v0.4 语义)
		}
	}
	// G1-6: 收割退出 — 断掉所有未结算腿的在飞请求 (不留后台网络任务)
	runCancel()
	// 聚合快照: 只采纳收割时刻已结算的腿; 未结算的以 timeout 身份进 failed(TS 契约)
	var lanes []laneResult
	var failedTimeout []string
	mu.Lock()
	for i := 0; i < attempted; i++ {
		if slots[i].settled {
			lanes = append(lanes, slots[i].results...)
		} else {
			failedTimeout = append(failedTimeout, legNameAt(legSets, i))
		}
	}
	mu.Unlock()
	// S1 (issue #3): 收割诊断 — 早返是否触发、软截止到期时证据是否不足。
	// 质量不够但 deadline 到期 → 已得候选 + insufficient 诊断, 不无限抢救。
	harvestTotalRefs, harvestRelevantRefs := 0, 0
	for _, lr := range lanes {
		harvestTotalRefs += len(lr.Refs)
		if minRelevant == 0 {
			continue
		}
		for _, r := range lr.Refs {
			if relevanceEvidence(opts.Query, r).Accepted {
				harvestRelevantRefs++
			}
		}
	}
	harvestMeta := &HarvestMeta{
		SettledLegs: attempted - len(failedTimeout), TotalLegs: attempted,
		AbortedPending: len(failedTimeout), RelevantRefs: harvestRelevantRefs,
		MinRelevant: minRelevant, TotalRefs: harvestTotalRefs, SoftDeadlineMs: softMs,
	}
	if degradedEarly {
		harvestMeta.Early = true
	}
	if len(failedTimeout) > 0 && minRelevant > 0 && harvestRelevantRefs < minRelevant {
		harvestMeta.Insufficient = true
		harvestMeta.Diagnosis = fmt.Sprintf(
			"deadline %dms reached with insufficient relevant evidence: %d/%d relevant refs (min %d), %d/%d legs settled, %d aborted; returning obtained candidates instead of rescuing indefinitely",
			softMs, harvestRelevantRefs, harvestTotalRefs, minRelevant, attempted-len(failedTimeout), attempted, len(failedTimeout))
	}
	if len(failedTimeout) > 0 {
		journal.Write("soft_deadline", map[string]any{
			"aborted": len(failedTimeout), "softMs": softMs, "earlyHarvest": degradedEarly,
		})
	}
	// 被断慢腿以 timeout 身份进 failed(TS 失败标注契约: 不能无声消失)
	failedTimedOut := failedTimeout
	if len(failedTimedOut) > 0 {
		for _, name := range failedTimedOut {
			health.Record(name, false, int64(softMs), fmt.Sprintf("soft deadline: aborted after %dms", softMs), "timeout")
		}
	}
	if os.Getenv("SC_DEBUG") == "1" {
		nRefs := 0
		for _, lr := range lanes {
			nRefs += len(lr.Refs)
			if lr.Err != nil {
				fmt.Fprintf(os.Stderr, "[lane %s] %v\n", lr.Name, lr.Err)
			}
		}
		fmt.Fprintf(os.Stderr, "[debug] laneResults=%d totalRefs=%d route=%s\n", len(lanes), nRefs, decision.route)
	}
	// S3 (issue #3): 词法证据门 — 融合前过滤词重合但无关结果 (S0-F2, TS lexical-evidence 对齐+加强)。
	// 诚实边界: 保守词法证据下限, 不是语义相关性或事实核验; 被拒条目计入 quality meta 透明返回。
	gatedLanes, qualityMeta, relevantKept := applyEvidenceGate(opts.Query, lanes)
	if qualityMeta.Evaluated > 0 {
		qualityMeta.VersionCheck = versionSignals(opts.Query, refsOf(gatedLanes))
		qualityMeta.SourceMix = sourceMix(refsOf(gatedLanes))
	}
	journal.Write("quality_gate", map[string]any{
		"policy": qualityMeta.Policy, "evaluated": qualityMeta.Evaluated,
		"rejected": qualityMeta.Rejected, "relevant": relevantKept, "reasons": qualityMeta.Reasons,
	})
	if scak := os.Getenv("SC_AUTHORITY_JSON"); scak != "" {
		mergeExternalAuthority(scak)
	}
	// 融合: topic 由 domainPlan 注入; domainCap= packages/devops→0(域名纯度是特性) / 有 domainPlan→3 / 默认 3
	topic := ""
	domainCap := 3
	if decision.domainPlan != nil {
		topic = decision.domainPlan.topic
		if topic == "packages" || topic == "devops" {
			domainCap = 0
		}
	}
	// S3 (issue #3): domain cap 可调 — SC_DOMAIN_CAP 覆盖默认(0=关),
	// 来源多样性/单一权威域名上限由调用方显式控制。
	if v := os.Getenv("SC_DOMAIN_CAP"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			domainCap = n
		}
	}
	refs, meta := fuseSemantic(gatedLanes, fuseOpts{
		query: opts.Query, topN: opts.TopN,
		category:        detectCategory(opts.Query),
		communityIntent: detectCommunityIntent(opts.Query),
		lang:            opts.Lang, authorityBoost: 0.75, topic: topic, domainCap: domainCap,
		// b37 snippet 合并查询词命中优先(SC_B37_MERGE=0 回退旧长度规则)
		b37KeyTermMerge: os.Getenv("SC_B37_MERGE") != "0",
	}, opts.TopN)
	journal.Write("fusion", map[string]any{
		"fused": len(refs), "dedupMerged": meta.DedupMerged,
		"spamBlocked": meta.SpamBlocked, "authorityGuarded": meta.AuthorityGuarded,
		"b37merge": os.Getenv("SC_B37_MERGE") != "0", // snippet 合并判据状态(防静默回退伪装生效)
	})
	// b27 cross-encoder 语义重排: SC_RERANK=1 启用 (lib/model/vocab 三路径就位), lin-λ 增量式
	// 保住融合分基底 (b26 离线重放裁决: 位次保持池救回 60.6%, hit@1 +17.1pp 双集同向);
	// 初始化失败优雅回退原序, 查询永不失败。集成位置在注入层前 — 重排后的 top-5 进 b19 抓正文。
	refs, _, _ = rerankRefs(refs, opts.Query, journal)
	// b19/b21 答案抽取层: 问句/意图查询对 top-N(SC_ANSWER_TOPN, 缺省 5)抓正文, 含答案句注入 Snippet
	// (外部基准挂账转正: "top1 相关但 datum 在正文" → 搬进摘要直接交付)。
	// SC_ANSWER_PASS=0 关闭; 页缓存 900s 使同 URL 复抓免费。
	if os.Getenv("SC_ANSWER_PASS") != "0" {
		af := NewFetcher(loadFetchConfig(), journal)
		if pc, err := OpenCache(dataDir()); err == nil {
			af.pageStore = pc
			defer pc.Close()
		}
		refs = b19AnswerPass(context.Background(), client, af, refs, opts.Query)
	}
	used, failed := []string{}, []string{}
	for _, lr := range lanes {
		if lr.Err != nil {
			failed = append(failed, lr.Name)
		} else {
			used = append(used, lr.Name)
		}
	}
	failed = append(failed, failedTimedOut...)
	out := Output{
		Query: opts.Query, Refs: refs, EnginesUsed: used, EnginesFailed: failed,
		ElapsedMs: time.Since(t0).Milliseconds(),
		Poc:       "go-port P4: 44 lanes + planner + authority v3 + semantic fusion + governor(SSRF/budget/domain) + focus fetcher + journal + breaker2.0 + REST/MCP exits",
		Meta:      OutputMeta{SpamBlocked: meta.SpamBlocked, AuthorityGuarded: meta.AuthorityGuarded, DedupMerged: meta.DedupMerged, Embedder: meta.Embedder},
	}
	if qualityMeta.Evaluated > 0 {
		qm := qualityMeta
		out.Meta.Quality = &qm
	}
	if harvestMeta != nil {
		out.Meta.Harvest = harvestMeta
	}
	if out.Refs == nil {
		out.Refs = []Reference{}
	}
	// 出勤不到一半或全灭 → degraded 降级信号(TS v0.4 语义)
	if len(used) == 0 || (attempted > 0 && len(used) < attempted/2) {
		out.Meta.Degraded = true
	}
	if cache != nil {
		// S2 (issue #3): 临时失败不负缓存 — degraded/空结果不入缓存,
		// 避免"长期无结果"假象; 完整响应才缓存(引用预算与完整响应一致)。
		if !out.Meta.Degraded && len(out.Refs) > 0 {
			if raw, err := json.Marshal(out); err == nil {
				cache.PutSearch(cacheKey, raw)
			}
		} else {
			journal.Write("cache_skip_negative", map[string]any{
				"degraded": out.Meta.Degraded, "refs": len(out.Refs), "failed": len(out.EnginesFailed),
			})
		}
		cache.Close()
	}
	return out
}

// searchCacheKey 对齐 TS engine.ts cacheKey: sha24(JSON.stringify({q,r,o:{f,l,m,t,e}}))
// TS 语义: undefined 字段省略键(domains 恒省略 — v0.1 fetch 不带 run 级 allow)
func searchCacheKey(queries []string, route string, opts SearchOpts) string {
	var b strings.Builder
	b.WriteString(`{"q":`)
	qj, _ := json.Marshal(queries)
	b.Write(qj)
	b.WriteString(`,"r":`)
	rj, _ := json.Marshal(route)
	b.Write(rj)
	b.WriteString(`,"o":{`)
	var parts []string
	if opts.Freshness != "" && opts.Freshness != "true" {
		parts = append(parts, `"f":`+strconv.Quote(opts.Freshness))
	}
	if opts.Lang != "" {
		parts = append(parts, `"l":`+strconv.Quote(opts.Lang))
	}
	parts = append(parts, `"m":`+strconv.Itoa(opts.MaxResults), `"t":`+strconv.Itoa(opts.TopN))
	if len(opts.Engines) > 0 {
		ej, _ := json.Marshal(opts.Engines)
		parts = append(parts, `"e":`+string(ej))
	}
	b.WriteString(strings.Join(parts, ","))
	b.WriteString("}}")
	return CacheHash(b.String())
}

// searchCacheQuery v0.5 缓存即搜索面: 全文搜已抓页面(离线秒回)
func searchCacheQuery(query string, limit int) []CacheSearchHit {
	cache, err := OpenCache(dataDir())
	if err != nil {
		return []CacheSearchHit{}
	}
	defer cache.Close()
	cache.KvIncr("stat:cache_search_total", 1)
	return cache.SearchPages(query, limit)
}

// legSet 腿编排单元(路由分腿)
type legSet struct {
	query   string
	engines []string
}

// legNameAt 扁平腿序号 → 腿名(被断慢腿报账用)
func legNameAt(legSets []legSet, idx int) string {
	i := idx
	for _, ls := range legSets {
		if i < len(ls.engines) {
			return ls.engines[i]
		}
		i -= len(ls.engines)
	}
	return "?"
}

func printJSON(v any) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func cmdSearch(rest []string) {
	positional, flags := parseFlags(rest)
	query := strings.Join(positional, " ")
	if query == "" {
		fmt.Fprintln(os.Stderr, `usage: search-core-go search "query" [--lang zh] [--topn 20] [--freshness month] [--engines keenable,bingrss,...] [--timeout 6000]`)
		os.Exit(2)
	}
	topn, _ := strconv.Atoi(flags["topn"])
	if topn <= 0 {
		topn = 20
	}
	timeout, _ := strconv.Atoi(flags["timeout"])
	if timeout <= 0 {
		timeout = 6000
	}
	freshness := flags["freshness"]
	if freshness == "" || freshness == "true" {
		freshness = "any"
	}
	var engList []string
	enginesSet := false
	if e, given := flags["engines"]; given && e != "true" {
		// 显式空名单(--engines "")= 零请求契约(MCP 同款); 无值(--engines)视为未提供
		enginesSet = true
		for _, x := range strings.Split(e, ",") {
			if x = strings.TrimSpace(x); x != "" {
				engList = append(engList, x)
			}
		}
	}
	opts := SearchOpts{
		Query: query, Lang: flags["lang"], TopN: topn, MaxResults: 10,
		Engines: engList, EnginesSet: enginesSet, TimeoutMs: timeout, Freshness: freshness,
	}
	out := searchFlow(opts, timeout)
	if flags["json"] == "true" {
		printJSON(out)
		return
	}
	fmt.Printf("# %s\n", out.Query)
	fmt.Printf("engines: %s  failed: %s  %dms\n",
		strings.Join(out.EnginesUsed, "+"), strings.Join(out.EnginesFailed, ","), out.ElapsedMs)
	for i, ref := range out.Refs {
		fmt.Printf("\n[%d] %s  (%s)\n    %s\n", i+1, ref.Title, strings.Join(ref.Engines, ","), ref.URL)
		if ref.Snippet != "" {
			fmt.Printf("    %s\n", truncStr(ref.Snippet, 160))
		}
	}
}

func cmdFetch(rest []string) {
	positional, flags := parseFlags(rest)
	if len(positional) == 0 {
		fmt.Fprintln(os.Stderr, "usage: search-core-go fetch <url> [--focus text] [--max-chars 8000]")
		os.Exit(2)
	}
	rawURL := positional[0]
	opts := FetchOptions{Focus: flags["focus"]}
	if v, err := strconv.Atoi(flags["max-chars"]); err == nil && v > 0 {
		opts.MaxChars = v
	}
	if v, err := strconv.Atoi(flags["adjacent"]); err == nil && v > 0 {
		opts.Adjacent = v
	}
	f := NewFetcher(loadFetchConfig(), NewJournal(dataDir(), os.Getenv("SC_JOURNAL") != "0"))
	if pc, err := OpenCache(dataDir()); err == nil {
		f.pageStore = pc // v0.5: 页面缓存持久化(SQLite, 跨进程)
		defer pc.Close()
	}
	r := f.Run(rawURL, opts, f.policyFor(nil, nil))
	if flags["json"] == "true" {
		printJSON(r)
		return
	}
	t := r.Title
	if t == "" {
		t = r.URL
	}
	saved := "-"
	if r.SavedPct != nil {
		saved = strconv.Itoa(int(*r.SavedPct*100)) + "%"
	}
	fmt.Printf("# %s\ncache=%v text=%dch returned=%dch saved=%s %dms\n---\n",
		t, r.FromCache, r.TextLength, r.ReturnedChars, saved, r.ElapsedMs)
	if len(r.Segments) > 0 {
		fmt.Println(strings.Join(r.Segments, "\n…\n"))
	} else if r.Text != "" {
		fmt.Println(r.Text)
	}
}

func cmdResearch(rest []string) {
	positional, flags := parseFlags(rest)
	query := strings.Join(positional, " ")
	resumeID := flags["resume"]
	if query == "" && resumeID == "" {
		fmt.Fprintln(os.Stderr, `usage: search-core-go research "query" [--loops 3] [--strict] [--preset summary|report|deep] [--resume runId] [--json]`)
		os.Exit(2)
	}
	opts := ResearchOptions{Preset: flags["preset"]}
	if v, err := strconv.Atoi(flags["loops"]); err == nil && v > 0 {
		opts.MaxLoops = v
	}
	opts.Strict = flags["strict"] == "true"
	onEvent := func(ev map[string]any) {
		if flags["json"] == "true" {
			return
		}
		switch ev["type"] {
		case "loop_start":
			fmt.Fprintf(os.Stderr, "[loop %v] angles: %v\n", ev["loop"], ev["angles"])
		case "angle_done":
			fmt.Fprintf(os.Stderr, "  [%v] found=%v new=%v pool=%v\n", ev["angle"], ev["found"], ev["added"], ev["poolSize"])
		case "angle_error":
			fmt.Fprintf(os.Stderr, "  [%v] ERROR: %v\n", ev["angle"], ev["error"])
		case "fetch_done":
			fmt.Fprintf(os.Stderr, "  [fetch] %v refId=%v\n", truncStr(fmt.Sprint(ev["url"]), 70), ev["refId"])
		case "reflect":
			if scores, ok := ev["scores"].(ReflectScores); ok {
				fmt.Fprintf(os.Stderr, "  [reflect] facts=%v Q1=%.2f Q2=%.2f Q3=%.2f Q4=%.2f\n", ev["facts"], scores.Q1Facts, scores.Q2Coverage, scores.Q3Authority, scores.Q4Freshness)
			}
		case "decide":
			fmt.Fprintf(os.Stderr, "  [decide] %v\n", ev["decision"])
		case "stop":
			fmt.Fprintf(os.Stderr, "[stop] %v: %v\n", ev["reason"], ev["detail"])
		}
	}
	fetcher := newPersistentFetcher(NewJournal(dataDir(), os.Getenv("SC_JOURNAL") != "0"))
	loop := NewResearchLoop(dataDir(), fetcher)
	var res *ResearchResult
	var err error
	if resumeID != "" {
		res, err = loop.Resume(resumeID, opts, onEvent)
	} else {
		res, err = loop.Run(query, opts, onEvent)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	if flags["json"] == "true" {
		printJSON(res)
		return
	}
	fmt.Println(res.Report)
	fmt.Fprintf(os.Stderr, "\n[run] %s | stop=%s | loops=%d | facts=%d | refs=%d | %dms | journal=%s\n",
		res.RunID, res.Stop.Reason, len(res.Loops), len(res.Facts), len(res.Refs), res.Stats.ElapsedMs, res.JournalPath)
}

// xSearchCore X 降级链 + 融合(对齐 TS engine.xSearch: domainCap=0 同域是特性, kind 全置 x)
func xSearchCore(query string, topN int) Output {
	t0 := time.Now()
	cfg := loadXChainConfig()
	client := &http.Client{Timeout: 20 * time.Second}
	xkv := newXKv(dataDir())
	health := NewHealthTracker(dataDir())
	chain := xSearchChain(cfg, client, xkv, health, query, func(siteQuery string) []Reference {
		// TS deps.runKeyless: router.run(siteQuery, opts, keyless 引擎子集)
		out := searchFlow(SearchOpts{Query: siteQuery, TopN: 30, MaxResults: 10, TimeoutMs: 6000}, 6000)
		return out.Refs
	})
	// 融合: 同域是特性(twitter/x.com), 多样性 cap 不适用(domainCap=0)
	lr := []laneResult{{Name: "x", Refs: chain.Refs}}
	refs, meta := fuseSemantic(lr, fuseOpts{
		query: query, topN: topN, domainCap: 0,
		b37KeyTermMerge: os.Getenv("SC_B37_MERGE") != "0", // b37 同主链路
	}, topN)
	for i := range refs {
		refs[i].Kind = "x"
	}
	used := []string{}
	for _, u := range chain.Used {
		used = append(used, u)
	}
	out := Output{
		Query: query, Refs: refs, EnginesUsed: used,
		ElapsedMs: time.Since(t0).Milliseconds(),
		Poc:       "go-port P5: xchain 4-layer degrade (official/guest-gql/keyless/oembed) + queryId self-heal + fuse domainCap=0",
		Meta:      OutputMeta{SpamBlocked: meta.SpamBlocked, AuthorityGuarded: meta.AuthorityGuarded, DedupMerged: meta.DedupMerged, Embedder: meta.Embedder},
	}
	if out.Refs == nil {
		out.Refs = []Reference{}
	}
	return out
}

// cmdCache v0.5 缓存即搜索面: 全文搜已抓页面(离线秒回, TS cache 子命令对齐)
func cmdCache(rest []string) {
	positional, flags := parseFlags(rest)
	query := strings.Join(positional, " ")
	if query == "" {
		fmt.Fprintln(os.Stderr, `usage: search-core-go cache "query" [--limit 10] [--json]`)
		os.Exit(2)
	}
	limit := 10
	if v, err := strconv.Atoi(flags["limit"]); err == nil && v > 0 {
		limit = v
	}
	hits := searchCacheQuery(query, limit)
	if flags["json"] == "true" {
		printJSON(hits)
		return
	}
	fmt.Printf("# cache: %s — %d hit(s)\n", query, len(hits))
	for _, h := range hits {
		t := "(untitled)"
		if h.Title != nil && *h.Title != "" {
			t = *h.Title
		}
		fmt.Printf("\n%s  [%s]\n    %s\n", t, h.Via, h.URL)
		if h.Snippet != "" {
			fmt.Printf("    %s\n", truncStr(h.Snippet, 160))
		}
	}
}

func cmdX(rest []string) {
	positional, flags := parseFlags(rest)
	query := strings.Join(positional, " ")
	if query == "" {
		fmt.Fprintln(os.Stderr, `usage: search-core-go x "query" [--topn 20] [--json]`)
		os.Exit(2)
	}
	topn, _ := strconv.Atoi(flags["topn"])
	if topn <= 0 {
		topn = 20
	}
	out := xSearchCore(query, topn)
	if flags["json"] == "true" {
		printJSON(out)
		return
	}
	for i, ref := range out.Refs {
		fmt.Printf("[%d] %s  (%s)\n    %s\n", i+1, ref.Title, strings.Join(ref.Engines, ","), ref.URL)
	}
}

func cmdProviders() {
	health := NewHealthTracker(dataDir())
	names := make([]string, 0, len(laneRegistry))
	for name := range laneRegistry {
		names = append(names, name)
	}
	ps := health.All(names)
	fmt.Println("engine        configured  key  ok/fail   avg-ms  last-error")
	// 2026-11-25 W4: keyed lane 在 providers 面板如实标注 Configured/NeedsKey
	keyState := map[string][2]bool{}
	for lane, envVar := range keyedLaneEnv {
		keyState[lane] = [2]bool{strings.TrimSpace(os.Getenv(envVar)) != "", true}
	}
	for _, p := range ps {
		if ks, ok := keyState[p.Name]; ok {
			p.Configured, p.NeedsKey = ks[0], ks[1]
		}
		lastErr := p.LastError
		if len(lastErr) > 50 {
			lastErr = lastErr[:50]
		}
		open := ""
		if p.CircuitOpen {
			open = " [OPEN]"
		}
		fmt.Printf("%-14s%-12v%-5v%-10s%-8d%s%s\n", p.Name, p.Configured, p.NeedsKey,
			fmt.Sprintf("%d/%d", p.OK, p.Fail), p.AvgLatencyMs, lastErr, open)
	}
}

func cmdStats() {
	health := NewHealthTracker(dataDir())
	names := make([]string, 0, len(laneRegistry))
	for name := range laneRegistry {
		names = append(names, name)
	}
	printJSON(map[string]any{
		"lanes":         len(laneRegistry),
		"enginesHealth": health.All(names),
		"cache":         cacheStatsSnapshot(),
	})
}

func main() {
	args := os.Args[1:]
	cmd := ""
	if len(args) > 0 {
		cmd = args[0]
	}
	switch cmd {
	case "search":
		cmdSearch(args[1:])
	case "fetch":
		cmdFetch(args[1:])
	case "research":
		cmdResearch(args[1:])
	case "x":
		cmdX(args[1:])
	case "cache":
		cmdCache(args[1:])
	case "providers":
		cmdProviders()
	case "stats":
		cmdStats()
	case "serve":
		serveMcpStdio() // MCP stdio 常驻直到 stdin 关闭
	case "serve-http":
		cmdServeHTTP(args[1:])
	default:
		fmt.Fprintln(os.Stderr, `search-core-go (go-port)
usage:
  search-core-go search "query" [--lang zh] [--topn 20] [--freshness month] [--engines keenable,bingrss,searxng,wikipedia] [--timeout 6000]
  search-core-go fetch <url> [--focus text] [--max-chars 8000]
  search-core-go providers            engine health + breaker state
  search-core-go stats                counters snapshot
  search-core-go research "query"     deep research loop (5 angles + 6-question reflection,
                                      [--loops 3] [--strict] [--preset summary|deep] [--resume runId])
  search-core-go x "query"            X/Twitter search (4-layer degrade chain)
  search-core-go cache "query"        full-text search over fetched pages (offline, instant)
  search-core-go serve                MCP stdio server (JSON-RPC 2.0)
  search-core-go serve-http [--port 8787]  REST gateway`)
		os.Exit(2)
	}
}


// engineAllowed: 用户名单是否允许该引擎 (S2: 名单包括恢复腿, 不绕过)
func engineAllowed(name string, allow []string) bool {
	for _, a := range allow {
		if a == name {
			return true
		}
	}
	return false
}

// constrainEngines: 引擎列表交用户名单过滤; 未提供名单时原样返回。
// 过滤后为空 = 该腿集无可用引擎 (调用方决定是否回退通用腿)。
func constrainEngines(engines []string, opts SearchOpts) []string {
	if !opts.EnginesSet {
		return engines
	}
	var out []string
	for _, e := range engines {
		if engineAllowed(e, opts.Engines) {
			out = append(out, e)
		}
	}
	return out
}
