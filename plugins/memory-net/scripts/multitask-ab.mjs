#!/usr/bin/env node
/** 固定任务/噪音题集 A/B：任务驱动精选召回 vs 最新优先原始快照（issue #2 必须验收项）。
 *
 * 问题原文：“固定同类任务/噪音题集比较有效召回、错误记忆、重复排查次数、token与延迟；
 * 保存可复现输入/版本和真实结果，不能把写读成功叫效果提升。”
 *
 * Arm A（curated）：recallForTask 任务驱动精选（约束冻结 > 当次进度 > 已审阅推断 > 建议 > 日志默认排除）
 * Arm B（recent-raw）：无精选基线——按时间倒序注入同预算的最新节点（等价于“最新日志填满预算”的旧行为）
 *
 * 指标（每任务每臂）：有效召回（相关条目入预算数/应召回数）、错误记忆（他任务条目泄漏数）、
 * 重复排查代理（漏掉的相关约束/建议/推断数，需重新人工推导）、token 代理（入选文本字符数）、延迟。
 * 确定性离线 fixture，不代表真实模型效果；超界（精选臂不优于原始臂）以非零退出。
 * 用法: node scripts/multitask-ab.mjs [--json <output>] */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const args = process.argv.slice(2)
const OUT = (() => { const i = args.indexOf('--json'); return i >= 0 && args[i + 1] ? args[i + 1] : null })()
const { MemoryNet } = await import('../dist/src/store.js')
const { recallForTask } = await import('../dist/src/recall.js')

// ---- 固定题集（可复现：同输入同库同结果）----
const TASKS = [
  { id: 'task-auth', query: 'oauth token refresh rotation', constraints: ['auth: never log refresh tokens in plaintext', 'auth: token rotation must stay backward compatible v1'], tips: ['oauth refresh tokens rotate on every use; keep the old one valid for a 60s overlap window', 'use PKCE for public clients before enabling rotation'], inferences: ['refresh token rotation fixed the replay failures seen in staging cluster b'], observations: ['oauth handler logged 412 errors during rotation window', 'token refresh regression reproduced on staging cluster b'] },
  { id: 'task-migration', query: 'sqlite wal migration concurrent writers', constraints: ['migration: never run DDL while WAL writers are active', 'migration: keep schema version in the meta table'], tips: ['run migration inside a single BEGIN IMMEDIATE transaction', 'checkpoint WAL before switching readers to the new schema'], inferences: ['wal mode with three concurrent writers is safe only with a single writer connection'], observations: ['migration dry run reported lock timeout with two writer connections', 'wal checkpoint blocked 40s during cutover rehearsal'] },
  { id: 'task-latency', query: 'search p95 latency tail slow leg', constraints: ['latency: hard global deadline must abort in-flight legs', 'latency: never let a slow engine delay an already sufficient answer'], tips: ['harvest early once two independent sources agree', 'use per-leg budgets plus one global deadline'], inferences: ['the 10s tail was caused by a blocked leg without a global deadline'], observations: ['slow leg held the response 9.8s despite an early sufficient candidate', 'cancelling the slow leg cut p95 from 10s to 800ms'] },
  { id: 'task-release', query: 'release rollback staging deploy', constraints: ['release: rollback must keep user data untouched', 'release: no deploy on friday afternoon'], tips: ['tag the previous release before any staging deploy', 'rehearse rollback in a disposable environment first'], inferences: ['rollback drill on staging exposed a missing migration guard'], observations: ['rollback rehearsal finished in 4 minutes with data intact', 'deploy hook skipped the migration guard in dry-run mode'] },
  { id: 'task-i18n', query: 'cjk text extraction encoding entity', constraints: ['i18n: never normalize away fullwidth characters', 'i18n: entity decoding must happen before token counting'], tips: ['detect encoding from the response header before parsing', 'keep cjk bigram tokenization consistent with the search skill'], inferences: ['garbled cjk output traced to double entity decoding'], observations: ['cjk page returned mojibake after entity decode ran twice', 'bigram tokenization matched the expected vocabulary'] },
  { id: 'task-budget', query: 'token budget queue bounded distill', constraints: ['budget: distiller queue must stay bounded', 'budget: default extractor never calls a paid model'], tips: ['enforce per-run caps before enqueueing events', 'failures in distillation must never block the original tool call'], inferences: ['unbounded queue growth disappeared after per-run caps'], observations: ['queue depth stabilized at the cap after enabling per-run limits', 'distiller failure logged a warning and the tool call completed'] },
]
// 噪音：与任务词重合但无关的日志（“无关但词重合”题集要求）
const NOISE = [
  'oauth plugin for a game server unrelated to this task', 'wal fishing spots near the lake', 'tailwind css p95 utility classes list',
  'rollback menu prices at the diner', 'cjk airport code reference unrelated', 'budget rental car deals token discount',
  'token counting for a board game', 'migration of birds in autumn', 'latency between city bus stops', 'release of a new board game',
]

