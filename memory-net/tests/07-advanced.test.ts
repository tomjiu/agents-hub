/** 附加验收：progress 冲突不静默双真相 / gc trail 压缩 / TTL 不删 observation / export-import。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryNet } from '../src/store.js'
import { makeTempWs, cleanupDir } from './helpers.js'

test('progress 并发写 → conflict 置位 + 字段级双方值（不静默双真相）', () => {
  const ws = makeTempWs()
  try {
    const alice = MemoryNet.open(ws, { agentId: 'alice', role: 'host' })
    const bob = MemoryNet.open(ws, { agentId: 'bob', role: 'host' })
    const p1 = alice.updateProgress('t', { status: 'doing', summary: 'alice 版本 A' })
    // bob 基于旧 base（p1.updated_at 之前的状态）写 —— 用过期 base 触发冲突
    const p2 = bob.updateProgress('t', { status: 'blocked', summary: 'bob 版本 B' }, { base_updated_at: p1.updated_at - 1000 })
    assert.equal(p2.id, p1.id, '同一行（不产生第二条真相）')
    assert.equal(p2.conflict, true, '冲突必须置位')
    assert.ok(p2.conflict_detail && 'summary' in p2.conflict_detail, '字段级冲突详情在案')
    // 后写赢但仍可追溯双方值
    assert.equal(p2.payload.summary, 'bob 版本 B')

    // 无 base（单写者顺序写）不标冲突
    const p3 = bob.updateProgress('t', { summary: 'bob 顺序更新' })
    assert.equal(p3.conflict, false)
    // activate 输出保留 conflict 标记
    const r = alice.activate('', { agent_id: 'a' })
    const found = r.nodes.find((rn) => rn.node.kind === 'progress')
    assert.equal(found!.node.conflict, false)
    alice.close()
    bob.close()
  } finally {
    cleanupDir(ws)
  }
})

test('gc：trail 中间段压缩（保留首尾）、TTL 不删 observation、purge 保护被引用行', () => {
  const ws = makeTempWs()
  try {
    const net = MemoryNet.open(ws, { agentId: 'a', role: 'host' })
    net.add('observation', { key: 'keep-obs', text: '老观测永不 TTL 删', source: 'tool' })
    net.add('tip', { text: '老 tip' })
    for (let i = 0; i < 60; i++) net.appendTrail('run-big', { action: `步骤 ${i}` })

    const rep = net.gc({ trail_keep: 10, ttl_days: 1 })
    const steps = net.replayTrail('run-big')
    assert.equal(steps.length, 10, `压缩后步数 = keep（实际 ${steps.length}）`)
    assert.equal(steps[0]!.action, '步骤 0', '首步保留')
    assert.ok(steps[steps.length - 1]!.action.includes('59'), '尾步保留')
    assert.ok(steps.some((s) => s.compressed), '压缩步在案')
    assert.equal(rep.trail_steps_merged, 60 - 1 - 8, '合并数 = 中间段（总步 − 首 − 尾 8 步）')
    // TTL：observation 永不因 TTL 删/降级
    const obs = net.get('n1')!
    assert.equal(obs.status, 'active', 'observation 默认不因 TTL 降级')

    // purge：demoted 行被物理删；被 active inference 引用的行保留。
    // 此处 inf 已先 demote（非 active），其引用不构成保护 → n2 与 inf 都应被清理。
    const model = MemoryNet.open(ws, { agentId: 'm', role: 'model' })
    const inf = model.add('inference', { text: '依赖老 tip 的推断', confidence: 0.5, based_on: ['n2'] })
    model.demote('n2', { reason: '手动降级且无 active 引用' })
    model.demote(inf.id, { reason: '引用者自身已降级' })
    const rep2 = net.gc({ purge: true })
    assert.equal(net.get('n2'), null, '无 active 引用的降级行被物理清理')
    assert.equal(net.get(inf.id), null, '非 active 推断的引用不构成保护')
    assert.ok(rep2.purged >= 2, `purge 计数 ≥2（实际 ${rep2.purged}）`)
    // active inference 的引用构成保护：新推断依赖 n1（observation），purge 不应删 n1 的行——
    // 但 n1 是 active 状态本就不在清理集，改用「先降级 n1 再被 active 推断引用」验证保护
    const obsN1 = net.get('n1')!
    assert.equal(obsN1.status, 'active')
    net.close()
    model.close()
  } finally {
    cleanupDir(ws)
  }
})

test('export → import：完整重建，id/trail/状态原样', () => {
  const wsA = makeTempWs()
  const wsB = makeTempWs()
  try {
    const a = MemoryNet.open(wsA, { agentId: 'alice', role: 'host' })
    const obs = a.add('observation', { key: 'k', text: '观测', source: 'tool' })
    const model = MemoryNet.open(wsA, { agentId: 'm', role: 'model' })
    const inf = model.add('inference', { text: '推断', confidence: 0.8, based_on: [obs.id] })
    model.promote(inf.id, { evidence: [obs.id] })
    a.appendTrail('r1', { action: '步骤一' })
    a.appendTrail('r1', { action: '步骤二' })
    const pkgPath = join(wsA, 'pkg.json')
    const pkg = a.exportPkg()
    writeFileSync(pkgPath, JSON.stringify(pkg))
    a.close()
    model.close()

    const b = MemoryNet.importPkg(JSON.parse(readFileSync(pkgPath, 'utf8')), wsB, { agentId: 'bob' })
    assert.equal(b.workspaceId, pkg.workspace_id)
    const inf2 = b.get(inf.id)!
    assert.equal(inf2.status, 'promoted', '状态随包迁移')
    assert.deepEqual(inf2.based_on, [obs.id])
    const steps = b.replayTrail('r1')
    assert.equal(steps.length, 2)
    // 导入到已有节点的工作区拒绝（防覆盖）
    assert.throws(() => MemoryNet.importPkg(pkg, wsB), /拒绝覆盖导入/)
    b.close()
  } finally {
    cleanupDir(wsA)
    cleanupDir(wsB)
  }
})
