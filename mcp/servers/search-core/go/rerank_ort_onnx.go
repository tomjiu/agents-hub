//go:build onnx
// +build onnx

package main

// rerank_ort_onnx.go — G1-1 (issue #3 评论): cross-encoder 推理后端 (增强构建)
// 仅在 `go build -tags onnx` (CGO) 时编译; 默认构建为纯 Go, 见 rerank_ort_stub.go。
// 行为契约与原批 27 实现逐字一致: SetSharedLibraryPath → InitializeEnvironment →
// session options (intra-op 线程) → NewDynamicAdvancedSession; 打分 [n,maxLen]
// 三输入 → logits [n,1]。失败即返回错误, 由 rerank.go 统一优雅回退。

import (
	ort "github.com/yalue/onnxruntime_go"
)

var rerankSession *ort.DynamicAdvancedSession

// rerankBackendInit: libonnxruntime 路径 + 模型 + intra-op 线程预算
func rerankBackendInit(lib, model string, threads int) error {
	ort.SetSharedLibraryPath(lib)
	if err := ort.InitializeEnvironment(); err != nil {
		return err
	}
	sOpts, err := ort.NewSessionOptions()
	if err != nil {
		return err
	}
	defer sOpts.Destroy()
	if err := sOpts.SetIntraOpNumThreads(threads); err != nil {
		return err
	}
	s, err := ort.NewDynamicAdvancedSession(model,
		[]string{"input_ids", "attention_mask", "token_type_ids"},
		[]string{"logits"}, sOpts)
	if err != nil {
		return err
	}
	rerankSession = s
	return nil
}

// rerankBackendScore: 批量打分 (已由 rerank.go 完成编码/padding; mutex 由调用方持有)
func rerankBackendScore(flatIds, flatTypes, flatMask []int64, n, maxLen int) ([]float32, error) {
	shape := ort.NewShape(int64(n), int64(maxLen))
	tIds, err := ort.NewTensor(shape, flatIds)
	if err != nil {
		return nil, err
	}
	defer tIds.Destroy()
	tTypes, err := ort.NewTensor(shape, flatTypes)
	if err != nil {
		return nil, err
	}
	defer tTypes.Destroy()
	tMask, err := ort.NewTensor(shape, flatMask)
	if err != nil {
		return nil, err
	}
	defer tMask.Destroy()
	// v1.36 API: 输出需预分配 (logits shape: [n, 1])
	tOut, err := ort.NewTensor(ort.NewShape(int64(n), 1), make([]float32, n))
	if err != nil {
		return nil, err
	}
	defer tOut.Destroy()
	if err := rerankSession.Run([]ort.Value{tIds, tMask, tTypes}, []ort.Value{tOut}); err != nil {
		return nil, err
	}
	src := tOut.GetData()
	out := make([]float32, n)
	copy(out, src)
	return out, nil
}
