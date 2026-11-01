/**
 * console API 客户端：同源相对路径 + Bearer token（localStorage 持久化）。
 * 远程场景（Tunnel 单域托管）下 origin 即家中 gateway 地址，无需任何配置。
 */

const TOKEN_KEY = 'memory-net-console-token'

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setToken(t: string): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // 隐私模式等 localStorage 不可用：本次会话内存兜底由调用方处理
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// 挂起请求不再让「加载中…」永久停留（P3-12）：所有 REST 调用 20s 超时中止
const REQUEST_TIMEOUT_MS = 20_000

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch (e) {
    if (ctrl.signal.aborted) {
      throw new ApiError(0, 'TIMEOUT', `请求超时（${REQUEST_TIMEOUT_MS / 1000}s）`)
    }
    throw new ApiError(0, 'NETWORK', `网络错误: ${(e as Error).message}`)
  }
  try {
    if (res.status === 401) throw new ApiError(401, 'UNAUTHORIZED', 'token 缺失或无效')
    const text = await res.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      if (!res.ok) throw new ApiError(res.status, 'BAD_RESPONSE', `非 JSON 响应（${res.status}）`)
      return text as unknown as T
    }
    if (!res.ok) {
      const msg = json?.error?.message ?? `请求失败（${res.status}）`
      const code = json?.error?.code ?? 'ERROR'
      throw new ApiError(res.status, code, msg)
    }
    return json as T
  } finally {
    clearTimeout(timer)
  }
}

// ---- 类型（对齐 server 面契约） ----

export interface MemoryNode {
  id: string
  kind: string
  agent_id: string
  run_id: string | null
  task_id: string | null
  key: string | null
  text: string
  payload: Record<string, unknown>
  source: string | null
  confidence: number | null
  status: string
  conflict: boolean
  conflict_detail: Record<string, [unknown, unknown]> | null
  based_on: string[]
  created_at: number
  updated_at: number
}

export interface WorkspaceSummary {
  id: string
  dir_name: string
  nodes_total: number
  trail_steps: number
  trail_runs: number
  last_activity: number | null
  by_kind: Record<string, number>
  unreadable?: boolean
}

export interface WsStats extends WorkspaceSummary {
  by_status: Record<string, number>
  by_agent: Record<string, number>
}

export interface NodePage {
  total: number
  offset: number
  limit: number
  nodes: MemoryNode[]
}

export interface RankedNode {
  node: MemoryNode
  weight: number
  score: number | null
  tokens: number
  frozen: boolean
}

export interface ActivationResult {
  nodes: RankedNode[]
  trail?: { kind: 'trail'; run_id: string; steps: number; tokens: number; text: string }
  tokens_used: number
  nodes_dropped: number
  budgets: { max_nodes: number; max_tokens: number }
}

export interface TrailEntry {
  run_id: string
  seq: number
  agent_id: string
  action: string
  refs: string[]
  ts: number
  compressed: boolean
}

export interface RunSummary {
  run_id: string
  steps: number
  agents: string[]
  first_ts: number
  last_ts: number
}

export const api = {
  health: (): Promise<{ ok: boolean; service: string; version: string; workspace_count: number }> =>
    call('GET', '/v1/health'),
  workspaces: (): Promise<{ workspaces: WorkspaceSummary[]; count: number }> =>
    call('GET', '/v1/workspaces'),
  stats: (ws: string): Promise<WsStats> => call('GET', `/v1/ws/${encodeURIComponent(ws)}/stats`),
  nodes: (ws: string, q: { kind?: string; status?: string; q?: string; limit?: number; offset?: number }): Promise<NodePage> => {
    const p = new URLSearchParams()
    if (q.kind) p.set('kind', q.kind)
    if (q.status) p.set('status', q.status)
    if (q.q) p.set('q', q.q)
    p.set('limit', String(q.limit ?? 100))
    p.set('offset', String(q.offset ?? 0))
    return call('GET', `/v1/ws/${encodeURIComponent(ws)}/nodes?${p.toString()}`)
  },
  activate: (
    ws: string,
    body: { query: string; budgets?: { max_nodes?: number; max_tokens?: number }; agent_id?: string; run_id?: string; task_id?: string },
  ): Promise<ActivationResult> => call('POST', `/v1/ws/${encodeURIComponent(ws)}/activate`, body),
  trail: (ws: string, runId?: string): Promise<{ run_id: string | null; entries: TrailEntry[]; count: number }> =>
    call('GET', `/v1/ws/${encodeURIComponent(ws)}/trail${runId ? `?run_id=${encodeURIComponent(runId)}` : ''}`),
  runs: (ws: string): Promise<{ runs: RunSummary[]; count: number }> =>
    call('GET', `/v1/ws/${encodeURIComponent(ws)}/runs`),
  writeProgress: (
    ws: string,
    body: { task_id: string; patch: { status?: string; summary?: string; owner?: string } },
  ): Promise<{ node: MemoryNode }> => call('POST', `/v1/ws/${encodeURIComponent(ws)}/progress`, body),
  writeTrail: (ws: string, body: { run_id: string; action: string; refs?: string[] }): Promise<{ entry: TrailEntry }> =>
    call('POST', `/v1/ws/${encodeURIComponent(ws)}/trail`, body),
}

/** v1.1 实时事件流（SSE）：workspace 变更推送（EventSource 自动重连）。返回关闭函数。 */
export function openEvents(handlers: {
  onUpdate?: (workspaceId: string, reason: string) => void
  onState?: (state: 'live' | 'down') => void
}): () => void {
  const es = new EventSource(`/v1/events?token=${encodeURIComponent(getToken())}`)
  es.addEventListener('hello', () => handlers.onState?.('live'))
  es.addEventListener('workspace.updated', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as { workspace_id?: string; reason?: string }
      if (data.workspace_id) handlers.onUpdate?.(data.workspace_id, data.reason ?? 'change')
    } catch {
      // 坏帧忽略（协议纪律：未知/坏数据不炸通道）
    }
  })
  es.onerror = () => handlers.onState?.('down')
  return () => es.close()
}
