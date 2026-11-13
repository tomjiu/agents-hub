package zai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/local/zai-bridge/internal/config"
)

var ErrPoolClosed = errors.New("验证码池已关闭")
var ErrCaptchaQueueFull = errors.New("验证码等待队列已满")

const maxCaptchaQueue = 64

// Pool serializes only local Solve calls in FIFO order. A solve still races all
// workers (default 2), for up to 3 rounds. It does not serialize remote runs.
// Losers are killed and reaped before the next caller is admitted.
type Pool struct {
	cfg       config.CaptchaConfig
	mu        sync.Mutex
	workers   []*worker
	seq       int64
	active    bool
	queue     []chan struct{}
	closed    bool
	ctx       context.Context
	cancel    context.CancelFunc
	calls     sync.WaitGroup
	closeOnce sync.Once
	closeDone chan struct{}
	// start is injectable for local helper-process tests; never invokes the SDK there.
	start func() (*worker, error)
}

type worker struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	stdout  io.ReadCloser
	in      *bufio.Writer
	out     *bufio.Scanner
	mu      sync.Mutex
	busy    bool
	defunct bool
	waiters map[int64]chan solveResponse
	done    chan struct{}
}

type solveResponse struct {
	ID    int64  `json:"id"`
	OK    bool   `json:"ok"`
	Param string `json:"param,omitempty"`
	Error string `json:"error,omitempty"`
}

func NewPool(cfg config.CaptchaConfig) *Pool {
	n := cfg.Workers
	if n <= 0 {
		n = 2
	}
	if n > 32 {
		n = 32
	} // defensive cap even when callers bypass config validation
	cfg.Workers = n
	if cfg.Rounds <= 0 {
		cfg.Rounds = 3
	}
	if cfg.Rounds > 100 {
		cfg.Rounds = 100
	}
	if cfg.TimeoutMS > 3600000 {
		cfg.TimeoutMS = 3600000
	}
	ctx, cancel := context.WithCancel(context.Background())
	p := &Pool{cfg: cfg, workers: make([]*worker, n), ctx: ctx, cancel: cancel, closeDone: make(chan struct{})}
	p.start = func() (*worker, error) {
		node := cfg.NodePath
		if node == "" {
			node = "node"
		}
		script := cfg.ScriptPath
		if script == "" {
			script = defaultScriptPath()
		}
		if _, err := os.Stat(script); err != nil {
			return nil, fmt.Errorf("找不到验证码脚本 %s: %w", script, err)
		}
		return startWorker(node, script)
	}
	return p
}

func (p *Pool) timeout() time.Duration {
	if p.cfg.TimeoutMS > 0 {
		return time.Duration(p.cfg.TimeoutMS) * time.Millisecond
	}
	return 90 * time.Second
}

// admission has a bounded, cancellable FIFO wait, rather than failing on busy.
func (p *Pool) admission(ctx context.Context) error {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return ErrPoolClosed
	}
	if !p.active {
		p.active = true
		p.mu.Unlock()
		return nil
	}
	if len(p.queue) >= maxCaptchaQueue {
		p.mu.Unlock()
		return ErrCaptchaQueueFull
	}
	ready := make(chan struct{})
	p.queue = append(p.queue, ready)
	p.mu.Unlock()
	timer := time.NewTimer(p.timeout())
	defer timer.Stop()
	var err error
	select {
	case <-ready:
		return nil
	case <-ctx.Done():
		err = ctx.Err()
	case <-p.ctx.Done():
		err = ErrPoolClosed
	case <-timer.C:
		err = fmt.Errorf("验证码等待超时: %w", context.DeadlineExceeded)
	}
	p.mu.Lock()
	for i, ch := range p.queue {
		if ch == ready {
			p.queue = append(p.queue[:i], p.queue[i+1:]...)
			p.mu.Unlock()
			return err
		}
	}
	// Already admitted concurrently with cancellation: pass our slot along.
	p.releaseLocked()
	p.mu.Unlock()
	return err
}
func (p *Pool) releaseLocked() {
	if len(p.queue) > 0 {
		ch := p.queue[0]
		p.queue = p.queue[1:]
		close(ch)
	} else {
		p.active = false
	}
}
func (p *Pool) release() { p.mu.Lock(); p.releaseLocked(); p.mu.Unlock() }

