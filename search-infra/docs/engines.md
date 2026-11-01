# engines.md — search-core 引擎目录书（v0.8）

> 资产管理口径：每个引擎标「接法 / 是否 key / 默认池 / 封锁特征 / 实测延迟 / 协议风险」。
> 数据来源：2026-09-02/03 一手实测（probe-engines + 10-a 端点矩阵 + e/f/g 报告 + probe-v07）。
> ⚠ 官方文档漂移 ≈ 半年一大变，接入新引擎前重爬官方文档；本文件每月巡检一次。

## 总览（46 个 provider，注册 43：默认池 13 + 显式启用 9（图片/备胎/新闻/firecrawl/时间机器×2/实体/geo）+ 域名路由 19（phase AJ +4: security 三腿/bingnews）+ key 插槽 3 + route 专项 4；另有 3 个目录在案未接）

> v0.6 起有**域名路由层**（src/domains.ts）：planner 按关键词查 DOMAIN_TABLE，命中→领域专线（Tier1 免 key API 直连 + Tier2 `site:` 前缀 + Tier3 通用池兜底），条目进表前必须过 smoke（防幻觉造域名）。
> v0.7 表序规则：**窄关键词主题（packages/devops）排在宽关键词主题（programming）之前**，防 " npm "/"docker" 宽词截胡。

