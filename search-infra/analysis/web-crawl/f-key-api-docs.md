# Task 10-b：key API 官方文档爬取（GitHub 之外的世界）

> 抓取日期：2026-09-03 ｜ 方法：官方文档页 + 官网定价页直爬 + 一次匿名端点实测
> 本轮任务：给自研免 key 引擎池的 key 插槽找回落对象，核实 2026 年 9 月各家 key API 的真实情况。

---

## 30 秒结论

1. **Google CSE 关停实锤**：官方 overview 页白纸黑字——API 已对**新客户关闭**，现有客户 **2027-01-01** 到期整体退役（不是只关免费层，是整个 API）。官方替代品 Vertex AI Search 只管 ≤50 域名的站内搜索，全网搜索要"contact us"走销售。**别接，别等。**
2. **插槽 Top3：Tavily → Brave → Exa**。三家都有"每月白送"的额度（1000 credit / $5 credit≈1000 次 / $10 credit≈1400 次），都是标准 REST + 明确的超限报错语义，正好接我们"免 key 池挂了自动回落"的模型。
3. **旧情报有两处被推翻**：Brave 的"免费 2000 次/月独立层"没了（换成月送 $5 credit）；Exa 的 `type: neural/keyword` 参数已废弃（换成 auto/fast/instant/deep 系列）。
4. **没死的死讯**：Bing Search API 2025-08 退役后**没有复活**，微软官方替代是 Azure AI Agents 里的"Grounding with Bing Search"——那是 agent 产品不是 SERP API，第三方实测贵 40–483%。You.com 活得挺好还降价了。
5. **免卡白嫖榜**（月度持续）：Tavily 1000 credit/月 ≥ Brave $5/月 ≈ Serper 2500（仅一次性）> Exa $10/月。

## 选型总表

| 名称 | 免费额度（2026-09 实况） | 付费单价 | 响应质量口碑 | 接入难度 | 插槽优先级 |
|---|---|---|---|---|---|
| **Tavily** | 1000 credit/月，免卡（确认仍有效） | PAYG $0.008/credit；包月 $0.0075–0.005/credit | AI agent 圈默认口粮，口碑稳 | ★ 极简（POST+Bearer） | **① 首选** |
| **Brave Search API** | 月送 $5 credit≈1000 次，50 QPS | $5/1k 次；Answers $4/1k+token 费 | 独立索引 30B 页， blinded test 不输巨头 | ★★ 简单（GET+header） | **② 次选** |
| **Exa** | 注册送 $20 + 每月 $10 credit（≈1400 次搜索），5 QPS | Search $7/1k（≤10 条），Deep $12–15/1k | 代码/技术检索口碑最佳 | ★★ 简单（POST+x-api-key） | **③ 第三** |
| **Serper** | 2500 次一次性，免卡（确认仍有效） | $1.00→$0.30/1k（充值越多越便宜，credit 有效期 6 个月） | Google SERP 代理里最便宜的一档 | ★ 极简（POST+X-API-KEY） | ④ 一次性炮灰/多号轮换 |
| **You.com API** | $100 complimentary credits | Search $5/1k（2026-03 刚降价）、Contents $1/1k 页 | 中规中矩，走 AWS Marketplace 分发 | ★★ | 观察位 |
| **Mojeek API** | 未核实到官方页（本次抓取被挡） | 2023 年博客价 $15/1k | 独立索引+欧洲托管+零留存卖点 | ★★ | 暂缓，待人工注册核实 |
| SerpApi | 100 次/月（官方博客口径；另有 250/月说法未证实） | 很贵（$725/月=10 万次） | 老牌，质量好 | ★ | 不值得当主力 |
| SearchApi.io | 100 次（注册一次性） | $40/月起 | 老牌平替 | ★ | 不值得 |
| ValueSERP | 本轮未核实（旧情报 100/月） | — | — | — | 不值得 |
| Firecrawl search | 1000 credit/月免卡 | 与抽取共用 credit | 搜索+抓正文一体，好评 | ★★ | **值得测**（新玩家里最值） |
| Jina s.jina.ai | 免费有速率限制 | 便宜 | 口碑"并行查询秒被限" | ★ | 值得测，但只低频 |
| parallel.ai | 企业向 | 偏贵（task API 按任务） | 企业 Deep Research 定位 | ★★★ | 观察，不急 |

