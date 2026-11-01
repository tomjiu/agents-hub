# 搜索工具专题分析目标清单（下一阶段正式立项）

> 依据：2026-09-02 大扫库（analysis/search-landscape/）+ 2026-09-03 非 GitHub 官方文档巡检（analysis/web-crawl/）+ 用户六大块功能蓝图（商业引擎聚合 / 商业引擎搜不到的补全 / 爬虫 / 数据清洗 / 图片搜索 / 类 search 引擎）。
> 原则：只要"快速拿到搜索结果"，不要 SearXNG 的安全合规全家桶；一切以免 key 优先、key 做插槽。
> ⚠ 官方文档漂移速度 ≈ 半年一大变（Brave 套餐改制/Exa 参数废弃均 10-b 轮发现），接入前必须重爬官方文档。

## P0 — 贴脸对标精读（决定 search-core 怎么进化）

| 目标 | 仓库 | 为什么先读它 | 读什么 | 验收 |
|------|------|-------------|--------|------|
| wigolo | https://github.com/KnockOutEZ/wigolo (4.9k★/2005c/活跃) | 和 search-core 同定位的最强对手：local-first、免 key、10 个 MCP 工具、18 引擎适配器 | docs/tools.md 响应契约、分层抓取路由、失败标注(degraded/blocked_by_challenge)、cache 即搜索面 | ✅ 完成（analysis/deep-wigolo.md，Task 8）：Top3=失败标注契约/熔断 2.0+软截止/FTS5 缓存 |
| ddgs | https://github.com/deedy5/ddgs (2.9k★/881c/活跃) | 免 key 多引擎库的事实标准，一个包 lib/CLI/API/MCP 四形态 | TLS 指纹伪装实现(primp impersonate=random)、10 后端 auto 切换、202 空页检测 | ✅ 完成（analysis/deep-ddgs-metasearchmcp.md，Task 8） |
| MetaSearchMCP | 见 b 报告 | 融合排序 60 行源码讲完，无人真用 RRF | URL 归一化+共识×2+词命中×1+优先级排序的实现 | ✅ 完成（Task 8）：不整体换 RRF 三处小改已落地；10-c 论文对照验证，v0.4 可开加权 RRF 实验分支 |
| MiroThinker | 见 d-alt 报告 (8.3k★) | 第二轮补漏捞到的漏网大件（关键词扫描偏 Perplexica 词根漏掉） | 深研 agent 架构 | ✅ 完成（analysis/quick-mirothinker.md，Task 11-a）：模型研究项目（练出来的搜索模型+agent 架子）代码已冻结，搜索面全 key API 与我们错位；判「参考学」——Wayback+维基修订「时间机器」双工具和工具回话契约值得抄 |
| LLocalSearch | 见 d-alt 报告 (5947★) | 漏网大件：agent 讨论式聚合（多 agent 互相辩） | 讨论式聚合 vs 我们的统计融合 | ✅ 完成（analysis/quick-llocalsearch.md，Task 11-a）：已官方归档死项目（作者转私有 beta），"多 agent 讨论"实为单 agent 日志流+自托管 SearXNG；判「不用学」——只记会话向量库+结果卫生两个点子进 backlog |

## P0 — 免 key Provider 扩池（10-a 官方文档巡检后更新，全部实测取证）

