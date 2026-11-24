import type {DshCtx,ToolDef} from './contract.js'
import type {MemoryNet} from '../../../src/store.js'
import {candidateMeta,candidateReason} from '../../../src/candidates.js'
import {curatedMatch} from '../../../src/curation.js'
export type CandidateSelection=(args:Record<string,unknown>,exec?:{agent?:unknown;signal?:AbortSignal})=>{net:MemoryNet;run?:string;task?:string;workspace:string}
export function registerCandidateTools(ctx:DshCtx,select:CandidateSelection):void {
 const propose:ToolDef={name:'memory_net_propose',description:'Propose a reusable inference citing current-session observation IDs. Proposal is pending and excluded from curated recall until separate host review; tool success is not truth.',parameters:{type:'object',properties:{text:{type:'string'},confidence:{type:'number',minimum:0,maximum:1},source_ids:{type:'array',items:{type:'string'},minItems:1,maxItems:32}},required:['text','confidence','source_ids'],additionalProperties:false},output:{schema:{type:'object',properties:{id:{type:'string'},state:{type:'string'},fingerprint:{type:'string'}},required:['id','state','fingerprint'],additionalProperties:false},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:(args,exec)=>{
  const s=select(args,exec);if(!s.run)throw new Error('Trusted candidate session required')
  const n=s.net.proposeCandidate({text:args.text as string,confidence:args.confidence as number,source_ids:args.source_ids as string[],run_id:s.run})
  const c=candidateMeta(n)!;return {id:n.id,state:c.state,fingerprint:c.fingerprint}
 }}
 const list:ToolDef={name:'memory_net_candidates',description:'Inspect pending/reviewed candidate summaries and source observation IDs in current session only. This diagnostic list is not curated memory admission or host review.',parameters:{type:'object',properties:{query:{type:'string'},limit:{type:'integer',minimum:1,maximum:20}},additionalProperties:false},output:{schema:{type:'object',properties:{candidates:{type:'array',items:{type:'object',properties:{id:{type:'string'},text:{type:'string'},state:{type:'string'},fingerprint:{type:'string'},source_ids:{type:'array',items:{type:'string'}},eligibility:{type:'string'}},required:['id','text','state','fingerprint','source_ids','eligibility'],additionalProperties:false}},events:{type:'array',items:{type:'object',properties:{id:{type:'string'},text:{type:'string'},status:{type:'string'}},required:['id','text','status'],additionalProperties:false}}},required:['candidates','events'],additionalProperties:false},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:(args,exec)=>{
  const s=select(args,exec),limit=args.limit??10,query=args.query??''
  if(!Number.isInteger(limit)||Number(limit)<1||Number(limit)>20||typeof query!=='string'||query.length>500)throw new Error('Invalid candidate listing query/limit')
  const all=s.net.exportPkg().nodes,match=(n:typeof all[number])=>!query.trim()||curatedMatch(query,n)
  const candidates=s.net.candidates({run_id:s.run,limit:100}).filter(match).slice(0,Number(limit)).map(n=>{const c=candidateMeta(n)!;return {id:n.id,text:n.text.slice(0,500),state:c.state,fingerprint:c.fingerprint,source_ids:n.based_on,eligibility:candidateReason(n,id=>s.net.get(id))??'eligible'}})
  const events=all.filter(n=>n.kind==='observation'&&n.run_id===s.run&&match(n)).reverse().slice(0,Number(limit)).map(n=>({id:n.id,text:n.text.slice(0,500),status:n.status}))
  return {candidates,events}
 }}
 ctx.tools.register(propose);ctx.tools.register(list)
}