---

## 一、Google CSE / Programmable Search Engine 关停官方核实（最高优先级）

**官方原文出处**：https://developers.google.com/custom-search/v1/overview （页面标注 Last updated 2026-02-18 UTC）

原文引用一（关停公告本体，位于页面 Note 段）：

> "The Custom Search JSON API is closed to new customers. Vertex AI Search is a favorable alternative for searching up to 50 domains. Alternatively, if your use case necessitates full web search, contact us to express your interest in and get more information about our full web search solution. **Existing Custom Search JSON API customers have until January 1, 2027 to transition to an alternative solution.**"

原文引用二（定价段，确认免费层只活到关停日）：

> "The following pricing applies only to existing Custom Search JSON API customers **until the service discontinuation on January 1, 2027**. This API is not available for new customers. Custom Search JSON API provides 100 search queries per day for free. If you need more, you may sign up for billing in the API Console. Additional requests cost $5 per 1000 queries, up to 10k queries per day."

**核实结论**：
- **日期属实**：2027-01-01，官方原文就是 "January 1, 2027"，Task 9 扫库情报正确。
- **影响范围**：**整个 API**，不是只砍免费层。免费 100 次/天和付费 $5/1k 都活到 2027-01-01 一起死；且**新客户现在就注册不了**（"closed to new customers"）。
- **时间线补充**（Brave 官方博客侧证，https://brave.com/learn/google-api-shutdown/ ）：2026-01-20 起新建引擎强制"Sites to search"≤50 域名；老引擎的"Search the entire web"开关同样只保留到 2027-01-01。
- **官方推荐替代品**：① **Vertex AI Search**（≤50 域名站内搜索）——但三个月后就改名 **Agent Search** 并塞进 Gemini Enterprise Agent Platform（一个产品四个名字：Agent Search / Vertex AI Search / Discovery Engine / generative-ai-app-builder）；② 全网搜索没有自助替代，只有"contact us"销售通道。
- **对我们的判决**：原本"Google CSE 100 次/天免 key"的计划彻底作废——连新号都开不出来。免 key 池里 Google 通道只剩 9-b 已实锤的 curl_cffi+NID cookie 路线（非官方、脆弱）。CSE 从 backlog 划掉。

---

## 二、Tavily

- 文档：https://docs.tavily.com （API Reference：https://docs.tavily.com/documentation/api-reference/endpoint/search ；计费：https://docs.tavily.com/documentation/api-credits ）
- **端点**：`POST https://api.tavily.com/search`（另有 /extract /crawl /map /research 系列）
- **认证**：`Authorization: Bearer tvly-xxx`（官方文档全部示例均为 Bearer header；老式 body 里塞 api_key 属于 legacy 玩法）

### 参数表（官方 reference 实录）

