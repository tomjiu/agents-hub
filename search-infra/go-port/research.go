package main

// Research Loop (对齐 TS research.ts v0.2 — v0-spec §4.7 深度研究状态机)
// 证据: Trae[06] 5 角度并行+双预算池 / WorkBuddy[07] 6 步状态机+6 问量化反思 /
//       ODR[11] stop 三保险(单角度失败只降级该角度, 连续整轮全灭才停) /
//       断点恢复: journal 事件流即状态, replay 重建。
// 无 LLM 合成: 默认输出结构化 markdown(角度分节+引用尾注) — TS 同款(synthesizer 钩子留给 LLM 版)。
// 出口校验: 引用 [n] 100% 可回溯(citations strict), 验收口径。

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---------- 公开类型 ----------

type ResearchOptions struct {
	MaxLoops        int      `json:"maxLoops,omitempty"`
	MinFacts        int      `json:"minFacts,omitempty"`
	ReferenceBudget int      `json:"referenceBudget,omitempty"`
	FetchBudget     int      `json:"fetchBudget,omitempty"`
	FetchPerLoop    int      `json:"fetchPerLoop,omitempty"`
	Strict          bool     `json:"strict,omitempty"`
	Angles          []string `json:"angles,omitempty"`
	Freshness       string   `json:"freshness,omitempty"`
	Domains         *struct {
		Allow []string `json:"allow,omitempty"`
		Block []string `json:"block,omitempty"`
	} `json:"domains,omitempty"`
	NoCache bool   `json:"noCache,omitempty"`
	Preset  string `json:"preset,omitempty"` // summary|report|deep
}

// researchBudgets 预算五元组(state.opts 形状)
type researchBudgets struct {
	MaxLoops        int `json:"maxLoops"`
	MinFacts        int `json:"minFacts"`
	ReferenceBudget int `json:"referenceBudget"`
	FetchBudget     int `json:"fetchBudget"`
	FetchPerLoop    int `json:"fetchPerLoop"`
}

// researchPresets 对齐 TS RESEARCH_PRESETS(report=不覆盖用默认; summary/deep 显式预算表)
var researchPresets = map[string]researchBudgets{
	"summary": {1, 4, 60, 4, 4},
	"deep":    {5, 10, 240, 24, 6},
}

type Fact struct {
	RefID     int    `json:"refId"`
	URL       string `json:"url"`
	Title     string `json:"title"`
	Angle     string `json:"angle"`
	Quote     string `json:"quote"`
	Domain    string `json:"domain"`
	Tier      int    `json:"tier"`
	Published string `json:"published,omitempty"`
}

type ReflectScores struct {
	Q1Facts     float64 `json:"q1Facts"`
	Q2Coverage  float64 `json:"q2Coverage"`
	Q3Authority float64 `json:"q3Authority"`
	Q4Freshness float64 `json:"q4Freshness"`
	Q5MultiSrc  float64 `json:"q5MultiSource"`
	Q6Usable    float64 `json:"q6Usable"`
}

type angleQueryStat struct {
	Angle string `json:"angle"`
	Query string `json:"query"`
	Found int    `json:"found"`
	Error string `json:"error,omitempty"`
}

type LoopRecord struct {
	Loop     int              `json:"loop"`
	Queries  []angleQueryStat `json:"queries"`
	NewURLs  int              `json:"newUrls"`
	Fetched  int              `json:"fetched"`
	Reflect  ReflectScores    `json:"reflect"`
	Decision string           `json:"decision"`
}

type ResearchStats struct {
	RefPoolUsed      int   `json:"refPoolUsed"`
	RefBudgetDropped int   `json:"refBudgetDropped"`
	FetchUsed        int   `json:"fetchUsed"`
	FetchErrors      int   `json:"fetchErrors"`
	AngleErrors      int   `json:"angleErrors"`
	Loops            int   `json:"loops"`
	ElapsedMs        int64 `json:"elapsedMs"`
}

type ResearchOutlineEntry struct {
	Angle      string   `json:"angle"`
	Facts      int      `json:"facts"`
	Tier1Facts int      `json:"tier1Facts"`
	Domains    []string `json:"domains"` // 按事实数降序前 2
}

type ResearchResult struct {
	RunID    string       `json:"runId"`
	Resumed  bool         `json:"resumed"`
	Query    string       `json:"query"`
	Angles   []string     `json:"angles"`
	Facts    []Fact       `json:"facts"`
	Refs     []Reference  `json:"refs"`
	Loops    []LoopRecord `json:"loops"`
	Report   string       `json:"report"`
	Registry [][2]any     `json:"registry"` // [id, {url,title}] 对齐 TS 元组数组
	Stop     struct {
		Reason string `json:"reason"`
		Detail string `json:"detail"`
	} `json:"stop"`
	Strict      bool                   `json:"strict"`
	Stats       ResearchStats          `json:"stats"`
	JournalPath string                 `json:"journalPath"`
	Outline     []ResearchOutlineEntry `json:"outline"`
}

// ---------- 角度池(TS DEFAULT_ANGLES 逐条对齐) ----------

type angleTpl struct {
	name    string
	query   func(q string) string
	signals []*regexp.Regexp
}

func re(pattern string) *regexp.Regexp { return regexp.MustCompile("(?i)" + pattern) }

func nowYear() string { return strconv.Itoa(time.Now().Year()) }

