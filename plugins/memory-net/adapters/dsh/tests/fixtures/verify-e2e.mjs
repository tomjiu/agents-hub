#!/usr/bin/env node
// E2E 断言核验（smoke-dsh-e2e.sh 第 6 步调用）：
//   node verify-e2e.mjs <requests.jsonl> <workspace.db> <dsh-stdout-file>
// 六类断言：
//   A 工具注册面   —— 至少一个请求的 tools 同时含 memory_net_write/memory_net_recall/mn_e2e_echo
//   B 区段注入面   —— 宿主预置的约束/进度出现在 system prompt；工具写后的组装含该推断
//   C 闭环回显     —— dsh stdout 含 MN-E2E-OK（模型最终回复携带工具结果）
//   D SQLite 落盘   —— 模型经工具写入的 inference 真实持久化在 workspace memory.db
//   E auto-observe —— 宿主工具 mn_e2e_echo 的执行结果被 tools/result 桥自动写为观测
//                     （独立调用无状态key，payload.tool=mn_e2e_echo）；且 memory_net_* 未被递归观测（自指过滤真实生效）
import { readFileSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const [diagPath, dbPath, stdoutPath] = process.argv.slice(2)
const fail = (msg) => { console.error(`[verify] FAIL: ${msg}`); process.exit(1) }
const ok = (msg) => console.log(`[verify] ✓ ${msg}`)

if (!diagPath || !dbPath || !stdoutPath) fail('用法: verify-e2e.mjs <requests.jsonl> <memory.db> <stdout-file>')
if (!existsSync(diagPath)) fail(`诊断文件不存在: ${diagPath}`)

const rows = readFileSync(diagPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
if (rows.length === 0) fail('模型未收到任何请求（dsh 未发起对话？）')

// A. 工具注册面
const withTools = rows.filter((r) => r.has_memory_net_write && r.has_memory_net_recall)
if (withTools.length === 0) {
  fail(`工具未出现在模型请求 tools 列表（共 ${rows.length} 个请求，tool_count 样本=${rows[0].tool_count}）`)
}
ok(`A1 工具注册: memory_net_write + memory_net_recall 出现在 ${withTools.length} 个请求的 tools 列表`)
const withEcho = rows.filter((r) => r.has_mn_e2e_echo)
if (withEcho.length === 0) fail('mn_e2e_echo 未出现在 tools 列表（echo-tool 插件未加载？）')
ok(`A2 工具注册: mn_e2e_echo（宿主真实工具）出现在 ${withEcho.length} 个请求的 tools 列表`)

// B. 区段注入面
const withConstraint = rows.filter((r) => r.has_constraint_section)
if (withConstraint.length === 0) fail('预置约束（永不 force push main）未注入 system prompt（memory-net 区段未生效）')
ok('B1 区段注入: 宿主预置约束进入 system prompt（memory-net section 生效）')
const curated = process.env.MN_E2E_CURATED === '1'
const withProgress = rows.filter((r) => r.has_progress_section)
if (!curated && withProgress.length === 0) fail('预置进度（登录页 60%）未注入 system prompt')
ok(curated ? 'B2 精选区段: 无当前任务时排除其他任务进度' : 'B2 区段注入: 宿主预置进度进入 system prompt')
const withInference = rows.filter((r) => r.round === 'after_tool' && r.has_inference_section)
if (!curated && withInference.length === 0) fail('工具写入的推断未在后续组装中出现（激活/重组装未生效）')
ok(curated ? 'B3 精选区段: 不自动注入未审阅推断' : 'B3 区段注入: 工具写入的推断进入工具后组装（重组装生效）')

if (curated && !rows.some(r=>r.has_curated_prompt&&r.has_curated_recall&&r.has_raw_recall)) fail('Curated prompt/recall/raw diagnosis missing')

// C. 闭环回显
const stdout = readFileSync(stdoutPath, 'utf8')
if (!stdout.includes('MN-E2E-OK')) fail('dsh stdout 无 MN-E2E-OK（模型最终回复未携带工具结果）')
ok('C 工具闭环: 模型发起 memory_net_write → dsh 执行 → canonical 结果回给模型并进入最终回复')

// D. SQLite 落盘
if (!existsSync(dbPath)) fail(`workspace 数据库不存在: ${dbPath}`)
const db = new DatabaseSync(dbPath, { readOnly: true })
const row = db.prepare("SELECT id, kind, text FROM nodes WHERE text LIKE '%memory_net_write%' AND kind='inference'").get()
if (!row) { db.close(); fail('SQLite 中未找到模型写入的 inference 节点（落盘失败？）') }
ok(`D 持久化: ${row.id} [inference] "${row.text.slice(0, 40)}…" 已落 ${dbPath}`)

// E. auto-observe：宿主工具结果自动观测入网（tools/result 事件桥在真实 dsh 里生效）
const echoes = db.prepare("SELECT id, key, status, text, payload_json FROM nodes WHERE kind='observation' AND json_extract(payload_json, '$.tool')='mn_e2e_echo' ORDER BY seq").all()
const obs = echoes[0]
if (!obs) {
  db.close()
  fail('auto-observe 未生效：workspace 无 payload.tool=mn_e2e_echo 的观测（ctx.on 不可达或事件未分发？）')
}
if (!obs.text.includes('工具 mn_e2e_echo 成功') || !obs.text.includes('hello auto-observe')) {
  db.close()
  fail(`auto-observe 观测内容异常: ${obs.text.slice(0, 120)}`)
}
if (!JSON.parse(obs.payload_json).call_id) {
  db.close()
  fail(`auto-observe 观测 payload 缺 call_id（非本桥写入？）: ${obs.payload_json.slice(0, 120)}`)
}
ok(`E1 auto-observe: ${obs.id} [observation] "${obs.text.slice(0, 60)}…" 已自动入网（payload 含 call_id）`)
const selfObs = db.prepare("SELECT COUNT(*) AS n FROM nodes WHERE kind='observation' AND substr(json_extract(payload_json, '$.tool'),1,11)='memory_net_'").get()
if (selfObs.n !== 0) {
  db.close()
  fail(`自身工具被递归观测（${selfObs.n} 条）——memory_net_* 过滤失效`)
}
ok('E2 自指过滤: memory_net_* 工具结果未被递归观测')
if (process.env.MN_E2E_MEMORY_P0 === '1') {
  if (echoes.length !== 3 || !echoes.every(n => n.key === null)) fail('P0 independent echo invocations missing')
  const finding = db.prepare("SELECT id, status, based_on_json, payload_json FROM nodes WHERE text='MN-P0-REVIEWED-DECISION'").get()
  if (!finding || finding.status !== 'promoted') fail('P0 reviewed decision not retained')
  const dependencies = JSON.parse(finding.based_on_json)
  if (!dependencies.includes(obs.id) || !db.prepare('SELECT id FROM nodes WHERE id=?').get(obs.id)) fail('P0 GC removed decision evidence')
  if (!rows.some(r => r.has_p0_checked) || !rows.some(r => r.has_p0_recall)) fail('P0 actual tool check/recall result missing from model')
  ok('P0 independent invocations, reviewed recall and GC evidence retained through actual host')
}
if (echoes.some(n=>n.key!==null)) fail('Automatic observations still use mutable state key')
db.close()
console.log('[verify] PASS: 适配包经真实 dsh headless 端到端生效（含 auto-observe）')
