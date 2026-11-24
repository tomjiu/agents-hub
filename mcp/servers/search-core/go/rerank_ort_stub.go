//go:build !onnx
// +build !onnx

package main

// rerank_ort_stub.go — G1-1 (issue #3 评论): 默认纯 Go 构建的 cross-encoder stub。
// 默认构建 (无 -tags onnx, CGO_ENABLED=0) 不携带 onnxruntime C 依赖;
// SC_RERANK=1 时初始化显式报错 (构建变体透明), rerankRefs 优雅回退原序 —
// 与路径缺失/初始化失败的既有回退契约一致 (查询永不失败)。
// 增强构建见 rerank_ort_onnx.go (go build -tags onnx)。

import "errors"

// rerankBackendInit: 默认构建无推理后端 — 显式错误 (不静默伪装成功)
func rerankBackendInit(lib, model string, threads int) error {
	return errors.New("cross-encoder rerank unavailable: binary built without `-tags onnx` (pure-Go default build); rebuild with CGO_ENABLED=1 go build -tags onnx to enable")
}

// rerankBackendScore: 同上 — 默认构建不可达 (init 先失败)
func rerankBackendScore(flatIds, flatTypes, flatMask []int64, n, maxLen int) ([]float32, error) {
	return nil, errors.New("cross-encoder rerank unavailable: binary built without `-tags onnx`")
}
