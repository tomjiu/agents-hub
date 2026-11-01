# 9-b 小仓库扫雷（stars 0-100 活跃项目：MCP search / SERP scraper / 元搜索 / 引擎 wrapper / 免 key 库）

> 扫描日期：2026-09-02 ｜ 方法：GitHub Search API 34 次请求（17 组搜索词 × updated/created 双排序 + stars:0..100 + pushed:>2026-05-01 + fork:false），短名单 60+，逐个拉 commits 数（Link header 技巧）+ README/源码抽查。上一轮（7-b）只看了高星，本轮专补 0 星/低星新项目——小仓库才是新野路子的首发地。

---

## 一、先说结论（30 秒版）

1. **Google 免 key 直抓 2026 年的底牌被摸清了**：两家小仓库从正反两面实锤——纯 HTTP 客户端（7 种变体、带不带代理都试了）只会拿到 **91KB 的 JS 空壳**，一个结果都没有（BlankTrail 实测）；但 **curl_cffi 伪装 + 从真浏览器抄一次 SOCS+NID cookie（每个出口 IP 一次）**，Google 网页/图片/地图/YouTube/趋势/新闻/自动补全/专利/图书/学术**十个垂直面全部纯 HTTP 可抓**（gscrape）。唯一铁板钉钉拿不到的：AI Overview/AI Mode——它的 token 由页面 JS 异步算出来，真浏览器不开 JS 都没有。**结论：圣杯还在，但钥匙是"浏览器铸的 cookie"，不是 UA 也不是指纹本身。**
2. **官方免费通道正在关门**：Google Custom Search JSON API **已停止接新客户，存量客户 2027-01-01 关停**（cse-bridge 引官方原文）。社区对策已经出现：自架一个说 `customsearch/v1` 同款协议的 shim，底下接 SearXNG——**协议兼容层**会成为 2027 年的常见姿势。
3. **反爬对抗的分级答案出来了**：轻的用 curl_cffi 伪装 Chrome 131 的 JA3（DDG Lite 就够）；中的用"浏览器捕获一次、复用数小时"的 PoW 值（duck.ai 的 X-Vqd-Hash-1）；野的直接**把旧安卓手机变成抓取节点**（PageKit：真 WebView、真 GPU 指纹、住宅移动流量，"和人不可区分"）。
4. **免 key 新端点收获 5 个**：Exa 官方匿名 MCP（mcp.exa.ai/mcp，无凭据可调！）、duck.ai 免费搜索（带 WebSearch/NewsSearch 工具调用）、Mwmbl 公共 JSON API（机房 IP 永远可用）、8 大中文平台热搜板精确端点、Wiby/DDG Instant 等长尾。详见第五节清单。
5. **熔断/降级的小而美范式已收敛**：daedra（30s 冷却 + 只重试瞬时错误、被封错误直接 fail-fast）和 dsh-search-failover（额度错误 402/429→1 小时长冷却 vs 瞬时错误 5 分钟内 3 次→60 秒短冷却 + 半开探活 + 单引擎多 key 轮换）两份作业可以直接抄。
6. **工具面新花样**：`web_search_from`（让 AI 自己换源重搜的元工具）、`doctor`（自检兼能力分层报告）、deadline-bounded fan-out（慢源不许拖死整次调用）、`failed` map（降级源单独标注不污染主结果）、Parser Health Warning（解析器腐烂自曝）。

---

## 二、分档总表

### 💎 新苗档（0-10★ 但手法独特，commit ≥5）

