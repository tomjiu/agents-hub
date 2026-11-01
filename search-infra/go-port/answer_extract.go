package main

// answer_extract.go — 批 19: 轻量答案抽取层 (b17/b18 挂账项转正)
//
// 外部基准 miss 归因实锤(NQ 49 题): ~12% 是"top1 相关但 datum 在正文不在摘要" —
// 通用 web 腿的质量上限, 除非把答案从正文搬到摘要。本层在 fusion 之后对 top-N
// refs 并行抓正文(extractHtml 剔除 script/nav 模板噪声), 切句后选"含最多查询
// 内容词的句子"注入对应 ref 的 Snippet 尾部 — 用户直接看到含答案的句子。
//
// 触发条件(延迟保护): 问句形态(疑问词开头/含疑问词/? 结尾)或实体意图词查询 —
// 关键词式查询( bench 题库主流)结果页 title/snippet 已含词面, 抓正文无增量价值。
// 预算: 每页 3.5s timeout, top-N 并行, 总墙钟增量 ≤3.5s(并行窗口不随页数增长);
// fetcher 页面缓存(900s) 对同 URL 二次抓取免费。SC_ANSWER_PASS=0 关闭(评测对比用)。
//
// 批 21: top-3 → top-5 (SC_ANSWER_TOPN 可调, 缺省 5)。
// 依据 b20 dump 实测: NQ hit@3→hit@5 还有 ~9pp 存量(gold 在 rank4-5), 且 miss 归因
// "证据在正文"~12% 中相当部分落在 rank4-5 的正文里 — 多抓 2 页并行成本≈0, 直接吃这块。

import (
        "context"
        "net/http"
        "regexp"
        "strconv"
        "strings"
        "sync"
        "unicode"
)

// b19 问句检测: NQ/TriviaQA 全量问句; 77 题库约 1/3 问句。中文疑问词对齐 b12 意图族。
var b19QuestionRe = regexp.MustCompile(`(?i)\b(what|who|whom|whose|when|where|which|how|why)\b|\?$|是谁|是什么|多少|哪里|哪些|哪年|几岁|何时|何地|怎么`)

// 句子切分: Go RE2 无 lookbehind, 用"句末标点后插换行"标记法。
// 英文缩写误切可接受(评分兜底), 中英句号/问叹号全覆盖。
var b19SentBoundary = regexp.MustCompile(`([.!?。！？]+)\s+|([。！？]+)`)

func b19SplitSentences(text string) []string {
        return strings.Split(b19SentBoundary.ReplaceAllString(text, "$1$2\n"), "\n")
}

const (
        b19PageTimeout = 3500 // 每页 ms
        b19MinCover    = 2    // 内容词覆盖下限(防噪声句混入)
)

// b21 答案抓取页数: 缺省 5(top-5 并行, 墙钟仍 ≤3.5s); SC_ANSWER_TOPN 覆盖
// (评测回放 b19=3, 上限 8 防上游压力); 非法值回退 5。SC_ANSWER_PASS=0 时整体关闭。
func b19AnswerPages() int {
        n := 5
        if v := strings.TrimSpace(osGetenv2("SC_ANSWER_TOPN")); v != "" {
                if p, err := strconv.Atoi(v); err == nil && p >= 1 && p <= 8 {
                        n = p
                }
        }
        return n
}

// 句长阈值: CJK 信息密度高(15-20 字 ≈ 英文 40 字符), 按 rune 计且含 CJK 时阈值减半。
const (
        b19MinSentenceLatin = 40
        b19MinSentenceCJK   = 15
        b19MaxSentenceRune  = 300
)

func b19SentenceLenOk(s string) bool {
        r := []rune(s)
        if len(r) > b19MaxSentenceRune {
                return false
        }
        hasCJK := false
        for _, c := range r {
                if c >= 0x2E80 && c <= 0x9FFF {
                        hasCJK = true
                        break
                }
        }
        min := b19MinSentenceLatin
        if hasCJK {
                min = b19MinSentenceCJK
        }
        return len(r) >= min
}

func b19IsQuestionQuery(q string) bool {
        return b19QuestionRe.MatchString(q)
}