var defaultAngles = []angleTpl{
	{"定义与概念", func(q string) string { return q + " 是什么 定义 核心概念" }, nil},
	{"现状与进展", func(q string) string { return q + " 最新进展 现状 " + nowYear() }, nil},
	{"对比与替代", func(q string) string { return q + " 对比 优缺点 替代方案" }, []*regexp.Regexp{re(`对比|比较|vs\b|versus|替代|哪个好|alternative|选哪个`)}},
	{"数据与案例", func(q string) string { return q + " 数据 案例 统计 benchmark" }, []*regexp.Regexp{re(`数据|统计|案例|benchmark|多少|占比|份额`)}},
	{"批评与风险", func(q string) string { return q + " 问题 风险 局限性 criticism" }, []*regexp.Regexp{re(`风险|问题|争议|批评|坑|limitation|criticism|downside`)}},
	{"教程与实践", func(q string) string { return q + " 教程 实践 最佳实践 how to" }, []*regexp.Regexp{re(`怎么|如何|how to|教程|指南|入门|报错|错误|install|配置|部署|deploy`)}},
	{"历史与背景", func(q string) string { return q + " 历史 起源 发展背景" }, []*regexp.Regexp{re(`历史|起源|发展|由来|背景|history|origin`)}},
	{"生态与工具", func(q string) string { return q + " 工具 生态 库 框架" }, []*regexp.Regexp{re(`工具|生态|库|框架|library|framework|sdk|生态圈`)}},
}

// selectAngles v0.8 STORM-lite: 强制角度=定义与概念(basic fact writer), signals 命中优先, 池序填满到 5
func selectAngles(query string) []string {
	forced := defaultAngles[0].name
	picked := map[string]bool{forced: true}
	var order []string
	order = append(order, forced)
	for _, tpl := range defaultAngles {
		if len(picked) >= 5 {
			break
		}
		if tpl.signals != nil {
			for _, sg := range tpl.signals {
				if sg.MatchString(query) && !picked[tpl.name] {
					picked[tpl.name] = true
					order = append(order, tpl.name)
				}
			}
		}
	}
	for _, tpl := range defaultAngles {
		if len(picked) >= 5 {
			break
		}
		if !picked[tpl.name] {
			picked[tpl.name] = true
			order = append(order, tpl.name)
		}
	}
	return order
}

// ---------- 权威域分层(WorkBuddy[07] Q3 规则版; 小而保守, 宁缺勿滥) ----------

var tier1Domains = []string{
	"arxiv.org", "ieee.org", "acm.org", "nature.com", "science.org",
	"gov.cn", "stats.gov.cn", "who.int", "un.org", "worldbank.org", "imf.org",
	"nist.gov", "nasa.gov", "noaa.gov", "europa.eu", "oecd.org",
}
var tier2Domains = []string{
	"github.com", "wikipedia.org", "stackoverflow.com", "mdn.dev", "developer.mozilla.org",
	"reuters.com", "apnews.com", "bbc.com", "nature.com", "springer.com", "sciencedirect.com",
	"mckinsey.com", "gartner.com", "forrester.com", "stanford.edu", "mit.edu", "harvard.edu",
}

func tierOf(domain string) int {
	for _, d := range tier1Domains {
		if domain == d || strings.HasSuffix(domain, "."+d) {
			return 1
		}
	}
	for _, d := range tier2Domains {
		if domain == d || strings.HasSuffix(domain, "."+d) {
			return 2
		}
	}
	return 3
}

// buildOutline v0.8 STORM 大纲骨架的无 LLM 版: 角度→事实统计+权威分布+主要来源域
func buildOutline(angles []string, facts []Fact) []ResearchOutlineEntry {
	out := make([]ResearchOutlineEntry, 0, len(angles))
	for _, angle := range angles {
		var fs []Fact
		for _, f := range facts {
			if f.Angle == angle {
				fs = append(fs, f)
			}
		}
		domainCount := map[string]int{}
		tier1 := 0
		for _, f := range fs {
			host := hostOf(f.URL)
			if tierOf(host) == 1 {
				tier1++
			}
			domainCount[host]++
		}
		type de struct {
			d string
			n int
		}
		var des []de
		for d, n := range domainCount {
			des = append(des, de{d, n})
		}
		sort.Slice(des, func(i, j int) bool { return des[i].n > des[j].n })
		doms := []string{}
		for i, e := range des {
			if i >= 2 {
				break
			}
			doms = append(doms, e.d)
		}
		out = append(out, ResearchOutlineEntry{Angle: angle, Facts: len(fs), Tier1Facts: tier1, Domains: doms})
	}
	return out
}

// ---------- 状态(journal 事件流即状态, resume 靠 replay) ----------

type ResearchState struct {
	RunID       string
	Query       string
	Angles      []string
	Strict      bool
	Opts        researchBudgets
	Pool        map[string]Reference // normalizedUrl -> ref(带稳定 refId)
	poolOrder   []string             // TS Map 插入序(重建 refs 排序确定性)
	Facts       []Fact
	FetchedURLs map[string]bool
	Loops       []LoopRecord
	StopReason  string
	StopDetail  string
	Report      string
	Stats       ResearchStats
	nextRefID   int
}

func newResearchState(runID string) *ResearchState {
	if runID == "" {
		runID = strconv.FormatInt(time.Now().UnixMilli(), 36) + "-" + randomID8()[:6]
	}
	return &ResearchState{
		RunID:       runID,
		Pool:        map[string]Reference{},
		FetchedURLs: map[string]bool{},
		Opts:        researchBudgets{3, 6, 120, 12, 4},
		nextRefID:   1,
	}
}

