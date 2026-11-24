/**
 * M4 跨会话授权/隐私/增长治理测试（issue #2 M4）。
 * 纪律：默认拒绝；task 身份（≠session）；撤销/过期即时生效；脱敏副本不改原件；
 * 不混合对端库；host 专属；GC 证据闭包不删有效结论依据。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MemoryNet } from '../src/store.js'
import { WorkspaceError } from '../src/errors.js'
import { grantAllows } from '../src/grants.js'
import { redactNode, DEFAULT_REDACTION_RULES } from '../src/privacy.js'

function mkws(name: string): { dir: string; net: MemoryNet } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-m4-' + name + '-'))
  const net = MemoryNet.open(dir, { agentId: 'owner-host', role: 'host', workspaceId: name })
  return { dir, net }
}

test('grantAllows: 默认拒绝 + task 身份校验（≠ session）', () => {
  const g = {
    grant_id: 'g1', owner_agent: 'o', grantee_task: 'task-billing', grantee_agent: null,
    kinds: 'all' as const, created_at: 1, expires_at: 0, revoked_at: null, note: '',
  }
  const now = 1000
  // 任务匹配 → 允许
  assert.equal(grantAllows(g, { task_id: 'task-billing', agent_id: 'anyone' }, 'observation', now), true)
  // 其他任务 → 拒绝
  assert.equal(grantAllows(g, { task_id: 'task-other', agent_id: 'anyone' }, 'observation', now), false)
  // 无任务 → 拒绝
  assert.equal(grantAllows(g, { task_id: null, agent_id: 'anyone' }, 'observation', now), false)
  // 会话 id 即使撞上授权键也按任务身份比较——grant 键是业务任务, 不是 session
  // (语义上 session id 只存在于 provenance 坐标, 不进 grant 表)
  // kinds 范围
  const gk = { ...g, kinds: ['observation' as const] }
  assert.equal(grantAllows(gk, { task_id: 'task-billing', agent_id: 'a' }, 'observation', now), true)
  assert.equal(grantAllows(gk, { task_id: 'task-billing', agent_id: 'a' }, 'inference', now), false)
  // 撤销/过期
  assert.equal(grantAllows({ ...g, revoked_at: 999 }, { task_id: 'task-billing', agent_id: 'a' }, 'observation', now), false)
  assert.equal(grantAllows({ ...g, expires_at: 999 }, { task_id: 'task-billing', agent_id: 'a' }, 'observation', now), false)
  // agent 限定
  const ga = { ...g, grantee_agent: 'alice' }
  assert.equal(grantAllows(ga, { task_id: 'task-billing', agent_id: 'alice' }, 'observation', now), true)
  assert.equal(grantAllows(ga, { task_id: 'task-billing', agent_id: 'bob' }, 'observation', now), false)
})

test('跨会话读取：无 grant 默认拒绝；显式 grant 后按 scope 放行；不混合库', () => {
  const src = mkws('src')
  const dst = mkws('dst')
  try {
    src.net.add('observation', { text: 'billing service uses postgres 15', source: 'tool', run_id: 'r1' })
    src.net.add('inference', { text: 'billing db needs migration plan', confidence: .7, based_on: [] })
    src.net.add('constraint', { key: 'c1', text: 'do not touch prod', payload: { mode: 'forbid' } })

    // dst 宿主先尝试无 grant 读取 → 默认拒绝
    const noGrants = src.net.grants()
    assert.equal(noGrants.length, 0)
    assert.throws(() => dst.net.readGranted(src.net, 'g-nonexistent', { task_id: 'task-billing' }), WorkspaceError)

    // src 宿主显式 grant: 只授权 observation
    const grant = src.net.grantAccess({ grantee_task: 'task-billing', kinds: ['observation'], note: 'billing migration' })
    // dst 以任务身份读取（跨会话：dst 的 session/run 与 src 无关）
    const view = dst.net.readGranted(src.net, grant.grant_id, { task_id: 'task-billing' })
    assert.equal(view.nodes.length, 1, 'only granted kind visible')
    assert.equal(view.nodes[0]!.kind, 'observation')
    assert.ok(!view.nodes.some(n => n.kind === 'constraint'), 'constraint not in grant scope')

    // 不混合: dst 库中不出现对端节点
    assert.equal(dst.net.listNodes().length, 0, 'granted view must not mix into caller db')

    // 任务身份不匹配 → 拒绝
    assert.throws(() => dst.net.readGranted(src.net, grant.grant_id, { task_id: 'task-other' }), WorkspaceError)
  } finally {
    src.net.close(); dst.net.close()
    fs.rmSync(src.dir, { recursive: true, force: true }); fs.rmSync(dst.dir, { recursive: true, force: true })
  }
})

test('撤销与过期：即时生效', () => {
  const src = mkws('rev-src')
  const dst = mkws('rev-dst')
  try {
    src.net.add('observation', { text: 'shared fact', source: 'tool' })
    const grant = src.net.grantAccess({ grantee_task: 'task-x' })
    assert.doesNotThrow(() => dst.net.readGranted(src.net, grant.grant_id, { task_id: 'task-x' }))
    // 撤销 → 立即拒绝
    src.net.revokeGrant(grant.grant_id)
    assert.throws(() => dst.net.readGranted(src.net, grant.grant_id, { task_id: 'task-x' }), WorkspaceError)
    // 过期 grant (ttl=1ms) → 拒绝
    const ttlGrant = src.net.grantAccess({ grantee_task: 'task-y', ttl_ms: 1 })
    const before = Date.now()
    while (Date.now() < before + 5) { /* 等 ttl 过期 */ }
    assert.throws(() => dst.net.readGranted(src.net, ttlGrant.grant_id, { task_id: 'task-y' }), WorkspaceError)
  } finally {
    src.net.close(); dst.net.close()
    fs.rmSync(src.dir, { recursive: true, force: true }); fs.rmSync(dst.dir, { recursive: true, force: true })
  }
})

