/**
 * 角色桥：dsh 半区 ↔ memory-net。
 *
 * - host 半区（provide('memory-net') 的 api）：宿主/工具桥持有，全写权限（observation 仅此入口）
 * - model 半区（memory_net_write 工具）：受限句柄，只能 inference/tip——observation
 *   写路径在类型与运行时两个层面都不可达（WriteForbiddenError 双保险）
 *
 * 生命周期：每个 workspace 一个实例，apply 时按需打开，close() 全量清理。
 */
import { MemoryNet } from '../../../src/store.js'
import type { ActivationResult } from '../../../src/types.js'
import type { AdapterConfig } from './config.js'
import { workspaceDir } from './config.js'
import { createHash } from 'node:crypto'
import type { ToolResultExec, ToolResultPayloadFace } from './contract.js'

/** host 半区 API（ctx.provide('memory-net') 的服务面）。 */
export interface HostApi {
  /** workspace 目录（= 物理隔离载体）。 */
  workspaceDir: string
  forAgent?: (agent:unknown)=>HostApi
  /** 物理观测写入（仅宿主/工具桥调用；模型工具不可达此方法）。 */
  observe(input: {
    key: string
    text: string
    source?: 'tool' | 'user' | 'config' | 'system'
    run_id?: string | null
    task_id?: string | null
    payload?: Record<string, unknown>
  }): ReturnType<MemoryNet['add']>
  addInference(input: {
    text: string
    confidence: number
    based_on?: string[]
    run_id?: string | null
    task_id?: string | null
  }): ReturnType<MemoryNet['add']>
  addTip(input: { text: string; strategy?: string; recovery?: string; run_id?: string | null }): ReturnType<MemoryNet['add']>
  addConstraint(input: { key: string; text: string; mode: 'forbid' | 'require' }): ReturnType<MemoryNet['add']>
  updateProgress: MemoryNet['updateProgress']
  appendTrail: MemoryNet['appendTrail']
  replayTrail: MemoryNet['replayTrail']
  activate: MemoryNet['activate']
  promote: MemoryNet['promote']
  demote: MemoryNet['demote']
  contradict: MemoryNet['contradict']
  gc: MemoryNet['gc']
  exportPkg: MemoryNet['exportPkg']
  proposeCandidate: MemoryNet['proposeCandidate']
  reviewCandidate: MemoryNet['reviewCandidate']
  candidates: MemoryNet['candidates']
  /** 全量关闭（apply 内打开的所有 workspace 实例）。 */
  close: () => void
}

/** 打开（或复用）一个 workspace 的 host 实例并返回 host API。
 *  closeAll：全量关闭回调（apply 内打开的所有 workspace 实例）——
 *  多 workspace 场景（模型工具传 workspace 参数）下 nets Map 会常开多实例，
 *  close 只关默认实例会泄漏 WAL 句柄（会话 12 P2-4 修复）。 */
export function openHostApi(
  cfg: AdapterConfig,
  netOf: (dir: string) => MemoryNet,
  workspaceName?: string,
  closeAll?: () => void,
): HostApi {
  const dir = workspaceDir(cfg, workspaceName)
  const net = netOf(dir)
  return {
    workspaceDir: dir,
    observe: (input) => net.add('observation', { ...input, source: input.source ?? 'tool' }),
    addInference: (input) => net.add('inference', input),
    addTip: (input) =>
      net.add('tip', {
        text: input.text,
        run_id: input.run_id ?? null,
        payload: {
          ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
          ...(input.recovery !== undefined ? { recovery: input.recovery } : {}),
        },
      }),
    addConstraint: (input) => net.add('constraint', { ...input, payload: { mode: input.mode } }),
    updateProgress: (taskId, patch, pctx) => net.updateProgress(taskId, patch, pctx),
    appendTrail: (runId, step) => net.appendTrail(runId, step),
    replayTrail: (runId) => net.replayTrail(runId),
    activate: (query, opts) => net.activate(query, opts),
    promote: (id, opts) => net.promote(id, opts),
    demote: (id, opts) => net.demote(id, opts),
    contradict: (id, opts) => net.contradict(id, opts),
    gc: (opts) => net.gc(opts),
    exportPkg: () => net.exportPkg(),
    proposeCandidate: input => net.proposeCandidate(input),
    reviewCandidate: (id,input) => net.reviewCandidate(id,input),
    candidates: opts => net.candidates(opts),
    close: () => (closeAll ? closeAll() : net.close()),
  }
}

