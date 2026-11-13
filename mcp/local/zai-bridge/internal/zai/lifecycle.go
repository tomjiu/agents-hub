package zai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
)

const maxJSONResponse int64 = 16 * 1024 * 1024
const maxOutputBytes = 4 * 1024 * 1024

var ErrResponseTooLarge = errors.New("响应超过安全大小上限")
var ErrRunUnknown = errors.New("无法确认原会话任务状态，不发送新消息")
var ErrIncompleteStream = errors.New("事件流未确认完成，请查询原消息；不自动重发")

type HTTPError struct {
	Status       int
	Path, Detail string
	RetryAfter   time.Duration
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("请求 %s 返回 %d: %s", e.Path, e.Status, e.Detail)
}
func (e *HTTPError) Is(target error) bool {
	return target == ErrThrottled && (e.Status == 405 || e.Status == 429) || target == ErrChatNotFound && e.Status == 404 && strings.HasPrefix(e.Path, "/api/v1/chats/")
}
func readBounded(r io.Reader, max int64) ([]byte, error) {
	b, e := io.ReadAll(io.LimitReader(r, max+1))
	if e != nil {
		return nil, e
	}
	if int64(len(b)) > max {
		return nil, ErrResponseTooLarge
	}
	return b, nil
}
func (c *Client) redact(s string) string {
	for _, secret := range []string{c.cfg.Token, c.cfg.Cookie} {
		if secret != "" {
			s = strings.ReplaceAll(s, secret, "[redacted]")
		}
	}
	return s
}
func (c *Client) Model() string { return c.cfg.Model }

// Set before serving requests; the shared gate limits all same-egress accounts.
func (c *Client) SetDispatchGate(g *DispatchGate) {
	if g != nil {
		c.dispatch = g
	}
}
func (c *Client) WithChatMutation(ctx context.Context, id string, fn func() error) error {
	r, e := c.mutation.acquire(ctx, id)
	if e != nil {
		return e
	}
	defer r()
	return fn()
}
func (c *Client) Close() error {
	c.trackerMu.Lock()
	if c.closed {
		c.trackerMu.Unlock()
		return nil
	}
	c.closed = true
	c.cancel()
	c.trackerMu.Unlock()
	c.trackers.Wait()
	c.http.CloseIdleConnections()
	return nil
}
func (c *Client) linkedContext(ctx context.Context) (context.Context, func()) {
	x, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(c.root, cancel)
	return x, func() { stop(); cancel() }
}
func (c *Client) pendingID(chatID string) string {
	c.trackerMu.Lock()
	defer c.trackerMu.Unlock()
	return c.pending[chatID]
}
func (c *Client) setPending(chatID, id string) {
	c.trackerMu.Lock()
	defer c.trackerMu.Unlock()
	if id == "" {
		delete(c.pending, chatID)
	} else {
		c.pending[chatID] = id
	}
}

// Keep account/conversation lease until remote terminal state is observed.
// Caller cancellation stops reading, not the remote generation.
func (c *Client) trackRemote(chatID, id string, release func()) {
	c.trackerMu.Lock()
	if c.closed {
		c.trackerMu.Unlock()
		release()
		return
	}
	c.trackers.Add(1)
	c.trackerMu.Unlock()
	go func() {
		defer c.trackers.Done()
		defer release()
		timer := time.NewTimer(0)
		defer timer.Stop()
		for {
			select {
			case <-c.root.Done():
				return
			case <-timer.C:
			}
			ctx, cancel := context.WithTimeout(c.root, 15*time.Second)
			state, e := c.remoteState(ctx, chatID, id)
			cancel()
			if e == nil && (state == "completed" || state == "failed" || state == "idle") {
				c.setPending(chatID, "")
				return
			}
			timer.Reset(3 * time.Second)
		}
	}()
}

// Message failures are terminal failures, never successful retry results.
func (m Message) Failed() bool {
	if len(m.Error) > 0 && string(m.Error) != "null" && string(m.Error) != "{}" {
		return true
	}
	switch strings.ToLower(m.StatusValue()) {
	case "failed", "error", "cancelled", "canceled", "aborted":
		return true
	}
	return false
}
func (m Message) Terminal() bool {
	if m.Failed() {
		return true
	}
	switch strings.ToLower(m.StatusValue()) {
	case "completed", "done", "finished", "stopped":
		return true
	case "running", "pending", "thinking", "in_progress":
		return false
	}
	return m.Done
}
func (m Message) Answer() string {
	var b strings.Builder
	for _, block := range m.ContentBlocks {
		if block.Type == "text" {
			var s string
			if unmarshalString(block.Content, &s) {
				b.WriteString(s)
			}
		}
	}
	if b.Len() == 0 && m.Content != nil {
		return *m.Content
	}
	return b.String()
}

// remoteState checks list run metadata first, then the message in the selected tree.
func (c *Client) remoteState(ctx context.Context, chatID, targetID string) (string, error) {
	list, e := c.ListChats(ctx)
	if e != nil {
		return "unknown", e
	}
	for _, chat := range list {
		if chat.ID != chatID {
			continue
		}
		if chat.LastRun != nil && (targetID == "" || chat.LastRun.MessageID == targetID) {
			switch strings.ToLower(chat.LastRun.Status) {
			case "running", "pending", "in_progress", "queued":
				return "running", nil
			case "completed", "finished", "done":
				return "completed", nil
			case "failed", "error", "cancelled", "canceled", "stopped":
				return "failed", nil
			default:
				return "unknown", ErrRunUnknown
			}
		}
		break
	}
	detail, e := c.GetChat(ctx, chatID)
	if e != nil {
		return "unknown", e
	}
	branch := detail.Branch()
	if targetID == "" {
		for i := len(branch) - 1; i >= 0; i-- {
			if branch[i].Role == "assistant" {
				targetID = branch[i].ID
				break
			}
		}
	}
	if targetID == "" {
		return "idle", nil
	}
	node, ok := detail.Chat.History.Messages[targetID]
	if !ok {
		return "unknown", ErrRunUnknown
	}
	localDraft := c.draft(chatID)
	if c.pendingID(chatID) == "" && ((localDraft != nil && localDraft.AssistantID == targetID) || node.Draft) {
		return "idle", nil
	}
	msgs, e := c.GetMessages(ctx, chatID, []string{targetID})
	if e != nil || len(msgs) != 1 {
		if e == nil {
			e = ErrRunUnknown
		}
		return "unknown", e
	}
	if msgs[0].Failed() {
		return "failed", nil
	}
	if msgs[0].Terminal() {
		return "completed", nil
	}
	return "running", nil
}
func (c *Client) waitIdle(ctx context.Context, chatID string) error {
	for {
		state, e := c.remoteState(ctx, chatID, c.pendingID(chatID))
		if e != nil {
			return fmt.Errorf("%w: %s", ErrRunUnknown, c.redact(e.Error()))
		}
		if state == "completed" || state == "failed" || state == "idle" {
			return nil
		}
		timer := time.NewTimer(2 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}
func unmarshalString(b []byte, s *string) bool { return json.Unmarshal(b, s) == nil }
