package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/local/zai-bridge/internal/zai"
)

// Deps 是工具执行所需依赖。
type Deps struct {
	// Client 是当前账户的客户端。多账户模式下由 dispatch 按 account 参数切换。
	Client *zai.Client
	Model  string
	// Accounts 是多账户模式下「账户名 -> 客户端」的映射。单账户时为空。
	Accounts map[string]*zai.Client
	// DefaultAccount 是默认账户名。
	DefaultAccount string
	// Current 是本次调用实际使用的账户名（由 withAccount 填入）。
	Current string
}

// toolsBase 返回全部工具定义（未注入账户参数）。
func toolsBase() []ToolDef {
	return append([]ToolDef{
		{
			Name: "list_chats",
			Description: "列出 / 搜索 Z.ai 上的会话。" +
				"支持关键词搜索、只看已归档或已置顶；返回 id、标题、最近运行状态、更新时间。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"limit":  map[string]any{"type": "integer", "description": "最多返回多少条，默认 30"},
					"search": map[string]any{"type": "string", "description": "按关键词搜索标题与内容"},
					"filter": map[string]any{
						"type":        "string",
						"enum":        []string{"all", "archived", "pinned"},
						"description": "all=全部（默认），archived=只看已归档，pinned=只看已置顶",
					},
				},
			},
		},
		{
			Name:        "list_tags",
			Description: "列出账户下所有会话标签（用于给会话分类/筛选）。",
			InputSchema: map[string]any{"type": "object", "properties": map[string]any{}},
		},
		{
			Name: "get_chat",
			Description: "查看单个会话的摘要信息：标题、模型、消息条数、" +
				"以及云端 agent 当前是否仍在运行。适合在不拉全文的情况下先探一下状态。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"chat_id": map[string]any{"type": "string", "description": "会话 id"},
				},
				"required": []string{"chat_id"},
			},
		},
		{
			Name: "get_messages",
			Description: "拉取会话当前分支的消息内容（按时间正序）。" +
				"每条消息包含：role、正文 text、思考过程 reasoning、以及工具调用 tool_calls" +
				"（含执行的命令参数和返回结果）。这是查看云端 agent 工作成果的主要方式。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"chat_id":    map[string]any{"type": "string", "description": "会话 id"},
					"limit":      map[string]any{"type": "integer", "description": "只返回最后 N 条，默认 20，0 表示全部"},
					"since_id":   map[string]any{"type": "string", "description": "只返回该消息 id 之后的内容（用于增量拉取）"},
					"leaf_id":    map[string]any{"type": "string", "description": "沿这条消息所在的分支取，默认跟随 currentId。用 get_chat 看分叉点"},
					"reasoning":  map[string]any{"type": "boolean", "description": "是否包含思考过程，默认 false"},
					"tool_calls": map[string]any{"type": "boolean", "description": "是否包含工具调用详情，默认 true"},
					"max_chars":  map[string]any{"type": "integer", "description": "单条消息最大字符数，默认 4000，0 表示不限"},
				},
				"required": []string{"chat_id"},
			},
		},
		{
			Name: "create_chat",
			Description: "新建一个 Z.ai 会话（agent 模式）。" +
				"可选写入首条草稿；用 send_message 传同一内容实际提交，不会自动生成。" +
				"注意：不指定 message 时创建的是空会话，模型的上下文里不会有任何历史内容。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title":   map[string]any{"type": "string", "description": "会话标题，默认 New Chat"},
					"message": map[string]any{"type": "string", "description": "首条用户消息（可选）"},
				},
			},
		},
		{
			Name: "send_message",
			Description: "向 Z.ai 会话发送一条用户消息，让云端 agent 继续工作。" +
				"默认会等待 agent 开始回复并返回首段内容；配合 wait_for_reply 可拿到完整结果。" +
				"验证码会在提交前求解；未知受理或断流会保留 message_id，不能盲目重发。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"chat_id": map[string]any{"type": "string", "description": "会话 id"},
					"message": map[string]any{"type": "string", "description": "要发送的内容"},
					"wait":    map[string]any{"type": "boolean", "description": "是否阻塞等待完整回复，默认 true"},
					"timeout_seconds": map[string]any{"type": "integer",
						"description": "等待超时秒数，默认 600"},
					"attempts": map[string]any{"type": "integer",
						"description": "兼容参数，默认 1。受理后或受理状态未知不会重新提交；请使用返回的 message_id 查询原请求"},
				},
				"required": []string{"chat_id", "message"},
			},
		},
		{
			Name: "wait_for_reply",
			Description: "等待指定会话出现新的助手消息。适合 send_message 用 wait=false 之后，" +
				"或者监控一个正在运行的云端 agent。返回新消息内容。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"chat_id":          map[string]any{"type": "string", "description": "会话 id"},
					"after_message_id": map[string]any{"type": "string", "description": "等待这条消息及后续输出，可填写 send_message 返回的 message_id"},
					"message_id":       map[string]any{"type": "string", "description": "恢复原发送的稳定助手消息 id，与 after_message_id 二选一"},
					"timeout_seconds":  map[string]any{"type": "integer", "description": "最长等待秒数，默认 300"},
					"poll_ms":          map[string]any{"type": "integer", "description": "轮询间隔毫秒，默认 3000"},
				},
				"required": []string{"chat_id"},
			},
		},
	}, append(append(extraTools(), chatFileTools()...), manageTools()...)...)
}

