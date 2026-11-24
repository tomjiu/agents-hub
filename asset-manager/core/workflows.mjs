// G1 (issue #4): 有版本的工作流程契约 — 机器可校验的阶段交接 (G0-9)。
//
// 契约是方法与路由, 不冒充自动执行 Agent 或自授工具权限:
// - 触发条件 / 适用与不适用范围 / 步骤 DAG / 阶段输入输出 / 验证器 /
//   工具需求 / 批准-取消-恢复路径 / 最终交付
// - 机器校验: schema 形状、DAG 无环+拓扑序、阶段 IO 闭包(每个步骤所需输入由
//   任务输入或前驱输出提供)、工具需求只引用已登记资产或显式 none、
//   门控步骤必须有批准点、provider 只引用已审阅 catalog 资产
// - 契约不执行任何东西; 执行仍是宿主/用户的事, 缺工具/缺环境在执行前阻止
import fs from 'node:fs/promises'
import path from 'node:path'
import { confined, tree } from './files.mjs'
import { loadCatalog } from './catalog.mjs'

const STAGES = ['clarify', 'research', 'plan', 'execute', 'review', 'deliver', 'maintain']
const CONTRACT_KEYS = ['schema', 'id', 'version', 'title', 'route', 'trigger', 'applies', 'not_applies', 'task_inputs', 'steps', 'providers', 'approval_points', 'failure_paths', 'delivery', 'notes']
const STEP_KEYS = ['id', 'stage', 'title', 'needs', 'inputs', 'outputs', 'tools', 'validator', 'approval']
const string = (v, l) => { if (typeof v !== 'string' || !v.trim() || v.length > 500) throw new Error('Invalid workflow ' + l) }
const strings = (v, l) => { if (!Array.isArray(v) || !v.length || v.length > 50 || v.some(s => typeof s !== 'string' || !s.trim() || s.length > 300)) throw new Error('Invalid workflow ' + l) }

export async function listWorkflows(root) {
  const dir = await confined(root, 'catalog/workflows', { mustExist: false })
  let entries = []
  try { entries = await fs.readdir(dir) } catch { return { workflows: [], scope: 'No workflow contracts registered yet' } }
  const out = []
  for (const name of entries.filter(n => n.endsWith('.json')).sort()) {
    const contract = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'))
    out.push({ id: contract.id, version: contract.version, title: contract.title, route: contract.route, file: 'catalog/workflows/' + name, steps: (contract.steps || []).length })
  }
  return { workflows: out, scope: 'Workflow contracts are method/routing metadata with machine-checked shape, DAG, stage-IO closure, tool references and approval gates. They execute nothing.' }
}

