# 支持AI调用的引擎全景 + 公共SearXNG×Google实测 + 动态域名路由设计（e-ai-invocable-domain-routing）

> 一句话总结：**①AI 能调的搜索源比我们池子里多得多，但分三档**（MCP 原生 / 为 LLM 设计的 API / 免 key 直连），真正的新发现是 Perplexity 开始"卖结构化搜索结果"、博查补了中文缺口、StackExchange API 是免 key 域名表最佳新人；**②公共 SearXNG 对 Google = 三层门全锁，config 里 google 开着你也走不到**（今日实测三实例解剖 + 官方 issue 佐证）；**③"AI 维护动态域名表"方向正确**——Tavily/Perplexity 的 include_domains 参数、MetaSearchMCP 按域拆工具、LDR 引擎元数据三重业界印证，本文给出 v0.6 可动手的三层路由设计。
- 实测日期：2026-09-03 ｜ 方法：node fetch 实测 + z-ai web_search 7 次核实官网/官方文档
- 用户原始三问：还有哪些引擎支持 AI 调用？/ 公共 SearXNG 也爬不了 Google 吗？/ AI 维护动态域名表质量会不会更好更快？

---

## 一、还有哪些"AI 能直接调用"的搜索源？（三档分类，只列我们池子没有的）

> 判断口径："AI 调用"≠"有 API"，而是：**返回结构化数据、为 LLM/agent 消费设计、支持自动化鉴权**。爬 HTML 不算（那是我们 provider 层自己消化的事）。

### 档位 A：为 LLM 设计的搜索 API（key 制，最"AI 原生"）

| 服务 | 关键事实（本次核实） | 对 search-core 的价值 |
|---|---|---|
| **Perplexity Search API**（新动向⚠️） | docs.perplexity.ai 实抓：2026 年从"卖答案（Sonar）"拆出了独立的 **Search API**——返回实时排序 web 结果的结构化数据，**原生带 domains/languages/regions 过滤参数**；Sonar 在线模型 $0.20–15/M tokens | 头部答案引擎下场卖"裸搜索"，且参数设计（domain 过滤）直接印证域名表思路。key 插槽观察位 |
| **博查 Bocha**（open.bochaai.com，中文场景缺口） | Web Search API **¥0.036/次 ≈ $5/1k**、Semantic Reranker API 限时免费、**官方 MCP server（bocha-search-mcp）已上架**；自我定位"国内最接近 Bing Search API 的效果"，差异化=**有国内 Region**（Bing API 数据出海无国内 region、$15/1k 且无摘要） | 中文 query 的付费引擎首选候选；官方 MCP 说明它把 AI 调用当一级公民。按量计费无免费档（阿里云文章提"千万 tokens 免费额度"疑为旧活动，需注册核实） |
| **Linkup**（linkup.so） | 2026 年 LLM 搜索 API 口碑榜常客，主打 answer quality；官方博客自评"Tavily/Exa 是默认起点，我们拼质量" | key 插槽观察位（免费额度待注册核实） |
| **Valyu** | 对比文宣称评分领先（79% vs Tavily 24%——**单一来源软文嫌疑，仅记录**） | 纯观察位，等二方验证 |
| **Brave Search API**（定价更新） | brave.com/zh/search/api 官网实抓：**$5/1k，每月送 $5 免费 credit**（≈1000 次/月，实际上等于月月循环免费额度） | 已在 key 插槽（v0.4），额度数字按此修正 |
| **Jina Reader**（补充确认） | jina.ai 官网：**免 key 即可用**（按 IP 20 RPM），注册 key 提限额；定位"URL→LLM 文本"不是搜索 | 已在 engines.md 记录；属"搜索结果消化器"配套件 |

**已在池/已插槽不重复**：Tavily（1000/月循环）、Exa（$10/月循环）、Serper（2500 一次性）、Google CSE（100/天，注意 d 系列已警告 CSE JSON API 2027-01-01 关停）。

