package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// 多账户支持。
//
// 账户之间完全独立：各自的 token、会话、沙盒、云盘、记忆都不共享。
// 这带来一个关键结论——排队只需要做到「同一个会话内串行」，
// 不同账户可以真正并行。而验证码求解是「证明请求来自真实浏览器」，
// 与登录的是哪个账户无关，所以全部账户共用一套验证码池。
//
// accounts.json 结构：
//
//	{
//	  "default": "work",
//	  "accounts": [
//	    {"name": "work", "token": "eyJ...", "max_concurrency": 1},
//	    {"name": "personal", "token": "eyJ...", "model": "glm-5.2"}
//	  ]
//	}

// AccountConfig 是单个账户。
type AccountConfig struct {
	// Name 是账户别名，MCP 工具的 account 参数用它。
	Name string `json:"name"`
	// Token 是该账户的 Bearer token。
	Token string `json:"token"`
	// Cookie 可选，带上可让风控更宽松。
	Cookie string `json:"cookie,omitempty"`
	// Model 可选，覆盖全局模型。
	Model string `json:"model,omitempty"`
	// Region 可选，覆盖 x-region。
	Region string `json:"region,omitempty"`
	// MaxConcurrency 是该账户的并发上限。
	// 免费账户服务端并发为 1；开通会员后放宽，这里跟着调高。
	MaxConcurrency    int `json:"max_concurrency,omitempty"`
	maxConcurrencySet bool
}

func (a *AccountConfig) UnmarshalJSON(raw []byte) error {
	type plain AccountConfig
	var parsed plain
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	_, parsed.maxConcurrencySet = fields["max_concurrency"]
	*a = AccountConfig(parsed)
	return nil
}

// accountsFile 是 accounts.json 的结构。
type accountsFile struct {
	Default  string          `json:"default"`
	Accounts []AccountConfig `json:"accounts"`
}

// AccountsPath 返回 accounts.json 的路径。
func AccountsPath() string {
	if v := os.Getenv("ZAI_ACCOUNTS_FILE"); v != "" {
		return v
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".zai-bridge", "accounts.json")
	}
	return "accounts.json"
}

// LoadAccounts 读取 accounts.json。
// 文件不存在时返回 (nil, nil)，交给上层回退到单 token 模式。
func LoadAccounts() ([]AccountConfig, string, error) {
	path := AccountsPath()
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) && os.Getenv("ZAI_ACCOUNTS_FILE") == "" {
			// 也看看工作目录下的 accounts.json，方便 Docker 挂载
			if alt, err2 := os.ReadFile("accounts.json"); err2 == nil {
				return parseAccounts(alt, "accounts.json")
			} else if !os.IsNotExist(err2) {
				return nil, "", fmt.Errorf("读取 accounts.json 失败: %w", err2)
			}
			return nil, "", nil
		}
		return nil, "", fmt.Errorf("读取 %s 失败: %w", path, err)
	}
	return parseAccounts(raw, path)
}

func parseAccounts(raw []byte, path string) ([]AccountConfig, string, error) {
	var f accountsFile
	if err := json.Unmarshal(raw, &f); err != nil {
		return nil, "", fmt.Errorf("解析 %s 失败: %w", path, err)
	}
	if len(f.Accounts) == 0 {
		return nil, "", fmt.Errorf("%s accounts 列表为空", path)
	}

	seen := map[string]bool{}
	identities := map[string]bool{}
	out := make([]AccountConfig, 0, len(f.Accounts))
	for i, a := range f.Accounts {
		a.Name = strings.TrimSpace(a.Name)
		if a.Name == "" {
			a.Name = fmt.Sprintf("account%d", i+1)
		}
		if seen[a.Name] {
			return nil, "", fmt.Errorf("%s 里账户名重复: %s", path, a.Name)
		}
		seen[a.Name] = true
		if strings.TrimSpace(a.Token) == "" {
			return nil, "", fmt.Errorf("%s 里账户 %s 缺少 token", path, a.Name)
		}
		if a.MaxConcurrency < 0 || a.MaxConcurrency > 64 || (a.maxConcurrencySet && a.MaxConcurrency == 0) {
			return nil, "", fmt.Errorf("账户 %s max_concurrency 非法", a.Name)
		}
		// Two aliases of one bearer identity must not bypass one account quota/run budget.
		identity := accountIdentity(a.Token)
		if identities[identity] {
			return nil, "", fmt.Errorf("%s 内重复使用同一账户token，请合并同身份的别名", path)
		}
		identities[identity] = true
		out = append(out, a)
	}

	def := strings.TrimSpace(f.Default)
	if value := os.Getenv("ZAI_ACCOUNT"); value != "" {
		def = strings.TrimSpace(value)
	}
	if def != "" && !seen[def] {
		return nil, "", fmt.Errorf("%s 里 default=%s 不在 accounts 列表里", path, def)
	}
	if def == "" {
		def = out[0].Name
	}
	return out, def, nil
}
