// Package zai 封装 chat.z.ai 的网页端 API。
//
// 读：纯 HTTP，无需验证码。
//
//	GET  /api/v1/chats
//	GET  /api/v1/chats/{id}
//	POST /api/v1/chats/{id}/messages/batch
//
// 写：POST /api/v2/chat/completions（SSE），服务端要求阿里云验证码
// captcha_verify_param；token 由本地的 Node sidecar（happy-dom 模拟
// 浏览器）解出，全程不启动真实浏览器。
package zai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/local/zai-bridge/internal/config"
)

// ErrCaptchaRequired 表示服务端要求验证码，调用方应补上后再试。
var ErrCaptchaRequired = errors.New("captcha required")

// ErrChatNotFound 表示会话不存在，或已被服务端回收。
// 空历史的草稿会话不会真正落库，拿它的 id 再读就会 404。
var ErrChatNotFound = errors.New("会话不存在")

// Client 是 chat.z.ai 的 HTTP 客户端。
type Client struct {
	cfg     config.Config
	http    *http.Client
	captcha captchaProvider
	limiter *limiter
	// userID 从 token 解出的用户 id，缓存一份（拼指纹用）
	userID    string
	quota     quotaState
	mutation  *fifoLocks
	root      context.Context
	cancel    context.CancelFunc
	trackerMu sync.Mutex
	trackers  sync.WaitGroup
	closed    bool
	dispatch  *DispatchGate
	pending   map[string]string
	drafts    map[string]*userMsg
}

// New 构造客户端。
func New(cfg config.Config) *Client {
	root, cancel := context.WithCancel(context.Background())
	userID := ""
	if claims, ok := decodeJWTPayload(cfg.Token); ok {
		userID, _ = claims["id"].(string)
	}
	if cfg.Model == "" {
		cfg.Model = config.DefaultModel
	}
	if cfg.MaxConcurrency <= 0 {
		cfg.MaxConcurrency = 1
	}
	return &Client{
		root: root, cancel: cancel, userID: userID, mutation: newFIFOLocks(),
		dispatch: NewDispatchGate(time.Duration(sendInterval(cfg)) * time.Second),
		pending:  map[string]string{},
		drafts:   map[string]*userMsg{},
		cfg:      cfg,
		limiter:  newLimiter(time.Duration(sendInterval(cfg))*time.Second, cfg.MaxConcurrency),
		http: &http.Client{
			// SSE lifetime is controlled by the caller context, not a fixed 120s timer.
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) > 0 && req.URL.Host != via[0].URL.Host {
					return fmt.Errorf("拒绝跨域认证重定向")
				}
				if len(via) >= 5 {
					return fmt.Errorf("重定向过多")
				}
				return nil
			},
			Transport: &http.Transport{
				MaxIdleConns:        16,
				MaxIdleConnsPerHost: 8,
				IdleConnTimeout:     90 * time.Second,
			},
		},
	}
}

// sendInterval 取配置的发送最小间隔，默认 8 秒。
func sendInterval(cfg config.Config) int {
	if cfg.SendIntervalSeconds >= 0 {
		return cfg.SendIntervalSeconds
	}
	return 8
}

func (c *Client) baseURL() string {
	if c.cfg.BaseURL == "" {
		return config.DefaultBaseURL
	}
	return strings.TrimRight(c.cfg.BaseURL, "/")
}

// headers 构造统一请求头。服务端会校验 origin/referer/UA 等浏览器指纹，
// 缺了容易被风控拦下。
func (c *Client) headers(chatID string) map[string]string {
	h := map[string]string{
		"authorization":         "Bearer " + c.cfg.Token,
		"content-type":          "application/json",
		"accept":                "application/json",
		"x-kl-kfa-ajax-request": "Ajax_Request",
		"x-region":              c.cfg.Region,
		"origin":                c.baseURL(),
		"x-fe-version":          "prod-fe-1.2.8",
		"user-agent":            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:160.0) Gecko/20100101 Firefox/160.0",
		"accept-language":       "zh-CN,zh;q=0.9,en;q=0.8",
	}
	if chatID != "" {
		h["referer"] = c.baseURL() + "/c/" + chatID
	}
	if c.cfg.Cookie != "" {
		h["cookie"] = c.cfg.Cookie
	}
	return h
}

