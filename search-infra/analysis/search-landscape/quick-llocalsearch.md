# LLocalSearch 速评（Task 11-a，2026-09-03）

> 仓库：https://github.com/nilsherzig/LLocalSearch（Task 9-c 捞到的漏网中坚，当时 5947★）
> 方法：GitHub API 体检 + README（新旧两版）/ issue #17（作者亲写的架构规划）+ 挑 6 个核心源码文件直读（raw 直拉，未 clone）：`agentChain.go` / `simple_websearch.go` / `tool_webscrape.go` / `types.go` / `llm_backends.go` / `docker-compose.yaml` + `searxng/settings.yml` + 最早一版 agentChain.go 对照。

---

## 一句话总结

**LLocalSearch = "2024 年标准答案"的本地 AI 搜索：Ollama 小模型 + 一个会自己用工具的 agent 循环 + docker 捆自托管 SearXNG，全程零 key**——它 5.9k 星里一大半是"全程直播 agent 每一步"的 UI 赚的；但**仓库已官方归档，作者转私有 beta 重写**，真身是"单 agent"，不是宣传的"多 agent 讨论"。不用学，白嫖两个点子（会话向量库、结果卫生）进 backlog 即可。

---

## 1. 仓库体检

| 项 | 数字/事实 |
|---|---|
| star / fork | 5,947★ / 363 forks（截至 2026-09-03） |
| commit 总数 | **182 个**（GitHub API commits?per_page=1 的 Link header 数出） |
| 建仓时间 | 2024-03-23 |
| 最后一次真代码 commit | **2024-05-10**（修 nginx mime 类型；主冲刺期 2024-03~05，100+ commits 全在这两个月） |
| 之后的动静 | 2025-04-28 只加了一条 README 警告；2025-12-11 改了赞助文件；2026-03 归档 |
| open issues | 58 个（归档冻结，不再处理） |
| 语言 | Go（后端 7 万字节）+ Svelte（前端 4.8 万字节） |
| license | Apache-2.0 |
| **archived** | **是（官方归档）** |

**维护活跃度判定：已死（官方盖章那种）。**
按我们的口径（commit 迭代次数 + 最后更新时间）：182 个 commit 里的真代码集中在 2024-03~05 两个月，之后三年零代码；README 首行原文挂着作者警告："This version has not been under development for over a year. I'm working on a rewrite / relaunch within a private beta"（新版在私有内测，不打算在老仓库续命）；2026-03-24 前后整个仓库被 archived。**5.9k 星是 2024-04 那波"本地 AI 搜索"风口的老账，不是活信号**——又一个"高星≠活着"的实锤（同批还有 whoogle）。

---

## 2. 它是怎么干活的（大白话）

**宣传形象 vs 真身，先对齐**：README 和 demo 给人的印象是"一群 LLM agent 互相讨论得出答案"。翻了全部关键源码 + 作者亲写的架构规划（issue #17）+ 最早一版代码对照后确认：**仓库里从头到尾只有一个 agent 在循环**。用户在界面上看到的"agents 在讨论"，其实是**这一个 agent 的思考/行动日志被拆成一条条实时推出来**的视觉效果。作者在 issue #17 里画过"聊天层可以调自批评子链"的规划图，但仓库里没有实现。

真身流程（`backend/agentChain.go`，用 langchaingo 框架）：

```
用户提问
  └→ 开"会话"：建会话记忆（对话窗口缓冲）+ 本会话专属向量库命名空间（Chroma）
       └→ 一个 ReAct 对话 agent，手里 3 个工具，循环干活（默认上限 30 轮）：
            ① websearch    → 打 SearXNG 拿结果，直接把各条摘要喂给模型
            ② webscrape    → 打 SearXNG → 抓 top N 页面全文 → 切块 → 嵌入进本会话向量库
                             → 只返回跟问题最相关的片段给模型
            ③ searchvectordb → 换个关键词，再查一遍刚抓回来的那批页面
            （每一步：模型在想啥/调了啥/加了什么来源卡片，全部经 SSE 直播给前端）
       └→ 答完 → 再调一次模型给会话起个 3 词标题
```

