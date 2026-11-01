# A-1 · AI 搜索成品类仓库扫描（GitHub 大规模扫描）

> 任务 7-a 产出。扫描日期：**2026-09-02**。
> 范围：开箱就能跑的 AI 搜索引擎 / answer engine / deep research 产品（Perplexica 的同类和衍生物）。
> 方法：GitHub Search API（PAT 认证，30 次/分钟限额，实际只发了 15 个搜索请求）+ commits Link header 技巧数 commit 总数 + 直接抓 README 核对搜索后端。
> 筛选：stars ≥ 100（个别放宽）；pushed_at 6 个月内算活跃，6 个月~1 年标"渐冷"，>1 年标"已死"（stars 极高的保留一句话提及）；AI 生成的空壳仓库直接过滤。

---

## 一、结论速览（大白话）

1. **整个赛道变成了三个物种**：① Perplexica 类"搜索引擎皮"（输入问题→SearXNG/Exa 搜→LLM 带引用回答）；② gpt-researcher/storm 类"报告机"（多轮规划→多路搜索→长报告）；③ SurfSense/wigolo 类"给 agent 用的搜索底座"（MCP/REST 工具，不给人类 UI）。对我们 search-core 最有营养的是第 ③ 类和第 ① 类里的免 key 玩法。
2. **"免 API key"已经是头部项目的默认卖点**：Perplexica（已改名 Vane）、morphic、local-deep-research 全部把 SearXNG 打包进 docker compose，装完即用零 key。这和我们 search-core 的理念完全同路，说明这条路是对的。
3. **迭代次数差距惊人**：活跃产品 commit 数都是几千级别（SurfSense 8846、local-deep-research 7641、khoj 5180），而一堆 2000+★ 的"Perplexity 克隆"只有 3~78 个 commit 就停更了——star 多不等于活得久，commit 数才是真命。
4. **Perplexica 已改名 Vane**（ItzCrazyKns/Vane，36.6k★，1009 commits），仓库描述、部署模板名（perplexica）都还能看到前身痕迹；周边已经长出 MCP server、手机客户端、docker 镜像镜像站等衍生物。
5. 纯"克隆 Perplexity"的玩法 2024 年就卷死了（omniplex/clarity-ai/Gemini-Search 全部断更 1~2 年）；2026 年还活着的都在往 **多源（Reddit/X/YouTube）、多策略（快答 vs 深研）、MCP 化** 三个方向卷。

---

## 二、主表 A：活跃主力（pushed 6 个月内）

