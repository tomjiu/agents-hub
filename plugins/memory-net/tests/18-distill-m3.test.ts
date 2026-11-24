/**
 * M3 可控候选提炼测试 —— issue #2 M3。
 *
 * 纪律：默认离线 fixture 提取器；有界（队列/频率/每run/token 上限）；可取消；
 * 失败不阻断原工具；自动产物只能 pending；不自动 accept；重复事件聚合不冒充独立实验。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryNet } from '../src/store.js'
import { Distiller, defaultExtractor, type DistillConfig, type DistillEvent } from '../src/distill.js'
import { makeTempWs, cleanupDir } from './helpers.js'

function openHost(ws: string) {
  return MemoryNet.open(ws, { agentId: 'm3-host', role: 'host' })
}

function obsEvent(net: MemoryNet, text: string, run = 'r1'): DistillEvent {
  const n = net.add('observation', { text, source: 'tool', run_id: run })
  return { node_id: n.id, run_id: run, task_id: null, kind: 'observation', text, payload: n.payload }
}

test('M3-distill: fixture extractor aggregates repeated identical events, not per-event candidates', async () => {
  const ws = makeTempWs('mn-m3-agg-')
  const net = openHost(ws)
  try {
    const ev1 = obsEvent(net, '工具 build 成功·args(a)→ ok')
    const ev2 = obsEvent(net, '工具 build 成功·args(a)→ ok')
    const ev3 = obsEvent(net, '工具 build 成功·args(a)→ ok')
    const claims = defaultExtractor([ev1, ev2, ev3], { maxTextChars: 400 })
    // 聚合为一条主张（3 次独立事件是同一实验的重复，不是 3 个实验）。
    assert.equal(claims.length, 1)
    assert.equal(claims[0]!.source_ids.length, 3)
    assert.ok(claims[0]!.text.includes('build'))
    assert.ok(claims[0]!.confidence <= 0.5, '自动提炼置信度必须保守（≤0.5）')
  } finally { net.close(); cleanupDir(ws) }
})

test('M3-distill: bounded queue drops with counted reason, never blocks the caller', async () => {
  const ws = makeTempWs('mn-m3-queue-')
  const net = openHost(ws)
  try {
    const cfg: DistillConfig = { enabled: true, mode: 'fixture', maxQueue: 4, maxPerRun: 8, minIntervalMs: 0, tokenBudget: 100000, maxTextChars: 400 }
    const d = new Distiller(net, cfg)
    for (let i = 0; i < 10; i++) {
      const n = net.add('observation', { text: `工具 build 成功·args(x${i})→ ok`, source: 'tool', run_id: 'r1' })
      assert.doesNotThrow(() => d.offer({ node_id: n.id, run_id: 'r1', task_id: null, kind: 'observation', text: n.text, payload: n.payload }))
    }
    const st = d.stats()
    assert.equal(st.offered, 10)
    assert.equal(st.dropped_queue_full, 6)
    await d.drain()
    const st2 = d.stats()
    assert.ok(st2.proposed >= 1)
    // 队列有界：提炼入库候选数受每 run 上限约束。
    const cands = net.candidates({ run_id: 'r1', limit: 100 })
    assert.ok(cands.length <= cfg.maxPerRun)
    assert.ok(cands.every(c => (c.payload.memory_candidate as { state: string }).state === 'pending'), '自动产物只能是 pending')
  } finally { net.close(); cleanupDir(ws) }
})

test('M3-distill: rate limit and token budget are enforced and reported', async () => {
  const ws = makeTempWs('mn-m3-budget-')
  const net = openHost(ws)
  try {
    const cfg: DistillConfig = { enabled: true, mode: 'fixture', maxQueue: 100, maxPerRun: 100, minIntervalMs: 60_000, tokenBudget: 100_000, maxTextChars: 400 }
    const d = new Distiller(net, cfg)
    for (const tag of ['a1', 'a2']) {
      const n1 = net.add('observation', { text: `工具 warm 成功·args(${tag})→ ok`, source: 'tool', run_id: 'r1' })
      d.offer({ node_id: n1.id, run_id: 'r1', task_id: null, kind: 'observation', text: n1.text, payload: n1.payload })
    }
    await d.drain()
    assert.ok(d.stats().proposed >= 1)
    const n2 = net.add('observation', { text: '工具 b 成功·args(x)→ ok', source: 'tool', run_id: 'r1' })
    d.offer({ node_id: n2.id, run_id: 'r1', task_id: null, kind: 'observation', text: n2.text, payload: n2.payload })
    await d.drain()
    // 频率限制：第二次 drain 在冷却窗口内被跳过（计数，不抛错）。
    assert.ok(d.stats().dropped_rate_limited >= 1)
    // token 预算耗尽后不再提炼。
    const d2cfg: DistillConfig = { ...cfg, minIntervalMs: 0, tokenBudget: 10 }
    const d2 = new Distiller(net, d2cfg)
    const before = net.candidates({ run_id: 'r1', limit: 100 }).length
    for (const tag of ['c1', 'c2']) {
      const n3 = net.add('observation', { text: `工具 cold 成功·args(${tag})→ ok`, source: 'tool', run_id: 'r1' })
      d2.offer({ node_id: n3.id, run_id: 'r1', task_id: null, kind: 'observation', text: n3.text, payload: n3.payload })
    }
    await d2.drain()
    assert.ok(d2.stats().dropped_budget >= 1)
    assert.equal(net.candidates({ run_id: 'r1', limit: 100 }).length, before)
  } finally { net.close(); cleanupDir(ws) }
})

test('M3-distill: abort cancels pending drain; extractor errors are counted not thrown', async () => {
  const ws = makeTempWs('mn-m3-cancel-')
  const net = openHost(ws)
  try {
    const cfg: DistillConfig = { enabled: true, mode: 'custom', maxQueue: 10, maxPerRun: 10, minIntervalMs: 0, tokenBudget: 100000, maxTextChars: 400 }
    const boom = new Distiller(net, cfg, async () => { throw new Error('extractor offline') })
    const n = net.add('observation', { text: '工具 x 成功·args(x)→ ok', source: 'tool', run_id: 'r1' })
    boom.offer({ node_id: n.id, run_id: 'r1', task_id: null, kind: 'observation', text: n.text, payload: n.payload })
    await boom.drain()
    assert.ok(boom.stats().dropped_extract_error >= 1, '提取器失败计数，不抛出')

    const ac = new AbortController()
    const slow = new Distiller(net, cfg, async (events, ctx) => {
      ac.abort()
      return [{ text: 'late claim', confidence: 0.3, source_ids: events.map(e => e.node_id), run_id: 'r1', task_id: null }]
    })
    const n2 = net.add('observation', { text: '工具 y 成功·args(x)→ ok', source: 'tool', run_id: 'r1' })
    slow.offer({ node_id: n2.id, run_id: 'r1', task_id: null, kind: 'observation', text: n2.text, payload: n2.payload })
    await slow.drain(ac.signal)
    assert.ok(slow.stats().dropped_cancelled >= 1, '取消信号生效')
  } finally { net.close(); cleanupDir(ws) }
})

test('M3-distill: model-role net cannot distill (host/tool discipline)', () => {
  const ws = makeTempWs('mn-m3-role-')
  const net = MemoryNet.open(ws, { agentId: 'model-1', role: 'model', ledger: false })
  try {
    const d = new Distiller(net as never, { enabled: true, mode: 'fixture', maxQueue: 4, maxPerRun: 4, minIntervalMs: 0, tokenBudget: 10000, maxTextChars: 400 })
    const n = net.add('tip', { text: 'tip text' })
    assert.throws(() => d.offer({ node_id: n.id, run_id: 'r1', task_id: null, kind: 'tip', text: 'x', payload: {} }), /host|tool|角色/)
  } finally { net.close(); cleanupDir(ws) }
})

test('M3-distill: disabled config offers nothing; custom extractor is the only non-offline path', async () => {
  const ws = makeTempWs('mn-m3-off-')
  const net = openHost(ws)
  try {
    const d = new Distiller(net, { enabled: false, mode: 'fixture', maxQueue: 4, maxPerRun: 4, minIntervalMs: 0, tokenBudget: 10000, maxTextChars: 400 })
    const n = net.add('observation', { text: '工具 z 成功·args(x)→ ok', source: 'tool', run_id: 'r1' })
    d.offer({ node_id: n.id, run_id: 'r1', task_id: null, kind: 'observation', text: n.text, payload: n.payload })
    await d.drain()
    assert.equal(d.stats().proposed, 0)
    assert.ok(d.stats().dropped_disabled >= 1)
  } finally { net.close(); cleanupDir(ws) }
})
