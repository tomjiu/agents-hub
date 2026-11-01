/**
 * mn — memory-net CLI（宿主侧；--role model 可演示写纪律拒绝）。
 *
 * 所有子命令即开即关（open → 操作 → close），无常驻进程。
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { MemoryNet } from './store.js'
import { MemoryError, WorkspaceError } from './errors.js'
import type { NodeKind, Role } from './types.js'

interface Args {
  _: string[]
  flags: Map<string, string>
}

/** --payload 解析：坏 JSON / 非对象归类为 WorkspaceError（走拒绝=2 契约，不裸抛）。 */
function parsePayloadJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new WorkspaceError('--payload 需为 JSON 对象（如 {"strategy":"x"}）')
    }
    return parsed as Record<string, unknown>
  } catch (e) {
    if (e instanceof WorkspaceError) throw e
    throw new WorkspaceError(`--payload 不是合法 JSON: ${(e as Error).message}`)
  }
}

function parseArgs(argv: string[]): Args {
  const _: string[] = []
  const flags = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next)
        i++
      } else {
        flags.set(key, 'true')
      }
    } else if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      // 单横杠短 flag（如 export -o pkg.json）；负数除外
      const key = a.slice(1)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('-')) {
        flags.set(key, next)
        i++
      } else {
        flags.set(key, 'true')
      }
    } else {
      _.push(a)
    }
  }
  return { _, flags }
}

const KINDS: readonly NodeKind[] = ['constraint', 'observation', 'inference', 'tip']

function usage(): string {
  return `mn — 共享记忆网 CLI（v1）

用法: mn <子命令> <workspace目录> [参数]

子命令:
  init <dir> [--workspace-id id]                 初始化 workspace（幂等）
  add <dir> <kind> --text "..."                  写节点 kind ∈ ${KINDS.join('/')}
      [--key k] [--run r] [--task t] [--source tool|user|config|system]
      [--confidence 0.8] [--based-on n1,n2] [--payload '{"mode":"forbid"}']
      [--agent a] [--role model|tool|host]       （默认 host；--role model 可演示写纪律）
  get <dir> <id>                                 读取节点
  link <dir> <from> <to>                         补 based_on 边
  progress <dir> --task t --status doing --summary "..."
      [--agent a] [--base-ts <updated_at>]       共享进度（同 task 单行；base-ts 触发冲突检测）
  trail <dir> --run r --action "..." [--agent a] 追加 trail 步
  replay <dir> --run r                           回放 run 的 trail
  activate <dir> --agent a [--query "..."] [--run r] [--task t]
      [--max-nodes n] [--max-tokens n] [--json]  预算化激活
  promote <dir> <id> [--evidence n1,n2] [--note "..."]
  demote <dir> <id> [--reason "..."]
  contradict <dir> <id> [--evidence n1,n2] [--note "..."]
  gc <dir> [--keep 50] [--ttl-days 30] [--purge] 压缩 trail / TTL 降级 / 物理清理
  export <dir> -o pkg.json                       导出记忆包
  import pkg.json --to dir                       导入记忆包为新 workspace
`
}

function openNet(dir: string, flags: Map<string, string>): MemoryNet {
  const agent = flags.get('agent') ?? 'host'
  const role = (flags.get('role') ?? 'host') as Role
  return MemoryNet.open(dir, { agentId: agent, role })
}

function printNode(n: ReturnType<MemoryNet['get']>): void {
  if (!n) {
    console.log('(不存在)')
    return
  }
  const marks: string[] = []
  if (n.conflict) marks.push('⚠ 冲突')
  if (n.status !== 'active') marks.push(n.status)
  const head = `${n.id} [${n.kind}]${marks.length ? ' {' + marks.join(',') + '}' : ''} by=${n.agent_id}`
  const details: string[] = [head]
  if (n.key) details.push(`  key: ${n.key}`)
  if (n.text) details.push(`  text: ${n.text}`)
  const p = { ...n.payload }
  for (const k of ['status', 'summary', 'owner', 'mode', 'strategy', 'recovery']) {
    if (p[k] !== undefined) details.push(`  ${k}: ${String(p[k])}`)
  }
  if (n.source) details.push(`  source: ${n.source}`)
  if (n.confidence !== null) details.push(`  confidence: ${n.confidence}`)
  if (n.based_on.length) details.push(`  based_on: ${n.based_on.join(',')}`)
  if (n.conflict_detail) details.push(`  conflict_detail: ${JSON.stringify(n.conflict_detail)}`)
  console.log(details.join('\n'))
}

