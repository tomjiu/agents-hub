// Package config 负责加载运行配置。
//
// 配置来源优先级：环境变量 > 配置文件。配置文件默认在
// ~/.zai-bridge/config.json，可用 ZAI_CONFIG 覆盖。
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	DefaultBaseURL = "https://chat.z.ai"
	// chat.z.ai 的阿里云验证码场景（取自前端 captcha 配置块）
	DefaultSceneID = "didk33e0"
	DefaultRegion  = "sgp"
	DefaultPrefix  = "no8xfe"
	DefaultModel   = "glm-5.3"
)

// Config 是完整运行配置。
type Config struct {
	// Token 是 Z.ai 网页端的 Bearer token（JWT，无 exp，长期有效）。
	Token string `json:"token"`
	// Cookie 可选，带上可让风控更宽松。
	Cookie string `json:"cookie,omitempty"`
	// BaseURL 允许指向自建反代。
	BaseURL string `json:"base_url,omitempty"`
	// Model 是发消息时使用的模型 id。
	Model string `json:"model,omitempty"`
	// Region 是 x-region 头，通常是 overseas。
	Region string `json:"x_region,omitempty"`
	// Captcha 相关配置。
	Captcha CaptchaConfig `json:"captcha"`
	// SendIntervalSeconds 是两次发送之间的最小间隔（秒），
	// 用于规避服务端按 IP 的频率限制。
	SendIntervalSeconds int `json:"send_interval_seconds,omitempty"`
	// MaxConcurrency 是同一账户允许同时进行的会话数。
	// 免费账户并发为 1；开通会员后服务端会放宽，这里跟着调高即可。
	// 注意：会话之间不共享沙盒/云盘/记忆，所以并发只影响「能同时跑几个会话」。
	MaxConcurrency int `json:"max_concurrency,omitempty"`
	// SkipQuotaCheck 为 true 时发送前不查额度。
	SkipQuotaCheck bool `json:"skip_quota_check,omitempty"`
	// Debug 打开后会把请求细节打到 stderr。
	Debug bool `json:"debug,omitempty"`

	// Accounts 是多账户列表（来自 accounts.json）。
	// 为空时回退到单 token 模式（ZAI_TOKEN / 配置文件里的 token）。
	Accounts []AccountConfig `json:"-"`
	// DefaultAccount 是默认账户名，工具不传 account 时用它。
	DefaultAccount string `json:"-"`
}

// MultiAccount 表示当前是否处于多账户模式。
func (c Config) MultiAccount() bool { return len(c.Accounts) > 0 }

// ResolvedAccounts 返回实际要用的账户列表。
// 多账户模式直接返回 Accounts；单账户模式把顶层 token 包装成一个名为 default 的账户。
func (c Config) ResolvedAccounts() []AccountConfig {
	if len(c.Accounts) > 0 {
		out := make([]AccountConfig, len(c.Accounts))
		copy(out, c.Accounts)
		for i := range out {
			out[i] = c.inherit(out[i])
		}
		return out
	}
	return []AccountConfig{c.inherit(AccountConfig{Name: "default", Token: c.Token, Cookie: c.Cookie})}
}

// DefaultAccountName 返回默认账户名。
func (c Config) DefaultAccountName() string {
	if c.DefaultAccount != "" {
		return c.DefaultAccount
	}
	if len(c.Accounts) > 0 {
		return c.Accounts[0].Name
	}
	return "default"
}

// ForAccount 返回把 token/cookie 等换成指定账户的配置副本。
// 验证码、BaseURL 等全局设置保持不变（验证码池是共享的）。
func (c Config) ForAccount(a AccountConfig) Config {
	out := c
	out.Token = a.Token
	out.Cookie = a.Cookie
	if a.Model != "" {
		out.Model = a.Model
	}
	if a.Region != "" {
		out.Region = a.Region
	}
	if a.MaxConcurrency > 0 {
		out.MaxConcurrency = a.MaxConcurrency
	}
	// 账户级配置已经展开，避免 client 内部再走 ResolvedAccounts
	out.Accounts = nil
	out.DefaultAccount = a.Name
	return out
}

