# WorkBuddy 5.4.2 逆向分析报告

**目标**: WorkBuddy（腾讯 CodeBuddy 团队 AI 工作端 / AI Agent Desktop）
**版本**: 5.4.2 (`@genie/workbuddy-desktop`)，内置 agent 内核 `@tencent-ai/codebuddy-code` 2.132.0-dev
**平台**: Windows Electron (NSIS 安装包)，main/ 为可读命名 JS，cli/dist 为 esbuild bundle
**样本**: `analysis/workbuddy/code/` (asar 解包 772M) + `extracted/app/` (Electron 运行时)
**关联产品**: 同源 CLI 即 CodeBuddy Code（cnb.cool/codebuddy/codebuddy-code），产品线 endpoint 共享

---

## 0. 摘要 (TL;DR)

WorkBuddy = **Electron 壳（Manus 式 AI 工作端）+ 可独立更新的 agent 内核（Claude Code 血统的 CodeBuddy CLI）+ 服务端 agenttool 家族**。对搜索工具设计最值钱的 4 个发现：

1. **搜索智能全部在服务端**：`WebSearch`/`WebFetch`/`agentic_search` 三个工具都打自家网关 `/agenttool/v1/*`（Bearer + X-Conversation-ID 头）。其中 `agentic_search` 是**hosted agentic search**——服务端 agent 自主多步搜索，客户端经 **SSE 流式收 tool_call/tool_result 进度事件**，`done` 事件返回 synthesis 摘要。与 01-grok-build / 09-codex 结论第三次印证：头部产品都把搜索编排放服务端。
2. **WebFetch 的"竞速 + 按需提炼"值得整段抄**：远端 API 与本地 fetch（undici + turndown）Promise.race 谁快用谁，互为降级；>100k 字符截断、>15k 才触发小模型按 prompt 提炼；15min URL 缓存；SSRF 私网守卫 + Galileo 威胁域名库拦截。
3. **工具面用 "defer + MiniSearch 搜索 + DeferExecuteTool 换票" 按需加载**：`defer_loading` 工具只进 MiniSearch 倒排索引（name boost 2，topK 5），prompt 里只留字符预算内的摘要；与 Codex 的 BM25 tool_search 异曲同工但工程细节更细（overlay 强制 defer/禁 defer、按 server 增量换索引、agent 工具白名单过滤）。
4. **纯 prompt 的 deep-research 引擎**：tencent-docx 插件里的 6 步状态机（Decompose→Search→Extract→Reflect→Decide→Snapshot），核心是**6 个量化自问**（事实数/维度覆盖/权威源 Tier1/时效/冲突标注/可用性预演）+ strict/relaxed 两档严格度 + max_loops 降级——比 open-deep-research 的 think_tool 更可操作的反思协议。

---

## 1. 整体架构

### 1.1 进程拓扑：壳 / 守护 / agent 内核三层

```
Electron Renderer (React, 152M assets: lib-chat-ui / monaco / mermaid / pdfjs / pptx-sheet 预览)
   │ preload bridge
Electron Main (module.desktop-host; 23M 可读 JS)
   │ spawn (detached) + 本地 HTTP/JSON-RPC
workbuddy-server daemon (main/server.js 7MB, @genie/workbuddy-server)
   │ ACP (Agent Client Protocol, @agentclientprotocol/sdk 0.25.0, stdio JSON-RPC)
CodeBuddy CLI 进程 (cli/dist/codebuddy.js 22M bundle, --acp worker)
   │ HTTPS + Bearer + X-Conversation-ID/X-Agent-Intent/...
www.workbuddy.ai  (LLM 网关 + /agenttool/v1/* + /api/memory/* + /config/models|agents)
```

