# deep — gpt-researcher / STORM / Morphic 三框架源码解剖（2026-09-03，v0.8 纳入依据）

> 触发：用户"本想推荐 gpt-researcher/STORM/Morphic 那就分析分析，初始阶段有用的设计就纳入"。
> 方法：三仓浅克隆（`analysis/*/source/`，gitignore 不入 git）+ 三路并行精读 + 主线抽查验证关键行号。
> 结论先行：**抄了 4 件进 v0.8（全部已落地+测试），明确不抄 6 件（其中 2 件反向验证了我们已有的更强设计）**。

## 一、gpt-researcher（assafelovic/gpt-researcher，29.3k★/3,109 commits，Apache-2.0）

### 机制（file:line 均已抽查验证）

| 机制 | 证据 | 内容 |
|---|---|---|
| RETRIEVER 抽象 | `gpt_researcher/retrievers/base.py:35-51` | ABC 只约定 `search(max_results=7) -> List[Dict]` + `requires_scraping` 声明属性；子类化非必需（duck-typing 只查属性）。`True`=返回待抓 URL，`False`=自带 raw_content 直通 |
| RETRIEVER env | `config/config.py:78-84,189-202` + `actions/retriever.py:140-166` | 环境变量逗号拆分+白名单校验；工厂 match-case 在 `retrievers/utils.py:38-125`（含 `case "mcp"`） |
| MCP retriever | `gpt_researcher/mcp/client.py:68-81` + `tool_selector.py:37` + `research.py:158-200` | 传输按 URL scheme 自动判定（wss→websocket / http→streamable_http / 否则 stdio）；**工具选择靠 LLM**（从全部工具挑 ≤3 个）；结果归一化 `structured_content.results → {title,href,body}` |
| plan/exec 分工 | `actions/query_processing.py:158-215` + `skills/researcher.py:380-387` | planner 产子查询（**默认 3 条**=MAX_ITERATIONS），同一 researcher 内 `asyncio.gather` 并发跑子查询 |
| deep research 拓扑 | `skills/deep_research.py:244-249,426,534-536` | breadth=3/depth=2/concurrency=4，每分支新建 GPTResearcher，Semaphore 限流，递归 `breadth//2` |
| 报告类型 | `utils/enum.py:21-27` | research/resource/outline/custom/detailed/subtopic/deep 七类——**没有按类型的预算表**，差异全在运行拓扑+配置散件里 |
| 引用机制 | `prompts.py:280-310` + `actions/markdown_processing.py:117-122` | **无编号系统**，靠 prompt 强制 markdown 超链接 + "不得引用信息之外来源"的约束；References 由 visited_urls 确定性追加 |

### 裁决

- **✅ 抄了（v0.8 已落地）**：`RETRIEVER=mcp` 思想 → `core/src/providers/mcp-connector.ts`（外部 MCP 搜索连接器，keySlot 语义同 tavily）；报告类型预算化 → `RESEARCH_PRESETS`（summary/report/deep 显式预算表，比原家"拓扑散件"更可审查）。
- **✅ 抄了（改法不同）**：MCP 工具选择原家用 LLM 挑 ≤3 个；我们无 LLM，改显式配置 tool 名 > 名称/描述启发式（/search|query|web|find/ 权重+平手取短名）——确定性可测试。
- **❌ 不抄 + 反向验证**：原家引用只靠 prompt 约束、无出口校验——我们 `citations.ts` 的 [n] 100% 可回溯 strict/strip 机制**更强**，这条是"我们做对了"的确认而不是要学的。
- **❌ 不抄**：requires_scraping 声明（我们是 search/fetch 分离架构，天然对应）；递归 deep 拓扑（我们用预算表替代，简单可预算）。

## 二、STORM（stanford-oval/storm，31.2k★/238 commits，MIT，2025-09 后渐冷）

### 机制（file:line 均已抽查验证）

| 机制 | 证据 | 内容 |
|---|---|---|
| persona 生成 | `storm_wiki/modules/persona_generator.py:48-65,134-155` | 先找相关维基页抓 TOC 作示例 → LLM 生成视角（"一群维基编辑各代表不同 perspective/role"）；**默认 3 persona + 强制前置 "Basic fact writer" 兜底**=4；数据结构纯字符串 List[str] |
| 大纲两段式 | `storm_wiki/modules/outline_generation.py:84-125,153-167` | ①仅凭 topic 生成 draft outline ②persona 对话拼进 prompt 生成 refined outline；Markdown #/## 层级 → ArticleSectionNode 树（`storm_dataclass.py:437-474`） |
| 节名即 query | `article_generation.py:104-110` | 每个一级节的检索 query = 该节子树所有节名拼接——大纲结构直接驱动检索 |
| 引用回填 | `storm_dataclass.py:174-207,267-288` + `utils.py:374-412,440-447` | URL 粒度全局编号；正文未出现的引用删号、超编号删（幻觉编号直接被删）、按出现顺序重排；**引用不足无补搜机制**（节检索为空就裸写、空节被剪掉） |
| Co-STORM | `collaborative_storm/modules/information_insertion_module.py:16-36` | 多专家+模拟用户+主持人轮流发言，信息实时挂到共享层级 mind map，节点满自动扩展 |

