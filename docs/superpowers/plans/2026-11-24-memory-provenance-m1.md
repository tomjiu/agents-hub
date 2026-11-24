# Memory Provenance M1 Implementation Plan

> **For agentic workers:** Execute inline using the available executing-plans workflow, with review checkpoints. Delegate only if permitted by the user and exposed by the host; never invent a required sub-skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 [issue #2](https://git.mingjiu.store/sandbox/agents-hub/issues/2) M1——操作账本、不可变修订与引用正确性；使 [M0 矩阵](../../../plugins/memory-net/PROVENANCE-M0-MATRIX.md) §5 红灯 R1-R5 转绿，并补齐无 API 面缺口的先红后绿测试。

**Architecture:** schema1 `memory.db` 保持不动（写纪律/缓存指纹/既有回归零变化）。新增 sidecar `provenance.db`（schema_version=2）：`operations`（稳定操作身份+重放坐标）、`node_revisions`（不可变全量快照+单父链）、`node_heads`（current 指针+revision 级 CAS）、`revision_links`（精确到修订的依赖边）。MemoryNet 以可选 `ledger` 附件记录成功事务；适配层不感知。绝不复制 Delta 内部 DDL/CRDT——仅借鉴公开设计结论（操作稳定身份、修订链、精确引用、同事务提交）。

**Tech Stack:** Node、TypeScript、node:sqlite（BEGIN IMMEDIATE、FK 开启）、node:test、独立临时库 fixture。

---

## 边界及验证入口

- 不修改真实库/用户 profile/当前 Web；全部测试用 `makeTempWs` 独立临时库。
- 不重写导入基线、不改 catalog provenance；sidecar 独立文件独立版本键，旧二进制打开不得写回版本。
- schema1 既有 44 核心+35 适配测试必须保持全绿；`tests/m1-red/` 转绿后移入常规套件并保留原断言。
- 每完成一个 Task 独立提交；最终跑根 npm test/validate + 核心/适配回归 + 两版 DSH 独立 HOME 验收（rc.5 Linux 已有指纹记录，指纹变化即重验）。

## Task 1: 操作账本与稳定身份（R1/R4）

**Files:** 新建 `plugins/memory-net/src/ledger.ts`、`plugins/memory-net/tests/14-ledger.test.ts`；转绿 `tests/m1-red/` R1/R4。

- [x] ledger.ts：`openLedger(dir)` 打开/创建 sidecar `provenance.db`；DDL 含 `operations(op_id TEXT PK, workspace_instance_id, seq INTEGER UNIQUE, actor, operation_kind, session_id, call_id, root_call_id, durable_event_seq, summary, occurred_at, committed_at, capture_policy)`；`schema_version=2` 存 sidecar 自己的 meta，不动 memory.db。
- [x] 每个成功事务（add/link/promote/demote/contradict/updateProgress/appendTrail/reviewCandidate/gc）在**同一 BEGIN IMMEDIATE** 内写 operation + 业务行；失败/回滚不发布操作。
- [x] appendTrail 账本锚点（trail 表保留显示层压缩，账本 op 坐标不可变）：GC 压缩不再 DELETE+重编号，改为 tombstone/合并行保留原 seq 坐标（R4 转绿；trail 保持显示层压缩摘要）。
- [x] 重放去重：`recordOperation` 以 `(host_instance, session_id, durable_event_seq)` 唯一约束；同坐标同摘要幂等返回既有 op_id；同坐标异摘要拒绝并抛 `LedgerConflictError`。无持久来源坐标（durable_event_seq NULL）只分配本地 op_id，不声称可去重。
- [x] exportFullPkg 附完整账本（R1 转绿）；v1 exportPkg 保持原样（R1 转绿）；importPkg 校验账本闭包后原子导入。

## Task 2: 不可变修订链与精确引用（R2）

**Files:** `src/ledger.ts`（node_revisions/node_heads/revision_links）、`tests/15-revisions.test.ts`；转绿 R2。

- [x] `node_revisions(revision_id TEXT PK, node_id, parent_revision_id, kind, text, payload_json, based_on_json, status, actor, op_id, created_at)`——有界全量快照，不实现 delta 压缩；单父链。
- [x] `node_heads(node_id PK, revision_id)`；CAS 变更：携带 `expected_revision`，不匹配抛 `RevisionConflictError` 并要求显式重读（不用 updated_at 毫秒）。
- [x] `revision_links(revision_id, referenced_node_id, referenced_revision_id, relation)`——依赖精确到修订，历史引用不随 current 漂移；一个事件改多个节点用同 op_id 关联多条修订。
- [x] progress/link 走修订链：updateProgress 每次新修订（保留 conflict 标记语义），link 追加修订而非原地改 based_on_json（R2 转绿：导出可复原 before 快照）。
- [x] 迁移：migrateLedgerBaseline（显式、先备份、拒绝重复、legacy_baseline）时把 schema1 当前态导入为 origin=legacy_baseline 首修订；不补造历史；迁移在 .bak 备份后进行，可整体删除 sidecar 回退。

## Task 3: 修订级 CAS 与并发治理（R3/R5）

**Files:** `store.ts`（promote/demote/contradict/updateProgress 增加可选 expected_revision）、`tests/16-cas.test.ts`；转绿 R3/R5。

- [x] 所有状态变更支持 expected_revision；无 ledger 时保持现状行为（兼容），有 ledger 时强制 CAS。
- [x] 补齐校验后写入竞态（跨进程竞态测试 16 号，两路径均无悬空引用）：非 key add/link/promote/demote/contradict 的引用存在性校验移入同一写事务（BEGIN IMMEDIATE 序列化写者，消除 GC 检查到使用窗口）。
- [x] 并发 CAS 失败抛 RevisionConflictError（显式重读）+当前头修订；不自动 LWW（R5 转绿）。
- [x] updateProgress 的 base_updated_at 保留兼容，expected_revision 优先（R3 转绿） 保留为兼容入口，但 ledger 在场时以 revision 为准；同一毫秒并发不再漏判（R3 转绿）。

## Task 4: 导出/导入含历史与敏感删除（M1 末项）

**Files:** `store.ts` exportPkg v2 / importPkg v2、`tests/17-export-history.test.ts`。

- [x] schema2 导出：全部 operations/revisions/heads/links + trail 原坐标；导入先校验闭包（无悬空修订引用）再原子发布新库。
- [x] 降级拒绝：schema2 包被旧导入入口（仅认 schema_version=1）明确报错，不静默丢历史；schema1 包导入 schema2 库时标 legacy_baseline，不伪造账本。
- [x] 敏感删除：`redact(node_id|revision_id)` 硬删/脱敏目标修订并**失效所有指向它的 links 与依赖投影**（依赖方标 needs_review），不以不可变拒绝用户删除；导出可排除已脱敏项。
- [x] 崩溃恢复（单事务原子发布，失败回滚不留半写库）导入/迁移中途失败不留半写库（临时名+原子 rename）；.bak 保留最近一次。

## 必须验收（对齐 issue #2）

- [x] R1-R5 转绿入 14 号测试；m1-red 场景改写为 15 号 legacy 边界契约（默认套件）并移入常规套件；新增 14-17 号测试覆盖：并发 CAS、事务回滚、证据漂移、GC 竞态、导出恢复、重放幂等/异摘要拒绝、缺元数据 unknown。
- [x] 核心 69/69、适配 35/35、根 152/152、validate PASS（Linux）、适配 35、根套件全绿；npm run validate 通过。
- [ ] 两版固定 DSH（rc.5 Linux + 一版 Windows 或用户指定）独立 HOME/DSH_HOME、本地模型/临时库、遥测关闭：生成运行包 + 跨进程恢复同一持久会话（若运行包探针仍受 session 默认限制，如实列缺口不标 PASS）。
- [ ] 无 CI 不声称 CI 通过；宿主/产物指纹重验，不继承失效接受记录。
