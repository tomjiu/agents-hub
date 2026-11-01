/** 验收 5：trail 顺序可回放（复现/排障基础）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryNet } from '../src/store.js'
import { makeTempWs, cleanupDir } from './helpers.js'

test('trail 按 seq 严格有序回放，refs 完整', () => {
  const ws = makeTempWs()
  try {
    const net = MemoryNet.open(ws, { agentId: 'alice', role: 'host' })
    const obs = net.add('observation', { key: 'seed', text: '起点', source: 'user' })
    net.appendTrail('run-x', { action: 'clone 仓库' })
    net.appendTrail('run-x', { action: '安装依赖', refs: [obs.id] })
    net.appendTrail('run-x', { action: '跑测试' })
    net.appendTrail('run-y', { action: '另一 run 独立序列' })

    const steps = net.replayTrail('run-x')
    assert.equal(steps.length, 3)
    assert.deepEqual(steps.map((s) => s.action), ['clone 仓库', '安装依赖', '跑测试'])
    assert.deepEqual(steps.map((s) => s.seq), [1, 2, 3])
    assert.deepEqual(steps[1]!.refs, [obs.id], 'refs 引用完整保留')

    // 空 run 回放为空数组（可复现语义：无步即无步）
    assert.deepEqual(net.replayTrail('run-none'), [])
    // action 空拒绝
    assert.throws(() => net.appendTrail('run-x', { action: '  ' }), /action 不能为空/)
    // refs 指向不存在节点拒绝
    assert.throws(() => net.appendTrail('run-x', { action: 'x', refs: ['n9999'] }), /节点不存在/)
    net.close()
  } finally {
    cleanupDir(ws)
  }
})
