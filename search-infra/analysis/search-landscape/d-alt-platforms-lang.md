# d. 换平台 + 换切面扫库（GitLab / 低星语言切面 / Topic 深挖 / Awesome 反查）

> Task 9-c，2026-09-02。前三轮（a/b/c + Task 8 深爬）只扫了 GitHub 高星和关键词命中的头部仓库，本轮专捞角落：
> ① GitLab 公开项目（没人扫过）② GitHub 按语言切面（Rust/Go/Zig/C 的低星活跃库）③ GitHub topic 切面（topic 能命中不写 description 的无名仓库）④ Awesome list 反查（list 里有但没人报过的）。
> 过滤规则：fork:false、空壳/模板/纯 list 剔除、commit 活跃优先、0-10 星有思路的标 💎 新苗。

## 30 秒结论

1. **GitLab 上有个活的 SearXNG 工具生态，但全是 0-6 星小工具**，形态清一色是"自托管 SearXNG 的连接器"：MCP 桥、Ruby/Go/CLI 客户端、编码 agent 插件。星数在 GitLab 完全失真（GitHub 300★ 的 araa-search 在 GitLab 是 0★），只能看 last_activity_at。
2. **低星语言切面各有流派**：Rust 在做"窄件"（TUI/网关/边缘盒），Go 在做"拿现成存储当引擎"（Postgres 全文+语义），Zig/WASM 在做"可嵌入库"，C 是老血统自建索引（DataparkSearch 2000 年代的项目还在 push）。
3. **Topic 深挖是本轮最大金矿**：answer-engine / search-api 两个小 topic（37/237 个仓库）里挖出一批"格式标准提案"和"关停 API 替身"——都是 GitHub 关键词搜索永远排不前面、但对我们最有价值的东西。
4. **两条重要情报**：Google CSE JSON API 将于 2027-01-01 关停（我们 P1 key 插槽表要改）；编码 agent 插件生态（pi / dsh / OpenCode / Claude skill）已经成了搜索工具的新分发渠道，一周内冒出 5+ 个"给某某 agent 的搜索插件"。

---

## 切面 1：GitLab 公开项目

**一句话结论：GitLab 的搜索生态 = 自托管 SearXNG 的"接线板"集合，原创引擎几乎没有，但给 SearXNG 做 MCP/插件/客户端的活很勤，星数全失真，last_activity 才是信号。**

扫法：`/api/v4/projects?search=<词>&order_by=last_activity_at`，9 个词（ai search / metasearch / searxng / search engine / deep research / serp scraper / serp / perplexica / websearch），逐页看 top 结果 + 对重点项目拉明细。

### 值得看的 Top5

| 项目 | 星 | 最后活跃 | 一句话 | 可抄点 |
|---|---|---|---|---|
| digicura/opencode-searxng | 0 | 2026-08-10 | OpenCode 插件：用自托管 SearXNG 做"有证据支撑的搜索" | 编码 agent 插件里叫 evidence-backed search——搜索结果直接带证据语义，跟纯 search tool 有区分度 |
| enrell/better-search | 0 | 2026-05-12 | Go 写的 MCP server：SearXNG 搜索 + Byparr 抓内容 | **Byparr**（FlareSolverr 的轻量替代）当"被挑战页面"的兜底通道，可进我们引擎阶梯第 3 层 |
| originaltrini0/mcp/searxng-mcp | 0 | 2026-08-30 | 三层嵌套 group 里的 SearXNG MCP server，月更 | GitLab 嵌套 namespace 生态的活样本；持续单维护者月更 |
| andy.huangyh/sovereign-storm | 0 | 2026-06-26 | 把 STORM 改造成编码 CLI agent 用的多 agent 深研引擎（Hermes/Codex/Claude Code/OpenCode） | STORM 的 outline→article 流程剪裁成 CLI 可用的子命令——"学术研究引擎 agent 化"独一份 |
| amkisko/searxng.rb | 0 | 2026-07-06 | Ruby 的 SearXNG 客户端 + MCP server 二合一 | "同一包两种出口"（console 客户端 + MCP）在 Ruby 生态也成立，验证了我们 CLI/MCP 双出口路线 |