func (s *ResearchState) registry() CitationRegistry {
	refs := make([]Reference, 0, len(s.Pool))
	for _, k := range s.poolOrder {
		refs = append(refs, s.Pool[k])
	}
	return buildCitationRegistry(refs)
}

// admitRef 给 ref 分配/确认稳定 refId; 池满(referenceBudget)返回 false
func (s *ResearchState) admitRef(ref Reference) bool {
	u := ref.URL
	if _, ok := s.Pool[u]; ok {
		return true
	}
	if len(s.Pool) >= s.Opts.ReferenceBudget {
		s.Stats.RefBudgetDropped++
		return false
	}
	assigned := ref
	if assigned.RefID == 0 {
		assigned.RefID = s.nextRefID
		s.nextRefID++
	}
	if assigned.RefID >= s.nextRefID {
		s.nextRefID = assigned.RefID + 1
	}
	s.Pool[u] = assigned
	s.poolOrder = append(s.poolOrder, u)
	s.Stats.RefPoolUsed++
	return true
}

// apply replay: 事件→状态(顺序敏感; live 跑与 replay 走同一套赋值逻辑)
func (s *ResearchState) apply(ev map[string]any) {
	getInt := func(k string) int { v, _ := ev[k].(float64); return int(v) }
	getStr := func(k string) string { v, _ := ev[k].(string); return v }
	switch ev["event"] {
	case "start":
		s.Query = getStr("query")
		if raw, ok := ev["angles"].([]any); ok {
			for _, a := range raw {
				if str, ok := a.(string); ok {
					s.Angles = append(s.Angles, str)
				}
			}
		}
		s.Strict, _ = ev["strict"].(bool)
		if raw, ok := ev["opts"].(map[string]any); ok {
			gi := func(k string) int { v, _ := raw[k].(float64); return int(v) }
			s.Opts = researchBudgets{gi("maxLoops"), gi("minFacts"), gi("referenceBudget"), gi("fetchBudget"), gi("fetchPerLoop")}
		}
	case "loop_start":
		lr := LoopRecord{Loop: getInt("loop"), Decision: "CONTINUE"}
		if raw, ok := ev["queries"].([]any); ok {
			for _, q := range raw {
				if m, ok := q.(map[string]any); ok {
					ang, _ := m["angle"].(string)
					qy, _ := m["query"].(string)
					lr.Queries = append(lr.Queries, angleQueryStat{Angle: ang, Query: qy})
				}
			}
		}
		s.Loops = append(s.Loops, lr)
		if l := getInt("loop"); l > s.Stats.Loops {
			s.Stats.Loops = l
		}
	case "angle_done":
		if len(s.Loops) == 0 {
			return
		}
		loop := &s.Loops[len(s.Loops)-1]
		var refs []Reference
		if raw, ok := ev["refs"].([]any); ok {
			b, _ := json.Marshal(raw)
			_ = json.Unmarshal(b, &refs)
		}
		added := 0
		for _, r := range refs {
			before := len(s.Pool)
			if s.admitRef(r) {
				added += len(s.Pool) - before
			}
		}
		loop.Queries = append(loop.Queries, angleQueryStat{
			Angle: getStr("angle"), Query: getStr("query"), Found: getInt("found"), Error: getStr("error")})
		loop.NewURLs += added
	case "angle_error":
		if len(s.Loops) == 0 {
			return
		}
		loop := &s.Loops[len(s.Loops)-1]
		loop.Queries = append(loop.Queries, angleQueryStat{
			Angle: getStr("angle"), Query: getStr("query"), Error: getStr("error")})
		s.Stats.AngleErrors++
	case "fetch_done":
		if len(s.Loops) == 0 {
			return
		}
		loop := &s.Loops[len(s.Loops)-1]
		ref := Reference{}
		if raw, ok := ev["ref"].(map[string]any); ok {
			b, _ := json.Marshal(raw)
			_ = json.Unmarshal(b, &ref)
		}
		s.FetchedURLs[ref.URL] = true
		s.Stats.FetchUsed++
		loop.Fetched++
		domain := hostOf(ref.URL)
		s.Facts = append(s.Facts, Fact{
			RefID: ref.RefID, URL: ref.URL, Title: ref.Title,
			Angle: getStr("angle"), Quote: getStr("quote"),
			Domain: domain, Tier: tierOf(domain), Published: ref.Published,
		})
	case "fetch_error":
		s.Stats.FetchErrors++
	case "reflect":
		if len(s.Loops) > 0 {
			if raw, ok := ev["scores"].(map[string]any); ok {
				b, _ := json.Marshal(raw)
				_ = json.Unmarshal(b, &s.Loops[len(s.Loops)-1].Reflect)
			}
		}
	case "decide":
		if len(s.Loops) > 0 {
			s.Loops[len(s.Loops)-1].Decision = getStr("decision")
		}
	case "stop":
		s.StopReason = getStr("reason")
		s.StopDetail = getStr("detail")
	case "report":
		s.Report = getStr("text")
	case "resume":
		// 标记事件, 不承载状态
	}
}

// ---------- 6 问反思(WorkBuddy[07] 规则化) ----------

