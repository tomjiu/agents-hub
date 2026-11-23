# Memory Provenance P0 Implementation Plan

> **For agentic workers:** Execute inline using the available executing-plans workflow, with review checkpoints. Delegate only if permitted by the user and exposed by the host; never invent a required sub-skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先修复自动观测误覆盖、promoted漏召回及GC悬空证据，为下一阶段不可变修订原型保留可靠基线。

**Architecture:** 保留schema1和SQLite，自动工具结果是独立调用记录，不再是tool名状态寄存器。显式状态key仍保留原有保守覆盖/推翻语义，但包括promoted结论；GC在单写事务内保护所有存活节点的传递依据。这一P0不是操作历史或版本绑定本身，第二阶段需求见[设计](../../../plugins/memory-net/PROVENANCE-DESIGN.md)。

**Tech Stack:** Node、TypeScript、node:sqlite、现有Memory-net及DSH适配契约、node:test。

---

## 边界及验证入口

执行状态：P0已在隔离分支按红绿测试实施，核心34/adapter22/搜索330/根138通过（根1项跳过），rc.1/rc.5及新clone独立验收见[记录](../../../catalog/audit/memory-provenance-p0.json)。复跑步骤保留为清单；未在当前Web采用。不得从代码示例推断P1或版本绑定已上线。专用worktree执行，不触碰原main运行dist、用户数据库和Web配置；改动产物先独立编译/新包验收。新库实验不用真实工具日志或完整代码；基线证据见[8项复现](../../../catalog/audit/memory-provenance-baseline.json)。

P0不修progress修订漂移、trail稳定地址、代码状态needs_review、任务隔离或噪音预算。GC事务只保护当次可见的已提交引用图；当前add/link先校验引用再写入，与GC并发时仍有检查到使用之间的竞态，P1必须把依赖校验与修改纳入同一写事务，不能把P0宣称成完整并发引用完整性。这些由P1-P3独立计划解决；尤其取消tool名覆盖后观测量会增长，P0不能默认更新live配置。不能做无限提示注入或把新增调用记录当精选记忆。

固定构建命令（在对应包目录运行，预先固定安装依赖，不启动用户服务）：

