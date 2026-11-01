package main

// HealthTracker (对齐 TS providers/base.ts v0.4 熔断 2.0): 分类熔断策略 —
// 连败阈值 + 冷却时长按失败类别差异化(wigolo 思路) + 半开探针失败冷却翻倍 + 滚动窗口衰减。
// 诚实差异: TS 状态持久化在 SQLite kv; Go 侧用 JSON 文件(data/health.json)落盘,
// 语义(阈值/冷却/半开/衰减)逐字对齐, 介质不同 README 留档。

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

// breakerPolicy 对齐 TS BREAKER_POLICY
var breakerPolicy = map[string]struct {
	threshold  int
	cooldownMs int
}{
	"rate_limited": {4, 2 * 60 * 1000},  // 软封自愈快, 短冷却
	"blocked":      {2, 15 * 60 * 1000}, // 挑战页不会自己好, 长冷却
	"quota":        {1, 30 * 60 * 1000}, // 额度烧完再试也没用
	"auth":         {1, 60 * 60 * 1000}, // key 坏了得人工修
	"timeout":      {6, 5 * 60 * 1000},
	"error":        {6, 10 * 60 * 1000}, // v0.1 默认档
}

const cooldownCapMs = 60 * 60 * 1000

type healthState struct {
	OK          int    `json:"ok"`
	Fail        int    `json:"fail"`
	AvgMs       int64  `json:"avgMs"`
	FailStreak  int    `json:"failStreak"`
	OpenUntil   int64  `json:"openUntil"`
	StreakClass string `json:"streakClass"`
	StreakCount int    `json:"streakCount"`
	CooldownMs  int    `json:"cooldownMs"` // 当前冷却基数(半开探针失败后翻倍, 上限 1h)
	LastStatus  string `json:"lastStatus,omitempty"`
	LastError   string `json:"lastError,omitempty"`
	LastOkAt    int64  `json:"lastOkAt"`
}

// ProviderHealth 对齐 TS ProviderHealth 形状
type ProviderHealth struct {
	Name         string `json:"name"`
	Configured   bool   `json:"configured"`
	NeedsKey     bool   `json:"needsKey"`
	OK           int    `json:"ok"`
	Fail         int    `json:"fail"`
	AvgLatencyMs int64  `json:"avgLatencyMs"`
	LastError    string `json:"lastError,omitempty"`
	LastOkAt     int64  `json:"lastOkAt,omitempty"`
	LastStatus   string `json:"lastStatus,omitempty"`
	CircuitOpen  bool   `json:"circuitOpen,omitempty"`
}

// kvStore 极简 kv(内存 + JSON 文件落盘), 复用给 HealthTracker
type kvStore struct {
	mu   sync.Mutex
	path string
	data map[string]string
}

func newKvStore(dataDir string) *kvStore {
	k := &kvStore{data: map[string]string{}}
	if dataDir != "" {
		k.path = filepath.Join(dataDir, "health-kv.json")
		if raw, err := os.ReadFile(k.path); err == nil {
			_ = json.Unmarshal(raw, &k.data)
		}
	}
	return k
}

func (k *kvStore) get(key string) (string, bool) {
	k.mu.Lock()
	defer k.mu.Unlock()
	v, ok := k.data[key]
	return v, ok
}

func (k *kvStore) set(key, val string) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.data[key] = val
	if k.path != "" {
		if raw, err := json.Marshal(k.data); err == nil {
			_ = os.WriteFile(k.path, raw, 0o644)
		}
	}
}

type HealthTracker struct {
	kv  *kvStore
	mu  sync.Mutex
	now func() time.Time // 测试可注入
}

func NewHealthTracker(dataDir string) *HealthTracker {
	return &HealthTracker{kv: newKvStore(dataDir), now: time.Now}
}

var healthRe = regexp.MustCompile(`health:(.+)`)

