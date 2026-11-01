// rerank_e2e_test.go — 批 27: Go 推理与 Python onnxruntime 分数对拍 (条件测试)
// 守卫: SC_RERANK_E2E=1 且模型三路径就位才跑 (CI/常规单测跳过, 不依赖 ORT)
// Python 侧: scripts/ce-parity-check.py 读取同一 refs.json 打分输出, 人工比对。
package main

import (
	"encoding/json"
	"os"
	"testing"
)

func TestRerankScoresParity(t *testing.T) {
	if os.Getenv("SC_RERANK_E2E") != "1" {
		t.Skip("SC_RERANK_E2E != 1, 跳过 ORT 实弹对拍")
	}
	f := os.Getenv("SC_RERANK_E2E_REFS")
	q := os.Getenv("SC_RERANK_E2E_Q")
	if f == "" || q == "" {
		t.Skip("SC_RERANK_E2E_REFS/Q 未配置")
	}
	data, err := os.ReadFile(f)
	if err != nil {
		t.Fatal(err)
	}
	var row struct {
		Refs []Reference `json:"refs"`
	}
	if err := json.Unmarshal(data, &row); err != nil {
		t.Fatal(err)
	}
	n := 10
	if len(row.Refs) < n {
		n = len(row.Refs)
	}
	docs := make([]string, n)
	for i := 0; i < n; i++ {
		docs[i] = row.Refs[i].Title + "\n" + row.Refs[i].Snippet
	}
	cs, err := rerankScores(q, docs)
	if err != nil {
		t.Fatalf("rerankScores: %v", err)
	}
	out, _ := json.Marshal(cs)
	t.Logf("GO_CS=%s", string(out))
}
