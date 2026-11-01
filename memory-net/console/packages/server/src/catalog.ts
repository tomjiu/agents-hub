/**
 * workspace 目录与只读探查层。
 *
 * 发现：扫 CONSOLE_HOME 根下每个含 memory.db 的一级子目录；
 * workspace_id 读 meta 表（缺省回退目录名）。
 * 重复 id 治理（P3-1）：两目录 meta 同 workspace_id（复制库）时，
 * 首个保留规范 id，其后以目录名强制区分 —— 绝不静默串统计。
 *
 * 只读纪律：连接级强制 —— 优先 readOnly 打开，WAL 只读受限时回退
 * 读写打开 + PRAGMA query_only=ON（任何写语句报错）。控制台 v1 不提供
 * 任何直接 SQL 写路径；受控写面（progress/trail）只经核心库 host 身份。
 *
 * 防注入：URL 中的 workspace id 一律先经 list 结果白名单映射回目录，
 * 绝不直接拼接路径。
 *
 * 性能（P3-2）：meta 读取按 memory.db mtime+size 签名缓存 —— 外部无变化时
 * 重复请求零开库；stats 单连接完成（旧实现 withDb→summarize→withDb 双开）。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'
import type { MemoryNode, NodeKind, NodeStatus, ObservationSource } from 'memory-net/dist/src/types.js'

/** workspace 不存在（URL id 白名单外）：HTTP 404（P3-3，不再 500 泛滥）。 */
export class WorkspaceNotFoundError extends Error {}

/** workspace 库损坏/不可读：HTTP 503 WORKSPACE_UNREADABLE（与 list 的 unreadable 标记同语义，P3-4）。 */
export class WorkspaceUnreadableError extends Error {}

export interface WorkspaceSummary {
  id: string
  dir_name: string
  nodes_total: number
  trail_steps: number
  trail_runs: number
  last_activity: number | null
  by_kind: Record<string, number>
  /** 库不可读（损坏/非库文件）时置 true，统计为零（P3-4：list 与 stats/nodes 语义一致） */
  unreadable?: boolean
}

export interface WsStats extends WorkspaceSummary {
  by_status: Record<string, number>
  by_agent: Record<string, number>
}

export interface NodeQuery {
  kind?: NodeKind
  status?: NodeStatus
  agent?: string
  q?: string
  limit: number
  offset: number
}

export interface NodePage {
  total: number
  offset: number
  limit: number
  nodes: MemoryNode[]
}

interface Rowish {
  [k: string]: unknown
}

const NODE_COLS =
  'id, seq, kind, agent_id, run_id, task_id, key, text, payload_json, source, confidence, status, conflict, conflict_json, based_on_json, created_at, updated_at'

function rowToNode(r: Rowish): MemoryNode {
  let payload: Record<string, unknown> = {}
  try {
    payload = JSON.parse(String(r.payload_json ?? '{}')) as Record<string, unknown>
  } catch {
    payload = {}
  }
  let basedOn: string[] = []
  try {
    const parsed = JSON.parse(String(r.based_on_json ?? '[]')) as unknown
    if (Array.isArray(parsed)) basedOn = parsed.map(String)
  } catch {
    basedOn = []
  }
  let conflictDetail: Record<string, [unknown, unknown]> | null = null
  if (r.conflict_json) {
    try {
      conflictDetail = JSON.parse(String(r.conflict_json)) as Record<string, [unknown, unknown]>
    } catch {
      conflictDetail = null
    }
  }
  return {
    id: String(r.id),
    kind: r.kind as NodeKind,
    agent_id: String(r.agent_id),
    run_id: (r.run_id as string | null) ?? null,
    task_id: (r.task_id as string | null) ?? null,
    key: (r.key as string | null) ?? null,
    text: String(r.text ?? ''),
    payload,
    source: (r.source as ObservationSource | null) ?? null,
    confidence: (r.confidence as number | null) ?? null,
    status: r.status as NodeStatus,
    conflict: Number(r.conflict) === 1,
    conflict_detail: conflictDetail,
    based_on: basedOn,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
  }
}

function trailRow(r: Rowish): {
  run_id: string
  seq: number
  agent_id: string
  action: string
  refs: string[]
  ts: number
  compressed: boolean
} {
  let refs: string[] = []
  try {
    const parsed = JSON.parse(String(r.refs_json ?? '[]')) as unknown
    if (Array.isArray(parsed)) refs = parsed.map(String)
  } catch {
    refs = []
  }
  return {
    run_id: String(r.run_id),
    seq: Number(r.seq),
    agent_id: String(r.agent_id),
    action: String(r.action ?? ''),
    refs,
    ts: Number(r.ts),
    compressed: Number(r.compressed) === 1,
  }
}

