/**
 * M1 溯源账本测试 —— issue #2 M1 验收（对应 M0 矩阵红灯 R1-R5 的转绿场景）。
 * 全部使用独立临时库；账本挂载为显式 opt-in（默认行为不变）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { MemoryNet } from '../src/store.js'
import { LedgerConflictError, RevisionConflictError, type RevisionRecord } from '../src/ledger.js'
import { makeTempWs, cleanupDir } from './helpers.js'

function openLedgered(ws: string, agentId = 'ledger-host') {
  return MemoryNet.open(ws, { agentId, role: 'host', ledger: true })
}

test('R1-green: full export carries the operations ledger with one op per committed transaction', () => {
  const ws = makeTempWs('mn-m1-ledger-')
  const net = openLedgered(ws)
  try {
    net.add('observation', { text: 'event one', source: 'tool' })
    net.add('observation', { text: 'event two', source: 'tool' })
    const pkg = net.exportFullPkg()
    assert.equal(pkg.schema_version, 2)
    assert.ok(Array.isArray(pkg.ledger.operations))
    assert.equal(pkg.ledger.operations.length, 2)
    assert.ok(pkg.ledger.operations.every(o => /^[0-9a-f-]{36}$/.test(o.op_id)))
    assert.ok(pkg.ledger.operations.every(o => o.seq > 0))
    // 每个操作都有对应修订（成功事务同事务提交）。
    assert.equal(pkg.ledger.revisions.length, 2)
    assert.equal(pkg.ledger.heads.length, 2)
  } finally { net.close(); cleanupDir(ws) }
})

test('R2-green: progress reference pins the exact revision and history survives export', () => {
  const ws = makeTempWs('mn-m1-drift-')
  const net = openLedgered(ws)
  try {
    const p1 = net.updateProgress('task-1', { status: 'doing', summary: 'before-state' })
    const inference = net.add('inference', { text: 'decided on before-state', confidence: .8, based_on: [p1.id] })
    const p2 = net.updateProgress('task-1', { status: 'done', summary: 'after-state' })
    assert.notEqual(p1.revision_id, p2.revision_id)
    // 推断修订的依赖链接固定在 p1 修订，不随 current 漂移。
    const inferHead = net.ledger!.headRevision(inference.id)!
    const links = net.ledger!.linksOf(inferHead)
    assert.equal(links.length, 1)
    assert.equal(links[0]!.referenced_node_id, p1.id)
    assert.equal(links[0]!.referenced_revision_id, p1.revision_id)
    // 导出能复原 before-state（修订历史完整）。
    const pkg = net.exportFullPkg()
    const progressHistory = pkg.ledger.revisions.filter(r => r.node_id === p1.id)
    assert.equal(progressHistory.length, 2)
    assert.ok(progressHistory.some(r => r.text === 'before-state'))
    assert.ok(progressHistory.some(r => r.text === 'after-state'))
    // historyOf 直接可读。
    const history = net.historyOf(p1.id)
    assert.equal(history.length, 2)
    assert.equal(history[0]!.parent_revision_id, null)
    assert.equal(history[1]!.parent_revision_id, history[0]!.revision_id)
  } finally { net.close(); cleanupDir(ws) }
})

test('R3-green: same-millisecond stale progress write is flagged via revision CAS (frozen clock)', () => {
  const ws = makeTempWs('mn-m1-cas-ms-')
  const net = openLedgered(ws)
  const realNow = Date.now
  try {
    const frozen = realNow()
    Date.now = () => frozen
    net.updateProgress('task-1', { summary: 'alice first' })
    const bobRead = net.updateProgress('task-1', { summary: 'bob read point' })
    net.updateProgress('task-1', { summary: 'alice second same ms' })
    // bob 基于过期修订（毫秒墙钟无法区分）发起写入：必须标记冲突。
    const headBeforeBob = net.ledger!.headRevision(bobRead.id)
    const merged = net.updateProgress('task-1', { summary: 'bob stale write' }, { expected_revision: bobRead.revision_id })
    assert.equal(merged.conflict, true)
    assert.ok(merged.conflict_detail && 'revision' in merged.conflict_detail)
    // 约定 [当前值, 传入值]：当前 = bob 写入前的 head（alice 第二次修订），传入 = bob 的过期令牌。
    assert.deepEqual(merged.conflict_detail!['revision'], [headBeforeBob, bobRead.revision_id])
  } finally {
    Date.now = realNow
    net.close(); cleanupDir(ws)
  }
})

test('R4-green: trail operations keep stable anchors after GC compression', () => {
  const ws = makeTempWs('mn-m1-trail-')
  const net = openLedgered(ws)
  try {
    const run = 'run-m1'
    for (let i = 1; i <= 8; i++) net.appendTrail(run, { action: `step-${i}` })
    const before = net.ledger!.operationsFor({ kind: 'trail' })
    assert.equal(before.length, 8)
    const report = net.gc({ trail_keep: 4 })
    assert.ok(report.trail_runs_compressed >= 1)
    // trail 表可重编号（显示摘要），但账本操作坐标不可变。
    const after = net.ledger!.operationsFor({ kind: 'trail' })
    assert.equal(after.length, 8)
    assert.deepEqual(after.map(o => o.summary), before.map(o => o.summary))
    assert.equal(net.ledger!.operationsFor({ kind: 'gc' }).length, 1)
  } finally { net.close(); cleanupDir(ws) }
})

test('R5-green: stale status transition is rejected — no silent last-writer-wins', () => {
  const ws = makeTempWs('mn-m1-lww-')
  const net = openLedgered(ws)
  try {
    const evidence = net.add('observation', { text: 'evidence', source: 'tool' })
    const decision = net.add('inference', { text: 'decision', confidence: .8, based_on: [evidence.id] })
    const staleRevision = decision.revision_id
    net.promote(decision.id, { evidence: [evidence.id], expected_revision: decision.revision_id })
    // 裸调用（无 CAS 令牌）必须被拒绝，而不是静默覆盖 promote。
    assert.throws(() => net.demote(decision.id, { reason: 'bob stale view' }), /expected_revision/)
    // 带过期令牌同样拒绝：显式重读后重试。
    assert.throws(() => net.demote(decision.id, { reason: 'bob stale token', expected_revision: staleRevision }), RevisionConflictError)
    assert.equal(net.get(decision.id)!.status, 'promoted')
    // 重读后带当前令牌成功。
    const current = net.get(decision.id)!
    net.demote(decision.id, { reason: 'bob re-read', expected_revision: current.revision_id })
    assert.equal(net.get(decision.id)!.status, 'demoted')
  } finally { net.close(); cleanupDir(ws) }
})

test('replay dedup: same coordinate and digest is idempotent, different digest is rejected', () => {
  const ws = makeTempWs('mn-m1-replay-')
  const net = openLedgered(ws)
  try {
    const coord = { host_instance: 'host-a', session_id: 'session-1', durable_event_seq: 42 }
    const first = net.add('observation', { text: 'tool observed X', source: 'tool', provenance: coord })
    const replayed = net.add('observation', { text: 'tool observed X', source: 'tool', provenance: coord })
    assert.equal(replayed.id, first.id, 'idempotent replay must return the original node')
    assert.equal(net.exportFullPkg().ledger.operations.length, 1)
    // 同坐标不同摘要 → 拒绝，且不产生部分写入。
    assert.throws(() => net.add('observation', { text: 'tool observed DIFFERENT', source: 'tool', provenance: coord }), LedgerConflictError)
    assert.equal(net.exportFullPkg().ledger.operations.length, 1)
    // 无持久坐标：不做去重（本地身份，两次写入两个节点）。
    net.add('observation', { text: 'tool observed X', source: 'tool' })
    assert.equal(net.exportFullPkg().ledger.operations.length, 2)
  } finally { net.close(); cleanupDir(ws) }
})

test('one event revising multiple nodes records all revisions under the same op_id', () => {
  const ws = makeTempWs('mn-m1-supersede-')
  const net = openLedgered(ws)
  try {
    const obs1 = net.add('observation', { key: 'subject:A', text: 'A before', source: 'tool' })
    const decision = net.add('inference', { text: 'decision about A', confidence: .8, based_on: [obs1.id] })
    net.promote(decision.id, { evidence: [obs1.id], expected_revision: decision.revision_id })
    const opsBefore = net.exportFullPkg().ledger.operations.length
    net.add('observation', { key: 'subject:A', text: 'A after', source: 'tool' })
    const pkg = net.exportFullPkg()
    // 覆盖+推翻联动是一个事务：新观测 + superseded 旧观测 + contradicted 推断 共享 op_id。
    assert.equal(pkg.ledger.operations.length, opsBefore + 1)
    const lastOp = pkg.ledger.operations.at(-1)!
    const revised = pkg.ledger.revisions.filter(r => r.op_id === lastOp.op_id)
    assert.equal(revised.length, 3)
    const statuses = revised.map(r => `${r.kind}:${r.status}`).sort()
    assert.deepEqual(statuses, ['inference:contradicted', 'observation:active', 'observation:superseded'])
  } finally { net.close(); cleanupDir(ws) }
})

test('concurrent CAS: second writer with stale token must fail and re-read', () => {
  const ws = makeTempWs('mn-m1-cas2-')
  const alice = openLedgered(ws, 'alice')
  const bob = openLedgered(ws, 'bob')
  try {
    const evidence = alice.add('observation', { text: 'shared evidence', source: 'tool' })
    const decision = alice.add('inference', { text: 'shared decision', confidence: .8, based_on: [evidence.id] })
    const bobView = bob.get(decision.id)!
    // alice 先 promote。
    alice.promote(decision.id, { evidence: [evidence.id], expected_revision: decision.revision_id })
    // bob 基于过期视图发起【不同结局】的变更（demote）→ 必须 CAS 拒绝。
    assert.throws(() => bob.demote(decision.id, { reason: 'bob stale view', expected_revision: bobView.revision_id }), RevisionConflictError)
    // bob 重读后成功；两次状态变更产生两条修订。
    const reRead = bob.get(decision.id)!
    bob.demote(decision.id, { reason: 'bob re-read', expected_revision: reRead.revision_id })
    const history = bob.historyOf(decision.id)
    assert.equal(history.length, 3)
    assert.deepEqual(history.map(h => h.status), ['active', 'promoted', 'demoted'])
  } finally { alice.close(); bob.close(); cleanupDir(ws) }
})

test('transaction atomicity: ledger conflict rolls back the memory.db write too', () => {
  const ws = makeTempWs('mn-m1-atomic-')
  const net = openLedgered(ws)
  try {
    const coord = { session_id: 'session-atomic', durable_event_seq: 1 }
    net.add('observation', { text: 'first commit', source: 'tool', provenance: coord })
    const nodesBefore = net.exportPkg().nodes.length
    const opsBefore = net.exportFullPkg().ledger.operations.length
    // 同坐标异摘要：recordOperation 在写事务内抛出 → memory.db 插入必须一并回滚。
    assert.throws(() => net.add('observation', { text: 'conflicting replay', source: 'tool', provenance: coord }), LedgerConflictError)
    assert.equal(net.exportPkg().nodes.length, nodesBefore)
    assert.equal(net.exportFullPkg().ledger.operations.length, opsBefore)
  } finally { net.close(); cleanupDir(ws) }
})

test('schema1 behavior unchanged when ledger is not attached', () => {
  const ws = makeTempWs('mn-m1-legacy-')
  const net = MemoryNet.open(ws, { agentId: 'legacy-host', role: 'host' })
  try {
    assert.equal(net.ledger, null)
    const obs = net.add('observation', { key: 'k', text: 'v1', source: 'tool' })
    const decision = net.add('inference', { text: 'd', confidence: .8, based_on: [obs.id] })
    // 无账本：promote/demote/link 不要求 expected_revision（兼容旧行为）。
    net.promote(decision.id, { evidence: [obs.id] })
    net.link(obs.id, decision.id)
    net.demote(decision.id)
    net.updateProgress('t', { summary: 's' })
    net.appendTrail('r', { action: 'a' })
    const pkg = net.exportPkg()
    assert.equal(pkg.schema_version, 1)
    assert.ok(!('ledger' in pkg))
    assert.ok(!('operations' in pkg))
    // provenance.db 不存在（sidecar 仅显式创建）。
    assert.ok(!existsSync(ws + '/provenance.db'))
  } finally { net.close(); cleanupDir(ws) }
})

test('migration: baseline snapshots existing schema1 nodes once, with backup', () => {
  const ws = makeTempWs('mn-m1-migrate-')
  const legacy = MemoryNet.open(ws, { agentId: 'legacy', role: 'host' })
  legacy.add('observation', { text: 'old observation', source: 'tool' })
  legacy.add('inference', { text: 'old decision', confidence: .7 })
  legacy.updateProgress('old-task', { summary: 'old progress' })
  legacy.close()
  const net = openLedgered(ws)
  try {
    const { migrated, backup } = net.migrateLedgerBaseline()
    assert.equal(migrated, 3)
    assert.ok(existsSync(backup), 'backup directory must exist before migration')
    const revisions = net.exportFullPkg().ledger.revisions
    assert.ok(revisions.every(r => r.origin === 'legacy_baseline'))
    assert.equal(revisions.length, 3)
    // 迁移不补造历史：每个节点恰好一条基线修订；操作恰一条 migration。
    assert.equal(net.exportFullPkg().ledger.operations.length, 1)
    // 重复迁移拒绝。
    assert.throws(() => net.migrateLedgerBaseline(), /拒绝重复迁移/)
    // 迁移后新写入正常追加 live 修订。
    const added = net.add('observation', { text: 'new after migration', source: 'tool' })
    assert.equal(net.historyOf(added.id).length, 1)
    rmSync(backup, { recursive: true, force: true })
  } finally { net.close(); cleanupDir(ws) }
})

test('v2 export/import roundtrip preserves history; tampered package rejected', () => {
  const ws = makeTempWs('mn-m1-roundtrip-')
  const net = openLedgered(ws)
  try {
    const p1 = net.updateProgress('task-rt', { summary: 'v1' })
    net.updateProgress('task-rt', { summary: 'v2' })
    const obs = net.add('observation', { text: 'rt observation', source: 'tool' })
    const inf = net.add('inference', { text: 'rt decision', confidence: .8, based_on: [obs.id, p1.id] })
    net.promote(inf.id, { evidence: [obs.id], expected_revision: inf.revision_id })
    const pkg = net.exportFullPkg()
    const ws2 = makeTempWs('mn-m1-roundtrip-restore-')
    try {
      const restored = MemoryNet.importFullPkg(pkg, ws2, { agentId: 'restore-host' })
      try {
        assert.equal(restored.exportPkg().nodes.length, pkg.nodes.length)
        const rpkg = restored.exportFullPkg()
        assert.equal(rpkg.ledger.operations.length, pkg.ledger.operations.length)
        assert.equal(rpkg.ledger.revisions.length, pkg.ledger.revisions.length)
        assert.equal(rpkg.ledger.links.length, pkg.ledger.links.length)
        // 修订历史与精确引用恢复。
        const rtHistory = restored.historyOf(p1.id)
        assert.equal(rtHistory.length, 2)
        const rtInfHead = restored.ledger!.headRevision(inf.id)
        const rtLinks = restored.ledger!.linksOf(rtInfHead!)
        assert.equal(rtLinks.length, 2)
      } finally { restored.close() }
      // 非空目标拒绝。
      const pkg2 = JSON.parse(JSON.stringify(pkg)) as typeof pkg
      assert.throws(() => MemoryNet.importFullPkg(pkg2, ws2), /已有节点/)
      // 篡改包（悬空链接）拒绝，不留半写库。
      const tampered = JSON.parse(JSON.stringify(pkg)) as typeof pkg
      tampered.ledger.links.push({ revision_id: rtFake(), referenced_node_id: 'nX', referenced_revision_id: rtFake(), relation: 'supports' })
      const ws3 = makeTempWs('mn-m1-roundtrip-tamper-')
      try {
        assert.throws(() => MemoryNet.importFullPkg(tampered, ws3), /悬空修订链接/)
      } finally { cleanupDir(ws3) }
    } finally { cleanupDir(ws2) }
    // v1 入口拒绝 v2 包（降级打开被拒绝，不静默丢历史）。
    assert.throws(() => MemoryNet.importPkg(pkg as never, makeTempWs('mn-m1-v1downgrade-')), /schema_version/)
  } finally { net.close(); cleanupDir(ws) }
})

test('redaction removes sensitive history and invalidates dependents', () => {
  const ws = makeTempWs('mn-m1-redact-')
  const net = openLedgered(ws)
  try {
    const sensitive = net.add('observation', { text: 'SECRET api key observed', source: 'tool' })
    const decision = net.add('inference', { text: 'decision based on secret', confidence: .8, based_on: [sensitive.id] })
    assert.equal(net.ledger!.linksOf(net.ledger!.headRevision(decision.id)!).length, 1)
    const result = net.redact({ node_id: sensitive.id }, { note: 'user requested deletion', delete_live: true })
    // 目标修订与指向它的链接被物理删除。
    assert.ok(result.removed_revisions.length >= 1)
    assert.equal(net.historyOf(sensitive.id).length, 0)
    assert.equal(net.ledger!.linksOf(net.ledger!.headRevision(decision.id)!).length, 0)
    // 依赖方被标记 needs_review（不静默保持有效）。
    const head = net.ledger!.revision(net.ledger!.headRevision(decision.id)!)
    assert.ok(head && (head.payload.needs_review as { reason: string }).reason === 'evidence_redacted')
    assert.deepEqual(result.marked_dependents, [decision.id])
    // 敏感正文不再出现在全量导出（账本+live 行）中。
    assert.ok(!JSON.stringify(net.exportFullPkg()).includes('SECRET'))
    assert.equal(net.get(sensitive.id), null)
    // redact 是 host-only。
    const model = MemoryNet.open(ws, { agentId: 'm', role: 'model', ledger: true })
    try {
      assert.throws(() => model.redact({ node_id: decision.id }), /host/)
    } finally { model.close() }
  } finally { net.close(); cleanupDir(ws) }
})

test('add/link with ledger never commits dangling references (validation inside write txn)', () => {
  const ws = makeTempWs('mn-m1-dangling-')
  const net = openLedgered(ws)
  try {
    const a = net.add('observation', { text: 'will be purged', source: 'tool' })
    const tip = net.add('tip', { text: 'unreferenced' })
    net.demote(a.id, { expected_revision: a.revision_id })
    net.demote(tip.id, { expected_revision: tip.revision_id })
    net.gc({ purge: true })
    assert.equal(net.get(a.id), null)
    // 依赖校验在写事务内：目标不存在 → 拒绝，无悬空引用提交。
    assert.throws(() => net.add('inference', { text: 'late', confidence: .5, based_on: [a.id] }), /UnknownNode|不存在/)
    const pkg = net.exportFullPkg()
    for (const rev of pkg.ledger.revisions) {
      for (const ref of rev.based_on) {
        assert.ok(pkg.ledger.revisions.some(r => r.node_id === ref) || ref === a.id,
          `revision ${rev.revision_id} references ${ref}`)
      }
    }
    // 账本保留被 purge 节点的修订历史（GC 只清 live 行，不删账本）。
    assert.ok(net.historyOf(a.id).length >= 1)
  } finally { net.close(); cleanupDir(ws) }
})

test('downgrade protection: newer sidecar schema is refused, not silently reopened', () => {
  const ws = makeTempWs('mn-m1-downgrade-')
  const net = openLedgered(ws)
  try {
    net.add('observation', { text: 'x', source: 'tool' })
  } finally { net.close() }
  // 模拟未来版本 sidecar：直接改 ledger meta 版本号。
  const raw = new DatabaseSync(ws + '/provenance.db')
  raw.prepare("UPDATE ledger_meta SET v = '3' WHERE k = 'schema_version'").run()
  raw.close()
  assert.throws(() => openLedgered(ws), /拒绝/)
  // sidecar 可整体删除回退 schema1 行为（显式回滚路径）。
  rmSync(ws + '/provenance.db')
  const reverted = MemoryNet.open(ws, { agentId: 'rollback', role: 'host' })
  try {
    assert.equal(reverted.ledger, null)
    assert.equal(reverted.exportPkg().nodes.length, 1)
  } finally { reverted.close(); cleanupDir(ws) }
})

test('backup directory keeps memory.db snapshot before baseline migration', () => {
  const ws = makeTempWs('mn-m1-backup-')
  const legacy = MemoryNet.open(ws, { agentId: 'legacy', role: 'host' })
  legacy.add('observation', { text: 'before backup', source: 'tool' })
  legacy.close()
  const net = openLedgered(ws)
  try {
    const { backup } = net.migrateLedgerBaseline()
    const files = readdirSync(backup)
    assert.ok(files.some(f => f.startsWith('memory.db')), 'backup must contain a memory.db snapshot')
    rmSync(backup, { recursive: true, force: true })
  } finally { net.close(); cleanupDir(ws) }
})

function rtFake(): string {
  return '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0')
}
