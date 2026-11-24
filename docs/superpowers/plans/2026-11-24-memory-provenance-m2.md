# Memory Provenance M2 Implementation Plan（已实施）

> **For agentic workers:** Execute inline using the available executing-plans workflow, with review checkpoints. Delegate only if permitted by the user and exposed by the host; never invent a required sub-skill.

**Goal:** 落地 [issue #2](https://git.mingjiu.store/sandbox/agents-hub/issues/2) M2——宿主会话／代码版本绑定：实际会话事件 seq、call/root-call、原生 read/edit/write before/after 依据与规范化摘要；结论绑定确切证据/代码修订；无关变化不失效、同内容重验不证伪、相关变化标 needs_review 且原证据可定位；dirty/untracked/shell 副作用/缺 before/不可访问源码不得伪装为已知版本。

**Architecture:** M1 sidecar `provenance.db` 纯增量扩展（`code_states`、`source_refs`、`evidence_validations` 三表 + `ledger_meta.evidence_feature_version` 前向守卫）。schema_version 保持 2：旧二进制忽略新表安全降读，新二进制遇到更高特性版本拒绝打开（显式失败，不静默）。导出格式：有证据数据 → v3 包（旧 M1 二进制按 `schema_version !== 2` 明确拒绝，不静默丢证据）；无证据 → 保持 v2 形状零扰动。

**Tech Stack:** Node、TypeScript、node:sqlite、node:test；宿主验收用真实 DSH 0.2.2-rc.5 headless + 本地脚本模型（沿 M1 通道）。

---

## 边界及验证入口

- 不修改真实库/用户 profile/当前 Web；全部测试 `makeTempWs` 独立临时库。
- 模型面工具 schema 零变化（`adapters/dsh` 工具定义不动）；M2 全部走宿主/工具面新 API 与 payload 数据字段。
- 既有 69 核心 + 35 适配测试全绿不回归；新增 21 项 M2 测试（先红后绿：API 不存在时编译失败即红灯）。
- 宿主指纹重验：`probe-memory-session-context`（candidates+cache specials + 三会话隔离 + 默认库不开启）+ `check-dsh`。

## Task 1: code_states 捕获语义（声明式、缺=unknown 不补造）

**Files:** `src/evidence.ts`（新）、`tests/17-evidence-m2.test.ts`（新）。

- [x] `captureCodeState(input)`：host/tool 声明式捕获。completeness 推导从严：`complete` 仅当 host_native + 显式 `fullEnumeration` + git 信息在场 + 非 dirty + untracked 可知；git-only → `partial`（**Git commit 不能代表完整工作树**）；dirty/untracked/untrackedUnknown → 至多 `partial`；shell 副作用 → 至多 `partial`，无摘要 → `unknown`。
- [x] 文件级：`digest`（已摘要）或 `content`（原文规范化摘要）二选一；皆缺 = 该文件不入已知表（**不编造、不用 mtime/大小冒充**）。
- [x] `normalizeContent`：仅行尾 CRLF/CR→LF；空白/Unicode 改写视为内容变化。`capture_policy='m2-capture-v1'` 行级版本化。

## Task 2: source_refs 绑定与事件坐标

- [x] `bindEvidence(nodeId, {code_state_id, session_id, durable_event_seq, call_id, root_call_id, files})`：追加式（旧绑定 `current=0` 保留，`evidenceHistory` 可查全链——**原证据可定位**）。
- [x] `link_status` 三态：`captured`（持久事件坐标齐全）/`event_linked`（仅 call 坐标）/`persisted_unknown`（全无）——**区分捕获、事件链接、持久化未知**。
- [x] `AddInput.evidence`：写入同事务绑定（`bind` 操作复用会话坐标、durable=NULL 不与 add 操作撞 UNIQUE）；模型角色夹带证据 → 拒绝（保留字段纪律）。
- [x] 绑定依赖在 BEGIN IMMEDIATE 内解析（未知 node/code_state 拒绝）；账本记录 `capture|bind|verify` 操作（OperationKind 扩展，DDL 无 CHECK 约束、旧行不受影响）。

## Task 3: verifyEvidence 核验语义

- [x] 相关变化 → `needs_review`：追加标记修订（payload.needs_review 指向 validation_id + original_code_state_id + bound_revision_id），节点保持 active（标记≠推翻），原绑定/原 code_state 不动。
- [x] 无关变化（证据外文件）→ `valid` + `unrelated_changed` 如实列出（**不失效**）。
- [x] 同内容重验（含行尾归一一致）→ `valid`（**不证伪**）。
- [x] 当前态无证据文件摘要（不可访问源码）→ `unknown`，不标 needs_review（区分"证据失效"与"无法核验"）；未绑定节点 → 显式报错。
- [x] `evidence_validations` 表追加记录每次核验（含 changed/unrelated 明细）。

## Task 4: 桥接（adapters/dsh）

- [x] `buildObservation`：原生 read/edit/write 词段族工具（保守正则，独立词段匹配）从 arguments 提取 path/before/after → **digest-only 证据**（payload.evidence + 顶层 evidence）；观测文本 args 同步脱敏（`[evidence-digested]`，原文不进记忆文本/载荷）；非文件工具零变化。
- [x] `installAutoObserve`：binding 回调可选 `durableEventSeq`/`root` 透传 → 观测写入带 provenance 坐标；事件内文件摘要即时捕获 code_state（host_native、非全量枚举 → partial，**不声称全树已知**）；证据失败不阻断原观测写入（try/catch 降级）。

## Task 5: 导出/导入与验收

- [x] v3 包（`LedgerPackage.evidence` + 闭包校验：source_refs/validation 悬空 code_state 拒绝；目标非空拒绝）；无证据导出保持 v2（M1 兼容形状，既有断言零改动）。
- [x] 21 项 M2 测试全绿；核心 90/90、适配 35/35、根 npm test/validate 通过。
- [x] 宿主重验：probe-memory-session-context（rc.5 真实 headless、candidates+cache specials、3 会话隔离、默认库不开启、指纹前后一致）PASS；check-dsh VERIFIED（新指纹已登记 48 号验收）。
- [x] 审计记录 `catalog/audit/memory-provenance-m2.json`。

## 已知边界（如实）

- `installAutoObserve` 的 `durableEventSeq`/`root` 由宿主 binding 回调提供；当前 DSH 宿主面若不提供 → 持久化 unknown（M1 行为），不冒充可重放。
- evidence 特性版本守卫是单向前向保护；旧 M1 二进制打开 M2 库会忽略证据表（SQLite 语义安全），但反向导出 v3 包会被旧二进制明确拒绝。
- `completeness=complete` 依赖宿主诚实声明 `fullEnumeration`；本模块不从文件系统自行枚举（桥不读盘，捕获语义保持声明式）。
- Windows 复验未执行（本环境 Linux）；跨进程恢复同一持久会话仍属 issue 终验缺口（M3+/运行包阶段）。
