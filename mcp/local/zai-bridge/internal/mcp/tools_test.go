package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/local/zai-bridge/internal/config"
	"github.com/local/zai-bridge/internal/zai"
)

type fakeTransport func(*http.Request) (*http.Response, error)

func (f fakeTransport) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }
func fakeResponse(value any) *http.Response {
	raw, _ := json.Marshal(value)
	return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(raw))}
}
func fakeClient(t *testing.T, token, cookie, model string, transport fakeTransport) *zai.Client {
	t.Helper()
	cfg := config.Default()
	cfg.Token = token
	cfg.Cookie = cookie
	cfg.Model = model
	cfg.Captcha.Enabled = false
	cfg.BaseURL = "https://offline.invalid"
	client := zai.NewWithHTTPClient(cfg, &http.Client{Transport: transport})
	t.Cleanup(func() { _ = client.Close() })
	return client
}
func toolsCall(id int, name string, arguments any) string {
	raw, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": "tools/call", "params": map[string]any{"name": name, "arguments": arguments}})
	return string(raw) + "\n"
}
func TestToolsCallConcurrentAccountRouting(t *testing.T) {
	entered := make(chan string, 2)
	release := make(chan struct{})
	makeClient := func(account string) *zai.Client {
		return fakeClient(t, account, account+"-cookie", account+"-model", func(req *http.Request) (*http.Response, error) {
			if req.Header.Get("Authorization") != "Bearer "+account || req.Header.Get("Cookie") != account+"-cookie" {
				return nil, fmt.Errorf("cross-account headers")
			}
			if req.URL.Path != "/api/models" {
				return nil, fmt.Errorf("unexpected path %s", req.URL.Path)
			}
			entered <- account
			select {
			case <-release:
			case <-req.Context().Done():
				return nil, req.Context().Err()
			}
			return fakeResponse(map[string]any{"data": []map[string]string{{"id": account + "-model"}, {"id": "other"}}}), nil
		})
	}
	a, b := makeClient("a"), makeClient("b")
	registry := map[string]*zai.Client{"a": a, "b": b}
	sink := &responseSink{make(chan Response, 8)}
	server, _ := NewServerWithLimits(sink, 2, 4)
	RegisterTools(server, Deps{Client: a, Model: "wrong-shared-model", Accounts: registry, DefaultAccount: "a"})
	// A later caller edit to its map must not change the registered routing table.
	registry["a"] = b
	done := make(chan error, 1)
	input := toolsCall(1, "list_models", map[string]string{"account": "a"}) + toolsCall(2, "list_models", map[string]string{"account": "b"})
	go func() { done <- server.Serve(strings.NewReader(input)) }()
	seen := map[string]bool{receive(t, entered): true}
	seen[receive(t, entered)] = true
	if !seen["a"] || !seen["b"] {
		t.Fatal(seen)
	}
	close(release)
	if err := receive(t, done); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		response := receive(t, sink.responses)
		if response.Error != nil {
			t.Fatal(response.Error)
		}
		raw, _ := json.Marshal(response.Result)
		var result CallToolResult
		_ = json.Unmarshal(raw, &result)
		account := "a"
		if string(response.ID) == "2" {
			account = "b"
		}
		if result.IsError || len(result.Content) != 1 || !strings.Contains(result.Content[0].Text, account+"-model  ← 当前使用") {
			t.Fatalf("routed result: %+v", result)
		}
	}
	// Omitting account after a B call must still choose A.
	result, rerr := server.handler("tools/call")(context.Background(), json.RawMessage(`{"name":"list_models","arguments":{}}`))
	if rerr != nil || !strings.Contains(result.(*CallToolResult).Content[0].Text, "a-model  ← 当前使用") {
		t.Fatalf("default result: %v %v", result, rerr)
	}
}
func TestToolsCallCancellationReachesClient(t *testing.T) {
	entered := make(chan struct{}, 1)
	cancelled := make(chan struct{}, 1)
	client := fakeClient(t, "fake", "", "model", func(req *http.Request) (*http.Response, error) {
		entered <- struct{}{}
		<-req.Context().Done()
		cancelled <- struct{}{}
		return nil, req.Context().Err()
	})
	sink := &responseSink{make(chan Response, 4)}
	server := NewServer(sink)
	RegisterTools(server, Deps{Client: client})
	reader, writer := io.Pipe()
	defer writer.Close()
	done := make(chan error, 1)
	go func() { done <- server.Serve(reader) }()
	_, _ = io.WriteString(writer, toolsCall(1, "list_chats", map[string]any{}))
	receive(t, entered)
	_, _ = io.WriteString(writer, `{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}`+"\n")
	receive(t, cancelled)
	_ = writer.Close()
	if err := receive(t, done); err != nil {
		t.Fatal(err)
	}
	response := receive(t, sink.responses)
	raw, _ := json.Marshal(response.Result)
	var result CallToolResult
	_ = json.Unmarshal(raw, &result)
	if !result.IsError {
		t.Fatalf("cancellation was not an error: %+v", response)
	}
}
func historyClient(t *testing.T, status string, done bool, batchCalls *atomic.Int32) *zai.Client {
	return fakeClient(t, "fake", "", "model", func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/api/v1/chats" {
			return fakeResponse([]map[string]any{{"id": "chat", "last_run": map[string]any{"message_id": "a", "status": status}}}), nil
		}
		if strings.HasSuffix(req.URL.Path, "/messages/batch") {
			batchCalls.Add(1)
			return fakeResponse(map[string]any{"data": []map[string]any{{"id": "a", "role": "assistant", "content": "partial", "done": done, "status": status}}}), nil
		}
		return fakeResponse(map[string]any{"chat": map[string]any{"history": map[string]any{"currentId": "a", "messages": map[string]any{"a": map[string]any{"id": "a", "role": "assistant"}}}}}), nil
	})
}
func TestWaitReturnsPartialAndTimeoutError(t *testing.T) {
	var calls atomic.Int32
	d := Deps{Client: historyClient(t, "running", false, &calls)}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	msgs, err := d.pollNewMessages(ctx, "chat", "a", true, 1)
	if !errors.Is(err, context.DeadlineExceeded) || len(msgs) != 1 || calls.Load() < 1 {
		t.Fatalf("partial timeout: %+v %v", msgs, err)
	}
	ctx2, cancel2 := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel2()
	result, rerr := d.waitForReplyContext(ctx2, json.RawMessage(`{"chat_id":"chat","after_message_id":"a","poll_ms":1}`))
	if rerr != nil || !result.(*CallToolResult).IsError || !strings.Contains(result.(*CallToolResult).Content[0].Text, "partial") {
		t.Fatalf("wait: %v %v", result, rerr)
	}
}
func TestWaitFailedAndCompletedDiffer(t *testing.T) {
	for _, status := range []string{"failed", "completed"} {
		var calls atomic.Int32
		d := Deps{Client: historyClient(t, status, true, &calls)}
		msgs, err := d.pollNewMessages(context.Background(), "chat", "a", true, 1)
		if len(msgs) != 1 || (status == "failed") != (err != nil) {
			t.Fatalf("%s: %v %v", status, msgs, err)
		}
	}
}
func TestNumericArgumentsAndZeroLimits(t *testing.T) {
	for _, raw := range []string{`{"max_chars":-1}`, `{"limit":-1}`, `{"page":-1}`, `{"poll_ms":0}`, `{"attempts":-1}`, `{"timeout_seconds":9223372036854775807}`} {
		if validateArguments(json.RawMessage(raw)) == nil {
			t.Fatal(raw)
		}
	}
	if defaultInt(json.RawMessage(`{}`), "limit", 20) != 20 || defaultInt(json.RawMessage(`{"limit":0}`), "limit", 20) != 0 || clip("你好🙂", 2) != "你好\n... (已截断，原长 3 字符)" {
		t.Fatal("zero/default or UTF-8 clipping")
	}
	var requests atomic.Int32
	client := fakeClient(t, "fake", "", "model", func(*http.Request) (*http.Response, error) {
		requests.Add(1)
		return nil, errors.New("should not request")
	})
	_, err := (Deps{Client: client}).downloadChatFileContext(context.Background(), json.RawMessage(`{"chat_id":"chat","all":true}`))
	if err == nil || requests.Load() != 0 {
		t.Fatal("ZIP without output sent HTTP")
	}
}
func TestSaveStreamIsAtomicOnFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "file.txt")
	if err := os.WriteFile(path, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err := saveStream(path, func(w io.Writer) error { _, _ = io.WriteString(w, "partial"); return errors.New("interrupted") })
	raw, _ := os.ReadFile(path)
	if err == nil || string(raw) != "original" {
		t.Fatalf("%s %v", raw, err)
	}
	size, err := saveStream(path, func(w io.Writer) error { _, err := io.WriteString(w, "complete"); return err })
	raw, _ = os.ReadFile(path)
	if err != nil || size != 8 || string(raw) != "complete" {
		t.Fatalf("%s %v", raw, err)
	}
	files, _ := os.ReadDir(filepath.Dir(path))
	if len(files) != 1 {
		t.Fatalf("temporary residue: %v", files)
	}
}

