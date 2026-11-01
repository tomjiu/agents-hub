package main

// b37 设计探针: 融合层 snippet 合并判据 — 同 lanes 新旧规则配对 A/B(b36 交接候选① 实弹)。
//
// 背景: 批 36 五级血脉追踪坐实融合层"长 snippet 胜出"双处覆盖证据文本(fuseV3 URL 合并
// semantic.go + TF 去重), FUSION-LOSS 6/21 案(快腿纯融合层 2 案 BLM/You Sexy Thing 与收割
// 无关 + 慢腿复合 3 案 + domainCap 1 案)。修复 = 合并时查询关键 token 命中数优先, 次取
// 长度(b37SnippetBetter); 打平(含双 0)回退长度规则 = 旧行为逐字节 → 健康案零漂移。
//
// 方法: 同一次活窗采集(lanes 只跑一次, 逐引擎独立 runLanes 全结算, 镜像纪律同 b36:
// plan 路由/domainCap/client 三层超时/MaxResults=10), fuseSemantic 以旧规则
// (b37KeyTermMerge=false)与新规则(true)各融合一遍 — 配对对比, 上游 churn 在配对内抵消:
//
//      RESCUED@n   旧=零证据 → 新=有证据(位次 n)   修复目标形态
//      LOST        旧=有证据 → 新=零证据           回归, 门禁=必须 0
//      IMPROVED    双方有证据, 新位次更靠前
//      WORSE       双方有证据, 新位次更靠后
//      SAME@a      双方有证据, 位次不变
//      NOEV        双方零证据(ENGINE-MISS 主体, 预期不变)
//
// 附: top-20 URL 序逐位 diff 数 / rank1 换页 / raw 证据腿慢腿占比(收割复合注记) /
// 新旧 top-3 交付样本(url+snippet 头 200 字, 供人工核)。
//
// 门禁: 缺省 t.Skip — SC_B37_PROBE=1 才发网络请求(常规 go test 零外呼)。
// 输入: SC_B37_PROBE_CASES (缺省 scripts/b36-legprobe-still.json, 复用 b36 冻结案集 21 案;
//       案集随换血漂移属正常 — 配对内对比不受影响, 被上游治好的案记 churn-cured)
// 输出: SC_B37_PROBE_OUT   (缺省 scripts/b37-mergeprobe.json, JSONL 逐案追加)

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"sort"
	"strings"
	"testing"
	"time"
)

type b37Head struct {
	URL     string `json:"url"`
	Title   string `json:"title"`
	Snippet string `json:"snippet"`
}

type b37CaseOut struct {
	Dataset  string   `json:"dataset"`
	Q        string   `json:"q"`
	Answers  []string `json:"answers"`
	RawTotal int      `json:"rawTotal"`
	Distinct int      `json:"distinct"`
	// 配对结果
	OldEvRank int    `json:"oldEvRank"` // 0=无
	NewEvRank int    `json:"newEvRank"`
	Bucket    string `json:"bucket"`
	// 效应面
	TopURLOldNewDiff int  `json:"topURLOldNewDiff"` // top-20 逐位 URL 不同数
	Rank1Flip        bool `json:"rank1Flip"`
	DedupOld         int  `json:"dedupOld"`
	DedupNew         int  `json:"dedupNew"`
	SlowLegOnly      bool `json:"slowLegOnly"` // raw 证据全部落在 >1200ms 慢腿(生产早收割复合风险)
	// 交付样本(人工核)
	OldTop3 []b37Head `json:"oldTop3,omitempty"`
	NewTop3 []b37Head `json:"newTop3,omitempty"`
}