| 参数 | 类型/默认 | 说明 |
|---|---|---|
| query | string，必填 | 搜索词 |
| search_depth | basic（默认）/advanced/fast/**ultra-fast** | **basic/fast/ultra-fast=1 credit，advanced=2 credit** |
| chunks_per_source | 1–3，默认 3 | 每来源片段数，每段≤500 字符 |
| max_results | 0–20，默认 10 | 结果条数 |
| topic | general（默认）/news/**finance** | finance 是新加的 |
| time_range | day/week/month/year（或 d/w/m/y） | 相对时间过滤 |
| start_date / end_date | YYYY-MM-DD | 绝对时间过滤 |
| include_answer | false/basic/true/advanced | true=basic 快答；advanced=详细答案 |
| include_raw_content | false/markdown/text | 正文抽取 |
| include_images / include_image_descriptions / include_favicon | bool | 图片相关 |
| include_domains / exclude_domains | string[] | 白名单≤300 域，黑名单≤150 域 |
| country | enum，仅 topic=general | 国家加权 |
| language | ISO 639-1（如 zh-cn） | 语言加权；配 filter_by_language=true 变硬过滤 |
| filter_by_language | bool，默认 false | 严格过滤非目标语言（须先设 language，否则 400） |
| auto_parameters | bool，默认 false | 自动配参——**注意：可能自动把 search_depth 升成 advanced，一单扣 2 credit** |
| exact_match | bool | 引号短语精确匹配 |
| include_usage | bool | 响应里带 usage.credits |

### 计费与免费层
- **免费层 1000 credit/月：确认还成立**（官方 api-credits 页原句 "You get 1,000 free API Credits every month"；tavily.com/pricing 同口径，免卡）。
- 付费：PAYG $0.008/credit；包月计划 $0.0075–$0.005/credit（量大更便宜）。
- **超限行为 = 明确报错，不降速**：429=请求过快（"Please reduce rate of requests"）；**432=超出套餐用量上限**；**433=超出 PAYG 上限**。错误码语义清晰，正好用来自动探知"额度烧完→切下一家"。
- 响应结构：`query / answer / images[] / results[{title,url,content,score,raw_content,favicon,id}] / response_time / usage.credits / request_id`。

### 坑
- `auto_parameters: true` 会偷偷升 advanced，双倍扣 credit——我们接入时显式锁 `search_depth: basic`。
- answer/raw_content/images 都是加价项（具体加价见 api-credits 页），回落场景一律关掉，只拿 organic 列表最省。

---

## 三、Exa

- 文档：https://docs.exa.ai/reference/search ｜ 定价：https://exa.ai/pricing
- **端点**：`POST https://api.exa.ai/search`，header `x-api-key`
- **⚠️ 参数大变（推翻旧情报）**：`type` 不再是 neural/keyword！现在可选 `instant / fast / auto（默认） / deep-lite / deep / deep-reasoning`——产品路线全面转向"合成输出"，新增 `outputSchema`（JSON Schema 定结构化输出）、`systemPrompt`、`stream`。老参数 `startPublishedDate/endPublishedDate/startCrawlDate/endCrawlDate/numResults/includeDomains/excludeDomains` 都还在。
- category：`company / publication / news / personal site / financial report / people`；**坑：company/people 类目不支持日期过滤和 excludeDomains，用了直接 400**。
- 新增 `userLocation`（两字母国家码）。

### 计费与免费层
- **免费（Starter Free）**：注册送 **$20 credit**，之后**每月送 $10 credit**，免卡；全端点开放；5 QPS；含 MCP server / Claude Connector / ChatGPT plugin。
- 按量：**Search $7/1k 次**（含 ≤10 条结果；每多 1 条/次，+$/1k）；Deep Search $12–15/1k；Deep-Reasoning $15/1k；Contents $1/1k 页（按内容类型）；Answer $5/1k；Monitors $15/1k；Agent $0.012–$1.00/run（ACU $0.10，单次搜索工具调用 $0.005）。
- $10 月度 credit ≈ **1400 次免费搜索/月**——三家里"持续白嫖"最肥的。
- 开发者层 10 QPS，企业定制 QPS。

### mcp.exa.ai 匿名端点实测
- **2026-09-03 实测可用**：`POST https://mcp.exa.ai/mcp`（MCP 协议，`tools/call` → `web_search_exa`），无需任何 key，SSE 返回真实结果（Title/URL/PublishedDate/Highlights）。限额未知，公开资料少，建议：当"超级炮灰"用，失败静默跳过。Task 9-b 的情报"匿名端点存在"属实。

---

## 四、Brave Search API

- 官网：https://brave.com/search/api/ ｜ 文档：https://api-dashboard.search.brave.com/app/documentation
- **端点**：`GET https://api.search.brave.com/res/v1/web/search`，header `X-Subscription-Token`；另有 `/res/v1/llm/context`（LLM 上下文端点）、Answers、Image/Video/News/Suggest/Spellcheck、2026 新增 **Place Search**（对标 Google Maps 的地图点搜索）。
- 参数（官方示例）：`q`、`count`（示例 20）、`country`、`search_lang`；freshness/time_frame 等见文档。
- 响应结构：`{ type:"search", web:{ results:[{ title, url, description, profile:{name,url,long_name,img}, ... }] } }`（≤5 段 snippet，30B 页索引，每天 1 亿次页面更新）。

### ⚠️ 套餐模式 2026 年大变（推翻旧情报）
- 官网现行定价：**Search $5/1k 次，含每月 $5 免费credit**（自动到账）——即 **≈1000 次免费/月**；**50 QPS**。
- Answers：$4/1k + $5/百万 input/output token，2 QPS，同样月送 $5。
- Enterprise：定制。
- **旧的"Free 层 2000 次/月、1 QPS"独立档没了**，换成"月送 $5 credit"模式。旧情报（免费 2000/月）已失效。
- 无超限降速机制文档细节，按报错处理。

---

## 五、Serper

- 官网：https://serper.dev （定价即首页）
- **免费 2500 次一次性：确认还成立**——首页原话 "Get 2,500 free queries. No credit card required"。
- **端点**：`https://google.serper.dev/search`（POST）；垂直端点：/images /news /maps /places /videos /shopping /scholar /patents /autocomplete。认证为 header key（社区通用 `X-API-KEY`；官网首页未展开，接入时以 dashboard 文档为准）。
- 响应结构（首页示例实录）：`knowledgeGraph{...}` + `organic[{title, link, snippet, position}]` + `shopping[...]` 等，Google SERP 原味解析。
- **计费（充值制，非订阅）**：

| 档位 | 价格 | 单价 | QPS |
|---|---|---|---|
| Starter | $50 / 50k credit | $1.00/1k | 50 |
| Standard | $375 / 500k | $0.75/1k | 100 |
| Scale | $1250 / 2.5M | $0.50/1k | 200 |
| Ultimate | $3750 / 12.5M | $0.30/1k | 300 |

- credit **有效期 6 个月**。
- 坑：2500 次是**一次性**不是每月——烧完就没了，适合多号轮换的炮灰池，不适合当长期回落位。

---

## 六、You.com API

- **还活着，且在降价**。官方博客（2026-03-11）：Search API 降到 **$5/1k 次调用**；Contents API $1/1k 页；Research API 价格不动。注册送 **$100 complimentary credits**（官方 quickstart：https://you.com/docs/quickstart ）。
- **⚠️ 文档搬家（旧情报需更正）**：`documentation.ydc-index.io`（本次抓取超时，疑似已退役/跳转）→ 新文档在 **https://you.com/docs**。老端点 `api.ydc-index.io/search` 是否仍在服务未确认，接入前以 you.com/docs/quickstart 为准。
- 2025-07 上架 AWS Marketplace（AI Agents & Tools 类目）——分发渠道多元化，团队没死，反而在打企业单。
- 判决：活着，观察位。$100 送够测一轮。

---

## 七、Mojeek 官方 API

- 官方页：https://www.mojeek.com/services/search-api/ ——**本次两种抓法全失败**（page_reader 422、curl 30s 超时，疑似对沙箱出口封锁），免费层数额没能官方核实。
- 能确认的：API 在售、独立索引、欧洲托管、企业卖点"zero data retention"；2023 年官方博客提到过 API 定价 **$15/1k 次**（当年涨过价 500%）。
- 旧情报"1000 次/月免费"**未获官方确认**，可能已变。**判决**：我们已经爬 Mojeek HTML 了，官方 API 是否更干净值得换，取决于注册后 dashboard 里看到的真实配额——**暂缓，人工注册一次再定**（顺手核实免费层数额与超限行为）。

---

## 八、聚合器一行快查

| 名称 | 免费层（本轮口径） | 备注 |
|---|---|---|
| SerpApi | 100 次/月（官方博客口径）；另有第三方 2026-08 文章称 250/月，未证实 | 付费极贵（$725/月=10 万次）。判决：**不值得**当插槽，免费层太小 |
| SearchApi.io | 100 次（"Get started today with 100 requests for free"，疑似一次性） | 付费 $40/月起。判决：**不值得** |
| ValueSERP | 本轮未直接核实（旧情报 100/月） | 判决：**不值得**，同类里没优势 |

---

## 九、新玩家扫描（2025–2026）

| 新玩家 | 一行判决 |
|---|---|
| **Firecrawl search**（/search 端点） | **值得测**。免 1000 credit/月免卡，搜索+整页正文抽取一个 credit 池，等于 Tavily 的直接竞品；Reddit 口碑比 Jina 稳 |
| **Jina s.jina.ai** | **值得测但只敢低频**。免费有速率限制，Reddit 口碑"并行查询秒被限"；胜在便宜、markdown 干净、无需月费 |
| **parallel.ai** | **观察不急**。企业向 Deep Research/Search API（task API，按任务计费，$0.012–$1/run 量级），接进我们的简单 key 插槽杀鸡用牛刀 |
| 顺带观察 | Brave 新出 Place Search（地图点搜索）、Exa Connect（第三方数据 provider 聚合，BYOK）、You.com 上 AWS Marketplace——key API 们在往"agent 工具生态"卷，纯 SERP 回落反而更好接了 |

---

## 十、Bing Search API 退役后现状

- 退役确认：2025-08-11 正式停（多家第三方 + Microsoft Learn Q&A 一致口径）。
- **2026 年没有复活**。微软官方给的替代是 Azure AI Agents 里的 **"Grounding with Bing Search"**——那是给 agent 用的 grounding 产品，不是 SERP API，无结构化 organic 列表承诺；第三方测算（cloro.dev，2026-03）**贵 40–483%**。
- 判决：**死了就是死了，别等 Azure 出新 SERP API**。Bing 通道在免 key 池里继续用 8-b 已做的 Bing RSS 通道（非官方但活着）。

---

## 插槽接入顺序建议（结论）

**插槽模型**：免 key 池健康度下降（连续失败/空结果）→ 按顺序试 key 插槽 → 全挂才报错。

1. **第一个接 Tavily**，理由三条：① 免费额度最大且**每月刷新**（1000 credit/月，免卡）；② 接入最省事——POST + Bearer 一个 header，参数全是可选；③ **超限报错语义三档分明**（429 限速 / 432 套餐超限 / 433 PAYG 超限），我们的"额度耗尽自动切换"逻辑可以直接对错误码写状态机，不用猜。接入姿势：`search_depth:"basic"`（锁死，防 auto_parameters 偷偷升 advanced）、`max_results:10`、不开 answer/raw_content/images，1 query=1 credit 刚好 1000 次/月。
2. **第二个接 Brave**：月送 $5 credit≈1000 次，独立索引（30B 页）与 Google 系结果互补，50 QPS 很阔。注意套餐刚改成 credit 制，接的时候按 credit 余额判断而不是按次数。
3. **第三个接 Exa**：$10/月 credit≈1400 次，技术/代码查询质量最好（Cursor 都在用）。接 `type:"auto"` 最稳，别碰 deep 系列（贵）。
4. **Serper 当一次性炮灰**：2500 次/号，适合注册小号轮换烧，不进常驻回落链。
5. **Firecrawl search 排在 Tavily 之后一起测**——同为 1000/月免卡，谁的质量好谁上位。

**回合小结**：CSE 计划作废（官方原文钉死 2027-01-01 全 API 退役）；Brave/Exa 参数面均已和旧情报对不上，**凡是"去年存的文档"接入前必须重爬**——这次官方文档巡检证明文档漂移速度 ≈ 半年一大变。
