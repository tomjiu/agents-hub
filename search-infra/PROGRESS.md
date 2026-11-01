# 进度跟踪

> 最新更新: 2026-09-02 (第四轮会话: 追加逆向 Kimi 桌面版 + ZCode, 15 份报告)

## 总览: 15 份报告全部完成 ✅

## 总览: 13 份报告全部完成 ✅

| # | 报告 | 状态 |
|---|------|------|
| 01 | grok-build | ✅ |
| 02 | pi-search-boost | ✅ |
| 03 | antigravity | ✅ |
| 04 | qoder | ✅ |
| 05 | trae-work (TRAE SOLO CN) | ✅ Rust 原生 agent + 云端两步搜索 |
| 06 | trae-code | ✅ 同引擎差异分析 + deep-research.js 泄露 |
| 07 | workbuddy | ✅ ACP 架构 + hosted agentic_search |
| 08 | claude-code | ✅ Coordinator 编排 + hosted WebSearch + ToolSearch |
| 09 | codex | ✅ 双层循环 + 工具四档披露 + Code Mode |
| 10 | dsh-search-boost | ✅ 与 pi 版差异为主 |
| 11 | open-deep-research | ✅ LangGraph 状态机 + stop condition |
| 12 | perplexica (vane) | ✅ SearXNG 链路 + embedding 双阈值 |
| 13 | **cross-comparison 综合对比** | ✅ 六层搜索解剖 + 共识机制 + 反面教材 |
| 14 | **kimi-desktop (Kimi Work 3.2.4)** | ✅ daimon 守护进程 + 系统提示词明文 12 篇 + WebBridge 扩展; kimi-code 是 MIT 开源可直读 |
| 15 | **zcode (ZCode 3.10.2)** | ✅ Claude Code fork 实锤(提示词残留/CLAUDE_* 兼容层) + 官方市场在线拉取(16 插件) + 10 家模型目录 |

## Phase D: 综合 + 自研设计

- [x] reports/13-cross-comparison.md — 12 目标横向对比
- [x] design/v0-spec.md — **search-core v0 设计规格**(定位/架构/接口/7 模块/路线图)

## Phase A: 基础设施(第二轮重建记录)

- [x] 环境清空后从远端仓库恢复
- [x] 重新下载 4 个 installer(sha256 记录在 analysis/DOWNLOAD_SHA256.txt)
- [x] 工具链用户态重建: 7zz 25.01(GitHub) + innoextract 1.10-dev(micromamba 源码编译,支持 Inno 6.4) + asar
- [x] 解包 Trae Work/Code(Inno Setup 6.4.0.1 → 1.5G/1.3G)
- [x] 解包 WorkBuddy(NSIS → app-64.7z → 772M asar 源码)
- [x] Claude Code: stub(Go Squirrel/MSIX 安装器)逆向出下载协议 → 拿到 233M 完整桌面包 + npm 平台原生二进制(206M)strings 提取
- [x] 磁盘回收: 提取产物分析完毕后清理(可再生),保留 notes/ 证据

## 关键架构发现(一句话版)

- **Trae SOLO**: Electron 只是壳,agent 是 Rust(ai_agent.dll 263M,socket :40005);checkpoint.sh 把上下文保真做成可执行协议;deep-research.js 泄露了完整工作流引擎(5 角度并行/双预算池/3 票对抗验证弃权≠存活)
- **WorkBuddy**: Electron → CodeBuddy CLI(ACP 协议)→ 服务端 agenttool;agentic_search 全程 SSE 只回 synthesis;WebFetch 本地/服务端 Promise.race 竞速
- **Claude Code**: 单 bun 二进制;Coordinator 多 worker 编排(特权动作 spawn fresh worker 防 injection);WebSearch 是 hosted tool+旁路小 agent;后台预计算压缩
- **Codex**: 工具四档披露(Direct/Deferred/CodeModeOnly/Hidden);Code Mode V8 编排中间结果不进 context;软硬双限压缩+handoff checkpoint
- **共识**: SKILL.md 是技能事实标准(连闭源竞品都兼容);MCP 是普遍连接层;小模型干脏活;缓存原文读时过滤;子代理=上下文防火墙(4 家独立验证)

## Phase E: 实现自研(进行中)

- [x] **search-core v0.1 MVP 实现**(core/, TypeScript, 零原生依赖)
  - Planner(规则版)/Engine Router(8 引擎并行+健康熔断)/Fusion(URL归一+RRF+词法)/Focus Fetcher(缓存原文读时过滤)/Governor(预算+SSRF逐跳+域名治理)/Journal/MCP server/CLI
  - 37/37 单测通过;MCP 协议探针通过;live smoke 全链路通过(yahoo 真实返回, focus 二次查询缓存复用 586ch/2767ch)
  - 详见 core/README.md(模块↔spec↔证据映射 + 验收状态 + 已知限制)
- [x] **search-core v0.2**(2026-09-02 第二轮会话)
  - **Research Loop**(research.ts): 5 角度并行[06] + 双预算池(ref 120/fetch 12)[06] + 6 问反思[07] + 三保险停止(收敛/max_loops 降级不阻塞/预算/零新URL/连续全灭)[11] + journal 断点恢复(replay 重建, refId 稳定)
  - **引用出口校验**(citations.ts): [n] 100% 可回溯;strict 抛错/strip 剔除+标注 — 幻觉引用零容忍
  - **embedding 双阈值**(embed.ts+fusion.ts): 本地 TF hash(词+CJK bigram)默认,OpenAI 兼容可插拔+回落;>0.75 语义去重 / 0.5 相关过滤可选 / 失败放行[12]
  - **X 四层降级链**(xchain.ts): 官方 Bearer ∥ Guest GraphQL(公开 bearer+guest token 2h 缓存+queryId bundle 轮换自愈[10]) ∥ site: keyless → oEmbed 增强 top2;层间独立熔断
  - **MCP 渐进披露**(mcp.ts): Direct(search/fetch/tool_search) + Deferred(research/x_search/providers/stats) 按需激活[09];name boost 2[07]
  - **REST+SSE**(http.ts): POST /research 10 类事件流(agentic_search 式[07]);可选 Bearer 鉴权
  - SSRF 三档(strict/allowPrivate/off);fetch 预算按尝试计费
  - **62/62 单测**;mcp-probe(渐进披露全流程)/http-probe(SSE 端到端)/smoke(真实网络: research 5 角度 19 refs→2 facts→max_loops 降级出报告→resume 回放 OK;X 链 x-keyless:yahoo 真实返回推文)
- [ ] v0.3: 对抗验证(3 票弃权≠存活[06])+双预算池 UI / LLM Planner+反思钩子 / Web UI / REST 公开 API 治理 / 付费引擎健康路由
- [ ] pi/dsh 插件迁移到 search-core

## 下一步(Phase E: 实现自研)

按 design/v0-spec.md 路线图:
1. v0.1 MVP: search-core MCP server + 免费四路并行 + Focus Fetch + Governor ✅
2. v0.2: Research Loop + 引用出口校验 + embedding 双阈值 + X 降级链 + 渐进披露 + SSE ✅
3. 迁移 pi/dsh 插件到 search-core(替换两插件自带的编排层,验证透明接管)
4. v0.3: 对抗验证(3 票) + LLM Planner/反思钩子 + Web UI + 付费引擎健康路由

## 备注

- TeleAgent 按用户指示移出研究范围
- 反编译产物已清理(可再生),strings 证据保留在 analysis/*/notes/
- Token 安全: GitHub PAT 在对话中出现过明文,**任务完成后请立即撤销重建**

## Phase F: 按主题重组(易读层) (2026-09-02 第三轮)

- [x] 按"主题 → 产品"两级重组,大白话重写,面向非专业读者
  - `1-技能与工具市场/`: README(名词 30 秒 + 全景表) + claude-code/codex/trae/workbuddy/grok-build/qoder/antigravity 7 文件
  - `2-工作流与架构/`: README(三流派 + 四条共识) + 10 文件(含 trae-code-deep-research 单列)
  - `3-搜索专题/`: README(两大阵营 + 五条共识 + 独门绝技 + 反面教材) + 11 文件(含 pi/dsh 自评)
- [x] 每个文件统一格式: 一句话总结 → 背景 → 机制(是什么/怎么运作/能抄什么) → 抄什么清单 → 坑 → 证据指路(回链 reports/)
- [x] 根 README 增加"怎么读这套资料"导航(易读层 vs 证据层双层结构)
- 证据层 reports/01-13 保持不动,易读文件末尾均回链

## Phase G: 追加逆向 Kimi 桌面版 + ZCode (2026-09-02 第四轮)

- [x] 下载并解包 kimi_3.2.4.exe(NSIS→app-64.7z→asar→daimon-bundle.tar.gz 四层)与 ZCode-3.10.2-linux-x64.deb
- [x] **Kimi 桌面版**: 三层底座(Electron 壳 + daimon 守护进程 + OpenClaw 网关);daimon = kimi-code 内核 daemon 化(github.com/MoonshotAI/kimi-code, MIT 开源, 直接 clone 读源码);系统提示词 12 篇明文(identity/constraints/tool-use/plugins/harness-spec);Canvas/Widget/Automation/Binding 看板体系;WebBridge Chrome 扩展(debugger API, 控制用户日常浏览器带登录态);托管 Python 运行时(pandas/duckdb/reportlab + CJK 字体);约 30 工具(语言包全集提取)
- [x] **ZCode**: Claude Code fork 五条实锤(提示词残留 "useful to Claude Code" / "Claude Code-compatible alias" 注释 / CLAUDE_* 环境变量双轨 / 工具集完全同款 / claude-plugins-official 引用);自研 workflow/phase 显式编排层;官方市场 https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json 在线拉取成功(16 插件, 8 个金融整包);内置 8 官方插件(document-skills 与 GLM 对话端技能同源 R1-R7);搜索双轨(客户端 WebFetch/browser-use + 服务端 server-tool 协议桥 openai.web_search_preview + anthropic web_search_tool_result);10 家模型 provider 目录(含 kimi-k3/glm-5.3)
- [x] 大白话维度文件: 1-技能与工具市场/{kimi,zcode}.md, 2-工作流与架构/{kimi,zcode}.md, 3-搜索专题/{kimi,zcode}.md + 三个 README 表格更新
- [x] 核实: reports/02 = pi-search-boost, reports/03 = antigravity
- 逆向工具链重装: 7zz 25.01 + @electron/asar + 自写 asar_extract.py(scripts/)
- 解包产物保留在 raw-downloads/{kimi-app, zcode-extract, zcode-asar, gateway-asar, webbridge-ext, zcode-marketplace.json}(体积大, 已 gitignore? 见 .gitignore)

## Phase H: 持久化加固 + 下一阶段立项 (2026-09-02 第五轮)

- [x] **持久化漏洞修补**(用户问"包地址和主要信息存云仓库了吗", 排查后发现 3 个漏洞, 全部补上):
  - asar_extract.py 之前只存在本地 scripts/, 不在仓库 → 已复制进 scripts/(官方 asar 解不开时的兜底工具)
  - docs/targets.md 缺 Kimi/ZCode 下载地址 → 已补, 全表加"状态"列(14 产品全标记完成)
  - DOWNLOAD_SHA256.txt 里 kimi/zcode 两行缺路径前缀 → 已修, 补注释
- [x] **新建 RESTART.md**(仓库根): 一站式重启指南 = 恢复步骤 + 工具链重建命令(7zz/asar/asar_extract.py 用法) + 14 产品地址总表(含版本/平台/包类型) + 按包类型的解包速查表 + 仓库地图 + 进度快照
- [x] 根 README 三阶段路线更新 + RESTART.md 导航
- 下一阶段(用户已拍板): **搜索工具专题分析** — 分析市面上的搜索工具/搜索源, 为 search-core Provider 层选型做输入; 候选: Firecrawl/Jina/Crawl4AI(抓取类), Tavily/Exa/Brave(搜索 API 类), SearXNG/Whoogle(元搜索类), browser-use(带登录态类)

## Phase I: 搜索工具生态大扫库 (2026-09-02 第五轮, 3 子任务并行)

- [x] 用户拍板方向: 找现成 AI 搜索仓库学思路 + 盘点免 key/低成本搜索 API; 评估口径 = commit 迭代次数 + 最后更新时间; 只要"快速拿结果", 不要 SearXNG 安全合规全家桶
- [x] 子任务 7-a: AI 搜索成品扫描 → analysis/search-landscape/a-ai-search-products.md (Vane36.6k★=原Perplexica改名/local-deep-research 9k★/deer-flow 81.3k★/SurfSense/gpt-researcher/scira/morphic/dzhng/storm/wigolo 4.9k★; 已死高星 13 个)
- [x] 子任务 7-b: 搜索工具层扫描 → b-search-tools-mcp.md (ddgs 2.9k★=免key多引擎标准/wigolo=贴脸同赛道/MetaSearchMCP 融合排序 60 行/openserp 三模式/whoogle 官宣停更=单引擎反面教材; 实锤 DDG 按 JA3 TLS 指纹封客户端返回 202 空页)
- [x] 子任务 7-c: 搜索 API 实测盘点 → c-search-apis.md (免 key 通过: Openverse 0.06s/HN/Wikipedia/arXiv/Crossref/Marginalia 0.7s 免key通用JSON/Bing HTML 灰色活着; 公共 SearXNG 19 实例 0 个给 JSON; key 榜: Tavily 1000/月免卡、Exa $10/月、You.com $100 一次性、Serper 2500、Google CSE 100/天)
- [x] 汇总: search-landscape/README.md(30 秒结论+合并 Top8 思路) + **docs/targets-search.md(下一阶段正式目标清单: P0 精读 wigolo/ddgs/MetaSearchMCP + 免 key Provider 扩池 4→10+, P1 策略深挖+key 插槽, P2 TLS 防御/engines.md/本地索引/SKILL.md 出口)**
- 用户六大块蓝图映射: 聚合→openserp/MetaSearchMCP; 补全→垂直 API 池; 爬虫→Firecrawl/Crawl4AI/wigolo 分层; 清洗→Readability.js 接 focus; 图片→Openverse/SearXNG images(自托管); 类 search 引擎→Meilisearch 缓存索引

## Phase J: P0 深爬 + v0.3 扩池开工 (2026-09-02 第六轮, A+B 双线)

- [x] 环境(第五轮中途)被重置 → git fetch + reset --hard origin/main 恢复(95985bc), 仓库即持久层验证成功
- [x] **子任务 8-a 深爬 wigolo**(30+ 文件精读) → analysis/search-landscape/deep-wigolo.md: 15 条对照表(抄/改造/避免); Top3 立刻抄 = 失败标注契约三件套(telemetry/engine_warnings/degraded) / 熔断 2.0(429 瞬态不记慢性+403 指数退避+半开探针)+并行池软截止 / FTS5 缓存检索; AGPL 边界: 只抄行为规格不搬码
- [x] **子任务 8-b 深爬 ddgs + MetaSearchMCP** → deep-ddgs-metasearchmcp.md: ddgs 10 条(primp impersonate=random TLS 指纹/后端洗牌发车/两段式隐形 API/四形态分发, TS 对应=got-scraping); MetaSearchMCP 10 条(ranking.py 共识×2+全词命中/URL 归一化 12 具名参数/Bing RSS 通道/consent cookie 五件套/list_providers 元工具); **fusion 结论: 不换 RRF, 三处小改**
- [x] **B 线: search-core v0.3 扩池落地**(core/src/providers/keyless-apis.ts):
  - 新 provider 5 个: marginalia(唯一免 key 通用 JSON)/openverse(CC 图片 kind:image)/hn(Algolia)/wikipedia(待 h2)/bingrss(零封锁 RSS)
  - Kind 类型加 "image"; Router 注册; 默认池 4→7(+marginalia/hn/bingrss); openverse 显式启用
  - **fusion 三处小改**(8-b 结论): URL 归一化补 12 具名追踪参数+query 参数排序; 共识 bonus 0.02→0.35×min(n-1,2) 上限 3 路; 全词命中 title 独立 +0.25; 确定性 tie-break(bestRank)
  - **68/68 单测**(providers 9→15); smoke 真实三引擎返回, 共识加权生效(sqlite-vec 双引擎共识排第 1); openverse 图片搜索真实验证(直链+落地页+CC 授权)
- [x] **新知识: 协议指纹墙实锤两条** — DDG 按 JA3 封客户端返回 202 空页(7-b); Wikimedia 全线拒 HTTP/1.1(本环境 curl --http1.1 复现 403, Node fetch 仅 h1) → wikipedia 默认不进池, 待 h2 传输层(node:http2 封装或 got-scraping)
- v0.3 backlog 更新(targets-search.md): 失败标注契约/熔断 2.0+软截止/FTS5 缓存检索/engines.md/技能出口

## Phase K: 第二轮零星门槛补漏扫库 (2026-09-02 第七轮, 3 子任务并行)

- [x] 用户指出上轮漏了 0 星仓库("0星的也行") → 3 子 agent 并行补扫(0-300★ 新苗带)
- [x] 9-a 新兴 AI 搜索成品 22 入选/💎新苗 10 → d-emerging-products.md (最反常规: OpenSaC 搜索即代码/gainsay 反共识合成/Polaris 静默失败检测)
- [x] 9-b 工具层小仓库 → d-small-tools.md (💎新苗 10 + 12 类新免 key 端点: mcp.exa.ai 匿名/duck.ai/Mwmbl/Google News RSS/中文热榜/llms.txt; Google 圣杯双实锤: 裸 HTTP=91KB JS 空壳假货, curl_cffi+NID cookie 十面全活)
- [x] 9-c GitLab+语言切面+topic+awesome 反查 → d-alt-platforms-lang.md (GitLab Top5 + 四条改变计划情报: **Google CSE 2027-01-01 关停**/编码 agent 插件位=新分发渠道/证据格式标准抢位赛 4 家 0-4★/漏网大件 MiroThinker 8.3k★+LLocalSearch 5947★)
- [x] 方法论升级: 关键词+高星会漏新项目; topic 小池(answer-engine 37 仓库信噪比最高)+awesome 反查才是补漏正道
- commit 2334759

