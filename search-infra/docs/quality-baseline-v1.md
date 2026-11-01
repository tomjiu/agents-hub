# search-core 全链路质量基线 v1（Phase V，2026-09-03）

> 用户提案：MCP 外部连接器实测往后放，先测"搜索的成果质量、爬取的质量、清洗的质量、
> 最后返回文本的质量，以及搜索结果有没有解决问题"，同时加入优先域名（首批=权威学术网站）。
> 评测工具：`core/scripts/quality-bench.mjs`（8 题基准 + 2 题 research summary 档，真网络，探针原始 JSON 不入仓）。
> 本轮两轮跑数：第 1 轮暴露问题 → 修 3 处 → 第 2 轮验证全部生效。

## 一、优先域名机制（用户提案落地）

**`core/src/authority.ts`**：权威域名表 + 段精确匹配（`hostname === d || endsWith("." + d)`，
`ieeexplore.ieee.org` 命中 `ieee.org`，`fake-arxiv.org` 不命中）。融合打分阶段提权，**只提权不屏蔽**。

首批 16 域：arxiv.org / nature.com / science.org / ieee.org / acm.org / springer.com /
sciencedirect.com / wiley.com / tandfonline.com / ncbi.nlm.nih.gov（PubMed+PMC 子域全覆盖）/
semanticscholar.org / aclanthology.org / openreview.net / plos.org / core.ac.uk / **wikipedia.org**
（百科双角色：学术背景 + 事实型查询最优源——评测 case-3 教训后补入）。

**提权分档（评测发现的副作用修正）**：

| 场景 | boost | 理由 |
|------|-------|------|
| academic 专线查询（domainPlan.topic） | 0.75 | 能反超"标题党多命中一个词"的转载页（一个词的词法差 = 0.5） |
| 通用查询 | 0.4 | 仅同层微调——事实型查询里字面强相关的答案页不被论文淹没 |
| 0（可关） | FuseOptions.authorityBoost=0 | 关闭提权，标注仍保留（matchAuthority 与 boost 独立） |

## 二、五维质量结论（第 2 轮，修复后）

### 1. 搜索成果质量 —— 良，通用引擎面是短板
- 8 题全出勤（平均 3.5 引擎/题），平均 1484ms，0 降级；权威域名命中 51 条（6/8 题有命中）。
- **修复验证**：事实型题 "who invented the world wide web" 第 1 轮被 7 条 arXiv 字面命中论文淹没
  （wiki 答案页 #8，L1 未解决）→ 修复后 wiki "World Wide Web" **#1** + "History of the World Wide Web" #2，
  正文命中 Berners-Lee。医学题 aspirin、报告题 IPCC 的 wiki 权威页同步升 #1。
- **短板**：通用 web 引擎出勤不稳——yahoo 全灭（error）、duckduckgo 频繁 rate_limited（间歇自愈）、
  hn/wikipedia 偶发 error。多数题实际主力 = bingrss(Bing RSS) + 学术专线腿。
- **短板 2**：中文题"向量数据库 milvus faiss 对比"只有 arXiv 腿活着 → top10 全 arXiv，
  中文内容源塌方（与 f 报告"智谱 key 插槽"立项呼应，不重复立项）。

### 2. 爬取质量 —— 79% 成功，失败源集中
- 24 次抓取 19 成功，平均 354ms；wikipedia 大页面（31k-109k 字符）全程稳定。
- 5 次失败全集中在三类源：crates.io SPA 空文本 ×2（页面 JS 渲染，extractHtml 无内容）、
  npmjs.com 403（反爬）、doi.org 落地页 403（wiley/emerald 反爬墙）+ 空文本 ×1。
- **修复验证**：dockerhub URL 拼接 bug（API 的 repo_name 自带 namespace 时硬塞 `library/` 前缀
  → `/r/library/rapidfort/...` 404）修复后 fetch 全通，case-7 解题层从 L1 升级到 L1+L2 双确认。

### 3. 清洗质量 —— 优秀，本轮最亮维度
- 19 次成功抓取：导航/广告残留平均 0.1 处/页，**100% 判定干净**（唯一残留 = wiki 页 1 处导航词）。
- cheerio 剪枝（script/style/nav/footer + article/main 优先）+ 块级换行的组合无广告泄漏，
  arXiv abstract 页提取 3.8k-4.7k 字符恰好是摘要体量，无误吞。

### 4. 返回文本质量（research summary 档） —— 结构与引用合格，深度受档位限制
- 两题均产出 6.4k/7.1k 字符报告，5 节大纲（v0.8 buildOutline 生效），**引用池 60 条全部带 [n] 标注
  （覆盖率 100%）——引用出口校验在真实跑数下成立**。
- 弱点：summary 档 1 轮循环只攒 3-4 条事实就写稿，stop=max_loops 且诚实标注 "degraded output"；
  "who invented the www" 的报告未命中 Berners-Lee（素材太浅）。**summary 档定位=快速概览，
  深题应走 report/deep 档**，文档已标注，不改预算表。

### 5. 解决问题率 —— 6/8（75%），两个 MISS 根因都在数据源
| 题型 | 解题层 | 说明 |
|------|--------|------|
| academic（RAG 原文） | L1+L2 | wiki #1 + 正文命中 |
| academic-priority（transformer） | L1+L2 | wiki 原论文条目 #2，正文命中 Vaswani |
| fact（www 发明人） | L2 | wiki #1/#2，正文 Berners-Lee |
| route-packages（rust crate） | **MISS** | crates.io 对长自然语言查询排序差，tokio 不进前列 |
| zh-tech（向量库对比） | **MISS** | 中文引擎面塌方（见维度 1 短板 2） |
| med-academic（aspirin） | L1+L2 | wiki 机制页 #1 |
| route-devops（postgres 镜像） | L1+L2 | dockerhub 出勤 + fetch 修复后双确认 |
| fact-report（IPCC） | L1+L2 | wiki AR6 条目 #1 |

> 诚实口径：解题判定 = expect 关键词命中（搜索层 title/snippet → 爬取层正文 → 研究层报告），
> 是代理指标，不冒充人工阅卷。

## 三、本轮修复清单（3 处，全部带测试）

1. **dockerhub URL 拼接 bug**（registries.ts）：repo_name 自带 namespace 时不再叠加 owner/library
   前缀；补 4 分支测试。真实网络 404 → 修复后 fetch OK。