// inherit 让账户继承全局缺省值。
func (c Config) inherit(a AccountConfig) AccountConfig {
	if a.Model == "" {
		a.Model = c.Model
	}
	if a.Region == "" {
		a.Region = c.Region
	}
	if a.MaxConcurrency <= 0 {
		a.MaxConcurrency = c.MaxConcurrency
	}
	return a
}

// CaptchaConfig 控制 Node 验证码 sidecar。
type CaptchaConfig struct {
	// Enabled 为 false 时跳过验证码求解（仅适用于服务端未要求验证码的账号/时段）。
	Enabled bool `json:"enabled"`
	// NodePath 是 node 可执行文件，默认 "node"。
	NodePath string `json:"node_path,omitempty"`
	// ScriptPath 是 solver 入口，默认与 Go 二进制同目录的 captcha/solver.mjs。
	ScriptPath string `json:"script_path,omitempty"`
	// TimeoutMS 是单次求解超时。
	TimeoutMS int `json:"timeout_ms,omitempty"`
	// Workers 是并行求解进程数。阿里云每次下发不同的 pe.0xx 脚本，
	// 约一半版本在 happy-dom 里会卡死，并行抽签能显著降低等待。
	Workers int `json:"workers,omitempty"`
	// Rounds 是外层重试轮数（每轮都会重新并行抽签）。
	Rounds int `json:"rounds,omitempty"`
	// SceneID / Region / Prefix 对齐前端配置。
	SceneID string `json:"scene_id,omitempty"`
	Region  string `json:"region,omitempty"`
	Prefix  string `json:"prefix,omitempty"`
}

// Default 返回带默认值的配置。
func Default() Config {
	return Config{
		BaseURL:             DefaultBaseURL,
		Model:               DefaultModel,
		Region:              "overseas",
		SendIntervalSeconds: 8,
		MaxConcurrency:      1,
		Captcha: CaptchaConfig{
			Enabled:   true,
			NodePath:  "node",
			TimeoutMS: 90000,
			Workers:   2,
			Rounds:    3,
			SceneID:   DefaultSceneID,
			Region:    DefaultRegion,
			Prefix:    DefaultPrefix,
		},
	}
}

// Load 读取配置文件并叠加环境变量。
func Load() (Config, error) {
	cfg := Default()

	path := os.Getenv("ZAI_CONFIG")
	explicitPath := path != ""
	if path == "" {
		if home, err := os.UserHomeDir(); err == nil {
			path = filepath.Join(home, ".zai-bridge", "config.json")
		}
	}
	if path != "" {
		if raw, err := os.ReadFile(path); err == nil {
			base := Default()
			if err := json.Unmarshal(raw, &base); err != nil {
				return cfg, fmt.Errorf("解析配置文件 %s 失败: %w", path, err)
			}
			cfg = base
			// 配置文件里的空字段用默认值补齐
			cfg.fillDefaults()
		} else if explicitPath || !os.IsNotExist(err) {
			return cfg, fmt.Errorf("读取配置文件 %s 失败: %w", path, err)
		}
	}

	if err := cfg.applyEnv(); err != nil {
		return cfg, err
	}
	if err := cfg.validate(); err != nil {
		return cfg, err
	}

	// 多账户：accounts.json 优先
	accounts, def, err := LoadAccounts()
	if err != nil {
		return cfg, err
	}
	if len(accounts) > 0 {
		cfg.Accounts = accounts
		cfg.DefaultAccount = def
		for _, account := range cfg.ResolvedAccounts() {
			if account.MaxConcurrency < 1 {
				return cfg, fmt.Errorf("账户 %s max_concurrency 必须 >= 1", account.Name)
			}
		}
		return cfg, nil
	}

	// 单账户回退
	if cfg.DefaultAccount != "" && cfg.DefaultAccount != "default" {
		return cfg, fmt.Errorf("未知默认账户 %q", cfg.DefaultAccount)
	}
	if strings.TrimSpace(cfg.Token) == "" {
		return cfg, fmt.Errorf("缺少 Z.ai token。三种方式任选其一：\n" +
			"  1. 环境变量 ZAI_TOKEN\n" +
			"  2. ~/.zai-bridge/config.json 里的 token 字段\n" +
			"  3. 多账户：~/.zai-bridge/accounts.json（见 README）")
	}
	return cfg, nil
}

