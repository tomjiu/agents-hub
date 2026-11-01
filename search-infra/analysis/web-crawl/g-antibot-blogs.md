# Task 10-c: GitHub 之外的世界 —— 技术博客 / HN / 论文 / 独立搜索引擎圈反爬实战知识

> 采集日期 2026-09-03。方法：web_search（英文为主）+ page_reader 深读 + npm registry / DNS 一手实测 + HN Algolia API。
> 注意信源立场：apiserpent / webclaw / roundproxies / brightdata 都是付费 SERP API / 代理厂商的博客，技术细节可信、结论倾向"买我们的 API"，已剔除推销部分只留行为事实。

---

## 30 秒结论（最重要的 5 条）

1. **TLS 指纹是 2026 年反爬的第一道墙，而且从 JA3 升级到了 JA4**。一句话：浏览器 HTTPS 握手的第一步（ClientHello）是明文的，里面 TLS 参数的组合像指纹——Python requests、Node fetch、curl 默认配置的"指纹"和真浏览器天差地别，UA 头说自己 Chrome 也没用，服务器在读到任何 HTTP 头之前就把你识破了。Chrome 2023 年开始随机化握手参数顺序后，JA3 对浏览器失效但对静态客户端（我们）反而更显眼；新标准 JA4 还带上 ALPN（能看出你走 HTTP/1.1 还是 2）——这正是 Task 8 发现的 Wikimedia 拒 HTTP/1.1 同款协议指纹墙。
2. **Node 生态 2026 年的无浏览器 TLS 伪装方案活下来了：`impers`（curl-impersonate 的 Node 绑定，最新版 2026-09-01 发布，就靠一个 koffi 依赖）是唯一活跃且轻量的选择**；got-scraping / header-generator 活着但只解决 header 层；node 版 tls-client 死了三年半、cycle-tls 基本消失。**结论：cheerio 路线不动，impers 作为 v0.4 备胎做 feature-flag 传输层**，绝不上 Playwright。
3. **DDG 的 202 空页档案补全了：它是"软封"不是封死，触发条件 = 突发高频 + IP 信誉差（尤其 datacenter/共享代理 IP），会自愈**。绕法不是换 header，是"全局限速门 + 指数退避 + 把空结果当失败重试 + 用干净 IP 别挂便宜代理（越挂越糟）"。html.duckduckgo.com 和 lite 端点都不需要 vqd token，单请求直出 HTML，比主站 vqd 两步握手稳得多。
4. **Google 免 key 直抓 2026 年官方圈共识 = 已死，v0.3 不碰 Google 的决策验证正确**。裸 HTTP 返回约 60KB 的 JS 空壳（结果靠客户端 JS 加载），TLS 伪装做得再好也只是"不被当场识破"，拿到的还是空壳；无代理每天 50-100 次就出验证码。唯一可靠免 key 的 Google 面 = Google News RSS（Task 9 已收录）。
5. **RRF 论文与 2025-2026 实战文章给了我们融合算法的对照答案：k=60 的本质是"压制单一引擎的离谱第一名投票、奖励共识"**，和我们"共识计数×0.35"哲学一致但我们丢掉了排名位置信息。Task 8-b"不整体换 RRF"的结论成立，但值得抄一个加权变体 Σw/(k+rank) 做实验分支。另：**独立搜索引擎圈死亡率惊人**（alexandria.org DNS 已死、stract.com 域名变成了 PR 软件公司），引擎池的健康检查+熔断是保命符。

---

## 1. TLS 指纹对抗现状（2026 年 9 月视角）