func reflectScores(state *ResearchState) ReflectScores {
	facts := state.Facts
	angles := state.Angles
	byAngle := map[string][]Fact{}
	for _, a := range angles {
		byAngle[a] = nil
	}
	for _, f := range facts {
		byAngle[f.Angle] = append(byAngle[f.Angle], f)
	}
	// Q1 事实数量: >=minFacts → 1, 否则线性比例
	q1 := float64(len(facts)) / float64(state.Opts.MinFacts)
	if q1 > 1 {
		q1 = 1
	}
	// Q2 维度覆盖: 每个角度 >=1 事实
	covered := 0
	for _, a := range angles {
		if len(byAngle[a]) >= 1 {
			covered++
		}
	}
	q2 := 0.0
	if len(angles) > 0 {
		q2 = float64(covered) / float64(len(angles))
	}
	// Q3 权威源: Tier1>=1 → 1; Tier2>=1 → 0.5; 否则 0
	q3 := 0.0
	hasT2 := false
	for _, f := range facts {
		if f.Tier == 1 {
			q3 = 1
			break
		}
		if f.Tier == 2 {
			hasT2 = true
		}
	}
	if q3 == 0 && hasT2 {
		q3 = 0.5
	}
	// Q4 时效: 有 <=2 年的 published → 1; 全无日期 → 0.5(中性); 全老 → 0
	q4 := 0.5
	dated := false
	fresh := false
	twoYearsAgo := time.Now().Add(-time.Duration(2 * 365.25 * 24 * 3600 * float64(time.Second)))
	for _, f := range facts {
		if f.Published != "" {
			dated = true
			for _, layout := range []string{time.RFC1123Z, time.RFC1123, "2006-01-02T15:04:05Z07:00", "2006-01-02", "2006-01"} {
				if t, err := time.Parse(layout, f.Published); err == nil {
					if t.After(twoYearsAgo) {
						fresh = true
					}
					break
				}
			}
		}
	}
	if dated {
		if fresh {
			q4 = 1
		} else {
			q4 = 0
		}
	}
	// Q5 多源支撑: >=2 个独立域名支撑的角度占比
	multi := 0
	for _, a := range angles {
		doms := map[string]bool{}
		for _, f := range byAngle[a] {
			doms[f.Domain] = true
		}
		if len(doms) >= 2 {
			multi++
		}
	}
	q5 := 0.0
	if len(angles) > 0 {
		q5 = float64(multi) / float64(len(angles))
	}
	// Q6 可用性: 每角度 >=2 事实(可写 What/Why/Next)的比例
	rich := 0
	for _, a := range angles {
		if len(byAngle[a]) >= 2 {
			rich++
		}
	}
	q6 := 0.0
	if len(angles) > 0 {
		q6 = float64(rich) / float64(len(angles))
	}
	return ReflectScores{q1, q2, q3, q4, q5, q6}
}

func decide(state *ResearchState, scores ReflectScores, loop int) string {
	// strict: 6 问全过(WorkBuddy[07] gap_check_strict)
	if state.Strict {
		pass := scores.Q1Facts >= 1 && scores.Q2Coverage >= 1 && scores.Q3Authority >= 1 &&
			scores.Q4Freshness >= 1 && scores.Q5MultiSrc >= 0.5 && scores.Q6Usable >= 0.6
		if pass {
			return "EXIT"
		}
	} else {
		// relaxed(默认): Q1 事实数 + Q2 维度覆盖 — 硬收敛信号(Q3/Q4 属质量门槛, 免费引擎不保证)
		if scores.Q1Facts >= 1 && scores.Q2Coverage >= 1 {
			return "EXIT"
		}
	}
	if loop >= state.Opts.MaxLoops {
		return "MAX_LOOPS_DEGRADED" // 降级出报告, 不阻塞 [07]
	}
	if state.Stats.FetchUsed >= state.Opts.FetchBudget {
		return "BUDGET_STOP"
	}
	if len(state.Loops) > 0 {
		cur := state.Loops[len(state.Loops)-1]
		if cur.NewURLs == 0 && loop > 1 {
			return "CONVERGED" // 零新 URL → 无新信息
		}
		if len(cur.Queries) > 0 {
			allErr := true
			for _, q := range cur.Queries {
				if q.Error == "" {
					allErr = false
					break
				}
			}
			if allErr {
				return "ALL_ANGLES_FAILED"
			}
		}
	}
	return "CONTINUE"
}

// ---------- Research Loop 主类 ----------

type ResearchLoop struct {
	fetcher *Fetcher
	dir     string
	dataDir string
}

func NewResearchLoop(dataDir string, fetcher *Fetcher) *ResearchLoop {
	return &ResearchLoop{
		fetcher: fetcher,
		dir:     filepath.Join(dataDir, "journal"),
		dataDir: dataDir,
	}
}

func (r *ResearchLoop) filePath(runID string) string {
	return filepath.Join(r.dir, "research-"+runID+".jsonl")
}

func (r *ResearchLoop) append(runID string, ev map[string]any) {
	_ = os.MkdirAll(r.dir, 0o755)
	rec := map[string]any{"ts": time.Now().UnixMilli()}
	for k, v := range ev {
		rec[k] = v
	}
	b, err := json.Marshal(rec)
	if err != nil {
		return
	}
	f, err := os.OpenFile(r.filePath(runID), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return // journal 失败不影响主链路
	}
	defer f.Close()
	_, _ = f.Write(append(b, '\n'))
}

