package main

// G0 基线探针 (issue #3 评论 G0): 可复现资源/延迟基线 — 仅 SC_G0=1 时运行。
// 输出 JSON 到 stdout; 由 scripts/g0-baseline.sh 收集两侧 (Go/TS) 同输入对照。
// 纪律: 本地合成输入的资源测量, 不冒充公网 SERP 质量; 网络相关项如实 NOT_MEASURED。

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

type g0Ms struct {
	P50   float64 `json:"p50"`
	P95   float64 `json:"p95"`
	N     int     `json:"n"`
	Suite []int64 `json:"-"`
}

func g0Percentiles(xs []int64) g0Ms {
	if len(xs) == 0 {
		return g0Ms{}
	}
	v := make([]int64, len(xs))
	copy(v, xs)
	sort.Slice(v, func(i, j int) bool { return v[i] < v[j] })
	p := func(q float64) float64 {
		idx := int(float64(len(v)-1) * q)
		return float64(v[idx])
	}
	return g0Ms{P50: p(0.5), P95: p(0.95), N: len(v), Suite: v}
}

func g0RSSKB() int { // current VmRSS in KB
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			var kb int
			fmt.Sscanf(line, "VmRSS: %d", &kb)
			return kb
		}
	}
	return 0
}

func g0HWMKB() int { // peak VmHWM in KB
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "VmHWM:") {
			var kb int
			fmt.Sscanf(line, "VmHWM: %d", &kb)
			return kb
		}
	}
	return 0
}

func g0CPUms() int64 { // user+sys CPU of self in ms
	var ru syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &ru); err != nil {
		return 0
	}
	u := time.Duration(ru.Utime.Sec)*time.Second + time.Duration(ru.Utime.Usec)*time.Microsecond
	s := time.Duration(ru.Stime.Sec)*time.Second + time.Duration(ru.Stime.Usec)*time.Microsecond
	return (u + s).Milliseconds()
}

func g0GC() {
	runtime.GC()
	runtime.GC()
	time.Sleep(50 * time.Millisecond)
}

