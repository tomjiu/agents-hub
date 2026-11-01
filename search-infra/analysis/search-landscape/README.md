# 搜索工具生态扫描总览（2026-09-02 大扫库，两轮）

> **第一轮**（a/b/c）：3 个并行子任务，stars≥50 门槛。**第二轮补漏**（d 系列）：零星门槛，专捞 0-300 星💎新苗、GitLab、topic 小池、awesome 反查。
> 目的：为 search-core 找参考项目（用户六大块：商业引擎聚合 / 搜不到的补全 / 爬虫 / 数据清洗 / 图片搜索 / 类 search 引擎）。
> 评估口径：**commit 迭代次数 + 最后更新时间**（用户指定），stars 做参考。

## 30 秒结论

1. **我们选对了赛道，但已有贴脸对手**：wigolo（4.9k★/4 个月/2005 commits，AGPL）跟 search-core 几乎同定位（local-first、免 key、多引擎、MCP 出口），是首选精读对标。
2. **免 key 生态真实存在且很活跃**：Vane(原 Perplexica)36.6k★、local-deep-research 9k★、morphic 9.1k★ 全部"docker 捆 SearXNG 零 key 可跑"——零 key 全流程已是品类默认验收标准。
3. **免 key 的新护城河是 TLS 指纹**：DDG 开始按 JA3 指纹封 httpx 类客户端（返回 202 空页伪装无结果），UA 轮换已死。四家头部库（ddgs/wigolo/anysearch/wet-mcp）全部上了"伪装客户端+auto 降级探测"。
4. **公共 SearXNG 实例不可依赖**：实测 19 个实例 0 个给 JSON（429/Anubis 挑战/IP 黑名单）。SearXNG 只值得自托管，公共实例当"机会主义引擎"。
5. **融合排序没人真用 RRF**：实用配方是 URL 归一化 + 共识计数×2 + 词命中×1 + provider 优先级（MetaSearchMCP 60 行源码讲完）。
6. **单引擎路线活不过维护断档**：whoogle（11.6k★）官宣停更 = 反面教材；我们 4 引擎冗余方向正确。
7. **意外收获**：Marginalia 免 key 公开 JSON API 直接能用；Openverse 图片搜索 0.06s 免 key；Bing HTML 纯 curl 还活着（灰色，机会主义用）。

## 第二轮补漏（d 系列）30 秒结论

1. **💎新苗 30 个**（0-10 星但活跃有思路）：最有范式威胁的是 **OpenSaC 搜索即代码**（agent 写检索程序进沙箱，挑战固定 fusion 管线）和 **gainsay 反共识合成**（分歧不抹平、答案可申诉）。
2. **12 类新免 key 端点**：mcp.exa.ai 官方匿名 MCP、duck.ai、Mwmbl（机房 IP 永远可用，Marginalia 备胎）、Google News RSS、8 大中文热榜 API、StackExchange、Wayback、llms.txt 直读。
3. **Google 圣杯双实锤**：裸纯 HTTP 打 Google = 91KB JS 空壳假货（HTTP 200 最阴险）；curl_cffi + 浏览器 NID cookie = 十个垂直面全活；AI Overview 纯 HTTP 永死。
4. **四条改变计划的情报**：① Google CSE JSON API 2027-01-01 关停（key 表改）；② 编码 agent 插件位成了搜索工具新分发渠道（SKILL.md 出口升 P0）；③ AI 引用/证据格式标准抢位赛开打（4 家 0-4★ 无人认领，我们 citations 有立标准窗口）；④ 漏网大件 MiroThinker 8.3k★ / LLocalSearch 5947★——关键词扫描偏 Perplexica 系词根，topic 小池（answer-engine 信噪比最高）+ awesome 反查才是补漏正道。

## 第二轮补漏(d 系列) 30 秒结论

1. **💎新苗 30 个**(0-10 星但活跃有思路): 最有范式威胁的是 **OpenSaC 搜索即代码**(agent 写检索程序进沙箱,挑战固定 fusion 管线)和 **gainsay 反共识合成**(分歧不抹平、答案可申诉)。
2. **12 类新免 key 端点**: mcp.exa.ai 官方匿名 MCP、duck.ai、Mwmbl(机房 IP 永远可用,Marginalia 备胎)、Google News RSS、8 大中文热榜 API、StackExchange、Wayback、llms.txt 直读。
3. **Google 圣杯双实锤**: 裸纯 HTTP 打 Google = 91KB JS 空壳假货(HTTP 200 最阴险); curl_cffi + 浏览器 NID cookie = 十个垂直面全活; AI Overview 纯 HTTP 永死。
4. **四条改变计划的情报**: ① Google CSE JSON API 2027-01-01 关停(key 表改); ② 编码 agent 插件位成了搜索工具新分发渠道(SKILL.md 出口升 P0); ③ AI 引用/证据格式标准抢位赛开打(4 家 0-4★ 无人认领,我们 citations 有立标准窗口); ④ 漏网大件 MiroThinker 8.3k★/LLocalSearch 5947★——关键词扫描偏 Perplexica 系词根,topic 小池(answer-engine 信噪比最高)+ awesome 反查才是补漏正道。

