# memory-net worklog（权威副本）

---
Task ID: 18（memory-net v1 收尾）
Agent: Super Z（主代理）
Task: 共享记忆网 v1 验收核查与补完——「继续查，补完」

Work Log:
- 仓库现状盘点：v1.0.0 主体已落地（6 类节点 / 写纪律硬门控 / 预算化激活 / workspace 物理 SQLite 隔离 / node:sqlite 零 npm 运行时依赖），基线 16 测试全绿、demo 三条命令跑通、origin/main 同步（9baa236）、GitHub CI success（public 仓库）
- 规格逐项核对：作用域四元组 / 节点最小集 / 权重序 6-5-4-3-2-1 / constraint+当次 progress 冻结集 / promote 需 evidence 或宿主 / gc 不因 TTL 删 observation / export-import 记忆包 / README 与 docs/architecture.md / 7 条规格测试全覆盖（16 库级用例）——全部落实
- 发现 1（文档漂移，已修）：usage() 帮助文本写 `add <kind> <dir>`（kind 在前），实现为 `dir=args._[0]`、`kind=args._[1]`（dir 在前）——README:73 示例跟 usage 一起错，按 README 传参必报「kind 不合法」exit 2。usage 与 README 均改为 `add <dir> <kind>`，add 报错信息补用法提示
- 发现 2（CLI 功能缺陷，已修，先红后绿）：parseArgs 只认 `--` 长 flag，usage/README 承诺的 `export -o pkg.json` 单横杠短 flag 被误推进位置参数 → export 恒报「需要 -o pkg.json」，CLI export/import 从未端到端可用（demo 与库级测试均未覆盖此路径）。parseArgs 增加单横杠短 flag 分支（负数 `-N` 除外）
- 发现 3（显示层假象再现，不误报）：`branches: [main]`、`details: string[] = [head]` 在工具显示层均被吞 `[字母` 前缀渲染成 `ain]`/`ead]`——字节级 python 验证均完好，与 kokoa Step 43/44 沉淀同族（"arket]" 事件）；沉淀：凡方括号内容一律 repr/替换法字节级核验，不做显示层判断
- F-cli-smoke（先红后绿）：新增 tests/08-cli-smoke.test.ts 四用例（spawnSync 子进程级）——①add 参数顺序契约（dir-first 成功 + kind-first 报带用法提示错误 exit 2）②export -o 短 flag + import 整网回路（pkg 2 节点 + n1 内容回读）③写纪律 CLI 端到端（model 拒绝 exit 2 可读文案 + host 同 workspace 成功排除坏库误判）④activate 双 agent 共享 progress（demo 主链路回归）。修复前红灯天然实锤（README 示例报错 / export 报缺参均为现场复现），修复后 16→20 全绿
- README 测试计数 16→20 同步 + CLI smoke 描述；demo 复跑无回归

Stage Summary:
- 净收益：2 个 CLI 面修复（usage 参数顺序漂移 + export -o 短 flag 失效，后者使 export/import 首次真正可用）+ 4 个 CLI 子进程级 smoke 契约锁 + 1 条显示层假象再确认
- 交付标准达成：CLI 跑通 open → 两 agent 写 progress/trail → activate 共享结果（demo.sh + CI 端到端步骤）；测试 20/20 绿（零 LLM 依赖）；仓库 https://github.com/tomjiu/memory-net
- 遗留：dsh 适配包骨架为可选后续（文档已声明不在核心内）；kokoa 侧 packages/dsh-plugin-memory 与本仓库的关系待后续任务明确（适配或迁移）

---
Task ID: 19（dsh 适配包）
Agent: Super Z（主代理）
Task: dsh 适配包骨架——用户澄清「dsh 需要和官方上游版本一直方便更新，插件需要适配 dsh」