// Run 新开研究
func (r *ResearchLoop) Run(query string, opts ResearchOptions, onEvent func(map[string]any)) (*ResearchResult, error) {
	state := newResearchState("")
	// preset 先于逐字段合并(preset 表 → 默认; 显式 opts 永远最高优先)
	preset := researchPresets[opts.Preset] // report/未知 = 零值 → 落到默认
	maxLoops := firstNonZero(opts.MaxLoops, preset.MaxLoops, 3)
	minFacts := firstNonZero(opts.MinFacts, preset.MinFacts, 6)
	refBudget := firstNonZero(opts.ReferenceBudget, preset.ReferenceBudget, 120)
	fetchBudget := firstNonZero(opts.FetchBudget, preset.FetchBudget, 12)
	fetchPerLoop := firstNonZero(opts.FetchPerLoop, preset.FetchPerLoop, 4)
	state.Opts = researchBudgets{maxLoops, minFacts, refBudget, fetchBudget, fetchPerLoop}
	state.Strict = opts.Strict
	// v0.8 STORM-lite: 缺省按查询信号从角度池选("定义与概念"永远保留)
	state.Angles = opts.Angles
	if len(state.Angles) == 0 {
		state.Angles = selectAngles(query)
	}
	state.Query = query

	r.append(state.RunID, map[string]any{"event": "start", "query": query, "angles": state.Angles, "strict": state.Strict, "opts": state.Opts})
	fireEvent(onEvent, "start", map[string]any{"query": query, "angles": state.Angles, "runId": state.RunID, "strict": state.Strict})

	return r.drive(state, opts, false, onEvent), nil
}

// Resume 断点恢复: replay journal → 继续未完成的循环
func (r *ResearchLoop) Resume(runID string, opts ResearchOptions, onEvent func(map[string]any)) (*ResearchResult, error) {
	path := r.filePath(runID)
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("research run not found: %s", runID)
	}
	state := newResearchState(runID)
	lines := strings.Split(string(raw), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var ev map[string]any
		if json.Unmarshal([]byte(line), &ev) == nil {
			state.apply(ev) // 坏行跳过
		}
	}
	fireEvent(onEvent, "resume", map[string]any{"runId": runID, "events": len(lines), "loopsDone": len(state.Loops)})
	r.append(runID, map[string]any{"event": "resume", "events": len(lines)})

	if state.StopReason != "" && state.Report != "" {
		return r.buildResult(state, true, ""), nil // 已完成: 直接重建结果
	}
	// 覆盖部分参数(预算允许扩大续跑)
	if opts.MaxLoops > state.Opts.MaxLoops {
		state.Opts.MaxLoops = opts.MaxLoops
	}
	if opts.FetchBudget > state.Opts.FetchBudget {
		state.Opts.FetchBudget = opts.FetchBudget
	}
	if opts.ReferenceBudget > state.Opts.ReferenceBudget {
		state.Opts.ReferenceBudget = opts.ReferenceBudget
	}
	return r.drive(state, opts, true, onEvent), nil
}

