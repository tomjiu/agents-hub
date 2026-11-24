# memory-net

> 同目标、多 Agent 分工，维护**一张共享记忆网**。按 workspace 物理隔离；事实（observation）与推断（inference）硬隔离；activate 预算化注入。**不是通用 chatbot RAG** —— 没有向量库、没有相似度检索，只有结构化节点、权重序与双预算裁剪。

## 事件到候选的准入闭环（本分支候选）

proposeCandidate写入带来源观测和内容指纹的pending推断；它不是物理事实，不进入curated。reviewCandidate仅host可调用，必须给出预期指纹、审核者、理由和与原事件不同的同范围成功观测。accept记录核验回执并promoted，reject保留回执但demoted；重复同请求幂等，冲突请求拒绝。提案和核验在BEGIN IMMEDIATE内校验引用再写入，失败整体回滚。

精选每次只读复核原事件/核验观测的正文摘要和active状态；失效、篡改或不完整回执退出精选，raw仍可诊断。候选与证据存在原节点结构中，无schema迁移；GC沿based_on/promote_evidence保护有效推断依据。旧add/promote仍兼容，但仅promote不能把pending候选准入。tip仍是建议，不要求这条候选核验路径，不得当已验证结论。

**这是证据流程，不是自动真假判断**：不同观测ID不保证独立实验，reviewer是宿主记录不是身份认证，成功工具结果不证明任务正确。模型需显式提炼摘要并引用事件；没有自动语义摘要、核验UI、跨会话分享、不可变修订或代码版本绑定。拒绝候选在显式purge后不保证永久保留。详见[适配使用](<adapters/dsh/README.md>)。

## 精选召回（隔离候选）

核心activate默认raw兼容旧调用；`activate(query,{view:"curated",task_id,run_id})`使用只读精选投影。自动工具观测（payload.tool）不进入精选，原件/引用仍完整保留，显式raw可诊断。约束始终保护，进度仅当前上下文保护；没有上下文时不冻结其他任务。非空查询按NFKC字面词命中，ASCII词边界避免react命中reactivity；不作向量或语义召回。空查询只保留持久tip、已审阅推断和明确当前上下文内容。

精选返回curation排除数及原因；预算裁剪统计与策略排除分开。`promoted`仍是经过审阅的推断，不是物理事实或身份认证。此投影不删除、不自动升级、也不解决存储增长、不可变版本/代码绑定、引用并发竞态及敏感信息脱敏。DSH默认策略见[适配说明](<adapters/dsh/README.md>)。

## 与「每人私有记忆」的区别

常见的 agent 记忆方案是每个 agent 一份私有记忆库：进度不可见、路径不可复现、互相踩踏重做。memory-net 反其道而行：

| 维度 | 私有记忆 | memory-net（共享记忆网） |
|------|---------|------------------------|
| 进度 | 各自为政，A 不知道 B 做到哪 | `progress` 按 task 单行共享，owner 随交接换手 |
| 路径 | 只有自己的日志 | `trail` 按 run 有序共享，可回放/排障/复现 |
| 事实 | 混在对话历史里 | `observation` 仅工具桥/宿主可写，模型结论永远进不了事实层 |
| 冲突 | 静默双真相 | progress 并发写标 `conflict` 并记录字段级双方值 |
| 隔离 | 全局一份或按人分 | **按 workspace 物理隔离**（一个 workspace 一个 SQLite 文件），切换即挂载/卸载，关闭不串读 |

每个 Agent 只 `activate` 当前需要的节点（带 `max_nodes` + `max_tokens` 双预算）；`constraint` 与当次 `progress` 永不裁光。

## 节点类型（最小集）

- **constraint**（forbid/require，置顶，仅宿主可写）
- **observation**（source=tool|user|config|system；可带 path/exit_code；同 key 覆盖 → 基于旧值的 inference 自动 contradicted）
- **inference**（confidence 必填；based_on 轻量边；**禁止自动 promote**——升级需证据或宿主确认）
- **progress**（同 task 单行共享，多 Agent 协作核心；冲突标 conflict，不静默双真相）
- **tip**（可选 strategy/recovery）
- **trail**（有序步骤表：action、refs、timestamp —— 可复现/排障）

## 快速开始（三条命令演示双 agent 共享 progress）

要求 Node ≥ 22.5（内置 `node:sqlite`，**零 npm 运行时依赖**）。注：`node:sqlite` 自 Node 23.4 起默认启用；22.5–22.12需加 `--experimental-sqlite`；22.13+无需该旗标。Node 26.13.1文档将DatabaseSync列为Database的弃用兼容别名，两者仍同步执行；本实现尚未迁移，不能假定未来兼容。详见 [本仓实际研究任务](../../catalog/audit/research-memory-sqlite.md)。

```bash
npm install && npm run build

# ① 初始化共享 workspace（alice / bob 都挂载它）
node bin/mn.js init /tmp/demo-ws --workspace-id demo

# ② agent alice 写 progress + trail（同 run 协作序列）
node bin/mn.js progress /tmp/demo-ws --task build-login --agent alice --status doing --summary "登录页完成 60%，卡在 OAuth 回调" && node bin/mn.js trail /tmp/demo-ws --run r1 --agent alice --action "发现 OAuth 回调阻塞"

# ③ agent bob activate：读到 alice 的进度与步骤，接手继续
node bin/mn.js activate /tmp/demo-ws --query "登录 OAuth 进度" --agent bob --run r1
```

