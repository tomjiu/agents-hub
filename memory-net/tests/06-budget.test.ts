/** 验收 6：预算裁剪下 constraint + 当次 progress 永不保留光；权重序生效。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryNet } from '../src/store.js'
import { makeTempWs, cleanupDir } from './helpers.js'

test('极小预算下 constraint 与 progress 仍被激活（frozen 永不裁光）', () => {
  const ws = makeTempWs()
  try {
    const host = MemoryNet.open(ws, { agentId: 'host', role: 'host' })
    // 大量噪声候选（tip 权重低）
    for (let i = 0; i < 30; i++) {
      host.add('tip', { text: `噪声建议 ${i}：随机上下文填充内容 xyz-${i}` })
    }
    // constraint（置顶）与 progress（当前任务）
    const c = host.add('constraint', { key: 'no-force-push', text: '禁止对 main 执行 force push', payload: { mode: 'forbid' } })
    host.updateProgress('task-hot', { status: 'doing', summary: '当前任务：修复登录 OAuth' })

    const r = host.activate('与查询完全无关的词 深海鱼', {
      agent_id: 'host',
      task_id: 'task-hot',
      budgets: { max_nodes: 3, max_tokens: 120 },
    })
    const kinds = r.nodes.map((rn) => rn.node.kind)
    assert.ok(kinds.includes('constraint'), '极小预算下 constraint 必须仍在')
    assert.ok(kinds.includes('progress'), '极小预算下当次 progress 必须仍在')
    const frozen = r.nodes.filter((rn) => rn.frozen)
    assert.ok(frozen.length >= 2, '两项均为 frozen 标记')
    const cNode = r.nodes.find((rn) => rn.node.id === c.id)!
    assert.ok(cNode.frozen)
    assert.ok(r.nodes_dropped > 0, '噪声应被裁掉')
    host.close()
  } finally {
    cleanupDir(ws)
  }
})

test('权重序：constraint > observation > progress > tip > inference（无查询词时）', () => {
  const ws = makeTempWs()
  try {
    const host = MemoryNet.open(ws, { agentId: 'host', role: 'host' })
    const tool = MemoryNet.open(ws, { agentId: 'tb', role: 'tool' })
    const model = MemoryNet.open(ws, { agentId: 'm', role: 'model' })
    host.add('constraint', { key: 'c1', text: '规则', payload: { mode: 'require' } })
    tool.add('observation', { key: 'o1', text: '观测事实', source: 'tool' })
    host.updateProgress('t1', { summary: '进度' })
    host.add('tip', { text: '建议' })
    model.add('inference', { text: '推断', confidence: 0.5 })

    const r = host.activate('', { agent_id: 'host', budgets: { max_nodes: 10, max_tokens: 4000 } })
    const kinds: string[] = r.nodes.map((rn) => rn.node.kind)
    // 排序：constraint 在 observation 前，observation 在 progress 前……
    const idx = (k: string) => kinds.indexOf(k)
    assert.ok(idx('constraint') < idx('observation'), 'constraint 置顶')
    assert.ok(idx('observation') < idx('progress'), 'observation 高于 progress')
    assert.ok(idx('progress') < idx('tip'), 'progress 高于 tip')
    assert.ok(idx('tip') < idx('inference'), 'tip 高于 inference')
    host.close()
    tool.close()
    model.close()
  } finally {
    cleanupDir(ws)
  }
})

test('query 命中提升排序（同权重无关，跨权重可越级）', () => {
  const ws = makeTempWs()
  try {
    const host = MemoryNet.open(ws, { agentId: 'host', role: 'host' })
    host.add('tip', { text: 'OAuth 回调要在 30 秒内完成验证' })
    host.add('tip', { text: '无关内容 菜谱 番茄炒蛋' })
    const r = host.activate('OAuth 回调', { agent_id: 'host', budgets: { max_nodes: 1, max_tokens: 200 } })
    assert.equal(r.nodes.length, 1)
    assert.match(r.nodes[0]!.node.text, /OAuth/)
    host.close()
  } finally {
    cleanupDir(ws)
  }
})
