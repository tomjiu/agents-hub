# search-core v0.7

> 客户端搜索编排器 — 实现 [design/v0-spec.md](../design/v0-spec.md) 的 v0.2 范围 + v0.3 扩池 + v0.4 防御升级 + v0.5 时间机器 + v0.6 域名路由 + v0.7 注册表与垂直资产层。
> 逆向依据: reports/01-13(标注格式 `[NN]` = 对应报告)。
> v0.2 新增: **Research Loop 状态机 / embedding 双阈值融合 / X 四层降级链 / 引用出口校验 / REST+SSE 网关 / tool_search 渐进披露**。
> v0.3 新增(10-a/b/c 官方文档巡检后): **默认池 10 引擎(wikipedia 解掑/arxiv/crossref 新增) / marginalia 迁 api2 / DDG 202 软封检测+限速门 / 图片搜索 kind:image / 新闻垂直 kind:news**。
> v0.4 新增(wigolo[09] 契约学走 + Tavily 插槽落地): **失败标注契约(status/retryable 六类) / 熔断 2.0(分类阈值+半开探针冷却翻倍) / 软截止(到点先收割慢腿不再干等) / key 引擎插槽(Tavily/Brave/Exa 月度额度计数器, 用完自动回落免 key 池; Tavily 迁 Bearer 认证+432/433 一票判死)**。
> v0.5 新增(MiroThinker 时间机器 + wigolo[09] Top3 缓存面落地): **wayback(CDX 快照时间线, kind:archive) / wikirev(维基修订历史, oldid 永久直链) 双 provider / FTS5 缓存即搜索面(cache.searchPages → core.searchCache, trigram 中文 ≥3 字可搜+LIKE 兜底, MCP search_cache + CLI cache + REST /search_cache 三出口)**。
> v0.6 新增(用户提案"AI 维护动态域名表"落地 + e 报告三档全景): **域名路由表(DOMAIN_TABLE+lookupDomains, planner 查表命中→领域专线分腿: Tier1 免 key API 直连 + Tier2 site: 前缀通用引擎 + Tier3 通用池兜底) / stackexchange(免 key 300/天, 注册 key 10000/天) / npm(包名垂直) 双 provider; 新增后 provider 总数 19→21**。
> v0.7 新增("继续扩大搜索面"第二批): **src/providers/registries.ts 八连发全免 key 官方 API — 包管理器四兄弟 crates(Rust)/packagist(PHP)/rubygems(Ruby) 补齐跨语言版图(PyPI 无官方 search API 诚实不接) + 开发者资产 huggingface(模型权重)/dockerhub(容器镜像) + 学术双补 openalex(被引数+OA 链接)/dblp(CS 会议目录) + 实体背景 wikidata; 域名表 3→7 主题新增 packages/ai-models/devops/entities; 表序新规则: 窄关键词主题先于宽关键词主题防截胡; 注册 21→29(目录在案 32)**。
> v0.7 出口实战化(Phase S): **MCP 出口接入指南 docs/mcp-exit.md("不绑账户的眼睛"卖法, Claude Code on Bedrock 补眼场景)+ probe-mcp-real.mjs 真网络 stdio 全流程实锢(协议 2025-06-18/域名专线 route:domain/focus 省 79% token/渐进披露)+ 版本单一事实源 src/version.ts(消灭三处手写版本号漂移, 实锢 bug: mcp.ts 写死 0.5.0 落后两个 minor)+ planner 域名命中 route 标注 "web"→"domain"+ MCP meta 增 domain 字段**。
> v0.8 新增(Phase U, 三框架源码解剖后纳入, 详见 analysis/search-landscape/deep-gptr-storm-morphic.md): **① mcp-connector provider(gpt-researcher RETRIEVER=mcp 思想无 LLM 版: 外部 MCP 搜索源即插拔, stdio+streamable HTTP 双传输/懒连接/失败清理防子进程泄漏/三形状归一化, 配了才注册 keySlot 语义同 tavily, 一次接入吃遍 Tavily/Exa/博查现成 MCP server; SC_MCP_CONNECTORS JSON 配置) ② RESEARCH_PRESETS 预算预设表(gpt-researcher 报告类型×Morphic Quick/Adaptive 同构, summary 1轮/4fetch < report 默认 < deep 5轮/24fetch, 逐字段可覆盖, MCP/CLI/REST 三出口) ③ STORM-lite 角度选择(persona_generator 强制兜底视角的规则版: 角度池 5→8, 定义与概念永远保留+查询信号选+池序补满) ④ buildOutline 大纲骨架(STORM outline 的无 LLM 版: 角度即节+逐节 facts/tier1/来源域统计, 进 ResearchResult.outline 三出口)**; 测试 143→154; 过程抓 3 真 bug: 启发式零分工具应拒选/ cp -r 嵌套目录陷阱/ JSON-RPC id=0 falsy 陷阱(SDK 客户端 id 从 0 起)+连接失败路径子进程泄漏; 总注册 29+连接器(按配置), 目录在案 33
>
> v0.8 质量轮(Phase V, 用户提案"优先域名+全链路质量评测", 详见 docs/quality-baseline-v1.md): **authority.ts 权威域名优先(16 学术域含 wikipedia, 段精确匹配防伪命中, 只提权不屏蔽, topic 感知分档: academic 专线 0.75/通用 0.4) + quality-bench.mjs 五维评测(搜索/爬取/清洗/文本/解题: 8 题+2 题 research 真网络)**; 实测清洗 100% 干净/引用覆盖 100%/解题 6/8(两 MISS 根因在数据源非编排); 修复 3 处: dockerhub repo_name 自带 namespace 拼接 404/事实型查询被 arXiv 淹没(提权分档+wikipedia 入表)/探针 research.run; 测试 154→162
>
> v0.8 置信度轮(Phase W, 用户提案"屏蔽 csdn/百家号/搜狐等灌水站+冷门专业自己做"): **credibility.ts 置信度筛选(硬屏 12 域剔除+计数/强降权 3 域 -1.2 标注, 段精确匹配防误伤, 知乎/cnblogs 不动) + 域名多样性 cap(单域≤3, domain 路由与 x 搜索豁免——cap 误伤单源专线实测修复) + packages 闭环(crates sort=downloads+语言腿裁剪, case4 MISS→L1)**; 冷门源核查: Marginalia 冷门站索引+StackExchange 170+子站已在仓, Lobsters 仍不可达/Reddit 403 诚实不接; 第三轮 bench 解题 7/9, 清洗 100% 干净; 测试 162→175