值得单独说的是工具 ②③ 的组合拳——**"抓回来的页面不是用完就扔，而是落进本会话专属的向量库"**：agent 之后可以反复换词查询同一批页面，不用重新抓。这是它最聪明的一步棋，也是跟我们"缓存即搜索面"思路最接近的地方（详见下面第 4 节）。

部署形态：docker-compose 全家桶（后端 + 前端 + Chroma 向量库 + Redis + SearXNG），Ollama 在外面接，所以全流程零 API key、全本地。它属于"docker 捆 SearXNG 零 key 可跑"这个品类定式的**早期定型样本**（Vane/morphic/LDR 都是后来者）。

---

## 3. 搜索结果从哪来

| 来源 | 要不要 key | 说明 |
|---|---|---|
| 自托管 SearXNG（compose 捆绑） | 不要 | **唯一搜索入口**，`/?q=…&format=json` 拿 JSON；settings.yml 里 `formats: [html, json]` 打开 JSON 才能用 |
| Ollama 本地模型 | 不要 | LLM + 嵌入（nomic-embed-text）都是本地的 |

- **被反爬卡住怎么办：它自己根本不碰反爬**——压力全部转嫁给 SearXNG 和它的几十个上游引擎。SearXNG 的 suspension 配置（`searxng/settings.yml`）写好了各类封禁的自愈时间（撞验证码封 1 天、限流封 1 小时之类）。这是"自托管假设"的标准姿势，跟我们扫库结论一致：**公共 SearXNG 实例不可依赖，自托管才可靠**。
- 空结果的处理很直白：直接报错 `"No results, we might be rate limited"`——把空结果当限流信号。这个我们已经用更强的版本（DDG 202 软封检测 + 退避）做过了。

---

## 4. 它有我们没有的

我们已有：免 key 引擎池 13+ 引擎、RRF+词命中+共识融合排序、失败抛错+6 连败熔断、TTL 缓存、CLI/MCP/REST 三出口。对照如下：

1. **会话级向量库二次检索**（抓过的页面切块嵌入，本会话内反复换词查，不用重抓）→ **值得抄**：这就是我们"缓存即搜索面"（v0.4 FTS5 计划）的**向量版兄弟项**——FTS5 管词面召回，向量管语义召回，做 FTS5 时把接口留成可替换的就行；我们 local-first 不排斥本地嵌入模型。
2. **结果卫生默认件**：会话内已用 URL 去重（同一批页面不会抓两遍）+ PDF 一律跳过（`tool_webscrape.go:81`）→ **值得抄**：几行代码的事，放进 fusion/抓取层当默认卫生规则，省 token 也省重复劳动。
3. **SSE 全程事件流**（22 种事件类型：agent 开动/工具起止/来源加入/流式 token，全推给前端）→ **暂时不抄**：我们没有 UI 需求；且 MCP 工具调用自带 progress 通知机制，真要做"直播"时挂上去就行，不用现在背一个事件总线。
4. **docker-compose 全家桶分发**（SearXNG+Redis+Chroma+前端一键起）→ **暂时不抄**：search-core 的定位是"库 + 三出口"，不是终端应用；捆绑分发是另一条产品线，等有"一键 demo"需求再议。
5. **"多 agent 讨论"的包装话术** → **明确不抄（但记一笔反面教材）**：名不副实，代码里是单 agent；不过它反过来证明了一件事——**把搜索过程讲清楚本身就是卖点**，5.9k 星一半是直播 UI 挣的。我们失败标注契约 + 融合排序的可解释性其实是同一种价值的"诚实版"，值得在 README 里学着讲。
6. **空结果当限流报错 / 解析错误回喂自纠**（langchaingo ParserErrorHandler 把模型的坏输出包成提示喂回去）→ **明确不抄**：前者我们已在 DDG 三件套里用更强的版本落地；后者是模型层的凑合解，我们"失败抛错"的诚实契约更干净。

---

## 5. 一句话裁决

**不用学**：已官方归档的死项目，架构本质是"2024 年标准答案"（单 agent + 自托管 SearXNG + 本地 Ollama），每一块我们都有更强或更诚实的实现；只把「会话向量库」「结果卫生」两个点子记进 v0.4 backlog，代码一行不用搬。
