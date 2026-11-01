# Perplexica 逆向分析报告

**目标**: Perplexica / Vane (开源 Perplexity 替代品)
**版本**: v1.12.2 (package.json 内部名已改为 `vane`,上游仓库已迁移到 ItzCrazyKns/Vane)
**平台**: Web (Next.js 16 全栈,单服务)
**类型**: 开源 (MIT)
**分析日期**: 2026-09-02
**原始下载**: https://github.com/ItzCrazyKns/Perplexica
**Commit**: 348feca3e378fb4157b217724ed508dc707f853f (2026-09-01)

---

## 0. 摘要 (TL;DR)

Perplexica 是最完整的开源 Perplexity 克隆:Next.js 单体应用,SearXNG 做检索底座,Playwright+Readability 做抓取,LLM 负责分类/重写/筛选/提取/写作五个环节。**v1.x 最大的变化是从"固定 pipeline"重构成了真 agent 架构**:一个 Researcher agent 持有 `web_search` / `academic_search` / `social_search` / `scrape_url` / `uploads_search` / `done` 六个工具,按 speed/balanced/quality 三档预算自主循环 (迭代上限 2/6/25)。最值得抄的三个机制:(1) **classify 一次 LLM 调用同时完成"路由 + query 重写"**;(2) **speed 模式下用 embedding 余弦相似度做 snippet 过滤(>0.5)+ 跨源去重(>0.75),不需要 rerank 模型**;(3) **引用从 prompt 约定(`[n]`)到前端正则替换(`<citation href>`)的零解析器实现**。

---

## 1. 整体架构

### 1.1 进程拓扑

单进程 Next.js 服务(前端 RSC + `/api/*` route handlers 即后端),外挂两个可选容器:SearXNG 和(为动态页面准备的)本地 Chromium(playwright 按需启动)。持久化用 better-sqlite3 + drizzle(会话/消息),应用配置是一份 JSON 文件 `data/config.json`(SearXNG URL、provider 列表),env 只用于首次播种(`SEARXNG_API_URL`、各 provider key)。

### 1.2 关键模块图

```mermaid
graph TD
    UI[React UI] -->|SSE /api/chat| Route[chat route]
    Route -->|loadChatModel / loadEmbeddingModel| MR[ModelRegistry]
    Route --> SA[SearchAgent]
    SA --> CL[classify: 路由+standalone重写]
    SA -->|parallel| WE[WidgetExecutor weather/stock/calc]
    SA -->|skipSearch=false| RE[Researcher agent loop]
    RE -->|ActionRegistry| WS[web_search / academic / social]
    RE -->|ActionRegistry| SU[scrape_url / uploads_search / done]
    WS --> SX[searxng.ts /search?format=json]
    WS -->|quality| PICK[LLM picker ≤3] --> SCRAPE[Scraper] --> EXT[LLM extractor]
    SU --> SCRAPE
    SA --> WR[Writer prompt + streamText]
    SA -->|blocks| DB[(sqlite messages)]
    UI -->|regex [n]→citation| MD[markdown renderer]
```

关键点:**SSE 不是逐 token 文本流,而是结构化 Block 流**。`SessionManager`(`src/lib/session.ts`)维护 `Map<blockId, Block>`,每次变更发 RFC6902 JSON Patch(`updateBlock`),前端 `applyPatch` 回放。text/source/widget/research 四种 block 类型,`research` block 内嵌 subSteps(plan → searching → reading → search_results),这就是 UI 上"研究过程时间线"的数据来源。

这套协议解决了流式 UI 的一个经典难题:搜索结果块是"先到先显示、后到再追加"的,如果每次都重传整块会很浪费;用 JSON Patch 只传 diff(比如 `/data/subSteps` 数组的整体替换),前端 `rfc6902.applyPatch` 原地更新。代价是 patch 粒度较粗——源码里所有 subSteps 更新都是整组数组替换,并没有做到真正的最小 diff。另一个细节:SessionManager 存在 `globalThis` 上并带 30 分钟 TTL(`session.ts:6-25`),`/api/search` 的非流式模式靠"先订阅、事后一次性 resolve"复用同一套事件流,流式/非流式两个 API 形态共用 agent 代码。

---

## 2. Agent 工作流

### 2.1 拓扑选择