### 档位 B：MCP 原生搜索（agent 一键接入形态）

- **官方 MCP**：Tavily / Brave / Exa / 博查 都有官方 MCP server；Exa 还有**免 key 匿名 MCP**（mcp.exa.ai，d 系列已记）。
- **社区 MCP**：ddgs MCP（四形态一体）、mcp-searxng（1.2k★）、MetaSearchMCP（14 工具按域拆）等，b 报告已全量覆盖。
- 结论：**MCP 是分发形态不是新引擎**——底层还是上面那些 API 或免 key 抓取，我们不缺这一层（MCP/CLI/REST 三出口已有）。

### 档位 C：免 key 直连（域名表 Tier-1 候选池）

| 端点 | 本次核实事实 | 用途 |
|---|---|---|
| **StackExchange API** ⭐新人 | api.stackexchange.com/docs/throttle 官方文档实抓：**免 key 300 次/天/IP，免费注册 key 10000 次/天**，并发 30 req/s；响应带 quota_max/quota_remaining 自报额度 | 编程垂直权威源，秒级稳定，**域名表 Tier-1 最佳新人**（我们只有 github 专项，缺 StackOverflow） |
| 百科/学术/新闻垂直 | wikipedia/hn/arxiv/crossref/googlenews 已全进池（engines.md 22 条目） | 不重复 |
| 中文热榜 API ×8 | d 系列"12 类新免 key 端点"已记录 | 中文场景备选 |

---

## 二、公共 SearXNG 到底能不能拿到 Google 结果？（2026-09-03 现场解剖）

**答：不能。而且比"拿不到"更狠——你在门口就被拦，连"google 开没开"都摸不着。** 今日对 6 实例做三层探测（/config 引擎开关 → format=json → HTML 结果页解剖），三种死法各逮到一个活的：

| 实例 | /config | JSON | HTML 解剖结论 |
|---|---|---|---|
| searx.be | 非配置页 | 200 但是挑战页非 JSON | 标题 **"Verifying your browser…"** + JS redirect = 浏览器验证挑战页，200 都是假象 |
| **priv.au** | ✅ 55 引擎开着，**google/google images/news/videos/google CSE/brave 全家都在列** | 挑战页 | 7KB 的 **JS 拦截页**（仅 1 个外链），带 0 条结果——**config 里 google 开着 ≠ 你用得上，bot 在门卫处就被扣下了** |
| search.inetol.net | ✅ 但**全实例只启用 1 个引擎**（google 不在） | 挑战页 | 真·搜索结果页（标题"python tutorial - INETOL SearXNG"）但 **resultClass≈0 条、0 个外站链接**——真开门真营业，货架是空的（引擎被掐到只剩 1 个） |
| searx.tiekoetter.com / opnxng.com | TCP 不可达（本沙箱） | 同 | 同 |

**官方层佐证（web 核实）**：
- searxng 官方仓库 issue #2750「Google Search - **Suspended: access denied**」：SearXNG 把 bot 请求转发给 Google → Google 认出是 bot → 封实例 IP，google 引擎被自家调度器挂起。
- SearXNG **官方 admin 文档**专门有一页《Answer CAPTCHA from server's IP》：教管理员用 SSH 隧道登服务器**人工解 CAPTCHA** 解锁 google——官方都承认 google 引擎要人肉伺候。
- Reddit r/Searx 共识帖：公共实例迟早 CAPTCHA/被识别/被封。
- 加上我们 P1 精读的 SearXNG 调度器挂起表（验证码挂 1 小时、CF 验证码挂 **15 天**、ReCAPTCHA 挂 7 天）——这就是"google 引擎在公共实例上的日常"。

