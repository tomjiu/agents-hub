import fs from 'node:fs'
export const name='mn-session-fixture'
export const inject=['tools','memory-net']
export function apply(ctx) {
 if(process.env.MN_CONTEXT_CANDIDATES==='1')ctx.tools.register({name:'mn_candidate_verify',description:'Synthetic host review fixture; not a real user approval',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object',properties:{reviewed:{type:'boolean'}},required:['reviewed'],additionalProperties:false},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:(_args,exec)=>{
  const api=ctx['memory-net'].forAgent(exec.agent),candidate=api.candidates({status:'pending'})[0]
  if(!candidate)throw new Error('No proposed candidate')
  const evidence=api.observe({key:'fixture-validation',text:'Fixture validator separately checked SQLite choice',source:'tool',payload:{fixture:true}})
  api.reviewCandidate(candidate.id,{expected_fingerprint:candidate.payload.memory_candidate.fingerprint,decision:'accept',reviewer:'fixture-host-validator',note:'Synthetic review receipt, not semantic truth oracle',evidence:[evidence.id]})
  return {reviewed:true}
 }})
 if(process.env.MN_CONTEXT_CACHE==='1')ctx.tools.register({name:'mn_memory_clear',description:'Synthetic current memory empty snapshot fixture',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object',properties:{cleared:{type:'boolean'}},required:['cleared'],additionalProperties:false},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:(_args,exec)=>{
  const api=ctx['memory-net'].forAgent(exec.agent);for(const n of api.exportPkg().nodes)if(n.status==='active'||n.status==='promoted')api.demote(n.id);return {cleared:true}
 }})
 if(process.env.MN_CONTEXT_CACHE==='1')ctx.tools.register({name:'mn_candidate_invalidate',description:'Synthetic evidence invalidation fixture',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object',properties:{invalidated:{type:'boolean'}},required:['invalidated'],additionalProperties:false},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:(_args,exec)=>{
  const api=ctx['memory-net'].forAgent(exec.agent),candidate=api.candidates({status:'accepted'})[0];if(!candidate)throw new Error('No accepted candidate');api.demote(candidate.based_on[0],{reason:'Synthetic stale source'});return {invalidated:true}
 }})
 ctx.tools.register({name:'mn_context_seed',description:'Isolated fixture: seed current host-bound session memory',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object',properties:{seeded:{type:'boolean'}},required:['seeded'],additionalProperties:false},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:(_args,exec)=>{
  const api=ctx['memory-net'].forAgent(exec.agent)
  const text='SESSION-PRIVATE-'+process.env.MN_CONTEXT_LABEL
  api.addTip({text:text+' {{.Names}} {{unknown}}'});api.updateProgress(exec.agent.id,{summary:text+' progress'})
  const pkg=api.exportPkg()
  fs.writeFileSync(process.env.MN_CONTEXT_REPORT,JSON.stringify({session:exec.agent.id,dir:api.workspaceDir,tip:text,nodes:pkg.nodes.length}))
  return {seeded:true}
 }})
 ctx.tools.register({name:'mn_context_echo',description:'Fixture automatic observation',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object',properties:{echoed:{type:'string'}},required:['echoed'],additionalProperties:false},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:()=>({echoed:'AUTO-PRIVATE-'+process.env.MN_CONTEXT_LABEL})})
}