| # | full_name | ⭐ | pushed | commits | license | 一句话 | 反爬/免key手法 | 对 search-core 的可抄点 |
|---|---|---|---|---|---|---|---|---|
| 1 | chukfinley/gscrape | 2 | 2026-08-04 | 6 | MIT | Google 十个垂直面纯 HTTP 抓取库（Search/Maps/YouTube含字幕/Trends/News/Images/Suggest/Patents/Books/Scholar） | curl_cffi impersonate + **浏览器铸的 SOCS+NID cookie（每出口 IP 一次手工）**；REVERSE-ENGINEERING.md 方法论文档 | **头号圣杯参照**；逆向方法论（见四.1）；"measured, not assumed" 的逐面状态表 |
| 2 | funkyfunc/fearch | 0 | 2026-08-30 | 39 | MIT | "诚实到能在公司用"的搜索 MCP+CLI：自报身份、守 robots.txt、拒绝即终局 | **只用 robots.txt 允许的 DDG Lite 当默认**；Google/Bing 要显式点名且"被验证码拦了是你自己的事"；`--human-search` 让人手动按搜索 | 诚实输出哲学的极致：失败永远带"为什么+下一步"；fetch 保代码块/表格（数 `<pre>` 进 vs 反引号出）；llms.txt 直信 |
| 3 | atinseau/open-websearch-mcp | 0 | 2026-08-25 | 39 | Apache-2.0 | 给"无网 harness"的 2 工具极简 MCP（web_search/web_open） | Google→DDG→Bing 有序前端降级 + Obscura 隐身渲染器；**明确拒绝**：不解 CAPTCHA、不轮代理、不换身份 | evidence passages（带出处位置不synthesize）；调查内页面去重记忆；`external_untrusted` 标注；结构化结局（paywall/WAF/timeout 各有名分） |
| 4 | Walvez/dsh-search-failover | 3 | 2026-08-17 | 37 | MIT | DSH 的 provider 级搜索池：8 后端 + **额度感知熔断** | 402/429/QuotaExceeded→1h 长冷却；瞬时错误 5min 内 3 连→60s 短冷却；冷却满**半开探活** | **熔断参数最完整的小实现**（直接抄阈值）；failover vs 加权轮询双策略；单引擎多 key 轮换；`web_search_from` 让 AI 自主换源 |
| 5 | Afqoro/duckai-bridge | 3 | 2026-08-25 | 12 | none | 把 duck.ai（DDG 免费 AI 搜索）桥接成 OpenAI 兼容 API，带工具调用 | **X-Vqd-Hash-1 PoW 浏览器捕获一次用数小时**（PoW 需真 DOM+crypto.subtle，纯 Go 无解）；RSA-OAEP durableStream 封包 | duck.ai 内置 WebSearch/NewsSearch/RelatedSearchTerms = 免费搜索端点；"浏览器捕获一次、服务端复用"的PoW姿势 |
| 6 | Ken-u/PageKit | 2 | 2026-08-21 | 44 | Apache-2.0 | **旧安卓手机 = agent 专属抓取节点**：MCP server 跑在手机上，驱动真 WebView | 真机指纹（bot.sannysoft 全过：无 WebDriver、真 GPU）+ 住宅/移动 IP；多 profile cookie 隔离；内置去广告 | "硬件即反爬"路线；设备比较表（SearXNG/付费API/无头浏览器 vs 真机）可进我们 docs；OLED 屏保防烧屏这种运维细节 |
| 7 | hermes-labs-ai/supersearch | 0 | 2026-07-19 | 10 | Apache-2.0 | deadline-bounded 的多源 fan-out 检索内核 | 免 key 默认路径（DDG/GitHub/HN…），**慢源超时不得拖死整次调用** | `supersearch.search.v1` 版本化 JSON 契约；status=completed/partial/unavailable 三态；每源独立 status+diagnostics 数组 |
| 8 | boy-373/hot-trending-mcp | 0 | 2026-09-02 | 11 | MIT | 8 大中文平台热搜板一个 MCP 调用全拿（微博/知乎/B站/百度/头条/抖音/贴吧/掘金） | 全走各平台**公开热榜 API**（精确 URL 都在 README）+ 300s 内存缓存 | **中文免 key 端点清单可直接入池**；`failed` map：单个源挂了绝不影响其余返回；免费托管端点当兜底 |
| 9 | TonyDua/dsh-web-search-exa | 6 | 2026-08-14 | 5 | MIT | Exa 零配置 provider：**无 key 走 Exa 官方匿名 MCP**，有 key 自动升级 REST | mcp.exa.ai/mcp JSON-RPC `tools/call web_search_exa` **无凭据可调**（官方公开 MCP，限流） | **新免 key 端点实锤**；"匿名档默认 + 有 key 自动升级"的无缝双档设计 |
| 10 | Booyaka101/cse-bridge | 0 | 2026-08-03 | 27 | MIT | Google CSE JSON API 的自架兼容 shim（SearXNG 后端） | 免 key：你自己的 SearXNG 实例 | **情报：CSE API 2027-01-01 关停**；协议兼容层模式（换 baseURL 即迁移，cx/分页/响应结构全保真） |

### 活跃档（11-100★ 或提交很勤）