Work Log:
- 用户裁决吸收：dsh 是 vendor 且跟随官方上游更新 → 适配包只挂官方插件点、零侵入；app（cloudflare tunnel 云远程主机）单开独立仓库，与 memory-net 解耦
- 适配包落地（adapters/dsh/，先例 = kokoa dsh-plugin-memory 插件形态）：contract.ts（自声明最小结构契约 + probeCtx 运行时能力探测）/ config.ts（resolveConfig 默认值全 + 函数形态 replacer 防 $& 序列腐化——kokoa 12-a 同族预防 + workspaceDir 名字路径注入防护）/ bridge.ts（host api 全写面 + renderActivation 注入渲染）/ index.ts（apply 接线：provide('memory-net') + memory_net_recall + memory_net_write + systemPrompt.section，能力缺失降级明示不崩宿主）
- 三条设计红线（README 明示）：①零 import dsh/cordis——只依赖自声明契约，dsh 内部重构不影响本包 ②严禁 fork/patch/替换 dsh——升级 = 换 vendor 版本 ③写纪律由桥面强制——模型工具只暴露 inference/tip（kind 白名单 + 核心 WriteForbiddenError 双保险），observation 写路径仅 host API 可达
- F-render（先红后绿）：8 用例 mock ctx 契约测试首跑抓出 renderActivation 真实缺陷——frozen 组把当次 progress 统一打成 [约束] 前缀，progress 丢失语义标签；修复为按 kind 分标签（进度带 ·status）后全绿。红灯同时暴露测试预期问题（based_on 引用异 workspace 节点 id）一并修正
- 8 用例全绿：probeCtx 降级逐项 / apply 接线 / write 拒绝矩阵 / recall 双 agent 共享 + workspace 隔离 / section 空网空串 / enabled=false + 非法名降级 / config 解析与注入防护 / host api 全景
- 同步面：CI 增 dsh 适配包测试步（npm --prefix adapters/dsh test）；.gitignore 补适配包产物；根 README「明确不做」节与 docs/architecture.md「dsh 适配」节改为 adapters/dsh 落地形态
- 根测试 20/20 + demo 复跑无回归；适配包 dist/node_modules 不入库

Stage Summary:
- 净收益：dsh 适配包骨架完整落地（8 契约测试全绿 + CI 接入）——dsh 上游升级零改动的机制保证（契约自持 + probeCtx 降级 + mock ctx 兼容性锁）+ 1 个渲染层缺陷先红后绿收口
- 关键决策：契约测试即升级兼容性锁——dsh 升级后重跑红灯即接缝处；真实 dsh 接入时唯一可能对齐点是 tools.register def 形态（README 明示）
- 下一步：app 独立仓库立项（cloudflare tunnel 云远程操作主机 app，与 memory-net 零耦合）

---
Task ID: 20（dsh 适配包真实加载闭环）
Agent: Super Z（主代理）
Task: 适配包对齐真实 dsh 0.1.2-rc.1 契约并端到端验证——「可被 kokoa profile 实际加载，禁止复制核心」

Work Log:
- 实勘真实 dsh（npx 物化 @deepseek-ai/dsh@0.1.2-rc.1 + cordis 运行时源码）锁定四处接缝缺陷：①缺 inject 静态导出——cordis 守卫「cannot get property without inject」必炸 ②systemPrompt.section 用 id/render——真实 PromptSection={name,order,text} ③工具缺必填 output——真实 ToolDefinition=ToolSchema+output{schema,render}+canonical JSON 返回 ④package.json 缺 main——cordis bare name import 不达 dist 入口
- 四缺陷全修（先红后绿）：contract.ts 对齐真实形态（ToolOutputDef/SectionDef.name+text）；index.ts 导出 inject=['systemPrompt','tools']、工具 output+canonical 值（recall→{text}，write→{saved,id,kind,workspace}，拒绝路径抛 Error 对齐 kokoa 插件先例）、section 改 name/text；package.json 补 main
- 契约测试重写对齐真实 dsh（8→9 项，新增两道契约锁：inject 导出面 + output 必填面）；mock 即升级兼容性锁
- 真实 dsh headless 端到端冒烟落地（scripts/smoke-dsh-e2e.sh + tests/fixtures/mock-model.mjs/verify-e2e.mjs，不进 CI）：脚本化两轮 mock 模型（发起 memory_net_write→回显结果）+ symlink 进 profile node_modules + patch insert 注册；断言 A 工具注册/B1+B2+B3 区段注入/C 调用闭环/D SQLite 落盘——dsh@0.1.2-rc.1 全绿 PASS（n3 inference 落盘核验）
- 根测试 20/20 无回归；根 README 与适配包 README 同步（真实契约对齐表 + 冒烟说明）