func (p *Pool) Solve(ctx context.Context) (string, error) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return "", ErrPoolClosed
	}
	p.calls.Add(1)
	p.mu.Unlock()
	defer p.calls.Done()
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := p.admission(ctx); err != nil {
		return "", err
	}
	defer p.release()
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(p.ctx, cancel)
	defer stop()
	defer cancel()
	rounds := p.cfg.Rounds
	if rounds <= 0 {
		rounds = 3
	}
	var lastErr error
	for round := 0; round < rounds; round++ {
		if ctx.Err() != nil {
			if p.ctx.Err() != nil {
				return "", ErrPoolClosed
			}
			return "", ctx.Err()
		}
		if err := p.ensureStarted(); err != nil {
			lastErr = err
		} else {
			param, err := p.solveRound(ctx)
			if err == nil {
				return param, nil
			}
			lastErr = err
		}
		// Bounded restart backoff, also interruptible by Close/caller cancellation.
		if round+1 < rounds {
			timer := time.NewTimer(time.Duration(round+1) * 25 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
			case <-timer.C:
			}
		}
	}
	if p.ctx.Err() != nil {
		return "", ErrPoolClosed
	}
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	return "", lastErr
}

func (p *Pool) ensureStarted() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return ErrPoolClosed
	}
	var errs []error
	live := 0
	for i, w := range p.workers {
		if w != nil && !w.isDefunct() {
			live++
			continue
		}
		if w != nil {
			w.kill()
		}
		nw, err := p.start()
		if err != nil {
			errs = append(errs, err)
			p.workers[i] = nil
			continue
		}
		p.workers[i] = nw
		live++
	}
	if live == 0 {
		return fmt.Errorf("验证码进程启动失败: %w", errors.Join(errs...))
	}
	return nil
}

func (p *Pool) solveRound(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, p.timeout())
	defer cancel()
	p.mu.Lock()
	workers := append([]*worker(nil), p.workers...)
	p.mu.Unlock()
	type outcome struct {
		param string
		err   error
	}
	results := make(chan outcome, len(workers))
	var wg sync.WaitGroup
	count := 0
	for _, w := range workers {
		if w == nil || w.isDefunct() {
			continue
		}
		p.mu.Lock()
		p.seq++
		id := p.seq
		p.mu.Unlock()
		count++
		wg.Add(1)
		go func(w *worker, id int64) {
			defer wg.Done()
			param, err := w.solve(ctx, id, p.cfg)
			results <- outcome{param, err}
		}(w, id)
	}
	var winner string
	var errs []error
	for i := 0; i < count; i++ {
		o := <-results
		if o.err == nil && winner == "" {
			winner = o.param
			cancel()
		} else if o.err != nil {
			errs = append(errs, o.err)
		}
	}
	wg.Wait()
	if winner != "" {
		return winner, nil
	}
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	if count == 0 {
		return "", errors.New("没有可用验证码进程")
	}
	return "", errors.Join(errs...)
}

func startWorker(node, script string) (*worker, error) {
	cmd := exec.Command(node, script)
	cmd.Stderr = os.Stderr
	env := os.Environ()
	if os.Getenv("CAPTCHA_STALL_MS") == "" {
		env = append(env, "CAPTCHA_STALL_MS=10000")
	}
	if os.Getenv("CAPTCHA_ATTEMPTS") == "" {
		env = append(env, "CAPTCHA_ATTEMPTS=1")
	}
	cmd.Env = env
	return startWorkerCommand(cmd)
}
func startWorkerCommand(cmd *exec.Cmd) (*worker, error) {
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		stdin.Close()
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		stdin.Close()
		stdout.Close()
		return nil, fmt.Errorf("启动验证码进程失败: %w", err)
	}
	w := &worker{cmd: cmd, stdin: stdin, stdout: stdout, in: bufio.NewWriter(stdin), out: bufio.NewScanner(stdout), waiters: map[int64]chan solveResponse{}, done: make(chan struct{})}
	w.out.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	go w.readLoop()
	return w, nil
}