2. **提权副作用**（engine.ts + authority.ts）：topic 感知分档 0.75/0.4 + wikipedia.org 入表；
   新增"弱提权不反超全词命中页"语义测试。事实型题 top1 从 arXiv 论文 → wiki 答案页。
3. **探针 research 调用**（quality-bench.mjs）：`core.research` 是 ResearchLoop 属性（engine.ts:37），
   正确调用 `core.research.run()`——顺带暴露"属性名与方法名混用易踩坑"的 API 事实，不改（MCP/CLI 出口正常）。

测试 154 → 162（+8：authority 7 条 + dockerhub 分支扩充），全绿。

## 四、待办（按对解题率的预期收益排序）

1. **registry 长查询浓缩**（直击 route-packages MISS）：crates/npm 收到自然语言长查询时
   提取候选包名（去停用词/取名词短语）再打 API，或对 crate 名做精确优先排序。
2. **crates.io fetch 空文本**：provider 结果附 API JSON 端点（`/api/v1/crates/{name}`）作 fetch 目标，
   页面 URL 留作展示——fetch 面与展示面分离。
3. **doi.org fetch 差**：crossref 腿结果可选 OA 直链（openalex 已有 oa_url 阶梯），DOI 页面留展示。
4. **topN 域名多样性**：单域名霸屏（arXiv 10/10）→ 融合裁剪阶段每域名上限（搜索引擎标准做法，
   预计 2-3 条），防单一权威源挤出其余视角。
5. **中文查询面**：duckduckgo 限流退避 + 中文 key 插槽（f 报告智谱 ¥0.01 候选）——已在 v0.8 挂账，不重复立项。
6. **MCP 外部连接器真机实测**（用户指令明确往后放）：把本 core 作为 MCP server 挂进真实客户端会话。

---

# 第 2 批：置信度筛选 + 多样性 + registry 修复（Phase W，2026-09-03 同日第二轮，用户"1 和 2 都要做，更关心自做引擎补商业缺口+屏蔽 csdn/百家号/搜狐等灌水站"）

## 五、新机制三件

### 5.1 置信度筛选（`core/src/credibility.ts`，用户最关心）✅
- **硬屏蔽 12 域**（从融合结果剔除+`meta.spamBlocked` 计数）：csdn.net / baijiahao.baidu.com /
  sohu.com（三条用户点名）+ zhidao/wenku/jingyan.baidu.com（百度系灌水面）+ docin/doc88/book118/
  360doc/renrendoc/taodocs（文库爬虫墙，对 agent 零提取价值）。
- **强降权 3 域**（-1.2 分，压过 authority 0.75+一个词差 0.5 之和，保留但标 `ref.spam`）：
  ehow.com / answers.com / wikihow.com（英文 SEO 农场）。
- 段精确匹配与 authority 同规则（`blog.csdn.net` 命中、`fake-csdn.net` 不命中）；
  **知乎/cnblogs 未点名不动**（混杂但有干货，不自作主张）；名单在 git 可审查可增删。
- 与 `config.blockedDomains`（fetch 层 SSRF 策略）互补：那边管"不去抓"，这边管"不混进结果"。
- 测试 10 条：匹配规则/伪装域/未点名站不误伤/两表与权威表零矛盾/fuseSemantic 集成（剔除计数+降权重排标注）。

### 5.2 域名多样性 cap（治"单一权威源霸屏"）✅
- 融合裁剪阶段贪心挑选，单域默认最多 3 条（`FuseSemanticOptions.domainCap`，0=关闭）。
- **评测实抓二次 bug：cap 对单源专线是误伤**——crates 腿 10 条全是 crates.io 域，cap=3 裁掉 7 成
  连头部包都丢 → **domain 路由（用户点名鱼塘）与 x 搜索（同域是特性）豁免 cap**（engine 两处调用点分档）。
- 实测：中文题 uniqDomains 1 → **6 域**，异域视角回来了。

### 5.3 packages 修复（评测 case-4 结构性闭环）✅
- **crates `sort=downloads`**：长自然语言查询按下载量排序，头部包（tokio 9.3 亿）不再被字面匹配小众包挤掉——
  探针实测 `q=rust crate async runtime tokio&sort=downloads` → mio/tokio/rustls/tower/sqlx（全是真头部包）。
- **语言腿裁剪 `condensePackagesLeg`**：含 rust/cargo/crate → crates 单腿；含 npm/node/js → npm 单腿；
  php/ruby 同理；无信号全四腿兜底——rust 查询不再空跑 npm 腿（实测 npmjs 403 fetch 失败随之消失）。
- cap 豁免后复验：**tokio #4 进 top5，case4 从 MISS → L1**。

## 六、冷门专业源补商业引擎缺口（用户本轮核心关切）

**结论先行：常规题免费池够用，冷门专业题的牌面 = 已有四张 + 本轮新机制**：

| 牌 | 覆盖什么 | 状态 |
|----|---------|------|
| Marginalia（API 已接） | **冷门独立网站专用索引**——本身就是"商业引擎看不到的非商业站" | 王牌，无需动作 |
| StackExchange（API 已接） | **170+ 专业子站**（unix/superuser/serverfault/academia…），config.engines 可指名 | 已支持指名 |
| DOMAIN_TABLE 7 主题 | 学术/包/镜像/实体等垂直 API 直连（官方数据比通用引擎快且准） | 29 providers |
| HN/Lobsters 类论坛 | HN 已接；Lobsters 沙箱 TCP 仍不可达（重测 ETIMEDOUT，维持 watchlist） | Lobsters 挂账 |
| Reddit .json | 实测 **403 反爬墙**（Cloudflare 挑战页），沙箱/服务器 IP 接不了 | 诚实不接 |
| **本轮新增** | 垃圾站屏蔽（csdn 等不占坑）+ 多样性 cap（冷门视角不被霸屏挤出） | 见上 |

- 第二轮 bench 里 packagist/rubygems error 经探针复核为**间歇性**（200 OK / 373-500ms），API 健康，provider 无需动作。
- 冷门查询的下一步是**源扩充**（更多垂直站进 DOMAIN_TABLE Tier2 site: 或新 provider），
  按"官方 API 优先 > HTML 爬"的老规矩逐个过 smoke——记入待办不冒进。

## 七、第三轮 bench 定稿（9 题+2 research，全部真网络）