func TestG0Baseline(t *testing.T) {
	if os.Getenv("SC_G0") != "1" {
		t.Skip("SC_G0 != 1")
	}
	if runtime.GOOS != "linux" {
		t.Fatalf("G0 probe assumes /proc (linux), got %s", runtime.GOOS)
	}

	out := map[string]any{
		"probe":   "go",
		"goVer":   runtime.Version(),
		"numCPU":  runtime.NumCPU(),
		"dateUTC": time.Now().UTC().Format(time.RFC3339),
	}

	// ---------- 1) 密集 HTML 提取: 1MB / 2MB ----------
	// 输入文件由 scripts/g0-baseline.sh 统一生成 (Go/TS 同输入)
	for _, mb := range []int{1, 2} {
		path := fmt.Sprintf("/tmp/g0-dense-%dmb.html", mb)
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v (run scripts/g0-baseline.sh first)", path, err)
		}
		html := string(b)
		g0GC()
		rss0, hwm0 := g0RSSKB(), g0HWMKB()
		cpu0 := g0CPUms()
		var times []int64
		const reps = 7
		for i := 0; i < reps; i++ {
			t0 := time.Now()
			ex := extractHtml(html)
			times = append(times, time.Since(t0).Milliseconds())
			if ex.Text == "" {
				t.Fatalf("%dMB: empty text", mb)
			}
		}
		ms := g0Percentiles(times)
		out[fmt.Sprintf("dense%dMB", mb)] = map[string]any{
			"inputBytes": len(html), "wallMs": ms,
			"cpuMs":      g0CPUms() - cpu0,
			"rssKBDelta": g0RSSKB() - rss0,
			"peakHWMKB":  g0HWMKB(),
			"hwmDeltaKB": g0HWMKB() - hwm0,
		}
	}

	// ---------- 2) 8 并发解析 (信号量上限下的排队行为) ----------
	b1, _ := os.ReadFile("/tmp/g0-dense-1mb.html")
	html1 := string(b1)
	g0GC()
	rss0 := g0RSSKB()
	var wg sync.WaitGroup
	var mu sync.Mutex
	var walls []int64
	t0 := time.Now()
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s := time.Now()
			extractHtml(html1)
			mu.Lock()
			walls = append(walls, time.Since(s).Milliseconds())
			mu.Unlock()
		}()
	}
	wg.Wait()
	out["concurrent8x1MB"] = map[string]any{
		"totalWallMs":   time.Since(t0).Milliseconds(),
		"perTaskMs":     g0Percentiles(walls),
		"rssKBDelta":    g0RSSKB() - rss0,
		"domParseLimit": domParseLimit(),
	}

	// ---------- 3) 长跑漂移 (泄漏检测): 300 次 256KB 解析 ----------
	small := html1
	if len(small) > 256*1024 {
		small = small[:256*1024]
	}
	g0GC()
	rssBefore := g0RSSKB()
	var heapBefore uint64
	var ms1 runtime.MemStats
	runtime.ReadMemStats(&ms1)
	heapBefore = ms1.HeapAlloc
	for i := 0; i < 300; i++ {
		extractHtml(small)
	}
	g0GC()
	rssAfter := g0RSSKB()
	var ms2 runtime.MemStats
	runtime.ReadMemStats(&ms2)
	out["longRun300x256KB"] = map[string]any{
		"rssKBBefore": rssBefore, "rssKBAfter": rssAfter,
		"rssKBDrift":      rssAfter - rssBefore,
		"heapAllocBefore": heapBefore, "heapAllocAfter": ms2.HeapAlloc,
		"mallocsDelta": ms2.Mallocs - ms1.Mallocs,
		"goroutines":   runtime.NumGoroutine(),
	}

	// ---------- 4) 缓存冷/热 (SQLite 搜索缓存) ----------
	tmp := t.TempDir()
	t.Setenv("SC_DATA_DIR", tmp)
	c, err := OpenCache(tmp)
	if err != nil {
		t.Fatalf("cache: %v", err)
	}
	key := searchCacheKey([]string{"g0 probe"}, "general", SearchOpts{Query: "g0 probe", Lang: "zh", TopN: 10})
	payload := []byte(`{"query":"g0 probe","refs":[{"url":"https://example.com/a","title":"a","snippet":"s"}],"meta":{}}`)
	var cold, warm []int64
	for i := 0; i < 5; i++ {
		k := fmt.Sprintf("%s-%d", key, i)
		t0 := time.Now()
		c.PutSearch(k, payload)
		cold = append(cold, time.Since(t0).Milliseconds())
	}
	for i := 0; i < 50; i++ {
		t0 := time.Now()
		if hit := c.GetSearch(key+"-0", 900); hit == nil {
			t.Fatal("warm cache miss")
		}
		warm = append(warm, time.Since(t0).Milliseconds())
	}
	out["cacheSQLite"] = map[string]any{
		"putMs": g0Percentiles(cold), "getMs": g0Percentiles(warm),
	}
	c.Close()

	// ---------- 5) 收割取消传播延迟 (runLanesCtx) ----------
	name := "g0-cancel-probe-lane"
	laneRegistry[name] = func(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	runCtx, cancel := context.WithCancel(context.Background())
	opts := SearchOpts{Query: "q", Engines: []string{name}, TimeoutMs: 30000}
	done := make(chan []laneResult, 1)
	go func() { done <- runLanesCtx(runCtx, opts, &http.Client{}) }()
	time.Sleep(80 * time.Millisecond)
	tc := time.Now()
	cancel()
	rs := <-done
	out["harvestCancelPropagationMs"] = time.Since(tc).Milliseconds()
	if len(rs) != 1 || rs[0].Err == nil {
		t.Fatalf("cancel result: %+v", rs)
	}
	delete(laneRegistry, name)

	// ---------- 6) MCP stdio 空闲: 子进程启动 + initialize 往返 + RSS ----------
	bin, err := os.Executable()
	if err == nil {
		// go test binary 不是 searchcore; 用 SC_G0_BIN 指定的构建产物
		if env := os.Getenv("SC_G0_BIN"); env != "" {
			bin = env
		}
	}
	if strings.HasSuffix(bin, ".test") || os.Getenv("SC_G0_BIN") != "" {
		cmd := exec.Command(bin, "serve")
		cmd.Stdin = strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"g0","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
`)
		var stdout strings.Builder
		cmd.Stdout = &stdout
		cmd.Stderr = os.Stderr
		start := time.Now()
		if err := cmd.Start(); err != nil {
			t.Fatalf("spawn serve: %v", err)
		}
		// 等首个输出行 (initialize 响应)
		initLatency := time.Duration(0)
		cmd.Wait()
		initLatency = time.Since(start)
		lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
		out["mcpStdioIdle"] = map[string]any{
			"spawnToExitMs": initLatency.Milliseconds(),
			"responseLines": len(lines),
			"note":          "spawn+initialize+tools/list 单管道往返 (子进程级)",
		}
	} else {
		out["mcpStdioIdle"] = map[string]any{"status": "NOT_MEASURED", "reason": "SC_G0_BIN 未指定 searchcore 二进制"}
	}

	// ---------- 7) 如实声明未测项 ----------
	out["notMeasured"] = []string{
		"realSERP (公网质量/延迟): 本探针为本地合成资源基线, 不冒充公网结果",
		"rerankOn (增强推理): 模型三件套未部署, SC_RERANK 默认关闭; 需 -tags onnx 构建 + 模型资产后另测",
		"eventLoopLag: Go 无 JS 事件循环等价物, 以 CPU/goroutine 口径替代",
	}

	// 输出到 SC_G0_OUT 指定文件 (stdout 会被 go test 框架输出污染)
	dest := os.Getenv("SC_G0_OUT")
	if dest == "" {
		dest = "/tmp/g0-go.json"
	}
	f, err := os.Create(dest)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(out); err != nil {
		t.Fatal(err)
	}
	fmt.Fprintf(os.Stderr, "g0 probe written to %s\n", dest)
}