export async function validateWorkflowContract(root, contract) {
  const problems = []
  const shape = (obj, keys, label) => { if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).some(k => !keys.includes(k))) problems.push(label + ': unexpected/missing keys') }
  shape(contract, CONTRACT_KEYS, 'contract')
  if (contract.schema !== 1) problems.push('schema must be 1')
  string(contract.id, 'id'); string(contract.version, 'version'); string(contract.title, 'title'); string(contract.route, 'route')
  strings(contract.trigger, 'trigger'); strings(contract.applies, 'applies'); strings(contract.not_applies, 'not_applies')
  strings(contract.task_inputs, 'task_inputs'); strings(contract.delivery, 'delivery')
  if (Array.isArray(contract.notes)) { if (contract.notes.some(n => typeof n !== 'string' || n.length > 500)) problems.push('notes entries must be short strings') } else problems.push('notes must be an array')
  // 步骤
  if (!Array.isArray(contract.steps) || !contract.steps.length || contract.steps.length > 50) { problems.push('steps must be a non-empty array (<=50)') }
  const byId = new Map(); const ids = new Set()
  for (const s of contract.steps || []) {
    shape(s, STEP_KEYS, 'step ' + (s?.id ?? '?'))
    string(s.id, 'step id'); string(s.title, 'step title')
    if (!STAGES.includes(s.stage)) problems.push('step ' + s.id + ': unknown stage ' + String(s.stage))
    if (!Array.isArray(s.needs) || s.needs.some(n => typeof n !== 'string')) problems.push('step ' + s.id + ': needs must be string[]')
    if (ids.has(s.id)) problems.push('step ' + s.id + ': duplicate id'); ids.add(s.id); byId.set(s.id, s)
    strings(s.inputs || [], 'step ' + s.id + ' inputs'); strings(s.outputs || [], 'step ' + s.id + ' outputs')
    strings(s.tools || [], 'step ' + s.id + ' tools')
    if (s.validator !== undefined && (typeof s.validator !== 'string' || s.validator.length > 300)) problems.push('step ' + s.id + ': validator must be a short string')
    if (s.approval !== undefined && typeof s.approval !== 'boolean') problems.push('step ' + s.id + ': approval must be boolean')
  }
  // DAG: needs 引用存在 + 无环 + 拓扑可达
  const color = new Map()
  const visit = (id, stack) => {
    if (color.get(id) === 2) return
    if (color.get(id) === 1) { problems.push('cycle detected at step ' + id + ' via ' + stack.join('->')); return }
    color.set(id, 1)
    for (const n of byId.get(id).needs || []) {
      if (!byId.has(n)) problems.push('step ' + id + ': needs unknown step ' + n)
      else visit(n, [...stack, n])
    }
    color.set(id, 2)
  }
  for (const id of ids) visit(id, [id])
  // 阶段 IO 闭包: 每个步骤的 inputs 必须由 task_inputs 或其前驱(传递)的 outputs 提供
  if (!problems.some(p => p.includes('cycle'))) {
    const reach = new Map()
    const availableAt = (id) => {
      if (reach.has(id)) return reach.get(id)
      const s = byId.get(id); const avail = new Set(contract.task_inputs || [])
      for (const n of s.needs || []) for (const o of availableAt(n)) avail.add(o)
      for (const o of s.outputs || []) avail.add(o)
      reach.set(id, avail); return avail
    }
    for (const s of contract.steps) {
      const avail = availableAt(s.id)
      for (const i of s.inputs || []) if (!avail.has(i)) problems.push('step ' + s.id + ': input "' + i + '" not provided by task inputs or any predecessor output (stage-IO closure violated)')
    }
  }
  // 工具需求: 只允许已登记资产 id 或 "none"
  const catalog = await loadCatalog(root)
  for (const s of contract.steps || []) {
    for (const t of s.tools || []) {
      if (t === 'none') continue
      if (!catalog.has(t)) problems.push('step ' + s.id + ': tool requirement "' + t + '" is not a registered asset id (register it or use "none")')
    }
  }
  // provider: 已登记 skill 且非重复
  const seen = new Set()
  for (const p of contract.providers || []) {
    if (typeof p !== 'string' || !catalog.has(p)) problems.push('provider "' + String(p) + '" is not a registered asset')
    else if (catalog.get(p).kind !== 'skills') problems.push('provider "' + p + '" must be a skill')
    if (seen.has(p)) problems.push('duplicate provider ' + p); seen.add(p)
  }
  if (!Array.isArray(contract.providers) || !contract.providers.length) problems.push('providers must be non-empty (route to reviewed skills)')
  // 批准点: approval:true 的步骤必须在 approval_points 中登记; 失败路径覆盖取消
  const gated = (contract.steps || []).filter(s => s.approval === true).map(s => s.id)
  const ap = new Set(contract.approval_points || [])
  for (const g of gated) if (!ap.has(g)) problems.push('gated step ' + g + ' missing from approval_points')
  for (const a of ap) if (!ids.has(a)) problems.push('approval_point ' + a + ' is not a step id')
  const fp = contract.failure_paths || {}
  if (typeof fp !== 'object' || Array.isArray(fp)) problems.push('failure_paths must be an object')
  else for (const key of ['cancel', 'missing_dependency']) if (!(key in fp)) problems.push('failure_paths missing "' + key + '" (cancel/missing-dependency handoff required)')
  return { valid: problems.length === 0, problems }
}

export async function validateAllWorkflows(root) {
  const dir = await confined(root, 'catalog/workflows', { mustExist: false })
  let entries = []
  try { entries = (await fs.readdir(dir)).filter(n => n.endsWith('.json')) } catch { }
  const results = []
  for (const name of entries.sort()) {
    const file = path.join(dir, name)
    let contract
    try { contract = JSON.parse(await fs.readFile(file, 'utf8')) } catch (e) { results.push({ file: 'catalog/workflows/' + name, valid: false, problems: ['invalid JSON: ' + e.message] }); continue }
    const v = await validateWorkflowContract(root, contract)
    results.push({ id: contract.id, version: contract.version, file: 'catalog/workflows/' + name, ...v })
  }
  return { status: results.every(r => r.valid) ? 'PASS' : 'FAIL', workflows: results, checks: 'schema shape, stage vocabulary, DAG acyclicity, stage-IO closure, tool/provider registration, approval gates, failure paths (cancel + missing dependency)' }
}