## 快速开始

```bash
cd core
npm install && npm test          # 143 项单测
npm run smoke                    # 真实引擎连通性(依赖网络环境)
node dist/cli.js search "sqlite-vec"           # 多引擎并行搜索(语义去重)
node dist/cli.js fetch https://github.com/asg017/sqlite-vec --focus "installation"   # focus 抓取
node dist/cli.js cache "borrow checker"           # v0.5 离线搜已抓页面(FTS5, 毫秒级)
node dist/cli.js research "sqlite vector search landscape" --loops 3   # 深度研究循环
node dist/cli.js research --resume <runId>       # 断点恢复
node dist/cli.js serve           # MCP stdio server(search/fetch/tool_search Direct + 5 Deferred)
node dist/cli.js serve-http      # REST + SSE 网关(POST /research = agentic_search 式事件流)
```

MCP 接入(pi/dsh/Claude/Codex 均为标准 MCP client):

```json
{ "mcpServers": { "search-core": { "command": "node", "args": ["/path/to/core/dist/mcp.js"] } } }
```

HTTP/SSE 探针: `node scripts/http-probe.mjs`;MCP 渐进披露探针: `node scripts/mcp-probe.mjs`。

## 配置

`~/.search-core/config.json` 或环境变量(优先):

| 配置 | 环境变量 | 说明 |
|---|---|---|
| dataDir | `SC_DATA_DIR` | 默认 `~/.search-core`(cache.db + journal/) |
| engines | `SC_ENGINES` | 默认 `searxng,duckduckgo,mojeek,yahoo,marginalia,hn,bingrss,wikipedia,arxiv,crossref,wiby,keenable`(12 引擎) |
| timeoutMs | `SC_TIMEOUT_MS` | 单引擎超时,默认 12000 |
| softDeadlineMs | `SC_SOFT_DEADLINE_MS` | v0.4 软截止: 到点先收割已完成引擎,慢腿断开并以 timeout 身份入 failed;默认 6000,0=关 |
| keySlots | `SC_KEY_SLOTS=off` 关 | v0.4 插槽自动并联: auto(默认)=已配 key 且额度未尽的 tavily/brave/exa 自动加入默认池,额度尽自动回落免 key 池 |
| tavily.baseUrl | `SC_TAVILY_BASE_URL` | phase Y: 指 Tavily 兼容网关(如 tavily-hikari `https://tavily.ivanli.cc/api/tavily`), 不设=官方端点; 走网关建议配 `SC_TAVILY_MONTHLY_QUOTA=0` |
| keenable | `SC_KEENABLE_KEY` / `SC_KEENABLE_TITLE` | phase Y: 有 key 走正式路 /v1/search(10 万 credit/月免额); 无 key 公共路 /v1/search/public(1000 次/时/IP), title 缺省 search-core |
| tavily.monthlyQuota | `SC_TAVILY_MONTHLY_QUOTA` | v0.4 月度额度本地计数,默认 1000(免费层);432/433 一票判死当月不再尝试 |
| brave.monthlyQuota | `SC_BRAVE_MONTHLY_QUOTA` | 同上,默认 1000(月送 $5 credit≈1000 次) |
| exa.monthlyQuota | `SC_EXA_MONTHLY_QUOTA` | 同上,默认 1400(月送 $10 credit) |
| budgetChars | `SC_BUDGET_CHARS` | run 级输出预算,默认 60000 |
| userAgent | `SC_UA` | 默认规范 UA `search-core/0.5 (+https://github.com/mmqz/search-tool-rnd)` — ⚠ Wikimedia UA 政策硬门槛(10-a),勿改回浏览器伪装 UA |
| contactEmail | `SC_CONTACT_EMAIL` | Crossref polite pool mailto(可选) |
| searxng.baseUrl | `SC_SEARXNG_BASE_URL` | 自建/可信实例 |
| brave/tavily/exa.apiKey | `BRAVE_API_KEY` 等 | 有 key 自动加入并行 |
| blockedDomains | `SC_BLOCKED_DOMAINS` | 全局黑名单(csv) |
| fakeIpCidrs | `SC_FAKE_IP_CIDRS` | Clash TUN fake-ip 豁免网段 [10] |
| ssrf | `SC_SSRF` | `strict`(默认)/`allowPrivate`/`off`(测试) |
| x.bearerToken | `X_BEARER_TOKEN` | X 官方 API 层(可选) |
| x.guestEnabled | `SC_X_GUEST=0` 关 | Guest GraphQL 匿名层(默认开,自愈轮换) [10] |
| embedding.baseUrl/model | `SC_EMBEDDING_BASE_URL/MODEL` | OpenAI 兼容 embedding(可选;缺省本地 TF) [12] |
| research.* | `SC_RESEARCH_MAX_LOOPS` 等 | maxLoops=3/minFacts=6/refBudget=120/fetchBudget=12/fetchPerLoop=4/strict=0 |
| http | `SC_HTTP_PORT`/`SC_HTTP_TOKEN` | 网关端口/可选 Bearer 鉴权 |