/** 渲染单节点（progress 带状态；冲突显式标注——不静默双真相）。 */
function renderNode(x: { node: { id: string; status: string; based_on: string[]; kind: string; text: string; confidence: number | null; conflict: boolean; payload: Record<string, unknown> } }): string {
  const n = x.node
  const tag = n.kind === 'observation' ? '观测'
    : n.kind === 'progress' ? `进度${typeof n.payload?.status === 'string' ? `·${n.payload.status}` : ''}`
    : n.kind === 'tip' ? '提示'
    : n.kind === 'constraint' ? '约束'
    : (n.payload.memory_candidate as {state?:string})?.state === 'accepted' && n.status === 'promoted' ? '候选·已核验（推断，非物理事实）' : n.status === 'promoted' ? '推断·已审阅（非物理观测）' : (n.payload.memory_candidate ? '候选·未准入' : '推断·未证实')
  const conf = n.confidence !== null ? `（置信 ${n.confidence}）` : ''
  const conflict = n.conflict ? ' ⚠冲突' : ''
  const based = n.based_on.length ? ` based_on=${n.based_on.join(',')}` : ''
  const evidence = Array.isArray(n.payload.promote_evidence) ? n.payload.promote_evidence.filter((id): id is string => typeof id === 'string') : []
  const review = evidence.length ? ` review_evidence=${evidence.join(',')}` : ''
  return `[${tag}]${conf}${conflict} ${n.text} (id=${n.id}${based}${review})`
}

/** 渲染 ActivationResult 为注入文本（冻结集在前：约束 + 当次进度；trail 摘要收尾）。 */
export function renderActivation(r: ActivationResult, diagnostics = true): string {
  const lines: string[] = []
  const frozen = r.nodes.filter((x) => x.frozen)
  const rest = r.nodes.filter((x) => !x.frozen)
  for (const x of frozen) lines.push(renderNode(x))
  for (const x of rest) lines.push(renderNode(x))
  if (r.trail) lines.push(`[路径 r=${r.trail.run_id}] ${r.trail.text}`)
  if (diagnostics && r.curation) lines.push(`[精选] 排除 ${r.curation.excluded}：${JSON.stringify(r.curation.reasons)}`)
  if (diagnostics) lines.push(`（激活 ${r.nodes.length} 节点 / ${r.tokens_used} tokens，裁掉 ${r.nodes_dropped}）`)
  return lines.join('\n')
}

/** 工具默认预算（config.budgets 展开为 activate opts）。 */
export function activateOpts(cfg: AdapterConfig, runId?: string | null, taskId?: string | null, view: unknown = cfg.recall.view) {
  if (view !== 'raw' && view !== 'curated') throw new Error('Invalid recall view')
  return {
    view: view as 'raw' | 'curated',
    run_id: runId ?? null,
    task_id: taskId ?? null,
    agent_id: cfg.agent_id,
    budgets: { max_nodes: cfg.budgets.max_nodes, max_tokens: cfg.budgets.max_tokens },
  }
}

// ---------------------------------------------------------------- auto-observe：宿主工具结果自动入网

/** buildObservation 的产出：可直接投递给 MemoryNet.add('observation') 的内容。 */
export interface AutoObservation {
  key?: string
  text: string
  payload: Record<string, unknown>
  /** M2：原生 read/edit/write 事件的文件摘要证据（digest only，绝不含原文）。 */
  evidence?: { files: Array<{ path: string; before_digest: string | null; after_digest: string | null }> }
}

/** 原生文件工具名（read/edit/write 词段族）。保守匹配独立词段，避免误伤 web_search 等。 */
const FILE_TOOL_RE = /(^|[_\\/: -])(read|edit|write|apply_?patch|multi_?edit|notebook_?edit)([_\\/: -]|$)/

