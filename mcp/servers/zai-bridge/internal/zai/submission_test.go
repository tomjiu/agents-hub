package zai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

type submissionFixture struct {
	mu               sync.Mutex
	chat             map[string]any
	runID, runStatus string
	posts            int
	parents          []any
	contents         []string
	stream           string
	firstStarted     chan struct{}
	firstRelease     chan struct{}
}

func newSubmissionFixture() *submissionFixture {
	return &submissionFixture{chat: map[string]any{"history": map[string]any{"messages": map[string]any{}, "currentId": ""}}, stream: "data: {\"type\":\"chat:completion\",\"data\":{\"phase\":\"answer\",\"delta_content\":\"ok\",\"done\":true}}\n\n"}
}
func (f *submissionFixture) transport(r *http.Request) (*http.Response, error) {
	if r.URL.Path == "/api/v2/chat/completions" {
		var body map[string]any
		if e := json.NewDecoder(r.Body).Decode(&body); e != nil {
			return nil, e
		}
		f.mu.Lock()
		f.posts++
		n := f.posts
		f.parents = append(f.parents, body["current_user_message_parent_id"])
		f.runID = body["id"].(string)
		f.runStatus = "running"
		stream := f.stream
		f.mu.Unlock()
		if n == 1 && f.firstStarted != nil {
			close(f.firstStarted)
			select {
			case <-f.firstRelease:
			case <-r.Context().Done():
				return nil, r.Context().Err()
			}
		}
		f.mu.Lock()
		if strings.Contains(stream, "done") {
			f.runStatus = "completed"
		}
		f.mu.Unlock()
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(stream)), Request: r}, nil
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	switch {
	case r.URL.Path == "/api/v1/chats":
		var last any
		if f.runID != "" {
			last = map[string]any{"message_id": f.runID, "status": f.runStatus}
		}
		return coreJSON(r, []any{map[string]any{"id": "chat", "last_run": last}}), nil
	case strings.Contains(r.URL.Path, "feature-quota"):
		return coreJSON(r, quotaEnvelope(20)), nil
	case r.URL.Path == "/api/models":
		return coreJSON(r, map[string]any{"data": []any{map[string]any{"id": "glm-5.3"}}}), nil
	case r.URL.Path == "/api/v1/chats/new" || r.URL.Path == "/api/v1/chats/chat" && r.Method == http.MethodPost:
		var body struct {
			Chat map[string]any `json:"chat"`
		}
		if e := json.NewDecoder(r.Body).Decode(&body); e != nil {
			return nil, e
		}
		f.chat = body.Chat
		return coreJSON(r, map[string]any{"chat": map[string]any{"id": "chat"}}), nil
	case strings.HasSuffix(r.URL.Path, "/messages/batch"):
		return coreJSON(r, map[string]any{"data": []any{map[string]any{"id": f.runID, "role": "assistant", "done": f.runStatus == "completed", "status": f.runStatus}}}), nil
	default:
		return coreJSON(r, map[string]any{"chat": f.chat}), nil
	}
}
func TestSendCompletedNormalizedTreeQueuesNextParent(t *testing.T) {
	f := newSubmissionFixture()
	f.firstStarted = make(chan struct{})
	f.firstRelease = make(chan struct{})
	c := testCoreClient(t, f.transport)
	results := make(chan error, 2)
	go func() { _, e := c.Send(context.Background(), "chat", "first", nil); results <- e }()
	select {
	case <-f.firstStarted:
	case e := <-results:
		t.Fatal("first send did not start", e)
	case <-time.After(2 * time.Second):
		t.Fatal("send start timeout")
	}
	go func() { _, e := c.Send(context.Background(), "chat", "second", nil); results <- e }()
	// Second request cannot reach completion endpoint before first lease completes.
	time.Sleep(30 * time.Millisecond)
	f.mu.Lock()
	n := f.posts
	firstID := f.runID
	f.mu.Unlock()
	if n != 1 {
		t.Fatal("concurrent same-conversation POST")
	}
	close(f.firstRelease)
	for i := 0; i < 2; i++ {
		if e := <-results; e != nil {
			t.Fatal(e)
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.posts != 2 || f.parents[1] != firstID {
		t.Fatalf("incorrect successor parent posts=%d parents=%v", f.posts, f.parents)
	}
}
func TestCreateDraftReuseWithoutOverwritingContent(t *testing.T) {
	f := newSubmissionFixture()
	c := testCoreClient(t, f.transport)
	id, e := c.CreateChat(context.Background(), "draft", "hello")
	if e != nil {
		t.Fatal(e)
	}
	// Server may strip bridge_draft: local registry still preserves unsubmitted intent.
	f.mu.Lock()
	h := f.chat["history"].(map[string]any)
	m := h["messages"].(map[string]any)
	leaf := h["currentId"].(string)
	delete(m[leaf].(map[string]any), "bridge_draft")
	f.mu.Unlock()
	if _, e = c.Send(context.Background(), id, "different", nil); e == nil {
		t.Fatal("must not overwrite the draft prompt")
	}
	if _, e = c.Send(context.Background(), id, "hello", nil); e != nil {
		t.Fatal(e)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.posts != 1 || len(f.chat["history"].(map[string]any)["messages"].(map[string]any)) != 2 {
		t.Fatal("draft duplicate nodes")
	}
}
func TestUnknownPartialSendNeverResubmits(t *testing.T) {
	f := newSubmissionFixture()
	f.stream = "data: {\"data\":{\"phase\":\"answer\",\"delta_content\":\"partial\"}}\n\n"
	c := testCoreClient(t, f.transport)
	r, e := c.SendWithRetry(context.Background(), "chat", "hello", 3, nil)
	if e == nil || r == nil || r.State != "unknown" || r.MessageID == "" || r.Content != "partial" {
		t.Fatalf("unexpected partial %+v %v", r, e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Millisecond)
	defer cancel()
	_, e = c.SendWithRetry(ctx, "chat", "new", 3, nil)
	if !errors.Is(e, context.DeadlineExceeded) {
		t.Fatal(e)
	}
	c.Close()
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.posts != 1 {
		t.Fatal("unknown result resubmitted")
	}
}

type failingCaptcha struct{}

func (failingCaptcha) Solve(context.Context) (string, error) { return "", errors.New("fake failure") }
func TestCaptchaFailureDoesNotWriteHistoryOrSend(t *testing.T) {
	writes := 0
	c := testCoreClient(t, func(r *http.Request) (*http.Response, error) {
		if r.Method != http.MethodGet {
			writes++
		}
		if strings.Contains(r.URL.Path, "feature-quota") {
			return coreJSON(r, quotaEnvelope(20)), nil
		}
		if r.URL.Path == "/api/v1/chats" {
			return coreJSON(r, []any{}), nil
		}
		return coreJSON(r, map[string]any{"chat": map[string]any{"history": map[string]any{"messages": map[string]any{}, "currentId": ""}}}), nil
	})
	c.SetCaptchaProvider(failingCaptcha{})
	_, e := c.Send(context.Background(), "chat", "hello", nil)
	if e == nil || writes != 0 {
		t.Fatalf("failure writes=%d err=%v", writes, e)
	}
}
