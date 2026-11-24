/**
 * M2 宿主会话／代码版本绑定测试 —— issue #2 M2 验收。
 *
 * 纪律：独立临时库；账本挂载显式 opt-in；缺元数据 = unknown，绝不补造；
 * Git commit 不能代表完整工作树；同内容重验不证伪；无关变化不失效；
 * 相关变化标 needs_review 且原证据可定位。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryNet } from '../src/store.js'
import { contentDigest, CAPTURE_POLICY, type CodeStateInput } from '../src/evidence.js'
import { makeTempWs, cleanupDir } from './helpers.js'

function openLedgered(ws: string, agentId = 'm2-host', role: 'host' | 'model' | 'tool' = 'host') {
  return MemoryNet.open(ws, { agentId, role, ledger: true })
}

/** git-only 捕获输入（无文件摘要，无全量枚举声明）。 */
function gitOnlyInput(overrides: Partial<CodeStateInput> = {}): CodeStateInput {
  return {
    root: '/proj/repo',
    source: 'git',
    git: { commit: 'a'.repeat(40), status: 'clean' },
    ...overrides,
  }
}

/** 宿主原生捕获：给出全部文件摘要 + 全量枚举声明 + git clean。 */
function fullNativeInput(overrides: Partial<CodeStateInput> = {}): CodeStateInput {
  return {
    root: '/proj/repo',
    source: 'host_native',
    fullEnumeration: true,
    git: { commit: 'b'.repeat(40), status: 'clean' },
    files: [
      { path: 'src/a.ts', content: 'export const a = 1\n' },
      { path: 'src/b.ts', content: 'export const b = 2\n' },
    ],
    ...overrides,
  }
}

test('M2-capture: git commit alone never claims complete working tree', () => {
  const ws = makeTempWs('mn-m2-git-')
  const net = openLedgered(ws)
  try {
    const st = net.captureCodeState(gitOnlyInput())
    assert.equal(st.git_commit, 'a'.repeat(40))
    assert.equal(st.git_status, 'clean')
    // Git commit 不能代表完整工作树：无文件摘要、无枚举声明 → 至多 partial。
    assert.equal(st.completeness, 'partial')
    assert.equal(st.capture_policy, CAPTURE_POLICY)
    assert.deepEqual(st.files, {})
  } finally { net.close(); cleanupDir(ws) }
})

test('M2-capture: dirty/untracked never masquerade as clean or complete', () => {
  const ws = makeTempWs('mn-m2-dirty-')
  const net = openLedgered(ws)
  try {
    const st = net.captureCodeState({
      root: '/proj/repo', source: 'host_native', fullEnumeration: true,
      git: { commit: 'c'.repeat(40), status: 'dirty', changedFiles: ['src/a.ts'], untrackedFiles: ['tmp/x.log'] },
      files: [{ path: 'src/a.ts', content: 'dirty\n' }],
    })
    assert.equal(st.git_status, 'dirty')
    assert.equal(st.completeness, 'partial') // dirty → 永不 complete
    assert.deepEqual(st.changed_files, ['src/a.ts'])
    assert.deepEqual(st.untracked_files, ['tmp/x.log'])
    // untracked 不可得 → 标 unknown，不猜空。
    const st2 = net.captureCodeState({
      root: '/proj/repo', source: 'host_native', fullEnumeration: true,
      git: { commit: 'c'.repeat(40), status: 'clean', untrackedUnknown: true },
      files: [{ path: 'src/a.ts', content: 'x\n' }],
    })
    assert.equal(st2.untracked_unknown, true)
    assert.equal(st2.completeness, 'partial')
  } finally { net.close(); cleanupDir(ws) }
})

test('M2-capture: full native enumeration with digests may be complete', () => {
  const ws = makeTempWs('mn-m2-full-')
  const net = openLedgered(ws)
  try {
    const st = net.captureCodeState(fullNativeInput())
    assert.equal(st.completeness, 'complete')
    assert.ok(Object.keys(st.files).length === 2)
    assert.equal(st.files['src/a.ts'], contentDigest('export const a = 1\n'))
  } finally { net.close(); cleanupDir(ws) }
})

