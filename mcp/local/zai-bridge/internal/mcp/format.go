package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/local/zai-bridge/internal/zai"
)

func (d Deps) getMessagesContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	var a struct {
		ChatID    string `json:"chat_id"`
		Limit     int    `json:"limit"`
		SinceID   string `json:"since_id"`
		LeafID    string `json:"leaf_id"`
		Reasoning bool   `json:"reasoning"`
		ToolCalls *bool  `json:"tool_calls"`
		MaxChars  int    `json:"max_chars"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, &RPCError{Code: CodeInvalidParams, Message: err.Error()}
	}
	if a.ChatID == "" {
		return nil, &RPCError{Code: CodeInvalidParams, Message: "缺少 chat_id"}
	}
	a.Limit = defaultInt(raw, "limit", 20)
	includeTools := true
	if a.ToolCalls != nil {
		includeTools = *a.ToolCalls
	}
	a.MaxChars = defaultInt(raw, "max_chars", 4000)

	ctx, cancel := context.WithTimeout(parent, 60*time.Second)
	defer cancel()

	// leaf_id 为空时跟随 currentId；给了就沿那条分支取
	msgs, err := d.Client.HistoryTo(ctx, a.ChatID, a.LeafID, a.Limit)
	if err != nil {
		return errResult(err), nil
	}

	// since_id 截断
	if a.SinceID != "" {
		idx := -1
		for i, m := range msgs {
			if m.ID == a.SinceID {
				idx = i
				break
			}
		}
		if idx >= 0 {
			msgs = msgs[idx+1:]
		}
	}
	if a.Limit > 0 && len(msgs) > a.Limit {
		msgs = msgs[len(msgs)-a.Limit:]
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "共 %d 条消息：\n\n", len(msgs))
	for _, m := range msgs {
		writeMessage(&sb, m, a.Reasoning, includeTools, a.MaxChars)
	}
	if len(msgs) == 0 {
		sb.WriteString("(没有消息)\n")
	}
	return textResult(sb.String()), nil
}

// writeMessage 把一条消息渲染成可读文本。
func writeMessage(sb *strings.Builder, m zai.Message, withReasoning, withTools bool, maxChars int) {
	role := m.Role
	if role == "assistant" {
		role = "assistant"
	}
	// 只有助手消息才有"生成中"的语义；用户消息的 done 恒为 false，不能据此标进行中。
	state := ""
	if m.Role == "assistant" && !m.Done {
		state = " [进行中]"
	}
	if sv := m.StatusValue(); sv != "" {
		state += " [" + sv + "]"
	}
	fmt.Fprintf(sb, "═══ %s%s ═══\n", role, state)
	fmt.Fprintf(sb, "id: %s  时间: %s\n", m.ID, time.Unix(m.Timestamp, 0).Format("01-02 15:04:05"))

	for _, b := range m.ContentBlocks {
		switch b.Type {
		case "reasoning":
			if !withReasoning {
				continue
			}
			var s string
			_ = json.Unmarshal(b.Content, &s)
			if s == "" {
				continue
			}
			fmt.Fprintf(sb, "\n--- 思考 ---\n%s\n", clip(s, maxChars))

		case "text":
			var s string
			_ = json.Unmarshal(b.Content, &s)
			if s == "" {
				continue
			}
			fmt.Fprintf(sb, "\n%s\n", clip(s, maxChars))

		case "tool_calls":
			if !withTools {
				continue
			}
			var calls []zai.ToolCall
			if err := json.Unmarshal(b.Content, &calls); err != nil {
				// 有些版本是 {tool_calls:[...]} 包装
				var wrap struct {
					ToolCalls []zai.ToolCall `json:"tool_calls"`
				}
				if err2 := json.Unmarshal(b.Content, &wrap); err2 == nil {
					calls = wrap.ToolCalls
				}
			}
			results := map[string]zai.ToolResult{}
			for _, r := range b.Results {
				results[r.ToolCallID] = r
			}
			for _, c := range calls {
				fmt.Fprintf(sb, "\n--- 工具调用: %s ---\n", c.Function.Name)
				fmt.Fprintf(sb, "参数: %s\n", clip(prettyJSON(c.Function.Arguments), maxChars))
				if r, ok := results[c.ID]; ok {
					fmt.Fprintf(sb, "返回[%s]: %s\n", r.Status, clip(r.Content, maxChars))
				}
			}
		}
	}

	// 兼容只有 content 字段的老消息
	if len(m.ContentBlocks) == 0 && m.Content != nil && *m.Content != "" {
		fmt.Fprintf(sb, "\n%s\n", clip(*m.Content, maxChars))
	}
	sb.WriteString("\n")
}

func clip(s string, max int) string {
	if max <= 0 {
		return s
	}
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + fmt.Sprintf("\n... (已截断，原长 %d 字符)", len(runes))
}

func prettyJSON(s string) string {
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		return s
	}
	out, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return s
	}
	return string(out)
}
