# 搜索 API 全景盘点：免 key 实测 + 免费额度核实（c-search-apis）

> 一句话总结：**通用 web 搜索的"免 key 白嫖"路线在 2026 年基本绝迹**（DDG 本环境连不上、公共 SearXNG 全灭、Brave 网页端 429），能长期白用的只剩**垂直 API**（HN/Wikipedia/Openverse/Marginalia/Crossref/arXiv）和"今天恰好能解析"的 Bing HTML；要稳定质量就得走 key API，免费额度最大方的是 **Tavily（1000 credits/月循环、不要卡）**、**Exa（每月 $10 循环、不要卡）**、**You.com（新号 $100 一次性）**。

- 实测方法：Bash + curl，`-m 15 -w "HTTP:%{http_code} time:%{time_total}s"`，记录状态码/延迟/格式/能否拿到结果
- 出口环境：本沙箱数据中心 IP（这很重要——很多"被挡"其实是**对数据中心 IP 的态度**，家庭宽带跑分可能更好）
- 已知情报对照：Bing Search API 已于 2025-08 退役 ✅ 与本次抓到的各方信息一致，微软的替代品是 Azure AI Agents 里的 "Grounding with Bing Search"，不走公开 API，本文不再把 Bing API 当候选

---

## 表一：免 key 端点实测（2026-09-02）

| # | 端点 | 状态码 | 延迟 | 格式 | 能否拿到结果 | 大白话点评 |
|---|------|--------|------|------|------------|-----------|
| 1 | `html.duckduckgo.com/html/` (POST q=test) | **000 TCP 超时** | >15s | - | ❌ | 本环境 80/443 全部建连超时（解析到 20.43.161.105）。连 TCP 都握不上手，属于网络层不可达；就算可达，DDG 对数据中心 IP 的机器人检测也是出了名的。**不宜当主力** |
| 2 | `lite.duckduckgo.com/lite/?q=test` | **000 TCP 超时** | >15s | - | ❌ | 同上，DDG 全域在本环境不可达 |
| 3 | `www.mojeek.com/search?q=test` | **000 TCP 超时** | >15s | - | ❌ | 本环境不可达（解析 5.102.173.68）。Mojeek 官方也明说网页版不欢迎程序化抓取，想用请走他家付费 API |
| 4a | `search.marginalia.nu/search?query=test` | 302→200 | 1.9s | HTML | ✅ | **域名搬家了**：302 到 `marginalia-search.com`，跟随后正常出结果页（约 30 个链接）。爬 HTML 可行但注意新域名 |
| 4b | `api.marginalia.nu/public/search/test` | **200** | 0.7s | **JSON** | ✅ | 免 key 公开 API 直接可用！返回 title/url/description/quality 分，License 是 **CC-BY-NC-SA 4.0（商用注意）**。独立索引，专门捞小众/个人站，和 Google 系互补 |
| 5 | `api.openverse.org/v1/images/?q=cat` | **200** | **0.06s** | **JSON** | ✅ | 免 key 秒回，result_count=240，字段齐全（license/provider/tags）。匿名档有限流（429 风险），但配额对低频 agent 足够。**CC 图片搜索最优解** |
| 6 | `hn.algolia.com/api/v1/search?query=test` | **200** | 0.43s | **JSON** | ✅ | 免 key 无鉴权，nbHits=68 万，稳定跑了很多年，极可靠。但只覆盖 Hacker News 内容 |
| 7 | `en.wikipedia.org/w/api.php?...list=search` | **200** | 0.51s | **JSON** | ✅ | MediaWiki 标准接口，33 万命中，永远免费永远在线。百科垂直必收 |
| 8 | `www.bing.com/search?q=test`（浏览器 UA） | **200** | 0.27s | HTML | ✅（意外） | 纯 curl + 浏览器 UA 居然给了完整结果页（121KB，10 个 b_algo 结果）。API 死了网页端还活着。**但这是"今天恰好没拦"，随时可能收紧，只配当机会主义 Provider** |
| 9 | `search.brave.com/search?q=test` | **429** | 0.31s | HTML(报错页) | ❌ | 如预期被挡，机器人检测直接限流。想用 Brave 的质量请走官方 API |
| 10 | `duckduckgo.com/html/?q=test` | **000 TCP 超时** | >15s | - | ❌ | 备用域名也没用，DDG 全域不可达 |
| 11 | 公共 SearXNG 实例 ×19（`searx.be`、`search.inetol.net`、`opnxng.com`、`priv.au`、`paulgo.io`、`baresearch.org`、`etsi.me`、`searx.tiekoetter.com`、`search.hbubli.cc`、`grep.vim.wtf`、`find.xenorio.xyz`、`kantan.cat`、`libresearch.space`、`sear.lurx.net`、`sx.catgirl.cloud`、`search.in.projectsegfau.lt`、`searxng.world`、`searxng.site`、`search.mdosch.de`） | 429/403/200(挑战页)/000 | 0.2–1.1s | - | **❌ 0/19 返回 JSON** | 从 searx.space 的 instances.json（92 个实例）筛了 uptime 最高的 19 个实测 `/search?q=test&format=json`，全军覆没：**6 个 429 限流、2 个 Anubis 工作量证明挑战页（"Making sure you're not a bot!"/"Oh noes!"）、1 个 403 明说"你的 IP 段搞过大规模垃圾流量"、2 个 403/连接失败、searx.be 返回 HTML 挑战**。公共实例对数据中心 IP 已经全面敌对，JSON 输出基本都被关了。**结论：SearXNG 只值得自托管** |
| 12a | `api.crossref.org/works?query=test` | **200** | 0.73s | **JSON** | ✅ | 免 key 学术文献元数据，77 万命中，礼貌池（加 mailto 进快池）。学术垂直可选 |
| 12b | `export.arxiv.org/api/query?search_query=all:test` | **200** | 0.43s | Atom XML | ✅ | 免 key，返回 XML（要解析）。arXiv 论文垂直可用。注意 http 会 301，直接用 https |
| 13 | startpage / marcia | - | - | - | 跳过 | 按任务指示未测（业界公认对 curl 最狠的几家，不值得浪费请求） |