| full_name | stars | forks | pushed_at | commits | license | 它是什么 | 搜索后端 | 架构亮点 | 对 search-core 的借鉴 |
|---|---|---|---|---|---|---|---|---|---|
| bytedance/deer-flow | 81,263 | 11,198 | 2026-09-02 | 3,117 | MIT | 字节的开源 super agent harness（1.x 是 deep research 框架，2.0 推倒重写） | BytePlus InfoQuest 自家搜索工具集，可选 Tavily（要 key） | LangGraph checkpointer+Store 共用 postgres；子 agent+沙箱+技能体系 | 报告机路线的工业级参照：checkpointer 持久化研究状态的做法值得看 |
| ItzCrazyKns/Vane（原 Perplexica） | 36,587 | 4,066 | 2026-09-01 | 1,009 | MIT | 品类锚点：隐私优先的自托管 AI 回答引擎 | **SearXNG（免 key，docker 镜像直接捆绑）**，Tavily/Exa 在路上；Ollama 本地模型 | Next.js+LangChain.js；搜索历史本地存；-setup 向导引导配模型 | 免 key+SearXNG 捆绑分发是"开箱即用"的正解，跟我们同路 |
| khoj-ai/khoj | 36,963 | 2,443 | 2026-08-02 | 5,180 | AGPL-3.0 | AI 第二大脑（个人助理，web 回答是能力之一） | 多引擎 web 搜索+自有文档索引 | 5,180 commits 超长迭代；automation 定时研究任务 | "定时自动研究"（Lookouts 同类思路）值得 search-core 排期器参考 |
| stanford-oval/storm | 31,203 | 2,938 | 2025-09-30（渐冷） | 238 | MIT | 学术派报告机：写维基百科式带引用长文 | You.com API（YouRM）/Bing（要 key），rm.py 可插拔 | 两段式：pre-writing（多视角提问收集参考+大纲）→ writing；Co-STORM 协作模式 | "多视角提问扩展 query"是 planner 最该抄的学术招 |
| assafelovic/gpt-researcher | 29,259 | 3,968 | 2026-08-27 | 3,109 | Apache-2.0 | 最老牌的 deep research 产品，报告+引用+配图 | 默认 Tavily（要 key），`RETRIEVER=tavily,mcp` 可混合 MCP 检索源 | 并行化 agent 集群（plan+exec 分工）；RETRIEVER 环境变量即插拔 | 检索器抽象成一个环境变量/一个接口——router 该这么简单 |
| virattt/dexter | 27,565 | 3,409 | 2026-08-04 | 487 | 无 license | 垂直领域（金融）deep research agent | 自选数据源+web | 证明"垂类深研"比通用问答更有爆点 | 垂直域 query 模板（财报/行情）可以做 search-core 的 focus 包 |
| MODSetter/SurfSense | 16,056 | 1,536 | 2026-09-02 | **8,846** | NOASSERTION（自定义） | 开源 NotebookLM 平替，agent 的"活数据"平台 | 自建连接器：Reddit/YouTube/TikTok/Google SERP/Maps/Indeed 等结构化 REST | **每个连接器=带类型的 REST 端点，再统一用 MCP server 暴露成 `surfsense_*` 工具**；知识库带引用 | 把 provider 包成 typed tool 再 MCP 暴露——search-core 的 mcp.ts 可以照这个长 |
| dzhng/deep-research | 19,628 | 1,995 | 2026-04-11 | 77 | MIT | 最小可行 deep research（<500 行 LoC） | 搜索+抓取（Firecrawl 系，要 key） | **depth/breadth 两个参数控制研究广度深度**；迭代生成 query→消化→再深挖；follow-up 反问 | 500 行讲清楚研究循环，search-core 的 research.ts 精简版教材 |
| LearningCircuit/local-deep-research | 9,019 | 799 | 2026-09-02 | **7,641** | MIT | 全本地 deep research，~95% SimpleQA（单卡 3090+Qwen3.6） | **SearXNG（免 key）打底**+arXiv/PubMed/Semantic Scholar 学术源，Ollama 任意本地模型 | 多策略可切换：quick pipeline vs LangGraph agent 自适应选引擎、收集源更多；用公开 benchmark 驱动迭代 | 我们的对标样板：免 key+策略开关+benchmark 验收，三件套全齐 |
| zaidmukaddam/scira | 11,853 | 1,490 | 2026-08-12 | 777 | AGPL-3.0 | 17 种搜索模式的精致 AI 搜索（原 MiniPerplx） | **多路并行+去重：Exa/Firecrawl/Parallel/Tavily 混用**（多数要 key） | Extreme 模式=多步规划+代码执行+R2 存工件；Lookouts 定时监控邮件推送 | 17 个模式=垂直 query 模板库；"多引擎并行去重"我们 fusion 已有雏形 |
| miurla/morphic | 9,082 | 2,353 | 2026-09-02 | 1,820 | Apache-2.0 | 生成式 UI 的 AI 搜索引擎 | Tavily/Brave/Exa（要 key）或 **SearXNG（免 key，docker 默认捆绑）** | Generative UI：流式 JSON spec 渲染富组件答案，不止 markdown | "Docker compose 里自带 SearXNG=零 key 默认路径"的打包方式直接抄 |
| KnockOutEZ/wigolo | 4,852 | 366 | 2026-09-02 | 2,005 | NOASSERTION（自定义） | **给 coding agent 用的本地优先 web 工具箱（search/fetch/crawl/cache）** | **核心全免 key 无云**（本地引擎+本地模型可全离线），仅答案合成可选免费 Gemini key | **分层 fetch 路由：普通 HTTP→撞反爬自动升级 headless 浏览器**；本地 cache 可用关键词+语义查询 | 与 search-core 哲学最像的项目：免 key、本地优先、cache 即搜索面，逐条可抄 |
| u14app/deep-research | 4,682 | 1,061 | 2026-06-18 | 190 | MIT | 任意 LLM 的 deep research 报告机 | 联网搜索（跟随模型 grounding） | ~2 分钟出报告；SSE API+**MCP server** 双出口；thinking/task 模型分工 | "思考模型规划+便宜模型执行"的分工法和 SSE 出口值得参考 |
| MODSetter 系之外的企业向：xynehq/xyne | 680 | 63 | 2026-08-31 | 1,553 | Apache-2.0 | 开源 Glean 替代：企业内部搜索+回答 | 企业连接器为主，web 为辅 | TS 全栈；企业权限下做搜索合规的参照 | 企业权限模型暂不抄，但"连接器清单驱动"的配置可参考 |
| swirlai/swirl-search | 3,043 | 286 | 2026-08-25 | 4,958 | Apache-2.0 | 联邦式企业 AI 搜索（不动数据） | 100+ 数据源联邦查询 | 2022 年活到现在的老将，4,958 commits；"数据不搬家"架构 | 元搜索联邦调度思路与我们 fusion/xchain 相通 |
| memfreeme/memfree | 1,505 | 211 | 2026-07-06 | 760 | MIT | 混合 AI 搜索（web+自建知识库）+AI 页面生成 | Google/Exa/自有向量索引混合（要 key） | 多模态输入（图/文件/网页）混合检索 | "自有索引参与 web 搜索"的混合排序可以留档 |
| MiroMindAI/MiroThinker | 8,363 | 643 | 2026-07-06 | 162 | Apache-2.0 | 面向复杂研究/预测任务的 deep research agent（模型+框架） | 自研工具集 | 研究型模型权重+agent 框架一起开源 | 研究轨迹（trajectory）数据格式可参考 |
| 666ghj/BettaFish | 42,140 | 7,626 | 2026-09-01 | 1,035 | GPL-2.0 | 微舆：多 agent 舆情分析助手（中文爆款） | 自建多平台爬取+搜索，从 0 实现、不依赖框架 | 1,035 commits、GPL-2.0；舆情聚合 UI 完整 | 多平台"舆情面"聚合与去重思路对 xchain 有参考 |
| mvanhorn/last30days-skill | 60,970 | 5,326 | 2026-09-02 | 1,202 | MIT | agent 技能：研究任意话题最近 30 天的全网声量 | Reddit/HN/Polymarket/GitHub **免 key 直查**；X/YouTube/TikTok 靠 BYO 浏览器会话/密钥 | **并行搜多平台→按真实互动量打分→LLM judge 合成简报**；SKILL.md 即规格 | "平台数据各自免 key 入口+互动量排序"是我们 xchain 最该抄的选题 |
| BunsDev/perplexica-search-engine-ai | 318 | 28 | 2026-04-14 | 1,008 | MIT | Perplexica 镜像改名（commit 数 1,008 与上游几乎一致） | 同上游 SearXNG | 无独立演进，纯搬运 | 无需借鉴，仅作"改名潮"证据 |