// Tools 返回对外的工具定义列表。
// 多账户时给每个工具补上 account 参数，并额外提供 list_accounts。
func Tools() []ToolDef {
	tools := toolsBase()
	return tools
}

// ToolsFor 按账户情况生成工具列表。
func ToolsFor(names []string, def string) []ToolDef {
	tools := toolsBase()
	if len(names) > 0 {
		tools = append(tools, ToolDef{
			Name:        "list_accounts",
			Description: "列出已配置的账户及其默认项。多账户之间会话、沙盒、云盘、记忆互不共享。",
			InputSchema: map[string]any{"type": "object", "properties": map[string]any{}},
		})
		injectAccountParam(tools, names, def)
	}
	return tools
}

// RegisterTools 把所有工具注册到 MCP server。
func RegisterTools(s *Server, deps Deps) {
	// Capture a private immutable registry snapshot, never assign call state back.
	baseDeps := deps
	if deps.Accounts != nil {
		baseDeps.Accounts = make(map[string]*zai.Client, len(deps.Accounts))
		for name, client := range deps.Accounts {
			baseDeps.Accounts[name] = client
		}
	}
	s.Register("tools/list", func(json.RawMessage) (any, *RPCError) {
		return map[string]any{"tools": ToolsFor(baseDeps.AccountNames(), baseDeps.DefaultAccount)}, nil
	})
	s.RegisterContext("tools/call", func(ctx context.Context, params json.RawMessage) (any, *RPCError) {
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, &RPCError{Code: CodeInvalidParams, Message: err.Error()}
		}
		if len(p.Arguments) == 0 {
			p.Arguments = json.RawMessage("{}")
		}
		if rerr := validateArguments(p.Arguments); rerr != nil {
			return nil, rerr
		}
		callDeps, err := baseDeps.withAccount(peekAccount(p.Arguments))
		if err != nil {
			return errResult(err), nil
		}
		switch p.Name {
		case "list_accounts":
			return callDeps.listAccountsContext(ctx, p.Arguments)
		case "list_chats":
			return callDeps.listChatsContext(ctx, p.Arguments)
		case "list_tags":
			return callDeps.listTagsContext(ctx, p.Arguments)
		case "list_models":
			return callDeps.listModelsContext(ctx, p.Arguments)
		case "rename_chat":
			return callDeps.renameChatContext(ctx, p.Arguments)
		case "pin_chat":
			return callDeps.pinChatContext(ctx, p.Arguments)
		case "archive_chat":
			return callDeps.archiveChatContext(ctx, p.Arguments)
		case "delete_chat":
			return callDeps.deleteChatContext(ctx, p.Arguments)
		case "get_chat":
			return callDeps.getChatContext(ctx, p.Arguments)
		case "get_messages":
			return callDeps.getMessagesContext(ctx, p.Arguments)
		case "create_chat":
			return callDeps.createChatContext(ctx, p.Arguments)
		case "send_message":
			return callDeps.sendMessageContext(ctx, p.Arguments)
		case "wait_for_reply":
			return callDeps.waitForReplyContext(ctx, p.Arguments)
		case "get_usage":
			return callDeps.getUsageContext(ctx, p.Arguments)
		case "list_files":
			return callDeps.listFilesContext(ctx, p.Arguments)
		case "download_file":
			return callDeps.downloadFileContext(ctx, p.Arguments)
		case "upload_file":
			return callDeps.uploadFileContext(ctx, p.Arguments)
		case "delete_file":
			return callDeps.deleteFileContext(ctx, p.Arguments)
		case "list_chat_files":
			return callDeps.listChatFilesContext(ctx, p.Arguments)
		case "download_chat_file":
			return callDeps.downloadChatFileContext(ctx, p.Arguments)
		default:
			return nil, &RPCError{Code: CodeInvalidParams, Message: "未知工具: " + p.Name}
		}
	})
}