test('M2-capture: shell side-effect observation without digests stays unknown', () => {
  const ws = makeTempWs('mn-m2-shell-')
  const net = openLedgered(ws)
  try {
    const st = net.captureCodeState({ root: '/proj/repo', source: 'shell', git: { commit: null, status: 'unknown' } })
    assert.equal(st.completeness, 'unknown')
    assert.equal(st.git_commit, null)
    // shell 给出个别文件摘要 → 至多 partial（shell 观测不能证明全树已知）。
    const st2 = net.captureCodeState({
      root: '/proj/repo', source: 'shell', fullEnumeration: true,
      files: [{ path: 'out.txt', content: 'built\n' }],
    })
    assert.equal(st2.completeness, 'partial')
  } finally { net.close(); cleanupDir(ws) }
})

test('M2-capture: missing digest and content means per-file unknown, never fabricated', () => {
  const ws = makeTempWs('mn-m2-miss-')
  const net = openLedgered(ws)
  try {
    const st = net.captureCodeState({
      root: '/p', source: 'host_native',
      files: [{ path: 'known.ts', content: 'k\n' }, { path: 'opaque.bin' }],
    })
    assert.ok('known.ts' in st.files)
    assert.ok(!('opaque.bin' in st.files)) // 无摘要 → 不出现在已知文件表，不编造
  } finally { net.close(); cleanupDir(ws) }
})

test('M2-capture: CRLF and LF normalize to the same digest', () => {
  assert.equal(contentDigest('a\r\nb\r\n'), contentDigest('a\nb\n'))
  assert.notEqual(contentDigest('a\nb\n'), contentDigest('a\nb \n')) // 行尾空白是内容变化
})

test('M2-bind: link_status distinguishes captured / event_linked / persisted_unknown', () => {
  const ws = makeTempWs('mn-m2-bind-')
  const net = openLedgered(ws)
  try {
    const cs = net.captureCodeState(fullNativeInput())
    const obs = net.add('observation', { text: 'edited a.ts', source: 'tool' })
    const r1 = net.bindEvidence(obs.id, {
      code_state_id: cs.code_state_id,
      session_id: 'sess-1', durable_event_seq: 42, call_id: 'call-9', root_call_id: 'call-1',
      files: [{ path: 'src/a.ts', before_digest: contentDigest('export const a = 1\n'), after_digest: contentDigest('export const a = 2\n') }],
    })
    assert.equal(r1.link_status, 'captured')
    assert.equal(r1.durable_event_seq, 42)
    assert.equal(r1.files[0]!.before_digest, contentDigest('export const a = 1\n'))

    const obs2 = net.add('observation', { text: 'child step', source: 'tool' })
    const r2 = net.bindEvidence(obs2.id, { code_state_id: cs.code_state_id, call_id: 'call-10', root_call_id: 'call-1' })
    assert.equal(r2.link_status, 'event_linked') // 有 call 坐标、无持久事件序号

    const obs3 = net.add('observation', { text: 'no coords', source: 'tool' })
    const r3 = net.bindEvidence(obs3.id, { code_state_id: cs.code_state_id })
    assert.equal(r3.link_status, 'persisted_unknown')
    // 缺 before → before_digest 保持 null（不补造）。
    const r4 = net.bindEvidence(obs3.id, { code_state_id: cs.code_state_id, files: [{ path: 'src/a.ts', after_digest: st1Digest(net, cs.code_state_id, 'src/a.ts') }] })
    assert.equal(r4.files[0]!.before_digest, null)
    assert.equal(r4.files[0]!.after_digest !== null, true)
  } finally { net.close(); cleanupDir(ws) }
})

function st1Digest(net: MemoryNet, id: string, path: string): string | null {
  return net.getCodeState(id)?.files[path] ?? null
}

test('M2-bind: rebind keeps the original binding locatable (history preserved)', () => {
  const ws = makeTempWs('mn-m2-rebind-')
  const net = openLedgered(ws)
  try {
    const cs1 = net.captureCodeState(fullNativeInput())
    const obs = net.add('observation', { text: 'evidence v1', source: 'tool' })
    net.bindEvidence(obs.id, { code_state_id: cs1.code_state_id, session_id: 's1', durable_event_seq: 1 })
    const cs2 = net.captureCodeState(fullNativeInput({ files: [{ path: 'src/a.ts', content: 'export const a = 3\n' }, { path: 'src/b.ts', content: 'export const b = 2\n' }] }))
    net.bindEvidence(obs.id, { code_state_id: cs2.code_state_id, session_id: 's1', durable_event_seq: 2 })
    const history = net.evidenceHistory(obs.id)
    assert.equal(history.length, 2)
    assert.equal(history[0]!.code_state_id, cs1.code_state_id)
    assert.equal(history[1]!.code_state_id, cs2.code_state_id)
    assert.equal(net.evidenceOf(obs.id)!.code_state_id, cs2.code_state_id) // 当前指向最新
  } finally { net.close(); cleanupDir(ws) }
})

