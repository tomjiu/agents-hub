# 文件夹三：搜索专题

> 这个文件夹回答本项目最核心的问题：**12 个产品各自怎么做搜索——用了什么引擎、查问句怎么处理、网页怎么抓、结果怎么省 token、怎么循环迭代。**
> 也是为什么做这个项目：我们要在没有 Brave/Tavily/Exa key 的情况下做出好搜索。

## 先看大盘：搜索智能放在哪，分成两大阵营

```
                    多步研究循环
                        │
        【托管型 Deep Research】
        WorkBuddy agentic_search        ← 我们的位置：
        Trae deep-research.js              客户端自持编排器
                        │                  （pi/dsh 的进化）
 ───────────────────────┼───────────────────
 单次搜索               │          服务端黑盒
        【纯工具调用】            【云端 RAG / 托管】
        Perplexica              Grok Build / Qoder /
        pi / dsh                Antigravity / Claude Code / Codex
                        │
                    客户端可编排
```

**一句话版本：闭源大厂把搜索智能放在自家服务器上，客户端只留抓取和清洗；开源阵营（包括我们自己的 search-boost）把搜索智能放在客户端。** 这正好划出我们的生存空间——客户端可观测、可编排、可自选引擎、免 key 可用。而且闭源产品内部也在用"小模型预决策 + 多步循环"这类我们能抄的机制，只是藏在云端。

## 每家什么路线（点进文件看细节）

| 产品 | 搜索路线 | 关键词 |
|------|---------|--------|
| [pi-search-boost](pi-search-boost.md)（我们自己） | 客户端多引擎编排 | 复杂度路由、自适应剪枝、Focus Fetch 省 95% token |
| [dsh-search-boost](dsh-search-boost.md)（我们自己） | 客户端四路免费并行 | Bing+DDG+Yahoo+Exa 无 key、SSRF 守卫、X 降级链 |
| [trae](trae.md) | 云端两步走 + 客户端抓取 | 小模型改写查问句、引用统一体系、本地代码搜索 |
| [workbuddy](workbuddy.md) | 服务端托管 + 客户端保底 | 双路竞速、agentic_search 进度流、威胁域名库 |
| [claude-code](claude-code.md) | 全托管（Anthropic 服务端） | 旁路小请求、200 次配额、专家子代理读网页 |
| [codex](codex.md) | 全托管（OpenAI 服务端） | 三档搜索权限（Cached/Indexed/Live） |
| [grok-build](grok-build.md) | 全托管（xAI 服务端） | 客户端唯一认真做的是 web_fetch（SSRF/分流/截断） |
| [qoder](qoder.md) | 云端委托 | 独有图片搜索工具 |
| [antigravity](antigravity.md) | 基本没有 web 搜索 | 只有内部代码搜索（对照组） |
| [open-deep-research](open-deep-research.md) | 客户端编排（研究向） | 三层压缩漏斗、URL 去重、think_tool、无缓存教训 |
| [perplexica](perplexica.md) | 客户端编排（单点） | SearXNG 用法、embedding 双阈值、引用三段式 |
| [kimi](kimi.md) | 服务端黑盒 + 用户浏览器 | web_search 全在云端、WebBridge 扩展控制日常浏览器（带登录态）、证据门控提示词 |
| [zcode](zcode.md) | 双轨：服务端工具 + 客户端兜底 | server-tool 协议桥（OpenAI/Anthropic 双协议）、官方云端 MCP、browser-use 无头浏览器 |

## 五条高频共识（3 家以上独立验证，基本等于行业定律）

1. **抓取后置**：没有任何一家把网页全文直接塞进上下文。搜索结果先只有"标题+链接+摘要"，要细读再抓。Trae 两步走、WorkBuddy 竞速、Claude 专家代理、我们 focus fetch——同一件事四种做法。
2. **小模型干脏活**：改写查问句（Trae query_rewrite）、判断正文要不要细读（WorkBuddy contentAnalyzer）、网页摘要（Claude small fast model、ODR gpt-4.1-mini）——全是便宜模型。
3. **缓存 15 分钟起步**：WorkBuddy/Claude 明确 15min；dsh 磁盘缓存存原文（**缓存存原文、读取时按需过滤**——一页可以服务多个不同角度的查询，这是 dsh 的独门优化）。
4. **域名治理四件套**：黑名单（Trae）、白/黑名单互斥（Claude/WorkBuddy/Codex）、威胁域名库（WorkBuddy Galileo）、SSRF 守卫（dsh 182 行 + Clash TUN 豁免 / Grok 416 行独立模块）。
5. **搜索结果不自成协议**：Trae 把搜索结果和文件/符号/飞书文档并列成"统一引用体系"的一等公民——搜索结果应该挂进统一的引用管线，而不是搞一套特殊格式。

## 独门绝技（单家验证但高价值）

| 绝技 | 来源 | 解决什么 |
|------|------|---------|
| 双预算池（引用预算/fetch 名额分开算） | Trae deep-research.js | 抓多了浪费 token、抓少了漏信息 |
| 对抗验证 3 票 + 弃权不算存活 | Trae deep-research.js | 搜索结果可信度分级 |
| 6 问量化反思（Q1-Q6 + 超轮降级） | WorkBuddy | 迭代什么时候该停 |
| 双路竞速（服务端/本地谁快用谁） | WorkBuddy | 可用性翻倍 |
| 缓存存原文 + 读时过滤 | dsh | 一页服务多角度查询 |
| embedding 双阈值（>0.5 过滤 / >0.75 去重，免 rerank 模型） | Perplexica | 零 GPU 零 API 的相关性方案 |
| 一次 classify（路由+改写+意图一次出） | Perplexica | 省掉 planner 的多轮开销 |
| X 搜索四层降级链 | dsh | 没有订阅也能拿 X 数据 |
| journal.jsonl 断点恢复 | Trae | 长研究循环崩溃后能续 |
| bge_m3 + sqlite-vec 本地向量 | Trae ckg | 零外部依赖的本地语义搜索 |

## 反面教材（三家踩过的坑，我们必须绕开）

1. **ODR 的 `or True` 吞错**：所有异常当终止处理，一次网络抖动烧掉整轮并行研究；
2. **Perplexica 主链路无 try/catch + 全程无缓存**：SearXNG 一超时，SSE 静默挂死；
3. **ODR/Perplexica 引用无代码校验**：模型可以编造编号；
4. **Trae 搜索全押云端无本地兜底**：云端挂了 web 搜索全灭——单点依赖是共同软肋；
5. **pi 版的剪枝在 dsh 版被删导致回退**：迭代时好机制会意外丢失——需要回归测试清单。

## 给我们工具的最终收敛

1. **定位**：客户端搜索编排器（pi/dsh 的进化版），不做搜索引擎（Perplexica 的位置），不做托管 API（大厂的位置）。
2. **差异化四件**：引擎可换、全链路可观测、免 key 可用、token 可控。
3. **必抄**：双预算池、小模型预决策、缓存原文读时过滤、域名治理四件套、统一引用体系、子代理防火墙、三保险停止。
4. **生态**：技能用 SKILL.md 标准、连接层用 MCP、接口形态参考 WorkBuddy 的 SSE 事件流。