| 指标 | 第 2 轮 | **第 3 轮** | 变化 |
|------|---------|------------|------|
| 解题 L1+L2 | 6/8 | **7/9** | case4 MISS→L1（结构性），case3 回落=wiki 腿间歇缺勤（非 bug，上轮同代码 L2 solved） |
| 域名多样性 | 中文题 1 域 | **6 域** | cap 生效 |
| npmjs 403 | 有 | **消失** | 语言腿裁剪后 npm 噪音腿不再空跑 |
| 清洗 | 100% 干净 | **100% 干净**（nav 0.0/页） | 持平 |
| spamBlocked | — | 1（屏蔽生效待命） | csdn 本轮自然结果未出现，单测+机制在位 |

- fetch 失败收敛为两类源头：doi.org 落地反爬（ssrn/wiley/emerald 403）+ crates.io SPA 空文本——对应待办 2/3 不变。

### 第 4 轮（phase X：wiby 入默认池 + marginalia dc=3，回归验证）

| 指标 | 第 3 轮 | **第 4 轮** | 结论 |
|------|---------|------------|------|
| 解题 L1+L2 | 7/9 | **7/9** | 持平无回归；MISS 集合不变（fact=wiki 腿间歇缺勤、zh=数据源缺口，均已挂账） |
| 清洗 | 100%（nav 0.0/页） | **100%（nav 0.0/页）** | 持平 |
| authority 命中 | — | 25（7/9 题命中） | 提权继续生效 |
| spamBlocked | 1 | 1（待命） | 机制在位 |
| fetch | 21/27 OK | 21/27 OK（78%） | 失败仍集中 crates SPA 空文本+doi 落地 403（待办 2/3） |

- 本轮改动属"冷门面扩池"（wiby 默认池 10→11、marginalia 源头 dc=3），设计预期是**不伤通用题、增冷门覆盖**——两轮解题率持平符合预期，冷门题收益靠真冷门 query 长期观察（bench 9 题偏通用，诚实口径：本轮指标看不到 wiby 的增量价值，机制与探针在位）。

### 第 5 轮（phase Y：keenable 入默认池第 12 腿，两遍采样同判）

| 指标 | 第 4 轮 | **第 5 轮（×2 采样）** | 变化 |
|------|---------|------------|------|
| 解题 L1 | 6/9 | **8/9** | fact(who invented www)与中文题(向量数据库 milvus)双双翻绿——keenable 出勤 6/9 是第二主力 |
| 解题 L1+L2 | 7/9 | **9/9 全绿** | 历史最高；python 题靠 L2 爬取层兜住 |
| 出勤引擎均值 | 2.2 | **4.4** | keenable/blingrss/wikipedia 出勤稳定 |
| 搜索耗时均值 | 801ms | **4243ms** | 诚实代价：更多腿跑完才收割；仍在 6s 软截止内,延迟敏感可调 SC_SOFT_DEADLINE_MS |
| L2 未中 | — | rust/中文两题 | rust=crates.io SPA 空文本(待办 2),中文=已 L1 中不亏 |

- 结论：**独立索引腿(keenable)直接救活了 fact+中文两个历史 MISS**——第 4 轮注记里"看不到 wiby 增量"的通用 bench,这轮看到了 keenable 的增量,验证"独立索引补商业缺口"路线。

## 八、待办更新（合并两轮，按解题率收益排序）

1. ~~registry 长查询浓缩~~ ✅ 本轮落地（sort=downloads+语言腿裁剪，case4 闭环）
2. ~~topN 域名多样性~~ ✅ 本轮落地（cap=3+domain/x 豁免）
3. ~~置信度筛选~~ ✅ 本轮落地（两档 15 域）
4. crates.io fetch 走 API 端点（SPA 空文本，fetch 面与展示面分离）
5. doi.org 落地反爬 → OA 直链（openalex oa_url 阶梯复用）
6. **fact 型查询 wiki 出勤保障**（第 3 轮 case3 教训：wiki 间歇缺勤时事实题失去答案源——重试/优先出勤机制）
7. 冷门源扩充：按老规矩逐个过 smoke 进 DOMAIN_TABLE Tier2（Lobsters 沙箱不可达/Reddit 403 已挂账，不硬接）
8. 中文查询面：智谱 key 插槽（f 报告挂账）
9. MCP 外部连接器真机实测（用户明确后置）

## 九、第 6 轮 bench + 对照轮（Phase Z，用户"跑一轮和你之间搜索的进行对比"）

**第 6 轮 quality-bench（9 题真网络）**：L1=9/9、L1+L2=9/9 **历史最高**（此前 8/9+9/9），出勤均值 4.6、authority 31 命中、spamBlocked=4、清洗 100%（nav 0.0/页）、耗时均值 926ms。第 5 轮靠 L2 兜住的 python 题，这轮 L1 直接翻绿（修复生效）。

**对照轮（vs-zai，详见 docs/vs-zai-search-compare.md）**：同 9 题 vs 托管聚合黑盒（我方 AI 内置 web_search），同一把尺（authority/credibility 清单）打标——

- 修复前 8/9 vs 9/9，唯一败题「python asyncio 教程」**挖出 planner 真 bug**：中文编程题被域名路由收窄到 5 腿（3 条英文系），ddg 限流后塌到 bingrss 单腿；修法=programming 腿集补 keenable 保底（zh 能力+免 key+健康 9-0），真实 miss 题做回归锁，179→180 测试；
- 修复后两轮全量 9/9 vs 9/9 战平；**权威密度 3.1-3.2 vs 1.2（2.6 倍）**、灌水站 0 出现 vs csdn 稳坐对方中文题 top1、**域名重叠 Jaccard 均值 0.16**——两边几乎是两个互联网，"本地引擎+API 聚合"双面架构的实证；
- 诚实：对方均延迟更稳（1.3-1.9s vs 我方 1.0-3.8s 波动）、中文教程面池子更厚（廖雪峰/菜鸟/知乎顶位）；判分是关键词代理，单机网络 3 样本快照。

## 十、待办更新（第 6 轮后）

1. crates.io fetch 走 API 端点（SPA 空文本，老挂账）
2. doi.org 落地反爬 → OA 直链（老挂账）
3. fact 型查询 wiki 出勤保障（老挂账，keenable 保底后优先级降低）
4. **中文教程面数据源**（对照轮实证差距：廖雪峰/菜鸟/知乎顶位 vs 我们靠 keenable 翻盘——智谱 key 接入正路）
5. pyguides.dev fetch 失败（对照轮新发现，sandbox 直连不通，记档观察）
6. 学术腿 arXiv 刷屏（3 席）是否引入 topic 感知 domainCap——等第 7 轮 bench 再判
7. 冷门源扩充（Lobsters/Reddit 已挂账不硬接）；MCP 外部真机实测（用户后置）

