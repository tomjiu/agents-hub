package zai

import (
	"context"
	"testing"
	"time"
)

// 两个账户各自一个 limiter：A 占着会话时，B 不该被阻塞。
// 这正是多账户能真正并行的前提。
func TestTwoAccountsIndependent(t *testing.T) {
	// 模拟账户 A 和 B，各自并发额度 1
	limA := newLimiter(time.Millisecond, 1)
	limB := newLimiter(time.Millisecond, 1)
	ctx := context.Background()

	// A 占住自己的会话
	relA, err := limA.acquire(ctx, "chat-shared")
	if err != nil {
		t.Fatal(err)
	}

	// B 用同一个 chat_id（现实中不同账户的 chat 不会同名，这里只为验证隔离）
	done := make(chan struct{})
	go func() {
		relB, err := limB.acquire(ctx, "chat-shared")
		if err != nil {
			t.Error(err)
		} else {
			relB()
		}
		close(done)
	}()

	select {
	case <-done:
		// 期望走到这里：B 不被 A 阻塞
	case <-time.After(500 * time.Millisecond):
		t.Fatal("账户 B 被账户 A 阻塞了，隔离失败")
	}
	relA()
}