关键点：**agent 引擎不在 Electron 里，是一个独立 CLI**，desktop 用 ACP 协议驱动（`main/acp.js`：`session/new`、`session/prompt`、`session/set_mode`、`session/request_permission`、`fs/read_text_file`、`terminal/create`、`mcp/connect`，还有 NES 补全方法集）。`main/server.js` 有完整的 ACP worker 生命周期管理：prewarm 池（`main/cli-prewarm-pool.js`）、孤儿 `--acp` worker 回收（"父进程暴毙后 worker 常被 init 收养"）、writer lease。

desktop→CLI 的配置走**环境变量协议**（`main/cli-prewarm-pool.js` buildAgentCliRuntimeEnv）：`CODEBUDDY_FORCE_HEADLESS_BUNDLE=1`、`CODEBUDDY_SKILL_TOOL_CHAR_BUDGET=30000`、`CODEBUDDY_DISABLE_CRON=1`、`CODEBUDDY_DISABLE_FORK_SUBAGENT=1`、`CODEBUDDY_DISABLE_AUTO_MEMORY=1`（记忆上收到 desktop）、`ACC_PRODUCT_CONFIG_V3`（产品配置注入）等——桌面不信任 CLI 的自主行为，把技能目录、记忆、定时任务全部接管。

### 1.2 服务端同一域名的多面 API

`cli/product.json`：endpoint `https://www.workbuddy.ai`（内部 `copilot.tencent.com`，SSO `tencent.sso.copilot.tencent.com`）。所有智能调用都汇聚到这个域：
- LLM 主对话（网关代理，模型目录来自 `/config/models`）
- `/agenttool/v1/search`、`/agenttool/v1/webfetch`、`/agenttool/v1/agentic_search`
- `/api/memory/search`（历史对话检索）、`/v2/config`、`/v3/config`、`/config/agents`
- 鉴权统一 Bearer，请求头协议（`cli/dist/codebuddy.js` 模块 63355）：`X-Conversation-ID / X-Conversation-Request-ID / X-Conversation-Message-ID / X-Agent-Intent(=craft|plan|ask…) / X-Agent-Type / X-Agent-Purpose / X-Product / X-IDE-* / X-User-Id / X-Trace-ID`——即**服务端靠这些头知道"这是哪个会话哪个 agent 哪个模式"**，是做多 agent/多模式遥测与路由的关键设计。

### 1.3 安全栈（重量级，远超同类）

native/: `turing_sdk.node`（TuringShield 反作弊）+ `qimei.dll`（设备指纹）；`cli/vendor/sandbox/`（sandbox-cli.exe / tsbx.dll，44M Windows 沙箱）；`cli/vendor/shim/`（brokered bash/node/python shim、safe-delete、sitecustomize.py——文件删除代理审批）；Linux 用 sandbox-cli，云侧还有 e2b SDK（`main/e2b-filesystem.js`）；webfetch 域名过 Galileo 威胁库（`main/threat-database-galileo.js`）。遥测三件套 Aegis + Universal-Report + OTLP。

## 2. Agent 工作流

### 2.1 四种交互模式 × 三种"胶囊" = prompt 由模板拼装

system prompt 不是硬编码在 CLI 里，而是 **desktop 侧插件仓库 + nunjucks 模板**（`resources/plugins/workbuddy-builtin/`）：
- `welcomemode/{code,work,design}/prompt.tpl`（约 30k 字符/份）——"胶囊"根模板
- `interactionmode/{ask,craft,plan,expert}/fragments/*.md`——模式片段（agent-loop / tool-use / task-management / result-presentation / interaction / plugin-recommendation）
- `prompt-common/fragments/`——记忆系统片段

daemon 的 work-mode-packs 组装器（`main/server.js`，`interactionmode-ask/expert/plan/craft` 插件 ID）按会话开关把这些插件打包，CLI 侧 `cliComposeEnabled` 时不再传 `--tools`，工具面由模式插件声明。模板里到处是 include 与条件注入：

