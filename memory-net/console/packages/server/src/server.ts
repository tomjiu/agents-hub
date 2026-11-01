/**
 * memory-net-console HTTP 服务面（v1）。
 *
 * 读面（node:sqlite 只读探查）：health / workspaces / stats / nodes / trail / runs / export
 * 语义面（核心库）：activate（预算裁剪演示，权重序与预算语义唯一来源 = memory-net）
 * 受控写面（核心库 host 身份）：progress / trail —— 远程协作记录，模型写纪律不涉 UI。
 *
 * 认证：Bearer token（除 health 外全站强制）；静态资源免认证（构建产物非敏感）。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { statSync } from 'node:fs'
import { MemoryError, UnknownNodeError } from 'memory-net/dist/src/errors.js'
import { MemoryNet } from 'memory-net/dist/src/store.js'
import type {
  ActivateOpts,
  ActivationResult,
  MemoryNode,
  NodeKind,
  NodeStatus,
  ProgressPatch,
} from 'memory-net/dist/src/types.js'
import {
  Catalog,
  WorkspaceNotFoundError,
  WorkspaceUnreadableError,
  type NodeQuery,
  type NodePage,
  type WorkspaceSummary,
  type WsStats,
} from './catalog.js'
import { checkToken } from './auth.js'
import { createStaticHandler } from './static.js'

export const CONSOLE_VERSION = '0.1.0'

const MAX_BODY_BYTES = 1024 * 1024

interface TrailEntryLike {
  run_id: string
  seq: number
  agent_id: string
  action: string
  refs: string[]
  ts: number
  compressed: boolean
}

interface RunSummaryLike {
  run_id: string
  steps: number
  agents: string[]
  first_ts: number
  last_ts: number
}

export interface ConsoleServerOpts {
  host: string
  port: number
  token: string
  catalog: Catalog
  staticDir?: string
  log?: boolean
  /** SSE 变更扫描间隔（ms）；默认 3000，测试可调小 */
  ssePollMs?: number
}

export interface ConsoleHandle {
  server: Server
  close: () => void
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  // P3-8：socket 已毁/响应已结时不写（防上游 Node 行为变化把静默容忍变成进程崩溃）
  if (res.writableEnded || res.destroyed) return
  const payload = JSON.stringify(body)
  try {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(payload)
  } catch {
    // 客户端已断开：吞（进程不因写响应崩溃）
  }
}

interface ApiError {
  status: number
  code: string
  message: string
  /** 响应已由错误源直接写出（如 413 冲刷后断开），catch 不再重复发送 */
  handled?: boolean
}

function httpError(status: number, code: string, message: string): ApiError {
  return { status, code, message }
}

function readBody(req: IncomingMessage, res: ServerResponse): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    req.on('data', (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        settled = true
        // 413 必须先冲刷给客户端、再断连接：旧实现先 req.destroy()，
        // 客户端只见连接重置（UND_ERR_SOCKET），永远收不到 413（P2-1）
        const payload = JSON.stringify({
          error: { code: 'PAYLOAD_TOO_LARGE', message: `请求体过大（上限 ${MAX_BODY_BYTES} 字节）` },
        })
        res.writeHead(413, {
          'Content-Type': 'application/json; charset=utf-8',
          'Connection': 'close',
        })
        res.end(payload, () => {
          try { req.destroy() } catch { /* 已断开 */ }
        })
        reject({ status: 413, code: 'PAYLOAD_TOO_LARGE', message: '请求体过大', handled: true })
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (e: Error) => {
      if (settled) return
      settled = true
      reject(e)
    })
  })
}

async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown>> {
  const raw = await readBody(req, res)
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw httpError(400, 'BAD_REQUEST', '请求体必须是 JSON 对象')
    }
    return parsed as Record<string, unknown>
  } catch (e) {
    if ((e as ApiError).status === 400) throw e
    throw httpError(400, 'BAD_REQUEST', `JSON 解析失败: ${(e as Error).message}`)
  }
}

