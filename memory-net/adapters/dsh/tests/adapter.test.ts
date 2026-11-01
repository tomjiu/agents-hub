/**
 * dsh 适配包 mock ctx 契约测试——不依赖真实 dsh。
 *
 * 这是「dsh 上游升级兼容性锁」：本文件锁的是适配包对 ctx 契约面的全部假设，
 * 已对齐真实 dsh 0.1.2-rc.1（@deepseek-ai/dsh-system-prompt 的 PromptSection、
 * @deepseek-ai/dsh-tools 的 ToolDefinition/output、@deepseek-ai/cordis 的 inject
 * 强制声明——2026-09-10 实勘）。dsh 升级后重跑：官方契约破坏假设 → 这里红灯，
 * 失败点即接缝处。
 *
 * 另锁适配包自身行为承诺：
 *  - inject 静态导出：['systemPrompt', 'tools']（cordis 服务访问守卫强制）
 *  - 写纪律硬边界：模型工具永远拿不到 observation 写路径（工具面白名单 + 核心 WriteForbiddenError 双保险）
 *  - 降级明示：ctx 能力缺失 / enabled=false / 打开失败 → 不挂接缝、不崩宿主、stderr 可读
 *  - workspace 物理隔离 + 名字路径注入防护
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as adapter from '../src/index.js'
import { apply } from '../src/index.js'
import { probeCtx } from '../src/contract.js'
import { installAutoObserve } from '../src/bridge.js'
import { resolveConfig, workspaceDir } from '../src/config.js'
import type { DshCtx, ToolDef, SectionDef } from '../src/contract.js'

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'mn-dsh-'))
}
function cleanup(p: string): void {
  rmSync(p, { recursive: true, force: true })
}

/** 按真实契约调用 section.text（函数形态；若未来遇 string 形态显式报错而非静默）。 */
function renderSection(s: SectionDef, context: unknown = {}): string {
  if (typeof s.text !== 'function') throw new Error(`section.text 应为函数形态，实为 ${typeof s.text}`)
  return s.text(context)
}

/** mock dsh ctx：记录全部注册调用（形态对齐真实 cordis 接缝面）。 */
function mockCtx(opts: { withBus?: boolean } = {}): {
  ctx: DshCtx; provided: Map<string, unknown>; tools: ToolDef[]; sections: SectionDef[]; warns: string[]
  bus: Map<string, Array<(...a: unknown[]) => void>>; emit: (event: string, ...args: unknown[]) => void
} {
  const provided = new Map<string, unknown>()
  const tools: ToolDef[] = []
  const sections: SectionDef[] = []
  const warns: string[] = []
  const bus = new Map<string, Array<(...a: unknown[]) => void>>()
  const ctx: DshCtx = {
    provide: (k, api) => provided.set(k, api),
    tools: { register: (d) => tools.push(d) },
    systemPrompt: { section: (d) => sections.push(d) },
    logger: { warn: (m) => warns.push(m), info: () => {} },
  }
  if (opts.withBus) {
    // cordis 事件总线最小面：ctx.on（混合在 ctx 上）——真实 emit 见 dsh-tools notifyResult
    ctx.on = (event: string, listener: (...a: unknown[]) => void) => {
      const arr = bus.get(event) ?? []
      arr.push(listener)
      bus.set(event, arr)
    }
  }
  const emit = (event: string, ...args: unknown[]) => {
    for (const l of bus.get(event) ?? []) l(...args)
  }
  return { ctx, provided, tools, sections, warns, bus, emit }
}

// ---------- 契约锁：模块导出面（真实 dsh 加载的入口假设） ----------

test('契约锁: 模块导出 name/apply/inject——inject 声明是 cordis 服务访问的强制前提', () => {
  assert.equal(typeof adapter.name, 'string')
  assert.equal(typeof adapter.apply, 'function')
  // cordis：未声明 inject 即访问 ctx.systemPrompt/ctx.tools → 抛 cannot get property without inject
  assert.deepEqual(adapter.inject, ['systemPrompt', 'tools'])
})