## 主表 B：渐冷（6 个月~1 年没动静）与已死高星（保留一句话）

| full_name | stars | forks | pushed_at | commits | license | 一句话 | 状态 |
|---|---|---|---|---|---|---|---|
| Alibaba-NLP/DeepResearch | 19,907 | 1,527 | 2026-02-27（渐冷边缘） | 300 | Apache-2.0 | 通义 DeepResearch 开源模型+研究框架，"leading open-source deep research agent" | 渐冷边缘（刚过 6 个月线） |
| zilliztech/deep-searcher | 8,250 | 802 | 2025-11-19 | 212 | Apache-2.0 | 私有数据深研（Milvus 向量库+可选 Firecrawl 抓网） | 渐冷 |
| InternLM/MindSearch | 6,918 | 693 | 2025-07-04 | 56 | Apache-2.0 | 多 agent 搜索框架（类 Perplexity Pro），图式"WebPlanner"建模 | 已死（但思路常被引用） |
| firecrawl/fireplexity | 1,960 | 341 | 2025-08-22 | 10 | 未声明 | Firecrawl 官方 Perplexity 克隆（web/news/图+实时引用） | 已死（刚过 1 年线；本质是 Firecrawl API 的 10-commit 壳） |
| rashadphz/farfalle | 3,543 | 319 | 2024-09-27 | 258 | Apache-2.0 | 自托管 AI 搜索（本地/云 LLM 均可，Tavily/SearXNG） | 已死 |
| nashsu/FreeAskInternet | 8,748 | 906 | 2024-04-18 | 29 | Apache-2.0 | 完全本地免 key：SearXNG 聚合+本地 LLM 回答 | 已死（免 key 路线的早期旗帜） |
| supermemoryai/opensearch-ai | 1,329 | 199 | 2025-07-08 | 56 | 未声明 | 个性化 SearchGPT/Perplexity 克隆 | 已死 |
| nickscamara/open-deep-research | 6,281 | 744 | 2025-05-07 | 46 | NOASSERTION | Firecrawl 版 deep research 克隆（我们 reports/11 已逆向过） | 已死 |
| ammaarreshi/Gemini-Search | 2,069 | 412 | 2025-01-04 | 3 | MIT | Gemini grounding 版 Perplexity 克隆（3 个 commit） | 已死 |
| mckaywrigley/clarity-ai | 1,420 | 273 | 2024-03-28 | 18 | MIT | 最早的 Perplexity 克隆之一 | 已死 |
| Omniplex-ai/omniplex | 1,055 | 357 | 2024-07-07 | 6 | AGPL-3.0 | Open-Source Perplexity（6 个 commit） | 已死 |
| jjleng/sensei | 464 | 38 | 2024-10-20 | 103 | Apache-2.0 | 又一个开源 Perplexity | 已死 |
| Yusuke710/nanoPerplexityAI | 335 | 32 | 2025-01-24 | 25 | MIT | "最简 Perplexity 实现" | 已死 |