对照组：`google.com` 200（0.13s，说明本环境出口本身是通的）、`ecosia.org` 403（0.04s，搜索引擎网页端普遍敌视 curl 的又一例证）。

---

## 表二：要 key 的搜索 API 免费额度（2026-09-02 抓官网核实）

| 服务 | 免费额度 | 要信用卡吗 | 返回格式 | 效果口碑（agent 生态） | 接入难度 |
|------|---------|-----------|---------|----------------------|---------|
| **Tavily** | **1,000 credits/月，月月循环**（官网原文核实："1,000 free API credits per month with no credit card required"；Researcher 计划 $0，Project $30/月） | ❌ 官方明说不要卡 | JSON（title/url/content/score，专为 LLM 设计） | **AI agent 生态事实标准**，LangChain/LlamaIndex 默认搜索，content 直接可喂模型 | ⭐ 极简：一个 key 一个 POST |
| **Brave Search API** | 有免费月度额度（官网核实存在 "free monthly credits"；业界通行认知 **2,000 queries/月、1 qps**，具体数字**待核实**） | ⚠️ 官网明说"卡只用来确认身份、不扣费"=**要绑卡** | JSON（web/news/images 分接口） | 独立索引质量好、无 Google 依赖，agent 用得多 | ⭐⭐ 简单，要绑卡略烦 |
| **Serper.dev** | **2,500 free queries（一次性，不循环）**（官网核实"2,500 free queries"） | ⚠️ 页面同时出现 "credit card required" 字样，是否强制**待核实**（通行体验：邮箱即可注册） | JSON（Google SERP 结构化转发） | Google 结果转发，**速度快**，agent 圈老牌选择 | ⭐ 极简 |
| **Exa** | **注册送 $20 + 每月 $10 credits 循环，明说 "No payment method required"**（官网 pricing 页核实） | ❌ 不要卡 | JSON（含神经/语义搜索、find similar、contents 抓正文） | 语义搜索口碑好，找"同类内容/论文/公司页"强，agent 生态增长中 | ⭐ 极简 |
| **You.com API** | **新账号 $100 complimentary credits**（docs.you.com 原文核实："new accounts start with $100 in complimentary credits"，且 "no credit card required"） | ❌ 不要卡 | JSON（web search / news / research 端点） | 转型做 agent 的 Web Search APIs，生态认知度中等 | ⭐ 简单 |
| **Google Programmable Search (CSE)** | **100 queries/天免费**；超出 $5/1000，上限 10,000 queries/天（开发者文档原文核实："100 search queries per day for free... $5 per 1000 queries"） | ❌ 不要卡（要 Google Cloud 项目+建自定义引擎拿 cx） | JSON | 结果是 Google 但**只是你配置的 CSE 子集**，全网页面覆盖率打折；适合站内搜 | ⭐⭐⭐ 中：建引擎、配 cx、管 key 三件事 |
| **Mojeek API** | 付费（官网 pricing 本环境不可达，**额度/价格待核实**；通行认知：低价档月付，量小够用） | 待核实 | JSON | 独立索引、无偏见卖点，小众但真索引 | ⭐⭐ 简单 |
| **SerpAPI** | **250 searches/月免费**（官网 pricing 核实） | ❌ 免费档不要卡 | JSON（Google/Bing/多家 SERP 全托管） | 老牌 SERP 代理，稳但**贵**（付费档是同行最贵之一） | ⭐ 简单 |
| **Kagi Search API** | **无免费层，纯付费**（官网/帮助页未公示具体价格文本，**待核实**；通行认知 ~$25/1000 次搜索量级） | 要（Kagi 账号充值） | JSON | 搜索质量口碑天花板，无广告无追踪，但付费墙挡住了免费试用 | ⭐⭐ 简单 |
| **Jina Reader (r.jina.ai)** | **免 key 可用：20 RPM（按 IP 限流）**；免费注册 key 后 500 RPM / 2,000,000 TPM（官网 rate limit 表核实） | ❌ 不要卡 | **Markdown**（网页转 LLM 友好文本） | 不是搜索引擎但是**搜索结果消化器**：把 URL 转 markdown 喂模型，agent 圈标配 | ⭐ 极简：GET 前缀即可 |
| **Firecrawl** | 有 Free Plan（官网核实存在；通行认知 **500 credits 一次性**，具体数**待核实**） | ❌ 免费档不要卡 | JSON/Markdown（抓取+结构化为主，含 /search 端点） | 抓取赛道头部，搜索是配菜 | ⭐ 简单 |