test('契约锁: 工具 def 含必填 output（schema + render）——真实 ToolDefinition 缺 output 即违约', () => {
  const root = makeRoot()
  try {
    const { ctx, tools } = mockCtx()
    apply(ctx, { workspaces_root: join(root, 'ws'), default_workspace: 'main' })
    assert.equal(tools.length, 2)
    for (const t of tools) {
      assert.equal(typeof t.name, 'string')
      assert.equal(typeof t.description, 'string')
      assert.equal(t.parameters?.type, 'object')
      assert.ok(t.output, `${t.name} 缺 output（真实 dsh 必填）`)
      assert.equal(typeof t.output.render, 'function')
      assert.equal((t.output.schema as { type?: string }).type, 'object')
      // render 纯函数冒烟：canonical 值 → text 块数组
      const blocks = t.output.render({}, {})
      assert.ok(Array.isArray(blocks) && blocks.every((b) => b.type === 'text' && typeof b.text === 'string'))
    }
  } finally {
    cleanup(root)
  }
})

// ---------- apply 接线 ----------

test('apply 正常接线: provide 服务 + 2 工具 + 1 区段（name/order/text 形态）；host api observe 可写', () => {
  const root = makeRoot()
  try {
    const { ctx, provided, tools, sections } = mockCtx()
    const api = apply(ctx, { workspaces_root: join(root, 'ws'), default_workspace: 'main' })
    assert.ok(api, 'apply 应返回 host api')
    assert.equal(provided.get('memory-net'), api, 'provide(memory-net) 注册且同一实例')
    assert.deepEqual(tools.map((t) => t.name).sort(), ['memory_net_recall', 'memory_net_write'])
    assert.equal(sections.length, 1)
    assert.equal(sections[0]!.name, 'memory-net', '真实契约是 name（非 id）')
    assert.equal(typeof sections[0]!.order, 'number')
    assert.equal(typeof sections[0]!.text, 'function', '真实契约是 text 函数（非 render）')

    // host 半区：物理观测仅此入口
    const n = api!.observe({ key: 'build.status', text: '编译通过', source: 'tool' })
    assert.equal(n.kind, 'observation')
    assert.equal(n.source, 'tool')

    // close 幂等
    api!.close()
    api!.close()
  } finally {
    cleanup(root)
  }
})

test('memory_net_write: 伪造 observation/constraint/progress 抛错拒绝；inference 缺 confidence 抛错；inference/tip 返回 canonical 值', () => {
  const root = makeRoot()
  try {
    const { ctx, tools } = mockCtx()
    const api = apply(ctx, { workspaces_root: join(root, 'ws'), default_workspace: 'main' })!
    const write = tools.find((t) => t.name === 'memory_net_write')!
    assert.ok(write, 'write 工具已注册')
    const realObs = api.observe({ key: 'k', text: '真观测', source: 'tool' })

    assert.throws(() => write.execute({ kind: 'observation', text: '伪造观测' }), /模型不得写 observation/, '工具面白名单拒绝（第一道门）')
    assert.throws(() => write.execute({ kind: 'constraint', text: '伪造约束' }), /不得写 constraint/)
    assert.throws(() => write.execute({ kind: 'progress', text: '伪造进度' }), /不得写 progress/)
    assert.throws(() => write.execute({ kind: 'inference', text: '没置信度' }), /confidence/)
    assert.throws(() => write.execute({ kind: 'nonsense', text: 'x' }), /kind 必须/)

    const okInf = write.execute({ kind: 'inference', text: '登录问题在回调', confidence: 0.6, based_on: [realObs.id] }) as { saved: boolean; id: string; kind: string; workspace: string }
    assert.equal(okInf.saved, true)
    assert.match(okInf.id, /^n\d+$/)
    assert.equal(okInf.kind, 'inference')
    assert.equal(okInf.workspace, 'main')
    // canonical 值满足自身 output.schema（宿主强制校验的模拟）
    const infText = write.output.render({}, okInf)[0]!.text
    assert.match(infText, /memory saved: id=n\d+ kind=inference workspace=main/)

    const okTip = write.execute({ kind: 'tip', text: '先看日志', strategy: '查 stderr' }) as { id: string; kind: string }
    assert.equal(okTip.kind, 'tip')
  } finally {
    cleanup(root)
  }
})