| 引擎 | 接法 | key | 默认池 | 封锁特征 | 实测延迟* | 协议风险 |
|---|---|---|---|---|---|---|
| **searxng** | JSON `GET /search?format=json` | 免 | ✅ | 公共实例 429/Anubis/IP 黑名单三重死法 | 兑底链 mectov **333ms**（2026-09-03 实测 10 条） | **phase AB 多实例回退链**：自建(SC_SEARXNG_BASE_URL)永远链首 → 内置兑底实例(探针存活名单，SC_SEARXNG_INSTANCES 可覆盖)；判定标准是"能 JSON.parse 且有 results"不是 HTTP 码（伪 200 挑战页教训）；全灭才抛错交熔断 |
| **duckduckgo** | html 端点 POST + cheerio | 免 | ✅ | **202 空页=软封会自愈**（触发=突发高频+脏 IP）；datacenter 代理反而更糟 | 数百 ms | 限速门 3s+退避已内置；流量 2026-05 涨 30% 是生存压力 |
| **mojeek** | HTML GET + cheerio | 免 | ✅ | 宽松，基本不封 | - | 本沙箱环境 TCP 不可达（线下复测）；官方 API 是否值得换待人工核实 |
| **yahoo** | HTML GET + cheerio | 免 | ✅ | 中等 | - | markup 漂移风险（golden 样本守门） |
| **marginalia** | api2 JSON，header `API-Key: public` | 免（`SC_MARGINALIA_KEY` 免费邮件键覆盖） | ✅ | public 键**全网共享限额**打满 503（创始人口径 IIRC ~15 q/min 仅供参考，官方不公布） | api2 1428ms | 旧端点 api.marginalia.nu 慢性死亡（保留 fallback）；**CC-BY-NC-SA 限商用**；dc=3 源头每域上限与 domainCap 对齐；口径全案 analysis/search-landscape/marginalia-api-terms.md |
| **hn** | Algolia JSON | 免 | ✅ | 宽松 | 数百 ms | hitsPerPage 硬截 1000 |
| **wikipedia** | REST v1 `/{lang}/w/rest.php/v1/search/page` | 免 | ✅ | **UA 政策硬门槛**（空/泛/伪装 UA 一律 403） | 675ms | 规范 UA 后 h1.1/h2 全通；勿改回浏览器伪装 UA |
| **bingrss** | `bing.com/search?format=rss` | 免 | ✅ | 零封锁通道 | 数百 ms | 每查询仅 4-10 条（量少但稳） |
| **bingnews** | RSS `bing.com/news/search?format=RSS`（与 web 版 bingrss 不同端点） | 免 | 域名路由(news) | 宽松（探针 351ms） | **351ms**（探针 200，4-10 item） | phase AJ：apiclick 跳转内嵌 `url=` 真实出版方链接**可解码**（googlenews 的跳转不可解码——两腿互补）；kind=news；零 item 合法空（AH openverse 教训）；HTML 挑战页抛错 |
| **arxiv** | Atom XML `export.arxiv.org/api/query` | 免 | ✅ | **1 req/3s**（共享 IP 撞 429） | 37ms | 429 退避已内置；cheerio xmlMode |
| **crossref** | JSON `api.crossref.org/works?mailto=` | 免 | ✅ | rows≤1000，深翻页 cursor | 724ms | mailto 进 polite pool；被引数=权威性硬信号 |
| **openverse** | JSON `api.openverse.org/v1/images/` | 免 | 显式（图片） | **20 次/分+200 次/天**（响应头实抄） | ~1s | page_size≤20；governor 限速 1req/4s |
| **mwmbl** | JSON，**参数是 `s` 不是 `q`** | 免 | 显式（备胎） | 宽松 | 1686ms | nginx gzip 流不规范（Node zlib 报错）→ 已强制 identity |
| **googlenews** | RSS `news.google.com/rss/search` | 免 | **默认关** | 100 条封顶 | 445ms | **版权条款限个人非商业渲染**；when:1d/site: 运算符有效 |
| **wiby** | JSON `wiby.me/json/?q=` | 免 | ✅（phase X 默认池第 11） | 宽松（2026-09-03 探针 200） | ~1s | 冷门/古典独立站第二腿（第一腿 marginalia）；Description 真摘要优先/Snippet 导航噪声兜底；Title/Description 带 HTML 转义需解码；纯英文独立网，中文查询贡献≈0 |
| **keenable** | POST JSON `api.keenable.ai/v1/search(/public)` | 免（公共路；`SC_KEENABLE_KEY` 升 10 万 credit/月） | ✅（phase Y 默认池第 12） | 公共路 1000 次/时/IP 共享，10 req/s | **433ms**（2026-09-03 实测） | 独立索引通用搜索（用户提案 keenable.ai）；公共路必带 `X-Keenable-Title`（缺→400）；description 常空→snippet 优先；freshness→published_after(1d/7d/30d/365d)；**不设 keySlot**（本在池内，有 key 是 provider 内部切正式端点；keySlot+免 key isConfigured 会被 auto 强注入空池——引擎测试跑真网络的实测教训） |
| **mdn** | JSON `GET developer.mozilla.org/api/v1/search?q=&locale=` | 免 | 域名路由（phase AA 编程 Tier1） | 无已知限额；礼貌调用 | **~800ms**（2026-09-03 实测 200） | MDN 官方文档面（对照轮增量）：locale 跟随查询语言（zh→zh-CN 中文内容实测 10 条）；**documents=[] 合法空**（python 等非 web 编程题必空，抛错会误伤熔断），仅缺 documents 字段（API 形状漂移）才抛错；summary 即摘要无清洗压力 |
| **anysearch** | POST JSON `api.anysearch.com/v1/search`（无 Authorization） | 免 | ✅（phase AB 默认池第 13） | 匿名额度官方未公开（连打 6 发全 200 未触限） | **1.4-1.9s**（2026-09-03 实测） | 托管聚合免 key 车道（用户清单★+探针证实）：`{code:0,data:{results:[{title,url,snippet,content}]}}` 形状干净，asyncio 题 docs.python.org/realpython 顶位；code!=0 抛错交熔断；长期强度靠熔断兑 |
| **firecrawl** | POST JSON `api.firecrawl.dev/v2/search`（无 Authorization） | 免（`FIRECRAWL_API_KEY` 升级付费车道） | 显式 engines/research | 连打 4 发全 200 未触限 | **0.8-1.3s**（2026-09-03 实测） | keyless 聚合（用户清单★+探针证实）：`data.web[]` 映射；**description 是抓取页 markdown（YouTube 页噪音数千字符）clamp 兑底**；不进默认池待 bench 观察升池 |
| **pubmed** | eutils 两步式 `esearch(拿 PMID)→esummary(拿题录)` | 免（tool+email 礼貌池） | 域名路由（phase AB academic 腿） | 宽松；3 req/s 无 email 上限建议 | **632ms**（2026-09-03 实测 200） | 生物医学文献垂直（用户清单）：补 arXiv/crossref 的医学盲区；空 idlist 抛错；url 拼 pubmed.ncbi.nlm.nih.gov/{pmid}/ |
| **hfpapers** | JSON `huggingface.co/api/papers/search?q=` | 免 | 域名路由（phase AG-1 academic 腿） | 宽松 | **879ms**（2026-09-04 探针 200，arr=120） | HF Papers AI 论文面：嵌套 paper 形状（id=arXiv 号/title/summary 全文/publishedAt）；url 拼 huggingface.co/papers/{arXiv号}；空结果抛错 |
| **sov2ex** | JSON `GET sov2ex.com/api/search?q=&size=` | 免 | 域名路由（编程主题**仅中文题**，zhBoost lang-guard） | 宽松（探针 200 total=51399） | **~1s**（2026-09-03 实测） | V2EX 社区搜索（中文面增量）：中文技术讨论质量高；英文题不打（纯噪音）—— domains.ts zhBoostProviders 按 CJK 判；url 拼 v2ex.com/t/{id} |
| **tavily** ⚡ | POST JSON，`Authorization: Bearer`；**baseUrl 可指兼容网关（Hikari：`SC_TAVILY_BASE_URL=https://tavily.ivanli.cc/api/tavily`，全案 docs/tavily-hikari.md）** | ✅ | 插槽自动并联（phase AB 起无 key 也并入——keyless 车道） | **429=限速 / 432=套餐超限 / 433=PAYG 超限**（三档分明可写状态机）；网关无凭据探针 401 missing/invalid token 语义清晰（2026-09-03） | keyless 匿名车道 1.3-4s（2026-09-03 实测连打 6 发全 200） | 1000 credit/月免卡；锁死 search_depth:basic 防 auto_parameters 偷升扣双倍；**phase AB keyless 车道**：无 key 且无 baseUrl 时发 `X-Tavily-Access-Mode: keyless` 走官方匿名（用户清单★+探针证实，isConfigured 恒 true）；429 由熔断 rate_limited 档兑 |
| **wayback** | CDX JSON `web.archive.org/cdx/search/cdx?url=` | 免 | 显式（时间机器） | 本沙箱 web.archive.org **TCP 不可达**（与 DDG/Mojeek 同款，线下复测） | 线下实测（CDX P95 常 >6s，调用方放宽 `SC_SOFT_DEADLINE_MS`） | query=URL/域名，传关键词抛教学错；collapse=timestamp:6 按月去重；空库=诚实 [] 不污染熔断 |
| **wikirev** | REST v1 `/{lang}/w/rest.php/v1/page/{title}/history` | 免 | 显式（时间机器） | UA 政策同 wikipedia | **838ms/661ms**（2026-09-03 实测） | oldid 永久直链；user 是 `{id,name}` 对象（已适配）；接受裸词条名或完整 wiki URL |
| **stackexchange** | JSON `GET /2.3/search/advanced?site=stackoverflow` | 免（300/天/IP；`SC_STACKEXCHANGE_KEY` 免费注册后 10000/天） | 显式/域名路由 | 并发 30 req/s；502=throttled | **344ms**（2026-09-03 实测） | title 是 HTML 转义文本需解码；响应自带 quota_remaining 自报额度；is_answered/score=结构化权威信号 |
| **npm** | JSON `registry.npmjs.org/-/v1/search` | 免 | 显式/域名路由 | 宽松 | **502ms**（2026-09-03 实测） | score 细分 popularity/quality/maintenance；links 缺失兜底拼 npmjs.com URL |
| **crates** | JSON `crates.io/api/v1/crates` | 免 | 显式/域名路由(packages) | 必须带 UA（否则 403） | **561ms**（2026-09-03 probe-v07） | 下载量/版本/kw 元数据齐；PyPI 搜索端点已死——元数据面由 pypi 行接替 |
| **pypi** | JSON `pypi.org/pypi/{name}/json`（按包名直取，非搜索） | 免 | 显式/域名路由(packages) | 宽松（探针 161ms） | **161ms**（2026-09-04 探针 200） | phase AG-1：非合法包名（含空格）合法空零请求；404 包不存在=合法空；**ref.license 透传（AG-4）**：info.license+version+upload_time 元数据齐；搜索端点仍死，关键词搜包走 npm/crates 腿 |
| **nvd** | JSON `services.nvd.nist.gov/rest/json/cves/2.0?cveId=`（CVE 编号精查，非搜索） | 免（滚窗 5req/30s） | 域名路由(security) | 暖 1.1s / 冷启 7.4s 方差（2026-09-04 探针） | **1.1s**（探针二采） | phase AJ：keywordSearch 整句 totalResults=1 精度差**不用**；无编号合法空零请求；404 合法空；ref=nvd.nist.gov/vuln/detail/{id} + CVSS 透传 |
| **osv** | JSON `GET api.osv.dev/v1/vulns/{id}`（**POST /v1/query 按 id 是 400，用 GET**） | 免 | 域名路由(security) | 宽松 | **315ms**（探针 200，52 refs 含 cisagov 官方库） | phase AJ：无编号合法空；404 合法空；ref=osv.dev/vulnerability/{id}，aliases(GHSA) 进 snippet；categories.json security +osv.dev(s) |
| **ghsa** | JSON `api.github.com/advisories?cve_id=` | 免（**60/hr 无 token**，垂直单发可用；403 交熔断 rate_limited） | 域名路由(security) | 宽松 | **470ms**（探针 200 critical） | phase AJ：空数组=GHSA 未收录=合法空（部分 CUDA/闭源 CVE）；ref=github.com/advisories/{ghsa_id}；CISA KEV feed 同批探针 HTML 挑战页❌关账 |
| **packagist** | JSON `packagist.org/search.json` | 免 | 显式/域名路由(packages) | 宽松 | **398ms**（probe-v07） | url 缺失兜底拼 packagist.org/packages/{name}；favers=star 数 |
| **rubygems** | JSON `rubygems.org/api/v1/search.json` | 免 | 显式/域名路由(packages) | 宽松 | **317ms**（probe-v07） | 无 per_page 参数本地切片；info=长描述 |
| **huggingface** | JSON `huggingface.co/api/models?search=` | 免 | 显式/域名路由(ai-models) | 宽松 | **248ms**（probe-v07） | 默认 sort=downloads；pipeline_tag/tags 元数据；仅模型搜索(数据集另端点未接) |
| **dockerhub** | JSON `hub.docker.com/v2/search/repositories/` | 免 | 显式/域名路由(devops) | 宽松 | **336ms**（probe-v07） | official 镜像 URL 走 `/_/name`、用户镜像 `/r/{owner}/{name}`、无主兑底 library |
| **openalex** | JSON `api.openalex.org/works?search=&mailto=` | 免 | 显式/域名路由(academic) | 宽松（mailto 进 polite pool） | **1176ms**（probe-v07） | 2.5 亿 works；被引数+OA 链接+venue；URL 阶梯 landing_page→oa_url→doi；补 crossref 的 OA 盲区 |
| **dblp** | JSON `dblp.org/search/publ/api?format=json` | 免 | 显式/域名路由(academic) | 宽松 | **1106ms**（probe-v07） | authors.author 可能是单对象/数组/缺失(已归一化)；ee(电子版)优先于 dblp 页；补 crossref 的 CS 会议盲区 |
| **wikidata** | JSON `wikidata.org/w/api.php?action=wbsearchentities` | 免 | 显式/域名路由(entities) | 宽松（UA 规范即可） | **604ms**（probe-v07） | 实体背景/消歧(Q-id 永久 URI)；language 跟 ctx.opts.lang；表尾最低优先防误伤 |
| **brave** ⚡ | GET + `X-Subscription-Token` | ✅ | 插槽自动并联 | 429（50 QPS） | - | 旧"免费 2000/月"已死改 $5 credit；独立 30B 页索引 |
| **exa** ⚡ | POST JSON + `x-api-key` | ✅ | 插槽自动并联 | 429（5 QPS） | - | type:neural/keyword 已废弃，用 auto；$10/月 credit≈1400 次 |
| **mcp:<name>** 🔌 | MCP stdio（spawn 子进程）或 streamable HTTP | 视连接器（key 在连接器自身的 env 里） | 插槽自动并联（配了才注册） | 子进程/网络错误按 6 类归熔断 | -（离线夹具全链路测试，真连需用户自己的 MCP server） | v0.8 外部 MCP 搜索连接器（gpt-researcher RETRIEVER=mcp 思想无 LLM 版）：`SC_MCP_CONNECTORS` JSON 数组配置，tool 名显式优先/启发式选（/search\|query\|web\|find/ 权重+平手取短名），结果三形状归一化（results 数组/直接数组/MCP content 信封），空结果抛错；一次接入吃遍 Tavily/Exa/博查等现成 MCP server |
| **github** | REST search/repositories | 免 | route=github 专项 | **10 req/min**（认证 30） | 数百 ms | 只在 planner 路由到 github 时出场 |
| ~~google~~ | - | - | ❌ 永不进池 | 裸 HTTP=91KB JS 空壳假货（HTTP 200 最阴险）；TLS 伪装救不了 | - | 2026 共识已死；唯一可靠面=googlenews RSS |
| ~~serper~~ | POST + X-API-KEY | ✅ | 未接 | 429 | - | 2500 次一次性（6 个月有效）；多号轮换炮灰，需要时再接 |
| ~~you.com~~ | - | ✅ | 未接 | - | - | 注册送 $100（$5/1k，2026-03 降价）；观察位 |