### 其他记录（活跃但有保留）

| 项目 | 星 | 活跃 | 一句话 | 备注 |
|---|---|---|---|---|
| antton-the-dev/cli-web-search | 0 | 2026-06-08 | 终端 web search：SearXNG → markdown 转换 | 单发项目，无后续 |
| Latiler/mcp-query-bridge | 0 | 2026-04-29 | FastMCP 把 SearXNG 暴露成 MCP 工具 | 同质化第 N 个 |
| nadiasumayaperes/SearxGo-browser | 0 | 2026-07-24 | SearXNG 跨端浏览器客户端（Android/iOS/Linux/macOS/Win） | 移动端接自托管实例的需求真实存在 |
| coder77/bismillah-search | 0 | 2026-07-22 | 包一层 SearXNG 给现代 UI | 模板感重 |
| TECHNOFAB/mcp-searxng | 0 | 2025-08-29 | 又一个 SearXNG MCP | — |
| jeffmartson/sitedorks 等 4 件套 | 0 | 标记 deletion scheduled | Google/Bing/DDG/Yandex dork 批量搜索套件 | **GitLab 会给不活跃个人项目排期删除**，看到喜欢的要趁早 clone |
| Extravi/araa-search | 0 | 2023-10 停 | GitHub 上 300+★ 的 Google 元搜索，GitLab 镜像 0★ | 实锤 GitLab 星数不可比 |

### GitLab vs GitHub 主流做法的差异

- **生态位完全不同**：GitHub 在造引擎（wigolo/Vane/donsetch），GitLab 在给引擎做"接线"（MCP 桥/客户端/插件）。想找引擎去 GitHub，想找 SearXNG 的连接器姿势反而 GitLab 密度更高。
- **"证据语义"先出现在小平台**：opencode-searxng 明确叫 evidence-backed search，比 GitHub 同类（还在卷"多引擎+聚合"）多走半步。
- **平台机制差异**：GitLab 对个人项目有 deletion-scheduled 清理（安全 dorks 类工具成批待删），GitHub 没有这机制——冷门工具的"抢救窗口"是 GitLab 特有现象。
- **镜像/机器人污染**：`gitlab-oss-package-research/*` 这类自动镜像 namespace 批量灌 PyPI/npm 包快照，搜索结果一半是它，得靠 description 过滤——这是 GitLab 搜索工程化的主要噪音。
- **GitLab 无星文化**：9 个词 170+ 结果，仅 3 个项目星数 >5。**结论：以 GitLab 为唯一家园的搜索项目≈没有，但它适合当"某某 GitHub 项目的第二主页"去交叉验证活跃度。**

---

## 切面 2：GitHub 按语言切面（低星 + 活跃）

**一句话结论：每个语言都有自己的"搜索生态位"——Rust 做窄件、Go 拿 Postgres 当引擎、Zig 做可嵌入库、C 守着自建索引老血统，全部在 200★ 以下但思路跟 TS 主流完全不同。**

### q=metasearch language:rust stars:0..200（9 个结果，全活跃）

| 项目 | 星 | 活跃 | 一句话 | 可抄点 |
|---|---|---|---|---|
| mat-1/metasearch2 | 169 | 2026-09-01 | "a cute metasearch engine" | 主开发其实在 GitLab（mat-1/metasearch），GitHub 只是镜像——跨平台开发的活样本 |
| MikeLuu99/metasearch-rust | 113 | 2026-08-22 | Rust 复刻 SearXNG 定位 | 同人重写能拿 100+★：说明"SearXNG 但 Rust"是真需求 |
| sempervictus/searxng-rs 💎 | 4 | 2026-06-27 | SearXNG 的 Rust 重实现 | 同上，更小更生 |
| eggstack/eggsearch 💎 | 3 | 2026-09-02 | 本地元搜索的 MCP server | "本地元搜索 + MCP 出口"已有人做成最小件 |
| xonoxitron/beamxng 💎 | 0 | 2026-08-26 | 极轻 Rust 网关，代理公共 SearXNG 实例 | 反着来：不自托管，写个网关白嫖公共实例（配合我们的机会主义引擎思路） |
| Rah-Rah-Mitra/meridian 💎 | 0 | 2026-06-14 | 树莓派 5 上的 geo-aware 边缘搜索盒子（BM25+向量混合） | "搜索 appliance"硬件流派 |
| MikeLuu99/search-tui | 1 | 2026-08-09 | Rust 元搜索 TUI | 终端党需求 |