func textResult(s string) *CallToolResult {
	return &CallToolResult{Content: []TextContent{{Type: "text", Text: s}}}
}

func errResult(err error) *CallToolResult {
	return &CallToolResult{
		Content: []TextContent{{Type: "text", Text: "错误: " + err.Error()}},
		IsError: true,
	}
}

// chatRunState 判断会话当前是否在生成。
// 列表接口带 last_run，详情接口不带，所以详情要退化成看最后一条助手消息。
func (d Deps) chatRunState(ctx context.Context, chatID string, detail *zai.ChatDetail, branch []zai.TreeNode) string {
	if detail.LastRun != nil {
		return runStateText(detail.LastRun)
	}
	for i := len(branch) - 1; i >= 0; i-- {
		if branch[i].Role != "assistant" {
			continue
		}
		msgs, err := d.Client.GetMessages(ctx, chatID, []string{branch[i].ID})
		if err != nil || len(msgs) == 0 {
			return "无运行记录"
		}
		if msgs[0].Done {
			return "空闲（最后一轮已完成）"
		}
		return "进行中"
	}
	return "无运行记录"
}

// runStateText 把 last_run.status 翻译成中文。
// 注意：不能用 im_context.status——它恒为 active，判断不了是否在跑。
func runStateText(r *zai.LastRun) string {
	if r == nil || r.Status == "" {
		return "无运行记录"
	}
	switch r.Status {
	case "running", "pending", "in_progress":
		return "运行中（" + r.Status + "）"
	case "completed":
		return "已完成"
	case "failed", "error":
		return "失败"
	default:
		return r.Status
	}
}

