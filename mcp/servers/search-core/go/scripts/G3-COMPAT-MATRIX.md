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

## 结论与挂账

1. **Go-first 路线证据** (G0 基线, 同输入同环境): DOM 提取 12-19x, 峰值内存 ~1/16,
   MCP 启动 6ms vs 307ms, 长跑无泄漏。资源口径支持用户裁决。
2. **已迁入的 TS 后续修复**: engines 名单契约 (#3/#4)、失败分类补齐 (#8)、截断透明 (#11)。
3. **挂账 (需可达环境/资产)**: 真实公网 SERP A/B 相关性对照 (S3/S4); rerank 实弹
   (需 -tags onnx + 模型三件套); Windows 实机 DSH 宿主验收; live 引擎漂移 probe
   (本沙箱 DDG 202 软封 / Mojeek/Yahoo 出站受阻, 证据 G2-PROTOCOL-NOTES.md)。
4. **不做的事**: 不无授权合并 memory 分支; 不改用户正在运行的 Web; 不为省内存换容错退化。