**推论（接 engines.md 教训 #3）**：想要 Google 质量的结果，正确姿势不是硬爬 Google（裸 HTTP=91KB JS 空壳假货，TLS 伪装也救不了，engines.md 已列死案），而是：
1. **买 Google 结果**：Serper（2500 次一次性）/ 博查（$5/1k，国内 region）/ Perplexity Search API——把"爬"的外包成本换成"买"，一次性额度对低频 agent 极耐用；
2. **Google News RSS 兜底**（已在池，100 条/查询，site: 运算符有效）；
3. Google CSE 100/天保底（2027-01 关停前可用）。

---

## 三、AI 维护动态域名表：方向判断 + v0.6 三层路由设计

**答：方向完全正确，而且业界已有三重印证——但"动态"要克制，域名表变化慢，真正动态的是健康状态（这我们已有 breaker）。**

### 3.1 为什么方向对（业界印证）

1. **商业 API 用参数承认了这条路**：Tavily 官方文档实抓——`include_domains` / `exclude_domains` 是一级参数（"Restrict results to trusted sources"）；Perplexity Search API 同样原生带 domains 过滤。头部玩家把"域名收窄"当质量旋钮。
2. **我们精读过的项目都在这么干**：MetaSearchMCP 把 14 个工具按域拆（search_code/search_academic/search_finance…本质=预置域名路由）；local-deep-research 把引擎 strengths/weaknesses 元数据拼进工具描述让 LLM 自选垂直引擎（arxiv/pubmed）；Google CSE / Kagi Lens 是产品级先例（自定义引擎=固化域名表）。
3. **速度账**：我们实测过的 Tier-1 垂直 API 全是 37ms–724ms（arxiv 37ms / openverse 60ms / hn 430ms / wikipedia 675ms / crossref 724ms），且**官方欢迎程序化调用、永远不会被反爬封**——比通用引擎（可能 202/429/挑战页）少了整条失败重试链。质量账：权威域直连 = 天然绕开 SEO 农场，StackOverflow API 还带 score/accepted_answer 结构化信号，比"site:stackoverflow.com 再套引擎"强一档。

### 3.2 三层路由设计（v0.6 提案）

```jsonc
// core/src/domains.json（种子表 30-50 域，git 管理可审查可回滚）
{
  "programming": [
    { "domain": "stackoverflow.com", "tier": "api", "provider": "stackexchange" },
    { "domain": "github.com",        "tier": "api", "provider": "github" },      // 已有
    { "domain": "developer.mozilla.org", "tier": "site", "engines": ["duckduckgo", "bingrss"] },
    { "domain": "news.ycombinator.com",  "tier": "api", "provider": "hn" }         // 已有
  ],
  "academic": [
    { "domain": "arxiv.org",    "tier": "api", "provider": "arxiv" },             // 已有
    { "domain": "en.wikipedia.org", "tier": "api", "provider": "wikipedia" }      // 已有
  ],
  "images": [
    { "domain": "openverse.org", "tier": "api", "provider": "openverse" }          // 已有
  ]
}
```

- **Tier 1（api）**：域名有免 key API → 直连对应 provider（现有 19 个 provider 直接复用，新写一个 stackexchange.ts 就能点亮最大缺口）。
- **Tier 2（site）**：没 API 的权威域 → 在 DDG/Mojeek/Yahoo/BingRSS 上拼 `site:domain` 前缀（googlenews 的 site: 已验证有效）。注意结果数会缩水（引擎索引过滤后可能只剩几条）——诚实返回，不补水。
- **Tier 3（通用池兜底）**：表未命中 → 走现有 planner 的 web 路由。**长尾问题别硬路由**，没有权威域的问题留在通用池。

- **接入点（现有代码零重构）**：planner.ts 已有 `route: "web" | "github" | "x"`，域名表就是在 web 路由前插一层"查表路由"：命中 → 并行打 Tier1 providers + Tier2 site: 查询 → 照旧进 fusion（共识排序现成）。限速归 governor、生死归 breaker、融合归 fusion——**全是已有机制，新代码只有"查表 + 拼查询"百来行**。

### 3.3 "AI 动态维护"落地回路（克制的版本）