func (d Deps) listChatsContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	var a struct {
		Limit  int    `json:"limit"`
		Search string `json:"search"`
		Filter string `json:"filter"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, &RPCError{Code: CodeInvalidParams, Message: err.Error()}
	}
	a.Limit = defaultInt(raw, "limit", 30)

	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()

	var (
		chats []zai.ChatSummary
		err   error
	)
	switch {
	case a.Search != "":
		chats, err = d.Client.SearchChats(ctx, a.Search, 1)
	case a.Filter == "archived":
		chats, err = d.Client.ArchivedChats(ctx)
	case a.Filter == "pinned":
		chats, err = d.Client.PinnedChats(ctx)
	default:
		chats, err = d.Client.ListChats(ctx)
	}
	if err != nil {
		return errResult(err), nil
	}
	if a.Limit > 0 && len(chats) > a.Limit {
		chats = chats[:a.Limit]
	}

	// 标题按来源说明，避免用户以为搜出来的就是全部
	var sb strings.Builder
	switch {
	case a.Search != "":
		fmt.Fprintf(&sb, "搜索「%s」：%d 个会话\n", a.Search, len(chats))
	case a.Filter == "archived":
		fmt.Fprintf(&sb, "已归档：%d 个会话\n", len(chats))
	case a.Filter == "pinned":
		fmt.Fprintf(&sb, "已置顶：%d 个会话\n", len(chats))
	default:
		fmt.Fprintf(&sb, "共 %d 个会话：\n", len(chats))
	}
	for _, c := range chats {
		// 搜索接口的 last_run 恒为 null，拿不到运行状态时就不瞎猜，
		// 直接不显示这一行，避免和列表结果自相矛盾。
		runState := runStateText(c.LastRun)
		title := c.Title
		if title == "" {
			title = "(无标题)"
		}
		updated := time.Unix(c.UpdatedAt, 0).Format("2006-01-02 15:04:05")
		if c.LastRun == nil {
			fmt.Fprintf(&sb, "- %s\n  id: %s\n  更新: %s\n", title, c.ID, updated)
		} else {
			fmt.Fprintf(&sb, "- %s\n  id: %s\n  agent运行: %s\n  更新: %s\n",
				title, c.ID, runState, updated)
		}
	}
	return textResult(sb.String()), nil
}

func (d Deps) getChatContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
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

	detail, err := d.Client.GetChat(ctx, a.ChatID)
	if err != nil {
		if errors.Is(err, zai.ErrChatNotFound) {
			return errResult(fmt.Errorf(
				"会话 %s 不存在。常见原因：\n"+
					"1. id 写错\n"+
					"2. 这是空历史的草稿会话，服务端没有真正落库（用 create_chat 建会话时带上 message 参数即可避免）\n"+
					"3. 会话已被删除", a.ChatID)), nil
		}
		return errResult(err), nil
	}
	branch := detail.Branch()

	var sb strings.Builder
	fmt.Fprintf(&sb, "标题: %s\n", detail.Title)
	fmt.Fprintf(&sb, "id: %s\n", detail.ID)
	fmt.Fprintf(&sb, "类型: %s\n", detail.Type)
	fmt.Fprintf(&sb, "模型: %s\n", strings.Join(detail.Chat.Models, ", "))
	fmt.Fprintf(&sb, "当前分支消息数: %d\n", len(branch))
	fmt.Fprintf(&sb, "最后更新: %s\n", time.Unix(detail.UpdatedAt, 0).Format("2006-01-02 15:04:05"))
	fmt.Fprintf(&sb, "运行状态: %s\n", d.chatRunState(ctx, a.ChatID, detail, branch))
	if detail.Meta.WorkspaceID != "" {
		fmt.Fprintf(&sb, "云沙箱 workspace: %s\n", detail.Meta.WorkspaceID)
	}

	// 分叉点：这里生成过多个候选回复，可以用 get_messages(leaf_id=...) 查看别的分支
	forks := detail.ForkPoints()
	if len(forks) > 0 {
		fmt.Fprintf(&sb, "\n分叉点 %d 处（重新生成产生的多个分支）：\n", len(forks))
		for _, f := range forks {
			fmt.Fprintf(&sb, "- %s（%s）下有 %d 个分支\n", f.ID, f.Role, len(f.ChildrenIDs))
			for _, c := range f.ChildrenIDs {
				fmt.Fprintf(&sb, "    · %s\n", c)
			}
		}
	}
	return textResult(sb.String()), nil
}

func (d Deps) listTagsContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if rerr := validateArguments(raw); rerr != nil {
		return nil, rerr
	}
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()

	tags, err := d.Client.AllTags(ctx)
	if err != nil {
		return errResult(err), nil
	}
	if len(tags) == 0 {
		return textResult("还没有任何标签。"), nil
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "共 %d 个标签：\n", len(tags))
	for _, t := range tags {
		fmt.Fprintf(&sb, "- %s\n", t)
	}
	return textResult(sb.String()), nil
}