```jinja
{# welcomemode/work/prompt.tpl #}
{% if workMode == "plan" %}{% include "interactionmode-plan/fragments/interaction.md" %}
{% elif workMode == "expert" %}...{% else %}{% include "interactionmode-craft/fragments/interaction.md" %}{% endif %}
...
{% if workMode == "plan" %}{% include "interactionmode-plan/fragments/task-management.md" %}{% endif %}
```

work 胶囊的人设是 Manus 式通用工作 agent（研究写作/数据分析/建站/多模态生成/100+ 专家），plan 模式的 agent-loop 片段明确 7 步循环：

```
1. Analyze context → 2. Think (update plan / advance phase / take action)
→ 3. Select tool → 4. Execute in sandbox → 5. Receive observation
→ 6. Iterate → 7. present_files + final answer (must carry forward results hidden in collapsed tool calls)
```

### 2.2 多 agent：子代理 + Teams + Fork + 定时体

CLI 的 `ToolNames` 枚举给出了完整工具面（这是理解全产品的钥匙）：

```js
// cli/dist/codebuddy.js — ToolNames enum（节选）
READ,LS,WRITE,EDIT,MULTI_EDIT,NOTEBOOK_READ,NOTEBOOK_EDIT,BASH,BASH_OUTPUT,KILL_SHELL,
GLOB,GREP,TODO_WRITE,SAVE_MEMORY,WEB_FETCH,WEB_SEARCH,
AGENT,TASK_OUTPUT,TASK_CREATE,TASK_GET,TASK_UPDATE,TASK_LIST,TASK_STOP,
ENTER_PLAN_MODE,EXIT_PLAN_MODE,SLASH_COMMAND,SKILL,ASK_USER_QUESTION,LSP,STRUCTURED_OUTPUT,
IMAGE_GEN,TOOL_SEARCH,IMAGE_EDIT,ARTIFACT,ARTIFACT_CONTROL,
TEAM_CREATE,TEAM_DELETE,SEND_MESSAGE,ENTER_WORKTREE,LEAVE_WORKTREE,
CRON_CREATE,CRON_DELETE,CRON_LIST,DEFER_EXECUTE,WECHAT_REPLY,WECOM_REPLY,PUSH_NOTIFICATION,
DELEGATE_TOOL,POWERSHELL,SKILL_MANAGE,COMPUTER_USE,LIST_MCP_RESOURCES,READ_MCP_RESOURCE,
WAIT_FOR_MCP_SERVERS,WORKFLOW,VIDEO_GEN,REPORT_FINDINGS,MONITOR,REPL
```

- **子代理**：Agent 工具（`subagent_type`/`prompt`/`name`/`run_in_background`），`AgentTask` 实现类带 subagentDepth（嵌套深度）、spawn budget（防爆炸）、`MaxTurnsExceededError` 时"返回部分输出按 completed 收尾"、agent-scoped MCP（子代理可以有自己的 MCP server）、frontmatter hooks/skills 预加载。内置 agent 名一长串：`general-purpose、Explore、compact、contextSummary、contentAnalyzer、autoModeClassifier、terminalTitleGenerator、summaryGenerator、memorySelector、fork…`——**后半部分是"隐形小 agent"**，专门跑摘要/标题/内容提炼这类副业任务。
- **Teams**：TeamCreate/TeamDelete/SendMessage + teamContext/memberName，正式队员 `isTeamMember` 会**隔离主会话的 silentAbort**（队长取消不打断队员），还有 lead inbox、TEAM 上限 20 会话缓存。
- **钩子**：PreToolUse/PostToolUse/UserPromptSubmit/SessionStart/SessionEnd/Stop/SubagentStop/PreCompact/WorktreeCreate/WorktreeRemove——与 Claude Code 完全同名兼容。
- **定时/自动化**：CLI 有 Cron 工具但 desktop 禁用（`CODEBUDDY_DISABLE_CRON=1`），改由 desktop 侧 MCP 工具 `automation_update` 接管（rrule/scheduledAt + modelId + 推送到企业微信 bot + 绑定专家）。prompt.tpl 里有一整段 `<automations>` 教模型怎么写 rrule、"prompt 必须自包含因为未来运行看不到当前对话"。

