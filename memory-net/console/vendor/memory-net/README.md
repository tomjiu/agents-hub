# memory-net

> 同目标、多 Agent 分工，维护**一张共享记忆网**。按 workspace 物理隔离；事实（observation）与推断（inference）硬隔离；activate 预算化注入。**不是通用 chatbot RAG** —— 没有向量库、没有相似度检索，只有结构化节点、权重序与双预算裁剪。

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

要求 Node ≥ 22.5（内置 `node:sqlite`，**零 npm 运行时依赖**）。注：`node:sqlite` 自 Node 23.4 起默认启用；22.5–22.x 需加 `--experimental-sqlite` 旗标运行。

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

## 存储

- **SQLite（node:sqlite，写死）**：一个 workspace = 一个 `<dir>/memory.db`，WAL + busy_timeout，多实例并发共享安全
- 轻量边：`based_on`（JSON 数组列）与 trail 序号——**不上图数据库**
- `export/import` 单 workspace 记忆包：跨机迁移、备份、审计

## 明确不做（v1）

向量库 / 双曲几何 / 完整 Multi-Agent 编排 / 预测预取（留扩展点，默认关闭）/ 云远程控制面 / 通用 chatbot RAG。

dsh 适配包（把 memory-net 接入 Kokoa 桌面的 dsh 运行时）位于 [`adapters/dsh/`](adapters/dsh/README.md)：
零 import dsh/cordis（只依赖自声明的最小结构契约），dsh 官方上游升级零改动；已对真实
dsh 0.1.2-rc.1 端到端验证（headless 冒烟：插件加载/工具注册/区段注入/模型工具调用/SQLite
落盘/宿主工具结果自动观测全闭环）。模型工具面只暴露 inference/tip，observation 写路径仅宿主
可达（host API + auto-observe 桥：dsh 宿主工具的执行结果经 `tools/result` 事件自动入网，
模型不可控不可伪造）。`npm --prefix adapters/dsh test`（mock ctx 契约测试，即 dsh 升级兼容性锁）；
`bash adapters/dsh/scripts/smoke-dsh-e2e.sh`（真实 dsh headless 冒烟，不进 CI）。

## 测试

```bash
npm test        # 20 用例：双 agent 共享 / workspace 隔离 / 写纪律 / 覆盖联动 / trail 回放 / 预算 / 冲突 / gc / 迁移 / CLI 子进程 smoke
```

不依赖任何真实 LLM。
