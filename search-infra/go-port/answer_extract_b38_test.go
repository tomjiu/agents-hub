package main

// b38: ENGINE-MISS 查询词形/召回层盲变体探针 (v0.10 菜单候选 #2 第一锹, 零产品代码改动)。
//
// 背景: b36 定界 21 案 STILL-NOGOLD 中 ENGINE-MISS=15(71%) — 全引擎全深度(每腿≤10)
// title+snippet 零证据, 平均 161 refs/案全结算仍无。假设: NQ/TriviaQA 自然语言问句的
// 词面形态(疑问词/虚词/前导数字伪影/词序)导致引擎召回失败, 与引擎覆盖无关的查询改写
// 可捞回证据页。本探针回答: 盲查询变体的召回上限天花板有多高, 哪类变体有效。
//
// 变体定义(全部盲派生 — 只用 query 文本, 严禁 gold/URL 信息进入变体构造; gold 仅用于
// 判定侧 b36Evidence, 这是 oracle 红线):
//      V0 orig      原查询(基线复现, churn 对照)
//      V1 kw        关键词化: 去疑问词/虚词/前导孤立数字, 保留内容 token 原序
//      V2 quoted    最长连续内容 run 加引号(短语精确匹配)
//      V3 trim      最小裁剪: 仅去前导伪影(数字/疑问词/冠词), 其余原样
//      V4 entfirst  原 query 中首字母大写 token 提前(专名优先), 其余内容 token 随后
//
// 镜像纪律(沿用 b36 骨架): plan() 按变体 query 重新路由(生产同款), 引擎池=laneRegistry
// 全池去 searxng, client 三层快超时+20s 总超时, MaxResults=10/TopN=20, 判定=b36Evidence
// (b32AnsIn 逐字镜像, 金样本自检前置)。
//
// 判定口径: 变体证据 = 该变体任一腿 depth≤10 的 title+snippet 含 gold(b36Evidence)。
//      RESCUED   ≥1 个非 orig 变体产出证据(记录变体类/引擎/腿内序位)
//      ORIG-EV   仅 V0 产出证据(活窗 churn 翻案, 不计召回修复)
//      STILL-MISS 全变体零证据(真语料/索引层缺口, 查询词形救不了)
//
// 口径边界(防再诉讼):
//      - 本探针只测召回上限(证据进任一腿), 不证明交付 rank1(融合+重排下游仍需工作,
//        产品化=查询 fan-out 成本 2-5× 引擎调用, 收益定界后另行立项)
//      - 引擎活窗: V0 与 b36 窗可能漂移, ORIG-EV 桶承接 churn
//      - matcher 子串陷阱类(b31 立档: Persia⊂Persian 等)沿用 eval 口径不修改, RESCUED
//        逐案人工裁决后才计入结论
//      - 变体路由: plan(variant) 与生产一致, 变体几乎全走 web 全池
//
// 门禁: 缺省 t.Skip — SC_B38_PROBE=1 才发网络请求(常规 go test 零外呼)。
// 输入: SC_B38_PROBE_CASES (缺省 scripts/b38-engine-miss-cases.json, 由 b36-legprobe.json
//        bucket=ENGINE-MISS* 派生冻结)
// 输出: SC_B38_PROBE_OUT   (缺省 scripts/b38-queryvariant.json, JSONL 逐案追加)

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

// b38QStop: 变体生成的英文疑问词/虚词表(与判定侧 b32Stop 无关, 只服务变体构造;
// 保留 first/last/new 等内容承载词)
var b38QStop = map[string]bool{
	"who": true, "whom": true, "whose": true, "what": true, "when": true, "where": true,
	"which": true, "why": true, "how": true,
	"is": true, "are": true, "was": true, "were": true, "be": true, "been": true, "being": true,
	"do": true, "does": true, "did": true, "has": true, "have": true, "had": true,
	"the": true, "a": true, "an": true,
	"of": true, "in": true, "on": true, "at": true, "to": true, "for": true, "from": true,
	"by": true, "with": true, "about": true, "as": true, "into": true, "over": true,
	"and": true, "or": true, "but": true, "not": true, "no": true,
	"it": true, "its": true, "he": true, "she": true, "they": true, "their": true,
	"his": true, "her": true, "him": true,
	"this": true, "that": true, "these": true, "those": true, "there": true, "here": true,
}

type b38Case struct {
	Dataset string   `json:"dataset"`
	Q       string   `json:"q"`
	Answers []string `json:"answers"`
}

