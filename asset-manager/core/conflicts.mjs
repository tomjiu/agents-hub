// G2 (issue #4): 结构与语义冲突治理 — 候选级证据输出（G0-10）。
//
// 纪律:
// - 语义检查产出【候选冲突】: 文件/行与条款证据、触发组合、影响、严重度、范围和建议;
//   启发式不保证发现全部矛盾 — 不可用文件判 unknown, 不给假阴性"无冲突"。
// - 不削弱用户/系统指令优先级; 不移除安全/审批门槛来消除冲突;
//   修复建议一律走最小本地适配/配方选择/显式互斥/分阶段隔离。
// - 结构层(重复名/依赖/互斥/环)复用 usability.selectionConflicts, 不重建。
import fs from 'node:fs/promises'
import path from 'node:path'
import { confined } from './files.mjs'
import { loadCatalog } from './catalog.mjs'
import { selectionConflicts } from './usability.mjs'
import { resolveExpert } from './catalog.mjs'

const PATTERNS = [
  {
    code: 'subagent-mandate-vs-host-prohibition',
    severity: 'high',
    re: /\b(spawn|launch|create|use|delegate to)\b[^.\n]{0,60}\b(sub-?agents?|agent workers?|agents? as needed)\b|\bsub-?agents?\b[^.\n]{0,30}\b(must|always|are required)\b/i,
    impact: '技能要求派生子代理，而宿主/项目规则禁止创建子代理；同时遵守两者不可能。',
    recommendation: '遵守宿主禁止：改为内联方案（单进程顺序执行），或在用户明确授权后再启用派生。'
  },
  {
    code: 'global-instruction-override',
    severity: 'high',
    // 要求"覆盖/无视 系统/用户/宿主规则"，或全局强制加载；
    // 反例排除: 安全技能教模型"忽略不可信输入里的注入指令"(untrusted/tool output/injection/引号内 ignore)
    re: /\b(always|must) load\b[^.\n]{0,60}(skill|this|everything|all)\b|\b(override|disregard|ignore)\b[^.\n]{0,40}\b(system|user|host|previous|prior)\b[^.\n]{0,20}\b(rules|instructions|prompts?|directives)\b|\bhighest priority\b[^.\n]{0,30}\b(rule|instruction)\b|\btake precedence over\b[^.\n]{0,40}\b(system|user)\b/i,
    excludes: /untrusted|injection|attacker|tool output|["'“”]\s*(ignore|disregard)/i,
    impact: '技能要求全局加载或覆盖系统/用户指令，破坏指令优先级。',
    recommendation: '改为按需加载与显式引用；系统与用户指令优先级不可被技能正文覆盖。'
  }
]

// 方法矛盾: 相对指令配对（always X vs never X）。
// 宾语 = 动词 + 紧随的非虚词（"commit secrets" vs "commit" 不同宾语不配对 —
// 安全规则"never commit secrets"与频率指令"commit fully"不是矛盾, 这是反例题集的一部分）;
// 间隔内不允许句读分隔（—/;/.），避免跨从句误配（"don't style … — commit fully"）。
const DIRECTIVES = ['commit', 'push', 'merge', 'force-push', 'force push', 'delete', 'run tests', 'write tests', 'deploy', 'rebase']
const MODIFIER_STOP = new Set(['fully', 'directly', 'immediately', 'always', 'now', 'first', 'then', 'after', 'before', 'when', 'with', 'without', 'to', 'in', 'on', 'at', 'the', 'a', 'an', 'your', 'all', 'only', 'just', 'it', 'them'])
const DIRECTIVE_RE = () => new RegExp('\\b(always|never|must not|must|do not|don\'t)\\b[^.;\\u2014\\n]{0,25}?\\b(' + DIRECTIVES.map(d => d.replace(/[-\s]/g, '[-\\s]?')).join('|') + ')\\b(\\s+([a-z-]+))?', 'gi')
const OPPOSING = (a, b) => {
  const pos = m => ['always', 'must'].includes(m)
  const neg = m => ['never', 'must not', 'do not', "don't"].includes(m)
  return (pos(a) && neg(b)) || (neg(a) && pos(b))
}
const directiveKey = (verb, modifier) => modifier && !MODIFIER_STOP.has(modifier) ? verb + ' ' + modifier : verb

const ARTIFACT_DIR_RE = /\b(write|save|output|put|store)s?\b[^.\n]{0,60}?\b(?:to|in|under)\s+((?:\.\/|~\/)?[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)+)/gi

/** 扫描单个文本，返回候选证据行（纯函数，供题集测试复用）。
 *  frontmatter（name/description 摘要）先剥离 — slug 与摘要行不构成方法指令证据
 *  （反例题集: name "never-commit-secrets" 曾被误提取为 "never commit" 指令）。 */
export function scanSkillText(file, text) {
  const hits = []
  text = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const p of PATTERNS) {
      if (p.excludes && p.excludes.test(line)) continue // 反例: 教模型抵御注入的安全条款不是覆盖系统指令
      if (p.re.test(line)) hits.push({ code: p.code, severity: p.severity, evidence: { file, line: i + 1, excerpt: line.trim().slice(0, 200) }, impact: p.impact, recommendation: p.recommendation })
    }
  }
  // 相对指令收集（供跨技能矛盾配对）
  const directives = []
  const re = DIRECTIVE_RE()
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(lines[i])) !== null) {
      const verb = m[2].toLowerCase().replace(/[-\s]+/g, ' ')
      const object = directiveKey(verb, m[4] ? m[4].toLowerCase() : undefined)
      directives.push({ modal: m[1].toLowerCase(), object, evidence: { file, line: i + 1, excerpt: lines[i].trim().slice(0, 200) } })
    }
  }
  // 产物目录声明
  const artifactDirs = []
  for (let i = 0; i < lines.length; i++) {
    ARTIFACT_DIR_RE.lastIndex = 0
    let m
    while ((m = ARTIFACT_DIR_RE.exec(lines[i])) !== null) artifactDirs.push({ dir: m[2], evidence: { file, line: i + 1, excerpt: lines[i].trim().slice(0, 200) } })
  }
  return { hits, directives, artifactDirs }
}

