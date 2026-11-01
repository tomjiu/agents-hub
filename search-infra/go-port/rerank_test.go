// rerank_test.go — 批 27: cross-encoder 重排单测
// 覆盖: ①tokenizer golden 对拍 (与 Python tokenizers 逐 id 一致, testdata/tokenizer-golden.json)
//
//	②bertNormalize/bertPreTokenize/wordPiece 单元行为
//	③rerankOrderBy 融合序 (lin-λ 纯函数)
//	④rerankRefs 关闭/路径缺失优雅回退
//
// 说明: ONNX 真推理由外部 A/B 评测验证 (需 lib+模型), 单测不依赖 ort 初始化。
package main

import (
	"encoding/json"
	"os"
	"testing"
)

// ---------- ① golden 对拍 ----------

func TestBertTokenizerGolden(t *testing.T) {
	data, err := os.ReadFile("testdata/tokenizer-golden.json")
	if err != nil {
		t.Fatalf("golden 读取: %v (scripts/gen-tokenizer-golden.py 生成)", err)
	}
	var cases []struct {
		Q       string `json:"q"`
		D       string `json:"d"`
		IDs     []int  `json:"ids"`
		TypeIDs []int  `json:"typeIds"`
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("golden 解析: %v", err)
	}
	vocab := loadTestVocab(t)
	for i, c := range cases {
		ids, types := encodePair(c.Q, c.D, vocab, rerankUNK)
		if len(ids) != len(c.IDs) {
			t.Fatalf("case %d len mismatch: got %d want %d\nq=%q", i, len(ids), len(c.IDs), c.Q)
		}
		for j := range ids {
			if ids[j] != c.IDs[j] {
				t.Fatalf("case %d ids[%d]: got %d want %d\nq=%q d=%q", i, j, ids[j], c.IDs[j], c.Q, c.D)
			}
			if types[j] != c.TypeIDs[j] {
				t.Fatalf("case %d types[%d]: got %d want %d", i, j, types[j], c.TypeIDs[j])
			}
		}
	}
}

func loadTestVocab(t *testing.T) map[string]int {
	t.Helper()
	data, err := os.ReadFile("/home/z/my-project/.cache/ce-model/tokenizer.json")
	if err != nil {
		t.Skipf("tokenizer.json 不可达 (CI 无模型): %v", err)
	}
	var tj struct {
		Model struct {
			Vocab map[string]int `json:"vocab"`
		} `json:"model"`
	}
	if err := json.Unmarshal(data, &tj); err != nil || len(tj.Model.Vocab) == 0 {
		t.Fatalf("vocab 解析失败: %v", err)
	}
	return tj.Model.Vocab
}

// ---------- ② tokenizer 单元行为 ----------