/** 打开只读连接：WAL 只读受限（无并发写者时 -shm 可能缺失）则回退 query_only。 */
function openReadonly(dbPath: string): DatabaseSync {
  try {
    return new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    const db = new DatabaseSync(dbPath)
    db.exec('PRAGMA query_only = ON;')
    return db
  }
}

function countMap(rows: Rowish[], key: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    const k = r[key]
    out[String(k ?? 'null')] = Number(r.n ?? 0)
  }
  return out
}

interface DirEntry {
  dirName: string
  /** meta 原始 workspace_id（目录名兜底）——语义面打开核心库仍以此为准 */
  workspaceId: string
  /** 寻址 id：首个条目 = workspaceId；重复 id 的后续条目 = 目录名（P3-1） */
  id: string
  dbPath: string
}

interface MetaCacheEntry {
  workspaceId: string
  sig: string
}

export class Catalog {
  readonly root: string
  /** meta 签名缓存：dirName → { workspaceId, sig }。外部直写变签名即失效（P3-2）。 */
  private metaCache = new Map<string, MetaCacheEntry>()

  constructor(root: string) {
    this.root = resolve(root)
  }

  /** db 文件签名：mtimeMs+size。WAL 未 checkpoint 时主库 mtime/size 也随 meta 写变化（meta 表在主库页内）。 */
  private dbSig(dbPath: string): string {
    try {
      const st = statSync(dbPath)
      return `${st.mtimeMs}:${st.size}`
    } catch {
      return 'missing'
    }
  }

  /** 读单目录 meta workspace_id（缺省回退目录名）；连不上/读不出一律回退目录名。 */
  private readWorkspaceId(dirName: string, dbPath: string): string {
    const sig = this.dbSig(dbPath)
    const hit = this.metaCache.get(dirName)
    if (hit && hit.sig === sig) return hit.workspaceId
    let wsId = dirName
    try {
      const db = openReadonly(dbPath)
      try {
        const row = db.prepare('SELECT v FROM meta WHERE k = ?').get('workspace_id') as
          | { v: string }
          | undefined
        if (row && row.v) wsId = row.v
      } finally {
        db.close()
      }
    } catch {
      // meta 不可读时以目录名为 id，后续查询失败按缺库处理
    }
    this.metaCache.set(dirName, { workspaceId: wsId, sig })
    return wsId
  }

  /** 扫根下含 memory.db 的一级子目录 → 条目（含重复 id 的目录名强制区分，P3-1）。 */
  private discover(): DirEntry[] {
    if (!existsSync(this.root) || !statSync(this.root).isDirectory()) return []
    const raw: Array<{ dirName: string; dbPath: string }> = []
    for (const name of readdirSync(this.root)) {
      const dir = join(this.root, name)
      try {
        if (!statSync(dir).isDirectory()) continue
      } catch {
        continue
      }
      const dbPath = join(dir, 'memory.db')
      if (!existsSync(dbPath) || !statSync(dbPath).isFile()) continue
      raw.push({ dirName: name, dbPath })
    }
    // 重复 workspace_id 检测：首个占规范 id，其后用目录名寻址（不静默串数据）
    const seen = new Set<string>()
    const out: DirEntry[] = []
    for (const { dirName, dbPath } of raw) {
      const wsId = this.readWorkspaceId(dirName, dbPath)
      let id = wsId
      if (seen.has(wsId)) {
        id = dirName
        console.warn(
          `[console] 重复 workspace_id "${wsId}"（目录 ${dirName}）——该条目以目录名 "${dirName}" 寻址，防串读（P3-1）`,
        )
      }
      seen.add(wsId)
      out.push({ dirName, workspaceId: wsId, id, dbPath })
    }
    return out
  }

  /** 按 id 或目录名解析条目（白名单映射；未知 id 返回 null，绝不拼路径）。 */
  private findEntry(id: string): DirEntry | null {
    for (const e of this.discover()) {
      if (e.id === id || e.dirName === id) return e
    }
    return null
  }

  /** id → 目录名（白名单映射；未知 id 返回 null）。 */
  resolveDir(id: string): string | null {
    return this.findEntry(id)?.dirName ?? null
  }

