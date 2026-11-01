# 7-b 搜索工具层仓库扫描（MCP search servers / agent 搜索工具 / 元搜索聚合器 / SERP 抓取器）

> 扫描日期：2026-09-02 ｜ 方法：GitHub Search API（20 个搜索请求，star 数 + 更新时间双排序交叉），短名单 24 个，逐个拉 commits 数（Link header 翻页技巧）、license、README/关键源码（ddgs 的 http_client.py、MetaSearchMCP 的 ranking.py）。
> 服务对象：search-core（免账号免 API key 的 TS 客户端搜索编排器，内置 4 引擎：DDG html / SearXNG / Mojeek / Yahoo）。

---

## 一、先说结论（30 秒版）

1. **"免 key 纯 HTTP 抓 SERP"这条路 2026 年依然是主流活法**，但门槛变了：光换 UA 头已经没用，**DuckDuckGo html 端点现在按 TLS/JA3 指纹封客户端**（httpx 会被返回一个空的 HTTP 202 页，看起来像"没结果"）。活下来的库全靠浏览器指纹伪装（primp/curl_cffi impersonate）。
2. **MCP search server 生态已经收敛成两种做法**：少工具（1-2 个 search/fetch + 参数里选引擎）和工具面铺开（10-14 个按领域拆分）。渐进披露（环境能力不同→参数都不同）已有人做（open-webSearch 的 searchMode）。
3. **元搜索融合排序没有神算法**：现有项目全是"URL 归一化去重 + 共识加分 + 简单词匹配加分 + 稳定排序"，RRF 反而没几个人真用。够用就好。
4. 最值得整体对标的两个项目：**deedy5/ddgs**（Python 免 key 多引擎库，就是 search-core 的完整参照物）和 **KnockOutEZ/wigolo**（TS 写的 local-first agent web 层，4852 星、2005 commits、4 个月冲起来的，产品叙事值得全抄）。

---

## 二、入选仓库总表（按相关度排）

