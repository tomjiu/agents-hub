/**
 * 会话 12 P2 修复锁定：
 * - P2-1 fillBudget trail 优先级倒挂（候选优先，trail 预算紧时最先丢）
 * - P2-2 appendTrail 原子 seq 分配（跨进程不撞 PK，返回真实 seq）
 * - P2-3 lifecycle 角色门控（model 不得 demote constraint/observation）+ contradict 证据要求
 * - P2-6 CLI import/--payload 错误分类（拒绝=可读信息 + 退出码 2）
 * - P2-7 同 key 观测覆盖链事务原子（INSERT + supersede 同事务，恒有 active）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryNet } from '../src/store.js'
import { WriteForbiddenError, WorkspaceError } from '../src/errors.js'
import { estimateTokens } from '../src/activate.js'
import { runCli } from '../src/cli.js'
import { makeTempWs, cleanupDir } from './helpers.js'

test('P2-1: 预算紧时候选（weight 5）优先于 trail（weight 1）入选', () => {
  const ws = makeTempWs()
  try {
    const host = MemoryNet.open(ws, { agentId: 'host', role: 'host' })
    // trail 摘要足够大（6 步 ≈ 40 token），保证「观测 +10」的剩余预算装不下它
    const runId = 'r-trail-prio'
    for (let i = 1; i <= 6; i++) host.appendTrail(runId, { action: `step-${i}` })
    // 高权重候选：observation（正文加长，token 估算与 nodeTokens 同源）
    const longText = '数据库主从延迟扩大到三秒，写入侧出现堆积，需要延迟回放与限流介入。'.repeat(6)
    host.add('observation', { key: 'db-status', text: longText, source: 'tool' })
    const obsTokens = estimateTokens(`observation db-status ${longText}`)

    // 预算 = 观测 + 10：观测必入选，trail（远大于 10）必被丢——
    // 旧实现 trail 先占 → 观测被裁（倒挂）；新实现观测先入 → trail 被丢（文档语义）
    const r = host.activate('', {
      run_id: runId,
      budgets: { max_nodes: 24, max_tokens: obsTokens + 10 },
    })
    const kinds = r.nodes.map((rn) => rn.node.kind)
    assert.ok(kinds.includes('observation'), 'observation（weight 5）必须优先于 trail 入选')
    if (r.trail) {
      assert.fail('预算只够其一时不该同时保留 trail')
    }
    host.close()
  } finally {
    cleanupDir(ws)
  }
})

test('P2-1b: 预算充裕时 trail 与候选共存（语义不回退）', () => {
  const ws = makeTempWs()
  try {
    const host = MemoryNet.open(ws, { agentId: 'host', role: 'host' })
    const runId = 'r-co'
    host.appendTrail(runId, { action: 'only' })
    host.add('observation', { key: 'k1', text: '观测内容', source: 'tool' })
    const r = host.activate('', { run_id: runId, budgets: { max_nodes: 24, max_tokens: 2048 } })
    assert.ok(r.trail, '预算充裕时 trail 应保留')
    assert.ok(r.nodes.some((rn) => rn.node.kind === 'observation'))
    host.close()
  } finally {
    cleanupDir(ws)
  }
})

test('P2-2: appendTrail 返回真实 seq 且连续追加严格递增（原子分配语义）', () => {
  const ws = makeTempWs()
  try {
    const host = MemoryNet.open(ws, { agentId: 'host', role: 'host' })
    const runId = 'r-seq'
    const seqs: number[] = []
    for (let i = 0; i < 5; i++) {
      const e = host.appendTrail(runId, { action: `step-${i}` })
      seqs.push(e.seq)
    }
    assert.deepEqual(seqs, [1, 2, 3, 4, 5], '单进程语义不变：seq 严格递增从 1 起')
    // 回放与追加返回一致
    const replayed = host.replayTrail(runId)
    assert.deepEqual(replayed.map((e) => e.seq), seqs)
    host.close()
  } finally {
    cleanupDir(ws)
  }
})

test('P2-3: model 不得 demote constraint/observation（lifecycle 角色门控）', () => {
  const ws = makeTempWs()
  try {
    const host = MemoryNet.open(ws, { agentId: 'host', role: 'host' })
    const c = host.add('constraint', { key: 'no-delete', text: '禁止删库', payload: { mode: 'forbid' } })
    const o = host.add('observation', { key: 'k', text: '观测', source: 'tool' })
    const model = MemoryNet.open(ws, { agentId: 'm', role: 'model' })
    assert.throws(() => model.demote(c.id), WriteForbiddenError, 'model demote constraint 必须被拒')
    assert.throws(() => model.demote(o.id), WriteForbiddenError, 'model demote observation 必须被拒')
    // host 不受影响
    const demoted = host.demote(c.id, { reason: '规则过期' })
    assert.equal(demoted.status, 'demoted')
    // model 对自己可写的 kind（inference/tip）仍可 demote（写纪律矩阵内）
    const tip = model.add('tip', { text: '提示' })
    const demotedTip = model.demote(tip.id, { reason: '过时' })
    assert.equal(demotedTip.status, 'demoted')
    host.close()
    model.close()
  } finally {
    cleanupDir(ws)
  }
})

test('P2-3b: contradict 无 evidence 且无 note 时拒绝', () => {
  const ws = makeTempWs()
  try {
    const host = MemoryNet.open(ws, { agentId: 'host', role: 'host' })
    const model = MemoryNet.open(ws, { agentId: 'm', role: 'model' })
    const inf = model.add('inference', { text: '推断', confidence: 0.7 })
    assert.throws(
      () => model.contradict(inf.id),
      /evidence（观测 id 列表）或 note（文字依据）至少其一/,
      '无依据推翻必须被拒',
    )
    // 带 note 通过
    const ok = model.contradict(inf.id, { note: '实测与推断相反' })
    assert.equal(ok.status, 'contradicted')
    host.close()
    model.close()
  } finally {
    cleanupDir(ws)
  }
})

test('P2-6: CLI import 坏 JSON / 缺文件 → 退出码 2 + 可读信息（不再裸抛）', async () => {
  const ws = makeTempWs()
  const badPkg = `${ws}/bad.json`
  try {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(badPkg, '{ not json', 'utf8')
    const rcBad = await runCli(['import', badPkg, '--to', `${ws}/ws`])
    assert.equal(rcBad, 2, '坏 JSON 应归类为拒绝（exit 2）')
    const rcMissing = await runCli(['import', `${ws}/nope.json`, '--to', `${ws}/ws`])
    assert.equal(rcMissing, 2, '缺文件应归类为拒绝（exit 2）')
  } finally {
    cleanupDir(ws)
  }
})

test('P2-7: 同 key 覆盖链保持恒有一个 active 观测（事务原子回归锁）', () => {
  const ws = makeTempWs()
  try {
    const tool = MemoryNet.open(ws, { agentId: 'tool', role: 'tool' })
    const model = MemoryNet.open(ws, { agentId: 'm', role: 'model' })
    const obs1 = tool.add('observation', { key: 'svc', text: 'v1 状态', source: 'tool' })
    const inf = model.add('inference', { text: '基于 v1 的推断', confidence: 0.6, based_on: [obs1.id] })
    const obs2 = tool.add('observation', { key: 'svc', text: 'v2 状态', source: 'tool' })
    const obs3 = tool.add('observation', { key: 'svc', text: 'v3 状态', source: 'tool' })
    assert.equal(tool.get(obs1.id)!.status, 'superseded')
    assert.equal(tool.get(obs2.id)!.status, 'superseded')
    assert.equal(tool.get(obs3.id)!.status, 'active', '最新观测恒 active')
    assert.equal(model.get(inf.id)!.status, 'contradicted', 'based_on 联动在新实现（instr）下照常生效')
    // 三连覆盖后 active 观测恰好一条
    const actives = tool.activate('svc').nodes.filter((rn) => rn.node.kind === 'observation' && rn.node.key === 'svc')
    assert.equal(actives.length, 1)
    tool.close()
    model.close()
  } finally {
    cleanupDir(ws)
  }
})

// ---------------------------------------------------------------------------
// 会话 14 P3：confidence NaN 校验穿透（NaN<0 / NaN>1 恒 false → 落库 NULL）
// ---------------------------------------------------------------------------

test('P3-14a: inference confidence=NaN 被拒绝（不落库成 NULL，不变量「inference 必带 confidence」不被破坏）', () => {
  const ws = makeTempWs()
  try {
    const host = MemoryNet.open(ws, { agentId: 'host', role: 'host' })
    assert.throws(
      () => host.add('inference', { key: 'nan-conf', text: 'x', confidence: NaN }),
      /confidence/,
    )
    // Infinity 同族
    assert.throws(
      () => host.add('inference', { key: 'inf-conf', text: 'x', confidence: Infinity }),
      /confidence/,
    )
    // 正常值不受影响
    const n = host.add('inference', { key: 'ok-conf', text: 'x', confidence: 0.5 })
    assert.equal(n.confidence, 0.5)
  } finally {
    cleanupDir(ws)
  }
})