### 大白话结论
- **JA3 是什么**：HTTPS 握手第一步 ClientHello 是明文的（这时还没协商出加密钥匙，谁都能看）。里面有五样东西：TLS 版本、加密套件列表**及其顺序**、扩展列表、椭圆曲线、EC 点格式。把这五样拼起来做 MD5 就是 JA3。每个 HTTP 客户端的组合都不一样且极其稳定：Chrome 用 Google 自家 BoringSSL，Python requests 走 OpenSSL，Node fetch 走 Node 内置 TLS——所以"Python requests 说自己 UA 是 Chrome"在握手层一眼假。JA4 是升级版：扩展先排序再算（Chrome 2023 年起随机化扩展顺序，JA3 对浏览器报废）、纳入 ALPN（能区分 HTTP/1.1 vs HTTP/2）、还覆盖 QUIC/HTTP3。
- **第二层墙是 HTTP/2 指纹**：SETTINGS 帧参数（header 表大小、窗口大小、流优先级）和伪头顺序。curl-impersonate 之所以强，是因为它同时换了 TLS 库（BoringSSL/NSS，真浏览器同款）**和** h2 参数。Cloudflare 已同时用 JA3+JA4；AWS WAF 上了 JA4。检测侧还有 2026 年 2 月的 arXiv 论文专门讲用 JA4 识别 bad bots——这面墙只会更高。
- **Node 生态盘点（npm registry 一手实测，2026-09-01）**：

| 包 | 最新版 | 发布日期 | 状态判断 |
|---|---|---|---|
| `impers`（lexiforest，curl-impersonate 的 Node 绑定） | 0.1.2 | **2026-09-01** | ✅ 极活跃，依赖只有 koffi（FFI），r/webscraping 评价"试了一圈里最完整的 Node 版 curl_cffi" |
| `cuimp`（CLI 包装 curl-impersonate） | 2.1.1 | 2026-08-14 | ✅ 活跃，走子进程方式 |
| `curl-cffi`（npm 版，@tocha688/libcurl） | 0.1.50 | 2026-05-08 | ✅ 活跃，个人维护为主 |
| `got-scraping`（Apify） | 4.2.1 | 2026-02-24 | ✅ 维护中，但本质是"header 生成 + h2 伪装"，TLS 层仍是 Node 栈；官方 issue #65 承认过不了 Cloudflare |
| `header-generator`（Apify） | 2.1.88 | 2026-08-05 | ✅ 活跃，但只管 header——UA 轮换那条路我们已判死，它救不了 TLS 层 |
| `tls-client`（Node 版） | 0.0.5 | **2023-01-16** | ☠️ 死了三年半，还依赖已停止维护的 ffi-napi |
| `cycle-tls` | — | — | ☠️ npm 已查无此包（查询返回空），事实上消失 |
| `curl-impersonate`（npm 同名包） | 0.0.0 | 2024-01-21 | ☠️ 占位假包，别装错 |

- Rust 侧的 impit（Apify，改 rustls）和 wreq（真 BoringSSL，60+ 浏览器 profile）是当前博客圈公认最强两档，但都不是 Node 直用。**真正"无浏览器"的段位排序：真 BoringSSL（wreq/curl-impersonate）> 改 TLS 库参数（bogdanfinn/impit）> 只装 header（got-scraping/header-generator）**。

### 证据链接
- https://scrapfly.io/blog/posts/ja3-ja4-tls-fingerprinting-guide-to-detection-and-evasion （2026-08-15，20 分钟长文，JA3 五要素/Chrome 2023 随机化/JA4 与 QUIC/curl-impersonate 原理，本次最核心信源）
- https://developers.cloudflare.com/bots/additional-configurations/ja3-ja4-fingerprint （Cloudflare 官方文档：JA4 对扩展排序、Cloudflare 同时用 JA3+JA4）
- https://www.proxies.sx/blog/ja3-vs-ja4-fingerprinting-2026 （"JA3 died when Chrome randomized TLS extension order"）
- https://webdecoy.com/blog/ja4-fingerprinting-ai-scrapers-practical-guide （2026-01，JA4 抓 AI 爬虫实战）
- https://arxiv.org/html/2602.09606v1 （2026-02 论文：JA4 检测 bad bots）
- https://github.com/lexiforest/impers + https://www.reddit.com/r/webscraping/comments/1p6n1e1/curlimpersonate_wrapper_for_nodejs （2025-11 讨论帖）
- https://blog.logrocket.com/using-curl-impersonate-node-js-avoid-blocks （Node 接入 curl-impersonate 教程）
- https://www.npmjs.com/got-scraping + https://github.com/apify/got-scraping/issues/65 + https://crawlee.dev/js/docs/guides/got-scraping
- https://webclaw.io/blog/how-to-scrape-google-search-results （TLS 指纹库三巨头盘点：bogdanfinn tls-client / impit / wreq）

