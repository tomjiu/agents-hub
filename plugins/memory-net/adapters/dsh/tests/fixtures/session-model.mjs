import {createServer} from 'node:http'
import fs from 'node:fs'
const label=process.env.MN_CONTEXT_LABEL,foreign=['A','B','C'].filter(x=>x!==label),diag=process.env.MN_CONTEXT_DIAG
const call=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}})
const flatten=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(flatten):[]
createServer((req,res)=>{
 let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  let j;try{j=JSON.parse(body)}catch{res.writeHead(400).end();return}
  const messages=j.messages||[],text=JSON.stringify(messages),has=id=>messages.some(m=>m.role==='tool'&&m.tool_call_id===id)
  const prompt=flatten(messages.filter(m=>m.role==='system'||m.role==='developer')).join(String.fromCharCode(10))
  const rows={label,private_prompt:prompt.includes('SESSION-PRIVATE-'+label),progress_prompt:prompt.includes('SESSION-PRIVATE-'+label+' progress'),foreign_leak:foreign.some(x=>text.includes('SESSION-PRIVATE-'+x)||text.includes('AUTO-PRIVATE-'+x)),raw_result:messages.some(m=>m.role==='tool'&&m.tool_call_id==='raw'&&JSON.stringify(m.content).includes('AUTO-PRIVATE-'+label)),curated_result:messages.some(m=>m.role==='tool'&&m.tool_call_id==='recall'&&JSON.stringify(m.content).includes('SESSION-PRIVATE-'+label)&&!JSON.stringify(m.content).includes('AUTO-PRIVATE-'+label)),selector_refused:messages.some(m=>m.role==='tool'&&m.tool_call_id==='forged'&&/selectors forbidden|additional property|additionalProperties|not allowed/.test(JSON.stringify(m.content))),raw_prompt_leak:prompt.includes('AUTO-PRIVATE-'+label)}
  rows.model_write=messages.some(m=>m.role==='tool'&&m.tool_call_id==='write'&&JSON.stringify(m.content).includes('memory saved'))
  rows.tool_results=messages.filter(m=>m.role==='tool').map(m=>({id:m.tool_call_id,content:m.content}))
  fs.appendFileSync(diag,JSON.stringify(rows)+String.fromCharCode(10))
  let calls=[]
  if(!has('seed'))calls=[call('seed','mn_context_seed',{})]
  else if(!has('write'))calls=[call('write','memory_net_write',{kind:'tip',text:'MODEL-PRIVATE-'+label})]
  else if(!has('echo'))calls=[call('echo','mn_context_echo',{})]
  else if(!has('recall'))calls=[call('recall','memory_net_recall',{query:'SESSION-PRIVATE'})]
  else if(!has('raw'))calls=[call('raw','memory_net_recall',{view:'raw'})]
  else if(!has('forged'))calls=[call('forged','memory_net_recall',{workspace:'main',view:'raw'})]
  const content=calls.length?null:'MN-CONTEXT-OK'
  if(j.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});const chunk=(delta,reason)=>res.write('data: '+JSON.stringify({id:'ctx',object:'chat.completion.chunk',created:0,model:'mock-flash',choices:[{index:0,delta,finish_reason:reason}]})+String.fromCharCode(10,10));chunk({role:'assistant',content:''},null);if(calls.length)chunk({tool_calls:calls.map((x,index)=>({index,...x}))},null);else chunk({content},null);chunk({},calls.length?'tool_calls':'stop');res.end('data: [DONE]'+String.fromCharCode(10,10));}
  else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'ctx',object:'chat.completion',created:0,model:'mock-flash',choices:[{index:0,message:{role:'assistant',content,...(calls.length?{tool_calls:calls}:{})},finish_reason:calls.length?'tool_calls':'stop'}]}))}
 })
}).listen(Number(process.argv[2]),'127.0.0.1',()=>console.error('ready'))
