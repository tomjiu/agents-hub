# memory-net-console worklog

---
Task ID: 1（立项，会话 10）
Agent: Super Z（主代理）
Task: 仓 D 立项——memory-net 云端控制台（memory-net worklog Task 19 用户裁决遗留：「app（cloudflare tunnel 云远程主机）单开独立仓库，与 memory-net 解耦」；README「明确不做 v1：云远程控制面」的独立落点）

Work Log:
- 开工核实：三仓远端同步工作区干净（A=kokoa-companion f191a46 / B=kokoa 8e2fbda / C=memory-net 8cb937e）；会话 9 收尾裁决「实机 Tunnel/实机调参需真实硬件不可行」→ 落「桌面 app 新队列」→ 实勘确认为 memory-net Task 19 遗留的独立 app 立项
- GitHub API 建仓 tomjiu/memory-net-console（Node v24.19.0，node:sqlite 内置可用）
- 依赖方式裁决：npm git 依赖实装发现 dist 缺失（npm 对 git 依赖不跑 prepare）→ 改 vendor 钉扎哲学（对齐 kokoa pins.yaml）：构建产物入库（含 declaration）+ scripts/fetch-vendor.sh 可复现拉取（钉 sha 8cb937e 与 kokoa pins.yaml 对齐）+ .vendor-lock 溯源；server 以 file:../../vendor/memory-net 引用（symlink 解析验证通过）
- packages/server（零依赖 TS）：①catalog.ts——workspace 发现（扫 CONSOLE_HOME 含 memory.db 子目录）+ node:sqlite 只读探查（readOnly 优先、WAL 受限时回退 query_only；nodes/trail/stats 查询、LIKE 搜索、分页；id→目录白名单映射防路径注入）②auth.ts——Bearer token（sha256 对齐 + timingSafeEqual，对齐 kokoa gateway 安全件）③static.ts——CONSOLE_STATIC 单域托管（解码+normalize+inside 双层防穿越 + SPA fallback + MIME + nosniff，对齐 companion）④server.ts——v1 API 全面：health（免认证）/workspaces/stats/nodes/trail/runs/activate（核心库语义）/export/受控写面 progress+trail（host 身份）；未知 workspace 统一 404；closeIdleConnections 防 keep-alive 挂起 ⑤index.ts——env 五项，CONSOLE_HOST 默认 127.0.0.1 红线
- 三道纪律：读面零写（SQL 连接级只读）/ 语义不复制（activate/export 经 vendor MemoryNet，权重序唯一来源）/ 写纪律不破（UI 写面仅 progress+trail 宿主合法操作，observation 仍仅工具桥可达）
- packages/server 测试 11 项（node:test）：auth 单元/catalog 发现统计/只读纪律（写语句被拒）/搜索分页/trail 摘要/health+401/契约面/activate 预算（constraint frozen 置顶 w6）/受控写面（console 身份落库+校验面）/export/静态托管（SPA 深链接 + 原始路径穿越无泄露：node:http raw %2e%2e、..%2f、%252e 三变体断言绝不泄露 TOPSECRET）——11/11 全绿
- 过程坑：①tests 目录为空时 tsc rootDir 推断漂移（dist 平铺）→ 显式 rootDir 固定 ②WHATWG URL 客户端把 %2e%2e 规范化后发请求，fetch 测不了原始路径 → 改 node:http raw 请求实测服务端防御 ③closeIdleConnections 缺失导致测试进程被 keep-alive 挂 120s ④printf 写 bin 文件丢引号 → python3 写入修复
- apps/console（vite + vanilla TS 零运行时依赖，构建产物 14KB gzip 6.2KB）：侧栏 workspace 列表/四页签（节点过滤浏览、激活预算演示、轨迹回放、统计画像三组条形图）/Token 模态（localStorage）/记录模态（progress+trail 远程写入）；移动端侧栏折叠适配
- 单域托管真浏览器端到端全绿（agent-browser）：curl 四断言（GET / 前端入口、静态资源 MIME、health 同域、SPA 深链接）+ 浏览器八项（token 流未连接→已连接、workspace 发现 2 个、切换+标题更新、节点 4 卡渲染、激活演示真实核心语义（w6 约束冻结/裁剪计数/token 统计）、轨迹 run+步骤、统计实时更新、真浏览器写入 progress→console 身份落库→UI 刷新→curl 双验证）；截图两张存 download/
- 过程坑：agent-browser refs 在侧栏重渲染后失效（DOM 直点验证代码本身正常）；沙箱跨 Bash 回收后台进程 → ensure-e2e.sh 幂等模式（端口探测+自动重启）
- 交付：README（架构/三道纪律/快速开始/env 表/API 面/Tunnel 三步/明确不做/三仓关系）+ .gitignore（构建产物与 vendor 产物区分）+ LICENSE + CI（Node 24，vendor lock sanity 步骤）

