package main

// b32: b19 漏抓归因重放 harness。
//
// 背景: b31 D 桶正文层探针发现 11 条 D1(探针独立抓 rank1-3 正文, eval 匹配器逐字判定
// 正文含 gold, 但产品交付的 snippet 无答案)。本 harness 用产品同一条 b19 链路对这 11 条
// 逐 URL 精确重放, 回答"抽取为何没命中":
//
//      产品精确路径: loadFetchConfig()(缺省 UA=search-core/0.5) + Fetcher.Run(
//        MaxChars=12000, TTLSeconds=900, policyFor(nil,nil) — 与 b19AnswerPass 逐参一致)
//      判定语义:    与 eval matchEvidence 逐字一致(verbatim len>1 / tokenAND 停用词表)
//      诊断维度:    全文(MaxChars=1e6)定位 12k 窗口截断; b19SplitSentences+b19SentenceLenOk
//                   逐句解剖含答案句被哪道闸门拒(句长/覆盖/切句形状/选句竞争/560 clamp);
//                   browser-UA(b31 probe 同串)复抓量化 403 解锁墙。
//
// 归因桶: C1 抓取墙 / B4 12k窗口 / B2 切句形状 / B2a 句长门槛 / B2b 覆盖门槛 /
//         B1 选句竞争 / B3 560clamp截断 / X 重放会命中(时点漂移)
//
// 门禁: 缺省 t.Skip — SC_B19_REPLAY=1 才发网络请求(常规 go test 零外呼)。
// 输入: SC_B19_REPLAY_CASES (缺省 scripts/b19-miss-cases-b32.json,
//       由 scripts/b19-miss-attribution.mjs 从 b31 probe × b30 dump 对拍生成)
// 输出: SC_B19_REPLAY_OUT (缺省 scripts/b19-replay-b32.json)

import (
        "encoding/json"
        "os"
        "strings"
        "testing"
        "time"
)

const b32BrowserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

type b32Case struct {
        Dataset     string   `json:"dataset"`
        Q           string   `json:"q"`
        URL         string   `json:"url"`
        Rank        int      `json:"rank"`
        Sub         string   `json:"sub"`
        Answers     []string `json:"answers"`
        ProbeAns    string   `json:"probeAns"`
        ProbeType   string   `json:"probeType"`
        DumpSnippet string   `json:"dumpSnippet"`
}

type b32Sent struct {
        Text    string  `json:"text"`
        Runes   int     `json:"runes"`
        Cover   int     `json:"cover"`
        Score   float64 `json:"score"` // 产品闸门条件: cover + 专名0.25/数字1.0(b19BestSentence 内部逻辑 1:1 镜像)
        LenOK   bool    `json:"lenOk"`
        CoverOK bool    `json:"coverOk"` // score >= minCover — 与产品过闸条件一致, 非纯 cover
        Boiler  bool    `json:"boiler,omitempty"` // b33: 引文/日期串样板句 — 产品先跳过再选句
}

// b32SentenceScore: b19BestSentence 内部评分镜像(专名/数字奖励计入总分后再过门槛)。
// 与产品唯一的差异风险=tokenize 细节 — terms 由调用方用产品 tokenize 产出, 此处零再实现。
func b32SentenceScore(s string, terms []string) (float64, int) {
        ls := strings.ToLower(s)
        score := 0.0
        cover := 0
        for _, t := range terms {
                if strings.Contains(ls, t) {
                        score++
                        cover++
                }
        }
        toks := splitRe.Split(s, -1)
        for i, tk := range toks {
                if tk == "" {
                        continue
                }
                if i > 0 && len(tk) > 2 && tk[0] >= 'A' && tk[0] <= 'Z' {
                        score += 0.25
                } else if isAllDigits(tk) {
                        score += 1.0
                }
        }
        return score, cover
}

