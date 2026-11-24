/**
 * Provenance ledger（schema 2 sidecar）——操作账本、不可变修订与精确引用。
 *
 * 定位：issue #2 M1。`provenance.db` 通过 ATTACH 挂到 memory.db 同一连接：
 * BEGIN IMMEDIATE 跨两文件原子提交/回滚（SQLite super-journal），依赖存在性
 * 校验与修改在同一写事务内完成。设计依据 PROVENANCE-DESIGN.md；不复制任何
 * Delta 内部 DDL/CRDT 协议。
 *
 * 纪律：
 * - 本文件绝不写 memory.db 的 meta/schema（schema_version 写回保护）。
 * - 修订不可变：只 INSERT，不改不删（用户显式 redact 例外，且必须失效关联）。
 * - 无持久来源坐标（durable_event_seq 为 NULL）只分配本地 op_id，不声称可去重。
 * - 全部方法必须在调用方已开启的写事务内使用（store.ts 保证）。
 */
import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { mkdirSync, copyFileSync, statSync, existsSync, renameSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { WorkspaceError } from './errors.js'
import type { MemoryNode, NodeKind } from './types.js'

export const LEDGER_SCHEMA_VERSION = 2

/** 同坐标（host_instance+session_id+durable_event_seq）不同摘要 → 拒绝。 */
export class LedgerConflictError extends WorkspaceError {
  constructor(message: string) { super(message) }
}
/** 修订 CAS 失败：显式重读后重试，不自动 LWW。 */
export class RevisionConflictError extends WorkspaceError {
  constructor(message: string) { super(message) }
}

export type OperationKind =
  | 'add' | 'link' | 'promote' | 'demote' | 'contradict' | 'progress' | 'status'
  | 'trail' | 'review' | 'gc' | 'redact' | 'import' | 'migration'
  | 'capture' | 'bind' | 'verify'

export interface OperationInput {
  actor: string
  operation_kind: OperationKind
  summary: string
  session_id?: string | null
  call_id?: string | null
  root_call_id?: string | null
  /** 持久事件序号：与 host_instance+session_id 构成重放坐标；NULL=本地身份。 */
  durable_event_seq?: number | null
  host_instance?: string | null
}

export interface OperationRecord extends Required<Omit<OperationInput, 'host_instance'>> {
  op_id: string
  workspace_instance_id: string
  seq: number
  summary_digest: string
  occurred_at: number
  committed_at: number
  capture_policy: string
}

export interface RevisionSnapshot {
  node_id: string
  kind: NodeKind
  text: string
  payload: Record<string, unknown>
  based_on: string[]
  status: MemoryNode['status']
  actor: string
}

export interface RevisionRecord {
  revision_id: string
  node_id: string
  parent_revision_id: string | null
  op_id: string
  origin: 'live' | 'legacy_baseline' | 'import' | 'redaction'
  kind: NodeKind
  text: string
  payload: Record<string, unknown>
  based_on: string[]
  status: MemoryNode['status']
  actor: string
  created_at: number
}

export interface RevisionLinkRow {
  revision_id: string
  referenced_node_id: string
  referenced_revision_id: string
  relation: 'supports' | 'derived_from' | 'supersedes'
}

const DDL = `
CREATE TABLE IF NOT EXISTS ledgerdb.ledger_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ledgerdb.operations (
  op_id                 TEXT PRIMARY KEY,
  workspace_instance_id TEXT NOT NULL,
  seq                   INTEGER NOT NULL UNIQUE,
  actor                 TEXT NOT NULL,
  operation_kind        TEXT NOT NULL,
  session_id            TEXT,
  call_id               TEXT,
  root_call_id          TEXT,
  durable_event_seq     INTEGER,
  summary               TEXT NOT NULL,
  summary_digest        TEXT NOT NULL,
  occurred_at           INTEGER NOT NULL,
  committed_at          INTEGER NOT NULL,
  capture_policy        TEXT NOT NULL,
  UNIQUE (workspace_instance_id, session_id, durable_event_seq)
);
CREATE INDEX IF NOT EXISTS ledgerdb.idx_operations_kind ON operations(operation_kind, seq);
CREATE TABLE IF NOT EXISTS ledgerdb.node_revisions (
  revision_id        TEXT PRIMARY KEY,
  node_id            TEXT NOT NULL,
  parent_revision_id TEXT REFERENCES node_revisions(revision_id),
  op_id              TEXT NOT NULL REFERENCES operations(op_id),
  origin             TEXT NOT NULL DEFAULT 'live' CHECK(origin IN ('live','legacy_baseline','import','redaction')),
  kind               TEXT NOT NULL,
  text               TEXT NOT NULL,
  payload_json       TEXT NOT NULL,
  based_on_json      TEXT NOT NULL,
  status             TEXT NOT NULL,
  actor              TEXT NOT NULL,
  created_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledgerdb.idx_revisions_node ON node_revisions(node_id, created_at);
CREATE INDEX IF NOT EXISTS ledgerdb.idx_revisions_op ON node_revisions(op_id);
CREATE TABLE IF NOT EXISTS ledgerdb.node_heads (
  node_id      TEXT PRIMARY KEY,
  revision_id  TEXT NOT NULL REFERENCES node_revisions(revision_id)
);
CREATE TABLE IF NOT EXISTS ledgerdb.revision_links (
  revision_id           TEXT NOT NULL REFERENCES node_revisions(revision_id),
  referenced_node_id    TEXT NOT NULL,
  referenced_revision_id TEXT NOT NULL REFERENCES node_revisions(revision_id),
  relation              TEXT NOT NULL CHECK(relation IN ('supports','derived_from','supersedes')),
  PRIMARY KEY (revision_id, referenced_node_id, relation)
);
CREATE INDEX IF NOT EXISTS ledgerdb.idx_links_ref ON revision_links(referenced_node_id, referenced_revision_id);
`

const CAPTURE_POLICY = 'ledger-v1'
/** 摘要上限同时是重放摘要输入：必须是完整内容，截断会让同前缀异内容误判为同事件。 */
const SUMMARY_MAX = 8000

function digestOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function safeJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T } catch { return fallback }
}