\* 延迟为 2026-09-02/03 probe-engines 实测（本沙箱网络），仅作量级参考。

## 熔断 2.0 分类速查（v0.4）

| 失败分类 | 典型信号 | 连败阈值 | 冷却 | retryable |
|---|---|---|---|---|
| rate_limited | 429 / DDG 202 软封 / "reduce rate" | 4 | 2 分钟 | ✅ 晚点再试 |
| blocked | 403 / 挑战页 / 验证码 / Anubis | 2 | 15 分钟 | ❌ 别硬碰 |
| quota | 432 / 433 / 402 | 1 | 30 分钟（月度由 QuotaTracker 判死） | ❌ 等下月/充值 |
| auth | 401 / invalid api key | 1 | 60 分钟 | ❌ 先修 key |
| timeout | abort / ETIMEDOUT / 软截止代报 | 6 | 5 分钟 | ✅ |
| error | 5xx / 解析错 / DNS | 6 | 10 分钟（半开探针再栽翻倍，上限 1h） | ✅ |

## key 插槽额度（QuotaTracker，v0.4 + phase AC 可见性）


- 本地月度计数（YYYY-MM key 自动滚动重置）：Tavily 1000 / Brave 1000 / Exa 1400（默认，env 可覆盖）。
- 成功 1 次记 1 credit；**432/433 一票判死**（当月不再试，官方语义明确）。
- 额度尽 → `allow()=false` → 插槽不进并行池 → **免 key 池天然接管（回落零代码）**。
- `SC_KEY_SLOTS=off` 可整体关闭自动并联（只用显式 engines 点名）。