## 三份报告导航

| 文件 | 内容 | 一句话收获 |
|------|------|-----------|
| [a-ai-search-products.md](a-ai-search-products.md) | AI 搜索成品 Top10+（Vane/LDR/deer-flow/SurfSense/gpt-researcher/scira/morphic/dzhng/storm/wigolo）+ 已死高星名单 13 个 | 研究循环参数化（depth/breadth 两旋钮）+ 分层抓取路由 |
| [b-search-tools-mcp.md](b-search-tools-mcp.md) | 工具层 Top10（ddgs/wigolo/anysearch/SearXNG/Vane/whoogle/LDR/open-webSearch/ddg-mcp/openserp）+ 三专题（反爬手法/融合排序/分发形态） | TLS 指纹伪装 + 引擎阶梯 + engines.md 资产化 |
| [c-search-apis.md](c-search-apis.md) | 免 key 端点实测 12+（含延迟）+ key API 免费额度 Top5（官网核实） | Marginalia/Openverse/HN/Wikipedia 免 key 直连可用；Tavily 1000/月免卡 |
| [d-small-tools.md](d-small-tools.md) | 小仓库扫雷（0-100★ 活跃，34 次搜索/24 份深读）：💎新苗 10 个 + Google 圣杯 2026 状态 + 免 key 新端点 12 类 + 熔断范式 | Google 纯 HTTP 死但"浏览器 NID cookie"可救；Exa 匿名 MCP/duck.ai/Mwmbl 等新端点；熔断数值可直接抄 |
| [d-emerging-products.md](d-emerging-products.md) | 新兴 AI 搜索成品 22 个（0-300★，2025 后创建）：💎新苗 10 个 | OpenSaC 搜索即代码 / Polaris 静默失败检测（= 失败标注契约现成参考）/ deepr 信念持久化 |
| [d-alt-platforms-lang.md](d-alt-platforms-lang.md) | GitLab Top5 + 语言切面(Rust/Go/Zig) + topic 深挖 + awesome 反查 | 漏网大件 MiroThinker/LLocalSearch + CSE 关停情报 + 证据格式标准抢位赛 |
| [e-ai-invocable-domain-routing.md](e-ai-invocable-domain-routing.md) | AI 可调搜索源三档全景（Perplexity Search API/博查/Linkup/Valyu/StackExchange）+ 公共 SearXNG×Google 现场解剖 + 域名表三层路由设计 | 公共 SearXNG 三层门全锁（config 开着 google 也摸不到）；博查补中文缺口 $5/1k；stackexchange 免 key 300/天=域名表最佳新人 |

## 漏网大件速评（Task 11-a，2026-09-03）

| 文件 | 内容 | 一句话收获 |
|------|------|-----------|
| [quick-mirothinker.md](quick-mirothinker.md) | MiroThinker 8.3k★ 速评（agent 架构搜索，模型研究项目） | 半死（代码冻结但模型线在走）；搜索面全 key API 与我们错位；判**参考学**：Wayback+维基修订「时间机器」双工具和工具回话契约值得抄 |
| [quick-llocalsearch.md](quick-llocalsearch.md) | LLocalSearch 5947★ 速评（"多 agent 讨论式聚合"） | 已死（官方归档，作者转私有 beta）；真身是单 agent ReAct+自托管 SearXNG，"多 agent 讨论"是日志流包装；判**不用学**：只记会话向量库+结果卫生两个点子 |

## 合并"值得抄"思路 Top8