const KINDS: ReadonlySet<string> = new Set(['constraint', 'observation', 'inference', 'progress', 'tip'])
const STATUSES: ReadonlySet<string> = new Set(['active', 'contradicted', 'promoted', 'demoted', 'superseded'])

function parseNodeQuery(url: URL): NodeQuery {
  const kind = url.searchParams.get('kind') ?? undefined
  const status = url.searchParams.get('status') ?? undefined
  if (kind && !KINDS.has(kind)) throw httpError(400, 'BAD_REQUEST', `非法 kind: ${kind}`)
  if (status && !STATUSES.has(status)) throw httpError(400, 'BAD_REQUEST', `非法 status: ${status}`)
  const limit = Number(url.searchParams.get('limit') ?? '100')
  const offset = Number(url.searchParams.get('offset') ?? '0')
  return {
    kind: (kind as NodeKind) || undefined,
    status: (status as NodeStatus) || undefined,
    agent: url.searchParams.get('agent') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    limit: Number.isFinite(limit) ? Math.trunc(limit) : 100,
    offset: Number.isFinite(offset) ? Math.trunc(offset) : 0,
  }
}

export function createConsoleServer(opts: ConsoleServerOpts): ConsoleHandle {
  const catalog = opts.catalog
  const serveStatic = opts.staticDir ? createStaticHandler(opts.staticDir) : undefined
  const verbose = opts.log === true

  function requireWs(url: URL): string {
    const parts = url.pathname.split('/').filter(Boolean)
    // 形如 /v1/ws/<id>/...
    const id = parts[2]
    if (!id) throw httpError(404, 'NOT_FOUND', '缺少 workspace id')
    return decodeURIComponent(id)
  }

  const server: Server = createServer((req, res) => {
    // P3-8：响应流错误一律有监听者（旧实现 catch 内 sendJson 依赖 Node 静默容忍）
    res.on('error', () => undefined)
    void handle(req, res)
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // 防 iframe 嵌套（写面按钮存在，防点击劫持）；writeHead 头会与本头合并
      res.setHeader('X-Frame-Options', 'DENY')
      const url = new URL(req.url ?? '/', 'http://localhost')
      const pathname = url.pathname
      if (verbose) console.log(`[console] ${req.method} ${pathname}`)

      if (req.method === 'GET' && serveStatic && pathname !== '/v1/health' && !pathname.startsWith('/v1/')) {
        serveStatic(pathname, res)
        return
      }

      // health 接受 GET|HEAD（P3-7：探活 HEAD 不再 401/404）；HEAD 无响应体
      if (pathname === '/v1/health' && (req.method === 'GET' || req.method === 'HEAD')) {
        const all = catalog.list()
        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          })
          res.end()
          return
        }
        sendJson(res, 200, {
          ok: true,
          service: 'memory-net-console',
          version: CONSOLE_VERSION,
          workspace_count: all.length,
        })
        return
      }

      // EventSource（SSE）无法自定义请求头：兼容 ?token=（companion gateway 同款约定）
      const qToken = url.searchParams.get('token')
      const authorized = checkToken(opts.token, req.headers.authorization) ||
        (qToken !== null && qToken.length > 0 && checkToken(opts.token, `Bearer ${qToken}`))
      if (!authorized) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="memory-net-console"')
        sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: '缺少或无效 token' } })
        return
      }

      // ---- v1.1 实时事件流：workspace 变更推送（外部写入经 mtime/size 签名检测）----
      if (pathname === '/v1/events' && req.method === 'GET') {
        handleSse(req, res)
        return
      }

      if (pathname === '/v1/workspaces' && req.method === 'GET') {
        const all: WorkspaceSummary[] = catalog.list()
        sendJson(res, 200, { workspaces: all, count: all.length })
        return
      }

      if (pathname.startsWith('/v1/ws/')) {
        await handleWs(req, res, url)
        return
      }

      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `未知路径: ${pathname}` } })
    } catch (e) {
      const err = e as ApiError
      if (err && err.handled) return
      if (err && typeof err.status === 'number') {
        sendJson(res, err.status, { error: { code: err.code, message: err.message } })
        return
      }
      // catalog 探查层错误类：不存在 404 / 不可读 503（P3-3/4，不再 500 泛滥）
      if (e instanceof WorkspaceNotFoundError) {
        sendJson(res, 404, { error: { code: 'NOT_FOUND', message: e.message } })
        return
      }
      if (e instanceof WorkspaceUnreadableError) {
        sendJson(res, 503, { error: { code: 'WORKSPACE_UNREADABLE', message: e.message } })
        return
      }
      // vendor 错误族映射：用户输入/语义拒绝给 4xx，而非 500 泛滥（P2-2）
      if (e instanceof UnknownNodeError) {
        sendJson(res, 404, { error: { code: 'NOT_FOUND', message: e.message } })
        return
      }
      if (e instanceof MemoryError) {
        sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: e.message } })
        return
      }
      console.error('[console] 内部错误:', e)
      sendJson(res, 500, { error: { code: 'INTERNAL', message: '内部错误' } })
    }
  }

  /** workspace 动作 → 允许方法（405 语义与 Allow 头唯一来源，P3-7） */
  const WS_ACTION_METHODS: Record<string, string[]> = {
    stats: ['GET'],
    nodes: ['GET'],
    trail: ['GET', 'POST'],
    runs: ['GET'],
    activate: ['POST'],
    export: ['GET'],
    progress: ['POST'],
  }

  async function handleWs(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const wsId = requireWs(url)
    // 未知 workspace 统一 404（防 catalog 内部错误漏成 500；白名单映射防路径注入）
    if (!catalog.resolveDir(wsId)) {
      throw httpError(404, 'NOT_FOUND', `workspace 不存在: ${wsId}`)
    }
    const parts = url.pathname.split('/').filter(Boolean)
    // parts: v1, ws, <id>, <action...>
    const action = parts[3] ?? ''

    // P3-7：动作已知但方法不对 → 405 + Allow（旧实现落到末尾 404「未知动作」文案误导）
    const allowed = WS_ACTION_METHODS[action]
    if (allowed && !allowed.includes(req.method ?? '')) {
      res.setHeader('Allow', allowed.join(', '))
      sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: `${action} 仅支持 ${allowed.join('/')}` } })
      return
    }

    if (action === 'stats' && req.method === 'GET') {
      const stats: WsStats = catalog.stats(wsId)
      sendJson(res, 200, stats)
      return
    }

    if (action === 'nodes') {
      const nid = parts[4] ? decodeURIComponent(parts[4] as string) : undefined
      if (nid && req.method === 'GET') {
        const node: MemoryNode | null = catalog.node(wsId, nid)
        if (!node) {
          sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `节点不存在: ${nid}` } })
          return
        }
        sendJson(res, 200, { node })
        return
      }
      if (!nid && req.method === 'GET') {
        const page: NodePage = catalog.nodes(wsId, parseNodeQuery(url))
        sendJson(res, 200, page)
        return
      }
      sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '不支持的方法' } })
      return
    }

    if (action === 'trail' && req.method === 'GET') {
      const runId = url.searchParams.get('run_id') ?? undefined
      const limit = Number(url.searchParams.get('limit') ?? '200')
      const entries: TrailEntryLike[] = catalog.trail(
        wsId,
        runId,
        Number.isFinite(limit) ? Math.trunc(limit) : 200,
      )
      sendJson(res, 200, { run_id: runId ?? null, entries, count: entries.length })
      return
    }

    if (action === 'runs' && req.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? '50')
      const runs: RunSummaryLike[] = catalog.trailRuns(wsId, Number.isFinite(limit) ? Math.trunc(limit) : 50)
      sendJson(res, 200, { runs, count: runs.length })
      return
    }

    if (action === 'activate' && req.method === 'POST') {
      const body = await readJsonBody(req, res)
      const query = typeof body.query === 'string' ? body.query.trim() : ''
      if (!query) throw httpError(400, 'BAD_REQUEST', 'query 必填（激活查询词）')
      const agentId = typeof body.agent_id === 'string' && body.agent_id.trim() ? body.agent_id.trim() : 'console'
      const budgetsRaw = (body.budgets ?? {}) as Record<string, unknown>
      const budgets: { max_nodes?: number; max_tokens?: number } = {}
      if (typeof budgetsRaw.max_nodes === 'number' && Number.isFinite(budgetsRaw.max_nodes)) {
        budgets.max_nodes = Math.trunc(budgetsRaw.max_nodes)
      }
      if (typeof budgetsRaw.max_tokens === 'number' && Number.isFinite(budgetsRaw.max_tokens)) {
        budgets.max_tokens = Math.trunc(budgetsRaw.max_tokens)
      }
      const mnOpts: ActivateOpts = { budgets, agent_id: agentId }
      if (typeof body.run_id === 'string' && body.run_id.trim()) mnOpts.run_id = body.run_id.trim()
      if (typeof body.task_id === 'string' && body.task_id.trim()) mnOpts.task_id = body.task_id.trim()
      const result = withWorkspace(wsId, (mn) => mn.activate(query, mnOpts))
      sendJson(res, 200, result satisfies ActivationResult)
      return
    }

    if (action === 'export' && req.method === 'GET') {
      const pkg = withWorkspace(wsId, (mn) => mn.exportPkg())
      const payload = JSON.stringify(pkg)
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="memory-${encodeURIComponent(wsId)}.json"`,
        'Cache-Control': 'no-store',
      })
      res.end(payload)
      return
    }

    if (action === 'progress' && req.method === 'POST') {
      const body = await readJsonBody(req, res)
      const taskId = typeof body.task_id === 'string' ? body.task_id.trim() : ''
      if (!taskId) throw httpError(400, 'BAD_REQUEST', 'task_id 必填')
      const patchRaw = (body.patch ?? {}) as Record<string, unknown>
      const patch: ProgressPatch = {}
      for (const key of ['status', 'summary', 'owner'] as const) {
        const v = patchRaw[key]
        if (typeof v === 'string' && v.trim()) patch[key] = v.trim()
      }
      if (Object.keys(patch).length === 0) throw httpError(400, 'BAD_REQUEST', 'patch 至少含 status/summary/owner 之一')
      const node = withWorkspace(wsId, (mn) => mn.updateProgress(taskId, patch))
      publishSse('workspace.updated', { workspace_id: wsId, reason: 'progress' })
      sendJson(res, 200, { node })
      return
    }

    if (action === 'trail' && req.method === 'POST') {
      const body = await readJsonBody(req, res)
      const runId = typeof body.run_id === 'string' ? body.run_id.trim() : ''
      const actionText = typeof body.action === 'string' ? body.action.trim() : ''
      if (!runId) throw httpError(400, 'BAD_REQUEST', 'run_id 必填')
      if (!actionText) throw httpError(400, 'BAD_REQUEST', 'action 必填')
      const refs = Array.isArray(body.refs) ? body.refs.filter((r): r is string => typeof r === 'string') : []
      const entry = withWorkspace(wsId, (mn) => mn.appendTrail(runId, { action: actionText, refs }))
      publishSse('workspace.updated', { workspace_id: wsId, reason: 'trail' })
      sendJson(res, 200, { entry })
      return
    }

    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `未知 workspace 动作: ${action}` } })
  }

  /**
   * 以核心库 host 身份打开 workspace 执行操作（写面/activate/export）。
   * workspaceId 显式校验防串读；用完即关（WAL 短连接，不长期持锁）。
   */
  function withWorkspace<T>(wsId: string, fn: (mn: MemoryNet, agentId: string) => T): T {
    // 语义面必须传规范 id（meta workspace_id 为准）：URL 里的别名 id（目录名 ≠ meta）
    // 在读面可用、传给核心库会抛 WorkspaceError（读面/语义面劈叉，P2-2a）
    const resolved = catalog.resolveEntry(wsId)
    if (!resolved) throw httpError(404, 'NOT_FOUND', `workspace 不存在: ${wsId}`)
    const mn = MemoryNet.open(resolved.dir, { agentId: 'console', role: 'host', workspaceId: resolved.canonicalId })
    try {
      return fn(mn, 'console')
    } finally {
      mn.close()
    }
  }

  // ---------------------------------------------------------------- v1.1 SSE ----

  const SSE_POLL_MS = opts.ssePollMs ?? 3_000
  interface SseClient { res: ServerResponse; closed: boolean }
  const sseClients = new Set<SseClient>()
  const lastSignature = new Map<string, string>()
  let signaturesPrimed = false
  let sseSeq = 0

  function handleSse(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    req.on('error', () => undefined)
    res.on('error', () => undefined)
    res.write('retry: 3000\n\n')
    res.write(`id: 0\nevent: hello\ndata: ${JSON.stringify({ ok: true, poll_ms: SSE_POLL_MS })}\n\n`)
    const client: SseClient = { res, closed: false }
    sseClients.add(client)
    req.on('close', () => {
      client.closed = true
      sseClients.delete(client)
    })
  }

  function publishSse(event: string, data: unknown): void {
    sseSeq += 1
    const id = sseSeq
    for (const c of sseClients) {
      if (c.closed) continue
      try {
        c.res.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      } catch {
        c.closed = true
      }
    }
  }

  /**
   * 外部写入的实时层：家中 agent 直写 memory.db 不经本服务，
   * 以 mtime+size 签名轮询检测变化并广播（本服务自身写入走即时广播）。
   * 无订阅者时零开销（扫描直接跳过）。
   */
  function scanWorkspaceChanges(): void {
    if (sseClients.size === 0) return
    let entries: Array<{ id: string; dbPath: string }>
    try {
      entries = catalog.scanEntries()
    } catch {
      return
    }
    for (const { id, dbPath } of entries) {
      let sig = ''
      try {
        // WAL 模式下写入先进 -wal 文件：签名必须覆盖主库 + -wal + -shm 三件，
        // 否则外部直写（WAL 未 checkpoint）对主库 mtime/size 零变化，检测失明
        for (const suffix of ['', '-wal', '-shm']) {
          try {
            const st = statSync(dbPath + suffix)
            sig += `${st.mtimeMs}:${st.size};`
          } catch {
            sig += '0;'
          }
        }
      } catch {
        sig = 'missing'
      }
      const prev = lastSignature.get(id)
      if (prev === undefined) {
        lastSignature.set(id, sig)
        continue
      }
      if (prev !== sig) {
        lastSignature.set(id, sig)
        if (signaturesPrimed) publishSse('workspace.updated', { workspace_id: id, reason: 'external' })
      }
    }
    signaturesPrimed = true
  }

  const scanTimer = setInterval(() => scanWorkspaceChanges(), SSE_POLL_MS)
  scanTimer.unref?.()

  return {
    server,
    close: () => {
      clearInterval(scanTimer)
      for (const c of sseClients) {
        try { c.res.end() } catch { /* 已断开 */ }
      }
      sseClients.clear()
      // 终止 idle keep-alive 连接：否则测试进程/CLI 退出被 undici 连接池阻塞
      const closer = server as Server & { closeIdleConnections?: () => void }
      if (typeof closer.closeIdleConnections === 'function') closer.closeIdleConnections()
      server.close()
    },
  }
}