## fetch 落地页改写链（phase AD，fetcher.ts）

- crates.io 裸 crate 页 → 官方 API `/api/v1/crates/{name}` 直取（SPA 空文本老挂账修复）
- doi 落地 403 / SPA 假 200 空文本 → OA 直链双通道：OpenAlex（匿名池可能当日 429，mailto 进 polite pool 也可能不够）→ Unpaywall（email 必填，须配 contactEmail）；自环守卫防 OA 落地=原链死循环；全失败诚实抱原始错

## 专线腿治理（phase AE，domains.ts laneLegProviders + mdn 亲和守卫）

- programming 专线 leg-0 补 searxng+tavily keyless 聚合兜底腿：专线窄腿静默时不再整题塌方（vs-zai 第 7 采样 k8s 题 MISS 根因，修复后第 8 采样同题翻绿）；registry 专线（packages/devops）保持纯 API 腿不变（cap=0 域名纯度是特性）
- mdn web 亲和守卫：查询无 web token（css/html/javascript/前端/fetch…，短词 js/ts/web/dom 用词边界）→ 合法空零请求；治 MDN 模糊匹配把 "best practices" 泛教程页塞给 kubernetes 题、asyncio 题混入无关 zh 教程页（s 档域级提权抬错页的 junk 源头）；async/await 故意不收（asyncio 子串误配）