func (w *worker) readLoop() {
	for w.out.Scan() {
		var resp solveResponse
		if json.Unmarshal(w.out.Bytes(), &resp) != nil {
			continue
		}
		w.mu.Lock()
		if ch := w.waiters[resp.ID]; ch != nil {
			delete(w.waiters, resp.ID)
			w.busy = false // only a matching response proves this computation finished
			ch <- resp
			close(ch)
		}
		w.mu.Unlock()
	}
	// EOF/scanner error may precede process exit; never leave it running forever.
	_ = w.cmd.Process.Kill()
	_ = w.stdin.Close()
	_ = w.cmd.Wait() // exactly one Wait owner, on every exit path
	w.mu.Lock()
	w.defunct = true
	for id, ch := range w.waiters {
		close(ch)
		delete(w.waiters, id)
	}
	w.mu.Unlock()
	close(w.done)
}
func (w *worker) isDefunct() bool {
	select {
	case <-w.done:
		return true
	default:
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.defunct
}
func (w *worker) dispatch(id int64, cfg config.CaptchaConfig) (chan solveResponse, error) {
	w.mu.Lock()
	if w.busy || w.defunct {
		w.mu.Unlock()
		return nil, errors.New("worker 不可用")
	}
	ch := make(chan solveResponse, 1)
	w.waiters[id] = ch
	w.busy = true
	w.mu.Unlock()
	raw, err := json.Marshal(map[string]any{"id": id, "scene": cfg.SceneID, "region": cfg.Region, "prefix": cfg.Prefix})
	if err == nil {
		_, err = w.in.Write(append(raw, '\n'))
	}
	if err == nil {
		err = w.in.Flush()
	}
	if err != nil {
		w.kill()
		return nil, err
	}
	return ch, nil
}
func (w *worker) solve(ctx context.Context, id int64, cfg config.CaptchaConfig) (string, error) {
	stop := context.AfterFunc(ctx, func() { w.kill() })
	defer func() {
		if !stop() {
			w.kill()
		}
	}()
	if err := ctx.Err(); err != nil {
		return "", err
	}
	ch, err := w.dispatch(id, cfg)
	if err != nil {
		return "", err
	}
	select {
	case <-ctx.Done():
		w.kill()
		return "", ctx.Err()
	case resp, ok := <-ch:
		if !ok {
			return "", errors.New("求解进程异常退出")
		}
		if !resp.OK {
			return "", fmt.Errorf("验证码求解失败: %s", resp.Error)
		}
		if len(resp.Param) < 100 {
			return "", fmt.Errorf("求解结果异常（长度 %d）", len(resp.Param))
		}
		return resp.Param, nil
	}
}
func (w *worker) kill() {
	w.mu.Lock()
	w.defunct = true
	w.mu.Unlock()
	_ = w.cmd.Process.Kill()
	_ = w.stdin.Close()
	_ = w.stdout.Close() // unblock Scan even if inherited pipe handles remain open
	<-w.done
}

// Close is terminal and idempotent. It cancels queued/active solves and waits
// for every call, reader goroutine and child process, including concurrent Close.
func (p *Pool) Close() {
	p.closeOnce.Do(func() {
		p.mu.Lock()
		p.closed = true
		p.cancel()
		p.mu.Unlock()
		p.calls.Wait()
		p.mu.Lock()
		workers := append([]*worker(nil), p.workers...)
		p.mu.Unlock()
		for _, w := range workers {
			if w != nil {
				w.kill()
			}
		}
		close(p.closeDone)
	})
	<-p.closeDone
}

// defaultScriptPath 依次尝试若干常见位置。
func defaultScriptPath() string {
	var candidates []string
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(dir, "captcha", "solver.mjs"),
			filepath.Join(dir, "..", "captcha", "solver.mjs"),
		)
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(wd, "captcha", "solver.mjs"),
			filepath.Join(wd, "..", "captcha", "solver.mjs"),
		)
	}
	candidates = append(candidates, "/app/captcha/solver.mjs")
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return candidates[0]
}

var debugPool = os.Getenv("ZAI_DEBUG") != ""
