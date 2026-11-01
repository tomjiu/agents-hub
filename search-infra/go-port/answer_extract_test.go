package main

import (
        "strings"
        "testing"
)

func TestB19IsQuestionQuery(t *testing.T) {
        yes := []string{
                "What was Eddie Murphy's first movie",
                "who is the founder of the ubuntu project",
                "华为创始人是谁",
                "where do the Orioles come from?",
                "日本人口多少",
        }
        for _, q := range yes {
                if !b19IsQuestionQuery(q) {
                        t.Errorf("b19IsQuestionQuery(%q)=false want true", q)
                }
        }
        no := []string{
                "rust lifetimes explained with examples",
                "golang goroutine 泄漏 排查 pprof",
                "zod npm package schema validation",
        }
        for _, q := range no {
                if b19IsQuestionQuery(q) {
                        t.Errorf("b19IsQuestionQuery(%q)=true want false", q)
                }
        }
}

func TestB19BestSentence(t *testing.T) {
        text := `Eddie Murphy is an American actor and comedian. ` +
                `Brooklyn raised, he was just 21 when he joined Saturday Night Live. ` +
                `Murphy made his feature film debut in the 1982 action comedy 48 Hrs., which became a box office hit. ` +
                `He later starred in Trading Places and Beverly Hills Cop.`
        got := b19BestSentence(text, "What was Eddie Murphy's first movie")
        if got == "" {
                t.Fatal("b19BestSentence: want a sentence, got empty")
        }
        // 目标句: 覆盖 eddie/murphy/first/movie 全部 4 内容词
        want := "Murphy made his feature film debut in the 1982 action comedy 48 Hrs., which became a box office hit."
        if got != want {
                t.Errorf("b19BestSentence got %q want %q", got, want)
        }
}

func TestB19BestSentenceChinese(t *testing.T) {
        text := "华为技术有限公司是一家总部位于深圳的电信设备公司。任正非于 1987 年创立华为。华为是全球最大的电信设备制造商之一。"
        got := b19BestSentence(text, "华为创始人是谁")
        if got == "" {
                t.Fatal("b19BestSentence zh: want a sentence, got empty")
        }
        if !containsAny(got, "任正非") {
                t.Errorf("b19BestSentence zh got %q, want sentence mentioning 任正非", got)
        }
}

func containsAny(s, sub string) bool {
        return len(sub) > 0 && len(s) >= len(sub) && (func() bool {
                for i := 0; i+len(sub) <= len(s); i++ {
                        if s[i:i+len(sub)] == sub {
                                return true
                        }
                }
                return false
        })()
}

// b21: 抓取页数旋钮 — 缺省 5, 环境变量覆盖, 越界/非法回退
func TestB19AnswerPages(t *testing.T) {
        t.Setenv("SC_ANSWER_TOPN", "")
        if got := b19AnswerPages(); got != 5 {
                t.Fatalf("default want 5 got %d", got)
        }
        t.Setenv("SC_ANSWER_TOPN", "3")
        if got := b19AnswerPages(); got != 3 {
                t.Fatalf("override want 3 got %d", got)
        }
        t.Setenv("SC_ANSWER_TOPN", "99")
        if got := b19AnswerPages(); got != 5 {
                t.Fatalf("out-of-range want fallback 5 got %d", got)
        }
        t.Setenv("SC_ANSWER_TOPN", "abc")
        if got := b19AnswerPages(); got != 5 {
                t.Fatalf("invalid want fallback 5 got %d", got)
        }
}

// b33: 引文/日期串样板句 — 数字 token 主导的列表句跳过, 含答案句胜出(b32 tibbs 案回归)
func TestB19BoilerplateSkip(t *testing.T) {
        jet := "Jet, June 14, 1993; August 16, 1993; November 29, 1993; May 16, 1994; December 23, 1996."
        if !b19IsBoilerplate(jet) {
                t.Errorf("citation date-list should be boilerplate: %q", jet)
        }
        born := "Born Howard Ellsworth Rollins, Jr., October 17, 1950 in Baltimore, MD, died December 8, 1952."
        if b19IsBoilerplate(born) {
                t.Errorf("prose biography sentence should not be boilerplate: %q", born)
        }
        carrier := "Murphy made his feature film debut in the 1982 action comedy 48 Hrs., which became a box office hit."
        if b19IsBoilerplate(carrier) {
                t.Errorf("carrier sentence with 2 digits should not be boilerplate: %q", carrier)
        }
        one := "The 2026 games were originally set to be held in the Australian state of Victoria."
        if b19IsBoilerplate(one) {
                t.Errorf("normal prose with 1 year should not be boilerplate: %q", one)
        }
        refs := "J. Biol. Chem. 1998; 273: 1234-1240. Smith J, Doe A 2019; Smith K 2020."
        if !b19IsBoilerplate(refs) {
                t.Errorf("academic reference line should be boilerplate: %q", refs)
        }
        awards := "Awards: nominated for an Academy Award in 1982 for Best Supporting Actor in Ragtime (1981); nominated for Golden Globe for Best New Star of the Year and Best Supporting Actor for Ragtime (1981); Nominated for an Emmy."
        if !b19IsBoilerplate(awards) {
                t.Errorf("semicolon-chained awards line should be boilerplate: %q", awards)
        }
        oneSemi := "He died December 8, 1996 in New York; the cause was lymphoma."
        if b19IsBoilerplate(oneSemi) {
                t.Errorf("prose with 1 semicolon should not be boilerplate: %q", oneSemi)
        }
        // 选句回归: 引文行(10.0)+奖项行(7+)在旁, 答案句(6.25)必须胜出 — 无惩罚时都赢不了
        text := jet + " " + awards + " " + born
        got := b19BestSentence(text, "who played tibbs on in the heat of the night")
        if got != born {
                t.Errorf("b19BestSentence: want answer sentence over citation list, got %q", got)
        }
}

// b23 v2: 非破坏式追加 — 基底完整保留, 560 上限内答案句可见
func TestB19InjectReservesRoom(t *testing.T) {
        base400 := strings.Repeat("x", 400) // 长基底(400 恰到旧上限)
        ans := strings.Repeat("a", 80)      // 答案句 80 rune
        got := clampText(base400+" · "+ans, 560)
        if !strings.HasSuffix(got, ans) {
                t.Fatalf("answer sentence must remain fully visible at tail, len=%d", len([]rune(got)))
        }
        if !strings.HasPrefix(got, base400) {
                t.Fatalf("base must remain intact (non-destructive append)")
        }
        // 超长答案句: 只截 s 尾部, 基底不动
        longAns := strings.Repeat("b", 300)
        got2 := clampText(base400+" · "+longAns, 560)
        if !strings.HasPrefix(got2, base400) {
                t.Fatalf("base must remain intact even with long answer")
        }
        if len([]rune(got2)) != 560 {
                t.Fatalf("expected clamp at 560, got %d", len([]rune(got2)))
        }
}