interface OpRow {
  op_id: string; workspace_instance_id: string; seq: number; actor: string
  operation_kind: string; session_id: string | null; call_id: string | null
  root_call_id: string | null; durable_event_seq: number | null
  summary: string; summary_digest: string; occurred_at: number
  committed_at: number; capture_policy: string
}

interface RevRow {
  revision_id: string; node_id: string; parent_revision_id: string | null
  op_id: string; origin: string; kind: string; text: string
  payload_json: string; based_on_json: string; status: string
  actor: string; created_at: number
}

function opToRecord(r: OpRow): OperationRecord {
  return {
    op_id: r.op_id, workspace_instance_id: r.workspace_instance_id, seq: r.seq,
    actor: r.actor, operation_kind: r.operation_kind as OperationKind,
    session_id: r.session_id, call_id: r.call_id, root_call_id: r.root_call_id,
    durable_event_seq: r.durable_event_seq, summary: r.summary,
    summary_digest: r.summary_digest, occurred_at: r.occurred_at,
    committed_at: r.committed_at, capture_policy: r.capture_policy,
  }
}

function revToRecord(r: RevRow): RevisionRecord {
  return {
    revision_id: r.revision_id, node_id: r.node_id,
    parent_revision_id: r.parent_revision_id, op_id: r.op_id,
    origin: r.origin as RevisionRecord['origin'], kind: r.kind as NodeKind,
    text: r.text, payload: safeJson<Record<string, unknown>>(r.payload_json, {}),
    based_on: safeJson<string[]>(r.based_on_json, []), status: r.status as MemoryNode['status'],
    actor: r.actor, created_at: r.created_at,
  }
}

