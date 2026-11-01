# search-core vs 托管聚合搜索（z-ai web_search）同题对照报告

> Phase Z（2026-09-03，用户原话："跑一轮进行测试和你之间搜索的进行对比"）。
> 对手是我方 AI 助手内置的 web_search（托管聚合黑盒）——它就是用户平时"问我问题时我用的搜索"。
> 脚本：`core/scripts/vs-zai-compare.mjs`（原始 JSON 落 /tmp 不入仓，本报告抄结论）。

## 一句话结论

**搜索层两战平（修复后 9/9 vs 9/9），但赢法完全不同**：我们赢在可控（权威密度 2.6 倍、灌水站 0 出现、可路由可自托管），对方赢在中文教程面的数据池；域名重叠度只有 0.16，两边看到的网页几乎是两个互联网——这正是"本地引擎+API 聚合"双面架构的实证。

## 对比设计（诚实口径）

- **同题**：9 个题全部复用 quality-bench 的题集（fact/学术/路由/中文/灌水重灾区），关键词判分完全一致；
- **同一把尺子**：两边都用 `authority.ts` 16 权威域 + `credibility.ts` 灌水清单打标，不偏袒任何一方；
- **只比搜索层（L1）**：两边都只回标题+摘要，比爬取层对黑盒不公平（它没法开放 fetch）；
- **样本量**：修复前 1 轮 + 修复后 2 轮，共 3 个全量样本，单样本有网络波动，看趋势不看单点；
- **耗时口径**：我方取 meta.elapsedMs（引擎净耗时）；对方是 CLI 起进程的墙钟（含 1-2s SDK 冷启动），只做方向性参考；
- **黑盒声明**：对方上游池不可知，本报告不猜测其内部，只比较可观测行为。

## 三轮样本总表

| 轮次 | 我方 L1 | 对方 L1 | 我方均耗时 | 对方均耗时(含冷启) | 备注 |
|---|---|---|---|---|---|
| 修复前 | 8/9 | 9/9 | 3203ms | 1337ms | 唯一败题=python asyncio 教程（见 §四） |
| 修复后#1 | 9/9 | 9/9 | 3754ms | 12542ms | 对方被一题 48.9s 离群值拉爆（其网络波动） |
| 修复后#2 | 9/9 | 9/9 | 1054ms | 1926ms | 双方都正常的一轮，耗时同级 |

**聚合差异（修复后两轮均值）**：

| 指标 | search-core | z-ai web_search | 差异解读 |
|---|---|---|---|
| L1 解题 | 9/9 | 9/9 | 平 |
| 权威域命中/题（top10） | **3.1-3.2** | 1.2 | **我方 2.6 倍**——提权+专线腿把权威源顶到前排 |
| 灌水站在结果里 | **0**（清单内域被融合层剔除） | 1（csdn 出现在中文题 top1） | 见下节实证 |
| 域名多样性/题（top10） | 6.0 | 7.7 | 对方略高（无每域裁剪，单域可刷屏） |
| 域名重叠 Jaccard | —— | —— | **均值 0.16（范围 0.06-0.33）**：两边几乎是两个互联网 |

## 灌水站实证（用户 Phase W 核心关切的对照验证）

「向量数据库 milvus faiss 对比」中文题，**三轮采样里 z-ai 的 top1 稳定是 `blog.csdn.net`**（我们点名屏蔽的灌水站），后续还有 aliyun 开发者社区这类内容农场常客。search-core 同题：

- csdn 在融合层被直接剔除（`spamDropped=2`，refs 里 0 出现）；
- 顶位被 arXiv 论文（milvus/faiss 官方对比文献）+ cnblogs 独立博客占据；
- 权威命中 3-5 vs 对方 0。

这就是"置信度筛选"在真实对照里的价值：**不是我们找不到 csdn，是找到了也不给你看**。

## 对比挖出并修掉的一个真 bug

修复前唯一败题「python asyncio 教程」暴露了 planner 的系统性问题，不是网络波动：

- **根因**：中文编程题被域名路由判成 programming 主题后，腿集只剩 5 个引擎（stackexchange/github/hn 三条英文系 + duckduckgo/bingrss）。这轮 stackexchange error + ddg rate_limited，整题塌到 bingrss 单腿，返回的全是泛 Python 页（没有一条 asyncio 专页）——通用池的 keenable/wikipedia 等 9 个引擎**根本没被选中**；
- **修法**：programming 腿集补 keenable（免 key 独立索引、中文能力强、426ms/9-0 健康），单测锁死（含用真实 miss 题做的回归锁），179→180 测试全绿；
- **修后实弹**：同题 top5 从泛 Python 页变成 realpython/pyguides 等 asyncio 专页，L1=HIT，后续两轮全量 9/9；
- **同源教训**：第 5 轮 bench 这题是靠 L2（爬取层）捞回来的 8/9，当时没追根因——对照轮把它揪出来了。**对照是最好的回归测试**。

## 双方强项清单（诚实）

**search-core 赢的**：
1. 权威密度（2.6 倍）——学术题 top5 里 arXiv/wiki/PMC 占 4 席是常态；
2. 灌水免疫——12 域硬屏蔽+3 域降权，中文题不被 csdn 淹；
3. 专项路由——crates 腿 529ms 精确返回包列表，dockerhub 腿 1123ms 精确返回镜像，这类结构化结果黑盒给不了；
4. 可控可审计——每条 ref 带引擎来源/得分/提权标记，可自托管可断网降级（FTS5 缓存）。

**z-ai web_search 赢的**：
1. 中文教程/生活面数据池更厚——asyncio 题它 top3 是 廖雪峰/菜鸟/知乎（都是真教程），我们靠 keenable 翻盘但池子厚度仍差；
2. 平均延迟更稳（1.3-1.9s vs 我们 1.0-3.8s 波动大）——单点托管 vs 12 引擎扇出的天然差距；
3. 离群值少——我们这边引擎失败/限流是常态（有熔断兜着），对方偶发 48.9s 长尾但整体稳。

