# `mcp/` = 默认**启用**的 MCP（一目了然）

```text
mcp/
  enabled.yaml           # 清单
  servers/               # 每个子目录 = 一个已启用 MCP
    zai/                 # DSH: Z.ai MCP descriptor
    keenable/
    tavily-hikari/
    playwright/
    firefox-devtools/
    zen-browser/         # OpenCode only
    codex/               # OpenCode only
    node_repl/
  local/                 # 本地 MCP 源码
    firefox-devtools-mcp/
    zai-bridge/          # Z.ai Go MCP source + offline tests
  README.md
```

## 约定

| 你想… | 做… |
|--------|-----|
| 看启用了谁 | 打开 `servers/` 文件夹 |
| 启用新 MCP | 新建 `servers/<id>/` + 改 Codex/OpenCode 配置 + 更新 `enabled.yaml` |
| 关掉 MCP | 删掉/移走 `servers/<id>/` 到 `../archive/` + 从客户端 config 删除 |
| 只下载不启用 | 放到 `../sources/mcp-ecosystem/`，**不要**放进 `servers/` |

## 运行时配置（已与此目录对齐）

- Codex: `~/.codex/config.toml` → `[mcp_servers.*]`
- OpenCode: `~/.config/opencode/opencode.json` → `mcp`

**改启用状态必须同时改文件夹和客户端配置。**

## 未启用

见 `../catalog/mcp.draft.toml` 与 `../sources/mcp-ecosystem/`（Ghidra、Frida、Context7…）。