// Record 对齐 TS HealthTracker.record
func (h *HealthTracker) Record(name string, ok bool, latencyMs int64, errMsg, status string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	key := "health:" + name
	st := healthState{}
	if raw, found := h.kv.get(key); found {
		_ = json.Unmarshal([]byte(raw), &st)
	}
	total := st.OK + st.Fail
	st.AvgMs = (st.AvgMs*int64(total) + latencyMs) / int64(total+1)
	if ok {
		st.OK++
		st.FailStreak = 0
		st.OpenUntil = 0
		st.StreakClass = ""
		st.StreakCount = 0
		st.CooldownMs = 0
		st.LastOkAt = h.now().UnixMilli()
		st.LastError = ""
	} else {
		cls := status
		if cls == "" {
			cls, _ = classifyFailure(errMsg)
		}
		st.Fail++
		st.FailStreak++
		st.LastStatus = cls
		// 同类连败才累加(换成另一类重新计数)
		if st.StreakClass == cls {
			st.StreakCount++
		} else {
			st.StreakClass = cls
			st.StreakCount = 1
		}
		pol, exists := breakerPolicy[cls]
		if !exists {
			pol = breakerPolicy["error"]
		}
		if st.StreakCount >= pol.threshold {
			// 半开探针失败(上次冷却已过期又栽) → 冷却翻倍, 指数退避到上限
			wasExpiredOpen := st.OpenUntil > 0 && st.OpenUntil <= h.now().UnixMilli()
			base := pol.cooldownMs
			if wasExpiredOpen {
				prev := st.CooldownMs
				if prev < pol.cooldownMs {
					prev = pol.cooldownMs
				}
				base = prev * 2
			}
			if base > cooldownCapMs {
				base = cooldownCapMs
			}
			st.CooldownMs = base
			st.OpenUntil = h.now().UnixMilli() + int64(st.CooldownMs)
		}
		if errMsg != "" {
			st.LastError = truncStr(errMsg, 200)
		}
	}
	// 滚动窗口: 记录过多时衰减一半, 防止早期失败永久拉黑
	if st.OK+st.Fail > 50 {
		st.OK /= 2
		st.Fail /= 2
	}
	raw, _ := json.Marshal(st)
	h.kv.set(key, string(raw))
}

// IsOpen 熔断判定: 冷却期内拒绝; 冷却到期 = 半开探针(放进一个请求试水)
func (h *HealthTracker) IsOpen(name string) bool {
	raw, found := h.kv.get("health:" + name)
	if !found {
		return false
	}
	var st healthState
	if json.Unmarshal([]byte(raw), &st) != nil {
		return false
	}
	return st.OpenUntil > h.now().UnixMilli()
}

// Snapshot 对齐 TS snapshot(name, configured, needsKey)
func (h *HealthTracker) Snapshot(name string, configured, needsKey bool) ProviderHealth {
	empty := ProviderHealth{Name: name, Configured: configured, NeedsKey: needsKey}
	raw, found := h.kv.get("health:" + name)
	if !found {
		return empty
	}
	var st healthState
	if json.Unmarshal([]byte(raw), &st) != nil {
		return empty
	}
	return ProviderHealth{
		Name: name, Configured: configured, NeedsKey: needsKey,
		OK: st.OK, Fail: st.Fail,
		AvgLatencyMs: st.AvgMs,
		LastError:    st.LastError,
		LastOkAt:     st.LastOkAt,
		LastStatus:   st.LastStatus,
		CircuitOpen:  st.OpenUntil > h.now().UnixMilli(),
	}
}

// All 对齐 TS listProviders 的健康面: 返回所有已记录引擎的 snapshot
func (h *HealthTracker) All(registryOrder []string) []ProviderHealth {
	out := []ProviderHealth{}
	seen := map[string]bool{}
	add := func(name string) {
		if seen[name] {
			return
		}
		seen[name] = true
		out = append(out, h.Snapshot(name, true, false))
	}
	for _, name := range registryOrder {
		if _, ok := h.kv.get("health:" + name); ok {
			add(name)
		}
	}
	return out
}
