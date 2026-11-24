/**
 * Legacy（无账本）路径边界特征测试 —— 锁定 schema1 默认行为的兼容契约。
 *
 * M0 红灯（tests/m1-red/，见 git 历史与 memory-provenance-m0.json）记录了这些
 * 缺陷在仅有 schema1 时的表现；M1 通过账本（open({ledger:true})）补齐能力
 * （见 14-ledger.test.ts R1-R5 转绿场景）。默认路径保持原样：
 * 本文件把这些"缺陷表现"改写为显式兼容契约断言——v1 导出不伪装含历史、
 * 无账本时不强制 CAS、trail 表可重编号。任何无意改变默认行为的回归都会在此红灯。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryNet } from '../src/store.js'
import { makeTempWs, cleanupDir } from './helpers.js'

test('legacy v1 export never pretends to carry ledger history', () => {
  const ws = makeTempWs('mn-m1-legacy-export-')
  const net = MemoryNet.open(ws, { agentId: 'legacy', role: 'host' })
  try {
    net.add('observation', { text: 'event one', source: 'tool' })
    const pkg = net.exportPkg() as unknown as Record<string, unknown>
    assert.equal(pkg.schema_version, 1)
    assert.ok(!('operations' in pkg) && !('ledger' in pkg) && !('revisions' in pkg),
      'v1 export must not fabricate history; use open({ledger:true}) + exportFullPkg')
  } finally { net.close(); cleanupDir(ws) }
})

test('legacy progress update drifts in place — the documented reason the ledger pins revisions', () => {
  const ws = makeTempWs('mn-m1-legacy-drift-')
  const net = MemoryNet.open(ws, { agentId: 'legacy', role: 'host' })
  try {
    net.updateProgress('task-1', { status: 'doing', summary: 'PROGRESS-EARLY-STATE' })
    const progress = net.activate('', { task_id: 'task-1' }).nodes.map(r => r.node).find(n => n.kind === 'progress')!
    net.add('inference', { text: 'decided at that point', confidence: .8, based_on: [progress.id] })
    net.updateProgress('task-1', { status: 'done', summary: 'PROGRESS-LATER-STATE' })
    // 无账本：in-place 更新，based_on 指向同一 id；导出只有当前态（旧 summary 不在包中）。
    const pkg = JSON.stringify(net.exportPkg())
    assert.ok(!pkg.includes('PROGRESS-EARLY-STATE'), 'schema1 keeps only current state (capability gap documented, not hidden)')
    assert.equal(net.get(progress.id)!.text, 'PROGRESS-LATER-STATE')
  } finally { net.close(); cleanupDir(ws) }
})

test('legacy wall-clock optimistic lock cannot order same-millisecond writes', () => {
  const ws = makeTempWs('mn-m1-legacy-ms-')
  const net = MemoryNet.open(ws, { agentId: 'legacy', role: 'host' })
  const realNow = Date.now
  try {
    const frozen = realNow()
    Date.now = () => frozen
    net.updateProgress('task-1', { summary: 'alice' })
    const bobBase = net.activate('', { task_id: 'task-1' }).nodes.map(r => r.node).find(n => n.kind === 'progress')!.updated_at
    net.updateProgress('task-1', { summary: 'alice again same ms' })
    const merged = net.updateProgress('task-1', { summary: 'bob' }, { base_updated_at: bobBase })
    assert.equal(merged.conflict, false,
      'same-millisecond writes are indistinguishable by updated_at — the gap the revision CAS closes (14-ledger R3-green)')
  } finally {
    Date.now = realNow
    net.close(); cleanupDir(ws)
  }
})

test('legacy trail compression renumbers — ledger operations are the stable anchors', () => {
  const ws = makeTempWs('mn-m1-legacy-trail-')
  const net = MemoryNet.open(ws, { agentId: 'legacy', role: 'host' })
  try {
    const run = 'run-legacy'
    for (let i = 1; i <= 8; i++) net.appendTrail(run, { action: `step-${i}` })
    const lastSeq = net.replayTrail(run).at(-1)!.seq
    net.gc({ trail_keep: 4 })
    const after = net.replayTrail(run)
    assert.equal(after.at(-1)!.seq < lastSeq, true,
      'schema1 trail is a display digest that renumbers; stable anchors live in ledger ops (14-ledger R4-green)')
  } finally { net.close(); cleanupDir(ws) }
})

test('legacy status transitions have no CAS — silent last-writer-wins is the documented legacy gap', () => {
  const ws = makeTempWs('mn-m1-legacy-lww-')
  const net = MemoryNet.open(ws, { agentId: 'legacy', role: 'host' })
  try {
    const evidence = net.add('observation', { text: 'evidence', source: 'tool' })
    const decision = net.add('inference', { text: 'decision', confidence: .8, based_on: [evidence.id] })
    net.promote(decision.id, { evidence: [evidence.id] })
    // 无账本：不带令牌的 demote 静默生效（兼容旧多 Agent 客户端）。
    net.demote(decision.id, { reason: 'legacy path' })
    assert.equal(net.get(decision.id)!.status, 'demoted',
      'legacy path keeps no-CAS semantics; ledger path enforces expected_revision (14-ledger R5-green)')
  } finally { net.close(); cleanupDir(ws) }
})
