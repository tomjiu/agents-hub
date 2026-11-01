# tavily-hikari 网关接入指南（phase Y, 2026-09-03）

> 用户提案：接入自己的 Tavily 网关 `tavily.ivanli.cc`（Hikari），并顺带评估 keenable.ai。
> keenable 结论见 engines.md keenable 行 + f-keyed-apis-scan.md 附录；本文只管 Hikari。

## Hikari 是什么

IvanLi-CN/tavily-hikari：Tavily 兼容网关。对外提供两种形态——
1. **Tavily 风格 HTTP API**：`https://tavily.ivanli.cc/api/tavily/search|extract|crawl|map|research`，
   `Authorization: Bearer th-...`（Header 不方便时可把 token 写进 body 的 `api_key` 字段）。
2. **远程 MCP**：`https://tavily.ivanli.cc/mcp`，`Authorization: Bearer th-...`。

2026-09-03 无凭据探针（沙箱，未拿真 token）：
- `POST /api/tavily/search` 无 token → `401 {"error":"missing token"}`；坏 token → `401 {"error":"invalid or disabled token"}` ✅ 网关活，鉴权语义清晰
- `POST /mcp`（initialize）无 token → `401 {"error":"missing token"}` ✅ MCP 端点活
- 诚实边界：**没做带真 token 的端到端调用**（token 在聊天里是打码的，也不该进仓库）；接好后首次真调用由用户本地完成。

## 我们引擎的两条接入路线（二选一，别同时开）

### 路线 A：tavily provider 直接换 baseUrl（推荐，零新概念）

```bash
export TAVILY_API_KEY="th-你的HikariToken"          # 网关 token 走原 key 槽位
export SC_TAVILY_BASE_URL="https://tavily.ivanli.cc/api/tavily"
export SC_TAVILY_MONTHLY_QUOTA="0"                  # 关掉本地 1000/月计数(额度由网关自己管); 不设则默认 1000
```
- provider 内部请求 `${baseUrl}/search`，协议/参数/响应与官方 Tavily 同形（429/432/433 分类熔断照旧）。
- 有 key 且额度未尽 → keySlots=auto 自动并联进默认池；额度尽 → 自动回落免 key 池，零代码。
- baseUrl 配了但没配 key → 引擎判 isConfigured=false 不出勤（网关没 token 本来也没法用）。

### 路线 B：mcp-connector 挂远程 MCP（phase Y 新增 headers 支持）

```bash
export SC_MCP_CONNECTORS='[{"name":"hikari","url":"https://tavily.ivanli.cc/mcp","headers":{"Authorization":"Bearer th-你的HikariToken"}}]'
```
- 注册为引擎 `mcp:hikari`，stdio/HTTP 双传输里的 streamable HTTP 路；headers 走 SDK `requestInit`。
- 适合同时想给其他 agent 客户端用同一网关的场景（配置同构，一份心智两处用）。
- 缺点：MCP 工具调用比直连 API 多一层封装；工具选择靠启发式（可 `tool` 字段点名）。

### 其他 agent 客户端（用户提供的官方接法，抄录备查）

```toml
# Codex CLI: ~/.codex/config.toml
experimental_use_rmcp_client = true

[mcp_servers.tavily_hikari]
url = "https://tavily.ivanli.cc/mcp"
bearer_token_env_var = "TAVILY_HIKARI_TOKEN"
```

```bash
# Claude Code CLI
claude mcp add-json tavily-hikari '{
  "type": "http",
  "url": "https://tavily.ivanli.cc/mcp",
  "headers": { "Authorization": "Bearer th-..." }
}'
claude mcp get tavily-hikari   # 验证
```

通用规则（网关文档原话）：支持远程 MCP 的客户端指 `https://tavily.ivanli.cc/mcp` + Bearer 头；
走 Tavily 风格 HTTP API 的客户端用 `https://tavily.ivanli.cc/api/tavily` 再拼 `/search` 等端点。

## token 纪律（重要）

- token 只进环境变量或本地 config.json（0600），**永不进仓库/聊天明文**——聊天里出现的都是打码形式。
- tvly-hikari CLI（`curl ... | bash -s -- --base-url ... --token ...`）是网关自己的命令行封装，
  与我们引擎无依赖关系：它管"人+agent 直接调 Tavily 工具"，我们引擎管"搜索编排聚合"，两者可并存。
- `npx skills add https://github.com/IvanLi-CN/tavily-hikari --global` 是给 agent 技能生态装的
  技能包；我们的 search-core 本身已有 SKILL.md 出口，不需要借助它。

## 改动清单（phase Y）

- `core/src/config.ts`：`tavily.baseUrl` 配置位 + `SC_TAVILY_BASE_URL` env + MCP 连接器 `headers` 字段
- `core/src/providers/api.ts`：tavily 请求改 `${baseUrl}/search`（默认官方端点不变，尾斜杠容忍）
- `core/src/providers/mcp-connector.ts`：streamable HTTP 传输透传自定义 headers
- 测试：tavily baseUrl 三分支（网关/默认/尾斜杠）golden