### 对 search-core 的行动建议
- **现在做**：什么都不用做。我们的主战场（DDG html/lite、Bing RSS、Marginalia、HN、Wikipedia、arXiv 等）目前不卡 JA3/JA4，cheerio+undici 保持零原生依赖。
- **v0.4 做**：把 `impers` 做 feature-flag 传输层备胎（`SEARCH_TRANSPORT=impers` 环境变量切换），专供两个场景：(a) DDG 主站 vqd 通道如果哪天必须用；(b) Wikimedia 全线拒 HTTP/1.1 的墙——impers 走 curl 支持 h2， wikipedia provider 可以借此进池。体积预估：koffi + libcurl 动态库，MB 级，远小于 Playwright（百 MB 级），不违背"轻量优先"。
- **不做**：Playwright/无头浏览器；UA 轮换（已死 + header-generator 只解决这一层）；node tls-client / cycle-tls 复活项目。

---

## 2. DDG 反爬行为档案（补全版）

### 大白话结论
- **202 空页 = 软封，不是封死**。触发条件两条：(a) 突发高频——DDG 体量小，对 burst 敏感，"几秒内连发"立刻触发；(b) IP 信誉差——datacenter 网段和共享代理池正是滥用重灾区，**挂便宜代理反而比家用/住宅 IP 更容易吃 202**（这条反直觉，来自 2026-06 博客实测复盘）。202 会自愈，问题是"你多久再触发一次"。
- **vqd 机制**：主站是刻意设计的两步握手——先给你一个页面，里面有每次查询专用的 vqd token，真正的结果接口没 token 不回话。ddgs（原 duckduckgo-search，2025 年中改名，旧包冻结）每次搜索实际打两个请求，所以猛打 ddgs 很容易吃限速。**html.duckduckgo.com/html/ 和 lite.duckduckgo.com/lite/ 完全不需要 vqd，一个请求直接回完整 HTML 结果页**。
- **html vs lite 哪个稳**：两个都免 vqd。html 端点给完整 SERP（`.result` 行结构、`a.result__a` 标题、`.result__snippet` 摘要），最好解析，链接要解码 `/l/?uddg=<urlencoded 真实URL>`；lite 更轻、结构更简。博客圈主流推荐 html 为主（ddgs 库自己也主要走 html 端点）。POST `q`（查询）+ `kl`（区域，如 us-en）。
- **官方政策面**：DDG 没有"欢迎抓搜索结果"的条款。官方爬虫是 DuckAssistBot（给 AI 快答抓网页的），走 robots.txt 标准指令；51degrees 2026-06 研究确认其遵守 robots.txt、变更 72 小时生效。api.duckduckgo.com（Instant Answer）**从来不是 web 结果接口**，只出即时答案卡片——这是新手最常见的坑。
- **社区绕法汇总**：① 全局限速门（每个进程每 N 秒最多 1 个 DDG 请求，别让并发工具加起来打穿）；② 随机化间隔（数秒级）；③ 指数退避 + jitter，**并把"空结果"也当限速信号重试**（202 伪装成"无结果"正是它的恶心之处）；④ 固定一个最新 Chrome UA 即可，轮换无意义；⑤ 不挂 datacenter 代理，IP 池脏了换干净的住宅出口。

### 证据链接
- https://apiserpent.com/blog/scrape-duckduckgo-serp-for-free （2026-06-16，12 分钟：端点对比表 / ddgs 改名 / vqd 原理 / 202 修复三习惯 / uddg 解码 / 代理反而更糟，本次 DDG 主题核心信源）
- https://roundproxies.com/blog/scrape-duckduckgo （2026-07-01，3 种免费方法）
- https://brightdata.com/blog/web-data/how-to-scrape-duckduckgo （厂商视角四种方法，DDGS 现状）
- https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot （DDG 官方：DuckAssistBot 说明）
- https://51degrees.com/blog/duckduckgo-crawlers-2026 （2026-06，DDG 爬虫指纹与 robots.txt 遵循研究）

