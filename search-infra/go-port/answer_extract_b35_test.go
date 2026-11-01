package main

// b35: 专名行/bonus 结构语义层设计探针(b34 候选①实弹)。
//
// 背景: b34 机制A否决归档把 grokipedia 重新定性为 B1 竞争层残余 — bonus 富集散文
//       (Billboard 榜单句 12.75 cover=1 / bio intro ~3.x)压答案散文(重切后 7.50 cover=3);
//       spartacus 同族(Lloyd George 专名行 cover 3+bonus 4.5 压答案句 4.0)。
//       两案共同形态: 胜选句分数大头来自专名 0.25/数字 1.0 奖励的无上限积累。
// b35 候选机制(评分层, 与 b33 样板跳过/b34 行候选正交):
//   ① bonus 计分封顶: 数字 1.0 最多计 M 个, 专名 0.25 最多计 K 个(cover 不动)
//   ② 超长句逃生舱: lenOk=false(>300r)句在选句循环内按 clause 重切(b34SimResplit 同款),
//      取该句内部最佳 seg 作为代表候选(每超长句出 1 候选, 无 swarm — b34 洪泛风险的收敛版)
// 联动逻辑: 封顶压掉 bonus swarm 分数 → 逃生舱 seg 可达且洪泛风险同步收敛。
// 本探针在产品函数域内模拟(零镜像偏差), b32 canonical 全 11 案 × 变体矩阵:
//   baseline(现状) × 封顶 M∈{2,3} K∈{3,4,6} × 逃生舱 on/off = 13 变体
// 定稿判据: 目标案(grokipedia 期望翻正; spartacus 观察并诚实记录)翻正 且
//   回归锚(tibbs 答案句不被双杀 / commonwealth "2026 Victoria" 句不翻 / 48hrs 载体句不翻 /
//   libretexts 假答案仍拒)全部保持 + 健康轮案尽量逐字节一致。
// 门禁: SC_B35_PROBE=1 才发网络请求(常规 go test 零外呼)。
// 输出: scripts/b35-design-probe.json

import (
        "encoding/json"
        "fmt"
        "os"
        "strings"
        "testing"
)

// b35SentenceScoreCapped 封顶版评分镜像: cover 部分与 b32SentenceScore 逐参一致
// (coverW=1 时逐参一致; coverW=2 为 cover 加权对照变体), bonus 部分按数字/专名两个
// 计数器分别封顶(token 互斥分支结构保持原样)。
func b35SentenceScoreCapped(s string, terms []string, maxDig, maxProp, coverW int) (float64, int) {
        ls := strings.ToLower(s)
        score := 0.0
        cover := 0
        for _, t := range terms {
                if strings.Contains(ls, t) {
                        score += float64(coverW)
                        cover++
                }
        }
        toks := splitRe.Split(s, -1)
        digs, props := 0, 0
        for i, tk := range toks {
                if tk == "" {
                        continue
                }
                if i > 0 && len(tk) > 2 && tk[0] >= 'A' && tk[0] <= 'Z' {
                        if props < maxProp {
                                score += 0.25
                                props++
                        }
                } else if isAllDigits(tk) {
                        if digs < maxDig {
                                score += 1.0
                                digs++
                        }
                }
        }
        return score, cover
}

// b35Pick b35 选择器镜像: 在 b34Pick 语义上叠加封顶评分 + 超长句逃生舱。
// escape=false 时与现状一致(>300r 句直接跳过); escape=true 时超长句重切取内部最佳 seg。
func b35Pick(cands []string, terms []string, maxDig, maxProp, coverW int, escape bool) (string, float64) {
        best, bestScore := "", 0.0
        minCover := b19MinCover
        if allTermsCJK(terms) {
                minCover = 1
        }
        for _, raw := range cands {
                s := strings.TrimSpace(raw)
                if s == "" {
                        continue
                }
                long := len([]rune(s)) > b19MaxSentenceRune
                if long && !escape {
                        continue // 现状: 超长句拒
                }
                if b19IsBoilerplate(s) {
                        continue
                }
                score, _ := b35SentenceScoreCapped(s, terms, maxDig, maxProp, coverW)
                if long {
                        // 逃生舱: 重切取内部最佳 seg(每超长句出 1 候选)
                        segs := b34SimResplit(s, b19MaxSentenceRune)
                        segBest, segScore := "", 0.0
                        for _, seg := range segs {
                                sg := strings.TrimSpace(seg)
                                if !b19SentenceLenOk(sg) || b19IsBoilerplate(sg) {
                                        continue
                                }
                                sc, _ := b35SentenceScoreCapped(sg, terms, maxDig, maxProp, coverW)
                                if sc < float64(minCover) {
                                        continue
                                }
                                if sc > segScore || (sc == segScore && len(sg) < len(segBest)) {
                                        segBest, segScore = sg, sc
                                }
                        }
                        if segBest == "" {
                                continue
                        }
                        s, score = segBest, segScore
                } else if !b19SentenceLenOk(s) {
                        continue
                }
                if score < float64(minCover) {
                        continue
                }
                if score > bestScore || (score == bestScore && len(s) < len(best)) {
                        best, bestScore = s, score
                }
        }
        return best, bestScore
}