/** 从工具参数提取文件证据（保守：仅识别显式 string 字段；缺 before → null 不补造）。 */
function extractFileEvidence(name: string, args: unknown): AutoObservation['evidence'] | undefined {
  if (!FILE_TOOL_RE.test(name)) return undefined
  if (args === null || typeof args !== 'object') return undefined
  const a = args as Record<string, unknown>
  const path = typeof a.path === 'string' && a.path ? a.path
    : typeof a.file_path === 'string' && a.file_path ? a.file_path
    : typeof a.filePath === 'string' && a.filePath ? a.filePath
    : typeof a.notebook_path === 'string' && a.notebook_path ? a.notebook_path
    : null
  if (path === null) return undefined
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = a[k]
      if (typeof v === 'string' && v.length > 0) return v
    }
    return null
  }
  const before = pick('before', 'old_content', 'oldContent', 'original', 'original_content', 'prev_content')
  const after = pick('after', 'new_content', 'newContent', 'content', 'patched', 'replacement')
  if (before === null && after === null) return undefined
  const d = (c: string | null): string | null => (c === null ? null : evidenceDigestOf(c))
  return { files: [{ path, before_digest: d(before), after_digest: d(after) }] }
}

/** 规范化摘要（与 src/evidence.ts contentDigest 同规则：行尾 CRLF/CR→LF 后 sha256）。 */
function evidenceDigestOf(content: string): string {
  return createHash('sha256').update(content.replaceAll('\\r\\n', '\\n').replaceAll('\\r', '\\n'), 'utf8').digest('hex')
}

/** 证据提取后，观测文本中的 args 脱敏为非正文字段（原文不进记忆文本/载荷）。 */
const EVIDENCE_ARG_KEYS = ['before', 'after', 'old_content', 'new_content', 'oldContent', 'newContent', 'original', 'original_content', 'prev_content', 'content', 'patched', 'replacement']
function redactArgsForEvidence(args: unknown): unknown {
  if (args === null || typeof args !== 'object') return args
  const a = { ...(args as Record<string, unknown>) }
  for (const k of EVIDENCE_ARG_KEYS) if (k in a) a[k] = '[evidence-digested]'
  return a
}

const clip = (s: string, max: number): { text: string; truncated: boolean } =>
  s.length > max ? { text: s.slice(0, max) + '…', truncated: true } : { text: s, truncated: false }