**跟 GitHub 主流的差异**：TS 主流在做"平台"（UI+API+MCP 全家桶），Rust 低星阵营全在做**窄件**——TUI、网关、盒子，单一形态做到极致。没人试图在 Rust 里重造 Perplexica。

### q="search engine" language:go（229 个，挑活跃的）

| 项目 | 星 | 活跃 | 一句话 | 可抄点 |
|---|---|---|---|---|
| DjordjeVuckovic/tusker 💎 | 0 | 2026-09-02 | **把 PostgreSQL 当搜索引擎**：全文/模糊/语义/混合，多语言新闻实测 | 零新增组件的混合检索——我们 FTS5 缓存路线的"重装版"参照 |
| GitPaulo/blogme 💎 | 1 | 2026-09-02 | 专搜技术博客的搜索引擎 | 垂直 crawler+index+rank 一条龙最小实现 |
| rostamlabs/rostam | 29 | 2026-09-02 | 向量库 + 亚微秒 KV 存储二合一的 Go 引擎 | "embed as lib"分发形态 |
| schak04/septcrawler | 1 | 2026-09-02 | 从零写的学习资源搜索引擎（C++ 性能核） | 从零派在 Go/Cpp 交界活动 |
| XylolabsInc/Knowledge-Engine | 1 | 2026-09-02 | 持续摄取 Slack/Gmail/Notion 成统一搜索 | 私域搜索引擎 |

**差异**：Go 阵营的共识是**不造新存储**——Postgres/Redis 直接当索引（tusker），或者干脆"引擎即库"（rostam）。TS 主流则倾向引 Meilisearch/Typesense 外部件。

### q="search engine" language:zig / language:c（21 / 310 个）

| 项目 | 星 | 活跃 | 一句话 | 可抄点 |
|---|---|---|---|---|
| acoustid/acoustid-index | 100 | 2026-08-23 | 音频指纹搜索引擎（Zig） | 非文本索引的工程范本 |
| aikoschurmann/zog | 49 | 2026-07-17 | 零分配 JSONL 搜索引擎（Zig） | zero-alloc 查询路径设计 |
| The-Billy-Company/irregex 💎 | 1 | 2026-09-01 | "造任何搜索引擎"的全套工具箱（Zig） | 把"造引擎"本身组件化 |
| taggon/chaza | 2 | 2026-07-25 | 静态站搜索：Zig 编译成 WASM | **引擎产物 = 一个 wasm 文件**，纯前端部署 |
| NicolasPllr1/kwsearch | 5 | 2026-01-27 | Zig 关键词引擎编译到 WASM | 同上 |
| Maxime2/dataparksearch | 95 | 2026-06-22 | 2000 年代血统的 C 爬虫+搜索引擎**还在维护** | 自建索引流派活化石：crawler/indexer/search 三件套架构至今成立 |
| searchdaimon/enterprise-search | 110 | 2026-06-14 | C 写的企业数据/网站搜索 | — |
| colonelwatch/abstracts-search | 105 | 2026-06-19 | 2 亿篇学术文献的语义搜索（C） | 大语料单机语义索引 |
| verivus-oss/sqry | 29 | 2026-08-28 | 语义代码搜索引擎 | — |

**差异**：C/Zig 是**自建索引原教旨流派**——不依赖 Lucene/Solr，从分词到倒排自己写；而且活得比想象久（DataparkSearch 二十多年还在 push）。Zig/WASM 独有方向：把引擎当**编译产物**发给浏览器/静态站，没有服务进程。

### q="search" "no api key" language:typescript（91 个）