### 对 search-core 的行动建议
- **现在做**：给 DDG provider 加三件套——全局限速门（建议 3-5 秒/请求起步）、202 与空页统一当"限速"信号做指数退避（1s→2s→4s→8s + jitter）、UA 固定单值最新 Chrome。这三条全是十几行代码，收益最大。
- **v0.4 做**：把"空结果"检测升级为可配置（连续 N 次空结果 → 触发熔断降级到 lite 端点或下一引擎）；从 impers 通道走一次 vqd 主站抓取做 A/B 备份路径。
- **不做**：换 header 大法、挂代理、追求 DDG 高并发。

---

## 3. Google 免 key 现状：v0.3 不碰 Google 决策验证通过

### 大白话结论
- **裸 HTTP 判死刑**：2026-04 博客实测——`requests` 打 `google.com/search` 返回约 60KB 的 JS bootstrap，里面没有结果、没有摘要、没有链接，原话 "This approach is done. Don't spend time trying to make it work."。到 2025 年末 Google 已把结果全部挪到客户端 JS 渲染。这与 Task 9 的"91KB JS 空壳"完全互相印证。
- **TLS 伪装也救不了 Google 搜索**：TLS 伪装让你"过第一层不被当场识破"，但拿回来的仍是 JS 空壳——Google 搜索是特例，"结果不管你指纹多真都动态加载"。所以 TLS 伪装是地基不是完整方案，对 Google 必须再上 JS 渲染（= 浏览器）。
- **量级参考**：无代理 + 无特殊工具，单 IP 每天大约 50-100 次就出验证码；住宅代理 + TLS 伪装能到几千次/天。EU consent 墙：Google 用 SOCS cookie（有效期 13 个月）+ NID；SearXNG 2025-10 的 issue 记录了完整 cookie 流程（先打 consent.google.com 拿 cookie → 带 NID+SOCS 搜索 → NID 可复用）——但这条流程 2026 年的前提仍是"能拿到非 JS 页面"，属于随时会断的灰区。Task 9 的 curl_cffi+NID 十面全活结论要打折扣看待：博客圈 2026 共识是"必须有 JS 渲染"，那条命是借用 Google 尚未全面下线的 legacy 响应，不可作为工程依赖。
- **结论：v0.3 不进引擎池的决策依然正确**。免 key 世界里 Google 的可靠面只有 Google News RSS（Task 9 已收录）。

### 证据链接
- https://webclaw.io/blog/how-to-scrape-google-search-results （2026-04-10：5 种方法全实测，"TLS fingerprinting alone isn't enough for Google"，50-100 次/天验证码数据）
- https://github.com/searxng/searxng/issues/5286 （2025-10：NID+SOCS cookie 完整流程 issue）
- https://policies.google.com/technologies/cookies?hl=en-US （官方：SOCS/NID cookie 语义）
- https://www.scrapingbee.com/blog/how-to-use-curl-cffi （2026-06：curl_cffi 现状）

### 对 search-core 的行动建议
- **现在做**：无。维持 Google News RSS 唯一 Google 面。
- **v0.4 做**：在 docs 里把 SearXNG issue #5286 的 NID+SOCS 流程记成"复活包"条目（若未来加 impers 传输层 + 愿意承担灰区风险，可做实验性 google provider，feature-flag 默认关）。
- **不做**：v0.3 任何形式的 Google 直抓；为 Google 引入浏览器。

---

## 4. RRF 论文与 2024-2026 融合排序实战

