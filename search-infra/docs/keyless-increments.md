# 免 Key 公共源审计与增量轮（phase AB）

> 日期：2026-09-03。输入：用户两轮外部调研清单（网页 SERP 抓取盘 / 真·公网无 Key 端点 / 公共 SearXNG / 垂直源）+ 用户实测 searx.space 扫描（80 实例仅 2 个开 JSON）。
> 纪律：**每个候选先探针后定案**（原始 JSON 留 /tmp，只抄结论）；能证实才说证实；过不了的诚实记档不硬接。
> 证据链脚本：`core/scripts/probe-keyless-ab.mjs`（16 候选 + 强度复验，原始输出落 /tmp/phase-ab/）。

## 一、探针矩阵（2026-09-03 实测）

| 候选 | 探针结果 | 判定 |
|---|---|---|
| **Tavily keyless**（`X-Tavily-Access-Mode: keyless`） | 200 + 5 条结果；**连打 6 发全 200**（1.3-4s），asyncio 题 realpython 顶位 | ✅ 接入（现有 tavily provider 内切 keyless 车道） |
| **Firecrawl keyless**（POST /v2/search 无 Authorization） | 200 + 5 条（0.8-1.3s）；连打 4 发全 200；description 是抓取页 markdown（YouTube 页噪音数千字符） | ✅ 接入（显式启用，不进默认池，待 bench 观察） |
| **Parallel 匿名 MCP** | initialize 200 + session、tools/list 200、tools/call 200（结果=content[0].text 内嵌 JSON `{results:[{url,title,excerpts[]}]}`，_meta 自报 sku_search cost） | ✅ 接通（mcp-connector 新增 argsTemplate + excerpts 数组归一化，一行配置即插，见下文配方） |
| **AnySearch 匿名** | 200 `{code:0,data:{results[]}}` 形状干净；连打 6 发全 200（1.4-1.9s）；asyncio 题 docs.python.org/realpython 顶位 | ✅ 接入（新 provider，进默认池） |
| **PubMed eutils** | esearch→esummary 两步全 200（632ms），题录完整 | ✅ 接入（academic 腿） |
| **sov2ex**（V2EX 社区搜索） | 200，中文题 total=51399，_source 含 id/title/content/created | ✅ 接入（编程主题仅中文题进腿） |
| **SearXNG search.mectov.my.id** | 200 JSON results=10，**333ms**（独立复验通过） | ✅ 接入（searxng 内置兜底链） |
| **SearXNG sx.xo.st** | 200 JSON results=10，3.9s（慢但可用） | ✅ 接入（兜底链第二位） |
| **DDG Instant Answer** | 200 但 Abstract 空、RelatedTopics=0（"who invented the web"实测无货） | ❌ 不接：摘要层非 SERP，实测贡献≈0 |
| **Qwant v3 API** | **403**（数据中心 IP 反爬直接挡） | ❌ 不接（诚实记录：官方 API 无 Key 路对 DC IP 不可用） |
| **Jina s.jina.ai** | **401**（keyless 时代结束，证实"部分文档标为需要 Key"） | ❌ 不接 |
| **Semantic Scholar** | **429**（无 key 共享池，196ms 即拒） | ❌ 不接（间歇可用不可依赖；openalex/dblp/crossref/pubmed 已覆盖学术面） |
| **Yep**（SERP 抓取） | **403**（80ms 即拒，反爬硬） | ❌ 不接 |
| **Startpage**（SERP 抓取） | 200 但页面含 captcha/challenge 信号 | ❌ 不接（挑战页=不可依赖） |
| **Open Library** | 9s 超时 + 重试 fetch failed（沙箱网络层失败） | ❌ 本轮不接（书籍垂直属边缘需求，挂账观察） |
| **Nominatim**（地理） | 200 JSON（规范 UA） | ⏸ 探针通过暂不接：地理垂直无对应查询主题，避免"接了不用"的目录噪音，挂账 |
| 公共 SearXNG 实例大盘 | 用户实测 80 实例：55 个 429、11 个伪 200 挑战页、6 个 403、4 个 418、**仅 2 个真 JSON** | 判定=公共实例只能当兜底不能当主力（行业刻意关 JSON+反爬），与 phase AA searx.be 伪 200 教训互证 |