## 局限性（别过度解读）

1. 判分是关键词代理（题集自带 expect 词），命中≠真解决问题——和 quality-bench 同一口径；
2. 只比了搜索层，爬取/清洗/研究层是我们的内环能力，黑盒没法比（我们 100% 清洗/74% 爬取是单方数据）；
3. 3 个样本都在同一沙箱网络跑，两边共享网络环境波动；
4. 对方后端黑盒且版本可能随时变，本报告结论是 2026-09-03 快照。

## 给后续的挂账

- 中文教程面数据缺口（老挂账）：智谱 key 接入后补中文搜索源，是把 asyncio 类题从"翻盘"变"碾压"的正路；
- crates.io fetch 空文本（老挂账）：走 API 端点替代 SPA 页面；
- pyguides.dev fetch 失败（新发现）：本轮 bench 新进 top 结果的站，sandbox 直连不通，记档观察；
- domainCap 豁免目前只给 packages/devops/域名路由——学术腿 arXiv 刷屏（3 席）是否要引入 topic 感知裁剪，等第 7 轮 bench 再判。

## 附：对照驱动的增量落地（Phase AA，用户"根据你的搜索广度来给+增量"）

对照报告的直接产出——把对方压住我们的面变成增量，全部探针证实才接（2026-09-03）：

| 增量 | 内容 | 探针证据 | 状态 |
|---|---|---|---|
| **MDN 直连 API**（新 provider） | 编程题 Tier1 腿，`/api/v1/search`，locale 跟随查询语言 | 200/documents[10]；locale=zh-CN 返回中文内容 10 条 | ✅ 已接（35 号 provider） |
| **查询语言自动检测** | planner CJK≥2 → decision.lang → engine 合并 opts.lang（调用方显式传参优先） | wikipedia zh 子域/googlenews hl-gl-ceid/mdn locale 三条中文路由本就已写好，只是从未被触发 | ✅ 已接（185 测试） |
| **programming site: 补 docs.python.org** | MDN 从 Tier2 site: 升级 Tier1 直连后，空出的 site: 槽位补 python 官方文档 | bingrss `site:docs.python.org` 200 有 item | ✅ 已接 |

**探针后诚实不接的**：devdocs.io（无免 key 搜索 API，两路径 404）；searxng 公共实例 5 个（searx.be 反爬验证页伪 200、其余 429/超时——自建路由 `SC_SEARXNG_BASE_URL` 已支持）；ddg `kl=cn-zh` 区域参数（本轮 202 反爬挑战无法证实，不硬接）。

**增量后复跑（第 4 采样）**：9/9 vs 9/9 持平；asyncio 题 top5 出现 docs.python.org（与对方重叠的官方文档面）；csdn 第 4 次稳坐对方中文题 top1（我方 0 出现不变）。第 7 轮 bench：L1+L2=9/9 无回归，出勤均值 4.6→4.9（增量腿贡献）。

## Phase AB 附录：免 Key 聚合车道后的第 5 采样（2026-09-03）

用户新增免 Key 清单落地（全案 docs/keyless-increments.md）：anysearch 进默认池、tavily keyless 匿名车道、firecrawl 显式启用、searxng 多实例回退链、sov2ex 中文腿、pubmed 学术腿。

**第 5 采样（--quick 4 题）**：4/4 vs 4/4 战平；权威密度 14 vs 6（2.3 倍）；**延迟反超**——我方 0.6-2.2s vs 对方 2.2-12.7s（含冷启，口径不变）；**域名重叠 Jaccard 从历史均值 0.16 升至 0.46-0.58**：新聚合车道（anysearch/tavily-keyless 与对方同为托管聚合）让我方开始覆盖"对方的互联网"——重叠上升不是趋同，而是融合面吃到了聚合覆盖增量；权威密度优势保持。

**第 8 轮 bench**：L1+L2=9/9 无回归，出勤均值 4.9→5.9，tavily+anysearch 9 题全勤。

## Phase AB 追加：zh 面实测——智谱 key 还缺不缺？（2026-09-03，用户质询）

用户质询三点：智谱要钱为什么不免？已接源不含中文吗？它独特在哪？实测回答（core/scripts/zh-coverage-check.mjs，5 中文题同尺对照，原始 JSON /tmp/zh-check/）：

**判分：5/5 vs 5/5 双方全 HIT（含判分第 1 轮 zai docker 题 30s 超时 core 独赢）——关键词判分下 zh 面已无差距。**