1. **冷启动**：手工种子表（本文件 3.2 的 30-50 域按领域分组）。
2. **运行时学习回路**：某类查询结果质量差/全灭时，agent 把"本轮结果里反复出现的权威域"记进 journal → 提议新条目 → **先过 smoke 测试（证明该域的 tier 判断是对的）→ 写进 domains.json**。表在 git 里 = 变更可审查、坏了可回滚。
3. **健康巡检**：每条目每天 smoke 一次，死了自动临时摘除——**复用 breaker，零新机制**。
4. **克制条款（诚实设计）**：
   - 别让 LLM 幻觉造域名：新条目必须过 smoke（真实打一发验证 tier/provider 判断）才能入表；
   - 表按领域分组 + 设条目上限（比如 100），防 planner 决策变慢；
   - "动态"的重点不是天天换域名（域名不常换），而是**每个域的健康状态和 tier 判断随时会过期**——这层交给 breaker + 巡检，不是交给 LLM 天天改表。

### 3.4 一句话裁决

**用户的直觉是对的**：通用引擎是"撒大网"，域名表是"指定鱼塘钓鱼"——快（少失败重试链）、好（绕开 SEO 农场）、稳（官方 API 不封人）。v0.6 两个动手件：**stackexchange.ts**（点亮 Tier-1 最大缺口，免 key 300/天）+ **domains.json 查表路由**（planner 前插一层，百行级改动）。

---

## 附：本次实测与核实记录

- SearXNG 探测脚本：`scripts/searxng-google-probe.mjs`（三层探测）+ `scripts/searxng-page-autopsy.mjs`（页面解剖），原始输出 `scripts/searxng-*-result.jsonl`
- 6 实例探测：searx.be / search.inetol.net / searx.tiekoetter.com / opnxng.com / priv.au / baresearch.org（各 /config + json + html 三层）
- web_search 核实 7 次：AI search API 对比 / 博查 / Perplexity Sonar+Search 定价 / SearXNG google 封锁 / StackExchange 限流 / Tavily include_domains / Jina
- 原始搜索结果 JSON：本机 scripts/ws1~ws7（不入仓，结论已抄录本文）

---

## 附二：托管搜索 API 黑盒验尸（以助手自身搜索能力为样本）+ BYOK 市场验证

> 日期：2026-09-03。背景：用户问"你也是 bot，你用什么搜？能否借我用？"——顺势用本文解剖 SearXNG 的同一套黑盒方法，反向解剖助手自己调用的托管搜索 API（z-ai web_search function，本报告此前 7 次核实用的是同一工具）；再顺带回答第二个问题："编程办公 AI 工具的搜索都依赖账户吗？支持第三方 key 之后搜索是不是就没了？"

### A. 黑盒验尸：托管搜索 API 能测出什么

助手能看见的只有 I/O（query 进、JSON 出），引擎选择/聚合/排序/缓存全在服务端黑盒里。三探针验尸：

| 探针 | 查询 | 结果 | 结论 |
|---|---|---|---|
| `site:` 操作符 | `site:stackoverflow.com python asyncio semaphore` | **6/6 全部来自 stackoverflow.com**，零漏网 | 后端支持域名级过滤——Tier-2 `site:` 前缀路由在托管类 API 上同样可用，是"无 API 权威域"场景的通用钥匙 |
| 冷门内容 | `mmqz search-tool-rnd github` | 找不到目标仓库，返回邻近项（crewai/MindSearch/HN 等） | 弱证据（仓库若私有本来就抓不到），但至少证明**没有特殊 GitHub 代码搜索集成** |
| 响应 schema 指纹 | 字段 `name/url/snippet/host_name/rank/date/favicon` | 与 Serper（link/position）、Tavily（content/score）、博查（siteName/summary）原生 schema 均不匹配；`date`/`favicon` 空置 | **自建聚合层重新包装**，非任何一家裸转发——从 schema 反推上游这条路走不通 |