Stage Summary:
- 适配包从「骨架」升级为「真实 dsh 验证通过」：四处接缝缺陷清零，端到端闭环四断言全绿
- kokoa 侧接线（pins.yaml 钉扎 + bootstrap 构建装配）由同会话随后在 kokoa 仓落地

---
Task ID: 21（auto-observe 工具桥深化）
Agent: Super Z（主代理）
Task: 适配包深化——宿主工具结果自动 observe 入网（dsh-tools tools/result 事件桥），kokoa Task 21/会话 6 与本仓 Task 20 双侧共同指向的下一步

Work Log:
- 接缝实勘（dsh-tools 0.0.1-rc.1 tarball + cordis 4.0.2）：工具注册表对每次工具 dispatch 终态 emit 'tools/result'（exec, result，emit 模式无 next），listener 失败被宿主 containment（notifyResult try/catch + Promise 兜底）；exec={callId,name,arguments,agent?,parent?,token,signal}，result={isError,value|error,content}；cordis ctx.on 为事件总线方法（混合在 ctx，非服务属性——无需 inject 声明，真实 dsh 冒烟实锤可达）
- 实现（先红后绿）：bridge.ts 新增 buildObservation（纯函数：key=tool:<名> 状态覆盖语义/摘要截断/payload 带 call_id）+ installAutoObserve（订阅+全 try/catch 自我隔离 warn 计数）；config 新增 auto_observe 五项（严格布尔/数字防御）；contract 新增 ToolResultExec/ToolResultPayloadFace 最小面 + ctx.on 可选声明；index.ts 接线（on 缺失软降级明示，其余接缝照常）
- 语义要点：memory_net_* 自指过滤（防递归噪声）；嵌套 dispatch（exec.parent 在场）默认过滤、字段缺失 fail-open（形态漂移时宁多勿漏）；失败结果默认入网（include_error）——失败是同样有价值的协作事实；同 key 新观测自动 contradict 基于旧观测的 active 推断（核心 store 既有语义，工具结果变化即现实变化）
- 测试 9→17（红：installAutoObserve 不存在/auto_observe 缺失编译红）：成功/失败/自指/截断/嵌套/软降级/自我隔离/配置防御八面全绿；根测试 20/20 + demo 无回归
- e2e 扩展（真实 dsh@0.1.2-rc.1）：新增 tests/fixtures/echo-tool（最小宿主工具插件 mn_e2e_echo）；mock 模型第一轮并行双工具调用（echo + memory_net_write）；verify 增 E1（tool:mn_e2e_echo 观测落库、文本与 payload.call_id 校验——确系本桥写入）+ E2（memory_net_* 未被递归观测）；A1/A2/B1/B2/B3/C/D/E1/E2 全绿——跨 scope 事件分发、ctx.on 可达、写纪律不破三件事全部实机证明
- 文档：适配包 README auto-observe 专节 + 契约对齐表事件订阅行 + 测试计数；根 README 与 docs/architecture.md dsh 适配节同步
- commit 9123d59 推送验证；kokoa 侧 pins.yaml sha 同步升级（同会话）

Stage Summary:
- Task 21 ✅：工具桥深化闭环——「宿主工具结果自动入网」从 write 工具描述里的承诺变为实测机制；观测链路补全（模型显式写 inference/tip + 宿主自动写 observation + 宿主显式写 constraint/progress）
- 写纪律经受扩展验证：模型面仍只有 inference/tip，auto-observe 是宿主事件监听（模型不可控不可伪造）
- 下一步备选：kokoa 实机联调时观察 auto-observe 观测质量（预算/噪声面）按需调 include_nested/max_chars；或仓 C 独立 app 立项（遗留）

---
Task ID: 11 (会话 11)
Agent: 主 agent (Super Z)
Task: 全仓审计——并发硬化 2 处 P1 修复闭环