### 大白话结论
- **原始论文**：Cormack, Clarke, Büttcher, SIGIR 2009《Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods》。公式就一行：`RRF(d) = Σ 1/(k + rank(d))`，k=60。在 LETOR 3 基准上干掉了 Condorcet、CombMNZ 和所有 learning-to-rank 单模型（p<0.003）。核心思想：**扔掉分数只看名次**——名次是所有排序器唯一共通的语言，BM25 分数和余弦相似度直接相加=垃圾。
- **k=60 的由来**：出自论文的 pilot study，且最优区间平坦（k∈[20,100] MAP 几乎不动）。k 的作用是压平曲线顶部：k=0 时第 1 名和第 2 名差 0.5 分（离谱地大），k=60 时只差 0.0003——**防止某个引擎的离谱第一名把垃圾文档抬上天**。论文原话："The constant k mitigates the impact of high rankings by outlier systems."（60 只是合理默认，不神圣。）
- **2025-2026 生态**：RRF 已是行业标准默认件——Elasticsearch `rrf` retriever（参数名 rank_constant）、OpenSearch hybrid search（2025-02-12 官方博客）、Weaviate 默认 fusion、Qdrant `Fusion.RRF`、Azure AI Search hybrid 全在用。RAG 复兴给了这个 2009 年算法第二春。
- **实战注意事项（对照我们配方最有价值的一段）**：
  1. 只有当各引擎**失败模式不同**时 RRF 才有增益（三个 BM25 变体融合≈没用；BM25+向量是黄金搭档）→ 我们 8 引擎异构池天然符合。
  2. 短列表（top-10）用 k∈[1,10] 让第一名权重更大；长列表（top-1000）才用 k∈[60,100]。
  3. **引擎强弱不一时，vanilla RRF 会稀释强引擎**——实战普遍用加权变体 `Σ wᵣ/(k+rank)`（严格说已不是纯正 RRF，但无处不在）。
  4. 文档缺失于某引擎列表：两种约定（补 rank=列表长+1 / 直接跳过该项），选一个并写进文档。
  5. RRF 是"分数盲"——有校准分数的排序器应放 RRF 之上做 top-50 重排。
- **对照我们的配方**（URL 归一化 + 共识计数×0.35×min(n-1,2) + 词命中 + 确定性 tie-break）：
  - 相同哲学：奖励共识、压制单引擎离谱投票 ✓；确定性 tie-break 是 RRF 没有的优点（RRF 平票无解）✓。
  - 弱点一：**共识项丢掉了排名位置**——某引擎把它排第 1 还是第 10，我们一视同仁；RRF 用 1/(k+rank) 保留了"多被喜欢一点"的梯度。
  - 弱点二：min(n-1,2) 截断让第 3 个引擎之后的共识不再加分，而 RRF 天然是"每多一票加一点、边际递减"。
  - 弱点三：0.35 的共识权重是拍的，没有 k 那种"被证明平坦"的稳健性论证。
- **判定**：Task 8-b"不整体换 RRF、三处小改"的结论依然成立（整体切换会破坏现有确定性 tie-break 和测试基线），但值得开实验分支验证加权 RRF 变体：`共识Σ 1/(k+bestRank)` × 词命中加成 × tie-break 保留。

### 证据链接
- 论文：https://dl.acm.org/doi/10.1145/1571941.1572114 （ACM DOI）；公开 PDF：https://plg.uwaterloo.ca/~gvcormac/cormack_sigir09.pdf
- https://blog.serghei.pl/posts/reciprocal-rank-fusion-explained （2026-04-22，本次最佳：k=60 逐位演算 / 加权变体 / 缺失文档约定 / score-agnostic 之税）
- https://opensearch.org/blog/introducing-reciprocal-rank-fusion-hybrid-search （2025-02-12 官方）
- https://bigdataboutique.com/blog/reciprocal-rank-fusion-how-it-works-and-when-to-use-it （2026-05-18，为何 k=60）
- https://glaforge.dev/posts/2026/02/10/advanced-rag-understanding-reciprocal-rank-fusion-in-hybrid-search （2026-02-10）
- https://github.com/langgenius/dify/discussions/34643 （工业界采用的旁证）

### 对 search-core 的行动建议
- **现在做**：无必做项（Task 8-b 三处小改已落地且 68/68 通过，别动稳定基线）。
- **v0.4 做**：开 `fusion-rrf-weighted` 实验分支——共识项从 `count×0.35×min(n-1,2)` 换成 `Σ 1/(k+bestRank)`（k 取 30-60 档），词命中加成与确定性 tie-break 保留；用固定 query 集对比排序稳定性。
- **不做**：全量切换 vanilla RRF（丢 tie-break、丢词命中介质信号）。

