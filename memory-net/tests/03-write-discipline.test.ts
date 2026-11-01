/** 验收 3：写纪律 —— 模型/自由文本只能 inference/tip，不能变 observation；constraint 仅宿主。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryNet } from '../src/store.js'
import { makeTempWs, cleanupDir } from './helpers.js'

test('role=model 写 observation 被拒绝（硬门控）', () => {
  const ws = makeTempWs()
  try {
    const model = MemoryNet.open(ws, { agentId: 'coder-model', role: 'model' })
    assert.throws(
      () => model.add('observation', { key: 'exit', text: 'npm test 退出码 1', source: 'tool' }),
      /写纪律拒绝/,
      '模型不得写 observation（物理事实仅工具桥/宿主）',
    )
    // 模型可以写 inference / tip
    const inf = model.add('inference', { text: '测试失败可能因为端口占用', confidence: 0.6 })
    assert.equal(inf.kind, 'inference')
    const tip = model.add('tip', { text: '先查端口占用再重试', payload: { strategy: 'lsof -i :3000' } })
    assert.equal(tip.kind, 'tip')
    // 模型也不得写 constraint
    assert.throws(
      () => model.add('constraint', { key: 'no-force-push', text: '禁止 force push', payload: { mode: 'forbid' } }),
      /写纪律拒绝/,
    )
    model.close()
  } finally {
    cleanupDir(ws)
  }
})

test('role=tool 可写 observation；progress 全角色共享', () => {
  const ws = makeTempWs()
  try {
    const bridge = MemoryNet.open(ws, { agentId: 'tool-bridge', role: 'tool' })
    const obs = bridge.add('observation', { key: 'exit', text: 'npm test 退出码 1', source: 'tool', payload: { exit_code: 1 } })
    assert.equal(obs.status, 'active')
    const p = bridge.updateProgress('t1', { summary: '工具桥也能共享进度' })
    assert.equal(p.kind, 'progress')
    bridge.close()
  } finally {
    cleanupDir(ws)
  }
})

test('inference 必须带 confidence；add 不接受 progress kind', () => {
  const ws = makeTempWs()
  try {
    const host = MemoryNet.open(ws, { agentId: 'host', role: 'host' })
    assert.throws(() => host.add('inference', { text: '无置信度推断' }), /confidence/)
    assert.throws(
      () => host.add('progress', { text: 'x' }),
      /update_progress/,
      'progress 只能经 update_progress（同 task 单行共享语义）',
    )
    assert.throws(() => host.add('constraint', { key: 'k', text: 'x', payload: { mode: 'bogus' } }), /forbid/)
    host.close()
  } finally {
    cleanupDir(ws)
  }
})