type b32Rec struct {
        Dataset  string `json:"dataset"`
        Q        string `json:"q"`
        URL      string `json:"url"`
        Rank     int    `json:"rank"`
        Sub      string `json:"sub"`
        ProbeAns string `json:"probeAns"`
        // 产品链路重放
        Status       int    `json:"status"`
        ErrText      string `json:"errText,omitempty"`
        TextLen      int    `json:"textLen"`
        CappedHasAns bool   `json:"cappedHasAns"`
        // 全文窗口
        FullTextLen     int    `json:"fullTextLen"`
        FullHasAns      bool   `json:"fullHasAns"`
        FullHasProbeAns bool   `json:"fullHasProbeAns"`
        AnsOffset       int    `json:"ansOffset"`
        // b19 抽取重放
        BestSentence   string    `json:"bestSentence,omitempty"`
        BestHasAns     bool      `json:"bestHasAns"`
        InjectNoop     bool      `json:"injectNoop,omitempty"`
        InjectedSim    string    `json:"injectedSim,omitempty"`
        InjectedHasAns bool      `json:"injectedHasAns"`
        AnswerSents    []b32Sent `json:"answerSents,omitempty"`
        // 归因
        Bucket string `json:"bucket"`
        // C1 时的 UA 解锁复抓
        UAStatus         int    `json:"uaStatus,omitempty"`
        UATextLen        int    `json:"uaTextLen,omitempty"`
        UnlockBestHasAns *bool  `json:"unlockBestHasAns,omitempty"`
        UnlockBucket     string `json:"unlockBucket,omitempty"`
}

// b32 STOP 表与 eval-external-dump.mjs 逐字一致
var b32Stop = map[string]bool{"one": true, "two": true, "three": true, "four": true, "five": true,
        "six": true, "seven": true, "eight": true, "nine": true, "ten": true,
        "season": true, "seasons": true, "episode": true, "episodes": true,
        "the": true, "and": true, "was": true, "were": true, "has": true, "have": true, "had": true}

// b32AnsIn: matchEvidence 的 Go 镜像 — verbatim 优先(len>1 小写子串), 再 tokenAND。
// 返回 (probeAns 命中, 任一 gold 变体命中)。
func b32AnsIn(hay, probeAns string, answers []string) (bool, bool) {
        hl := strings.ToLower(hay)
        probe := false
        if p := strings.ToLower(probeAns); len([]rune(p)) > 1 && strings.Contains(hl, p) {
                probe = true
        }
        any := false
        for _, a := range answers {
                al := strings.ToLower(a)
                if len([]rune(al)) > 1 && strings.Contains(hl, al) {
                        any = true
                        break
                }
        }
        if !any {
                // tokenAND 回退(与 eval 语义一致)
                for _, a := range answers {
                        al := strings.ToLower(a)
                        toks := splitRe.Split(al, -1)
                        ft := []string{}
                        for _, t := range toks {
                                if t == "" {
                                        continue
                                }
                                if (len([]rune(t)) >= 4 && !b32Stop[t]) || isAllDigits(t) {
                                        ft = append(ft, t)
                                }
                        }
                        if len(ft) == 0 {
                                continue
                        }
                        ok := true
                        for _, t := range ft {
                                if !strings.Contains(hl, t) {
                                        ok = false
                                        break
                                }
                        }
                        if ok {
                                any = true
                                break
                        }
                }
        }
        return probe, any
}

