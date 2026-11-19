package zai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"io"
	"net/http"
	"strings"
	"time"
)

type SendResult struct {
	MessageID     string `json:"message_id"`
	UserMessageID string `json:"user_message_id,omitempty"`
	State         string `json:"state"`
	Content       string `json:"content"`
	Reasoning     string `json:"reasoning,omitempty"`
	Usage         *Usage `json:"usage,omitempty"`
	Done          bool   `json:"done"`
}
type SubmissionError struct {
	MessageID, State string
	Cause            error
}

func (e *SubmissionError) Error() string {
	return fmt.Sprintf("发送状态=%s，message_id=%s：%v；请查询原消息，不要盲目重发", e.State, e.MessageID, e.Cause)
}
func (e *SubmissionError) Unwrap() error { return e.Cause }

type captchaProvider interface {
	Solve(context.Context) (string, error)
}

// Register dependencies before serving requests.
func (c *Client) SetCaptchaProvider(p captchaProvider) { c.captcha = p }
func (c *Client) IsRunning(ctx context.Context, chatID string) (bool, error) {
	s, e := c.remoteState(ctx, chatID, "")
	return s == "running", e
}
func (c *Client) Send(ctx context.Context, chatID, prompt string, onDelta func(string)) (*SendResult, error) {
	return c.SendWithRetry(ctx, chatID, prompt, 1, onDelta)
}

