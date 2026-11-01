# f — 闭源/付费搜索 API 六家补扫 + 赛道窗口期判断（2026-09-03）

> 触发：用户问"还有没有值得借鉴的搜索工具（包括闭源）"。
> 诚实边界先行：开源侧（gpt-researcher 29.3k★/STORM 31.2k★/Morphic 9.1k★）**a 报告第一轮已深度覆盖**（含借鉴点列），本轮不重复立传；
> 本轮真新货 = **闭源商业 API 六家**（价格/免费层/角色），全部 z-ai web_search 实抓（2026-09-03），第三方口径逐条标注。

## A. 六家补扫表（按对我方价值排序）

| # | 服务 | 价格（2026-09 实抓） | 免费层 | 对 search-core 的角色 | 信源与置信 |
|---|---|---|---|---|---|
| 1 | **Gemini grounding（google_search tool）** | Gemini Developer API：**$14/1k** grounded queries；Vertex Agent Platform：$25/1k grounded prompts | **5,000 次/月免费**（Gemini 3.x 共享） | **CSE 2027-01 关停后的唯一合法 Google 结果路径**——免费量比 Tavily（1000/月）还大 5 倍。key 插槽观察位**升第一优先**。另注意 server-side tool 模式=模型自决何时搜（我们 planner 是它的客户端同构物，行为可对照） | ai.google.dev 官方 pricing 页（直抓摘要）+ cloud.google.com；置信高 |
| 2 | **智谱 web-search / web-search_pro** | 基础版 **¥0.01/次**；pro 版 **¥0.03/次**（多引擎协作、降空结果率，官方口径） | 无（纯计量） | **中文付费首选候选易主**：基础版 ¥0.01 打博查 ¥0.036（Phase Q 核实价）2.6 倍价差，同有国内 Region+中文生态。key 插槽观察位升第二 | docs.bigmodel.cn 官方文档页（直抓摘要）；置信高 |
| 3 | **Parallel Web Systems（parallel.ai）** | **Fast 档 $1/1k**（~700ms）；Basic/Advanced $5/1k；另有 Extract API 与 Search 配对 | 未确认 | **Tavily 的贴脸竞品**：agent-first 定位+自家 Tavily-vs-Parallel 对比页；Fast 档价格是全表最低档。若注册实测通过，可顶替 Tavily 的"①首选"位（Tavily 1000 credit/月 vs Parallel 纯计量更便宜） | parallel.ai 官网多页（直抓摘要，含 2026-04-21 升级公告与比价页）；置信高，免费层待核实 |
| 4 | **OpenRouter web search（server tool）** | Web Search Server Tool **$5/1k requests** + 超量结果 $1/1k；Exa 通道 Instant/Fast/Auto **$0.005-0.007/req** | 无 | 竞争情报为主：2026-05 官宣"search+fetch 跨 400+ 模型统一"——**与 search-core MCP 出口的 search+fetch 工具对同构，但是收费版**。零 key 免费定位的窗口仍在，但收费巨头已把"agent 搜索"做成标配 | openrouter.ai 官方 docs 多页 + exa.ai 案例（直抓摘要）；置信高 |
| 5 | **Moonshot $web_search（Kimi 内置）** | **$0.005/次**（第三方口径）；注意**双计费**：搜索费 + 注入结果的 token 费分收 | 无 | 中文备选观察位。原生 $web_search 内置工具流存活确认（2026-02 仍有网关集成 issue） | platform.kimi.ai 官方文档（功能确认）+ developer.puter.com（2026-07 价格，**第三方口径待官网核实**） |
| 6 | **xAI Live Search（Grok）** | **$5/1k calls**（第三方 2026-08 口径；2025-05 上市价 $25/1k sources，疑似已降价） | 无（曾送 $175/月 credit 的活动口径见第三方） | 观察位：差异化在 **X/Twitter 数据面**——我们 x_search 的官方 key 通道候选（现在走 guest GraphQL+site: 降级链）。首轮搜索被"SpaceXAI"仿冒 SEO 站污染，官网价待 docs.x.ai 人工复核 | datanorth.ai（2026-08-13，第三方）+ mem0.ai；**低置信，接前必须官网核实** |