| 引擎 | 端点 | 限额（实测/官方） | 补哪块 | 状态与备注 |
|------|------|------|--------|------|
| Marginalia | **api2.marginalia-search.com/search?query=**（新 API，header `API-Key: public`） | public key QPM 很紧，1次/分保守 | 独立索引通用搜索 | 🔴 迁移令：旧 api.marginalia.nu 时通时断；旧端点保留 fallback |
| Openverse | api.openverse.org/v1/images/ | **20次/分+200次/天**（响应头实抄），page_size≤20 | **图片搜索（最大空档）** | ✅ 已在池；可加 license 透传；governor 限速 1req/4s |
| HN Algolia | hn.algolia.com/api/v1/search | 无官方数字（宽松），hitsPerPage 硬截 1000 | 技术社区垂直 | ✅ 已在池；可加 numericFilters 透传 |
| Wikipedia | {lang}.wikipedia.org/w/rest.php/v1/search/page | 无硬限流；**规范 UA 必须**（含项目 URL） | 百科垂直 | 🟢 **403 破案=UA 问题非协议问题**（T1-T11 矩阵实测）；改 DEFAULT_UA 后进默认池 |
| arXiv | export.arxiv.org/api/query（Atom XML） | **1 req/3s**（实测共享 IP 吃 429），max_results≤2000 | 学术垂直 | 🟡 新增 provider；cheerio xmlMode；429 退避必做 |
| Crossref | api.crossref.org/works?query=&mailto= | rows≤1000，深翻页 cursor | 学术引用垂直（被引数=权威性硬信号） | 🟡 新增 provider；mailto 进 polite pool；snippet 拼 author·期刊·被引 N |
| Mwmbl | mwmbl.org/api/v1/**search?s=**（参数是 s 不是 q！） | 宽松 | Marginalia 熔断备胎 | 🟡 新增 provider（默认不进池，显式启用）；title/extract 是 [{value,is_bold}] 要扁平化 |
| Google News RSS | news.google.com/rss/search?q=&hl=&gl=&ceid= | 100 条封顶；when:1d/site: 实测有效 | 新闻时效垂直 | 🟡 新增 provider（**默认关**：版权条款限个人非商业渲染） |
| Bing RSS | bing.com/search?format=rss | 每查询仅 ~4-10 条 | 零封锁通道 | ✅ 已在池 |
| mcp.exa.ai 匿名 MCP | mcp.exa.ai/mcp（实测 200，v3.2.1） | 配额未公布 | Exa 免 key 匿名档 | 记录不进池：MCP 协议不合 provider 模型 |
| duck.ai | duckchat/v1/status 实测活着 | PoW/vqd 通道 | 免费搜索+引用 | 不进：chat 型定位不合 |
| StackExchange / Wayback / 中文热榜 API | （d-small 报告） | - | 垂直/热点补全 | 未排期（DailyHotApi 上游 100+ 端点） |
| llms.txt 直读 | （d-small 报告） | - | 站点自述通道 | 未排期；focus fetcher 可优先探测 /llms.txt |

验收：每个新 Provider 单测 + smoke 实测；providers 总数 4 → 10+（✅ 已达标）；图片搜索 kind=image 走通（✅ openverse）。

### 立即行动三件套（10-a 给出的代码动作，本轮落地）
1. `config.ts` DEFAULT_UA：假 Chrome → 带项目 URL 规范 UA（一处改动惠及所有 provider，解锁 wikipedia）
2. marginalia 迁 api2（env `SC_MARGINALIA_KEY` 覆盖，默认 public；旧端点降级 fallback）
3. 新增 arxiv/crossref/mwmbl/googlenews provider + DDG 202 软封检测/限速门

## P1 — 深挖参考（学设计不急着抄码）

| 目标 | 为什么 | 取什么 |
|------|--------|--------|
| local-deep-research (9k★/7641c) | 策略开关做最全：pipeline vs agent 自适应换 arXiv/PubMed | ✅ 完成（analysis/p1-research/local-deep-research.md，Task 12-a）：无自动判定器——策略用户显式选+引擎 strengths/weaknesses 元数据拼进工具描述由 LLM 自选；"auto" 元引擎被他们自己删了（教训）；值得抄：引擎元数据/双开关/错误脱敏 |
| SearXNG 本体 (36.4k★) | 只看引擎调度器/限流/超时部分，安全合规全家桶不看 | ✅ 完成（analysis/p1-research/searxng-scheduler.md，Task 12-a）：分档挂起秒数表（CF 验证码挂 15 天）+ per-engine timeout×全局 cap + 嫌疑升级滑动窗口限流；线程弃置式软截止与我们同构；weight 打分与实例防爬限流不抄 |
| dzhng/deep-research (19.6k★/77c) | <500 行讲清研究循环 | ✅ 完成（analysis/p1-research/dzhng-deep-research.md，Task 12-a）：整个循环 294 行实读（非 500）：depth/breadth 每层广度减半+learnings 喂回+查询带 researchGoal；抄三小件（researchGoal/事实抽取硬约束/token 级 trimPrompt），旋钮本身不抄（双预算池+反思已超越） |
| Firecrawl / Crawl4AI | 爬取管道设计标杆 | 抓取→清洗→markdown 的管道分层 |
| anysearch-skill (6k★) | SKILL.md 分发搜索能力的新形态 | ✅ 完成（analysis/p1-research/anysearch-skill.md，Task 12-a）：SKILL.md 三级结构（快速路径/doc 兑底/无效示例）+runtime.conf 由 agent 持久化（代码零写入，说明书即程序）+batch_search（≤5 并行/共享参数注入/JSON 修复）；抄形态不抄商业源 |

## P1 — key 引擎插槽（10-b 官方文档核实后更新，2026-09 实况）

| 服务 | 免费额度（2026-09 实况） | 信用卡 | 角色 |
|------|---------|--------|------|
| **Tavily ①首选** | 1000 credit/月循环（✅ 官方确认仍有效） | 不要卡 | 主选；超限三档码 429/432/433 可直接写状态机；锁死 search_depth:basic 防 auto_parameters 偷升 advanced 扣双倍 |
| **Brave ②次选** | 月送 $5 credit≈1000 次，50 QPS | 不要卡 | 独立 30B 页索引与 Google 系互补；⚠ 旧"免费 2000/月独立层"已死，改 credit 制 |
| **Exa ③第三** | 注册送 $20+每月 $10 credit≈1400 次，5 QPS | 不要卡 | 技术/代码检索最好；⚠ type:neural/keyword 已废弃换 instant/fast/auto/deep 系列，接 type:"auto" |
| Serper ④一次性炮灰 | 2500 次一次性（✅ 确认仍有效） | 不要卡 | 多号轮换烧；credit 有效期 6 个月；$50/50k 起 |
| You.com 观察位 | 注册送 $100 | 不要卡 | 活着且降价（$5/1k，2026-03）；文档搬到 you.com/docs |
| Mojeek API | ⚠ 未核实（官网对沙箱封锁） | - | 已爬 HTML，是否值得换官方 API 待人工注册核实 |
| ~~Google CSE~~ | ❌ **官方原文实锤关停**：API 已对新客户关闭，存量客户 2027-01-01 全部退役（免费层+付费一起死） | - | **划掉，别接别等**；官方替代 Vertex AI Search 只管 ≤50 域名站内搜索 |
| 新玩家 | Firecrawl search 免 1000 credit/月（搜索+抓正文一体，值得测）；Jina s.jina.ai 低频可用 | - | 排 Tavily 之后一起测 |

验收：governor 加"key 引擎额度计数器"，用完自动回落免 key 池；默认零 key 全流程可跑。接入顺序 Tavily→Brave→Exa（10-b 结论）。

## P2 — 防御升级与资产化

1. **TLS 指纹（10-c 选型定案）**：JA4 时代，握手层指纹先于 HTTP 头被读，UA 伪装无用。Node 生态唯一活跃轻量方案 = `impers`（curl-impersonate 绑定，2026-09-01 仍发版，单依赖 koffi，MB 级）；got-scraping/header-generator 只解决 header 层；node tls-client 死 3 年半、cycle-tls 已消失。路线：v0.3 用"绕"（只打不查指纹端点）+ DDG 限速门三件套（3-5s 间隔/202+空页当限速信号退避/UA 固定单值）；v0.4 impers 做 feature-flag 传输层（`SEARCH_TRANSPORT=impers`）；**永不上 Playwright/浏览器**。
2. **engines.md 引擎目录书**：每引擎标 接法/是否 key/封锁特征/实测延迟/协议风险（MetaSearchMCP 80+ provider 表同款），当资产管理。
3. **本地缓存索引**（类 search 引擎块）：~~Meilisearch/MiniSearch~~ → **v0.5 已落地（node:sqlite FTS5 trigram 零依赖方案，比 Meilisearch 轻三个量级）**：pages_fts 倒排索引+searchPages(LIKE 兜底中文短词)+searchCache 出口(MCP search_cache/CLI cache/REST /search_cache)，cache 即搜索面（wigolo 思路），重复查询秒回。
4. **SKILL.md 出口**：给 search-core 写一份 SKILL.md，让 Claude Code 等技能生态直接用（anysearch 验证了这条流量）。
5. **SKILL.md/插件出口升 P0**（第二轮补漏情报）：编码 agent 插件位成了搜索工具新分发渠道（一周内 pi-web-access 1343★/dsh 插件×3/querit 双 harness 齐冒头）。
6. **证据格式标准窗口**：AI 引用/证据格式抢位赛开打（ai-evidence-format-spec/search-responses/answerworthy.md/llms.txt 四家 0-4★ 无人认领）——我们 citations.ts 契约有立事实标准的窗口期。
7. **静默失败检测**（Polaris 参考）："全空=故障"判定→逐级降级→`[via X]` 标注，与 wigolo 失败标注契约合并实现。
8. **Google 现实预期**（d-small 圣杯实锤）：裸纯 HTTP=91KB JS 空壳假货（HTTP 200 最阴险）；可行路径=curl_cffi+浏览器 NID cookie；AI Overview 纯 HTTP 永死——Google 不进 v0.3 引擎池。

## v0.6 候选 — 域名路由表 + StackExchange（2026-09-03 用户三问产出，详见 search-landscape/e 报告）—— ✅ 全部落地（Phase P）

1. **stackexchange.ts（Tier-1 新 provider）**✅：api.stackexchange.com 免 key 300 次/天/IP（免费注册 key 10000/天，30 req/s），响应自报 quota_remaining；编程垂直权威源，补"只有 github 没有 StackOverflow"缺口。
2. **domains.json 查表路由（用户提案"AI 维护动态域名表"落地）**✅ 落地为 src/domains.ts DOMAIN_TABLE（TS 表在 git 同样可审查可回滚）：planner web 路由前插一层查表——Tier1 免 key API 直连（复用现有 19 provider）/ Tier2 无 API 权威域走 `site:` 前缀（DDG/Mojeek/Yahoo/BingRSS，googlenews 已验证 site: 有效）/ Tier3 通用池兜底；种子表 30-50 域 git 管理；学习回路=低质查询的权威域经 smoke 验证后才入表（防 LLM 幻觉造域名）；健康归 breaker 巡检零新机制。约百行级改动。
3. **key 插槽观察位**（待注册核实，未接）：Perplexity Search API（2026 新出独立搜索端点，原生 domains 过滤参数）/ 博查 Bocha（¥0.036/次≈$5/1k，**有国内 Region**，中文 query 付费首选候选，官方 MCP 已上架）/ Linkup（口碑榜新选手）。Brave 免费额度修正为**每月 $5 credit≈1000 次**（官网实抓，月月循环）。

## 风险台账（10-a/b/c 官方文档巡检后更新）

- DDG：202 空页=软封会自愈，触发=突发高频+脏 IP（datacenter 代理反而更糟）；html/lite 端点免 vqd 单请求直出；绕法=限速门+指数退避+空结果当限速信号；DDG 流量 2026-05 暴涨 30%（agent 大迁徙），礼貌限速=生存项
- Wikimedia：**UA 政策硬门槛**（无 UA/空 UA/泛 UA/浏览器伪装 UA 一律 403，Phab T400119）；规范 UA（带项目 URL）h1.1/h2 全通——Task 8 "拒 h1.1"结论作废
- Marginalia：旧端点慢性死亡 → api2 迁移（public key QPM 紧，governor 1次/分）；CC-BY-NC-SA 限商用
- 独立引擎死亡率：alexandria.org DNS 已死、stract.com 域名易主——任何单源不得硬依赖，小众源用更低熔断阈值
- 公共 SearXNG：429/Anubis 挑战/IP 黑名单三重死法 → 文档明确"自托管假设"
- Google 直抓：2026 共识已死（裸 HTTP=JS 空壳，TLS 伪装救不了，50-100 次/天验证码）；唯一可靠免 key 面 = Google News RSS；curl_cffi+NID 结论打折看待（灰区，不可工程依赖）
- Bing API：2025-08 退役无复活；微软替代 "Grounding with Bing" 非 SERP 且贵 40-483%（cloro.dev 2026-03）
- Brave 免费层：旧 2000/月已死改 credit 制；Serper 2500 是一次性不是每月

## v0.7 候选 — 注册表与垂直资产层（2026-09-03 "继续扩大搜索面"第二批）—— ✅ 全部落地（Phase R）

1. **包管理器四兄弟补齐跨语言版图**✅：crates(Rust, 561ms)/packagist(PHP, 398ms)/rubygems(Ruby, 317ms) 补 npm(JS)——全部免 key 官方 API（probe-v07 实测）。**PyPI 诚实不接**：官方 search API 已关停（XML-RPC search 退役），不做 HTML 爬，python 包查询走编程主题（SO 答案本身就在推荐包）。
2. **开发者资产双源**✅：huggingface（模型权重，248ms，sort=downloads）/ dockerhub（容器镜像，336ms，official `/_/` 与用户 `/r/` URL 分支）。
3. **学术双补**✅：openalex（2.5 亿 works，1176ms，被引数+OA 链接，URL 阶梯 landing_page→oa_url→doi，mailto polite pool 同 crossref）/ dblp（CS 会议目录，1106ms，补 crossref 对会议论文的盲区；authors.author 单对象/数组/缺失三态归一化）。
4. **实体背景**✅：wikidata（wbsearchentities，604ms，Q-id 永久 URI，language 跟随 ctx.opts.lang；域名表尾最低优先防误伤）。
5. **探测后放弃（诚实记录）**：semantic scholar 免 key 10s 超时无响应（拥堵出名，进观察位待注册 key）；lobste.rs 沙箱 TCP 不可达（同 tiekoetter 前科，线下复测再议）。
6. **表序新规则**：窄关键词主题（packages/devops）必须排在宽关键词主题（programming 的 `" npm "`/`"docker"`）之前，否则包/镜像意图被编程专线截胡——probe-v07 端到端验证 4 类查询路由全对。
7. **测试**：143/143（+24：8 provider golden 样本与 URL 兜底分支/错误分类/域名表 4 新主题/表序回归/planner 集成/表完整性防手误检查）。

## v0.7 出口实战化 — MCP 接入指南 + 真网络实测（2026-09-03 Phase S，用户选"1"=动工 MCP 出口）—— ✅ 全部落地

1. **docs/mcp-exit.md「不绑账户的眼睛」卖法文档**✅：四模式缺口 recap（A/B 模式用户 BYOK 只卖大脑不卖眼睛）→ 通用 stdio 配置/Claude Code（`claude mcp add` + .mcp.json）/Claude Code on Bedrock（WebSearch 不可用的官方补法=挂 MCP 搜索 connector，本 server 即现成 connector）/Cursor 四套接入片段 + 已验证/未验证诚实矩阵（Bedrock 真会话与 GUI 点击流沙箱无法验证，如实声明不冒充实测）。
2. **probe-mcp-real.mjs 真网络 stdio 全流程实锤**✅：协议 2025-06-18 协商通过（老探针 2024-11-05 已过时）；通用搜索冷 6.0s/热缓存 2ms（首条即 MCP spec 官方页）；域名专线 "rust crate async runtime" → **route: domain + domain: packages**，npm+crates 双 API 腿 562ms；focus 抓取省 79% token；渐进披露 tool_search 激活 3→4；健康面 29 注册/9 有战绩/0 熔断。
3. **版本单一事实源 src/version.ts**✅：运行时 createRequire 读 package.json，消灭 mcp.ts/http.ts/cli.ts 三处手写版本号——实测 bug：mcp.ts 写死 "0.5.0" 落后 package.json 两个 minor 且无人发现，正是单点漂移教训。
4. **planner route 标注修正**✅：域名命中 route "web"→"domain"（types.ts 联合类型扩展 + domains.test 同步）；MCP search meta 新增 `domain` 字段（消费方直接读出 packages/academic/... 主题专线）。
5. 顺带核实：domains.test 里 "rust crate" 关键词是连续子串设计（"tokio rust async runtime crate" 中间断开不命中属防误伤预期行为，非 bug）。

## v0.8 候选 — key 插槽观察位重排 + 竞争情报（2026-09-03 f 报告产出，用户问"还有什么可借鉴（含闭源）"）

1. **Gemini grounding 升第一观察位**：Gemini Developer API $14/1k + **5,000 次/月免费**（Vertex $25/1k）——CSE 2027-01 关停后唯一合法 Google 结果路径，免费量是 Tavily 的 5 倍。需 Google 账号+计费开通，注册后实测再接。
2. **智谱 web-search 升中文首选候选**：基础版 ¥0.01/次 / pro ¥0.03/次（官方页实抓），打博查 ¥0.036 有 2.6 倍价差，同有国内 Region；pro 版"多引擎协作降空结果率"口径待实测验证。
3. **Parallel Web Systems**：agent-first 搜索 API，Fast $1/1k(~700ms)/Basic+Advanced $5/1k，带 Extract API 配对——Tavily 贴脸竞品，免费层有无待核实。
4. **Moonshot $web_search / xAI Live Search**：观察位垫底（均为第三方口径价：$0.005/次双计费注意 / $5/1k 疑似降价），接前必须官网核实。
5. **竞争态势**：OpenRouter 2026-05 已把 search+fetch 做成跨 400+ 模型的收费标配（Exa 供数）——我们 MCP 免 key 出口卡位仍成立但窗口收窄，差异化守"零门槛+可审计+本地缓存面"。
6. research loop 挂账（a 报告在案）：STORM 多视角提问→planner 角度生成；gpt-researcher RETRIEVER 抽象/plan-exec 分工。详见 analysis/search-landscape/f-keyed-apis-scan.md。

## v0.8 — 三框架源码解剖后的纳入（2026-09-03 Phase U，用户"有用的设计就纳入"）—— ✅ 全部落地（154/154）

1. **mcp-connector provider**✅（gpt-researcher RETRIEVER=mcp 思想无 LLM 版）：`src/providers/mcp-connector.ts` — 外部 MCP 搜索源即插拔（stdio 子进程 + streamable HTTP 双传输），懒连接+失败清理防子进程泄漏，工具选择=显式配置>启发式（替代原家 LLM 选法），结果三形状归一化，空结果抛错；配了才注册，keySlot 语义同 tavily；`SC_MCP_CONNECTORS` JSON 配置。离线夹具（手写 JSON-RPC fake server）真子进程全链路 6 测试。
2. **RESEARCH_PRESETS 预算预设**✅（gpt-researcher 报告类型×Morphic Quick/Adaptive 同构）：summary(1轮/4抓/60ref) < report(默认) < deep(5轮/24抓/240ref)，逐字段可覆盖，MCP/CLI/REST 三出口；probe-v08 真网络 summary 档 7.6s 出迷你报告。
3. **STORM-lite 角度选择**✅（persona_generator.py L134-155 强制兜底视角的规则版）：角度池 5→8（+教程与实践/历史与背景/生态与工具），selectAngles()=定义与概念永远保留（basic fact writer 对应）+signals 正则命中优先+池序补满；诚实标注=无 LLM 模板近似非复刻。
4. **buildOutline 大纲骨架**✅（STORM outline 无 LLM 版）：角度即节+逐节 facts/tier1Facts/top2 域统计，进 ResearchResult.outline + MCP/REST 出口。
5. **明确不抄（反向验证我方更强）**：gpt-researcher 引用仅 prompt 约束（我们 citations.ts 出口校验更强）/STORM 引用不足不补搜（我们 Q2 覆盖率驱动 CONTINUE 更强）/Morphic 生成式 UI 与 Redis（headless 不适用，FTS5 已落地）。详见 analysis/search-landscape/deep-gptr-storm-morphic.md。
6. **过程抓 3 真 bug**：启发式零分工具应拒选 / build `cp -r` 嵌套目录陷阱（fixtures 拷两份）/ fixture 把 JSON-RPC id=0 当 notification 丢弃（SDK 客户端 id 从 0 起）+ 连接失败路径不关 client 泄漏 stdio 子进程钉死测试进程。
7. **fetcher 候选记账**：Morphic safe-fetch 5 跳重定向逐跳 SSRF 校验（我们 SSRF strict 已有，逐跳细节后补）。

## Phase V — 全链路质量评测 + 优先域名（2026-09-03，用户"MCP 实测不急，先测质量+加权威学术域名"）—— ✅ 落地（162/162）

- [x] **authority.ts 权威域名优先**✅：首批 16 学术域（arxiv/nature/science/ieee/acm/springer/sciencedirect/wiley/tandfonline/ncbi.nlm.nih.gov/semanticscholar/aclanthology/openreview/plos/core.ac.uk/wikipedia），段精确匹配防伪命中，只提权不屏蔽；topic 感知分档（academic 专线 0.75 /通用 0.4）修事实型查询副作用
- [x] **quality-bench.mjs 五维评测**✅：8 题+2 题 research 真网络，两轮跑数（第 1 轮暴露→修→第 2 轮验证）；报告 docs/quality-baseline-v1.md
- [x] 实测口径：清洗 100% 干净（nav 0.1/页）/爬取 79%（失败集中在 crates SPA+npmjs 403+doi 落地 403）/引用覆盖 100%/解题 6/8
- [x] 修复 3 处：dockerhub repo_name 自带 namespace 拼接 404 / 事实型查询被 arXiv 淹没（提权分档+wikipedia 入表）/ 探针 research 属性调用
- [ ] 待办（按解题率收益排序）：registry 长查询浓缩（crates/npm）→ crates.io fetch 走 API 端点 → doi OA 直链 → topN 域名多样性裁剪 → 中文查询面（智谱 key 候选已在 f 报告挂账）→ MCP 外部连接器真机实测（用户明确往后放）

## Phase W — 置信度筛选 + 多样性 + registry 修复（2026-09-03，用户"1和2都做+屏蔽 csdn/百家号/搜狐灌水站+冷门专业自己做"）—— ✅ 落地（175/175）

- [x] **credibility.ts**✅：硬屏 12 域（点名 3+百度系 3+文库爬虫 6）+降权 3 域（-1.2），段精确匹配，只删点名站不猜关键词（知乎/cnblogs 不误伤）；`meta.spamBlocked` 计数可审计
- [x] **域名多样性 cap**✅：单域≤3，domain 路由/x 搜索豁免（单源专线同域是特性，cap 误伤实测修复）；中文题 1→6 域
- [x] **packages 闭环**✅：crates sort=downloads + condensePackagesLeg 语言腿裁剪；case4 MISS→L1（tokio #4）
- [x] **冷门源**：Marginalia（冷门站索引王牌）/StackExchange 170+ 子站已在仓；Lobsters 仍 ETIMEDOUT、Reddit 403 反爬——诚实不接；packagist/rubygems 间歇复核健康
- [ ] 待办：crates fetch 走 API 端点 / doi OA 直链 / **fact 型 wiki 出勤保障** / 冷门源扩充（逐个过 smoke）/ 智谱 key / MCP 真机实测（后置）

## Phase X — Marginalia 口径定案 + 冷门面第二腿 wiby（2026-09-03，用户问"Marginalia 限额/付费/本地降级？本地引擎+API 聚合架构，冷门原网站通过搜索扩充"）—— ✅ 落地（176/176）

- [x] **Marginalia API 口径定案**（官方文档 2025-12-08 版实抄+当日探针）→ `analysis/search-landscape/marginalia-api-terms.md`：public 共享键免 key 可用（打满 503，创始人口径 IIRC ~15 q/min 仅供参考）；免费正式键邮件申请=非商用 CC-BY-NC-SA；付费键永远可选项（非商用一次性买断/商用按量 polar.sh）；本地降级四层（provider 内 api2→旧端点 fallback / 池层 mwmbl 备胎+熔断 / FTS5 缓存 / 终极=自托管+downloads.marginalia.nu 数据集 1.3GB-81GB，存在性记档不建议现在做）；**商用化红线**：免 key 路线数据 CC-BY-NC-SA 非商用
- [x] **marginalia 加 dc=3**：官方"每域最多几条"参数，与 fuseSemantic domainCap=3 对齐（源头多样→融合才有多样可保）；api2+旧端点双路都带
- [x] **wiby provider（冷门面第二腿）**：wiby.me JSON（探针 200 OK），古典老网/个人站，与 marginalia（学术倾斜独立索引）互补；Description 真摘要优先/Snippet 导航噪声兜底/实体解码；**默认池 10→11**
- [x] 第 4 轮 bench 验证无回归：L1+L2=7/9 持平，清洗 100%，MISS 集合不变（fact=wiki 缺勤波动/zh=数据源缺口，均已在案）；测试 175→176
- [ ] 待办（承接 Phase W）：crates fetch 走 API / doi OA 直链 / fact 型 wiki 出勤保障 / 中文面（智谱 key）/ MCP 真机实测（后置）

## Phase Y — Hikari 网关 + keenable 独立索引腿（2026-09-03，用户"加入 keenable.ai + tavily-hikari CLI/MCP/HTTP API"）—— ✅ 落地（179/179）

- [x] **keenable**✅：免 key 公共路（1000 次/时/IP，X-Keenable-Title 必填）+key 升 10 万 credit/月；433ms 实测；默认池第 12；bench L1 6→8、L1+L2 9/9 全绿（fact+中文题翻绿，keenable 出勤 6/9）
- [x] **tavily-hikari**✅：tavily.baseUrl（`SC_TAVILY_BASE_URL`）+ mcp-connector headers（/mcp Bearer）双路；全案 docs/tavily-hikari.md；token 只走 env 不进仓库
- [ ] 待办（不变）：crates fetch 走 API / doi OA 直链 / fact 型 wiki 出勤保障（本轮 fact 题已靠 keenable 翻绿，机制仍值得做）/ 中文面继续观察（本轮中文题翻绿=keenable 贡献，持续验证）/ MCP 真机实测（后置）

## Phase Z — 同题对照轮 + planner 编程腿修复（2026-09-03，用户"跑一轮测试和你之间搜索的进行对比"）—— ✅ 落地（180/180）

- vs-zai-compare.mjs：9 题同尺对照托管聚合黑盒（我方 AI 内置 web_search），3 全量样本；对照报告 docs/vs-zai-search-compare.md
- 对照挖出真 bug：中文编程题域名路由腿集太窄（3 英文系腿+ddg 限流→单腿塌方），programming 补 keenable 保底+真实 miss 题回归锁（179→180）
- 修复后 9/9 vs 9/9 战平；权威密度 2.6 倍/灌水 0 vs csdn 稳坐对方 top1/重叠 Jaccard 0.16=双面架构实证；第 6 轮 bench L1+L2=9/9 历史最高

## Phase AA — 对照驱动增量扩源（2026-09-03，用户"根据你的搜索广度来给+增量"）—— ✅ 落地（185/185）

- MDN 直连 API（35 号 provider，编程 Tier1，locale 跟随语言，documents=[] 合法空不误伤熔断）
- planner 查询语言自动检测（CJK≥2→zh）→ engine 合并 opts.lang → 三条已写好的中文路由（wiki zh/googlenews 中文版/mdn zh-CN）首次自动触发
- programming site: 槽位 developer.mozilla.org→docs.python.org；devdocs/searxng 公共实例/ddg 区域参数探针后诚实不接
- 第 7 轮 bench 9/9 无回归（出勤 4.6→4.9）；vs-zai 第 4 采样 9/9 vs 9/9

## Phase AB — 免 Key 公共源审计与增量（2026-09-03，用户提供清单）—— ✅ 落地（200/200）

- 探针矩阵 16 候选全案：docs/keyless-increments.md（证实 6 / 诚实不接 7 / 挂账 2）
- anysearch 默认池第 13 + tavily keyless 车道（无 key 也进池）+ firecrawl 显式 + searxng 多实例回退链
- pubmed academic 腿 + sov2ex 中文编程腿（CJK lang-guard）+ mcp-connector argsTemplate（Parallel 匿名 MCP 配方在案）
- 第 8 轮 bench L1+L2=9/9 无回归；vs-zai 第 5 采样战平+延迟反超+Jaccard 上升（聚合覆盖增量）