顺带复核实价（本轮新抓，与 §1 key 插槽表一致）：Perplexity Search API **$5/1k**（官方 pricing 页，无额外 token 费）≈ 博查 **¥0.036/次**（第三方文档），两家打平，博查多国内 Region 与中文生态。

**方法论结论**：黑盒验尸测得出**行为能力**（site: 支持与否、索引深度、schema 形状），测不出**底层真相**（上游是谁、怎么排序）。与 SearXNG 六实例解剖是同一课——三条路线的本质差异就此摆齐：

1. **托管 API**（本验尸对象、博查、Perplexity）：可测行为、不可审计底层，改动只能靠行为漂移发现；
2. **自建 SearXNG**（docs/selfhost-searxng.md）：全透明，真正卖点不是省钱，是**可审计可调**；
3. **search-core 直连**：中间态——HTTP 层每一帧可见（三层门/JA3 指纹就是这么抓的），结果集本身仍是上游给的。

### B. BYOK 市场验证：搜索被锁进订阅，缺口由 MCP/插件来补

| 工具 | BYOK 后搜索 | 证据（2026-09 实抓） |
|---|---|---|
| Claude Code | **不可用** | 官方文档：WebSearch is not available on Amazon Bedrock（Vertex 同）；server-side tool `web_search_20250305` 转发到 Bedrock 被直接拒绝（litellm#26252）；AWS 官方给的解法是挂 **MCP Web Search connector**（AgentCore Gateway 教程） |
| Cursor | **刻意阉割** | 官方帮助页：自定义 key 只对 chat 模型生效，Tab 补全仍走 Cursor 内置模型；Composer 模型后端**拒绝任何带 BYOK key 的请求**（forum #162152）；Reddit 用户称 "effectively killed BYOK" |
| 通用 agent 生态 | **自带搜索 key 可补** | Tavily/Exa/Firecrawl 等搜索 MCP server 均要求用户自己的搜索 key——"搜索"已独立成订阅品 |

**大白话机制**：BYOK 只带了"大脑"（LLM 推理费），没带"眼睛"（搜索费）。搜索是厂商后端跑的 server-side 工具——成本真实发生（上游 API 或自建爬虫），又是订阅差异化卖点，所以必然绑账户计量计费。换上自己的模型 key 等于只租了厨房没租菜谱，眼睛自然被拔掉。

**对本项目的意义（市场验证）**：厂商把眼睛锁进订阅 → BYOK 用户的搜索缺口成为独立市场 → 补法三条：① 付费搜索 MCP（Tavily/Exa/博查，key 插槽表已覆盖）；② 自建 SearXNG MCP（selfhost-searxng.md 已有速查）；③ **免 key 直连（search-core 的 21 providers）**。pi-search-boost / dsh-search-boost 卡的正是这条缝隙，本轮实抓等于给产品存在必要性做了一次市场验证。

> **延伸**：用本仓库 12 份逆向报告把这套绑定分析回扫到全部已逆向产品（Grok Build/Codex/WorkBuddy/Qoder/Trae/Claude Code/Kimi Desktop/ZCode/Perplexica/ODR），归纳出四种绑定模式——见 [reports/13-cross-comparison.md §5.5](../../reports/13-cross-comparison.md)。

### C. 附二信源

- cursor.com/help/models-and-usage/api-keys（BYOK 仅 chat 模型）；forum.cursor.com/t/162152（Composer 拒 BYOK）；reddit r/cursor "effectively killed the BYOK option"
- code.claude.com/docs/en/amazon-bedrock（WebSearch 不可用）；builder.aws.com（Bedrock 挂 MCP 搜索 connector 官方教程）；github.com/BerriAI/litellm/issues/26252
- docs.tavily.com / firecrawl.dev（搜索 MCP 需自带 key）；docs.perplexity.ai/docs/getting-started/pricing（$5/1k）
- 验尸原始输出：本机 probe-site.json / probe-obscure.json / ws-byok-*.json（不入仓，结论已抄录本文）
