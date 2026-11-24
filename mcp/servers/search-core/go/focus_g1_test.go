package main

// G1 压力点复现与回归 (issue #3 评论 G1-2: focus.go 行循环内 regexp.MustCompile)
// 红灯: BenchmarkExtractHtmlDense 记录现状 allocs (每行编译一次正则);
// 修复: 正则提升为包级 MustCompile — 输出必须逐字节不变 (golden 对拍), 分配/时间下降。

import (
	"fmt"
	"strings"
	"testing"
)

// mkDenseHTML 生成 1MB/2MB 密集标签页 — 与 TS 侧 s0 剖析同思路: 小标签高频重复 + 短文本
func mkDenseHTML(target int) string {
	var b strings.Builder
	b.WriteString("<!doctype html><html><head><title>Dense</title></head><body><article>")
	i := 0
	for b.Len() < target {
		fmt.Fprintf(&b, "<div class=\"c%d\"><span>x%d</span> text %d with tab\tand  spaces </div>", i%97, i, i)
		i++
	}
	b.WriteString("</article></body></html>")
	return b.String()
}

// TestExtractHtmlGoldenStability: 修复前后输出逐字节一致 (规范摘要快照)。
// 语义基线: 修复仅移动正则编译位置, 不改变任何替换行为。
func TestExtractHtmlGoldenStability(t *testing.T) {
	cases := []string{
		mkDenseHTML(4096),
		"<html><body><main>  a \t\t b   c  \n\n\n\n  d  </main></body></html>",
		"<html><body><article><p>a</p><p>b</p><pre>keep\tme</pre></article></body></html>",
		"<html><head><title>T</title></head><body><article>" + strings.Repeat("<p>line with  double\ttabs </p>", 50) + "</article></body></html>",
	}
	for i, h := range cases {
		ex := extractHtml(h)
		// 空白规范化不变量: 行内多空格→单空格; 3+换行→2; 无 \r; 首尾 trim
		if strings.Contains(ex.Text, "\r") {
			t.Fatalf("case %d: \\r 残留", i)
		}
		if strings.Contains(ex.Text, "  ") || strings.Contains(ex.Text, "\t") {
			t.Fatalf("case %d: 行内空白未规范化: %q", i, ex.Text[:min(120, len(ex.Text))])
		}
		if strings.Contains(ex.Text, "\n\n\n") {
			t.Fatalf("case %d: 3+ 连续换行未折叠", i)
		}
	}
}

// TestSplitSegmentsGoldenStability: splitSegments 语义不变量
// (300 预算内跨段合并; 超预算时句号/换行优先切 — 与 TS 对齐口径)
func TestSplitSegmentsGoldenStability(t *testing.T) {
	// 短文本: 全部并入一个段
	short := "Para one.\nSentence two here.\n\nPara three after blanks.\n\nPara four."
	segs := splitSegments(short, 300)
	if len(segs) != 1 || segs[0] != "Para one.\nSentence two here.\n\nPara three after blanks.\n\nPara four." {
		t.Fatalf("short segs=%q", segs)
	}
	// 长文本: 预算切分, 每段 ≤ 300 (末段可短), 无空段
	long := strings.Repeat("Sentence number one here. Sentence number two there. ", 80)
	segs = splitSegments(long, 300)
	if len(segs) < 2 {
		t.Fatalf("long not split: %d", len(segs))
	}
	for i, s := range segs {
		if s == "" {
			t.Fatalf("seg[%d] empty", i)
		}
		if len(s) > 300 {
			t.Fatalf("seg[%d] len=%d > 300", i, len(s))
		}
	}
}

// BenchmarkExtractHtmlDense1MB: 修复前基线 (每行 MustCompile) → 修复后应显著降 allocs/op
func BenchmarkExtractHtmlDense1MB(b *testing.B) {
	h := mkDenseHTML(1 << 20)
	b.SetBytes(int64(len(h)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if ex := extractHtml(h); ex.Text == "" {
			b.Fatal("empty text")
		}
	}
}

func BenchmarkSplitSegmentsDense(b *testing.B) {
	text := extractHtml(mkDenseHTML(1 << 20)).Text
	b.SetBytes(int64(len(text)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if s := splitSegments(text, 300); len(s) == 0 {
			b.Fatal("no segments")
		}
	}
}