| 项目 | 星 | 活跃 | 一句话 | 备注 |
|---|---|---|---|---|
| KnockOutEZ/wigolo | 4865 | 2026-09-02 | 我们的老对手，霸占该词第一 | 已深爬 |
| smeer666/mcp-* 系列（20+ 个） | 0 | 2026-09-02 批量更新 | 单站点免 key MCP 矩阵：国会图书馆/Internet Archive/歌词/菜谱/招聘/Metacritic… | **一个人把"垂直站点免 key MCP"做成流水线**，一天 push 十几个 |
| Br0ski777/twitter-scraper-x402 等 | 1 | 2026-09-02 | 免 key 抓取 + x402 微付费协议 | 见切面 3 结论 6 |

**差异**：TS 低星阵营把 "no api key" 当**营销关键词**写进 README 第一行（这是第一次见到把免 key 当 SEO 词）；打法是**垂直站点矩阵**（每个站一个小 MCP），而主流（wigolo/ddgs）是水平通用引擎。矩阵打法适合我们补"搜不到的补全"块时参考。

---

## 切面 3：GitHub Topic 深挖

**一句话结论：topic 是被低估的入口——answer-engine(37) 和 search-api(237) 两个小 topic 的"信噪比"远高于关键词搜索，挖出一批格式标准、关停替身、以及一个 8.3k★ 的漏网大件。**

### topic:searxng + pushed:>2026-08-01（158 个命中）

| 项目 | 星 | 一句话 | 可抄点 |
|---|---|---|---|
| felladrin/MiniSearch | 586 | 纯浏览器内跑的搜索平台+AI 助手（WASM，无服务器） | **零后端形态**：SearXNG 式聚合塞进浏览器，HF Spaces 一键 demo |
| Johell1NS/browser-search | 512 | 给 AI agent 的技能：SearXNG 搜索 + Camoufox 浏览 + Cloudflare 绕过 | "搜索是 agent 的一个 skill"——SKILL.md 出口的又一流派 |
| Shelpuk-AI/kindly-web-search-mcp-server | 381 | MCP 搜索+稳健抓取，主打 coding agent | — |
| askalf/amnesia 💎 | 7 | "搜网页，什么都不记"：155 引擎、零追踪、VPN 隧道 | 隐私参数化到极端的配置清单 |
| le0-star/searxng-docker-tavily-adapter 💎 | 0 | **把自托管 SearXNG 伪装成 Tavily 兼容 API** | 适配器反转：自建免 key 后端冒充付费 API，现有 agent 框架零改造成本 |
| rogerdigital/dsh-searxng + Apoze/dsh-web-search-searxng + genesis-agents/dsh-plugins | 5/0/2 | dsh（DeepSeek Harness）插件的 SearXNG 接入 | 新 harness 的"ctx.web seam"插件缝——一周 3 个同类插件，分发位在抢 |
| zhangjhe3004-art/openclaw-free-web-search | 1 | 带置信分 + 多源验证的免费搜索 | confidence score 字段进响应体 |
| tiekoettercom/searx-instances-uptime | 24 | SearXNG 公共实例 uptime 监控 | **公共实例健康度现成数据源**，我们机会主义 SearXNG provider 的熔断依据 |

**差异**：SearXNG 生态一年内从"自托管隐私 UI"转型为"**agent 的搜索后端**"——Tavily 适配器、MCP 桥、agent skill 全是这方向的变体。GitHub 主流报告（a/b）里我们还没把"反向适配器"当一回事。

### topic:metasearch fork:false（112 个）

| 项目 | 星 | 一句话 | 可抄点 |
|---|---|---|---|
| theotherp/nzbhydra2 | 1719 | Usenet 元搜索（垂直老炮，活跃） | 垂直元搜索的 query 路由/鉴权/统计面板 |
| taxueseek/argo | 115 | 中文 agent 搜索工具：中英/学术/代码/购物/金融/新闻/百科 8 垂直 | **中文多垂直 query 路由**，跟英文圈完全不同的垂直划分 |
| tiagozip/metasearch | 85 | "search the web without slop" | 卖点=去 SEO 垃圾 |
| hermes-labs-ai/supersearch 💎 | 0 | **deadline-bounded 搜索扇出** + source-explicit JSON receipts | 把"时间预算"做成一等公民——跟 Governor 预算池同思路但更激进 |
| Alih-b/Josty 💎 | 0 | keyless、面向引用的元搜索 | 响应以引用为中心组织 |
| jahrulnr/searchwire 💎 | 0 | 零配置 Go 元搜索运行时 | "runtime"形态：装完就当服务跑 |
| gefsikatsinelou/MetaSearchMCP | 54 | 即 Task 8 深爬过的 MetaSearchMCP（换 owner 名） | 已消化 |

