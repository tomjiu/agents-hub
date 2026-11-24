import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { stringify } from 'smol-toml'
import { tree } from '../core/files.mjs'
import { workflowProvidersCurrent, checkStaleness } from '../core/workflows.mjs'
import { planDeployment, deployProfile } from '../core/deployment.mjs'
import { preflightSelection } from '../core/usability.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

// G3 (issue #4) 版本更新与组合兼容演练:
// - 工作流 provider 映射与已审阅内容版本绑定, 源更新 → STALE/NEEDS_REVIEW（不重算哈希）
// - 技能被删除/改名 → 部署失效核验报 UNKNOWN/NEEDS_REVIEW, 不冒充 CURRENT
// - 新许可限制 → preflight 阻止组合（不绕过）

async function setupHub(t, { skillBody = 'Body v1\n' } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-drill-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const hub = path.join(dir, 'hub'), project = path.join(dir, 'project')
  await fs.mkdir(project)
  for (const p of ['skills/demo', 'catalog/assets', 'catalog/profiles', 'catalog/workflows', 'experts', 'mcp']) await fs.mkdir(path.join(hub, p), { recursive: true })
  await fs.writeFile(path.join(hub, 'skills/demo/SKILL.md'), '---\nname: demo\ndescription: Drill skill\n---\n' + skillBody)
  const baseline = await tree(path.join(hub, 'skills/demo'))
  await fs.writeFile(path.join(hub, 'catalog/assets/demo.toml'), stringify({ id: 'demo', kind: 'skills', path: 'skills/demo', source: { kind: 'local', url: 'https://example.test/demo' }, version: { sha256: baseline.sha256, local: '1', upstream: '1' } }))
  await fs.writeFile(path.join(hub, 'experts/core.toml'), stringify({ name: 'core', skills: ['demo'], mcp: [], plugins: [] }))
  await fs.writeFile(path.join(hub, 'mcp/registry.toml'), stringify({ schema: 1, servers: [] }))
  for (const client of ['dsh', 'codex', 'opencode']) await fs.writeFile(path.join(hub, 'catalog/profiles', client + '.toml'), stringify({ schema: 1, client, experts: ['core'], skills: [], mcp: [], plugins: [], enabled: false, deploy: 'explicit', overwrite_user_config: false }))
  return { hub, project, dir }
}

const skillHash = async hub => (await import('node:crypto')).createHash('sha256').update(await fs.readFile(path.join(hub, 'skills/demo/SKILL.md'))).digest('hex')

test('G3 演练: 工作流 provider 映射 — 源更新后 STALE/NEEDS_REVIEW, 未变 CURRENT, 不重算', async t => {
  const { hub } = await setupHub(t)
  const caps = { schema: 1, groups: [{ id: 'office', title: '办公' }], routes: [{ id: 'r1', title: '路线', group: 'office', domains: ['workflow'], stages: ['plan'], aliases: ['排期'], coverage: 'scoped', limitations: ['测试'], providers: [{ id: 'demo', fit: 'primary', reason: 'fixture', limitations: ['测试'], reviewed_skill_sha256: await skillHash(hub) }] }] }
  await fs.writeFile(path.join(hub, 'catalog/capabilities.json'), JSON.stringify(caps))
  await fs.writeFile(path.join(hub, 'catalog/workflows/w.json'), JSON.stringify({ schema: 1, id: 'w', version: '1.0.0', title: 'T', route: 'r1', trigger: ['t'], applies: ['a'], not_applies: ['n'], task_inputs: ['i'], steps: [{ id: 's1', stage: 'plan', title: 'S', needs: [], inputs: ['i'], outputs: ['o'], tools: ['none'], validator: 'v' }], providers: ['demo'], approval_points: [], failure_paths: { cancel: 'c', missing_dependency: 'm' }, delivery: ['d'], notes: [] }))
  // 映射时哈希一致 → CURRENT
  let cur = await workflowProvidersCurrent(hub)
  assert.equal(cur.status, 'CURRENT')
  assert.equal(cur.workflows[0].providers[0].status, 'CURRENT')
  // 源更新（SKILL.md 修订）→ STALE/NEEDS_REVIEW; 哈希不被静默重算
  await fs.writeFile(path.join(hub, 'skills/demo/SKILL.md'), '---\nname: demo\ndescription: Drill skill\n---\nBody v2\n')
  cur = await workflowProvidersCurrent(hub)
  assert.equal(cur.status, 'NEEDS_REVIEW')
  assert.equal(cur.workflows[0].providers[0].status, 'STALE')
  assert.equal(cur.workflows[0].providers[0].needs_review, true)
})

test('G3 演练: 技能改名/删除 — 部署失效核验报 UNKNOWN/NEEDS_REVIEW, 不冒充 CURRENT', async t => {
  const { hub, project } = await setupHub(t)
  await planDeployment(hub, 'dsh', project)
  await deployProfile(hub, 'dsh', project, { approved: true })
  // 改名 drill: 目录与登记同步迁移（id+path 都换新）, 旧 id 注销
  const baseline = await tree(path.join(hub, 'skills/demo'))
  await fs.rename(path.join(hub, 'skills/demo'), path.join(hub, 'skills/demo-renamed'))
  await fs.writeFile(path.join(hub, 'catalog/assets/demo-renamed.toml'), stringify({ id: 'demo-renamed', kind: 'skills', path: 'skills/demo-renamed', source: { kind: 'local', url: 'https://example.test/demo' }, version: { sha256: baseline.sha256, local: '1', upstream: '1' } }))
  await fs.rm(path.join(hub, 'catalog/assets/demo.toml'))
  let stale = await checkStaleness(hub, project, 'all')
  assert.equal(stale.status, 'NEEDS_REVIEW')
  assert.equal(stale.deployments[0].skills.find(s => s.id === 'demo').status, 'UNKNOWN')
  assert.ok(stale.deployments[0].skills.find(s => s.id === 'demo').reason.includes('no longer registered'))
  // 删除 drill: 登记与目录一起删除 → 旧部署引用全部 UNKNOWN, 不给假阴性 CURRENT
  await fs.rm(path.join(hub, 'catalog/assets/demo-renamed.toml'))
  await fs.rm(path.join(hub, 'skills/demo-renamed'), { recursive: true, force: true })
  stale = await checkStaleness(hub, project, 'all')
  assert.equal(stale.status, 'NEEDS_REVIEW')
  assert.equal(stale.deployments[0].skills[0].status, 'UNKNOWN')
})

test('G3 演练: 新许可限制 — runtime_review_required 后 preflight 阻止组合, 不绕过', async t => {
  const { hub } = await setupHub(t)
  // 升级前可用
  let pre = await preflightSelection(hub, { ids: ['demo'], client: 'dsh' })
  assert.equal(pre.status, 'CONTENT_READY')
  // 模拟上游新版本带来新的许可/宿主复核要求（runtime_review_required, 顶层键）
  const baseline = await tree(path.join(hub, 'skills/demo'))
  await fs.writeFile(path.join(hub, 'catalog/assets/demo.toml'), stringify({ id: 'demo', kind: 'skills', path: 'skills/demo', runtime_review_required: true, source: { kind: 'local', url: 'https://example.test/demo' }, version: { sha256: baseline.sha256, local: '1', upstream: '1' } }))
  pre = await preflightSelection(hub, { ids: ['demo'], client: 'dsh' })
  assert.equal(pre.status, 'BLOCKED')
  assert.ok(pre.blockers.some(b => b.code === 'vendor-review'), 'license/host re-review must block, not bypass')
})