| # | full_name | ⭐ | pushed | commits | license | 一句话 | 反爬/免key手法 | 对 search-core 的可抄点 |
|---|---|---|---|---|---|---|---|---|
| 11 | dirmacs/daedra | 13 | 2026-09-02 | 107 | MIT | Rust 单二进制 MCP：14 个免 key 后端全并发 fan-out | 每后端 `BackendHealth` 熔断（30s 冷却）+ governor 每后端限速 + **分类重试**（只重试瞬时错误，被封 fail-fast） | **免 key 引擎目录**：Mwmbl/Marginalia 任何 IP 可用；DDG HTML 2025 年中起基本被封；Bing RSS/Google News RSS/Wiby/DDG Instant 全是低封险源；"忽略 query 的后端无权投票"的融合防噪规则 |
| 12 | tiagozip/metasearch | 85 | 2026-09-01 | 115 | NOASSERTION | "无 slop" 隐私元搜索前端 | SearXNG 路线 | （略看）UI/产品层参考 |
| 13 | pwilkin/mcp-searxng-public | 54 | 2026-05-23 | 38 | MIT | 查**公共** SearXNG 实例的 MCP：解析 HTML 而不是 JSON | 公共实例 99% 不开 JSON——**直接抓 HTML 解析**；主+备 3 实例；detailed 模式 3 实例×前3页合并去重 | 公共 SearXNG 的正确用法（我们之前测 JSON 全灭的答案）；自带 12 个活实例清单 + report 探活任务 |
| 14 | sweetcornna/free-search-mcp | 63 | 2026-04-24 | 64 | MIT | 本地优先免 key MCP（DDG/Mojeek/Startpage 多引擎 + fetch + 文档读取） | 多引擎纯 HTTP | （快速过）引擎组合与我们高度重叠，可对照功能面 |
| 15 | robbyczgw-cla/web-search-plus-plugin | 99 | 2026-08-31 | 98 | MIT | OpenClaw 插件：13 搜索 provider + 6 抽取 provider 智能路由 | 混合 key/免 key | provider×extractor 矩阵 + 路由层分离 |
| 16 | paperfoot/search-cli | 50 | 2026-07-26 | 76 | MIT | Rust 单二进制 13 provider 13 模式，RRF 融合 | 多为 key 服务（Brave/Serper/Exa/Tavily） | **`usage` 命令查各 provider 剩余额度**；`agent-info` 自描述；"CLI 永不猜意图，模式必须显式选" |
| 17 | Khamel83/argus | 4 | 2026-03-31 | 355 | MIT | 14 provider 检索平台：预算感知路由 + 死链恢复 + 本地语料 | **拓扑感知**：先探测自己在住宅 IP 还是机房 IP 再决定路由和抽取通道；预算烧完的 provider 自动跳过 | **IP 拓扑探测**思路（对引擎成功率建模的输入信号）；免费优先分层；RRF 融合带 provider 归因；`recover-url`（Wayback/archive 兜底）；discovery/research/recovery/grounding 四模式 |
| 18 | wtznicy/my-websearch | 1 | 2026-08-31 | 298 | Apache-2.0 | 9 引擎 MCP+CLI+daemon+Skill 四出口（国内 bing/baidu/csdn/juejin/sogou + 海外 ddg/exa/brave/startpage） | 国内引擎免代理直连；海外需代理（写明分流域市场景） | 国内/海外引擎**按代理可达性分组**的做法；298 commits 的四出口形态与我们完全同构，可当 TS 对照实现 |
| 19 | Djarvur/cc-websearch | 21 | 2026-05-19 | 96 | MIT | Claude Code 的 WebSearch/WebFetch 技能**平替插件**（DDG 驱动） | DDG 免 key | "drop-in 替换官方工具签名"的分发思路（与 DSH ctx.web seam 同一招）；stdin JSON→stdout XML 的技能协议 |
| 20 | PhantomPixelDev/BetterWebSearch-MCP | 15 | 2026-08-29 | 58 | MIT | keyless-first MCP：DDG 开箱即用，Brave/Tavily 可选，3 层抽取 | HTTP→升级阶梯 | keyless 默认 + key 增强的产品叙事（与我们一致） |
| 21 | BugraAkdemir/gosearch | 2 | 2026-07-29 | 64 | MIT | Go 免 key 库：DDG/Bing/Google/Yandex HTML 直抓 + markdown 抽取 | HTML 直抓 + 可选真浏览器子包 | Go 侧的干净 API 形状；"Reliability, honestly" 章节的降级声明写法 |
| 22 | aphrody-code/bxc | 2 | 2026-05-10 | 199 | Apache-2.0 | **Zero-Spawn 浏览器引擎**：Bun+Rust FFI，DOM/网络全在进程内，不拉起 Chromium | curl-impersonate 隐身 HTTP + CDP 协议兼容 | "浏览器引擎进程内化"路线（spawn 开销归零）；bxc search 的 Google 面可观察 |
| 23 | dabito/pi-lynx | 3 | 2026-06-21 | 29 | MIT | 用 **lynx 文本浏览器**当搜索+抓取引擎的 pi 扩展 | lynx=1992 年客户端，拿到的天然是简化 HTML，无人针对它设防 | 野路子：古董客户端当免伪装通道；Reddit 旧版搜索 + thread JSON 免 key |
| 24 | okokjai/unified-fetch | 1 | 2026-08-13 | 14 | MIT | HTTP 优先（~1s）→ 被挡/JS 壳/空内容自动升级 CDP 隐身浏览器 | 原生 CDP（无 Playwright）+ 懒启动 + "坏内容永不缓存" | 升级触发器的三种信号（blocked/JS shell/empty）；每响应带 `content_ok/page_type/next_action/engine_used`；≤2 条/域名 + quorum 共识报告 |
| 25 | BlankTrail/google-serp-parser | 2 | 2026-08-15 | 242 | MIT | Google SERP 抓取+排名追踪（Go，GUI） | **vendor 锁定**：必须配 BlankTrail Proxy + Challenge Breaker（reCAPTCHA solver 实测 721/821=88%） | 情报价值：7 种纯 HTTP 客户端变体全被 Google 回 91KB JS 空壳的**实测记录**；"身份解出后还能持续工作"的会话存续观察 |

