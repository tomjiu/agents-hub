package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/local/zai-bridge/internal/zai"
)

// 多账户调度。
//
// 设计要点：账户之间完全独立（会话、沙盒、云盘、记忆都不共享），
// 因此每个账户各自维护自己的 client / 限流器 / 额度缓存。
// 验证码池则全局共享——它证明的是「请求来自真实浏览器」，与账户无关。
//
// account 参数在所有工具上统一处理：在 tools/call 分发前把 Deps.Client
// 换成目标账户的 client，各工具的实现完全不用感知多账户。

// withAccount 返回把 Client 换成指定账户的 Deps。
// name 为空时用默认账户。
func (d Deps) withAccount(name string) (Deps, error) {
	if len(d.Accounts) == 0 {
		if name = strings.TrimSpace(name); name != "" && name != d.DefaultAccount && name != "default" {
			return d, fmt.Errorf("未知账户 %q", name)
		}
		return d, nil
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = d.DefaultAccount
	}
	c, ok := d.Accounts[name]
	if !ok {
		return d, fmt.Errorf("未知账户 %q，可用：%s", name, strings.Join(d.AccountNames(), ", "))
	}
	out := d
	out.Client = c
	out.Current = name
	return out, nil
}

// AccountNames 返回排好序的账户名。
func (d Deps) AccountNames() []string {
	names := make([]string, 0, len(d.Accounts))
	for n := range d.Accounts {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

// peekAccount 从工具参数里取 account 字段。
// 各工具会忽略这个字段，所以不影响它们自己的参数解析。
func peekAccount(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var probe struct {
		Account string `json:"account"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return ""
	}
	return probe.Account
}

// accountSchema 是注入到每个工具里的 account 参数。
func accountSchema(names []string, def string) map[string]any {
	desc := "指定账户"
	if def != "" {
		desc = fmt.Sprintf("指定账户，默认 %s", def)
	}
	if len(names) > 0 {
		desc += "；可用：" + strings.Join(names, ", ")
	}
	return map[string]any{
		"type":        "string",
		"description": desc,
	}
}

// injectAccountParam 给所有工具补上 account 参数（多账户模式才加）。
func injectAccountParam(tools []ToolDef, names []string, def string) {
	if len(names) == 0 {
		return
	}
	for i := range tools {
		props, ok := tools[i].InputSchema["properties"].(map[string]any)
		if !ok {
			props = map[string]any{}
			tools[i].InputSchema["properties"] = props
		}
		props["account"] = accountSchema(names, def)
	}
}

func (d Deps) listAccountsContext(parent context.Context, raw json.RawMessage) (any, *RPCError) {
	if len(d.Accounts) == 0 {
		return textResult("当前是单账户模式（未配置 accounts.json）。"), nil
	}
	names := d.AccountNames()
	var sb strings.Builder
	fmt.Fprintf(&sb, "共 %d 个账户：\n", len(names))
	for _, n := range names {
		mark := ""
		if n == d.DefaultAccount {
			mark = "  ← 默认"
		}
		fmt.Fprintf(&sb, "- %s%s\n", n, mark)
	}
	return textResult(sb.String()), nil
}

var _ = zai.Client{}
