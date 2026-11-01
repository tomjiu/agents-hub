# local-deep-research 深挖精读（P1 / Task 12-a）

> 精读日期 2026-09-03，全部结论基于 GitHub main 分支源码（API + raw.githubusercontent.com 实拉）。
> 我们带着三个问题读：① pipeline 与 agent 策略怎么切换的？② 什么时候换 arXiv/PubMed 学术源？③ 引擎怎么管理、免 key 引擎怎么用？

## 一、体检

| 项 | 值 |
|----|----|
| 仓库 | LearningCircuit/local-deep-research（Python，src/local_deep_research/） |
| ★ / fork | 9,023 ★ / 801 fork |
| commits | 7,643（最后一条 2026-09-02：fix(export) ODT 元数据处理 #5997） |
| 最后 push | 2026-09-02（体检前一天） |
| archived | 否；open issue 752 |
| **活死判断** | **非常活跃**——每天多个 commit，issue 数百在流转，迭代速度在同类里排第一梯队 |

## 二、它是什么

本地优先的 deep research 全家桶：FastAPI Web 界面 + 多种研究策略（管道式/迭代式/agent 式）+ 30 来个搜索引擎适配器（含 arXiv/PubMed/OpenAlex 等学术源）+ 本地文档库 RAG + 新闻订阅 + 报告导出。全程可接本地 LLM（Ollama/llama.cpp），卖点是"一切本地且加密"。对我们来说它是"策略开关做得最全"的同类项目——研究方式不是写死的一条管道，而是五档策略随便选。

## 三、精读发现（源码级证据）

### 3.1 策略开关：不是"自动判定"，是"用户显式选 + agent 内部自适应"

- **策略清单**：`src/local_deep_research/constants.py:124-150` 的 `AVAILABLE_STRATEGIES` 是 UI 下拉的唯一定义点，5 档：
  - `source-based`（标签原话 "Best for small <16,000 context window"）
  - `focused-iteration`（快问快答档）
  - `focused-iteration-standard`（"Needs >16,000 context window"）
  - `topic-organization`（按主题聚类）
  - `langgraph-agent`（自主 agent 档）
  注意**策略标签里直接写了适配条件（上下文窗口大小）**——把"什么情况用哪档"写在 UI 上，而不是藏在代码里。
- **工厂**：`search_system_factory.py`（全文 402 行）`create_strategy()` 按名字分发，允许别名（`mcp`/`agentic` 已在 #4548 删除，匹配到就 logger.warning 然后路由到 `langgraph-agent`，见 342-352 行），**未知策略兜底到 source-based**（385-402 行）。
- **默认值链**：`research_service.py:1051-1053` 从设置读 `search.search_strategy`，默认 `"source-based"`；`search_system.py:78` `AdvancedSearchSystem.__init__` 同默认。
- **关键结论：没有"pipeline vs agent 自动判定器"**。策略是用户显式选的；"自适应"发生在 agent 策略内部——LLM 自己决定调哪个引擎工具（见 3.2）。
- **反面教训（他们自己踩过）**：`constants.py:24-33` 注释原话——老的默认搜索引擎是 `"auto"`（自动选引擎的元引擎），散落在约 30 处的字面量，"meta engines were removed"（元引擎被整个删掉）后要一处一处猎杀。现在的默认值 `DEFAULT_SEARCH_TOOL: str = "searxng"`（33 行）是代码级单一事实源，还配了测试 `tests/test_constants.py::test_default_search_tool_matches_registry` 防漂移。**自动选引擎的隐式层他们做过后删了**。

### 3.2 什么时候换 arXiv/PubMed：引擎自我描述 + LLM 选工具，两件套

非 agent 路径里引擎是用户手动选的（`search.tool` 设置）。agent 路径里"换学术源"的机制是：

1. **引擎自带 strengths/weaknesses 元数据**（`defaults/default_settings.json`）：
   - `search.engine.web.arxiv.strengths = ["scientific papers", "academic research", "physics", "computer science", "mathematics", ...]`，`weaknesses = ["non-academic topics", "consumer products", "news", "general information"]`
   - `search.engine.web.pubmed.strengths = ["biomedical literature", "medical research", "clinical studies", ...]`
   - 还有 `reliability` 数值：pubmed 0.98 / searxng 1.0 / arxiv 0.9