/** 挂载/创建 sidecar 账本。dir 即 workspace 根；返回绑定到同一连接的 Ledger。 */
export function attachLedger(db: DatabaseSync, wsDir: string, opts?: { workspaceInstanceId?: string }): Ledger {
  const root = resolve(wsDir)
  mkdirSync(root, { recursive: true })
  const sidecar = resolve(root, 'provenance.db')
  db.exec(`ATTACH DATABASE '${sidecar.replaceAll("'", "''")}' AS ledgerdb`)
  db.exec(DDL)
  const existing = db.prepare("SELECT v FROM ledgerdb.ledger_meta WHERE k = 'schema_version'").get() as { v: string } | undefined
  if (existing) {
    const v = Number(existing.v)
    if (!Number.isInteger(v) || v > LEDGER_SCHEMA_VERSION) {
      throw new WorkspaceError(`provenance.db schema_version ${existing.v} 高于本实现支持版本 ${LEDGER_SCHEMA_VERSION}，拒绝降级打开`)
    }
    if (v < LEDGER_SCHEMA_VERSION) {
      // 旧账本存在时不静默升级：显式迁移接口处理（当前仅 v2，防御未来）。
      throw new WorkspaceError(`provenance.db schema_version ${existing.v} 需要显式迁移，拒绝自动打开`)
    }
  } else {
    db.prepare("INSERT INTO ledgerdb.ledger_meta (k, v) VALUES ('schema_version', ?)").run(String(LEDGER_SCHEMA_VERSION))
    db.prepare("INSERT INTO ledgerdb.ledger_meta (k, v) VALUES ('workspace_instance_id', ?)").run(opts?.workspaceInstanceId ?? randomUUID())
  }
  const instanceId = (db.prepare("SELECT v FROM ledgerdb.ledger_meta WHERE k = 'workspace_instance_id'").get() as { v: string }).v
  return new Ledger(db, instanceId)
}

export class Ledger {
  constructor(private readonly db: DatabaseSync, readonly workspaceInstanceId: string) {}

  /** 重放检查（在业务写入前调用）：
   *  - new：无同坐标记录，可继续写入；
   *  - replay：同坐标同摘要 → 幂等重放，返回原 op 修订过的节点（不重复写入）；
   *  - 同坐标异摘要 → LedgerConflictError。
   *  仅当持久坐标三元组（host_instance+session_id+durable_event_seq）齐全时判定。 */
  checkOperation(input: OperationInput): { status: 'new' } | { status: 'replay'; op_id: string; node_ids: string[] } {
    const sessionId = input.session_id ?? null
    const durableSeq = input.durable_event_seq ?? null
    if (sessionId === null || durableSeq === null) return { status: 'new' }
    const prior = this.db.prepare(
      'SELECT op_id, summary_digest FROM ledgerdb.operations WHERE workspace_instance_id = ? AND session_id = ? AND durable_event_seq = ?',
    ).get(this.workspaceInstanceId, sessionId, durableSeq) as { op_id: string; summary_digest: string } | undefined
    if (!prior) return { status: 'new' }
    if (prior.summary_digest !== digestOf({ kind: input.operation_kind, summary: String(input.summary ?? '') })) {
      throw new LedgerConflictError(
        `重放坐标 (session=${sessionId}, event_seq=${durableSeq}) 已绑定不同摘要操作 ${prior.op_id}；拒绝同坐标异摘要重放`,
      )
    }
    const nodeIds = (this.db.prepare('SELECT DISTINCT node_id FROM ledgerdb.node_revisions WHERE op_id = ? ORDER BY created_at ASC').all(prior.op_id) as unknown as Array<{ node_id: string }>).map(r => r.node_id)
    return { status: 'replay', op_id: prior.op_id, node_ids: nodeIds }
  }