## 二、落地清单（6+2）

**provider 层（4 新 + 2 改造）：**
1. `anysearch`（新）：默认池第 13 名，托管聚合免 key 车道，独立索引覆盖增量。
2. `firecrawl`（新）：keyless 聚合，显式 engines/research 启用；markdown 噪音 clamp 兜底。
3. `pubmed`（新）：eutils 两步式，academic 腿 5→6（顺带稀释 arXiv 刷屏挂账项，第 8 轮 bench 观察是否还需 topic 感知 domainCap）。
4. `sov2ex`（新）：V2EX 社区，编程主题 + 查询含 CJK 才追加（`domains.ts zhBoostProviders` lang-guard，英文题零打扰）。
5. `tavily`（改造）：官方 keyless 匿名车道（isConfigured 恒 true + keySlot 语义扩展：无 key 也并入默认池；Phase Y 的"keySlot+免 key 强注入"教训这次是故意行为，熔断 rate_limited 档兜长期强度）。车道规则：无 key 且无 baseUrl 才走匿名（自建网关/Hikari 必须带 token）。
6. `searxng`（改造）：多实例回退链——自建（SC_SEARXNG_BASE_URL）永远链首 → 内置兜底实例（mectov → xo.st，SC_SEARXNG_INSTANCES 可覆盖）；判定标准是"能 JSON.parse 且有 results"而非 HTTP 码（伪 200 挑战页教训）；单实例空 results 换下一家，全灭才抛错交熔断。isConfigured 恒 true（显式空名单才可关）。

**connector 层（1 特性）：**
7. `mcp-connector` argsTemplate：任意非标准参数形状的 MCP 工具一行配置即插（模板字符串 `${query}` 深替换，嵌套对象/数组递归）；配了模板则跳过 query/count 键启发式探测。Parallel 匿名 MCP 配方：

```json
{ "name": "parallel", "url": "https://search.parallel.ai/mcp", "tool": "web_search",
  "argsTemplate": { "objective": "${query}", "search_queries": ["${query}"] } }
```

**归一化层（1 修补）：**
8. `normalizeToolResult` 补 `excerpts` 键 + 字符串数组连接成 snippet——否则 Parallel 返回的条目只有 URL 没有摘要（"哑条目"）。

## 三、验证

- 测试 185→200（+15）：tavily keyless/Bearer 双车道、anysearch/firecrawl/sov2ex/pubmed 黄金样本、searxng 回退链（伪 200 换实例/全灭抛错/自建优先）、argsTemplate 深替换、excerpts 数组归一化。全绿。
- 第 8 轮 bench：**L1=9/9、L1+L2=9/9 无回归**；出勤均值 4.9→5.9（tavily+anysearch 9 题全勤）；耗时均值 1.9s（软截止 6s 内）；清洗 100%；spam 屏蔽 9 条（transformer 题 2 + milvus 中文题 7）。
- vs-zai 第 5 采样（--quick 4 题）：4/4 战平；权威密度 14 vs 6（2.3 倍）；**延迟反超**（我方 0.6-2.2s vs 对方 2.2-12.7s 含冷启）；域名重叠 Jaccard 0.46-0.58（历史均值 0.16 → 新聚合车道让我们开始覆盖"对方的互联网"，双面架构融合面扩源的直接证据）。

## 四、诚实边界与挂账