test('memory_net_recall: 双 agent 共享——host 写 progress/observation，工具侧读到（预算内 constraint 置顶）', () => {
  const root = makeRoot()
  try {
    const { ctx, tools, provided } = mockCtx()
    const api = apply(ctx, { workspaces_root: join(root, 'ws'), default_workspace: 'main' })!
    const recall = tools.find((t) => t.name === 'memory_net_recall')!

    api.addConstraint({ key: 'no-force-push', text: '永不 force push main', mode: 'forbid' })
    api.updateProgress('t1', { status: 'doing', summary: '登录页 60%' })
    api.observe({ key: 'build.status', text: '编译通过', source: 'tool' })

    const out = (recall.execute({ query: '登录 进度' }) as { text: string }).text
    assert.match(out, /\[约束\] 永不 force push main/, 'constraint 置顶')
    assert.match(out, /\[进度·doing\] 登录页 60%/, '共享 progress 可被另一 agent 读到（带状态渲染）')
    assert.match(out, /\[观测\] 编译通过/)
    assert.match(out, /裁掉 0/)

    // workspace 切换物理隔离：另一个 workspace 读不到 main 的内容
    const other = (recall.execute({ workspace: 'side', query: '登录 进度' }) as { text: string }).text
    assert.ok(!other.includes('登录页 60%'), '跨 workspace 不串读')

    // 非法 workspace 名 → 抛错（工具失败内容回给模型，不崩宿主）
    assert.throws(() => recall.execute({ workspace: '../escape' }), /非法 workspace/)

    // close 走 host api（缓存实例同源，双重 close 幂等）
    assert.equal(provided.get('memory-net'), api)
    api.close()
  } finally {
    cleanup(root)
  }
})

test('section text: 空网返回空串（不占 prompt 预算）；有内容时含约束与进度；再次写后组装增量可见', () => {
  const root = makeRoot()
  try {
    const { ctx, sections } = mockCtx()
    apply(ctx, { workspaces_root: join(root, 'ws'), default_workspace: 'main' })
    const section = sections[0]!
    assert.match(renderSection(section), /^$/, '空网 → 空区段')

    const api = apply(ctx, { workspaces_root: join(root, 'ws'), default_workspace: 'main' })!
    api.addConstraint({ key: 'c1', text: '必须先跑测试', mode: 'require' })
    api.updateProgress('t2', { status: 'doing', summary: '重构进行中' })
    const out = renderSection(section)
    assert.match(out, /\[约束\] 必须先跑测试/)
    assert.match(out, /\[进度·doing\] 重构进行中/)
    api.close()
  } finally {
    cleanup(root)
  }
})

test('降级路径: enabled=false 不挂任何接缝；ctx 探测失败不挂且明示；workspace 名非法 → apply 返回 null', () => {
  const root = makeRoot()
  try {
    const { ctx, provided, tools, sections } = mockCtx()
    const off = apply(ctx, { enabled: false, workspaces_root: join(root, 'ws') })
    assert.equal(off, null)
    assert.equal(provided.size, 0)
    assert.equal(tools.length, 0)
    assert.equal(sections.length, 0)
    assert.ok(ctx.logger, '降级路径在 logger 缺失时也必须安全（stderr 回退）')

    const bad = mockCtx()
    const degraded = apply(bad.ctx, { workspaces_root: join(root, 'ws'), default_workspace: '../escape' })
    assert.equal(degraded, null, '非法 workspace 名 → 降级不抛')
    assert.match(bad.warns.join('\n'), /打开失败/, '降级原因明示')
  } finally {
    cleanup(root)
  }
})

