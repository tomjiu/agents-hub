import {createServer} from 'node:http'
import fs from 'node:fs'
const phase=Number(process.env.MN_RESUME_PHASE||'1'),diag=process.env.MN_RESUME_DIAG
if(!diag)throw new Error('MN_RESUME_DIAG required')
const call=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}})
createServer((req,res)=>{
 let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  let j;try{j=JSON.parse(body)}catch{res.writeHead(400).end();return}
  const messages=j.messages||[],has=id=>messages.some(m=>m.role==='tool'&&m.tool_call_id===id)
  const result=id=>{const m=messages.find(m=>m.role==='tool'&&m.tool_call_id===id);return m?JSON.stringify(m.content):''}
  const row={phase,tool_results:messages.filter(m=>m.role==='tool').map(m=>({id:m.tool_call_id,content:m.content}))}
  let calls=[],content=null
  if(phase===1){
   if(!has('echo'))calls=[call('echo','mn_resume_echo',{})]
   else if(!has('write'))calls=[call('write','memory_net_write',{kind:'tip',text:'RESUME-MARK-1'})]
   else if(!has('recall'))calls=[call('recall','memory_net_recall',{query:'RESUME'})]
   else {row.write_ok=result('write').includes('memory saved');row.recall_in_process=result('recall').includes('RESUME-MARK-1');content='MN-RESUME-OK-1'}
  } else {
   if(!has('recall-first'))calls=[call('recall-first','memory_net_recall',{query:'RESUME'})]
   else if(!has('raw'))calls=[call('raw','memory_net_recall',{view:'raw'})]
   else if(!has('write2'))calls=[call('write2','memory_net_write',{kind:'tip',text:'RESUME-MARK-2'})]
   else {row.recall_first_has_mark1=result('recall-first').includes('RESUME-MARK-1');row.raw_has_obs1=result('raw').includes('AUTO-RESUME-OBS-1');row.write2_ok=result('write2').includes('memory saved');content='MN-RESUME-OK-2'}
  }
  fs.appendFileSync(diag,JSON.stringify(row)+String.fromCharCode(10))
  if(j.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});const chunk=(delta,reason)=>res.write('data: '+JSON.stringify({id:'resume',object:'chat.completion.chunk',created:0,model:'mock-flash',choices:[{index:0,delta,finish_reason:reason}]})+String.fromCharCode(10,10));chunk({role:'assistant',content:''},null);if(calls.length)chunk({tool_calls:calls.map((x,index)=>({index,...x}))},null);else chunk({content},null);chunk({},calls.length?'tool_calls':'stop');res.end('data: [DONE]'+String.fromCharCode(10,10));}
  else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'resume',object:'chat.completion',created:0,model:'mock-flash',choices:[{index:0,message:{role:'assistant',content,...(calls.length?{tool_calls:calls}:{})},finish_reason:calls.length?'tool_calls':'stop'}]}))}
 })
}).listen(Number(process.argv[2]),'127.0.0.1',()=>console.error('ready'))