func (c *Config) fillDefaults() {
	d := Default()
	if c.BaseURL == "" {
		c.BaseURL = d.BaseURL
	}
	if c.Model == "" {
		c.Model = d.Model
	}
	if c.Region == "" {
		c.Region = d.Region
	}
	if c.Captcha.NodePath == "" {
		c.Captcha.NodePath = d.Captcha.NodePath
	}
	if c.Captcha.SceneID == "" {
		c.Captcha.SceneID = d.Captcha.SceneID
	}
	if c.Captcha.Region == "" {
		c.Captcha.Region = d.Captcha.Region
	}
	if c.Captcha.Prefix == "" {
		c.Captcha.Prefix = d.Captcha.Prefix
	}
}

func (c *Config) applyEnv() error {
	if v := os.Getenv("ZAI_SEND_INTERVAL"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.SendIntervalSeconds = n
		} else {
			return fmt.Errorf("invalid integer environment value: %w", err)
		}
	}
	if v := os.Getenv("ZAI_TOKEN"); v != "" {
		c.Token = v
	}
	if v := os.Getenv("ZAI_COOKIE"); v != "" {
		c.Cookie = v
	}
	if v := os.Getenv("ZAI_BASE_URL"); v != "" {
		c.BaseURL = strings.TrimRight(v, "/")
	}
	if v := os.Getenv("ZAI_MODEL"); v != "" {
		c.Model = v
	}
	if v := os.Getenv("ZAI_REGION"); v != "" {
		c.Region = v
	}
	if v := os.Getenv("ZAI_CAPTCHA_ENABLED"); v != "" {
		c.Captcha.Enabled = v != "0" && strings.ToLower(v) != "false"
	}
	if v := os.Getenv("ZAI_NODE"); v != "" {
		c.Captcha.NodePath = v
	}
	if v := os.Getenv("ZAI_CAPTCHA_SCRIPT"); v != "" {
		c.Captcha.ScriptPath = v
	}
	if v := os.Getenv("ZAI_CAPTCHA_SCENE"); v != "" {
		c.Captcha.SceneID = v
	}
	if v := os.Getenv("ZAI_CAPTCHA_WORKERS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.Captcha.Workers = n
		} else {
			return fmt.Errorf("invalid integer environment value: %w", err)
		}
	}
	if v := os.Getenv("ZAI_CAPTCHA_ROUNDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.Captcha.Rounds = n
		} else {
			return fmt.Errorf("invalid integer environment value: %w", err)
		}
	}
	if v := os.Getenv("ZAI_MAX_CONCURRENCY"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.MaxConcurrency = n
		} else {
			return fmt.Errorf("invalid integer environment value: %w", err)
		}
	}
	if v := os.Getenv("ZAI_SKIP_QUOTA_CHECK"); v != "" {
		c.SkipQuotaCheck = v != "0" && strings.ToLower(v) != "false"
	}
	if v := os.Getenv("ZAI_ACCOUNT"); v != "" {
		c.DefaultAccount = v
	}
	if os.Getenv("ZAI_DEBUG") != "" {
		c.Debug = true
	}
	return nil
}

func (c Config) validate() error {
	if c.SendIntervalSeconds < 0 || c.SendIntervalSeconds > 86400 {
		return fmt.Errorf("send_interval_seconds must be in [0,86400]")
	}
	if c.MaxConcurrency < 1 || c.MaxConcurrency > 64 {
		return fmt.Errorf("max_concurrency must be in [1,64]")
	}
	if c.Captcha.TimeoutMS < 1 || c.Captcha.TimeoutMS > 3600000 || c.Captcha.Workers < 1 || c.Captcha.Workers > 32 || c.Captcha.Rounds < 1 || c.Captcha.Rounds > 100 {
		return fmt.Errorf("invalid captcha timeout/workers/rounds")
	}
	if c.SkipQuotaCheck {
		return fmt.Errorf("skip_quota_check is forbidden: quota must be verified before sending")
	}
	return nil
}
