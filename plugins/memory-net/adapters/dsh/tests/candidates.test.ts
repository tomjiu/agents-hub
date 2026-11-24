import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {apply} from '../src/index.js'
function fixture(t:any){const root=fs.mkdtempSync(path.join(os.tmpdir(),'mn-proposal-adapter-')),tools:any[]=[],sections:any[]=[],agent={id:'A',session:{id:'A',header:{id:'A'}}},other={id:'B',session:{id:'B',header:{id:'B'}}},ctx:any={provide:()=>{},agents:{get:(id:string)=>id==='A'?agent:other},workingDirectory:{get:()=>root},tools:{register:(d:any)=>tools.push(d)},systemPrompt:{section:(d:any)=>sections.push(d)},logger:{warn:()=>{}}};const api=apply(ctx,{workspaces_root:path.join(root,'memory')}) as any;t.after(()=>{api.close();fs.rmSync(root,{recursive:true,force:true})});return {root,api,agent,other,tools,sections,host:api.forAgent(agent),call:(name:string,args:any,a:any=agent)=>tools.find(t=>t.name===name).execute(args,{agent:a})}}
test('scoped event source to model proposal to host review to curated prompt',t=>{
 const f=fixture(t),source=f.host.observe({key:'source',text:'SQLite WAL observed',source:'tool'});
 assert.ok(f.tools.find(t=>t.name==='memory_net_propose'));assert.ok(!f.tools.some(t=>t.name==='memory_net_review'));
 assert.ok(f.call('memory_net_candidates',{}).events.some((e:any)=>e.id===source.id));
 const c=f.call('memory_net_propose',{text:'SQLite WAL selected',confidence:.8,source_ids:[source.id]});
 assert.equal(c.state,'pending');const pending=f.call('memory_net_recall',{query:'SQLite'}).text;assert.ok(!pending.includes('SQLite WAL selected'));
 const listed=f.call('memory_net_candidates',{});assert.equal(listed.candidates[0].id,c.id);assert.equal(f.call('memory_net_candidates',{},f.other).candidates.length,0);
 assert.throws(()=>f.call('memory_net_propose',{text:'foreign',confidence:.8,source_ids:[source.id]},f.other));
 const verification=f.host.observe({key:'check',text:'SQLite WAL validated separately',source:'tool'});f.host.reviewCandidate(c.id,{expected_fingerprint:c.fingerprint,decision:'accept',reviewer:'fixture',note:'checked separately',evidence:[verification.id]});
 const r=f.call('memory_net_recall',{query:'SQLite'}).text;assert.ok(r.includes('SQLite WAL selected'));assert.ok(r.includes('候选·已核验'));assert.ok(r.includes(source.id)&&r.includes(verification.id));
 const prompt=f.sections[0].text({agent:f.agent,scope:f.agent});assert.ok(prompt.includes('SQLite WAL selected'));
 assert.throws(()=>f.call('memory_net_write',{kind:'inference',text:'uncited inference',confidence:.9}));
 assert.equal(f.call('memory_net_write',{kind:'inference',text:'SQLite WAL via compatibility tool',confidence:.8,based_on:[source.id]}).kind,'inference');
 assert.throws(()=>f.call('memory_net_propose',{text:'forged scope',confidence:.8,source_ids:[source.id],workspace:'main'}));
})
