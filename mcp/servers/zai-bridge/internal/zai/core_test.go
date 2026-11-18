package zai

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/local/zai-bridge/internal/config"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

type coreTransport func(*http.Request) (*http.Response, error)

func (f coreTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func coreJSON(r *http.Request, v any) *http.Response {
	b, _ := json.Marshal(v)
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(string(b))), Request: r}
}
func quotaEnvelope(remaining int) any {
	return map[string]any{"code": 0, "data": map[string]any{"reset_at": "2099-01-01T00:00:00Z", "items": []any{map[string]any{"feature": "agent_mode", "status": "available", "limit": 20, "used": 20 - remaining, "remaining": remaining}}}}
}
func testCoreClient(t *testing.T, tr coreTransport) *Client {
	t.Helper()
	cfg := config.Default()
	cfg.Token = "dummy-local-test-token"
	cfg.Captcha.Enabled = false
	cfg.SendIntervalSeconds = 0
	c := NewWithHTTPClient(cfg, &http.Client{Transport: tr})
	t.Cleanup(func() { c.Close() })
	return c
}
func TestQuotaFailClosedNoWrites(t *testing.T) {
	cases := []struct {
		name string
		body any
		err  error
	}{
		{"network failure", nil, errors.New("mock failed")}, {"missing data", map[string]any{"code": 0}, nil}, {"missing feature", map[string]any{"code": 0, "data": map[string]any{"items": []any{}}}, nil},
		{"missing used", map[string]any{"code": 0, "data": map[string]any{"items": []any{map[string]any{"feature": "agent_mode", "status": "available", "limit": 20, "remaining": 20}}}}, nil},
		{"used limit missing remaining", map[string]any{"code": 0, "data": map[string]any{"items": []any{map[string]any{"feature": "agent_mode", "status": "available", "limit": 20, "used": 20}}}}, nil},
		{"zero", quotaEnvelope(0), nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			writes := 0
			c := testCoreClient(t, func(r *http.Request) (*http.Response, error) {
				if r.Method != http.MethodGet {
					writes++
				}
				if strings.Contains(r.URL.Path, "feature-quota") {
					return coreJSON(r, tc.body), tc.err
				}
				if r.URL.Path == "/api/v1/chats" {
					return coreJSON(r, []any{}), nil
				}
				if r.URL.Path == "/api/v1/chats/chat" {
					return coreJSON(r, map[string]any{"chat": map[string]any{"history": map[string]any{"messages": map[string]any{}, "currentId": ""}}}), nil
				}
				return nil, errors.New("unexpected request")
			})
			_, e := c.SendWithRetry(context.Background(), "chat", "hello", 3, nil)
			if e == nil {
				t.Fatal("must reject unknown/exhausted quota")
			}
			if writes != 0 {
				t.Fatalf("quota failure caused %d writes", writes)
			}
		})
	}
}
func TestQuotaConcurrentLastReservation(t *testing.T) {
	c := testCoreClient(t, func(r *http.Request) (*http.Response, error) { return coreJSON(r, quotaEnvelope(1)), nil })
	var wg sync.WaitGroup
	var mu sync.Mutex
	ok := 0
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := c.reserveQuota(context.Background())
			if e == nil {
				r.settle(false)
				mu.Lock()
				ok++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if ok != 1 {
		t.Fatalf("last quota admitted %d requests", ok)
	}
}
func TestQuotaNoUncertainRefundAndSafeRollback(t *testing.T) {
	c := testCoreClient(t, func(r *http.Request) (*http.Response, error) { return coreJSON(r, quotaEnvelope(1)), nil })
	r, e := c.reserveQuota(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	r.settle(true)
	r, e = c.reserveQuota(context.Background())
	if e != nil {
		t.Fatal("not-sent rollback missing", e)
	}
	r.settle(false)
	if _, e = c.reserveQuota(context.Background()); !errors.Is(e, ErrQuotaExhausted) {
		t.Fatal("uncertain result replenished quota", e)
	}
}
func TestSSEFramesPartialErrorAndReasoning(t *testing.T) {
	c := New(config.Default())
	defer c.Close()
	stream := "data: {\"type\":\"chat:completion\",\"data\":{\"phase\":\"thinking\",\"delta_content\":\"thought\"}}\n\ndata: {\"type\":\"chat:completion\",\n" + "data: \"data\":{\"phase\":\"answer\",\"delta_content\":\"你好\"}}\n\ndata: {\"type\":\"chat:completion\",\"data\":{\"done\":true}}\n\n"
	r, e := c.consumeSSE(strings.NewReader(stream), nil)
	if e != nil {
		t.Fatal(e)
	}
	if r.Content != "你好" || r.Reasoning != "thought" || !r.Done {
		t.Fatalf("incorrect result %+v", r)
	}
	partial := "data: {\"data\":{\"delta_content\":\"partial\"}}\n\n"
	r, e = c.consumeSSE(strings.NewReader(partial), nil)
	if !errors.Is(e, ErrIncompleteStream) || r.Content != "partial" {
		t.Fatalf("partial EOF hidden: %+v %v", r, e)
	}
	r, e = c.consumeSSE(strings.NewReader("data: {broken}\n\n"), nil)
	if e == nil || r == nil {
		t.Fatal("bad JSON must be explicit incomplete error")
	}
}
func TestMessageErrorTerminalNotSuccess(t *testing.T) {
	m := Message{Done: true, Error: json.RawMessage("{\"code\":\"failure\"}")}
	if !m.Failed() || !m.Terminal() {
		t.Fatal("failed done must be terminal error")
	}
}
func TestFIFOOrderAndGateSpacing(t *testing.T) {
	f := newFIFOLocks()
	first, e := f.acquire(context.Background(), "chat")
	if e != nil {
		t.Fatal(e)
	}
	order := make(chan int, 3)
	for i := 0; i < 3; i++ {
		go func(i int) {
			r, e := f.acquire(context.Background(), "chat")
			if e != nil {
				return
			}
			order <- i
			r()
		}(i)
		deadline := time.Now().Add(time.Second)
		for {
			f.mu.Lock()
			n := len(f.entries["chat"].waiters)
			f.mu.Unlock()
			if n >= i+1 {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("waiter missing")
			}
			time.Sleep(time.Millisecond)
		}
	}
	first()
	for i := 0; i < 3; i++ {
		if x := <-order; x != i {
			t.Fatalf("FIFO %d !=%d", x, i)
		}
	}
	g := NewDispatchGate(10 * time.Millisecond)
	var mu sync.Mutex
	times := []time.Time{}
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if e := g.Wait(context.Background()); e != nil {
				t.Error(e)
			}
			mu.Lock()
			times = append(times, time.Now())
			mu.Unlock()
		}()
	}
	wg.Wait()
	for i := 1; i < len(times); i++ {
		if times[i].Sub(times[i-1]) < 8*time.Millisecond {
			t.Fatal("dispatch waiters collapsed interval")
		}
	}
}