test('M2-bind: model role cannot capture or bind evidence', () => {
  const ws = makeTempWs('mn-m2-role-')
  const net = openLedgered(ws, 'model-1', 'model')
  try {
    assert.throws(() => net.captureCodeState(fullNativeInput()), /host|tool|角色|禁止/)
    const obs = net.add('tip', { text: 'tip' })
    assert.throws(() => net.bindEvidence(obs.id, { code_state_id: 'cs-x' }), /host|tool|角色|禁止/)
    // 模型 add 也不能夹带证据元数据。
    assert.throws(() => net.add('inference', {
      text: 'guess', confidence: .5,
      evidence: { code_state_id: 'cs-x' },
    } as never), /evidence|保留|禁止/)
  } finally { net.close(); cleanupDir(ws) }
})

test('M2-bind: unknown node or code_state is rejected inside the write txn', () => {
  const ws = makeTempWs('mn-m2-unk-')
  const net = openLedgered(ws)
  try {
    const cs = net.captureCodeState(fullNativeInput())
    assert.throws(() => net.bindEvidence('n999', { code_state_id: cs.code_state_id }), /不存在|unknown/i)
    assert.throws(() => net.bindEvidence('n1', { code_state_id: 'cs-not-exist' }), /code_state|不存在/i)
  } finally { net.close(); cleanupDir(ws) }
})

test('M2-add: evidence binds atomically with the write (same op)', () => {
  const ws = makeTempWs('mn-m2-atomic-')
  const net = openLedgered(ws)
  try {
    const cs = net.captureCodeState(fullNativeInput())
    const node = net.add('observation', {
      text: 'native edit a.ts', source: 'tool',
      provenance: { session_id: 'sess-9', durable_event_seq: 7, call_id: 'call-7' },
      evidence: {
        code_state_id: cs.code_state_id,
        files: [{ path: 'src/a.ts', before_digest: contentDigest('export const a = 1\n'), after_digest: contentDigest('export const a = 2\n') }],
      },
    })
    const ref = net.evidenceOf(node.id)!
    assert.equal(ref.link_status, 'captured')
    assert.equal(ref.node_id, node.id)
    // 同一操作：add op 坐标与绑定一致。
    const ops = net.ledger!.operationsFor({ session_id: 'sess-9' })
    assert.ok(ops.some(o => o.operation_kind === 'add' && o.durable_event_seq === 7))
    assert.ok(ops.some(o => o.operation_kind === 'bind'))
  } finally { net.close(); cleanupDir(ws) }
})

test('M2-verify: unrelated file change does not invalidate the conclusion', () => {
  const ws = makeTempWs('mn-m2-unrel-')
  const net = openLedgered(ws)
  try {
    const cs = net.captureCodeState(fullNativeInput())
    const inf = net.add('inference', {
      text: 'a.ts exports const a = 1', confidence: .9,
      evidence: { code_state_id: cs.code_state_id, session_id: 's', durable_event_seq: 1, files: [{ path: 'src/a.ts', after_digest: contentDigest('export const a = 1\n') }] },
    })
    // 无关文件（b.ts）变化；a.ts 原样。
    const cur = net.captureCodeState(fullNativeInput({
      files: [{ path: 'src/a.ts', content: 'export const a = 1\n' }, { path: 'src/b.ts', content: 'export const b = 99\n' }],
    }))
    const v = net.verifyEvidence(inf.id, cur.code_state_id)
    assert.equal(v.outcome, 'valid')
    assert.deepEqual(v.unrelated_changed, ['src/b.ts'])
    assert.equal(v.changed.length, 0)
  } finally { net.close(); cleanupDir(ws) }
})