**差异**：新一代元搜索的响应契约是"**给 agent 的 JSON 收据**"（receipts/citation-first/confidence），不再是"给人的结果页"。中文圈（argo）按消费场景切垂直（购物/金融），英文圈按内容类型切（Usenet/学术）。

### topic:search-agent（30 个）——学术圈重灾区，但有大鱼

| 项目 | 星 | 一句话 | 备注 |
|---|---|---|---|
| MiroMindAI/MiroThinker | 8363 | 深研 agent + 开源模型，8.3k★ | **之前所有轮次都没扫到的大件**，研究循环可直接对标 |
| VibeBench/VibeSearchBench | 418 | "野外最狠搜索 benchmark"：模糊、多轮、主动追问，200 长程任务 | 现成评测集，可直接测我们 research.ts |
| shawn0728/OpenSearch-VL | 276 | 多模态深研 agent 的 RL 训练全套配方 | — |
| DavidZWZ/Awesome-Deep-Research | 860 | Agentic Deep Research 论文/资源总表 | 切面 4 素材 |
| RUC-NLPIR/GISA | 37 | 通用信息求助助手 benchmark | — |
| brisok11/harness | 0 | 20B RL 训练的搜索 agent + 有状态检索 harness | — |

**差异**：学术圈把搜索当**RL 训练问题**（Search-R1 一脉：搜索即工具调用的强化学习），工程圈没人接这茬；反过来工程圈在卷 MCP 分发。两边零交流——benchmark 是现成的跨界接口。

### topic:web-search（682 个，加 pushed>2026-06 过滤）

| 项目 | 星 | 一句话 | 可抄点 |
|---|---|---|---|
| nicobailon/pi-web-access | 1343 | Pi 编码 agent 的搜索+内容抽取扩展 | 单 agent 平台扩展做到 1.3k★——**分发位价值实锤** |
| dondai44423/donsetch | 578 | Rust 从零写 fetch/search/crawl，无 key 无账号，AGPL | 第二个"Rust 造全套"（继 wigolo 路线后），爬取内核自研 |
| funkyfunc/fearch 💎 | 0 | "诚实搜索"：MCP/CLI **自报身份**、遵守 robots | 反 TLS 伪装潮流：靠老实换不封 |
| agntn/web 💎 | 4 | 给 agent/CLI 的统一 web search provider | 单一 provider 抽象层 |
| infinit3labs/web-research-mcp | 0 | 7 工具多源研究 MCP（search/fetch/Wikipedia/arXiv…） | 垂直源打包成 MCP 工具组 |

**差异**：出现了"**honest agent**"流派（fearch 自报 UA、不伪装）——TLS 指纹伪装（ddgs 路线）之外的第二条路：赌"标注自己是 bot 但守规矩"能换长期通行。跟 searchts（切面 4）的阶梯解锁构成三条路线。

### topic:crawler + topic:ai（155 个）

| 项目 | 星 | 一句话 | 可抄点 |
|---|---|---|---|
| discourselab/scrapai-cli | 115 | 自然语言描述 → 生成生产级 Scrapy spider | 爬虫生成器 |
| KuiChi-x/reverseloom 💎 | 41 | AI 浏览器 agent 做 web 逆向：**把网站固化成免浏览器的 API 客户端** | "site→API"逆向产物可持续复用，不是每次现抓 |
| makralabs/makra 💎 | 28 | 网页和 agent 之间的"记忆层"，实时供结构化数据 | 把缓存从"事后查"升级成"事前供" |
| lucasmartins-ai/lookacrawler | 0 | token 高效的本地 Firecrawl 替代 + MCP | — |
| G5317/aivscan 💎 | 0 | 审计网站对 AI 爬虫/答案引擎的就绪度 | AEO 反光面工具（见结论 6） |

