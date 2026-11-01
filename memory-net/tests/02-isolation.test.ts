/** 验收 2：切换 workspace 不串读 —— 每个 workspace 独立 memory.db 物理隔离。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { MemoryNet } from '../src/store.js'
import { makeTempWs, cleanupDir } from './helpers.js'

test('两个 workspace 互不可见（写 A，读 B 空）', () => {
  const root = makeTempWs()
  const wsA = join(root, 'proj-alpha')
  const wsB = join(root, 'proj-beta')
  try {
    const a = MemoryNet.open(wsA, { agentId: 'alice', role: 'host' })
    a.add('observation', { key: 'build-status', text: 'alpha 构建红灯', source: 'tool' })
    a.updateProgress('t-alpha', { status: 'doing', summary: 'alpha 专属进度' })
    a.close()

    const b = MemoryNet.open(wsB, { agentId: 'bob', role: 'host' })
    const r = b.activate('alpha 构建 进度', { agent_id: 'bob', budgets: { max_nodes: 100 } })
    assert.equal(r.nodes.length, 0, 'beta workspace 不得读到 alpha 的任何节点')
    assert.equal(b.get('n1'), null, 'beta 内 id 空间独立')
    b.close()

    // 切回 alpha：数据原样还在（随 workspace 打开挂载）
    const a2 = MemoryNet.open(wsA, { agentId: 'alice', role: 'host' })
    const again = a2.activate('alpha', { agent_id: 'alice' })
    assert.ok(again.nodes.some((rn) => rn.node.kind === 'progress'), '重新挂载后 progress 仍在')
    a2.close()
  } finally {
    cleanupDir(root)
  }
})

test('workspace_id 不匹配的打开请求被拒绝（防串读护栏）', () => {
  const ws = makeTempWs()
  try {
    const a = MemoryNet.open(ws, { agentId: 'x', role: 'host', workspaceId: 'real-ws' })
    a.add('tip', { text: 'x' })
    a.close()
    assert.throws(
      () => MemoryNet.open(ws, { agentId: 'x', role: 'host', workspaceId: 'other-ws' }),
      /workspace_id 不匹配/,
      '显式传入错误 workspace_id 必须拒绝',
    )
  } finally {
    cleanupDir(ws)
  }
})
