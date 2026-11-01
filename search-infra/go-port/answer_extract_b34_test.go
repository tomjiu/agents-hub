package main

// b34: B2a 双端修正设计探针。
//
// 背景: b32 canonical 归因 B2a=3(句长门槛全拒): libretexts 304r 答案句(lenOk=false, score 2.0)
//       allmusic 表格单元 "Atlantic" 8r(min 长度拒) / grokipedia 767r 答案句(score 14.5 被拒)。
//       b34 候选机制: A 长句二次切分(副级分隔符切 clause 贪心打包 ≤300r 段)
//                    B 短行成行(连续 cell-like 短行 join 为行候选, 仍过全部既有闸)。
// 本探针在产品函数域内直接模拟两机制(零镜像偏差), 抓三案全文落盘供设计定稿:
//   ① 每案 12k 窗口原文 → scripts/b34-design/*.txt(看表格行结构)
//   ② >300r 句: 全文 + 切分打包模拟段 + 产品评分逐段判定(score/cover/含答案)
//   ③ 短行 run: join 模拟段 + 同样评分
//   ④ 翻正预测: 产品闸门选择器(=len/best 评分循环同款)在"原句+段+行候选"上重选
// 门禁: SC_B34_PROBE=1 才发网络请求(常规 go test 零外呼)。
// 输出: scripts/b34-design-probe.json + scripts/b34-design/*.txt

import (
        "encoding/json"
        "fmt"
        "os"
        "regexp"
        "strings"
        "testing"
)

var b34ClauseRe = regexp.MustCompile(`[,;；:—–]`)

// b34SimResplit 机制A模拟: 副级分隔符切 clause, 贪心打包 ≤maxRune 段(保留原分隔符)。
func b34SimResplit(s string, maxRune int) []string {
        parts := b34ClauseRe.Split(s, -1)
        dels := b34ClauseRe.FindAllString(s, -1)
        segs := []string{}
        cur := ""
        for i, p := range parts {
                c := strings.TrimSpace(p)
                if c == "" {
                        continue
                }
                d := ""
                if i-1 >= 0 && i-1 < len(dels) {
                        d = dels[i-1]
                }
                if cur == "" {
                        cur = c
                } else if len([]rune(cur))+len([]rune(d))+1+len([]rune(c)) <= maxRune {
                        cur = cur + d + " " + c
                } else {
                        segs = append(segs, cur)
                        cur = c
                }
        }
        if cur != "" {
                segs = append(segs, cur)
        }
        return segs
}

// b34SimRowJoin 机制B模拟: 连续 cell-like 短行(≥2 行) join 成行候选。
func b34SimRowJoin(sents []string, maxRow int) []string {
        out := []string{}
        run := []string{}
        isCell := func(s string) bool {
                r := []rune(s)
                if len(r) == 0 || len(r) >= b19MinSentenceLatin {
                        return false
                }
                return !strings.ContainsAny(s, ".!?。！？")
        }
        flush := func() {
                if len(run) >= 2 {
                        j := strings.Join(run, " · ")
                        if len([]rune(j)) <= maxRow {
                                out = append(out, j)
                        }
                }
                run = run[:0]
        }
        for _, raw := range sents {
                s := strings.TrimSpace(raw)
                if s == "" {
                        continue
                }
                if isCell(s) {
                        run = append(run, s)
                        continue
                }
                flush()
        }
        flush()
        return out
}

type b34SegEval struct {
        Text   string  `json:"text"`
        Runes  int     `json:"runes"`
        Score  float64 `json:"score"`
        Cover  int     `json:"cover"`
        LenOk  bool    `json:"lenOk"`
        HasAns bool    `json:"hasAns"`
        Boiler bool    `json:"boiler"`
}

func b34EvalSegs(segs []string, terms []string, probeAns string, answers []string) []b34SegEval {
        out := []b34SegEval{}
        for _, s := range segs {
                score, cover := b32SentenceScore(s, terms)
                p, a := b32AnsIn(s, probeAns, answers)
                out = append(out, b34SegEval{Text: s, Runes: len([]rune(s)), Score: score, Cover: cover,
                        LenOk: b19SentenceLenOk(s), HasAns: p || a, Boiler: b19IsBoilerplate(s)})
        }
        return out
}

// b34Pick 产品闸门选择器镜像: lenOk + 非样板 + score>=minCover, 平手取更短。
// 与 b19BestSentence 内循环逐参一致(minCover 按全 CJK 查询降 1 的分支同镜像)。
func b34Pick(cands []string, terms []string) (string, float64) {
        best, bestScore := "", 0.0
        minCover := b19MinCover
        if allTermsCJK(terms) {
                minCover = 1
        }
        for _, raw := range cands {
                s := strings.TrimSpace(raw)
                if !b19SentenceLenOk(s) || b19IsBoilerplate(s) {
                        continue
                }
                score, _ := b32SentenceScore(s, terms)
                if score < float64(minCover) {
                        continue
                }
                if score > bestScore || (score == bestScore && len(s) < len(best)) {
                        best, bestScore = s, score
                }
        }
        return best, bestScore
}