**差异**：crawler×AI 的结合点不是"抓得更狠"，而是**契约化**——把网站一次性固化成 API 客户端（reverseloom）或记忆层（makra），之后按契约走。这跟 Firecrawl"每次现抓现洗"是两条路。

### topic:perplexity（840 个，90% 蹭词）+ topic:answer-engine（37 个，全金）

answer-engine 37 个仓库几乎每个都是新苗级：

| 项目 | 星 | 一句话 | 可抄点 |
|---|---|---|---|
| Yuuzulight/Wisp 💎 | 0 | SearXNG 之上的本地答案引擎：rerank→抽取→带引用合成 | **与我们同构的最小对手**（SearXNG+本地合成），可对照验收 |
| salpenr/gainsay 💎 | 0 | 隐私答案引擎，**专门呈现来源之间的分歧** | "disagreement-first"全新产品理念：不掩饰矛盾而是展示矛盾 |
| lumioguard/lumioguard-tools | 15 | Slopmeter：贴个 URL 告诉你它多" slop" | 网页质量评分器 |
| mizcausevic-dev/ai-evidence-format-spec 💎 | 1 | **AI Evidence Format v0.1**：随 LLM 答案旅行的结构化引用 JSON 规范 | 引用格式标准化尝试（与我们 citations.ts 对标） |
| answerworthy/answerworthy.md | 4 | 另一个开放标准：让商家可被 AI 验证推荐 | 标准抢位赛第二家 |
| togo-framework/aeo 💎 | 0 | 每页 /md markdown 双胞胎 + llms.txt 索引 | AEO 供给侧的极简实现 |
| Skelf-Research/polymathy | 0 | Rust：把传统搜索变成答案引擎的服务层 | — |
| YashMahawa/answerloom 💎 | 0 | 静态化带引用答案包，零 AI 账单零服务器 | "答案包"预生成形态 |

**差异**：answer-engine topic 里在发生**格式标准抢位**（AI Evidence Format / answerworthy.md / llms.txt 三方），GitHub 关键词搜索根本看不到这些 0★ spec 仓库。且"分歧呈现"（gainsay）是全部主流都没做过的产品理念。

### topic:search-api（237 个）

| 项目 | 星 | 一句话 | 可抄点 |
|---|---|---|---|
| **Booyaka101/cse-bridge** 💎 | 0 | 自建替身：完整模拟 **Google CSE JSON API**（官方 2027-01-01 关停） | **重大情报**：Google CSE 100 次/天的免费插槽只有 16 个月寿命；替身方案=用别的源冒充 CSE 响应格式 |
| dmarzzz/search-responses 💎 | 0 | **provider 无关的 agent 搜索请求/响应标准** | 跟我们 types.ts 的引擎间契约同一件事，第一次有人试图立标准 |
| Khamel83/argus 💎 | 4 | 14 provider、预算感知路由、内容抽取的搜索 broker | 与 Governor 同思路的他人实现，可对照 |
| robbyczgw-cla/web-search-plus-mcp | 4 | 15 搜索源 + 9 抓取源的 MCP | — |
| xerj-org/xerj | 1812 | "AI 搜数据的新方式"：autoindex 让 agent 自动索引数据 | 高星新面孔，定位模糊但涨得快 |
| querit-ai/querit-plugins | 8 | 同时给 pi 和 dsh 两个 harness 出插件的搜索 | **跨 harness 分发**成为常规操作 |
| Ban711/moark-websearch-kit 💎 | 0 | Gitee AI 的 web search 接入套件（含 Agent Skill） | **中国平台（Gitee AI）在抄 MCP/Skill 分发模式** |
| TakoData/tako-mcp | 5 | 实时搜索 + 授权数据（open web 没有的） | "licensed data"作为搜索增量 |

**差异**：search-api topic 冒出两个"基建向"物种——**API 关停替身**（cse-bridge）和**响应格式标准**（search-responses）。主流搜索项目全在卷功能，没人做"替别人收尸/立规矩"的活。

---

## 切面 4：Awesome list 反查

