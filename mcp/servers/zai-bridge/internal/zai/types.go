package zai

import "encoding/json"

// Chat 是会话列表项（GET /api/v1/chats）
type ChatSummary struct {
	ID        string     `json:"id"`
	Title     string     `json:"title"`
	UpdatedAt int64      `json:"updated_at"`
	CreatedAt int64      `json:"created_at"`
	Type      string     `json:"type"`
	ProjectID *string    `json:"project_id"`
	IMContext *IMContext `json:"im_context,omitempty"`
	// LastRun 是最近一次运行的状态，这才是「agent 是否还在跑」的可靠来源。
	// 注意 im_context.status 恒为 active，不能用它判断。
	LastRun *LastRun `json:"last_run,omitempty"`
}

// LastRun 是会话最近一次运行。
type LastRun struct {
	MessageID string `json:"message_id"`
	Status    string `json:"status"`
	StartedAt int64  `json:"started_at"`
	UpdatedAt int64  `json:"updated_at"`
}

// IMContext 携带会话运行状态
type IMContext struct {
	SessionID       string          `json:"session_id"`
	SessionName     string          `json:"session_name"`
	Channel         string          `json:"channel"`
	Type            string          `json:"type"`
	Model           string          `json:"model"`
	Status          string          `json:"status"`
	ChannelMetadata json.RawMessage `json:"channel_metadata,omitempty"`
	ZaiUserID       string          `json:"zai_user_id"`
}

// ChatDetail 是单个会话全文（GET /api/v1/chats/{id}）
type ChatDetail struct {
	Pinned    bool       `json:"pinned"`
	Archived  bool       `json:"archived"`
	ID        string     `json:"id"`
	Title     string     `json:"title"`
	Type      string     `json:"type"`
	UpdatedAt int64      `json:"updated_at"`
	CreatedAt int64      `json:"created_at"`
	Meta      ChatMeta   `json:"meta"`
	Chat      ChatBody   `json:"chat"`
	IMContext *IMContext `json:"im_context,omitempty"`
	LastRun   *LastRun   `json:"last_run,omitempty"`
}

type ChatMeta struct {
	Models      []string `json:"models"`
	Flags       []string `json:"flags"`
	WorkspaceID string   `json:"workspace_id"`
	MCPServers  []any    `json:"mcp_servers"`
}

type ChatBody struct {
	ID      string         `json:"id"`
	Models  []string       `json:"models"`
	Params  map[string]any `json:"params"`
	History ChatHistory    `json:"history"`
	// features 在不同版本里可能是对象或数组，用 RawMessage 兜住
	Features json.RawMessage `json:"features,omitempty"`
}

type ChatHistory struct {
	Messages  map[string]TreeNode `json:"messages"`
	CurrentID string              `json:"currentId"`
}

// TreeNode 是消息树的一个节点（只有结构，不含内容）
type TreeNode struct {
	ID          string   `json:"id"`
	ParentID    *string  `json:"parentId"`
	ChildrenIDs []string `json:"childrenIds"`
	Role        string   `json:"role"`
	Timestamp   int64    `json:"timestamp"`
	Draft       bool     `json:"bridge_draft,omitempty"`
}

// Message 是 messages/batch 返回的完整消息
type Message struct {
	ID            string          `json:"id"`
	ChatID        string          `json:"chat_id"`
	UserID        string          `json:"user_id"`
	ParentID      *string         `json:"parent_id"`
	ChildrenIDs   []string        `json:"childrenIds"`
	Role          string          `json:"role"`
	Content       *string         `json:"content"`
	ContentBlocks []ContentBlock  `json:"content_blocks"`
	Files         json.RawMessage `json:"files"`
	Usage         *Usage          `json:"usage"`
	Status        json.RawMessage `json:"status"`
	Done          bool            `json:"done"`
	Error         json.RawMessage `json:"error"`
	Model         string          `json:"model"`
	Timestamp     int64           `json:"timestamp"`
	CreatedAt     int64           `json:"created_at"`
	UpdatedAt     int64           `json:"updated_at"`
}

// ContentBlock 是消息内的结构化片段：reasoning / text / tool_calls
type ContentBlock struct {
	Type      string          `json:"type"`
	Content   json.RawMessage `json:"content"`
	StartedAt int64           `json:"started_at,omitempty"`
	EndedAt   int64           `json:"ended_at,omitempty"`
	Results   []ToolResult    `json:"results,omitempty"`
}

// ToolCall 是一次工具调用
type ToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"`
	Function ToolFunction `json:"function"`
}

type ToolFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

// ToolResult 是工具调用的返回
type ToolResult struct {
	ToolCallID string `json:"tool_call_id"`
	Content    string `json:"content"`
	Status     string `json:"status"`
}

// Usage 是 token 用量
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// StatusValue 把 status 归一化成字符串（服务端可能返回字符串、对象或 null）。
func (m *Message) StatusValue() string {
	if len(m.Status) == 0 || string(m.Status) == "null" {
		return ""
	}
	var s string
	if err := json.Unmarshal(m.Status, &s); err == nil {
		return s
	}
	var obj struct {
		Phase string `json:"phase"`
		State string `json:"state"`
		Code  string `json:"code"`
	}
	if err := json.Unmarshal(m.Status, &obj); err == nil {
		for _, v := range []string{obj.Phase, obj.State, obj.Code} {
			if v != "" {
				return v
			}
		}
	}
	return ""
}