// b19BestSentence 选正文里与查询最相关的句子。评分 = 内容词覆盖 +
// 专名/数字奖励(gold 答案多为专名/年份/数字 — "48 Hrs."/"1982" 类 token 是
// 答案载体, 同义改写句(debut vs first movie)靠此胜出); 平手取更短(信息密度)。
// b33: 引文/日期串样板句(b19IsBoilerplate)先跳过再选句。
// b34: 表格感知行候选(b19RowCandidates) — 短行单元格 run 成行后同闸竞争。
// 返回 "" 表示无可注入句(覆盖率都不达标)。
func b19BestSentence(text, query string) string {
        terms := uniqueTerms(tokenize(query))
        if len(terms) == 0 {
                return ""
        }
        sents := b19SplitSentences(text)
        // b34: 数据表行候选与普通句同池竞争(生成期已过行级准入: 数字行锚+查询词覆盖)
        sents = append(sents, b19RowCandidates(sents, terms)...)
        best, bestScore := "", 0.0
        for _, raw := range sents {
                s := strings.TrimSpace(raw)
                if !b19SentenceLenOk(s) {
                        continue
                }
                // b33: 引文/日期串样板句不参与选句(数字奖励 exploit, b32 tibbs 案:
                // Jet 引文行 10 个日期 token = 10.0 分 cover=0 压过答案句 6.25)
                if b19IsBoilerplate(s) {
                        continue
                }
                ls := strings.ToLower(s)
                score := 0.0
                for _, t := range terms {
                        // 词中匹配(句子本身): CJK bigram 与英文 token 通吃(b15 bigram 语义对齐);
                        // 不能用全文 norm 兜底 — 句子外的词命中是虚高, 会选出跑题句
                        if strings.Contains(ls, t) {
                                score++
                        }
                }
                // CJK 查询 bigram 交集天然稀疏(7 字 query→6 bigram, 答案句常仅含 1 个), 覆盖下限降为 1
                minCover := b19MinCover
                if allTermsCJK(terms) {
                        minCover = 1
                }
                // 专名/数字奖励: 英文大写开头 token(非句首)计 0.25, 纯数字 token 计 1.0。
                // 用 splitRe 原样切(tokenize 会 ToLower, 大小写信号丢失)。
                // 奖励计入总分后再过门槛 — 覆盖 1 但带答案载体的句子(debut/年份句)
                // 是首选注入目标, 不能被裸覆盖门槛拦截。
                toks := splitRe.Split(s, -1)
                for i, tk := range toks {
                        if tk == "" {
                                continue
                        }
                        if i > 0 && len(tk) > 2 && tk[0] >= 'A' && tk[0] <= 'Z' {
                                score += 0.25
                        } else if isAllDigits(tk) {
                                score += 1.0 // 数字是最强 gold 载体(年份/日期/计数), 权重最高
                        }
                }
                if score < float64(minCover) {
                        continue
                }
                if score > bestScore || (score == bestScore && len(s) < len(best)) {
                        best, bestScore = s, score
                }
        }
        return best
}

// b19IsBoilerplate 引文/日期串列表形态检测(b33 样板句惩罚)。
// 机制: 数字/专名奖励无上限, 百科 Sources 行/参考文献行/奖项行等列表形态句
// 以奖励 token 刷分, cover=0 也能过闸压过含答案句(b32 tibbs 案: Jet 引文行 10.0
// vs 答案句 6.25; 实弹第二轮 Awards 行 prose 夹年份同病)。两类可审计判据:
//   1) 数字主导列表: 纯数字 token >= 3 且多于含字母内容词(rune>=3)
//      — 纯日期串("June 14, 1993; ...")/文献卷期行
//   2) 分号链式列表: 分号 >= 2 — 引文/奖项/credits 块的链式结构
//      ("Awards: ... (1981); ... (1981); ...")
// 载体句(1-2 个数字 + 无链式 prose)不受影响 — b32 canonical 11 案胜选句
// 分号全 0 逐案核过(commonwealth "2026 Victoria" 句必须不跳, 跳了反交付旧 gold)。
// 既有测试 48hrs 载体句(1982/48 两数字)天然回归锚。
func b19IsBoilerplate(s string) bool {
        if strings.Count(s, ";")+strings.Count(s, "；") >= 2 {
                return true
        }
        toks := splitRe.Split(s, -1)
        digits, alpha := 0, 0
        for _, tk := range toks {
                if tk == "" {
                        continue
                }
                if isAllDigits(tk) {
                        digits++
                        continue
                }
                if len([]rune(tk)) < 3 {
                        continue
                }
                for _, c := range tk {
                        if unicode.IsLetter(c) {
                                alpha++
                                break
                        }
                }
        }
        return digits >= 3 && digits > alpha
}

// b19IsCellLine 表格单元格形态: 短行(< min 长度阈)且无句末标点。
// 表头/目录/导航碎行同形态 — 由 b19RowCandidates 的数据表锚(纯数字行)排除。
func b19IsCellLine(s string) bool {
        r := []rune(s)
        if len(r) == 0 || len(r) >= b19MinSentenceLatin {
                return false
        }
        return !strings.ContainsAny(s, ".!?。！？")
}

