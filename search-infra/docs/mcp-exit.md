# search-core MCP 出口 —「不绑账户的眼睛」接入指南

> v0.7 出口实战化（2026-09-03）。Phase Q 立项的落地件：把 D 模式（免 key 客户端直连）包成 MCP server，
> 卖给 A/B 绑定模式的用户。市场依据见 [Phase Q 验证](../reports/13-cross-comparison.md) §5.5 与
> [附二](../analysis/search-landscape/e-ai-invocable-domain-routing.md)。

## 一句话

search-core 是免账号、免 API key 的本地搜索编排器（29 个 provider：通用引擎池 + GitHub/StackOverflow/包管理器/学术/模型/镜像/实体等垂直 API）。
`npm run serve` 把它包成一个 **MCP stdio server**——任何支持 MCP 的 agent（Claude Code / Cursor / 其他）都能把
这双"眼睛"插上：不用交厂商订阅、不用交搜索 key、搜索流量走你自己的 HTTP 客户端。

## 为什么有这个缺口（Phase Q 结论速览）

仓库 12 个被逆向产品的搜索绑定方式归纳为四种模式：

| 模式 | 代表 | 痛点 |
|---|---|---|
| A 托管跟厂商账户 | Claude Code / Codex / Grok Build / Qoder / Trae / Kimi / WorkBuddy | `web_search` 不是搜索代码，是发给厂商云端的规格声明；搜索跟订阅走 |
| B BYOK 跟大脑走 | ZCode 等 | 自带模型 key 可行，但搜索仍绑 provider 服务端工具或官方云 MCP——**眼睛不随大脑独立** |
| C 全自托管 | Perplexica / ODR | 要自己养 SearXNG/引擎池 |
| D 免 key 客户端直连 | pi/dsh-search-boost、**search-core** | 即插即用，零账户 |

A/B 模式用户的共同缺口：**BYOK 只卖"大脑"（推理费），从不卖"眼睛"（搜索费）**。最硬的证据：
Claude Code 的 WebSearch 在 Amazon Bedrock / Google Vertex 上**官方明示不可用**（server-side tool
`web_search_20250305` 转发被拒，litellm#26252；AWS 官方给的解法就是"挂一个 MCP 搜索 connector"）。
本 server 就是那个现成的 connector。

## 已验证 / 未验证（诚实边界）

**✅ 本沙箱实测通过**（`core/scripts/probe-mcp-real.mjs`，stdio 真网络全流程，2026-09-03）：

| 项 | 实测 |
|---|---|
| 协议握手 | MCP `2025-06-18` 协商通过；server 上报 `search-core 0.7.0`（版本运行时读 package.json，不再手写漂移） |
| Direct 工具 | `search / fetch / tool_search` 常驻 3 件 |
| 真实搜索（通用） | "model context protocol specification 2025" → 5 引擎并联（bingrss+hn+crossref+wikipedia+arxiv），冷 6.0s / 热缓存 2ms，首条即 MCP spec 官方页 |
| 真实搜索（域名专线） | "rust crate async runtime" → `route: domain`、`domain: packages`，npm+crates 双 API 腿直连 562ms，首条即 crates.io crate 页 |
| focus 抓取 | 925/4314 chars（省 79% token），热缓存 2ms / 冷 423ms |
| 渐进披露 | `tool_search("engine health")` 激活 `search_providers`，工具清单 3→4 |
| 健康面 | 29 provider 注册 / 9 个有实战战绩 / 0 熔断 |

**⚠️ 本沙箱无法验证（如实声明，不冒充实测）**：

- Bedrock/Vertex 托管的 Claude Code **真实会话**（沙箱无 AWS 凭证与该客户端）——但"WebSearch 不可用、
  MCP connector 可用"这对结论有一方文档 + litellm issue 双重信源（附二 §B/C）。
- Cursor 等 GUI 客户端的点击流——下述配置片段按各客户端官方 MCP 配置格式给出，接线后请以实际表现为准。
  Phase Q 已核实 Cursor 的 MCP 工具不随 BYOK 阉割（被阉割的是模型侧搜索），但版本迭代快，自测为准。

## 接入指南

### 前置（一次性）

```bash
git clone https://github.com/mmqz/search-tool-rnd.git
cd search-tool-rnd/core && npm install && npm run build
# 要求 Node >= 22.5；产物在 dist/mcp.js；零 key 即可用
```

### 通用 stdio 配置（适用于任何标准 MCP 客户端）

```json
{
  "mcpServers": {
    "search-core": {
      "command": "node",
      "args": ["/absolute/path/to/search-tool-rnd/core/dist/mcp.js"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add search-core -- node /absolute/path/to/search-tool-rnd/core/dist/mcp.js
```

或项目级 `.mcp.json`（放进仓库让团队共用上面那段通用 JSON）。

**Claude Code on Bedrock / Vertex（本出口的目标场景）**：按 Anthropic 官方文档设置 Bedrock 环境变量
（`CLAUDE_CODE_USE_BEDROCK=1` + AWS 区域/凭证，以官方文档为准）；MCP 配置与上面完全相同——
WebSearch 缺位由本 server 的 `search` 工具顶上，这正是 AWS 官方教程给的补法。

### Cursor

`~/.cursor/mcp.json`（全局）或项目 `.cursor/mcp.json`，内容同样是上面那段通用 JSON。

### 工具面（渐进披露，Direct 常驻 + Deferred 发现后激活）

| 工具 | 类型 | 干什么 |
|---|---|---|
| `search` | Direct | 多引擎并行搜索 + 融合去重；meta 里带 `route`（web/domain/x/github）、`domain`（命中的主题专线）、`engines_used/engines_failed/degraded` |
| `fetch` | Direct | 正文抓取，`focus` 只回命中段+邻接段（实测省 ~79% token） |
| `tool_search` | Direct | 渐进披露入口：按需激活 Deferred 工具，避免 schema 撑爆 context |
| `research` | Deferred | 深度研究循环（5 角度并行 + 6 问反思 + 双预算 + 断点恢复） |
| `x_search` | Deferred | X/Twitter 三层降级链 |
| `search_providers` | Deferred | 29 provider 健康面（ok/fail/延迟/熔断） |
| `search_cache` | Deferred | FTS5 离线全文搜已抓页面（全网引擎全灭时的兜底面） |
| `cache_stats` | Deferred | 缓存/计数器快照 |

给 agent 的调用契约写在工具描述里：query 一句话意图、别把清单塞一个查询、深研究走 research。

## 运维要点

- **零 key 零额度**：29 个 provider 全部免 key 可用（个别如 stackexchange 免 key 300 次/天/IP，
  `SC_STACKEXCHANGE_KEY` 可升 10000/天）；Tavily/Brave/Exa key 插槽可选，不配不影响。
- **可观测**：`search_providers` 看健康，`cache_stats` 看命中；熔断/额度尽自动回落，`meta.degraded` 如实标注。
- **三出口同核**：MCP（agent 用）/ REST+SSE（服务集成，`npm run serve-http`）/ CLI（人用，`node dist/cli.js`）。
  本文档只覆盖 MCP 出口；REST 鉴权见 `core/src/http.ts` 头注释。