| # | full_name | ⭐ | forks | pushed | commits | license | 它是什么 | 反爬/免key手法 | 对 search-core 的借鉴 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | deedy5/ddgs | 2926 | 279 | 2026-08-26 | 881 | MIT | 原 duckduckgo_search，进化成免 key 多引擎元搜索库（lib/CLI/API/MCP 四形态一体） | primp 客户端 `impersonate="random"`+`impersonate_os="random"`，每次实例随机浏览器指纹 | **头号参照物**：backend=auto 换引擎、SimpleFilterRanker 本地重排、extract() 出 markdown |
| 2 | KnockOutEZ/wigolo | 4852 | 366 | 2026-09-02 | 2005 | AGPL-3.0 | local-first 的 agent web 工具层（search/fetch/crawl/extract/cache/find_similar/research/agent 10 工具） | 18 个引擎直连适配器免 key；fetch 走"阶梯"按信号升级无头浏览器；TLS 等级按域名自学习；失败标注 blocked_by_challenge | 同赛道最强对标：18→融合→本地 rerank→explainable score（final/semantic/lexical/consensus） |
| 3 | anysearch-ai/anysearch-skill | 6028 | 357 | 2026-09-02 | 63 | Apache-2.0 | 给 agent 用的统一搜索 Skill（非 MCP，走 SKILL.md+CLI 分发） | 免 key；运行时自探测（python/node/pwsh/bash）写 runtime.conf | Skill 分发是 MCP 之外的第二条路；batch_search 多查询并行值得抄 |
| 4 | searxng/searxng | 36424 | 3327 | 2026-09-02 | 9691 | AGPL-3.0 | 自托管元搜索之王，70+ 引擎 | 服务端代理所有引擎请求，实例即"IP 池"；JSON 输出需开 format=json | 我们内置 searxng 引擎就靠它的 JSON API；它是"免 key"的终极形态：把免 key 服务器化 |
| 5 | ItzCrazyKns/Vane（原 Perplexica） | 36587 | 4066 | 2026-09-01 | 1009 | MIT | SearXNG 驱动的 AI 答案引擎 | 全靠 SearXNG 出结果 | Speed/Balanced/Quality 三档搜索模式（浅搜→深搜）这个产品化切法值得抄 |
| 6 | benbusby/whoogle-search | 11582 | 1049 | 2026-08-14 | 928 | MIT | Google 免 key 代理元搜索鼻祖（无广告/无 JS/无 cookie） | 服务端会话代替浏览器 cookie；支持 Tor 出口；纯 GET 抓 Google | ⚠️ 已官宣停止维护。反面教材：押注单引擎（Google）的项目活不过维护断档 |
| 7 | LearningCircuit/local-deep-research | 9019 | 799 | 2026-09-02 | 7641 | MIT | 本地 LLM 深度研究（SimpleQA ~95%） | SearXNG + arxiv/pubmed 等专项引擎全免 key | **删掉了 auto/parallel 元搜索**，改成 langgraph-agent 策略让 LLM 动态选引擎——多引擎编排的新答案 |
| 8 | Aas-ee/open-webSearch | 1779 | 186 | 2026-08-28 | 232 | Apache-2.0 | 多引擎 MCP server + CLI + 本地守护进程 + skill | 11 引擎纯 HTTP 抓取（含 baidu/csdn/sogou/juejin 中文系）；Bing 抓不到自动降级 Playwright | SEARCH_MODE=auto 是教科书渐进披露：Playwright 可用时才给 searchMode 参数 |
| 9 | nickclyde/duckduckgo-mcp-server | 1446 | 186 | 2026-07-28 | 43 | MIT | DDG 搜索 MCP（2 工具：search+fetch_content） | README 实锤 DDG html 端点按 TLS 指纹封 httpx（HTTP 202 空页）；auto 模式先 httpx 后 curl_cffi 伪装 Chrome | 反爬情报最关键一手材料；backend 暴露成每次调用可覆盖的参数 |
| 10 | karust/openserp | 1335 | 153 | 2026-07-22 | 157 | MIT | Go 自托管 SERP API（google/bing/yandex/baidu/ddg/ecosia） | 无头浏览器渲染（Docker 一把梭），免 key | mega/search 三模式（balanced 并行融合/fast 单引擎最快/any 第一个响应就返回）+ clusters 保留各引擎排名 |
| 11 | ihor-sokoliuk/mcp-searxng | 1192 | 155 | 2026-09-01 | 586 | MIT | SearXNG MCP 标准件（Claude/Cursor 生态常用） | 依托 SearXNG 免 key | 单工具面 + URL/内容分离的干净参数设计 |
| 12 | felladrin/MiniSearch | 586 | 65 | 2026-09-02 | 3618 | Apache-2.0 | 浏览器里跑的 AI 搜索（SearXNG 捆绑容器） | SearXNG 聚合 + 浏览器内 WebGPU cross-encoder 重排 | 本地小模型重排零成本；3618 commits 说明"重排+缓存+限流"是长期打磨点 |
| 13 | ecoron/SerpScrap | 273 | 60 | 2026-09-02 | 347 | MIT | 老牌 SEO SERP 抓取库 2.0 重写 | 官方声明"不绕反爬"，要真 Chrome，被拦就是部分结果 | fusion rank（合并后排名）+ provider rank（引擎内排名）双排名输出，诚实设计 |
| 14 | mat-1/metasearch2 | 169 | 32 | 2026-09-01 | 181 | CC0-1.0 | Rust 极简元搜索（无客户端 JS） | 直接抓 Google/Bing/Brave | `engines.google.weight` 权重乘子 + Accept: application/json 切 API——最轻的元搜索参考实现 |
| 15 | gefsikatsinelou/MetaSearchMCP | 54 | 2 | 2026-09-02 | 371 | MIT | MCP 元搜索后端 + **80+ provider 接入手册** | 每个 provider 标注接法：HTML 抓取/RSS/公开 JSON API/no-key；Google 直抓用"浏览器式请求+consent cookie+locale 参数" | provider 目录本身就是数据库；consensus×2.0+词命中×1.0 排序可直接抄 |
| 16 | any4ai/AnyCrawl | 3445 | 366 | 2026-08-11 | 432 | MIT | Node 爬虫 + SERP 提取 | 默认 cheerio（最快最省）→playwright→puppeteer，隐身浏览器 CloakBrowser 兜底 | "引擎阶梯"哲学：默认最便宜的通道，按需升级 |
| 17 | NikolaiT/GoogleScraper | 2877 | 745 | 2021-07-03 | 287 | Apache-2.0 | 2013-2021 年最著名的多引擎 SERP 抓取库 | （历史）纯 HTTP+selenium 双模式，无指纹对抗 | 已死 5 年仍 2877 星。证明：纯爬 Google 的项目，维护一断就死 |
| 18 | n24q02m/wet-mcp | 17 | 3 | 2026-09-02 | 1271 | Apache-2.0 | 小而精的搜索+提取 MCP | SearXNG 免 key | 提取 5 策略链：basic_http→tls_spoof→render(native/browserless/cf)→captcha（key 门控），批量 50 URL |
| 19 | miurla/morphic | 9082 | 2353 | 2026-09-02 | 1820 | Apache-2.0 | generative UI 搜索引擎 | SearXNG 后端 | （次相关）UI 层参考 |
| 20 | yokingma/one-search-mcp | 139 | 20 | 2026-07-31 | 61 | MIT | 多后端搜索 MCP（SearXNG/Tavily/DDG/Bing） | SearXNG 路线免 key，付费后端可选 | "免 key 引擎优先、key 后端可选"的降级顺序和 search-core 一致 |