// Only explicit pre-admission CAPTCHA rejection may retry the same submission.
// Unknown, running or unreadable state is never permission to resend.
func (c *Client) SendWithRetry(ctx context.Context, chatID, prompt string, attempts int, onDelta func(string)) (*SendResult, error) {
	if strings.TrimSpace(chatID) == "" || strings.TrimSpace(prompt) == "" {
		return nil, fmt.Errorf("chat_id 和消息内容不能为空")
	}
	if len(prompt) > 1024*1024 {
		return nil, fmt.Errorf("消息超过1MiB上限")
	}
	if attempts <= 0 {
		attempts = 1
	}
	if attempts > 3 {
		return nil, fmt.Errorf("attempts 必须在1到3之间")
	}
	ctx, unlink := c.linkedContext(ctx)
	defer unlink()
	release, e := c.limiter.acquire(ctx, chatID)
	if e != nil {
		return nil, e
	}
	owned := true
	defer func() {
		if owned {
			release()
		}
	}()
	if e = c.waitIdle(ctx, chatID); e != nil {
		return nil, e
	}
	if e = c.waitAccountCapacity(ctx); e != nil {
		return nil, e
	}
	reserve, e := c.reserveQuota(ctx)
	if e != nil {
		return nil, e
	}
	// Default settle is conservative once dispatch is uncertain.
	sent := false
	defer func() { reserve.settle(!sent) }()
	mutation, e := c.mutation.acquire(ctx, chatID)
	if e != nil {
		return nil, e
	}
	defer mutation()
	// Recheck after acquiring mutation right before modifying history.
	if e = c.waitIdle(ctx, chatID); e != nil {
		return nil, e
	}
	param, e := c.solveCaptcha(ctx)
	if e != nil {
		return nil, e
	}
	if e = reserve.validate(ctx, c); e != nil {
		return nil, e
	}
	um, e := c.appendUserMessage(ctx, chatID, prompt)
	if e != nil {
		return nil, e
	}
	result := &SendResult{MessageID: um.AssistantID, UserMessageID: um.UserID, State: "not_sent"}
	for attempt := 0; attempt < attempts; attempt++ {
		// Queue/risk preparation may take seconds; recheck authoritative quota now.
		if e = reserve.validate(ctx, c); e != nil {
			return result, e
		}
		if e = c.markDispatched(ctx, chatID, um); e != nil {
			return result, e
		}
		sent = true
		c.setPending(chatID, um.AssistantID)
		c.setDraft(chatID, nil)
		// Once dispatch is attempted, nil result must never inherit not_sent.
		result.State = "unknown"
		res, err := c.sendOnce(ctx, chatID, prompt, um, param, onDelta)
		if res != nil {
			result = res
		}
		result.MessageID = um.AssistantID
		result.UserMessageID = um.UserID
		if err == nil {
			state, stateErr := c.remoteState(ctx, chatID, um.AssistantID)
			if stateErr == nil && (state == "completed" || state == "failed") {
				c.setPending(chatID, "")
				result.State = state
				result.Done = true
				if state == "failed" {
					return result, &SubmissionError{MessageID: um.AssistantID, State: state, Cause: fmt.Errorf("远端任务失败")}
				}
				return result, nil
			}
			result.State = "running"
			result.Done = false
			owned = false
			c.trackRemote(chatID, um.AssistantID, release)
			return result, nil
		}
		if result.State == "not_sent" {
			sent = false
			c.setPending(chatID, "")
			c.setDraft(chatID, um)
			return result, err
		}
		preCaptcha := errors.Is(err, ErrCaptchaRequired) && result.State == "rejected" && result.Content == "" && result.Reasoning == ""
		if preCaptcha {
			c.setPending(chatID, "")
			c.setDraft(chatID, um)
			sent = false
			if attempt+1 < attempts {
				param, e = c.solveCaptcha(ctx)
				if e != nil {
					return result, e
				}
				continue
			}
			return result, &SubmissionError{MessageID: um.AssistantID, State: "rejected", Cause: err}
		}
		var he *HTTPError
		rejected := errors.As(err, &he) && (he.Status == 401 || he.Status == 403 || he.Status == 404 || he.Status == 405 || he.Status == 429)
		if rejected {
			c.setPending(chatID, "")
			c.setDraft(chatID, um)
			result.State = "rejected"
			return result, &SubmissionError{MessageID: um.AssistantID, State: "rejected", Cause: err}
		}
		// Transport/HTML/SSE failure can occur after upstream admission: retain lease.
		result.State = "unknown"
		owned = false
		c.trackRemote(chatID, um.AssistantID, release)
		return result, &SubmissionError{MessageID: um.AssistantID, State: "unknown", Cause: err}
	}
	return result, &SubmissionError{MessageID: um.AssistantID, State: result.State, Cause: ErrCaptchaRequired}
}
func (c *Client) solveCaptcha(ctx context.Context) (string, error) {
	if c.captcha == nil {
		if c.cfg.Captcha.Enabled {
			return "", fmt.Errorf("验证码求解器未配置，本次未发送")
		}
		return "", nil
	}
	p, e := c.captcha.Solve(ctx)
	if e != nil {
		return "", fmt.Errorf("验证码求解失败，本次未发送：%s", c.redact(e.Error()))
	}
	if len(p) < 100 {
		return "", fmt.Errorf("验证码结果异常，本次未发送")
	}
	return p, nil
}
func (c *Client) waitAccountCapacity(ctx context.Context) error {
	for {
		list, e := c.ListChats(ctx)
		if e != nil {
			return fmt.Errorf("%w：无法读取账户运行状态", ErrRunUnknown)
		}
		n := 0
		for _, chat := range list {
			if chat.LastRun == nil {
				continue
			}
			switch strings.ToLower(chat.LastRun.Status) {
			case "running", "pending", "in_progress", "queued":
				n++
			}
		}
		if n < c.cfg.MaxConcurrency {
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

type userMsg struct{ UserID, ParentID, AssistantID string }

func (c *Client) appendUserMessage(ctx context.Context, chatID, prompt string) (*userMsg, error) {
	chat, e := c.GetChatRaw(ctx, chatID)
	if e != nil {
		return nil, e
	}
	history, _ := chat["history"].(map[string]any)
	if history == nil {
		history = map[string]any{"messages": map[string]any{}, "currentId": ""}
		chat["history"] = history
	}
	msgs, _ := history["messages"].(map[string]any)
	if msgs == nil {
		msgs = map[string]any{}
		history["messages"] = msgs
	}
	parent, _ := history["currentId"].(string)
	if node, ok := msgs[parent].(map[string]any); ok {
		role, _ := node["role"].(string)
		done, _ := node["done"].(bool)
		draft, _ := node["bridge_draft"].(bool)
		localDraft := c.draft(chatID)
		if localDraft != nil && localDraft.AssistantID == parent && c.pendingID(chatID) == "" {
			draft = true
		}
		if role == "assistant" && !done && draft {
			upID, _ := node["parentId"].(string)
			up, _ := msgs[upID].(map[string]any)
			if !draft || up == nil || up["role"] != "user" || up["content"] != prompt {
				return nil, fmt.Errorf("%w：禁止复用或覆写非本地匹配草稿", ErrRunUnknown)
			}
			upParent, _ := up["parentId"].(string)
			return &userMsg{UserID: upID, ParentID: upParent, AssistantID: parent}, nil
		}
		if role == "assistant" && !done && !draft {
			state, e := c.remoteState(ctx, chatID, parent)
			if e != nil || (state != "completed" && state != "failed") {
				return nil, ErrRunUnknown
			}
		}
		if role != "assistant" && parent != "" {
			return nil, fmt.Errorf("会话叶节点不是助手消息，需检查会话树")
		}
	}
	um := &userMsg{UserID: uuid.NewString(), AssistantID: uuid.NewString(), ParentID: parent}
	msgs[um.UserID] = map[string]any{"id": um.UserID, "parentId": nullable(parent), "childrenIds": []any{um.AssistantID}, "role": "user", "timestamp": time.Now().Unix(), "content": prompt, "models": []string{c.cfg.Model}}
	msgs[um.AssistantID] = map[string]any{"id": um.AssistantID, "parentId": um.UserID, "childrenIds": []any{}, "role": "assistant", "timestamp": time.Now().Unix(), "done": false, "bridge_draft": true}
	if node, ok := msgs[parent].(map[string]any); ok {
		children, _ := node["childrenIds"].([]any)
		node["childrenIds"] = append(children, um.UserID)
	}
	history["currentId"] = um.AssistantID
	if e = c.SaveChat(ctx, chatID, chat); e != nil {
		return nil, e
	}
	c.setDraft(chatID, um)
	return um, nil
}

// Persist dispatch intent before POST; uncertainty survives subsequent local calls.
func (c *Client) markDispatched(ctx context.Context, chatID string, um *userMsg) error {
	chat, e := c.GetChatRaw(ctx, chatID)
	if e != nil {
		return e
	}
	h, _ := chat["history"].(map[string]any)
	m, _ := h["messages"].(map[string]any)
	node, _ := m[um.AssistantID].(map[string]any)
	if node == nil {
		return ErrRunUnknown
	}
	node["bridge_draft"] = false
	return c.SaveChat(ctx, chatID, chat)
}
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
func (c *Client) sendOnce(ctx context.Context, chatID, prompt string, um *userMsg, param string, onDelta func(string)) (*SendResult, error) {
	raw, e := json.Marshal(c.completionBody(ctx, chatID, prompt, um, param))
	if e != nil {
		return nil, e
	}
	// Wait before signing, so a long Retry-After does not age the signature.
	releaseDispatch, e := c.dispatch.begin(ctx)
	if e != nil {
		return &SendResult{State: "not_sent"}, e
	}
	defer releaseDispatch()
	q, quotaErr := c.FeatureQuota(ctx)
	if quotaErr != nil {
		return &SendResult{State: "not_sent"}, ErrQuotaUnknown
	}
	if _, quotaErr = budgetFromQuota(q); quotaErr != nil {
		return &SendResult{State: "not_sent"}, quotaErr
	}
	sign, e := c.Sign(strings.TrimSpace(prompt), chatID)
	if e != nil {
		return nil, e
	}
	u := c.baseURL() + "/api/v2/chat/completions?" + sign.URLParams + "&signature_timestamp=" + sign.Timestamp
	req, e := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(raw))
	if e != nil {
		return nil, e
	}
	for k, v := range c.headers(chatID) {
		req.Header.Set(k, v)
	}
	req.Header.Set("accept", "text/event-stream")
	req.Header.Set("x-signature", sign.Signature)
	c.dispatch.markSent()
	resp, e := c.http.Do(req)
	releaseDispatch()
	if e != nil {
		return nil, fmt.Errorf("发送请求未确认受理：%s", c.redact(e.Error()))
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet, _ := readBounded(resp.Body, 4096)
		wait := retryAfter(resp.Header.Get("Retry-After"))
		if resp.StatusCode == 405 || resp.StatusCode == 429 {
			if wait == 0 {
				wait = time.Minute
			}
			c.dispatch.Pause(wait)
		}
		return nil, &HTTPError{Status: resp.StatusCode, Path: "/api/v2/chat/completions", Detail: c.redact(truncate(string(snippet), 400)), RetryAfter: wait}
	}
	ct := strings.ToLower(resp.Header.Get("content-type"))
	if strings.Contains(ct, "html") {
		return nil, ErrGatewayBlocked
	}
	if !strings.Contains(ct, "event-stream") {
		raw, e := readBounded(resp.Body, 4096)
		if e != nil {
			return nil, e
		}
		if bytes.Contains(bytes.ToLower(raw), []byte("<html")) || bytes.Contains(bytes.ToLower(raw), []byte("<!doctype")) {
			return nil, ErrGatewayBlocked
		}
		res := &SendResult{State: "unknown"}
		if err := parseEventError(raw, res); err != nil {
			return res, err
		}
		return res, fmt.Errorf("服务端未返回事件流，content-type=%s", ct)
	}
	return c.consumeSSE(resp.Body, onDelta)
}
func parseEventError(payload []byte, result *SendResult) error {
	var top map[string]json.RawMessage
	if json.Unmarshal(payload, &top) != nil {
		return nil
	}
	current := top
	for depth := 0; depth < 4; depth++ {
		if raw, ok := current["error"]; ok && len(raw) > 0 && string(raw) != "null" && string(raw) != "{}" {
			var errObj struct {
				Code      any    `json:"code"`
				ErrorCode string `json:"error_code"`
				Detail    string `json:"detail"`
				Message   string `json:"message"`
			}
			if json.Unmarshal(raw, &errObj) != nil {
				return fmt.Errorf("服务端事件错误")
			}
			code := fmt.Sprint(errObj.Code)
			if code == "<nil>" {
				code = errObj.ErrorCode
			}
			detail := errObj.Detail
			if detail == "" {
				detail = errObj.Message
			}
			if strings.Contains(strings.ToUpper(code), "CAPTCHA") && result.Content == "" && result.Reasoning == "" && result.State != "accepted" {
				result.State = "rejected"
				return fmt.Errorf("%w：%s", ErrCaptchaRequired, detail)
			}
			return fmt.Errorf("服务端错误 %s：%s", code, detail)
		}
		raw, ok := current["data"]
		if !ok {
			break
		}
		var next map[string]json.RawMessage
		if json.Unmarshal(raw, &next) != nil {
			break
		}
		current = next
	}
	return nil
}

// SSE frames, not individual data lines; bound both frame and total output.
func (c *Client) consumeSSE(body io.Reader, onDelta func(string)) (*SendResult, error) {
	result := &SendResult{State: "unknown"}
	var answer, reason strings.Builder
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	data := []string{}
	frameBytes := 0
	consume := func() error {
		if len(data) == 0 {
			return nil
		}
		payload := strings.Join(data, "\n")
		data = nil
		frameBytes = 0
		if strings.TrimSpace(payload) == "[DONE]" {
			result.Done = true
			result.State = "completed"
			return nil
		}
		if !json.Valid([]byte(payload)) {
			return fmt.Errorf("事件流包含无效JSON；保留原消息状态")
		}
		if e := parseEventError([]byte(payload), result); e != nil {
			return e
		}
		var evt struct {
			Type string `json:"type"`
			Data struct {
				Phase        string `json:"phase"`
				DeltaContent string `json:"delta_content"`
				Done         bool   `json:"done"`
				Usage        *Usage `json:"usage"`
			} `json:"data"`
		}
		if e := json.Unmarshal([]byte(payload), &evt); e != nil {
			return e
		}
		if evt.Type != "" && evt.Type != "chat:completion" && evt.Type != "chat:message" {
			return nil
		}
		if evt.Data.DeltaContent != "" {
			if answer.Len()+reason.Len()+len(evt.Data.DeltaContent) > maxOutputBytes {
				return ErrResponseTooLarge
			}
			result.State = "accepted"
			if evt.Data.Phase == "thinking" || evt.Data.Phase == "reasoning" {
				reason.WriteString(evt.Data.DeltaContent)
			} else {
				answer.WriteString(evt.Data.DeltaContent)
				if onDelta != nil {
					onDelta(evt.Data.DeltaContent)
				}
			}
		}
		if evt.Data.Usage != nil {
			result.Usage = evt.Data.Usage
		}
		if evt.Data.Done || evt.Data.Phase == "done" {
			result.Done = true
			result.State = "completed"
		}
		return nil
	}
	finish := func(e error) (*SendResult, error) {
		result.Content = answer.String()
		result.Reasoning = reason.String()
		return result, e
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			if e := consume(); e != nil {
				return finish(e)
			}
			if result.Done {
				return finish(nil)
			}
			continue
		}
		if strings.HasPrefix(line, "data:") {
			v := strings.TrimPrefix(line, "data:")
			v = strings.TrimPrefix(v, " ")
			frameBytes += len(v)
			if frameBytes > 1024*1024 {
				return finish(ErrResponseTooLarge)
			}
			data = append(data, v)
		}
	}
	if e := scanner.Err(); e != nil {
		return finish(fmt.Errorf("事件流读取失败：%w", e))
	}
	if e := consume(); e != nil {
		return finish(e)
	}
	if !result.Done {
		return finish(ErrIncompleteStream)
	}
	return finish(nil)
}