单 agent + 工具循环(无 planner-executor 拆分),外层是一个"编排器" `SearchAgent`(`src/lib/agents/search/index.ts`)负责 classify → 并行(widgets ∥ researcher)→ writer 三段式。Researcher 是纯 ReAct loop。

### 2.2 主循环伪代码

```
// src/lib/agents/search/researcher/index.ts:14-183
maxIteration = mode==='speed' ? 2 : mode==='balanced' ? 6 : 25
tools = ActionRegistry.getAvailableActionTools({classification, sources, mode, fileIds})
history = [user: <conversation>...history(截尾10条) User: q (Standalone question: 重写q)</conversation>]
for i in 0..maxIteration:
  stream = llm.streamText(system=getResearcherPrompt(tools,mode,i,max), history, tools)
  toolCalls = 收集流式 tool_call 片段(partial-json 边流边解析)
  if toolCalls 空 or 最后一个是 done: break
  results = ActionRegistry.executeAll(toolCalls)   // 并发执行
  history += [assistant(tool_calls), tool 结果(JSON.stringify)]
去重: 按 URL 合并多轮 search_results 内容
emit source block → 返回 searchFindings
```

每轮 system prompt 都重新生成并注入"当前第 i/max 次迭代"和日期,三档模式各有独立 prompt(speed 不带 reasoning、balanced 强制每步先调 `__reasoning_preamble`、quality 要求 4-7 次信息收集且"至少 5-6 轮才许停",`src/lib/prompts/search/researcher.ts`)。注意 `__reasoning_preamble` 不是真 reasoning,而是一个伪装成工具的"计划陈述",输出直接进 UI 的 research block——这是给非 reasoning 模型补可见思考的取巧设计。

### 2.3 关键决策点

| 决策 | 位置 | 判断依据 |
|---|---|---|
| 搜不搜 / 走哪路 | `classifier.ts:37-53` | 一次 `generateObject`:skipSearch/personal/academic/discussion + 3 个 widget 布尔;不确定时强制 skipSearch=false(安全默认) |
| 迭代何时停 | `researcher/index.ts:150-156` | LLM 调 `done`,或无 tool_call,或迭代上限;quality prompt 明确"提前 done 是错误" |
| 抓哪些页面 | `baseSearch.ts:240-286` | quality 模式下 LLM picker 从全部结果挑 ≤3 个(按相关性/权威性/多样性打分),speed/balanced 不抓页面只用 snippet |
| scrape_url 何时可用 | `scrapeURL.ts:53-58` | prompt 明确"仅当用户给了具体 URL 才许用",防止模型乱抓 |
| 哪些工具对模型可见 | `actions/registry.ts:22-46` | 每个 action 的 `enabled(config)` 谓词:web_search 要 `sources含web && !skipSearch`;academic_search 要分类器同时打了 `academicSearch=true`;uploads_search 只要传了文件就常驻 |

### 2.4 异常处理

- 抓取失败不抛错:`Scraper.scrape` 返回 `title: 'Failed to scrape', content: '# url\nError scraping content.'`(`scraper.ts:97-103`),让 writer 自行降级。
- embedding 失败降级:`executeSearch` 里 try/catch,失败则所有 snippet `similarity=1` 原样放行(`baseSearch.ts:73-86`)。
- 弱点:**`SearchAgent.searchAsync` 整个函数没有 try/catch**。SearXNG 10s 超时(`searxng.ts:41-42`)抛出的错误会变成 unhandled rejection,SSE 流挂死不 emit error——对比 `api.ts:22-25` 的 APISearchAgent 反而给 widgetPromise 加了 `.catch`。这是把旧 pipeline 重构成 agent 时丢掉的健壮性。

---

## 3. 技能仓库 (Skill Repo)

不适用。Perplexica 无 skill/plugin 概念;最接近的是 `ActionRegistry`(`actions/registry.ts`)+ `WidgetExecutor`(`widgets/executor.ts`),都是静态 Map + `register()` 的注册表模式,`enabled(config)` 谓词决定工具是否随 classify 结果注入——这个"**分类结果驱动工具可见性**"的模式值得记下。

---

## 4. 工具系统