Stage Summary:
- 仓 D 立项闭环 ✅：https://github.com/tomjiu/memory-net-console —— 记忆网「人」侧窗口开箱即用（手机浏览器→Tunnel→填 token 即可浏览/激活演示/远程记录）；server 11/11 契约测试 + 真浏览器端到端全绿
- 三仓+控制台的部署哲学统一：Tunnel + 单域托管 + token（companion=消息/智能体控制，console=记忆网浏览/操作，gateway=家中侧服务面）
- 下一步（会话 11 备选）：家中主机实机联调（Tunnel 双端：companion + console 一次接入两个界面）；或 console v1.1（SSE 实时刷新/观测质量专页：auto-observe tool:* 观测的覆盖与 contradicted 链可视化）；或仓 B/C 队列

---
Task ID: 11 (会话 11)
Agent: 主 agent (Super Z)
Task: 全仓审计——三道纪律复核 + 前端重入缺陷修复闭环

Work Log:
- 子代理审计：P0=0、P1=1、P2=5；三道纪律全部成立（读面只读降级链正确、activate/export 走核心库零复制、写面身份服务端硬编码不可伪造）；vendor dist 与 memory-net@8cb937e 逐字节一致；静态防穿越与鉴权覆盖实测无缺口
- 修复 P1：renderNodes 防抖重入前清空容器（首过滤即双套 UI+陈旧残留）+ 保留搜索框焦点与光标位置
- 过程坑：会话 11 修复提交混入 56 文件沙箱 mode 噪音（100644→100755）——补还原提交并 core.fileMode false 根治（ee80722）
- 验证：11/11 测试 + build 全绿；commits 885e534/ee80722 推送 ls-remote 双向验证

Stage Summary:
- 核心浏览交互劣化缺陷闭合；P2 清理项见 reports/task-11-e.md（vendor 错误映射层、413 时序、CI 内容级校验）
- 下一步（会话 12）：console v1.1（SSE 实时刷新 / auto-observe 观测质量专页）；vendor 随 kokoa pins 升 740f9a8 联动

---
Task ID: 12 (会话 12)
Agent: 主 agent (Super Z)
Task: v1.1 SSE 实时刷新 + P2 修复 + vendor 钉扎升级 e52c75c

