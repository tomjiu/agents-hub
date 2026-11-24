/**
 * memory-net — 共享记忆网数据模型（v1）。
 *
 * 六类节点中 trail 是独立有序表（可回放），其余五类为 nodes 表行。
 * 作用域四元组：workspace_id（= 独立 .db 文件，物理隔离）/ run_id / task_id / agent_id。
 */

/** 节点类型最小集。 */
export type NodeKind =
  | 'constraint'   // forbid/require，置顶，永不因预算裁光
  | 'observation'  // 物理观测：source=tool|user|config|system；同 key 可覆盖
  | 'inference'    // 模型推断：confidence + based_on；可被 contradicted；禁止自动 promote
  | 'progress'     // 任务进度：同 task_id 单行共享，多 Agent 协作核心
  | 'tip'          // 可选策略/恢复建议

/** trail 独立存储，不占节点类型。 */

export type NodeStatus =
  | 'active'
  | 'contradicted' // 被同 key 新观测或显式 contradict 推翻
  | 'promoted'     // inference 经显式 promote（需 evidence 或宿主）
  | 'demoted'      // 显式降级 / gc TTL 降级，不参与激活
  | 'superseded'   // observation 被同 key 新观测覆盖

/** 写纪律角色（v1 写死三种）。 */
export type Role = 'model' | 'tool' | 'host'

/** observation 来源。 */
export type ObservationSource = 'tool' | 'user' | 'config' | 'system'

/** constraint 的两种模式。 */
export type ConstraintMode = 'forbid' | 'require'

/** nodes 表行（trail 除外）。 */
export interface MemoryNode {
  id: string
  kind: NodeKind
  /** 写入者（open 时绑定实例，不可冒名）。 */
  agent_id: string
  run_id: string | null
  task_id: string | null
  /** observation 覆盖键 / constraint 名。 */
  key: string | null
  text: string
  /** 结构化附加字段（observation.path / exit_code，constraint.mode，tip.strategy / recovery…）。 */
  payload: Record<string, unknown>
  source: ObservationSource | null
  /** inference 置信度 0~1。 */
  confidence: number | null
  status: NodeStatus
  /** progress 冲突标（不静默双真相）。 */
  conflict: boolean
  /** 冲突详情：field -> [当前值, 传入值]。 */
  conflict_detail: Record<string, [unknown, unknown]> | null
  /** 轻量边：依赖的 node ids（inference.based_on / 显式 link）。 */
  based_on: string[]
  created_at: number
  updated_at: number
  /** 溯源账本（schema2 sidecar）当前 head 修订 id；账本未挂载时缺省。 */
  revision_id?: string
}

/** trail 步骤输入。 */
export interface TrailStepInput {
  action: string
  refs?: string[]
}

/** trail 行。 */
export interface TrailEntry {
  run_id: string
  seq: number
  agent_id: string
  action: string
  refs: string[]
  ts: number
  /** gc 压缩合并步（保留首尾与压缩摘要，中间明细不保留）。 */
  compressed: boolean
}

/** progress 补丁：字段级 patch，冲突时记录双方值。 */
export interface ProgressPatch {
  status?: string
  summary?: string
  owner?: string
  [field: string]: unknown
}

/** 预算：节点数 + 估算 token 双上限。 */
export interface Budgets {
  max_nodes?: number
  max_tokens?: number
}

export interface ActivateOpts {
  /** Core defaults to raw for compatibility; curated is a read-only projection. */
  view?: 'raw' | 'curated'
  run_id?: string | null
  task_id?: string | null
  agent_id?: string
  budgets?: Budgets
}

/** 激活结果中带排序信息的节点。frozen=true 表示预算保护（constraint / 当次 progress）。 */
export interface RankedNode {
  node: MemoryNode
  weight: number
  score: number
  tokens: number
  frozen: boolean
}

/** trail 摘要（激活尾部附一条，预算最紧时最先丢弃）。 */
export interface TrailDigest {
  kind: 'trail'
  run_id: string
  steps: number
  tokens: number
  text: string
}

export interface ActivationResult {
  curation?: { view: 'curated'; excluded: number; reasons: Record<string, number> }
  nodes: RankedNode[]
  trail?: TrailDigest
  tokens_used: number
  nodes_dropped: number
  budgets: { max_nodes: number; max_tokens: number }
}

/** add 输入（agent_id/role 由 open 绑定的实例提供，不可在 input 里冒名）。 */
export interface AddInput {
  run_id?: string | null
  task_id?: string | null
  key?: string | null
  text: string
  source?: ObservationSource
  confidence?: number
  based_on?: string[]
  payload?: Record<string, unknown>
  /** 溯源坐标（M2 宿主绑定填充；齐全时启用重放去重/同坐标异摘要拒绝）。 */
  provenance?: ProvenanceCoord
  /** M2 证据绑定（host/tool 角色；同事务写入 source_refs）。模型角色传入即拒绝。 */
  evidence?: import('./evidence.js').EvidenceBindingInput
}

/** 持久事件坐标：host_instance+session_id+durable_event_seq 齐全才可去重重放。 */
export interface ProvenanceCoord {
  host_instance?: string | null
  session_id?: string | null
  call_id?: string | null
  root_call_id?: string | null
  durable_event_seq?: number | null
}

/** update_progress 上下文：base_updated_at 提供乐观锁（不传 = 无条件覆盖但不标冲突）；
 *  expected_revision 是修订级 CAS（账本挂载时优先于毫秒墙钟）。 */
export interface ProgressCtx {
  base_updated_at?: number
  expected_revision?: string
}

export interface GcOpts {
  /** 每 run trail 保留步数上限，超出压缩中间段（保留首尾）。默认 50。 */
  trail_keep?: number
  /** 按天降级 tip/inference（updated_at 距今超过 N 天 → demoted）。默认不启用。 */
  ttl_days?: number
  /** 物理删除 demoted/contradicted/superseded 行（默认仅降级不删）。 */
  purge?: boolean
}

export interface GcReport {
  trail_runs_compressed: number
  trail_steps_merged: number
  demoted_by_ttl: number
  purged: number
}

/** export/import 的单 workspace 记忆包。 */
export interface MemoryPackage {
  schema_version: 1
  workspace_id: string
  exported_at: number
  seq: number
  nodes: MemoryNode[]
  trail: TrailEntry[]
}
