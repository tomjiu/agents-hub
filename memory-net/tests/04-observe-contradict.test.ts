/** 验收 4：observation 覆盖同 key → 旧观测 superseded，基于它的 inference 自动 contradicted。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryNet } from '../src/store.js'
import { makeTempWs, cleanupDir } from './helpers.js'

test('同 key 覆盖 → 派生推断自动失效；不依赖 LLM', () => {
  const ws = makeTempWs()
  try {
    const tool = MemoryNet.open(ws, { agentId: 'tool-bridge', role: 'tool' })
    const model = MemoryNet.open(ws, { agentId: 'coder', role: 'model' })

    // 物理观测 v1：构建红灯
    const obs1 = tool.add('observation', { key: 'build-status', text: '构建红灯：缺少 typescript 依赖', source: 'tool' })
    // 模型基于 obs1 做推断
    const inf = model.add('inference', {
      text: '构建失败是缺依赖导致',
      confidence: 0.8,
      based_on: [obs1.id],
    })
    assert.equal(inf.status, 'active')

    // 物理事实变化：同 key 新观测覆盖
    const obs2 = tool.add('observation', { key: 'build-status', text: '构建红灯：端口 3000 被占用', source: 'tool' })
    const obs1After = tool.get(obs1.id)!
    assert.equal(obs1After.status, 'superseded', '旧观测被覆盖为 superseded（不删除，保留历史）')
    const infAfter = model.get(inf.id)!
    assert.equal(infAfter.status, 'contradicted', '基于旧观测的推断自动 contradicted')

    // contradicted 推断不再进入激活
    const r = tool.activate('构建', { agent_id: 'tool' })
    assert.ok(!r.nodes.some((rn) => rn.node.id === inf.id), '失效推断不得注入')
    // 新观测在激活中
    assert.ok(r.nodes.some((rn) => rn.node.id === obs2.id), '新观测应被激活')

    // 无 key 的观测互不覆盖（独立事实）
    const free1 = tool.add('observation', { text: '自由观测 A', source: 'tool' })
    const free2 = tool.add('observation', { text: '自由观测 B', source: 'tool' })
    assert.equal(tool.get(free1.id)!.status, 'active')
    assert.equal(tool.get(free2.id)!.status, 'active')
    tool.close()
    model.close()
  } finally {
    cleanupDir(ws)
  }
})

test('显式 contradict 与 promote 门控', () => {
  const ws = makeTempWs()
  try {
    const tool = MemoryNet.open(ws, { agentId: 'tb', role: 'tool' })
    const model = MemoryNet.open(ws, { agentId: 'm', role: 'model' })
    const obs = tool.add('observation', { key: 'k', text: '事实 A', source: 'tool' })
    const inf = model.add('inference', { text: '推断 B', confidence: 0.5, based_on: [obs.id] })

    // promote 无证据且非宿主 → 拒绝（禁止自动/无依据升级）
    assert.throws(() => model.promote(inf.id), /需要 evidence/)
    // 带证据（引用观测）→ 允许
    const promoted = model.promote(inf.id, { evidence: [obs.id], note: '已被复验两次' })
    assert.equal(promoted.status, 'promoted')
    // 宿主（by=user）可直接 promote 另一条
    const inf2 = model.add('inference', { text: '推断 C', confidence: 0.7 })
    const promoted2 = tool.promote(inf2.id, { by: 'user' })
    assert.equal(promoted2.status, 'promoted')

    // 显式 contradict
    const inf3 = model.add('inference', { text: '推断 D', confidence: 0.9 })
    const cx = model.contradict(inf3.id, { note: '与观测 n? 冲突', evidence: [obs.id] })
    assert.equal(cx.status, 'contradicted')
    // demote 后不参与激活
    const inf4 = model.add('inference', { text: '推断 E', confidence: 0.9 })
    model.demote(inf4.id, { reason: '过时' })
    const r = tool.activate('', { agent_id: 'x', budgets: { max_nodes: 50 } })
    assert.ok(!r.nodes.some((rn) => rn.node.id === inf4.id))
    tool.close()
    model.close()
  } finally {
    cleanupDir(ws)
  }
})