// b32Diagnose: 对给定正文重放 b19 抽取并归因。isCapped=true 表示 text 是 12k 产品窗口。
func b32Diagnose(text string, isCapped bool, c b32Case, rec *b32Rec) {
        terms := uniqueTerms(tokenize(c.Q))
        rec.TextLen = len([]rune(text))
        rec.CappedHasAns = func() bool { p, a := b32AnsIn(text, c.ProbeAns, c.Answers); _ = p; return a }()

        // b19 选句重放
        best := b19BestSentence(text, c.Q)
        rec.BestSentence = best
        if best != "" {
                p, a := b32AnsIn(best, c.ProbeAns, c.Answers)
                rec.BestHasAns = p || a
                // 注入模拟: b23 v2 语义 — base 完整保留 + " · " + s, clamp 560; base 已含 s 则不动。
                // InjectNoop: base 自身 ≥560 时 clamp 截尾=注入完全无效(b23 v2 代码语义, 560ch 基底实弹在案)
                base := strings.TrimSpace(c.DumpSnippet)
                sim := base
                if !strings.Contains(base, best) {
                        sim = clampText(base+" · "+best, 560)
                }
                rec.InjectNoop = base != "" && len([]rune(base)) >= 560 && sim == base
                rec.InjectedSim = sim
                _, rec.InjectedHasAns = b32AnsIn(sim, c.ProbeAns, c.Answers)
        }

        // 含答案句逐句解剖(以 probeAns 为主, 任一变体兜底)
        pl := strings.ToLower(c.ProbeAns)
        for _, raw := range b19SplitSentences(text) {
                s := strings.TrimSpace(raw)
                if s == "" {
                        continue
                }
                ls := strings.ToLower(s)
                pIn := len([]rune(c.ProbeAns)) > 1 && strings.Contains(ls, pl)
                _, aIn := b32AnsIn(s, c.ProbeAns, c.Answers)
                if !pIn && !aIn {
                        continue
                }
                score, cover := b32SentenceScore(s, terms)
                d := b32Sent{Text: s, Runes: len([]rune(s)), Cover: cover, Score: score,
                        LenOK: b19SentenceLenOk(s), CoverOK: score >= float64(b19MinCover),
                        Boiler: b19IsBoilerplate(s)}
                if len([]rune(d.Text)) > 160 {
                        d.Text = string([]rune(d.Text)[:160]) + "…"
                }
                rec.AnswerSents = append(rec.AnswerSents, d)
                if len(rec.AnswerSents) >= 6 {
                        break
                }
        }

        // 归因(桶优先序)
        switch {
        case !rec.CappedHasAns && isCapped && !rec.FullHasAns:
                rec.Bucket = "X-页漂移" // 当前页面正文已无答案(页内容 vs b31 时点变化)
        case !rec.CappedHasAns && isCapped:
                rec.Bucket = "B4" // 12k 窗口截断(全文有, 窗口无)
        case best == "":
                if len(rec.AnswerSents) == 0 {
                        rec.Bucket = "B2" // 切句形状: 窗口内含答案但无任何切句承载(表格/剥除)
                } else {
                        anyLen := false
                        for _, s := range rec.AnswerSents {
                                if s.LenOK {
                                        anyLen = true
                                        break
                                }
                        }
                        if !anyLen {
                                rec.Bucket = "B2a" // 句长门槛全拒
                        } else {
                                rec.Bucket = "B2b" // 覆盖门槛全拒
                        }
                }
        case !rec.BestHasAns:
                if len(rec.AnswerSents) == 0 {
                        // 窗口内答案可判(多为 tokenAND)但无任何单句承载 — token 散布/表格单元格跨行
                        rec.Bucket = "B2"
                        break
                }
                passed := false
                anyLen := false
                for _, s := range rec.AnswerSents {
                        if s.LenOK {
                                anyLen = true
                                // b33: 样板句被产品跳过, 不算真过闸 — 过闸 = 长度+覆盖+非样板
                                if s.CoverOK && !s.Boiler {
                                        passed = true
                                }
                        }
                }
                switch {
                case passed:
                        rec.Bucket = "B1" // 选句竞争: 含答案句过闸但败选
                case !anyLen:
                        rec.Bucket = "B2a"
                default:
                        rec.Bucket = "B2b"
                }
        case !rec.InjectedHasAns:
                rec.Bucket = "B3" // 560 clamp 把答案截掉
        default:
                rec.Bucket = "X-重放会命中" // 当前重放注入成功 = dump 时点瞬时漂移
        }
}

