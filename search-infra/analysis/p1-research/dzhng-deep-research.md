# dzhng/deep-research 深挖精读（P1 / Task 12-a）

> 精读日期 2026-09-03，全部结论基于 GitHub main 分支源码（API + raw.githubusercontent.com 实拉，全部源文件已读）。
> 我们带着两个问题读：① <500 行怎么讲清研究循环？② depth/breadth 两旋钮怎么驱动循环、反馈怎么迭代查询？

## 一、体检

| 项 | 值 |
|----|----|
| 仓库 | dzhng/deep-research（TypeScript） |
| ★ / fork | 19,629 ★ / 1,995 fork |
| commits | 77（最后一条 2026-04-11：README 赞助方从 Aomni 换成 Duet） |
| 最后 push | 2026-04-11（体检时约 5 个月前） |
| archived | 否；open issue 92 |
| 代码量 | 全部源码 877 行，8 个 TS 文件（deep-research.ts 294 行是核心） |
| **活死判断** | **活着但代码冻结型**——未归档且 issue 在累积，但它本来就是"最小示范仓库"（77 个 commit 撑起 19.6k★），读的人远多于写的人；当冻结研究快照读，别等它更新 |

## 二、它是什么

把"deep research"压进一个递归函数的最小教学实现。depth 控制递归深度（往深钻几层），breadth 控制每层并行查询数（往广撒几张网），每个查询的产出是"learnings 字符串数组"，下一层把已有 learnings 喂回查询生成器实现"越查越准"。搜索+抓取一体交给 Firecrawl API（免自建爬虫），结构化输出全靠 Vercel AI SDK 的 generateObject + zod schema。没有数据库、没有向量库、没有 agent 框架——learnings 就是一个字符串数组走天下。

## 三、精读发现（源码级证据）

### 3.1 整个研究循环 = deepResearch() 一个函数（deep-research.ts:176-294）

```
deepResearch({query, breadth, depth, learnings, visitedUrls, onProgress})
  1. generateSerpQueries(query, learnings, numQueries=breadth)   // 205-209
  2. 并行跑每条查询（pLimit(ConcurrencyLimit)）                    // 216-288
     ├─ firecrawl.search(q, {timeout: 15000, limit: 5, formats:['markdown']})  // 222-226
     ├─ newBreadth = Math.ceil(breadth/2); newDepth = depth-1     // 230-231 ← 旋钮收缩规则
     ├─ processSerpResult(...) → {learnings[], followUpQuestions[]}  // 233-237
     ├─ depth>0 → 递归 deepResearch({query: 合成查询, breadth: newBreadth, ...})
     └─ 出错 → log 后返回空 learnings，兄弟分支不受影响            // 275-285
  3. Set 去重合并全部 learnings/urls 返回                          // 290-293
```

- **两旋钮的唯一收缩规则就一行**：`newBreadth = Math.ceil(breadth/2)`、`newDepth = depth - 1`（230-231 行）。每往下一层，广度减半、深度减一 → 总查询量约 `breadth × (1 + 1/2 + 1/4 + …) ≈ 2×breadth/层`，指数收敛，不会爆。CLI 默认 breadth=4 / depth=2（run.ts:39-48），推荐范围 2-10 / 1-5。
- **并发闸门**：`pLimit(Number(process.env.FIRECRAWL_CONCURRENCY) || 2)`（30 行）——注释原话 "increase this if you have higher API rate limits"，并发是全局单值，不按引擎分。
- **单次搜索参数**：`timeout: 15000` + `limit: 5` 条 + markdown 格式（222-226 行）。search 和 scrape 是 Firecrawl 一次调用完成的，没有独立的 Focus Fetch 步骤。

### 3.2 查询是"带研究目标的复合体"，不是裸字符串

- `generateSerpQueries`（40-79 行）用 generateObject + zod 强制每条查询带两个字段：
  - `query`：SERP 查询词；
  - `researchGoal`：schema describe 原话 "First talk about the goal of the research that this query is meant to accomplish, then go deeper into how to advance the research once the results are found, mention additional research directions."
- **反馈迭代**体现在两处：
  1. 生成查询时把已有 learnings 拼进 prompt："Here are some learnings from previous research, use them to generate more specific queries"（55-59 行）；
  2. 下一层查询由上一层产物**合成**（251-254 行）：`"Previous research goal: ${serpQuery.researchGoal}\nFollow-up research directions: ${newLearnings.followUpQuestions}"` —— 每条查询继承父查询的研究目标 + 本轮抽取的追问方向。
- `processSerpResult`（81-118 行）：每篇正文 `trimPrompt(content, 25_000)` 截断后喂 LLM，一次抽出 ≤3 条 learnings + ≤3 条 followUpQuestions；**对 learnings 的 prompt 约束**（102 行）："concise and to the point, as detailed and information dense as possible... include any entities like people, places, companies, products, things... as well as any exact metrics, numbers, or dates"——实体/数字/日期是硬要求。LLM 调用挂 `AbortSignal.timeout(60_000)`（99 行）。

### 3.3 周边件