**第 7 轮（Phase AA 增量后回归）**：L1=9/9、L1+L2=9/9 持平无回归；出勤均值 4.6→4.9（mdn/docs.python.org 增量腿贡献）；authority 33 命中、spamBlocked=8、degraded=0。增量明细见 docs/vs-zai-search-compare.md 附录。

## 十一、第 8 轮 bench + 免 Key 增量轮（Phase AB，用户提供免 Key 清单+searx.space 实测）

**增量来源**：用户两轮外部调研清单（真·公网无 Key 端点/公共 SearXNG/垂直源）+ 用户实测 searx.space（80 实例仅 2 个开 JSON）。全案见 docs/keyless-increments.md（16 候选探针矩阵，能证实才接）。

**落地（6+2）**：anysearch（新 provider，默认池第 13）/ firecrawl（新，显式启用）/ pubmed（新，academic 腿 5→6）/ sov2ex（新，编程题中文腿 lang-guard）/ tavily keyless 匿名车道（内切，无 key 也进默认池）/ searxng 多实例回退链（自建优先→内置兜底，伪 200 挑战页用 JSON 判定识破）/ mcp-connector argsTemplate（Parallel 匿名 MCP 一行配置即插）/ normalizeToolResult 补 excerpts 数组归一化。

**第 8 轮 bench（9 题真网络）**：L1=9/9、L1+L2=9/9 **无回归**；出勤均值 4.9→5.9（tavily+anysearch 9 题全勤）；耗时均值 1.9s（软截止内）；清洗 100%；spamBlocked=9（中文题 7 条——Phase W 屏蔽面继续干活）。

**vs-zai 第 5 采样（--quick）**：4/4 战平；权威密度 14 vs 6（2.3 倍）；**延迟反超**（我方 0.6-2.2s vs 对方 2.2-12.7s 含冷启）；**Jaccard 0.16→0.46-0.58**——新聚合车道让我方开始覆盖"对方的互联网"，双面架构融合面扩源的直接证据。

**测试**：185→200（tavily 双车道/四新 provider 黄金/searxng 回退链/argsTemplate/excerpts）全绿。

## 十二、待办更新（第 8 轮后）
1. ~~中文面（智谱 key）~~ ✅ 口径修正：zh 面实测 5/5 与托管聚合打平（docs/vs-zai-search-compare.md 追加节），智谱 key 降级为"可选付费插槽"——残余价值仅纯中文教程站厚度+墙内独占内容两条，由真实使用频率决定是否付费，不预付
2. firecrawl 升默认池观察（等更多轮 bench 出勤/质量数据）
3. Nominatim 探针通过待地理主题；Open Library 沙箱网络失败待线下复验；Semantic Scholar 无 key 429 挂账
4. crates.io fetch 走 API 端点（SPA 空文本，遗留）
5. doi.org OA 直链（openalex oa_url 阶梯复用，遗留）
6. fact 型 wiki 出勤保障（遗留）
7. MCP 外部真机实测（用户后置）
8. 学术腿 arXiv 刷屏 topic 感知 domainCap：pubmed 入腿后观察（第 9 轮 bench 再判）

## 十三、第 9 轮 bench + 三层权威体系 + 额度可见性（Phase AC，用户"效果优化/自引擎+权威站优先/免费 key 额度熔断/逆向智谱来源按类补充"）

**用户三问与落地**：
1. "自引擎和搜索库网站优先能不能弥补？"——能，且升级成三层权威：第 0 层全局表（学术+wiki，沿用）→ 第 1 层主题表 TOPIC_AUTHORITY（域路由命中时，S/A/B 分档）→ 第 2 层意图表 CATEGORY_AUTHORITY（不改路由只改排序：新闻/安全/法律/金融/医疗/数据库/设计/词典/教育/数据 10 类）。召回/质量分层（用户架构指令）：召回面不动，质量层做域名优先+意图路由。
2. "免费 key 额度满了有没有暂时熔断？"——已有三层防线，本轮补可见性：①QuotaTracker 月度计数（tavily 1000/brave 1000/exa 1400 默认档，432/433 一票判死+月度滚动自动恢复）；②熔断 2.0 按失败分类（quota 类 1 次→30min 冷却，半开探针失败翻倍至 1h 上限；429 软封 4 次→2min）；③providers() 现在透出 quota 快照（used/remaining/exhausted/resetsAt）——先能看见，才谈治理。
3. "逆向智谱清言的网站来源按类补充"——core/scripts/zhipu-source-mining.mjs 14 题×6 类采样（原始 JSON 只落 /tmp/zhipu-mining），host_name 频次榜：zh-programming 里知乎专栏×3/runoob×2/liaoxuefeng(asyncio top1)/cnblogs/ruanyifeng/cloud.tencent/rustwiki 各×1；学术面与我们全局表高度重合（arxiv/springer/sciencedirect 全在）；csdn×2 坐实"对方也绕不开灌水站"。甄别后并入主题表 zh 条目（zh 守卫：英文题零误伤）。

**S/A/B 分档换算（诚实口径）**：user v3 的 +5..-3 裸值在本仓标定（RRF×10+lex×1.5+consensus 0.35×n）下会让无关官方页压过一切强相关结果，故换算：S+/S/A+→s=+1.2（压过两词词法差 1.0），A/A-→a=+0.75（原学术专线量级），B+/B→b=+0.4（原通用量级）。社区意图翻转：query 含"讨论/怎么看/experience"类词时 kind=community 条目升 s 档（"rust 开发者在讨论什么"类查询社区源反超文档）。

**实测教训（第 9 轮当场抓获）**：s 档上线后 docker compose 题 MDN×5 霸屏 MISS——混源主题（programming/academic）里 mdn 单源多条同域页全 +1.2 而 domainCap=0。修复：packages/devops registry 单域专线保 0（case-4 教训不动），混源主题恢复 cap=3。复测 docker 题 MISS→HIT，top5=MDN×3+v2ex×2。回归锁入 fusion2.test。