// drive 状态机驱动: 循环 [角度并行搜索 → 抢 fetch slot → 抽事实 → 反思 → 决策]
func (r *ResearchLoop) drive(state *ResearchState, opts ResearchOptions, resumed bool, onEvent func(map[string]any)) *ResearchResult {
	t0 := time.Now()
	consecutiveAllFail := 0

	for loop := len(state.Loops) + 1; loop <= state.Opts.MaxLoops; loop++ {
		// --- 1. 角度查询生成(loop1 用角度模板; loop2+ 对未覆盖角度追加原始 query 变体) ---
		covered := map[string]bool{}
		for _, f := range state.Facts {
			covered[f.Angle] = true
		}
		type aq struct{ angle, query string }
		angleQueries := make([]aq, 0, len(state.Angles))
		for _, angle := range state.Angles {
			var base string
			for _, tpl := range defaultAngles {
				if tpl.name == angle {
					base = tpl.query(state.Query)
					break
				}
			}
			if base == "" {
				base = state.Query + " " + angle
			}
			if covered[angle] && loop > 1 {
				base = state.Query + " " + angle
			}
			angleQueries = append(angleQueries, aq{angle, base})
		}
		state.Loops = append(state.Loops, LoopRecord{Loop: loop, Decision: "CONTINUE"})
		state.Stats.Loops = loop
		qmetas := []map[string]string{}
		for _, a := range angleQueries {
			qmetas = append(qmetas, map[string]string{"angle": a.angle, "query": a.query})
		}
		r.append(state.RunID, map[string]any{"event": "loop_start", "loop": loop, "queries": qmetas})
		fireEvent(onEvent, "loop_start", map[string]any{"loop": loop, "angles": qmetas})

		// --- 2. 角度并行搜索(单角度失败只降级该角度 — 修 ODR[11] or True 反面教材) ---
		var wg sync.WaitGroup
		var mu sync.Mutex
		results := make([]*struct {
			aq   aq
			refs []Reference
			err  error
		}, len(angleQueries))
		for i, a := range angleQueries {
			wg.Add(1)
			go func(idx int, aa aq) {
				defer wg.Done()
				so := SearchOpts{Query: aa.query, TopN: 30, MaxResults: 10, TimeoutMs: 6000, Freshness: opts.Freshness}
				out := searchFlow(so, so.TimeoutMs)
				mu.Lock()
				defer mu.Unlock()
				if len(out.Refs) == 0 && len(out.EnginesFailed) > 0 && len(out.EnginesUsed) == 0 {
					results[idx] = &struct {
						aq   aq
						refs []Reference
						err  error
					}{aa, nil, fmt.Errorf("all engines failed: %s", strings.Join(out.EnginesFailed, ","))}
					return
				}
				results[idx] = &struct {
					aq   aq
					refs []Reference
					err  error
				}{aa, out.Refs, nil}
			}(i, a)
		}
		wg.Wait()

		for i, res := range results {
			if res != nil && res.err == nil {
				before := len(state.Pool)
				var admitted []Reference
				for _, rr := range res.refs {
					if state.admitRef(rr) {
						admitted = append(admitted, state.Pool[rr.URL])
					}
				}
				added := len(state.Pool) - before
				cur := &state.Loops[len(state.Loops)-1]
				cur.NewURLs += added
				cur.Queries = append(cur.Queries, angleQueryStat{Angle: res.aq.angle, Query: res.aq.query, Found: len(res.refs)})
				r.append(state.RunID, map[string]any{
					"event": "angle_done", "loop": loop, "angle": res.aq.angle, "query": res.aq.query,
					"found": len(res.refs), "added": added, "refs": admitted,
				})
				fireEvent(onEvent, "angle_done", map[string]any{"loop": loop, "angle": res.aq.angle, "found": len(res.refs), "added": added, "poolSize": len(state.Pool)})
			} else {
				aa := angleQueries[i]
				msg := "unknown error"
				if res != nil && res.err != nil {
					msg = res.err.Error()
				}
				state.Stats.AngleErrors++
				state.Loops[len(state.Loops)-1].Queries = append(state.Loops[len(state.Loops)-1].Queries,
					angleQueryStat{Angle: aa.angle, Query: aa.query, Error: truncStr(msg, 200)})
				r.append(state.RunID, map[string]any{"event": "angle_error", "loop": loop, "angle": aa.angle, "query": aa.query, "error": truncStr(msg, 200)})
				fireEvent(onEvent, "angle_error", map[string]any{"loop": loop, "angle": aa.angle, "error": truncStr(msg, 120)})
			}
		}

		// --- 3. fetchSlots: 按 slot 得分抢全文预算(低分先丢, Trae[06] fetchSlots+relRank) ---
		fetchRemaining := state.Opts.FetchBudget - state.Stats.FetchUsed
		perLoop := state.Opts.FetchPerLoop
		if perLoop > fetchRemaining {
			perLoop = fetchRemaining
		}
		slots := r.pickSlots(state, perLoop)
		if len(slots) > 0 {
			type fetchOutcome struct {
				slot slotPick
				fr   FetchResult
				err  error
			}
			outcomes := make([]fetchOutcome, len(slots))
			var fwg sync.WaitGroup
			for i, sl := range slots {
				fwg.Add(1)
				go func(idx int, s slotPick) {
					defer fwg.Done()
					focus := state.Query + " " + s.angle
					policy := r.fetcher.policyFor(domainList(opts.Domains, true), domainList(opts.Domains, false))
					fr := r.fetcher.Run(s.ref.URL, FetchOptions{Focus: focus, MaxChars: 6000, Adjacent: 1}, policy)
					outcomes[idx] = fetchOutcome{s, fr, nil}
				}(i, sl)
			}
			fwg.Wait()
			for _, oc := range outcomes {
				cur := &state.Loops[len(state.Loops)-1]
				state.Stats.FetchUsed++ // 预算按"尝试"计费: 无论成败 slot 都消耗了 [06]
				if oc.err == nil {
					quote := ""
					if len(oc.fr.Segments) > 0 {
						quote = oc.fr.Segments[0]
					} else {
						quote = oc.fr.Text
					}
					quote = strings.TrimSpace(spaceRe.ReplaceAllString(quote, " "))
					quote = truncStr(quote, 300)
					if len([]rune(quote)) < 40 {
						// 引用无实质内容 → 不算事实(WorkBuddy[07]: 无 source/无内容剔除)
						state.Stats.FetchErrors++
						r.append(state.RunID, map[string]any{"event": "fetch_error", "loop": loop, "url": oc.slot.ref.URL, "error": "quote too short after focus"})
						continue
					}
					state.FetchedURLs[oc.slot.ref.URL] = true
					cur.Fetched++
					domain := hostOf(oc.slot.ref.URL)
					state.Facts = append(state.Facts, Fact{
						RefID: oc.slot.ref.RefID, URL: oc.slot.ref.URL, Title: oc.slot.ref.Title,
						Angle: oc.slot.angle, Quote: quote, Domain: domain,
						Tier: tierOf(domain), Published: oc.slot.ref.Published,
					})
					r.append(state.RunID, map[string]any{
						"event": "fetch_done", "loop": loop, "angle": oc.slot.angle,
						"ref": oc.slot.ref, "quote": quote,
					})
					fireEvent(onEvent, "fetch_done", map[string]any{"loop": loop, "angle": oc.slot.angle, "url": oc.slot.ref.URL, "refId": oc.slot.ref.RefID})
				} else {
					state.Stats.FetchErrors++
					r.append(state.RunID, map[string]any{"event": "fetch_error", "loop": loop, "url": "unknown", "error": truncStr(oc.err.Error(), 200)})
				}
			}
		}

		// --- 4. 反思(6 问) + 决策 ---
		scores := reflectScores(state)
		state.Loops[len(state.Loops)-1].Reflect = scores
		r.append(state.RunID, map[string]any{"event": "reflect", "loop": loop, "scores": scores})
		fireEvent(onEvent, "reflect", map[string]any{"loop": loop, "scores": scores, "facts": len(state.Facts), "pool": len(state.Pool)})

		decision := decide(state, scores, loop)
		state.Loops[len(state.Loops)-1].Decision = decision
		r.append(state.RunID, map[string]any{"event": "decide", "loop": loop, "decision": decision})
		fireEvent(onEvent, "decide", map[string]any{"loop": loop, "decision": decision})

		allFailed := false
		if cur := state.Loops[len(state.Loops)-1]; len(cur.Queries) > 0 {
			allFailed = true
			for _, q := range cur.Queries {
				if q.Error == "" {
					allFailed = false
					break
				}
			}
		}
		if allFailed {
			consecutiveAllFail++
		} else {
			consecutiveAllFail = 0
		}

		stopMap := map[string]string{
			"EXIT": "converged", "MAX_LOOPS_DEGRADED": "max_loops", "BUDGET_STOP": "budget",
			"CONVERGED": "converged", "ALL_ANGLES_FAILED": "", "CONTINUE": "",
		}
		reason := stopMap[decision]
		if reason != "" {
			detail := ""
			switch decision {
			case "MAX_LOOPS_DEGRADED":
				detail = fmt.Sprintf("max_loops=%d reached; degraded output with %d facts [07]", state.Opts.MaxLoops, len(state.Facts))
			case "BUDGET_STOP":
				detail = fmt.Sprintf("fetch budget %d exhausted; %d facts from %d refs", state.Opts.FetchBudget, len(state.Facts), len(state.Pool))
			case "CONVERGED":
				detail = fmt.Sprintf("no new urls in loop %d; %d facts", loop, len(state.Facts))
			default:
				detail = fmt.Sprintf("reflection passed (%s); %d facts", map[bool]string{true: "strict", false: "relaxed"}[state.Strict], len(state.Facts))
			}
			state.StopReason, state.StopDetail = reason, detail
			r.append(state.RunID, map[string]any{"event": "stop", "reason": reason, "detail": detail})
			fireEvent(onEvent, "stop", map[string]any{"reason": reason, "detail": detail})
			break
		}
		if consecutiveAllFail >= 2 {
			state.StopReason = "all_angles_failed"
			state.StopDetail = fmt.Sprintf("all angle searches failed in %d consecutive loops; engines likely blocked/network down; %d facts so far", consecutiveAllFail, len(state.Facts))
			r.append(state.RunID, map[string]any{"event": "stop", "reason": state.StopReason, "detail": state.StopDetail})
			fireEvent(onEvent, "stop", map[string]any{"reason": state.StopReason, "detail": state.StopDetail})
			break
		}
	}

	if state.StopReason == "" {
		if len(state.Facts) > 0 {
			state.StopReason = "max_loops"
		} else {
			state.StopReason = "all_angles_failed"
		}
		state.StopDetail = fmt.Sprintf("loop budget reached after resume/limits; %d facts", len(state.Facts))
		r.append(state.RunID, map[string]any{"event": "stop", "reason": state.StopReason, "detail": state.StopDetail})
	}

	state.Stats.ElapsedMs = time.Since(t0).Milliseconds()
	report := r.synthesize(state, onEvent)
	return r.buildResult(state, resumed, report)
}

