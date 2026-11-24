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
import {createDshBundle,verifyDshBundle} from './core/dsh-bundle.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),installation=process.env.HUB_DSH_INSTALLATION;
if(!installation)throw new Error('Explicit installed DSH path required (HUB_DSH_INSTALLATION)');
const bundleMode=process.env.HUB_MEMORY_RESUME_BUNDLE==='1';
const work=await fs.mkdtemp(path.join(os.tmpdir(),'mn-resume-host-')),home=path.join(work,'home'),memory=path.join(work,'memory');
const fixtures=path.join(root,'plugins/memory-net/adapters/dsh/tests/fixtures'),adapterDist=path.join(root,'plugins/memory-net/adapters/dsh/dist/adapters/dsh/src/index.js'),dsh=path.join(installation,'lib/bin.js');
const evidence=path.join(root,'.asset-state/evidence');await fs.mkdir(evidence,{recursive:true});
const env={};for(const k of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'])if(process.env[k])env[k]=process.env[k];
Object.assign(env,{HOME:work,USERPROFILE:work,DSH_HOME:home,DSH_TELEMETRY_MODE:'DISABLED',DSH_PERMISSION_MODE:'danger-full-access',MN_RESUME_MODEL_KEY:'fixture-key'});
let model,bundle,project;const rows={};let memoryRoot;
async function run(args,cwd,extra={},timeout=180000){const child=spawn(process.execPath,args,{cwd,env:{...env,...extra},stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);const timer=setTimeout(()=>child.kill(),timeout);const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)}).finally(()=>clearTimeout(timer));if(code!==0)throw new Error(JSON.stringify({code,out:out.slice(-4000),err:err.slice(-6000)}));return {out,err};}
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
function sessionIdOf(out){for(const line of out.split(String.fromCharCode(10))){if(!line.trim().startsWith('{'))continue;try{const event=JSON.parse(line);if(event.type==='session'&&typeof event.sessionId==='string')return event.sessionId;}catch{}}throw new Error('session event absent from --json stream');}
async function phase(n,sessionId){
 const port=await freePort(),diag=path.join(work,'phase'+n+'-requests.jsonl');
 const extra={MN_RESUME_PHASE:String(n),MN_RESUME_DIAG:diag};
 model=spawn(process.execPath,[path.join(fixtures,'resume-model.mjs'),String(port)],{cwd:project,env:{...env,...extra},stdio:['ignore','ignore','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Model readiness timeout')),10000);model.once('error',reject);model.stderr.on('data',c=>{if(c.toString().includes('ready')){clearTimeout(timer);resolve()}});model.once('exit',code=>{clearTimeout(timer);reject(new Error('Model exited '+code))});});
 const profilePatch=[{id:'session-title-llm',disabled:true},{id:'llm-pi-ai',config:{providers:{mock:{displayName:'resume-fixture',apiKeyEnv:'MN_RESUME_MODEL_KEY',api:'openai-completions',baseURL:'http://127.0.0.1:'+port+'/v1',models:[{id:'deepseek-v4-flash',name:'Mock',contextWindow:131072,maxTokens:8192}]}}}},{id:'agent-default-model',config:{provider:'mock',model:'deepseek-v4-flash'}},{insert:[{id:'resume-fixture',name:pathToFileURL(path.join(fixtures,'resume-tool.mjs')).href},...(bundleMode?[]:[{id:'resume-memory',name:pathToFileURL(adapterDist).href,config:{workspaces_root:memoryRoot,context:{mode:'session'}}}])]}];
 const layers=[...profilePatch];if(bundleMode)layers.push(...YAML.parse(await fs.readFile(bundle.patch,'utf8')));
 const patchFile=path.join(work,'phase'+n+'-patch.yml');await fs.writeFile(patchFile,YAML.stringify(layers));
 const args=[dsh,'--profile',bundleMode?'headless':'resume-e2e'];
 args.push('--patch',patchFile);
 if(sessionId)args.push('--session-id',sessionId);
 args.push('--json',n===1?'Record session memory that must survive a process restart.':'Continue the same session and recall the memory recorded before the restart.');
 const result=await run(args,project,extra);
 const stop=new Promise(resolve=>model.once('exit',resolve));model.kill();await stop;model=undefined;
 return {out:result.out,err:result.err,diag};
}
try {
 const fingerprint=await dshFingerprint(root,installation);
 memoryRoot=memory;
 if(bundleMode){bundle=await createDshBundle(root,installation,{memory:true});await verifyDshBundle(bundle.bundle);memoryRoot=path.join(bundle.bundle,'state/memory-net');}
 project=path.join(work,'project-a');await fs.mkdir(project);
 if(!bundleMode)await run([dsh,'--profile','resume-e2e','--from-default-profile','headless','--dump-config'],project);
 const first=await phase(1);const sessionId=sessionIdOf(first.out);
 assert.ok(first.out.includes('MN-RESUME-OK-1'),'Phase 1 completion absent');
 const second=await phase(2,sessionId);const resumedId=sessionIdOf(second.out);
 assert.equal(resumedId,sessionId,'Resumed process must adopt the same persisted session id');
 assert.ok(second.out.includes('MN-RESUME-OK-2'),'Phase 2 completion absent');
 for(const p of [1,2])rows[p]=(await fs.readFile(path.join(work,'phase'+p+'-requests.jsonl'),'utf8')).trim().split(String.fromCharCode(10)).map(s=>JSON.parse(s));
 const last1=rows[1].at(-1),last2=rows[2].at(-1);
 assert.ok(last1.write_ok===true&&last1.recall_in_process===true,'Phase 1 write/in-process recall incomplete');
 assert.ok(last2.recall_first_has_mark1===true,'Cross-process recall of prior-session tip missing');
 assert.ok(last2.raw_has_obs1===true,'Phase 1 auto observation missing from phase 2 raw view');
 assert.ok(last2.write2_ok===true,'Phase 2 write failed');
 const scoped=path.join(memoryRoot,'scoped-v1');
 const projects=(await fs.readdir(scoped)).filter(d=>d.startsWith('p-'));
 assert.equal(projects.length,1,'Expected exactly one project scope directory');
 const sessions=(await fs.readdir(path.join(scoped,projects[0]))).filter(d=>d.startsWith('s-'));
 assert.equal(sessions.length,1,'Resume must reuse the same session scope directory, not create a new one');
 const db=new DatabaseSync(path.join(scoped,projects[0],sessions[0],'memory.db'),{readOnly:true});
 const nodes=db.prepare('select kind,run_id,task_id,text from nodes').all();db.close();
 assert.ok(nodes.some(n=>n.kind==='tip'&&n.text.includes('RESUME-MARK-1')),'RESUME-MARK-1 not persisted');
 assert.ok(nodes.some(n=>n.kind==='tip'&&n.text.includes('RESUME-MARK-2')),'RESUME-MARK-2 not persisted');
 assert.ok(nodes.some(n=>n.kind==='observation'&&n.text.includes('AUTO-RESUME-OBS-1')),'Phase 1 auto observation not persisted');
 assert.ok(nodes.every(n=>n.kind==='progress'?n.task_id===sessionId:n.run_id===sessionId),'Wrong session attribution across processes');
 let defaultRootUntouched=true;try{await fs.access(path.join(memoryRoot,'main'));defaultRootUntouched=false;}catch{}
 if(bundleMode)await verifyDshBundle(bundle.bundle);
 const after=await dshFingerprint(root,installation);assert.equal(after.assets_sha256,fingerprint.assets_sha256);assert.equal(after.host_sha256,fingerprint.host_sha256);
 const report={status:'PASS',host_version:fingerprint.version,bundle_test:bundleMode,fingerprint,cross_process_resume:{session_id_adopted:resumedId===sessionId,first_recall_had_prior_tip:last2.recall_first_has_mark1,raw_view_had_prior_observation:last2.raw_has_obs1,second_write_persisted:nodes.some(n=>n.text.includes('RESUME-MARK-2')),single_scope_directory:sessions.length===1,attribution_stable:nodes.every(n=>n.kind==='progress'?n.task_id===sessionId:n.run_id===sessionId),default_main_workspace_untouched:defaultRootUntouched},nodes:nodes.length,scope:'Actual isolated DSH headless processes ('+(bundleMode?'generated session-default run package via bundle patch':'adapter-direct session mode')+'), local scripted OpenAI-compatible model, real plugin/tool execution and SQLite; process 1 exits before process 2 resumes the same persisted session id. Not live user profile or paid model.'};
 const destination=path.join(evidence,'memory-resume-'+fingerprint.version+(bundleMode?'-bundle':'')+'.json');await fs.writeFile(destination,JSON.stringify(report,null,2)+String.fromCharCode(10));
 console.log(JSON.stringify({status:report.status,host:report.host_version,bundle_test:bundleMode,checks:report.cross_process_resume,session:sessionId,nodes:nodes.length,evidence:destination},null,2));
}catch(e){await fs.writeFile(path.join(evidence,'memory-resume-failure.json'),JSON.stringify({error:String(e),bundle:bundleMode},null,2));throw e}
finally {if(model){const stop=new Promise(resolve=>model.once('exit',resolve));model.kill();await stop;}if(bundle)await fs.rm(bundle.bundle,{recursive:true,force:true});await fs.rm(work,{recursive:true,force:true});}