type b38VariantOut struct {
	Variant     string       `json:"variant"`
	Query       string       `json:"query"`
	Lanes       []b38LaneOut `json:"lanes"`
	Evidence    []b38RawEv   `json:"evidence"`
	HasEvidence bool         `json:"hasEvidence"`
}

type b38LaneOut struct {
	Engine    string `json:"engine"`
	Err       string `json:"err,omitempty"`
	Count     int    `json:"count"`
	ElapsedMs int64  `json:"elapsedMs"`
}

type b38RawEv struct {
	Engine     string `json:"engine"`
	Rank       int    `json:"rank"`
	URL        string `json:"url"`
	Title      string `json:"title"`
	Snippet    string `json:"snippet"`
	MatchedBy  string `json:"matchedBy"`
	MatchedAns string `json:"matchedAns"`
}

type b38CaseOut struct {
	Dataset  string          `json:"dataset"`
	Q        string          `json:"q"`
	Answers  []string        `json:"answers"`
	Bucket   string          `json:"bucket"` // RESCUED / ORIG-EV / STILL-MISS
	Variants []b38VariantOut `json:"variants"`
}

// b38Variants: 盲变体生成(只用 c.Q 文本)
func b38Variants(c b38Case) []struct {
	name  string
	query string
} {
	toks := splitRe.Split(c.Q, -1)
	clean := []string{}
	for _, t := range toks {
		if t != "" {
			clean = append(clean, t)
		}
	}
	// V1 kw: 关键词化(去疑问词/虚词; 前导孤立数字无论位置视为伪影去除)
	var kw []string
	for i, t := range clean {
		lt := strings.ToLower(t)
		if b38QStop[lt] {
			continue
		}
		if isAllDigits(t) && i == 0 {
			continue // 前导数字伪影("1 the bureau...")
		}
		kw = append(kw, t)
	}
	// V2 quoted: 最长连续内容 run(原 token 序中相邻且均非停用词)
	bestLo, bestLen := -1, 0
	runLo, runLen := -1, 0
	for i, t := range clean {
		lt := strings.ToLower(t)
		if !b38QStop[lt] && !(i == 0 && isAllDigits(t)) {
			if runLo < 0 {
				runLo = i
			}
			runLen++
			if runLen > bestLen {
				bestLo, bestLen = runLo, runLen
			}
		} else {
			runLo, runLen = -1, 0
		}
	}
	quoted := ""
	if bestLen >= 2 { // 单 token 无短语价值, 退化为 orig 即跳过
		parts := make([]string, 0, bestLen)
		for i := bestLo; i < bestLo+bestLen; i++ {
			parts = append(parts, clean[i])
		}
		quoted = "\"" + strings.Join(parts, " ") + "\""
	}
	// V3 trim: 仅去前导伪影(数字/疑问词/冠词), 保留虚词
	trim := append([]string{}, clean...)
	for len(trim) > 0 {
		lt := strings.ToLower(trim[0])
		if isAllDigits(trim[0]) || b38QStop[lt] && (lt == "who" || lt == "what" || lt == "when" || lt == "where" || lt == "which" || lt == "the" || lt == "a" || lt == "an" || lt == "in" || lt == "on") {
			trim = trim[1:]
			continue
		}
		break
	}
	// V4 entfirst: 首字母大写 token 提前(专名优先, 保留原 case), 其余内容 token 按序
	var ents, rest []string
	for i, t := range clean {
		lt := strings.ToLower(t)
		if b38QStop[lt] || (i == 0 && isAllDigits(t)) {
			continue
		}
		r := []rune(t)
		if len(r) > 0 && r[0] >= 'A' && r[0] <= 'Z' {
			ents = append(ents, t)
		} else {
			rest = append(rest, t)
		}
	}
	entfirst := append(append([]string{}, ents...), rest...)

	out := []struct {
		name  string
		query string
	}{{"orig", c.Q}}
	if len(kw) > 0 {
		out = append(out, struct {
			name  string
			query string
		}{"kw", strings.Join(kw, " ")})
	}
	if quoted != "" && quoted != "\""+c.Q+"\"" {
		out = append(out, struct {
			name  string
			query string
		}{"quoted", quoted})
	}
	if len(trim) > 0 && strings.Join(trim, " ") != c.Q {
		out = append(out, struct {
			name  string
			query string
		}{"trim", strings.Join(trim, " ")})
	}
	if len(entfirst) > 0 && strings.Join(entfirst, " ") != strings.Join(kw, " ") {
		out = append(out, struct {
			name  string
			query string
		}{"entfirst", strings.Join(entfirst, " ")})
	}
	return out
}