或一键：`npm run demo`。

## 库 API（TypeScript）

```ts
import { MemoryNet } from 'memory-net'

const alice = MemoryNet.open('./ws-demo', { agentId: 'alice', role: 'host' })
const bob   = MemoryNet.open('./ws-demo', { agentId: 'bob',   role: 'model' }) // 写纪律：只能 inference/tip

alice.updateProgress('t1', { status: 'doing', summary: '…' })       // 共享进度
alice.appendTrail('r1', { action: '完成 X', refs: ['n3'] })          // 共享路径
bob.activate('查询词', { run_id: 'r1', budgets: { max_nodes: 24, max_tokens: 2048 } })

alice.exportPkg()                       // 单 workspace 记忆包（JSON）
MemoryNet.importPkg(pkg, './ws-copy')   // 整网迁移
alice.gc({ trail_keep: 50 })            // trail 压缩；observation 默认绝不因 TTL 删
```

权重序（写死）：`constraint(6) > observation(5) > progress(4) > tip(3) > inference(2) > trail 摘要(1)`；promoted inference 升至 observation 级。

## CLI 一览

```
mn init | add | get | link | progress | trail | replay | activate
      | promote | demote | contradict | gc | export | import
```

写纪律演示：`mn add <dir> observation --role model --text "…"` → 可读拒绝（模型不得伪造观测）。

## P0正确性修复（schema1，需新宿主验收）

- 自动工具观测在DSH适配桥中独立追加，不以工具名覆盖旧依据；显式subject key仍按保守覆盖规则推翻active/promoted推断。
- promoted推断可参与召回，仍是推断，不自动变成observation。
- GC压缩/TTL/purge同一BEGIN IMMEDIATE事务内执行，失败全部回滚；保护active/promoted节点通过based_on和生命周期evidence可达的传递依据，循环引用用visited集终止。purge与TTL仍默认关闭。
- 尚无不可变修订/代码版本绑定。trail清理仍重编号；已有缺失引用不补造。GC只保护当次已提交图，add/link的校验到写入竞态尚未解决，不能宣称完整并发引用完整性。
- 追加增加存储与召回噪音，不能直接采用到运行Web；当前预算不是精选召回或存储配额。设计见[操作历史设计](PROVENANCE-DESIGN.md)。

## 存储

- **SQLite（node:sqlite，写死）**：一个 workspace = 一个 `<dir>/memory.db`，WAL + busy_timeout，本机多实例共享且写者串行；不支持活跃WAL库跨机器网络盘共享写入，超时/失败仍需处理
- 轻量边：`based_on`（JSON 数组列）与 trail 序号——**不上图数据库**
- `export/import` 单 workspace 记忆包：跨机迁移、备份、审计

## 明确不做（v1）

向量库 / 双曲几何 / 完整 Multi-Agent 编排 / 预测预取（留扩展点，默认关闭）/ 云远程控制面 / 通用 chatbot RAG。

dsh 适配包（把 memory-net 接入 Kokoa 桌面的 dsh 运行时）位于 [`adapters/dsh/`](adapters/dsh/README.md)：
零 import dsh/cordis（只依赖自声明的最小结构契约），但DSH上游升级仍须精确指纹与实际宿主复验，不能保证零改动。历史验证为真实
dsh 0.1.2-rc.1 端到端验证（headless 冒烟：插件加载/工具注册/区段注入/模型工具调用/SQLite
落盘/宿主工具结果自动观测全闭环）。模型工具面只暴露 inference/tip，observation 写路径仅宿主
可达（host API + auto-observe 桥：dsh 宿主工具的执行结果经 `tools/result` 事件自动入网，
模型不可控不可伪造）。`npm --prefix adapters/dsh test`（mock ctx 契约测试，即 dsh 升级兼容性锁）；
`bash adapters/dsh/scripts/smoke-dsh-e2e.sh`（真实 dsh headless 冒烟，不进 CI）。

## 测试

```bash
npm test        # 69 用例：双 agent 共享 / workspace 隔离 / 写纪律 / 覆盖联动 / trail 回放 / 预算 / 冲突 / gc / 迁移 / CLI 子进程 smoke / 溯源账本（操作/修订/CAS/重放/导出导入/脱敏/跨进程竞态）
```

不依赖任何真实 LLM。

## 溯源账本（M1，schema2 sidecar，默认关闭）

`MemoryNet.open(dir,{ledger:true})` 挂载 `provenance.db`（ATTACH 同一连接，跨文件同事务提交）：
操作账本（稳定 op_id+重放坐标去重/同坐标异摘要拒绝）、不可变修订链（单父链+精确到修订的
based_on 引用）、修订级 CAS（promote/demote/contradict/link 必需 expected_revision，progress
以 expected_revision 标冲突保留合并语义）、`exportFullPkg`/`importFullPkg`（含历史，闭包校验+拓扑
导入+降级拒绝）、`migrateLedgerBaseline`（先备份，origin=legacy_baseline，不补造历史）、`redact`
（敏感删除：清理修订+操作摘要+失效依赖方，不以"不可变"拒绝用户删除）。默认不挂载时 schema1
行为与指纹完全不变；sidecar 可整体删除回退。设计与边界见 [PROVENANCE-M0-MATRIX](PROVENANCE-M0-MATRIX.md)
与 [M1 计划](../../docs/superpowers/plans/2026-11-24-memory-provenance-m1.md)。