边缘/排除说明：vshulcz/deja-vu（759★）是搜 AI 会话历史的，不是 web 搜索，出圈但排除；taylorwilsdon/google_workspace_mcp、MODSetter/SurfSense、firecrawl/exa/tavily 官方 MCP 属于要账号/key 或别的赛道，只作对照；codelibs/fess 是企业内网搜索引擎，出题范围外。

---

## 三、Top10 逐个点评

**1. deedy5/ddgs（2926★ / 881 commits / MIT）**
原 duckduckgo_search，现在是"Dux Distributed Global Search"：text() 一次给 10 个后端（bing/brave/duckduckgo/google/mojeek/startpage/yandex/yahoo/wikipedia/grokipedia），backend 支持逗号列表和 auto。反爬核心就一行：primp 客户端 `impersonate="random"`——每次实例化随机挑一个浏览器+OS 指纹，TLS 层模拟，不给 UA 轮换的机会（UA 根本不重要了）。同一个包带 CLI、FastAPI server、MCP server 三种出口，还有个 extract() 直接把 URL 转 markdown。**这就是 search-core 的 Python 完整答案，架构逐层对着抄。**

**2. KnockOutEZ/wigolo（4852★ / 2005 commits / AGPL-3.0）**
2026-04 创建，4 个月冲到 4852 星，TS 写的，和 search-core 定位完全重合（no keys, no cloud, $0/query）。10 个 MCP 工具（search/fetch/crawl/extract/cache/find_similar/research/agent…），search 底下是 18 个引擎直连适配器→rank fusion→本机 embeddings+reranker。最值钱的是它的"诚实输出"设计：被反爬拦了返回 `blocked_by_challenge` 标注而不是把验证码页当内容；degraded 引擎、过期缓存全部写进响应；evidence_score 拆成 final/semantic/lexical/engine_consensus 四个数。fetch 是"阶梯"：普通 HTTP 不行才升级无头浏览器，按域名学习 TLS 加固等级。**search-core 的产品叙事、响应契约、降级标注直接学它。**

**3. anysearch-ai/anysearch-skill（6028★ / 63 commits / Apache-2.0）**
不走 MCP，把搜索做成 SKILL.md + CLI 脚本（py/js/ps1/sh 五份），装进 ~/.claude/skills 等目录。亮点是运行时自探测：挨个试 python/python3/node/powershell/bash 跑 doc 命令，哪个能跑写进 runtime.conf，以后直接用。batch_search 支持多查询并行。**"Skill 分发"是 2026 年 agent 工具的新入口，MCP 之外的第二条腿，search-core 值得同时出一份 SKILL.md。**