### 观察档（相关但没深挖/或仅达门槛）

| full_name | ⭐ | 备注 |
|---|---|---|
| askalf/amnesia | 7 | SearXNG+每次查询过 VPN+HMAC 会话 cookie（bot-check 只解一次），155 引擎聚合；隐私产品化思路 |
| kbjama8/kortex-search | 0 | 18 源单 `search()` 契约 + **加权 RRF** + cross-encoder 重排 + MMR 多样性；v0.4 有 SSRF 三层防护（L1 出网过滤/L2 强制代理/L3 内核级）和浏览器 profile farm；0.4.1 加 per-persona 密钥保险箱——安全工程最全的小仓库 |
| egrm/sx | 0 | Go 单文件 SearXNG CLI，紧凑 JSON 输出给 LLM，零依赖 |
| tamnd/baidu-cli | 1 | 百度实时热搜+autocomplete 转 JSONL 免 key（Go） |
| Albertous007/ddg-search-mcp | 3 | curl_cffi Chrome 131 JA3 打 DDG Lite；双解析器（主+legacy 兜底）；**Parser Health Warning**（解析器腐烂自曝） |
| guan-tends/mcp-websearch | 0 | Rust+rmcp 的 DDG Lite MCP |
| corvuslee/quack | 0 | 终端 AI 用的 DDG 浏览器伪装搜索 |
| prateeknishad305/gsearch-api | 0 | 8 引擎免 key（Google/DDG/Bing/Yahoo/Brave/Mojeek/Startpage/Qwant），支持日期过滤 |
| DaKheera47/scraperecon | 43 | 给爬虫开发者的侦察 CLI：探测目标站是 TLS 指纹墙还是 JS 挑战还是限速 |
| Massii-08/tls-fingerprint-scraper-demo | 1 | 教学演示：Cloudflare 后面的"空结果"多是**渲染前的 JA3 握手检查**，不是 CAPTCHA（tls.peet.ws 回声对比） |
| pipeworx-io/mcp-*（5 个） | 0 | 垂直免 key MCP 家族：NIH ClinicalTables/EUR-Lex/DevDocs.io/urlscan.io/CA 政府采购（各 3 commits，家族模式值得记） |
| rnwolfe/roost | 0 | 免 key 只读 Google Hotels 搜索（agent 用酒店比价） |
| MochiNek0/dsh-web-search-free | 5 | 8 引擎可配置顺序 fallback |
| A3Boy/dsh-web-tools | 24 | 8 个深度适配 provider + SearchHints + 弹性 fallback |
| neriousy/opencode-chatgpt-websearch | 10 | 拿 ChatGPT OAuth 会话当搜索 provider |
| code-yeongyu/ultimate-web-search-skill | 9 | 12 provider 一个 CLI，纯 stdlib Python（零依赖兼容性优先） |
| alfonso0512/academic-search-skill | 4 | Semantic Scholar/Crossref/OpenAlex/PubMed/arXiv/Zenodo/秘塔 七合一学术 skill |
| x-cmd-install/duckduckgo_search | 0 | ddgs 的镜像/再发布（观察 ddgs 生态扩散） |
| NieXuebang/…（DSH 插件群） | - | DSH"web seam"已形成插件生态（见四.5） |