export async function runCli(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help') {
    process.stdout.write(usage())
    return 0
  }
  const cmd = argv[0]!
  const rest = argv.slice(1)
  // export/import 的第一个位置参数不是目录，单独处理。
  // 错误分类：import 分支同样受 MemoryError 契约约束（拒绝=可读信息 + 退出码 2），
  // 文件缺失/坏 JSON 也归类为可读拒绝，不再裸抛成「未预期异常」。
  if (cmd === 'import') {
    const args = parseArgs(rest)
    const pkgPath = args._[0]
    const to = args.flags.get('to')
    if (!pkgPath || !to) {
      process.stderr.write('用法: mn import pkg.json --to dir\n')
      return 2
    }
    try {
      const raw = readFileSync(pkgPath, 'utf8')
      let pkg: unknown
      try {
        pkg = JSON.parse(raw)
      } catch (e) {
        throw new WorkspaceError(`包文件不是合法 JSON: ${pkgPath}（${(e as Error).message}）`)
      }
      const net = MemoryNet.importPkg(pkg as never, to)
      const count = net.exportPkg().nodes.length
      net.close()
      console.log(`✓ 导入完成: ${pkgPath} → ${to}（${count} 节点）`)
      return 0
    } catch (e) {
      if (e instanceof MemoryError) {
        process.stderr.write(`✗ ${e.message}\n`)
        return 2
      }
      if (e instanceof Error && (e as NodeJS.ErrnoException).code === 'ENOENT') {
        process.stderr.write(`✗ 包文件不存在: ${pkgPath}\n`)
        return 2
      }
      throw e
    }
  }

  const args = parseArgs(rest)
  const dir = args._[0]
  if (!dir) {
    process.stderr.write(`缺少 workspace 目录参数。${usage()}`)
    return 2
  }

  try {
    switch (cmd) {
      case 'init': {
        const net = MemoryNet.open(dir, { workspaceId: args.flags.get('workspace-id') || undefined })
        console.log(`✓ workspace 就绪: ${dir}（workspace_id=${net.workspaceId}）`)
        net.close()
        return 0
      }
      case 'add': {
        const kind = args._[1] as NodeKind | undefined
        if (!kind || !KINDS.includes(kind)) {
          process.stderr.write(`add 需要 kind ∈ ${KINDS.join('/')}（用法: mn add <dir> <kind> --text "..."）\n`)
          return 2
        }
        const net = openNet(dir, args.flags)
        try {
          const n = net.add(kind, {
            text: args.flags.get('text') ?? '',
            key: args.flags.get('key') ?? null,
            run_id: args.flags.get('run') ?? null,
            task_id: args.flags.get('task') ?? null,
            source: (args.flags.get('source') ?? undefined) as never,
            confidence: args.flags.has('confidence') ? Number(args.flags.get('confidence')) : undefined,
            based_on: (args.flags.get('based-on') ?? '').split(',').filter(Boolean),
            payload: args.flags.has('payload') ? parsePayloadJson(args.flags.get('payload')!) : undefined,
          })
          printNode(n)
          return 0
        } finally {
          net.close()
        }
      }
      case 'get': {
        const id = args._[1]
        if (!id) {
          process.stderr.write('get 需要节点 id\n')
          return 2
        }
        const net = openNet(dir, args.flags)
        try {
          printNode(net.get(id))
          return net.get(id) ? 0 : 1
        } finally {
          net.close()
        }
      }
      case 'link': {
        const from = args._[1]
        const to = args._[2]
        if (!from || !to) {
          process.stderr.write('link 需要 <from> <to>\n')
          return 2
        }
        const net = openNet(dir, args.flags)
        try {
          net.link(from, to)
          console.log(`✓ 边已建立: ${from} → ${to}`)
          return 0
        } finally {
          net.close()
        }
      }
      case 'progress': {
        const task = args.flags.get('task')
        if (!task) {
          process.stderr.write('progress 需要 --task\n')
          return 2
        }
        const net = openNet(dir, args.flags)
        try {
          const patch: Record<string, unknown> = {}
          if (args.flags.has('status')) patch.status = args.flags.get('status')
          if (args.flags.has('summary')) patch.summary = args.flags.get('summary')
          const base = args.flags.get('base-ts')
          const n = net.updateProgress(task, patch, base ? { base_updated_at: Number(base) } : undefined)
          printNode(n)
          if (n.conflict) {
            console.log('  ⚠ 检测到并发写冲突（详见 conflict_detail）——已按后写应用，但未静默')
          }
          return 0
        } finally {
          net.close()
        }
      }
      case 'trail': {
        const run = args.flags.get('run')
        const action = args.flags.get('action')
        if (!run || !action) {
          process.stderr.write('trail 需要 --run 与 --action\n')
          return 2
        }
        const net = openNet(dir, args.flags)
        try {
          const t = net.appendTrail(run, { action, refs: (args.flags.get('refs') ?? '').split(',').filter(Boolean) })
          console.log(`✓ trail #${t.seq} (${t.agent_id}): ${t.action}`)
          return 0
        } finally {
          net.close()
        }
      }
      case 'replay': {
        const run = args.flags.get('run')
        if (!run) {
          process.stderr.write('replay 需要 --run\n')
          return 2
        }
        const net = openNet(dir, args.flags)
        try {
          const steps = net.replayTrail(run)
          for (const s of steps) {
            console.log(`#${String(s.seq).padStart(3)} [${s.agent_id}]${s.compressed ? '(压缩)' : ''} ${s.action}`)
          }
          console.log(`共 ${steps.length} 步`)
          return 0
        } finally {
          net.close()
        }
      }
      case 'activate': {
        const net = openNet(dir, args.flags)
        try {
          const r = net.activate(args.flags.get('query') ?? '', {
            run_id: args.flags.get('run') ?? null,
            task_id: args.flags.get('task') ?? null,
            agent_id: args.flags.get('agent') ?? 'host',
            budgets: {
              max_nodes: args.flags.has('max-nodes') ? Number(args.flags.get('max-nodes')) : undefined,
              max_tokens: args.flags.has('max-tokens') ? Number(args.flags.get('max-tokens')) : undefined,
            },
          })
          if (args.flags.has('json')) {
            console.log(JSON.stringify(r, null, 2))
          } else {
            console.log(`激活 ${r.nodes.length} 节点（预算 ${r.budgets.max_nodes} 节点 / ${r.budgets.max_tokens} tokens，裁掉 ${r.nodes_dropped}，用 ${r.tokens_used} tokens）`)
            for (const rn of r.nodes) {
              const n = rn.node
              const tag = rn.frozen ? '🔒' : `w=${rn.weight.toFixed(0)} s=${rn.score.toFixed(1)}`
              console.log(`  ${n.id} [${n.kind}] ${tag}${n.conflict ? ' ⚠冲突' : ''} — ${(n.text || String(n.payload.summary ?? '')).slice(0, 80)}`)
            }
            if (r.trail) console.log(`  trail 摘要（${r.trail.steps} 步）: ${r.trail.text.slice(0, 160)}`)
          }
          return 0
        } finally {
          net.close()
        }
      }
      case 'promote': {
        const id = args._[1]
        if (!id) {
          process.stderr.write('promote 需要 <id>\n')
          return 2
        }
        const net = openNet(dir, args.flags)
        try {
          const n = net.promote(id, {
            evidence: (args.flags.get('evidence') ?? '').split(',').filter(Boolean),
            by: args.flags.has('user') ? 'user' : 'agent',
            note: args.flags.get('note') ?? '',
          })
          console.log(`✓ ${n.id} 已 promote（observation 级权重参与激活）`)
          return 0
        } finally {
          net.close()
        }
      }
      case 'demote': {
        const id = args._[1]
        if (!id) {
          process.stderr.write('demote 需要 <id>\n')
          return 2
        }
        const net = openNet(dir, args.flags)
        try {
          const n = net.demote(id, { reason: args.flags.get('reason') ?? '' })
          console.log(`✓ ${n.id} 已 demote（不参与激活）`)
          return 0
        } finally {
          net.close()
        }
      }
      case 'contradict': {
        const id = args._[1]
        if (!id) {
          process.stderr.write('contradict 需要 <id>\n')
          return 2
        }
        const net = openNet(dir, args.flags)
        try {
          const n = net.contradict(id, {
            evidence: (args.flags.get('evidence') ?? '').split(',').filter(Boolean),
            note: args.flags.get('note') ?? '',
          })
          console.log(`✓ ${n.id} 已 contradicted`)
          return 0
        } finally {
          net.close()
        }
      }
      case 'gc': {
        const net = openNet(dir, args.flags)
        try {
          const r = net.gc({
            trail_keep: args.flags.has('keep') ? Number(args.flags.get('keep')) : undefined,
            ttl_days: args.flags.has('ttl-days') ? Number(args.flags.get('ttl-days')) : undefined,
            purge: args.flags.has('purge'),
          })
          console.log(`✓ gc 完成: trail 压缩 ${r.trail_runs_compressed} 个 run（合并 ${r.trail_steps_merged} 步），TTL 降级 ${r.demoted_by_ttl}，物理清理 ${r.purged}`)
          return 0
        } finally {
          net.close()
        }
      }
      case 'export': {
        const out = args.flags.get('o')
        if (!out) {
          process.stderr.write('export 需要 -o pkg.json\n')
          return 2
        }
        const net = openNet(dir, args.flags)
        try {
          const pkg = net.exportPkg()
          writeFileSync(out, JSON.stringify(pkg, null, 2), 'utf8')
          console.log(`✓ 导出完成: ${out}（${pkg.nodes.length} 节点 / ${pkg.trail.length} trail 步）`)
          return 0
        } finally {
          net.close()
        }
      }
      default:
        process.stderr.write(`未知子命令: ${cmd}\n${usage()}`)
        return 2
    }
  } catch (e) {
    if (e instanceof MemoryError) {
      process.stderr.write(`✗ ${e.message}\n`)
      return 2
    }
    throw e
  }
}