**4. searxng/searxng（36424★ / 9691 commits / AGPL-3.0）**
不用多说，元搜索基础设施本身：70+ 引擎聚合、可插拔、实例即 IP 池。对 search-core 它就是"免 key 引擎"的最大靠山——记一件小事：JSON 输出（format=json）默认关，文档要提醒用户开。上面 6 个大项目（Vane/morphic/MiniSearch/LDR/mcp-searxng/one-search）全把 SearXNG 当底座，说明"自建元搜索实例"是免 key 生态的公共电网。

**5. ItzCrazyKns/Vane（36587★ / 1009 commits / MIT，原 Perplexica）**
改名后继续涨星的开源 Perplexica。SearXNG 出结果 + LLM 出引用答案。产品设计上最值得抄的是三档搜索模式：Speed（快）/ Balanced（日常）/ Quality（深研究），同一套引擎，不同深度预算。

**6. benbusby/whoogle-search（11582★ / 928 commits / MIT）**
Google 免 key 代理的祖师爷：无 JS、无 cookie（服务端会话存配置）、可走 Tor。2026 年中官宣**停止维护**。教训比技术值钱：单引擎押注 + 个人维护断档 = 项目死亡，即使 1.1 万星也救不了。这印证 search-core 多引擎冗余路线的正确性。

**7. LearningCircuit/local-deep-research（9019★ / 7641 commits / MIT）**
本地 LLM 深度研究，SimpleQA ~95%。关键演进：**把 auto/parallel 两种元搜索策略删了**，换成 langgraph-agent 策略——LLM 按查询内容动态决定用哪个引擎（arxiv/pubmed/wikipedia…）、搜几轮、何时停。还维护公开 benchmark 数据集。启示：多引擎编排的终局可能是"调度策略"而非"固定并行"。

**8. Aas-ee/open-webSearch（1779★ / 232 commits / Apache-2.0）**
11 引擎纯 HTTP（含 baidu/csdn/sogou/juejin/hackernews 中文系，这对中文场景稀缺）。MCP 面 6 工具（search + 5 个站点级 fetch）。两个绝活：① SEARCH_MODE=auto——启动时探测 Playwright 真能用才给 search 工具暴露 searchMode 参数，并指示 agent "HTTP 结果空/被挡再试 playwright"；② 所有工具可用环境变量改名或禁用（`<disabled>`）。**渐进披露 + 工具可配置，MCP 工具设计的实用主义范本。**

**9. nickclyde/duckduckgo-mcp-server（1446★ / 43 commits / MIT）**
代码量很小但 README 是 2026 年最值钱的反爬情报：html.duckduckgo.com 已按 JA3/TLS 指纹封 httpx——返回 HTTP 202 + 空页面（不是 403！），很多库把它当成"没结果"默默吞掉。解法：curl_cffi 伪装 Chrome TLS 握手；search 工具默认 auto——先 httpx，检测到 202/403 自动切 curl 后端。**"auto + 按响应特征识别封锁"是免 key 引擎的标准存活姿势，search-core 四引擎都要配降级探测。**

**10. karust/openserp（1335★ / 157 commits / MIT）**
Go 写的自托管 SERP API，6 引擎统一 JSON schema，Docker 一键起。mega/search 一个查询打多引擎，三种模式：balanced（并行合并去重）、fast（挑最快引擎）、any（第一个响应就返回）；结果按 URL 归一化去重成 clusters，保留每个引擎里的原始排名。**"any 模式"（谁快用谁）是个被低估的延迟优化思路；clusters 保留引擎内排名 = 给融合层留足信息。**

---

## 四、三个专题题目的答案

### 4.1 免 key SERP 抓取库怎么对抗反爬？