**排除**：BlankTrail 之外一批 `serp-api-pricing`/`scraperapi-*` 空壳 SEO 软文仓库（1 commit、无码）；data-scrape/serpapi-alternative（关键词堆砌+代理商赞助，模板垃圾）；lesterppo/hermes-google-search、marcinkuk/ddgs-mcp、marko0905/websearch-rs、yl365/trawl、GenSEAM/search、onlytrisdev/serp-search-api、pipeworx-io 单仓库（≤3 commits）——思路有价值但没过 commit 门槛，其中 marko0905/websearch-rs（"纯 Rust ddgs 移植"）和 GenSEAM/search（"SearXNG 代理池轮换"）值得持续盯是否长出真身。awesome list 类未发现新增（本档无纯 awesome）。

---

## 三、重点点评（挑 8 个，重点"新手法/新端点"）

**1. chukfinley/gscrape（2★，💎 圣杯当前最优解）**
Python + 两个依赖（curl_cffi、selectolax），把 Google 十个垂直面全部纯 HTTP 化，Maps 一个地点 ~2 请求 300ms（浏览器方案要 30 秒半 G 内存）。关键就一招：**SOCS+NID 两个 cookie 缺一不可，且 NID 必须由真浏览器铸**——库自己走 consent 流程铸的会被"无限期拒收"，所以每个出口 IP 要手工从 devtools 抄一次。docs/REVERSE-ENGINEERING.md 把"怎么逆向、坏了怎么重逆"写成了方法论（见四.1），比代码更值钱。AI Overview 实锤纯 HTTP 拿不到（JS 异步算 token），库选择 raise 而不是返回空——诚实。

**2. funkyfunc/fearch（0★，💎 诚实流派的极致）**
默认只用 DDG Lite，理由：**这是唯一一个 robots.txt 明文允许抓结果页的引擎**。Google/Bing 要用户显式点名，被 CAPTCHA 拦了提示"该你上了"（`--human-search` 让人手动按搜索，agent 拿结果）。fetch 保留代码块和表格（靠数 `<pre>` 进/反引号出做守卫），长页有 BM25 focus/heading/regex/cursor 四种切片，GitHub/PyPI/npm/SO/arXiv 走 API 快车道，声明 `text/markdown` 或 `llms.txt` 的站点直接信。退出码 0/1/2 + Diagnosis 对象——"拒绝"也是一种结构化结果。这是把"不装"做成产品的人，和 search-core 的失败标注契约同频。

**3. Walvez/dsh-search-failover（3★，💎 熔断器作业范本）**
中文文档，最值钱的是那段熔断参数：**额度类错误（402/429/Quota Exceeded）→ 1 小时长冷却**（免得白白烧请求），**瞬时错误 5 分钟内连续 3 次 → 60 秒短冷却**，冷却到期**半开探活**，成功立刻恢复。再加单引擎多 key 轮换（Key A 烧完切 Key B，全挂才降级下一引擎）和 failover/加权轮询双策略（后者为了"榨干各家免费额度"）。新发明的工具：`web_search_from`——AI 觉得默认结果不行时，自己指定 exa/serper/tavily 再搜一遍。这套数值直接搬进 search-core 熔断 2.0。

**4. Afqoro/duckai-bridge（3★，💎 免费搜索端点+PoW 新姿势）**
duck.ai（DDG 免费 AI 对话）内建 WebSearch/NewsSearch/RelatedSearchTerms/GenerateImage 工具——**等于一个免费的带实时搜索的 chat API**。难点是 X-Vqd-Hash-1 PoW：挑战代码要求真 DOM（window.parent、iframe.contentWindow.get）+ crypto.subtle SHA-256，纯 Go 库根本跑不了。作者的答案不是解 PoW，而是**从真浏览器抓一次现成值，服务端复用几小时**——"PoW 不用解，借就行"。另附 RSA-OAEP-256 durableStream 封包和 SSE 转译细节。我们如果接 duck.ai 当兜底引擎，这是完整地图。