  /** 扫描面：SSE 变更检测用（调用方对 dbPath 做 mtime/size 签名，零开库开销）。 */
  scanEntries(): Array<{ id: string; dbPath: string }> {
    return this.discover().map((e) => ({ id: e.id, dbPath: e.dbPath }))
  }

  /**
   * 解析为目录 + 规范 workspace_id（meta 为准，目录名兜底）。
   * 语义面（MemoryNet.open 的 workspaceId 校验）必须传规范 id——URL 里的别名 id
   * （目录名 ≠ meta workspace_id 的改名/复制场景）在读面可用、语义面会抛 WorkspaceError。
   */
  resolveEntry(id: string): { dir: string; canonicalId: string } | null {
    const e = this.findEntry(id)
    if (!e) return null
    return { dir: join(this.root, e.dirName), canonicalId: e.workspaceId }
  }

  /**
   * 单连接执行只读查询（P3-2/3：解析、开库一次到位；找不到 404 语义、开不了 503 语义）。
   * 连接由本方法开、用完即关。
   */
  private withEntry<T>(id: string, fn: (db: DatabaseSync, entry: DirEntry) => T): T {
    const entry = this.findEntry(id)
    if (!entry) throw new WorkspaceNotFoundError(`workspace 不存在: ${id}`)
    let db: DatabaseSync
    try {
      db = openReadonly(entry.dbPath)
    } catch (e) {
      throw new WorkspaceUnreadableError(
        `workspace 库不可读: ${entry.dirName}（${(e as Error).message}）`,
      )
    }
    try {
      return fn(db, entry)
    } catch (e) {
      // 打开成功但查询撞坏页：与「打不开」同语义，503 一致面（P3-4）。
      // node:sqlite 的 SQLite 层错误形态 = 普通 Error + code 'ERR_SQLITE_ERROR'（name 不叫 SqliteError）
      const err = e as Error & { code?: string }
      if (err.name === 'SqliteError' || err.code === 'ERR_SQLITE_ERROR') {
        throw new WorkspaceUnreadableError(`workspace 库查询失败: ${entry.dirName}（${err.message}）`)
      }
      throw e
    } finally {
      db.close()
    }
  }

  list(): WorkspaceSummary[] {
    const out: WorkspaceSummary[] = []
    for (const e of this.discover()) {
      try {
        const db = openReadonly(e.dbPath)
        try {
          out.push(summarizeDb(db, e.id, e.dirName))
        } finally {
          db.close()
        }
      } catch {
        // P3-4：损坏库在 list 面显式标 unreadable（不再静默计零冒充健康）
        out.push({
          id: e.id,
          dir_name: e.dirName,
          nodes_total: 0,
          trail_steps: 0,
          trail_runs: 0,
          last_activity: null,
          by_kind: {},
          unreadable: true,
        })
      }
    }
    return out
  }

  /** stats：与 nodes 同一连接完成（旧实现 withDb→summarize→withDb 双开 + resolveDir race 500，P3-2/3）。 */
  stats(id: string): WsStats {
    return this.withEntry(id, (db, entry) => {
      const base = summarizeDb(db, entry.id, entry.dirName)
      const statusRows = db
        .prepare('SELECT status, COUNT(*) AS n FROM nodes GROUP BY status')
        .all() as unknown as Rowish[]
      const agentRows = db
        .prepare('SELECT agent_id, COUNT(*) AS n FROM nodes GROUP BY agent_id')
        .all() as unknown as Rowish[]
      return { ...base, by_status: countMap(statusRows, 'status'), by_agent: countMap(agentRows, 'agent_id') }
    })
  }

  nodes(id: string, q: NodeQuery): NodePage {
    return this.withEntry(id, (db) => {
      const where: string[] = []
      const params: Array<string | number> = []
      if (q.kind) {
        where.push('kind = ?')
        params.push(q.kind)
      }
      if (q.status) {
        where.push('status = ?')
        params.push(q.status)
      }
      if (q.agent) {
        where.push('agent_id = ?')
        params.push(q.agent)
      }
      if (q.q) {
        where.push('(text LIKE ? OR key LIKE ? OR agent_id LIKE ? OR task_id LIKE ?)')
        const like = `%${q.q}%`
        params.push(like, like, like, like)
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM nodes ${whereSql}`).get(...params) as Rowish
      const lim = Math.min(Math.max(q.limit, 1), 500)
      const rows = db
        .prepare(
          `SELECT ${NODE_COLS} FROM nodes ${whereSql} ORDER BY updated_at DESC, seq DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, lim, Math.max(q.offset, 0)) as unknown as Rowish[]
      return {
        total: Number(totalRow.n ?? 0),
        offset: Math.max(q.offset, 0),
        limit: lim,
        nodes: rows.map(rowToNode),
      }
    })
  }

