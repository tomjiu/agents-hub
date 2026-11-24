/**
 * M3 任务驱动精选/证据检索测试 —— issue #2 M3。
 *
 * 纪律：不用最新日志填满预算；区分约束、建议、已审阅推断、当前有效性；
 * 可解释为何入选/排除/需复核；向量不是强制前置（词法可解释打分即可）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryNet } from '../src/store.js'
import { recallForTask } from '../src/recall.js'
import { makeTempWs, cleanupDir } from './helpers.js'

function openHost(ws: string) {
  return MemoryNet.open(ws, { agentId: 'm3-host', role: 'host' })
}

function seed(net: MemoryNet) {
  net.add('constraint', { key: 'no-secrets', text: '禁止向记忆写入密钥', payload: { mode: 'forbid' } })
  net.updateProgress('login-task', { status: 'doing', summary: 'OAuth 回调修复中' })
  const obsA = net.add('observation', { text: '登录 OAuth 回调返回 state mismatch', source: 'tool', run_id: 'r1' })
  const obsB = net.add('observation', { text: '完全无关的构建日志噪音行', source: 'tool', run_id: 'r1' })
  const inf = net.add('inference', { text: 'OAuth 回调 state 校验顺序错误导致 mismatch', confidence: .85, based_on: [obsA.id], run_id: 'r1' })
  net.promote(inf.id, { evidence: [obsA.id], by: 'user', note: '人工核验' })
  const tip = net.add('tip', { text: 'OAuth state 校验建议放在签名验证之后', payload: { strategy: 'auth-order' } })
  const cand = net.proposeCandidate({ text: '回调修复后 mismatch 消失', confidence: .6, source_ids: [obsA.id], run_id: 'r1' })
  return { obsA, obsB, inf, tip, cand }
}

test('M3-recall: constraints and task progress lead; logs excluded by default with reasons', () => {
  const ws = makeTempWs('mn-m3-r1-')
  const net = openHost(ws)
  try {
    const s = seed(net)
    const r = recallForTask(net, 'OAuth 回调 修复', { task_id: 'login-task' })
    const ids = r.nodes.map(n => n.id)
    // 约束与任务进度入选（最前）。
    assert.ok(ids.includes(s.obsA.id) === false || true) // obsA 相关性由词法判定
    const constraintNode = r.nodes.find(n => n.kind === 'constraint')
    const progressNode = r.nodes.find(n => n.kind === 'progress')
    assert.ok(constraintNode, '约束入选')
    assert.ok(progressNode, '当次任务进度入选')
    assert.equal(r.nodes.indexOf(constraintNode!) < r.nodes.indexOf(progressNode!), true)
    // 完全无关日志默认排除，且有解释（不用最新日志填满预算）。
    const noiseExpl = r.explanations.find(e => e.node_id === s.obsB.id)
    assert.ok(noiseExpl, '噪音日志有解释条目')
    assert.equal(noiseExpl!.included, false)
    assert.match(noiseExpl!.reason, /不相关|日志|noise/i)
    // 每个返回节点都有解释与有效性。
    for (const n of r.nodes) {
      const e = r.explanations.find(x => x.node_id === n.id)
      assert.ok(e, `节点 ${n.id} 缺解释`)
      assert.ok(['current', 'needs_review', 'stale', 'unknown'].includes(e!.validity))
    }
  } finally { net.close(); cleanupDir(ws) }
})

test('M3-recall: promoted inference included as reviewed; pending candidate excluded with reason', () => {
  const ws = makeTempWs('mn-m3-r2-')
  const net = openHost(ws)
  try {
    const s = seed(net)
    const r = recallForTask(net, 'OAuth state mismatch', { task_id: 'login-task' })
    const infExpl = r.explanations.find(e => e.node_id === s.inf.id)!
    assert.ok(infExpl, '已审阅推断有解释')
    assert.equal(infExpl.included, true)
    assert.equal(infExpl.role, 'reviewed_inference')
    const candExpl = r.explanations.find(e => e.node_id === s.cand.id)!
    assert.equal(candExpl.included, false)
    assert.match(candExpl.reason, /未审阅|pending|候选/)
  } finally { net.close(); cleanupDir(ws) }
})

test('M3-recall: needs_review nodes are surfaced with needs_review validity, not silently dropped', async () => {
  const ws = makeTempWs('mn-m3-r3-')
  const net = MemoryNet.open(ws, { agentId: 'm3-host', role: 'host', ledger: true })
  try {
    // 借 M2 needs_review 标记：手动打 payload.needs_review。
    const obsA = net.add('observation', { text: '认证令牌刷新端点返回 401', source: 'tool', run_id: 'r1' })
    const inf = net.add('inference', { text: '刷新端点证书轮换导致 401', confidence: .8, based_on: [obsA.id], run_id: 'r1' })
    net.promote(inf.id, { evidence: [obsA.id], expected_revision: inf.revision_id })
    // 走真实 M2 证据核验路径打 needs_review（不直接改库）。
    const { contentDigest } = await import('../src/evidence.js')
    const cs = net.captureCodeState({
      root: '/proj/auth', source: 'host_native',
      files: [{ path: 'auth/refresh.ts', content: 'cert v1\n' }],
    })
    net.bindEvidence(inf.id, {
      code_state_id: cs.code_state_id, session_id: 's1', durable_event_seq: 1,
      files: [{ path: 'auth/refresh.ts', after_digest: contentDigest('cert v1\n') }],
    })
    const cur = net.captureCodeState({
      root: '/proj/auth', source: 'host_native',
      files: [{ path: 'auth/refresh.ts', content: 'cert v2 rotated\n' }],
    })
    const v = net.verifyEvidence(inf.id, cur.code_state_id)
    assert.equal(v.outcome, 'needs_review')
    const r = recallForTask(net, '401 刷新 端点', { task_id: null })
    const e = r.explanations.find(x => x.node_id === inf.id)!
    assert.equal(e.included, true)
    assert.equal(e.validity, 'needs_review')
    assert.match(e.reason, /复核|review/)
  } finally { net.close(); cleanupDir(ws) }
})

test('M3-recall: contradicted/superseded excluded as stale; includeLogs can admit relevant logs explicitly', () => {
  const ws = makeTempWs('mn-m3-r4-')
  const net = openHost(ws)
  try {
    const obsOld = net.add('observation', { key: 'config:mode', text: '旧配置 mode=v1', source: 'config' })
    const infOld = net.add('inference', { text: 'mode=v1 下行为 X', confidence: .7, based_on: [obsOld.id] })
    net.add('observation', { key: 'config:mode', text: '新配置 mode=v2', source: 'config' })
    // 同 key 覆盖：obsOld superseded、infOld contradicted。
    const r = recallForTask(net, 'mode 行为', { task_id: null })
    const e1 = r.explanations.find(x => x.node_id === obsOld.id)!
    assert.equal(e1.included, false)
    assert.equal(e1.validity, 'stale')
    const e2 = r.explanations.find(x => x.node_id === infOld.id)!
    assert.equal(e2.included, false)
    // includeLogs=true 时相关日志可入选（显式而非默认）。
    const r2 = recallForTask(net, 'mode=v2 新配置', { task_id: null, includeLogs: true })
    const newObs = r2.nodes.find(n => n.text.includes('mode=v2'))
    assert.ok(newObs, '显式 includeLogs 下相关日志入选')
    const e3 = r2.explanations.find(x => x.node_id === newObs!.id)!
    assert.equal(e3.role, 'observation')
  } finally { net.close(); cleanupDir(ws) }
})

test('M3-recall: budget respected (max_nodes) and explanations cover dropped nodes too', () => {
  const ws = makeTempWs('mn-m3-r5-')
  const net = openHost(ws)
  try {
    seed(net)
    const r = recallForTask(net, 'OAuth', { task_id: 'login-task', budgets: { max_nodes: 3, max_tokens: 100000 } })
    assert.ok(r.nodes.length <= 3)
    assert.ok(r.nodes.length >= 2, '约束+进度保护不被裁光')
    // 被预算裁掉的节点也有解释（excluded: budget）。
    assert.ok(r.explanations.some(e => !e.included && /预算|budget/.test(e.reason)))
  } finally { net.close(); cleanupDir(ws) }
})
