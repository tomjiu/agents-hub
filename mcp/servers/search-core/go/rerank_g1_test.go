//go:build !onnx

package main

// G1-1/G1-5 (issue #3 评论): rerank 构建/预算行为回归 — 默认纯 Go 构建变体。
// 覆盖: stub 透明性(不伪装成功)、推理超时回退、排队有界、线程预算默认值。

import (
	"strings"
	"sync"
	"testing"
	"time"
)

// stub 构建变体: init 显式报错且指明构建方式 (透明, 不静默)
func TestRerankStubBuildTransparentError(t *testing.T) {
	if err := rerankBackendInit("/nonexistent/lib.so", "/nonexistent/m.onnx", 4); err == nil {
		t.Fatal("stub backend must fail init")
	} else if !strings.Contains(err.Error(), "without `-tags onnx`") {
		t.Fatalf("error must name the build remedy, got: %v", err)
	}
}

// SC_RERANK=1 + stub 构建: rerankRefs 优雅回退原序 (查询永不失败)
func TestRerankRefsFallbackOnStubBuild(t *testing.T) {
	t.Setenv("SC_RERANK", "1")
	t.Setenv("SC_RERANK_LIB", "/nonexistent/lib.so")
	t.Setenv("SC_RERANK_MODEL", "/nonexistent/m.onnx")
	t.Setenv("SC_RERANK_VOCAB", "/nonexistent/v.json")
	refs := []Reference{{Score: 3, Title: "a"}, {Score: 2, Title: "b"}}
	got, ok, _ := rerankRefs(refs, "q", nil)
	if ok {
		t.Fatal("stub build must not claim rerank success")
	}
	if len(got) != 2 || got[0].Title != "a" {
		t.Fatal("fallback must preserve original order")
	}
}

// G1-5: 排队有界 — 锁被占用时, 有界等待后放弃而不是无限排队
func TestRerankScoreGuardedBoundedQueueWait(t *testing.T) {
	t.Setenv("SC_RERANK_QUEUE_WAIT_MS", "50")
	// 占住锁模拟推理在飞
	rerankMu.Lock()
	done := make(chan error, 1)
	go func() {
		_, err := rerankScoreGuarded(func() ([]float32, error) { return []float32{1}, nil })
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "busy") {
			t.Fatalf("want busy error, got %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("bounded wait did not give up — unbounded queue")
	}
	rerankMu.Unlock()
}

// G1-5: 推理超时 — 到点回退且进程内 disabled
func TestRerankScoreGuardedInferenceTimeout(t *testing.T) {
	t.Setenv("SC_RERANK_TIMEOUT_MS", "100")
	old := rerankState
	defer func() { rerankState = old }()
	t0 := time.Now()
	_, err := rerankScoreGuarded(func() ([]float32, error) {
		time.Sleep(10 * time.Second) // 模拟挂死推理
		return nil, nil
	})
	dt := time.Since(t0)
	if err == nil || !strings.Contains(err.Error(), "timeout") {
		t.Fatalf("want timeout error, got %v", err)
	}
	if dt > 3*time.Second {
		t.Fatalf("timeout must fire near deadline, took %v", dt)
	}
	if rerankState != rerankFailed {
		t.Fatal("timeout must disable rerank for process")
	}
}

// G1-5: 排队等待 0 — 立即放弃
func TestRerankScoreGuardedZeroQueueWait(t *testing.T) {
	t.Setenv("SC_RERANK_QUEUE_WAIT_MS", "0")
	rerankMu.Lock()
	t0 := time.Now()
	_, err := rerankScoreGuarded(func() ([]float32, error) { return nil, nil })
	dt := time.Since(t0)
	rerankMu.Unlock()
	if err == nil || !strings.Contains(err.Error(), "busy") {
		t.Fatalf("want immediate busy error, got %v", err)
	}
	if dt > 500*time.Millisecond {
		t.Fatalf("queue wait 0 must abort immediately, took %v", dt)
	}
}

// 并发排队上限: N 并发打分, 全部在界内返回 (不 hang, 不 panic)
func TestRerankScoreGuardedConcurrentAllBounded(t *testing.T) {
	rerankMu.Lock()
	var wg sync.WaitGroup
	results := make([]error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, results[i] = rerankScoreGuarded(func() ([]float32, error) { return nil, nil })
		}(i)
	}
	wg.Wait()
	rerankMu.Unlock()
	for i, err := range results {
		if err == nil {
			t.Fatalf("[%d] expected busy error under full lock", i)
		}
	}
}

// G1-5: 正常路径 — 后端返回即透传 (不受超时影响)
func TestRerankScoreGuardedPassThrough(t *testing.T) {
	cs, err := rerankScoreGuarded(func() ([]float32, error) {
		return []float32{0.5, -0.25}, nil
	})
	if err != nil || len(cs) != 2 || cs[0] != 0.5 || cs[1] != -0.25 {
		t.Fatalf("pass-through broken: %v %v", cs, err)
	}
}
