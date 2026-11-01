package main

// 重排实验基准: 零模型 TF-hash embedding 作为排序信号的成本量级
// 运行: go test -bench=BenchTFVector -benchtime=200x -run='^$'

import (
	"strings"
	"testing"
)

func benchDocs() (string, []string) {
	q := "who is the founder of the ubuntu project"
	docs := make([]string, 0, 20)
	for i := 0; i < 20; i++ {
		docs = append(docs, strings.Repeat("Ubuntu is a Linux distribution developed by Canonical and the community. ", 3)+string(rune('a'+i%26)))
	}
	return q, docs
}

// 对 20 个候选文档做 query/doc 向量化 + 余弦(重排一屏的完整成本)
func BenchmarkTFVectorRerank20(b *testing.B) {
	q, docs := benchDocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		qv := tfVector(q)
		for _, d := range docs {
			_ = cosine(qv, tfVector(d))
		}
	}
}

// 单文档向量化(纯特征成本)
func BenchmarkTFVectorSingle(b *testing.B) {
	_, docs := benchDocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = tfVector(docs[i%len(docs)])
	}
}
