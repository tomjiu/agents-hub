# TS→Go 语义兼容矩阵 — search-core (issue #3 评论 G3)

日期: 2026-11-24 · 范围: `mcp/servers/search-core/{typescript,go}` · 记录者: sandbox-agent

裁决背景: 用户最新技术决定 — **以现有 Go 版为搜索开发基础** (替代原"仅要求 TS MCP 路径");
TS 保留兼容与基准对照。本矩阵逐项核对两侧语义, 标注迁入状态。

图例: ✅ 一致 · 🔶 Go 已实现(实现方式不同, 语义等价) · 🆕 Go 领先(TS 未实现) · ⚠️ 差异待协调 · ❌ Go 缺失(挂账)

| # | 能力/契约 | TS 状态 | Go 状态 | 证据/说明 |
|---|---|---|---|---|
| 1 | MCP stdio initialize/list/call | ✅ | ✅ | go: mcp_stdio_g3_test.go 全协议管道实测 |
| 2 | MCP 取消 (notifications/cancelled) | ⚠️ TS 走 AbortSignal | 🆕 Go 异步派发+按请求 ctx 注册表 | go: dispatchMcpCall + cancelMcpRequest; 迟到取消忽略 |
| 3 | engines 用户名单约束所有路由 | ❌ S0-F1 缺陷 (域路由绕过) | ✅ Go 已修复 | go: constrainEngines 约束 domain/github/恢复腿; engines_g3_test.go |
| 4 | engines:[] 显式空 = 零请求 | ❌ (TS 未区分) | ✅ Go 已实现 | go: EnginesSet + engines_empty_zero_request 契约测试 |
| 5 | 每腿超时 + 全局软截止 | ✅ | ✅ | 两侧语义对齐: TimeoutMs 每腿 / SC_SOFT_DEADLINE_MS 兜底 |
| 6 | 早收割 (60% 腿 + refs≥15) | ✅ 25ms 轮询 | 🔶 事件驱动 (settleCh) | go: 收割语义逐条对齐, 唤醒即时; G0 实测取消传播 0ms |
| 7 | 取消后无残留网络任务 | ⚠️ | ✅ | go: runCancel() 断在飞腿 (G1-6); 测试 TestRunLanesCtxCancelStopsInFlight |
| 8 | 429/202/403/挑战 失败分类 | ✅ 6 类 | ✅ 同款 6 类 + consent(wall/page) | go: classifyFailure; TestClassifyFailureMatrix |
| 9 | 熔断/健康统计 | ✅ | ✅ | health.go; providers 工具可诊断 |
| 10 | 响应体有界读取 | ⚠️ 部分 | ✅ 统一 ReadBounded | go: 8MB JSON 上限 + 显式 ErrBodyOverLimit, 不截断伪正常 |
| 11 | 页面截断透明 | ⚠️ 静默截断 | ✅ truncated 置位+journal | go: fetcher.go (G1-3b) |
| 12 | DOM 解析预算/并发上限 | ❌ | 🆕 信号量+节点预算 | go: SC_DOM_PARSE_CONCURRENCY / SC_MAX_DOM_NODES (G1-4) |
| 13 | focus 正文提取 | ✅ cheerio | ✅ goquery 1:1 | 选择器/行为逐字对齐; G0: 1MB 密集页 Go 50ms vs TS 629ms |
| 14 | rerank cross-encoder | ✅ 内置 onnxruntime-node | 🔶 build tag 隔离 | go: 默认纯 Go stub, `-tags onnx` 增强; 队列/超时/线程预算有界 (G1-1/5) |
| 15 | 词法质量门 | ✅ | ✅ | S0-F2 (词重合无关结果) 两侧同为已知缺陷 — S3 语义效果阶段统一处理 |
| 16 | 搜索缓存 (SQLite) | ✅ | ✅ | 900s TTL; G0: get/put 亚毫秒 |
| 17 | research 多角度深研 | ✅ | ✅ | research.go 5 角度 + 6 问反思 |
| 18 | providers/health 诊断工具 | ✅ | ✅ | search_providers 工具 |
| 19 | cache 全文检索语料 | ✅ FTS5 | ✅ | search_cache 工具; CJK ≥3 字三字索引 |
| 20 | DSH 工具 schema 稳定 | ✅ | ✅ | tools/list 形状测试; 发现/回流见 DSH-HOST-ACCEPTANCE 流程 |
| 21 | Linux 构建 | ✅ | ✅ | 默认纯 Go + CGO_ENABLED=0 双通过 |
| 22 | Windows 构建 | ✅ | ✅ | GOOS=windows 交叉编译通过 (18.6MB, 无 CGO); 实机运行验收挂账 (沙箱无 Windows) |
| 23 | onnx 增强构建 | — | ✅ `-tags onnx` | 需 CGO + libonnxruntime; 沙箱编译通过, 模型推理挂账 (无模型资产) |
| 24 | SearXNG 公共实例 | ✅ (SEO 污染已摘出) | ✅ 同款摘出 | SC_ENABLE_SEARXNG=1 可开回试 |
| 25 | DDG 分页会话 | ❌ | 🆕 ddgPageState | go: s/dc 表单回传 + 有界翻页 (G2); TS 侧挂账同步 |
| 26 | Yahoo consent 墙 | ❌ (误报 no-results) | 🆕 显式 blocked 分类 | go: isYahooConsentPage (G2) |
| 27 | S1 证据感知早收割 | ✅ 2026-11-25 同步 (earlyHarvestMinRelevant, 总refs≥15+相关≥5; 0=TS 既有证据计数回退) | 🆕 S1: +相关 refs≥5 | ts/go: SC_EARLY_HARVEST_MIN_RELEVANT; TS s1s2-parity 红灯先红后绿 (6相关+20噪声不收割→收割, 4相关地板守护) |
| 28 | S1 早收割调度 | ⚠️ 25ms 轮询 | ✅ 事件驱动(修复回归) | go: 旧 nextEdge 在 enough 变真后跳到软截止→早收割永不触发; TestEarlyHarvestFiresWithRelevantEvidence 红灯复现后修复 |
| 29 | S1 到期不足诊断 | ✅ 2026-11-25 同步 (meta.harvest 全字段) | 🆕 meta.harvest.insufficient | ts/go: HarvestMeta 逐字段对等 (early/settledLegs/totalLegs/abortedPending/relevantRefs/minRelevant/totalRefs/softDeadlineMs/insufficient/diagnosis); TS 红灯 s1s2-parity |
| 30 | S2 Retry-After 退避 | ✅ 2026-11-25 同步 (retryAfterMsOf + httpErr 头捕获) | 🆕 有界(1h 上限) | ts/go: HealthTracker 冷却=max(策略, retry-after) 截 1h; HTTP-date 如实忽略; searxng/ddg/keenable/bingweb/google/baidu 抛点接入; TS 红灯 s1s2-parity |
| 31 | S2 负结果不缓存 | ✅ 核验修正: TS 引擎层已有 refs>0 && !degraded 守卫 (2026-11-25 s1s2-parity 显式测试锁定; 此前矩阵记录过时) | 🆕 degraded/空结果跳过 | ts/go: 均跳过负结果缓存; TS 侧 journal 事件为后续候选 |
| 32 | S3 词法证据门 | ✅ lexical-evidence-v2 (复数折叠+50%, 已同步) | 🆓 v2: 复数折叠+50% | go: S0-F2 实测 40% 下限放行词重合烹饪页; v2 拒绝且 python 页保留; TS 已同步 (2026-11-24, 先红后绿 S0-F2/折叠/后缀用例; 缓存 key 升 v2, 命中重跑门) |
| 33 | S3 版本适用性标注 | ✅ 2026-11-25 同步 (versionSignals, 只标注不剔除) | 🆕 versionCheck(只标注) | ts/go: 查询版本 vs ref 主版本差异 → meta.quality.versionCheck; 单数字不算版本(两位数算 — 两侧同款守卫); TS 红灯 s3-parity 先红后绿 |
| 34 | S3 来源构成/官方社区 | ✅ 2026-11-25 同步 (sourceMix, 融合后 refs 带权威层 sourceKind) | 🆕 sourceMix 摘要 | ts/go: meta.quality.sourceMix 计数(official/community/unknown); TS 红灯 s3-parity 先红后绿 |
| 35 | S3 domain cap 可调 | ⚠️ 主题推导固定 | 🆕 SC_DOMAIN_CAP | go: 调用方显式覆盖(0=关) |
| 36 | S4 壳页透明拒绝 | ⚠️ 仅反爬/DOI 回退 | 🆕 login_wall/js_shell/consent_wall | go: classifyPageShell+原始壳识别; 壳页不编造正文; 缓存命中同样拒绝 |
| 37 | S4 非 2xx 状态拒绝 | ❌ 403 带正文当正常 | ✅ http N 透明错误 | go: fetchExtract 状态拒绝; DOI 回退链触发更完整 |
| 38 | S4 抓取方式透明 | ⚠️ | 🆕 via/finalUrl/fromCache | go: FetchResult 记录 direct/crates-api/oa-landing + 原始/最终 URL |
| 39 | CLI --engines 契约 | — | ✅ 修复 EnginesSet | go: 旧版 --engines 被忽略(默认全池); 显式空名单=零请求 |
| 40 | MCP 工具 schema 稳定(新增 meta 字段) | ✅ | ✅ | go: quality/harvest 为输出附加字段, tools/list schema 不变; 全协议管道测试通过 |

