package main

// 类型层: 与 TS 版 core/src/types.ts + fusion 输出形状对齐(JSON 字段名兼容)

// Reference 对齐 TS Reference(搜索面通用引用)
type Reference struct {
	URL     string   `json:"url"`
	Title   string   `json:"title"`
	Snippet string   `json:"snippet"`
	Engines []string `json:"engines"`
	// 融合后附加字段
	Score     float64 `json:"score,omitempty"`
	BestRank  int     `json:"bestRank,omitempty"`
	Published string  `json:"published,omitempty"`
	Kind      string  `json:"kind,omitempty"`
	// v3 权威层字段(对齐 TS Reference 扩展)
	Authority        string `json:"authority,omitempty"`
	SourceKind       string `json:"sourceKind,omitempty"`
	Spam             string `json:"spam,omitempty"`
	AuthorityGuarded bool   `json:"authorityGuarded,omitempty"`
	Rank             int    `json:"rank,omitempty"`
	RefID            int    `json:"refId,omitempty"`
}

// SearchOpts 对齐 TS SearchOptions 子集(P1 范围)
type SearchOpts struct {
	Query      string
	Lang       string   // zh-CN/en-US 取主语言码; 缺省 en
	TopN       int      // 融合后输出条数(TS 默认 20)
	MaxResults int      // 每车道条数(TS 默认 10)
	Engines    []string // 车道子集; 空=全部注册车道
	Freshness  string   // day/week/month/year; any=不限
	TimeoutMs  int      // 每腿软截止(对齐 TS softDeadline 默认 6000)
}

// SearchCtx 车道执行上下文
type SearchCtx struct {
	Opts SearchOpts
}

// Output JSON 输出形状(与 TS search --json 可对照)
type Output struct {
	Query         string      `json:"query"`
	Refs          []Reference `json:"refs"`
	EnginesUsed   []string    `json:"enginesUsed"`
	EnginesFailed []string    `json:"enginesFailed"`
	ElapsedMs     int64       `json:"elapsedMs"`
	Poc           string      `json:"poc"`
	Meta          OutputMeta  `json:"meta"`
}

type OutputMeta struct {
	SpamBlocked      int    `json:"spamBlocked"`
	AuthorityGuarded int    `json:"authorityGuarded"`
	DedupMerged      int    `json:"dedupMerged"`
	Embedder         string `json:"embedder"`
	FromCache        bool   `json:"fromCache,omitempty"`
	Degraded         bool   `json:"degraded,omitempty"`
}

// clampText 对齐 TS clampText: 按 rune 截断
func clampText(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
