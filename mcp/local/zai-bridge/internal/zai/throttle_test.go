package zai

import (
	"context"
	"sync"
	"testing"
	"time"
)

// 同一会话必须串行：后一个必须等前一个释放。
func TestLimiterSameChatSerial(t *testing.T) {
	l := newLimiter(time.Millisecond, 4)
	ctx := context.Background()

	r1, err := l.acquire(ctx, "chat-a")
	if err != nil {
		t.Fatal(err)
	}

	done := make(chan struct{})
	go func() {
		r2, err := l.acquire(ctx, "chat-a")
		if err != nil {
			t.Error(err)
			close(done)
			return
		}
		r2()
		close(done)
	}()

	select {
	case <-done:
		t.Fatal("同一会话的第二个 acquire 不该立即返回")
	case <-time.After(120 * time.Millisecond):
	}

	r1()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("释放后第二个 acquire 仍未返回")
	}
}

// 不同会话在并发额度内应当互不阻塞。
func TestLimiterDifferentChatsParallel(t *testing.T) {
	l := newLimiter(time.Millisecond, 4)
	ctx := context.Background()

	r1, err := l.acquire(ctx, "chat-a")
	if err != nil {
		t.Fatal(err)
	}
	defer r1()

	done := make(chan struct{})
	go func() {
		r2, err := l.acquire(ctx, "chat-b")
		if err != nil {
			t.Error(err)
		} else {
			r2()
		}
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("不同会话被错误地阻塞了")
	}
}

// 并发额度为 1 时，不同会话也必须串行（免费账户场景）。
func TestLimiterConcurrencyOne(t *testing.T) {
	l := newLimiter(time.Millisecond, 1)
	ctx := context.Background()

	r1, err := l.acquire(ctx, "chat-a")
	if err != nil {
		t.Fatal(err)
	}

	done := make(chan struct{})
	go func() {
		r2, err := l.acquire(ctx, "chat-b")
		if err != nil {
			t.Error(err)
		} else {
			r2()
		}
		close(done)
	}()

	select {
	case <-done:
		t.Fatal("并发额度为 1 时不该并行")
	case <-time.After(120 * time.Millisecond):
	}

	r1()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("释放后仍未返回")
	}
}

// ctx 取消时排队中的请求要能退出，不能死等。
func TestLimiterCtxCancel(t *testing.T) {
	l := newLimiter(time.Millisecond, 1)
	r1, err := l.acquire(context.Background(), "chat-a")
	if err != nil {
		t.Fatal(err)
	}
	defer r1()

	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, err = l.acquire(ctx, "chat-a")
	if err == nil {
		t.Fatal("应当返回 ctx 错误")
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("取消响应太慢")
	}
}

// 并发压测：多个会话同时进出，不应死锁，且 map 不能泄漏。
func TestLimiterNoLeak(t *testing.T) {
	l := newLimiter(time.Millisecond, 8)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			chat := "chat-" + string(rune('a'+n%5))
			r, err := l.acquire(context.Background(), chat)
			if err != nil {
				t.Error(err)
				return
			}
			time.Sleep(time.Millisecond)
			r()
		}(i)
	}
	wg.Wait()

	l.fifo.mu.Lock()
	n := len(l.fifo.entries)
	l.fifo.mu.Unlock()
	if n != 0 {
		t.Fatalf("会话锁 map 泄漏，残留 %d 条", n)
	}
}