**5. Ken-u/PageKit（2★，💎 最野的"硬件反爬"）**
把吃灰的安卓手机/电视盒子变成 MCP 抓取服务器：APK 里跑 streamable HTTP MCP server，驱动真 Android WebView 开页、去广告、抽正文。反爬逻辑简单粗暴——**真手机、真 GPU、住宅/移动网络，检测器无从下手**（README 附 bot.sannysoft.com 实测全过）。多 profile cookie 隔离、多会话并发、甚至有 OLED 防烧屏屏保。和代理池路线相比，这是一次性硬件成本换"人形流量"，对我们启发在于：反爬的终极形态可以是换赛道，不是换头。

**6. TonyDua/dsh-web-search-exa（6★，💎 新免 key 端点）**
证实 **mcp.exa.ai/mcp 是 Exa 官方的公开匿名 MCP**：JSON-RPC `tools/call web_search_exa`，零凭据，限流，`x-exa-source` 头带归因。设计上"匿名 MCP 默认 + 检测到 EXA_API_KEY 自动切 REST"——同一个工具两种燃料。对 search-core：Exa 可以进引擎池当"语义搜索档"（免 key 档），不用注册任何账号。

**7. dirmacs/daedra（13★，活跃档里最有用的引擎目录）**
14 个后端三分类：scraper（HTML）/ machine-format（RSS+JSON）/ knowledge（wiki/HN/SO/GitHub/Wiby/DDG Instant），每个都标了"机房 IP 可用性"——**Mwmbl 和 Marginalia 任何 IP 永远可用，DDG HTML 2025 年中起基本被封，Brave HTML 看脸**。融合规则里有一条防噪金句："忽略 query 的后端无权投票给不相关结果"（query 词零命中的结果永远排在有命中之后）。熔断+限速+分类重试全家桶，Rust 单二进制。它就是我们 engines.md 想要的活样本。

**8. boy-373/hot-trending-mcp + pipeworx-io 家族（0★，💎 中文端点与垂直家族）**
前者把 8 大中文平台热榜 API 的精确 URL 全公开（微博 ajax/side/hotSearch、知乎 topstory、B站 popular、百度 board、头条 hot-board、抖音 billboard、贴吧 hottopic、掘金 article_rank），响应里 `failed` map 单列挂掉的源；后者一家出了 5 个"单文件垂直 MCP"（NIH 医学表/EU 法律/DevDocs/urlscan/加州政府采购）。共同点：**每个都薄到极点，但端点情报是真金**。出处还点名了上游 imsyy/DailyHotApi——那里面有 100+ 个同类中文端点，是中文免 key 池的总目录。

---

## 四、三个专题

### 4.1 对抗 202 空页/JA3/TLS 指纹的新手法

| 手法 | 谁在用 | 野度 | 备注 |
|---|---|---|---|
| 浏览器铸 cookie 注入（SOCS+NID） | gscrape | ★★ | 每 IP 一次手工，之后纯 HTTP 随便跑；库自铸的会被无限期拒 |
| PoW 值借用（不解，抓现成的） | duckai-bridge | ★★★ | X-Vqd-Hash-1 浏览器抓一次用数小时；PoW 需真 DOM，纯语言库无解 |
| 真机当节点 | PageKit | ★★★★ | 旧安卓=真指纹+住宅流量；sannysoft 全过 |
| 古董客户端通道 | pi-lynx（lynx） | ★★ | 1992 年的 HTTP 栈反而没人针对；天然无 JS 简化页 |
| 进程内浏览器（零 spawn） | aphrody-code/bxc | ★★ | Bun+Rust FFI 把 DOM/网络搬进运行时内存，无 Chromium 子进程 |
| JA3 预检侦察 | scraperecon / anti-bot-doctor | ★ | 先诊断目标是 TLS 墙/JS 挑战/限速再选通道，不瞎试 |
| "空结果≠没结果"教育 | Massii-08 demo | ★ | Cloudflare 在渲染前就按 JA3 掐掉，多数人误判成 CAPTCHA |
| 会话存续复用 | BlankTrail Challenge Breaker | ★★★ | reCAPTCHA 解出后身份可继续工作（88% 解除率），不是一锤子买卖 |
| HTML 解析顶替 JSON | pwilkin/mcp-searxng-public | ★ | 公共 SearXNG 不开 JSON？那就抓 HTML 自己解析 |

