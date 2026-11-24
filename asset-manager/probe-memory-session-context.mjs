import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import YAML from 'yaml';
import {dshFingerprint} from './core/dsh-compatibility.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),installation=process.env.HUB_DSH_INSTALLATION;
if(!installation)throw new Error('Explicit installed DSH path required');
const work=await fs.mkdtemp(path.join(os.tmpdir(),'mn-context-host-')),home=path.join(work,'home'),memory=path.join(work,'memory');
const fixtures=path.join(root,'plugins/memory-net/adapters/dsh/tests/fixtures'),dsh=path.join(installation,'lib/bin.js');
const evidence=path.join(root,'.asset-state/evidence');await fs.mkdir(evidence,{recursive:true});
const env={};for(const k of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'])if(process.env[k])env[k]=process.env[k];
Object.assign(env,{HOME:work,USERPROFILE:work,DSH_HOME:home,DSH_TELEMETRY_MODE:'DISABLED',DSH_PERMISSION_MODE:'danger-full-access',MN_CONTEXT_MODEL_KEY:'fixture-key'});
let model;const reports=[];
async function run(args,cwd,extra={},timeout=90000){const child=spawn(process.execPath,args,{cwd,env:{...env,...extra},stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);const timer=setTimeout(()=>child.kill(),timeout);const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)}).finally(()=>clearTimeout(timer));if(code!==0)throw new Error(JSON.stringify({code,out:out.slice(-4000),err:err.slice(-6000)}));return {out,err};}
try {
 const fingerprint=await dshFingerprint(root,installation);
 const projectA=path.join(work,'project-a'),projectB=path.join(work,'project-b');await fs.mkdir(projectA);await fs.mkdir(projectB);
 await run([dsh,'--profile','context-e2e','--from-default-profile','headless','--dump-config'],projectA);
 for(const label of ['A','B','C']) {
  const project=label==='C'?projectB:projectA,reportFile=path.join(work,label+'-scope.json'),diag=path.join(work,label+'-requests.jsonl');
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const extra={MN_CONTEXT_LABEL:label,MN_CONTEXT_REPORT:reportFile,MN_CONTEXT_DIAG:diag};
  model=spawn(process.execPath,[path.join(fixtures,'session-model.mjs'),String(port)],{cwd:project,env:{...env,...extra},stdio:['ignore','ignore','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Model readiness timeout')),10000);model.once('error',reject);model.stderr.on('data',c=>{if(c.toString().includes('ready')){clearTimeout(timer);resolve()}});model.once('exit',code=>{clearTimeout(timer);reject(new Error('Model exited '+code))});});
  const patch=[{id:'session-title-llm',disabled:true},{id:'llm-pi-ai',config:{providers:{mock:{displayName:'context-fixture',apiKeyEnv:'MN_CONTEXT_MODEL_KEY',api:'openai-completions',baseURL:'http://127.0.0.1:'+port+'/v1',models:[{id:'deepseek-v4-flash',name:'Mock',contextWindow:131072,maxTokens:8192}]}}}},{id:'agent-default-model',config:{provider:'mock',model:'deepseek-v4-flash'}},{insert:[{id:'context-memory',name:pathToFileURL(path.join(root,'plugins/memory-net/adapters/dsh/dist/adapters/dsh/src/index.js')).href,config:{workspaces_root:memory,context:{mode:'session'}}},{id:'context-fixture',name:pathToFileURL(path.join(fixtures,'session-tool.mjs')).href}]}];
  const patchFile=path.join(work,label+'-patch.yml');await fs.writeFile(patchFile,YAML.stringify(patch));
  const result=await run([dsh,'--profile','context-e2e','--patch',patchFile,'Test current session memory only.'],project,extra,120000);
  assert.ok(result.out.includes('MN-CONTEXT-OK'),'Model completion absent');
  const rows=(await fs.readFile(diag,'utf8')).trim().split(String.fromCharCode(10)).map(s=>JSON.parse(s));
  await fs.writeFile(path.join(evidence,'session-host-'+label+'-diagnostics.json'),JSON.stringify({rows,stderr:result.err},null,2));
  assert.ok(rows.some(r=>r.private_prompt&&r.progress_prompt&&r.curated_result&&r.raw_result&&r.selector_refused&&r.model_write),'Full scoped prompt/recall/raw/refusal cycle not complete');
  assert.ok(rows.every(r=>!r.foreign_leak&&!r.raw_prompt_leak),'Foreign or raw prompt leaked');
  const scope=JSON.parse(await fs.readFile(reportFile,'utf8'));const db=new DatabaseSync(path.join(scope.dir,'memory.db'),{readOnly:true});
  const nodes=db.prepare('select kind,run_id,task_id,text,payload_json from nodes').all();db.close();
  assert.ok(nodes.some(n=>n.kind==='tip'&&n.text==='MODEL-PRIVATE-'+label),'Model tip write missing')
  assert.ok(nodes.some(n=>n.kind==='observation'&&n.text.includes('AUTO-PRIVATE-'+label)),'Auto observation not persisted');
  assert.ok(nodes.every(n=>n.kind==='progress'?n.task_id===scope.session:n.run_id===scope.session),'Wrong session attribution');
  reports.push({label,session:scope.session,scope_directory:path.relative(memory,scope.dir),nodes:nodes.length,prompt:true,progress:true,curated:true,raw:true,selectors_refused:true,no_foreign_content:true,automatic_observation_persisted:true});
  const stop=new Promise(resolve=>model.once('exit',resolve));model.kill();await stop;model=undefined;
 }
 assert.equal(new Set(reports.map(r=>r.scope_directory)).size,3);await assert.rejects(fs.access(path.join(memory,'main')));
 const after=await dshFingerprint(root,installation);assert.equal(after.assets_sha256,fingerprint.assets_sha256);assert.equal(after.host_sha256,fingerprint.host_sha256);
 const report={status:'PASS',host_version:fingerprint.version,fingerprint,session_boundary:{same_project_sessions_isolated:true,different_project_isolated:true,model_scope_selectors_refused:true,default_root_untouched:true,contextual_prompt:true,raw_scope_preserved:true,auto_attribution:true},sessions:reports,scope:'Actual isolated DSH headless processes, local scripted model, three fresh sessions; no subprocess resumed persisted session and no live profile/user library.'};
 const destination=path.join(evidence,'session-host-'+fingerprint.version+'.json');await fs.writeFile(destination,JSON.stringify(report,null,2)+String.fromCharCode(10));console.log(JSON.stringify({status:report.status,host:report.host_version,checks:report.session_boundary,sessions:reports,evidence:destination},null,2));
}catch(e){await fs.writeFile(path.join(evidence,'session-host-failure.json'),JSON.stringify({error:String(e),reports,work},null,2));throw e}
finally {if(model){const stop=new Promise(resolve=>model.once('exit',resolve));model.kill();await stop;}await fs.rm(work,{recursive:true,force:true});}