func TestBertNormalize(t *testing.T) {
	cases := []struct{ in, want string }{
		{"Hello World", "hello world"},
		{"A\tB\nC", "a b c"},                     // 空白规整
		{"x\x00y\x7fz", "xyz"},                   // 控制字符删除
		{"美国的首都", " 美  国  的  首  都 "},             // CJK 两侧加空格 (HF 同款, 每 char 独立加 → 双空格, pre-tokenize 等价)
		{"  spaced   out  ", "  spaced   out  "}, // 多空格在 normalize 阶段不合并 (HF 同款, pre-tokenize 吃掉)
	}
	for _, c := range cases {
		if got := bertNormalize(c.in); got != c.want {
			t.Errorf("bertNormalize(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestBertPreTokenizePunct(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"802.11a", []string{"802", ".", "11a"}},
		{"don't", []string{"don", "'", "t"}},
		{"c++ vs c#", []string{"c", "+", "+", "vs", "c", "#"}},
		{"plain words", []string{"plain", "words"}},
	}
	for _, c := range cases {
		got := bertPreTokenize(c.in)
		if len(got) != len(c.want) {
			t.Errorf("bertPreTokenize(%q) = %v, want %v", c.in, got, c.want)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("bertPreTokenize(%q)[%d] = %q, want %q", c.in, i, got[i], c.want[i])
			}
		}
	}
}

func TestWordPiece(t *testing.T) {
	vocab := map[string]int{
		"humbl": 1, "##e": 2, "##and": 3, "kind": 4, "[UNK]": 100,
	}
	if got := wordPiece("humble", vocab, 100); len(got) != 2 || got[0] != 1 || got[1] != 2 {
		t.Errorf("wordPiece(humble) = %v, want [1 2]", got)
	}
	if got := wordPiece("zzzzzz", vocab, 100); len(got) != 1 || got[0] != 100 {
		t.Errorf("wordPiece(zzzzzz) = %v, want [100 UNK]", got)
	}
	if got := wordPiece("kind", vocab, 100); len(got) != 1 || got[0] != 4 {
		t.Errorf("wordPiece(kind) = %v, want [4]", got)
	}
	// 超 100 rune 整词 UNK
	long := make([]byte, 120)
	for i := range long {
		long[i] = 'a'
	}
	if got := wordPiece(string(long), vocab, 100); len(got) != 1 || got[0] != 100 {
		t.Errorf("wordPiece(long) = %v, want [100]", got)
	}
}

// ---------- ③ 融合序纯函数 ----------

func TestRerankOrderBy(t *testing.T) {
	mk := func(score float64, title string) Reference {
		return Reference{Score: score, Title: title}
	}
	// lin-4: key = score*10 + 4*cs
	// p0: 3.0*10+4*1 = 34 | p1: 2.5*10+4*9 = 61 | p2: 2.8*10+4*(-2) = 20 | p3: 2.0*10+4*5 = 40
	pool := []Reference{mk(3.0, "p0"), mk(2.5, "p1"), mk(2.8, "p2"), mk(2.0, "p3")}
	cs := []float32{1, 9, -2, 5}
	got := rerankOrderBy(pool, cs, 4)
	want := []string{"p1", "p3", "p0", "p2"}
	for i, w := range want {
		if got[i].Title != w {
			t.Fatalf("rerankOrderBy[%d] = %s, want %s", i, got[i].Title, w)
		}
	}
	// λ=0: 退化为纯融合分序 (score 降序)
	got = rerankOrderBy(pool, cs, 0)
	want = []string{"p0", "p2", "p1", "p3"}
	for i, w := range want {
		if got[i].Title != w {
			t.Fatalf("lambda=0 rerankOrderBy[%d] = %s, want %s", i, got[i].Title, w)
		}
	}
}

// ---------- ④ 开关与优雅回退 ----------

func TestRerankRefsDisabledByDefault(t *testing.T) {
	t.Setenv("SC_RERANK", "0")
	refs := []Reference{
		{Score: 3.0, Title: "a"}, {Score: 2.0, Title: "b"},
	}
	got, ok, _ := rerankRefs(refs, "query", nil)
	if ok {
		t.Fatal("SC_RERANK=0 不应触发重排")
	}
	if len(got) != 2 || got[0].Title != "a" {
		t.Fatal("关闭时应原序返回")
	}
	// 未设也关闭
	os.Unsetenv("SC_RERANK")
	got, ok, _ = rerankRefs(refs, "query", nil)
	if ok || len(got) != 2 {
		t.Fatal("SC_RERANK 未设不应触发重排")
	}
}

func TestRerankRefsGracefulFallbackOnMissingPaths(t *testing.T) {
	// 路径缺失 → init 失败 → 原序返回 (且进程内标记 failed, 不影响其他测试:
	// rerankInitOnce 是 sync.Once, 本测试故意用缺失路径会污染后续开启型测试 —
	// 因此放在本文件最后一个测试执行; Go 测试按文件内声明序执行)
	t.Setenv("SC_RERANK", "1")
	t.Setenv("SC_RERANK_LIB", "/nonexistent/libonnxruntime.so")
	t.Setenv("SC_RERANK_MODEL", "/nonexistent/model.onnx")
	t.Setenv("SC_RERANK_VOCAB", "/nonexistent/tokenizer.json")
	refs := []Reference{
		{Score: 3.0, Title: "a"}, {Score: 2.0, Title: "b"}, {Score: 1.0, Title: "c"},
	}
	got, ok, _ := rerankRefs(refs, "query", nil)
	if ok {
		t.Fatal("路径缺失不应报告重排成功")
	}
	if len(got) != 3 || got[0].Title != "a" || got[2].Title != "c" {
		t.Fatal("初始化失败应原序返回")
	}
}
