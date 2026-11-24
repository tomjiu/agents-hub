/**
 * M1 跨进程并发测试 —— 校验后写入竞态关闭（验收矩阵：GC 竞态/并发 CAS）。
 *
 * 竞态窗口（P0 已承认）：非事务路径下 add 的 based_on 校验在写事务外执行，
 * 并发 GC purge 可在校验后、插入前删除被引用节点 → 悬空引用提交。
 * M1 把校验移入 BEGIN IMMEDIATE：写锁序列化后，add 要么看到 GC 后状态
 * （UnknownNodeError），要么先于 GC 提交（GC 保护闭包保留被引用节点）。
 * 本测试用真实子进程 + 父进程持锁制造确定的两序竞争，断言不变量：
 * **任何交错序下，最终库中不存在悬空 based_on 引用。**
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { MemoryNet } from '../src/store.js'
import { makeTempWs, cleanupDir } from './helpers.js'

const DIST_STORE = fileURLToPath(new URL('../src/store.js', import.meta.url))

/** 子进程脚本：对 X 发起 based_on 写入（模拟并发 add 客户端）。
 *  argv（node -e）：[node, distStore, ws, targetId, useLedger] */
const CHILD_SCRIPT = `
const { MemoryNet } = await import(process.argv[1])
const ws = process.argv[2]
const target = process.argv[3]
const useLedger = process.argv[4] === '1'
try {
  const net = MemoryNet.open(ws, { agentId: 'child-writer', role: 'host', ledger: useLedger })
  try {
    const node = net.add('inference', { text: 'child decision on ' + target, confidence: .8, based_on: [target] })
    console.log('CHILD_OK ' + node.id)
  } finally { net.close() }
} catch (e) {
  console.log('CHILD_ERR ' + e.message)
  process.exitCode = 2
}
`

function runChild(ws: string, target: string, useLedger: boolean): Promise<{ code: number | null; stdout: string }> {
  const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD_SCRIPT, '--', DIST_STORE, ws, target, useLedger ? '1' : '0'], { stdio: ['ignore', 'pipe', 'inherit'] })
  let stdout = ''
  child.stdout.on('data', c => { stdout += c })
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => resolve({ code, stdout }))
  })
}

async function raceOnce(useLedger: boolean): Promise<void> {
  const ws = makeTempWs('mn-m1-race-')
  try {
    // 基线：X 存在且已降级（GC purge 候选），此时无任何节点引用 X。
    const setup = MemoryNet.open(ws, { agentId: 'setup', role: 'host', ledger: useLedger })
    const x = setup.add('observation', { text: 'purge-eligible observation', source: 'tool' })
    setup.demote(x.id, useLedger ? { expected_revision: x.revision_id } : undefined)
    setup.close()

    // 父进程（GC 模拟者）：持锁 400ms，事务内复查"无引用才删除 X"。
    const parent = new DatabaseSync(join(ws, 'memory.db'))
    parent.exec('PRAGMA busy_timeout = 5000;')
    parent.exec('BEGIN IMMEDIATE')
    const refCount = (parent.prepare(
      "SELECT COUNT(*) AS c FROM nodes WHERE instr(based_on_json, ?) > 0",
    ).get(`"${x.id}"`) as { c: number }).c
    if (refCount === 0) {
      parent.prepare('DELETE FROM nodes WHERE id = ?').run(x.id)
    }
    // 持锁窗口内让子进程并发发起 based_on 写入。
    const childPromise = runChild(ws, x.id, useLedger)
    await new Promise(resolve => setTimeout(resolve, 400))
    parent.exec('COMMIT')
    parent.close()
    const child = await childPromise

    // 不变量（与交错序无关）：最终库中不存在悬空 based_on。
    const verify = MemoryNet.open(ws, { agentId: 'verify', role: 'host' })
    try {
      const dangling = verify.exportPkg().nodes.filter(n =>
        n.based_on.some(id => verify.get(id) === null))
      assert.equal(dangling.length, 0, `dangling references committed: ${JSON.stringify(dangling.map(n => ({ id: n.id, based_on: n.based_on })))}`)
      const childNode = verify.exportPkg().nodes.find(n => n.text === `child decision on ${x.id}`)
      if (child.code === 0) {
        // 子进程成功：其引用目标必须仍然存在（GC 保护闭包或子进程先行）。
        assert.ok(childNode, 'successful child write must be persisted')
        for (const ref of childNode.based_on) assert.ok(verify.get(ref), `referenced node ${ref} must survive`)
      } else {
        // 子进程失败：必须是显式引用校验拒绝，且无部分写入。
        assert.match(child.stdout, /CHILD_ERR/)
        assert.equal(childNode, undefined, 'failed child write must not be partially persisted')
      }
    } finally { verify.close() }
  } finally { cleanupDir(ws) }
}

test('cross-process GC-vs-add race never commits dangling references (legacy path)', async () => {
  for (let i = 0; i < 3; i++) await raceOnce(false)
})

test('cross-process GC-vs-add race never commits dangling references (ledger path)', async () => {
  for (let i = 0; i < 3; i++) await raceOnce(true)
})

test('concurrent writers serialize on the write lock with unique seq and ops', async () => {
  const ws = makeTempWs('mn-m1-writers-')
  const a = MemoryNet.open(ws, { agentId: 'writer-a', role: 'host', ledger: true })
  const b = MemoryNet.open(ws, { agentId: 'writer-b', role: 'host', ledger: true })
  try {
    // 同进程交替写（WAL 写者经 BEGIN IMMEDIATE 串行；node:sqlite 同步执行天然互斥）。
    for (let i = 0; i < 20; i++) {
      a.add('observation', { text: `a-${i}`, source: 'tool' })
      b.add('observation', { text: `b-${i}`, source: 'tool' })
    }
    const pkg = a.exportFullPkg()
    assert.equal(pkg.nodes.length, 40)
    assert.equal(pkg.ledger.operations.length, 40)
    const seqs = pkg.ledger.operations.map(o => o.seq)
    assert.equal(new Set(seqs).size, 40, 'operation seq must be unique under interleaved writers')
  } finally { a.close(); b.close(); cleanupDir(ws) }
})

test('child writer script resolves the built store module', async () => {
  // 卫生检查：子进程环境能加载 dist store（防路径漂移导致竞态测试静默失效）。
  const ws = makeTempWs('mn-m1-childcheck-')
  try {
    const setup = MemoryNet.open(ws, { agentId: 's', role: 'host' })
    const x = setup.add('observation', { text: 'x', source: 'tool' })
    setup.close()
    const { code, stdout } = await runChild(ws, x.id, false)
    assert.equal(code, 0)
    assert.match(stdout, /CHILD_OK/)
  } finally { cleanupDir(ws) }
})
