package main

// Focus Fetcher (对齐 TS core/src/focus.ts, v0-spec §4.4 — 省 token 主战场)
// - HTML→正文: goquery 剪枝(script/style/nav/...) + article/main 优先 + 块级换行
// - 分段: 段落边界 + 句子感知打包 ~300 chars/段
// - Focus 提取: 命中段 + 邻接段(dsh[10] 方案), idf-lite 词权重

import (
	"math"
	"regexp"
	"sort"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"golang.org/x/net/html"
)

var blockTags = map[string]bool{
	"p": true, "div": true, "h1": true, "h2": true, "h3": true, "h4": true,
	"h5": true, "h6": true, "li": true, "tr": true, "section": true,
	"article": true, "blockquote": true, "pre": true, "ul": true, "ol": true,
	"table": true, "figcaption": true, "dl": true, "dt": true, "dd": true,
}

type Extracted struct {
	Title string
	Text  string
}

// appendTextTail 对齐 cheerio $(el).append("\n"): 在元素内容末尾补一个换行文本节点
func appendTextTail(n *html.Node, s string) {
	t := &html.Node{Type: html.TextNode, Data: s}
	if n.LastChild != nil {
		n.InsertBefore(t, nil)
	} else {
		n.AppendChild(t)
	}
}

// replaceWithText 对齐 $("br").replaceWith("\n")
func replaceWithText(s *goquery.Selection, txt string) {
	for _, n := range s.Nodes {
		if n.Parent == nil {
			continue
		}
		t := &html.Node{Type: html.TextNode, Data: txt}
		n.Parent.InsertBefore(t, n)
		n.Parent.RemoveChild(n)
	}
}

func extractHtml(htmlBody string) Extracted {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(htmlBody))
	if err != nil {
		return Extracted{}
	}
	title := strings.TrimSpace(doc.Find("title").First().Text())
	doc.Find("script,style,noscript,svg,iframe,form,template,link,meta,head,footer,nav,aside,header,figure figcaption").Remove()

	mainSel := doc.Find("article").First()
	if mainSel.Length() == 0 {
		mainSel = doc.Find("main").First()
	}
	if mainSel.Length() == 0 {
		mainSel = doc.Find("body")
	}
	if mainSel.Length() == 0 {
		return Extracted{Title: title, Text: ""}
	}
	// 块级元素结尾补换行 — cheerio .text() 会把块级元素粘连成一行, 同款纪律
	mainSel.Find("*").Each(func(_ int, s *goquery.Selection) {
		name := goquery.NodeName(s)
		if blockTags[name] && len(s.Nodes) > 0 {
			appendTextTail(s.Nodes[0], "\n")
		}
	})
	replaceWithText(mainSel.Find("br"), "\n")

	raw := strings.ReplaceAll(mainSel.Text(), "\r", "")
	lines := strings.Split(raw, "\n")
	var text []string
	for _, l := range lines {
		l = strings.TrimSpace(regexp.MustCompile(`[ \t]+`).ReplaceAllString(l, " "))
		if l == "" {
			if len(text) > 0 && text[len(text)-1] != "" {
				text = append(text, "")
			}
		} else {
			text = append(text, l)
		}
	}
	out := strings.Join(text, "\n")
	re3 := regexp.MustCompile(`\n{3,}`)
	out = re3.ReplaceAllString(out, "\n\n")
	return Extracted{Title: title, Text: strings.TrimSpace(out)}
}

// splitSegments 把纯文本切成 ~segmentSize 的段(句号/换行优先切) — 逐字对齐 TS
func splitSegments(text string, segmentSize int) []string {
	if segmentSize <= 0 {
		segmentSize = 300
	}
	paras := regexp.MustCompile(`\n{2,}`).Split(text, -1)
	var segments []string
	buf := ""
	flush := func() {
		if strings.TrimSpace(buf) != "" {
			segments = append(segments, strings.TrimSpace(buf))
		}
		buf = ""
	}
	for _, para := range paras {
		if len(para) <= segmentSize {
			if len(buf+"\n\n"+para) > segmentSize {
				flush()
			}
			if buf != "" {
				buf = buf + "\n\n" + para
			} else {
				buf = para
			}
			continue
		}
		// 长段落: 按句子切 (TS lookbehind /(?<=[.!?。！？])\s+/ 的手写等价)
		for _, s := range splitSentences(para) {
			if len(buf+" "+s) > segmentSize {
				flush()
			}
			if buf != "" {
				buf = buf + " " + s
			} else {
				buf = s
			}
		}
		flush()
	}
	flush()
	return segments
}

func isSentenceEndRune(r rune) bool {
	switch r {
	case '.', '!', '?', '。', '！', '？':
		return true
	}
	return false
}

func isSpaceRune(r rune) bool {
	switch r {
	case ' ', '\t', '\n', '\r', '\v', '\f', 0x85, 0xA0:
		return true
	}
	return false
}