| 41 | MCP search 工具 count 参数 (Magpie v0.1.3062+ 宿主契约 1-20) | ✅ 2026-11-25 同步 (mcp.ts count 别名, top_n 未传时生效) | ✅ 2026-11-25 (resolveTopN, clamp 1-20) | go: lanes_next_test.go TestResolveTopN/TestMCPToolSchemaHasCount; 协议实测 tools/list 含 count; 零请求契约不受影响 (engines:[]+count → 0 refs 1ms) |
| 42 | parallel 匿名 MCP 车道 (keyless) | ❌ TS 无此车道 | 🆕 2026-11-25 W1 | go: lanes_anon_mcp.go; 实弹 2026-11-25 (mcp.parallel.ai, sqlite 题真实结果); SSE+JSON 双形状 httptest 锁定 |
| 43 | tinyfish 匿名 MCP 车道 (keyless) | ❌ TS 无此车道 | 🆕 2026-11-25 W1 | go: lanes_anon_mcp.go; 实弹 2026-11-25 (agent.tinyfish.ai keyless, rust 题真实结果); fixture 保真自实弹抓取 |
| 44 | S1 多批全局收割协调 (domain 多子查询) | ✅ 2026-11-25 (HarvestCoord 共享证据池/结算计数) | ✅ 扁平 slots | ts/go: 修复前 TS 各批独立预算 — A/B 实弹编程题 site: 腿 ddg 拖到 recovery 10s 而 leg-0 1.2s 已有 21 条证据; TS 红灯复现 2514ms→316ms; Go 语义对齐参照 |
| 45 | bingweb 进编程专线 site: 腿 | ✅ 2026-11-25 (programming siteEngines +bingweb) | ✅ 2026-11-25 同款 | ts/go: ddg 出口限流时 site: 腿单点塌方 (A/B 实弹); Go 侧同步修复 site 腿装配 = 全 siteEngines (旧轮询单 siteTarget 恒取 index 0, bingrss 从未出勤 — 与 TS 语义分歧); 红灯两侧先红后绿 |