---

## 5. Kagi 博客/文档：能抄的查询预处理与排序技巧

### 大白话结论
- Kagi 有两个自建索引：**Teclis**（web 索引，专挖非商业小站）+ **TinyGem**（新闻索引）。每次搜索并发调 ~12 个源（自家索引 + Google/Bing 匿名 API + Marginalia + Wolfram Alpha + Wikipedia + Yelp 等）——这个"多源并行再融合"的架构和我们同款，验证了方向。
- 可抄的三条：
  1. **降权信号**：官方明确说"广告和 tracker 数量与内容质量负相关，据此降权"。我们抓不了落地页统计 tracker，但可以抄其精神——维护一个 SEO 农场/内容农场 host 特征黑名单做轻量降权。
  2. **运算符透传**：Kagi 用户可用 `site:`、`-term`、`filetype:`、`before:/after:` 等（文档在 help.kagi.com/kagi/features/search-operators.html）。我们的 search-core 应该在 query 预处理层做运算符识别，映射到各引擎参数（DDG html/lite 端点原生支持 `site:`/`-term` 语法透传，Bing RSS 也认 `site:`），让上层调用者获得引擎无关的查询表达。
  3. **Small Web RSS**（kagisearch/smallweb，2026-03-12 官宣扩容）：个人博客/非商业内容聚合，提供免费 RSS feed——这是 Task 9 之后新发现的**免 key 新端点候选**，适合做"博客/独立站"垂直通道。
- 另外用户可控的 domain promote/block + lenses（子集搜索）是 Kagi 差异化的核心，对应我们未来可做"每项目屏蔽名单"配置。

### 证据链接
- https://help.kagi.com/kagi/search-details/search-sources.html （Teclis/TinyGem/12 源并发/广告降权官方说法）
- https://help.kagi.com/kagi/features/search-operators.html （搜索运算符官方文档）
- https://blog.kagi.com/small-web + https://blog.kagi.com/small-web-updates （Small Web 计划与 2026-03 扩容）
- https://github.com/kagisearch/smallweb （Small Web 开源仓 + RSS）

### 对 search-core 的行动建议
- **现在做**：在 query 预处理里加一层运算符识别（至少 `site:`、`-term`），透传给 DDG/Bing RSS/Marginalia——半天工作量，查询表达能力上一个台阶。
- **v0.4 做**：Small Web RSS 作为第 6+ 个免 key provider 试点；SEO 农场 host 黑名单降权实验。
- **不做**：试图复刻 TinyGem 级自建索引（离题，我们是聚合层）。

---

## 6. 独立搜索引擎圈：小团队的经验教训

### 大白话结论（3 条教训）
1. **别做通用搜索的 Google 挑战者，做差异化子集**。Marginalia 创始人 Viktor Löfgren 把全部筹码押在"非商业、文本密集的小 web"上（连索引策略都是反广告的），靠两个 NLnet 资助活到今天（2025-03-25 第二笔 grant）；Stract 当年的 HN 讨论原话：试图对标 Google/Bing 需要"tech megaproject"。对应我们：免 key 多源聚合本身就是差异化子集，别想着自己爬全 web。
2. **独立引擎的线上服务死亡率极高，且死得悄无声息**。2026-09-01 一手实测：alexandria.org **DNS 已不解析**（域名直接没了）；stract.com 域名现在是一家"媒体监测/PR 外联"公司的网站，开源仓（StractOrg/stract，最后提交 2026-04-02）与线上服务彻底脱钩。教训落到工程上：**引擎池必须有健康探测 + 熔断 + 降级**，任何单源都不许是硬依赖——我们的 provider 架构方向完全正确，Marginalia 这类小众源尤其要做死活检测。
3. **资助模式决定寿命，而"不养爬虫基建"的聚合层最稳**。Marginalia 靠 NLnet 捐助撑运营（2026-07 还在优化：迁 systemd、新增 unranked 查询端点、宽域名独立索引、爬取耗时减半——见其 log）；Stract 非营利模式撑不住转了商业。我们不爬全 web、只聚合别人现成的结果面，没有这个生存问题——这也是当初选"聚合层"而不是"自建索引"的隐性正确。