- anysearch/firecrawl/tavily-keyless 匿名额度官方均未公开，本沙箱短时强度测试不代表长期/高并发表现；长期靠熔断（429→rate_limited→2min 冷却）+ 半开探针自愈。
- 公共 SearXNG 两实例随时可能关 JSON/加限流/挂掉（用户实测 80 实例仅 2 存活的现状即证据）；自建仍是最稳路径（docs/selfhost-searxng.md）。
- firecrawl 是否升默认池：等更多轮 bench 出勤与质量数据，不在接入当天拍板。
- 挂账：Nominatim（探针通过待地理主题）、Open Library（沙箱网络失败待线下复验）、Semantic Scholar（无 key 429，除非官方放宽）、Parallel 的 session_id 免费层限流参数（可由用户在 argsTemplate 里自带）。

## 五、phase AG-1 探针第 2 批（2026-09-04，用户"继续扩充优化计划"）

> 证据链脚本：`core/scripts/probe-ag-sources.mjs`（9 候选，原始输出落 /tmp/phase-ag/）。
> 背景：phase AB 挂账 3 项（Open Library/Semantic Scholar/Qwant）到期复审 + 新候选 6 项。

| 候选 | 探针结果 | 判定 |
|---|---|---|
| **PyPI JSON API**（`pypi.org/pypi/{name}/json`） | 200（161ms）：name/version/**license**/requires_python 齐 | ✅ 接入（pypi provider，packages 腿）——注意这是**按包名直取的元数据 API，不是搜索**：非合法包名（含空格）合法空零请求；404=包不存在也是合法空；搜索端点仍死，关键词搜包仍走 npm/crates 腿 |
| **HuggingFace Papers**（`huggingface.co/api/papers/search?q=`） | 200（879ms）arr=120：嵌套 `paper{id(arXiv号),title,summary,publishedAt}` | ✅ 接入（hfpapers provider，academic 腿第 7 腿）；url 拼 huggingface.co/papers/{arXiv号}；配 " paper" 路由关键词（带前导空格，newspaper/whitepaper 零误伤实测）后 en 学术题可路由进线 |
| Open Library（挂账复审） | 9s 超时 + 二轮复探 fetch failed（沙箱网络层两次失败） | ❌ 关账（两次不同日失败，非瞬时抖动；书籍垂直属边缘需求） |
| Semantic Scholar（挂账复审） | 仍 429（209ms 即拒） | ❌ 关账（openalex/dblp/crossref/pubmed/hfpapers 已 5 腿覆盖学术面） |
| Qwant v3（挂账复审，浏览器全套头） | 仍 403（819ms，挑战页） | ❌ 关账（浏览器头也过不了 DC IP 反爬，AB 结论加固） |
| GitLab 项目 API | `search`+`order_by=stars` 400；去参数改 403 HTML 挑战页 | ❌ 不接（数据中心 IP 被挑战，同 Qwant 案） |
| searchcode | API 端点 404 `page not found` | ❌ 不接（API 已死亡） |
| GDELT 文档 API | 15s 超时一次；复探 429 且**官方明文"1 req / 5 seconds"** | ❌ 不接（强制 5s 节奏与全并行池+6s 软截止的结构性冲突——接了也永远赶不上收割，诚实不硬凑） |
| Internet Archive advancedsearch | 9s 超时 + 复探 fetch failed（与 web.archive.org 同域同款沙箱不可达） | ❌ 不接（timemachine 的 CDX 腿同款限制已在案） |

**落地**：注册 37→39（pypi/hfpapers）；packages 腿 4→5、academic 腿 6→7；AG-4 license_status 一并落地（pypi ref.license 透传 + crates 改写链补 license 行；npm/packagist/rubygems 搜索 API 不返回 license，诚实不做逐条二次请求）。
**测试**：241→247（pypi 3 + hfpapers 2 + paper 路由 1，既有 4 腿/6 腿断言同步 5/7 腿）。
**bench 第 14 轮**：L1 9/9、L1+L2 9/9 无回归；hfpapers 学术 2 题出勤。

## 六、phase AJ 探针第 3 批（2026-09-04，用户"继续"；攻 vs-zai 附录 G 诚实剩余「news/security 官方源召回面差距」）

