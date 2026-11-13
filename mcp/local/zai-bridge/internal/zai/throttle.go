package zai

import (
	"context"
	"errors"
	"sync"
	"time"
)

var ErrBusy = errors.New("会话运行状态未确认，请等待原任务结束")
var ErrThrottled = errors.New("发送被临时限流，请遵守服务端重试等待时间")
var ErrGatewayBlocked = errors.New("服务端返回了非预期 HTML 页面；未确认受理，不自动重发")
var ErrQueueFull = errors.New("本地会话等待队列已满")
var ErrClientClosed = errors.New("客户端已关闭")

// fifoLocks bounds waiters and orders admission for each conversation.
type fifoWaiter struct {
	ready   chan struct{}
	granted bool
}
type fifoEntry struct {
	held    bool
	waiters []*fifoWaiter
}
type fifoLocks struct {
	mu       sync.Mutex
	entries  map[string]*fifoEntry
	capacity int
}

func newFIFOLocks() *fifoLocks { return &fifoLocks{entries: map[string]*fifoEntry{}, capacity: 64} }
func (f *fifoLocks) acquire(ctx context.Context, key string) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	f.mu.Lock()
	e := f.entries[key]
	if e == nil {
		e = &fifoEntry{}
		f.entries[key] = e
	}
	w := &fifoWaiter{ready: make(chan struct{})}
	if !e.held {
		e.held = true
		w.granted = true
		close(w.ready)
	} else {
		if len(e.waiters) >= f.capacity {
			f.mu.Unlock()
			return nil, ErrQueueFull
		}
		e.waiters = append(e.waiters, w)
	}
	f.mu.Unlock()
	select {
	case <-w.ready:
	case <-ctx.Done():
	}
	f.mu.Lock()
	if err := ctx.Err(); err != nil {
		if w.granted {
			f.releaseLocked(key, e)
		} else {
			for i, x := range e.waiters {
				if x == w {
					e.waiters = append(e.waiters[:i], e.waiters[i+1:]...)
					break
				}
			}
		}
		f.mu.Unlock()
		return nil, err
	}
	f.mu.Unlock()
	var once sync.Once
	return func() { once.Do(func() { f.mu.Lock(); f.releaseLocked(key, e); f.mu.Unlock() }) }, nil
}
func (f *fifoLocks) releaseLocked(key string, e *fifoEntry) {
	if len(e.waiters) > 0 {
		w := e.waiters[0]
		e.waiters = e.waiters[1:]
		w.granted = true
		close(w.ready)
		return
	}
	e.held = false
	delete(f.entries, key)
}

// DispatchGate is shared by accounts using the same upstream/egress.
// It gates every actual completion POST, never the duration of a remote run.
type DispatchGate struct {
	mu       sync.Mutex
	next     time.Time
	interval time.Duration
	prepare  *fifoLocks
}

func NewDispatchGate(interval time.Duration) *DispatchGate {
	if interval < 0 {
		interval = 0
	}
	return &DispatchGate{interval: interval, prepare: newFIFOLocks()}
}
func (g *DispatchGate) Wait(ctx context.Context) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		g.mu.Lock()
		wait := time.Until(g.next)
		if wait <= 0 {
			g.next = time.Now().Add(g.interval)
			g.mu.Unlock()
			return nil
		}
		g.mu.Unlock()
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

// One client owns an account run budget and conversation FIFOs.
type limiter struct {
	sem  chan struct{}
	fifo *fifoLocks
}

func newLimiter(interval time.Duration, max int) *limiter {
	if max <= 0 {
		max = 1
	}
	if max > 64 {
		max = 64
	}
	return &limiter{sem: make(chan struct{}, max), fifo: newFIFOLocks()}
}
func (l *limiter) acquire(ctx context.Context, chatID string) (func(), error) {
	releaseChat, err := l.fifo.acquire(ctx, chatID)
	if err != nil {
		return nil, err
	}
	select {
	case l.sem <- struct{}{}:
	case <-ctx.Done():
		releaseChat()
		return nil, ctx.Err()
	}
	var once sync.Once
	return func() { once.Do(func() { <-l.sem; releaseChat() }) }, nil
}
