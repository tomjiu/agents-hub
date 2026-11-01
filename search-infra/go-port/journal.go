package main

// journal.jsonl 运行日志 (对齐 TS journal.ts v0-spec §4.5, Trae[06] journal 断点恢复思想 v0.1 观测版)
// 每个 run 一个文件: data/journal/<ts>-<runid>.jsonl
// 事件: run_start / planner / engine_result / engine_error / fusion / fetch / run_end
// 保留最近 50 个 run, 超出滚动清理。日志失败不影响主链路。

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const keepRuns = 50

type Journal struct {
	mu   sync.Mutex
	path string // 空 = 未启用
	dir  string
}

func NewJournal(dataDir string, enabled bool) *Journal {
	j := &Journal{}
	if !enabled || dataDir == "" {
		return j
	}
	j.dir = filepath.Join(dataDir, "journal")
	if err := os.MkdirAll(j.dir, 0o755); err != nil {
		return j // 日志失败不影响主链路
	}
	runID := randomID8()
	j.path = filepath.Join(j.dir, strconv.FormatInt(time.Now().UnixMilli(), 10)+"-"+runID+".jsonl")
	j.Write("run_start", map[string]any{})
	j.gc()
	return j
}

func randomID8() string {
	// crypto 随机 8 hex(对齐 TS randomUUID().slice(0,8) 形状)
	b := make([]byte, 4)
	if f, err := os.Open("/dev/urandom"); err == nil {
		defer f.Close()
		_, _ = f.Read(b)
	} else {
		now := time.Now().UnixNano()
		b[0] = byte(now)
		b[1] = byte(now >> 8)
		b[2] = byte(now >> 16)
		b[3] = byte(now >> 24)
	}
	const hex = "0123456789abcdef"
	out := make([]byte, 8)
	for i, v := range b {
		out[i*2] = hex[v>>4]
		out[i*2+1] = hex[v&0xf]
	}
	return string(out)
}

// Write 追加一条事件 {ts, event, ...data}; 失败静默(观测面不拖垮主链路)
func (j *Journal) Write(event string, data map[string]any) {
	if j == nil || j.path == "" {
		return
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	rec := map[string]any{"ts": time.Now().UnixMilli(), "event": event}
	for k, v := range data {
		rec[k] = v
	}
	raw, err := json.Marshal(rec)
	if err != nil {
		return
	}
	f, err := os.OpenFile(j.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(raw, '\n'))
}

// gc 保留最近 50 个 run 文件
func (j *Journal) gc() {
	entries, err := os.ReadDir(j.dir)
	if err != nil {
		return
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".jsonl") {
			files = append(files, filepath.Join(j.dir, e.Name()))
		}
	}
	sort.Strings(files)
	for len(files) > keepRuns {
		victim := files[0]
		files = files[1:]
		_ = os.Remove(victim)
	}
}

// Path 返回当前 run 的 journal 文件路径(未启用为空)
func (j *Journal) Path() string {
	if j == nil {
		return ""
	}
	return j.path
}
