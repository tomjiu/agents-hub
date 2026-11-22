import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {MemoryNet} from '../plugins/memory-net/dist/src/store.js';
import {sha256} from './core/files.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const reportPath=process.argv[2];
if(!reportPath)throw new Error('Explicit reviewed report path required; this probe does not write the report or invent conclusions');
const report=await fs.readFile(path.resolve(reportPath),'utf8');
const statements=[
 {text:'Node 26.13.1: DatabaseSync is a deprecated alias for Database; both APIs are synchronous.',url:'https://nodejs.org/docs/v26.13.1/api/sqlite.html'},
 {text:'SQLite WAL allows only one writer at a time and requires the same host; it does not work over a network filesystem.',url:'https://www.sqlite.org/wal.html'}
];
for(const statement of statements){assert.ok(report.includes(statement.url),'Report must cite the reviewed official source');assert.ok(report.includes(statement.text),'Report must explicitly contain the statement stored as reviewed evidence');}
const work=await fs.mkdtemp(path.join(os.tmpdir(),'hub-research-memory-'));let host,model;
try{
 host=MemoryNet.open(work,{agentId:'research-evidence',role:'tool',workspaceId:'sqlite-research'});
 const evidence=statements.map(statement=>host.add('observation',{text:statement.text,key:statement.url,source:'tool',payload:{url:statement.url,source_reader:'Harness web_fetch; separate from failed Search-core fetch',report_sha256:sha256(report)}}));
 model=MemoryNet.open(work,{agentId:'research-author',role:'model',workspaceId:'sqlite-research'});
 assert.throws(()=>model.add('observation',{text:'unverified model claim'}),'Model cannot write evidence observations');
 const conclusion=model.add('inference',{text:'Memory-net SQLite task-memory recommendation: retain local workspace SQLite for bounded agent tasks; keep explicit close/reopen and WAL write serialization, migrate the Node 26 DatabaseSync alias through a separately tested compatibility change, and do not call recall semantic/vector search.',confidence:0.85,based_on:evidence.map(node=>node.id),task_id:'sqlite-decision',run_id:'real-research'});
 const first=model.activate('Memory-net SQLite task-memory recommendation',{task_id:'sqlite-decision',run_id:'real-research',budgets:{max_nodes:8,max_tokens:1600}});
 assert.ok(first.nodes.some(row=>row.node.id===conclusion.id));
 assert.equal(model.get(conclusion.id).kind,'inference');assert.equal(model.get(conclusion.id).status,'active');
 model.close();model=null;host.close();host=null;
 const modulePath=path.join(root,'plugins/memory-net/dist/src/store.js');
 const script="import {MemoryNet} from "+JSON.stringify(pathToFileURL(modulePath).href)+";const n=MemoryNet.open(process.argv[1],{role:'model',agentId:'reopened-reader',workspaceId:'sqlite-research'});try{const r=n.activate('Memory-net SQLite task-memory recommendation',{budgets:{max_nodes:8,max_tokens:1600}});console.log(JSON.stringify(r));}finally{n.close();}";
 const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'])if(process.env[key])env[key]=process.env[key];
 const child=spawnSync(process.execPath,['--input-type=module','-e',script,work],{env,encoding:'utf8',timeout:10000,maxBuffer:1024*1024});if(child.error)throw child.error;assert.equal(child.status,0,child.stderr);const reopened=JSON.parse(child.stdout);
 const recalled=reopened.nodes.find(row=>row.node.id===conclusion.id);assert.ok(recalled,'A new process must recall the written conclusion');assert.equal(recalled.node.kind,'inference');assert.equal(recalled.node.status,'active');assert.deepEqual(recalled.node.based_on,evidence.map(node=>node.id));assert.equal(recalled.node.text,conclusion.text);assert.equal(recalled.node.confidence,conclusion.confidence);
 const outcome={schema:1,status:'PASS_FOR_THIS_RESEARCH_TASK',scripted_model:false,live_user_profile_changed:false,report_sha256:sha256(report),evidence_urls:statements.map(s=>s.url),stored_inference:{id:conclusion.id,kind:conclusion.kind,status:conclusion.status,confidence:conclusion.confidence,based_on:conclusion.based_on,text:conclusion.text},readback:{separate_process:true,close_reopen:true,recalled:true,tokens_used:reopened.tokens_used,budgets:reopened.budgets},scope:'Lead wrote and reviewed the actual cited research report. The statements are replay inputs drawn from the Lead-reviewed report, not fresh network observations verified by this probe. They and the recommendation were stored/recalled by real MemoryNet in a temporary SQLite workspace; not a free-running model or full semantic RAG quality benchmark.'};
 await fs.mkdir(path.join(root,'.asset-state/evidence'),{recursive:true});await fs.writeFile(path.join(root,'.asset-state/evidence/real-research-memory.json'),JSON.stringify(outcome,null,2)+String.fromCharCode(10));console.log(JSON.stringify(outcome,null,2));
}finally{model?.close();host?.close();await fs.rm(work,{recursive:true,force:true});}