**一句话结论：反查 awesome-ai-web-search（1426★）的 85 个仓库，捞出 3 个 4-6k★ 的漏网中坚和一批活跃小件；另发现 awesome-hacker-search-engines（11k★）是"搜不到的补全"块的现成地图。**

抓取的 list（raw README 直抓）：
- **felladrin/awesome-ai-web-search**（1426★，作者=MiniSearch 作者）：按"initial commit 时间线"组织 85 个 AI 搜索软件——**时间线视角**一眼看出品类代际（2021 Khoj → 2024 Perplexica/morphic 潮 → 2025+ agent 化）。
- **edoardottt/awesome-hacker-search-engines**（11119★）：按资产类型分的几百个垂直引擎（域名/DNS/证书/泄露/凭据/隐藏服务/Web 历史/WiFi/威胁情报…）。
- **qhjqhj00/awesome-agentic-search**（62★）：agentic search 论文/训练/arena/gym 四件套（学术圈入口）。
- 参考（未逐条反查）：DavidZWZ/Awesome-Deep-Research 860★、amplifying-ai/awesome-generative-engine-optimization 495★（GEO 资源总表）。

### 反查结果：list 里有但没人扫过的（18 个 core API 反查）

| 项目 | 星 | 活跃 | 一句话 | 判定 |
|---|---|---|---|---|
| ThinkInAIXYZ/deepchat | 6302 | 2026-09-02 | 桌面 AI 助手（带个人世界连接+搜索） | 大件但偏聊天，存档 |
| **nilsherzig/LLocalSearch** | 5947 | 2026-03 | **完全本地的搜索聚合器：多个 LLM agent 相互讨论得出答案**（Go） | 漏网中坚！"agent 讨论式聚合"与 Vane 单线循环不同，2026-03 后停更 |
| **u14app/deep-research** | 4682 | 2026-06 | 任意 LLM 深研，SSE + MCP server 出口 | 漏网中坚，dzhng 同类但工程化更全 |
| memfreeme/memfree | 1505 | 2026-07 | 混合 AI 搜索 + AI 页面生成器 | 搜索+生成二合一 |
| hrithikkoduri/WebRover | 1022 | 2025-02 停 | 自主研究 agent | 已死，跳过 |
| YassKhazzan/openperplex_backend_os | 891 | 2024-08 停 | OpenPerplex 开源后端 | 已死 |
| JasonHonKL/spy-search | 387 | 2026-05 | "比 Perplexity 快"的 LLM 搜索 | 存档 |
| leettools-dev/leettools | 343 | 2026-04 | AI 搜索工具集 | 存档 |
| **masterFoad/NanoSage** | 266 | 2026-08-29 | 本地 LLM **递归搜索**+知识探索 | 💎活跃：递归式 query 分解，跟 dzhng depth/breadth 不同的第三种循环形态 |
| pengfeng/ask.py | 281 | 2025-06 | search-extract-summarize 极简流 | 教学价值 |
| AsyncFuncAI/rabbitholes | 156 | 2025-04 停 | "兔子洞"式发散研究 | 已死 |
| cnzzx/VSA | 128 | 2024-11 停 | 视觉语言模型当多模态搜索引擎（论文码） | 已死 |
| **tobocop2/lilbee** | 51 | 2026-09-02 | **整个本地 AI 栈打包成一个可执行文件**（907MB，含搜索） | 💎分发形态 extremes |
| brunostjohn/perplexideez | 574 | 2024-11 停 | 自托管应用+web 混搜（本地 agent） | 已死 |
| radityaharya/looq 💎 | 11 | 2025-01 | SearXNG 前端，原生跑在 Cloudflare Pages（Hono+React） | 边缘部署 SearXNG 前端 |
| goofrey/zoom-search 💎 | 3 | 2026-07-16 | MCP 搜索+证据工具：query 重写 → **source zoom-in** → 带源答案 | "对单个来源下钻"作为独立工具动词 |
| chutesai/chutes-search | 3 | 2026-06-27 | Chutes Search 开源 | 观望 |