- 协议:内部 `Tool = {name, description, schema: ZodObject}`,发给 OpenAI 兼容端时 `z.toJSONSchema(tool.schema)` 转成 function calling(`openaiLLM.ts:75-84`);非 OpenAI provider 各自转换。
- 流式工具调用解析:`openaiLLM.ts:161-194` 用 `partial-json` 边流边 parse arguments,配合上游 `__reasoning_preamble` 的流式 plan 展示。
- 工具输出直接 `JSON.stringify(action)` 塞回 `role:'tool'` 消息,无截断——quality 模式下 extractor 已把内容压成 facts,算是隐式预算。
- 授权:全部静默,无确认环节(搜索场景合理)。

---

## 5. 搜索实现(重点)

### 5.1 后端

| 后端 | 是否使用 | 配置方式 | 备注 |
|---|---|---|---|
| SearXNG | ✅ 唯一检索后端 | `data/config.json` 的 `search.searxngURL` 或 env `SEARXNG_API_URL` | 仓库自带 `searxng/settings.yml`(docker-compose 起 `searxng/searxng:latest`) |
| 多引擎 fallback | ❌ 无 | — | fallback 完全依赖 SearXNG 内部聚合;SearXNG 挂 = 全挂 |

集成方式极简(`src/lib/searxng.ts`,全文 67 行):

```ts
// src/lib/searxng.ts:27-42
const url = new URL(`${searxngURL}/search?format=json`);
url.searchParams.append('q', query);
if (opts) {
  Object.keys(opts).forEach((key) => {
    const value = opts[key];
    if (Array.isArray(value)) {
      url.searchParams.append(key, value.join(','));  // engines: ['arxiv','google scholar','pubmed']
      return;
    }
    url.searchParams.append(key, value as string);    // language / pageno
  });
}
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 10000);
```

要点:① 前置要求 SearXNG `formats: [html, json]`(自带 settings.yml 已开);② 多引擎 = 一个 `engines=csv` 参数,不同 focus 只换参数不换代码;③ 返回 `{results, suggestions}`,suggestions 在新版被丢弃(旧版用于联想);④ 自带 settings.yml 还打开了 `wolframalpha` 引擎,但代码里已无引用——旧版 wolfram focus mode 的遗迹。

### 5.2 Query 处理

**重写与路由合并在一次调用里**(`classifier.ts`):`standaloneFollowUp` 字段即历史感知重写("对话聊车,用户问'它们怎么工作' → 'How do cars work?'")。重写结果不替换原 query,而是拼接进 researcher 的 user 消息:`User: ${followUp} (Standalone question: ${standaloneFollowUp})`(`researcher/index.ts:53`)——原 query 保留语用,重写消解指代,比"只发重写后的 query"信息更全。

**拆分**:由 LLM 在 `web_search(queries[≤3])` 工具参数里完成,prompt 明确要求"输出 SEO 友好的关键词而非句子"、每档模式给了 few-shot(如 `["Kimi K2", "Kimi K2 AI"]`)。多 query 在 `baseSearch.ts:128` `Promise.all(queries.map(search))` 并发。balanced prompt 还教了"先广后窄"的两跳策略,quality 要求覆盖定义/对比/新闻/评价/局限 5+ 个角度。

**Focus mode → sources 演化**:旧版 6 个 focus(academic/youtube/reddit/wolfram/writing)在新版收敛为 3 个 source(`web/discussions/academic`,`agents/search/types.ts:7`)+ 3 个 widget + 独立的 image/video 副链路(前端并行打 `/api/images`、`/api/videos`,各自 LLM 重写 query 后用 `engines: ['bing images','google images']` / `['youtube']` 查 SearXNG)。youtube 没消失,变成了 `video.ts`;wolfram 没消失,变成了 calculationWidget(mathjs 本地算)。

值得注意的两个边角:① image/video 副链路是**前端并行触发的独立 REST 调用**(`SearchImages.tsx:41`),不在 agent 循环内,受 `autoMediaSearch` 开关控制——即"聊天流之外再发两个请求",好处是不阻塞主链路、模型可复用(直接读 localStorage 里的 provider 配置),坏处是媒体结果与回答互不感知。② `/api/discover`(发现页)展示了另一种 SearXNG 用法:对预置站点清单做 `site:techcrunch.com technology news` 这类**站内限定检索**(`engines: ['bing news']`),5 个话题 × 4 query × 3 站点并发打满后去重——纯规则驱动,无 LLM,是低成本做"垂直资讯源"的参考模板。

