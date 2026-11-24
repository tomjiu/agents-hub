import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {apply} from '../src/index.js'
import {resolveConfig} from '../src/config.js'
import type {DshCtx,ToolDef,SectionDef} from '../src/contract.js'
import {MemoryNet} from '../../../src/store.js'
test('DSH defaults to curated prompt and recall while explicit raw remains diagnostic',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mn-curated-adapter-')),tools:ToolDef[]=[],sections:SectionDef[]=[]
 const ctx:DshCtx={provide:()=>{},tools:{register:d=>tools.push(d)},systemPrompt:{section:d=>sections.push(d)}}
 const api=apply(ctx,{context:{mode:'shared'},workspaces_root:dir,default_workspace:'main'});assert.ok(api)
 try {
  const storage=MemoryNet.open(join(dir,'main'),{role:'host'})
  try {
   storage.add('observation',{text:'RAW-NOISE SQLite tool payload',source:'tool',payload:{tool:'run_code'}})
   const tip=storage.add('tip',{text:'DURABLE-TIP SQLite writer retries'})
   const d=storage.add('inference',{text:'SQLite reviewed choice',confidence:.8,based_on:[tip.id]});storage.promote(d.id,{evidence:[tip.id]})
   const render=()=>typeof sections[0]!.text==='function'?sections[0]!.text({}):sections[0]!.text
   assert.ok(String(render()).includes('DURABLE-TIP'));assert.ok(!String(render()).includes('RAW-NOISE'))
   const recall=tools.find(t=>t.name==='memory_net_recall')!
   const r=recall.execute({query:'SQLite'}) as {text:string};assert.ok(r.text.includes('DURABLE-TIP'));assert.ok(!r.text.includes('RAW-NOISE'))
   assert.ok(r.text.includes('推断·已审阅'));assert.ok(r.text.includes(d.id));assert.ok(r.text.includes(tip.id))
   assert.ok((recall.execute({query:'SQLite',view:'raw'}) as {text:string}).text.includes('RAW-NOISE'))
   assert.ok(!String(render()).includes('RAW-NOISE'),'raw call cannot change prompt policy')
   assert.throws(()=>recall.execute({view:'invalid'}),/view/)
   const reviewOnly=storage.add('inference',{text:'SQLite review-only',confidence:.8});storage.promote(reviewOnly.id,{evidence:[tip.id]})
   const reviewed=(recall.execute({query:'review-only'}) as {text:string}).text
   assert.ok(reviewed.includes('review_evidence='+tip.id),'promotion-only evidence must be traceable')
   assert.equal(storage.exportPkg().nodes.length,4)
  }finally{storage.close()}
 }finally{api.close();rmSync(dir,{recursive:true,force:true})}
})
test('recall policy configuration fails closed on invalid modes',()=>{
 assert.equal((resolveConfig() as any).recall.view,'curated')
 assert.equal((resolveConfig({recall:{view:'raw'}}) as any).recall.view,'raw')
 assert.throws(()=>resolveConfig({recall:{view:'unrecognized'}}),/view/)
})