- **预反馈（human-in-the-loop）**：`feedback.ts` `generateFeedback()` 开跑前生成 ≤3 个澄清问题，run.ts 里 report 模式要求用户逐题回答后拼进 combinedQuery（"Initial Query: ... Follow-up Questions and Answers: Q/A ..."）再启动循环；answer 模式跳过。
- **双输出形态**：`writeFinalReport`（120-147 行，"aim for 3 or more pages, include ALL the learnings"，末尾追加 `## Sources` URL 清单）vs `writeFinalAnswer`（149-174 行，BrowseComp 式短答案，"just the answer, no other text"）——同一批 learnings 两种出口。
- **trimPrompt（providers.ts:65-98）**：token 级上下文裁剪——o200k_base 编码器精确计数；超长则按"平均 3 字符/token"估出可保留字符数，RecursiveCharacterTextSplitter 切一块；**递归裁直到达标**；两处兜底：切不动就硬切 `MinChunkSize=140`，切完长度没变就 `slice(chunkSize)` 重来。默认上下文 128k（CONTEXT_SIZE env）。
- **getModel（providers.ts:48-56）**：优先 DeepSeek R1（Fireworks，`extractReasoningMiddleware({tagName:'think'})` 剥思考链），回退 o3-mini（reasoningEffort medium），`CUSTOM_MODEL` 走 OpenAI 兼容端点——三档全 key。
- **进度契约**（14-22 行）：`{currentDepth, totalDepth, currentBreadth, totalBreadth, currentQuery, totalQueries, completedQueries}` ——树形递归也能向上报线性进度，api.ts 的 POST /api/research 直接把 onProgress 接给响应流。
- **systemPrompt（prompt.ts）**：注入 `Today is ${now}`（当天日期）对抗 LLM 知识截止；"Mistakes erode my trust, so be accurate and thorough"。
- **失败哲学**：每分支 try/catch 吞错返回空数组（275-285 行）——单腿失败绝不拖死全局，但也没有失败标注（调用方无法区分"没结果"和"查询失败"）。

## 四、它有我们没有的（对照 search-core v0.4：Research Loop 5 角度并行+双预算池+6 问反思停止）

| # | 它有我们没有的 | 裁决 | 理由 |
|---|---------------|------|------|
| 1 | **每条查询携带 researchGoal 字段随查询进化**（父目标+追问合成子查询） | ✅ **值得抄** | 我们 research.ts 的角度查询是规则模板生成（角度名注入），查询无"目标"属性。给查询结构加 goal 字段，反思和下一轮查询生成都有依据，MCP 调用方的 research 结果也更可解释 |
| 2 | **followUpQuestions 直接当下一轮查询原料** | ✅ **值得对照** | 我们 6 问反思（q1-q6）目前是量化打分用于停/续判定；dzhng 证明反思除了打分还应"吐出下一轮的具体查询文本"。两者可拼：反思器输出分数+建议查询列表，双预算池决定喂几条 |
| 3 | learnings 抽取 prompt 约束（实体/指标/数字/日期必须进学习） | ✅ **值得抄** | 我们事实抽取器可直接吃这条约束——事实密度是循环收敛质量的第一决定因素，一句话成本 |
| 4 | trimPrompt token 级裁剪（精确计数+递归切+双兜底） | ✅ **值得抄** | 我们 focus fetcher 已切块，但进 LLM 合成（synthesizer 钩子）前的上下文裁剪需要同款"tokenizer 精确版"；纯规则版也要有字符级上限+硬切兜底 |
| 5 | breadth 几何收缩（每层÷2） | ⏸ **暂不抄** | 我们双预算池+反思停止比静态几何收缩聪明（收敛看证据不看层数）；但"越深越窄"的直觉可用于预算分配：深层角度的 fetch 预算应收紧 |
| 6 | 进度契约（depth/breadth/query 计数） | ⏸ **暂不抄** | 我们 journal 事件流（start/loop_start/angle_done/reflect/stop）信息量更大 |
| 7 | 60s LLM AbortSignal / 15s 搜索超时 / 分支吞错 | ❌ **不用抄** | 我们软截止+失败标注契约严格更强（迟到腿自报作废、错误分类六类） |
| 8 | 预反馈 3 问（human-in-the-loop 澄清） | ⏸ **暂不抄** | MCP 场景无人类交互位；可作 CLI `--interactive` 可选件记 backlog |
| 9 | depth/breadth 对外暴露为仅有的两个旋钮 | ✅ **值得记** | 旋钮数量本身就是设计——我们对外也该收敛成两个心智旋钮（budget/referenceBudget 已是），别让用户面对 7 个参数 |

## 五、裁决

**抄三个小件**：查询带 researchGoal、learnings 抽取的"实体/数字/日期"硬约束、token 级 trimPrompt——都能直接进我们的 Research Loop/合成器。**不抄** depth/breadth 的静态几何收缩机制本身（我们的双预算池+6 问反思已超越它），但它把整条循环压进 294 行且每个决策都是必要件的"骨架感"，正是我们对照自查复杂度的尺子：**我们 718 行 research.ts 里的每一块，能否也讲出一句"去掉它循环就断了"的理由？**