export async function workflowProvidersCurrent(root) {
  // 契约 provider 与能力映射的 reviewed hash 绑定: 源更新后显示 STALE/NEEDS_REVIEW,
  // 不盲目重算映射哈希让其重新 CURRENT (G3)。
  const dir = await confined(root, 'catalog/workflows', { mustExist: false })
  const catalog = await loadCatalog(root)
  let reviewed = new Map()
  try {
    const caps = JSON.parse(await fs.readFile(await confined(root, 'catalog/capabilities.json'), 'utf8'))
    for (const r of caps.routes) for (const p of r.providers) reviewed.set(p.id, p.reviewed_skill_sha256)
  } catch { reviewed = new Map() /* 无能力映射的临时环境: provider 按 UNBOUND 报告 */ }
  let entries = []
  try { entries = (await fs.readdir(dir)).filter(n => n.endsWith('.json')) } catch { return { status: 'PASS', workflows: [], note: 'no contracts' } }
  const out = []
  for (const name of entries.sort()) {
    const contract = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'))
    const providers = []
    let stale = false
    for (const pid of contract.providers || []) {
      const asset = catalog.get(pid)
      if (!asset) { providers.push({ id: pid, status: 'UNKNOWN', reason: 'not registered' }); stale = true; continue }
      const skillFile = path.join(await confined(root, asset.path), 'SKILL.md')
      // 读实际 SKILL.md 哈希对比能力映射登记的 reviewed hash
      const { sha256 } = await import('./files.mjs')
      let actual = null
      try { actual = sha256(await fs.readFile(skillFile)) } catch { }
      const recorded = reviewed.get(pid)
      const status = actual === null ? 'UNKNOWN' : recorded === undefined ? 'UNBOUND' : actual === recorded ? 'CURRENT' : 'STALE'
      if (status !== 'CURRENT') stale = true
      providers.push({ id: pid, status, needs_review: status === 'STALE', reason: status === 'STALE' ? 'SKILL.md content changed after capability mapping review' : status === 'UNBOUND' ? 'provider not mapped in capabilities.json — bind it before relying on the mapping' : status === 'UNKNOWN' ? 'SKILL.md unreadable' : 'content matches reviewed hash' })
    }
    out.push({ id: contract.id, version: contract.version, status: stale ? 'NEEDS_REVIEW' : 'CURRENT', providers })
  }
  return { status: out.every(w => w.status === 'CURRENT') ? 'CURRENT' : 'NEEDS_REVIEW', workflows: out, policy: 'STALE requires human re-review; hashes are never silently recomputed to become CURRENT' }
}

// G3 (issue #4): check-stale — 部署回执/工作流 provider 与当前内容的失效核验。
// 源更新后显示 STALE/NEEDS_REVIEW; 不盲目重算映射哈希让其重新 CURRENT。
export async function checkStaleness(root, project, deploymentId = 'all') {
  const catalog = await loadCatalog(root)
  const { sha256 } = await import('./files.mjs')
  const target = await confined(project, '.agents-hub/deployments', { mustExist: false })
  let receipts = []
  try {
    receipts = (await fs.readdir(target)).filter(n => n.endsWith('.json'))
    if (deploymentId !== 'all') receipts = receipts.filter(n => n === deploymentId + '.json')
  } catch { return { schema: 1, status: 'NO_DEPLOYMENTS', scope: 'No deployment receipts found in the consumer project' } }
  const results = []
  for (const name of receipts.sort()) {
    const receipt = JSON.parse(await fs.readFile(path.join(target, name), 'utf8'))
    const skills = []
    let stale = false
    for (const s of receipt.skills || []) {
      const asset = catalog.get(s.id)
      let status = 'UNKNOWN', reason = 'asset no longer registered'
      if (asset) {
        let actual = null
        try { actual = (await tree(await confined(root, asset.path))).sha256 } catch { }
        // 回执 sha256 是部署时技能树的树哈希（views snapshot），对比也用树哈希:
        // 任何文件变化（含模板/脚本）都会正确触发 STALE
        status = actual === null ? 'UNKNOWN' : actual === s.sha256 ? 'CURRENT' : 'STALE'
        reason = status === 'STALE' ? 'skill content changed after this deployment was reviewed' : status === 'UNKNOWN' ? 'current skill tree unreadable' : 'content matches the reviewed deployment hash'
      }
      if (status !== 'CURRENT') stale = true
      skills.push({ id: s.id, status, needs_review: status === 'STALE', reason })
    }
    results.push({ deployment: receipt.id ?? name.replace(/\.json$/, ''), status: stale ? 'NEEDS_REVIEW' : 'CURRENT', skills })
  }
  const providers = await workflowProvidersCurrent(root)
  const status = [...results, providers].every(r => r.status === 'CURRENT') ? 'CURRENT' : 'NEEDS_REVIEW'
  return { schema: 1, status, deployments: results, workflow_providers: providers, policy: 'STALE requires human re-review of the affected deployment/mapping; hashes are never silently recomputed' }
}