## B. 赛道窗口期判断（大白话）

1. **"给 agent 的搜索"已被收费巨头做成标配**：Parallel 打"highest accuracy AI search API for agents"、OpenRouter 打"400+ 模型统一 search+fetch"、Gemini grounding 塞进模型 API——三家都在收钱卖"眼睛"。
2. **我们卡位依然成立**：他们全都要 key+绑账户+纯计量，**免 key 免账户零成本试用的位置仍然空着**（Phase Q 四模式结论不变）；但窗口在收窄——Parallel Fast $1/1k 已经便宜到"不注册白不注册"的边缘，我们的差异化必须守住"零门槛+可审计+本地缓存面"三件套，而不是价格。
3. **Google 面的唯一活路确认**：CSE 2027-01 死后，Gemini grounding 是唯一合法 Google 结果通道（5000 免费/月），值得提前接入试水——这也是 v0.6 key 插槽表划掉 Google CSE 时留的伏笔，现在补上答案。

## C. 行动清单（进 targets-search v0.8 候选）

- **key 插槽观察位重排**：① Gemini grounding（5000 免费/月，Google 唯一活路）② 智谱 web-search（¥0.01 中文首选候选）③ Parallel Fast（$1/1k 全场最低价候选）④ Moonshot $web_search（中文备选，双计费注意）⑤ xAI Live Search（X 数据面，官网核实后再议）。
- **research loop 借鉴**（a 报告已在案，此处仅挂账）：STORM 多视角提问→planner 角度生成（a 报告原话"planner 最该抄的学术招"）；gpt-researcher 的 RETRIEVER 环境变量式检索器抽象与 plan/exec 分工。
- **不接**：Morphic 生成式 UI（headless core 不适用）；OpenRouter 通道（我们本身就是搜索方，不走别人转售）。
- **待人工核实清单**：Parallel 免费层有无；Moonshot 官网价与双计费细节；xAI 官网现价；智谱 web-search 的配额/并发限制。

## D. 信源

- 实抓：z-ai web_search 9 次（2026-09-03），原始 JSON 留档会话工作目录不入仓（沿用 Phase Q 口径）。
- 官方页：ai.google.dev/pricing、cloud.google.com/vertex、docs.bigmodel.cn（联网搜索）、parallel.ai（pricing/upgrade/tavily-vs）、openrouter.ai/docs（web search 多页）、platform.kimi.ai（联网搜索功能页）、github.com（parallel/gpt-researcher 间接）。
- 第三方价（低置信标注）：developer.puter.com（Kimi $0.005/次）、datanorth.ai（xAI $5/1k）、mem0.ai、skillsllm.com（gpt-researcher 29.2k★旁证）。
- 既有覆盖交叉引用：a-ai-search-products.md（开源三框架原表 27/28 行）、c-search-apis.md（Tavily/Brave/Exa/Serper/Kagi 现有表）、e 报告附二（博查 ¥0.036/次核实口径）。


## 附录（phase Y, 2026-09-03）：keenable 改写免费额度格局 + Hikari 自建网关样本

- **keenable.ai**（官方 docs.keenable.ai 实抄+实弹探针 200/433ms）：免 key 公共路 1000 次/时/IP **不计量**；有 key（邮件/控制台申请）**100,000 credit/月免额**——免费额度一举超过 Gemini grounding 的 5000/月，成为本报告**免额榜首**；10 req/s（org 级），search/fetch 各 1 credit，search 分 realtime/pro 双 SKU，支持 point-in-time 索引查询（query_time）/站点限定/日期窗。已接为默认池第 12 腿（keyless 优先，SC_KEENABLE_KEY 可升）。
- **tavily-hikari（IvanLi-CN）**：自建 Tavily 兼容网关样本——协议级兼容（/api/tavily/search+远程 MCP /mcp 双形态，Bearer th- token），证明"付费 API 网关化+多客户端复用"是活跃玩法；我们引擎以 tavily.baseUrl / mcp-connector.headers 双路原生支持（docs/tavily-hikari.md）。
- 对免费层结论的修正：keyless-zero-account 槽位比上一轮判断的更宽——keenable 公共路给了第三条"零 key 全功能"大路（前两条 bingrss/marginalia）。
