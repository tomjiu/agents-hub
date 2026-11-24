/**
 * M1 红灯测试 —— 断言 issue #2 M1 的期望行为，当前 schema1 实现必然失败。
 *
 * 这些测试刻意放在 tests/m1-red/ 子目录：默认套件 glob 是 dist/tests/*.test.js，
 * 不匹配子目录，因此不影响常规回归；按 M0 计划显式运行以取得红灯证据：
 *
 *   npm --prefix plugins/memory-net run build
 *   node --test plugins/memory-net/dist/tests/m1-red/*.test.js
 *
 * 每个测试对应 docs/superpowers/plans/2026-11-24-memory-provenance-m1.md 的任务项。
 * M1 落地后这些测试应转绿并移入常规套件。全部使用独立临时库，不触碰真实库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryNet } from '../../src/store.js'
import { makeTempWs, cleanupDir } from '../helpers.js'

/** R1 — 操作账本：导出必须携带稳定操作身份（operations），重放才可去重。
 *  M1 任务 1：为成功事务记录稳定操作身份。 */
test('R1 export carries a stable operation ledger for replay dedup', () => {
  const ws = makeTempWs('mn-m1-red-ledger-')
  const net = MemoryNet.open(ws, { agentId: 'red-fixture', role: 'host' })
  try {
    net.add('observation', { text: 'event one', source: 'tool' })
    net.add('observation', { text: 'event two', source: 'tool' })
    const pkg = net.exportPkg() as unknown as Record<string, unknown>
    assert.ok(Array.isArray(pkg.operations), 'export must include an operations ledger (M1 task 1)')
    assert.ok((pkg.operations as unknown[]).length >= 2, 'each committed transaction must record one operation')
  } finally { net.close(); cleanupDir(ws) }
})

/** R2 — 引用漂移：progress 原地更新后，导出必须仍能复原 based_on 当时指向的快照。
 *  M1 任务 2：引用不随 current 内容漂移；导出/导入包括历史和引用。 */
test('R2 exported history reconstructs the progress state an inference referenced', () => {
  const ws = makeTempWs('mn-m1-red-drift-')
  const net = MemoryNet.open(ws, { agentId: 'red-fixture', role: 'host' })
  try {
    net.updateProgress('task-1', { status: 'doing', summary: 'before-state' })
    const progress = net.activate('', { task_id: 'task-1' }).nodes.map(r => r.node).find(n => n.kind === 'progress')!
    net.add('inference', { text: 'decided on before-state', confidence: .8, based_on: [progress.id] })
    net.updateProgress('task-1', { status: 'done', summary: 'after-state' })
    const pkg = JSON.stringify(net.exportPkg())
    assert.ok(pkg.includes('before-state'), 'export must retain the progress revision the inference referenced (M1 task 2)')
    const restored = JSON.parse(pkg) as { nodes: Array<{ id: string, text: string }> }
    const history = restored.nodes.filter(n => n.id === progress.id)
    assert.ok(history.length >= 2 || pkg.includes('"revisions"'), 'prior revision snapshots must be addressable after in-place update')
  } finally { net.close(); cleanupDir(ws) }
})

/** R3 — 毫秒墙钟不能作 CAS：同一毫秒内的并发更新必须被识别为冲突。
 *  M1 任务 1：不用 updated_at 毫秒作 CAS，不靠墙钟判先后。 */
test('R3 same-millisecond concurrent progress update is detected as conflict', () => {
  const ws = makeTempWs('mn-m1-red-cas-')
  const net = MemoryNet.open(ws, { agentId: 'red-fixture', role: 'host' })
  const realNow = Date.now
  try {
    const frozen = realNow()
    Date.now = () => frozen // 冻结墙钟：两次更新落在同一毫秒
    net.updateProgress('task-1', { status: 'doing', summary: 'alice writes' })
    const aliceState = net.activate('', { task_id: 'task-1' }).nodes.map(r => r.node).find(n => n.kind === 'progress')!
    const bobBase = aliceState.updated_at // bob 在 alice 写入后重读，但随后 alice 又改了同毫秒内容
    net.updateProgress('task-1', { status: 'doing', summary: 'alice writes again same ms' })
    const merged = net.updateProgress('task-1', { summary: 'bob stale write' }, { base_updated_at: bobBase })
    assert.equal(merged.conflict, true, 'same-millisecond stale write must be flagged, wall clock cannot order it (M1 task 1)')
  } finally {
    Date.now = realNow
    net.close(); cleanupDir(ws)
  }
})

/** R4 — 稳定操作锚点：GC 压缩 trail 后，原步骤坐标必须保持可定位。
 *  M1 任务 1：为成功事务记录稳定操作身份；trail 不能删除再重编号。 */
test('R4 trail step coordinates stay stable across GC compression', () => {
  const ws = makeTempWs('mn-m1-red-trail-')
  const net = MemoryNet.open(ws, { agentId: 'red-fixture', role: 'host' })
  try {
    const run = 'run-red'
    for (let i = 1; i <= 8; i++) net.appendTrail(run, { action: `step-${i}` })
    const before = net.replayTrail(run)
    const lastSeq = before[before.length - 1]!.seq
    net.gc({ trail_keep: 4 })
    const after = net.replayTrail(run)
    assert.ok(after.some(t => t.seq === lastSeq), `original step ${lastSeq} must remain addressable after GC (M1 task 1)`)
  } finally { net.close(); cleanupDir(ws) }
})

/** R5 — 状态变更 CAS：基于过期读取的 promote/demote 不能静默最后写入者获胜。
 *  M1 任务 1：并发更新 CAS 失败后显式重读，不自动 LWW。 */
test('R5 stale status transition is rejected or explicitly conflicted', () => {
  const ws = makeTempWs('mn-m1-red-lww-')
  const net = MemoryNet.open(ws, { agentId: 'red-fixture', role: 'host' })
  try {
    const evidence = net.add('observation', { text: 'evidence', source: 'tool' })
    const decision = net.add('inference', { text: 'decision', confidence: .8, based_on: [evidence.id] })
    // bob 读取 active 状态后，alice 率先 promote；
    // bob 基于过期 active 视图发起 demote —— 当前实现静默 LWW，M1 要求拒绝或显式冲突。
    net.promote(decision.id, { evidence: [evidence.id] })
    let staleWriteRejected = false
    try {
      net.demote(decision.id, { reason: 'bob acted on stale active view' })
    } catch {
      staleWriteRejected = true
    }
    const current = net.get(decision.id)!
    assert.ok(staleWriteRejected || current.conflict === true || Boolean(current.payload.conflict_detail),
      'stale-view status transition must be rejected or carry an explicit conflict record (M1 task 1)')
  } finally { net.close(); cleanupDir(ws) }
})
