import test from 'node:test'
import assert from 'node:assert/strict'
import {MemoryNet} from '../src/store.js'
import {DatabaseSync} from 'node:sqlite'
import {join} from 'node:path'
import {makeTempWs,cleanupDir} from './helpers.js'
const fixture=(t:any)=>{const dir=makeTempWs('mn-candidate-'),net=MemoryNet.open(dir,{role:'host'});t.after(()=>{net.close();cleanupDir(dir)});return {dir,net:net as any}}
const selected=(net:any,q='candidate')=>net.activate(q,{view:'curated',run_id:'A'}).nodes.map((x:any)=>x.node.id)
test('proposal cites events idempotently, preserves source and stays out of curated until host review',t=>{
 const {net}=fixture(t),source=net.add('observation',{text:'event proof',source:'tool',run_id:'A',payload:{tool:'read',call_id:'one'}})
 const before=net.get(source.id),input={text:'candidate decision',confidence:.8,source_ids:[source.id],run_id:'A'}
 const candidate=net.proposeCandidate(input);assert.equal(candidate.kind,'inference');assert.deepEqual(candidate.based_on,[source.id]);assert.equal(candidate.payload.memory_candidate.state,'pending')
 assert.equal(net.proposeCandidate(input).id,candidate.id);assert.deepEqual(net.get(source.id),before);assert.ok(!selected(net).includes(candidate.id));assert.equal(net.candidates({run_id:'A'}).length,1)
 const evidence=net.add('observation',{text:'separate verification',source:'tool',run_id:'A',payload:{tool:'verify',call_id:'two'}})
 const request={expected_fingerprint:candidate.payload.memory_candidate.fingerprint,decision:'accept',reviewer:'fixture-host',note:'review recorded, not truth oracle',evidence:[evidence.id]}
 const accepted=net.reviewCandidate(candidate.id,request);assert.equal(accepted.status,'promoted');assert.ok(selected(net).includes(candidate.id));assert.equal(net.reviewCandidate(candidate.id,request).id,candidate.id)
 assert.throws(()=>net.reviewCandidate(candidate.id,{...request,decision:'reject'}),/review|terminal|conflict/i)
 assert.deepEqual(net.get(source.id),before);net.demote(evidence.id);assert.ok(!selected(net).includes(candidate.id));net.gc({purge:true});assert.ok(net.get(evidence.id));assert.ok(net.get(source.id))
})
test('proposal and review reject missing stale foreign evidence and invalid controls atomically',t=>{
 const {net}=fixture(t),source=net.add('observation',{text:'source',source:'tool',run_id:'A'}),foreign=net.add('observation',{text:'foreign',source:'tool',run_id:'B'})
 for(const patch of [{source_ids:[]},{source_ids:['missing']},{source_ids:[foreign.id]},{confidence:NaN},{text:' '},{run_id:''}])assert.throws(()=>net.proposeCandidate({text:'candidate',confidence:.8,source_ids:[source.id],run_id:'A',...patch}))
 const c=net.proposeCandidate({text:'candidate',confidence:.8,source_ids:[source.id],run_id:'A'}),fresh=net.add('observation',{text:'verified',source:'tool',run_id:'A'}),fp=c.payload.memory_candidate.fingerprint
 const input={expected_fingerprint:fp,decision:'accept',reviewer:'fixture',note:'checked',evidence:[fresh.id]}
 const stable=()=>{const {exported_at,...pkg}=net.exportPkg();return pkg};const before=stable()
 for(const patch of [{expected_fingerprint:'old'},{reviewer:''},{note:''},{evidence:[]},{evidence:[source.id]},{evidence:[foreign.id]},{decision:'unknown'}]){assert.throws(()=>net.reviewCandidate(c.id,{...input,...patch}));assert.deepEqual(stable(),before)}
 const failed=net.add('observation',{text:'failed validation',source:'tool',run_id:'A',payload:{is_error:true}});assert.throws(()=>net.reviewCandidate(c.id,{...input,evidence:[failed.id]}))
 net.demote(source.id);assert.throws(()=>net.reviewCandidate(c.id,input),/source|stale|active/i);assert.ok(!selected(net).includes(c.id))
})
test('candidate review is host-only, rejection is durable and generic promotion cannot bypass curation',t=>{
 const {dir,net}=fixture(t),source=net.add('observation',{text:'source',source:'tool',run_id:'A'})
 const c=net.proposeCandidate({text:'candidate',confidence:.8,source_ids:[source.id],run_id:'A'}),e=net.add('observation',{text:'verification',source:'tool',run_id:'A'})
 const request={expected_fingerprint:c.payload.memory_candidate.fingerprint,decision:'reject',reviewer:'fixture',note:'insufficient',evidence:[e.id]}
 const model=MemoryNet.open(dir,{role:'model'}) as any;try{assert.throws(()=>model.reviewCandidate(c.id,request),/host|role|forbidden/i);assert.throws(()=>model.add('inference',{text:'forged',confidence:.9,payload:{memory_candidate:{state:'accepted'}}}),/reserved|candidate/i)}finally{model.close()}
 net.promote(c.id,{evidence:[source.id]});assert.ok(!selected(net).includes(c.id));net.reviewCandidate(c.id,request);assert.equal(net.candidates({run_id:'A'})[0].payload.memory_candidate.state,'rejected');assert.ok(!selected(net).includes(c.id));assert.ok(net.get(source.id))
})

