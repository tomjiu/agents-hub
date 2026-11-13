package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// 会话管理：改名、置顶、归档、删除。

func manageTools() []ToolDef {
	return []ToolDef{
		{
			Name:        "list_models",
			Description: "列出账户可用的模型 id（发消息时的 model 就是从这里选）。",
			InputSchema: map[string]any{"type": "object", "properties": map[string]any{}},
		},
		{
			Name:        "rename_chat",
			Description: "修改会话标题。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"chat_id": map[string]any{"type": "string", "description": "会话 id"},
					"title":   map[string]any{"type": "string", "description": "新标题"},
				},
				"required": []string{"chat_id", "title"},
			},
		},
		{
			Name:        "pin_chat",
			Description: "置顶或取消置顶会话。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"chat_id": map[string]any{"type": "string", "description": "会话 id"},
					"pin":     map[string]any{"type": "boolean", "description": "true 置顶，false 取消，默认 true"},
				},
				"required": []string{"chat_id"},
			},
		},
		{
			Name:        "archive_chat",
			Description: "归档会话（从默认列表移走，可用 list_chats filter=archived 查看）。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"chat_id": map[string]any{"type": "string", "description": "会话 id"},
				},
				"required": []string{"chat_id"},
			},
		},
		{
			Name: "delete_chat",
			Description: "删除会话。**不可恢复**，会连同消息一起删掉。" +
				"建议先 get_chat 确认 id 再删。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"chat_id": map[string]any{"type": "string", "description": "会话 id"},
					"confirm": map[string]any{
						"type":        "boolean",
						"description": "必须显式传 true 才会真的删除",
					},
				},
				"required": []string{"chat_id", "confirm"},
			},
		},
	}
}

func (d Deps) listModelsContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()

	models, err := d.Client.ListModels(ctx)
	if err != nil {
		return errResult(err), nil
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "可用模型 %d 个：\n", len(models))
	for _, m := range models {
		id, _ := m["id"].(string)
		mark := ""
		if id == d.Client.Model() {
			mark = "  ← 当前使用"
		}
		fmt.Fprintf(&sb, "- %s%s\n", id, mark)
	}
	return textResult(sb.String()), nil
}

func (d Deps) renameChatContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	var a struct {
		ChatID string `json:"chat_id"`
		Title  string `json:"title"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, &RPCError{Code: CodeInvalidParams, Message: err.Error()}
	}
	if a.ChatID == "" || strings.TrimSpace(a.Title) == "" {
		return nil, &RPCError{Code: CodeInvalidParams, Message: "chat_id 和 title 均为必填"}
	}

	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()

	if err := d.Client.WithChatMutation(ctx, a.ChatID, func() error { return d.Client.RenameChat(ctx, a.ChatID, a.Title) }); err != nil {
		return errResult(err), nil
	}
	return textResult(fmt.Sprintf("已改名为：%s", a.Title)), nil
}

func (d Deps) pinChatContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	var a struct {
		ChatID string `json:"chat_id"`
		Pin    *bool  `json:"pin"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, &RPCError{Code: CodeInvalidParams, Message: err.Error()}
	}
	if a.ChatID == "" {
		return nil, &RPCError{Code: CodeInvalidParams, Message: "缺少 chat_id"}
	}
	pin := true
	if a.Pin != nil {
		pin = *a.Pin
	}

	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()

	if err := d.Client.WithChatMutation(ctx, a.ChatID, func() error { return d.Client.PinChat(ctx, a.ChatID, pin) }); err != nil {
		return errResult(err), nil
	}
	if pin {
		return textResult("已置顶"), nil
	}
	return textResult("已取消置顶"), nil
}

func (d Deps) archiveChatContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	var a struct {
		ChatID string `json:"chat_id"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, &RPCError{Code: CodeInvalidParams, Message: err.Error()}
	}
	if a.ChatID == "" {
		return nil, &RPCError{Code: CodeInvalidParams, Message: "缺少 chat_id"}
	}

	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()

	if err := d.Client.WithChatMutation(ctx, a.ChatID, func() error { return d.Client.ArchiveChat(ctx, a.ChatID) }); err != nil {
		return errResult(err), nil
	}
	return textResult("已归档"), nil
}

func (d Deps) deleteChatContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	var a struct {
		ChatID  string `json:"chat_id"`
		Confirm bool   `json:"confirm"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, &RPCError{Code: CodeInvalidParams, Message: err.Error()}
	}
	if a.ChatID == "" {
		return nil, &RPCError{Code: CodeInvalidParams, Message: "缺少 chat_id"}
	}
	// 删除不可恢复，强制要求显式确认，避免模型手滑
	if !a.Confirm {
		return textResult("没有删除：需要传 confirm=true 才执行。请先用 get_chat 确认这是要删的会话。"), nil
	}

	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()

	// 先读一次拿到标题，方便回显删了什么
	title := ""
	if detail, err := d.Client.GetChat(ctx, a.ChatID); err == nil {
		title = detail.Title
	}

	if err := d.Client.WithChatMutation(ctx, a.ChatID, func() error { return d.Client.DeleteChat(ctx, a.ChatID) }); err != nil {
		return errResult(err), nil
	}
	if title != "" {
		return textResult(fmt.Sprintf("已删除会话「%s」（%s）", title, a.ChatID)), nil
	}
	return textResult("已删除会话 " + a.ChatID), nil
}