// b19RowCandidates b34 表格感知: 连续 cell-like 短行 run(≥2 行) join 为行候选。
// 设计探针定稿(b34-design-probe.json): 朴素 run 成行会放页头/目录 run 入池
// (grokipedia "[35][31]·Solo Career Trajectory·..." score 5.25 cover=0 会污染页面),
// 故行级准入两把尺(在既有 lenOk/样板/评分闸之上):
//   1) 数据表锚: run 含 ≥1 纯数字行(唱片年表/统计表的年份列形态; 页头/TOC 无独立数字行)
//   2) 行含 ≥1 查询词(反数字刷分, b33 样板句血统: cover=0 的引用行/坐标行不入场)
// 超长 run 贪心按 300r(chunk) 切行, 与句长闸同限。CJK 纯表格无数字行为已知盲区
// (评测语料 EN-only, 记档观察项)。
func b19RowCandidates(sents []string, terms []string) []string {
        out := []string{}
        run := []string{}
        hasDigitLine := false
        rowHasTerm := func(row string) bool {
                ls := strings.ToLower(row)
                for _, t := range terms {
                        if strings.Contains(ls, t) {
                                return true
                        }
                }
                return false
        }
        emit := func(row string) {
                if row != "" && rowHasTerm(row) {
                        out = append(out, row)
                }
        }
        flush := func() {
                defer func() {
                        run = run[:0]
                        hasDigitLine = false
                }()
                if len(run) < 2 || !hasDigitLine {
                        return
                }
                row := ""
                for _, ln := range run {
                        if row == "" {
                                row = ln
                        } else if len([]rune(row))+3+len([]rune(ln)) <= b19MaxSentenceRune {
                                row = row + " · " + ln
                        } else {
                                emit(row)
                                row = ln
                        }
                }
                emit(row)
        }
        for _, raw := range sents {
                s := strings.TrimSpace(raw)
                if !b19IsCellLine(s) {
                        if len(run) > 0 {
                                flush()
                        }
                        continue
                }
                for _, tk := range splitRe.Split(s, -1) {
                        if isAllDigits(tk) {
                                hasDigitLine = true
                                break
                        }
                }
                run = append(run, s)
        }
        flush()
        return out
}

func isAllDigits(s string) bool {
        if s == "" {
                return false
        }
        for _, c := range s {
                if c < '0' || c > '9' {
                        return false
                }
        }
        return true
}

// allTermsCJK: terms 全部含 CJK rune(中文查询判定, bigram 词面)
func allTermsCJK(terms []string) bool {
        for _, t := range terms {
                hasCJK := false
                for _, c := range t {
                        if c >= 0x2E80 && c <= 0x9FFF {
                                hasCJK = true
                                break
                        }
                }
                if !hasCJK {
                        return false
                }
        }
        return true
}

// b19AnswerPass 主入口。失败全静默(抽取是增强, 不阻塞交付)。
// 走 Fetcher.Run: 复用其 extractHtml 正文链 + 进程内/SQLite 双层页缓存(900s TTL),
// 同 URL 二次抓取免费; fetch error 时 Run 返回 Text="fetch error: ..." 前缀 — 过滤。
func b19AnswerPass(ctx context.Context, client *http.Client, fetcher *Fetcher, refs []Reference, query string) []Reference {
        if osGetenv2("SC_ANSWER_PASS") == "0" {
                return refs
        }
        if len(refs) == 0 || !b19IsQuestionQuery(query) {
                return refs
        }
        n := len(refs)
        if m := b19AnswerPages(); n > m {
                n = m
        }
        var mu sync.Mutex
        var wg sync.WaitGroup
        for i := 0; i < n; i++ {
                u := refs[i].URL
                if !strings.HasPrefix(u, "http") {
                        continue
                }
                wg.Add(1)
                go func(idx int, url string) {
                        defer wg.Done()
                        res := fetcher.Run(url, FetchOptions{MaxChars: 12000, TTLSeconds: 900}, fetcher.policyFor(nil, nil))
                        if res.Status != 200 || res.Text == "" || strings.HasPrefix(res.Text, "fetch error") {
                                return
                        }
                        if s := b19BestSentence(res.Text, query); s != "" {
                                mu.Lock()
                                // b23 v2: 非破坏式追加 — v1(截基底预留空间)实测把注入价值归零
                                // (ON==OFF 逐位相同): 基底尾部的证据 token 被截掉, 得不偿失。
                                // 改为基底完整保留 + 上限 400→560 放宽, 只在 base+s>560 时
                                // 截 s 尾部(答案句头部通常已含载体 token)。
                                base := strings.TrimSpace(refs[idx].Snippet)
                                if !strings.Contains(base, s) {
                                        refs[idx].Snippet = clampText(base+" · "+s, 560)
                                }
                                mu.Unlock()
                        }
                }(i, u)
        }
        wg.Wait()
        return refs
}

var _ = context.Background // ctx 预留(未来 per-page ctx 链路)
var _ = http.DefaultClient // 同上