**第 9 轮 bench（9 题真网络）**：L1=9/9、L1+L2=9/9 **无回归**；出勤均值 5.9（持平）；耗时均值 1.98s；authorityHits 56/9 题；spamBlocked=7；degraded=0。
**zh 面第 3 采样（zh-coverage-check 5 题）**：core 5/5 vs zai 5/5 双方全 HIT；向量数据库题 core top5=知乎专栏/博客园/腾讯云/zilliz.cn——zh 分档提权首战见效（上轮还是 wiki/v2ex/pyguides 垫底格局）；rust 题对方 csdn 再中招我方 0。
**测试**：200→215（authority 分档 9 + fusion 三层 6 + 额度可见性 1），含既有 flake 修复（engine.search 无腿测试补 keySlots:"off" 隔离 tavily 免 key 车道联网泄漏）。

## 十四、第 10 轮 bench + 老待办清仓（Phase AD，用户"yolo 直到没有任何需要做的"）

**老挂账逐项清算**：
1. **crates.io SPA 空文本（挂了 5 轮）→ 关账**：fetcher 落地页改写链——`crates.io/crates/{name}` 裸页直接改写官方 API `/api/v1/crates/{name}`，JSON 转人读摘要（description/版本/仓库/downloads）。实弹 tokio 233 字符正文入缓存，第 10 轮 fetch fails 里 crates 清零。
2. **doi.org 落地 403 → OA 直链（挂了 5 轮）→ 关账**：403 与 SPA 假 200（200 但 JS 空壳）双触发 → OpenAlex → Unpaywall 双通道查 OA 直链（优先 html 落地页），自环守卫（Unpaywall 老记录的 OA 落地就是 doi.org 原链，实弹在案）。全链实弹：IEEE 403 → OpenAlex 429 静默换道 → Unpaywall 给 arXiv 仓库落地 → 5453 字符正文入缓存，journal oa_fallback=1。
   - **诚实发现**：OpenAlex 匿名池本 IP 当日额度已烧光（带 mailto 也 429，午夜 UTC 重置）——双通道设计是对的，没有 Unpaywall 就只剩诚实报错；没配 contactEmail 时 Unpaywall 不启用（它 email 必填）。
3. **fact 型 wiki 出勤保障（挂账后一直靠 keenable 保底）→ 有据关账**：第 8/9/10 轮 fact 题 wikipedia 连续全勤且第 10 轮 L2 直接命中（48074 字符 wiki 正文），无缺勤迹象，不需要机制性补丁。
4. **Nominatim（探针通过待主题）→ 转正**：geo 主题（在哪/坐标/地址/where is...）+ nominatim provider（OSM 官方地理编码，规范 UA，空结果=合法空不伤熔断），注册 36→37。实弹"故宫 在哪"：domain/geo 路由、nominatim 出勤、top1=OSM 对象链接 kind=geo。entities 表序在前，"人口/首都"类不被截胡。
5. **SC_AUTHORITY_JSON 外挂（phase AC 挂账）→ 落地**：env/file 配 JSON 覆盖权威表（新域追加/同域覆盖 tier/lang/kind/表内按域替换，非法域跳过，坏 JSON 整体跳过不阻塞）。实弹 boost=1.2 生效。
6. **vs-zai 第 6 采样**：9/9 vs 9/9；asyncio 题我方 top5 已换血 realpython/MDN/python.org（s 档生效），zh 题知乎/博客园进前排；向量数据库题 spamDropped=5（对方 csdn 中招）。

**第 10 轮 bench（9 题真网络）**：L1=9/9、L1+L2=9/9 无回归；出勤均值 6.9（+1.0，nominatim 注册+网络波动）；authorityHits 61；spamBlocked=8；fetch 20/27 OK——crates 空文本清零，余下失败全是无 DOI 的硬反爬（reddit/zhihu/realpython/earth.org 403、arxiv pdf content-type、ACM 内部号 10.5555 非真 DOI），诚实留档。
**测试**：215→230（fetcher 改写链 6 + nominatim/geo 4 + 外挂覆盖 3 + 语义升级调整 2）。

## 十五、第 12 轮 bench + 三项挂账闭环（Phase AF，2026-09-04，用户"继续 yolo"）

AE 挂账三项全部落地（详见 vs-zai 附录 E 与 engines.md AF 节），bench 同场验证无回归。

1. **页面级相关性守卫（fusion.ts keyTermPresent）**：域名权威提权前查 title/snippet/url 是否含查询关键 token（ASCII 最长词锚 / 纯 zh 最长 run / 子串 fail-open），缺失则提权清零+authorityGuarded 标注——治"s 档抬错页"（asyncio 题 MDN zh 教程页×3）。只压分不剔除，防误伤方向已验证（页面含 token 时 s 档照常生效，测试锁）。
2. **bench L2 判分窗 top-3→top-5**：前 3 全量抓保质量指标口径，L1 未解且前 3 未解才补抓 4/5，已解短路——route-packages 不再因 crates.io 排序波动误判。
3. **kind 补密度（authority.ts classifySourceKind）**：显式 kind > 域名模式 > 表缺省，ref.sourceKind 标注+vs-zai 两侧同尺；纯元数据不动排序（社区翻转仍只认显式 kind，测试锁）。

**第 12 轮 bench（9 题真网络）**：L1=9/9、**L1+L2=9/9**（r11 route-packages 8/9 脆弱性消除）；出勤均值 4.8；authorityHits 46；spamBlocked=7；耗时均值 1826ms（r10 1980ms）；清洗 100% 干净（nav 0.1/页）；fetch 18/27——失败仍是已知硬反爬集合（dl.acm/medium/reddit/sciencedirect/researchgate/realpython/earth.org 403）+1 个死链博客 404（latenode），诚实留档。
**zh 面第 5 采样**：5/5 vs 5/5 全 HIT；asyncio 题 core top5=docs.python.org/realpython/ruanyifeng/readthedocs/v2ex（守卫生效、MDN 错页零出勤进榜）；对方 csdn 中招 2 题（rust/docker），core 0。
**vs-zai 第 9 采样（quick 4 题）**：L1 4/4 vs 4/4；s 档 6 vs 4；权威命中 18 vs 9；kind 桶 2.0 vs 1.5（原 0.1）；uniqDom 8.3 平、Jaccard 0.41。
**测试**：234→241（keyTermPresent 6 断言块 + 守卫排序 2 + classifySourceKind 4 + arXiv 夹具真实形状修正）。