### 2.3 权限与 Auto 模式

PermissionMode：fullAccess/plan/default/acceptEdits/bypassPermissions；plan 模式会周期注入 plan-mode reminder（SystemReminderAgentInterceptor）。**Auto 模式**是"AI 审批"：`AutoModeClassifierClient` 两阶段分类器判定工具调用放行与否，带熔断（AUTO_MODE_MAX_CONSECUTIVE_DENIALS）、最近拒绝记录（AUTO_MODE_RECENT_DENIALS_MAX）；desktop 侧还有 compact 场景的 `shouldAutoApprovePermission` 白名单（bash/bashoutput/killshell 等在压缩期自动放行）。

## 3. 技能仓库（Skill System）

三源结构，全部 Claude Code SKILL.md 兼容格式：

| 来源 | 位置 | 内容 |
|---|---|---|
| 内置技能 | `code/resources/plugins/workbuddy-builtin/skills/`（19 个） | skill-creator、marketplace-skill-installer、expert-manager、ardot-*（设计族 6 个）、buddy-multimodal-generation、sites（建站发布）、library（资料库）、tencent-docs-routing、wb-finance-skill… |
| 内置插件 | `…/builtin-plugins/`（5 个） | tencent-docx（大型文档 agent：agents/ + experts/ + hooks/hooks.json + skills/ + core/engines/）、sheetagent、tencent-pptx、tencent-docs-plugin、weixinpay |
| 用户/项目 | `~/.workbuddy/skills/`、`{workspace}/.workbuddy/skills/` | 运行时可写 |

机制亮点：
- **加载**：Skill 工具调用即把技能内容注入 context，字符预算 `CODEBUDDY_SKILL_TOOL_CHAR_BUDGET=30000`；技能描述有 MAX_SKILL_DESC_CHARS 上限（控制目录开销）。
- **能力缺口先搜技能**：prompt 强制"说 I can't 之前必须先调 find-skills"，且有 skills-security-check（安装前 P0/P1/P2 审计）、SkillManage（模型**自积累技能**：8+ 工具调用任务完成即落盘成技能；用后必反思修正；只能改 `agent_created: true` 的技能）。这是把"经验固化"做成 prompt 硬规则的少见样本。
- **专家（Experts）**：100+ 领域专家（`resources/builtin-expert-recommendations/curated-experts.json` 场景匹配），expert 模式+expert-manager 技能+专家市场，本质是"预置的人设+工作流包"。
- **引擎复用**：tencent-docx 的 `core/engines/`（deep-research、critic-generator）是所有 experts 共享的纯 prompt 协议（见 §5.3）。
- **deferred MCP + 技能协同**：library 技能里明文教模型用 `ToolSearch {"tool_names":["connect_open_platform"]}` → `DeferExecuteTool {"toolName":..., "params":{...}}` 取 token——技能文档直接依赖工具面协议，两套系统咬合很深。

## 4. 工具系统

### 4.1 三层工具面与 defer 机制

1. **CLI 内置工具**（§2.2 枚举），Go 风格 class + 装饰器注册（`@Component(Tool)`）。
2. **Desktop MCP builtin tools**：desktop 进程注册进一个 workbuddy connector，经 ACP `mcp` 桥接给 CLI——`present_files`、`read_me`/`show_widget`（Visualizer 内联 SVG/HTML 小组件）、`connect_cloud_service`、`connect_open_platform`、`conversation_search`、`workbuddy_marketplace_skill`、`workbuddy_sites_deploy/unpublish`、`agentic_search`、`automation_update`、`pick_location`。其中一批标了 `defer_loading`（DEFERRED_BUILTIN_TOOL_NAMES）。
3. **第三方 MCP**：`~/.workbuddy/mcp.json`，`mcp__server__tool` 命名，`WaitForMcpServers` 工具处理慢启动。