Work Log:
- v1.1 SSE：GET /v1/events（Bearer + ?token= 双通道，EventSource 兼容）——hello + workspace.updated；本机写入即时广播，外部直写经 db/-wal/-shm 三件 mtime+size 签名轮询检测（WAL 主库不变坑实勘修复；无订阅者零开销）；close 全清理；前端 openEvents 接线（250ms 去抖合并、activate 表单页豁免防丢输入、「实时同步中」指示）
- P2-1 413 先冲刷响应再断连接（flush 后 destroy，客户端终于收到 413 而非连接重置）
- P2-2 vendor 错误族映射：UnknownNodeError→404、其余 MemoryError→400（用户输入错误不再 500 泛滥刷日志）
- P2-2a 语义面规范 id：catalog.resolveEntry 返回 meta 规范 id，withWorkspace 改传规范 id——别名（目录名≠meta workspace_id）读面/语义面劈叉消除
- P2-3 静态托管畸形编码/空字节 400
- P2-4 CI vendor 完整性升级：scripts/verify-vendor.sh 按 .vendor-lock 重新拉源→构建→diff（codeload 截断自动回退 git clone），「文件存在即过」弱断言退役
- P2-5 engines ≥22.13（node:sqlite 去 flag 最低版）+ README；CONSOLE_PORT fail-fast + 非回环 HOST 显式告警；X-Frame-Options: DENY
- vendor/memory-net 8cb937e → e52c75c（仓 C 会话 12 九处 P2 随 vendor 传导：fillBudget 语义/appendTrail 原子/lifecycle 门控/覆盖链事务/exports 面）
- 新增 5 条用例 + badAuth 修正（错误 token 路径实际可测）；server 16/16 全绿；verify-vendor 实跑通过（dist 与 package.json 双一致）
- commit e961b74 推送 ls-remote 双向验证

Stage Summary:
- 会话 12（仓 D）✅：v1.1 实时层落地——家中 agent 直写记忆网，浏览器控制台 3 秒内自动刷新；错误面工程化（4xx 映射）+ vendor 链完整性可验证
- 下一步：真浏览器 e2e 复验 SSE 指示与自动刷新；或 console v1.2（节点分页控件/观测质量专页）

---
Task ID: 13 (会话 13)
Agent: 主 agent (Super Z)
Task: vendor 钉扎升级 80e417e + 真浏览器 SSE e2e 复验

Work Log:
- vendor 升级窗口联动：fetch-vendor.sh MN_SHA e52c75c→80e417e（仓 C build.sh 自装守卫，与 kokoa pins.yaml 同 sha）；verify-vendor.sh 实跑通过（dist 逐字节一致——本次变更只动构建脚本不触 src；package.json 一致）
- 真浏览器 SSE e2e（agent-browser，会话 12 SSE 层此前只有单测）：console :8792 + mn CLI 预置真实 workspace（constraint/observation/progress 三节点）→ token 保存即连 → 侧栏发现 kokoa-main + 头部「实时同步中」指示 → 节点页三节点渲染正确 → mn CLI 外部直写 n4 → 页面未刷新 UI 自动从「3 个节点」刷新为「4 个节点」且新节点文本可见（workspace.updated 广播 + WAL 三件签名检测 + 前端 250ms 去抖实测闭环）→ 截图存档
- 验证：16/16 全绿 + build；commit 8228b6e 推送 ls-remote 双向验证

Stage Summary:
- 会话 13（仓 D）✅：SSE 实时层真浏览器闭环——家中 agent 直写记忆网，浏览器控制台秒级自动刷新的承诺实测成立
- 下一步：console v1.2（节点分页控件 / auto-observe 观测质量专页：tool:* 覆盖与 contradicted 链可视化）；或家中主机实机联调

---
Task ID: 15 (会话 15)
Agent: 主 agent (Super Z)
Task: 审计报告 task-11-e（console）14 条 P3 余量清零 + vendor 升级窗口（钉 memory-net e3dda9d）