test('workspaceDir: 名字路径注入防护 + config 默认值解析（~ 与 ${KOKOA_STATE_DIR} 展开）', () => {
  const cfg = resolveConfig({ workspaces_root: '/data/mn' })
  assert.equal(workspaceDir(cfg, 'main'), '/data/mn/main')
  for (const bad of ['../escape', 'a/b', 'a\\b', '.', '..', '']) {
    assert.throws(() => workspaceDir(cfg, bad), `应拒绝: ${JSON.stringify(bad)}`)
  }
  // 默认 root 落点
  const def = resolveConfig({})
  assert.ok(def.workspaces_root.includes('memory-net'), `默认 root: ${def.workspaces_root}`)
  const env = resolveConfig({ workspaces_root: '${KOKOA_STATE_DIR}/mn' })
  assert.ok(!env.workspaces_root.includes('${'), '函数形态 replacer 不展开特殊序列')
  // default_workspace 兜底
  assert.equal(workspaceDir(cfg), '/data/mn/default')
  // root 不要求预先存在（open 时按需创建），但配置解析纯函数无 IO
  assert.equal(typeof cfg.budgets.max_nodes, 'number')
  // 工具面 max_obs_chars 有默认（骨架参数，防超长观测撑爆注入——当前版本仅透传记录）
  assert.equal(cfg.tools.max_obs_chars, 4000)
})

test('host api 全景: addInference/addTip/addConstraint/exportPkg/activate + close 后目录仍存（workspace 物理存在）', () => {
  const root = makeRoot()
  try {
    const { ctx } = mockCtx()
    const api = apply(ctx, { workspaces_root: join(root, 'ws'), default_workspace: 'main' })!
    const inf = api.addInference({ text: '推断', confidence: 0.5 })
    assert.equal(inf.kind, 'inference')
    assert.equal(inf.confidence, 0.5)
    const tip = api.addTip({ text: '提示', strategy: 's' })
    assert.equal(tip.kind, 'tip')
    assert.equal(tip.payload?.strategy, 's')
    const c = api.addConstraint({ key: 'c', text: '约束', mode: 'require' })
    assert.equal(c.kind, 'constraint')
    api.appendTrail('r1', { action: '步骤一' })
    assert.equal(api.replayTrail('r1').length, 1)
    const r = api.activate('推断', {})
    assert.ok(r.nodes.length >= 1)
    const pkg = api.exportPkg()
    assert.equal(pkg.schema_version, 1)
    api.close()
    assert.ok(existsSync(api.workspaceDir), 'workspace 目录（物理记忆网）保留')
  } finally {
    cleanup(root)
  }
})

// ---------- auto-observe：宿主工具结果自动入网（dsh-tools 'tools/result' 事件桥） ----------

test('auto-observe 成功路径: tools/result 事件 → observation 落网（key=tool:<名>、payload 带 call_id、args 摘要进文本）', () => {
  const root = makeRoot()
  try {
    const { ctx, tools, emit, bus } = mockCtx({ withBus: true })
    const api = apply(ctx, { workspaces_root: join(root, 'ws'), default_workspace: 'main' })!
    assert.equal((bus.get('tools/result') ?? []).length, 1, 'tools/result 恰好订阅一次')

    emit('tools/result',
      { callId: 'c-1', name: 'browser_open', arguments: { url: 'https://example.com' } },
      { isError: false, value: { title: 'Example Domain' } })

    const r = api.activate('browser_open', {})
    const hit = r.nodes.find((x) => x.node.key === 'tool:browser_open')
    assert.ok(hit, '观测已入网且 key=tool:browser_open')
    assert.equal(hit!.node.kind, 'observation')
    assert.equal(hit!.node.source, 'tool')
    assert.equal(hit!.node.payload.call_id, 'c-1')
    assert.equal(hit!.node.payload.tool, 'browser_open')
    assert.equal(hit!.node.payload.is_error, false)
    assert.match(hit!.node.text, /工具 browser_open 成功/, '文本含工具名与结果态')
    assert.match(hit!.node.text, /Example Domain/, '结果摘要进文本')
    assert.match(hit!.node.text, /example\.com/, '参数摘要进文本（协作 agent 可分辨同工具不同调用）')

    // 模型面可达：recall 能读到这条自动观测
    const out = (tools.find((t) => t.name === 'memory_net_recall')!.execute({ query: 'browser_open' }) as { text: string }).text
    assert.match(out, /\[观测\] 工具 browser_open 成功/)
    api.close()
  } finally {
    cleanup(root)
  }
})