// b37RunLanes: 与 b36 探针同款腿编排镜像(逐引擎独立 runLanes, 全结算不等早收割)
func b37RunLanes(q string) ([]laneResult, map[string]int64, int, string, int) {
	legSets, topic, domainCap := b36BuildLegSets(q)
	client := &http.Client{
		Timeout: 20 * time.Second,
		Transport: &http.Transport{
			DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
		},
	}
	type slot struct {
		lr  laneResult
		ems int64
	}
	nEngines := 0
	for _, ls := range legSets {
		nEngines += len(ls.engines)
	}
	slots := make([]slot, nEngines)
	done := make(chan int, nEngines)
	idx := 0
	for _, ls := range legSets {
		for _, e := range ls.engines {
			go func(i int, q, e string) {
				lo := SearchOpts{Query: q, Lang: "", TopN: 20, MaxResults: 10, Engines: []string{e}, TimeoutMs: 20000}
				lt0 := time.Now()
				rs := runLanes(lo, client)
				slots[i].ems = time.Since(lt0).Milliseconds()
				if len(rs) > 0 {
					slots[i].lr = rs[0]
				} else {
					slots[i].lr = laneResult{Name: e, Err: fmt.Errorf("no result")}
				}
				done <- i
			}(idx, ls.query, e)
			idx++
		}
	}
	for i := 0; i < nEngines; i++ {
		<-done
	}
	var lanes []laneResult
	ems := map[string]int64{}
	rawTotal := 0
	for i := 0; i < nEngines; i++ {
		lr := slots[i].lr
		ems[lr.Name] = slots[i].ems
		if lr.Err == nil && !lr.Skipped {
			lanes = append(lanes, lr)
			rawTotal += len(lr.Refs)
		}
	}
	return lanes, ems, rawTotal, topic, domainCap
}

func b37EvRank(refs []Reference, answers []string) int {
	for i, r := range refs {
		if ok, _, _ := b36Evidence(r.Title, r.Snippet, "", answers); ok {
			return i + 1
		}
	}
	return 0
}

func b37Heads(refs []Reference, n int) []b37Head {
	out := []b37Head{}
	for i := 0; i < len(refs) && i < n; i++ {
		out = append(out, b37Head{URL: refs[i].URL, Title: clampText(refs[i].Title, 120), Snippet: clampText(refs[i].Snippet, 200)})
	}
	return out
}