## Phase L: 非 GitHub 官方文档巡检 (2026-09-03 第八轮, 3 子任务并行, "继续爬不只是github")

- [x] 用户指令: 爬 GitHub 之外的世界 → 10-a 免 key 端点官方文档 / 10-b key API 官方文档+定价核实 / 10-c 反爬博客圈+HN+论文, 全程 curl 实测取证 → analysis/web-crawl/ 四文件(README + e/f/g 三报告)
- [x] **破案: Wikimedia 403 = UA 问题非协议问题**(10-a 11 项矩阵实测): 伪装 Chrome 的 DEFAULT_UA 违反官方 UA 政策(Phab T400119 封杀浏览器伪装 UA), 规范 UA 下 h1.1/h2 全通 → **改一行 UA 即解锁 wikipedia 进池**, Phase J "拒 HTTP/1.1"结论作废
- [x] **Marginalia 迁移令**: 2025-12-08 新 API api2.marginalia-search.com(API-Key: public), 旧 api.marginalia.nu 时通时断; Mwmbl 备胎参数是 s 不是 q
- [x] **Google CSE 关停官方原文实锤**(10-b): "closed to new customers... until January 1, 2027" — 整个 API 死, 免费层+付费一起; CSE 计划划掉; 插槽顺序定案 Tavily(429/432/433 三档超限码)→Brave(旧免费 2000/月已死改 $5 credit)→Exa(type:neural/keyword 已废弃)
- [x] **TLS 指纹 JA4 时代定案**(10-c): impers(curl-impersonate Node 绑定, 2026-09-01 仍活跃, 单依赖 koffi)=唯一活跃轻量伪装方案; node tls-client 死 3 年半/cycle-tls 消失/got-scraping 只解决 header 层; 路线 v0.3 绕+v0.4 feature-flag 备胎, 永不上浏览器
- [x] DDG 202 空页档案补全: 软封自愈/触发=burst+脏 IP(代理反而更糟)/html+lite 免 vqd/绕法=限速门+指数退避+空结果当限速信号; DDG 流量 2026-05 暴涨 30% → 礼貌限速=生存项
- [x] RRF 论文对照(Cormack 2009): 现有融合配方哲学正确(奖励共识), 丢排名位置是弱点; v0.4 开加权变体 Σ1/(k+bestRank) 实验分支; 独立引擎死亡率实锤(alexandria DNS 死/stract 域名易主) → 熔断=保命符
- [x] targets-search.md 全面更新(P0 扩池表/插槽表/CSE 划掉/TLS 定案/风险台账); web-crawl/README.md 导航
- 下一轮代码动作(本轮随后落地): UA 修复+marginalia api2+arxiv/crossref/mwmbl/googlenews provider+DDG 202 检测

## Phase M: v0.4 防御升级 — 失败标注契约 + 熔断 2.0 + key 插槽 (2026-09-03 第九轮)

- [x] 漏网大件速评收口(Task 11-a 子 agent): quick-mirothinker.md(8.3k★ 半死/代码冻结型, 判「参考学」: 时间机器双工具 Wayback+维基修订 = "搜不到的补全"块免 key 候选) + quick-llocalsearch.md(5947★ **官方盖章已死 archived 2026-03**, "多 agent 讨论"名不副实=单 agent ReAct+SSE 直播, 判「不用学」) → **P0 贴脸对标表 5 行全部 ✅**
- [x] **失败标注契约落地**(wigolo Top1 学走, 字段自起): `EngineStatus` 六类 rate_limited(429/202 软封)/blocked(403/挑战页)/quota(432/433/402)/auth(401)/timeout/error + `retryable` 布尔; classifyFailure() 分类器; EngineFailure/EngineSkip/Skipped 进 types.ts, meta 透出到 MCP(engines_skipped+degraded)与 CLI(name(status)+DEGRADED 徽标)
- [x] **熔断 2.0**(providers/base.ts): 分类差异化阈值/冷却 — blocked 2 败 15min / quota·auth 1 败 30-60min / rate_limited 4 败 2min / timeout·error 6 败 5-10min; 半开探针失败冷却翻倍(上限 1h); 同类连败才累计(换类重置); 成功全复位
- [x] **软截止**(router.ts): Promise.race(allSettled, 6s) — 到点收割快腿先交付, 慢腿 AbortController 断开+代报 timeout 进 failed(失败标注契约: 被断的腿不能无声消失); 迟到腿自报作废不重复入账; 每腿永不 reject(消灭 v0.1 throw 普通对象模式)
- [x] **key 引擎插槽**(quota.ts + router.ts): QuotaTracker 月度额度本地计数(Tavily 1000/Brave 1000/Exa 1400 默认, YYYY-MM 自动滚动重置); **432/433 一票判死**(官方三档状态码语义); 额度尽 → 插槽不进池 → **免 key 池自动接管(回落零代码)**; keySlots=auto 默认并联/off 关闭; Tavily 认证迁 Bearer header(body api_key 属 legacy 已弃)
- [x] **degraded 降级信号**: 出勤引擎 <1/2 或全灭 → meta.degraded=true, agent 据此降低结果信任(Polaris 静默失败检测思路)
- [x] **文档资产化**: docs/engines.md 引擎目录书(20 provider 总表+熔断分类速查+额度规则+历史教训五条) + SKILL.md 技能出口(anysearch 验证的分发形态, Claude Code 等技能生态直用)
- [x] 验收: **83/83 单测**(73→83, 新增 breaker2.test.ts 10 项: 分类器 14 样本/分类熔断/半开翻倍/月度滚动/软截止/额度门/432 判死/插槽并联/degraded); tsc 零错误; package.json 0.4.0
- 设计取舍记录: quota 类失败同时触发熔断(阈值 1)+额度判死 → 第二轮 skip 原因诚实显示 circuit_open(熔断先到), 两条保险互为冗余

## Phase N: P1 深挖参考精读 + v0.5 时间机器+缓存面 (2026-09-03 第十轮, "继续")

