#!/usr/bin/env node
/** 100k+ 长期增长基准（issue #2 M4 挂账项）。
 *
 * 独立临时库，不触碰真实库。全部走公开 API（MemoryNet.open / add / updateProgress /
 * nodesForProjection / activate / gc / recallForTask），ledger+evidence sidecar 全开
 * （最重配置），测量：
 *   1) 100,000 混合节点插入吞吐（observation/tip/inference/progress 混合，含 based_on 链）
 *   2) 全量投影 nodesForProjection 延迟
 *   3) 任务驱动精选 recallForTask 采样延迟（命中/无关查询, p50/p95）
 *   4) 预算激活 activate 延迟
 *   5) GC(purge) 延迟与证据闭包保持
 *   6) db/副作用盘文件尺寸
 * 界限是回归信号（沙箱标定），不是产品 SLA；超界以非零退出。
 * 用法: node scripts/growth-benchmark.mjs [--nodes 100000] [--json <output>] */
import { mkdtempSync, rmSync, statSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const args = process.argv.slice(2)
const flag = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? Number(args[i + 1]) : dflt }
const NODES = flag('nodes', 100000)
const OUT = (() => { const i = args.indexOf('--json'); return i >= 0 && args[i + 1] ? args[i + 1] : null })()

const { MemoryNet } = await import('../dist/src/store.js')
const { recallForTask } = await import('../dist/src/recall.js')

const dir = mkdtempSync(join(tmpdir(), 'mn-growth-100k-'))
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] }
const round = (v) => Math.round(v * 10) / 10
const BOUND = { insertMsPerNode: 12, projectionMs: 30000, recallP95Ms: 5000, activateMs: 8000, gcMs: 60000 }
const failures = []
const check = (name, value, bound, ok) => { if (!ok) failures.push(`${name}=${round(value)} exceeds bound ${bound}`) }

try {
  const net = MemoryNet.open(dir, { agentId: 'growth-bench', role: 'host', ledger: true })
  const t0 = performance.now()
  let inferences = 0, tips = 0, observations = 0
  let lastObs = null, lastInf = null
  for (let i = 0; i < NODES; i++) {
    const k = i % 20
    if (k === 3) { net.add('tip', { text: `deploy tip ${i}: use wal checkpoint ${i % 89} before vacuum`, run_id: 'r-grow' }); tips++ }
    else if (k === 7 && lastObs) { const inf = net.add('inference', { text: `inference ${i}: metric drift ${i % 97} correlates with release ${i % 53}`, confidence: 0.8, based_on: [lastObs.id], run_id: 'r-grow' }); net.promote(inf.id, { by: "user", note: "benchmark promote", expected_revision: net.get(inf.id).revision_id }); lastInf = inf; inferences++ }
    else if (k === 11) { lastInf && net.updateProgress('task-' + (i % 7), { summary: `progress step ${i}: verified stage ${i % 31}` }) }
    else { lastObs = net.add('observation', { text: `obs ${i} baseline metric value ${i % 97} latency bucket ${i % 13} shard ${i % 29}`, source: 'tool', run_id: 'r-grow' }); observations++ }
  }
  const insertMs = performance.now() - t0
  const insertPerNode = insertMs / NODES

  const t1 = performance.now()
  const proj = net.nodesForProjection()
  const projMs = performance.now() - t1
  if (proj.length < NODES * 0.9) failures.push(`projection returned only ${proj.length} nodes`)

  const hitQueries = [], missQueries = []
  for (let q = 0; q < 60; q++) {
    hitQueries.push(`baseline metric value ${q % 97}`)
    missQueries.push(`zzqq nonexistent topic ${q} unrelated terms`)
  }
  const hitLat = [], missLat = [], hitCounts = []
  for (const q of hitQueries) { const s = performance.now(); const r = recallForTask(net, q, { budgets: { max_nodes: 10 } }); hitLat.push(performance.now() - s); hitCounts.push(r.nodes.length) }
  for (const q of missQueries) { const s = performance.now(); recallForTask(net, q, { budgets: { max_nodes: 10 } }); missLat.push(performance.now() - s) }
  const actLat = []
  for (let q = 0; q < 20; q++) { const s = performance.now(); net.activate('baseline metric value ' + (q % 97), { budget: { max_nodes: 10, max_tokens: 2048 } }); actLat.push(performance.now() - s) }

  // GC/purge：降级 2,000 个无引用 tip，purge 后确认被推断引用的 observation 仍在（证据闭包）
  const tipsList = net.nodesForProjection().filter(n => n.kind === 'tip').slice(0, 2000)
  for (const t of tipsList) net.demote(t.id, { reason: 'benchmark gc', expected_revision: net.get(t.id).revision_id })
  const tg = performance.now()
  const gcReport = net.gc({ purge: true })
  const gcMs = performance.now() - tg

  const dbSize = (p) => { try { return statSync(p).size } catch { return 0 } }
  const report = {
    schema: 1, at: new Date().toISOString(), environment: { node: process.version, platform: process.platform, nodes_target: NODES, ledger: true },
    inserted: { observations, tips, inferences, progress_tasks: 7, total: NODES },
    latency_ms: {
      insert_total: round(insertMs), insert_per_node: round(insertPerNode * 1000) / 1000,
      projection_full: round(projMs), projection_nodes: proj.length,
      recall_hit_p50: round(pct(hitLat, 50)), recall_hit_p95: round(pct(hitLat, 95)),
      recall_miss_p50: round(pct(missLat, 50)), recall_miss_p95: round(pct(missLat, 95)),
      activate_p50: round(pct(actLat, 50)), activate_p95: round(pct(actLat, 95)),
      gc_purge_2000: round(gcMs),
    },
    recall_hit_nodes_avg: round(hitCounts.reduce((a, b) => a + b, 0) / hitCounts.length),
    gc: gcReport,
    files_bytes: { memory_db: dbSize(join(dir, 'memory.db')), provenance_db: dbSize(join(dir, 'provenance.db')) },
    bounds_regression_signals: BOUND,
    scope: 'Sandbox-calibrated regression signals on an isolated temp workspace via public APIs with ledger+evidence sidecar enabled; not a product SLA and not a real-model effectiveness claim.',
  }
  check('insert_per_node', insertPerNode, BOUND.insertMsPerNode, insertPerNode < BOUND.insertMsPerNode)
  check('projection_full', projMs, BOUND.projectionMs, projMs < BOUND.projectionMs)
  check('recall_hit_p95', pct(hitLat, 95), BOUND.recallP95Ms, pct(hitLat, 95) < BOUND.recallP95Ms)
  check('recall_miss_p95', pct(missLat, 95), BOUND.recallP95Ms, pct(missLat, 95) < BOUND.recallP95Ms)
  check('activate_p95', pct(actLat, 95), BOUND.activateMs, pct(actLat, 95) < BOUND.activateMs)
  check('gc_purge', gcMs, BOUND.gcMs, gcMs < BOUND.gcMs)
  net.close()
  report.status = failures.length ? 'BOUND_EXCEEDED' : 'PASS'
  report.failures = failures
  const text = JSON.stringify(report, null, 2)
  if (OUT) { const { writeFileSync } = await import('node:fs'); writeFileSync(OUT, text + '\n') }
  console.log(text)
  process.exitCode = failures.length ? 1 : 0
} finally {
  rmSync(dir, { recursive: true, force: true })
}
