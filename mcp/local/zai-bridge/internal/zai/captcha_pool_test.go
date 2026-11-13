package zai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/local/zai-bridge/internal/config"
)

// This subprocess is this Go test binary, not Node or the captcha SDK.
func TestCaptchaHelperProcess(t *testing.T) {
	if os.Getenv("ZAI_FAKE_SOLVER") != "1" {
		return
	}
	mode := os.Getenv("ZAI_FAKE_MODE")
	scanner := bufio.NewScanner(os.Stdin)
	attempt := 0
	for scanner.Scan() {
		var req struct {
			ID int64 `json:"id"`
		}
		if json.Unmarshal(scanner.Bytes(), &req) != nil {
			os.Exit(3)
		}
		attempt++
		switch mode {
		case "hang":
			time.Sleep(time.Hour)
		case "exit":
			os.Exit(4)
		case "wrong-id":
			json.NewEncoder(os.Stdout).Encode(solveResponse{ID: req.ID + 100, OK: true, Param: strings.Repeat("x", 150)})
			time.Sleep(time.Hour)
		}
		resp := solveResponse{ID: req.ID, OK: true, Param: strings.Repeat("x", 150)}
		if mode == "third" && attempt < 3 {
			resp.OK = false
			resp.Error = "fake retry"
		}
		if strings.HasPrefix(mode, "delay:") {
			ms, _ := strconv.Atoi(strings.TrimPrefix(mode, "delay:"))
			time.Sleep(time.Duration(ms) * time.Millisecond)
		}
		if err := json.NewEncoder(os.Stdout).Encode(resp); err != nil {
			os.Exit(5)
		}
	}
	os.Exit(0)
}

type fakeWorkers struct {
	mu  sync.Mutex
	all []*worker
}

func fakePool(t *testing.T, cfg config.CaptchaConfig, mode func(int) string) (*Pool, *fakeWorkers) {
	t.Helper()
	p := NewPool(cfg)
	track := &fakeWorkers{}
	p.start = func() (*worker, error) {
		track.mu.Lock()
		i := len(track.all)
		track.mu.Unlock()
		cmd := exec.Command(os.Args[0], "-test.run=^TestCaptchaHelperProcess$")
		cmd.Env = append(os.Environ(), "ZAI_FAKE_SOLVER=1", "ZAI_FAKE_MODE="+mode(i))
		w, err := startWorkerCommand(cmd)
		if err == nil {
			track.mu.Lock()
			track.all = append(track.all, w)
			track.mu.Unlock()
		}
		return w, err
	}
	t.Cleanup(p.Close)
	return p, track
}
func (f *fakeWorkers) snapshot() []*worker {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]*worker(nil), f.all...)
}
func assertReaped(t *testing.T, w *worker) {
	t.Helper()
	select {
	case <-w.done:
	case <-time.After(3 * time.Second):
		t.Fatal("child was not reaped")
	}
	if w.cmd.ProcessState == nil {
		t.Fatal("cmd.Wait was not called")
	}
}
func TestCaptchaDirectConfigurationCaps(t *testing.T) {
	p := NewPool(config.CaptchaConfig{Workers: 1000000, Rounds: 1000000, TimeoutMS: 1000000000})
	defer p.Close()
	if len(p.workers) != 32 || p.cfg.Rounds != 100 || p.timeout() != time.Hour {
		t.Fatal("direct config bypasses resource caps")
	}
}