func TestB37MergeProbe(t *testing.T) {
	if os.Getenv("SC_B37_PROBE") != "1" {
		t.Skip("SC_B37_PROBE=1 才发网络请求(门禁)")
	}
	// 判据金样本自检(b36Evidence = eval matchEvidence 镜像; b37TermHits 决策表在语义单测)
	if ok, _, _ := b36Evidence("BLM", "manages over 247.3 million acres", "", []string{"247.3 million"}); !ok {
		t.Fatalf("金样本失败")
	}
	if b37TermHits("The Bureau of Land Management manages 247.3 million acres.", b37Q) != 5 {
		t.Fatalf("b37TermHits 金样本失败")
	}

	casesPath := os.Getenv("SC_B37_PROBE_CASES")
	if casesPath == "" {
		casesPath = "scripts/b36-legprobe-still.json"
	}
	raw, err := os.ReadFile(casesPath)
	if err != nil {
		t.Fatalf("读案集失败: %v", err)
	}
	var cases []b36Case
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("案集解析失败: %v", err)
	}
	outPath := os.Getenv("SC_B37_PROBE_OUT")
	if outPath == "" {
		outPath = "scripts/b37-mergeprobe.json"
	}

	tally := map[string]int{}
	for ci, c := range cases {
		out := b37CaseOut{Dataset: c.Dataset, Q: c.Q, Answers: c.Answers}
		lanes, ems, rawTotal, topic, domainCap := b37RunLanes(c.Q)
		out.RawTotal = rawTotal
		if len(lanes) == 0 {
			out.Bucket = "ALL-LANES-ERR"
			tally[out.Bucket]++
			b37WriteCase(t, outPath, out, ci, len(cases))
			continue
		}
		fuseO := fuseOpts{
			query: c.Q, topN: 20,
			category:        detectCategory(c.Q),
			communityIntent: detectCommunityIntent(c.Q),
			lang:            "", authorityBoost: 0.75, topic: topic, domainCap: domainCap,
		}
		// 同 lanes 双规则配对(fuseSemantic/fuseV3 不改写输入 lanes, b36 已验证同调用模式)
		oldMerge := fuseO
		oldMerge.b37KeyTermMerge = false
		newMerge := fuseO
		newMerge.b37KeyTermMerge = true
		oldF, oldMeta := fuseSemantic(lanes, oldMerge, 20)
		newF, newMeta := fuseSemantic(lanes, newMerge, 20)
		out.Distinct = len(newF)
		out.OldEvRank = b37EvRank(oldF, c.Answers)
		out.NewEvRank = b37EvRank(newF, c.Answers)
		out.DedupOld, out.DedupNew = oldMeta.DedupMerged, newMeta.DedupMerged

		// 效应面: top-20 逐位 URL diff + rank1 换页
		for i := 0; i < len(oldF) && i < len(newF); i++ {
			if oldF[i].URL != newF[i].URL {
				out.TopURLOldNewDiff++
			}
		}
		out.Rank1Flip = len(oldF) > 0 && len(newF) > 0 && oldF[0].URL != newF[0].URL
		out.OldTop3, out.NewTop3 = b37Heads(oldF, 3), b37Heads(newF, 3)

		// raw 证据腿慢腿占比: 任一引擎腿带证据 → 记引擎 elapsed; 全部 >1200ms → 收割复合风险
		slowOnly, anyEv := true, false
		for _, lr := range lanes {
			for _, r := range lr.Refs {
				if ok, _, _ := b36Evidence(r.Title, r.Snippet, "", c.Answers); ok {
					anyEv = true
					if ems[lr.Name] <= 1200 {
						slowOnly = false
					}
					break
				}
			}
		}
		out.SlowLegOnly = anyEv && slowOnly

		switch {
		case out.OldEvRank == 0 && out.NewEvRank > 0:
			out.Bucket = fmt.Sprintf("RESCUED@%d", out.NewEvRank)
		case out.OldEvRank > 0 && out.NewEvRank == 0:
			out.Bucket = fmt.Sprintf("LOST(was@%d)", out.OldEvRank)
		case out.OldEvRank > 0 && out.NewEvRank > 0 && out.NewEvRank < out.OldEvRank:
			out.Bucket = fmt.Sprintf("IMPROVED@%d->%d", out.OldEvRank, out.NewEvRank)
		case out.OldEvRank > 0 && out.NewEvRank > 0 && out.NewEvRank > out.OldEvRank:
			out.Bucket = fmt.Sprintf("WORSE@%d->%d", out.OldEvRank, out.NewEvRank)
		case out.OldEvRank > 0:
			out.Bucket = fmt.Sprintf("SAME@%d", out.OldEvRank)
		default:
			out.Bucket = "NOEV"
		}
		tally[out.Bucket]++
		b37WriteCase(t, outPath, out, ci, len(cases))
	}
	keys := make([]string, 0, len(tally))
	for k := range tally {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := []string{}
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s=%d", k, tally[k]))
	}
	t.Logf("TALLY %s", strings.Join(parts, " "))
	// 门禁: LOST 必须 0(证据存活案不得被新规则打死)
	for k, v := range tally {
		if strings.HasPrefix(k, "LOST") && v > 0 {
			t.Errorf("门禁失败: LOST=%d(证据存活案被新规则打死)", v)
		}
	}
}

func b37WriteCase(t *testing.T, outPath string, out b37CaseOut, ci, n int) {
	blob, _ := json.Marshal(out)
	f, err := os.OpenFile(outPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatalf("写输出失败: %v", err)
	}
	_, _ = f.Write(append(blob, '\n'))
	_ = f.Close()
	t.Logf("[%2d/%2d] %-22s old@%d new@%d urldiff=%d %s", ci+1, n, out.Bucket, out.OldEvRank, out.NewEvRank, out.TopURLOldNewDiff, out.Q[:min(len(out.Q), 48)])
}
