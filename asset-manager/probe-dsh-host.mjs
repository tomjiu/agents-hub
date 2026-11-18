import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
import {createView} from './core/views.mjs';
import {deployProfile,uninstallDeployment} from './core/deployment.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const installation=process.env.HUB_DSH_INSTALLATION;
if(!installation)throw new Error('Set HUB_DSH_INSTALLATION to installed @deepseek-ai/dsh directory; no downloads or live profile changes.');
const dsh=path.join(installation,'lib/bin.js'),mn=path.join(root,'plugins/memory-net'),adapter=path.join(mn,'adapters/dsh'),fixtures=path.join(adapter,'tests/fixtures');
const work=await fs.mkdtemp(path.join(os.tmpdir(),'hub-dsh-host-'));const home=path.join(work,'dsh-home'),state=path.join(work,'state'),ws=path.join(state,'memory-net/main');
const evidence=path.join(root,'.asset-state/evidence');await fs.mkdir(evidence,{recursive:true});
const env={};for(const k of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'])if(process.env[k])env[k]=process.env[k];
Object.assign(env,{DSH_HOME:home,HOME:work,USERPROFILE:work,KOKOA_STATE_DIR:state,MN_E2E_MODEL_KEY:'isolated-fake-key',DSH_TELEMETRY_MODE:'DISABLED',DSH_PERMISSION_MODE:'danger-full-access'});
async function run(args,cwd=work,budget=60000){
 const child=spawn(process.execPath,args,{cwd,env,stdio:['ignore','pipe','pipe'],shell:false});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
 const timer=setTimeout(()=>child.kill(),budget);const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>clearTimeout(timer));
 if(code!==0)throw new Error('Child exit '+code+': '+stderr.slice(-7000));return {stdout,stderr};
}
let mock,view,deployment;let mockLog='';
try{
 await run([path.join(mn,'scripts/build.mjs')],mn);await run([path.join(adapter,'scripts/build.mjs')],adapter);
 await run([path.join(mn,'bin/mn.js'),'init',ws]);await run([path.join(mn,'bin/mn.js'),'add',ws,'constraint','--key','no-force-push','--text','永不 force push main','--payload','{"mode":"forbid"}']);await run([path.join(mn,'bin/mn.js'),'progress',ws,'--task','e2e','--status','doing','--summary','登录页 60%','--agent','alice']);
 await run([dsh,'--profile','hub-e2e','--from-default-profile','headless','--dump-config']);
 const modules=path.join(home,'profiles/hub-e2e/node_modules');await fs.mkdir(modules,{recursive:true});await fs.symlink(adapter,path.join(modules,'memory-net-dsh-adapter'),'junction');await fs.symlink(path.join(fixtures,'echo-tool'),path.join(modules,'mn-e2e-echo-tool'),'junction');
 const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 await fs.mkdir(path.join(work,'.git'));deployment=await deployProfile(root,'dsh',work,{approved:true});
 view=await createView(root,'dsh','research');env.MN_E2E_MCP_TOOL='mcp__search-core__tool_search';env.MN_E2E_SKILL='asset-management';env.MN_E2E_SKILL_FILE=path.join(work,'.dsh/skills/asset-management/SKILL.md');env.SC_HOME=path.join(work,'search-cache');
 const diag=path.join(work,'requests.jsonl');mock=spawn(process.execPath,[path.join(fixtures,'mock-model.mjs'),String(port),diag],{cwd:work,env,stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Mock model readiness timeout')),10000);mock.once('error',reject);mock.stderr.on('data',chunk=>{mockLog+=chunk;if(mockLog.includes('listening on')){clearTimeout(t);resolve();}});mock.once('exit',code=>{clearTimeout(t);reject(new Error('Mock model exited '+code));});});
 const patch=[{id:'session-title-llm',disabled:true},{id:'llm-pi-ai',config:{providers:{mock:{displayName:'isolated-test-model',apiKeyEnv:'MN_E2E_MODEL_KEY',api:'openai-completions',baseURL:'http://127.0.0.1:'+port+'/v1',models:[{id:'deepseek-v4-flash',name:'Mock Flash',contextWindow:131072,maxTokens:8192}]}}}},{id:'agent-default-model',config:{provider:'mock',model:'deepseek-v4-flash'}},{insert:[{id:'hub-memory-net',name:'memory-net-dsh-adapter',config:{enabled:true,workspaces_root:path.join(state,'memory-net'),default_workspace:'main',agent_id:'dsh-e2e',budgets:{max_nodes:24,max_tokens:2048},inject:{section_order:90},tools:{recall:true,write:true}}},{id:'hub-e2e-echo',name:'mn-e2e-echo-tool',config:{}}]}];
 patch.push(...YAML.parse(await fs.readFile(path.join(view.destination,'dsh-mcp.patch.yml'),'utf8')));
 const patchFile=path.join(work,'host.patch.yml');await fs.writeFile(patchFile,YAML.stringify(patch));
 const result=await run([dsh,'--profile','hub-e2e','--patch',patchFile,'先调用 mn_e2e_echo（say=hello auto-observe），再调用 memory_net_write 写推断并结束。'],work,90000);
 const stdout=path.join(work,'dsh.out');await fs.writeFile(stdout,result.stdout);const verified=await run([path.join(fixtures,'verify-e2e.mjs'),diag,path.join(ws,'memory.db'),stdout]);
 const diagnostics=(await fs.readFile(diag,'utf8')).trim().split(String.fromCharCode(10)).map(line=>JSON.parse(line));assert.ok(diagnostics.some(row=>row.has_mcp_tool));assert.ok(diagnostics.some(row=>row.round==='after_tool'&&row.has_mcp_result),'Real MCP result must return to model, not a fabricated success');assert.ok(diagnostics.some(row=>row.has_skill_tool));assert.ok(diagnostics.some(row=>row.has_loaded_skill),'Deployed Skill full text must return through real host invocation');
 await uninstallDeployment(root,work,deployment.id,{approved:true});
 const report={status:'PASS',skill:{name:'asset-management',deployed:true,invoked:true,full_content_seen_by_model:true},mcp:{tool:'mcp__search-core__tool_search',registered:true,result_returned_to_model:true,source:'Generated DSH MCP patch + real Search-core stdio server'},host_version:JSON.parse(await fs.readFile(path.join(installation,'package.json'),'utf8')).version,scope:'Actual isolated DSH headless profile, local scripted OpenAI-compatible model, real plugin/tool execution and SQLite; not live user profile or paid model.',checks:verified.stdout.trim().split(String.fromCharCode(10)),user_profile_modified:false,telemetry:'DISABLED'};
 await fs.writeFile(path.join(evidence,'dsh-host.json'),JSON.stringify(report,null,2)+String.fromCharCode(10));console.log(JSON.stringify(report,null,2));
}catch(e){await fs.writeFile(path.join(evidence,'dsh-host-failure.txt'),String(e)+String.fromCharCode(10)+mockLog);throw e;}
finally{if(mock&&mock.exitCode===null){const exited=new Promise(resolve=>mock.once('exit',resolve));mock.kill();await exited;}if(view)await fs.rm(view.destination,{recursive:true,force:true});await fs.rm(work,{recursive:true,force:true});}