（ddgs 的 primp impersonate=random 仍是基本盘，本轮无新变化。）

### 4.2 Google 免 key 直抓 2026 年还能不能用？（圣杯状态更新）

- ❌ **裸纯 HTTP：死**。BlankTrail 实测 7 种客户端变体（直接/代理）全部拿到 91KB JS 空壳；gscrape 佐证：缺 cookie 时返回 **HTTP 200 形状正确但字段全空的 stub**（比报错更阴险，Maps 是 23KB 假货 vs 127KB 真货）。
- ✅ **curl_cffi 伪装 + 浏览器 NID：活**。十个垂直面可用（含分页图片搜索、YouTube 字幕、250 条真实联想词 sweep）；Scholar 限速严，Books 小匿名额度，Maps reviews 要自备 BotGuard key。
- ❌ **AI Overview/AI Mode：死**（纯 HTTP 永远拿不到，token 由页面 JS 异步计算；真浏览器不开 JS 都没有）。
- ⚠️ **官方 CSE JSON API：正在死**。已停止接新客，存量 2027-01-01 到期；官方推荐替代是收费的 Vertex AI Search。社区对策=cse-bridge 式协议兼容 shim。
- IP 被烧的信号：302 → `/sorry/index`（gscrape 的判定标准，跟我们引擎探活可以直接对齐）。
- 大白话结论：**Google 当"机会主义引擎"可以（代价=每 IP 一次手工 cookie），当主力引擎不行**；多引擎冗余路线继续正确。

### 4.3 MCP 工具面与熔断的新花样（小仓库观察）

工具面新招：
- **`web_search_from(source=…)` 元工具**（dsh-search-failover）：把"换源"做成 AI 可自主调用的工具，而不是配置项——agent 发现结果不好自己重搜。
- **`doctor` 自检**（fearch/kortex-search）：一条命令测试网络/浏览器/各引擎，兼当能力分层报告（kortex 23 个注册源按能力分层，缺什么依赖降什么级）。
- **deadline-bounded fan-out**（supersearch）：整次调用带死线，慢源超时返回 status=partial，绝不拖死调用方——配三态 status（completed/partial/unavailable）+ 每源 diagnostics。
- **`failed` map 与主结果分离**（hot-trending）：降级源的信息结构化旁路，不混进结果也不吞掉。
- **Parser Health Warning**（ddg-search-mcp）：解析器对不上页面结构时在输出里自曝+给上报链接——解析器腐烂检测。
- **工具签名平替**（cc-websearch / DSH ctx.web 系插件）：不做新工具名，直接顶替官方 WebSearch/WebFetch 的签名，宿主无感。

熔断/降级小而美（可直接抄的数值与规则）：
- daedra：每后端熔断 30s 冷却；**分类重试**——只重试瞬时错误，bot 防护/限速错误 fail-fast 立刻换下一家；governor 按后端组别分限速配额。
- dsh-search-failover：402/429→1h；5min 内 3 连失败→60s；半开探活；多 key 轮换在引擎降级之前。
- supersearch：整体 deadline + partial 可用语义。
- argus：预算感知——烧完额度的 provider 自动跳过；拓扑感知——按出口 IP 类型选通道。
- 综合范式：**错误分类（额度/瞬时/封锁三类）→ 三种冷却时长 → 半开探活 → fail-fast 降级**，四层就能讲完，两个仓库 200 行以内都实现了。

### 4.4 DSH（DeepSeek Harness）"web seam" 生态快照

本轮撞见一个完整的分发生态：DSH 官方在 `ctx.web` 上留了 web_search/web_fetch 的 provider 缝，社区已经长出 20+ 个搜索插件（searxng/exa/tinyfish/firecrawl/tavily/360/自架 JSON 通用适配器…），聚合市场 dsh-market 收录 1500+ 插件、带五维评分一键安装。**启示**：search-core 的 SKILL.md/MCP 出口之外，"宿主 provider seam 平替"是第三条分发路——对 Claude Code 就是 cc-websearch 式的技能平替。中国区还流行 360（so.com）免 key provider（Bronier/dsh-web-search-so360）。

---

## 五、新发现可接入的免 key 端点清单（search-core 引擎池候选）

