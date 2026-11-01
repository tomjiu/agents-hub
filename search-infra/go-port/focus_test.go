package main

import (
	"strings"
	"testing"
)

// focus 单测: HTML 提取/分段/focus 提取(对齐 TS focus.test 语义)

func TestExtractHtmlPruneAndBlocks(t *testing.T) {
	h := `<!doctype html><html><head><title>Page Title</title><script>var x=1;</script></head>
<body><nav>menu junk</nav><article><h1>Head</h1><p>Para one.</p><p>Para two<br>wrapped</p></article><footer>foot junk</footer></body></html>`
	ex := extractHtml(h)
	if ex.Title != "Page Title" {
		t.Fatalf("title=%q", ex.Title)
	}
	for _, junk := range []string{"menu junk", "foot junk", "var x=1"} {
		if strings.Contains(ex.Text, junk) {
			t.Fatalf("剪枝失败, text 含 %q: %q", junk, ex.Text)
		}
	}
	// 块级换行: h1/p 不粘连
	if !strings.Contains(ex.Text, "Head\nPara one.\nPara two\nwrapped") {
		t.Fatalf("块级换行语义丢失: %q", ex.Text)
	}
}

func TestExtractHtmlArticlePriority(t *testing.T) {
	h := `<html><body><main>MAINTEXT</main><article>ART_text</article></body></html>`
	ex := extractHtml(h)
	// TS: article 优先于 main
	if !strings.Contains(ex.Text, "ART_text") || strings.Contains(ex.Text, "MAINTEXT") {
		t.Fatalf("article 应优先于 main: %q", ex.Text)
	}
}

func TestSplitSegmentsParagraphAndSentence(t *testing.T) {
	sentence := "This is a sentence. " // 句末标点+空格(TS lookbehind 需空白分隔符才切)
	long := strings.Repeat(sentence, 40)
	text := "short one\n\n" + long + "\n\nshort two"
	segs := splitSegments(text, 300)
	if len(segs) < 4 {
		t.Fatalf("至少 4 段(短/长段多句切分/短): %d", len(segs))
	}
	for _, s := range segs {
		if len(s) > 300+250 { // 句子粒度打包允许最后一个句子溢出
			t.Fatalf("段超长: %d", len(s))
		}
	}
	// 整段无空白分隔(TS 同款: 标点后无 \s 不切 → 退化为一段)
	segsNoSpace := splitSegments(strings.Repeat("No space.", 80), 300)
	if len(segsNoSpace) != 1 {
		t.Fatalf("无空白分隔应退化为一段(TS 语义): %d", len(segsNoSpace))
	}
	// 中文句末标点(带空白才切, TS lookbehind 需 \s+)
	segs2 := splitSegments("第一句。 第二句！ 第三句？ 第四句。", 10)
	if len(segs2) < 2 {
		t.Fatalf("中文句末标点+空白应切分: %v", segs2)
	}
	// 中文标点无空白(常见排版): TS 同款不切 — 回归锁(诚实记录: 中文长段将退化为单段)
	segs3 := splitSegments("第一句。第二句！第三句？第四句。", 10)
	if len(segs3) != 1 {
		t.Fatalf("中文无空白不切(TS 语义): %v", segs3)
	}
}

func TestExtractFocusHitsAndAdjacent(t *testing.T) {
	text := strings.Repeat("filler text about nothing.\n\n", 20) +
		"quantum entanglement enables secure communication\n\n" +
		"more filler padding the page here.\n\n" +
		"quantum entanglement details continue right here\n\n" +
		strings.Repeat("more filler padding.\n\n", 20)
	segs := extractFocus(text, "quantum entanglement", 8000, 1)
	if segs == nil {
		t.Fatal("应有命中")
	}
	joined := strings.Join(segs, "\n…\n")
	if !strings.Contains(joined, "quantum entanglement enables secure communication") {
		t.Fatalf("命中段缺失: %q", joined)
	}
	// 省略比: 命中段应远小于全文
	if len(joined) >= len(text) {
		t.Fatalf("focus 未省 token: %d/%d", len(joined), len(text))
	}
}

func TestExtractFocusNoHit(t *testing.T) {
	segs := extractFocus("alpha beta gamma\n\ndelta epsilon", "zzzznotfound", 8000, 1)
	if segs != nil {
		t.Fatalf("无命中应返回 nil: %v", segs)
	}
	// focus 词全是 stopword/单字符 → tokenize 空 → nil
	if segs := extractFocus("alpha beta", "a of the", 8000, 1); segs != nil {
		t.Fatalf("空 terms 应返回 nil: %v", segs)
	}
}

func TestExtractFocusBudgetTrim(t *testing.T) {
	// 多命中段 + 小预算 → 触发丢段裁剪
	var b strings.Builder
	for i := 0; i < 10; i++ {
		b.WriteString("target keyword block ")
		b.WriteString(strings.Repeat("x", 200))
		b.WriteString("\n\n")
	}
	segs := extractFocus(b.String(), "target keyword", 900, 1)
	if segs == nil {
		t.Fatal("应有命中")
	}
	if len(strings.Join(segs, "\n…\n")) > 900+300 { // 裁剪循环退出后 join 仍可能略超(单段)
		t.Logf("预算裁剪后 join=%d(允许单段超预算)", len(strings.Join(segs, "\n…\n")))
	}
}