defer 机制核心（`cli/dist/codebuddy.js` ToolSearchService）：

```js
this.deferredTools = new Map();                 // defer_loading 工具注册表
static DEFAULT_TOP_K = 5
static SEARCH_OPTIONS = { prefix: true, combineWith: "OR", boost: { name: 2 } }
init() { this.miniSearch = new MiniSearch({ fields: ["name","description"], ... }) }
async search(query, k, { allowedTools, overlay, session }) {
  // 可见性检查 → agent 工具白名单过滤 → overlay 强制禁用过滤 → topK
}
describeForSession(name)   // ToolSearch 命中后取回完整 parameters schema
replaceServerTools(server, tools) // MCP server 重连时按代数增量换索引
```

配套：`DeferExecuteTool`（arguments.toolName + params，`resolveEffectiveToolName` 负责把 defer 调用还原成真实工具名做权限判断）、`ToolDeferOverlay`（模式/agent 级 forceDefer/forceNoDefer）、`DEFAULT_DEFERRED_TOOLS_CHAR_BUDGET`（deferred 工具摘要总字符预算）。模式声明 `ToolSearch` 时全部 MCP 工具转 deferred——**工具面预算化而不是全量塞 prompt**。

### 4.2 权限/审计

每次工具调用有 ToolPermissionType（read/bash/edit/unknown）+ ToolArgType（filePath/command/slashCommand/skill/url）分类；输出截断 MAX_TOOL_OUTPUT_LENGTH + TRUNCATION_PRESETS；工具结果 JSON 截断会被 `findTruncatedToolCalls` 检出并从历史丢弃（防止坏 JSON 进 context）。

## 5. 搜索实现（本报告重点）

### 5.1 WebSearch：Brave 风格 schema 的 hosted API

```js
// cli/dist/codebuddy.js — WebSearch 工具
WEB_SEARCH_API_PATH = "/agenttool/v1/search"; WEB_SEARCH_TIMEOUT_MS = 2e4;
lQ = z.object({
  query: z.string().min(2),
  allowed_domains: z.array(z.string()).optional(),   // 只含这些域
  blocked_domains: z.array(z.string()).optional(),   // 排除这些域
  freshness: z.string().regex(/^(?:d(?:[1-9]|[12]\d|30)?|m(?:[1-9]|1[0-2])?|y[1-5]?)$/)
    // d1=今天, m1=本月至今, y1=今年至今, N 省略默认 1
})
```

请求带 `X-Agent-Intent: meta["codebuddy.ai/mode"] ?? "craft"`（服务端知道搜索发生在什么模式）；结果 `{provider, results[{title,url,snippet}], total_results, response_time_ms}`，格式化成 `# Search Results for "…" → ## [title](url) + snippet + **URL:**`，末尾注 `Provider: X • Search performed on YYYY-MM-DD`。**provider 由服务端返回**（客户端不感知底层引擎），`searchType: "text2text"`。整个客户端实现约百行——与 Codex 的 hosted web_search 同构，但 schema 是 Brave 参数风格 + freshness 中文场景友好的 d/m/y 语法。

### 5.2 WebFetch：远端/本地竞速 + 按需 LLM 提炼（最值得抄的单个工具）