func TestSendPartialErrorKeepsRecoverableID(t *testing.T) {
	var completions atomic.Int32
	var chat map[string]any
	client := fakeClient(t, "fake", "", "model", func(req *http.Request) (*http.Response, error) {
		switch {
		case req.URL.Path == "/api/v1/chats":
			return fakeResponse([]any{}), nil
		case strings.Contains(req.URL.Path, "feature-quota"):
			return fakeResponse(map[string]any{"code": 0, "data": map[string]any{"items": []map[string]any{{"feature": "agent_mode", "status": "available", "limit": 20, "remaining": 20, "used": 0}}}}), nil
		case req.URL.Path == "/api/models":
			return fakeResponse(map[string]any{"data": []map[string]any{{"id": "model"}}}), nil
		case req.URL.Path == "/api/v2/chat/completions":
			completions.Add(1)
			response := fakeResponse(nil)
			response.Header.Set("Content-Type", "text/event-stream")
			response.Body = io.NopCloser(strings.NewReader("data: {\"type\":\"chat:completion\",\"data\":{\"phase\":\"answer\",\"delta_content\":\"partial-output\"}}\n\n"))
			return response, nil
		case req.Method == http.MethodPost && strings.HasSuffix(req.URL.Path, "/messages/batch"):
			h, _ := chat["history"].(map[string]any)
			return fakeResponse(map[string]any{"data": []map[string]any{{"id": h["currentId"], "role": "assistant", "done": false, "status": "running"}}}), nil
		case req.Method == http.MethodPost:
			var payload struct {
				Chat map[string]any `json:"chat"`
			}
			if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
				return nil, err
			}
			chat = payload.Chat
			return fakeResponse(map[string]any{}), nil
		default:
			if chat == nil {
				chat = map[string]any{"history": map[string]any{"currentId": "", "messages": map[string]any{}}}
			}
			return fakeResponse(map[string]any{"chat": chat}), nil
		}
	})
	result, rerr := (Deps{Client: client}).sendMessageContext(context.Background(), json.RawMessage(`{"chat_id":"chat","message":"hello","wait":false}`))
	// Close joins the tracker before reading shared fake state or completing test.
	_ = client.Close()
	if rerr != nil {
		t.Fatal(rerr)
	}
	tool := result.(*CallToolResult)
	if !tool.IsError || !strings.Contains(tool.Content[0].Text, "partial-output") || !strings.Contains(tool.Content[0].Text, "state: unknown") || !strings.Contains(tool.Content[0].Text, "message_id: ") || completions.Load() != 1 {
		t.Fatalf("partial recovery result: %+v, POSTs=%d", tool, completions.Load())
	}
}

func TestWaitDoneSegmentStillWaitsForRunningAgent(t *testing.T) {
	var calls atomic.Int32
	client := fakeClient(t, "fake", "", "model", func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/api/v1/chats" {
			return fakeResponse([]map[string]any{{"id": "chat", "last_run": map[string]any{"message_id": "a", "status": "running"}}}), nil
		}
		if strings.HasSuffix(req.URL.Path, "/messages/batch") {
			calls.Add(1)
			return fakeResponse(map[string]any{"data": []map[string]any{{"id": "a", "role": "assistant", "done": true, "status": "completed"}}}), nil
		}
		return fakeResponse(map[string]any{"chat": map[string]any{"history": map[string]any{"currentId": "a", "messages": map[string]any{"a": map[string]any{"id": "a", "role": "assistant"}}}}}), nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	msgs, err := (Deps{Client: client}).pollNewMessages(ctx, "chat", "a", true, 1)
	if !errors.Is(err, context.DeadlineExceeded) || len(msgs) != 1 || calls.Load() < 1 {
		t.Fatalf("running segment falsely complete: %v %v", msgs, err)
	}
}
