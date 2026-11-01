# 架构（memory-net v1）

## 定位

memory-net 是**共享记忆网**：同目标、多 Agent 分工，维护一张按 workspace 隔离的结构化记忆图。它服务的场景是「多个 agent 协作做同一件事」——进度可共享、路径可复现、事实与推断硬隔离、注入有预算。它不服务「聊天机器人长期对话摘要」——那是 RAG 的问题域，本仓库刻意不做。

## 分层

```
┌─────────────────────────────────────────────┐
│ CLI（mn）—— 宿主侧即开即关，无常驻进程            │
├─────────────────────────────────────────────┤
│ MemoryNet（src/store.ts）                     │
│   open/close · add/get/link                   │
│   update_progress · append_trail/replay       │
│   activate · promote/demote/contradict · gc   │
│   exportPkg / importPkg                       │
├─────────────────────────────────────────────┤
│ activate（src/activate.ts，纯函数）            │
│   权重序 + query 命中 + 新鲜度 + 双预算裁剪      │
├─────────────────────────────────────────────┤
│ db（src/db.ts）—— node:sqlite 写死             │
│   一个 workspace = 一个 memory.db（WAL）        │
└─────────────────────────────────────────────┘
```

依赖单向：CLI → MemoryNet → activate/db → node:sqlite。activate 与 store 的行转换全部为纯函数，可独立测试。

## 共享网模型

### 作用域四元组

| 作用域 | 载体 | 语义 |
|--------|------|------|
| workspace_id | `<dir>/memory.db` 文件本身 | 物理隔离：打开即挂载，关闭即卸载，跨 workspace 不可能串读；显式打开时 id 不符直接拒绝 |
| run_id | nodes 行列 + trail 主键 | 一次执行会话；trail 按 run 有序，activate 按 run 附摘要 |
| task_id | progress 行唯一键 | 一个任务一条进度（单行共享），跨 agent 换手 |
| agent_id | MemoryNet.open 绑定 | 写入者身份，add 时不可冒名；所有行留痕 |

### 节点与边

节点五类（constraint/observation/inference/progress/tip）存 `nodes` 表；trail 是独立有序表 `(run_id, seq)` 主键。轻量边只有两种：`based_on`（JSON 数组列，推断依赖观测）与 trail 序（隐式顺序边）。**没有图数据库、没有邻接表**——v1 的边查询只服务两件事：覆盖联动与 purge 保护。

### 覆盖联动（observation → inference）

```
tool 写 observation(key=K, v2)
  → 同 key active 观测 v1 → superseded（保留历史，不物理删）
  → 所有 based_on 含 v1 的 active inference → contradicted
```

物理事实变化时，基于旧事实的推断自动失效——这是「事实与推断硬隔离」的运行时体现：推断不能以 observation 身份永生，观测变了它就得退场。

## 写纪律

角色在 `MemoryNet.open` 时绑定，不是每次调用传参——写入者身份不可在调用点伪造：

| 角色 | constraint | observation | inference | tip | progress | trail |
|------|-----------|-------------|-----------|-----|----------|-------|
| model（模型/自由文本） | ✗ | **✗** | ✓ | ✓ | ✓ | ✓ |
| tool（工具桥） | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ |
| host（宿主显式 API） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

违规走 `WriteForbiddenError` 可读拒绝。`inference.confidence` 必填（0~1）；`add('progress')` 直接拒绝——进度只能走 `update_progress` 的单行共享语义。

## 激活（activate）

1. **冻结集**：constraint 全部 + 当次 progress（task_id 优先，其次 run_id，缺省全量保守冻结）——永不裁光，可超预算
2. **竞争池**：其余 active 节点（contradicted/demoted/superseded 永不进入）
3. **排序**：`权重 + query 命中×2 + 新鲜度（24h +1.5 / 7d +0.75）+ inference.confidence`
4. **双预算**：`max_nodes` + `max_tokens`（估算 utf8/3，写死）；trail 摘要权重最低，预算紧时最先丢

promote 语义：显式操作（需 evidence 节点引用或宿主 by=user），promoted inference 升至 observation 级权重。**库内无任何自动 promote 路径**。

## 冲突与 gc

- **progress 冲突**：`base_updated_at` 乐观锁；过期 base → 后写赢但 `conflict=1` + 字段级双方值留档（不静默双真相）
- **gc**：trail per-run 压缩（保留首尾，中间合并为 compressed 步）；TTL 仅降级 tip/inference（**observation 永不因 TTL 删**——物理观测是审计基础）；purge 物理清理降级行但保护被 active inference 引用的行

## 存储决策

SQLite（Node 内置 `node:sqlite`）在 v1 是写死选项：单文件嵌入、按 workspace 物理隔离天然成立、WAL 下多实例并发共享（busy_timeout 5s）、零 npm 运行时依赖。分 workspace 文件方案与之不冲突——SQLite 文件就是那个「分 workspace 的文件」。

## dsh 适配（adapters/dsh，零依赖 dsh 源码）

Kokoa 的 dsh 运行时接入为适配包 `adapters/dsh/`（见其 README 的三条设计红线）。核心机制：

- **契约自持**：适配包不 import 任何 dsh/cordis 模块——宿主以运行时形态传入 ctx，
  适配包只依赖 `src/contract.ts` 自声明的最小结构契约（structural typing）+ `probeCtx`
  运行时能力探测（能力缺失降级明示，不崩宿主）。dsh 是 vendor（版本锁定、跟随官方上游
  更新、严禁 fork/patch/替换），升级 dsh = 换 vendor 版本，适配包零改动。
- **角色映射**：`MemoryNet.open(workspace, { role: 'host' })` 由适配包持有并经
  `ctx.provide('memory-net', api)` 暴露 host API（`observe` 仅此入口）；模型侧只有两个
  工具——`memory_net_recall`（按预算 activate）与 `memory_net_write`（kind 白名单强制
  inference/tip，伪造 observation 在工具面与核心 WriteForbiddenError 双重拦截）。
- **auto-observe（宿主工具结果自动入网）**：订阅 dsh-tools 注册表的 `tools/result` emit
  事件（`ctx.on`，cordis 事件总线方法，非服务属性无需 inject），把非记忆类宿主工具的
  执行结果自动写为 observation（key=`tool:<名>` 状态覆盖语义；`memory_net_*` 自指过滤、
  嵌套 dispatch 默认过滤、写入全 try/catch 自我隔离 + dsh 侧 containment 双保险）。
  事件桥缺失（ctx.on 不可达）时软降级关闭，其余接缝照常。写纪律不变：模型永远不可控、
  不可伪造 observation 写路径。
- **兼容性锁**：mock ctx 契约测试锁住「适配包对 ctx 契约面的全部假设」——dsh 升级后
  重跑即知兼容性，失败点即接缝处。