---

## 结论

### 1. 免 key 可持续名单（实测通过，按 速度 × 质量 × 可持续性 排序）

| 排名 | 端点 | 实测延迟 | 格式 | 适合进 search-core 当 Provider 的理由 |
|-----|------|---------|------|-----------------------------------|
| 🥇 | **HN Algolia** | 0.43s | JSON | 零门槛零限流，多年稳定，tech 类 query 质量意外地好 |
| 🥈 | **Wikipedia API** | 0.51s | JSON | 同上，百科类 query 权威答案，永远在线 |
| 🥉 | **Openverse** | 0.06s | JSON | 最快，图片垂直独一档，license 字段直接可用 |
| 4 | **Marginalia API** | 0.7s | JSON | **唯一免 key 的"通用 web"JSON API**，独立索引补盲区；注意 CC-BY-NC-SA 与域名已迁 marginalia-search.com |
| 5 | **Crossref / arXiv** | 0.4–0.7s | JSON/XML | 学术垂直，稳 |
| 6 | **Bing HTML**（机会主义） | 0.27s | HTML | 今天能出 10 条结果，但属于"灰色窗口"，只能当低优先级降级路线，必须配熔断 |

**关键反结论**：
- **免 key 的通用 web 搜索已死**。DDG 三个入口本环境 TCP 层全不可达、公共 SearXNG 19/19 无 JSON、Brave/Startpage 级别的 bot 防护遍地。想在免 key 前提下做"通用搜索"，唯一可持续路径 = **自托管 SearXNG**（自己机器上 JSON 随便开，没有 IP 封禁问题）——search-core 的 searxng provider 应该明确定位为"自托管假设"，公共实例只配当试运行。
- 免 key 组合拳的正确姿势：**垂直 API 补面（HN/Wiki/Openverse/Marginalia/Crossref）+ Bing HTML 捞漏 + 自托管 SearXNG 兜通用**。

### 2. 低成本 key 名单（免费额度最大的 2–3 家，付费引擎健康路由候选）

| 排名 | 服务 | 额度 | 为什么选它 |
|-----|------|------|-----------|
| 🥇 | **Tavily** | 1,000 credits/月**循环**、不要卡 | agent 生态最通用、结果为 LLM 优化、月月刷新=可持续白嫖，作为付费引擎**默认健康路由首选** |
| 🥈 | **Exa** | 注册 $20 + **每月 $10 循环**、不要卡 | 月月循环且额度折算 ~$10k+ tokens 量级的搜索次数，语义搜索差异化，质量好 |
| 🥉 | **You.com** | 新号 **$100 一次性**、不要卡 | 一次性额度最大，适合冷启动/爆发期；用完需付费，可持续性不如前两家 |
| 备 | Serper.dev | 2,500 一次性 | 额度大但一次性，且要 Google SERP 转发质量时最顺手，可当第二梯队 |
| 备 | Google CSE | 100/天循环 | 循环额度小但**永远免费**，配好 cx 后当最低速率的保底路由也行 |

推荐路由策略（给 search-core）：**免 key 垂直 API 先跑 → 自托管 SearXNG 兜通用 → 结果不足时 key 路由（Tavily 主 → Exa 备 → You.com 爆发）**。

### 3. 风险提示

- **DDG 对 IP 频率极敏感**：机器人检测 + 本次实测数据中心 IP 直接 TCP 不可达。就算换网络跑通，也不能高频；search-core 的 DDG provider 必须保留降权 + 熔断 + 大间隔。
- **公共 SearXNG 三重死法**：limiter 429、Anubis PoW 挑战、IP 段黑名单（有实例直接明说"你们这个 IP 段发过垃圾流量"）。不要在产品里硬编码公共实例列表当依赖，最多当"可选实验源"。
- **Bing HTML 是灰色窗口**：今天 200 且 10 条结果，明天可能就 462/验证码；只能机会主义使用，永远要有 Plan B。
- **Marginalia 的 License 是 CC-BY-NC-SA**：非商用场景随便用，商用产品要过法务。
- **Marginalia 网页端域名已迁移**（search.marginalia.nu → marginalia-search.com 302）：爬 HTML 的话直接写新域名，老域名随时可能彻底下线。
- **Brave 免费档要绑卡**（身份确认用途），自动化注册流程里要考虑这一点；Openverse/Crossref 匿名档都有礼貌限流，别打满。
- 本盘点所有"被挡"结论基于**数据中心出口 IP**；家用网络环境下 DDG/Mojeek/SearXNG 公共实例的存活率会更高，但产品不能假设用户都在家跑。

---

*实测日期：2026-09-02（环境：沙箱数据中心出口 IP；curl + -m 15 计时）*
