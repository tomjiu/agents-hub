/**
 * memory-net dsh 适配包 —— apply(ctx) 接线。
 *
 * 零 import dsh/cordis：ctx 以运行时形态传入（见 contract.ts 结构契约），
 * 能力缺失防御式降级明示（不崩宿主）。dsh 上游升级 → 只需重跑契约测试。
 *
 * Cordis 注入声明（强制）：访问 ctx.systemPrompt / ctx.tools 必须静态导出 inject，
 * 否则 cordis 守卫抛 `cannot get property "X" without inject`（kokoa 插件先例同款）。
 *
 * 接缝：
 *   1) ctx.provide('memory-net', api)      —— host 半区（observe 仅此入口）
 *   2) ctx.tools.register(memory_net_recall / memory_net_write)
 *      —— 模型读写（write 强制 inference/tip，伪造 observation 在桥面被拒）
 *   3) ctx.systemPrompt.section('memory-net') —— activate 预算化注入
 *   4) ctx.on('tools/result', ...)         —— auto-observe：宿主工具结果自动入网（可选能力，
 *      缺失仅关自动观测不拖垮其余接缝；写纪律不破——observation 仅宿主路径）
 */
import path from 'node:path'
import { MemoryNet } from '../../../src/store.js'
import type { AdapterConfig } from './config.js'
import { resolveConfig, workspaceDir } from './config.js'
import type { DshCtx, ToolDef } from './contract.js'
import { probeCtx } from './contract.js'
import {resolveBinding,assemblyAgent,rejectSelectors,guardScopeDirectory} from './context.js'
import type { HostApi } from './bridge.js'
import { openHostApi, renderActivation, activateOpts, installAutoObserve } from './bridge.js'

export const name = 'memory-net-dsh'

/** Cordis 注入声明：ctx.systemPrompt / ctx.tools 须经此声明才可访问。 */
export const inject = ['systemPrompt', 'tools', 'agents', 'workingDirectory']

type Dict = Record<string, unknown>
const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.length > 0 ? v : fallback)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** 重复 apply 自检（contract.ts 承诺的幂等）：同宿主上下文重复加载时直接返回既有实例——
 *  真实 dsh 对同名 section/服务重复注册会抛错崩宿主；mock 宽容会掩盖，这里显式幂等。
 *  仅缓存成功 apply（降级路径不缓存，允许重试）。 */
const appliedCtxs = new WeakMap<object, HostApi | null>()

function warn(ctx: DshCtx, msg: string): void {
  try {
    if (ctx.logger?.warn) ctx.logger.warn(msg)
    else process.stderr.write(`[memory-net-dsh] ${msg}\n`)
  } catch { /* Diagnostics cannot fail host admission or tool execution. */ }
}