## 页面级相关性守卫 + kind 补密度（phase AF，fusion.ts + authority.ts）

- **页面级守卫 keyTermPresent**（AE 挂账闭环）：s 档是域级提权，域名对≠页面对（asyncio 题 MDN zh 教程页×3 进 top5）——融合期对每个权威命中条查"title/snippet/url 是否含查询关键 token"，没有则**提权清零**（只压分不剔除，页面仍靠 RRF/词法竞争），ref 带 `authorityGuarded` 标注、meta/journal 透出计数。关键 token 选取：有 ASCII 词取最长做技术词锚（"npm 使用教程"锚 npm 不锚中文长 run），纯 zh 取最长 run（子串可命中派生词）；判定用子串 fail-open（js→json 误报方向=保留提权，安全侧）。实证：asyncio 题 top5 换血官方面，bench r12 / zh 面零回归。
- **kind 补密度 classifySourceKind**（vs-zai 第 7 采样 kind 桶 0.1 无判别力闭环）：条目显式 kind > 域名模式（github/reddit/zhihu→community，forbes/jiemian→media，wikipedia/britannica→reference）> 表缺省（s 档官方域=official、news 表=media、dictionary/entities=reference）。任何 URL 可分类，vs-zai 两侧同尺（第 9 采样 kind 桶 core 2.0 vs 1.5）；ref.sourceKind 标注。**纪律：纯元数据不改排序**——社区意图翻转仍只认显式 kind=community（github 不因此升档，测试锁在 authority.test）。

## 三层权威体系（phase AC，authority.ts + SC_AUTHORITY_JSON 外挂）

| 层 | 表 | 生效条件 | 内容 |
|----|----|---------|------|
| 0 全局 | AUTHORITY_DOMAINS（16 域） | 一切查询 | 学术+wiki，通用结果兜底 0.4/0.75 |
| 1 主题 | TOPIC_AUTHORITY（7 主题） | 域路由命中 topic | 编程/包/运维/学术/AI/实体，S=1.2/A=0.75/B=0.4 分档 |
| 2 意图 | CATEGORY_AUTHORITY（10 类） | detectCategory 命中 | 新闻/安全/法律/金融/医疗/数据库/设计/词典/教育/数据 |

规则：三层取最强计一次分（非叠加）；zh 条目仅中文题生效（lang 守卫）；讨论意图（"怎么看/讨论/experience"）时 kind=community 条目升 s 档；混源主题 domainCap=3 防 s 档同域霸屏（registry 专线保 0）。数据来源=用户 v3 总白名单+智谱来源逆向 14 题采样（/tmp 只留结论，见 vs-zai 附录）。

## 历史教训（勿重蹈）

1. **单引擎路线活不过维护断档**（whoogle 11.6k★ 官宣停更）→ 任何单源不得硬依赖，小众源熔断阈值更低。
2. **独立引擎死亡率高**：alexandria.org DNS 已死、stract.com 域名易主（2026-09 实测）。
3. **公共 SearXNG 不可依赖**（19 实例 0 个给 JSON）→ searxng 条目假设自托管。
4. **UA 伪装已死**：Wikimedia 按 UA 政策 403；TLS 指纹（JA4 时代）先于 HTTP 头被读 → v0.3 用"绕"，v0.4 备胎 impers（feature-flag），**永不上 Playwright**。
5. **web.archive.org 本沙箱 TCP 不可达**（2026-09-03 curl/node 双确认连接超时；wikirev 同族正常）→ 时间机器类引擎线下复测，wayback 不能当唯一取证通道。
6. **Bing API 2025-08 退役无复活**；Google CSE 官方实锤关停（存量 2027-01-01 全退役）→ 别接别等。
## 权威表外置（phase AG-3）

> 三层权威表+垃圾源两档表不再硬编码：`core/data/authority/{global,topics,categories,credibility}.json` 为单一真源（政策注释住 `_meta` 字段），`authority.ts`/`credibility.ts` 只留类型+逻辑+检测关键词。
> loader 逐条校验（域名形状/档位白名单，坏条目跳过+告警，与 SC_AUTHORITY_JSON 同纪律）；整文件不可读→空表+loud warn（测试守门）。
> 维护：改 JSON → `npm test`（250 测试含"JSON⊆内存逐条一致"守门）→ 提交；运行时临时覆盖仍走 `SC_AUTHORITY_JSON`（最外层）。`authority-dump.mjs` 可从内存表重新导出（round-trip 不变量）。


## 零结果抢救腿 + 车道出勤纪律（phase AH，2026-09-04）

