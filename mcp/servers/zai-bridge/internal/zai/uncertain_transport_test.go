package zai

import (
	"context"
	"errors"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

func TestTransportErrorAfterPOSTDoesNotRollbackOrResubmit(t *testing.T) {
	f := newSubmissionFixture()
	var posts atomic.Int32
	tr := func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/api/v2/chat/completions" {
			posts.Add(1)
			return nil, errors.New("fake response lost after possible admission")
		}
		return f.transport(r)
	}
	c := testCoreClient(t, tr)
	r, e := c.SendWithRetry(context.Background(), "chat", "hello", 3, nil)
	if e == nil || r == nil || r.State != "unknown" || r.MessageID == "" {
		t.Fatalf("transport error reported not_sent: %+v %v", r, e)
	}
	c.quota.mu.Lock()
	remaining := c.quota.remaining
	c.quota.mu.Unlock()
	if remaining != 19 {
		t.Fatalf("uncertain submission refunded quota remaining=%d", remaining)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Millisecond)
	defer cancel()
	_, e = c.SendWithRetry(ctx, "chat", "hello", 3, nil)
	if !errors.Is(e, context.DeadlineExceeded) {
		t.Fatalf("unknown run was not held: %v", e)
	}
	c.Close()
	if posts.Load() != 1 {
		t.Fatalf("transport failure caused %d POSTs", posts.Load())
	}
}
