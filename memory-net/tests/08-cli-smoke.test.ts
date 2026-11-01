/**
 * CLI smoke：锁 mn 子进程端到端契约（库级测试之外的 CLI 面）。
 *
 * 契约来源：README「CLI 一览」与 usage() 帮助文本——
 *  ① add 参数顺序为 mn add <dir> <kind>（usage 曾写反成 <kind> <dir>，此测试锁顺序）
 *  ② export -o 支持单横杠短 flag（parseArgs 曾只认 -- 长 flag，-o 被当位置参数 → export 恒报缺参）
 *  ③ 写纪律 CLI 端到端：--role model 写 observation 可读拒绝 exit 2
 *  ④ export → import 记忆包整网回路
 *
 * 不依赖真实 LLM。
 */
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { makeTempWs, cleanupDir } from './helpers.js'

const MN = resolve(process.cwd(), 'bin', 'mn.js')

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [MN, ...args], { encoding: 'utf8' })
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

test('CLI add 参数顺序契约: mn add <dir> <kind> 成功；kind 在前报带用法提示的可读错误', () => {
  const ws = makeTempWs('mn-cli-add-')
  try {
    const ok = run(['add', ws, 'observation', '--role', 'host', '--agent', 'h1', '--key', 'k', '--text', 't'])
    if (ok.code !== 0) throw new Error(`dir-first 应成功，exit=${ok.code}, stderr=${ok.stderr}`)
    if (!ok.stdout.includes('observation')) throw new Error(`stdout 缺 kind 回显: ${ok.stdout}`)

    const bad = run(['add', 'observation', ws, '--text', 't'])
    if (bad.code !== 2) throw new Error(`kind-first（顺序错）应 exit=2，实际=${bad.code}`)
    if (!bad.stderr.includes('用法: mn add <dir> <kind>')) {
      throw new Error(`报错缺用法提示: ${bad.stderr}`)
    }
  } finally {
    cleanupDir(ws)
  }
})

test('CLI export -o 短 flag（parseArgs 支持单横杠）+ import 整网回路', () => {
  const ws = makeTempWs('mn-cli-xfer-')
  const copy = join(ws, '..', 'mn-cli-xfer-copy')
  const pkg = join(ws, '..', 'mn-cli-xfer-pkg.json')
  try {
    run(['init', ws, '--workspace-id', 'xfer'])
    run(['add', ws, 'observation', '--role', 'host', '--key', 'build.status', '--text', '编译通过'])
    run(['add', ws, 'inference', '--agent', 'm1', '--confidence', '0.8', '--text', '推断'])

    const ex = run(['export', ws, '-o', pkg])
    if (ex.code !== 0) throw new Error(`export -o 应成功，exit=${ex.code}, stderr=${ex.stderr}`)
    if (!existsSync(pkg)) throw new Error('pkg 文件未落盘')
    const raw = JSON.parse(readFileSync(pkg, 'utf8'))
    if (raw.nodes?.length !== 2) throw new Error(`pkg 应含 2 节点，实际 ${raw.nodes?.length}`)

    const im = run(['import', pkg, '--to', copy])
    if (im.code !== 0) throw new Error(`import 应成功，exit=${im.code}, stderr=${im.stderr}`)
    const got = run(['get', copy, 'n1'])
    if (!got.stdout.includes('编译通过')) throw new Error(`导入后 n1 内容不齐: ${got.stdout}`)
  } finally {
    cleanupDir(ws)
    cleanupDir(copy)
    cleanupDir(pkg)
  }
})

test('CLI 写纪律端到端: --role model 写 observation 可读拒绝 exit 2（不落库）', () => {
  const ws = makeTempWs('mn-cli-disc-')
  try {
    run(['init', ws, '--workspace-id', 'disc'])
    const r = run(['add', ws, 'observation', '--role', 'model', '--text', '伪造观测'])
    if (r.code !== 2) throw new Error(`应 exit=2，实际=${r.code}`)
    if (!r.stderr.includes('写纪律拒绝') || !r.stderr.includes('observation')) {
      throw new Error(`拒绝文案不可读: ${r.stderr}`)
    }
    // 同 key 由 host 成功写入，证明拒绝不是坏 workspace 导致
    const ok = run(['add', ws, 'observation', '--role', 'host', '--key', 'k', '--text', '真观测'])
    if (ok.code !== 0) throw new Error(`host 同 workspace 应成功: ${ok.stderr}`)
  } finally {
    cleanupDir(ws)
  }
})

test('CLI activate: 双 agent 共享 progress（demo 主链路子进程级回归）', () => {
  const ws = makeTempWs('mn-cli-share-')
  try {
    run(['init', ws, '--workspace-id', 'share'])
    run(['progress', ws, '--task', 't1', '--agent', 'alice', '--status', 'doing', '--summary', 'A 写入'])
    const act = run(['activate', ws, '--agent', 'bob', '--query', '进度'])
    if (act.code !== 0) throw new Error(`activate 应成功: ${act.stderr}`)
    if (!act.stdout.includes('A 写入')) throw new Error(`bob 未读到 alice 的 progress: ${act.stdout}`)
  } finally {
    cleanupDir(ws)
  }
})