| 端点 | 类型 | 证据来源 | 备注 |
|---|---|---|---|
| **mcp.exa.ai/mcp** | 语义搜索 JSON-RPC | TonyDua/dsh-web-search-exa | Exa 官方公开匿名 MCP，无凭据限流；有 key 自动升级 REST |
| **duck.ai /duckchat/v1/chat** | AI 搜索+新闻（带引用） | Afqoro/duckai-bridge | 需浏览器抓一次 X-Vqd-Hash-1（数小时有效）；RSA-OAEP 封包 |
| **Mwmbl 公共 JSON API** | 通用 web 索引 | dirmacs/daedra | 机房 IP 永远可用；Marginalia 的孪生备胎 |
| **Wiby**（wiby.me） | 独立/古典 web 搜索 | dirmacs/daedra | 长尾小站；HTML |
| **DDG Instant Answer API** | 知识图谱卡片 | dirmacs/daedra | 免 key，适合实体查询补全 |
| **Google News RSS** | 新闻 | dirmacs/daedra | 机房 IP 可用；比抓 Google 主站安全得多 |
| **8 大中文平台热榜 API**（微博/知乎/B站/百度/头条/抖音/贴吧/掘金） | 热点/趋势 | boy-373/hot-trending-mcp（上游 imsyy/DailyHotApi 有 100+） | 全公开端点，精确 URL 在 README |
| **百度热搜+autocomplete** | 趋势+联想词 | tamnd/baidu-cli | JSONL 免 key |
| **NIH ClinicalTables / EUR-Lex / DevDocs.io / urlscan.io(search) / 加州采购** | 垂直结构化 | pipeworx-io 家族 | 全免 key，按需挂载 |
| **StackExchange API / GitHub Search API** | 代码/社区 | daedra（免 key 档） | 我们池里还没有 SO |
| **Wayback Machine / archive.today** | 死链恢复 | Khamel83/argus | fetch 层兜底，不是搜索 |
| **llms.txt / text/markdown 声明** | 内容直读 | funkyfunc/fearch | 站点自我声明就直信，fetch 优先通道 |

（对照 c-report 已入池的：Marginalia/Openverse/HN/Wikipedia/arXiv/Crossref/BingRSS——本轮净新增 12 类。）

---

## 附：扫描记录

- 扫描日期：**2026-09-02**
- 搜索 API 用量：34 次（限额内；每 5 次间隔 sleep）
- commit 数核验：40 个短名单仓库用 `curl -sI .../commits?per_page=1` Link header 翻页法逐个取数
- 深读材料：gscrape README + docs/REVERSE-ENGINEERING.md、fearch、open-websearch-mcp、dsh-search-failover、duckai-bridge、supersearch、argus、daedra、my-websearch、hot-trending-mcp、dsh-web-search-exa、cse-bridge、PageKit、mcp-searxng-public、ddg-search-mcp、bxc、pi-lynx、unified-fetch、kortex-search、paperfoot/search-cli、amnesia、gosearch、serpapi-alternative（判垃圾）、cc-websearch 等 24 份
- 搜索词清单（17 组 × 双排序）：
  1. `search mcp`（updated/created） 2. `websearch mcp` 3. `mcp search server` 4. `searxng client` 5. `searxng wrapper` 6. `serp api free` 7. `serp scraper` 8. `duckduckgo api` 9. `duckduckgo search` 10. `google search scraper` 11. `metasearch` 12. `multi engine search` 13. `keyless search` 14. `"no api key" search` 15. `search aggregator` 16. `bing search wrapper` 17. `brave search client` 18. `mojeek` 19. `marginalia search` 20. `topic:mcp-server search` 21. `topic:serp` 22. `google keyless` 23. `duckduckgo lite` 24. `baidu search scraper` 25. `web search fallback` 26. `topic:search-engine` 27. `"search skill"`（created:>2025-06-01） 28. `engine fallback` 29. `"deepseek harness" web` 30. `searxng json` 31. `"tls fingerprint" scraper` 32. `impersonate search duckduckgo` 33. `"web_search" provider`（created:>2026-06-01） 34. `startpage scraper`（0 结果）
- 遗留盯梢：marko0905/websearch-rs（Rust ddgs 移植，待长身体）、GenSEAM/search（SearXNG 代理池轮换，1 commit 空壳但思路野）、aphrody-code/bxc（Google 面是否稳定）、DailyHotApi 端点目录全量盘点（下轮可专开一篇）