test('candidate insertion/review rollback and damaged receipt fail closed',t=>{
 const {dir,net}=fixture(t),db=new DatabaseSync(join(dir,'memory.db'));try {
 const source=net.add('observation',{text:'source',source:'tool',run_id:'A'}),input={text:'candidate',confidence:.8,source_ids:[source.id],run_id:'A'}
 const stable=()=>{const {exported_at,...pkg}=net.exportPkg();return pkg};const before=stable()
 db.exec("CREATE TRIGGER fixture_insert BEFORE INSERT ON nodes WHEN NEW.kind='inference' BEGIN SELECT RAISE(ABORT,'candidate insert failure'); END;")
 assert.throws(()=>net.proposeCandidate(input),/insert failure/);assert.deepEqual(stable(),before);db.exec('DROP TRIGGER fixture_insert')
 const c=net.proposeCandidate(input),e=net.add('observation',{text:'verification',source:'tool',run_id:'A'}),request={expected_fingerprint:c.payload.memory_candidate.fingerprint,decision:'accept',reviewer:'fixture',note:'separate check',evidence:[e.id]}
 const unchanged=stable();db.exec("CREATE TRIGGER fixture_review BEFORE UPDATE ON nodes WHEN NEW.status='promoted' BEGIN SELECT RAISE(ABORT,'review failure'); END;")
 assert.throws(()=>net.reviewCandidate(c.id,request),/review failure/);assert.deepEqual(stable(),unchanged);db.exec('DROP TRIGGER fixture_review')
 net.reviewCandidate(c.id,request);assert.ok(selected(net).includes(c.id))
 const payload=net.get(c.id).payload;payload.memory_candidate.review.digests={};db.prepare('UPDATE nodes SET payload_json=? WHERE id=?').run(JSON.stringify(payload),c.id);assert.ok(!selected(net).includes(c.id));assert.throws(()=>net.reviewCandidate(c.id,request),/fingerprint/)
 } finally {db.close()}
})

test('candidate receipts survive export import and remain CAS terminal across handles',t=>{
 const {net}=fixture(t),target=makeTempWs('mn-candidate-import-');let reopened:MemoryNet|undefined;
 try {
  const s=net.add('observation',{text:'source',source:'tool',run_id:'A'}),c=net.proposeCandidate({text:'candidate durable',confidence:.8,source_ids:[s.id],run_id:'A'}),e=net.add('observation',{text:'second check',source:'tool',run_id:'A'});
  const request={expected_fingerprint:(c.payload.memory_candidate as any).fingerprint,decision:'accept' as const,reviewer:'fixture',note:'separate verification',evidence:[e.id]};
  net.reviewCandidate(c.id,request);const pkg=net.exportPkg();reopened=MemoryNet.importPkg(pkg,target,{role:'host'});
  assert.ok(selected(reopened).includes(c.id));assert.equal(reopened.proposeCandidate({text:'candidate durable',confidence:.8,source_ids:[s.id],run_id:'A'}).id,c.id);
  assert.throws(()=>reopened!.reviewCandidate(c.id,{...request,decision:'reject'}),/terminal/);
  const {exported_at:_,...before}=pkg,{exported_at:__,...after}=reopened.exportPkg();assert.deepEqual(after,before);
 }finally{reopened?.close();cleanupDir(target)}
})