2. **元数据拼进工具描述**：`langgraph_agent_strategy.py` 的 `_load_specialized_engine_tools()`（1263 行起）把每个合格引擎包成 `search_{engine}` 工具，description = 引擎 description + `Best for: {strengths[:2]}`（1405-1408 行，原话 `desc += f" Best for: {', '.join(strengths[:2])}."`）。
3. **系统提示词点名**：agent 的研究提示词（2644 行）明写 "(search_arxiv for science, search_pubmed for medical, etc.)"。
4. **学术引擎的 LLM 加工**：pubmed 在 default_settings.json 里配 `requires_llm: true`，`optimize_queries: true` / `max_mesh_terms: 3` / `max_keywords: 3` 是引擎构造函数默认值（`search_engine_pubmed.py:40-52`）——用 LLM 把自然语言问题改写成 MeSH 医学词表查询（提示词原话 "Use only BASIC MeSH terms"，260 行），这是学术源特有的一步。

**即：换不换 arXiv 由"读工具描述的 LLM"判断，不由关键词分类器判断。**

### 3.3 engine 管理

- **硬注册表**：`web_search_engines/engine_registry.py`（164 行）——`ENGINE_REGISTRY: Dict[str, EngineEntry]` 冻结 dataclass，名字→module_path/class_name，29 个引擎一条不落；注释明确"这是内部接线不是用户配置"。
- **动态合并**：`search_engines_config.py` 的 `search_config()` 把 ①default_settings.json ②用户数据库设置 ③LangChain retriever 注册表 ④library RAG（`search.engine.library.enabled` 控制）⑤动态 `collection_{id}` 文档集合引擎 合并成一张表；`_extract_per_engine_config()` 把平铺 key（`search.engine.web.arxiv.max_results`）拆成嵌套 dict。
- **引擎元数据字段全集**：`requires_api_key` / `requires_llm` / `use_in_auto_search` / `agent_enabled` / `reliability`(0-1) / `strengths` / `weaknesses` / `supports_full_search` / `display_name` / `default_params`。
- **两层开关解耦（#5015）**：`use_in_auto_search` 管"非 agent 的自动搜索面"，`agent_enabled` 管"agent 工具面"。`_load_specialized_engine_tools` 的注释原话：两个开关是同一设置页上的兄弟项但管两个不同面，混用导致"没法只给 Tavily/Google PSE（默认 `use_in_auto_search=false`）开 agent 面"。**这个解耦对我们有直接参考价值。**
- **免 key 引擎清单**（`requires_api_key=false` 且默认可用）：wikipedia / wikinews / arxiv / pubmed / searxng / wayback / openalex / semantic_scholar / gutenberg / openlibrary / pubchem / stackexchange / zenodo 等。`use_in_auto_search=true` 的免 key 引擎：arxiv / pubmed / searxng / wikinews / wikipedia；key 引擎（brave/exa/serpapi/tavily/google_pse/mojeek）默认全是 `false`——**key 引擎不进自动搜索面**，与我们 key 插槽的"自动并联"路线不同，他们更保守。
- **UI 分组**：`engine_groups.py` 分组带 `favorites / collections / academic / local_rag / books / code / news / no_api_key / api_key`——**"No API key"是 UI 一等分组**，免 key 是产品意识不是隐藏属性。

### 3.4 学习式限速器（同类里没见过的设计）

- `web_search_engines/rate_limiting/tracker.py`（842 行）`AdaptiveRateLimitTracker`（48 行起）：
  - 每个引擎记最近 100 次尝试（LRU），**初始乐观 0.1s**（SearXNG 自托管按 0.1s 乐观默认）；
  - **10% exploration 概率试更快**：`base × uniform(0.5, 0.9)`（探测上游限流是否放松）；否则 exploitation：`base × uniform(0.9, 1.1)` 抖动（283-300 行附近）；
  - `record_outcome` → `_update_estimate`（392 行起）：成功等待取**下中位数**，EMA 更新 `new_base = 0.7×old + 0.3×new`（learning_rate 0.3）；全失败 → `max(失败等待)×1.5` 封顶 10s；下限 0.5×base、上限 3×base 且绝不超过 10s；confidence = min(样本数/20, 1)；
  - profile 三档（conservative/balanced/aggressive）调 exploration/learning；估算值**持久化进数据库**，`decay_per_day 0.95` 每天衰减；按查询失败/成功质量还能出"搜索质量统计"（`get_search_quality_stats`，708 行）。