// splitSentences JS split(/(?<=[.!?。！？])\s+/) 等价: 句末标点后的空白串是分隔符,
// 标点保留在前句尾部; 尾部分隔符产生尾部空串段(JS split 语义)。
func splitSentences(para string) []string {
	runes := []rune(para)
	var out []string
	var cur strings.Builder
	for i := 0; i < len(runes); i++ {
		cur.WriteRune(runes[i])
		if isSentenceEndRune(runes[i]) {
			j := i + 1
			for j < len(runes) && isSpaceRune(runes[j]) {
				j++
			}
			if j > i+1 { // 有空白 → 在此切分
				out = append(out, cur.String())
				cur.Reset()
				i = j - 1
				if j == len(runes) {
					out = append(out, "") // JS 尾部分隔符产生尾部空串
				}
			}
		}
	}
	if cur.Len() > 0 {
		out = append(out, cur.String())
	}
	return out
}

// extractFocus 返回命中段+邻接段, 总长受 maxChars 约束。
// 无命中时返回 nil(调用方降级为头部截断)。逐字对齐 TS extractFocus。
func extractFocus(text, focus string, maxChars, adjacent int) []string {
	if maxChars <= 0 {
		maxChars = 8000
	}
	if adjacent <= 0 {
		adjacent = 1
	}
	segments := splitSegments(text, 300)
	if len(segments) == 0 {
		return nil
	}
	terms := uniqueTerms(tokenize(focus))
	if len(terms) == 0 {
		return nil
	}

	// idf-lite: 全局 df 越低的词权重越高
	df := map[string]int{}
	for _, t := range terms {
		dfc := 0
		for _, seg := range segments {
			if strings.Contains(strings.ToLower(seg), t) {
				dfc++
			}
		}
		df[t] = dfc
	}
	weight := func(t string) float64 {
		return 1 + math.Log2(float64(len(segments))/math.Max(1, float64(df[t])))
	}

	// 每段得分 = Σ 命中词权重 × 次数(单词计数封顶 3, 防堆砌)
	scores := make([]float64, len(segments))
	for i, seg := range segments {
		low := strings.ToLower(seg)
		s := 0.0
		for _, t := range terms {
			count := 0
			hay := 0
			for {
				pos := strings.Index(low[hay:], t)
				if pos == -1 {
					break
				}
				count++
				hay += pos + len(t)
			}
			if count > 0 {
				s += weight(t) * math.Min(float64(count), 3)
			}
		}
		scores[i] = s
	}

	maxScore := 0.0
	for _, s := range scores {
		if s > maxScore {
			maxScore = s
		}
	}
	if maxScore <= 0 {
		return nil // 无命中
	}

	// 种子段: 得分最高的前 3+N 段(相邻已覆盖则跳过) — JS sort 稳定, Go SliceStable 对齐
	type si struct {
		s float64
		i int
	}
	order := make([]si, len(scores))
	for i, s := range scores {
		order[i] = si{s, i}
	}
	sort.SliceStable(order, func(a, b int) bool { return order[a].s > order[b].s })

	picked := map[int]bool{}
	pickedOrder := []int{} // 保持插入序仅供 size 判断; 遍历判断用 map
	for _, o := range order {
		if o.s <= 0 {
			break
		}
		covered := false
		for p := range picked {
			if absInt(p-o.i) <= adjacent {
				covered = true
				break
			}
		}
		if covered && len(picked) > 0 {
			continue
		}
		lo := o.i - adjacent
		if lo < 0 {
			lo = 0
		}
		hi := o.i + adjacent
		if hi > len(segments)-1 {
			hi = len(segments) - 1
		}
		for j := lo; j <= hi; j++ {
			if !picked[j] {
				picked[j] = true
				pickedOrder = append(pickedOrder, j)
			}
		}
		total := 0
		for idx := range picked {
			total += len(segments[idx])
		}
		if total >= maxChars {
			break
		}
		if len(picked) >= 24 {
			break
		}
	}

	idxs := make([]int, 0, len(picked))
	for i := range picked {
		idxs = append(idxs, i)
	}
	sort.Ints(idxs)
	out := make([]string, 0, len(idxs))
	for _, i := range idxs {
		out = append(out, segments[i])
	}
	// 预算裁剪: 从后往前丢分数最低的段直到达标(保最相关的种子段在前的组合)
	joinLen := func(list []string) int { return len(strings.Join(list, "\n…\n")) }
	total := joinLen(out)
	for total > maxChars && len(out) > 1 {
		minIdx := 0
		minScore := math.Inf(1)
		for i, seg := range out {
			// TS segments.indexOf(seg): 相同内容取第一个出现位置 — 照抄
			sc := 0.0
			for k, s2 := range segments {
				if s2 == seg {
					sc = scores[k]
					break
				}
			}
			if sc < minScore {
				minScore = sc
				minIdx = i
			}
		}
		total -= len(out[minIdx])
		out = append(out[:minIdx], out[minIdx+1:]...)
	}
	return out
}

func absInt(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