func TestB35DesignProbe(t *testing.T) {
        if os.Getenv("SC_B35_PROBE") != "1" {
                t.Skip("b35 design probe: set SC_B35_PROBE=1 (会发真实网络请求)")
        }
        casesPath := "scripts/b19-miss-cases-b32.json"
        raw, err := os.ReadFile(casesPath)
        if err != nil {
                t.Fatalf("read cases: %v", err)
        }
        var cases []b32Case
        if err := json.Unmarshal(raw, &cases); err != nil {
                t.Fatalf("parse cases: %v", err)
        }

        type variant struct {
                name            string
                maxDig, maxProp int
                escape          bool
                coverW          int // cover 权重(1=现状; 2=cover 加权降 bonus 相对话语权)
        }
        variants := []variant{{"baseline", 1 << 20, 1 << 20, false, 1}}
        for _, m := range []int{2, 3} {
                for _, k := range []int{3, 4, 6} {
                        variants = append(variants,
                                variant{fmt.Sprintf("capM%dK%d", m, k), m, k, false, 1},
                                variant{fmt.Sprintf("capM%dK%d+esc", m, k), m, k, true, 1},
                        )
                }
        }
        // 对照组: 仅封专名(M 不封) / 仅封数字(K 不封) / cover 加权×2(不封顶)
        variants = append(variants,
                variant{"capPropK4", 1 << 20, 4, false, 1},
                variant{"capDigM2", 2, 1 << 20, false, 1},
                variant{"coverW2", 1 << 20, 1 << 20, false, 2},
                variant{"coverW2+esc", 1 << 20, 1 << 20, true, 2},
        )

        report := map[string]any{}
        cfg := loadFetchConfig()
        for ci, c := range cases {
                f := NewFetcher(cfg, nil)
                res := f.Run(c.URL, FetchOptions{MaxChars: 12000, TTLSeconds: 900, NoCache: true}, f.policyFor(nil, nil))
                if res.Status != 200 || res.Text == "" || strings.HasPrefix(res.Text, "fetch error") {
                        t.Logf("[%s/%s#r%d] fetch fail: %d %s", c.Dataset, c.Sub, c.Rank, res.Status, res.Text[:min(80, len(res.Text))])
                        report[fmt.Sprintf("%02d-", ci)+c.Dataset+"/"+c.Sub+"#r"+fmt.Sprintf("%d", c.Rank)] = map[string]any{"fetchFail": res.Status}
                        continue
                }
                text := res.Text
                terms := uniqueTerms(tokenize(c.Q))
                bestCur := b19BestSentence(text, c.Q)
                pCur, aCur := b32AnsIn(bestCur, c.ProbeAns, c.Answers)

                sents := []string{}
                longCount := 0
                for _, r := range b19SplitSentences(text) {
                        s := strings.TrimSpace(r)
                        if s == "" {
                                continue
                        }
                        if len([]rune(s)) > b19MaxSentenceRune {
                                longCount++
                        }
                        sents = append(sents, s)
                }

                variantsOut := []map[string]any{}
                for _, v := range variants {
                        best, score := b35Pick(sents, terms, v.maxDig, v.maxProp, v.coverW, v.escape)
                        p, a := b32AnsIn(best, c.ProbeAns, c.Answers)
                        // 镜像自检: baseline 变体(无封顶+无逃生舱)必须与产品 b19BestSentence 逐字节一致。
                        // 产品循环含 b19RowCandidates — b32 案页 b34 触发面扫描=0, 差异即镜像偏差需修。
                        if v.name == "baseline" && best != bestCur {
                                t.Logf("[%s/%s#r%d] MIRROR-DRIFT: b35Pick=%q bestCur=%q", c.Dataset, c.Sub, c.Rank, best[:min(60, len(best))], bestCur[:min(60, len(bestCur))])
                        }
                        variantsOut = append(variantsOut, map[string]any{
                                "variant": v.name, "best": best, "score": score, "hasAns": p || a,
                        })
                }
                report[fmt.Sprintf("%02d-", ci)+c.Dataset+"/"+c.Sub+"#r"+fmt.Sprintf("%d", c.Rank)] = map[string]any{
                        "q": c.Q, "probeAns": c.ProbeAns,
                        "bestCur": bestCur, "bestCurHasAns": pCur || aCur,
                        "longSents": longCount, "variants": variantsOut,
                }
        }
        blob, _ := json.MarshalIndent(report, "", " ")
        _ = os.WriteFile("scripts/b35-design-probe.json", blob, 0o644)
        t.Logf("b35 design probe done -> scripts/b35-design-probe.json")
}