type slotPick struct {
	ref       Reference
	angle     string
	slotScore float64
}

// pickSlots 覆盖率感知的公平轮转(Trae[06] fetchSlots+relRank 的覆盖增强版):
// 每个角度的候选按 slotScore 降序排队; 轮转从各队列各取一个, 直到填满 count。
// slotScore = 词法相关(query+angle)×2 + 多引擎佐证 + 头部排名加成
func (r *ResearchLoop) pickSlots(state *ResearchState, count int) []slotPick {
	if count <= 0 {
		return nil
	}
	byAngle := map[string][]slotPick{}
	for _, angle := range state.Angles {
		byAngle[angle] = nil
	}
	for _, k := range state.poolOrder {
		ref := state.Pool[k]
		if state.FetchedURLs[ref.URL] || ref.RefID == 0 {
			continue
		}
		bestAngle := state.Angles[0]
		if bestAngle == "" {
			bestAngle = "general"
		}
		bestScore := -1.0
		for _, angle := range state.Angles {
			s := lexicalScore(state.Query+" "+angle, ref.Title, ref.Snippet)
			if s > bestScore {
				bestScore = s
				bestAngle = angle
			}
		}
		multiBoost := 0.0
		if len(ref.Engines) > 1 {
			multiBoost = 0.15
		}
		rankBoost := 0.0
		if ref.Rank > 0 && ref.Rank <= 5 {
			rankBoost = 0.1
		}
		byAngle[bestAngle] = append(byAngle[bestAngle], slotPick{ref, bestAngle, bestScore*2 + multiBoost + rankBoost})
	}
	for _, q := range byAngle {
		sort.SliceStable(q, func(i, j int) bool { return q[i].slotScore > q[j].slotScore })
	}
	// 轮转弹取: 每轮各队列出队一个
	var picked []slotPick
	round := 0
	for len(picked) < count {
		progressed := false
		for _, angle := range state.Angles {
			if len(picked) >= count {
				break
			}
			q := byAngle[angle]
			if len(q) > round {
				picked = append(picked, q[round])
				progressed = true
			}
		}
		if !progressed {
			break
		}
		round++
	}
	return picked
}