> vs-zai 第 11 采样（全量 24 题）抓出三个 bench 9 题照不出的结构性问题，同批修复：
> ① **零结果抢救腿**（engine.ts）：全腿空手（熔断冷却/全失败/单腿合法空）时用健康聚合器 [searxng,tavily,keenable] 再试一轮——已出勤引擎不重试、软截止 min(原值,3s)、尊重用户 engines 配置（排除即不注入，engines=[] 抢救自动失效）；meta.rescued 透出+journal 落 zero_ref_rescue。实测 github 专项窄腿全灭 1ms 零结果 → 10 refs。
> ② **openverse 合法空**：空命中返回 [] 不 throw（与 pypi 非包名 404 同纪律），单腿车道不再被空结果计熔断败；形状漂移仍 throw。
> ③ **images 车道补聚合兜底腿**（laneLegProviders）：openverse+searxng+tavily 三腿——非 registry 专线无纯度包袱（AE 纯度教训只保护 packages/devops）。
> ④ **arxiv/crossref 移出默认池**（config.ts）：学术源只在 academic 专线出勤（关键词路由），终结 vs 对比题 multi 子查询 arxiv 乱入 6+ 题（design top5×3/helm×3…）；wikipedia 留池（fact 型出勤保障）。默认池 13→11 引擎，enginesAvg 4.8→2.8。
> 测试 250→255（rescue×3/openverse 合法空/images lane×1）；bench r17 L1 9/9+L1+L2 9/9 零回归。踩坑留档：ddg 全局限速门跨测试泄漏（进程级 lastDdgAt）→ 测试注入 SC_DDG_MIN_INTERVAL_MS=0。

## phase AI：类目正主前排 + 检测召回补齐 + 守卫多证据放行（2026-09-04，用户"继续优化但是确保广度不要被砍"）

> 附录 F 诚实短板（s 档进 top5 12 vs 17）的正面进攻。诊断工具 `core/scripts/ai-top5-diagnose.mjs`（入仓可复跑）逐 URL 拆解分数构成，抓出四个叠加根因，全部质量层修复，召回面零改动，**权威表只扩不缩（+11 条/1 升档/0 删除）**：
>
> ① **detectCategory 消歧+召回（authority.ts）**：最长关键词胜出替代表序首中（"open data">"gdp" 不再被 finance 抢跑）；保守补无歧义锚 16 个（interest rate/collation/mysql/postgres/mongodb/redis/sqlite/sql/规定/条例/个人信息保护/side effect/medication/肠溶/缓释/design token/figma/wireframe/mockup/academy/sql 注入/xss/central bank/rate decision）——**修前 10 类目题 6 个运行时 null（类目权威层生产路径系统性失活），修后 10/11 命中 + 13 条误伤审计全过**（"of course"/"依赖注入"陷阱实测避开）。
> ② **CATEGORY_S_FRONTROW=2.0（fusion.ts）**：URL 命中【查询所命中类目】表的 s 档 → 提权 1.2→2.0（量化校准：mysql 差 +0.9/fed 差 +0.3，+0.8 双翻正有余量）。三重保护：只动命中类目表 s 档（主题/全局/a/b 不动）+ AF 守卫照常 + domainCap 照常。
> ③ **守卫多证据放行（fusion.ts keyTermPresent）**：长锚缺席但命中 ≥2 个其他查询 token → 放行提权（log4j 题 rapid7 含 log4j+cve+44228 缺 "mitigation" 不再被清零；个人信息保护法题 cac.gov.cn 专页同理）。AF 回归锁全过：MDN asyncio 错页零命中仍 false，单证据不放行。
> ④ **categories.json 扩充**：news +europa.eu(s)/artificialintelligenceact.eu(a)；security +rapid7/crowdstrike/fortinet/paloaltonetworks(a)+sysdig/lunasec.io(b 第一方)；medical +medlineplus.gov/mayoclinic.org(a)；education khanacademy a→s（第一方正主，同 crates.io 纪律）。
>
> **第 13 采样（24 题同尺）**：L1 **24/24 双满分**；s 进 top5 **20 vs 20 追平**（12 vs 17 落后→追平）；s 档 27 vs 25 反超；权威命中 68 vs 46（1.48×）；csdn 0 vs 2；延迟 699ms vs 1389ms（2×）；独占源 +5.9 vs +5.3、uniqDom 7.7 vs 7.1、Jaccard 0.15——**广度指标全部不降**。education 面 r12"双方都差"→ r13 我方明显胜（khan s=7/top5s=5 vs 3）。诚实剩余：news/security 官方源召回面差距（cisa/nvd/europa.eu 不被 keyless 池返回，融合层只能排池内）。
> 测试 255→263（fusion3.test.ts ×7 + detectCategory 锁 ×1）；bench r18 L1 9/9 + L1+L2 9/9 零回归（1017ms）。踩坑：分数拆解断言要逐项扣除 RRF/lex/titleBonus——漏项断言与"排名碰运气"断言都会在精确同分时翻车。

## phase AJ：security/news 专线 + CVE 元数据三腿（2026-09-04，攻附录 G 诚实剩余「官方源召回面差距」）