- `web_search_engines/engines/_searxng_rate_limiter.py`（132 行）：**进程级 per-instance_url 节流**。因为 agent 每次工具调用都新建引擎实例（per-instance 的 `last_request_time` 失效），所以 keyed by SearXNG `instance_url`，meta-lock + per-URL 锁 + 时间戳；`MAX_TRACKED_URLS=1000`，满了按 LRU 淘汰，**正被持锁的 URL 永不淘汰**（淘汰注释里把竞态分析写得很清楚）。
- **引擎生命周期**：agent 模式下 `_make_web_search_tool`（1166 行）每次工具调用 `create_search_engine(...)` 新建引擎、用完 `safe_close()`——即用即弃，无连接池；节流靠上面两个全局跟踪器兜底。

### 3.5 其他值得记的细节

- `_scrub_tool_error`（`langgraph_agent_strategy.py:114`）：引擎异常消息回传给 LLM 前先脱敏——"引擎异常可能把带 API key 的请求 URL 嵌进去"，完整日志只留服务端。
- `SearchResultsCollector`（308-1058 行）：跨工具调用的统一结果收集器——引擎名+全局索引 [N] 编号、URL/snippet 双 key 去重、`_prefer_anchored_link`（锚定链接优先）。
- `focused-iteration` 策略默认参数（工厂 88-160 行）：max_iterations 8、questions_per_iteration 5、knowledge_summary_limit 10、snippet_truncate 200、previous_searches_limit 10、adaptive_questions 可开关。

## 四、它有我们没有的（对照 search-core v0.4）

| # | 它有我们没有的 | 裁决 | 理由 |
|---|---------------|------|------|
| 1 | **引擎 strengths/weaknesses 元数据 → 拼进 agent 工具描述**（"Best for: ..."，LLM 据此换学术源） | ✅ **值得抄** | 我们 MCP 出口目前只有一个笼统描述；给 provider 加 strengths 标签拼进工具描述，LLM 才知道什么时候该打 arxiv 什么时候该打 googlenews。改动小收益大 |
| 2 | **use_in_auto_search / agent_enabled 双开关**（自动搜索面与 agent 工具面解耦） | ✅ **值得抄** | 我们 enabled 单开关管所有面。真实需求存在：Tavily 插槽额度紧不该进自动面，但 agent 明确要查时应该能用。kinds（image/news）再加一个 `agent_only` 之类标志即可 |
| 3 | **错误消息脱敏后回传**（_scrub_tool_error，防 key 从 URL 漏进对话） | ✅ **值得抄** | 我们失败标注契约里 error 字段目前原样透传；加一步 scrub 是一行代码级别的防御 |
| 4 | AdaptiveRateLimitTracker 学习式限速（探索/利用+EMA+持久化） | ⏸ **暂不抄** | 我们 governor 固定间隔+熔断 2.0 已覆盖主要风险；但"10% 概率试探更快"这个点子记入 backlog——DDG 202 软封自愈场景正需要"探一下恢复没"的机制，我们的半开探针冷却翻倍是保守版 |
| 5 | per-URL 进程级节流（即用即弃引擎实例的修补件） | ⏸ **暂不抄** | 我们 router 引擎是长驻单例，天然没有这个问题；仅当未来做 per-call 实例化时需要补同款 |
| 6 | 策略五档 UI + 上下文窗口适配标签 | ⏸ **暂不抄** | 我们无 UI；思路记下：给不同预算/窗口的调用方推荐不同 research 档位（我们 Research Loop 参数已可分档） |
| 7 | 引擎 reliability 静态数值 | ❌ **不抄** | 我们的熔断状态+degraded 出勤率是动态版，静态数值是它出现前的旧产物 |
| 8 | 学术源 LLM 查询改写（PubMed MeSH 词表） | ⏸ **暂不抄** | 我们 v0.4 无 LLM；planner LLM 化之后，arxiv/crossref 接入"术语改写"一步有真实收益（学术检索词不口语化） |
| 9 | "auto" 元引擎被删的教训 | ✅ **值得记** | 自动选引擎的隐式层做过又删——口径散落 30 处的漂移成本；我们坚持"路由显式+可解释"（熔断 skip 带原因）方向正确 |

## 五、裁决

**抄三件**：引擎 strengths/weaknesses 元数据驱动 agent 自选引擎（工具描述拼装）、自动面/agent 面双开关解耦、错误回传脱敏——都是小改动大收益。**不抄**学习式限速（governor+熔断已覆盖，留"试探放松"一个点子进 backlog）和 reliability 静态数值。**最重要的收获是一个教训**：连 9k 星的同类头部项目都把"auto 自动选引擎"的元引擎删掉了换成显式默认+LLM 自选工具——我们别做隐式自动切换层，要切就把选择依据（strengths/熔断状态/额度）摆到 LLM 或日志可见的地方。