~~~sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/build.mjs
node --test dist/tests/*.test.js
~~~

适配包使用自己的固定依赖及构建，测试路径是dist/adapters/dsh/tests。Windows只读sandbox若命令受限按宿主规则处理，不通过换通道绕过。不得创建子代理。

## Task 1: 自动工具观测只追加，不冒充状态变更

**Files:** 修改[bridge](../../../plugins/memory-net/adapters/dsh/src/bridge.ts#L127-L184)及[既有适配测试](../../../plugins/memory-net/adapters/dsh/tests/adapter.test.ts#L283-L409)；创建plugins/memory-net/adapters/dsh/tests/provenance-p0.test.ts。

- [ ] 在新测试文件写以下完整测试；没有日志输出原始参数，全部合成输入：

~~~ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryNet } from '../../../src/store.js'
import { buildObservation, installAutoObserve } from '../src/bridge.js'
import { resolveConfig } from '../src/config.js'

test('different and identical repeated calls retain independent evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'mn-p0-observe-'))
  const cfg = resolveConfig({workspaces_root: root, default_workspace: 'main'})
  const net = MemoryNet.open(join(root, 'main'), {agentId: 'fixture-host', role: 'host'})
  let listener: ((...args: unknown[]) => void) | undefined
  try {
    installAutoObserve({on: (_event, fn) => {listener = fn}}, cfg, () => net,
      {warn: message => {throw new Error(message)}})
    listener!({name:'read',callId:'call-A',arguments:{file_path:'A.ts'}}, {value:'evidence A'})
    const a = net.exportPkg().nodes.find(n => n.payload.call_id === 'call-A')!
    const decision = net.add('inference', {text:'decision about A',confidence:.9,based_on:[a.id]})
    listener!({name:'read',callId:'call-B',arguments:{file_path:'B.ts'}}, {value:'unrelated B'})
    listener!({name:'read',callId:'call-A-again',arguments:{file_path:'A.ts'}}, {value:'evidence A'})
    const observations = net.exportPkg().nodes.filter(n => n.kind === 'observation')
    assert.equal(observations.length,3)
    assert.ok(observations.every(n => n.key === null && n.status === 'active'))
    assert.equal(net.get(decision.id)!.status,'active')
    assert.equal(net.get(a.id)!.text,a.text)
    assert.equal(buildObservation(cfg.auto_observe,{name:'memory_net_write'},{}),null)
  } finally {net.close();rmSync(root,{recursive:true,force:true})}
})
~~~

- [ ] 在adapters/dsh目录运行node scripts/build.mjs及node --test dist/adapters/dsh/tests/provenance-p0.test.js。预期旧基线FAIL（key不是null或decision已contradicted），不能跳过失败复现。
- [ ] 精确修改：AutoObservation里的key: string改key?: string；buildObservation返回对象删除key: tool名那一行，保留text/payload及self/nested/error过滤；installAutoObserve现有key: obs.key成为undefined输入，核心add写NULL。不要从tool名构造新稳定ID，更不要从时间戳或hash捏造durable event_seq。

目标返回代码：

~~~ts
  return {
    text,
    payload: {
      tool: name,
      is_error: isError,
      call_id: exec?.callId ?? null,
      truncated: args.truncated || body.truncated,
    },
  }
~~~

- [ ] 替换bridge注释中“工具变化即现实变化”：明确独立调用，显式状态key只由宿主决定。更新既有adapter测试：所有n.key === tool名的断言改n.kind === observation && n.payload.tool === 工具名，首成功用payload.call_id === c-1定位；保留调用ID、args截断、错误、自指与销毁检查。不要删除既有负向断言。
- [ ] 重新构建运行全部适配测试，预期PASS；运行核心测试仍PASS。单独核对显式key的核心覆盖测试仍成立。
- [ ] 提交此任务，提交信息fix: preserve independent auto-observe invocations，不混入schema变化。当前应用还不具备重启事件去重，不声称解决它。

## Task 2: promoted可召回，而且明确状态变化也能推翻它

**Files:** 修改[store](../../../plugins/memory-net/src/store.ts#L276-L291)及其activate、创建plugins/memory-net/tests/11-provenance-p0.test.ts。

- [ ] 写新核心测试文件，以下完整内容先锁红灯：

~~~ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryNet } from '../src/store.js'
import { makeTempWs, cleanupDir } from './helpers.js'

test('promoted inference is recalled until explicit subject evidence changes', () => {
  const ws = makeTempWs('mn-p0-promoted-')
  const net = MemoryNet.open(ws,{agentId:'fixture-host',role:'host'})
  try {
    const evidence = net.add('observation',{key:'subject:A',text:'A before',source:'tool'})
    const decision = net.add('inference',{text:'decision about A',confidence:.8,based_on:[evidence.id]})
    net.promote(decision.id,{evidence:[evidence.id]})
    assert.ok(net.activate('decision about A').nodes.some(r=>r.node.id===decision.id))
    net.add('observation',{key:'subject:A',text:'A after',source:'tool'})
    assert.equal(net.get(decision.id)!.status,'contradicted')
    assert.ok(!net.activate('decision about A').nodes.some(r=>r.node.id===decision.id))
  } finally {net.close();cleanupDir(ws)}
})
~~~

- [ ] 从plugins/memory-net目录构建并运行node --test dist/tests/11-provenance-p0.test.js。旧基线预期FAIL：promoted没有入选。
- [ ] 最小SQL改动：supersedeSameKey的依赖UPDATE将status = active改为status IN (active,promoted)；activate竞争候选WHERE status = active改为WHERE status = active OR (kind = inference AND status = promoted)，用括号与后续AND条件结合。冻结约束/进度SQL不改，demoted/contradicted/superseded仍排除。目标片段：

~~~ts
// supersedeSameKey UPDATE statement
`UPDATE nodes SET status = 'contradicted', updated_at = ?
 WHERE kind = 'inference' AND status IN ('active','promoted') AND instr(based_on_json, ?) > 0`

// activate competitors SQL, retaining existing NOT condition and ordering
`SELECT * FROM nodes
 WHERE (status = 'active' OR (kind = 'inference' AND status = 'promoted'))
   AND NOT (kind = 'progress' AND task_id IS NOT NULL)
 ORDER BY updated_at DESC`
~~~

- [ ] 运行核心和适配完整测试，预期PASS；不提高confidence，不把promoted类型改成observation。显式subject覆盖暂保持保守contradicted，这是schema1兼容规则，P2再区分needs_review。相同**显式subject**重验仍需P1单独处理，不宣称全修。
- [ ] 提交fix: recall promoted conclusions without bypassing invalidation。

## Task 3: GC保护存活记忆的传递证据闭包

**Files:** 修改[store.gc](../../../plugins/memory-net/src/store.ts#L557-L619)，向上一个核心测试文件追加测试。

- [ ] 追加以下完整用例，旧基线GC将删除promoted引用的已demoted证据，预期FAIL：

~~~ts
test('GC keeps transitive based-on and promotion evidence for live conclusions', () => {
  const ws=makeTempWs('mn-p0-gc-')
  const net=MemoryNet.open(ws,{agentId:'fixture-host',role:'host'})
  try {
    const a=net.add('observation',{text:'underlying A',source:'tool'})
    const b=net.add('inference',{text:'derived B',confidence:.7,based_on:[a.id]})
    const c=net.add('inference',{text:'reviewed C',confidence:.8,based_on:[b.id]})
    const extra=net.add('observation',{text:'review evidence',source:'tool'})
    const unused=net.add('tip',{text:'unreferenced obsolete tip'})
    net.promote(c.id,{evidence:[extra.id]})
    net.demote(a.id);net.demote(b.id);net.demote(extra.id);net.demote(unused.id)
    net.gc({purge:true})
    for(const n of [a,b,c,extra])assert.ok(net.get(n.id),n.id)
    assert.equal(net.get(unused.id),null)
    net.link(b.id,c.id) // cycle is tolerated by visited set, not traversed forever
    net.gc({purge:true})
    for(const n of [a,b,c,extra])assert.ok(net.get(n.id))
  } finally {net.close();cleanupDir(ws)}
})
~~~

- [ ] 将现有gc实现改名private gcWithinTransaction(opts?: GcOpts): GcReport，在同位置加入public wrapper；原函数内部其它行为不变：

~~~ts
  gc(opts?: GcOpts): GcReport {
    return this.txn(() => this.gcWithinTransaction(opts))
  }
~~~

- [ ] 在purge分支中用以下完整代码替换protectedIds/infRows初始计算，后面的dead查询与del遍历不变。事务内加载rows一次，循环不会在引用环里无限运行；所有live节点作根，保留based_on及生命周期payload依据。缺失旧引用不补造节点；本阶段GC只保守跳过无法遍历的引用，不宣称已实现缺引用诊断接口。P1导入/读取时再加入结构化诊断。

~~~ts
      const rows=this.db.prepare('SELECT * FROM nodes').all() as unknown as NodeRow[]
      const byId=new Map(rows.map(r=>[r.id,rowToNode(r)]))
      const protectedIds=new Set<string>()
      const queue=rows.filter(r=>r.status==='active'||r.status==='promoted').map(r=>r.id)
      while(queue.length){
        const id=queue.pop()!
        if(protectedIds.has(id))continue
        protectedIds.add(id)
        const node=byId.get(id)
        if(!node)continue
        const edges=[...node.based_on]
        for(const key of ['promote_evidence','contradict_evidence']){
          const value=node.payload[key]
          if(Array.isArray(value))for(const dep of value)if(typeof dep==='string')edges.push(dep)
        }
        for(const dep of edges)if(!protectedIds.has(dep))queue.push(dep)
      }
~~~

- [ ] 更新gc注释：保护存活节点的传递证据及promotion依据，不再只保护active inference直接边。不能同时开启默认purge、默认TTL或剪枝账本；trail原编号问题仍在P1范围。
- [ ] 在核心测试文件imports中加入以下两行，然后追加完整回滚测试。只在该测试创建的临时库安装trigger；旧实现会先重编号trail、后DELETE被拒绝，因此断言FAIL，新txn包裹应PASS。不要在用户库安装trigger。

~~~ts
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
~~~

~~~ts
test('GC failure rolls back prior trail compression and node changes', () => {
  const ws=makeTempWs('mn-p0-gc-atomic-')
  const net=MemoryNet.open(ws,{agentId:'fixture-host',role:'host'})
  const db=new DatabaseSync(join(ws,'memory.db'))
  try {
    const obsolete=net.add('tip',{text:'obsolete'})
    net.demote(obsolete.id)
    for(let i=1;i<=8;i++)net.appendTrail('run',{action:'step-'+i})
    const before=net.exportPkg()
    db.exec("CREATE TRIGGER fail_gc_delete BEFORE DELETE ON nodes BEGIN SELECT RAISE(ABORT,'fixture gc failure'); END;")
    assert.throws(()=>net.gc({trail_keep:4,purge:true}),/fixture gc failure/)
    const after=net.exportPkg()
    assert.deepEqual(after.trail,before.trail)
    assert.deepEqual(after.nodes,before.nodes)
  } finally {db.exec('DROP TRIGGER IF EXISTS fail_gc_delete');db.close();net.close();cleanupDir(ws)}
})
~~~
- [ ] 在新测试文件追加导出/导入闭包检查，以下代码是完整可执行用例：

~~~ts
test('protected evidence survives package roundtrip', () => {
  const source=makeTempWs('mn-p0-export-'),target=makeTempWs('mn-p0-import-')
  const net=MemoryNet.open(source,{agentId:'fixture-host',role:'host'})
  let reopened: MemoryNet | undefined
  try {
    const a=net.add('observation',{text:'A',source:'tool'})
    const d=net.add('inference',{text:'decision',confidence:.9,based_on:[a.id]})
    net.promote(d.id,{evidence:[a.id]});net.demote(a.id);net.gc({purge:true})
    reopened=MemoryNet.importPkg(net.exportPkg(),target,{agentId:'fixture-reader',role:'host'})
    assert.equal(reopened.get(d.id)!.based_on[0],a.id)
    assert.equal(reopened.get(a.id)!.text,'A')
    assert.ok(reopened.activate('decision').nodes.some(r=>r.node.id===d.id))
  } finally {reopened?.close();net.close();cleanupDir(source);cleanupDir(target)}
})
~~~

- [ ] 提交fix: protect referenced memory evidence during GC。

## Task 4: 独立验收、文档与采用门槛

**Files:** 修改[核心说明](../../../plugins/memory-net/README.md)、[适配说明](../../../plugins/memory-net/adapters/dsh/README.md)、[兼容登记](../../../catalog/runtime/dsh-compatibility.json)，新增catalog/audit/memory-provenance-p0.json。无需修改用户profile或本轮设计probe断言来制造成功。

- [ ] 文档明确：auto-observe变为追加调用，会增加数据；subject key只有宿主显式设定才覆盖；promoted能召回但仍是推断。GC闭包不等于完整历史存档，进度/trail/代码状态尚未版本化。
- [ ] 运行根node --test asset-manager/tests/*.test.mjs及node asset-manager/cli.mjs validate；核心及适配分别在包目录完整运行测试。所有原测试+本计划新增测试应PASS；实际计数记录，不预设数量。原8项基线probe描述旧行为，P0后不能继续称它PASS：保留旧证据并用新用例证明哪些已修，不删除旧复现。
- [ ] 从新worktree用固定依赖构建新dist后check-dsh应NEEDS_ACCEPTANCE，这是预期状态。用HUB_DSH_INSTALLATION分别指向已安装rc.1与独立rc.5，node asset-manager/probe-dsh-host.mjs，测试HOME/DSH_HOME隔离且本地模拟模型；HUB_DSH_TUN_FETCH不设置，避免默认出网。实际节点key断言由payload.tool/memory node关系核验，不仅字符串成功回显。
- [ ] 报告记录具体源码哈希、版本、实际测试数、rollback原件保护、promoted回流/证据闭包、追加观测增长限制；缺任何必需证据不写PASS。历史兼容记录只追加，旧指纹不能审批新代码。
- [ ] 独立提交副本重新构建/测试/验证import及两版宿主，PR #3已合并，后续实现新建一个审核PR并在该PR内复用批次；用户确认后才生成新运行包及迁移新实验库。**当前Web留在旧已验收包，本计划不自动采用。**

## 自审清单

- [ ] P0三个行为可对应新测试和具体代码，red/green实际运行；两版宿主与独立副本确认。
- [ ] schema1不变，操作历史/不可变revision没有被虚假写成完成；scope/隐私/噪音风险明确。
- [ ] provenance身份P2再加；不会序列化parent Symbol或把call_id当全球唯一。
- [ ] 不照搬Delta二进制DDL/CRDT，不创建子代理、不改真实库、模型/Clash或运行Web配置。

建议P0验收后另写P1完整实施计划：新schema2侧库的operation/revision/head原子性、CAS和引用闭包；再P2会话/代码绑定与P3精选召回。该次序不是授权现在执行迁移。
