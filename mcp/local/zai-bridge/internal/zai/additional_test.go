package zai

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"
)

func TestExplicitUnlimitedUpgrade(t *testing.T) {
	unlimited := false
	c := testCoreClient(t, func(r *http.Request) (*http.Response, error) {
		if unlimited {
			return coreJSON(r, map[string]any{"code": 0, "data": map[string]any{"items": []any{map[string]any{"feature": "agent_mode", "status": "unlimited"}}}}), nil
		}
		return coreJSON(r, quotaEnvelope(1)), nil
	})
	reserve, e := c.reserveQuota(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	reserve.settle(false)
	unlimited = true
	if _, e = c.reserveQuota(context.Background()); e != nil {
		t.Fatal("explicit unlimited upgrade remained locally exhausted", e)
	}
}
func TestPinUnpinUsesReadBeforeToggle(t *testing.T) {
	pinned := false
	posts := 0
	c := testCoreClient(t, func(r *http.Request) (*http.Response, error) {
		if r.Method == http.MethodGet {
			return coreJSON(r, map[string]any{"id": "chat", "pinned": pinned}), nil
		}
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/chats/chat/pin" {
			t.Fatal("invalid pin protocol", r.Method, r.URL.Path)
		}
		posts++
		pinned = !pinned
		return coreJSON(r, map[string]any{"pinned": pinned}), nil
	})
	for _, desired := range []bool{true, true, false, false} {
		if e := c.PinChat(context.Background(), "chat", desired); e != nil {
			t.Fatal(e)
		}
		if pinned != desired {
			t.Fatal("wrong toggle state")
		}
	}
	if posts != 2 {
		t.Fatalf("non-idempotent pin changes: %d", posts)
	}
}
func TestHTTP429TypedRetryAfter(t *testing.T) {
	e := &HTTPError{Status: 429, Path: "/api/v2/chat/completions"}
	if !errors.Is(e, ErrThrottled) {
		t.Fatal("429 lost rate-limit classification")
	}
	if retryAfter("15") != 15*time.Second {
		t.Fatal("retry-after seconds")
	}
	gate := NewDispatchGate(0)
	gate.Pause(time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if !errors.Is(gate.Wait(ctx), context.DeadlineExceeded) {
		t.Fatal("pause not cancellable")
	}
}