func TestB19ReplayHarness(t *testing.T) {
        if os.Getenv("SC_B19_REPLAY") != "1" {
                t.Skip("b32 replay harness: set SC_B19_REPLAY=1 (会发真实网络请求)")
        }
        casesPath := os.Getenv("SC_B19_REPLAY_CASES")
        if casesPath == "" {
                casesPath = "scripts/b19-miss-cases-b32.json"
        }
        outPath := os.Getenv("SC_B19_REPLAY_OUT")
        if outPath == "" {
                outPath = "scripts/b19-replay-b32.json"
        }
        raw, err := os.ReadFile(casesPath)
        if err != nil {
                t.Fatalf("read cases: %v", err)
        }
        var cases []b32Case
        if err := json.Unmarshal(raw, &cases); err != nil {
                t.Fatalf("parse cases: %v", err)
        }
        t.Logf("b19 replay: %d cases", len(cases))

        recs := []b32Rec{}
        for _, c := range cases {
                rec := b32Rec{Dataset: c.Dataset, Q: c.Q, URL: c.URL, Rank: c.Rank,
                        Sub: c.Sub, ProbeAns: c.ProbeAns, AnsOffset: -1}

                // 1) 产品精确路径(缺省 UA = search-core/0.5)
                cfg := loadFetchConfig()
                f := NewFetcher(cfg, nil)
                res := f.Run(c.URL, FetchOptions{MaxChars: 12000, TTLSeconds: 900, NoCache: true}, f.policyFor(nil, nil))
                rec.Status = res.Status
                if res.Status != 200 || res.Text == "" || strings.HasPrefix(res.Text, "fetch error") {
                        rec.ErrText = res.Text
                        if len([]rune(rec.ErrText)) > 140 {
                                rec.ErrText = string([]rune(rec.ErrText)[:140])
                        }
                        rec.Bucket = "C1" // 抓取墙: b19 静默跳过, snippet 保持上游原样
                        // browser-UA 复抓(与 b31 probe 同串) — 量化解锁墙
                        cfg2 := loadFetchConfig()
                        cfg2.UserAgent = b32BrowserUA
                        f2 := NewFetcher(cfg2, nil)
                        res2 := f2.Run(c.URL, FetchOptions{MaxChars: 12000, TTLSeconds: 900, NoCache: true}, f2.policyFor(nil, nil))
                        rec.UAStatus = res2.Status
                        rec.UATextLen = len([]rune(res2.Text))
                        if res2.Status == 200 && res2.Text != "" && !strings.HasPrefix(res2.Text, "fetch error") {
                                var urec b32Rec
                                b32Diagnose(res2.Text, true, c, &urec)
                                ub := urec.BestHasAns
                                rec.UnlockBestHasAns = &ub
                                rec.UnlockBucket = urec.Bucket
                                // 解锁后含答案句解剖并入主记录供证据展示(去重: 主记录为空时)
                                if len(rec.AnswerSents) == 0 {
                                        rec.AnswerSents = urec.AnswerSents
                                }
                        }
                        recs = append(recs, rec)
                        continue
                }

                // 2) 全文窗口(MaxChars=1e6, 独立实例防进程内页缓存串味)
                cfgF := loadFetchConfig()
                fF := NewFetcher(cfgF, nil)
                resF := fF.Run(c.URL, FetchOptions{MaxChars: 1_000_000, TTLSeconds: 900, NoCache: true}, fF.policyFor(nil, nil))
                full := resF.Text
                if resF.Status != 200 || resF.Text == "" || strings.HasPrefix(resF.Text, "fetch error") {
                        full = res.Text // 全文抓失败退回窗口文本
                }
                rec.FullTextLen = len([]rune(full))
                rec.FullHasProbeAns, rec.FullHasAns = b32AnsIn(full, c.ProbeAns, c.Answers)
                if rec.FullHasProbeAns {
                        if i := strings.Index(strings.ToLower(full), strings.ToLower(c.ProbeAns)); i >= 0 {
                                // rune offset 近似: 窗口诊断只需 vs 12000 量级
                                rec.AnsOffset = len([]rune(full[:i]))
                        }
                }

                // 3) 窗口内重放 + 归因(把全文结论带入 B4 判定)
                var diag b32Rec
                b32Diagnose(res.Text, true, c, &diag)
                diag.Dataset, diag.Q, diag.URL, diag.Rank, diag.Sub, diag.ProbeAns = c.Dataset, c.Q, c.URL, c.Rank, c.Sub, c.ProbeAns
                diag.Status = res.Status
                diag.FullTextLen, diag.FullHasAns, diag.FullHasProbeAns, diag.AnsOffset = rec.FullTextLen, rec.FullHasAns, rec.FullHasProbeAns, rec.AnsOffset
                recs = append(recs, diag)
        }

        // 总账
        tally := map[string]int{}
        for _, r := range recs {
                tally[r.Bucket]++
        }
        out := map[string]any{
                "generatedAt": time.Now().UTC().Format(time.RFC3339),
                "n":           len(recs),
                "tally":       tally,
                "recs":        recs,
        }
        blob, _ := json.MarshalIndent(out, "", " ")
        if err := os.WriteFile(outPath, blob, 0o644); err != nil {
                t.Fatalf("write out: %v", err)
        }
        t.Logf("tally: %v → %s", tally, outPath)
}