test('auto-observe 失败路径: isError=true 也入网（include_error 默认开）；include_error=false 时跳过', () => {
  const root = makeRoot()
  try {
    const { ctx, emit } = mockCtx({ withBus: true })
    const api = apply(ctx, { workspaces_root: join(root, 'ws'), default_workspace: 'main' })!
    emit('tools/result',
      { callId: 'c-2', name: 'bash', arguments: { cmd: 'make test' } },
      { isError: true, error: { message: 'exit 1' } })
    const hit = api.activate('bash', {}).nodes.find((x) => x.node.key === 'tool:bash')
    assert.ok(hit, '失败结果同样是有价值的协作事实')
    assert.equal(hit!.node.payload.is_error, true)
    assert.match(hit!.node.text, /工具 bash 失败/)
    assert.match(hit!.node.text, /exit 1/)
    api.close()

    const { ctx: ctx2, emit: emit2 } = mockCtx({ withBus: true })
    const api2 = apply(ctx2, { workspaces_root: join(root, 'ws2'), default_workspace: 'main', auto_observe: { include_error: false } })!
    emit2('tools/result',
      { callId: 'c-3', name: 'bash', arguments: { cmd: 'x' } },
      { isError: true, error: { message: 'boom' } })
    assert.equal(api2.activate('bash', {}).nodes.filter((x) => x.node.kind === 'observation').length, 0, 'include_error=false 不入网')
    emit2('tools/result', { callId: 'c-4', name: 'bash', arguments: { cmd: 'y' } }, { isError: false, value: 'ok' })
    assert.ok(api2.activate('bash', {}).nodes.find((x) => x.node.key === 'tool:bash'), '成功结果不受 include_error 影响')
    api2.close()
  } finally {
    cleanup(root)
  }
})

test('auto-observe 自身工具过滤: memory_net_* 的结果不递归入网（防自指噪声）', () => {
  const root = makeRoot()
  try {
    const { ctx, emit } = mockCtx({ withBus: true })
    const api = apply(ctx, { workspaces_root: join(root, 'ws'), default_workspace: 'main' })!
    emit('tools/result',
      { callId: 'c-5', name: 'memory_net_write', arguments: { kind: 'tip', text: 'x' } },
      { isError: false, value: { saved: true, id: 'n1' } })
    emit('tools/result',
      { callId: 'c-6', name: 'memory_net_recall', arguments: { query: 'q' } },
      { isError: false, value: { text: '激活 0 节点' } })
    assert.equal(api.activate('', {}).nodes.filter((x) => x.node.kind === 'observation').length, 0, '记忆操作自身不入网')
    api.close()
  } finally {
    cleanup(root)
  }
})

test('auto-observe 截断: 超长结果/参数 → 文本截断 + payload.truncated；短结果不标截断', () => {
  const root = makeRoot()
  try {
    const { ctx, emit } = mockCtx({ withBus: true })
    const api = apply(ctx, {
      workspaces_root: join(root, 'ws'), default_workspace: 'main',
      auto_observe: { max_chars: 100, args_chars: 30 },
    })!
    emit('tools/result',
      { callId: 'c-7', name: 'read_file', arguments: { path: '/very/long/path/'.padEnd(120, 'x') } },
      { isError: false, value: 'r'.repeat(5000) })
    const hit = api.activate('read_file', {}).nodes.find((x) => x.node.key === 'tool:read_file')
    assert.ok(hit)
    assert.equal(hit!.node.payload.truncated, true)
    assert.ok(hit!.node.text.length <= 100 + 30 + 40, `文本有界（实长 ${hit!.node.text.length}）`)
    assert.match(hit!.node.text, /…/, '截断以省略号明示（不静默丢字）')
    api.close()

    const { ctx: ctx2, emit: emit2 } = mockCtx({ withBus: true })
    const api2 = apply(ctx2, { workspaces_root: join(root, 'ws2'), default_workspace: 'main' })!
    emit2('tools/result', { callId: 'c-8', name: 'small', arguments: { a: 1 } }, { isError: false, value: { ok: true } })
    const hit2 = api2.activate('small', {}).nodes.find((x) => x.node.key === 'tool:small')
    assert.equal(hit2!.node.payload.truncated, false)
    api2.close()
  } finally {
    cleanup(root)
  }
})