### 5.3 抓取策略

`src/lib/scraper.ts`(117 行):Playwright `chromium-headless-shell` 惰性单例(30s 空闲自毁 + mutex 保护并发 init),UA 伪装 Chrome 123 + `navigator.webdriver` 置 undefined 反检测;`goto(domcontentloaded, 20s)` → 再等 `load` 5s → 500ms 沉降 → `page.content()` → JSDOM + Mozilla Readability → **只取 `textContent`,不做 Markdown 转换**,拼成 `# ${title} - ${url}\n${text}`。

生命周期管理是这个类唯一复杂的地方:`browserMutex.runExclusive` 保证并发请求不会 launch 出多个 Chromium;`userCount` 计数器记录在抓请求数,归零时才允许 idle kill(30s 后关浏览器),下次请求再冷启动。这个"按需拉起 + 空闲回收"的模式对服务端无头浏览器管理是标准解法,可以直接搬。三个时间参数(20s 导航 / 5s load / 500ms 沉降)都是经验值,没有重试——失败页面直接返回错误文本,靠上游 agent 决定要不要换个来源,把重试策略上移给了 LLM。

预算控制分两层:
1. **分块**:`splitText(content, 4000, 500)`(`utils/splitText.ts`)按句边界正则切,cl100k 计 token,块间带前文 overlap——这是全项目唯一用 tokenizer 的地方;
2. **压缩**:超过 1 块就逐块过 LLM extractor,把每块压成电报体 bullet facts(prompt 里有 6 条规则,包括"数字绝不许概括",`scrapeURL.ts:7-39`)。speed/balanced 模式则根本不抓页面,只信 SearXNG snippet。

**没有全局 token 预算器**:quality 模式 25 轮 × 每轮 3 query 的结果全部堆进 writer context,`index.ts:106-111` 直接 join,唯一护栏是"URL 去重合并"(见 5.4)。commit `40a7cde feat(scrape-url): prevent context overflow` 说明作者自己也被这个问题咬过。

### 5.4 融合 & 排序

**没有 rerank 模型**,相关性全部交给 embedding 余弦(`computeSimilarity.ts` 手写 22 行点积/范数):

```ts
// src/lib/agents/search/researcher/actions/baseSearch.ts:51-72 (speed/balanced)
const queryEmbedding = (await input.embedding.embedText([q]))[0];
resultChunks = (await Promise.all(res.results.map(async (r) => {
  const content = r.content || r.title;
  const chunkEmbedding = (await input.embedding.embedText([content]))[0];
  return { content, metadata: { title: r.title, url: r.url,
    similarity: computeSimilarity(queryEmbedding, chunkEmbedding), ... } };
}))).filter((c) => c.metadata.similarity > 0.5);   // 相关性过滤
```

之后:`sort(similarity desc)` → **embedding 去重**(任意两个结果相似度 >0.75 视为重复,`baseSearch.ts:134-158`)→ `slice(0, 20)` → 删掉 embedding 字段。多轮循环的结果再按 URL 合并(后者 content 追加到前者,`researcher/index.ts:189-208`)。

embedding 的三个用途:① snippet 相关性过滤;② 去重;③ 上传文档向量检索(`uploads/store.ts`,uploads_search 工具)。embedding 模型就是用户在 UI 里选的那个(可以是 transformers.js 本地小模型),**每条 snippet 一次 `embedText` 调用**——20 条结果 = 21 次推理,本地小模型够用,大模型 provider 会很贵,这是拿简单换性能的取舍。

### 5.5 缓存

**无**。搜索结果、页面抓取、embedding 全部不缓存。Scraper 的浏览器单例算唯一"缓存"(省 launch 开销)。对个人部署可接受,做产品必须补。

---

## 6. 上下文管理