test('M2-verify: same-content rewrite (CRLF) does not falsify the conclusion', () => {
  const ws = makeTempWs('mn-m2-same-')
  const net = openLedgered(ws)
  try {
    const cs = net.captureCodeState(fullNativeInput())
    const inf = net.add('inference', {
      text: 'a.ts has one export', confidence: .9,
      evidence: { code_state_id: cs.code_state_id, session_id: 's', durable_event_seq: 1, files: [{ path: 'src/a.ts', after_digest: contentDigest('export const a = 1\n') }] },
    })
    // 行尾改写（CRLF）但规范化内容一致 → 同内容重验不证伪。
    const cur = net.captureCodeState(fullNativeInput({
      files: [{ path: 'src/a.ts', content: 'export const a = 1\r\n' }, { path: 'src/b.ts', content: 'export const b = 2\n' }],
    }))
    const v = net.verifyEvidence(inf.id, cur.code_state_id)
    assert.equal(v.outcome, 'valid')
  } finally { net.close(); cleanupDir(ws) }
})

test('M2-verify: related change marks needs_review and original evidence stays locatable', () => {
  const ws = makeTempWs('mn-m2-review-')
  const net = openLedgered(ws)
  try {
    const cs = net.captureCodeState(fullNativeInput())
    const inf = net.add('inference', {
      text: 'a.ts exports const a = 1', confidence: .9,
      evidence: { code_state_id: cs.code_state_id, session_id: 's', durable_event_seq: 1, files: [{ path: 'src/a.ts', after_digest: contentDigest('export const a = 1\n') }] },
    })
    const beforeRevision = inf.revision_id!
    const cur = net.captureCodeState(fullNativeInput({
      files: [{ path: 'src/a.ts', content: 'export const a = 42\n' }, { path: 'src/b.ts', content: 'export const b = 2\n' }],
    }))
    const v = net.verifyEvidence(inf.id, cur.code_state_id)
    assert.equal(v.outcome, 'needs_review')
    assert.equal(v.changed.length, 1)
    assert.equal(v.changed[0]!.path, 'src/a.ts')
    // 节点被标记 needs_review（追加修订，不改写原修订）。
    const node = net.get(inf.id)!
    const mark = node.payload.needs_review as { reason: string; validation_id: string } | undefined
    assert.ok(mark, 'payload.needs_review set')
    assert.equal(mark!.reason, 'code_state_changed')
    assert.equal(mark!.validation_id, v.validation_id)
    assert.notEqual(node.revision_id, beforeRevision)
    assert.equal(node.status, 'active') // 标记不等于推翻：不冒充 contradicted
    // 原证据可定位：历史绑定与原 code_state 均在。
    const hist = net.evidenceHistory(inf.id)
    assert.equal(hist.length, 1)
    assert.equal(hist[0]!.code_state_id, cs.code_state_id)
    assert.ok(net.getCodeState(cs.code_state_id))
    // 再次验证同一现状 → 稳定 needs_review，不静默转回 valid。
    const cur2 = net.captureCodeState(fullNativeInput({
      files: [{ path: 'src/a.ts', content: 'export const a = 42\n' }, { path: 'src/b.ts', content: 'export const b = 2\n' }],
    }))
    const v2 = net.verifyEvidence(inf.id, cur2.code_state_id)
    assert.equal(v2.outcome, 'needs_review')
  } finally { net.close(); cleanupDir(ws) }
})

test('M2-verify: unknown current state stays unknown, never valid', () => {
  const ws = makeTempWs('mn-m2-verunk-')
  const net = openLedgered(ws)
  try {
    const cs = net.captureCodeState(fullNativeInput())
    const inf = net.add('inference', {
      text: 'a.ts exports const a = 1', confidence: .9,
      evidence: { code_state_id: cs.code_state_id, session_id: 's', durable_event_seq: 1, files: [{ path: 'src/a.ts', after_digest: contentDigest('export const a = 1\n') }] },
    })
    // 现状无该文件摘要（不可访问源码）→ unknown，不得伪装为已知版本。
    const cur = net.captureCodeState({ root: '/proj/repo', source: 'unknown' })
    const v = net.verifyEvidence(inf.id, cur.code_state_id)
    assert.equal(v.outcome, 'unknown')
    // 且不标记 needs_review（区分"证据失效"与"无法核验"）。
    assert.equal((net.get(inf.id)!.payload.needs_review as unknown), undefined)
  } finally { net.close(); cleanupDir(ws) }
})