/** 任意值 → 摘要文本（JSON 优先，字符串原样，循环引用等失败回退 String；undefined 明示）。 */
function digest(v: unknown): string {
  if (v === undefined) return '（无返回值）'
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

/**
 * 'tools/result' 事件 → 观测内容（纯函数无 IO——易测、行为可锁）。
 * 返回 null = 该事件不产生观测：
 *   - 自身记忆工具（memory_net_*）不递归入网（防自指噪声）
 *   - include_error=false 时的失败结果
 *   - include_nested=false 时的嵌套 dispatch（exec.parent 存在；字段缺失 fail-open 视为根调用）
 *
 * 独立调用观测不设状态 key：同工具读取不同主体或重复重验不会覆盖旧依据。
 * 宿主显式 observe 的 subject key 仍用于状态覆盖；工具名/调用 ID 不等于事实主体。
 * 本桥不承诺跨重启去重，也不把执行成功当作用户接受变更。
 */
export function buildObservation(
  ao: AdapterConfig['auto_observe'],
  exec: ToolResultExec,
  result: ToolResultPayloadFace,
): AutoObservation | null {
  const name = typeof exec?.name === 'string' ? exec.name : ''
  if (!name) return null
  if (name.startsWith('memory_net_')) return null
  const isError = result?.isError === true
  if (isError && !ao.include_error) return null
  if (!ao.include_nested && exec?.parent != null) return null

  const evidence = extractFileEvidence(name, exec?.arguments)
  const args = clip(digest(evidence ? redactArgsForEvidence(exec?.arguments) : exec?.arguments), ao.args_chars)
  const body = clip(digest(isError ? result?.error : result?.value), ao.max_chars)
  const text = isError
    ? `工具 ${name} 失败·args(${args.text})→ ${body.text}`
    : `工具 ${name} 成功·args(${args.text})→ ${body.text}`
  return {
    text,
    payload: {
      tool: name,
      is_error: isError,
      call_id: exec?.callId ?? null,
      truncated: args.truncated || body.truncated,
      ...(evidence ? { evidence } : {}),
    },
    ...(evidence ? { evidence } : {}),
  }
}

/**
 * 安装 auto-observe：订阅 dsh-tools 'tools/result' emit 事件，把宿主工具的终态结果
 * 作为 observation 写入默认 workspace（写纪律：observation 仅宿主路径——模型工具不可达）。
 *
 * 三重防线保证宿主工具执行永不受影响：
 *   1) dsh 侧 containment：notifyResult 对 listener try/catch + Promise 兜底（dsh-tools 实勘）
 *   2) 本 listener 全体 try/catch + warn 计数（自我隔离双保险，前 3 次可见）
 *   3) buildObservation 纯函数无 IO，投递前已过滤全部不产生观测的事件形态
 */
export function installAutoObserve(
  ctx: { on: (event: string, listener: (...args: unknown[]) => void) => void },
  cfg: AdapterConfig,
  netOf: (dir: string) => MemoryNet,
  opts: { warn: (msg: string) => void; binding?: (exec:ToolResultExec)=>{dir:string;sessionId:string;scopeId:string;project:string;durableEventSeq?:number|null;root?:string} },
): void {
  let failures = 0
  const admitted = new Map<symbol, {dir:string;sessionId:string;scopeId:string;project:string;durableEventSeq?:number|null;root?:string}|null>()
  if(cfg.context.mode === 'session')ctx.on('tools/pre-execute',(execRaw,nextRaw)=>{
    const exec=(execRaw ?? {}) as ToolResultExec
    if(typeof exec.token === 'symbol' && !exec.name?.startsWith('memory_net_') && (cfg.auto_observe.include_nested || exec.parent == null)) {
      let binding:{dir:string;sessionId:string;scopeId:string;project:string;durableEventSeq?:number|null;root?:string}|null=null
      try {binding=opts.binding?.(exec) ?? null}catch(e){opts.warn('Memory admission context unavailable: '+String(e))}
      if(admitted.size<4096)admitted.set(exec.token,binding)
      else opts.warn('Memory admission capacity reached; result will be skipped')
    }
    if(typeof nextRaw !== 'function')throw new Error('Missing tools/pre-execute continuation')
    return nextRaw()
  })
  ctx.on('tools/result', (execRaw, resultRaw) => {
    try {
      const exec = (execRaw ?? {}) as ToolResultExec
      const result = (resultRaw ?? {}) as ToolResultPayloadFace
      const binding = cfg.context.mode === 'session' && exec.token ? admitted.get(exec.token) : undefined
      if(exec.token)admitted.delete(exec.token)
      const obs = buildObservation(cfg.auto_observe, exec, result)
      if (!obs) return
      if(cfg.context.mode === 'session' && !binding)throw new Error('Auto observation missing trusted agent context')
      const net = netOf(binding?.dir ?? workspaceDir(cfg, cfg.default_workspace))
      // M2：事件坐标透传（durable_event_seq 齐全 → 账本重放坐标 + captured 绑定；
      // 缺席 → persisted_unknown，不冒充可重放）。文件证据按事件内摘要即时捕获代码状态
      // （host_native、非全量枚举 → partial，不声称全树已知）。
      let evidenceInput: Parameters<MemoryNet['add']>[1]['evidence']
      if (obs.evidence && net.ledger && net.evidence) {
        try {
          const cs = net.captureCodeState({
            root: binding?.root ?? `session://${binding?.sessionId ?? 'unknown'}`,
            source: 'host_native',
            files: obs.evidence.files
              .map(f => ({ path: f.path, digest: f.after_digest ?? f.before_digest ?? null }))
              .filter((f): f is { path: string; digest: string } => f.digest !== null),
          })
          evidenceInput = { code_state_id: cs.code_state_id, files: obs.evidence.files }
        } catch {
          evidenceInput = undefined // 证据失败不阻断原观测写入
        }
      }
      net.add('observation', {
        run_id: binding?.sessionId ?? null,
        key: obs.key,
        text: obs.text,
        source: 'tool',
        payload: {...obs.payload,...(binding?{host_context:{session_id:binding.sessionId,project:binding.project,scope_id:binding.scopeId}}:{})},
        provenance: binding ? { session_id: binding.sessionId, call_id: exec?.callId != null ? String(exec.callId) : null, durable_event_seq: binding.durableEventSeq ?? null } : undefined,
        ...(evidenceInput ? { evidence: evidenceInput } : {}),
      })
    } catch (e) {
      failures++
      if (failures <= 3) {
        opts.warn(`auto-observe 写入失败（已静默计数 ${failures}）: ${String((e as Error)?.message ?? e)}`)
      }
    }
  })
}