> 召回面架构指令（planner/router 逻辑冻结）下的**加法路径**：扩源=加引擎（AG-1 pypi 先例），质量面融合层不动。探针全案见 docs/keyless-increments.md 第六节（7 候选 5 过：NVD/OSV-GET/GHSA/GoogleNews 复验/BingNews 过，CISA KEV HTML 挑战页❌，NVD keywordSearch 精度差❌）。
>
> ① **CVE 元数据三腿（nvd/osv/ghsa，registries.ts）**：pypi 同纪律——**按编号直取的元数据 API，不是搜索**：查询含 CVE-\d{4}-\d{4,7} 才发请求（extractCveId 正则），无编号合法空零请求；404/空数组=编号不存在/GHSA 未收录=合法空；只 HTTP 非 2xx/形状漂移抛错交熔断。ref 全是可构造的官方详情页（nvd.nist.gov/vuln/detail/{id} / osv.dev/vulnerability/{id} / github.com/advisories/{ghsa_id}）。
> ② **security lane（DOMAIN_TABLE 表尾追加）**：apiProviders=[nvd,osv,ghsa] + searxng/tavily 聚合兜底腿（官方三腿每腿 1 ref 太薄，无兜底=窄腿塌方，images 同款教训）。锚保守集：cve-/cve /漏洞/exploit/rce/0-day/0day/vulnerability/安全公告/security advisory/ransomware/勒索/攻击样本。
> ③ **news lane（表尾追加）**：apiProviders=[googlenews,bingnews] + 聚合兜底腿。锚只收强新闻意图（" news " 双空格独立词防 newsletter 误配——" npm " 同款纪律；**"最新进展"故意不收**——AI/学术查询常用语会劫持非新闻题）。googlenews 零 item 从抛错改合法空（AH openverse 教训，news lane 接线前提）；bingnews apiclick 内嵌 url= 真实出版方链接可解码（googlenews 跳转不可解码，两腿互补）。
> ④ **detectCategory 医疗锚补充（诚实剩余「zh 药名长尾」）**：+疫苗/抗生素/降压药/胰岛素/阿司匹林/布洛芬/二甲双胍/过敏/vaccine/aspirin/ibuprofen/metformin/insulin（只收全名不收缩写；跨类冲突靠 AI 最长胜出消歧——"疫苗 数据库设计"仍归 databases）。categories.json security +osv.dev(s)（表只扩不缩）。
>
> **bench r19**：L1 9/9 + L1+L2 9/9 零回归（enginesAvg 2.9）。**第 14 采样（24 题同尺）**：L1 **24/24 vs 23/24 连续双满分**；s 档 **31 vs 24**；**s 进 top5 22 vs 19（r13 追平 → 首次反超）**；权威命中 69 vs 47（1.47×）；csdn 0 vs 2；延迟 912ms vs 1378ms（1.5×）。**news 题 europa.eu 进 top1 / security 题 osv.dev 进 top1——附录 G 召回差距正面兑现**（官方源从"池里没有"变"池内有腿直取"）。广度红线复核：uniqDom 7.4 vs 7.2、独占源 +5.6 vs +5.5、Jaccard 0.15 不变——持平守住（表 +1 条、默认池 11 引擎不动、lane 加法只增不删）。诚实剩余：security 题 top2-5 兜底腿收割到 yahoo 泛页面（top1 正主在但深度波动）；mysql 题 dev.mysql 仍在池外（既有留档）。
> 测试 263→**276**（nvd×2/osv×2/ghsa×1/extractCveId×1/bingnews×1/googlenews 合法空×1/路由锁×2/laneLegProviders×1/医疗锚+FP×若干）。踩坑（工具级）：会话输出管道会把 `[m`（数组首元素 m 开头的字面量）当 ANSI 序列吃掉——rg/sed/python print/node console.log 全中招，hex 级检查才现形；**写层无损、读层有损**，编辑此类行用 python 直读。

## phase AK：domainCap 注册域粒度修复（2026-09-04，第 14 采样 yahoo 集群实证）

> domainCap 原按 hostname 计数——sports/baseball/weather.yahoo.co.jp 三子域各领配额，yahoo.co.jp 集群×4 绕过 cap=3（security 题 top2-5 全是它）。AC 治理意图是"单源霸屏"，子域集群=同一来源。修复：`fusion.ts registrableDomain()`（近似 eTLD+1，两级 TLD 白名单 30 项），cap 改按注册域计数。诚实边界：github.io/blogspot.com 跨用户子域共享 cap=3（自由托管平台 junk 集群常见，收紧方向正确）。测试 278；bench r20 L1/L2 9/9 零回归；第 15 采样 yahoo 集群消失、osv.dev top1 保持。

## phase AL：data 类目表 +5 官方统计机构（2026-09-04，表缺口修补）

> r15 诚实观察（data 题 top5 泛面、worldbank 官方页在 top10 非 top5）根因=data 表缺 worldbank.org——CATEGORY_S_FRONTROW 无从生效。修复：categories.json data +worldbank.org/imf.org/oecd.org/census.gov(s) +stats.gov.cn(s, lang:zh)——+5/0 删，第一批国际官方统计机构全入表（第一方正主原则，非为单题刷表）。第 16 采样 world bank 题 datahelpdesk.worldbank.org top1（frontrow 生效）；L1 24/24 双满分（阿司匹林题回 HIT 坐实 r15 波动）；权威 71 vs 58。诚实记录：本轮 zai 池强（s 34 vs 29、top5s 26 vs 22 对方反超）——keyless 池轮间波动双向存在，结论只谈方向。

## phase AM：词典/医学研究/数据 类目官方面（2026-09-04，探针第 4 批，用户"继续，我不会给智谱key"）