> 证据链脚本：`core/scripts/probe-aj-sources.mjs`（7 候选，原始输出落 /tmp/phase-aj/）。
> 全部候选免 key；security 面按 pypi 纪律评估（元数据直取 API ≠ 搜索端点）。

| 候选 | 探针结果 | 判定 |
|---|---|---|
| **NVD API 2.0**（`cves/2.0?cveId=` 精查） | 200：冷启 7.4s / 暖 1.1s 方差（keyless 滚窗 5req/30s）；题录 desc+CVSS+published 齐 | ✅ 接入（security lane 腿）：CVE 编号直取，无编号合法空零请求；404 合法空 |
| **NVD keywordSearch** | 200（606ms）但整句查询 totalResults=1（词间 AND 语义，自然语言题基本空手） | ❌ 不用（精度差）；只收 cveId 精查通道，诚实不硬凑搜索端点 |
| **OSV.dev**（`GET /v1/vulns/{id}`） | 200（315ms）：summary/aliases/modified 齐，52 refs 含 cisagov 官方库；**注意 POST /v1/query 按 id 是 400，正确用法是 GET** | ✅ 接入（security lane 腿）：无编号合法空；404 合法空 |
| **GitHub Advisory API**（`/advisories?cve_id=`） | 200（470ms）GHSA-jfh8-c2jp-5v3q critical；免 key 60/hr（无 token 基建，垂直腿单发可用） | ✅ 接入（security lane 腿）：空数组=GHSA 未收录=合法空；403 交熔断 rate_limited 档 |
| **CISA KEV feed** | **HTML 挑战页**（DC IP 被 bot 防护拦截，91ms） | ❌ 关账（qwant/gitlab 同案：数据中心 IP 挑战页不可依赖） |
| **Google News RSS**（复验现有 googlenews） | 200（549ms）10 item，但链接全是 news.google.com 不可解码跳转（出版方名在 source 字段） | ✅ 已有 provider——本次接线进 news lane；零 item 从抛错改合法空（AH openverse 教训） |
| **Bing News RSS**（`/news/search?format=RSS`） | 200（351ms）；与 web 版 bingrss 不同端点；**apiclick 跳转内嵌 `url=` 真实出版方链接（可解码）**+News:Source 字段 | ✅ 接入（bingnews provider，news lane 腿）：url= 解码失败保底原链接；零 item 合法空；HTML 挑战页抛错 |

**落地**：注册 39→43（nvd/osv/ghsa/bingnews）；DOMAIN_TABLE 新增 security（nvd+osv+ghsa）/news（googlenews+bingnews）两条 lane，均带 searxng+tavily 聚合兜底腿（images 同款——官方三腿每腿 1 ref 太薄、RSS 腿 niche 查询合法空，无兜底会窄腿塌方）；categories.json security 表 +osv.dev(s)（表只扩不缩）。
**测试**：263→276（nvd×2/osv×2/ghsa×1/extractCveId×1/bingnews×1/googlenews 合法空×1/security+news 路由锁×2/laneLegProviders 锁×1/医疗药名锚 FP 审计入 authority.test×若干）。
**踩坑（工具级）**：`[marginalia` 这类**数组首元素 m 开头**的字面量在会话输出管道里会被当 ANSI 序列吃掉 `[m`（rg/sed/python print/node console.log 全中招，hex 级检查才现形）——编辑含 `[m` 的行必须用 python 直读或避开该字面量取上下文。

## 七、phase AM 探针第 4 批（2026-09-04，用户"继续，我不会给智谱key"；类目级 keyless 官方面补齐）

> 证据链脚本：`core/scripts/probe-am-sources.mjs`（10 候选）+ `probe-am-retry.mjs`（3 项复核），原始输出落 /tmp/phase-am/。
> 主攻方向：类目面（词典/医学研究/数据/教育/财务）在 DOMAIN_TABLE 无 lane、召回全靠 generic 池的缺口——加法扩源路线（AJ 先例）。