1. **SearXNG 免 key 打底 + key 引擎做增强插槽**（Vane/morphic/LDR 三家一致）→ search-core 验收标准写死"零 key 跑通全流程"
2. **TLS 指纹伪装 + auto 降级**（ddgs 的 primp impersonate / wigolo 分层路由）→ 每引擎配 probe()，识别 202/403/挑战特征码自动换通道，如实报告 degraded
3. **融合排序简化配方**（MetaSearchMCP）→ URL 归一化 + 共识×2 + 词命中×1 + 优先级稳定排序；配 openserp clusters 保留引擎内排名
4. **分层抓取：默认最便宜通道，按信号升级**（cheerio 直抓 → 伪装客户端 → 可选无头）→ 失败标注 blocked_by_challenge，绝不把验证码页当结果
5. **一个包四种出口**（ddgs: lib/CLI/daemon/MCP + anysearch: SKILL.md 分发）→ search-core 已有 CLI/MCP/REST，补 SKILL.md 出口
6. **研究循环参数化**（dzhng depth/breadth 两旋钮）→ 对接我们 Governor 预算池
7. **typed REST → MCP 双向出口**（SurfSense + gpt-researcher）→ mcp.ts 长成既能吃也能吐 MCP
8. **引擎目录书当资产**（MetaSearchMCP 80+ provider 表）→ 建 engines.md：每引擎标接法/是否 key/封锁特征/实测延迟

## 第二轮补充思路（💎新苗层，与 Top8 不重复）

9. **静默失败检测**（Polaris）："全空=故障"判定→逐级降级→`[via X]` 标注→宁说降级不给假"无结果"——失败标注契约的现成参考实现
10. **搜索即代码**（OpenSaC）：agent 生成可批量/join 的检索程序进沙箱——范式级挑战，watch 名单
11. **反共识合成**（gainsay/passiveworkers）：分歧原样上桌+盲编辑防锚定——研究合成的另一条路
12. **deadline-bounded 扇出**（supersearch/argus）：时间预算当一等公民，慢源不许拖死调用——与 wigolo 软截止互证
13. **协议兼容 shim**（searxng-docker-tavily-adapter/cse-bridge）：把自托管引擎伪装成 Tavily/CSE 官方 API——存量生态零改造接入
14. **引用格式标准**（ai-evidence-format-spec/search-responses）：0-4★ 无人认领——我们 citations 契约有立标准窗口

## 免 key 实测通过名单（速览，详见 c 报告）

| 端点 | 延迟 | 用途 |
|------|------|------|
| api.openverse.org/v1/images/ | 0.06s | 图片搜索（我们最大空档！） |
| hn.algolia.com/api/v1/search | 0.43s | 技术社区垂直 |
| export.arxiv.org/api/query | 0.43s | 学术垂直 |
| api.marginalia.nu/public/search/ | 0.7s | 独立索引通用搜索（唯一免 key 通用 JSON） |
| en.wikipedia.org/w/api.php | 0.51s | 百科垂直 |
| api.crossref.org/works | 0.73s | 学术垂直 |
| www.bing.com/search（HTML） | 0.27s | 灰色机会主义，低优先级+熔断 |

**没通过**：DDG/Mojeek（本环境 TCP 不可达，需线下复测）、search.brave.com（429）、公共 SearXNG（19 选 0）。

## f 补扫（2026-09-03，"还有什么可借鉴（含闭源）"触发）

闭源/付费 API 六家价格与免费层实抓：Gemini grounding（$14/1k+5000 免费/月，CSE 后唯一合法 Google 路）＞智谱 web-search（¥0.01/次，中文首选候选易主）＞Parallel Fast（$1/1k，Tavily 贴脸竞品）＞OpenRouter server tool（竞争情报：search+fetch 已成收费标配）＞Moonshot/xAI（低置信观察位）。开源三框架（gpt-researcher/STORM/Morphic）a 报告已在案不重复。详见 f-keyed-apis-scan.md。

Marginalia 独立索引引擎 API 口径全案（限额/付费三档/CC-BY-NC-SA 红线/自托管数据集/本地降级四层，官方文档实抄+探针）：详见 marginalia-api-terms.md（phase X，用户问口径+冷门面第二腿 wiby 落地）。

phase Y 补充：keenable（10 万 credit/月免额新王，公共路免 key）与 tavily-hikari 自建网关样本已并入 f-keyed-apis-scan.md 附录；Hikari 接入全案在仓库 docs/tavily-hikari.md。

phase Z 补充：search-core 与托管聚合搜索（AI 助手内置 web_search 黑盒）的 9 题同尺对照全案在仓库 docs/vs-zai-search-compare.md——战平但赢法不同（权威密度 2.6 倍/灌水 0 vs 重叠 Jaccard 0.16 互补），对照挖出并修掉 planner 中文编程腿塌方 bug（keenable 保底）。
