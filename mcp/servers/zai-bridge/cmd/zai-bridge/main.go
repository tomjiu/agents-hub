// zai-bridge 把 chat.z.ai 的网页会话变成 MCP 工具，
// 让本地 AI 可以读云端 agent 的进展、并向它下指令。
//
// 设计：读取走纯 HTTP；发送时服务端要求阿里云验证码，由本地常驻的
// Node sidecar（happy-dom 模拟浏览器）解出 token，全程不启动真实浏览器。
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/local/zai-bridge/internal/config"
	"github.com/local/zai-bridge/internal/mcp"
	"github.com/local/zai-bridge/internal/zai"
)

var version = "0.3.1"

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--version", "-v", "version":
			fmt.Println("zai-bridge", version)
			return
		case "--help", "-h", "help":
			printHelp()
			return
		case "check":
			if err := runCheck(); err != nil {
				fmt.Fprintln(os.Stderr, "自检失败:", err)
				os.Exit(1)
			}
			return
		}
	}

	if err := runBridge(); err != nil {
		fmt.Fprintln(os.Stderr, "服务退出:", err)
		os.Exit(1)
	}
}

func runBridge() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("配置错误: %w", err)
	}

	// 验证码池全局共享：它证明的是「请求来自真实浏览器」，
	// 与登录的是哪个账户无关。所以账户再多也只占这一份内存。
	var pool *zai.Pool
	if cfg.Captcha.Enabled {
		pool = zai.NewPool(cfg.Captcha)
		defer pool.Close()
	}

	// 按账户构造客户端：每个账户独立 token / 限流器 / 额度缓存。
	accounts := map[string]*zai.Client{}
	var defaultClient *zai.Client
	gate := zai.NewDispatchGate(time.Duration(cfg.SendIntervalSeconds) * time.Second)
	defer func() {
		for _, cl := range accounts {
			_ = cl.Close()
		}
	}()
	for _, ac := range cfg.ResolvedAccounts() {
		acfg := cfg.ForAccount(ac)
		cl := zai.New(acfg)
		cl.SetDispatchGate(gate)
		if pool != nil {
			cl.SetCaptchaProvider(pool)
		}
		accounts[ac.Name] = cl
		if defaultClient == nil || ac.Name == cfg.DefaultAccountName() {
			defaultClient = cl
		}
	}
	client := defaultClient

	srv := mcp.NewServer(os.Stdout)

	// MCP 握手
	srv.Register("initialize", func(raw json.RawMessage) (any, *mcp.RPCError) {
		return map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities": map[string]any{
				"tools": map[string]any{},
			},
			"serverInfo": map[string]any{
				"name":    "zai-bridge",
				"version": version,
			},
		}, nil
	})
	srv.Register("ping", func(raw json.RawMessage) (any, *mcp.RPCError) {
		return map[string]any{}, nil
	})

	deps := mcp.Deps{
		Client:         client,
		Model:          cfg.Model,
		DefaultAccount: cfg.DefaultAccountName(),
	}
	// 只有真的多账户时才把映射传进去，单账户保持原样
	if len(accounts) > 1 || cfg.MultiAccount() {
		deps.Accounts = accounts
	}
	mcp.RegisterTools(srv, deps)

	if err := srv.ServeContext(ctx, os.Stdin); err != nil && !errors.Is(err, context.Canceled) {
		return err
	}
	return nil
}

func printHelp() {
	fmt.Println(`zai-bridge — Z.ai 会话 MCP 桥

用法:
  zai-bridge           以 MCP stdio 服务模式运行（供 AI 客户端调用）
  zai-bridge check     自检：验证 token 与验证码求解器
  zai-bridge --version 显示版本

环境变量:
  ZAI_TOKEN            单账户token（多账户用accounts.json）
  ZAI_ACCOUNTS_FILE    多账户配置文件路径
  ZAI_ACCOUNT          默认账户名
  ZAI_MAX_CONCURRENCY  账户并发上限，默认1
  ZAI_COOKIE           可选，浏览器 Cookie
  ZAI_MODEL            可选，默认 glm-5.3
  ZAI_CAPTCHA_ENABLED  设为 0 可关闭验证码求解
  ZAI_NODE             node 可执行文件路径
  ZAI_DEBUG            设为任意值输出调试信息

配置文件:
  ~/.zai-bridge/config.json（可用 ZAI_CONFIG 指定）`)
}

// runCheck 做一次端到端自检。
func runCheck() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	fmt.Println("✓ 配置已加载")

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	account := cfg.ResolvedAccounts()[0]
	for _, candidate := range cfg.ResolvedAccounts() {
		if candidate.Name == cfg.DefaultAccountName() {
			account = candidate
			break
		}
	}
	fmt.Printf("默认账户: %s\n", account.Name)
	client := zai.New(cfg.ForAccount(account))
	defer client.Close()

	chats, err := client.ListChats(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("✓ token 有效，共 %d 个会话\n", len(chats))
	for i, c := range chats {
		if i >= 5 {
			break
		}
		fmt.Printf("    %s  %s\n", c.ID, c.Title)
	}

	if !cfg.Captcha.Enabled {
		fmt.Println("· 验证码求解已关闭，跳过")
		return nil
	}

	pool := zai.NewPool(cfg.Captcha)
	defer pool.Close()
	fmt.Printf("· 正在求解验证码（并行 %d 个进程，首次约 5-15 秒）…\n", cfg.Captcha.Workers)
	param, err := pool.Solve(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("✓ 验证码求解成功（%d 字符）\n", len(param))
	fmt.Println("\n全部检查通过。")
	return nil
}