- [x] Task 12-a 子 agent: P1 深挖参考 4 仓库源码级精读 → analysis/p1-research/ 五文件(local-deep-research 无自动策略切换器/引擎元数据驱动 LLM 自选, dzhng 294 行循环抄 researchGoal+事实抽取硬约束+trimPrompt 三小件, SearXNG 异常类型→挂起秒数显式表(CF 验证码挂 15 天)+per-engine timeout×全局 cap, anysearch SKILL.md 即程序+runtime.conf+batch_search ≤5 并行) → P1 表 4 行全 ✅
- [x] **时间机器双 provider**(MiroThinker 裁决"值得抄"落地, timemachine.ts): wayback(CDX API, collapse=timestamp:6 按月去重, filter=statuscode:200, kind:archive, query=URL/域名传关键词抛教学错) + wikirev(REST v1 history, oldid 永久直链, 接受裸词条名/完整 wiki URL, lang 路由, user {id,name} 对象适配); 空快照=诚实 [] 不污染熔断(与关键词引擎"0 结果抛错"的语义区分)
- [x] **FTS5 缓存即搜索面**(wigolo Top3 落地, cache.ts): pages_fts trigram 倒排索引+putPage 写入同步+老库自动重建(pages>0 且 fts=0); searchPages 两脚走路(FTS MATCH 短语/rank 排序/snippet 高亮 → 短词/语法炸 LIKE ESCAPE 兜底); SearchCore.searchCache → **MCP search_cache(Deferred) / CLI cache / REST /search_cache 三出口**; 中文 ≥3 字实测可搜(2 字回落 like)
- [x] 实测: 103/103 单测(83→103: timemachine 10 项+fts 9 项); probe-v05.mjs 真网络: wikirev 2/2 真实修订返回(838/661ms), FTS 中英全通(0-1ms); wayback 本沙箱 web.archive.org TCP 不可达(curl/node 双确认, 与 DDG/Mojeek 同款环境限制, golden 测试守门+线下复测, engines.md 教训 #5)
- [x] 文档同步: core/README v0.5 化(模块表+验收表+测试数字) / engines.md 22 provider+wayback/wikirev 条目+教训#5 / SKILL.md(search_cache 工具+archive kind+显式点名清单) / package.json 0.5.0 / mcp+http version 字符串
- 下一步候选(按 targets-search.md): SearXNG 三件数字搬进熔断(异常→挂起秒表/per-engine timeout) / provider 元数据拼装进 MCP 工具描述(LDR) / Research Loop 查询带 goal+事实抽取硬约束(dzhng) / impers feature-flag / 加权 RRF 实验分支

## Phase O: AI 可调引擎全景 + SearXNG×Google 实测 + 域名路由设计 (2026-09-03 第十一轮, 用户三问)

- [x] 用户三问触发: ①还有哪些引擎支持 AI 调用 ②公共 SearXNG 能不能拿 Google 结果 ③"AI 维护动态域名表"质量会不会更好更快
- [x] **SearXNG×Google 现场解剖**（scripts/searxng-google-probe.mjs + page-autopsy.mjs, 6 实例三层探测 /config→json→HTML）: searx.be="Verifying your browser"挑战页; priv.au=config 里 google/brave 全家开启但 bot 在 JS 拦截页被扣(7KB/1 外链/0 结果); inetol=真结果页但全实例只开 1 引擎; tiekoetter/opnxng 本沙箱 TCP 不可达 → **三层门全锁, config 开着≠用得上**
- [x] **AI 可调源三档全景**（web_search 7 次核实）: Perplexity 2026 拆出独立 Search API(原生 domains 过滤); 博查 Bocha ¥0.036/次+国内 Region+官方 MCP(中文付费首选); Linkup/Valyu 观察位; **StackExchange API 免 key 300/天/IP(注册 key 10000/天)**; Brave 免费额度修正=每月 $5 credit≈1000 次循环
- [x] **域名路由表设计定稿**（e-ai-invocable-domain-routing.md §3）: 三层路由(Tier1 免 key API 直连复用 19 provider / Tier2 site: 前缀 / Tier3 通用池兜底) + domains.json git 管理种子表 + smoke 验证学习回路(防 LLM 幻觉造域名) + breaker 管健康零新机制; 接入点=planner.ts 前插查表层(百行级)
- [x] 文档: search-landscape/e 报告 + README 导航行 + targets-search.md 新增"v0.6 候选"块(stackexchange.ts/domains.json/key 插槽观察位)

## Phase P: v0.6 域名路由 + 编程垂直双 provider (2026-09-03 第十二轮, "继续扩大仓库搜索面"+用户架构设想)

- [x] **域名路由表落地**(用户提案"AI 维护动态域名表"→ domains.ts): DOMAIN_TABLE 种子表 3 领域(编程/学术/图片, 关键词小写子串匹配) + lookupDomains 查表; planner 在 x/github/research/multi 之后插入 domain 路由(显式深研究/对比拆分优先), 命中→domainPlan(topic+apiProviders+siteQueries+siteEngines); core.search 分腿=第 1 腿 Tier1 API 直连 + site: 腿走通用引擎, 各腿独立熔断, fusion 照旧聚合; 克制条款: 表在 git 可审查/新条目须过 smoke 防幻觉/长尾留给通用池
- [x] **Tier1 新人双 provider**(keyless-apis.ts): stackexchange(api.stackexchange.com 2.3 search/advanced, 免 key 300/天/IP, SC_STACKEXCHANGE_KEY→10000/天, is_answered/score/tags 结构化权威信号, title HTML 实体解码 &amp; 最后解) + npm(registry.npmjs.org/-/v1/search, score 细分 pop/quality/maintenance, links 缺失兜底拼 URL); 注册 19→21
- [x] 测试: **119/119**(103→119, domains.test 16 项: 查表命中/表序优先级/x>github>research>multi>domain 排序/planner 集成/SE+npm golden 含实体解码/空结果抛错/429 分类); planner 旧测试 rust query 命中专线属预期行为变化→换中性 query 保语义
- [x] 真网络 probe-v06: stackexchange **344ms**/4 条(首条即 asyncio gather 异常处理正确答案页), npm **502ms**/5 条(zod@4.5.4), planner python→programming 2 腿/中性不误路由
- [x] 文档: core/README v0.6(域名路由模块行+验收行) / engines.md 24 provider+stackexchange/npm 条目+路由层说明 / **docs/selfhost-searxng.md 新建**(用户预期自建底座: docker 五分钟+settings 开 json 关 limiter+现实预期) / targets-search v0.6 候选标 ✅ / package.json 0.6.0

## Phase Q: 托管搜索 API 黑盒验尸 + BYOK 市场验证 (2026-09-03 第十三轮, 用户问"你用什么搜/能否借我用/工具搜索为何绑账户")

- [x] **自我黑盒验尸**(用 Phase O 同一套方法反向解剖助手自己的托管搜索 API): site: 操作符 6/6 全中(Tier-2 site: 路由在托管 API 同样可用=通用钥匙); 冷门内容找不到目标仓库(弱证据, 私有混杂变量, 但证明无特殊 GitHub 集成); 响应 schema(name/host_name/rank)与 Serper/Tavily/博查原生均不匹配=自建聚合层包装, schema 反推上游走不通
- [x] **三条路线本质差异定稿**(e 报告附二 §A): 托管 API=可测行为不可审计底层 / 自建 SearXNG=全透明(卖点非省钱是可审计) / search-core 直连=HTTP 层全可见结果集仍是上游的; 顺带复核实价 Perplexity $5/1k(官方页)=博查 ¥0.036/次, 与 key 插槽表一致
- [x] **BYOK 市场验证**(e 报告附二 §B, 6 次实抓): Claude Code WebSearch 在 Bedrock/Vertex 官方明示不可用(server-side tool web_search_20250305 被拒, litellm#26252, AWS 官方解法=挂 MCP 搜索 connector); Cursor BYOK 刻意阉割(自定义 key 仅 chat 模型生效, Composer 后端拒带 BYOK 请求, reddit "effectively killed BYOK"); 结论=厂商把"眼睛"锁进订阅, BYOK 只卖"大脑", 搜索缺口由 MCP(Tavily/Exa/博查)/自建 SearXNG MCP/免 key 直连(search-core 21 providers)三路补齐——pi-search-boost/dsh-search-boost 正卡此缝, 产品存在性获市场验证
- [x] 文档: e-ai-invocable-domain-routing.md 追加"附二"(验尸三探针表+BYOK 三工具证据表+信源)
- [x] **仓库 12 产品搜索绑定回扫**(用户追问"其他 app 呢"): 用 12 份逆向报告原始证据归纳四种绑定模式——A 托管跟厂商账户(Grok Build/Codex 同构 hosted spec/WorkBuddy 网关/Qoder 云/Trae 云无 fallback/Claude Code 一方 API/Kimi 云端 agent, 七家闭源无一例外)/B BYOK 跟大脑走(ZCode 模型多路由但搜索仍跟 provider server-side tool 或 Z.ai 官方 MCP JWT, 眼睛不随大脑独立存在)/C 全自托管零账户(Perplexica+ODR)/D 免 key 客户端直连(pi/dsh); 机制结论=A 模式的 web_search 根本不是搜索代码而是发给厂商云端的规格声明; **v0.7 出口候选=把 D 模式包成 MCP server 卖给 A/B 模式用户**(Bedrock 场景官方推荐补法); 文档: 13-cross-comparison.md 新增 §5.5 + e 报告附二加交叉引用

## Phase R: v0.7 注册表与垂直资产层八连发 (2026-09-03 第十三轮, "继续扩大搜索面"第二批)

- [x] **候选真网络预筛**(curl 批量探针): 10 候选 8 中 — crates 0.9s/packagist 0.4s/rubygems 1.3s/huggingface 0.25s/dockerhub 0.38s/openalex 0.96s/dblp 0.68s/wikidata 0.43s 全 200 免 key; **放弃 2 个诚实记录**: semantic scholar 免 key 10s 超时无响应(拥堵出名, 观察位待注册 key)/lobste.rs 沙箱 TCP 不可达(同 tiekoetter 前科, 线下复测再议)
- [x] **src/providers/registries.ts 八连发**(全按 npm provider 模式: URL 构建/UA+Accept/状态检查/typed 解析/空结果抛错/URL 兜底分支): 包管理器四兄弟 crates(Rust 必须带 UA)/packagist(PHP favers=star)/rubygems(Ruby 无 per_page 本地切片)补齐跨语言版图 + huggingface(模型权重 sort=downloads)/dockerhub(容器镜像, official `/_/` vs 用户 `/r/` URL 分支) + openalex(2.5 亿 works 被引+OA, mailto polite pool 同 crossref, URL 阶梯 landing→oa→doi)/dblp(CS 会议补 crossref 盲区, authors.author 单对象/数组/缺失三态归一化, ee 电子版优先) + wikidata(实体消歧 Q-id 永久 URI, language 跟 ctx.opts.lang); **PyPI 诚实不接**(官方 XML-RPC search 已关停, 不做 HTML 爬)
- [x] **注册 21→29**(router.ts 全部显式 engines/域名路由启用, 不进通用池); **域名表 3→7 主题**: +packages(npm/crates/packagist/rubygems 四腿)/ai-models(huggingface)/devops(dockerhub)/entities(wikidata); academic 3→5 腿(+openalex/dblp); **表序新规则**: 窄关键词主题(packages/devops)必须排在宽关键词主题(programming 的 " npm "/"docker")之前防截胡 — "推荐 npm 包"须命中 packages 四腿而非编程专线
- [x] 测试: **143/143**(119→143, registries.test 24 项: 8 provider golden 样本+URL 兜底分支/空结果抛错/429 分类/wikidata language/4 新主题查表/表序回归"npm install 报错仍走 programming"/planner 集成/表完整性防手误检查=域名表引用的 provider 名必须已注册); 老 academic 测试同步 5 腿预期
- [x] 真网络 probe-v07: **8/8 全通**(248-1176ms), 相关性佳: dockerhub 首条即 library/postgres 官方镜像/openalex 首条即 RAG 原始论文/wikidata 首条即 Alan Turing Q7251; 路由端到端 4/4(crate→packages/docker→devops/编程报错→programming/中性→无路由)
- [x] 文档: core/README v0.7(八连发行+验收行+表序规则)/engines.md 32 条目(+8 行实测延迟+封锁特征)/targets-search v0.7 候选全 ✅ 含放弃记录/package.json 0.7.0

## Phase S: v0.7 出口实战化 — MCP 接入指南 + 真网络实测 (2026-09-03 第十四轮, 用户选"1"=动工 MCP 出口)

- [x] **版本单一事实源**(src/version.ts): 运行时 createRequire 读 package.json, 消灭 mcp.ts/http.ts/cli.ts 三处手写版本号; 实测 bug 修复: mcp.ts 写死 "0.5.0" 落后两个 minor(MCP 客户端看到的 serverInfo 版本是错的)
- [x] **planner route 标注修正**: 域名命中 route "web"→"domain"(types.ts 联合类型扩展+domains.test 同步), MCP search meta 新增 domain 字段(消费方直接读出 packages/academic/... 主题) — 修前 SEARCH-B 走了 npm+crates 专线但 meta.route 还标 "web", 消费方不可见
- [x] **probe-mcp-real.mjs 真网络 stdio 全流程实锤**(与禁网渐进披露探针 mcp-probe.mjs 互补): 协议 2025-06-18 协商通过 serverInfo search-core 0.7.0 / 通用搜索冷 6.0s 热 2ms(首条即 MCP spec 官方页, bingrss+hn+crossref+wikipedia+arxiv 五引擎) / 域名专线 "rust crate async runtime"→route:domain npm+crates 双腿 562ms / fetch focus 省 79% token(925/4314 chars) / 渐进披露 tool_search 激活 3→4 / 健康面 29 注册 9 有战绩 0 熔断
- [x] **docs/mcp-exit.md「不绑账户的眼睛」卖法文档**: Phase Q 四模式缺口 recap → 通用 stdio/Claude Code(claude mcp add)/Claude Code on Bedrock(WebSearch 不可用官方补法=MCP 搜索 connector, 本 server 即现成件)/Cursor 四套接入片段 + 已验证/未验证诚实矩阵(Bedrock 真会话与 GUI 点击流沙箱无法验证, 如实声明) + 工具面/运维要点
- [x] 文档同步: core/README v0.7 出口实战化行+验收新行 / SKILL.md 口径 10+→29+域名路由+mcp-exit 指向 / targets-search v0.7 出口实战化块(含 "rust crate" 连续子串防误伤设计核实)
- [x] 测试 143/143(version.ts+route:domain 后全绿); commit push 并 ls-remote 验证

## Phase T: f 报告 — 闭源付费 API 六家补扫 (2026-09-03 第十五轮, 用户问"还有什么可借鉴(含闭源)")

- [x] z-ai web_search 9 次实抓: Gemini grounding 官方价($14/1k+5000 免费/月, Vertex $25/1k)/智谱 web-search 官方价(基础 ¥0.01/pro ¥0.03, 中文首选候选易主打博查 ¥0.036)/Parallel(Fast $1/1k~700ms, Tavily 贴脸竞品)/OpenRouter($5/1k+Exa $0.005-0.007, search+fetch 跨 400+ 模型收费标配=竞争情报)/Moonshot $web_search($0.005 第三方口径+双计费注意)/xAI Live Search($5/1k 第三方口径疑似降价, 首搜被 SpaceXAI 仿冒站污染需官网复核)
- [x] 诚实修正: 开源三框架 gpt-researcher(29.3k★)/STORM(31.2k★)/Morphic(9.1k★) a 报告第一轮已深度覆盖(含借鉴点列), 首轮 grep 漏 a 报告差点把旧货当新发现——f 报告按"不重复立传"处理只挂账
- [x] 新建 analysis/search-landscape/f-keyed-apis-scan.md(六家表+赛道窗口判断+行动清单+待人工核实清单); targets-search v0.8 候选块(key 插槽观察位重排: Gemini grounding 第一/智谱第二/Parallel 第三); search-landscape README 导航行
- [x] 赛道结论: "给 agent 的搜索"已被收费巨头做成标配, 免 key 免账户位置仍空但窗口收窄, 差异化守"零门槛+可审计+本地缓存面"

## Phase U: v0.8 三框架源码解剖 + 纳入 (2026-09-03 第十六轮, 用户"分析分析,有用的设计就纳入")

- [x] 三仓浅克隆(analysis/*/source, gitignore 不入 git): gpt-researcher 29.3k★/STORM 31.2k★/Morphic(miurla) 9.1k★; 三路 Explore agent 并行精读 + 主线抽查验证关键行号(persona_generator L134-155 强制兜底/mcp client.py:68-81 传输判定/base.py:35-51 RETRIEVER 契约全对)
- [x] 新建 analysis/search-landscape/deep-gptr-storm-morphic.md: 三框架机制表(file:line)+抄4件/不抄6件裁决(其中 2 件反向验证我方更强: gpt-researcher 引用无出口校验/STORM 引用不足不补搜)
- [x] **纳入① mcp-connector provider**: src/providers/mcp-connector.ts — 外部 MCP 搜索源即插拔(gpt-researcher RETRIEVER=mcp 思想无 LLM 版): stdio+streamable HTTP 双传输/懒连接/#connect 失败清理防子进程泄漏/工具选择显式>启发式(原家 LLM 选≤3)/结果三形状归一化/空结果抛错; 配了才注册, keySlot 语义同 tavily(quota.allow 未注册名恒 true); SC_MCP_CONNECTORS JSON 配置
- [x] **纳入② RESEARCH_PRESETS**: summary(1轮/4抓/60ref)<report(默认)<deep(5轮/24抓/240ref) 显式预算表(gpt-researcher 报告类型散件/Morphic 分档提示词 的可审查化), preset→cfg→显式 opts 三级合并, MCP/CLI/REST 三出口
- [x] **纳入③ STORM-lite 角度**: DEFAULT_ANGLES 5→8 池(+教程实践/历史背景/生态工具带 signals 正则), selectAngles()=定义与概念永远保留(basic fact writer 规则版)+信号命中+池序补满到 5; 无 LLM 模板近似诚实标注
- [x] **纳入④ buildOutline**: ResearchResult.outline=角度即节+逐节 facts/tier1Facts/top2 域统计(STORM outline 无 LLM 版), MCP/REST 出口带出
- [x] 测试 143→154(+11: v08.test 连接器真子进程 stdio 全链路 6+selectAngles 3+preset 1+outline 1); probe-v08 真网络: how-to/compare 信号命中+summary 档 7.6s+outline 结构对
- [x] 过程抓 3 真 bug 全修: ①启发式选工具 0 分也选(阈值>0) ②build cp -r 嵌套目录(dist/test/fixtures/fixtures 双份) ③fixture 把 JSON-RPC id=0 当 notification(SDK 客户端 id 从 0 起, falsy 陷阱)+#connect 失败路径不关 client 泄漏子进程钉死测试
- [x] 文档: engines.md mcp:<name> 条目(目录 33)/core/README v0.8 块/SKILL.md 连接器+preset 行/targets-search v0.8 核销块/package.json 0.8.0(version.ts 自动传播三出口)
- [x] commit push 并 ls-remote 验证

## Phase V: 全链路质量评测 + 优先域名落地 (2026-09-03 第十七轮, 用户"MCP 实测不急, 先测搜索/爬取/清洗/文本质量+解题, 优先域名先加权威学术网站")

- [x] **authority.ts 权威域名优先(用户提案落地)**: 首批 16 学术域(预印本/四大出版商/引文库/CS+医学学术库+wikipedia 事实双角色), 段精确匹配(ieeexplore.ieee.org 命中 ieee.org, fake-arxiv.org 不命中), 只提权不屏蔽; topic 感知分档(academic 专线 0.75 反超一个词差/通用 0.4 仅同层微调), 修评测发现的"事实型查询被 arXiv 字面命中淹没"副作用
- [x] **quality-bench.mjs 五维评测探针**: 搜索(引擎出勤/权威命中/耗时)/爬取(成功率/正文长度/失败分类)/清洗(导航残留/模板重复行)/文本(research summary: 大纲/引用覆盖/终稿长度)/解题(L1 搜索层→L2 爬取层→L3 研究层 expect 关键词代理判定); 8 题+2 题真网络两轮跑数(第 1 轮暴露→修 3 处→第 2 轮全验证)
- [x] 实测结论(第 2 轮): 清洗 100% 干净(nav 0.1 处/页)/爬取 19/24(失败集中在 crates.io SPA 空文本+npmjs 403+doi.org 落地 403)/research 引用覆盖 100%(60/60 全带 [n])/解题 6/8=75%(MISS=route-packages 的 crates 长查询排序+zh-tech 中文引擎面塌方, 根因都在数据源非编排)
- [x] 修复 3 处全验证: dockerhub repo_name 自带 namespace 时硬塞 library/ 前缀 404(registries.ts)/提权分档+wikipedia 入表后事实型题 top1 从 arXiv 论文→wiki 答案页(case-3)/探针 core.research 是属性非方法(.run())
- [x] docs/quality-baseline-v1.md(五维结论+修复清单+待办 6 条按解题率收益排序); core/README v0.8 质量轮行+quality-bench 验收行; targets-search Phase V 块; SKILL.md 权威域名口径
- [x] 测试 154→162(+8: authority 7+dockerhub 分支); commit push 并 ls-remote 验证

## Phase W: 置信度筛选 + 域名多样性 + registry 修复 + 冷门源核查 (2026-09-03 第十八轮, 用户"1和2都做, 更关心自做引擎补商业缺口+屏蔽 csdn/百家号/搜狐等灌水站, 冷门专业的自己做")

- [x] **credibility.ts 置信度筛选(用户最关心)**: 硬屏 12 域(用户点名 csdn/百家号/搜狐 + 百度系灌水面 + 6 文库爬虫墙)从融合结果剔除+meta.spamBlocked 计数; 强降权 3 域(ehow/answers/wikihow, -1.2 压过 authority+一词差之和)标 ref.spam; 段精确匹配防误伤(知乎/cnblogs 未点名不动); 与 config.blockedDomains(fetch 层)互补; embedder 失败路径堵漏(垃圾不复活); 10 测试
- [x] **域名多样性 cap**: fuseSemantic 裁剪层单域≤3(domainCap 可调, 0=关); 评测实抓二次 bug: cap 误伤单源专线(crates 腿 10 条全同域被裁 7 成)→ domain 路由+x 搜索豁免(用户点名鱼塘同域是特性); 中文题 uniqDomains 1→6
- [x] **packages 结构性闭环**: crates sort=downloads(探针实测 tokio 回头部)+condensePackagesLeg 语言腿裁剪(rust→crates 单腿/npm→npm 单腿/无信号全腿); cap 豁免后 case4 MISS→L1(tokio #4); npmjs 403 fetch 失败随之消失
- [x] **冷门源核查(补商业引擎缺口)**: Marginalia 冷门独立站索引(API 已接=王牌)+StackExchange 170+ 子站(config.engines 指名)+Lobsters 重测仍 ETIMEDOUT 维持 watchlist+Reddit .json 实测 403 反爬墙诚实不接+packagist/rubygems 间歇复核 200 OK 健康
- [x] 第三轮 bench 定稿 9 题: L1+L2=7/9, 清洗 100% 干净(nav 0.0/页), fetch 失败收敛为 doi 反爬+crates SPA 两类; case3 回落=wiki 腿间歇缺勤(非 bug, 上轮同代码 L2 solved)→fact 型 wiki 出勤保障记待办
- [x] quality-baseline-v1.md 第 2 批节(五-八章)+targets Phase W 块+README+SKILL 口径; 测试 162→175(+13); commit push ls-remote 验证

## Phase X: Marginalia 口径定案 + 冷门面第二腿 wiby (2026-09-03 第十九轮, 用户问"Marginalia API 限额/付费/本地降级? 本地引擎+API 聚合架构, 冷门原网站通过搜索扩充")

- [x] **Marginalia API 口径定案**(官方文档 2025-12-08 版实抄+当日 curl 探针, 结论入 analysis/search-landscape/marginalia-api-terms.md): ①免费可免 key 用(public 体验键, 全网共享限额打满 503; 创始人 HN 口径 IIRC ~15 q/min 仅供参考, 官方不公布数字) ②免费正式键邮件申请(contact@marginalia-search.com, 防批量注册滥用) ③付费=非商用一次性买断(永远可选项)/商用按量订阅(polar.sh), 免 key 路线数据 **CC-BY-NC-SA 4.0 非商用红线** ④本地降级四层: provider 内 api2→旧端点 fallback(已在仓)/池层 mwmbl 备胎+熔断 2.0(已在仓)/FTS5 缓存(已在仓)/终极自托管(开源 Java 栈+downloads.marginalia.nu 数据集 Data Exports+爬取样本 1.3GB-81GB+语言模型, 存在性记档, 桌面插件场景性价比低不建议现在做)
- [x] **marginalia 加 dc=3**(官方"每域最多几条"参数 1-100): 与 fuseSemantic domainCap=3 对齐, 源头多样→融合才有多样可保; api2 主路+旧端点 fallback 双路都带, 单测断言
- [x] **wiby provider(冷门面第二腿)**: wiby.me/json 探针 200 OK(古典老网/个人站, 与 marginalia 学术倾斜互补); JSON 数组 {URL,Title,Snippet,Description}, Description 真摘要优先/Snippet 导航噪声兜底/HTML 转义解码; **默认池 10→11**; golden+空结果回归测试
- [x] 第 4 轮 quality-bench 真网络验证: L1+L2=7/9 持平无回归, 清洗 100%(nav 0.0/页), authority 25 命中, spamBlocked=1 待命; MISS 集合不变(fact=wiki 腿间歇缺勤/zh=数据源缺口, 均已挂账非本批回归); 测试 175→176
- [x] 文档: marginalia-api-terms.md(新)+engines.md 总览 33/注册 30+wiby 行+marginalia 行重写+targets Phase X+README+SKILL 29→30; commit push ls-remote 验证

## Phase Y: Hikari 网关双路接入 + keenable 独立索引腿 (2026-09-03 第二十轮, 用户提案"加入 keenable.ai + tavily-hikari(CLI/MCP/HTTP API 三形态)")

- [x] **环境回滚事故恢复**(插曲): 本地 checkout 被重置回 phase-f 老快照(d9c427d)——fetch+reset --hard origin/main 恢复到 50d7c3a, 176/176 复绿; 旧树未提交改动备份至 /home/z/my-project/backup/*.patch; worklog 重录 Task 20-23; 教训重申: 仓库=唯一持久层, commit 要小而频
- [x] **keenable 探针+接入**(用户提案 keenable.ai): 官方 docs.keenable.ai 实抄(Mintlify .md 源直抓)——独立索引通用搜索, 免 key 公共路 /v1/search/public(1000 次/时/IP 不计量, X-Keenable-Title 必填缺→400)+正式路 /v1/search(X-API-Key)升 **10 万 credit/月免额**(比 Tavily 1000/月宽百倍); 实弹探针 200 OK/433ms; provider 落地(snippet 优先 description 常空/freshness→published_after 相对增量/SC_KEENABLE_KEY); **默认池 11→12**; 不设 keySlot(keySlot+免 key isConfigured 会被 auto 强注入空池——引擎测试跑真网络的实测教训)
- [x] **tavily-hikari 网关双路接入**(用户自己的 Tavily 兼容网关 tavily.ivanli.cc): ①tavily provider 加 baseUrl(SC_TAVILY_BASE_URL, 尾斜杠容忍, 官方默认不变) ②mcp-connector streamable HTTP 加 headers(SDK requestInit, 可挂 /mcp+Bearer) ③无凭据探针: 双端点 401 missing/invalid token 语义清晰(真 token 不进聊天/仓库, 用户本地 env 注入); 全案 docs/tavily-hikari.md(含用户提供的 Codex/Claude Code 客户端接法抄录)
- [x] 第 5 轮 bench ×2 采样同判: **L1=8/9, L1+L2=9/9 历史新高**(此前 7/9), fact+中文两个历史 MISS 翻绿, keenable 出勤 6/9 第二主力; 诚实代价: 出勤均值 2.2→4.4, 耗时 801ms→4.2s(仍在软截止内); 测试 176→179(+3: keenable 双路 golden+tavily baseUrl 三分支)
- [x] 文档: docs/tavily-hikari.md(新)+engines.md 34/31/12+keenable/tavily 行+SKILL 30→31+README 配置行+baseline 第 5 轮+f 报告附录+landscape 导航; commit push ls-remote 验证

## Phase Z: 同题对照轮 vs 托管聚合搜索 + planner 编程腿修复 (2026-09-03 第二十一轮, 用户"跑一轮测试和你之间搜索的进行对比")

- [x] **vs-zai-compare.mjs 对照脚本**: 9 题复用 bench 题集+同关键词判分, 两边共用 authority/credibility 清单打标(同一把尺), 只比搜索层(黑盒无 fetch 可言), 3 全量样本; 原始 JSON 落 /tmp 不入仓
- [x] **对照挖出 planner 真 bug**: 中文编程题被域名路由收窄到 5 腿(stackexchange/github/hn 三英文系+ddg/bingrss), ddg 限流后塌到 bingrss 单腿→「python asyncio 教程」L1=miss(第 5 轮是 L2 兜住没追根因); **修法=programming 腿集补 keenable 保底**(免 key/zh 能力强/426ms 健康 9-0), 真实 miss 题回归锁, 179→180 测试; 修后同题 top5 变 asyncio 专页(realpython/pyguides)
- [x] **对照结论(修复后两轮 9/9 vs 9/9 战平)**: 权威密度 3.1-3.2 vs 1.2(**2.6 倍**), 灌水站 0 出现 vs **csdn 稳坐对方中文题 top1**(Phase W 屏蔽价值实证), 域名重叠 Jaccard 均值 0.16(两边几乎是两个互联网="本地引擎+API 聚合"架构实证); 诚实: 对方延迟更稳+中文教程池更厚(廖雪峰/菜鸟/知乎顶位)
- [x] **第 6 轮 bench 回归: L1=9/9, L1+L2=9/9 历史最高**, 清洗 100%, 耗时均值 926ms, 无回归
- [x] 文档: docs/vs-zai-search-compare.md(新, 全案含三轮样本表+双方强项清单+局限性)+baseline 第九/十节+targets Phase Z+README 测试行; commit push ls-remote 验证

## Phase AA: 对照驱动增量扩源 (2026-09-03 第二十二轮, 用户"根据你的搜索广度来给+增量")

- [x] **增量菜单按对照缺口定**（docs 面/中文面/通用面），全部探针证实才接：MDN 官方文档 API 200/documents[10]/locale=zh-CN 中文内容坐实 ✅；bingrss site:docs.python.org 200 ✅；devdocs.io 404×2 诚实不接；searxng 公共实例×5 全灭（反爬伪 200/429，自建路由已有）；ddg kl=cn-zh 202 无法证实不硬接
- [x] **MDN provider（第 35 号）**: /api/v1/search locale 跟随查询语言; **documents=[] 合法空**（python 等非 web 编程题必空，抛错误伤熔断——与"空即抛"惯例的语义分支有注释在案），仅缺 documents 字段（API 形状漂移）才抛; 编程主题 Tier1
- [x] **查询语言自动检测**: planner CJK≥2 → decision.lang（planBase 包裹零风险）→ engine 合并 opts.lang（调用方显式优先）——wikipedia zh 子域/googlenews hl-gl-ceid/mdn locale 三条中文路由本就写好，只是从未被触发，这一针打通
- [x] **programming 腿升级**: mdn 进 Tier1（原 Tier2 site:developer.mozilla.org 升级直连），site: 槽位补 docs.python.org（asyncio 对照轮对方 top 的官方文档面）
- [x] **第 7 轮 bench 无回归**: L1+L2=9/9 持平; 出勤均值 4.6→4.9; vs-zai 第 4 采样 9/9 vs 9/9，asyncio top5 出现 docs.python.org; 测试 180→185（MDN golden×3+zh 检测×2）
- [x] 文档: engines 35/32+mdn 行+SKILL 32+README 185+vs-zai 附录（增量表+诚实不接清单）+baseline 第 7 轮+targets Phase AA+worklog; commit push ls-remote 验证

## Phase AB — 免 Key 公共源审计与增量轮（2026-09-03，用户提供免 Key 清单+searx.space 实测）—— ✅ 落地（200/200）

- [x] **16 候选全探针**（core/scripts/probe-keyless-ab.mjs，原始 JSON 只落 /tmp）：能证实才接——证实 6 项，诚实不接 7 项（Qwant 403/Jina 401 要 key/S2 429/Yep 403/Startpage 挑战页/Open Library 沙箱网络失败/DDG IA 实测无货），挂账 2 项（Nominatim/Open Library）
- [x] **anysearch（第 39 号 provider，默认池第 13）**：POST /v1/search 匿名可用，code!=0 抛错交熔断；连打 6 发全 200，asyncio 题官方文档顶位
- [x] **tavily keyless 匿名车道**：X-Tavily-Access-Mode: keyless（用户清单★+探针 6/6 证实）；isConfigured 恒 true + keySlot 无 key 也并入默认池（Phase Y 强注入教训这次的故意版本）；无 key 且无 baseUrl 才走匿名（网关/Hikari 语义不变）
- [x] **firecrawl（新 provider，显式启用）**：data.web[] 映射，markdown 噪音 clamp；升池与否等 bench 观察
- [x] **searxng 多实例回退链**：自建永远链首→内置兜底(mectov 333ms/xo.st)→SC_SEARXNG_INSTANCES 可覆盖；JSON.parse 判定防伪 200；单实例空结果换下家
- [x] **pubmed（academic 腿 5→6）**：eutils esearch→esummary 两步式；顺带稀释 arXiv 刷屏挂账项
- [x] **sov2ex（编程题中文腿）**：domains.ts zhBoostProviders CJK lang-guard，英文题零打扰
- [x] **mcp-connector argsTemplate + excerpts 数组归一化**：Parallel 匿名 MCP 一行配置即插（initialize/tools/list/tools/call 全 200 探针证实）
- [x] **第 8 轮 bench 无回归**：L1+L2=9/9；出勤 4.9→5.9（tavily+anysearch 全勤）；vs-zai 第 5 采样 4/4 战平+延迟反超+Jaccard 0.16→0.46-0.58（聚合覆盖增量实证）
- [x] 测试 185→200；文档：keyless-increments.md（探针矩阵全案）+engines 39/36+SKILL 36+README 200+baseline 十一/十二节+vs-zai 附录+selfhost 附注+targets Phase AB+worklog

## Phase AC — 三层权威体系 + 智谱来源逆向 + 额度可见性（2026-09-03 第二十三~二十四轮，用户"效果优化/自引擎+权威站优先/免费 key 额度熔断/逆向智谱来源按类补充/总白名单 v3/胆大一点"）—— ✅ 落地（215/215）

- 智谱来源逆向：core/scripts/zhipu-source-mining.mjs 14 题×6 类采样（原始 JSON /tmp 不入仓）；结论：学术面与我方表重合无增量、zh 教程面真增量（知乎专栏/runoob/liaoxuefeng/cnblogs/ruanyifeng/cloud.tencent/rustwiki 入主题表 zh 守卫）、对方也中招 csdn×2
- 三层权威（authority.ts 重构）：第 0 层全局 16 域兜底 → 第 1 层主题表 TOPIC_AUTHORITY（7 主题，S=1.2/A=0.75/B=0.4 分档换算，user v3 +5..-3 裸值不直接用的理由在案）→ 第 2 层意图表 CATEGORY_AUTHORITY（10 类，不改路由只改排序）；zh 条目 lang 守卫；讨论意图 kind=community 升 s 档（source_policy 最小版）；三层取最强计一次分非叠加
- 已知修正落地：djangoproject.com/stratechery.com/nfra.gov.cn/learn.microsoft.com/element-plus.org；protocol.com 停运不收；overqualified.cn 无法核实不入
- 额度可见性：providers() 透出 QuotaTracker 快照（used/remaining/exhausted/resetsAt）——"额度满了怎么办"先能看见；熔断防线盘点在案（月度计数+432 一票判死+月度滚动+分类熔断+半开探针翻倍）
- 实测抓回归：s 档上线致 docker compose 题 MDN×5 霸屏 MISS → 混源主题（programming/academic）domainCap 恢复 3（registry 专线 packages/devops 保 0），复测 MISS→HIT，回归锁入 fusion2.test
- bench 第 9 轮：L1 9/9、L1+L2 9/9 无回归，出勤 5.9，authorityHits 56，spamBlocked 7；zh 面第 3 采样 5/5 vs 5/5 全 HIT，向量数据库题 zh 分档首战见效（知乎/博客园/腾讯云/zilliz.cn 进 top5）
- 测试 200→215；既有 flake 修复（engine.search 无腿测试补 keySlots:"off" 隔离 tavily 免 key 车道联网泄漏）
- 文档：baseline 十三节+engines 三层权威节+vs-zai 附录 C（采样全案）+SKILL 描述升级+README 阶段三行+本节

## Phase AD — 老待办清仓轮（2026-09-03 第二十五轮，用户"yolo 直到没有任何需要做的"）—— ✅ 落地（230/230）

- crates.io SPA 空文本（挂 5 轮）✅：fetcher 落地页改写链，裸 crate 页→官方 API 直取+人读摘要；bench fetch fails 里 crates 清零
- doi 403→OA 直链（挂 5 轮）✅：403 与 SPA 假 200 双触发→OpenAlex→Unpaywall 双通道+自环守卫；全链实弹（IEEE 403→arXiv 仓库 5453ch，journal oa_fallback=1）；诚实发现：OpenAlex 匿名池当日额度烧光时带 mailto 也 429，双通道必要
- fact 型 wiki 出勤保障 ✅ 有据关账：8/9/10 轮连续全勤且第 10 轮 L2 直接命中，无需机制补丁
- Nominatim 转正 ✅：geo 主题（在哪/坐标/地址/where is）+ provider（OSM 官方，空结果=合法空），注册 36→37；实弹"故宫 在哪"走 domain/geo、top1=OSM 对象 kind=geo
- SC_AUTHORITY_JSON 外挂 ✅：env/file JSON 覆盖权威表（追加/同域覆盖/非法跳过/坏 JSON 不阻塞）；实弹 boost 生效
- vs-zai 第 6 采样：9/9 vs 9/9；asyncio 题 top5 换血官方面（s 档生效），zh 题知乎/博客园进前排，spamDropped=5
- bench 第 10 轮：L1 9/9、L1+L2 9/9 无回归，出勤 6.9，fetch 20/27（crates 清零，余下全是无 DOI 硬反爬，诚实留档）
- 测试 215→230；文档：baseline 十四节+engines 改写链节+targets 待办勾销+SKILL/README 同步+本节

## Phase AE — vs-zai 全面性×质量双维实测+专线兜底修复（2026-09-04 第二十六轮，用户"进行测试看看全面性和质量和你比怎么样"）—— ✅ 落地（234/234）

- vs-zai 第 7 采样（新脚本 vs-zai-quality.mjs，9 题双边 top-10 逐 URL 打标）：L1 8/9 vs 9/9；质量 s 档 17 vs 11 / s 进 top5 15 vs 10 / 权威命中 44 vs 21 / csdn 进 top10 0（主动屏 6）vs 2；全面性 uniqDom 7.7 vs 8.6、独占源 +4.1 vs +5.0、Jaccard 0.31；延迟 4.2s vs 1.1s（输）
- 唯一败题 k8s 根因（复跑两次复现）：programming 宽词截胡 → 专线无聚合兜底 + mdn 腿模糊匹配 "best practices" 返回 WebGL/PWA 泛教程页 top3；次发现：s 档域级提权抬错页（asyncio 题 MDN zh 教程页×3 进 top5）
- 修复 ①：mdn web 亲和守卫（查询无 web token 合法空零请求，短词词边界防 json→js/webhook→web 误配；async/await 故意不收防 asyncio 误配）
- 修复 ②：programming 专线 leg-0 补 searxng+tavily keyless 兜底腿（registry 专线 packages/devops 保持纯 API 腿，case-4 纯度教训）
- 修复后第 8 采样同尺复测：L1 9/9 vs 9/9（k8s 翻绿）；pg 题反超（postgresql.org 进 top5，原双方共同盲区）；asyncio top5 换血官方面；s 档 20、top5s 19；延迟约 2.2s；Jaccard 0.45
- bench 第 11 轮：L1 9/9 无回归；L1+L2 8/9 = route-packages 判分脆弱性（crates.io 排序波动 tokio 掉到 #4，bench 只抓 top-3；改写链实弹正常，非代码回归，挂账）；zh 面第 4 采样 5/5 vs 5/5，对方 csdn 中招 2 题 core 0
- 测试 230→234（laneLegProviders 2 + mdn 守卫 2）；文档：vs-zai 附录 D+engines 专线兜底节+SKILL/README 同步+本节

## Phase AF — 三项挂账闭环：页面级守卫 + bench 判分窗 + kind 补密度（2026-09-04 第二十七轮，用户"继续 yolo"）—— ✅ 落地（241/241）

- **页面级相关性守卫**（AE 挂账①，fusion.ts keyTermPresent）：s 档域级提权抬错页根因治理——权威命中条查 title/snippet/url 是否含查询关键 token（ASCII 取最长词做技术词锚抗 zh 长词噪音，纯 zh 取最长 run，子串判定 fail-open），缺失→提权清零（只压分不剔除），ref.authorityGuarded + meta/journal 计数透出；实测 asyncio 题 top5 换血官方面（MDN 错页清零），防误伤有测试锁
- **bench L2 判分窗 top-3→top-5**（AE 挂账②，quality-bench.mjs）：前 3 全量抓保质量口径，L1 未解且前 3 未解才补抓 4/5，已解短路；r11 route-packages 8/9 判分脆弱性消除
- **kind 补密度 classifySourceKind**（AE 挂账③，authority.ts）：显式 kind > 域名模式（github/reddit/zhihu→community、forbes→media、wikipedia→reference）> 表缺省（s 档官方域=official、news=media、dictionary/entities=reference）；ref.sourceKind 标注 + vs-zai 两侧同尺（kind 桶 0.1→2.0 vs 1.5）；纪律=纯元数据不改排序，社区翻转仍只认显式 kind（github 不升档，测试锁）
- bench 第 12 轮：L1 9/9、**L1+L2 9/9** 无回归；出勤 4.8、authorityHits 46、spamBlocked 7、1826ms、清洗 100%；fetch 18/27 全是已知硬反爬+1 死链博客（诚实留档）
- zh 面第 5 采样 5/5 vs 5/5；vs-zai 第 9 采样 quick：L1 4/4 平、s 档 6 vs 4、权威命中 18 vs 9、csdn 0 vs 2、Jaccard 0.41；延迟仍输（1.8-3.8s vs 1.0s，维持结论）
- 测试 234→241；踩坑：测试夹具 snippet 为空 unrealistic——arXiv 真实结果摘要必含 transformer，守卫触发后旧夹具翻车，修夹具同步真实形状
- 文档：vs-zai 附录 E+engines AF 节+baseline 十五节+README/SKILL 同步+本节

## Phase AG — 扩充计划（2026-09-04 第二十八轮，用户"继续扩充优化计划，然后继续做"）

> AF 后诚实盘点：质量层四道关已闭环（域级提权+页面守卫+domainCap+spam 层），vs-zai 延迟是唯一持续输的维度（1.8-3.8s vs 1.0s，软截止默认 6s 是结构性原因）。本阶段四批：

- [x] **AG-1 扩源探针第 2 批** ✅：9 候选实证 2 项接入——pypi（包元数据直取+license，非搜索端点，含空格/404 合法空）+ hfpapers（HF Papers AI 论文面，academic 腿 6→7）；" paper" 带前导空格路由词（en 学术题进线，newspaper/whitepaper 零误伤实测）；诚实关账 7 项（openlibrary 两日两次网络失败/s2 仍 429/qwant 浏览器头仍 403/gitlab 403 挑战页/searchcode 404 死亡/gdelt 官方明文 1req/5s 与并行池结构性冲突/ia 同 web.archive 沙箱不可达）
- [x] **AG-2 延迟专项** ✅：量化坐实 7/9 题打满 6s 软截止（refs 12-20 在手干等慢腿）→ router 早收割（earlyHarvestMs 默认 1200ms+60% 腿结算+refs≥15 三条件护栏，软截止仍兜底）→ 9 题均值 4859→1663ms（-66%），bench r15 L1/L2 9/9 零回归且均值 2270→1096ms（-52%），vs-zai 第 10 采样延迟首次反超（819ms vs 1034ms）
- [x] **AG-3 权威表外置** ✅：四层 JSON 落 `core/data/authority/`（global 16 域/topics 7 表 188 条/categories 10 类 200 条/credibility blocked 12+downweight 3），`authority-dump.mjs` 从 dist 一次性导出保证零转写错误，表政策注释住 `_meta` 字段；loader 逐条校验（坏条目跳过+告警，同外挂纪律）——设计细化诚实说明：JSON 为**单一真源**不再保留代码副本（双源必有漂移），"回退内置表"细化为"整文件不可读→空表+loud warn"，测试守门（新增 JSON⊆内存逐条一致测试）；`" paper"` 外的检测关键词/kind 分类逻辑留代码；SC_AUTHORITY_JSON 实弹复验仍最外层生效
- [x] **AG-4 license_status 数据增强** ✅：pypi ref.license 透传（API 本就返回）+ crates 改写链摘要补 license 行；npm/packagist/rubygems 搜索 API 不返回 license，诚实不做逐条二次请求

## Phase AH — 全量 24 题对照 + 三结构性修复（2026-09-04 第二十九轮，用户"进行更多题目的测试起码20道各个领域的题目"）

- [x] **AH-1 题库外挂化** ✅：vs-zai-quality.mjs 支持 `--cases/--label`（默认 9 题行为不变），新题库 `vs-zai-cases-full20.mjs` 入仓——24 题覆盖 topic 7/7 + category 10/10 + 横切意图 3，复跑零成本
- [x] **AH-2 第 11 采样（修复前）** ✅：L1 21/24 vs 23/24，抓出三个 bench 照不出的结构性问题——github 专项窄腿全灭 1ms 零结果（熔断冷却无兜底）/ images 单腿 openverse 合法空即塌方（throw 计熔断败）/ arxiv+crossref 坐默认池对非学术题乱入 6+ 题（vs 对比 multi 子查询全中招）
- [x] **AH-3 四修复** ✅：零结果抢救腿（健康聚合器兜底轮：attempted 过滤+软截止 3s 封顶+尊重 engines 配置+meta.rescued 透出+journal）；openverse 合法空（return [] 不 throw，形状漂移仍抛）；images 车道补聚合兜底腿（非 registry 无纯度包袱）；arxiv/crossref 移出默认池（学术只走专线关键词路由，wikipedia 留池保 fact 出勤）
- [x] **AH-4 回归与复测** ✅：测试 250→255 全绿（rescue×3/openverse×1/lane×1）；bench r17 L1 9/9+L1+L2 9/9 零回归（enginesAvg 4.8→2.8）；第 12 采样同尺复测：L1 23/24 vs 24/24、权威命中 56 vs 39（1.4×）、csdn 0 vs 2、**延迟 557ms vs 1243ms（2.2×，24 题规模坐实反超）**、独占源 +5.8 vs +5.5、Jaccard 0.14；诚实短板留档：s 档进 top5 密度 12 vs 17（news/security/finance 正主第一率=下一质量项）
- [x] **AH-5 文档** ✅：vs-zai 附录 F + engines AH 节 + baseline 十七节 + README/SKILL 同步 + 本节

踩坑留档：ddg 全局限速门（进程级 lastDdgAt 默认 3s）跨测试泄漏 → 腿睡满 gate → 轮询等满软截止+迟到排水（database is not open）；测试注入 SC_DDG_MIN_INTERVAL_MS=0。

## Phase AI：类目正主前排 + 检测召回补齐 + 守卫多证据放行（2026-09-04，用户"继续优化但是确保广度不要被砍"）

> 攻附录 F 诚实短板（s 档进 top5 密度 12 vs 17）。广度红线：表只扩不缩、池不精简换分、24 题全量继续当回归尺。

- [x] **AI-1 先量化** ✅：`ai-top5-diagnose.mjs` 入仓（逐 URL 拆 lex/authority/残差 + 提升模拟）——四根因：detectCategory 生产路径失活（6/10 类目题 null，类目权威层根本没参与排序）/ 类目 s 档 1.2 不够（mysql 差 +0.9）/ AF 守卫单长锚误伤官方页（rapid7/cac.gov.cn 不清零即 #1）/ 表缺口（europa.eu/厂商安全域/medlineplus）
- [x] **AI-2 四修复** ✅：detectCategory 最长关键词胜出消歧（"open data">"gdp"）+保守补锚 16 个（误伤审计 13 条全过）；CATEGORY_S_FRONTROW=2.0（只动命中类目表 s 档，三重保护）；守卫多证据放行（≥2 其他 token，AF 回归锁全过）；categories.json +11 条/1 升档（khan a→s 第一方正主）
- [x] **AI-3 回归与复测** ✅：测试 255→263 全绿（fusion3 ×7 + detectCategory 锁）；bench r18 L1 9/9+L1+L2 9/9 零回归；第 13 采样：L1 24/24 双满分、s 进 top5 20 vs 20 追平（12 vs 17→追平）、s 档 27 vs 25 反超、权威命中 68 vs 46（1.48×）、延迟 699 vs 1389ms（2×）、独占源 +5.9 vs +5.3 / Jaccard 0.15（广度指标全不降）；education 面"双方都差"→我方明显胜
- [x] **AI-4 文档** ✅：vs-zai 附录 G + engines AI 节 + baseline 十八节 + README/SKILL 同步 + 本节

诚实剩余：news/security 官方源召回面差距（cisa/nvd/europa.eu 不被 keyless 池返回——召回面按架构指令冻结，融合层只能排池内）；检测补词保守集，zh 药名类长尾仍漏。

## Phase AJ：security/news 专线 + CVE 元数据三腿（2026-09-04 第三十轮，用户"继续"，攻附录 G 诚实剩余）

> 召回面冻结架构下的加法路径：扩源=加引擎（AG-1 pypi 先例），融合排序零改动，广度红线全程守（表只扩不缩/池不动/lane 全加法）。

- [x] **AJ-1 探针第 3 批** ✅：7 候选 5 过（NVD cveId 精查/OSV GET/GHSA/GoogleNews 复验/BingNews RSS；CISA KEV HTML 挑战页❌关账；NVD keywordSearch 精度差❌）——probe-aj-sources.mjs 入仓，原始 JSON /tmp/phase-aj
- [x] **AJ-2 CVE 元数据三腿** ✅：nvd/osv/ghsa（pypi 纪律：CVE 编号直取，无编号合法空零请求；404/空数组合法空；ref=官方详情页）
- [x] **AJ-3 两条新 lane** ✅：security（三腿+聚合兜底）/ news（googlenews 合法空改造+bingnews url= 解码+聚合兜底）；锚保守集+" news " 双空格纪律防 newsletter 误配、"最新进展"故意不收防学术劫持
- [x] **AJ-4 医疗锚补充** ✅：detectCategory +12 zh/en 药名药类锚（zh 药名长尾诚实剩余②），跨类冲突靠 AI 最长胜出消歧
- [x] **AJ-5 表扩充** ✅：categories.json security +osv.dev(s)——+1/0 删
- [x] **AJ-6 测试** ✅：263→276 全绿（CVE 三腿 golden/extractCveId/bingnews 解码/googlenews 合法空/路由锁/laneLegProviders 锁/医疗锚 FP）
- [x] **AJ-7 回归与采样** ✅：bench r19 L1 9/9+L1+L2 9/9 零回归；第 14 采样 24 题同尺：L1 **24/24 vs 23/24 连续双满分**、s 档 **31 vs 24**、**s 进 top5 22 vs 19 首次反超**、权威命中 69 vs 47（1.47×）、延迟 912 vs 1378ms（1.5×）、独占源/uniqDom/kind/Jaccard 全部持平不降——**news 题 europa.eu top1 / security 题 osv.dev top1，附录 G 召回差距正面闭环**
- [x] **AJ-8 文档** ✅：keyless-increments 第六节 + engines AJ 节（计数 46/43）+ vs-zai 附录 H + baseline 十九节 + README/SKILL 同步 + 本节

踩坑留档（工具级）：会话输出管道把 `[m`（数组首元素 m 开头的字面量）当 ANSI 序列吃掉——rg/sed/python print/node console.log 全中招，写层无损读层有损，hex 级检查才现形；编辑此类行用 python 直读。
诚实剩余：cisa.gov 官方页未直接进 top5（KEV feed 挑战页关账）；security 题 top2-5 兜底腿波动；mysql dev.mysql 池外留档；检测锚保守集继续外挂兜底。

## Phase AK：domainCap 注册域粒度修复（2026-09-04 第三十一轮，phase AJ 复测暴露的补漏）

- [x] **诊断** ✅：第 14 采样 security 题 top2-5=sports/baseball/weather.yahoo.co.jp——cap 按 hostname 计数，子域集群各领配额绕过 cap=3（AC"单源霸屏"意图漏了子域情况）
- [x] **修复** ✅：fusion.ts registrableDomain()（近似 eTLD+1，两级 TLD 白名单 30 项），cap 改按注册域计数；诚实边界=github.io 等自由托管跨用户子域共享 cap（收紧方向正确，注释留档）
- [x] **回归** ✅：测试 276→278（registrableDomain 单元+集群回归锁）；bench r20 L1 9/9+L1+L2 9/9 零回归；第 15 采样 yahoo 集群消失、osv.dev top1 保持；阿司匹林题本轮池波动 miss 诚实留档（r13/r14 均 HIT）
- [x] **文档** ✅：engines AK 节 + baseline 二十节 + vs-zai 附录 H 第 15 采样补节 + 本节

## Phase AL：data 类目表 +5 官方统计机构（2026-09-04 第三十二轮，表缺口修补）

- [x] **诊断** ✅：r15 data 题诚实观察（top5 泛面、worldbank 在 top10 非 top5）根因=data 表缺 worldbank.org
- [x] **修复** ✅：categories.json data +worldbank.org/imf.org/oecd.org/census.gov(s) +stats.gov.cn(s, lang:zh)——+5/0 删，第一批国际官方统计机构全入表
- [x] **回归与复测** ✅：测试 278 全绿；bench r21 L1/L2 9/9 零回归；第 16 采样 world bank 题 top1 正主、L1 24/24 双满分（阿司匹林回 HIT 坐实 r15 波动）、权威 71 vs 58；诚实记录 zai 本轮池强（s 34 vs 29）
- [x] **文档** ✅：baseline 二十一节 + vs-zai 附录 H 第 16 采样补节 + 本节

## Phase AM：词典/医学研究/数据 类目官方面（2026-09-04 第三十三轮，用户"继续，我不会给智谱key"，探针第 4 批）

> 智谱侧确认走内置 CLI 免 key 路径（对照评测链路不受影响）。主线=类目面 keyless 官方 API 补齐：词典/医学/数据等类目此前在 DOMAIN_TABLE 无 lane，召回全靠 generic 池——AJ 加法扩源路线续批，广度红线全程守（表只扩不缩/池不动/lane 全加法）。

- [x] **AM-1 探针第 4 批** ✅：10 候选 4 过 6 诚实关账——✅wiktionary(en+zh 854ms)/✅europepmc(hitCount 2 万级)/✅clinicaltrials(NCT 直链 295ms)/✅worldbank(指标直取 428ms)；❌dictionaryapi(2/2 超时)/❌SEC EDGAR(403 挑战页)/❌gbooks(免 key 429 配额枯竭)/❌s.jina.ai(401 强制 key)/❌searxng 扩容(6 候选 0 过全 Anubis)/❌mysql docs(403)。probe-am-sources.mjs+probe-am-retry.mjs 入仓，原始 /tmp/phase-am
- [x] **AM-2 三 lane 落地** ✅：dictionary=wiktionary（CJK→zh.wiktionary，零命中合法空）/ medical=europepmc+clinicaltrials（研究意图腿）/ data=worldbank（指标码×国家码小保守映射直取，未知指标合法空**零请求**）；均带 searxng+tavily 聚合兜底腿（合法空防塌方同款）
- [x] **AM-3 防劫持保守审计** ✅：词典锚不收裸"定义/define"（编程题表序先行，回归锁）；医学锚只收研究意图（clinical trial/随机对照/荟萃分析…），药名/副作用题不进线（归 generic 池+medlineplus 提权，保 zh 健康内容广度——24 题阿司匹林/metformin 题实证）；数据锚只收强官方统计意图
- [x] **AM-4 表只扩不缩** ✅：categories.json dictionary +wiktionary.org(s)、medical +clinicaltrials.gov(s)+europepmc.org(a)——+3/0 删；注册 43→47
- [x] **AM-5 测试与回归** ✅：278→**292 全绿**（四 provider golden×10+lane 路由锁×6 含防劫持双向锁）；bench r22 L1 9/9+L1+L2 9/9 零回归（enginesAvg 3.4）；medical lane 24 题外实弹（metformin 研究题 europepmc top1×3+clinicaltrials 出勤，1020ms）
- [x] **AM-6 第 17 采样** ✅：L1 23/24 vs 24/24；s 32 vs 34、s+a+b 52 vs 51、authorityAny 223 vs 193——本轮 zai 池强（诚实记录，方向性结论）；延迟 871 vs 1500ms（1.7×）保持；**广度四指标持平**：uniqDom 7.2 vs 7.0、独占源 +5.5 vs +5.3、kind 1.6 vs 1.7、Jaccard 0.15。逐面：**dictionary 题 en.wiktionary.org top1（×3 进 top5，新 lane 首轮兑现）**、**data 题 data.worldbank.org top1**（lane+frontrow 双链路）
- [x] **AM-7 文档** ✅：keyless-increments 第七节+engines AL/AM 节+baseline 二十二节+vs-zai 附录 H 第 17 采样+README/SKILL 同步+本节

诚实留档：images 题（unsplash pexels api comparison）miss——openverse 合法空（AH 根因）+公共 searxng 垃圾轮换（三次复现三套不同垃圾），波动性失败非回归（AM 未触碰 images 面），r12-r16 HIT=openverse 返窗期，同 r15 阿司匹林题先例。

## Phase AN：images 车道第 4 兜底腿 + images 主题表 +3（2026-09-04 第三十四轮，r17 诚实留档闭环）

- [x] **诊断** ✅：r17 images 题 miss 双根因=openverse 对 "api comparison" 题面合法空（AH 留档）+兜底双腿同时掉链（tavily rate_limited+公共 searxng 垃圾轮换）
- [x] **修补①加腿** ✅：laneLegProviders images +keenable（第 4 兜底腿，免 key 独立索引，对该题实弹验证返回官方面对比页）——单实例垃圾轮换不再整题塌方
- [x] **修补②补表** ✅：topics.json images 空占位表 +unsplash.com/pexels.com/pixabay.com 三条 s（第一方图库平台，表只扩不缩）
- [x] **实效** ✅：images 题 top1=unsplash.com/developers、top2=pexels.com/api；单题正式采样 core=HIT/zai=HIT（465ms）；结果面法院垃圾→高相关 API 对比内容
- [x] **回归** ✅：测试 292 全绿（images 兜底腿锁同步 4 腿）；bench r23 L1 9/9+L1+L2 9/9 零回归
- [x] **文档** ✅：engines AN 节+baseline 二十三节+vs-zai 附录 H 补段+PROGRESS+worklog

- [x] **r18 全量采样** ✅：L1 **24/24 vs 24/24 双满分**（images 题翻绿全量坐实）；延迟 772 vs 1847ms（2.4×）；广度持平（uniqDom 7.2 vs 7.2、Jaccard 0.16）；s 32 vs 36 zai 池强窗口诚实记录
- [x] **挂账裁决** ✅：「GitHub 仓库级二次判断」诚实关账不做（无案例暴露失败 + 逐 ref 二次请求违诚实线 + org 名单腐烂快）——优化待办池至此全部清零

## Phase AO：Rust 重写可行性 POC（2026-09-04 第三十五轮，rust-poc 分支，main 不动）

- [x] **诚实裁决** ✅：全量重写=5345 行 src+292 测试实战行为沉淀，一次会话到可交付级不现实；开分支做同车道 POC 拿决策数据（用户指令"可行就开分支做"）
- [x] **POC 实测** ✅：同 query 同 3 车道（keenable/bingrss/searxng）头对头——墙钟 0.41s vs 3.34s（8.1×）、VmHWM 4.3MB vs 108.9MB（25×）、3.7MB 单文件 vs 36MB+Node 前置、车道出勤 3/3 持平；Rust 冷启动 <8ms
- [x] **诚实边界** ✅：3/29 车道、fusion-lite（RRF+consensus）、无 authority/planner/cache/focus/research/MCP/breaker/SSRF 门；refs 不可比，只做占用/延迟结论不做质量结论；全量对齐按周计
- [x] **决策建议** ✅：桌面宿主留 TS（v0.8.1 够用）；<128MB 受限运行时 Rust 是唯一路径，POC 即起点；双运行时中间态不建议
- 分支：`rust-poc`（d4b8055，ls-remote 验证一致）；详见 poc/README.md

## Phase AP：语言裁决 Go + go-port P1 地基（2026-09-04 第三十六轮，go-port 分支）

- [x] **语言裁决** ✅：Go（保真度/迭代速度优先；Rust POC 留作极限下限证据）；环境实装 Go 1.25.0
- [x] **分期计划** ✅：go-port/PLAN.md——P1 地基✅/P2 默认池车道/P3 质量层全量（里程碑=L1 9/9+广度持平）/P4 外围出口/P5 research+全量采样；放弃条件写死
- [x] **P1 实测** ✅：同 query 同 4 车道——VmHWM 15.0MB vs TS 107.5MB（7×）、首跑墙钟 1.32s vs 3.57s（2.7×）、出勤 4/4 持平、6.2MB 单静态文件、冷启动 <8ms；10 单测绿
- [x] **真 bug 修复** ✅：stdlib flag 位置参数终止解析（--engines 被吞+wikipedia 假失败）→ 自定义解析对齐 TS parseFlags；urlNorm 尾斜杠语义单测锁定
- 分支：`go-port`（a9df792，ls-remote 验证一致）；详见 go-port/PLAN.md + go-port/README.md

## Phase AQ：go-port P2-c 车道补齐 + L1 9/9 里程碑（2026-09-04 第三十七轮，go-port 分支）

- [x] **P2-a/b/c 车道全量** ✅：registry 44/44（31 keyless+registry+HTML + 13 学术/安全/词典/医学/数据/时间机器；key 插槽 brave/tavily/exa 与 MCP 连接器除外），契约逐字实抄
- [x] **P3 质量层全量** ✅：planner（x>github>research>multi>domain>web+zh 自动路由）+DOMAIN_TABLE 13 主题+腿编排（laneLegProviders/condensePackagesLeg/zhBoost）+权威 v3（三层 max-not-sum+catFrontrow+页面守卫）+spam 双档+TF 语义去重+domainCap（packages/devops=0 纯度档）
- [x] **L1 里程碑门禁** ✅：9 题 quality bench Go 侧 **L1 9/9 全 HIT**（44 车道全栈下正式达标）
- [x] **诚实验尸** ✅：失败车道逐个 TS 同环境对照归因（mojeek/marginalia/stackexchange/openalex=环境与端点侧，移植无罪）；自查出检查器比 TS bench 严格并修正
- 分支：`go-port`（0718b51，ls-remote 验证一致）；P4（focus/MCP/熔断）与 P5（research/xchain/24 题全量）排队 PLAN.md

## Phase AR：go-port 合并 main + 三出口 E2E 实弹验收（2026-09-05 第三十八轮，main）

- [x] **MCP stdio E2E 实弹验收** ✅：真实 MCP host 身份（行分隔 JSON-RPC 2.0 完整握手 initialize→tools/list→tools/call×4）打穿 serve 出口；工具#2 fetch focus 命中段 60209→2817 字符省 95.3%、工具#3 search_providers 44 车道健康普查、search 全链路 8 refs；E2E 客户端入库 scripts/mcp-client-e2e.mjs 可作 CI 门禁
- [x] **E2E 暴露并修复两处接线缺口** ✅：①cache_stats 三出口原挂 "pending P4.5" 过时占位→接真实 Cache.Stats()（cacheStatsSnapshot 共享快照）；②MCP/serve-http 的 fetcher 传 nil pageStore=页面缓存仅进程内（fromCache:false 287ms 实证）→newPersistentFetcher() 共享工厂统一挂 SQLite pageStore，修复后跨出口命中 4ms
- [x] **合并后门禁** ✅：87 单测绿 + gofmt/vet 干净 + 24 题 bench 复跑 **L1 24/24 ALL HIT**、uniqDom 7.33（TS 7.7，广度持平不回退）、引擎出勤 13.9、缓存热延迟均值 205ms
- [x] **合并 main** ✅：merge --no-ff（2b880b4），go-port（44 车道+planner+权威 v3+语义融合+governor+focus fetcher+熔断 2.0+journal+REST/SSE+MCP 全工具面+FTS5 持久缓存+早收割）成主线 Go 引擎；TS 主链（core/）保留可用
- 度量：VmHWM 2-15MB vs TS 107.5MB（5-40×）、11.5MB stripped 单静态二进制 vs 36MB+Node≥22.5、MCP/CLI/HTTP 三出口全部实弹闭环

## Phase AY：探针第 12 批 Go 侧首发——academic/species/packages/food 四域加强 + wikidata 全短语清账（2026-09-05 第四十五轮，main）

- [x] **探针 12 候选（轮 1 全景 + 轮 2 幸存者深挖/红灯修正/curl 交叉归因 + 轮 3 定案/黄金样本）** ✅：academic 加强（semanticscholar/openreview）+music 加强（deezer）+entities 加强（restcountries）+species 加强（inaturalist）+finance 加强（coinpaprika）+food 加强（openfoodfacts）+programming 加强（searchcode/gitlab）+packages 加强（pubdev）+news 加强（lobsters）+devops 加强（nixos）；原始数据落 /tmp/probe-b12/，脚本入库 go-port/scripts/probe-b12-*.mjs（3 份证据链）
- [x] **4 车道接入（86→90）** ✅：openreview（academic 加强，notes 异构双形态=评审笔记 content.summary/rating+DBLP 记录 title/abstract/authors，中文"强化学习"直中综述论文，**同 forum 多评审车道内去重**防融合层 URL 去重错位，authors 数组宽容解包防整条反序列化炸）、inaturalist（species 加强，中英词面双通：隼→Falconiformes/gyrfalcon→Falco rusticolus，俗名/观察数/灭绝标记）、pubdev（packages 加强，**dart/flutter 语言空白补齐**，search+detail 双腿，packageLangSignals +dart/flutter 裁腿行）、openfoodfacts（food 加强，传统 cgi/search.pl 端点 count 真过滤，v2 search search_terms 参数被忽略弃用=remotive 陷阱）；DOMAIN_TABLE 36 域不变（四域各 +1 腿，food 词面 +营养成分/配料表）
- [x] **8 案诚实关账** ✅：coinpaprika（轮 1 200 后全 402 payment_required，免费档名存实亡）、restcountries（v3.1 全线 deprecated+新 host 401 authKeyMissing 鉴权墙）、semanticscholar（首发+退避重试均 429，无 key 共享池饱和）、searchcode（codesearch_I/J 404 API 已死）、nixos（SPA 壳+backend bonsai.io 401 双证死）、deezer（403 Akamai 边缘 IP 级，curl 双证，scryfall 同案）、lobsters（curl 10s 超时 0 字节，传输层不可达，gdelt 同案）、gitlab（轮 2 侥幸 200 轮 3 复测 403 Blocked 反爬页，不稳定）
- [x] **优先清账（批 11 挂账）：wikidata 全短语失败** ✅：根因=wbsearchentities 只匹配 label/alias，整句自然语言全灭（实弹取证 "who is linus torvalds"→search:[] 而 "linus torvalds"→Q34253 直中）→ b12StripEntityIntent 意图词剥离重查（b11StripLyricIntent 同款）+asciiFace 降级+**词面性空结果合法归零防熔断污染**（rubygems 惯例，原 error 上抛致熔断误开）；修复后 CLI 实弹 "who is linus torvalds"→Linus Torvalds (Q34253) 直中
- [x] **实弹抓获 2 缺口当场修** ✅：①inaturalist 意图词混入 taxa 索引（"falcon taxonomy"→0、"隼 物种"→Life/Animalia 根元垃圾）→ b12StripTaxonIntent 先剥离再查（lrclib 歌词意图词同款，中文俗名保留）；②pubdev CJK 混合词原词命中率差 → asciiFace 替代原词主查+纯 CJK 合法空零请求（实弹归因：q=flutter 返回 pub.dev 真实热度榜，正当排序非固定列表陷阱）
- [x] **门禁** ✅：175 单测全绿（164→175，黄金样本×5+authors 数组宽容锁×1+实体/物种意图剥离×2+路由锁×1+注册锁×1+拒连回归×1，计数锁 86→90 滚动同步 ×6 文件+packages/academic 腿锁 ×4）+ gofmt/vet 干净 + L1 24/24 ×3 轮（uniqDom 6.92/6.79/6.83，出勤 32.9-33.2，缓存热 204ms）+ MCP E2E PASS（lanes=90, circuit_open=0）
- [x] **A/B 归因（worktree 干净基线法复用）** ✅：批 11 基线（ff5b7b8）同日重跑 L1 24/24 ×3，uniqDom 6.88/6.88/6.83，出勤 32.5-32.6 → **批 12 净效应：广度 0 回退（6.85 vs 6.86，噪声内）+ 引擎出勤 +0.55（32.53→33.07）**——连续六批 A/B 口径正增量（+0.7/+1.1/+2.0/+1.3/+1.05/+0.55）；批 11 报告值 7.21→今日双侧 6.85 为外部世界漂移（b6/b7 方法论先例）
- 度量：车道 86→90、域 36 不变（四域加强）、新提取器 b12StripEntityIntent/b12StripTaxonIntent

## Phase AX：探针第 11 批 Go 侧首发——manga/lyrics/chemistry/quakes 四域六源口子 + 融合层同 URL 错位抓获（2026-09-05 第四十四轮，main）

- [x] **探针 12 候选（轮 1 全景 + 轮 2 幸存者深挖/红灯复验 + 轮 3 curl 交叉归因/黄金样本）** ✅：movies（imdbot）+manga（mangadex）+cardgames（scryfall）+lyrics（lrclib）+chemistry（pubchem）+机动（usgs-quakes/nagerdate/endoflife/frankfurter/dictionaryapi/mankier/rfc-editor）；原始数据落 /tmp/probe-b11/，脚本入库 go-port/scripts/probe-b11-*.mjs（3 份证据链）
- [x] **6 车道接入（80→86）** ✅：mangadex（**新 manga 域**，title 匹配含各语 altTitles，实弹中文"葬送的芙莉莲"直中）、lrclib（**新 lyrics 域**，从 music 域接管 歌词/lyrics 词面，实弹"晴天 周杰伦"直中中文曲库）、pubchem（**新 chemistry 域**，PUG REST 精确名直查，中文 404→仅 ASCII 化学锚）、usgsquakes（**新 quakes 窄意图域**，意图解析型 openmeteo 先例，minmagnitude=6 拉最新强震）、endoflife（devops 加强，双腿 all.json 产品 slug 匹配+别名表→/{slug}.json）、frankfurter（finance 加强，币码提取（ASCII+中文别名表）→latest，规范页 301 终点验证）；DOMAIN_TABLE 32→36 域
- [x] **6 案诚实关账** ✅：imdbot（服务端 500 error_code=103，Node+curl 双证死）、scryfall（403 rule=restricted IP 级限制）、dictionaryapi（Node 12s 超时+curl 同死，传输层本机不可达）、nagerdate（仅按国家/年份列举无关键词搜索，biorxiv 同款模板失配）、mankier（explain 单 ref 价值弱）、rfc-editor（Nuxt SPA 客户端渲染无服务端结果行）
- [x] **实弹抓获 3 缺口当场修** ✅：①**lrclib "晴天 歌词"全灭**（意图词混入曲名索引）→ 意图词剥离重查（gbif 疑问后缀剥离同款）；②**endoflife 各 cycle 共享规范页 URL，融合层"URL 去重+长 snippet 胜出"跨条目错位**（title 3.14 配 3.13 数据）→ 产品页单 ref 聚合前 3 cycle——**"同规范页多实体"是融合层 URL 去重的结构性盲区**；③**"最近地震"并入 geo 被 nominatim 地理编码污染**（查询被当地点名返回街道）→ 独立 quakes 窄意图域行独占 usgsquakes 腿（意图解析型车道与泛域腿互斥的正解）
- [x] **既有行为观察挂账** ✅：wikidata "who is linus torvalds" 全短语 no results parsed——stash 对比基线 d8a2a6a 同败（非本批回归），疑全短语进实体搜索词面，待未来批次按 rubygems 清账法查因
- [x] **门禁** ✅：164 单测全绿（148→164，黄金样本×6+提取器×4+路由锁×2+注册锁×1+拒连回归×1+意图剥离×1，计数锁 80→86 滚动同步 ×5 文件+devops 腿锁 ×2）+ gofmt/vet 干净 + L1 24/24 ×3 轮（uniqDom 7.21/7.21/7.13，出勤 31.8-32.0，缓存热 204-205ms）+ MCP E2E PASS（lanes=86）
- [x] **A/B 归因（worktree 干净基线法复用）** ✅：批 10 基线（d8a2a6a）同日重跑 L1 24/24 ×3，uniqDom 7.17-7.21，出勤 30.8-30.9 → **批 11 净效应：广度 0 回退（7.18 vs 7.20，噪声内）+ 引擎出勤 +1.05（30.85→31.9）**——连续五批 A/B 口径正增量（+0.7/+1.1/+2.0/+1.3/+1.05）

## Phase AW：探针第 10 批 Go 侧首发——drinks/travel/ide-ext/wordpress 四域七源口子 + rubygems 熔断清账（2026-09-05 第四十三轮，main）

- [x] **探针 12 候选（轮 1+幸存者强度复验/红灯修正+定案采黄金样本）** ✅：drinks（thecocktaildb）+travel（wikivoyage）+ide-ext（openvsx/jetbrains-plugins）+wordpress（wp-plugins）+species 加强（uniprot）+devops 加强（snapcraft）+机动（softwareheritage/gdelt）+复核（homebrew/boardgamegeek/reliefweb）；原始数据落 /tmp/probe-b10/，脚本入库 go-port/scripts/probe-b10-*.mjs（3 份证据链）
- [x] **7 车道接入（73→80）** ✅：thecocktaildb（**新 drinks 域**，themealdb 姊妹站，drinks:null=正常空）、wikivoyage（**新 travel 域**，MediaWiki action API，繁体"東京"45 hits 中文可用）、uniprot（species 加强，**617KB→fields 瘦身 4.2KB**，reviewed:true 收敛 Swiss-Prot）、openvsx+jetbrains（**新 ide-ext 域双源**，规范页 extension/{ns}/{name} 与 /plugin/{id}-{slug} 实弹 200）、wpplugins（**新 wordpress 域**，官方 1.2 API）、snapcraft（devops 加强，v1 search+Snap-Device-Series 头）；DOMAIN_TABLE 28→32 域
- [x] **5 案诚实关账** ✅：boardgamegeek（XML API2 401 应用层鉴权，浏览器 UA 同样 401）、reliefweb（v2 匿名 403，appname 需人工申请）、gdelt（node 超时+curl 12s 0 字节，传输层归因=本机网络不可达）、homebrew（search.json 404，批 5 关账维持）、softwareheritage（Anubis 挑战页，AUR 同族）
- [x] **遗留清账: rubygems 熔断查因（批 9 挂账 ok=0/fail=7）** ✅：实弹归因=API 存活形状未变（curl 与 parse 结构体完全匹配），根因=**含中文词面全灭**（"ruby 哪个 http 客户端包好"→[]）→ 词面性空结果归零防熔断污染（openfda 惯例）+ asciiFace→longestASCIIToken 双级降级；修复后全链路 "ruby gem 推荐"→packages 域→rubygems 8/8 refs 全中
- [x] **实弹抓获 3 缺口当场修** ✅：①**security 域 "rce" 裸子串潜伏 bug**（woocomme-rce 误入安全域，任何含 source/force/merce 查询中招，b10 路由锁暴露，TS 同款潜伏）→ " rce " 空格锚定；②uniprot gzip 体未被 transport 透明解压（bad json \x1f 魔数）→ Accept-Encoding: identity；③wikivoyage 简体全 CJK 查询 API 0 命中且域路由吞通用腿 → travel 行加 siteTargets ["wikivoyage.org"] 由 DDG site: 腿承接 zh（"东京旅行攻略"→zh.wikivoyage 东京指南首位）
- [x] **门禁** ✅：148 单测全绿（137→148，黄金样本×7+路由锁×2+注册锁×2+拒连回归×1+rubygems 清账锁×1，计数锁 73→80 滚动同步 ×4 文件）+ gofmt/vet 干净 + L1 24/24 ×3 轮（uniqDom 7.50×3，出勤 29.0-29.1，缓存热 203-204ms）+ MCP E2E PASS（lanes=80, circuit_open=0）
- [x] **A/B 归因（worktree 干净基线法复用）** ✅：批 9 基线（c45d8c1）同日重跑 L1 24/24，uniqDom 7.50，出勤 27.8 → **批 10 净效应：广度 0 回退（7.50 同日持平）+ 引擎出勤 +1.3（27.8→29.1）**——连续四批 A/B 口径正增量（+0.7/+1.1/+2.0/+1.3）
- 度量：车道 73→80、域 28→32、单静态二进制约 12.3MB stripped

## Phase AV：探针第 9 批 Go 侧首发——finance/food/anime/sport/books 五域口子 + bench 门禁入仓（2026-09-05 第四十二轮，main）

- [x] **探针 12 候选（轮 1+幸存者复验+定案轮）** ✅：金融加密（coingecko）+食谱（themealdb）+动漫（kitsu，Jikan 替代）+体育（thesportsdb）+书籍（standardebooks）+职位（remotive）+文学（poetrydb）+复验 4 案（oeis/gbooks/openlibrary/jikan）+机动 2 案（relevantxkcd）；原始数据落 /tmp/probe-b9/，脚本入库 go-port/scripts/probe-b9-*.mjs（4 份证据链）
- [x] **5 车道接入（68→73）** ✅：coingecko（**新 finance 域**，免费档限频极严连打 5 次即 429 → crypto 窄词面守卫，btc/eth 三字母误伤 method 不收）、themealdb（**新 food 域**，"做法"太泛不收）、kitsu（**新 anime 域**，JSON:API，2.3-4.8s 慢源腿内）、thesportsdb（**新 sport 域**，test key "3" 30req/min 窄词面守卫）、standardebooks（**新 books 域**，gbooks/openlibrary/gutendex 全关账后 books 词面重启，精工 HTML 车道 li[typeof=schema:Book]）；DOMAIN_TABLE 23→28 域、表只扩不缩
- [x] **7 案诚实关账** ✅：oeis（CF 403 维持）、gbooks（429 维持）、openlibrary（连接超时维持）、jikan（上游 MAL 拒连维持）、relevantxkcd（API 端点 404 已死）、**remotive（search 参数无效——两查询返回相同 18 条固定列表，不可用作搜索）**、poetrydb（通配 404+精确匹配语义弱+2.8s 慢）
- [x] **实弹抓获 2 缺口当场修** ✅：①coingecko 混合词 "bitcoin 价格" 空结果（CLI 端到端暴露，providers 3/0 证服务正常=词面问题）→ asciiFace 降级补齐；②thesportsdb "NBA Lakers 球队资料" 全词面 0（curl 实证 "NBA Lakers"→null "Lakers"→1，API 为「查询词必须为队名子串」语义）→ **二级降级 longestASCIIToken（批 9 新模式，腿内最多 3 请求）**；另抓 idTeam "0" 无效条目形态（gbif key=0 同模式）
- [x] **bench 门禁脚本首度入仓** ✅：scripts/bench-gate.mjs（24 题题库逐题拷贝 b8 批，L1/uniqDom/出勤/延迟四指标，JSON 落 /tmp 不入仓）——补齐此前 bench 临时脚本不入仓的证据链缺口
- [x] **门禁** ✅：137 单测全绿（129→137，黄金样本×5+路由锁×2+注册锁×2+拒连回归×1，计数锁 68→73 滚动同步 ×3 文件）+ gofmt/vet 干净 + L1 24/24 ×3 轮（uniqDom 7.08-7.17，出勤 25.4-25.5，缓存热 203-204ms）+ MCP E2E PASS（lanes=73, circuit_open=0）
- [x] **A/B 归因（worktree 干净基线法复用）** ✅：批 8 基线同日重跑 L1 24/24，uniqDom 7.13，出勤 23.5 → **批 9 净效应：广度 0 回退（同日持平，噪声内）+ 引擎出勤 +2.0（23.5→25.4）**——连续三批 A/B 口径正增量（+0.7/+1.1/+2.0），广度持续不回退
- 度量：车道 68→73、域 23→28、单静态二进制 12.2MB stripped

## Phase AU：探针第 8 批 Go 侧首发——消费内容/生命科学/法律六域七源口子（2026-09-05 第四十一轮，main）

- [x] **探针 12 候选（两轮+修正轮+定案轮）** ✅：消费内容全空白面（books/tv/podcast/games/anime）+生命科学（species/drug/food）+法律（法规/判例）+开发者内容（devblog/tech-news）；原始数据落 /tmp/probe-b8/，脚本入库 go-port/scripts/probe-b8-*.mjs（5 份证据链）
- [x] **7 车道接入（61→68）** ✅：tvmaze（**新 tv 域**，多语言别名库+stripHtmlSnip）、itunes（**新 podcast 域**，Apple 官方 ~20req/min 腿内单请求合规）、steam（**新 games 域**，仅英文词面中文自然降级，/app/{id}/ 闭环）、gbif（**新 species 域**，nubKey 规范页）、openfda（**新 drug 域**，[]string 取首元素+DailyMed 闭环）、federalregister+courtlistener（**新 legal 域**双源：法规+判例）；DOMAIN_TABLE 17→23 域、表只扩不缩
- [x] **5 案诚实关账** ✅：gbooks（匿名 429×2 共享配额池耗尽）、jikan（504×2 上游 MAL 拒连）、openfoodfacts（fields 参数即 503+无参数 548KB 肥）、lobsters（fetch failed×3 连接层拒）、devto（q 参数无效=默认流+forem 内部端点 0 条）
- [x] **实弹抓获 4 bug 当场修** ✅：①tvmaze AND 语义中文修饰词全灭→asciiFace 降级重查（共享新模式）；②gbif backbone 多记录同 nubKey 同物种×5 全同 URL→seen 去重；③gbif 中文疑问修饰词把 Ginkgo 挤出 top3→疑问后缀剥离；④openfda 中文词面 400（非 404）→400 归零结果防熔断污染+asciiFace 重查；federalregister/courtlistener 同享 asciiFace（中文混词 count=0）
- [x] **探针方法学新收获** ✅：tvmaze 探针"查询词绑定失败"假象 → 深挖=Node undici 无 happy-eyeballs+本机 IPv4 路径劣化连接池污染（curl IPv4 正常证服务端无恙）；**Go net.Dialer 原生 RFC 8305 双栈回退免疫**——探针失败先做传输层归因再定源生死
- [x] **门禁** ✅：129 单测全绿（119→129，黄金样本×7+路由锁×2+注册锁×2+拒连回归×1）+ gofmt/vet 干净 + L1 24/24 ×3 轮 + MCP E2E PASS（lanes=68）
- [x] **A/B 归因（worktree 干净基线法）** ✅：批 7 基线同日重跑 uniqDom 6.21（其自身历史 6.9=外部漂移持续）→ 批 8 净差 -0.08 噪声级、逐题 22 平/2↓1/0↑；**批 8 净效应：广度 0 回退（噪声内）+ 引擎出勤 +1.1（21.7→22.8）**
- 度量：车道 61→68、域 17→23、单静态二进制 12.2MB stripped

## Phase AT：探针第 7 批 Go 侧首发——helm/NASA/音乐/扩展/航天五域口子（2026-09-05 第四十轮，main）

- [x] **探针 12 候选+biorxiv 快验（两轮）** ✅：devops 收口（artifacthub）+图像扩展（nasaimages）+全新域音乐（musicbrainz）/航天（thespacedevs）/浏览器扩展（mozaddons）+学术数学（zbmath）/生预印本（biorxiv）/归档（fatcat）+化学（pubchem）+地震（usgs）+数列（oeis）+公版书（openlibrary）/多媒体（archive.org）；原始数据落 /tmp/probe-b7/，脚本入库 go-port/scripts/probe-b7-*.mjs
- [x] **5 车道接入（56→61）** ✅：artifacthub（devops+helm 词面，kind=0 过滤解决响应无 kind 字段的 URL 闭环，页面 200 实弹验证）、nasaimages（images+nasa 词面，详情页规范 URL）、musicbrainz（**新 music 域**，TOS 1req/s 腿内单请求合规）、mozaddons（**新 browser-ext 域**只收 firefox 词面，name/summary 本地化对象 default_locale 择优）、thespacedevs（**新 space 域**窄词面=守卫防烧匿名 15req/h 配额）；DOMAIN_TABLE 14→17 域、表只扩不缩
- [x] **8 案诚实关账** ✅：openlibrary（5/5 持续 >9s 超时）、archive.org advancedsearch（持续超时）、zbmath（50% 超时方差比 maven 更差）、pubchem（name lookup 非 relevance 搜索+autocomplete 400）、usgs FDSN（无文本 query 语义）、oeis（CF 挑战同 AUR 案）、fatcat（归档疑案）、biorxiv（API 只支持日期浏览无关键词搜索）
- [x] **实弹纠正 1 参数 bug** ✅：AMO v5 search limit 参数无效（595KB 肥 payload），正确参数 page_size（轮 1 形状轮抓获，轮 2 修正复验）
- [x] **门禁** ✅：119 单测全绿（111→119，黄金样本×5+路由锁×2+拒连回归×1）+ gofmt/vet 干净 + L1 24/24 ×4 轮 + MCP E2E PASS（cache_stats lanes=61）
- [x] **A/B 归因复用** ✅：stash 批 7 → 批 6 代码同日重跑 uniqDom 亦 6.9（出勤 19.3）→ 7.25→6.9 缺口=外部漂移（web 腿世界状态）；**批 7 净效应：广度 0 回退 + 引擎出勤 +0.7（19.3→20.0）**；A/B 同日同环境归因法稳定复用
- 度量：车道 56→61、域 14→17、引擎出勤 18.5→20.0（A/B 口径 +0.7）、单静态二进制 12.2MB stripped

## Phase AS：探针第 6 批 Go 侧首发 + A/B 广度归因法（2026-09-05 第三十九轮，main）

- [x] **探针 12 候选两轮+定案轮** ✅：包生态（NuGet/hex/Maven/conda）+发行版（Arch/Debian）+学术（INSPIRE-HEP/OpenAIRE）+自由媒体（Commons）+天气（Open-Meteo）+公版书（Gutendex）+社区（Reddit）；原始数据落 /tmp/probe-b6/，脚本入库 go-port/scripts/probe-b6-*.mjs
- [x] **7 车道接入（49→56）** ✅：nuget（packages+dotnet 信号）、hex（packages+elixir 信号）、arch（devops+pacman 关键词）、inspirehep（academic+物理意图守卫，fields 瘦身 2MB→20KB）、openaire（academic+OA 意图守卫，防 doi.org 同域稀释）、commonswiki（images，File 命名空间）、openmeteo（**新 weather 域**，双腿 Nominatim 定位→forecast 实况+WMO 释义）；DOMAIN_TABLE 13→14 域、表只扩不缩
- [x] **5 案诚实关账** ✅：maven（solrsearch 40% 超时方差结构性不稳）、conda（3-10s 慢）、debian sources（API 404 已死）、gutendex（CF 挑战）、reddit（403 挑战页）
- [x] **实弹抓获 2 bug 当场修** ✅：openaire 无描述条目孤日期（publisher 兜底）；open-meteo geocoding 中文索引只认繁体（简体"东京"仅命中江苏东京镇——population 择优方案作废，腿 1 换 Nominatim 简体直中）
- [x] **门禁** ✅：111 单测全绿（97→111，黄金样本×9+守卫×3+接线锁×2）+ gofmt/vet 干净 + L1 24/24 ×5 轮 + MCP E2E PASS（lanes=56, circuit_open=0）
- [x] **A/B 广度归因法（方法论新增）** ✅：批 5 代码同日重跑 uniqDom 亦 7.25/7.29（昨日 7.54=外部世界快照），批 6 同日 7.25-7.33——**代码净效应：广度 0 回退 + 引擎出勤 +1.0（17.45→18.47）**；外部漂移与代码效应解耦，广度回归不单靠历史单点对照
- 度量：车道 49→56、域 13→14、引擎出勤 15.9→18.5、单静态二进制 12MB stripped