test('M2-verify: unbound node is an explicit error', () => {
  const ws = makeTempWs('mn-m2-unbound-')
  const net = openLedgered(ws)
  try {
    const obs = net.add('observation', { text: 'no evidence', source: 'tool' })
    const cur = net.captureCodeState(fullNativeInput())
    assert.throws(() => net.verifyEvidence(obs.id, cur.code_state_id), /未绑定|evidence/i)
  } finally { net.close(); cleanupDir(ws) }
})

test('M2-export: v3 package carries evidence with closure; import restores and validates', () => {
  const wsA = makeTempWs('mn-m2-exp-a-'), wsB = makeTempWs('mn-m2-exp-b-')
  const a = openLedgered(wsA)
  try {
    const cs = a.captureCodeState(fullNativeInput())
    a.add('observation', {
      text: 'captured edit', source: 'tool',
      provenance: { session_id: 's', durable_event_seq: 3 },
      evidence: { code_state_id: cs.code_state_id, files: [{ path: 'src/a.ts', after_digest: contentDigest('export const a = 1\n') }] },
    })
    const pkg = a.exportFullPkg()
    assert.equal(pkg.schema_version, 3)
    assert.ok(pkg.ledger.evidence)
    assert.ok(pkg.ledger.evidence!.code_states.length >= 1)
    assert.ok(pkg.ledger.evidence!.source_refs.length >= 1)
    // 悬空引用在导入前被拒。
    const broken = JSON.parse(JSON.stringify(pkg)) as typeof pkg
    broken.ledger.evidence!.source_refs[0]!.code_state_id = 'cs-missing'
    assert.throws(() => MemoryNet.importFullPkg(broken, wsB), /code_state|闭包|校验/)

    const b = MemoryNet.importFullPkg(pkg, wsB)
    try {
      const ref = b.evidenceOf(pkg.nodes[0]!.id)!
      assert.equal(ref.code_state_id, cs.code_state_id)
      assert.equal(b.getCodeState(cs.code_state_id)!.root, '/proj/repo')
    } finally { b.close() }
  } finally { a.close(); cleanupDir(wsA); cleanupDir(wsB) }
})

test('M2-export: package without evidence stays v2 (M1 compatible shape)', () => {
  const ws = makeTempWs('mn-m2-v2-')
  const net = openLedgered(ws)
  try {
    net.add('observation', { text: 'plain', source: 'tool' })
    const pkg = net.exportFullPkg()
    assert.equal(pkg.schema_version, 2)
    assert.equal(pkg.ledger.evidence, undefined)
  } finally { net.close(); cleanupDir(ws) }
})

test('M2-ops: capture/bind/verify are recorded in the operations ledger', () => {
  const ws = makeTempWs('mn-m2-ops-')
  const net = openLedgered(ws)
  try {
    const cs = net.captureCodeState(fullNativeInput())
    const obs = net.add('observation', { text: 'o', source: 'tool' })
    net.bindEvidence(obs.id, { code_state_id: cs.code_state_id })
    const cur = net.captureCodeState(fullNativeInput())
    net.verifyEvidence(obs.id, cur.code_state_id)
    const kinds = net.ledger!.operationsFor({ limit: 100 }).map(o => o.operation_kind)
    assert.ok(kinds.includes('capture'))
    assert.ok(kinds.includes('bind'))
    assert.ok(kinds.includes('verify'))
  } finally { net.close(); cleanupDir(ws) }
})