流程（`cli/dist/codebuddy.js` lS 类）：
1. URL 归一化：http→https，`github.com/*/blob/*` → `raw.githubusercontent.com`。
2. 安全：`assertUrlAllowed` = 私网/回环/链路本地 IP 检查 + 威胁域名库（`ThreatDomainChecker`/Galileo），命中抛 `MaliciousWebsiteBlockedError` 并写审计日志+埋点；缓存命中也要重过安全检查。
3. **竞速**：`fetchContentViaApi`（POST /agenttool/v1/webfetch，20s 超时）与 `fetchAndProcessLocally`（undici + cleanHtml 去 script/style/noscript + turndown 转 MD）Promise.race，远端先回用远端；远端失败/超时落地本地；本地发现恶意域会 abort 远端请求。
4. 预算：>100k 字符截断；>15k 标记 `needsSummary=true` → 交给隐藏 agent `contentAnalyzer` 按 `prompt` 参数提炼（"content-analyzer-prompt"），否则原样返回。
5. 缓存：static Map，TTL 15min（9e5ms），带 needsSummary/finalUrl。
6. `CODEBUDDY_DISABLE_WEB_FETCH_REMOTE_API` 可强制纯本地（降级开关）。

### 5.3 agentic_search：hosted agentic search（SSE 进度流）

desktop 侧工具（`main/server.js` agentic-search-tool.ts），**deferred**（ToolSearch 才可见）：

- 调用：`POST {endpoint}/agenttool/v1/agentic_search`，body `{query, search_mode: 2(PRO), stream: true, biz_via: internal|public}`，300s 兜底 AbortController。
- **SSE 事件协议**：`tool_call`（`🔍 Calling {tool}({agent})`，带 agent 名区分主/子代理）→ `tool_result`（`✅ {tool} returned {items_count} results`）→ `done`（`synthesis.content` 即最终摘要）。前端只报进度不透传中间结果——**中间检索内容不进主对话 context**。
- 定位描述写得很诚实："目前仅金融投资主题…昂贵（延迟+资源）…简单查询用 websearch"；并对**委派 query 做 prompt 约束**：必须一句话高层意图（含标的/代码），禁止字段清单/表格格式/多子任务/"尽可能全面"这类扩范围措辞，过滤排序表格化"must be handled by the main agent after receiving the summary"。这是控制 hosted 搜索成本的优秀 prompt 工程样例。
- 进度映射到桌面 UI 的进度消息（seq 自增，无总步数）。

### 5.4 其余检索面

- `conversation_search`（云记忆 Layer1）：POST /api/memory/search，服务端排序，结果带 time_range；prompt 片段强调"查询必须自包含，工具看不到当前对话"；queryHash 打日志（脱敏）。
- 代码内搜索：Grep 工具即 rg（`cli/vendor/ripgrep` 12M 全平台内置 + ripgrep.node），Glob 文件名匹配；无本地向量/embedding 检索，语义检索全部云端化。
- 开放式代码库探索：`<tool_usage_policy>` 指示"broad codebase exploration 用 Agent(Explore) 子代理省 context"——与 Claude Code 同款做法。
- 资料库（library 技能）：Tencent Docs/space 体系的站内检索（manage/entry.md 全局搜索），属于产品内数据源而非公网搜索。

### 5.5 deep-research 引擎（纯 prompt 状态机，可直接借鉴）

`builtin-plugins/tencent-docx/core/engines/deep-research/engine.md`（11.8k 字符）：6 步状态机 Decompose→Search→Extract→Reflect→Decide→Snapshot，`max_loops` 硬上限，达上限降级 `MAX_LOOPS_DEGRADED` 不阻塞主流程。两条硬规则：Extract 必须产出 `{fact, source, tier, dimension, timestamp}` 结构化事实（无 source 的事实剔除），Reflect 必须**逐条回答 6 问**（不允许合并回答）：

| # | 自问 | 量化判据 |
|---|---|---|
| Q1 | 事实数量达标吗 | ≥ min_facts_required |
| Q2 | 必搜维度覆盖吗 | 每个 search_dimensions ≥1 条事实 |
| Q3 | 权威源足够吗 | Tier1 ≥1（政官网/统计局/顶会；T2 白皮书/咨询；T3 搜索引擎/社媒） |
| Q4 | 时效性达标吗 | ≤2 年（政策法规 ≤1 年） |
| Q5 | 冲突处理了吗 | 多版本冲突必须显式标注 |
| Q6 | 后续能用吗 | 预演生成阶段能否写出每维度 What/Why/Next |