test('脱敏：读取边界掩码敏感字段；原件不可变', () => {
  const src = mkws('priv-src')
  const dst = mkws('priv-dst')
  try {
    src.net.add('observation', {
      text: 'deployed with api_key sk-abcdef1234567890abcdef on host-1',
      source: 'tool',
      payload: { password: 'hunter2', api_key: 'sk-abcdef1234567890abcdef', note: 'ordinary' },
    })
    const grant = src.net.grantAccess({ grantee_task: 'task-sec-audit' })
    const view = dst.net.readGranted(src.net, grant.grant_id, { task_id: 'task-sec-audit' })
    const node = view.nodes[0]!
    assert.equal(node.payload['password'], '[REDACTED]')
    assert.ok(!String(node.payload['api_key']).includes('sk-abcdef1234567890abcdef'))
    assert.ok(!node.text.includes('sk-abcdef1234567890abcdef'), 'text pattern must be masked')
    assert.equal(node.payload['note'], 'ordinary', 'non-sensitive fields untouched')
    assert.ok(view.redacted_fields >= 2)
    // 原件不可变（账本纪律）：src 侧原文仍在
    const original = src.net.listNodes()[0]!
    assert.equal(original.payload['password'], 'hunter2')
    assert.ok(original.text.includes('sk-abcdef1234567890abcdef'))
  } finally {
    src.net.close(); dst.net.close()
    fs.rmSync(src.dir, { recursive: true, force: true }); fs.rmSync(dst.dir, { recursive: true, force: true })
  }
})

test('redactNode: 规则形态覆盖（AWS key/Bearer/gh token/长密钥）', () => {
  const n = {
    id: 'n1', kind: 'inference' as const, agent_id: 'a', run_id: null, task_id: null, key: null,
    text: 'keys: AKIAIOSFODNN7EXAMPLE and ghp_' + 'a'.repeat(30) + ' and Bearer abcdef12345678901234',
    payload: {}, source: null, confidence: .5, status: 'active' as const, conflict: false,
    conflict_detail: null, based_on: [], created_at: 1, updated_at: 1, revision_id: undefined,
  }
  const { node, masked } = redactNode(n, DEFAULT_REDACTION_RULES)
  assert.ok(masked >= 3)
  assert.ok(!node.text.includes('AKIAIOSFODNN7EXAMPLE'))
  assert.ok(!node.text.includes('ghp_'))
  assert.ok(!node.text.includes('Bearer abcdef'))
})

test('host 专属：模型角色不可 grant/revoke/readGranted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-m4-role-'))
  const model = MemoryNet.open(dir, { agentId: 'model-1', role: 'model', workspaceId: 'w' })
  try {
    assert.throws(() => model.grantAccess({ grantee_task: 't' }), WorkspaceError)
    assert.throws(() => model.revokeGrant('g1'), WorkspaceError)
    assert.throws(() => (model as unknown as { readGranted(): unknown }).readGranted(), WorkspaceError)
  } finally {
    model.close(); fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('GC 证据闭包：purge 不删除仍支撑有效结论的依据', () => {
  const { dir, net } = mkws('gc')
  try {
    const obs = net.add('observation', { text: 'evidence A', source: 'tool' })
    const decision = net.add('inference', { text: 'conclusion from A', confidence: .9, based_on: [obs.id] })
    net.promote(decision.id, { evidence: [obs.id] })
    // obs 保持 active（被有效结论引用）→ purge 不得删除
    const report = net.gc({ purge: true })
    assert.ok(net.get(obs.id) !== null, 'evidence supporting live conclusion must survive purge')
    assert.ok(net.get(decision.id) !== null)
    assert.equal(report.purged, 0)
    // 无引用的 demoted 节点可被 purge
    const lone = net.add('tip', { text: 'stale tip', payload: { strategy: 'x' } })
    net.demote(lone.id)
    const report2 = net.gc({ purge: true })
    assert.ok(report2.purged >= 1, 'unreferenced demoted node should be purged')
    assert.equal(net.get(lone.id), null)
    // 有效结论的依据仍在
    assert.ok(net.get(obs.id) !== null)
  } finally {
    net.close(); fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('增长治理：10k 节点插入 + 投影/召回查询延迟有界', async () => {
  const { dir, net } = mkws('growth')
  try {
    const t0 = Date.now()
    for (let i = 0; i < 10_000; i++) {
      net.add('observation', { text: `obs ${i} baseline metric value ${i % 97}`, source: 'tool', run_id: 'r-grow' })
    }
    const insertMs = Date.now() - t0
    const t1 = Date.now()
    const proj = net.nodesForProjection()
    const projMs = Date.now() - t1
    assert.equal(proj.length, 10_000)
    // 粗界: 沙箱内 10k 插入 < 30s, 全量投影 < 3s (超界=基准退化信号, 不是硬性产品 SLA)
    assert.ok(insertMs < 30_000, `insert too slow: ${insertMs}ms`)
    assert.ok(projMs < 3_000, `projection too slow: ${projMs}ms`)
    const { recallForTask } = await import('../src/recall.js')
    const t2 = Date.now()
    const recalled = recallForTask(net, 'baseline metric', { budgets: { max_nodes: 10 } })
    const recallMs = Date.now() - t2
    assert.ok(recallMs < 3_000, `recall too slow: ${recallMs}ms`)
    assert.ok(recalled.nodes.length <= 10)
  } finally {
    net.close(); fs.rmSync(dir, { recursive: true, force: true })
  }
})