  /** 记录一条成功操作。必须在写事务内调用；失败/回滚由外层事务保证不发布。 */
  recordOperation(input: OperationInput): { op_id: string; replayed: boolean } {
    const summary = String(input.summary ?? '')
    if (!summary.trim()) throw new WorkspaceError('operation summary 不能为空')
    if (summary.length > SUMMARY_MAX) throw new WorkspaceError(`operation summary 超过 ${SUMMARY_MAX} 字符上限`)
    const sessionId = input.session_id ?? null
    const durableSeq = input.durable_event_seq ?? null
    const hostInstance = input.host_instance ?? null
    const summaryDigest = digestOf({ kind: input.operation_kind, summary })
    void hostInstance
    const seq = Number((this.db.prepare(
      "INSERT INTO ledgerdb.ledger_meta (k, v) VALUES ('op_seq', '1') ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(v AS INTEGER) + 1 AS TEXT) RETURNING v",
    ).get() as { v: string }).v)
    const opId = randomUUID()
    const now = Date.now()
    this.db.prepare(
      `INSERT INTO ledgerdb.operations (op_id, workspace_instance_id, seq, actor, operation_kind, session_id, call_id, root_call_id,
         durable_event_seq, summary, summary_digest, occurred_at, committed_at, capture_policy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(opId, this.workspaceInstanceId, seq, input.actor, input.operation_kind,
      sessionId, input.call_id ?? null, input.root_call_id ?? null, durableSeq,
      summary, summaryDigest, now, now, CAPTURE_POLICY)
    return { op_id: opId, replayed: false }
  }

  headRevision(nodeId: string): string | null {
    const row = this.db.prepare('SELECT revision_id FROM ledgerdb.node_heads WHERE node_id = ?').get(nodeId) as { revision_id: string } | undefined
    return row ? row.revision_id : null
  }

  revision(revisionId: string): RevisionRecord | null {
    const row = this.db.prepare('SELECT * FROM ledgerdb.node_revisions WHERE revision_id = ?').get(revisionId) as RevRow | undefined
    return row ? revToRecord(row) : null
  }

  history(nodeId: string): RevisionRecord[] {
    return (this.db.prepare('SELECT * FROM ledgerdb.node_revisions WHERE node_id = ? ORDER BY created_at ASC, revision_id ASC').all(nodeId) as unknown as RevRow[]).map(revToRecord)
  }

  operationsFor(filter?: { kind?: OperationKind; session_id?: string; limit?: number }): OperationRecord[] {
    const limit = Math.min(Math.max(filter?.limit ?? 100, 1), 1000)
    const rows = filter?.kind && filter?.session_id
      ? this.db.prepare('SELECT * FROM ledgerdb.operations WHERE operation_kind = ? AND session_id = ? ORDER BY seq ASC LIMIT ?').all(filter.kind, filter.session_id, limit)
      : filter?.kind
        ? this.db.prepare('SELECT * FROM ledgerdb.operations WHERE operation_kind = ? ORDER BY seq ASC LIMIT ?').all(filter.kind, limit)
        : filter?.session_id
          ? this.db.prepare('SELECT * FROM ledgerdb.operations WHERE session_id = ? ORDER BY seq ASC LIMIT ?').all(filter.session_id, limit)
          : this.db.prepare('SELECT * FROM ledgerdb.operations ORDER BY seq ASC LIMIT ?').all(limit)
    return (rows as unknown as OpRow[]).map(opToRecord)
  }

  linksOf(revisionId: string): RevisionLinkRow[] {
    return this.db.prepare('SELECT * FROM ledgerdb.revision_links WHERE revision_id = ?').all(revisionId) as unknown as RevisionLinkRow[]
  }

  /** 依赖此节点任一修订的修订 id（redaction 失效关联用）。 */
  dependentsOf(nodeId: string): Array<{ revision_id: string; referenced_revision_id: string }> {
    return this.db.prepare('SELECT revision_id, referenced_revision_id FROM ledgerdb.revision_links WHERE referenced_node_id = ?').all(nodeId) as unknown as Array<{ revision_id: string; referenced_revision_id: string }>
  }

  /**
   * 提交一个不可变修订并推进 head。
   * CAS：expectedRevision 与当前 head 不符 → RevisionConflictError（显式重读，不自动 LWW）。
   * based_on 依赖在此（写事务内）解析并精确固定为被引用节点的当前 head 修订；
   * pin=false（基线快照）不固定引用——首迁没有更早的可固定对象。
   */
  commitRevision(opId: string, snapshot: RevisionSnapshot, opts?: {
    expectedRevision?: string
    origin?: RevisionRecord['origin']
    pin?: boolean
  }): { revision_id: string; references: Array<{ node_id: string; revision_id: string }> } {
    const parent = this.headRevision(snapshot.node_id)
    if (opts?.expectedRevision !== undefined && opts.expectedRevision !== parent) {
      throw new RevisionConflictError(
        `节点 ${snapshot.node_id} 修订 CAS 失败：期望 ${opts.expectedRevision}，当前 head ${parent ?? '无'}；请重读后重试`,
      )
    }
    const revisionId = randomUUID()
    const now = Date.now()
    this.db.prepare(
      `INSERT INTO ledgerdb.node_revisions (revision_id, node_id, parent_revision_id, op_id, origin, kind, text, payload_json, based_on_json, status, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(revisionId, snapshot.node_id, parent, opId, opts?.origin ?? 'live', snapshot.kind,
      snapshot.text, JSON.stringify(snapshot.payload), JSON.stringify(snapshot.based_on),
      snapshot.status, snapshot.actor, now)
    this.db.prepare(
      'INSERT INTO ledgerdb.node_heads (node_id, revision_id) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET revision_id = excluded.revision_id',
    ).run(snapshot.node_id, revisionId)
    const references: Array<{ node_id: string; revision_id: string }> = []
    if (opts?.pin !== false) {
      for (const refId of snapshot.based_on) {
        const pinned = this.headRevision(refId)
        if (pinned === null) {
          throw new WorkspaceError(`修订依赖 ${refId} 在写事务内不可解析；拒绝提交悬空引用`)
        }
        this.db.prepare(
          `INSERT INTO ledgerdb.revision_links (revision_id, referenced_node_id, referenced_revision_id, relation)
           VALUES (?, ?, ?, 'supports') ON CONFLICT(revision_id, referenced_node_id, relation) DO NOTHING`,
        ).run(revisionId, refId, pinned)
        references.push({ node_id: refId, revision_id: pinned })
      }
    }
    return { revision_id: revisionId, references }
  }

  /** 确保节点存在基线修订：无 head 时以当前快照建 origin=legacy_baseline 首修订（不固定引用）。
   *  供依赖固定与显式迁移使用；不补造更早历史。 */
  ensureBaseline(opId: string, snapshot: RevisionSnapshot): string {
    const head = this.headRevision(snapshot.node_id)
    if (head !== null) return head
    return this.commitRevision(opId, snapshot, { origin: 'legacy_baseline', pin: false }).revision_id
  }

  /** redaction 后追加"依赖已失效"标记修订（不让依赖方静默保持有效）。 */
  markRedactedDependency(nodeId: string, opId: string, actor: string, removed: string[]): void {
    const head = this.headRevision(nodeId)
    if (head === null) return
    const current = this.revision(head)
    if (!current) return
    const revisionId = randomUUID()
    const payload = { ...current.payload, needs_review: { reason: 'evidence_redacted', at: Date.now(), removed } }
    this.db.prepare(
      `INSERT INTO ledgerdb.node_revisions (revision_id, node_id, parent_revision_id, op_id, origin, kind, text, payload_json, based_on_json, status, actor, created_at)
       VALUES (?, ?, ?, ?, 'redaction', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(revisionId, nodeId, head, opId, current.kind, current.text, JSON.stringify(payload),
      JSON.stringify(current.based_on), current.status, actor, Date.now())
    this.db.prepare(
      'INSERT INTO ledgerdb.node_heads (node_id, revision_id) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET revision_id = excluded.revision_id',
    ).run(nodeId, revisionId)
  }

  /** 敏感删除：物理移除目标修订及指向它的链接，并给依赖方标记 needs_review。
   *  "不可变"是追加纪律，不是拒绝用户删除的借口。必须在写事务内调用。 */
  redact(target: { node_id: string; revision_id?: string }, opId: string, actor: string): { removed_revisions: string[]; marked_dependents: string[] } {
    const rows: RevRow[] = target.revision_id
      ? [this.db.prepare('SELECT * FROM ledgerdb.node_revisions WHERE revision_id = ? AND node_id = ?').get(target.revision_id, target.node_id) as unknown as RevRow]
      : this.db.prepare('SELECT * FROM ledgerdb.node_revisions WHERE node_id = ?').all(target.node_id) as unknown as RevRow[]
    const removal = rows.filter(Boolean).map(r => r.revision_id)
    if (removal.length === 0) throw new WorkspaceError(`redact 目标不存在: ${target.node_id}${target.revision_id ? '/' + target.revision_id : ''}`)
    const dependents = new Map<string, string[]>()
    for (const rid of removal) {
      // 依赖方 = 引用了被删修订的修订所属节点（revision_id → 其 node_id，非 referenced_* 列）。
      for (const link of this.db.prepare('SELECT node_id FROM ledgerdb.node_revisions WHERE revision_id IN (SELECT revision_id FROM ledgerdb.revision_links WHERE referenced_revision_id = ?)').all(rid) as unknown as Array<{ node_id: string }>) {
        const list = dependents.get(link.node_id) ?? []
        list.push(rid)
        dependents.set(link.node_id, list)
      }
    }
    // 受影响操作的摘要可能内嵌被删正文：一并脱敏（隐私优先于摘要完整性；
    // 摘要被改写后，同坐标重放原事件将因摘要不匹配被拒绝——被脱敏事件不再接受重放）。
    const scrubbed = new Set<string>()
    for (const rid of removal) {
      for (const row of this.db.prepare('SELECT op_id FROM ledgerdb.node_revisions WHERE revision_id = ?').all(rid) as unknown as Array<{ op_id: string }>) {
        scrubbed.add(row.op_id)
      }
    }
    const ph = removal.map(() => '?').join(',')
    this.db.prepare(`DELETE FROM ledgerdb.revision_links WHERE revision_id IN (${ph})`).run(...removal)
    this.db.prepare(`DELETE FROM ledgerdb.revision_links WHERE referenced_revision_id IN (${ph})`).run(...removal)
    this.db.prepare(`DELETE FROM ledgerdb.node_heads WHERE revision_id IN (${ph})`).run(...removal)
    // 先解除父链引用：被删修订的子修订 parent 置 NULL（历史断点显式可见，不伪造）。
    this.db.prepare(`UPDATE ledgerdb.node_revisions SET parent_revision_id = NULL WHERE parent_revision_id IN (${ph})`).run(...removal)
    this.db.prepare(`DELETE FROM ledgerdb.node_revisions WHERE revision_id IN (${ph})`).run(...removal)
    for (const opId of scrubbed) {
      const placeholder = '[redacted]'
      this.db.prepare('UPDATE ledgerdb.operations SET summary = ?, summary_digest = ? WHERE op_id = ?')
        .run(placeholder, digestOf({ kind: 'redacted', summary: placeholder }), opId)
    }
    const marked: string[] = []
    for (const [nodeId, removedList] of dependents) {
      if (nodeId === target.node_id) continue
      if (!this.headRevision(nodeId)) continue
      this.markRedactedDependency(nodeId, opId, actor, removedList)
      marked.push(nodeId)
    }
    return { removed_revisions: removal, marked_dependents: marked }
  }
}

/** sidecar 全量导出（schema 2；M2 起有证据数据时导 schema 3 包）。 */
export interface LedgerPackage {
  schema_version: 2 | 3
  workspace_instance_id: string
  exported_at: number
  operations: OperationRecord[]
  revisions: RevisionRecord[]
  heads: Array<{ node_id: string; revision_id: string }>
  links: RevisionLinkRow[]
  /** M2 证据（仅 schema 3 包；v2 包无此字段）。 */
  evidence?: {
    code_states: import('./evidence.js').CodeStateRecord[]
    source_refs: import('./evidence.js').SourceRefExport[]
    validations: Array<Record<string, unknown>>
  }
}

/** v2/v3 全量记忆包：v1 记忆包字段 + 完整账本；v3 = v2 + 证据绑定。 */
export interface FullMemoryPackage extends Omit<import('./types.js').MemoryPackage, 'schema_version'> {
  schema_version: 2 | 3
  ledger: LedgerPackage
}

export function exportLedger(db: DatabaseSync, workspaceInstanceId: string): LedgerPackage {
  const operations = (db.prepare('SELECT * FROM ledgerdb.operations ORDER BY seq ASC').all() as unknown as OpRow[]).map(opToRecord)
  const revisions = (db.prepare('SELECT * FROM ledgerdb.node_revisions ORDER BY created_at ASC, revision_id ASC').all() as unknown as RevRow[]).map(revToRecord)
  const heads = db.prepare('SELECT node_id, revision_id FROM ledgerdb.node_heads').all() as unknown as Array<{ node_id: string; revision_id: string }>
  const links = db.prepare('SELECT revision_id, referenced_node_id, referenced_revision_id, relation FROM ledgerdb.revision_links').all() as unknown as RevisionLinkRow[]
  return { schema_version: 2, workspace_instance_id: workspaceInstanceId, exported_at: Date.now(), operations, revisions, heads, links }
}

/**
 * 导入 schema2 账本行到目标 sidecar：先整体校验闭包（引用均可解析）再写入。
 * 不自管事务——调用方（store.importFullPkg）必须在同一写事务内同时导入
 * memory 部分，保证业务行与账本原子发布；目标已有账本内容则拒绝（不覆盖）。
 */
export function importLedgerRows(db: DatabaseSync, pkg: LedgerPackage): void {
  if (pkg.schema_version !== 2 && pkg.schema_version !== 3) throw new WorkspaceError(`不支持的账本 schema_version: ${String(pkg.schema_version)}`)
  const knownRevisions = new Set(pkg.revisions.map(r => r.revision_id))
  const knownOps = new Set(pkg.operations.map(o => o.op_id))
  if (pkg.revisions.some(r => r.parent_revision_id && !knownRevisions.has(r.parent_revision_id))) {
    throw new WorkspaceError('账本导入校验失败：存在不可解析的父修订引用')
  }
  if (pkg.revisions.some(r => !knownOps.has(r.op_id))) {
    throw new WorkspaceError('账本导入校验失败：存在不可解析的操作引用')
  }
  if (pkg.links.some(l => !knownRevisions.has(l.revision_id) || !knownRevisions.has(l.referenced_revision_id))) {
    throw new WorkspaceError('账本导入校验失败：存在悬空修订链接')
  }
  if (pkg.heads.some(h => !knownRevisions.has(h.revision_id))) {
    throw new WorkspaceError('账本导入校验失败：head 指向未知修订')
  }
  const existing = db.prepare('SELECT COUNT(*) AS c FROM ledgerdb.operations').get() as { c: number }
  if (existing.c > 0) throw new WorkspaceError('导入目标账本已有操作，拒绝覆盖导入')
  // 父修订先于子修订插入（同毫秒创建时 created_at 无法定序，FK 需要拓扑序）。
  const byParent = new Map<string, RevisionRecord[]>()
  for (const r of pkg.revisions) {
    const key = r.parent_revision_id ?? ''
    byParent.set(key, [...(byParent.get(key) ?? []), r])
  }
  const ordered: RevisionRecord[] = []
  const emitted = new Set<string>()
  const queueRoots = () => {
    for (const r of byParent.get('') ?? []) {
      ordered.push(r); emitted.add(r.revision_id)
    }
  }
  queueRoots()
  let progress = true
  while (ordered.length < pkg.revisions.length && progress) {
    progress = false
    for (const [parent, group] of byParent) {
      if (parent === '' || !emitted.has(parent)) continue
      for (const r of group) {
        if (emitted.has(r.revision_id)) continue
        ordered.push(r); emitted.add(r.revision_id); progress = true
      }
    }
  }
  if (ordered.length !== pkg.revisions.length) {
    throw new WorkspaceError('账本导入校验失败：修订父链存在环或不可解析引用')
  }
  const maxSeq = pkg.operations.reduce((m, o) => Math.max(m, o.seq), 0)
  db.prepare("INSERT INTO ledgerdb.ledger_meta (k, v) VALUES ('op_seq', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(String(maxSeq))
  const insOp = db.prepare(
    `INSERT INTO ledgerdb.operations (op_id, workspace_instance_id, seq, actor, operation_kind, session_id, call_id, root_call_id,
       durable_event_seq, summary, summary_digest, occurred_at, committed_at, capture_policy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const o of pkg.operations) {
    insOp.run(o.op_id, o.workspace_instance_id, o.seq, o.actor, o.operation_kind, o.session_id,
      o.call_id, o.root_call_id, o.durable_event_seq, o.summary, o.summary_digest, o.occurred_at, o.committed_at, o.capture_policy)
  }
  const insRev = db.prepare(
    `INSERT INTO ledgerdb.node_revisions (revision_id, node_id, parent_revision_id, op_id, origin, kind, text, payload_json, based_on_json, status, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const r of ordered) {
    insRev.run(r.revision_id, r.node_id, r.parent_revision_id, r.op_id, r.origin, r.kind, r.text,
      JSON.stringify(r.payload), JSON.stringify(r.based_on), r.status, r.actor, r.created_at)
  }
  const insHead = db.prepare('INSERT INTO ledgerdb.node_heads (node_id, revision_id) VALUES (?, ?)')
  for (const h of pkg.heads) insHead.run(h.node_id, h.revision_id)
  const insLink = db.prepare('INSERT INTO ledgerdb.revision_links (revision_id, referenced_node_id, referenced_revision_id, relation) VALUES (?, ?, ?, ?)')
  for (const l of pkg.links) insLink.run(l.revision_id, l.referenced_node_id, l.referenced_revision_id, l.relation)
}

/** 迁移前备份（memory.db + WAL/SHM 快照拷贝）；返回备份路径。 */
export function backupWorkspace(wsDir: string): string {
  const root = resolve(wsDir)
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
  const target = resolve(root, `backup-${stamp}`)
  mkdirSync(target, { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    const src = resolve(root, `memory.db${suffix}`)
    if (existsSync(src) && statSync(src).isFile()) copyFileSync(src, resolve(target, `memory.db${suffix}`))
  }
  return target
}

/** 原子发布：把 from rename 为 to（同目录），失败保留原文件。 */
export function atomicPublish(from: string, to: string): void {
  if (!existsSync(from)) throw new WorkspaceError(`原子发布源不存在: ${from}`)
  if (existsSync(to)) throw new WorkspaceError(`原子发布目标已存在: ${to}`)
  renameSync(from, to)
}

/** 删除备份目录（测试清理用）。 */
export function removeBackup(path: string): void {
  rmSync(path, { recursive: true, force: true })
}