`gap_check_strict: strict` 时 6 项全过才 EXIT，`relaxed` 只要求 Q1-Q4；CONTINUE 时只针对未通过项生成追问词（≤3 个且更具体）。快照落盘为固定 Markdown 结构（维度覆盖表/事实清单/信息缺口/循环轨迹），供下游 expert 直接消费。

## 6. 上下文管理

- **窗口预算**：模型元数据 `contextWindow.supportedLengths/defaultLength` + `maxInputTokens` 归一出 budget；auto-compact 窗口默认 200k，clamp [100k, 1M]。
- **三种 compact**（`cli/dist/codebuddy.js`）：`user-command`（/compact）、`pre-message-auto`（发下一条消息前若超 pre-message 阈值先压缩，可用 product config `enablePreMessageCompact` 或 ContextSummaryAgent 开关）、`emergency-auto`（阈值默认 0.7，可 env 覆盖；另有 engineering sufficiency 0.15——摘要至少保留 15% 有效信息量之类的工程阈值）。compact 由隐藏 agent（compact/contextSummary）执行，meta 带 compactType/compactContinueInProgress，支持 compact 期间继续排队输入。
- **prompt 组装是有序管线**：输入处理器带优先级（Env=2000、UserInput=1900、TeamResumeIntent=1775、ConditionalRules=1740、PreMessageCompact=1650、AgentSwitch=1600…InitialPrompt=1000），system-reminder 注入（CODEBUDDY.md 项目记忆 → system-reminder-md 模板）也在管线内。
- **记忆三层**（`prompt-common/fragments/workbuddy-memory-system.md`）：云 profile（服务端生成、只读、session 开始注入 `<memory>` 块）+ conversation_search（历史事件回忆）；用户级 `~/.workbuddy/MEMORY.md`（显式规则，4k 字符/session 上限）；工作区 `.workbuddy/memory/YYYY-MM-DD.md` 日志（append-only）+ `MEMORY.md`（3k/session），**30 天以上日志按主题蒸馏进 MEMORY.md 后删除**。"写什么"由 prompt 硬规则驱动（完成任务必须 append）。
- **子代理输出隔离**：AgentTaskOutputFileManager 落盘 + TaskOutput 按需取回，subagent 全量中间过程不占主 context。

## 7. 模型路由

- **模型目录在服务端**：`/config/models` 下发，ProductManager `waitConfiguration()`；`/model:*` 命令按 tags 过滤（TEXT_TO_IMAGE/IMAGE_TO_IMAGE/TEXT_TO_VIDEO…），支持 disabled+disabledReason 下架机制。
- **Auto 档**：`fast-model / balanced-model / deep-model` 三个占位 id，prompt 模板显示为 "Auto"——**档位路由在服务端网关做**，客户端只见占位符。
- **副业小模型**：contentAnalyzer/terminalTitleGenerator/summaryGenerator/autoModeClassifier 等隐藏 agent 各自路由；reasoning 补充表（REASONING_SUPPLEMENTS）按模型 id 配 `canDisableThinking/defaultEffort(high)/supportedEfforts`（覆盖 gpt-5.x/o3/o4 全家）。
- **传输**：自家网关（Bearer + X-* 头），OpenAI chat/completions 兼容协议 + 流式；代码内可见 anthropic/openrouter/gemini/deepseek/qwen/kimi/hunyuan 痕迹（多供应商目录/适配层）。IDE 补全（NES）单独模型 key（inlineCompletionModel）。

## 8. 设计取舍