- writer prompt(`prompts/search/writer.ts`)把检索结果包成 `<search_results><result index=N title=...>...</result></search_results>`,widget 结果单独 `<widgets_result noteForAssistant="...do not CITE this as a source">`——用 XML 注记区分"可引用/不可引用"上下文,是个干净的做法。skipSearch 命中时上下文也不是空串,而是字面量 `<Query to be answered without searching; Search not made>`(`index.ts:102-103`),让 writer 模型明确知道"这是闲聊/纯生成,别引用"。
- 历史截断:researcher 只带最近 10 条(`history.slice(-10)`);writer 带全量 history(前端给的 `[role,content]` 对,已不含中间工具流量)。中间工具消息(agent 内部的 assistant/tool 往返)在 Researcher 私有 history 里,不进主对话历史——**搜索噪音不污染多轮对话**,这个隔离做对了。
- 无长期记忆、无摘要压缩;`getTokenCount` 仅服务于分块。quality 模式下 writer prompt 追加"回答不得少于 2000 词"(`writer.ts:36`),配合超长上下文,属于用 prompt 硬顶输出长度,没有对应的输入端裁剪,两头不对称。

---

## 7. 模型路由

### 7.1 默认模型

无硬编码默认,setup wizard 引导配置。UI 默认 `optimizationMode='speed'`、`sources=['web']`。

### 7.2 任务到模型的映射

**整个应用只用用户选的一个 chat 模型 + 一个 embedding 模型**,没有按任务分模型:classify、researcher、picker、extractor、writer、媒体重写、suggestions 全走同一个 LLM。这和 Grok Build/Antigravity 的"分任务路由"形成鲜明对比——自部署产品让用户自己权衡,代码保持零路由逻辑。

### 7.3 Provider 抽象

三层基类(`src/lib/models/base/`),8 个 provider(openai/ollama/groq/anthropic/gemini/lmstudio/lemonade/transformers):

```ts
// src/lib/models/base/provider.ts:6-25
abstract class BaseModelProvider<CONFIG> {
  abstract getDefaultModels(): Promise<ModelList>;
  abstract getModelList(): Promise<ModelList>;          // 动态拉模型列表
  abstract loadChatModel(modelName): Promise<BaseLLM<any>>;
  abstract loadEmbeddingModel(modelName): Promise<BaseEmbedding<any>>;
  static getProviderConfigFields(): UIConfigField[];    // 声明式配置 schema → 自动生成设置 UI
  static parseAndValidate(raw): CONFIG;
}
```

`BaseLLM` 四方法:`generateText / streamText(AsyncGenerator) / generateObject<T>(zod) / streamObject<T>`。`generateObject` 的容错链值得抄:`response_format=zodResponseFormat` → 失败则 `repairJson(@toolsycc/json-repair, extractJson)` 修复 → 再 `schema.parse`(`openaiLLM.ts:215-226`)。`transformers` provider 用 `@huggingface/transformers` 的 feature-extraction pipeline(mean pooling + normalize)提供**零 API key 的本地 embedding**,是"开箱即用相关性过滤"的前提。

配置持久化:所有 provider 实例序列化进 `config.json`,`ModelRegistry` 每次请求现场实例化(`chat/route.ts:128-136`),无进程级缓存——每次提问都 new Registry + loadModel,ollama 类本地 provider 没问题,SaaS provider 多一次握手,又是一个"简单优先"。

---

## 8. 综合发现 (Findings)

### 8.1 最聪明的 3 个设计

1. **classify 一石三鸟**:一次 `generateObject` 同时产出路由(7 个布尔)、widget 触发、standalone 重写。旧版要用 2-3 次 LLM 调用(focus 判断 + rephrase),现在首 token 前只有 1 次调用,延迟省一半。
2. **embedding 当 rerank + dedup 用**:不做 cross-encoder,用"查询-snippet 相似度 >0.5 过滤 + 结果间 >0.75 去重"两个阈值解决排序和重复问题,与用户可选的任意 embedding 模型解耦。
3. **引用机制零解析器**:prompt 要求 `[n]`,后端把 index 编进 `<result index=N>`,前端一个正则 `\[([^\]]+)\]` 查 sources 数组替换成 `<citation href>`(`useChat.tsx:335-380`),顺带支持 `[1,2]` 多引。没有 JSON 校验、没有流式解析,鲁棒性靠"匹配不到就不替换"兜底。

### 8.2 最蠢的 3 个设计

1. **searchAsync 无任何错误处理**:SearXNG 超时/LLM 失败都会让 SSE 流静默挂死,连 `session.emit('error')` 都没调。APISearchAgent 有 catch,UI 版反而没有——重构遗留。
2. **quality 模式上下文无预算**:25 轮迭代结果全量进 writer,长对话必爆窗口;作者自己打了补丁也只覆盖 scrape_url 单工具。
3. **每条 snippet 单独一次 embedding 调用**(逐条 await Promise.all 内嵌),且 `ModelRegistry` 无实例缓存,自部署在低端机上 speed 模式也要 2-4s 才出结果。