// synthesize 结构化 markdown + 出口校验 — [n] 100% 可回溯(验收口径)
func (r *ResearchLoop) synthesize(state *ResearchState, onEvent func(map[string]any)) string {
	registry := state.registry()
	text := r.defaultReport(state)
	// 出口校验: 先 strict; 失败降级 strip + 标注
	validated, audit, err := enforceCitations(text, registry, true)
	if err != nil {
		stripped, audit2, _ := enforceCitations(text, registry, false)
		validated = stripped + fmt.Sprintf("\n\n> ⚠ 引用出口校验: 剔除未注册引用 [%s](幻觉引用零容忍)\n", intJoin(audit2.Unknown, ","))
		audit = audit2
	}
	_ = audit
	state.Report = validated
	r.append(state.RunID, map[string]any{"event": "report", "text": validated, "chars": len([]rune(validated))})
	fireEvent(onEvent, "report", map[string]any{"chars": len([]rune(validated))})
	return validated
}

func (r *ResearchLoop) defaultReport(state *ResearchState) string {
	byAngle := map[string][]Fact{}
	for _, a := range state.Angles {
		byAngle[a] = nil
	}
	for _, f := range state.Facts {
		byAngle[f.Angle] = append(byAngle[f.Angle], f)
	}
	var lines []string
	lines = append(lines, "# 研究报告: "+state.Query, "")
	last := (*LoopRecord)(nil)
	if len(state.Loops) > 0 {
		last = &state.Loops[len(state.Loops)-1]
	}
	hdr := fmt.Sprintf("> 轮数 %d | 事实 %d 条 / 引用池 %d | 停止: %s (%s) | ",
		len(state.Loops), len(state.Facts), len(state.Pool), state.StopReason, state.StopDetail)
	if last != nil {
		hdr += fmt.Sprintf("反思 Q1=%.2f Q2=%.2f Q3=%.2f Q4=%.2f Q5=%.2f Q6=%.2f",
			last.Reflect.Q1Facts, last.Reflect.Q2Coverage, last.Reflect.Q3Authority,
			last.Reflect.Q4Freshness, last.Reflect.Q5MultiSrc, last.Reflect.Q6Usable)
	}
	lines = append(lines, hdr, "")
	for _, angle := range state.Angles {
		fs := byAngle[angle]
		lines = append(lines, "## "+angle)
		if len(fs) == 0 {
			lines = append(lines, "- (本角度未获得可引用事实 — 覆盖缺口,见反思 Q2)")
		} else {
			for _, f := range fs {
				lines = append(lines, fmt.Sprintf("- %s [%d]", f.Quote, f.RefID))
			}
		}
		lines = append(lines, "")
	}
	lines = append(lines, "## 引用", renderCitations(state.registry()))
	return joinLines(lines)
}

func (r *ResearchLoop) buildResult(state *ResearchState, resumed bool, report string) *ResearchResult {
	refs := make([]Reference, 0, len(state.Pool))
	for _, k := range state.poolOrder {
		refs = append(refs, state.Pool[k])
	}
	sort.SliceStable(refs, func(i, j int) bool { return refs[i].RefID < refs[j].RefID })
	registry := state.registry()
	// registry → [id, {url,title}] 元组数组(TS 形状)
	ids := make([]int, 0, len(registry))
	for id := range registry {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	regArr := make([][2]any, 0, len(ids))
	for _, id := range ids {
		regArr = append(regArr, [2]any{id, map[string]string{"url": registry[id].URL, "title": registry[id].Title}})
	}
	if report == "" && state.Report != "" {
		report = state.Report
	}
	if report == "" {
		report = r.defaultReport(state)
	}
	res := &ResearchResult{
		RunID: state.RunID, Resumed: resumed, Query: state.Query, Angles: state.Angles,
		Facts: state.Facts, Refs: refs, Loops: state.Loops, Report: report,
		Registry: regArr, Strict: state.Strict, Stats: state.Stats,
		JournalPath: r.filePath(state.RunID),
		Outline:     buildOutline(state.Angles, state.Facts),
	}
	res.Stop.Reason = state.StopReason
	res.Stop.Detail = state.StopDetail
	return res
}

// ---------- 小工具 ----------

var spaceRe = regexp.MustCompile(`\s+`)

func fireEvent(onEvent func(map[string]any), typ string, data map[string]any) {
	if onEvent == nil {
		return
	}
	ev := map[string]any{"type": typ}
	for k, v := range data {
		ev[k] = v
	}
	onEvent(ev)
}

func firstNonZero(vals ...int) int {
	for _, v := range vals {
		if v != 0 {
			return v
		}
	}
	return 0
}

func domainList(d *struct {
	Allow []string `json:"allow,omitempty"`
	Block []string `json:"block,omitempty"`
}, wantBlock bool) []string {
	if d == nil {
		return nil
	}
	if wantBlock {
		return d.Block
	}
	return d.Allow
}

func intJoin(xs []int, sep string) string {
	parts := make([]string, len(xs))
	for i, x := range xs {
		parts[i] = strconv.Itoa(x)
	}
	return joinLines(parts)
}

func joinLines(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += "\n"
		}
		out += p
	}
	return out
}