> 类目面（词典/医学/数据等）在 DOMAIN_TABLE 无 lane、召回全靠 generic 池——AJ 加法扩源路线续批。探针 10 候选 4 过（wiktionary en+zh / europepmc / clinicaltrials / worldbank），6 诚实关账（dictionaryapi 2×超时、SEC EDGAR 403 挑战页、gbooks 免 key 429 配额枯竭、s.jina.ai 401 强制 key、searxng 扩实例 0/6 全 Anubis 挑战页、mysql docs 403）。注册 43→**47**。
> 三条新 lane（DOMAIN_TABLE 表尾，零劫持既有 lane）：dictionary=wiktionary（CJK→zh 站点，零命中合法空）/ medical=europepmc+clinicaltrials（研究意图腿）/ data=worldbank（指标码×国家码小映射直取，未知指标合法空零请求），均带 searxng+tavily 聚合兜底腿（合法空防塌方同款纪律）。
> 防劫持保守审计：dictionary 锚不收裸"定义"/"define"（编程查询表序先行保护，回归锁）；medical 锚只收研究意图（clinical trial/随机对照/荟萃分析…），药名/副作用题不进线——药名题归 generic 池+medlineplus 表提权（把医学题全劫进 PubMed 面会毁 zh 健康内容广度，24 题阿司匹林/metformin 题实证）；data 锚只收强官方统计意图。表只扩不缩：dictionary +wiktionary.org(s)、medical +clinicaltrials.gov(s)+europepmc.org(a)（+3/0 删）。
> **测试 278→292**（四 provider golden×10：wiktionary 双语路由/HTML 剥离/合法空、europepmc MED 直链+兜底 URL、clinicaltrials NCT 直链+缺 NCT 合法空、worldbank 指标映射+CN/WLD+零请求锁；lane 路由锁×6：三 lane 命中+编程题防劫持+药名题不进线+laneLegProviders 三主题）。bench r22 L1 9/9+L1+L2 9/9 零回归（enginesAvg 3.4）。
> **第 17 采样（24 题同尺）**：L1 23/24 vs 24/24；s 32 vs 34、s+a+b 52 vs 51、authorityAny 223 vs 193（1.16×）——本轮 zai 池强（诚实记录，方向性结论）；延迟 871 vs 1500ms（1.7×）保持；广度四指标持平：uniqDom 7.2 vs 7.0、独占源 +5.5 vs +5.3、kind 1.6 vs 1.7、Jaccard 0.15 不变。逐面：**dictionary 题 en.wiktionary.org top1（×3 进 top5，新 lane 首轮兑现）**、data 题 data.worldbank.org top1（lane+AL frontrow 链路）、medical lane 24 题外实弹（europepmc top1×3+clinicaltrials 出勤，1020ms）。**诚实留档**：images 题（unsplash pexels api comparison）miss——openverse 对该题面合法空（AH 已留档根因）+公共 searxng 实例垃圾轮换，三次复现三套不同垃圾（法院站/YouTube 支持/nperf）坐实**波动性失败非确定性回归**（AM 未触碰 images 面），r12-r16 HIT 窗口=openverse 返窗期，同 r15 阿司匹林题先例。

## phase AN：images 车道第 4 兜底腿 + images 主题表 +3（2026-09-04，r17 images 题波动 miss 修补）

> 第 17 采样 images 题（unsplash pexels api comparison）miss 双根因：openverse 对 "api comparison" 题面合法空（AH 已留档）+ 兜底双腿同时掉链（tavily rate_limited、公共 searxng 实例垃圾轮换三套三样）。两条加法修补（AE/AJ 加腿先例 + AI 表缺口先例，零召回面改动）：
> ① laneLegProviders images 兜底腿 +keenable（第 4 腿）：免 key 独立索引，对该题实弹验证返回 unsplash.com/developers 官方面 + g2 对比页——兜底腿多条独立索引后单实例垃圾轮换不再整题塌方；
> ② topics.json images 表从空占位补 3 条第一方图库平台：unsplash.com(s)/pexels.com(s)/pixabay.com(s)（表只扩不缩，第一方正主原则）——官方页获 topic s 提权爬进前排。
> **实效**：images 题 top1=unsplash.com/developers、top2=pexels.com/api（官方正主双进前排）；vs-zai 单题正式采样行 core=HIT / zai=HIT（465ms）；结果面从法院站垃圾换血为高相关 API 对比内容。测试 292 全绿（images 兜底腿锁同步 4 腿）；bench r23 L1 9/9+L1+L2 9/9 零回归。
> **第 18 采样（24 题全量同尺）**：L1 **24/24 vs 24/24 双满分**（images 题翻绿在全量坐实）；延迟 772 vs 1847ms（2.4×）；uniqDom 7.2 vs 7.2、独占源 5.3 vs 5.4、Jaccard 0.16——广度持平；s 32 vs 36（zai 池强窗口，方向性结论）。
> **挂账裁决「GitHub 仓库级二次判断」→ 诚实关账不做**：① 24 题全量 18 轮无一案例暴露 github 排名失败（vim 题 github.com 合法 top5）；② 逐 ref 二次网络请求违背 npm license 先例划下的诚实线（60/hr keyless 配额也撑不住）；③ 仓库级官方性离线启发式（org 名单）维护成本高腐烂快（域名表纪律：高频≠入表）。
