package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type responseSink struct{ responses chan Response }

func (s *responseSink) Write(raw []byte) (int, error) {
	var r Response
	if err := json.Unmarshal(bytes.TrimSpace(raw), &r); err != nil {
		return 0, err
	}
	s.responses <- r
	return len(raw), nil
}
func receive[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case value := <-ch:
		return value
	case <-time.After(3 * time.Second):
		t.Fatal("timed out")
		var zero T
		return zero
	}
}
func rpc(id int, method string) string {
	return fmt.Sprintf("{\"jsonrpc\":\"2.0\",\"id\":%d,\"method\":%q}\n", id, method)
}
func TestServeParallelEOFDrain(t *testing.T) {
	sink := &responseSink{make(chan Response, 10)}
	s, _ := NewServerWithLimits(sink, 2, 4)
	started := make(chan struct{}, 2)
	release := make(chan struct{})
	s.RegisterContext("slow", func(ctx context.Context, _ json.RawMessage) (any, *RPCError) {
		started <- struct{}{}
		select {
		case <-release:
			return "done", nil
		case <-ctx.Done():
			return nil, nil
		}
	})
	done := make(chan error, 1)
	go func() { done <- s.Serve(strings.NewReader(rpc(1, "slow") + rpc(2, "slow"))) }()
	receive(t, started)
	receive(t, started)
	select {
	case <-done:
		t.Fatal("EOF failed to drain")
	default:
	}
	close(release)
	if err := receive(t, done); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if r := receive(t, sink.responses); r.Error != nil {
			t.Fatal(r.Error)
		}
	}
}
func TestServeCancelDuplicateBusyAndPing(t *testing.T) {
	sink := &responseSink{make(chan Response, 20)}
	s, _ := NewServerWithLimits(sink, 1, 1)
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	s.RegisterContext("slow", func(ctx context.Context, _ json.RawMessage) (any, *RPCError) {
		started <- struct{}{}
		select {
		case <-release:
			return "done", nil
		case <-ctx.Done():
			return nil, nil
		}
	})
	s.Register("ping", func(json.RawMessage) (any, *RPCError) { return map[string]any{}, nil })
	reader, writer := io.Pipe()
	defer writer.Close()
	done := make(chan error, 1)
	go func() { done <- s.Serve(reader) }()
	_, _ = io.WriteString(writer, rpc(1, "slow"))
	receive(t, started)
	_, _ = io.WriteString(writer, rpc(1, "slow")+rpc(2, "slow")+rpc(3, "slow")+rpc(4, "ping"))
	for _, code := range []int{CodeInvalidRequest, CodeServerBusy, 0} {
		response := receive(t, sink.responses)
		if code == 0 {
			if response.Error != nil || string(response.ID) != "4" {
				t.Fatalf("ping: %+v", response)
			}
		} else if response.Error == nil || response.Error.Code != code {
			t.Fatalf("reject: %+v", response)
		}
	}
	_, _ = io.WriteString(writer, `{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}`+"\n")
	response := receive(t, sink.responses)
	if response.Error == nil || response.Error.Code != CodeRequestCancelled || string(response.ID) != "1" {
		t.Fatalf("cancel: %+v", response)
	}
	receive(t, started)
	close(release)
	_ = writer.Close()
	if err := receive(t, done); err != nil {
		t.Fatal(err)
	}
	response = receive(t, sink.responses)
	if string(response.ID) != "2" || response.Error != nil {
		t.Fatalf("queued: %+v", response)
	}
}
func TestServeInitializeBarrierAndRootCancel(t *testing.T) {
	sink := &responseSink{make(chan Response, 10)}
	s, _ := NewServerWithLimits(sink, 1, 1)
	var initialized atomic.Bool
	s.Register("initialize", func(json.RawMessage) (any, *RPCError) { initialized.Store(true); return "init", nil })
	started := make(chan struct{}, 1)
	s.RegisterContext("slow", func(ctx context.Context, _ json.RawMessage) (any, *RPCError) {
		if !initialized.Load() {
			return nil, &RPCError{Code: 1, Message: "overtook initialize"}
		}
		started <- struct{}{}
		<-ctx.Done()
		return nil, nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reader, writer := io.Pipe()
	defer writer.Close()
	done := make(chan error, 1)
	go func() { done <- s.ServeContext(ctx, reader) }()
	_, _ = io.WriteString(writer, rpc(1, "initialize")+rpc(2, "slow"))
	receive(t, started)
	response := receive(t, sink.responses)
	if string(response.ID) != "1" {
		t.Fatalf("initialize order: %+v", response)
	}
	cancel()
	if err := receive(t, done); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	response = receive(t, sink.responses)
	if response.Error == nil || response.Error.Code != CodeRequestCancelled {
		t.Fatalf("root: %+v", response)
	}
}
func TestServerLimitsAndRequestIDs(t *testing.T) {
	for _, limits := range [][2]int{{0, 0}, {1, -1}, {-1, 2}, {1025, 0}} {
		if _, err := NewServerWithLimits(io.Discard, limits[0], limits[1]); err == nil {
			t.Fatal(limits)
		}
	}
	for _, value := range []string{"null", "{}", "[]", "1.5", "true"} {
		if _, ok := requestKey(json.RawMessage(value)); ok {
			t.Fatal(value)
		}
	}
	if a, _ := requestKey(json.RawMessage("0")); a != "n:0" {
		t.Fatal(a)
	}
}

func TestServeCancelsQueuedRequestWithoutInvokingIt(t *testing.T) {
	sink := &responseSink{make(chan Response, 8)}
	s, _ := NewServerWithLimits(sink, 1, 2)
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	var invoked atomic.Int32
	s.RegisterContext("slow", func(ctx context.Context, _ json.RawMessage) (any, *RPCError) {
		invoked.Add(1)
		started <- struct{}{}
		select {
		case <-release:
			return "done", nil
		case <-ctx.Done():
			return nil, nil
		}
	})
	reader, writer := io.Pipe()
	defer writer.Close()
	done := make(chan error, 1)
	go func() { done <- s.Serve(reader) }()
	_, _ = io.WriteString(writer, rpc(1, "slow"))
	receive(t, started)
	_, _ = io.WriteString(writer, rpc(2, "slow")+`{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":2}}`+"\n")
	close(release)
	_ = writer.Close()
	if err := receive(t, done); err != nil {
		t.Fatal(err)
	}
	if invoked.Load() != 1 {
		t.Fatalf("cancelled queued handler invoked %d times", invoked.Load())
	}
	sawCancel := false
	for i := 0; i < 2; i++ {
		response := receive(t, sink.responses)
		if string(response.ID) == "2" {
			sawCancel = response.Error != nil && response.Error.Code == CodeRequestCancelled
		}
	}
	if !sawCancel {
		t.Fatal("queued cancellation response missing")
	}
}