Work Log:
- 子代理审计：P0=0、P1=2、P2=10；写纪律三道防线（schema enum→桥面白名单→WriteForbiddenError）实锤成立，SQL 全参数化无注入
- 修复 P1-1 progress 单行竞态：db.ts 增 uq_nodes_progress_task 部分唯一索引（单独 exec 吞错，极老库重复行仅告警不阻断打开）+ store.ts 撞 UNIQUE 重读落更新路径（乐观锁/conflict 语义照常）——跨进程并发首写不再产生不标 conflict 的静默双真相
- 修复 P1-2 importPkg 事务原子化：BEGIN IMMEDIATE 包住 count 检查+全部插入，失败 ROLLBACK——半写目标库不再永久砖化
- 验证：根 20/20 + adapters/dsh 17/17 + 双 typecheck + build 全绿；commit 740f9a8 推送 ls-remote 双向验证

Stage Summary:
- HEAD 升至 740f9a8（8cb937e+并发硬化）；kokoa vendor pins 现钉 8cb937e 仍有效，升级走显式 sha 窗口
- 下一步（会话 12）：kokoa pins 升 740f9a8 + wiring 回归；P2 清理（fillBudget trail 优先级、demote/contradict 角色门控等，见 reports/task-11-d.md）

---
Task ID: 12 (会话 12)
Agent: 主 agent (Super Z)
Task: 核心库并发/门控/预算语义与适配包生命周期——9 处 P2 修复闭环

Work Log:
- P2-1 fillBudget 优先级倒挂修复：候选填满后再尝试 trail——weight-1 的 trail 摘要不再挤掉 weight-5 的 observation（与 types.ts「预算最紧时最先丢弃」文档承诺对齐）
- P2-2 appendTrail 单语句子查询原子分配 seq（写入锁内取 MAX+1，rowid 读回真实值）——跨进程并发追加同一 run 不再撞 PK 裸 SqliteError
- P2-3 lifecycle 角色门控：demote 受写纪律矩阵约束（model 不得 demote constraint/observation，冻结集「永不裁光」不可旁路）；contradict 需 evidence/note 至少其一（禁止无依据推翻）
- P2-4 适配包 HostApi.close 全量关闭（nets Map 遍历 + 清空）——非默认 workspace 实例不再泄漏 WAL 句柄
- P2-5 auto-observe workspace 归属边界明示（'tools/result' 无 workspace 信息，观测恒落默认 workspace；多 workspace 部署语义注释 + README）
- P2-6 CLI import 分支入错误分类（坏 JSON/缺文件 → 可读信息 + exit 2）；--payload 坏 JSON 转 WorkspaceError
- P2-7 同 key 覆盖链：INSERT + supersede 包 BEGIN IMMEDIATE 事务（并发双写恒有且仅有一个 active 观测）；contradicted 联动改 instr 精确子串（过滤下推 SQLite，去全表 JS 比对）
- P2-9 package.json 补 main/exports（README 裸名 import 断链修复；"./*" 透传保深路径消费方兼容）
- P2-10 适配包 apply 幂等自检落地：WeakMap 同 ctx 重复 apply 返回既有实例（真实 dsh 同名 section 重复注册不再炸宿主）+ section 注册兜底 try/catch
- 新增 9 条锁定用例（根 7 + 适配包 2，含预算判别的确定性构造）；根 27/27 + 适配包 19/19 全绿
- commit e52c75c 推送 ls-remote 双向验证；kokoa pins 与 console vendor 随即同步本 sha（升级窗口联动）

Stage Summary:
- 会话 12（仓 C）✅：并发面补齐（appendTrail/覆盖链两处原子化）、lifecycle 门控闭合写纪律最后一块旁路面、库消费形态（exports）开箱可用
- 下一步：真实 dsh headless 冒烟复验（本批改动含适配包生命周期与核心并发，e2e 工序可复跑）；或宿主工具桥继续深化

---
Task ID: 13 (会话 13)
Agent: 主 agent (Super Z)
Task: build.sh 自装 devDeps 守卫（kokoa bootstrap 实跑缺陷三修复）+ 真实 dsh headless e2e 复验