### 8.3 可借鉴的机制

- SearXNG JSON API 的完整用法:`?format=json&q=&engines=a,b&language=&pageno=`,10s AbortController 超时;**把引擎选择(focus)编译成一个 engines 参数**,代码零分支。
- classify(路由+重写)单调用模式。
- `__reasoning_preamble` 伪工具:给非 reasoning 模型补"可见计划",直接喂 UI 进度条。
- URL 去重 + content 合并的多轮结果归并。
- `<result index=N>` → `[N]` → 前端正则的三段式引用。
- Readability + textContent(不搞 Markdown)——对 LLM 消费,纯文本比 Markdown 更省 token。

### 8.4 应避免的坑

- agent loop 无全局异常捕获、无 token 预算、无结果缓存。
- snippet-only 相关性判断(speed 模式)会被 SEO 垃圾页骗——它没有内容级验证。
- 分类器 7 个布尔全是"不确定时……"的模糊指令,实际效果强依赖所选模型的指令遵循能力;小模型下 skipSearch 误判率会很高。

---

## 9. 我们自己的设计参考

**必须复制**:
1. **SearXNG 作为免费底座的标准姿势**:`/search?format=json` + engines 参数化 + docker-compose 自带 settings.yml(开 json 格式)。我们的搜索工具 v0 应直接采用,并把 `engines=` 抽象成 `SearchProfile`(academic → arxiv,scholar,pubmed;discussions → reddit;news → bing news + site: 限定,见 `discover/route.ts:48` 的 `site:${link} ${query}` 技巧)。
2. **classify 单调用**:路由 + standalone 重写 + (我们的)预算档位一次出;不确定默认搜。
3. **引用三段式**:context 带 index、prompt 要求 `[n]`、前端正则替换;比结构化 JSON 引用便宜且流式友好。
4. **embedding 双阈值**(过滤 0.5 / 去重 0.75)替代 rerank 模型,v0 用本地小模型即可。
5. **Block + JSON Patch 的 SSE 协议**:research 过程可视化不需要自研协议,直接抄 `session.ts` 的 block/updateBlock 两事件。

**必须避免**:
1. 主链路裸奔无 try/catch——我们每个 stage 必须 emit error 并降级到"无检索直答"。
2. 无缓存——至少要 SearXNG 结果缓存(URL+query 哈希,TTL 1h)和页面抓取缓存。
3. 多轮结果不设全局 token 预算;我们应在 researcher 循环里维护"context 预算池",超了就停搜。

**可选改进**(Perplexica 没做、我们该做的):
- 搜索后端健康探测 + 多 SearXNG 实例/免费 API(DDG)fallback——它单点依赖 SearXNG,这是它作为"搜索引擎"而非"搜索编排器"的最大局限;
- speed 模式对 top-3 结果做一次廉价抓取验证,防 SEO 垃圾;
- 用 jaccardSim(它写了 `utils/jaccardSim.ts` 但主链路没用上)做零成本文本去重补充。

---

## 10. 引用 & 二次查阅

- 仓库: https://github.com/ItzCrazyKns/Perplexica (上游已改名 Vane: https://github.com/ItzCrazyKns/Vane)
- 分析 commit: `348feca3e378fb4157b217724ed508dc707f853f`
- 关键文件速查: `src/lib/searxng.ts`(SearXNG 客户端)/ `src/lib/agents/search/researcher/`(agent loop + actions)/ `src/lib/agents/search/researcher/actions/search/baseSearch.ts`(相似度过滤+picker+extractor)/ `src/lib/scraper.ts`(Playwright+Readability)/ `src/lib/agents/search/classifier.ts` + `src/lib/prompts/search/classifier.ts`(路由+重写)/ `src/lib/prompts/search/writer.ts`(引用要求)/ `src/lib/hooks/useChat.tsx:335`(引用正则)/ `src/lib/models/base/provider.ts`(provider 抽象)/ `searxng/settings.yml`(自带 SearXNG 配置)
- 本地源码: `analysis/perplexica/source/`(本次由子代理重新 clone,原目录曾被清空)