| 候选 | 探针结果 | 判定 |
|---|---|---|
| **Wiktionary API**（en+zh 双语 `list=search`） | 双站 200（854ms）：en 词条+zh 词条齐，snippet 带 searchmatch 标签需剥离 | ✅ 接入（dictionary lane 腿）：CJK 查询→zh.wiktionary，其余→en；零命中合法空 |
| **Europe PMC REST** | 200（961ms）hitCount=20016：PMID/DOI/OA 齐 | ✅ 接入（medical lane 腿）：MED/PMC 直链，pubmed(eutils 两步式)互补 |
| **ClinicalTrials.gov API v2** | 200（295ms）：NCT 编号+状态+适应症齐 | ✅ 接入（medical lane 腿）：NCT 直链 clinicaltrials.gov/study/{id} |
| **World Bank API v2** | 200（428ms）：CHN GDP 2023=18.27T 直取成功 | ✅ 接入（data lane 腿）：指标码×国家码小保守映射直取（pypi/CVE 纪律：未知指标合法空零请求）；ref=data.worldbank.org/indicator/{code}?locations={iso} |
| dictionaryapi.dev | 15s 超时 + 复测 9s 超时（2/2） | ❌ 关账（DC IP 不可达/不可靠延迟；词典面 wiktionary 双语已覆盖） |
| SEC EDGAR full-text search | 403 HTML 挑战页（Akamai） | ❌ 关账（CISA/Qwant/gitlab 同案：数据中心 IP 挑战页不可依赖） |
| Google Books API（免 key） | 429 Quota Exceeded（间隔 2.5s 两次） | ❌ 关账（免 key 配额对共享 DC IP 已枯竭；要 key，用户明确不给任何 key） |
| s.jina.ai | 401 AuthenticationRequiredError（2024-11 起强制 key） | ❌ 关账（诚实复核坐实；用户明确不给任何 key） |
| SearXNG 公共实例扩容（现 2 实例） | 6 候选 0 过：searx.be=Anubis 挑战页、baresearch.org=Anubis（"Oh noes!"）、2×429、2×fetch failed | ❌ 关账（"80 实例仅 2 存活"现状加固；自建仍是最稳路径，见 selfhost-searxng.md） |
| MySQL docs search | 403 HTML 挑战页 | ❌ 关账（同 DC IP 挑战案；mysql top5 池外诚实剩余维持——in-pool=#1 已由模拟实证） |

**落地**：注册 43→47（wiktionary/europepmc/clinicaltrials/worldbank）；DOMAIN_TABLE 表尾新增 dictionary（wiktionary）/medical（europepmc+clinicaltrials）/data（worldbank）三条 lane，均带 searxng+tavily 聚合兜底腿（合法空防塌方同款纪律）。
**防劫持设计（诚实审计）**：dictionary 锚不收裸"定义"/"define"（编程查询"接口定义"/"define function"高频劫持成本——编程题由表序先行保护，回归锁入测试）；medical 锚只收研究意图（clinical trial/随机对照/荟萃分析…）——药名/副作用题**不进线**（那是 generic 池+medlineplus 表提权的面，24 题阿司匹林/metformin 题实证；把医学题全劫进 PubMed 面会毁 zh 健康内容广度）；data 锚只收强官方统计意图（world bank/开放数据/统计数据…）。
**表只扩不缩**：categories.json dictionary +wiktionary.org(s)（词典面第一方内容本体，khan 先例）、medical +clinicaltrials.gov(s)（NLM 官方一手注册库）+europepmc.org(a)（EMBL-EBI 官方聚合器，openalex 先例）——+3/0 删。
**medical lane 实弹 E2E**：metformin cardiovascular outcomes randomized → europepmc top1×3 进 top5 + clinicaltrials 出勤 + 聚合兜底补面，1020ms 10 refs（24 题库无研究意图题面，用探针真题验证出勤）。
