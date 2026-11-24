import {createServer} from 'node:http'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
let previousMessages;let firstSystem;let firstTools;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const label=process.env.MN_CONTEXT_LABEL,foreign=['A','B','C'].filter(x=>x!==label),diag=process.env.MN_CONTEXT_DIAG
const call=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}})
const flatten=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(flatten):[]
createServer((req,res)=>{
 let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  let j;try{j=JSON.parse(body)}catch{res.writeHead(400).end();return}
  const messages=j.messages||[],text=JSON.stringify(messages),has=id=>messages.some(m=>m.role==='tool'&&m.tool_call_id===id)
  const systems=messages.filter(m=>m.role==='system'||m.role==='developer')
  const system=hash(systems),tools=hash(j.tools||[]);firstSystem??=system;firstTools??=tools
  const contexts=messages.filter(m=>m.role==='user'&&JSON.stringify(m.content).includes('Current memory snapshot'))
  const latestContext=contexts.at(-1)
  const prompt=flatten(latestContext?.content??[]).join(String.fromCharCode(10))
  const prefixSame=previousMessages===undefined||JSON.stringify(messages.slice(0,previousMessages.length))===JSON.stringify(previousMessages)
  const hashes=contexts.map(m=>hash(m.content))
  const systemStable=system===firstSystem,toolsStable=tools===firstTools
  previousMessages=structuredClone(messages)
  const rows={label,system_stable:systemStable,tools_stable:toolsStable,messages_prefix_stable:prefixSame,context_count:contexts.length,context_hashes:hashes,system_contains_memory:JSON.stringify(systems).includes('SESSION-PRIVATE'),literal_memory:prompt.includes('{{.Names}} {{unknown}}'),context_has_diagnostics:prompt.includes('[精选]')||prompt.includes(' tokens'),private_prompt:prompt.includes('SESSION-PRIVATE-'+label),progress_prompt:prompt.includes('SESSION-PRIVATE-'+label+' progress'),foreign_leak:foreign.some(x=>text.includes('SESSION-PRIVATE-'+x)||text.includes('AUTO-PRIVATE-'+x)||text.includes('CANDIDATE-PRIVATE-'+x)),raw_result:messages.some(m=>m.role==='tool'&&m.tool_call_id==='raw'&&JSON.stringify(m.content).includes('AUTO-PRIVATE-'+label)),curated_result:messages.some(m=>m.role==='tool'&&m.tool_call_id==='recall'&&JSON.stringify(m.content).includes('SESSION-PRIVATE-'+label)&&!JSON.stringify(m.content).includes('AUTO-PRIVATE-'+label)),selector_refused:messages.some(m=>m.role==='tool'&&m.tool_call_id==='forged'&&/selectors forbidden|additional property|additionalProperties|not allowed/.test(JSON.stringify(m.content))),raw_prompt_leak:prompt.includes('AUTO-PRIVATE-'+label)}
  rows.candidate_pending_excluded=messages.some(m=>m.role==='tool'&&m.tool_call_id==='pending'&&!JSON.stringify(m.content).includes('CANDIDATE-PRIVATE-'+label))
  rows.candidate_accepted_recalled=messages.some(m=>m.role==='tool'&&m.tool_call_id==='accepted'&&JSON.stringify(m.content).includes('CANDIDATE-PRIVATE-'+label))
  rows.candidate_prompt=prompt.includes('CANDIDATE-PRIVATE-'+label)
  rows.candidate_retracted=has('invalidate')&&!prompt.includes('CANDIDATE-PRIVATE-'+label)&&prompt.includes('supersedes previous')
  rows.explicit_retraction_empty=has('clear')&&prompt.includes('none available')&&!prompt.includes('SESSION-PRIVATE-'+label)
  rows.initial_explicit_empty=contexts.length>0&&flatten(contexts[0].content).join(' ').includes('none available')
  rows.model_write=messages.some(m=>m.role==='tool'&&m.tool_call_id==='write'&&JSON.stringify(m.content).includes('memory saved'))
  rows.tool_results=messages.filter(m=>m.role==='tool').map(m=>({id:m.tool_call_id,content:m.content}))
  fs.appendFileSync(diag,JSON.stringify(rows)+String.fromCharCode(10))
  let calls=[]
  if(!has('seed'))calls=[call('seed','mn_context_seed',{})]
  else if(!has('write'))calls=[call('write','memory_net_write',{kind:'tip',text:'MODEL-PRIVATE-'+label})]
  else if(!has('echo'))calls=[call('echo','mn_context_echo',{})]
  else if(process.env.MN_CONTEXT_CACHE==='1'&&!has('echo-again'))calls=[call('echo-again','mn_context_echo',{})]
  else if(!has('recall'))calls=[call('recall','memory_net_recall',{query:'SESSION-PRIVATE'})]
  else if(!has('raw'))calls=[call('raw','memory_net_recall',{view:'raw'})]
  else if(!has('forged'))calls=[call('forged','memory_net_recall',{workspace:'main',view:'raw'})]
  if(process.env.MN_CONTEXT_CANDIDATES==='1' && has('forged')) {
   const result=id=>{const item=messages.find(m=>m.role==='tool'&&m.tool_call_id===id);try{return JSON.parse(item?.content)}catch{return null}}
   if(!has('events'))calls=[call('events','memory_net_candidates',{})]
   else if(!has('propose')){const source=result('events')?.events?.find(e=>e.text.includes('AUTO-PRIVATE-'+label));calls=[call('propose','memory_net_propose',{text:'CANDIDATE-PRIVATE-'+label,confidence:.8,source_ids:[source?.id||'missing']})]}
   else if(!has('pending'))calls=[call('pending','memory_net_recall',{query:'CANDIDATE-PRIVATE'})]
   else if(!has('verify'))calls=[call('verify','mn_candidate_verify',{})]
   else if(!has('accepted'))calls=[call('accepted','memory_net_recall',{query:'CANDIDATE-PRIVATE'})]
   else if(process.env.MN_CONTEXT_CACHE==='1'&&!has('invalidate'))calls=[call('invalidate','mn_candidate_invalidate',{})]
   else if(process.env.MN_CONTEXT_CACHE==='1'&&!has('clear'))calls=[call('clear','mn_memory_clear',{})]
   else calls=[]
  }
  const content=calls.length?null:'MN-CONTEXT-OK'
  if(j.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});const chunk=(delta,reason)=>res.write('data: '+JSON.stringify({id:'ctx',object:'chat.completion.chunk',created:0,model:'mock-flash',choices:[{index:0,delta,finish_reason:reason}]})+String.fromCharCode(10,10));chunk({role:'assistant',content:''},null);if(calls.length)chunk({tool_calls:calls.map((x,index)=>({index,...x}))},null);else chunk({content},null);chunk({},calls.length?'tool_calls':'stop');res.end('data: [DONE]'+String.fromCharCode(10,10));}
  else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'ctx',object:'chat.completion',created:0,model:'mock-flash',choices:[{index:0,message:{role:'assistant',content,...(calls.length?{tool_calls:calls}:{})},finish_reason:calls.length?'tool_calls':'stop'}]}))}
 })
}).listen(Number(process.argv[2]),'127.0.0.1',()=>console.error('ready'))