/** dsh 插件入口。返回 host api 供宿主测试/直连（ctx.provide 同时注册）。 */
export function apply(ctx: DshCtx, rawConfig: Dict = {}): HostApi | null {
  if (typeof ctx === 'object' && ctx !== null && appliedCtxs.has(ctx)) {
    warn(ctx, '重复 apply：同宿主上下文已注册过 memory-net（幂等返回既有实例）')
    return appliedCtxs.get(ctx) ?? null
  }
  const degraded = probeCtx(ctx)
  if (degraded) {
    warn(ctx, `降级：${degraded}——本包不挂任何接缝`)
    return null
  }

  const cfg: AdapterConfig = resolveConfig(rawConfig)
  if (!cfg.enabled) {
    warn(ctx, 'enabled=false：不挂 section/工具/服务（宿主可自行 openHostApi 直连）')
    return null
  }

  /** workspace 名 → 实例缓存（同目录复用；close 由返回的 api.close 全量清理）。 */
  const nets = new Map<string, MemoryNet>()
  let closed = false
  const netOf = (dir: string): MemoryNet => {
    if (closed) throw new Error('memory-net adapter is closed')
    if(cfg.context.mode === 'session')guardScopeDirectory(cfg,dir)
    const hit = nets.get(dir)
    if (hit) return hit
    const net = MemoryNet.open(dir, { agentId: cfg.agent_id, role: 'host' })
    nets.set(dir, net)
    return net
  }
  /** 全量关闭：HostApi.close 的实际实现（默认 + 非默认 workspace 实例一个不漏）。 */
  const closeAllNets = (): void => {
    closed = true
    for (const n of nets.values()) n.close()
    nets.clear()
  }

  const bindingOf = (agent:unknown, signal?:AbortSignal) => {
    if(closed)throw new Error('memory-net adapter is closed')
    const binding = resolveBinding(ctx,cfg,agent,signal)
    guardScopeDirectory(cfg,binding.dir)
    return binding
  }
  const forAgent = (agent:unknown):HostApi => {
    const binding = bindingOf(agent)
    const scopedCfg = {...cfg,workspaces_root:path.dirname(binding.dir),default_workspace:binding.dir.split(/[\\/]/).pop()!}
    const scoped = openHostApi(scopedCfg,netOf)
    return new Proxy(scoped,{get(target,key) {
      if(key === 'forAgent') return forAgent
      if(key === 'close') return () => {throw new Error('Close adapter through owning host capability')}
      const value = Reflect.get(target,key)
      if(typeof value !== 'function')return value
      return (...args:unknown[])=>{
        if(bindingOf(agent).scopeId !== binding.scopeId)throw new Error('Memory context changed; obtain fresh bound capability')
        if(key === 'observe' || key === 'addInference' || key === 'addTip') {
          const input=(args[0] ?? {}) as Dict
          if((input.run_id !== undefined && input.run_id !== binding.sessionId) || (input.task_id !== undefined && input.task_id !== null))throw new Error('Host memory context selector mismatch')
          args[0]={...input,run_id:binding.sessionId}
        }
        if(key === 'activate') {
          const opts=(args[1] ?? {}) as Dict
          if((opts.run_id !== undefined && opts.run_id !== binding.sessionId)||(opts.task_id !== undefined && opts.task_id !== binding.sessionId))throw new Error('Host recall context mismatch')
          args[1]={...opts,run_id:binding.sessionId,task_id:binding.sessionId}
        }
        if(['updateProgress','appendTrail','replayTrail'].includes(String(key)) && args[0] !== binding.sessionId)throw new Error('Host session context slot mismatch')
        return value.apply(target,args)
      }
    }})
  }
  let api: HostApi
  if(cfg.context.mode === 'session') {
    api = new Proxy({workspaceDir:cfg.workspaces_root,forAgent,close:closeAllNets} as HostApi,{get(target,key){
      if(key === 'workspaceDir' || key === 'forAgent' || key === 'close')return Reflect.get(target,key)
      if(key === 'then' || typeof key === 'symbol')return undefined
      return ()=>{throw new Error('Trusted agent context required; use memory-net.forAgent(agent)')}
    }})
  } else {
    try {api = openHostApi(cfg,netOf,cfg.default_workspace,closeAllNets)}
    catch(e){warn(ctx,'memory-net 打开失败（shared）：'+String(e));return null}
  }
  ctx.provide('memory-net',api)
  const select = (args:Dict,exec?:{agent?:unknown;signal?:AbortSignal}) => {
    if(cfg.context.mode === 'shared')return {net:netOf(workspaceDir(cfg,str(args.workspace,cfg.default_workspace))),run:args.run_id as string|undefined,task:args.task_id as string|undefined,workspace:str(args.workspace,cfg.default_workspace)}
    rejectSelectors(args)
    const b=bindingOf(exec?.agent,exec?.signal)
    return {net:netOf(b.dir),run:b.sessionId,task:b.sessionId,workspace:'current'}
  }

  // ---- 模型工具 1：按预算激活共享记忆 ----
  if (cfg.tools.recall) {
    const recall: ToolDef = {
      name: 'memory_net_recall',
      description:
        '从共享记忆网按预算激活当前需要的节点（约束置顶、进度、观测、提示、推断、路径摘要）。' +
        '同任务多 agent 协作时，先 recall 再动手——读到的进度/路径是其他 agent 共享的。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索词（可空 = 精选持久提示/已审阅结论，不是原始日志）' },
          view: { type: 'string', enum: ['raw', 'curated'], description: '默认精选；raw仅本次调用用于诊断' },
          workspace: { type: 'string', description: `workspace 名（默认 ${cfg.default_workspace}）` },
          run_id: { type: 'string' },
          task_id: { type: 'string' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
        render: (_args, value) => [{ type: 'text', text: String((value as { text?: string })?.text ?? '') }],
      },
      execute: (args,exec) => {
        const selected=select(args,exec)
        const r = selected.net.activate(str(args.query, ''), activateOpts(cfg, selected.run, selected.task, args.view === undefined ? cfg.recall.view : args.view))
        return { text: renderActivation(r) }
      },
    }
    if(cfg.context.mode === 'session') {
      for(const key of ['workspace','run_id','task_id'])delete (recall.parameters.properties as Dict)[key]
      recall.parameters.additionalProperties=false
      recall.description='Recall memory for the trusted current project/session only. raw is diagnostic within the same boundary; no cross-session selectors.'
    }
    ctx.tools.register(recall)
  }

  // ---- 模型工具 2：写推断/提示（observation 写路径不在此暴露——硬边界）----
  if (cfg.tools.write) {
    const write: ToolDef = {
      name: 'memory_net_write',
      description:
        '向共享记忆网写一条推断（inference，需 confidence）或提示（tip）。' +
        '注意：物理观测（observation）只能由工具桥/宿主写入——工具执行结果会自动入网，你无需也不可伪造观测。',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['inference', 'tip'], description: '节点类型（observation 不允许）' },
          text: { type: 'string', description: '内容' },
          confidence: { type: 'number', description: 'inference 必填 0~1' },
          based_on: { type: 'array', items: { type: 'string' }, description: '依赖的节点 id（inference 推荐）' },
          strategy: { type: 'string', description: 'tip: 策略' },
          recovery: { type: 'string', description: 'tip: 恢复建议' },
          workspace: { type: 'string' },
          run_id: { type: 'string' },
          task_id: { type: 'string' },
        },
        required: ['kind', 'text'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            saved: { type: 'boolean', const: true },
            id: { type: 'string' },
            kind: { type: 'string' },
            workspace: { type: 'string' },
          },
          required: ['saved', 'id', 'kind', 'workspace'],
        },
        render: (_args, value) => {
          const v = value as { id?: string; kind?: string; workspace?: string }
          return [{ type: 'text', text: `memory saved: id=${v.id} kind=${v.kind} workspace=${v.workspace}` }]
        },
      },
      execute: (args,exec) => {
        const kind = str(args.kind, '')
        const selected=select(args,exec)
        const ws = selected.workspace
        const net = selected.net
        // 双保险 1：kind 白名单在工具面再拒一次（schema 层 enum 之外的第二道门）。
        // 拒绝路径抛 Error（宿主转为工具失败内容回给模型）——kokoa 插件先例同款。
        if (kind === 'observation' || kind === 'constraint' || kind === 'progress') {
          throw new Error(`模型不得写 ${kind}——observation 仅工具桥/宿主（api.observe），constraint 仅宿主，progress 走宿主交接面`)
        }
        if (kind !== 'inference' && kind !== 'tip') {
          throw new Error('kind 必须 inference|tip')
        }
        if (kind === 'inference' && num(args.confidence) === undefined) {
          throw new Error('inference 必须带 confidence（0~1）')
        }
        // 双保险 2：即便白名单漏了，核心 store 的 WriteForbiddenError 仍会拦（同样向上抛）
        const n = net.add(kind, {
          text: str(args.text, ''),
          confidence: num(args.confidence),
          based_on: Array.isArray(args.based_on) ? (args.based_on as string[]) : [],
          run_id: selected.run ?? null,
          task_id: cfg.context.mode === 'session' ? null : selected.task ?? null,
          payload: kind === 'tip' ? {
            ...(args.strategy !== undefined ? { strategy: args.strategy } : {}),
            ...(args.recovery !== undefined ? { recovery: args.recovery } : {}),
          } : undefined,
        })
        return { saved: true as const, id: n.id, kind: n.kind, workspace: ws }
      },
    }
    if(cfg.context.mode === 'session') {
      for(const key of ['workspace','run_id','task_id'])delete (write.parameters.properties as Dict)[key]
      write.parameters.additionalProperties=false
      write.description='Write inference/tip to the trusted current project/session. Observation is host-only. Session context is assigned by the host, not by arguments.'
    }
    ctx.tools.register(write)
  }

  // ---- 宿主工具桥：工具结果自动 observe 入网（写纪律：observation 仅宿主路径）----
  // ctx.on 是混合在 cordis ctx 上的事件总线方法（非服务属性，无需 inject 声明）；
  // 若未来 cordis 守卫收敛到它，try/catch 兜底降级明示，绝不崩宿主。
  if (cfg.auto_observe.enabled) {
    const bus = ctx.on
    if (typeof bus !== 'function') {
      warn(ctx, 'auto_observe 已启用但 ctx.on 缺失（cordis 事件总线不可达）——自动观测关闭，其余接缝不受影响')
    } else {
      try {
        installAutoObserve({ on: bus.bind(ctx) }, cfg, netOf, { warn: (m) => warn(ctx, m),...(cfg.context.mode === 'session'?{binding:(exec)=>bindingOf(exec.agent,exec.signal)}:{}) })
      } catch (e) {
        warn(ctx, `auto_observe 订阅失败（自动观测关闭，其余接缝不受影响）: ${String((e as Error)?.message ?? e)}`)
      }
    }
  }

  // ---- systemPrompt 区段：activate 注入（组装期求值，预算在本包内）----
  // 注册本身 try/catch：真实 dsh 对同名 section 重复注册会抛错——
  // WeakMap 幂等已拦同 ctx 重复 apply，这里兑底不同 ctx 但同名宿主的极端形态（软降级不崩宿主）
  try {
    ctx.systemPrompt.section({
      name: 'memory-net',
      order: cfg.inject.section_order,
      text: (context) => {
        try {
          const binding=cfg.context.mode === 'session'?bindingOf(assemblyAgent(context),(context as {signal?:AbortSignal})?.signal):null
          const net = netOf(binding?.dir ?? workspaceDir(cfg, cfg.default_workspace))
          const r = net.activate('', activateOpts(cfg,binding?.sessionId,binding?.sessionId))
          if (r.nodes.length === 0 && !r.trail) return ''
          return renderActivation(r)
        } catch (e) {
          warn(ctx, `memory-net 注入失败（软降级为空区段）: ${String((e as Error)?.message ?? e)}`)
          return ''
        }
      },
    })
  } catch (e) {
    warn(ctx, `memory-net section 注册失败（其余接缝不受影响）: ${String((e as Error)?.message ?? e)}`)
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      closeAllNets()
      appliedCtxs.delete(ctx)
    }, 'memory-net databases')
  }
  if (typeof ctx === 'object' && ctx !== null) appliedCtxs.set(ctx, api)
  return api
}

/** 测试/宿主全量清理：关闭 netOf 缓存的所有实例。 */
export function closeAll(nets: Iterable<{ close(): void }>): void {
  for (const n of nets) n.close()
}
