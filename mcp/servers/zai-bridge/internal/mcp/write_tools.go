package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/local/zai-bridge/internal/zai"
)

func (d Deps) createChatContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	var a struct {
		Title   string `json:"title"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, &RPCError{Code: CodeInvalidParams, Message: err.Error()}
	}

	ctx, cancel := context.WithTimeout(parent, 60*time.Second)
	defer cancel()

	id, err := d.Client.CreateChat(ctx, a.Title, a.Message)
	if err != nil {
		return errResult(err), nil
	}
	return textResult(fmt.Sprintf("已创建会话\nchat_id: %s", id)), nil
}

func (d Deps) sendMessageContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	var a struct {
		ChatID   string `json:"chat_id"`
		Message  string `json:"message"`
		Wait     *bool  `json:"wait"`
		Attempts int    `json:"attempts"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, &RPCError{Code: CodeInvalidParams, Message: err.Error()}
	}
	if a.ChatID == "" || strings.TrimSpace(a.Message) == "" {
		return nil, &RPCError{Code: CodeInvalidParams, Message: "chat_id 和 message 均为必填"}
	}
	doWait := a.Wait == nil || *a.Wait
	ctx, cancel := context.WithTimeout(parent, time.Duration(defaultInt(raw, "timeout_seconds", 600))*time.Second)
	defer cancel()
	start := time.Now()
	// Client owns FIFO admission, quota and run lifecycle. Never pre-reject via
	// IsRunning or take an independent MCP lock before using the sending API.
	res, err := d.Client.SendWithRetry(ctx, a.ChatID, a.Message, a.Attempts, nil)
	var sb strings.Builder
	fmt.Fprintf(&sb, "chat_id: %s\n", a.ChatID)
	if res != nil {
		fmt.Fprintf(&sb, "message_id: %s\nstate: %s\n", res.MessageID, res.State)
		if res.UserMessageID != "" {
			fmt.Fprintf(&sb, "user_message_id: %s\n", res.UserMessageID)
		}
		if res.Content != "" {
			fmt.Fprintf(&sb, "\n--- 当前回复 ---\n%s\n", res.Content)
		}
		if res.Usage != nil {
			fmt.Fprintf(&sb, "token: %d\n", res.Usage.TotalTokens)
		}
	}
	if err != nil {
		fmt.Fprintf(&sb, "发送未确认完成: %v\n请用 message_id 查询或恢复原请求，不要盲目重发。\n", err)
		result := submissionResult(sb.String(), res)
		result.IsError = true
		return result, nil
	}
	fmt.Fprintf(&sb, "发送耗时: %s\n", time.Since(start).Round(time.Millisecond))
	if !doWait {
		sb.WriteString("未额外等待云端最终回复；可用 wait_for_reply 查询原 message_id。\n")
		return submissionResult(sb.String(), res), nil
	}
	if res != nil && res.State == "completed" {
		return submissionResult(sb.String(), res), nil
	}
	if res == nil || res.MessageID == "" {
		return errResult(fmt.Errorf("发送结果缺少可恢复 message_id")), nil
	}
	msgs, werr := d.pollNewMessages(ctx, a.ChatID, res.MessageID, true, 3000)
	sb.WriteString(renderNew(msgs))
	result := submissionResult(sb.String(), res)
	if werr != nil {
		result.Content[0].Text += fmt.Sprintf("等待未完成: %v\nmessage_id: %s\n", werr, res.MessageID)
		result.IsError = true
	}
	return result, nil
}

func (d Deps) waitForReplyContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	var a struct {
		ChatID         string `json:"chat_id"`
		AfterMessageID string `json:"after_message_id"`
		MessageID      string `json:"message_id"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, &RPCError{Code: CodeInvalidParams, Message: err.Error()}
	}
	if a.ChatID == "" {
		return nil, &RPCError{Code: CodeInvalidParams, Message: "缺少 chat_id"}
	}
	ctx, cancel := context.WithTimeout(parent, time.Duration(defaultInt(raw, "timeout_seconds", 300))*time.Second)
	defer cancel()
	if a.MessageID != "" && a.AfterMessageID != "" && a.MessageID != a.AfterMessageID {
		return nil, &RPCError{Code: CodeInvalidParams, Message: "message_id 与 after_message_id 冲突"}
	}
	after := a.AfterMessageID
	if after == "" {
		after = a.MessageID
	}
	if after == "" {
		detail, err := d.Client.GetChat(ctx, a.ChatID)
		if err != nil {
			return errResult(err), nil
		}
		after = detail.Chat.History.CurrentID
	}
	msgs, err := d.pollNewMessages(ctx, a.ChatID, after, true, defaultInt(raw, "poll_ms", 3000))
	result := textResult(fmt.Sprintf("chat_id: %s\nmessage_id: %s\n", a.ChatID, after) + renderNew(msgs))
	if err != nil {
		result.Content[0].Text += fmt.Sprintf("等待未完成: %v\n", err)
		result.IsError = true
	}
	return result, nil
}

// Return partial content together with an error, never timeout-as-success. The
// newest assistant must be terminal; a completed earlier segment is not enough.
func (d Deps) pollNewMessages(ctx context.Context, chatID, afterID string, includeAfter bool, pollMS int) ([]zai.Message, error) {
	if pollMS < 1 || pollMS > 3600000 {
		return nil, fmt.Errorf("poll_ms must be in [1,3600000]")
	}
	ticker := time.NewTicker(time.Duration(pollMS) * time.Millisecond)
	defer ticker.Stop()
	var last []zai.Message
	for {
		if err := ctx.Err(); err != nil {
			return last, err
		}
		// A stable response id can live on a non-current branch after another
		// queued send. Follow that id rather than silently waiting on a new run.
		var msgs []zai.Message
		var err error
		if includeAfter && afterID != "" {
			msgs, err = d.Client.HistoryTo(ctx, chatID, afterID, 1)
		} else {
			msgs, err = d.Client.History(ctx, chatID, 0)
		}
		if err != nil {
			return last, err
		}
		idx := -1
		for i, m := range msgs {
			if m.ID == afterID {
				idx = i
				break
			}
		}
		switch {
		case idx >= 0 && includeAfter:
			last = msgs[idx:]
		case idx >= 0:
			last = msgs[idx+1:]
		case afterID == "":
			last = msgs
		}
		for i := len(last) - 1; i >= 0; i-- {
			m := last[i]
			if m.Role != "assistant" {
				continue
			}
			if m.Failed() {
				return last, fmt.Errorf("assistant %s failed (%s)", m.ID, m.StatusValue())
			}
			if m.Terminal() {
				state, stateErr := d.Client.RunState(ctx, chatID, m.ID)
				if stateErr != nil {
					return last, fmt.Errorf("无法确认完整运行终态: %w", stateErr)
				}
				switch state {
				case "completed":
					return last, nil
				case "failed":
					return last, fmt.Errorf("assistant %s remote run failed", m.ID)
				case "running": // A done SSE/message segment is not the whole agent run.
				default:
					return last, fmt.Errorf("assistant %s remote run state is %s", m.ID, state)
				}
			}
			break
		}
		select {
		case <-ctx.Done():
			return last, ctx.Err()
		case <-ticker.C:
		}
	}
}

func renderNew(msgs []zai.Message) string {
	if len(msgs) == 0 {
		return "(没有新内容)\n"
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "--- 新增 %d 条 ---\n\n", len(msgs))
	for _, m := range msgs {
		writeMessage(&sb, m, false, true, 4000)
	}
	return sb.String()
}
