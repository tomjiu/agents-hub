/**
 * SQLite 存储层（node:sqlite 写死，零 npm 运行时依赖）。
 *
 * 隔离模型：一个 workspace = 一个 <dir>/memory.db 文件 —— 物理隔离，
 * 随 workspace 打开/关闭挂载/卸载，关闭即不串读。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, statSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { WorkspaceError } from './errors.js'

export const SCHEMA_VERSION = 1

const DDL = `
CREATE TABLE IF NOT EXISTS nodes (
  id             TEXT PRIMARY KEY,
  seq            INTEGER NOT NULL UNIQUE,
  kind           TEXT NOT NULL CHECK(kind IN ('constraint','observation','inference','progress','tip')),
  agent_id       TEXT NOT NULL,
  run_id         TEXT,
  task_id        TEXT,
  key            TEXT,
  text           TEXT NOT NULL DEFAULT '',
  payload_json   TEXT NOT NULL DEFAULT '{}',
  source         TEXT,
  confidence     REAL,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK(status IN ('active','contradicted','promoted','demoted','superseded')),
  conflict       INTEGER NOT NULL DEFAULT 0,
  conflict_json  TEXT,
  based_on_json  TEXT NOT NULL DEFAULT '[]',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind, status);
CREATE INDEX IF NOT EXISTS idx_nodes_key  ON nodes(key) WHERE key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nodes_task ON nodes(task_id) WHERE task_id IS NOT NULL;
-- 控制台/CLI 读面默认序：ORDER BY updated_at DESC, seq DESC 反向扫此索引，
-- 大库下排序成本不再随每次请求重复付（console P3-5 上游修复）
CREATE INDEX IF NOT EXISTS idx_nodes_updated ON nodes(updated_at, seq);

CREATE TABLE IF NOT EXISTS trail (
  run_id    TEXT NOT NULL,
  seq       INTEGER NOT NULL,
  agent_id  TEXT NOT NULL,
  action    TEXT NOT NULL,
  refs_json TEXT NOT NULL DEFAULT '[]',
  ts        INTEGER NOT NULL,
  compressed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`

export interface OpenedDb {
  db: DatabaseSync
  workspaceId: string
  isNew: boolean
}

/** 打开（或创建）workspace 数据库。dir 即 workspace 根。 */
export function openWorkspaceDb(dir: string, opts?: { workspaceId?: string }): OpenedDb {
  const root = resolve(dir)
  mkdirSync(root, { recursive: true })
  const dbPath = resolve(root, 'memory.db')
  let isNew = false
  try {
    isNew = !statSync(dbPath).isFile()
  } catch {
    isNew = true
  }
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath)
  } catch (e) {
    throw new WorkspaceError(`无法打开 workspace 数据库 ${dbPath}: ${(e as Error).message}`)
  }
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA busy_timeout = 5000;') // 多实例（多 agent）并发写同一 workspace 时等锁而非抛 BUSY
  db.exec(DDL)
  // progress 单行不变量的库级兜底：唯一索引防跨进程并发首写双行（store 层撞索引
  // 时回落更新路径并标 conflict）。单独 exec 并吞错：极老库若已存在重复 progress
  // 行，建索引会失败——告警但照常打开，不阻断宿主 boot。
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_nodes_progress_task
             ON nodes(task_id) WHERE kind = 'progress' AND task_id IS NOT NULL;`)
  } catch (e) {
    console.warn(`[memory-net] progress 唯一索引创建失败（库内或有重复行）: ${(e as Error).message}`)
  }
  const existing = metaGet(db, 'workspace_id')
  let workspaceId: string
  if (existing) {
    if (opts?.workspaceId && opts.workspaceId !== existing) {
      throw new WorkspaceError(
        `workspace_id 不匹配：库中为 ${existing}，请求为 ${opts.workspaceId}（防止串读到错误工作区）`,
      )
    }
    workspaceId = existing
  } else {
    workspaceId = opts?.workspaceId ?? basename(root)
    metaSet(db, 'workspace_id', workspaceId)
  }
  metaSet(db, 'schema_version', String(SCHEMA_VERSION))
  return { db, workspaceId, isNew }
}

export function metaGet(db: DatabaseSync, k: string): string | null {
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined
  return row ? row.v : null
}

export function metaSet(db: DatabaseSync, k: string, v: string): void {
  db.prepare(
    'INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
  ).run(k, v)
}