func TestB34DesignProbe(t *testing.T) {
        if os.Getenv("SC_B34_PROBE") != "1" {
                t.Skip("b34 design probe: set SC_B34_PROBE=1 (会发真实网络请求)")
        }
        cases := []b32Case{
                {Dataset: "nq", Sub: "nogold", Rank: 1, Q: "where do the events in the story take place geographically",
                        URL: "https://human.libretexts.org/Bookshelves/Literature_and_Literacy/Literacy_and_Critical_Thinking/Writing_and_Critical_Thinking_Through_Literature_(Ringo_and_Kashyap)/04%3A_About_Fiction_-_Short_Stories_and_the_Novel/4.08%3A_Setting",
                        ProbeAns: "Persia", Answers: []string{"Persia"}},
                {Dataset: "triviaqa", Sub: "deep", Rank: 1, Q: "Throughout the 80s and 90s Phil Collins recorded on which record label?",
                        URL: "https://www.allmusic.com/artist/phil-collins-mn0000337119",
                        ProbeAns: "Atlantic", Answers: []string{"Atlantic", "Sea of Atlas", "The Pond", "Ethiopic Ocean"}},
                {Dataset: "triviaqa", Sub: "deep", Rank: 2, Q: "Art Garfunkel trained for which profession although he didn't qualify?",
                        URL: "https://grokipedia.com/page/Art_Garfunkel",
                        ProbeAns: "Architect", Answers: []string{"Architect", "Master Builder (occupation)", "Master builder (occupation)", "Registered Architect"}},
        }
        _ = os.MkdirAll("scripts/b34-design", 0o755)
        report := map[string]any{}
        for _, c := range cases {
                cfg := loadFetchConfig()
                f := NewFetcher(cfg, nil)
                res := f.Run(c.URL, FetchOptions{MaxChars: 12000, TTLSeconds: 900, NoCache: true}, f.policyFor(nil, nil))
                if res.Status != 200 || res.Text == "" || strings.HasPrefix(res.Text, "fetch error") {
                        t.Logf("[%s/%s] fetch fail: %d %s", c.Dataset, c.Sub, res.Status, res.Text)
                        continue
                }
                text := res.Text
                // 窗口原文落盘(行结构审阅)
                _ = os.WriteFile("scripts/b34-design/"+c.Dataset+"-"+c.Sub+".txt", []byte(text), 0o644)

                terms := uniqueTerms(tokenize(c.Q))
                bestCur := b19BestSentence(text, c.Q)
                pCur, aCur := b32AnsIn(bestCur, c.ProbeAns, c.Answers)

                sents := []string{}
                longSims := []map[string]any{}
                for _, raw := range b19SplitSentences(text) {
                        s := strings.TrimSpace(raw)
                        if s == "" {
                                continue
                        }
                        sents = append(sents, s)
                        if len([]rune(s)) > b19MaxSentenceRune {
                                segs := b34SimResplit(s, b19MaxSentenceRune)
                                longSims = append(longSims, map[string]any{
                                        "origRunes": len([]rune(s)),
                                        "orig":      s,
                                        "nSegs":     len(segs),
                                        "segs":      b34EvalSegs(segs, terms, c.ProbeAns, c.Answers),
                                })
                        }
                }
                rows := b34SimRowJoin(sents, 200)
                rowSims := b34EvalSegs(rows, terms, c.ProbeAns, c.Answers)

                // 翻正预测: 新候选集 = 原句 + 长句段 + 行候选 → 产品闸门选择器重选
                all := []string{}
                for _, s := range sents {
                        if len([]rune(s)) <= b19MaxSentenceRune {
                                all = append(all, s)
                        }
                }
                for _, m := range longSims {
                        for _, seg := range m["segs"].([]b34SegEval) {
                                all = append(all, seg.Text)
                        }
                }
                all = append(all, rows...)
                bestNew, scoreNew := b34Pick(all, terms)
                pNew, aNew := b32AnsIn(bestNew, c.ProbeAns, c.Answers)

                report[c.Dataset+"/"+c.Sub+"#r"+fmt.Sprintf("%d", c.Rank)] = map[string]any{
                        "q": c.Q, "probeAns": c.ProbeAns,
                        "bestCur": bestCur, "bestCurHasAns": pCur || aCur,
                        "bestSim": bestNew, "bestSimScore": scoreNew, "bestSimHasAns": pNew || aNew,
                        "longSims": longSims, "rowSims": rowSims,
                }
        }
        blob, _ := json.MarshalIndent(report, "", " ")
        _ = os.WriteFile("scripts/b34-design-probe.json", blob, 0o644)
        t.Logf("b34 design probe done -> scripts/b34-design-probe.json")
}