## 模块 ↔ 规格对照

| 模块 | 文件 | v0-spec 章节 | 机制来源 |
|---|---|---|---|
| 统一引用 | `src/types.ts` | §3.3 | Trae[05] 搜索结果是引用体系一等公民 |
| Planner | `src/planner.ts` | §4.1(规则版) | 复杂度路由[02][10];LLM 改写为后续钩子 |
| Engine Router | `src/router.ts` | §4.2 | allSettled 全并行[10];12s 剔慢腿;**v0.4 软截止(6s 先收割,慢腿代报 timeout)+每腿永不 reject+失败分类**;健康熔断修 Perplexica[12] 单点 |
| **失败标注+熔断 2.0** | `src/providers/base.ts` + `src/types.ts` | §4.2 | **v0.4**(wigolo[09] 契约学走,字段自起): `EngineStatus` 六类(rate_limited/blocked/quota/auth/timeout/error)+`retryable`;分类阈值熔断(blocked 2 败 15min/quota·auth 1 败 30-60min/error 6 败 10min)+半开探针失败冷却翻倍(上限 1h) |
| **QuotaTracker(key 插槽)** | `src/quota.ts` | §4.2 | **v0.4**(10-b 三档状态码): 月度额度本地计数(Tavily 1000/Brave 1000/Exa 1400 默认);432/433 一票判死;用完自动回落免 key 池(回落零代码) |
| **免 key Provider 扩池** | `src/providers/keyless-apis.ts` | §4.2 | **v0.3**(10-a 官方文档巡检): marginalia(**api2 迁移**+旧端点 fallback)/openverse(CC 图片, kind:image, 20/min+200/day)/hn(Algolia)/wikipedia(**REST v1; 403 破案=UA 政策非协议**, 已进默认池)/bingrss(零封锁 RSS)/arxiv(Atom XML, 1req/3s)/crossref(polite pool+被引数)/mwmbl(备胎, 参数是 s; gzip 流不规范需 identity)/googlenews(kind:news, 版权限个人渲染默认关); golden 样本取自 2026-09-02/03 实测; **phase X**: +wiby(冷门独立站第二腿, 默认池 11) + marginalia dc=3 源头每域上限(与 domainCap 对齐) + 限额/付费/本地降级口径全案 analysis/search-landscape/marginalia-api-terms.md; **phase Y**: +keenable(独立索引通用搜索, 公共路免 key 1000 次/时, key 升 10 万 credit/月, 默认池 12) + tavily.baseUrl 兼容网关(docs/tavily-hikari.md) |
| Fusion | `src/fusion.ts` | §4.3 | URL 归一(ODR[11];**v0.3 补 12 具名追踪参数+query 参数排序**, MetaSearchMCP[deep])+RRF+词法;**v0.3 共识加权** 0.35×min(n-1,2)+全词命中 title +0.25+确定性 tie-break(bestRank)[deep];**v0.2 embedding 双阈值**[12]: >0.75 语义去重 / 0.5 相关过滤(可选) / embedder 失败放行 |
| Embedder | `src/embed.ts` | §4.3 | 本地 TF hash-trust(词+CJK bigram,零依赖);OpenAI 兼容可插拔+回落 [12] |
| Focus Fetcher | `src/focus.ts` + `src/fetcher.ts` | §4.4 | 命中段+邻接段(dsh[10]);**缓存原文/读时过滤**;15min TTL[07][08] |
| **Research Loop** | `src/research.ts` | §4.5 | **v0.2**: 5 角度并行[06]+双预算池[06]+6 问反思[07]+三保险停止[11]+journal 断点恢复[06] |
| **引用出口校验** | `src/citations.ts` | §3.3/§6 | 出口 [n] 100% 可回溯;strict 抛错/strip 剔除+标注(幻觉引用零容忍) |
| **时间机器双 provider** | `src/providers/timemachine.ts` | §4.2 | **v0.5**(quick-mirothinker 裁决"值得抄"落地): wayback(CDX API 快照时间线, collapse 按月去重, kind:archive, query=URL/域名, 传关键词抛教学错) / wikirev(REST v1 history, oldid 永久直链, 接受裸词条名或完整 wiki URL, lang 路由); 空快照/空修订=诚实 [] 不污染熔断 |
| **域名路由表** | `src/domains.ts` + `src/planner.ts` + `src/engine.ts` | §4.1 | **v0.6**(用户提案落地): DOMAIN_TABLE 种子表(编程/学术/图片 3 领域)+lookupDomains 关键词查表; planner 命中→domainPlan(x/github/research/multi 优先); core.search 分腿=第 1 腿 Tier1 API 直连(stackexchange/github/hn 等)+site: 腿走通用引擎; 各腿独立熔断, fusion 照旧聚合; 新条目须过 smoke(防 LLM 幻觉造域名); **v0.7: 3→7 主题(+packages/ai-models/devops/entities), 表序规则=窄关键词主题(packages/devops)先于宽关键词主题(programming)防 " npm "/"docker" 截胡** |
| **注册表与垂直资产层** | `src/providers/registries.ts` | §4.2 | **v0.7**: 八连发全免 key 官方 API(probe-v07 实测 248-1176ms): crates/packagist/rubygems(包管理器, 补 npm 跨语言)/huggingface(模型权重 sort=downloads)/dockerhub(镜像, official `/_/` vs `/r/` URL 分支)/openalex(被引+OA, mailto polite pool 同 crossref, URL 阶梯 landing→oa→doi)/dblp(CS 会议, authors 三态归一化, ee 优先)/wikidata(实体消歧, language 跟 ctx); 全部默认不进通用池(显式 engines/域名路由) |
| **X 降级链** | `src/xchain.ts` | §4.2 | 官方 API ∥ Guest GraphQL(guest token 2h 缓存+queryId 从 bundle 轮换自愈[10]) ∥ site: keyless → oEmbed 增强 top2[10];层间独立熔断 |
| Governor | `src/governor.ts` | §4.6 | 预算(修 ODR[11] 无全局预算);SSRF 逐跳(dsh[10],三档模式);域名治理[05][07] |
| Journal | `src/journal.ts` | §4.5 | Trae[06] journal 断点恢复;research-* 独立事件流可 replay |
| **Cache(缓存即搜索面)** | `src/cache.ts` | §4.4 | node:sqlite 零编译依赖;页面/搜索/健康三表;**v0.5 FTS5 trigram 倒排索引**(pages_fts 写入同步+老库自动重建;中文 ≥3 字 trigram/短词 LIKE 兜底;searchPages → SearchCore.searchCache → MCP search_cache / CLI cache / REST /search_cache 三出口) |
| MCP Gateway | `src/mcp.ts` | §3.1 | **v0.2 渐进披露**[09]: Direct(search/fetch/tool_search) + Deferred(research/x_search/**search_cache**/search_providers/cache_stats) 按需激活(CodeBuddy[07] name boost 2 评分) |
| **HTTP/SSE 网关** | `src/http.ts` | §3.1 | WorkBuddy[07] agentic_search SSE: POST /research 流式回传 start/loop_start/angle_done/fetch_done/reflect/decide/stop/report/result,中间过程不占调用方 context |