| 手法 | 谁在用 | 有效性 |
|---|---|---|
| TLS/JA3 指纹伪装（primp / curl_cffi impersonate=chrome） | ddgs、duckduckgo-mcp-server | **2026 年的入场券**。UA 头已无用，DDG 会给非浏览器指纹回 HTTP 202 空页 |
| 随机化指纹（impersonate=random） | ddgs | 单一固定伪装也会被统计封，随机化是加分项 |
| auto 降级探测 | duckduckgo-mcp-server（httpx→curl）、open-webSearch（request→playwright） | 按响应特征（202/403/空页）识别被挡，自动换通道 |
| 引擎阶梯（cheerio→无头浏览器） | AnyCrawl、wigolo、wet-mcp、open-webSearch | 默认最便宜的纯 HTTP，检测到挑战才升级；wet-mcp 还有专门的 tls_spoof 档 |
| consent cookie / locale 参数 | MetaSearchMCP 的 Google 直抓 | 抓 Google 的入场细节（consent 页 + hl/gl 参数） |
| 代理池 | AnyCrawl（赞助商全是代理公司）、openserp 云版 | 商业项目的终极答案，但与"免账号"理念冲突，只可做可选档 |
| 服务端化（把免 key 交给自建实例） | SearXNG 全家桶 | 抓取难题外包给 SearXNG 社区维护 |
| 不绕（诚实路线） | SerpScrap | 明说"不绕反爬"，被拦就返回部分结果+typed failures——轻量工具也活得下去 |

### 4.2 MCP search server 怎么暴露工具？

| 项目 | 工具数 | 风格 |
|---|---|---|
| ddgs | 6 | search_text/images/news/videos/books + extract，按媒体类型拆 |
| duckduckgo-mcp-server | 2 | search + fetch_content，backend 参数每次可覆盖 |
| ihor-sokoliuk/mcp-searxng | 少 | 单 search 为主，参数里选类别 |
| open-webSearch | 6 | search + 5 个站点级 fetch 工具；工具可改名/禁用；searchMode 参数按环境能力动态出现 |
| wigolo | 10 | search/fetch/crawl/extract/cache/find_similar/research/agent…全生命周期 |
| MetaSearchMCP | 14 | search_web/google/academic/code/finance/news/social/images/videos/bio…按领域拆 + list_providers/provider_health 元工具 |
| SerpScrap MCP | 异步型 | start_search → poll_status → list_results，长任务轮询式 |

共识：**工具别太多也别太少**；领域拆分要有对应的"标签/参数"兜底（MetaSearchMCP 的 tags=web/academic/code）；**元工具**（list_providers/provider_health/list_search_engines）开始出现，agent 可以自查能力；渐进披露从"文档层"下沉到"参数层"（open-webSearch 的 searchMode）。

### 4.3 元搜索怎么融合排序？

没人用花哨算法，全部是本地、零网络调用的轻量启发式：

- **MetaSearchMCP ranking.py**（读过源码）：score = 共识数×2.0 + query 词全字命中 title/URL 数×1.0，同分保 provider 优先级原序（确定性）。归一化 URL（去 utm 等）后计数共识。
- **wigolo**：rank fusion 之后还上本机 embeddings+reranker，evidence_score 拆 final/semantic/lexical/engine_consensus，引擎失败数也算进 consensus 信号。
- **openserp**：clusters 去重但保留每引擎内原始 rank + fusion rank 双排名。
- **metasearch2**：每引擎 weight 乘子（engines.google.weight），用户可调偏好。
- **ddgs**：SimpleFilterRanker——wikipedia 置顶 + 按 query 词命中"标题+正文/仅标题/仅正文/没有"分桶。
- **MiniSearch / SearXNG 生态**：小号 cross-encoder 本地重排（唯一动模型的流派，跑在浏览器 WebGPU 上）。
- 反潮流：**local-deep-research 直接删了 auto/parallel 元搜索**，让 agent 策略动态选引擎——"融合"不一定是排序问题，也可能是调度问题。

---

## 五、值得抄的思路 Top5（给 search-core）

1. **TLS 指纹伪装 + auto 降级探测，四引擎标配**（ddgs / duckduckgo-mcp-server）
   Node 侧方案：undici/got-scraping 带 header 生成器，或子进程调 curl-impersonate。每个引擎实现 `probe(): blocked?`——识别 202 空页/403/验证码特征码，blocked 就自动降级到下一通道（纯 HTTP → 伪装客户端 → 标记 degraded）。响应里永远带上"哪些引擎挂了、为什么"。