func TestB38QueryVariantProbe(t *testing.T) {
	if os.Getenv("SC_B38_PROBE") != "1" {
		t.Skip("SC_B38_PROBE=1 才发网络请求(门禁)")
	}
	// ---- 匹配器金样本自检(b36 同款红线) ----
	if ok, _, _ := b36Evidence("Bureau of Land Management", "manages over 247.3 million acres", "", []string{"247.3 million"}); !ok {
		t.Fatalf("金样本失败: verbatim 命中")
	}

	casesPath := os.Getenv("SC_B38_PROBE_CASES")
	if casesPath == "" {
		casesPath = "scripts/b38-engine-miss-cases.json"
	}
	raw, err := os.ReadFile(casesPath)
	if err != nil {
		t.Fatalf("读案集失败: %v", err)
	}
	var cases []b38Case
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("案集解析失败: %v", err)
	}

	outPath := os.Getenv("SC_B38_PROBE_OUT")
	if outPath == "" {
		outPath = "scripts/b38-queryvariant.json"
	}

	client := &http.Client{
		Timeout: 20 * time.Second,
		Transport: &http.Transport{
			DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
		},
	}

	tally := map[string]int{}
	variantRescue := map[string]int{}
	for ci, c := range cases {
		out := b38RunCase(t, c, client)
		tally[out.Bucket]++
		for _, v := range out.Variants {
			if v.Variant != "orig" && v.HasEvidence {
				variantRescue[v.Variant]++
			}
		}
		blob, _ := json.Marshal(out)
		f, err := os.OpenFile(outPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			t.Fatalf("写输出失败: %v", err)
		}
		_, _ = f.Write(append(blob, '\n'))
		_ = f.Close()
		t.Logf("[%2d/%2d] %-10s %s", ci+1, len(cases), out.Bucket, c.Q[:min(len(c.Q), 56)])
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
	vkeys := make([]string, 0, len(variantRescue))
	for k := range variantRescue {
		vkeys = append(vkeys, k)
	}
	sort.Strings(vkeys)
	vparts := []string{}
	for _, k := range vkeys {
		vparts = append(vparts, fmt.Sprintf("%s=%d", k, variantRescue[k]))
	}
	t.Logf("TALLY %s | VARIANT-RESCUE %s", strings.Join(parts, " "), strings.Join(vparts, " "))
}

func b38RunCase(t *testing.T, c b38Case, client *http.Client) b38CaseOut {
	out := b38CaseOut{Dataset: c.Dataset, Q: c.Q, Answers: c.Answers}
	variants := b38Variants(c)
	origHasEv := false
	anyNonOrigHasEv := false
	for _, v := range variants {
		vo := b38VariantOut{Variant: v.name, Query: v.query}
		legSets, _, _ := b36BuildLegSets(v.query) // plan(variant) 与生产一致
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
					lo := SearchOpts{
						Query: q, Lang: "", TopN: 20, MaxResults: 10,
						Engines: []string{e}, TimeoutMs: 20000,
					}
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
		for i := 0; i < nEngines; i++ {
			lr := slots[i].lr
			vo.Lanes = append(vo.Lanes, b38LaneOut{
				Engine: lr.Name, Count: len(lr.Refs), ElapsedMs: slots[i].ems,
				Err: errStr(lr.Err),
			})
			for ri, ref := range lr.Refs {
				if ok, by, ans := b36Evidence(ref.Title, ref.Snippet, "", c.Answers); ok {
					vo.Evidence = append(vo.Evidence, b38RawEv{
						Engine: lr.Name, Rank: ri + 1, URL: ref.URL,
						Title: ref.Title, Snippet: ref.Snippet,
						MatchedBy: by, MatchedAns: ans,
					})
				}
			}
		}
		vo.HasEvidence = len(vo.Evidence) > 0
		if vo.HasEvidence {
			if v.name == "orig" {
				origHasEv = true
			} else {
				anyNonOrigHasEv = true
			}
		}
		out.Variants = append(out.Variants, vo)
	}
	switch {
	case anyNonOrigHasEv:
		out.Bucket = "RESCUED"
	case origHasEv:
		out.Bucket = "ORIG-EV"
	default:
		out.Bucket = "STILL-MISS"
	}
	return out
}

// errStr: lane 错误转字符串(空错误归 "")
func errStr(e error) string {
	if e == nil {
		return ""
	}
	return e.Error()
}
