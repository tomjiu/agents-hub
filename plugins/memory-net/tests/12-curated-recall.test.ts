import test from 'node:test'
import assert from 'node:assert/strict'
import {MemoryNet} from '../src/store.js'
import {nodeTokens,estimateTokens} from '../src/activate.js'
import {makeTempWs,cleanupDir} from './helpers.js'
function fixture(t:any){const ws=makeTempWs('mn-curated-'),net=MemoryNet.open(ws,{role:'host'});t.after(()=>{net.close();cleanupDir(ws)});return net}
const ids=(r:any)=>r.nodes.map((x:any)=>x.node.id)
const stable=(n:MemoryNet)=>{const {exported_at,...pkg}=n.exportPkg();return pkg}
test('recall token budget accounts for dependency and review provenance',t=>{
 const net=fixture(t),e=net.add('observation',{text:'proof',source:'tool'}),d=net.add('inference',{text:'reviewed',confidence:.8})
 net.promote(d.id,{evidence:[e.id]});const node=net.get(d.id)!
 node.based_on=Array.from({length:200},(_,i)=>'dependency-'+i);node.payload.promote_evidence=Array.from({length:200},(_,i)=>'review-'+i)
 assert.ok(nodeTokens(node)>=estimateTokens(node.based_on.join(',')+' '+(node.payload.promote_evidence as string[]).join(',')))
})

test('curation excludes raw logs and unrelated tasks without rewriting storage',t=>{
 const net=fixture(t);const constraint=net.add('constraint',{key:'safe',text:'never delete user memory',payload:{mode:'forbid'}})
 const evidence=net.add('observation',{key:'sqlite:wal',text:'SQLite WAL enabled',source:'tool'})
 const tip=net.add('tip',{text:'SQLite WAL bounded writer retries'})
 const decision=net.add('inference',{text:'SQLite WAL selected',confidence:.8,based_on:[evidence.id]});net.promote(decision.id,{evidence:[evidence.id]})
 const unrelated=net.add('tip',{text:'pasta recipes'});const taskB=net.add('tip',{text:'SQLite WAL for B',task_id:'B'})
 const progress=net.updateProgress('A',{summary:'current work'});const otherProgress=net.updateProgress('B',{summary:'unrelated work'})
 const logs=Array.from({length:30},()=>net.add('observation',{text:'SQLite WAL run_code verbose log',source:'tool',payload:{tool:'run_code'}}))
 const before=stable(net),r=net.activate('SQLite WAL',{view:'curated',task_id:'A',budgets:{max_nodes:12,max_tokens:1000}} as any)
 for(const n of [constraint,progress,tip,decision,evidence])assert.ok(ids(r).includes(n.id),n.text)
 for(const n of [...logs,unrelated,taskB,otherProgress])assert.ok(!ids(r).includes(n.id),n.text)
 assert.equal((r as any).curation.reasons.auto_observation,30);assert.deepEqual(stable(net),before)
 assert.ok(ids(net.activate('',{budgets:{max_nodes:100,max_tokens:20000}})).includes(logs[0]!.id))
})
test('empty curated prompt keeps durable unscoped material not every task or unreviewed inference',t=>{
 const net=fixture(t),tip=net.add('tip',{text:'durable tip'}),inference=net.add('inference',{text:'unverified guess',confidence:.9})
 const task=net.add('tip',{text:'other task private context',task_id:'B'});const progress=net.updateProgress('B',{summary:'work'})
 const reviewed=net.add('inference',{text:'reviewed decision',confidence:.8});net.promote(reviewed.id,{by:'user'})
 const r=net.activate('',{view:'curated'} as any);assert.ok(ids(r).includes(tip.id));assert.ok(ids(r).includes(reviewed.id))
 for(const n of [inference,task,progress])assert.ok(!ids(r).includes(n.id))
 const missing=net.activate('unmatched subject',{view:'curated'} as any);assert.equal(missing.nodes.length,0)
 assert.throws(()=>net.activate('',{view:'invalid'} as any),/view/)
})
test('curation respects run context and inactive conclusions while preserving referenced evidence',t=>{
 const net=fixture(t),a=net.add('tip',{text:'中文记忆',run_id:'A'}),b=net.add('tip',{text:'中文记忆',run_id:'B'})
 const e=net.add('observation',{text:'raw proof',source:'tool',payload:{tool:'read'}})
 const d=net.add('inference',{text:'中文记忆结论',confidence:.8,run_id:'A',based_on:[e.id]});net.promote(d.id,{evidence:[e.id]})
 const r=net.activate('中文记忆',{view:'curated',run_id:'A'} as any);assert.ok(ids(r).includes(a.id));assert.ok(!ids(r).includes(b.id));assert.ok(ids(r).includes(d.id));assert.ok(!ids(r).includes(e.id));assert.ok(net.get(e.id))
 net.contradict(d.id,{note:'new review'});assert.ok(!ids(net.activate('中文记忆',{view:'curated',run_id:'A'} as any)).includes(d.id))
})