test('M2-bridge: native read/edit/write events produce digest evidence, never raw content', async () => {
  const { buildObservation } = await import('../adapters/dsh/src/bridge.js')
  const cfg = {
    include_error: false, include_nested: false,
    args_chars: 200, max_chars: 500,
  } as Parameters<typeof buildObservation>[0]
  // 原生 edit：arguments 带 path/before/after。
  const obs = buildObservation(cfg, {
    name: 'native_edit', callId: 'c1', token: Symbol('t'),
    arguments: { path: 'src/a.ts', before: 'export const a = 1\n', after: 'export const a = 2\n' },
  } as never, { isError: false, value: 'ok' } as never)
  assert.ok(obs)
  const ev = obs!.payload.evidence as { files: Array<{ path: string; before_digest: string; after_digest: string }> } | undefined
  assert.ok(ev, 'evidence extracted')
  assert.equal(ev!.files[0]!.path, 'src/a.ts')
  assert.equal(ev!.files[0]!.before_digest, contentDigest('export const a = 1\n'))
  assert.equal(ev!.files[0]!.after_digest, contentDigest('export const a = 2\n'))
  // 摘要 only：观测文本/载荷不含原始正文。
  assert.ok(!JSON.stringify(obs!.payload).includes('export const a = 1'))
  assert.ok(!obs!.text.includes('export const a = 1'))
  // 非 read/edit/write 工具不产生证据字段。
  const obs2 = buildObservation(cfg, {
    name: 'web_search', callId: 'c2', token: Symbol('t2'), arguments: { q: 'x' },
  } as never, { isError: false, value: '[]' } as never)
  assert.equal((obs2!.payload.evidence as unknown), undefined)
  // 缺 before → before_digest null（不补造）。
  const obs3 = buildObservation(cfg, {
    name: 'native_write', callId: 'c3', token: Symbol('t3'),
    arguments: { path: 'src/new.ts', after: 'new file\n' },
  } as never, { isError: false, value: 'ok' } as never)
  const ev3 = obs3!.payload.evidence as { files: Array<{ path: string; before_digest: string | null }> }
  assert.equal(ev3.files[0]!.before_digest, null)
})

test('M2-bridge: session event seq flows through auto-observe into durable op coords', async () => {
  const { installAutoObserve } = await import('../adapters/dsh/src/bridge.js')
  const ws = makeTempWs('mn-m2-auto-')
  const events = new Map<string, Array<(...a: unknown[]) => void>>()
  let seq = 100
  const ctx = { on: (ev: string, fn: (...a: unknown[]) => void) => { events.set(ev, [...(events.get(ev) ?? []), fn]) } }
  const nets = new Map<string, MemoryNet>()
  const netOf = (dir: string) => {
    let n = nets.get(dir)
    if (!n) { n = MemoryNet.open(dir, { agentId: 'bridge-tool', role: 'tool', ledger: true }); nets.set(dir, n) }
    return n
  }
  installAutoObserve(ctx as never, {
    context: { mode: 'session' }, default_workspace: 'default', budgets: { max_nodes: 50, max_tokens: 4000 },
    auto_observe: { include_error: false, include_nested: false, args_chars: 100, max_chars: 200 },
    recall: { view: 'curated' },
  } as never, netOf, {
    warn: () => {},
    binding: (exec) => ({
      dir: ws, sessionId: 'sess-live', scopeId: 'scope-1', project: 'proj',
      durableEventSeq: ++seq,
    }),
  })
  // 触发一次完整工具生命周期：pre-execute 准入 → result 落网。
  const exec = { name: 'native_read', callId: 'c-read', token: Symbol('x'), arguments: { path: 'src/a.ts', after: 'content\n' } }
  for (const fn of events.get('tools/pre-execute') ?? []) fn(exec, () => undefined)
  for (const fn of events.get('tools/result') ?? []) fn(exec, { isError: false, value: 'ok' })
  const net = nets.get(ws)!
  try {
    const ops = net.ledger!.operationsFor({ session_id: 'sess-live' })
    assert.ok(ops.length >= 1, 'durable op recorded with session coords')
    // 持久事件序号是每事件唯一坐标：归 add（观测写入）操作；bind 复用会话但 durable=NULL。
    assert.ok(ops.some(o => o.operation_kind === 'add' && o.durable_event_seq === 101))
    const obs = net.candidates({}).length === 0 ? null : null
    assert.equal(obs, null)
    // 观测节点带 evidence 绑定（captured）。
    const nodes = (net as unknown as { db: { prepare: (q: string) => { all: () => Array<{ id: string }> } } }).db.prepare("SELECT id FROM nodes WHERE kind='observation'").all()
    assert.ok(nodes.length >= 1)
    const ref = net.evidenceOf(nodes[0]!.id)
    assert.ok(ref, 'auto observation carries evidence binding')
    assert.equal(ref!.link_status, 'captured')
  } finally {
    for (const n of nets.values()) n.close()
    cleanupDir(ws)
  }
})