| 44 | serper/serpapi keyed Google 车道 | ❌ TS 无此车道 | 🆕 2026-11-25 W4 (Go 领先) | go: lanes_keyed_google.go; SERPER_API_KEY/SERPAPI_API_KEY 门控 (无 Key 不入池/点名透明报错); 协议 fixture 锁定, 实弹挂账 (无真实 Key) |
| 45 | searxng 自部署实例 (SC_SEARXNG_URL, RustXNG 兼容) | ❌ TS 无 | 🆕 2026-11-25 W2 | go: searxngBases(); 自部署时重新入池; 本地 mock 实测 (SearXNG 形状 JSON); RustXNG (SearXNG Rust 重写, AGPL, 单二进制 8880/8888 端口) HTTP 集成不捆绑代码 |
| 46 | bingweb 无 key Bing 网页 HTML 车道 (ck/a 重定向解码 + 垃圾注入伪 200 词面守卫 + b_no 合法空) | ✅ 2026-11-25 同步 (providers/keyless-apis.ts + 默认池) | ✅ 2026-11-25 | go: lanes_bing_web.go + TS: keyless-apis.ts; 黄金/垃圾双样本锁 (2026-11-25 实弹); 守卫消息含 soft-block → rate_limited 熔断分类; 实弹: 干净窗口真实结果 + 软封窗口被守卫如实拒绝 |