func TestCaptchaDefaultWorkersAndRounds(t *testing.T) {
	p, track := fakePool(t, config.CaptchaConfig{TimeoutMS: 2000}, func(int) string { return "third" })
	token, err := p.Solve(context.Background())
	if err != nil || len(token) != 150 {
		t.Fatalf("default 3 rounds: token=%d err=%v", len(token), err)
	}
	if n := len(track.snapshot()); n != 2 {
		t.Fatalf("default workers=%d want 2", n)
	}
	p.Close()
	for _, w := range track.snapshot() {
		assertReaped(t, w)
	}
}
func TestCaptchaTimeoutCancelRestartAndClose(t *testing.T) {
	for _, mode := range []string{"hang", "exit", "wrong-id"} {
		t.Run(mode, func(t *testing.T) {
			p, track := fakePool(t, config.CaptchaConfig{Workers: 1, Rounds: 1, TimeoutMS: 150}, func(i int) string {
				if i == 0 {
					return mode
				}
				return "ok"
			})
			_, err := p.Solve(context.Background())
			if err == nil {
				t.Fatal("bad solver unexpectedly succeeded")
			}
			assertReaped(t, track.snapshot()[0])
			token, err := p.Solve(context.Background())
			if err != nil || len(token) != 150 {
				t.Fatalf("restart failed: %v", err)
			}
			p.Close()
			for _, w := range track.snapshot() {
				assertReaped(t, w)
			}
			if _, err := p.Solve(context.Background()); !errors.Is(err, ErrPoolClosed) {
				t.Fatalf("solve after close: %v", err)
			}
		})
	}
	p, track := fakePool(t, config.CaptchaConfig{Workers: 1, TimeoutMS: 5000}, func(int) string { return "hang" })
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { _, err := p.Solve(ctx); result <- err }()
	waitPoolState(t, p, func() bool { return len(track.snapshot()) > 0 })
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancel=%v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancel stuck")
	}
	for _, w := range track.snapshot() {
		assertReaped(t, w)
	}
}
func TestCaptchaWinnerReapsLoserAndReplaces(t *testing.T) {
	p, track := fakePool(t, config.CaptchaConfig{Workers: 2, Rounds: 1, TimeoutMS: 2000}, func(i int) string {
		if i == 1 {
			return "hang"
		}
		return "ok"
	})
	if _, err := p.Solve(context.Background()); err != nil {
		t.Fatal(err)
	}
	assertReaped(t, track.snapshot()[1])
	if _, err := p.Solve(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(track.snapshot()) < 3 {
		t.Fatal("loser was not replaced")
	}
}
func waitPoolState(t *testing.T, p *Pool, predicate func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if predicate() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("pool state timeout")
}
func queueLength(p *Pool) int { p.mu.Lock(); defer p.mu.Unlock(); return len(p.queue) }
func TestCaptchaFIFOQueueAndBoundedBusyWait(t *testing.T) {
	p := NewPool(config.CaptchaConfig{TimeoutMS: 1000})
	defer p.Close()
	if err := p.admission(context.Background()); err != nil {
		t.Fatal(err)
	}
	order := make(chan int, 2)
	for i := 1; i <= 2; i++ {
		go func(i int) {
			if err := p.admission(context.Background()); err != nil {
				order <- -i
				return
			}
			order <- i
			p.release()
		}(i)
		want := i
		waitPoolState(t, p, func() bool { return queueLength(p) == want })
	}
	select {
	case got := <-order:
		t.Fatalf("busy must wait, got %d", got)
	default:
	}
	p.release()
	for want := 1; want <= 2; want++ {
		if got := <-order; got != want {
			t.Fatalf("FIFO=%d want %d", got, want)
		}
	}
	// Queue capacity and timeout paths do not leak an admission slot.
	if err := p.admission(context.Background()); err != nil {
		t.Fatal(err)
	}
	p.mu.Lock()
	for i := 0; i < maxCaptchaQueue; i++ {
		p.queue = append(p.queue, make(chan struct{}))
	}
	p.mu.Unlock()
	if err := p.admission(context.Background()); !errors.Is(err, ErrCaptchaQueueFull) {
		t.Fatalf("queue cap: %v", err)
	}
	p.mu.Lock()
	p.queue = nil
	p.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := p.admission(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("busy cancellation: %v", err)
	}
	if n := queueLength(p); n != 0 {
		t.Fatalf("queue leaked %d", n)
	}
	p.release()
}
func TestCaptchaBusyWaitHasOwnTimeout(t *testing.T) {
	p := NewPool(config.CaptchaConfig{TimeoutMS: 20})
	defer p.Close()
	if err := p.admission(context.Background()); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	err := p.admission(context.Background())
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(started) < 15*time.Millisecond {
		t.Fatalf("busy fail instead of bounded wait: %v", err)
	}
	if queueLength(p) != 0 {
		t.Fatal("timed-out waiter leaked")
	}
	p.release()
}
func TestCaptchaCancelledWaiterPreservesFIFO(t *testing.T) {
	p := NewPool(config.CaptchaConfig{TimeoutMS: 1000})
	defer p.Close()
	if err := p.admission(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	first := make(chan error, 1)
	go func() { first <- p.admission(ctx) }()
	waitPoolState(t, p, func() bool { return queueLength(p) == 1 })
	second := make(chan error, 1)
	go func() {
		err := p.admission(context.Background())
		second <- err
		if err == nil {
			p.release()
		}
	}()
	waitPoolState(t, p, func() bool { return queueLength(p) == 2 })
	cancel()
	if err := <-first; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled queued waiter=%v", err)
	}
	if queueLength(p) != 1 {
		t.Fatal("wrong remaining queue length")
	}
	p.release()
	if err := <-second; err != nil {
		t.Fatalf("next waiter starved: %v", err)
	}
}
func TestCaptchaCloseWaitsActiveAndQueuedCalls(t *testing.T) {
	p, track := fakePool(t, config.CaptchaConfig{Workers: 2, TimeoutMS: 5000}, func(int) string { return "hang" })
	results := make(chan error, 3)
	go func() { _, err := p.Solve(context.Background()); results <- err }()
	waitPoolState(t, p, func() bool { return len(track.snapshot()) == 2 })
	go func() { _, err := p.Solve(context.Background()); results <- err }()
	waitPoolState(t, p, func() bool { return queueLength(p) == 1 })
	var closes sync.WaitGroup
	for i := 0; i < 3; i++ {
		closes.Add(1)
		go func() { defer closes.Done(); p.Close() }()
	}
	done := make(chan struct{})
	go func() { closes.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Close did not wait/terminate")
	}
	for i := 0; i < 2; i++ {
		if err := <-results; !errors.Is(err, ErrPoolClosed) {
			t.Fatal(fmt.Sprintf("close error=%v", err))
		}
	}
	for _, w := range track.snapshot() {
		assertReaped(t, w)
	}
}