## v0.2 验收状态(vs spec §6)

| 验收项 | 状态 | 证据 |
|---|---|---|
| 深度研究端到端可恢复 | ✅ | journal replay 重建状态(refId 稳定);resume 已完成 run 不重跑;partial journal 续跑测试通过;smoke 实测 resume=true loops=1 |
| **免 key 扩池 4→10 默认池(注册 17)** | ✅(v0.3) | 默认池 10: searxng/duckduckgo/mojeek/yahoo/marginalia/hn/bingrss/**wikipedia/arxiv/crossref**; 显式启用: openverse(图片)/mwmbl(备胎)/googlenews(新闻); key 插槽: brave/tavily/exa/github; probe-engines 9/9 真实返回; 图片 kind=image+新闻 kind=news 走通; providers.test 20 项 golden |
| **域名路由 + Tier1 新人(注册 21)** | ✅(v0.6) | domains.test 16 项(查表命中/优先级 x>github>research>multi>domain/planner 集成/SE+npm golden 样本含实体解码与空结果抛错); probe-v06 真网络: stackexchange 344ms/4 条(首条即 asyncio gather 异常处理正确答案), npm 502ms/5 条(zod@4.5.4); planner 分腿 python→programming 2 腿/中性 query 不误路由 |
| **注册表八连发 + 域名表 7 主题(注册 29)** | ✅(v0.7) | registries.test 24 项(8 provider golden+URL 兑底分支/错误分类/4 新主题查表/表序回归 packages 先于 programming/planner 集成/表完整性防手误); probe-v07 真网络 8/8: crates 561ms/packagist 398ms/rubygems 317ms/huggingface 248ms/dockerhub 336ms(首条即 library/postgres 官方镜像)/openalex 1176ms(首条即 RAG 原始论文)/dblp 1106ms/wikidata 604ms(首条即 Alan Turing Q7251); 路由端到端 4/4(crate→packages/docker→devops/编程报错→programming/中性→无) |
| **MCP 出口实战化(真网络 stdio 全流程)** | ✅(v0.7) | probe-mcp-real: 协议 2025-06-18 协商通过/真实搜索通用(冷 6.0s 热 2ms 首条即 MCP spec)+域名专线(rust crate→route:domain, npm+crates 双腿 562ms)/focus 省 79% token/渐进披露 3→4/29 注册面 0 熔断; 143/143; 未验证项(Bedrock 真会话/GUI 点击流)在 docs/mcp-exit.md 如实声明 |
| 引用出口校验 100% | ✅ | 默认合成路径 [n] 全部注册;LLM 钩子幻觉引用 → strip+标注;citations/research 测试守门 |
| Research Loop 三保险 | ✅ | 反思通过(converged)/max_loops 降级(MAX_LOOPS_DEGRADED 不阻塞[07])/预算停(budget)/零新 URL 收敛/连续全灭停 |
| embedding 双阈值 | ✅ | >0.75 合并转载稿;0.5 过滤可选开;embedder 失败→similarity=1 放行[12];OpenAI 兼容回落本地 TF |
| X 四层降级链 | ✅ | official∥guest∥keyless+oEmbed 增强离线测试全通过;smoke 真实 x-keyless:yahoo 返回推文 |
| REST+SSE 网关 | ✅ | http-probe: /health /stats /search /fetch /x_search + POST /research SSE 10 类事件端到端 |
| **时间机器+缓存面(v0.5)** | ✅ | wayback/wikirev golden+真网络 probe(wikirev 2/2 真实修订返回; wayback 本沙箱 web.archive.org TCP 不可达, golden 测试守门+线下复测); FTS5 中英/短词/替换同步/老库重建 9 项测试; 103/103 全绿 |
| 渐进披露 | ✅ | mcp-probe: vanilla 3 工具 → tool_search 命中 research(6) → 激活后可调用 |

## 已知限制(v0.2/v0.3 诚实清单)

1. **反爬墙**: DDG/Mojeek 对数据中心 IP 出验证墙时抛错(健康统计自动熔断 10min);家用宽带正常。多引擎并行保证可用性。**DDG 202 空页=软封**触发=burst+脏 IP, provider 已带三件套: 限速门(`SC_DDG_MIN_INTERVAL_MS` 默认 3s)+202 检测+空结果退避重试(10-c 档案); **Wikimedia 403 破案(10-a)=UA 政策非协议**, 规范 UA 下 h1.1/h2 全通, wikipedia 已进默认池; mwmbl gzip 流不规范需 identity。协议指纹(JA4 时代)是免 key 生态的真实壁垒(见 web-crawl/g 报告; v0.4 备胎=impers feature-flag 传输层, 永不上浏览器)。
2. **Guest GraphQL 与平台对抗**: features 集/operation 布局随 x.com 前端改版漂移;已实现 queryId 轮换自愈+token 重铸,但无保证 — 失败自动降级 keyless 层[10]。
3. **反思是规则版**: Q3 权威域表/Q4 时效判定保守;LLM 反思(gap 追问词生成)留作 synthesize/planner 钩子的后续工作。
4. **Planner 仍是规则版**: 角度模板固定 5 个,LLM 改写/澄清接口已预留。
5. **SSRF 守卫存在 DNS 重绑定 TOCTOU 窗口**(resolve 后 fetch 用 hostname): 后续可加连接级 IP pin。
6. 对抗验证(3 票弃权≠存活,Trae[06])与 Web UI 属 v0.4 范围。**v0.3 已落地**(扩池 10 引擎+DDG 三件套+marginalia api2, 本表; 下一步: key 插槽 Tavily→Brave→Exa / wigolo 失败标注契约/熔断 2.0, 见 targets-search.md)。

## 测试

```bash
npm test            # 200 项: planner fusion focus governor/cache providers router embed fusion2
                    #       + citations research xchain breaker2 providers-v03 timemachine fts
                    #       + domains(18, v0.6-v0.8.1) registries(24, v0.7)
node scripts/probe-engines.mjs   # 逐引擎真实连通性探针(验收用)
node scripts/quality-bench.mjs   # 全链路质量评测(搜索/爬取/清洗/文本/解题五维, 真网络)
node scripts/vs-zai-compare.mjs  # 同题对照托管聚合搜索(同尺打标, 见 docs/vs-zai-search-compare.md)
node scripts/probe-v06.mjs       # v0.6 新引擎+域名路由探针
node scripts/probe-v07.mjs       # v0.7 注册表八连发+新主题路由探针
npm run probe:mcp   # MCP 渐进披露探针
npm run probe:http  # REST+SSE 探针
npm run smoke       # 真实网络端到端(非 CI 门禁)
```

回归清单(v0-spec §5, pi→dsh 教训[10]): 剪枝/缓存/并行/熔断机制不得在迭代中静默丢失 — providers.test 的 "markup drift 抛错" 与 router.test 的 "失败不阻塞/熔断跳过" 是守门测试;research.test 的 "单角度饥饿不杀全局" 是 ODR `or True` 反面教材的守门测试。

## 交付口径:资源占用与部署形态(2026-09-04 实测, Linux x64 / Node v24.19)

**磁盘(交付安装量)**: 生产安装(`npm ci --omit=dev`+dist)共 **36MB**(node_modules 35M + 构建产物 1M); 运行时直接依赖仅 3 个(mcp-sdk/cheerio/zod), 纯 JS 零原生模块(无 node-gyp/prebuild, 无编译链要求); 源码 720K。本地状态只有 `~/.search-core`(FTS5 cache-as-search-corpus)首次使用 **156K**(cache.db 72K), 随抓取页面增长缓慢。

**内存(VmHWM 内核峰值口径, 实测 2026-09-04; v0.8.1 懒加载优化后)**: 裸 Node 基线 30MB → CLI 一次性冷启动 **80.5MB**(0.19s; 优化前 96MB/0.31s) → 离线 FTS5 缓存查询 80MB(零网络 0.2s) → **真实多引擎查询峰值 107.5MB**(优化前 124.3MB) → MCP serve 常驻 idle 97MB(serve 形态本身需要 SDK 服务端栈, 不随本优化变动)。优化手段: ① research 循环懒加载(engine.ts #getResearch 动态 import, 纯 search 场景零 research 内存) ② MCP SDK 懒加载(mcp-connector.ts loadSdk 动态 import, 零连接器配置=零 SDK 内存, 实测模块成本 81→46MB) — 两项均零行为变更(292 测试+L1 9/9 门禁守门), 纯 search 路径合计省 ~16MB + 冷启动快 ~120ms。

**网络与端口**: 仅出站 HTTPS; CLI/一次性模式零入站端口; `serve-http`(可选 REST+SSE 网关)是唯一监听端口的形态(默认 8787, 自行选择才暴露)。FTS5 缓存用 Node 内置 SQLite, 无外部数据库服务。

**部署形态三选一, 全部不需要云**: ① CLI 子进程(用完即退, 最省) ② MCP stdio 同机常驻(idle 97MB, 跟宿主 IDE/agent 同机) ③ serve-http 网关(仅当你要给多客户端共享时才开)。上游搜索引擎(DDG/keenable/searxng 公共实例/bing-rss...)本来就是"别人的云", 我方零服务端。key 全可选: 免 key 车道开箱即用, 配 key(Tavily/Brave/Exa/X)只提质不改变部署形态。

**延迟(实测 2026-09-04, 数据中心 IP 环境, 9 题质量 bench)**: 查询墙钟中位 **1.25s**/均值 1.78s/max 3.2s(逐题 0.94-3.2s, 网络主导); 机制上已有慢腿剔除不阻塞(allSettled+软截止 SC_SOFT_DEADLINE_MS 默认 6s+单引擎硬超时 12s)+救援批软截止 3s, 慢引擎不会拖死整题; 缓存命中 0.2s 秒回; research 摘要档 5.0-5.3s(两题 L3 双解)。**诚实边界: 默认软截止不再调低**——压截止=砍慢车道出勤=广度风险, 想更快可自行 SC_SOFT_DEADLINE_MS=3000 换覆盖面。数据中心 IP 会遇 DDG/Mojeek 验证墙(自动熔断 10min+多引擎并行兜底), 家用宽带延迟同水平或更好。

**对照常规方案**: vs 云搜索 API(Serper/Bing API)— 形态同样轻(都是出站 HTTP), 但对方要 key+按量计费($10-50/月级), 我方免 key 可跑; vs 自托管 SearXNG— 对方要 24/7 服务器(Docker 镜像 ~1GB 磁盘, idle 150-300MB RAM+反代+公网加固), 我方零守护进程零服务器; vs 本地索引引擎(Meilisearch/Typesense)— 对方常驻 100MB-1GB+ RAM 且要喂语料, 我方是实时全网聚合不养索引。