另外从 awesome-mcp-servers（搜索节）白捡 3 个已被 list 验证的：**capad-xyz/searchts**（阶梯解锁：指纹抓取→JS 渲染中继→隐身浏览器 + rank fusion + 自带 benchmark）、**AutomateLab/citation-intelligence**（查 Perplexity/Claude/Gemini/Google AIO 各引用什么 URL）、**rozetyp/grounder-mcp**（token 封顶的引用证据包，按小上下文窗口定量）。

### 跟 GitHub 主流的差异

- **List 组织方式本身就是情报**：awesome-ai-web-search 用 initial-commit 时间线证明"2024-04 是元搜索大爆炸月份"（Perplexica/STORM/morphic 同月发布）；hacker list 用资产类型切分——两种切法都值得抄进我们的 engines.md。
- **List 里的死尸率 ~30%**（WebRover/openperplex/perplexideez/rabbitholes 全停更）——awesome list 不做死亡标记，反查+活跃度过滤必须做（我们已做）。
- **漏网规律**：4-6k★ 漏网大件（LLocalSearch/u14app/deepchat）全是"非 Perplexica 系"技术路线（agent 讨论式/工程化 MCP 出口/桌面形态）——高星关键词扫描天然偏向 Perplexica 系词根，topic+list 反查才能补上。
- **hacker list 提醒我们**：所谓"搜不到的补全"在安全社区早被按资产类型工程化了（证书搜索/泄露搜索/Web 历史搜索…），直接按图索骥即可，不必自创分类。

---

## 本轮新角度结论（合并给主会话）

1. **分发位 > 引擎本体**：一周内出现 5+ 个"给某某 harness 的搜索插件"（pi-web-access 1343★ / dsh-searxng×3 / querit 双插件 / GitLab opencode-searxng / browser-search skill）。search-core 的 SKILL.md/插件出口应升级为 P0。
2. **Google CSE API 2027-01-01 关停**（cse-bridge 实锤）→ docs/targets-search.md P1 表的"Google CSE 100/天长期小额度"要改为"临终通道，2026 年内别投入"；cse-bridge 的"冒充官方 API 格式"思路值得抄（让免 key 后端冒充 Tavily/CSE 响应，存量 agent 零改造）。
3. **引用/证据格式在抢标准**：AI Evidence Format、answerworthy.md、llms.txt、search-responses 四家同时立规矩，全部 0-4★ 无人认领——我们 types.ts/citations.ts 契约有对外输出成"事实标准"的窗口期。
4. **学术 RL 圈和工程圈零交流**：Search-R1/MiroThinker(8.3k★)/VibeSearchBench(418★) 提供了现成 benchmark——research loop 直接拿 VibeSearchBench 测一轮，成本一天。
5. **免 key 三路线并存**：TLS 伪装（ddgs）/诚实自报（fearch）/阶梯解锁（searchts：指纹→渲染中继→隐身浏览器）。阶梯式已有带 benchmark 的开源实现，我们引擎阶梯可以直接对标。
6. **AEO/GEO 是搜索的反光面**：引用审计（citation-intelligence）、markdown twins（togo/aeo）、AI 爬虫就绪度评分（aivscan/aeo-cli）——既是"让 search-core 输出被 AI 引用"的免费情报，也可反向当"判断网页对 agent 友好度"的抓取优先级信号。
7. **平台结论**：GitLab 只值得定期查 last_activity（SearXNG 连接器生态），不值得扫星；真正的新苗几乎全部藏在 topic:answer-engine / topic:search-api 这类小 topic 里。

## 扫描日期与请求数

- **扫描日期：2026-09-02**（UTC）
- 切面 1 GitLab：约 35 次未认证 API 调用（9 关键词 × 2 页列表 ≈ 17 + 明细 13 + commit 头探测 5）
- 切面 2 GitHub 语言搜索：5 次 search API
- 切面 3 GitHub topic 搜索：8 次 search API
- 切面 4 Awesome：2 次 search API + 4 次 raw.githubusercontent 直抓（不占 API 配额）+ 18 次 core API 反查
- GitHub search API 合计 15 次（限额 ≤20 达标；每 5 次 sleep 5s；token 未入报告）
- 原始响应存 /tmp（gl-*.json、gh-*.json、aw1-4.md），未入仓