func (c *Client) doJSON(ctx context.Context, method, path string, body any, out any) error {
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL()+path, rdr)
	if err != nil {
		return err
	}
	for k, v := range c.headers("") {
		req.Header.Set(k, v)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("请求 %s 失败: %s", path, c.redact(err.Error()))
	}
	defer resp.Body.Close()
	raw, err := readBounded(resp.Body, maxJSONResponse)
	if err != nil {
		return err
	}
	if resp.StatusCode == http.StatusNotFound && strings.HasPrefix(path, "/api/v1/chats/") {
		return ErrChatNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &HTTPError{Status: resp.StatusCode, Path: path, Detail: c.redact(truncate(string(raw), 400))}
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("解析 %s 响应失败: %w (body: %s)", path, err, c.redact(truncate(string(raw), 300)))
	}
	return nil
}

// ListChats 返回全部会话。
func (c *Client) ListChats(ctx context.Context) ([]ChatSummary, error) {
	var out []ChatSummary
	if err := c.doJSON(ctx, http.MethodGet, "/api/v1/chats", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// SearchChats 按标题/正文关键词搜索会话。
func (c *Client) SearchChats(ctx context.Context, text string, page int) ([]ChatSummary, error) {
	if page <= 0 {
		page = 1
	}
	q := url.Values{}
	q.Set("text", text)
	q.Set("page", fmt.Sprint(page))
	var out []ChatSummary
	if err := c.doJSON(ctx, http.MethodGet, "/api/v1/chats/search?"+q.Encode(), nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ArchivedChats 返回已归档的会话。
func (c *Client) ArchivedChats(ctx context.Context) ([]ChatSummary, error) {
	var out []ChatSummary
	if err := c.doJSON(ctx, http.MethodGet, "/api/v1/chats/archived", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// PinnedChats 返回已置顶的会话。
func (c *Client) PinnedChats(ctx context.Context) ([]ChatSummary, error) {
	var out []ChatSummary
	if err := c.doJSON(ctx, http.MethodGet, "/api/v1/chats/pinned", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// AllTags 返回账户下用到的全部标签。
func (c *Client) AllTags(ctx context.Context) ([]string, error) {
	var out []string
	if err := c.doJSON(ctx, http.MethodGet, "/api/v1/chats/all/tags", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetChat 取单个会话（含消息树结构）。
func (c *Client) GetChat(ctx context.Context, chatID string) (*ChatDetail, error) {
	var out ChatDetail
	if err := c.doJSON(ctx, http.MethodGet, "/api/v1/chats/"+chatID, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListModels 返回可用模型列表。
func (c *Client) ListModels(ctx context.Context) ([]map[string]any, error) {
	var out struct {
		Data []map[string]any `json:"data"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/api/models", nil, &out); err != nil {
		return nil, err
	}
	return out.Data, nil
}

// GetModelItem 取模型对象（/api/models 里的一项）。
// 前端会把整个对象作为 model_item 放进 completions 请求体。
func (c *Client) GetModelItem(ctx context.Context, modelID string) (map[string]any, error) {
	var out struct {
		Data []map[string]any `json:"data"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/api/models", nil, &out); err != nil {
		return nil, err
	}
	for _, m := range out.Data {
		if id, _ := m["id"].(string); id == modelID {
			return m, nil
		}
	}
	return nil, fmt.Errorf("模型 %s 不在可用列表里", modelID)
}

// GetChatRaw 取会话原始 chat 对象（map 形式），用于回写时保留未知字段。
func (c *Client) GetChatRaw(ctx context.Context, chatID string) (map[string]any, error) {
	var out struct {
		Chat map[string]any `json:"chat"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/api/v1/chats/"+chatID, nil, &out); err != nil {
		return nil, err
	}
	if out.Chat == nil {
		return nil, fmt.Errorf("会话 %s 返回的 chat 为空", chatID)
	}
	return out.Chat, nil
}

// SaveChat 回写整个 chat 对象。前端在「新建会话」和「追加一条消息」后都会调用它，
// 否则服务端 history 里没有这条用户消息，completions 会返回 INTERNAL_ERROR。
func (c *Client) SaveChat(ctx context.Context, chatID string, chat map[string]any) error {
	return c.doJSON(ctx, http.MethodPost, "/api/v1/chats/"+chatID, map[string]any{"chat": chat}, nil)
}

// CreateChat 新建会话。
//
// message 非空时把首条用户消息一起写进 history：服务端只认 history 里节点自带的
// content，所以只建空会话的话，之后再发消息模型会收到空内容。
func (c *Client) CreateChat(ctx context.Context, title, message string) (string, error) {
	if strings.TrimSpace(title) == "" {
		title = "New Chat"
	}
	chatID := uuid.NewString()
	now := time.Now().Unix()

	msgs := map[string]any{}
	currentID := ""
	var draft *userMsg
	if strings.TrimSpace(message) != "" {
		uID, aID := uuid.NewString(), uuid.NewString()
		msgs[uID] = map[string]any{
			"id": uID, "parentId": nil, "childrenIds": []any{aID},
			"role": "user", "timestamp": now,
			"content": message, "models": []string{c.cfg.Model},
		}
		msgs[aID] = map[string]any{
			"id": aID, "parentId": uID, "childrenIds": []any{},
			"role": "assistant", "timestamp": now, "done": false, "bridge_draft": true,
		}
		currentID = aID
		draft = &userMsg{UserID: uID, AssistantID: aID}
	}

	chat := map[string]any{
		"id": chatID, "title": title,
		"models": []string{c.cfg.Model}, "params": map[string]any{},
		"history": map[string]any{"messages": msgs, "currentId": currentID},
		"tags":    []any{}, "flags": []string{"general_agent"}, "features": []any{},
		"mcp_servers": []any{}, "enable_thinking": true, "reasoning_effort": "high",
		"auto_web_search": false, "message_version": 1, "extra": map[string]any{},
		"timestamp": now, "type": "general_agent",
	}

	var out struct {
		Chat struct {
			ID string `json:"id"`
		} `json:"chat"`
	}
	if err := c.doJSON(ctx, http.MethodPost, "/api/v1/chats/new", map[string]any{"chat": chat}, &out); err != nil {
		return "", err
	}
	if out.Chat.ID == "" {
		return "", fmt.Errorf("新建会话返回的 id 为空")
	}
	if draft != nil {
		c.setDraft(out.Chat.ID, draft)
	}
	return out.Chat.ID, nil
}

// RenameChat 修改会话标题。
// 走的是回写整个 chat 的接口，所以只改 title 一个字段，其余原样带回去。
func (c *Client) RenameChat(ctx context.Context, chatID, title string) error {
	chat, err := c.GetChatRaw(ctx, chatID)
	if err != nil {
		return err
	}
	chat["title"] = title
	return c.SaveChat(ctx, chatID, chat)
}

// DeleteChat 删除会话（不可恢复）。
func (c *Client) DeleteChat(ctx context.Context, chatID string) error {
	return c.doJSON(ctx, http.MethodDelete, "/api/v1/chats/"+chatID, nil, nil)
}

// PinChat 置顶 / 取消置顶会话。
func (c *Client) PinChat(ctx context.Context, chatID string, pin bool) error {
	// Frontend pin endpoint toggles via POST; read first for idempotent pin/unpin.
	detail, err := c.GetChat(ctx, chatID)
	if err != nil {
		return err
	}
	if detail.Pinned == pin {
		return nil
	}
	return c.doJSON(ctx, http.MethodPost, "/api/v1/chats/"+chatID+"/pin", nil, nil)
}

// ArchiveChat 归档会话。
func (c *Client) ArchiveChat(ctx context.Context, chatID string) error {
	detail, err := c.GetChat(ctx, chatID)
	if err != nil {
		return err
	}
	if detail.Archived {
		return nil
	}
	return c.doJSON(ctx, http.MethodPost, "/api/v1/chats/"+chatID+"/archive", nil, nil)
}

// Branch 返回从根到当前叶子的消息节点序列。
func (d *ChatDetail) Branch() []TreeNode {
	var chain []TreeNode
	id := d.Chat.History.CurrentID
	seen := map[string]bool{}
	for id != "" && !seen[id] {
		n, ok := d.Chat.History.Messages[id]
		if !ok {
			break
		}
		seen[id] = true
		chain = append(chain, n)
		if n.ParentID == nil || *n.ParentID == "" {
			break
		}
		id = *n.ParentID
	}
	// 反转为时间顺序
	for i, j := 0, len(chain)-1; i < j; i, j = i+1, j-1 {
		chain[i], chain[j] = chain[j], chain[i]
	}
	return chain
}

// BranchTo 返回从根到指定节点的路径（时间顺序）。
// 用来查看「重新生成」产生的其它分支：currentId 只指向当前选中的那条，
// 想看兄弟分支就得从那个节点往上走。
func (d *ChatDetail) BranchTo(leafID string) []TreeNode {
	var chain []TreeNode
	id := leafID
	seen := map[string]bool{}
	for id != "" && !seen[id] {
		n, ok := d.Chat.History.Messages[id]
		if !ok {
			break
		}
		seen[id] = true
		chain = append(chain, n)
		if n.ParentID == nil || *n.ParentID == "" {
			break
		}
		id = *n.ParentID
	}
	for i, j := 0, len(chain)-1; i < j; i, j = i+1, j-1 {
		chain[i], chain[j] = chain[j], chain[i]
	}
	return chain
}

// ForkPoints 找出所有分叉点（childrenIds 多于 1 个的节点）。
// 每个分叉点意味着这里生成过多个候选回复。
func (d *ChatDetail) ForkPoints() []TreeNode {
	var out []TreeNode
	for _, n := range d.Chat.History.Messages {
		if len(n.ChildrenIDs) > 1 {
			out = append(out, n)
		}
	}
	return out
}

// HistoryTo 返回从根到 leafID 的消息全文。
func (c *Client) HistoryTo(ctx context.Context, chatID, leafID string, limit int) ([]Message, error) {
	detail, err := c.GetChat(ctx, chatID)
	if err != nil {
		return nil, err
	}
	if leafID == "" {
		leafID = detail.Chat.History.CurrentID
	}
	branch := detail.BranchTo(leafID)
	if len(branch) == 0 {
		if leafID == "" {
			return []Message{}, nil
		}
		return nil, fmt.Errorf("找不到消息节点 %s", leafID)
	}
	if limit > 0 && len(branch) > limit {
		branch = branch[len(branch)-limit:]
	}
	ids := make([]string, 0, len(branch))
	for _, n := range branch {
		ids = append(ids, n.ID)
	}
	msgs, err := c.GetMessages(ctx, chatID, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]Message, len(msgs))
	for _, m := range msgs {
		byID[m.ID] = m
	}
	ordered := make([]Message, 0, len(ids))
	for _, id := range ids {
		if m, ok := byID[id]; ok {
			ordered = append(ordered, m)
		}
	}
	return ordered, nil
}

// GetMessages 批量取消息全文。
func (c *Client) GetMessages(ctx context.Context, chatID string, ids []string) ([]Message, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	if len(ids) > 2048 {
		return nil, fmt.Errorf("消息历史超过2048条读取上限，请指定limit或leaf_id")
	}
	result := make([]Message, 0, len(ids))
	var totalBytes int
	for start := 0; start < len(ids); start += 100 {
		end := start + 100
		if end > len(ids) {
			end = len(ids)
		}
		var out struct {
			Data json.RawMessage `json:"data"`
		}
		if err := c.doJSON(ctx, http.MethodPost, "/api/v1/chats/"+chatID+"/messages/batch", map[string]any{"ids": ids[start:end]}, &out); err != nil {
			return nil, err
		}
		if len(out.Data) == 0 || string(out.Data) == "null" {
			return nil, fmt.Errorf("消息接口返回空data")
		}
		totalBytes += len(out.Data)
		if totalBytes > 32*1024*1024 {
			return nil, ErrResponseTooLarge
		}
		msgs, err := decodeMessages(out.Data)
		if err != nil {
			return nil, err
		}
		result = append(result, msgs...)
	}
	return result, nil
}

// decodeMessages 把 data 兼容成 []Message（服务端有时返回对象、有时返回数组）。
func decodeMessages(data any) ([]Message, error) {
	raw, ok := data.(json.RawMessage)
	if !ok {
		var err error
		raw, err = json.Marshal(data)
		if err != nil {
			return nil, err
		}
	}
	var asList []Message
	if err := json.Unmarshal(raw, &asList); err == nil {
		return asList, nil
	}
	var asMap map[string]Message
	if err := json.Unmarshal(raw, &asMap); err != nil {
		return nil, fmt.Errorf("无法解析消息列表: %w", err)
	}
	out := make([]Message, 0, len(asMap))
	for _, m := range asMap {
		out = append(out, m)
	}
	return out, nil
}

// History 返回当前分支的完整消息（按时间顺序）。
// limit > 0 时只取最后 limit 条。
func (c *Client) History(ctx context.Context, chatID string, limit int) ([]Message, error) {
	detail, err := c.GetChat(ctx, chatID)
	if err != nil {
		return nil, err
	}
	branch := detail.Branch()
	if limit > 0 && len(branch) > limit {
		branch = branch[len(branch)-limit:]
	}
	ids := make([]string, 0, len(branch))
	for _, n := range branch {
		ids = append(ids, n.ID)
	}
	msgs, err := c.GetMessages(ctx, chatID, ids)
	if err != nil {
		return nil, err
	}
	// 按 branch 顺序重排
	byID := make(map[string]Message, len(msgs))
	for _, m := range msgs {
		byID[m.ID] = m
	}
	ordered := make([]Message, 0, len(ids))
	for _, id := range ids {
		if m, ok := byID[id]; ok {
			ordered = append(ordered, m)
		}
	}
	return ordered, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