test('auto-observe 嵌套过滤: exec.parent 存在（嵌套 dispatch）默认跳过；include_nested=true 才入网', () => {
  const root = makeRoot()
  try {
    const { ctx, emit } = mockCtx({ withBus: true })
    const api = apply(ctx, { workspaces_root: join(root, 'ws'), default_workspace: 'main' })!
    emit('tools/result',
      { callId: 'c-9', name: 'run_code', parent: 'tok-1', arguments: {} },
      { isError: false, value: 1 })
    assert.equal(api.activate('run_code', {}).nodes.filter((x) => x.node.kind === 'observation').length, 0, '嵌套子 dispatch 默认不观察（fail-open：字段缺失视为根调用）')
    api.close()

    const { ctx: ctx2, emit: emit2 } = mockCtx({ withBus: true })
    const api2 = apply(ctx2, { workspaces_root: join(root, 'ws2'), default_workspace: 'main', auto_observe: { include_nested: true } })!
    emit2('tools/result',
      { callId: 'c-10', name: 'run_code', parent: 'tok-2', arguments: {} },
      { isError: false, value: 2 })
    assert.ok(api2.activate('run_code', {}).nodes.find((x) => x.node.key === 'tool:run_code'), 'include_nested=true 入网')
    api2.close()
  } finally {
    cleanup(root)
  }
})

test('auto-observe 软降级: ctx.on 缺失 → 自动观测关闭并明示 warn，其余接缝照常挂载（不整体降级）', () => {
  const root = makeRoot()
  try {
    const { ctx, tools, sections, warns } = mockCtx() // 无事件总线
    const api = apply(ctx, { workspaces_root: join(root, 'ws'), default_workspace: 'main' })
    assert.ok(api, 'auto-observe 不可用不拖垮其余接缝')
    assert.equal(tools.length, 2)
    assert.equal(sections.length, 1)
    assert.match(warns.join('\n'), /自动观测关闭/, '降级原因明示')
    api!.close()
  } finally {
    cleanup(root)
  }
})

test('auto-observe 自我隔离: 写入失败不外溢（listener 内吞掉并 warn 计数——宿主工具执行永不受影响）', () => {
  const root = makeRoot()
  try {
    const { ctx } = mockCtx({ withBus: true })
    const captured: Array<(...a: unknown[]) => void> = []
    const fakeCtx = { on: (_e: string, l: (...a: unknown[]) => void) => captured.push(l) }
    const cfg = resolveConfig({ workspaces_root: join(root, 'ws') })
    const warns: string[] = []
    installAutoObserve(fakeCtx, cfg, () => { throw new Error('db closed') }, { warn: (m) => warns.push(m) })
    assert.equal(captured.length, 1)
    // 不抛——dsh 侧已有 containment（notifyResult try/catch），这里自我隔离是双保险
    assert.doesNotThrow(() => captured[0]!({ callId: 'c', name: 'bash', arguments: {} }, { isError: false, value: 1 }))
    assert.doesNotThrow(() => captured[0]!({ callId: 'c2', name: 'bash', arguments: {} }, { isError: false, value: 2 }))
    assert.ok(warns.length >= 2, `失败被 warn 计数（${warns.length} 条）`)
    assert.match(warns[0]!, /auto-observe/)
  } finally {
    cleanup(root)
  }
})

