/** 验收 1：双 agent 同 workspace 同 run —— A 写 progress，B activate 读到。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryNet } from '../src/store.js'
import { makeTempWs, cleanupDir } from './helpers.js'

test('双 agent 共享 progress：A 写 → B activate 读到', () => {
  const ws = makeTempWs()
  try {
    const alice = MemoryNet.open(ws, { agentId: 'alice', role: 'host' })
    const bob = MemoryNet.open(ws, { agentId: 'bob', role: 'model' })

    // A（alice）写 progress + trail
    const p = alice.updateProgress('task-login', { status: 'doing', summary: '登录页完成 60%，卡在 OAuth 回调' })
    assert.equal(p.task_id, 'task-login')
    assert.equal(p.payload.owner, 'alice')
    alice.appendTrail('run-1', { action: '完成登录页表单 60%' })
    alice.appendTrail('run-1', { action: '发现 OAuth 回调阻塞', refs: [p.id] })

    // B（bob）activate 读到 A 的进度与 trail 摘要
    const r = bob.activate('登录 OAuth 进度', { run_id: 'run-1', agent_id: 'bob' })
    const found = r.nodes.find((rn) => rn.node.kind === 'progress')
    assert.ok(found, 'activate 结果必须含 progress（共享核心）')
    assert.equal(found.node.task_id, 'task-login')
    assert.match(String(found.node.payload.summary), /OAuth 回调/)
    assert.ok(r.trail, '带 run_id 的 activate 应附 trail 摘要')
    assert.match(r.trail.text, /OAuth 回调阻塞/)

    // B 在同一 run 追加自己的步骤 —— 共享 trail
    const t = bob.appendTrail('run-1', { action: 'bob 接手回调调试' })
    assert.equal(t.seq, 3, 'bob 的步接在 alice 之后（同 run 序列共享）')

    // B 更新同一 progress（同 task 单行，owner 换手）
    const p2 = bob.updateProgress('task-login', { status: 'doing', summary: 'OAuth 回调已修复，联调中' })
    assert.equal(p2.id, p.id, '同 task 单行共享（不产生双真相）')
    assert.equal(p2.payload.owner, 'bob')
    alice.close()
    bob.close()
  } finally {
    cleanupDir(ws)
  }
})

test('同 run 内 trail 序列共享且严格递增（多 agent 混写）', () => {
  const ws = makeTempWs()
  try {
    const a = MemoryNet.open(ws, { agentId: 'a', role: 'tool' })
    const b = MemoryNet.open(ws, { agentId: 'b', role: 'tool' })
    a.appendTrail('r', { action: 's1' })
    b.appendTrail('r', { action: 's2' })
    a.appendTrail('r', { action: 's3' })
    const seqs = a.replayTrail('r').map((s) => s.seq)
    assert.deepEqual(seqs, [1, 2, 3])
    a.close()
    b.close()
  } finally {
    cleanupDir(ws)
  }
})
