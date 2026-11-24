package main

// G1 行为回归: 有界读取 / DOM 节点预算 / 收割取消传播 (issue #3 评论 G1-3/G1-4/G1-6)

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

// ---------- G1-3: ReadBounded ----------

func TestReadBoundedUnderLimit(t *testing.T) {
	b, err := ReadBounded(strings.NewReader("hello"), 16)
	if err != nil || string(b) != "hello" {
		t.Fatalf("got %q err=%v", b, err)
	}
}

func TestReadBoundedOverLimitExplicitError(t *testing.T) {
	// 超限必须显式报错 — 不得静默截断成"伪正常"JSON/正文
	big := strings.Repeat("x", 1024)
	_, err := ReadBounded(strings.NewReader(big), 512)
	if !errors.Is(err, ErrBodyOverLimit) {
		t.Fatalf("want ErrBodyOverLimit, got %v", err)
	}
	// 恰好等于上限: 不报错 (limit+1 语义)
	b, err := ReadBounded(strings.NewReader(big[:512]), 512)
	if err != nil || len(b) != 512 {
		t.Fatalf("at-limit must pass, got err=%v len=%d", err, len(b))
	}
}

func TestReadAllStringBounded(t *testing.T) {
	// readAllString 超限返回 "" (不返回截断内容)
	big := strings.Repeat("y", maxAPIBodyBytes+1)
	if s := readAllString(strings.NewReader(big)); s != "" {
		t.Fatalf("over-limit readAllString must return empty, got len=%d", len(s))
	}
}

// ---------- G1-4: DOM 节点预算 ----------

func TestExtractHtmlNodeBudget(t *testing.T) {
	// 正常小页面不受影响
	ex := extractHtml("<html><body><article><p>ok</p></article></body></html>")
	if ex.Text != "ok" {
		t.Fatalf("normal page broken: %q", ex.Text)
	}
	// 病态节点数: 超预算拒绝处理 (显式空结果 + journal 记录), 不静默产出
	huge := "<html><body><article>" + strings.Repeat("<i>x</i>", 1_600_000) + "</article></body></html>"
	t0 := time.Now()
	ex = extractHtml(huge)
	dt := time.Since(t0)
	if ex.Text != "" {
		t.Fatalf("over-budget DOM must yield empty text, got len=%d", len(ex.Text))
	}
	if dt > 30*time.Second { // race 构建下解析显著变慢, 上限放宽
		t.Fatalf("over-budget rejection too slow: %v", dt)
	}
}

func TestDomNodeBudgetEnv(t *testing.T) {
	// SC_MAX_DOM_NODES 可调: 小预算下小页面也被拒
	t.Setenv("SC_MAX_DOM_NODES", "3")
	h := "<html><body><article><p>a</p><p>b</p><p>c</p></article></body></html>"
	if ex := extractHtml(h); ex.Text != "" {
		t.Fatalf("budget=3 must reject 6-node doc, got %q", ex.Text)
	}
	// 默认(未设): 同页面通过
	t.Setenv("SC_MAX_DOM_NODES", "")
	if ex := extractHtml(h); ex.Text == "" {
		t.Fatal("default budget must accept small doc")
	}
}

// ---------- G1-4: 解析并发上限 ----------

func TestDomParseSemaphore(t *testing.T) {
	// 信号量存在且有界; 并发 extractHtml 不超过上限 (忙等采样)
	sem := domParseSem()
	if sem == nil {
		t.Fatal("nil semaphore")
	}
	n := 16
	var wg sync.WaitGroup
	maxSeen := 0
	var mu sync.Mutex
	start := time.Now()
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			acquireDomParse()
			mu.Lock()
			if cur := domParseInFlight(); cur > maxSeen {
				maxSeen = cur
			}
			mu.Unlock()
			time.Sleep(20 * time.Millisecond)
			releaseDomParse()
		}()
	}
	wg.Wait()
	lim := domParseLimit()
	if maxSeen > lim {
		t.Fatalf("in-flight %d exceeded limit %d", maxSeen, lim)
	}
	if time.Since(start) < time.Duration(n/lim)*15*time.Millisecond {
		t.Fatalf("no queuing observed — semaphore not bounding (lim=%d)", lim)
	}
}

// ---------- G1-6: 收割退出取消在飞腿 ----------

func TestRunLanesCtxCancelStopsInFlight(t *testing.T) {
	// run 级 ctx 取消必须传播到腿函数: 阻塞腿在取消后立即返回, 不等满自身超时。
	name := "g1-cancel-probe-lane"
	oldFn, had := laneRegistry[name]
	laneRegistry[name] = func(ctx context.Context, opts SearchOpts, client *http.Client) ([]Reference, error) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(30 * time.Second):
			return nil, nil
		}
	}
	defer func() {
		if had {
			laneRegistry[name] = oldFn
		} else {
			delete(laneRegistry, name)
		}
	}()

	runCtx, cancel := context.WithCancel(context.Background())
	opts := SearchOpts{Query: "q", Engines: []string{name}, TimeoutMs: 30000}
	done := make(chan struct{})
	var rs []laneResult
	go func() {
		rs = runLanesCtx(runCtx, opts, &http.Client{})
		close(done)
	}()
	time.Sleep(50 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("run-level cancel did not stop in-flight lane (still blocked)")
	}
	if len(rs) != 1 || rs[0].Err == nil {
		t.Fatalf("cancelled lane must surface ctx error, got %+v", rs)
	}
}
