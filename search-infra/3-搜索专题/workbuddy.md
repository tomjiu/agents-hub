# WorkBuddy · 搜索专题

> **一句话**：WorkBuddy 的搜索三件套里藏着全场最值得抄的两个工程：**WebFetch 的"双路竞速"**（服务端和本地谁快用谁）和 **agentic_search 的"进度流 + 只回摘要"**（服务端多步搜索，中间过程看得见但永不进上下文）。

## 搜索三件套

### 1. WebSearch（服务端托管，约百行客户端）

客户端把请求发给自家网关 `/agenttool/v1/search`，返回 `{provider, results[{title,url,snippet}]}`——**provider 由服务端返回，客户端根本不感知底层用的什么引擎**（Brave 风格的参数 schema）。两个好细节：

- `freshness` 参数用 `d1/d7/m1/y1` 这种写法（今天/最近7天/本月/今年），正则即文档；
- 请求头带 `X-Agent-Intent`——服务端知道"这次搜索发生在什么模式下"，可按模式优化。

### 2. WebFetch（双路竞速，"最值得整段抄的单个工具"）

```
1. URL 归一化：http→https；github.com/xx/blob/yy → raw.githubusercontent.com（直接拿源码）
2. 安全检查：私网/回环 IP 拦截 + Galileo 威胁域名库（恶意网站库）——缓存命中也要重查
3. 双路竞速：远端渲染 API 和 本地抓取（undici + turndown 转 markdown）
   同时发，Promise.race 谁先回来用谁——互为降级，可用性翻倍
4. 预算：>100k 字符截断；>15k 才触发小模型提炼（contentAnalyzer 按 prompt 提炼），
   否则原样返回 ← 按需加工，小活不劳驾大模型
5. 缓存：15 分钟 TTL
```

本地发现恶意域名时，还会主动中止已发出的远端请求。

### 3. agentic_search（服务端多步搜索，SSE 进度流）

这是"hosted deep search"的产品形态：

- 客户端发 `{query, search_mode: 2(PRO), stream: true}`，300 秒兜底超时；
- 服务端 agent 自主多步搜索，客户端通过 SSE 收进度事件：
  `tool_call`（正在调某工具）→ `tool_result`（某工具返回了几条）→ `done`（最终 synthesis 摘要）；
- **前端只报进度，不透传中间结果——中间检索内容永不进主对话上下文**。调用方只拿到一段综合摘要。

成本意识也做进了提示词：工具描述诚实写着"目前仅金融投资主题、昂贵（延迟+资源）、简单查询请用普通搜索"；还**约束调用方怎么写 query**：必须是一句话高层意图，禁止字段清单/表格格式/多子任务/"尽可能全面"这类扩范围措辞——**控制托管搜索成本的 prompt 工程范本**。

## 其他检索面

- `conversation_search`：云端记忆检索（历史对话），约定"查询必须自包含，工具看不到当前对话"；
- 代码搜索：Grep = 内置 ripgrep（12MB 全平台），无本地向量——语义检索全云端化。

## 值得我们抄的清单

| 抄什么 | 为什么 |
|--------|--------|
| Promise.race 双路竞速 | 可用性翻倍，本地腿免费保底 |
| `>15k 才提炼` 的按需加工 | 小模型加工是成本，按需触发 |
| github blob→raw 重写 | 一行代码，抓 GitHub 源码免渲染 |
| 威胁域名库前置 + 缓存命中也重查 | 安全检查不因缓存打折 |
| agentic_search 的 SSE 事件协议（tool_call/tool_result/done+synthesis） | 我们 REST+SSE 接口的直接模板 |
| 委派 query 的改写约束（一句话意图、禁扩范围） | 防止 deep search 被滥用成普通搜索 |
| freshness d/m/y 参数 | 比日期过滤好用的 API 设计 |

## 别学的坑

- conversation_search 超时 600s、SSE 兜底 300s——都偏宽，挂住的请求会占资源；
- 本地分支的"需要提炼"标记恒为 true（不做长度判断直接送提炼）——省了判断多花 token。

## 证据指路

- 原始报告：`reports/07-workbuddy.md`（§5 搜索实现）
- 硬证据：`analysis/workbuddy/code/cli/dist/codebuddy.js`（WebSearch schema、WebFetch 竞速逻辑 lS 类）、`main/server.js`（agentic-search-tool.ts、SSE 事件）