1. **壳与内核解耦**：Electron 壳 5.4.2 与 CLI 内核 2.132.0-dev 版本独立，agent 能力可单独灰度/热更；代价是双份运行时（node_modules 401M + cli 154M）。
2. **Claude Code 血统 + 工作端化**：hook 名、AskUserQuestion/EnterPlanMode/Skill/SKILL.md、CODEBUDDY.md(=CLAUDE.md)、permission mode 全套兼容；增量在 present_files/experts/automations/Visualizer/IM 回复（WeChatReply/WeComReply/Slack/钉钉/QQ 依赖都在 package.json）——**把 coding agent 通用化成"办公 agent"**。
3. **搜索智能服务端化，客户端保底**：agenttool 三兄弟都走网关；WebFetch 留本地竞速降级（还有 env 开关），agentic_search 干脆纯 hosted。
4. **工具面预算化**：defer + MiniSearch + 字符预算 + overlay，而不是无脑全量 prompt；代价是引入 DeferExecuteTool 的"换票"复杂度。
5. **安全优先**：brokered sandbox/shim、威胁域名库、SSRF 守卫、TuringShield/qimei、内容合规段（content_policy 直接写在 system prompt）。
6. **可观测性偏执**：每条链路有埋点（含"恶意域名命中埋点失败（已忽略）"这种细节）、perf 报告 HTML 拖文件即渲染、SSE 300s 兜底、prewarm、孤儿回收。

## 9. 对我们搜索工具的启发

1. **接口形态学 agentic_search**：如果我们的搜索工具做成"研究型搜索"，就提供 `{query} → SSE(tool_call/tool_result 进度) → done(synthesis)` 的 hosted 形态；中间检索不进调用方 context，只回摘要+进度。同时像它一样在工具描述里写清"何时不要用我"（简单查询走普通搜索）与**委派 query 的改写约束**（一句话意图、禁 checklist/禁扩范围、后处理归调用方）。
2. **WebFetch 竞速模板**：本地 fetch（去噪+turndown）与远端渲染/解析 API Promise.race 互为降级；`>15k 才提炼` 的按需 LLM 加工、15min URL 缓存、>100k 截断、github blob→raw 重写——这套阈值可以直接搬。
3. **参数设计**：`freshness d[N]/m[N]/y[N]` + allowed/blocked_domains 是比我们的日期过滤更好用的 API 面（正则即文档）。
4. **工具检索**：工具多时用 MiniSearch（prefix+OR+name boost 2，topK 5）+ 每工具 `defer_loading` 标记 + **摘要字符总预算**；再补 overlay（模式级强制 defer/禁 defer）与按 server 增量换索引两个工程细节。与 Codex 的 BM25 方案二选一即可，MiniSearch 体积更小。
5. **反思协议**：deep-research 的 6 问量化自问 + strict/relaxed + max_loops 降级 + 结构化事实（fact/source/tier/dimension/timestamp），是比"搜后反思"更硬的 ReAct 节拍器，适合做我们搜索 agent 的迭代终止判定（可简化成 Q1/Q2/Q3/Q4 四问）。
6. **分层记忆**：云 profile（隐式）≠ 用户显式 MEMORY.md ≠ append-only 工作区日志 + 定期蒸馏的写回策略，避免"记忆垃圾场"；conversation_search 的"查询必须自包含"约定值得写进我们工具的 usage 说明。
7. **头协议**：X-Conversation-ID/X-Agent-Intent/X-Agent-Type 这组头是服务端区分"谁在搜、什么模式在搜"的最小方案，我们自己搭编排层时照抄即可获得全程可归因的遥测。

### 槽点
- 三份 prompt.tpl 29,946 字节完全相同（code 与 work 胶囊未分化），模板工程有冗余。
- `eE=.7, eC=.5` 等魔法数遍地，bundle 可读性差（当然这是闭源 bundle 的常态）。
- WebFetch 本地分支 needsSummary 恒为 true（远端关闭时），说明本地分支不做长度判断直接送提炼——省了判断但多花 token。
- conversation_search 超时 600s（10 分钟）过长，SSE 兜底 300s 也偏宽。