## 十六、AG-1/AG-2 扩源探针第 2 批 + 早收割延迟专项（Phase AG，2026-09-04，用户"继续扩充优化计划，然后继续做"）

**AG-1 扩源（探针 9 候选证实 2 项）**：pypi（`pypi.org/pypi/{name}/json` 包元数据直取，**ref.license 透传**=AG-4 落地；含空格/404 合法空零请求）+ hfpapers（HF Papers AI 论文面，嵌套 paper 形状，academic 腿 6→7）。诚实关账 7 项：openlibrary 两日两次网络失败/s2 仍 429/qwant 浏览器头仍 403/gitlab 403 挑战页/searchcode API 404 死亡/**gdelt 官方明文 1req/5s 节奏与全并行池+软截止结构性冲突**/ia 同 web.archive 沙箱不可达。`" paper"` 带前导空格路由词让 en 学术题进 academic 专线（newspaper/whitepaper 零误伤实测）。crates 改写链摘要补 license 行（AG-4）。
**AG-2 延迟专项（vs-zai 唯一持续输的维度）**：先量化（`scripts/ag2-latency-measure.mjs`，9 bench 同源题逐题逐腿）——**7/9 题打满 6000ms 软截止**（refs 已 12-20 条在手仍干等慢腿），坐实慢腿拖尾是 1.8-3.8s vs 1.0s 差距的结构性根因。修复=router 早收割：到 `earlyHarvestMs`（默认 1200ms，`SC_EARLY_HARVEST_MS` 可调 0=关）后若 **60% 腿已结算且 refs≥15**（证据足够）立即断慢腿交付；条件不满足继续等，软截止仍是无条件兜底（保守护栏，不是无脑砍延迟）。
**实测**：延迟量化 9 题均值 **4859→1663ms（-66%）**，7 题 6015→1223ms；单腿专线（crates 483/dockerhub 1086ms）不受影响（早收割只在多腿多证据时触发）。
**第 15 轮 bench（质量守门）**：L1=9/9、L1+L2=9/9 **零回归**；authorityHits 45/spamBlocked 5 持平；**bench 耗时均值 2270→1096ms（-52%）**；慢腿以 timeout 身份进 failed（契约保持）。
**vs-zai 第 10 采样（quick 4 题）**：L1 4/4 vs 4/4 平；s 档 6 vs 3；**延迟首次系统性反超——core 均值 819ms（383-1241）vs 对方 1034ms（963-1128 含冷启），4 题 3 题更快**；csdn 对方仍中招 1 题（core 0）；独占源 +23/+23 平。
**测试**：247→249（早收割触发 1 + 证据不足不触发 1；软截止既有测试暴露 abort 后微任务时序依赖，setImmediate 排空修复——旧 Promise.race 的隐式时序假设转显式契约）。

### 十六补：AG-3 权威表外置（同轮第三批）

四层表落 `core/data/authority/`：global.json(16 域)/topics.json(7 主题 188 条)/categories.json(10 类 200 条)/credibility.json(blocked 12+downweight 3)。`authority-dump.mjs` 从构建产物一次性导出（零转写错误），表政策注释住各文件 `_meta`。loader 逐条校验（坏条目跳过+告警）；整文件不可读→空表+loud warn。**设计细化诚实说明**：原计划"回退内置表"细化为 JSON 单一真源不保留代码副本——双源必有漂移，测试守门替代（新增"JSON⊆内存逐条一致"测试， tolerate 外挂覆盖测试的合法追加）。`" paper"` 外的检测关键词/kind 分类逻辑留代码。SC_AUTHORITY_JSON 外挂实弹复验仍最外层生效（外挂 s 档 1.2 + 内置 crates.io 1.2 + csdn 屏蔽三路全通）。bench 第 16 轮：L1 9/9、L1+L2 9/9、905ms。测试 249→250。authority.ts 497→337 行。

## 十七、第 17 轮 bench + 全量 24 题 vs-zai 对照三修复（Phase AH，2026-09-04，用户"进行更多题目的测试起码20道各个领域的题目"）

- **全量采样抓出三个结构性问题**（bench 9 题照不出来）：github 专项窄腿全灭 1ms 零结果（熔断冷却期无兜底）；images 专线 openverse 单腿合法空即塌方（throw 计熔断败）；arxiv/crossref 坐默认池对非学术题乱入 6+ 题（vs 对比 multi 子查询全中招，design top5×3）。
- **修复四件**：零结果抢救腿（健康聚合器兜底轮，attempted 过滤+软截止 3s 封顶+尊重 engines 配置+meta.rescued 透出）/ openverse 合法空 / images 车道聚合兜底腿 / arxiv+crossref 移出默认池（学术只走专线关键词路由，wikipedia 留池保 fact 出勤）。
- **bench r17**：L1 9/9 + L1+L2 9/9 零回归；enginesAvg 4.8→2.8（池精瘦）；学术 bench 题经专线照常出勤（arxiv+crossref+hfpapers）。
- **vs-zai 第 12 采样（24 题同尺复测）**：L1 23/24 vs 24/24；s 档 21 vs 21；权威命中 56 vs 39（1.4×）；csdn 0 vs 2；延迟 **557ms vs 1243ms（2.2×，24 题规模坐实反超）**；独占源 +5.8 vs +5.5；Jaccard 0.14（互补宇宙）。诚实短板：s 档进 top5 密度 12 vs 17（news/security/finance 正主第一率是下一个质量项）；images 题 searxng 实例质量波动留 1 miss。
- 测试 250→255 全绿；踩坑留档：ddg 限速门跨测试泄漏 → 测试注入 SC_DDG_MIN_INTERVAL_MS=0。

## 十八、phase AI：类目正主前排 + 检测召回补齐（第 13 采样，广度红线轮）

用户指令"继续优化但是确保广度不要被砍"——立项攻附录 F 留下的 s 档进 top5 密度短板（12 vs 17），红线：权威表只扩不缩、引擎池不精简换分、24 题全量当回归尺。