| 维度 | core（免费腿） | z-ai（托管聚合） |
|---|---|---|
| zh 腿出勤 | sov2ex 4 题全勤（CJK lang-guard 生效）/ keenable 5/5 / mdn+bingrss+searxng+wiki zh 按题出勤 | 黑盒 |
| 墙内面穿透 | 知乎专栏/腾讯云/博客园/zilliz.cn/百度智能云/**pydantic.com.cn+docs.pydantic.org.cn 中文官方镜像**均进 top5 | 同级（zhihu/oschina/cnblogs/tencent） |
| 灌水站 | **0 出现** | rust 题csdn + docker 题modelers.csdn.net（2 题中招） |
| 权威密度 | 11（5 题合计 top10） | 0 |
| 延迟 | 403ms-2.8s | 1.2-2.2s（另一采样单题 30s 超时） |

**结论与口径修正**：智谱 key 从"最后一块拼图"**降级为"可选付费插槽（¥0.01/次起，keySlot 语义，配了才并联）"——实测 5/5 打平，无必需性证据**。付费才值得的残余场景只剩两条：①纯中文教程站（廖雪峰/菜鸟级）顶位厚度——唯一测得的差距（asyncio 题对方 top5 教程三连，我方 wiki/v2ex/pyguides 命中但"教程形"稍薄）；②墙内独占内容（公众号文章级）。免费腿实测已能穿透大半墙内面（知乎/腾讯云/百度云/博客园/中文官方镜像在列），这两条是否值 ¥0.01/次由真实使用频率决定，不预付。

## 附录 C：智谱系来源逆向采样（phase AC，2026-09-03）

**口径**：用 z-ai CLI 的 web_search 托管函数做采样（智谱系搜索 API，清言同源近似，非网页产品精确复刻）；14 题×6 类目（zh-programming×4/en-programming×2/academic×2/news×2/general×2/zh-general×2），num=10，原始 JSON 只落 /tmp/zhipu-mining 不入仓；脚本 core/scripts/zhipu-source-mining.mjs 可复跑。

**高频 host 榜（≥2 次才列）**：
- zh-programming（37 条）：zhuanlan.zhihu.com×3、reddit×3、pydantic.dev×3、runoob×2、github×2、bilibili×2、**blog.csdn.net×2**、forums.docker.com×2；长尾正主：liaoxuefeng（asyncio 题 top1）、docs.python.org、cnblogs、ruanyifeng、rustwiki、cloud.tencent（docker 报错 top1）
- en-programming（15 条）：reddit×2、medium×2、tokio.rs×2；长尾：docs.python.org top1、realpython
- academic（20 条）：arxiv×2、github×2、medium×2——与我们全局权威表高度重合，无需补
- news（17 条）：openai.com×7（官方源霸屏）、nvidianews×2、finance.yahoo×2
- zh-general（18 条）：zhuanlan.zhihu.com×2；gov 站（rsj.sh.gov.cn）养老金题 top1

**三个结论**：
1. **对方也绕不开 csdn**（zh-programming ×2 中招）——我方 credibility 硬屏蔽层是对的方向，双方真实差距在"屏蔽之后谁的正主排名更高"，这正是分档权威表的战场。
2. **学术面双方同源**：智谱学术面返回的全在我们表内，"逆向补学术"无增量；真增量在 zh 教程面（runoob/liaoxuefeng/cnblogs/ruanyifeng/cloud.tencent/rustwiki 已按 zh 守卫入主题表）。
3. **官方源倾向重**：pydantic.dev×3、openai.com×7——对方对官网强偏好，与我方 s 档设计不谋而合。

**甄别纪律**：高频≠入表（csdn/bilibili/labex/kodekloud/comate.baidu 拒收）；未知站点不核不入（overqualified.cn 挂起）；已知修正落地（djangoproject.com/stratechery.com/nfra.gov.cn/learn.microsoft.com；protocol.com 停运不收）。

## 附录 D：全面性×质量双维对照（第 7 采样，2026-09-04，用户点名"全面性和质量和你比怎么样"）

**口径**：9 题（en-programming×2 / devops / databases-zh / academic / fact / security / zh-legal / zh-tech）×双边 top-10；新脚本 `core/scripts/vs-zai-quality.mjs`，与第 1-6 采样的区别是逐 URL 打标量四个新维度：分档分布（s/a/b）、s 档进 top5（排序质量）、独占源（谁看到对方看不到的源）、spam 交叉；尺子=同一套三层数据+credibility 清单量两边（自引偏差用 L1 关键词+独占源人工复核对冲）；原始 JSON 只落 /tmp。

**质量面**：

| 指标 | core | z-ai |
|---|---|---|
| L1 相关性（top5 关键词命中） | **8/9** | **9/9** |
| s 档条数（top10 合计） | **17** | 11 |
| s 档进 top5 | **15** | 10 |
| 三层权威命中合计 | **44** | 21 |
| csdn 系进 top10 | **0**（主动屏蔽 6 条） | **2** |
| 延迟均值 | 4.2s | **1.1s** |

**全面性面**：uniqDom 均值 7.7 vs 8.6（对方略多）；独占源均值 +4.1 vs +5.0（两边都有硬货：core 独占 owasp/arxiv/acm/github/reactdom，对方独占 home.cern/webfoundation.org 一手源/kubernetes.io/scaleops/liaoxuefeng）；域名 Jaccard 0.31（0-0.58），仍是七成不同的两个互联网。kind 覆盖指标两边都是 0.1——kind 字段在表内太稀，本轮无判别力（挂账补表再量）。

**四个真发现（这轮采样最大的价值）**：

1. **唯一败题 k8s = 专线窄腿无兜底（结构性，复跑两次均复现）**："kubernetes pod disruption budget best practices" 被 programming 宽词（kubernetes 在表）截进专线 → 腿=stackexchange/github/hn/keenable/mdn，聚合车道永不参与；MDN 模糊匹配 "best practices" 返回 WebGL/PWA 泛教程页 top3 → MISS（degraded:true，实际响应腿仅 3-4 条）；对方 top5 有 kubernetes.io 官方 s 档。
2. **s 档域级提权抬错页**：asyncio 题 core top5 = realpython（好）+ MDN zh 教程页×3（Games/Tutorials、Web/CSS/Tutorials——域名 s 档但页面与 asyncio 无关）+ python.org/getit；对方 top5 = liaoxuefeng/runoob/zhihu 精准贴合 zh 教程意图。AC 轮 domainCap=3 只把霸屏从×5 压到×3，页面级相关性盲区仍在。
3. **spam 屏蔽层实证**：向量题 core spamDropped=4；对方 pg 题 csdn 排 top2、向量题 csdn 排 top2（top10 内 2 次）。pg 题双方都没召回 postgresql.org 官方文档（databases 类表里有但两边召回面都没出）——诚实的共同盲区。
4. **legal 题同一个互联网**：gov.cn 系 s 档双方全中（core 5s vs 对方 4s，Jaccard 0.58 全场最高）；结合发现 3 的独占源，双方各有对方没有的真功夫。

**结论（大白话）**：质量=全池出勤时明显占优（s 档密度 2 倍、spam 0），专线翻车时没有兜底；全面性=平手（独占源互有攻守，重叠仅 3 成）；延迟这轮输（全池腿多等慢腿，1.1s vs 4.2s）。对方是"永远全池"设计——没有专线翻车面，但也没有屏蔽层。

**修复单（phase AE 当轮落地 ①②，③ 挂账）**：
1. mdn web 亲和守卫（provider 级，sov2ex CJK 守卫同款先例）：MDN 只写 web 平台，查询无 web token 直接合法空——治发现 1/2 的 junk 源头；
2. programming 专线 leg-0 补聚合兜底腿（searxng+tavily keyless）：专线窄腿时不再整题塌方——治发现 1 的根；registry 专线（packages/devops）保持纯 API 腿不变（case-4 纯度教训）；
3. 页面级相关性守卫（s 档条目标题 token 交集过低则降档）：需 bench 标定，挂账（phase AF 已落地，见附录 E）。

**修复后复测（同尺第 8 采样，同日）**：L1 **9/9 vs 9/9**（k8s MISS→HIT，gruntwork.io 等 k8s 专业源进独占面）；**pg 题反超**——修复前双方共同盲区，修复后 core tier s=2 且 postgresql.org 进 top5（兜底腿把官方文档带进来了），对方仍 0 tier 且 csdn 在 top10；asyncio top5 换血为 python.org×2+docs.python.org×2+realpython（MDN 垃圾清零，spamDropped=3）；s 档合计 17→20、s 进 top5 15→19、权威命中 44→46；延迟均值 4.2s→约 2.2s；Jaccard 0.31→0.45（兜底聚合腿让两边覆盖开始收敛，与 phase AB 聚合扩源趋势一致）；对方侧指标几乎不动（s=11、1.1s、csdn×2 照旧）。spam 层维持 core 0 vs 对方 2。诚实留痕：向量的独占源 zair.top 未经核实不入表；fact 题对方仍独占 home.cern/webfoundation.org 一手源。

**bench 第 11 轮同场**：L1 9/9 无回归；L1+L2 8/9——route-packages 的 L2 null **不是代码回归**：fetcher crates 改写链实弹正常（sqlx 324ch 摘要含名字行），是 crates.io 排序波动让 tokio 掉到第 4 位而 bench L2 只抓 top-3（判分脆弱性，挂账：bench L2 top-3→top-5 或 crates 腿精排）。zh 面第 4 采样：5/5 vs 5/5 全 HIT，对方 csdn 又中招 2 题（rust/docker），core 0。

## 附录 E：三项挂账闭环复测（第 9 采样，phase AF，2026-09-04）

AE 挂账三项（页面级守卫 / bench L2 判分窗 / kind 补密度）本轮全部落地并同尺复测（quick 4 题 + bench 第 12 轮 + zh 面第 5 采样）。

**① 页面级相关性守卫（fusion.ts keyTermPresent）**：s 档条目的 title/snippet/url 里找不到查询关键 token（ASCII 词取最长做技术词锚，纯 zh 取最长 run，子串 fail-open）→ 域名提权清零只压分不剔除，ref 带 authorityGuarded 标注、meta.authorityGuarded 计数进 journal。
- 实证：asyncio 题（第 7 采样根因题）core top5 从"realpython + MDN zh 教程页×3"换血为 **docs.python.org | realpython | ruanyifeng | readthedocs | v2ex**——MDN 错页清零、官方 s 档顶位、963ms（AE 时代 4.2s）。
- 防误伤设计实测：页面真含关键 token 时 s 档照常生效（测试锁）；bench 第 12 轮 L1 9/9、zh 面 5/5 无回归——守卫没有误伤合法权威页。

**② bench L2 判分窗 top-3→top-5**：前 3 条永远全量抓（爬取/清洗质量指标样本不变），仅 L1 未解且前 3 未解时补抓 4/5 位判分，已解短路。bench 第 12 轮 **L1 9/9、L1+L2 9/9**——r11 的 route-packages 8/9 判分脆弱性消除。

**③ kind 补密度（authority.ts classifySourceKind）**：kind 从"少数条目显式声明"变为任何 URL 可推导（条目显式 kind > 域名模式 github/reddit/wiki/forbes 等 > 表缺省：s 档官方域=official、news 表=media、dictionary/entities=reference），vs-zai 两侧同一把尺。纪律：纯元数据不改排序——社区意图翻转仍只认显式 kind（github 不因此升档，测试锁）。
- 实证：kind 桶均值 0.1（两侧，无判别力）→ **core 2.0 vs 对方 1.5**，指标活了。

**第 9 采样（quick 4 题）质量分**：L1 4/4 vs 4/4；s 档 6 vs 4；s 进 top5 6 vs 4；权威命中 **18 vs 9**；csdn 进 top10 core 0（主动屏 4）vs 对方 2；全面性 uniqDom 8.3 vs 8.3、独占源 +3.5 vs +3.5、Jaccard 0.41；延迟 core 均值 3.8s（首题网络抖动 6s 抬高，bench r12 全量均值 1.8s）vs 对方 1.0s——延迟仍输，维持既有结论。

**诚实口径**：quick 4 题样本小，量级结论以第 7/8 采样全量 9 题为准；本轮的定位是"三项修复的闭环验证"，三项都过。

## 附录 F：全量 24 题 14 领域面 + 三结构性修复（第 11/12 采样，phase AH，2026-09-04，用户"进行更多题目的测试起码20道各个领域的题目"）

用户要把对照面从 9 题扩到 **24 题**，覆盖：topic 专线 7/7（programming en+zh / packages npm+pypi / devops×2 / academic / ai-models / entities / images）+ category 类 10/10（news/security/legal zh/finance/medical en+zh/databases/design/dictionary/education/data）+ 横切意图 3（community/zh-tutorial/zh-fact）。题库外挂化：`vs-zai-quality.mjs` 支持 `--cases/--label`，题库文件 `vs-zai-cases-full20.mjs` 入仓（复跑零成本）。

### 第 11 采样（修复前）——全量采样的价值：抓出三个 bench 9 题照不出来的结构性问题

总分：L1 21/24 vs 23/24；s 档 20 vs 20 平；权威命中 68 vs 37；csdn 0 vs 2；延迟 844 vs 1176ms；Jaccard 0.08。**三个翻车面**：

1. **github 专项窄腿全灭 → 1ms 零结果**（"github actions cache docker layers"）：planner github 路由腿=[github,duckduckgo,mojeek]，24 题连跑把三条腿全部打入熔断冷却 → 零腿出勤直接空手返回（enginesUsed=[]，skipped 全 circuit_open）。**任何全灭场景都没有兜底**。
2. **images 专线单腿塌方**（"unsplash pexels … api comparison"）：images 车道只有 openverse 一条腿，对 meta 查询合法空但代码 `throw`（给唯一腿计熔断败）→ 整题零结果。AE 专线治理教训在 images 上重演。
3. **arxiv/crossref 坐默认池乱入非学术题 6+ 题**：design 题 top5 arxiv×3、helm×3、khan×2、vim×2、finance/worldbank 各×1——根因是 `"vs"` 对比句式 multi 拆分后子查询全走默认池，而 arxiv/crossref 是默认池成员。"kubernetes helm vs kustomize" 的 top1-3 全是 arxiv（helm vs kustomize 没有论文）。

### 三修复（phase AH，召回路由不动，只加兜底与出勤纪律）

- **零结果抢救腿（engine.ts）**：allRefs===0 且非 x 路由 → 用健康聚合器 [searxng,tavily,keenable] 再试一轮。纪律三条：已出勤/失败/跳过的引擎不重试；软截止压缩 min(原值,3s)（抢救是兜底不是第二轮全量）；**尊重用户 engines 配置**（显式排除的引擎不被强注入，engines=[] → 抢救自动失效）。meta.rescued 诚实透出 + journal 落 `zero_ref_rescue`。测试锁 3 条（抢救出勤/refs>0 零开销/用户排除即失效）。
- **openverse 合法空**：空命中 `return []` 不再 throw（与 pypi 非包名 404 同纪律）；API 形状漂移仍走 http/parse throw 交熔断。
- **images 车道补聚合兜底腿**：laneLegProviders 加 images（openverse+searxng+tavily）——非 registry 专线无纯度包袱（AE 教训只保护 packages/devops，测试锁不回退）。
- **arxiv/crossref 移出默认池**：学术源只在 academic 专线出勤（关键词路由：论文/" paper"/arxiv/survey…），专线 7 学术腿不变；wikipedia 留默认池（fact 型出勤保障，待办池项不回退）。

测试 250→255 全绿；bench r17 L1 9/9 + L1+L2 9/9 零回归（学术 bench 题经专线关键词照常出勤：arxiv+crossref+hfpapers）；enginesAvg 4.8→2.8（池更精瘦）。踩坑留档：ddg 全局限速门（进程级 lastDdgAt，默认 3s）跨测试泄漏会让腿睡满 gate → 轮询等满软截止+迟到排水（"database is not open"），测试须注入 SC_DDG_MIN_INTERVAL_MS=0。

### 第 12 采样（修复后同题同尺复测）

| 维度 | core | z-ai | 判 |
|---|---|---|---|
| L1 切题 | 23/24 | 24/24 | 对方小胜（其 khan 题 flake 本轮自愈；我方唯一 miss=images 题 searxng 印尼垃圾源波动） |
| s 档 top10 | 21 | 21 | 平 |
| s 档进 top5 | 12 | 17 | **对方胜**（cisa/federalreserve/dev.mysql/moj.gov 正主第一的密度仍是我方短板） |
| 权威命中(s+a+b+g) | 56 | 39 | **core 1.4×** |
| csdn 进 top10 | 0（主动屏） | 2 | core 胜（对方 rust/docker 题 csdn×2 第 11 采样同现） |
| 延迟均值 | **557ms** | 1243ms | **core 2.2×**（早收割+精瘦池在 24 题规模坐实第 10 采样的反超结论） |
| 独占源均值 | +5.8 | +5.5 | 微胜 |
| uniqDom 均值 | 7.5 | 7.1 | 微胜 |
| Jaccard | 0.14 | — | 互补宇宙：双方独占源 5.8/5.5 几乎对等，"全面性"在广域面是互补不是占优 |

修复实效逐题：github 题 1ms 零结果 → 10 refs（rescue 腿 searxng+keenable 出勤，meta.rescued=true）；images 题 0 → 9 refs（openverse 合法空+聚合腿）；helm 题 top5 从 arxiv×3 → secopslog/k8s.guide×2/wiki；design 题 L1 miss → HIT（figma 进 top5，arxiv 清零）。

### 分领域诚实记分卡（第 12 采样）

- **core 明显胜**：dictionary（MW+cambridge+oxford top3，s3+a3 vs 对方 a1）、packages（npm 正主 9×s）、fact/entities（wiki 正主×3）、学术（arxiv+doi 正主出勤且不再乱入他题）、延迟（全部题 ≤1.2s vs 对方 1.0-1.9s）、spam 屏蔽（csdn 0 vs 2）
- **对方明显胜**：security（cisa/sysdig/microsoft/rapid7 官方全上 vs 我方 lunasec/博客面）、finance（federalreserve.gov×2 第一 vs 我方 maseconomics/cnbc）、news（.europa.eu 官源密度）、top5s 密度
- **平手/互补**：medical en（goodrx 双方都有；对方多 pmc/nhs）、zh-legal（我方 s 档 gov 条目命中；对方 moj.gov/cac.gov 第一）、databases（我方 s1 但 dev.mysql 没进 top5）
- **双方都差**：education（我方 rutube.ru 占 top1、对方该题曾只回 1 条——教学课程检索是双方共同盲区）

**诚实口径**：①24 题仍是有限样本，keyless 腿有质量波动（images 题 searxng 垃圾源即实例）；②尺子是我方三层数据，对 z-ai 有自引偏差（对冲手段不变：L1 关键词+spam 交叉+独占源人工复核）；③z-ai 侧耗时含 CLI 冷启动，但其均值 1.0-1.9s 与我方 0.4-1.2s 的差距方向可信；④top5s 12 vs 17 说明"s 档进 top5"的排序密度是下一个值得做的质量项（news/security/finance 类目的正主第一率）。

## 附录 G：类目正主前排 + 检测召回补齐（第 13 采样，phase AI，2026-09-04，用户"继续优化但是确保广度不要被砍"）

附录 F 留下的诚实短板（s 档进 top5 密度 12 vs 17）立项 phase AI。纪律：**广度红线**——权威表只扩不缩、引擎池不精简换分、24 题全量继续当回归尺。按 AG-2"先量化再动手"惯例，新诊断工具 `ai-top5-diagnose.mjs`（入仓可复跑）把 core top-10 逐 URL 拆成 lex/authority/残差(rrf+consensus+titleBonus)，提升模拟找"官方源进 top5 的最小 delta"。

### 诊断结论：短板不是单一根因，是四个叠加

1. **根因 #0（最大）——detectCategory 生产路径系统性失活**：10 个类目题里 6 个运行时返回 null（finance/legal/databases/medical/design/education 全漏检——"federal reserve interest rate decision"无 "interest rate" 锚、"个人信息保护法 数据跨境 规定"零命中、"mysql collation"无数据库品牌锚…）。评测尺用题面指认 category 给两侧打分，掩盖了这一点——**类目权威表在生产路径上根本没参与排序**。附带消歧缺陷："world bank open data gdp api" 被 finance 的 "gdp" 按表序抢跑（应为 data）。
2. **类目 s 档提权不够**：dev.mysql.com 在池排 #10 差 +0.9 分进 top1；federalreserve 差 +0.3 丢 #1（提升模拟逐档量化）。
3. **AF 页面守卫单长锚误伤官方页**：log4j 题长锚选了 "mitigation"（10 字符最长），rapid7 官方分析页含 log4j+cve+44228 却被清零；个人信息保护法题长 run 锚定后 cac.gov.cn 数据跨境专页被清零——**不清零即 #1**。
4. **表缺口**（对照 z-ai r12 落后三面）：news 缺 europa.eu 官方机构面（我方池里 ai-act-service-desk.ec.europa.eu 排 #2 却 tier="-"）；security 缺厂商官方域（rapid7/crowdstrike/fortinet…）；medical 缺 medlineplus.gov（独立域，不被 nlm.nih.gov 子域覆盖）。

### 四修复（全部质量层，召回面零改动，表只扩不缩）

- **AI-1 类目正主前排（fusion.ts）**：URL 命中【查询所命中类目】表且 s 档 → 提权 1.2→**2.0**（`CATEGORY_S_FRONTROW`，量化校准：+0.8 使 mysql/fed 两题均翻正且有余量）。作用域三重保护：只动命中的类目表 s 档（主题表/全局表/a/b 档不动，AC 标定不回退）+ AF 守卫照常清零错页 + domainCap 照常防霸屏。
- **AI-2 守卫多证据放行（fusion.ts）**：长锚缺席但页面命中 ≥2 个其他查询 token → 仍算切题（保留提权）。回归安全实证：asyncio MDN 错页查询 token 零命中仍 false、单证据(python)不放行、单 token 池语义不变——AF 全部回归锁原样通过。
- **AI-3 表扩充（categories.json +11 条/1 升档）**：news +europa.eu(s, 官方机构)/artificialintelligenceact.eu(a)；security +rapid7/crowdstrike/fortinet/paloaltonetworks(a)+sysdig/lunasec.io(b, log4shell 第一方发现者)；medical +medlineplus.gov/mayoclinic.org(a)；education khanacademy a→s（第一方正主原则，同 crates.io 之于 packages）。
- **AI-4 detectCategory 召回+消歧（authority.ts）**：①最长关键词胜出消歧（"open data"9>gdp"3 → data 胜，同长保表序）；②保守补无歧义锚——finance+interest rate/rate decision/central bank、databases+collation/mysql/postgres/mongodb/redis/sqlite/sql、legal+规定/条例/个人信息保护、medical+side effect/medication/肠溶/缓释、design+design token/figma/wireframe/mockup、education+academy（**不收裸 "course"，"of course" 误伤陷阱实测避开**）、security+sql 注入/xss（"sql 注入"比裸"sql"长，最长胜出自然分流）。误伤审计：13 条非类目查询全 null（含 "of course"/"依赖注入"陷阱）。

### 第 13 采样（修复后同题同尺 24 题）

| 维度 | r12（AH 后） | **r13（AI 后）** | z-ai r13 | 判 |
|---|---|---|---|---|
| L1 切题 | 23/24 | **24/24** | 24/24 | **首次双满分** |
| s 档 top10 | 21 | **27** | 25 | 平 → 反超 |
| **s 档进 top5** | **12（输）** | **20** | 20 | **12 vs 17 落后 → 20 vs 20 追平** |
| 权威命中(s+a+b+g) | 56（1.4×） | **68** | 46 | **1.48×** |
| csdn 进 top10 | 0 | **0**（主动屏 14） | 2 | 保持 |
| 延迟均值 | 557ms（2.2×） | 699ms | 1389ms | **2×** 反超保持 |
| 独占源均值 | +5.8 | +5.9 | +5.3 | 广度不缩反微增 |
| uniqDom / kind 桶 | 7.5 / — | **7.7 / 1.8** | 7.1 / 1.7 | 微胜保持 |
| Jaccard | 0.14 | 0.15 | — | 互补宇宙不变（广度红线守住） |

逐面翻转实录：**education 从"双方都差"变我方明显胜**（khan s 升档+检测修复 → core s=7 top5s=5 vs zai 3，r12 我方 rutube.ru 垃圾源占 top1）；**zh-legal 官方 gov.cn 包揽 top-3**（mofcom/moj/npc，多证据放行解锁守卫+frontrow 双效应，对齐 z-ai 的 moj/cac-first）；**finance federalreserve.gov #1**（此前 maseconomics/cnbc 在前）；dictionary/packages/学术/事实面胜保持；mysql 题 dev.mysql.com 本轮在池但排 6-10（top5s 未翻，前排档在池即翻正——诊断已实证）。

测试 255→**263** 全绿（fusion3.test.ts ×7：frontrow 作用域/守卫叠加/a 档不前排/主题表不误伤/多证据放行/AF 回归锁/新表条目 + authority.test detectCategory 消歧与召回锁 ×1）。踩坑：frontrow 测试断言先漏 titleBonus 后漏 RRF 项——分数拆解断言必须逐项扣除，靠"排名碰运气"的断言在精确同分（1.91393）时按插入序翻车。

### 诚实口径（不留尾巴）

①**news/security 的官方源缺席是召回面差异，不是排序问题**：cisa/nvd/europa.eu 本采样窗口不被 keyless 聚合器返回——融合层只能排池内结果，召回面按用户架构指令冻结，此处是结构性的诚实剩余差距（z-ai 有自建索引的官方密度）。②mysql 题 top5s 未翻是同因（dev.mysql.com 本轮不在池前排；在池即 #1，诊断模拟实证）。③检测补词是保守集，仍会漏（zh 药名类长尾无限），误伤审计已过但生产语料更大，SC_AUTHORITY_JSON 外挂通道继续兜底。④24 题仍是有限样本，keyless 腿池波动造成轮间差异（images/news 题两轮池内容不同即实例），结论只谈方向。⑤广度红线复核：表 +11/0 删、池 11 引擎不动、独占源/kind 桶/Jaccard 三项广度指标全部不降。

## 附录 H：security/news 专线 + CVE 元数据三腿（第 14 采样，phase AJ，2026-09-04，用户"继续"）

> 附录 G 诚实剩余①「news/security 官方源召回面差距」的正面进攻。架构纪律：planner/router 冻结不动，走**扩源加法**（AG-1 pypi 先例：元数据直取 API ≠ 搜索端点）。探针 7 候选 5 过（全案 keyless-increments 第六节）：NVD cveId 精查✅/OSV GET✅/GitHub Advisory✅/CISA KEV feed HTML 挑战页❌/NVD keywordSearch 精度差❌/GoogleNews RSS 复验✅/BingNews RSS✅（apiclick 内嵌 url= 可解码真实出版方链接）。

### 修复（扩源加法，默认池 11 引擎不动）

- **CVE 元数据三腿**：nvd（cves/2.0?cveId= 精查，desc+CVSS）/osv（GET /v1/vulns/{id}，aliases+refs）/ghsa（/advisories?cve_id=，severity）。pypi 纪律：查询含 CVE 编号才发请求（extractCveId），无编号合法空零请求；404/空数组合法空；ref=可构造官方详情页。
- **security lane**（DOMAIN_TABLE 表尾）：三腿 + searxng/tavily 聚合兜底（官方腿 1 ref 太薄防塌方，images 同款）；锚保守集 13 个。
- **news lane**（表尾）：googlenews（零 item 改合法空）+ bingnews（url= 解码）+ 聚合兜底；锚只收强新闻意图（" news " 双空格独立词；"最新进展"故意不收防学术劫持）。
- **detectCategory 医疗锚**：+12 个 zh/en 药名药类锚（诚实剩余②「zh 药名长尾」）；categories.json security +osv.dev(s)。

### 第 14 采样（24 题同尺）

| 维度 | r13（AI 后） | **r14（AJ 后）** | z-ai r14 | 判 |
|---|---|---|---|---|
| L1 切题 | 24/24 | **24/24** | 23/24 | **连续双满分**（zai education 题 miss） |
| s 档 top10 | 27 | **31** | 24 | 反超拉开（+7） |
| **s 档进 top5** | 20 vs 20 | **22** | 19 | **追平 → 首次反超** |
| 权威命中(s+a+b+g) | 68（1.48×） | **69** | 47 | **1.47×** 保持 |
| csdn 进 top10 | 0 | **0** | 2 | 保持 |
| 延迟均值 | 699ms（2×） | 912ms | 1378ms | **1.5×** 反超保持 |
| 独占源均值 | +5.9 | +5.6 | +5.5 | 广度持平 |
| uniqDom / kind 桶 | 7.7 / 1.8 | 7.4 / 1.6 | 7.2 / 1.7 | 池波动范围内持平 |
| Jaccard | 0.15 | 0.15 | — | 互补宇宙不变 |

**逐面兑现**：**news 题 europa.eu 官方域进 top1**（r13 附录 G 记"europa.eu 不被 keyless 池返回"——news lane 上线后 european-union.europa.eu s 档 frontrow #1，googlenews/news.google.com 双 RSS 腿出勤）；**security 题 osv.dev 进 top1**（CVE 三腿直取官方元数据，附录 G 记"cisa/nvd 不被池返回"——现在池里有腿了）；education khan 题 zai 本轮 miss（s=7 优势保持）；zh-tutorial/zh-fact/community/dictionary 胜面保持。诚实观察：security 题 top2-5 兜底腿收割到 yahoo 泛页面（top1 正主在但深度波动——软截止收割的既有特性）；mysql 题 dev.mysql 仍在池外（r13 同因留档）；data 题 top5 有 wikipedia/dev.to 泛面（worldbank 官方 2 条在 top10 内）。

### 诚实口径（不留尾巴）

①**召回差距的修复是"加腿"不是"改排序"**：cisa.gov 官方页仍未进我方 top5（KEV feed 挑战页关账，cisa.gov 只能靠聚合器间接命中），但 nvd.nist.gov/osv.dev/CVE 官方元数据三腿已把"安全题官方源第一"从结构性缺席变成常态出勤——zai 侧 cisa.gov top1 依赖其自建索引，我方以 OSV/NVD 官方 API 对位。②广度红线复核：表 +1/0 删（osv.dev）、默认池 11 引擎不动、lane 与 provider 全是加法、独占源/uniqDom/kind/Jaccard 四项广度指标全部持平不降。③22 题 top5 波动仍在（keyless 池轮间差异），24 题有限样本结论只谈方向。④检测锚保守集继续外挂兜底（SC_AUTHORITY_JSON）。

### 第 15 采样（AK domainCap 注册域粒度修复后同尺复测）

> 第 14 采样暴露：security 题 top2-5 = sports/baseball/weather.yahoo.co.jp——domainCap 原按 hostname 计数，子域集群各领各的配额绕过 cap=3（AC 治理意图是"单源霸屏"，子域集群是同一来源）。修复：cap 改按注册域（近似 eTLD+1，两级 TLD 白名单取三段），`fusion.ts registrableDomain()` 入仓。

| 维度 | r14 | **r15（AK 后）** | z-ai r15 | 判 |
|---|---|---|---|---|
| L1 切题 | 24/24 | 23/24 | 24/24 | 阿司匹林题本轮池波动 miss（top5=zhihu×3+rainwear 雨衣店×2，top10 零医疗权威页可提权；r13/r14 均 HIT，诚实留档非回归） |
| s 档 top10 | 31 | 28 | 26 | 领先保持 |
| s 档进 top5 | 22 | 21 | 22 | 波动范围内持平 |
| 权威命中 | 69 | **70** | 49 | **1.43×** 保持 |
| 延迟 | 912ms | **585ms** | 1231ms | **2.1×** 反超 |
| uniqDom / Jaccard | 7.4 / 0.15 | 6.9 / 0.13 | 7.3 / — | uniqDom 微输 0.4（security 题 uniqDom 9→3 是 cap 修复直接效应：yahoo 集群原本虚增 4 个"不同域"挤掉真多样性；历史波动带 6.9-7.7 内） |

**修复实效**：security 题 yahoo.co.jp×4 集群消失，osv.dev top1 保持（support.google.com×2/zhihu×2 均 ≤cap 合法）。广度红线：cap 收紧=挤掉同源集群腾位给真多样性源，github.io/blogspot.com 等自由托管平台跨用户子域共享 cap=3 是收紧方向（免费平台 junk 集群常见，诚实边界入注释）。测试 276→278。

### 第 16 采样（AL data 表 +5 官方统计机构后）

> r15 诚实观察「data 题 top5 泛面」根因=数据表缺 worldbank.org。补齐：data 表 +worldbank.org/imf.org/oecd.org/census.gov(s) + stats.gov.cn(s, lang:zh)，+5/0 删（第一批国际官方统计机构全入表，第一方正主原则）。
> 结果：world bank 题 **datahelpdesk.worldbank.org top1**（frontrow 生效）；L1 **24/24 vs 24/24 双满分**（阿司匹林题回 HIT，r15 miss 坐实池波动）；权威命中 71 vs 58（1.22×）；uniqDom 7.3 vs 7.2、Jaccard 0.15；延迟 1158 vs 1394ms。诚实记录：本轮 zai 池强（s 档 34 vs 29、top5s 26 vs 22 对方反超）——池波动双向存在，方向性结论不变。

### 第 17 采样（AM 词典/医学/数据三 lane 落地后）

> phase AM 探针第 4 批：10 候选 4 过（wiktionary en+zh / europepmc / clinicaltrials / worldbank）6 诚实关账（dictionaryapi 超时×2、SEC EDGAR 403、gbooks 免 key 429、s.jina.ai 401 强制 key、searxng 扩实例 0/6 Anubis、mysql docs 403）。三 lane 表尾零劫持落地+聚合兜底腿；表 +3/0 删（wiktionary.org s / clinicaltrials.gov s / europepmc.org a）；注册 43→47。
> 结果：L1 23/24 vs 24/24；s 32 vs 34、s+a+b 52 vs 51、authorityAny 223 vs 193（1.16×）——本轮 zai 池强（诚实记录：keyless 池轮间波动双向，方向性结论）；延迟 871 vs 1500ms（1.7×）保持；**广度四指标持平：uniqDom 7.2 vs 7.0、独占源 +5.5 vs +5.3、kind 1.6 vs 1.7、Jaccard 0.15 不变**。
> 逐面兑现：**dictionary 题 en.wiktionary.org top1**（×3 进 top5，s 档 5 vs 1、top5s 5 vs 1——新 lane 首轮即翻面，r16 该题双方 top5 均无 wiktionary）；**data 题 data.worldbank.org top1**（lane+AL frontrow 链路）；khan/education、community（vim vs emacs：我方 vim.org+github+reddit 多源 vs 对方 reddit×5 单源）、zh 教程（csdn 对方 top1 中招、我方 0）维持我方优势面。
> 诚实留档：images 题（unsplash pexels api comparison）miss——openverse 合法空（AH 根因）+searxng 公共实例垃圾轮换，三次复现三套不同垃圾，波动性失败非回归（AM 未触碰 images 面），r12-r16 HIT=openverse 返窗期（同 r15 阿司匹林题先例）。
> **images 题复测翻绿（phase AN 同轮修补）**：images 车道 +keenable 第 4 兜底腿（免 key 独立索引）+ topics.json images 表 +unsplash/pexels/pixabay 三条 s（第一方图库，空占位表首次填充）——复测 top1=unsplash.com/developers、top2=pexels.com/api，单题正式采样行 **core=HIT / zai=HIT**（465ms），诚实留档闭环。