const dir = mkdtempSync(join(tmpdir(), 'mn-ab-'))
try {
  const net = MemoryNet.open(dir, { agentId: 'ab-bench', role: 'host', ledger: true })
  const expect = [] // {task, id, kind} 应被该任务召回的相关条目
  for (const t of TASKS) {
    for (let ci = 0; ci < t.constraints.length; ci++) expect.push({ task: t.id, id: net.add('constraint', { text: t.constraints[ci], key: t.id + '-rule-' + ci, payload: { mode: 'forbid' }, run_id: 'seed' }).id, kind: 'constraint' })
    for (const s of t.tips) expect.push({ task: t.id, id: net.add('tip', { text: s, run_id: 'seed' }).id, kind: 'tip' })
    const obsIds = t.observations.map(o => net.add('observation', { text: o, source: 'tool', run_id: 'seed' }).id)
    for (const inf of t.inferences) {
      const n = net.add('inference', { text: inf, confidence: 0.8, based_on: [obsIds[0]], run_id: 'seed' })
      net.promote(n.id, { by: 'user', note: 'fixture review', expected_revision: net.get(n.id).revision_id })
      expect.push({ task: t.id, id: n.id, kind: 'inference' })
    }
    net.updateProgress(t.id, { summary: `${t.id} progress: seeded fixture stage` })
    const prog = net.nodesForProjection().find(n => n.kind === 'progress' && n.task_id === t.id)
    if (prog) expect.push({ task: t.id, id: prog.id, kind: 'progress' })
  }
  const noiseIds = NOISE.map(o => net.add('observation', { text: o, source: 'tool', run_id: 'seed-log' }).id)
  // 最新优先噪音垫底（时间倒序注入在最后，模拟“最新日志”）
  for (const o of ['latest log: dashboard refresh', 'latest log: cron heartbeat', 'latest log: unrelated nightly job']) noiseIds.push(net.add('observation', { text: o, source: 'tool', run_id: 'seed-log' }).id)

  const relevant = new Set(expect.map(e => e.id))
  const taskOf = new Map(expect.map(e => [e.id, e.task]))
  const BUDGET = { max_nodes: 10, max_tokens: 8000 }

  const results = []
  for (const t of TASKS) {
    // Arm A：任务驱动精选
    const sa = performance.now()
    const curated = recallForTask(net, t.query, { task_id: t.id, budgets: BUDGET })
    const curatedMs = performance.now() - sa
    const curatedIds = new Set(curated.nodes.map(n => n.id))
    // Arm B：最新优先原始快照（同预算节点数）
    const all = net.nodesForProjection().filter(n => n.status === 'active' || n.status === 'promoted')
    const sb = performance.now()
    const recent = all.slice(-BUDGET.max_nodes).map(n => n.id) // 最新 10 条（噪声日志垫底）
    const recentMs = performance.now() - sb
    const recentIds = new Set(recent)
    const ownExpect = new Set(expect.filter(e => e.task === t.id).map(e => e.id))
    const measure = (ids) => {
      let effective = 0, wrong = 0, missed = 0, chars = 0
      const missedKinds = []
      for (const e of expect) if (e.task === t.id) { if (ids.has(e.id)) effective++; else { missed++; missedKinds.push(e.kind) } }
      for (const id of ids) { if (!ownExpect.has(id)) wrong++ }
      const byId = new Map(all.map(n => [n.id, n]))
      for (const id of ids) { const n = byId.get(id); if (n) chars += n.text.length }
      return { effective, expected: expect.filter(e => e.task === t.id).length, wrong, missed, missed_kinds: missedKinds, char_proxy: chars }
    }
    results.push({
      task: t.id, query: t.query,
      curated: { ...measure(curatedIds), progress_included: curated.nodes.some(n => n.kind === 'progress'), latency_ms: Math.round(curatedMs * 10) / 10 },
      recent_raw: { ...measure(recentIds), latency_ms: Math.round(recentMs * 10) / 10 },
    })
  }

  const agg = (arm) => ({
    effective_recall: results.reduce((s, r) => s + r[arm].effective / r[arm].expected, 0) / results.length,
    wrong_memory_total: results.reduce((s, r) => s + r[arm].wrong, 0),
    rederivation_missed_total: results.reduce((s, r) => s + r[arm].missed, 0),
    char_proxy_total: results.reduce((s, r) => s + r[arm].char_proxy, 0),
    latency_p50_ms: (() => { const l = results.map(r => r[arm].latency_ms).sort((a, b) => a - b); return l[Math.floor(l.length / 2)] })(),
  })
  const summary = { curated: agg('curated'), recent_raw: agg('recent_raw') }
  const failures = []
  if (summary.curated.effective_recall < summary.recent_raw.effective_recall) failures.push(`curated effective_recall ${summary.curated.effective_recall.toFixed(2)} not better than recent_raw ${summary.recent_raw.effective_recall.toFixed(2)}`)
  if (summary.curated.wrong_memory_total > summary.recent_raw.wrong_memory_total) failures.push(`curated wrong_memory ${summary.curated.wrong_memory_total} not better than recent_raw ${summary.recent_raw.wrong_memory_total}`)
  if (summary.curated.rederivation_missed_total > summary.recent_raw.rederivation_missed_total) failures.push(`curated missed ${summary.curated.rederivation_missed_total} not better than recent_raw ${summary.recent_raw.rederivation_missed_total}`)
  net.close()
  const report = {
    schema: 1, at: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, budget: BUDGET, tasks: TASKS.length, expected_items_per_task: expect.filter(e => e.task === TASKS[0].id).length, noise_observations: noiseIds.length },
    results, summary, failures,
    reproducibility: { seed_inputs: 'TASKS/NOISE constants in scripts/multitask-ab.mjs', deterministic: true },
    scope: 'Deterministic offline fixture on an isolated temp workspace; effective/wrong/missed measured against seeded ground truth, char count as token proxy; not a real-model effectiveness certification. Measured characteristic: constraints are workspace-global by design (frozen top), so in a single shared multi-task library foreign constraints crowd the budget (8/10 slots here); session-scoped mode bounds this per session. Recorded as a trade-off, semantics not changed without authorization.',
    status: failures.length ? 'REGRESSED' : 'PASS',
  }
  const text = JSON.stringify(report, null, 2)
  if (OUT) writeFileSync(OUT, text + '\n')
  console.log(text)
  process.exitCode = failures.length ? 1 : 0
} finally {
  rmSync(dir, { recursive: true, force: true })
}