- **先量化（ai-top5-diagnose.mjs 入仓）**：core top-10 逐 URL 拆 lex/authority/残差 + 提升模拟找最小 delta。四根因：①detectCategory 生产路径失活（10 类目题 6 个运行时 null——评测尺题面指认掩盖了它，类目权威层根本没参与排序）；②类目 s 档 1.2 不够（dev.mysql 在池 #10 差 +0.9）；③AF 守卫单长锚误伤（rapid7 含 log4j+cve+44228 缺 "mitigation" 被清零——不清零即 #1）；④表缺口（europa.eu/厂商安全域/medlineplus）。
- **修复四件**：detectCategory 最长关键词胜出消歧+保守补锚 16 个（误伤审计 13 条全过）/ CATEGORY_S_FRONTROW=2.0（只动命中类目表 s 档，守卫+cap 照常）/ 守卫多证据放行（≥2 其他 token，AF 回归锁全过）/ categories.json +11 条/1 升档。
- **bench r18**：L1 9/9 + L1+L2 9/9 零回归（1017ms，enginesAvg 3.1，clean 100%）。
- **vs-zai 第 13 采样（24 题同尺）**：L1 **24/24 双满分**；s 进 top5 **20 vs 20 追平**（12 vs 17→追平）；s 档 27 vs 25 反超；权威命中 68 vs 46（1.48×）；csdn 0 vs 2（主动屏 14）；延迟 699 vs 1389ms（2×）；独占源 +5.9 vs +5.3、uniqDom 7.7 vs 7.1、Jaccard 0.15——**广度指标全部不降**。education 面"双方都差"→我方明显胜（khan s=7/top5s=5）；zh-legal 官方 gov.cn 包揽 top-3；finance federalreserve #1。
- **诚实剩余**：news/security 官方源召回面差距（cisa/nvd/europa.eu 不被 keyless 池返回——融合层只能排池内，召回面按架构指令冻结）；mysql 题 top5s 未翻同因（在池即 #1，模拟实证）；检测补词是保守集，zh 药名类长尾仍漏。
- 测试 255→263 全绿；踩坑留档：分数拆解断言必须逐项扣除 RRF/lex/titleBonus，"排名碰运气"断言在精确同分时按插入序翻车。

## 十九、phase AJ：security/news 专线 + CVE 元数据三腿（第 14 采样，召回差距加法修复轮）