// ---- b34 门禁一: 表格感知行候选单元测试(产品机制 v2: 数字行锚 + 行级查询词覆盖) ----

// b34RowPage 合成 allmusic 型唱片年表页: 年份/专辑/厂牌短行 + 弱 prose + "…Records" 厂牌单元
const b34RowPage = "Discography\n" +
	"1981\nFace Value\nAtlantic\n" +
	"1982\nHello, I Must Be Going\nAtlantic / JDC Records\n" +
	"In 1985 he released his third album to widespread acclaim worldwide.\n" +
	"1985\nNo Jacket Required\nAtlantic\n"

func TestB19RowCandidatesAdmit(t *testing.T) {
	q := "Throughout the 80s and 90s Phil Collins recorded on which record label?"
	terms := uniqueTerms(tokenize(q))
	sents := b19SplitSentences(b34RowPage)
	rows := b19RowCandidates(sents, terms)
	// 两段 run(prose 断开): run1 含 "…Records" 单元 → 行含 "record" 准入;
	// run2 (1985/No Jacket Required/Atlantic) 无查询词 → 排除
	if len(rows) != 1 {
		t.Fatalf("want 1 row, got %d: %q", len(rows), rows)
	}
	want := "Discography · 1981 · Face Value · Atlantic · 1982 · Hello, I Must Be Going · Atlantic / JDC Records"
	if rows[0] != want {
		t.Fatalf("row mismatch:\n got %q\nwant %q", rows[0], want)
	}
	// 行候选在 b19BestSentence 内同闸竞争且胜出(prose 句 cover=0  score 1.0 不过闸)
	best := b19BestSentence(b34RowPage, q)
	if best != want {
		t.Fatalf("best != row:\n got %q\nwant %q", best, want)
	}
}

func TestB19RowCandidatesReject(t *testing.T) {
	q := "Throughout the 80s and 90s Phil Collins recorded on which record label?"
	terms := uniqueTerms(tokenize(q))
	// TOC/页头 run: 无独立数字行 → 排除
	toc := "Early Life\nFamily Background\nSolo Career Trajectory\nDebut and Exploration\n"
	if rows := b19RowCandidates(b19SplitSentences(toc), terms); len(rows) != 0 {
		t.Fatalf("TOC run must reject, got %q", rows)
	}
	// 引用 run: 有数字行但行无查询词(cover=0 反刷分) → 排除
	cite := "[35]\n[31]\nSolo Career Trajectory\nDebut and Exploration\n"
	if rows := b19RowCandidates(b19SplitSentences(cite), terms); len(rows) != 0 {
		t.Fatalf("cover-0 cite run must reject, got %q", rows)
	}
	// 终止符行断 run: 单行残留 run(<2)不成行; 无查询词行不成行
	mixed := "1981\nAtlantic\nHe said hi.\n"
	if rows := b19RowCandidates(b19SplitSentences(mixed), terms); len(rows) != 0 {
		t.Fatalf("terminator-broken run must reject, got %q", rows)
	}
	// b19BestSentence 整链: 行候选全被拒时选句结果与无行候选一致(prose cover=0 → best="")
	if best := b19BestSentence(cite, q); best != "" {
		t.Fatalf("page with only rejected rows: want best=\"\", got %q", best)
	}
}

func TestB19RowCandidatesChunk(t *testing.T) {
	q := "Throughout the 80s and 90s Phil Collins recorded on which record label?"
	terms := uniqueTerms(tokenize(q))
	// 长年表: 年份行 + 含查询词厂牌行交替 ×80 → join 超 300r 必须分 chunk, 每 chunk 均含查询词
	var b strings.Builder
	for i := 0; i < 80; i++ {
		fmt.Fprintf(&b, "%d\nAtlantic Records\n", 1981+i)
	}
	rows := b19RowCandidates(b19SplitSentences(b.String()), terms)
	if len(rows) < 3 {
		t.Fatalf("long run must chunk, got %d rows", len(rows))
	}
	for _, r := range rows {
		if n := len([]rune(r)); n > b19MaxSentenceRune {
			t.Fatalf("chunk over limit: %d", n)
		}
		if !strings.Contains(strings.ToLower(r), "atlantic records") {
			t.Fatalf("chunk lost term-bearing cell: %q", r[:60])
		}
	}
}