## 结论与挂账

1. **Go-first 路线证据** (G0 基线, 同输入同环境): DOM 提取 12-19x, 峰值内存 ~1/16,
   MCP 启动 6ms vs 307ms, 长跑无泄漏。资源口径支持用户裁决。
2. **已迁入的 TS 后续修复**: engines 名单契约 (#3/#4)、失败分类补齐 (#8)、截断透明 (#11)。
3. **挂账 (需可达环境/资产)**: 真实公网 SERP A/B 相关性对照 (S3/S4); rerank 实弹
   (需 -tags onnx + 模型三件套); Windows 实机 DSH 宿主验收; live 引擎漂移 probe
   (本沙箱 DDG 202 软封 / Mojeek/Yahoo 出站受阻, 证据 G2-PROTOCOL-NOTES.md)。
4. **S1-S4 首轮落地 (2026-11-24, issue #3)**: 证据感知早收割+调度回归修复+到期不足诊断
   (S1); Retry-After 有界退避+负结果不缓存 (S2); 词法证据门 v2+版本标注+来源构成+可调
   domain cap (S3); 壳页透明拒绝+状态拒绝+抓取方式透明 (S4)。CLI --engines 契约修复。
   公网复测 (同日): DDG/Mojeek/Yahoo 出站仍受阻, keenable 可用(中文题 candidate_results,
   证据门如实拒绝 12 条词重合不足结果), bingrss 连通但 q 回写被质量门拒绝 — 与 G2 记录
   一致, 不冒充公网质量认证。详见 catalog/audit/search-go-s1s4.json。
4. **不做的事**: 不无授权合并 memory 分支; 不改用户正在运行的 Web; 不为省内存换容错退化。
5. **2026-11-25 扩源轮 (b) — bingweb (issue #3 无 Key 主流引擎)**: 车道 94→95。google 直连 JS 壳/百度安全验证/brave 429/ecosia 403/qwant 403 复核实测维持关账; bing HTML 直连接入 + 垃圾注入伪 200 词面守卫 (实弹双窗口验证: 干净窗口真实结果, 软封窗口守卫如实拒绝)。Go+TS 同步, TS 进默认池。
6. **2026-11-25 扩源轮 (issue #3 下一阶段 W1-W5)**: 车道 90→94 (parallel/tinyfish 免 Key 匿名 MCP + serper/serpapi keyed Google); SC_SEARXNG_URL 自部署放行; MCP count 宿主契约双侧同步。Google 直连实测仍为 JS 壳 (0 可解析外链) 维持 BLOCKED; keyed SERP API 为合法通路。调查证据+实弹: catalog/audit/search-next-providers-2026-11-25.json。