### 证据链接
- https://www.marginalia.nu/ （Viktor 站点 + log：2026-07-22 unranked/systemd/爬取减半；2026-03-30 单隐层 NN 的 NSFW 过滤器从零实现）
- https://news.ycombinator.com/item?id=43269241 （Marginalia 第二笔 NLnet grant 讨论，2025-03）+ https://nlnet.nl/news/2023/20231016-marginalia.html （NLnet 官方访谈）
- https://github.com/StractOrg/stract + https://news.ycombinator.com/item?id=39254172 （Stract HN 发布帖）
- https://en.wikipedia.org/wiki/Marginalia_(search_engine) （背景）

### 对 search-core 的行动建议
- **现在做**：给 marginalia 等"个人维护"源加独立更低的超时/熔断阈值（它们抖动概率远大于 DDG/百科类）。
- **v0.4 做**：provider 注册表加"存活探测"元数据（周期性 HEAD 探测 + 自动摘除），把 alexandria/stract 之死写进 engines.md 当案例。
- **不做**：任何形式的"给自家项目自建全网索引"幻想。

---

## 7. 中文圈快扫

### 大白话结论
- **Firecrawl 放大招（2026-07）**：API 免 key 直接调，含搜索/抓取/PDF 转 Markdown，每月 1000 次免费额度（掘金+知乎双文印证，GitHub 13-14 万星）。这是 Task 9 端点清单之外的新增量——"搜索+正文抓取"一体，和我们"搜完还要抓正文"的第二跳天然互补。限制未知（速率/IP），需试点验证。
- **DDG 流量暴涨**（2026-05-27 掘金）：Google I/O 2026 宣布 AI Agent 全面取代蓝链后 5 天 DDG 安装量涨 30%。含义：打 DDG 的 agent 只会越来越多，限速门槛只会更紧——我们第 2 节那套礼貌限速从"优化项"变成"生存项"。
- 中文圈的免 key 路线和英文圈一致（知乎 OpenClaw 教程 = Python ddgs 封装反爬），没有发现我们不知道的新端点/新技巧；dsh-free-search 已在 Task 9 收录。

### 证据链接
- https://juejin.cn/post/7657865700393893922 + https://zhuanlan.zhihu.com/p/2056455092807669479 （Firecrawl 免 key，2026-07-03）
- https://juejin.cn/post/7644113217137131571 （DDG 暴涨 30%，2026-05-27）
- https://zhuanlan.zhihu.com/p/2017750196671500474 （OpenClaw 免费联网搜索 = ddgs 路线）

### 对 search-core 的行动建议
- **v0.4 做**：Firecrawl 免 key `/search` 端点试点（关注限速与配额条款），若可用则考虑作为"搜索+抓正文"二合一的后备通道。
- **不做**：再花预算扫中文圈（信噪比确认偏低，英文圈节奏快 3-6 个月）。

---

## 结尾：v0.3 反爬防御路线（一段话）

v0.3 的防御主线不是"伪装得更像浏览器"，而是**"把礼貌做成系统"**：第一层，全局每引擎限速门（DDG 3-5 秒起步、marginalia 更保守）+ 指数退避 + jitter，并把 DDG 的 202 空页与"空结果"统一识别为限速信号而不是"无结果"——这是当前最高优先级补丁，因为它直接决定搜索质量上限；第二层，健康探测与熔断降级保持现状并给小众源更低阈值，2026 年独立引擎死亡率（alexandria DNS 已死、stract 域名易主）证明这是保命符而非锦上添花；第三层，TLS 指纹墙（JA4 时代）我们 v0.3 用"绕"字诀——只打不查指纹的端点（DDG html/lite、RSS、各免 key API），把 impers（curl-impersonate Node 绑定，2026-09 仍活跃、单依赖、MB 级）做成 v0.4 feature-flag 传输层备胎，专解 Wikimedia HTTP/1.1 之墙和潜在 DDG 主站通道，**Playwright 永远是最后选项，本项目不碰**。Google 维持"News RSS 唯一通道、直抓不进池"。
