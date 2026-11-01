/**
 * dsh ctx 最小结构契约（本包自声明，零 import dsh/cordis）。
 *
 * 只描述本适配包实际用到的表面——dsh 内部任何重构都不影响本包；
 * dsh 升级若改了这些接缝，防御式探测（能力缺失 → 降级明示）兜底。
 *
 * 2026-09-10 对齐真实 dsh 0.1.2-rc.1（实勘 @deepseek-ai/dsh-system-prompt /
 * @deepseek-ai/dsh-tools / @deepseek-ai/cordis 类型与源码）：
 *  - PromptSection = { name, order, text }（name 唯一，重复注册宿主抛错；
 *    text 为 string 或 (context) => string——旧骨架的 id/render 均不存在）
 *  - ToolDefinition = ToolSchema(name/description/parameters) + output（必填！
 *    ToolOutputDefinition = { schema, render }）+ execute(args, exec) → canonical JSON
 *  - cordis 对 ctx 上的服务属性强制 inject 声明：未声明即访问抛
 *    `cannot get property "X" without inject`——插件模块必须静态导出
 *    inject = ['systemPrompt', 'tools']（本包由 src/index.ts 导出）。
 */

/** dsh 工具模型面内容块（ContentBlock 的 text 形态，本包只用这一种）。 */
export interface TextBlock {
  type: 'text'
  text: string
}

/** dsh 工具输出声明（ToolOutputDefinition 最小面）：canonical 值 schema + 模型面渲染。 */
export interface ToolOutputDef {
  /** canonical 返回值的 JSON Schema（宿主对每个成功值强制校验）。 */
  schema: Record<string, unknown>
  /** 校验后的 canonical 值 → 模型可见内容块（纯函数，不得抛）。 */
  render: (args: unknown, value: unknown) => TextBlock[]
}

/** dsh 工具（模型可调用）的注册形态。 */
export interface ToolDef {
  name: string
  description: string
  /** JSON Schema 形态的参数声明（dsh 端透传给模型）。 */
  parameters: Record<string, unknown>
  /** 必填：canonical 输出声明（真实 dsh 缺失即违约）。 */
  output: ToolOutputDef
  /**
   * 执行体：args 为模型传参（已按 schema 解析）；返回 canonical JSON 值
   * （须满足 output.schema）。拒绝/失败路径抛 Error（宿主转为工具失败内容）。
   */
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown
}

/** dsh systemPrompt 区段注册形态（PromptSection 最小面）。 */
export interface SectionDef {
  /** 区段唯一名（重复注册宿主抛错）。 */
  name: string
  /** 排序权重（小者靠前）。 */
  order: number
  /** 组装期求值：string 或 (context) => string（本包内已含 activate 预算裁剪）。 */
  text: string | ((context: unknown) => string)
}

/** dsh 工具执行终态事件的最小消费面（dsh-tools 'tools/result' emit 事件，2026-09-10 实勘）。
 *
 *  真实形态（@deepseek-ai/dsh-tools ToolRegistry.notifyResult）:
 *    events.dispatch("emit", [scopeTarget(this, exec.agent), "tools/result", exec, result])
 *  listener 形态 (exec, result) => void；失败被 dsh 侧 containment（try/catch + Promise 兜底）。
 *  exec: ToolExecution（callId/name/arguments/agent?/parent?/token/signal——本包只用前四个）。
 *  result: ToolExecutionResult（success: isError=false+value；failure: isError=true+error）。
 */
export interface ToolResultExec {
  /** 调用 id（root/nested 各自持有；进 payload 供追溯）。 */
  readonly callId?: string | number
  /** 工具名。 */
  readonly name: string
  /** 已解析的模型传参（无损快照，冻结）。 */
  readonly arguments?: unknown
  /** 嵌套 dispatch 的父执行 token（存在即嵌套子调用；字段缺失 fail-open 视为根调用）。 */
  readonly parent?: unknown
}

/** 'tools/result' 事件的结果面（ToolExecutionResult 最小消费面）。 */
export interface ToolResultPayloadFace {
  /** 失败标记（isError=false 或缺失 = 成功）。 */
  readonly isError?: boolean
  /** 成功路径的 canonical 值（冻结无损 JSON）。 */
  readonly value?: unknown
  /** 失败路径的错误对象。 */
  readonly error?: unknown
}

/** dsh 插件运行时 ctx（本包用到的最小面）。 */
export interface DshCtx {
  /** 服务注册：key 唯一；重复注册由宿主按其策略处理（本包幂等调用前自检）。 */
  provide: (key: string, api: unknown) => void
  tools: {
    register: (def: ToolDef) => void
  }
  systemPrompt: {
    section: (def: SectionDef) => void
  }
  /** 可选：cordis 事件总线订阅面（混合在 ctx 上的方法，非服务属性——无需 inject 声明）。
   *  仅用于 auto-observe（'tools/result' 事件）；缺失时自动观测关闭，其余接缝不受影响。 */
  on?: (event: string, listener: (...args: unknown[]) => void) => void
  /** 可选：结构化日志/告警面（缺失时回退 stderr）。 */
  logger?: {
    warn: (msg: string) => void
    info: (msg: string) => void
  }
}

/** 运行时能力探测：ctx 上缺能力 → 返回人类可读原因（非 null = 降级）。 */
export function probeCtx(ctx: unknown): string | null {
  if (ctx == null || typeof ctx !== 'object') return 'ctx 非对象（dsh 未按插件形态注入）'
  const c = ctx as Partial<DshCtx>
  if (typeof c.provide !== 'function') return 'ctx.provide 缺失（无法注册 memory-net 服务）'
  if (!c.tools || typeof c.tools.register !== 'function') return 'ctx.tools.register 缺失（无法注册记忆工具）'
  if (!c.systemPrompt || typeof c.systemPrompt.section !== 'function') {
    return 'ctx.systemPrompt.section 缺失（无法注入记忆区段）'
  }
  return null
}
