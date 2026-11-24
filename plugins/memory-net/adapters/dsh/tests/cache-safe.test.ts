import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {apply} from '../src/index.js'
function fixture(t:any,contextAvailable=true){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mn-cache-test-')),sections:any[]=[],contexts:any[]=[],tools:any[]=[],agent={id:'A',session:{id:'A',header:{id:'A'}}};
 const ctx:any={provide:()=>{},agents:{get:()=>agent},workingDirectory:{get:()=>root},logger:{warn:()=>{}},tools:{register:(t:any)=>tools.push(t)},systemPrompt:{section:(s:any)=>sections.push(s),...(contextAvailable?{context:(c:any)=>contexts.push(c)}:{})}}
 const api=apply(ctx,{workspaces_root:path.join(root,'memory')}) as any;t.after(()=>{api.close();fs.rmSync(root,{recursive:true,force:true})})
 const assembly={agent,scope:agent},render=(v:any)=>typeof v.text==='function'?v.text(assembly):v.text
 return {api,host:api.forAgent(agent),agent,sections,contexts,tools,render,system:()=>sections.map(render).join(' '),context:()=>contexts.map(render).join(' ')}
}
test('memory and statistics never enter system prefix; counter-only changes are byte stable',t=>{
 const f=fixture(t),system=f.system();f.host.addTip({text:'DURABLE {{.Names}} {{unknown}} SQLite tip'})
 assert.equal(f.system(),system);assert.ok(!system.includes('DURABLE'));assert.equal(f.contexts.length,1);assert.equal(f.contexts[0].interpolate,false);assert.equal(f.contexts[0].required,true)
 const snapshot=f.context();assert.ok(snapshot.includes('DURABLE {{.Names}} {{unknown}}'));assert.ok(!snapshot.includes('[精选]'));assert.ok(!snapshot.includes('tokens'))
 for(let i=0;i<20;i++)f.host.observe({key:'call-'+i,text:'verbose log',payload:{tool:'read'},source:'tool'})
 assert.equal(f.system(),system);assert.equal(f.context(),snapshot)
 const recall=f.tools.find(t=>t.name==='memory_net_recall').execute({}, {agent:f.agent});assert.ok(recall.text.includes('排除 20'));
 f.host.addTip({text:'NEW tip'});assert.notEqual(f.context(),snapshot);assert.equal(f.system(),system)
})
test('source invalidation retracts candidate through explicit current snapshot, not frozen cache',t=>{
 const f=fixture(t),s=f.host.observe({key:'status',text:'before'}),c=f.host.proposeCandidate({text:'ACCEPTED-CANDIDATE',confidence:.8,source_ids:[s.id]}),e=f.host.observe({key:'check',text:'second observation'});f.host.reviewCandidate(c.id,{expected_fingerprint:(c.payload as any).memory_candidate.fingerprint,decision:'accept',reviewer:'fixture',note:'checked',evidence:[e.id]});const system=f.system();assert.ok(f.context().includes('ACCEPTED-CANDIDATE'))
 f.host.observe({key:'status',text:'after'});assert.ok(!f.context().includes('ACCEPTED-CANDIDATE'));assert.match(f.context(),/supersedes previous/);f.host.demote(e.id);const active=f.host.exportPkg().nodes.filter((n:any)=>n.kind==='observation'&&n.status==='active');for(const n of active)f.host.demote(n.id);assert.match(f.context(),/none|无可用/);assert.equal(f.system(),system)
})
test('runtime context revalidates scope and lifecycle and never templates unavailable data',t=>{
 const f=fixture(t);f.host.addTip({text:'PRIVATE-A {{missing}}'});assert.ok(f.context().includes('PRIVATE-A'));
 const definition=f.contexts[0],copy={...f.agent};assert.match(definition.text({agent:copy,scope:copy}),/unavailable/);
 assert.ok(!definition.text({agent:copy,scope:copy}).includes('PRIVATE-A'));assert.match(definition.text({agent:f.agent,scope:copy}),/unavailable/);
 f.api.close();assert.match(f.context(),/unavailable/);assert.ok(!f.context().includes('PRIVATE-A'));
})
test('missing runtime context API never falls back to dynamic system memory',t=>{
 const f=fixture(t,false),system=f.system();f.host.addTip({text:'DO-NOT-INJECT-SYSTEM'});assert.equal(f.system(),system);assert.ok(!system.includes('DO-NOT-INJECT'));assert.equal(f.contexts.length,0);assert.ok(f.tools.find(t=>t.name==='memory_net_recall'))
})