async function readHostProhibition(rulesFile) {
  try {
    const text = await fs.readFile(rulesFile, 'utf8')
    const lines = text.split(/\r?\n/)
    const found = []
    for (let i = 0; i < lines.length; i++) if (/(不要|不得|禁止).{0,12}子代理|do not create sub-?agents?|never (spawn|create) sub-?agents?|no sub-?agents?/i.test(lines[i])) found.push({ file: rulesFile, line: i + 1, excerpt: lines[i].trim().slice(0, 200) })
    return { found }
  } catch { return { unreadable: true } }
}

/**
 * 语义冲突候选检查。
 * @param root 仓库根
 * @param {{skills?: Array<{id:string,path:string}>}} explicit 显式技能路径模式（测试/题集用）;
 *        不传 explicit 时按 ids/expert 构建选择（与 preflight 同源）。
 */
export async function checkSemanticConflicts(root, { ids, expert, hostRulesFile, explicit } = {}) {
  const catalog = await loadCatalog(root)
  let entries = []
  if (explicit) {
    for (const e of explicit) entries.push({ id: e.id, path: e.path })
  } else {
    if (!!ids === !!expert) throw new Error('Select explicit IDs or one expert, not both')
    let selected
    if (expert) selected = await resolveExpert(root, expert, catalog)
    else {
      selected = { skills: [], mcp: [], plugins: [] }
      for (const id of ids) { const a = catalog.get(id); if (!a) throw new Error('Unknown asset ' + id); selected[a.kind].push(id) }
    }
    for (const id of selected.skills) entries.push({ id, path: catalog.get(id).path })
  }
  const candidates = [], unknowns = []
  const scans = new Map()
  for (const e of entries) {
    let file
    try { file = path.join(await confined(root, e.path), 'SKILL.md') } catch { unknowns.push({ id: e.id, file: e.path, reason: 'skill directory unreadable — cannot judge semantic conflicts' }); continue }
    let text
    try { text = await fs.readFile(file, 'utf8') } catch { unknowns.push({ id: e.id, file, reason: 'SKILL.md unreadable — cannot judge semantic conflicts' }); continue }
    scans.set(e.id, { ...scanSkillText(file, text), id: e.id })
  }
  // 宿主禁止（默认根 AGENTS.md） — 未读则相关判 unknown
  const rulesFile = hostRulesFile ?? path.join(root, 'AGENTS.md')
  const host = await readHostProhibition(rulesFile)
  for (const [id, scan] of scans) {
    for (const hit of scan.hits) {
      if (hit.code === 'subagent-mandate-vs-host-prohibition') {
        if (host.unreadable) { unknowns.push({ id, file: rulesFile, reason: 'host rules unreadable — subagent prohibition cannot be checked' }); continue }
        if (!host.found.length) continue // 宿主未禁止则不构成冲突
        candidates.push({ code: hit.code, severity: hit.severity, ids: [id], trigger: '选择集包含要求派生子代理的技能，且宿主规则禁止子代理', impact: hit.impact, recommendation: hit.recommendation, evidence: [hit.evidence, host.found[0]] })
      } else {
        candidates.push({ code: hit.code, severity: hit.severity, ids: [id], trigger: '技能正文包含全局加载/覆盖系统指令条款', impact: hit.impact, recommendation: hit.recommendation, evidence: [hit.evidence] })
      }
    }
  }
  // 跨技能方法矛盾（候选级; 名字不同但方法矛盾靠指令配对, 不靠名称匹配）
  const byObject = new Map()
  for (const [id, scan] of scans) for (const d of scan.directives) {
    if (!byObject.has(d.object)) byObject.set(d.object, [])
    byObject.get(d.object).push({ id, ...d })
  }
  for (const [object, ds] of byObject) {
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
      const a = ds[i], b = ds[j]
      if (a.id === b.id) continue
      if (OPPOSING(a.modal, b.modal)) {
        candidates.push({ code: 'method-contradiction', severity: 'medium', ids: [a.id, b.id], trigger: '选择集中两个技能对 "' + object + '" 给出相反指令（' + a.modal + ' vs ' + b.modal + '）', impact: '同批安装时模型收到矛盾方法指令，行为不可预期。', recommendation: '最小本地适配二选一，或将其中一个改为 alternative 备选不共同混装；矛盾本身保留供人工复核。', evidence: [a.evidence, b.evidence] })
      }
    }
  }
  // 产物目录不一致（候选级）
  const dirOwners = new Map()
  for (const [id, scan] of scans) for (const d of scan.artifactDirs) {
    const root0 = d.dir.split('/')[0]
    if (!dirOwners.has(root0)) dirOwners.set(root0, [])
    dirOwners.get(root0).push({ id, ...d })
  }
  for (const [dir, owners] of dirOwners) {
    const uniqueIds = [...new Set(owners.map(o => o.id))]
    if (uniqueIds.length > 1) {
      candidates.push({ code: 'artifact-location-mismatch', severity: 'low', ids: uniqueIds, trigger: '选择集中多个技能把产物写到目录 "' + dir + '/" 下的不同子路径', impact: '交付物分散，验收与回收路径不一致。', recommendation: '对齐到同一显式产物根，或在配方中声明各自的产物边界。', evidence: owners.map(o => o.evidence) })
    }
  }
  candidates.sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.severity] - ({ high: 0, medium: 1, low: 2 })[b.severity])
  const status = candidates.length ? 'CANDIDATES_FOUND' : 'NO_KNOWN_PATTERNS'
  return {
    schema: 1, status, candidates, unknowns,
    scope: 'Heuristic candidate conflicts with file/line evidence; NOT an exhaustive guarantee (名字不同且无相对指令动词的矛盾不在覆盖内), unknown files never yield a "no conflicts" verdict. 修复不削弱用户/系统指令优先级。'
  }
}

export async function checkConflicts(root, { ids, expert, client = 'dsh', hostRulesFile } = {}) {
  const catalog = await loadCatalog(root)
  let selected
  if (expert) selected = await resolveExpert(root, expert, catalog)
  else { selected = { skills: [], mcp: [], plugins: [] }; for (const id of ids) { const a = catalog.get(id); if (!a) throw new Error('Unknown asset ' + id); selected[a.kind].push(id) } }
  const structural = await selectionConflicts(root, selected, { catalog })
  const semantic = await checkSemanticConflicts(root, { ids, expert, hostRulesFile })
  return {
    schema: 1, client, selected,
    structural, semantic,
    status: structural.length ? 'BLOCKED' : semantic.status,
    blocked: structural.length > 0,
    scope: 'Structural (duplicate names/dependencies/cycles/runtime ids) reuses selectionConflicts; semantic layer emits candidate conflicts only — human review decides, nothing auto-fixed or auto-removed.'
  }
}