Work Log:
- kokoa bootstrap 全程实跑实锤：本仓根与 adapters/dsh 的 build 为裸 tsc -p tsconfig.json，vendor 钉扎检出目录无 node_modules → 全新 clone 上 bootstrap 步骤 5.5 必炸（sh: tsc: not found），主流程级阻断
- 修复：两处新增 scripts/build.sh 自装守卫（同 kokoa 仓 message-gateway / dsh-plugin-memory 的 ADR-012 约定：node_modules/.bin/tsc 不在则 npm install），package.json build 改挂 bash scripts/build.sh
- 验证：根 27/27 + 适配包 19/19 全绿；自装路径实测（删 dist 重建一次跑通）
- 真实 dsh@0.1.2-rc.1 headless e2e 复验（会话 12 适配包生命周期 close 全量/apply 幂等 + 核心并发改动后的回归）：A1/A2 工具注册、B1/B2/B3 区段注入（含工具后重组装）、C 调用闭环、D SQLite 落盘、E1 auto-observe（call_id 入网）、E2 自指过滤——九断言全绿零回归
- commit 80e417e 推送 ls-remote 双向验证；kokoa pins.yaml 与 console fetch-vendor.sh 同步本 sha（vendor 升级窗口联动）

Stage Summary:
- 会话 13（仓 C）✅：任何消费方（kokoa bootstrap vendor 检出 / console verify-vendor / CI）零手工装依赖；真实宿主场景双闭环
- 下一步：auto-observe 观测质量按需调参（include_nested/max_chars，实机观察）；或宿主工具桥继续深化

---
Task ID: 14 (会话 14)
Agent: 主 agent (Super Z)
Task: P3 修复——confidence NaN 校验穿透 / boolOr 布尔哲学统一 / 注释路径漂移（审计报告 task-11-d 余项）

Work Log:
- 开工核实：仓 C=3a736b43 远端同步工作区干净
- store.ts（P3）：inference confidence 校验加 Number.isFinite 先行——NaN 是 number 且比较恒 false，旧实现穿透后经 node:sqlite 落 NULL 破坏「inference 必带 confidence」不变量；Infinity 同族一并拦截
- adapters/dsh/config.ts（P3）：顶层 enabled 从 Boolean() 强转改为 boolOr（"false"/0 可关掉，此前关不掉）；boolOr 本身升级为识别字符串/数字形态（'false'/'0'/'no'/'off' → false，'true'/'1'/'yes'/'on' → 1），enabled 与 auto_observe 五项同一哲学；注释漂移修正（'' 回退实为 ~/.kokoa/memory-net）
- 旧用例同步：auto-observe 配置用例中 'yes'/1 由「非法值」改为识别为 true 的新断言（行为升级的预期连带），1 处非法值样本换 'x'
- 锁定用例 2 条：根仓 P3-14a（NaN/Infinity 拒绝 + 正常值不受影响）、adapter P3-14b（enabled/五项布尔形态全矩阵）
- 验证：根 28/28（27→28）+ adapter 20/20（19→20）+ build 绿；commit 4673ba5 推送 ls-remote 双向验证

Stage Summary:
- 会话 14（仓 C）✅：写纪律不变量（confidence 非空非 NULL）获得 schema 校验级加固，配置面布尔语义可预测且全局一致
- 下一步：实机观察 auto-observe 观测质量按需调参；或桌面 app 新队列（console 14 条 P3 亦在队列）

---
Task ID: 15 (会话 15)
Agent: 主 agent (Super Z)
Task: nodes(updated_at,seq) 读序索引补齐（console P3-5 上游半）

Work Log:
- db.ts DDL 增 idx_nodes_updated ON nodes(updated_at, seq)——console/CLI 读面默认序 ORDER BY updated_at DESC, seq DESC 反向扫描命中，大库排序成本不再随每次请求重复付
- 锁定用例 tests/10-session15-index.test.ts：索引存在 + EXPLAIN QUERY PLAN 命中断言
- 根 29/29 + adapter 20/20 + build 绿；commit e3dda9d 推送 ls-remote 双向验证

Stage Summary:
- 会话 15（仓 C）✅：读面默认序索引落地，console vendor 同会话已钉本 sha
- 下一步：auto-observe 观测质量实机观察调参；或新队列