Work Log:
- 开工核实：仓 D=50d4250 远端同步工作区干净；task-11-a/d 清单已在前会话闭环，本会话处理唯一余量 task-11-e
- P3-1 重复 workspace_id（复制库）：discover 检测重复，首个占规范 id、其后以目录名寻址 + stderr 告警——两目录可分别到达，不再静默串统计；语义面经 resolveEntry 规范 id 解析不受影响
- P3-2 性能：meta 读取按 memory.db mtime+size 签名缓存（外部无变化零开库，SSE 轮询纯 stat）；stats 单连接完成（旧 withDb→summarize→withDb 双开消除）
- P3-3 race 500：workspace 不存在统一 WorkspaceNotFoundError→404；stats 重写后 resolveDir 二次调用消失
- P3-4 损坏库一致面：list 显式标 unreadable:true（前端侧栏橙色徽标）；stats/nodes → 503 WORKSPACE_UNREADABLE。实勘坑：node:sqlite 的 SQLite 层错误是普通 Error + code 'ERR_SQLITE_ERROR'（name 不叫 SqliteError），首版映射漏网 500
- P3-5 run 摘要 agent 聚合：GROUP_CONCAT(DISTINCT x, sep) 被 SQLite 拒绝（DISTINCT 聚合必须单参数，实勘）→ 改两条查询 + JS 聚合，agent_id 含逗号免疫；nodes 默认序索引在上游仓 C e3dda9d 落地（console 只读开不了索引，必须长在 schema）
- P3-7 405 语义：WS_ACTION_METHODS 动作→允许方法表，错配 → 405+Allow（不再落「未知动作」404 文案误导）；/v1/health 接受 HEAD（探活无响应体）
- P3-8 sendJson writableEnded/destroyed 守卫 + createServer 级 res.on(error) 监听（不再依赖 Node 静默容忍）
- P3-10 CONSOLE_TOKEN <8 字符日志全隐藏（原 slice(0,4) 对短令牌=全量暴露）
- P3-12 静态响应 CSP（self 全集 + frame-ancestors none）+ /assets/* 内容哈希产物 immutable 缓存（Tunnel 流量优化）；前端 api.call 20s AbortController 超时（挂起请求不再让「加载中…」永挂）
- P3-13 节点分页 UI：50/页 prev/next + 页码指示，换工作区/改过滤归零（服务端 offset 早已支持，UI 补齐）
- P3-14 fetch-vendor.sh git clone 回退（codeload 截断对齐 verify 同款）+ .vendor-hashes sha256 哈希基线（12 文件）+ dist/tests 剔除（上游测试编译物不入库）；verify-vendor.sh 增哈希基线逐文件比对，实跑通过
- 已在后续批次顺手闭合的核实：P3-6（vendor e52c75c appendTrail 单语句原子取号实锤）、P3-9（PORT fail-fast + 非回环告警已在 v1.1 批次）、P3-11（badAuth 已改错 token 真路径）
- vendor 升级窗口：e52c75c→e3dda9d（仓 C 会话 13-15 传导：build.sh 守卫/NaN confidence/boolOr/读序索引）；.vendor-lock + .vendor-hashes 同步
- 重要实勘（会话 15 最大发现）：SSE 外部直写检测测试旧实现假绿——write-dbg/sse-dbg 插桩实证：POST/ext 写全部发生在首轮扫描前被基线吸收，旧代码靠「每轮扫描 openReadonly 扰动 -shm mtime」制造虚假发布风暴恰好喂饱断言；meta 缓存消除风暴后测试必挂暴露真相。修复：基线打底 200ms → 本机写入断言即时广播 → 排干扫描回声+清 buf → 外部直写 → 断言 reason=external（真检测语义锁定）
- 过程坑（新增）：①反复 git stash 单文件使 dist 与 src 失配，debug 脚本跑在旧编译产物上造成「检测正常」假象——实证前必须 npm run build 对齐 ②uniq -c 误判：awk $3 字段含噪声致「sig 每行都变」错觉，需打印完整值人眼比对 ③GROUP_CONCAT DISTINCT+自定义分隔符是 SQLite 硬限制不是写法问题
- 验证：server 16→21 用例全绿（5 条 session15 锁定）+ 根 workspace build/test 绿 + tsc 无错 + verify-vendor 三项一致；commit 2c0e9aa 推送 ls-remote 双向验证

Stage Summary:
- 会话 15（仓 D）✅：task-11-e 14 条 P3 清零——四仓 P0-P3 审计清单全部闭环；vendor 链升级至 e3dda9d 且首次具备产物哈希可复现基线；SSE 检测从「风暴假绿」修成「真检测语义」
- 下一步（会话 16 备选）：①家中主机实机 Tunnel 双端联调（需真实硬件，companion+console 双界面一次接入）②auto-observe 观测质量专页（tool:* 覆盖/contradicted 链可视化）③dsh 0.1.3-alpha.2 稳定化观察