  node(id: string, nid: string): MemoryNode | null {
    return this.withEntry(id, (db) => {
      const row = db.prepare(`SELECT ${NODE_COLS} FROM nodes WHERE id = ?`).get(nid) as
        | Rowish
        | undefined
      return row ? rowToNode(row) : null
    })
  }

  trail(id: string, runId?: string, limit = 200): Array<ReturnType<typeof trailRow>> {
    return this.withEntry(id, (db) => {
      const lim = Math.min(Math.max(limit, 1), 1000)
      if (runId) {
        const rows = db
          .prepare('SELECT run_id, seq, agent_id, action, refs_json, ts, compressed FROM trail WHERE run_id = ? ORDER BY seq ASC LIMIT ?')
          .all(runId, lim) as unknown as Rowish[]
        return rows.map(trailRow)
      }
      const rows = db
        .prepare('SELECT run_id, seq, agent_id, action, refs_json, ts, compressed FROM trail ORDER BY ts DESC, run_id ASC, seq ASC LIMIT ?')
        .all(lim) as unknown as Rowish[]
      return rows.map(trailRow)
    })
  }

  /** trail run 摘要：每 run 首末时间/步数/参与者。 */
  trailRuns(id: string, limit = 50): Array<{
    run_id: string
    steps: number
    agents: string[]
    first_ts: number
    last_ts: number
  }> {
    return this.withEntry(id, (db) => {
      // P3-5：agent 聚合不用 GROUP_CONCAT——DISTINCT 聚合禁止自定义分隔符（SQLite 限制），
      // 且逗号分隔可被 agent_id 内的逗号击穿；改两条查询 + JS 聚合，任意字符免疫
      const runs = db
        .prepare(
          'SELECT run_id, COUNT(*) AS steps, MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM trail GROUP BY run_id ORDER BY last_ts DESC LIMIT ?',
        )
        .all(Math.min(Math.max(limit, 1), 200)) as unknown as Rowish[]
      if (runs.length === 0) return []
      const ids = runs.map((r) => String(r.run_id))
      const placeholders = ids.map(() => '?').join(',')
      const agentRows = db
        .prepare(`SELECT DISTINCT run_id, agent_id FROM trail WHERE run_id IN (${placeholders}) ORDER BY agent_id ASC`)
        .all(...ids) as unknown as Rowish[]
      const agentMap = new Map<string, string[]>()
      for (const r of agentRows) {
        const rid = String(r.run_id)
        const list = agentMap.get(rid) ?? []
        list.push(String(r.agent_id))
        agentMap.set(rid, list)
      }
      return runs.map((r) => ({
        run_id: String(r.run_id),
        steps: Number(r.steps ?? 0),
        agents: agentMap.get(String(r.run_id)) ?? [],
        first_ts: Number(r.first_ts ?? 0),
        last_ts: Number(r.last_ts ?? 0),
      }))
    })
  }
}

/** 单连接上的统计查询（list/stats 共用；P3-2：不再二次开库）。 */
function summarizeDb(db: DatabaseSync, id: string, dirName: string): WorkspaceSummary {
  const kindRows = db
    .prepare('SELECT kind, COUNT(*) AS n FROM nodes GROUP BY kind')
    .all() as unknown as Rowish[]
  const total = db.prepare('SELECT COUNT(*) AS n FROM nodes').get() as Rowish
  const steps = db.prepare('SELECT COUNT(*) AS n FROM trail').get() as Rowish
  const runs = db.prepare('SELECT COUNT(DISTINCT run_id) AS n FROM trail').get() as Rowish
  const lastN = db.prepare('SELECT MAX(updated_at) AS n FROM nodes').get() as Rowish
  const lastT = db.prepare('SELECT MAX(ts) AS n FROM trail').get() as Rowish
  const lastA = Math.max(Number(lastN.n ?? 0), Number(lastT.n ?? 0))
  return {
    id,
    dir_name: dirName,
    nodes_total: Number(total.n ?? 0),
    trail_steps: Number(steps.n ?? 0),
    trail_runs: Number(runs.n ?? 0),
    last_activity: lastA > 0 ? lastA : null,
    by_kind: countMap(kindRows, 'kind'),
  }
}