**边缘相关（不算搜索成品，只记一笔）**：Panniantong/Agent-Reach（77.5k★，给 agent 接 Twitter/Reddit/YouTube/B 站的读取工具）；anysearch-ai/anysearch-skill（6k★，agent 统一搜索技能）；browseros-ai/BrowserOS（13.5k★，开源 agentic 浏览器，对标 Comet/Atlas）；pipeshub-ai/pipeshub-ai（3.7k★，企业上下文层）。

**过滤掉的**：0~2★ 的新壳仓（blockgroot/RAG-Engine、RosterSeo、naktahu-AI、answershare 等）、api-evangelist/* 的 API 简介仓、面试题/awesome 清单、以及 meilisearch/qdrant/SeekStorm 这类**搜索基础设施**（不是 AI 回答产品，超出本篇范围，若做"搜索底座"扫描再单独立项）。

---

## 三、Top10 逐个点评

> 入选规则：对 search-core 的可借鉴度 × 健康度（commits/pushed_at）× 品类代表性。星数只是门票，不是排名。

1. **ItzCrazyKns/Vane（原 Perplexica）** — 品类锚点，36.6k★、1,009 commits、上月还在推。卖点就是"全跑在你自己硬件上"：SearXNG 免 key 打底 + Ollama 本地模型，docker 镜像把 SearXNG 直接捆进去，装完零配置可用。它证明了免 key 路线能做到几十 k 星的规模，是我们做品类定位时的对照组。
2. **LearningCircuit/local-deep-research** — 全本地 deep research，7,641 commits 的高强度迭代，公开 benchmark（单卡 3090 上 ~95% SimpleQA）当门面。多策略可切换：要快的走 pipeline，要深的走 LangGraph agent 自适应换 arXiv/PubMed 等专业引擎。它把"免 key（SearXNG）+ 策略开关 + benchmark 验收"做成了三件套，几乎就是 search-core 的成品预告。
3. **bytedance/deer-flow** — 81k★ 的巨无霸，但注意 2.0 是推倒重写（1.x 才是 deep research 框架，单独维护分支）。工业级看点：LangGraph checkpointer 和应用数据共用一个 postgres，研究状态可持久化、可恢复。搜索侧换成了自家 BytePlus InfoQuest，说明大厂下场会自带搜索基建——不依赖公共 search API 的趋势在加强。
4. **MODSetter/SurfSense** — 8,846 commits（本次扫描最高），定位从"研究 agent"转向"给 agent 供活数据的底座"。每个数据源（Reddit/YouTube/Google SERP/Indeed…）都封装成带类型的 REST 端点，再统一用一个 MCP server 暴露成 `surfsense_*` 工具。这是"搜索编排器服务化"的最完整范本。
5. **assafelovic/gpt-researcher** — 3,109 commits、七年老将，deep research 的行业标准答案。检索器抽象做成了 `RETRIEVER=tavily,mcp` 一个环境变量，混合 web+MCP 数据源开箱即用。plan/exec 双 agent 并行加报告模板成熟，缺点是默认深度绑定 Tavily key。
6. **zaidmukaddam/scira** — 17 种搜索模式的"瑞士军刀"（web/学术/X/Reddit/加密币/Spotify…），本质是垂直 query 模板库。多引擎并行+去重（Exa/Firecrawl/Parallel/Tavily）与我们 fusion 思路同构；Extreme 模式把深研做成"多步规划+代码执行+工件落 R2"。
7. **miurla/morphic** — 1,820 commits、持续活跃，最大卖点是 Generative UI：答案以流式 JSON spec 渲染成富组件而非纯 markdown。同样 docker 默认捆 SearXNG，零 key 可跑；Tavily/Brave/Exa 做增强插槽。Quick/Adaptive 两档搜索节奏值得抄。
8. **dzhng/deep-research** — 只有 77 commits、<500 行代码，却是 19.6k★ 的现象级仓库：证明"depth/breadth 两个旋钮+迭代 query 生成+follow-up 反问"十几个函数就能讲清楚研究循环。所有人抄它的骨架，它是 search-core research.ts 的精简教材。
9. **stanford-oval/storm** — 31k★ 学术派（斯坦福），两段式"先研究出大纲、再写全文"，招牌是 Perspective-Guided Question Asking：先挖出话题的多方视角，再按视角出问题去搜。虽渐冷（2025-09 后停更），但"多视角扩展 query"对 planner 是最值得抄的学术招。
10. **KnockOutEZ/wigolo** — 与 search-core 哲学重合度最高：本地优先、核心 search/fetch/crawl/extract/cache 全免 key、数据不出 `~/.wigolo/`，一条 `npx wigolo init` 把 MCP 配置写进 claude-code/cursor 等一串客户端。技术亮点是分层 fetch 路由（普通 HTTP→遇反爬/SPA 自动升级 headless 浏览器）和把本地 cache 做成可语义检索的搜索面。2,005 commits、非常活跃——它既是参考，也是竞品。

---

## 四、值得抄的思路 Top5

1. **SearXNG 免 key 打底 + key 引擎做增强插槽（Vane / morphic / local-deep-research 三家一致）**
   三个头部项目都把 SearXNG 捆进 docker compose 当默认路径，Tavily/Exa/Brave 只是可选增强。search-core 已有 searxng.ts + 多 provider router，要把"零 key 可跑通全流程"写成验收标准，并学 morphic 的打包：`docker compose up` 即完整可用。
2. **dzhng 的 depth/breadth 参数化研究循环（<500 行）**
   研究预算不写死在 agent 里，而是暴露成两个旋钮：breadth 控制每层 query 数、depth 控制递归层数。这正好对接 search-core 已有的 governor（预算管理）——把 research loop 改造成"旋钮驱动"，一份代码同时服务快答和深研。
3. **wigolo 的分层抓取路由 + cache 即搜索面**
   fetch 一律先走便宜路径（plain HTTP），撞上反爬/SPA 壳自动升级 headless 浏览器，逐层加价；所有抓过的东西进本地 cache，cache 支持关键词+语义查询，变成第二个搜索源。search-core 的 fetcher.ts/cache.ts 可以照此演进：省 token、抗封禁，还白得一个离线索引。
4. **多策略切换 + 多视角 query 扩展（local-deep-research 的策略开关 × storm 的 Perspective-Guided QA）**
   LDR 证明"快答 pipeline"和"agentic 深研"应该是一套系统里的两个可切换策略，且 agent 策略要能按 query 类型自动换专业引擎（arXiv/PubMed）；storm 补上 query 扩展的学术招：先让模型列出话题的多个视角（正方/反方/不同利益方），按视角生成问题再搜。这两招合并进 planner/focus，query 覆盖面立刻上一个台阶。
5. **typed tool + MCP 出口（SurfSense / u14app / gpt-researcher 的 RETRIEVER=mcp）**
   2026 年的共识：编排器要有两副面孔——给人 UI、给 agent MCP。SurfSense 把每个 provider 封装成带类型的 REST 端点再统一 MCP 暴露；gpt-researcher 把外部 MCP server 当检索源混用。search-core 已有 mcp.ts 和 index.ts，下一步是把每个 provider/能力规范成 typed tool schema，做"既能吃 MCP 也能吐 MCP"的双向节点。

---

### 尾注

- 扫描日期：**2026-09-02**（所有 stars/forks/pushed_at/commit 数均为当日 GitHub API 快照）。
- 搜索词清单（共 15 个 search API 请求，全部跑完）：
  1. `AI search engine` 2. `open source perplexity` 3. `answer engine` 4. `perplexica` 5. `deep research agent` 6. `web search agent` 7. `topic:ai-search` 8. `ai search copilot` 9. `search engine llm` 10. `perplexity clone` 11. `deep research` 12. `topic:deep-research` 13. `AI search engine open source`（按 updated 排序抓活跃小仓）14. `perplexica fork:true`（找衍生/活跃 fork）15. `answer engine open source`（按 updated 排序）
- commit 总数用 `GET /repos/{owner}/{repo}/commits?per_page=1` 的 Link header 末页页码法统计，与 GitHub UI 的计数可能有个位数出入。
- 本目录（analysis/search-landscape/）后续姊妹篇建议：b-搜索底座与抓取类（Firecrawl/Crawl4AI/SearXNG 本体等）、c-搜索 API 商业服务类。