> 攻第十八节诚实剩余①「news/security 官方源召回面差距」。架构纪律下的加法路径：planner/router 冻结，**扩源=加引擎**（召回面从"池里没有"变"池里有腿直取"），融合排序零改动，广度红线全程守。
- **探针第 3 批（probe-aj-sources.mjs 入仓，7 候选 5 过）**：NVD cveId 精查✅（暖 1.1s/冷启 7.4s 方差，滚窗 5req/30s）/ OSV GET /v1/vulns/{id}✅（315ms；POST /v1/query 按 id 是 400）/ GitHub Advisory✅（470ms 免 key 60/hr）/ GoogleNews RSS 复验✅（549ms）/ BingNews RSS✅（351ms，apiclick 内嵌 url= 真实出版方链接可解码）/ CISA KEV feed❌（DC IP HTML 挑战页，qwant 同案关账）/ NVD keywordSearch❌（整句 totalResults=1 精度差，诚实不硬凑）。
- **修复四件**：①CVE 元数据三腿 nvd/osv/ghsa（pypi 纪律：CVE-\d{4}-\d{4,7} 编号直取，无编号合法空零请求，404/空数组合法空，ref=官方详情页）；②security lane（表尾，三腿+聚合兜底防窄腿塌方，锚 13 个保守集）；③news lane（表尾，googlenews 零 item 改合法空+bingnews url= 解码，+聚合兜底；" news " 双空格独立词防 newsletter 误配、"最新进展"故意不收防学术劫持）；④detectCategory 医疗锚 +12（zh 药名长尾诚实剩余②，跨类冲突靠最长胜出消歧）+ categories.json security +osv.dev(s)。
- **bench r19**：L1 9/9 + L1+L2 9/9 零回归（enginesAvg 2.9）。
- **vs-zai 第 14 采样（24 题同尺）**：L1 **24/24 vs 23/24 连续双满分**；s 档 **31 vs 24**；**s 进 top5 22 vs 19（r13 追平→首次反超）**；权威命中 69 vs 47（1.47×）；csdn 0 vs 2；延迟 912 vs 1378ms（1.5×）；独占源 +5.6 vs +5.5、uniqDom 7.4 vs 7.2、Jaccard 0.15——广度指标持平守住（表 +1/0 删、默认池不动、lane 全加法）。**逐面兑现：news 题 europa.eu 官方域 top1（googlenews lane 出勤）、security 题 osv.dev top1（CVE 三腿直取）——附录 G 召回差距正面闭环**。
- **诚实剩余**：cisa.gov 官方页仍未直接进我方 top5（KEV feed 挑战页关账，只能靠聚合器间接）；security 题 top2-5 兜底腿 yahoo 泛页面波动（top1 正主在但深度不稳）；mysql 题 dev.mysql 池外留档同前；检测锚保守集继续 SC_AUTHORITY_JSON 外挂兜底。
- 测试 263→**276** 全绿。踩坑留档（工具级）：会话输出管道把 `[m`（数组首元素 m 开头的字面量，如 [marginalia）当 ANSI 序列吃掉——rg/sed/python print 全中招，**写层无损读层有损**，hex 级检查才现形。

## 二十、phase AK：domainCap 注册域粒度修复（第 15 采样，霸屏治理补漏轮）

> 第 14 采样 security 题暴露：domainCap 按 hostname 计数，sports/baseball/weather.yahoo.co.jp 三个子域各领配额 → yahoo.co.jp 集群×4 绕过 cap=3（v0.8 治理意图是"单源霸屏"，子域集群=同一来源）。
- **修复**：fusion.ts `registrableDomain()`（近似 eTLD+1：两级 TLD 白名单 co.uk/co.jp/com.cn/gov.cn 等 30 项取三段，其余取两段，www 剥离），cap 循环改按注册域计数。诚实边界：github.io/blogspot.com 跨用户子域共享 cap=3（免费平台 junk 集群常见，收紧方向正确）；未收录两级 TLD 并段近似可接受。
- **回归**：测试 276→278（registrableDomain 单元 ×1 + yahoo 集群 cap=3 回归锁 ×1；既有 MDN 同主机霸屏锁不冲突）；bench r20 L1 9/9 + L1+L2 9/9 零回归（enginesAvg 3.8）。
- **第 15 采样（24 题同尺）**：security 题 yahoo 集群消失、osv.dev top1 保持；L1 23/24 vs 24/24（阿司匹林题本轮池波动 miss——top5=zhihu×3+rainwear 雨衣店×2，top10 零医疗权威页可提权，r13/r14 均 HIT，非回归诚实留档）；s 档 28 vs 26、权威命中 70 vs 49（1.43×）、延迟 585 vs 1231ms（2.1×）保持；uniqDom 6.9 vs 7.3 微输 0.4（security 题 9→3 是 cap 挤掉虚增集群的直接效应，历史波动带 6.9-7.7 内）。广度红线：cap 收紧方向=真多样性↑。

## 二十一、phase AL：data 类目表 +5 官方统计机构（第 16 采样，表缺口修补轮）

> 第 15 采样 data 题诚实观察：「top5 有 wikipedia/dev.to 泛面（worldbank 官方 2 条在 top10 内）」——根因是 data 类目表缺 worldbank.org，frontrow 无从生效。一批补齐国际官方统计机构（第一方正主原则，非为单题刷表）：worldbank.org/imf.org/oecd.org/census.gov（s）+ stats.gov.cn（s, lang:zh zh 查询才生效）。表 +5/0 删。
- **第 16 采样（24 题同尺）**：world bank 题 datahelpdesk.worldbank.org 进 **top1**（frontrow 2.0 生效，泛面让位）；L1 **24/24 vs 24/24 双满分**（阿司匹林题回 HIT——r15 miss 坐实池波动）；权威命中 71 vs 58（1.22×）；延迟 1158 vs 1394ms；uniqDom 7.3 vs 7.2、Jaccard 0.15。诚实记录：本轮 zai 池强（s 档 34 vs 29、top5s 26 vs 22 对方反超）——keyless 池轮间波动双向存在，权威命中/广度我方保持，结论只谈方向。
- bench r21：L1 9/9 + L1+L2 9/9 零回归；测试 278。

## 二十二、phase AM：词典/医学研究/数据 类目官方面（第 17 采样，探针第 4 批轮）

> 用户"继续，我不会给智谱key"——智谱侧确认走内置 CLI 免 key 路径不受影响；本批主线=类目面 keyless 官方 API 补齐（AJ 加法扩源路线续批）：类目（词典/医学/数据等）此前在 DOMAIN_TABLE 无 lane，召回全靠 generic 池。
- **探针 10 候选 4 过 6 关**（probe-am-sources.mjs + probe-am-retry.mjs，原始 /tmp/phase-am）：✅wiktionary（en+zh 双语 854ms）/✅europepmc（hitCount 2 万级 961ms）/✅clinicaltrials（NCT 直链 295ms）/✅worldbank（指标直取 428ms）；❌dictionaryapi（2/2 超时）、❌SEC EDGAR（403 挑战页，CISA 同案）、❌Google Books（免 key 429 配额枯竭）、❌s.jina.ai（401 强制 key，诚实复核）、❌searxng 扩实例（6 候选 0 过全 Anubis 挑战页/429）、❌mysql docs（403 挑战页，top5 池外留档维持）。
- **三 lane 落地**（表尾零劫持）：dictionary=wiktionary（CJK 查询→zh.wiktionary，零命中合法空）/ medical=europepmc+clinicaltrials（研究意图腿）/ data=worldbank（指标码×国家码小保守映射直取，pypi/CVE 纪律：未知指标合法空**零请求**）；均带聚合兜底腿防塌方。防劫持审计：词典锚不收裸"定义/define"（编程题表序先行）；医学锚只收研究意图（clinical trial/随机对照…），药名/副作用题**不进线**（归 generic 池+medlineplus 提权——保 zh 健康内容广度）；数据锚只收强官方统计意图。表只扩不缩：dictionary +wiktionary.org(s)、medical +clinicaltrials.gov(s)+europepmc.org(a)，+3/0 删。注册 43→47。
- **回归**：测试 278→**292 全绿**（golden×10+lane 锁×6 含防劫持双向锁）；bench r22 L1 9/9+L1+L2 9/9 零回归（enginesAvg 3.4）；medical lane 24 题外实弹：metformin 研究题 europepmc **top1**×3 进 top5+clinicaltrials 出勤（1020ms 10 refs）。
- **第 17 采样（24 题同尺）**：L1 23/24 vs 24/24；s 32 vs 34、s+a+b 52 vs 51、authorityAny 223 vs 193（1.16×）——本轮 zai 池强（诚实记录，方向性结论）；延迟 871 vs 1500ms（1.7×）保持；**广度四指标持平**：uniqDom 7.2 vs 7.0、独占源 +5.5 vs +5.3、kind 1.6 vs 1.7、Jaccard 0.15 不变。逐面：**dictionary 题 en.wiktionary.org top1（×3 进 top5）**、**data 题 data.worldbank.org top1**（lane+frontrow 链路双兑现）。
- **诚实留档**：images 题（unsplash pexels api comparison）miss——openverse 对该题面合法空（AH 已留档根因）+公共 searxng 实例垃圾轮换（三次复现三套不同垃圾：法院站/YouTube 支持/nperf），坐实**波动性失败非确定性回归**（AM 未触碰 images 面），r12-r16 的 HIT 窗口=openverse 返窗期，同 r15 阿司匹林题先例。

## 二十三、phase AN：images 车道加腿 + images 主题表补正主（r17 诚实留档闭环轮）

> r17 诚实留档的 images 题波动 miss 双闭环：① laneLegProviders images +keenable 第 4 兜底腿（免 key 独立索引；兜底双腿同时掉链不再整题塌方）；② topics.json images 空占位表 +unsplash.com/pexels.com/pixabay.com 三条 s（第一方图库平台，表只扩不缩）。零召回面改动（加腿+加表双加法，AI/AE 先例）。
- **实效**：images 题 top1=unsplash.com/developers、top2=pexels.com/api；单题正式采样 core=HIT/zai=HIT（465ms）；结果面从法院站垃圾换血为高相关 API 对比内容。
- 回归：测试 292 全绿；bench r23 L1 9/9+L1+L2 9/9 零回归。
- **第 18 采样（24 题全量同尺）**：L1 **24/24 vs 24/24 双满分**（AN 修补全量坐实）；延迟 772 vs 1847ms（2.4×）；uniqDom 7.2 vs 7.2、Jaccard 0.16 广度持平；s 32 vs 36（zai 池强窗口，方向性）。挂账「GitHub 仓库级二次判断」诚实关账——待办池清零。