### 裁决

- **✅ 抄了（v0.8 已落地，STORM-lite）**：强制兜底视角 → `selectAngles()` 的"定义与概念永远保留"（basic fact writer 的规则版）；视角模板池 + 按查询信号选择（signals 正则命中优先，池序补满到 5，`core/src/research.ts`）；大纲骨架 → `buildOutline()`（角度即节 + 逐节 facts/tier1/来源域统计，进 ResearchResult.outline 三出口）。
- **⚠ 诚实边界**：STORM 真身是 LLM 生成 persona + 大纲对话增强；我们无 LLM 硬依赖，只能做**确定性模板近似**——"STORM-lite"名字就是这么来的，不是复刻。
- **❌ 不抄 + 反向验证**：引用不足不补搜、空节裸写——我们 6 问反思门（Q2 覆盖率驱动 CONTINUE 追问）**更强**，又一处确认。
- **❌ 不抄**：Co-STORM mind map（多轮 LLM 对话架构，超出 headless core 定位）；节间无信息复用是他们自己的弱点（我们的 fetchSlot 公平轮转已覆盖同题）。

## 三、Morphic（miurla/morphic，9.1k★/1,820 commits，Apache-2.0，持续活跃）

### 机制（file:line 证据）

| 机制 | 证据 | 内容 |
|---|---|---|
| Quick/Adaptive 分档 | `lib/agents/researcher.ts:100-121` + `lib/agents/prompts/search-mode-prompts.ts:43-71,230-241` | 差异在**工具集+轮数+提示词**（quick: 强制 1 次 search/20 步；adaptive: ~20 次工具调用/50 步），不改引擎集合 |
| 检索源抽象 | `lib/tools/search/providers/base.ts:3-15` + `lib/types/index.ts:4-12` | `search(query,maxResults,depth,include/excludeDomains)` 接口 + 统一 `{title,url,content}` 归一化 |
| SearXNG 集成 | `lib/tools/search/providers/searxng.ts:22-56` | GET JSON API；advanced→engines=google,bing,ddg,wikipedia + safesearch=0；basic→限 engines+time_range=year；**无 language 参数**（我们已有） |
| 服务端小件 | `advanced-search/route.ts:28-136`（Redis 缓存 TTL 3600 读写吞错）/ `lib/utils/safe-fetch.ts:140-305`（SSRF 拒私网+**5 跳重定向逐跳校验**）/ `route.ts:436-503`（相关性打分：整词/标题/新鲜度/长度） | 各自独立可用 |
| 不存在的 | — | 无去重、无 LLM query 改写（明说"不改写"） |

### 裁决

- **✅ 同构确认（不新增代码）**：Quick/Adaptive 分档与我们的 complexity 路由 + v0.8 preset 同构——我们做成了显式预算表，口径更清楚。
- **❌ 不抄**：生成式 UI（headless 不适用）；Redis 缓存（我们 FTS5 本地方案已落地且更轻）；相关性打分（我们 RRF+词法+语义双阈值更完整）。
- **📋 记账不实现**：safe-fetch 的 5 跳重定向逐跳 SSRF 校验——我们 SSRF strict 模式已有，重定向逐跳细节列为 fetcher 后续候选（targets-search v0.8 候选块）。

## 四、v0.8 纳入清单核销

| 纳入 | 来源 | 落地 | 测试 |
|---|---|---|---|
| mcp-connector provider | gpt-researcher RETRIEVER=mcp | `src/providers/mcp-connector.ts`（stdio+streamable HTTP 双传输/懒连接/失败清理防子进程泄漏/三形状归一化/空结果抛错） | v08.test 6 项（真子进程 stdio 全链路） |
| 预算预设表 | gpt-researcher 报告类型 × Morphic Quick/Adaptive | `RESEARCH_PRESETS` + ResearchOptions.preset，MCP/CLI/REST 三出口 | v08.test 1 项 + probe-v08 真网络 summary 档 7.6s |
| STORM-lite 角度 | STORM persona_generator | `selectAngles()`（强制定义与概念+信号选择+池序补满） | v08.test 3 项 + probe-v08 信号命中 |
| 大纲骨架 | STORM outline_generation | `buildOutline()` 进 ResearchResult.outline + 三出口 | v08.test 1 项 + probe-v08 实测结构 |

代价记录：测试过程抓到 3 个真 bug 并修掉——① 启发式选工具把 0 分工具也选上（阈值改 >0）② build 脚本 `cp -r` 嵌套目录陷阱（fixtures 拷两份）③ fixture 把 JSON-RPC id=0 当 notification 丢弃（falsy 陷阱，SDK 客户端 id 从 0 起）；另发现连接失败路径不关 client 会泄漏 stdio 子进程钉死测试进程——全部修复，154/154。
