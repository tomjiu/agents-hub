package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// health/journal 单测(对齐 TS 熔断 2.0 语义)

func newTestTracker(t *testing.T) *HealthTracker {
	t.Helper()
	dir := t.TempDir()
	return NewHealthTracker(dir)
}

func TestBreakerOpensAfterThreshold(t *testing.T) {
	h := newTestTracker(t)
	// error 类阈值 6: 连败 5 次不开
	for i := 0; i < 5; i++ {
		h.Record("laneX", false, 100, "http 500 boom", "error")
	}
	if h.IsOpen("laneX") {
		t.Fatal("5 连败不应开熔断(error 阈值 6)")
	}
	h.Record("laneX", false, 100, "http 500 boom", "error")
	if !h.IsOpen("laneX") {
		t.Fatal("6 连败应开熔断")
	}
	// 成功即重置
	h.Record("laneX", true, 50, "", "")
	if h.IsOpen("laneX") {
		t.Fatal("成功应重置熔断")
	}
}

func TestBreakerClassThresholds(t *testing.T) {
	h := newTestTracker(t)
	// blocked 阈值 2
	h.Record("laneB", false, 10, "http 403 forbidden", "")
	if h.IsOpen("laneB") {
		t.Fatal("1 次 blocked 不应开")
	}
	h.Record("laneB", false, 10, "http 403 forbidden", "")
	if !h.IsOpen("laneB") {
		t.Fatal("2 次 blocked 应开(阈值 2)")
	}
	// 混类连败重新计数: quota 1 次即开
	h2 := newTestTracker(t)
	h2.Record("laneQ", false, 10, "quota exceeded", "")
	if !h2.IsOpen("laneQ") {
		t.Fatal("quota 阈值 1 应立即开")
	}
}

func TestBreakerCooldownDoublesOnHalfOpenFail(t *testing.T) {
	h := newTestTracker(t)
	base := time.Now()
	// 429 类: 阈值 4, 冷却 2min
	for i := 0; i < 4; i++ {
		h.Record("laneR", false, 10, "http 429 too many", "rate_limited")
	}
	if !h.IsOpen("laneR") {
		t.Fatal("应开熔断")
	}
	// 注入时钟贯穿 Record/IsOpen(半开判定与 Record 用同一时钟面)
	at := func(d time.Duration) { h.now = func() time.Time { return base.Add(d) } }
	at(2*time.Minute + time.Second) // 冷却过期 → 半开
	if h.IsOpen("laneR") {
		t.Fatal("冷却过期应为半开(不再 open)")
	}
	// 半开探针又失败(仍在 2min+1s 时刻) → 冷却翻倍 4min: open 至 6min+1s
	h.Record("laneR", false, 10, "http 429 too many", "rate_limited")
	at(3 * time.Minute)
	if !h.IsOpen("laneR") {
		t.Fatal("半开失败后应重新开熔断(冷却翻倍)")
	}
	at(6 * time.Minute) // < 2min+1s+4min=6min+1s
	if !h.IsOpen("laneR") {
		t.Fatal("翻倍冷却 4min: 6min 时仍应 open")
	}
	at(6*time.Minute + 2*time.Second) // > 6min+1s → 半开
	if h.IsOpen("laneR") {
		t.Fatal("6min+2s 后应半开")
	}
	h.now = time.Now
}

func TestHealthRollingWindowDecay(t *testing.T) {
	h := newTestTracker(t)
	// ok+fail > 50 → 各减半
	for i := 0; i < 30; i++ {
		h.Record("laneW", true, 10, "", "")
	}
	for i := 0; i < 25; i++ {
		h.Record("laneW", false, 10, "x", "error")
	}
	snap := h.Snapshot("laneW", true, false)
	if snap.OK+snap.Fail > 55 { // 55 → 27+13 量级(衰减后)
		t.Fatalf("滚动窗口未衰减: ok=%d fail=%d", snap.OK, snap.Fail)
	}
}

func TestHealthPersistAcrossInstances(t *testing.T) {
	dir := t.TempDir()
	h1 := NewHealthTracker(dir)
	h1.Record("laneP", false, 10, "timeout happened", "timeout")
	h2 := NewHealthTracker(dir)
	snap := h2.Snapshot("laneP", true, false)
	if snap.Fail != 1 || snap.LastStatus != "timeout" {
		t.Fatalf("跨实例持久化失败: %+v", snap)
	}
}

func TestJournalWriteAndGC(t *testing.T) {
	dir := t.TempDir()
	j := NewJournal(dir, true)
	if j.Path() == "" {
		t.Fatal("journal 应启用")
	}
	j.Write("engine_result", map[string]any{"engine": "keenable", "count": 3})
	j.Write("fusion", map[string]any{"fused": 12})
	raw, err := os.ReadFile(j.Path())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"event":"run_start"`) || !strings.Contains(string(raw), `"event":"fusion"`) {
		t.Fatalf("journal 事件缺失: %s", raw)
	}
	// GC: 造 52 个旧文件, 新 journal 触发 gc 后应剩 50
	for i := 0; i < 52; i++ {
		p := filepath.Join(dir, "journal", strconv.FormatInt(time.Now().Add(-time.Duration(i)*time.Hour).UnixMilli(), 10)+"-gc.jsonl")
		_ = os.WriteFile(p, []byte("{}\n"), 0o644)
		time.Sleep(time.Millisecond)
	}
	NewJournal(dir, true)
	entries, _ := os.ReadDir(filepath.Join(dir, "journal"))
	if len(entries) > 50 {
		t.Fatalf("GC 后应 <=50: %d", len(entries))
	}
}

func TestJournalDisabledNoFile(t *testing.T) {
	j := NewJournal(t.TempDir(), false)
	if j.Path() != "" {
		t.Fatal("禁用时 path 应为空")
	}
	j.Write("x", nil) // 不应 panic
}