2. **引擎阶梯：默认最便宜的通道，按信号升级**（AnyCrawl / wigolo / wet-mcp / open-webSearch）
   search-core 的 4 个引擎全是纯 HTTP+cheerio，这没问题——阶梯用在 fetch 环节：先 cheerio 直抓，检测到 SPA 壳/挑战页才升级（后续可接可选的无头浏览器插件）。关键是**失败要诚实标注**（wigolo 的 `blocked_by_challenge` 命名直接抄），绝不把挑战页当搜索结果返回。

3. **融合排序先抄 MetaSearchMCP 的 60 行：URL 归一化去重 + 共识×2.0 + 词命中×1.0 + 稳定排序**（+ openserp 的 clusters 保留引擎内排名、metasearch2 的 weight 乘子）
   不需要 RRF，不需要网络调用，可解释可调试。每个结果带 `engines: [...]`（谁给过它）和 `engine_rank`（在各引擎里排第几），以后要加 semantic 重排再上（MiniSearch 证明 WebGPU 级 cross-encoder 都跑得动）。

4. **一个包四种出口：lib / CLI / 本地 HTTP daemon / MCP，再加一份 SKILL.md**（ddgs / open-webSearch / anysearch-skill）
   MCP 工具面收敛为 2-4 个（search、fetch、list_engines、config），引擎用参数选（`engines: ["duckduckgo","searxng"]` 或 tags）；open-webSearch 的渐进披露照抄：能力探测通过才暴露高级参数；再学它给工具留改名/禁用的环境变量。分发上 MCP 和 Skill 双轨（anysearch-skill 6028 星证明 skill 入口的流量不比 MCP 小）。

5. **把"引擎目录书"当资产管理**（MetaSearchMCP 的 80+ provider 表 + local-deep-research 的专项引擎 + openserp 的 mega 三模式）
   给 search-core 建 docs/engines.md：每个引擎一行——接法（HTML/RSS/JSON API）、是否要 key、封锁特征、region 参数、最后验证日期。长尾免 key 源（Wikipedia API、HN Algolia、Google News RSS、Marginalia、Mwmbl、Bing RSS）按 MetaSearchMCP 目录逐个验证补进引擎池，每个都便宜且不会被封——比死磕 Google 划算得多。产品层再抄 openserp 的 any 模式（最快引擎先返回）当 Speed 档，凑齐 Speed/Balanced/Quality 三档（Vane 的产品化切法）。

---

## 附：扫描记录

- 扫描日期：**2026-09-02**
- 搜索 API 用量：20 次（限额 40 内，每 5 次 sleep 5s）
- 搜索词清单（20 条）：
  1. `search+mcp+server`（updated 排序）
  2. `web+search+mcp`（updated）
  3. `topic:mcp-server+search`（updated）
  4. `metasearch`（updated）
  5. `search+aggregator`（updated）
  6. `serp+scraper`（updated）
  7. `duckduckgo+scraper`（updated）
  8. `google+search+scraper`（updated）
  9. `searxng+client`（updated）
  10. `search+api+free`（updated）
  11. `multimodal+search+agent`（updated）
  12. `search+tool+agent`（updated）
  13. `duckduckgo+search`（stars）
  14. `metasearch+engine`（stars）
  15. `mcp+search+server`（stars）
  16. `serp`（stars）
  17. `web+search+agent`（stars）
  18. `google+scraper`（stars）
  19. `searxng`（stars）
  20. `open+web+search+mcp`（stars）
- 深读源码/README：ddgs（http_client.py + similarity.py）、MetaSearchMCP（ranking.py）、wigolo、open-webSearch、duckduckgo-mcp-server、MetaSearchMCP、openserp、SerpScrap、whoogle-search、metasearch2、wet-mcp、Vane、MiniSearch、local-deep-research、AnyCrawl、anysearch-skill
- commit 数用 `curl -sI .../commits?per_page=1` 的 Link header 最后一页页码取得