test('auto-observe 配置: resolveConfig 默认值 + 非法值防御；enabled=false 不订阅事件', () => {
  const cfg = resolveConfig({})
  assert.deepEqual(cfg.auto_observe, { enabled: true, max_chars: 2000, args_chars: 200, include_error: true, include_nested: false })
  // 会话 14 P3：boolOr 升级为识别字符串/数字形态（'false'/0 关、'true'/1 开），非法值回落默认
  const def = resolveConfig({ auto_observe: { enabled: false, max_chars: 'x', args_chars: -5, include_error: 1, include_nested: 'x' } })
  assert.equal(def.auto_observe.enabled, false)
  assert.equal(def.auto_observe.max_chars, 2000, '非数字回退默认')
  assert.equal(def.auto_observe.args_chars, 200, '负数回退默认')
  assert.equal(def.auto_observe.include_error, true, '1 识别为 true（数字形态）')
  assert.equal(def.auto_observe.include_nested, false, "非法值（'x'）回退默认")

  const root = makeRoot()
  try {
    const { ctx, bus } = mockCtx({ withBus: true })
    apply(ctx, { workspaces_root: join(root, 'ws'), auto_observe: { enabled: false } })
    assert.equal((bus.get('tools/result') ?? []).length, 0, 'enabled=false 不订阅')
  } finally {
    cleanup(root)
  }
})

// ---- 会话 12：P2-4 close 全量 / P2-10 重复 apply 幂等 ----
import { MemoryNet } from '../../../src/store.js'

test('P2-4: HostApi.close 全量关闭——非默认 workspace 实例不泄漏（db 已关即不可再用）', () => {
  const root = makeRoot()
  const origOpen = MemoryNet.open
  const opened: MemoryNet[] = []
  try {
    MemoryNet.open = function (this: unknown, ...args: Parameters<typeof origOpen>) {
      const net = origOpen.apply(this, args)
      opened.push(net)
      return net
    } as typeof MemoryNet.open
    const { ctx, tools } = mockCtx()
    const api = apply(ctx, { workspaces_root: join(root, 'ws'), default_workspace: 'main' })!
    const recall = tools.find((t) => t.name === 'memory_net_recall')!
    recall.execute({ workspace: 'side', query: '' })
    assert.equal(opened.length, 2, '默认 + side 两个实例')
    api.close()
    assert.throws(() => opened[0]!.activate('', {}), '默认实例已关闭')
    assert.throws(() => opened[1]!.activate('', {}), '非默认实例也已关闭（P2-4）')
  } finally {
    MemoryNet.open = origOpen
    cleanup(root)
  }
})

test('P2-10: 同一 ctx 重复 apply 幂等返回既有实例，section/tools 不重复注册', () => {
  const root = makeRoot()
  try {
    const { ctx, tools, sections, warns } = mockCtx()
    const api1 = apply(ctx, { workspaces_root: join(root, 'ws'), default_workspace: 'main' })!
    const api2 = apply(ctx, { workspaces_root: join(root, 'ws'), default_workspace: 'main' })
    assert.equal(api2, api1, '幂等返回同一实例（真实 dsh 同名重复注册会炸宿主）')
    assert.equal(tools.length, 2, '工具不重复注册')
    assert.equal(sections.length, 1, 'section 不重复注册')
    assert.ok(warns.some((w) => w.includes('重复 apply')), '幂等跳过需明示告警')
    api1.close()
  } finally {
    cleanup(root)
  }
})

// ---------------------------------------------------------------------------
// 会话 14 P3：顶层 enabled 走 boolOr 哲学（"false" 可关掉，不再 Boolean() 强转）
// ---------------------------------------------------------------------------

test('P3-14b: resolveConfig enabled 布尔防御——"false"/0 关掉，"true"/1 开启，非法值回落默认', () => {
  assert.equal(resolveConfig({ enabled: 'false' }).enabled, false)
  assert.equal(resolveConfig({ enabled: 0 }).enabled, false)
  assert.equal(resolveConfig({ enabled: 'true' }).enabled, true)
  assert.equal(resolveConfig({ enabled: 1 }).enabled, true)
  assert.equal(resolveConfig({ enabled: 'nonsense' }).enabled, true) // 非法值回落默认（开）
  assert.equal(resolveConfig({}).enabled, true)
  // auto_observe 五项同一哲学：字符串形态同样可关
  assert.equal(resolveConfig({ auto_observe: { enabled: 'false' } }).auto_observe.enabled, false)
})
