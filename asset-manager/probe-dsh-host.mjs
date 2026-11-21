import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
import {createSearchFixture} from './search-fixture.mjs';
import {createView} from './core/views.mjs';
import {createDshBundle,verifyDshBundle} from './core/dsh-bundle.mjs';
import {deployProfile,uninstallDeployment} from './core/deployment.mjs';
import {dshFingerprint,saveDshAcceptance} from './core/dsh-compatibility.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const installation=process.env.HUB_DSH_INSTALLATION;
if(!installation)throw new Error('Set HUB_DSH_INSTALLATION to installed @deepseek-ai/dsh directory; no downloads or live profile changes.');
const dsh=path.join(installation,'lib/bin.js'),mn=path.join(root,'plugins/memory-net'),adapter=path.join(mn,'adapters/dsh'),fixtures=path.join(adapter,'tests/fixtures');
const work=await fs.mkdtemp(path.join(os.tmpdir(),'hub-dsh-host-'));const home=path.join(work,'dsh-home'),state=path.join(work,'state');let ws=path.join(state,'memory-net/main');
const evidence=path.join(root,'.asset-state/evidence');await fs.mkdir(evidence,{recursive:true});
const env={};for(const k of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'])if(process.env[k])env[k]=process.env[k];
Object.assign(env,{DSH_HOME:home,HOME:work,USERPROFILE:work,KOKOA_STATE_DIR:state,MN_E2E_MODEL_KEY:'isolated-fake-key',DSH_TELEMETRY_MODE:'DISABLED',DSH_PERMISSION_MODE:'danger-full-access'});
async function run(args,cwd=work,budget=60000){
 const child=spawn(process.execPath,args,{cwd,env,stdio:['ignore','pipe','pipe'],shell:false});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},budget);const outcome=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));}).finally(()=>clearTimeout(timer));
 if(outcome.code!==0)throw new Error(JSON.stringify({command:args[0],code:outcome.code,signal:outcome.signal,timed_out:timedOut,budget_ms:budget,stdout:stdout.slice(-7000),stderr:stderr.slice(-7000)}));return {stdout,stderr};
}
let mock,view,deployment,bundle,searchFixture;let mockLog='';
try{
 await run([path.join(mn,'scripts/build.mjs')],mn);await run([path.join(adapter,'scripts/build.mjs')],adapter);
 const fingerprint=await dshFingerprint(root,installation);
 if(process.env.HUB_DSH_BUNDLE_TEST==='1'){bundle=await createDshBundle(root,installation,{memory:true});await verifyDshBundle(bundle.bundle);ws=path.join(bundle.bundle,'state/memory-net/main');}
 await run([path.join(mn,'bin/mn.js'),'init',ws]);await run([path.join(mn,'bin/mn.js'),'add',ws,'constraint','--key','no-force-push','--text','永不 force push main','--payload','{"mode":"forbid"}']);await run([path.join(mn,'bin/mn.js'),'progress',ws,'--task','e2e','--status','doing','--summary','登录页 60%','--agent','alice']);
 await run([dsh,'--profile','hub-e2e','--from-default-profile','headless','--dump-config']);
 const modules=path.join(home,'profiles/hub-e2e/node_modules');await fs.mkdir(modules,{recursive:true});if(!bundle)await fs.symlink(adapter,path.join(modules,'memory-net-dsh-adapter'),'junction');await fs.symlink(path.join(fixtures,'echo-tool'),path.join(modules,'mn-e2e-echo-tool'),'junction');
 const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 await fs.mkdir(path.join(work,'.git'));if(!bundle)deployment=await deployProfile(root,'dsh',work,{approved:true});
 if(!bundle)view=await createView(root,'dsh','research');env.MN_E2E_MCP_TOOL='mcp__search-core__tool_search';env.MN_E2E_SKILL='asset-management';env.MN_E2E_SKILL_FILE=bundle?path.join(bundle.bundle,'skills/asset-management/SKILL.md'):path.join(work,'.dsh/skills/asset-management/SKILL.md');env.SC_DATA_DIR=bundle?path.join(bundle.bundle,'state/search-core'):path.join(work,'search-cache');
 if(process.env.HUB_DSH_EXPLICIT_SELECTION!=='0')env.MN_E2E_SEARCH_QUERY='Node SQLite python documentation';
 searchFixture=await createSearchFixture();env.MN_E2E_SEARCH_TOOL='mcp__search-core__search';if(process.env.HUB_DSH_PARALLEL_DISCOVERY!=='0')env.MN_E2E_PARALLEL_DISCOVERY='1';
 await fs.mkdir(env.SC_DATA_DIR,{recursive:true});await fs.writeFile(path.join(env.SC_DATA_DIR,'config.json'),JSON.stringify({engines:['searxng'],keySlots:'off',searxng:{baseUrl:searchFixture.url,instances:[]},timeoutMs:3000,softDeadlineMs:3000,earlyHarvestMs:0}));
 const diag=path.join(work,'requests.jsonl');mock=spawn(process.execPath,[path.join(fixtures,'mock-model.mjs'),String(port),diag],{cwd:work,env,stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Mock model readiness timeout')),10000);mock.once('error',reject);mock.stderr.on('data',chunk=>{mockLog+=chunk;if(mockLog.includes('listening on')){clearTimeout(t);resolve();}});mock.once('exit',code=>{clearTimeout(t);reject(new Error('Mock model exited '+code));});});
 const patch=[{id:'session-title-llm',disabled:true},{id:'llm-pi-ai',config:{providers:{mock:{displayName:'isolated-test-model',apiKeyEnv:'MN_E2E_MODEL_KEY',api:'openai-completions',baseURL:'http://127.0.0.1:'+port+'/v1',models:[{id:'deepseek-v4-flash',name:'Mock Flash',contextWindow:131072,maxTokens:8192}]}}}},{id:'agent-default-model',config:{provider:'mock',model:'deepseek-v4-flash'}},{insert:[{id:'hub-memory-net',name:'memory-net-dsh-adapter',config:{enabled:true,workspaces_root:path.join(state,'memory-net'),default_workspace:'main',agent_id:'dsh-e2e',budgets:{max_nodes:24,max_tokens:2048},inject:{section_order:90},tools:{recall:true,write:true}}},{id:'hub-e2e-echo',name:'mn-e2e-echo-tool',config:{}}]}];
 if(bundle){patch.at(-1).insert=patch.at(-1).insert.filter(node=>node.name!=='memory-net-dsh-adapter');patch.push(...YAML.parse(await fs.readFile(bundle.patch,'utf8')));}else patch.push(...YAML.parse(await fs.readFile(path.join(view.destination,'dsh-mcp.patch.yml'),'utf8')));
 const patchFile=path.join(work,'host.patch.yml');await fs.writeFile(patchFile,YAML.stringify(patch));
 const result=await run([dsh,'--profile','hub-e2e','--patch',patchFile,'先调用 mn_e2e_echo（say=hello auto-observe），再调用 memory_net_write 写推断并结束。'],work,180000);
 await fs.writeFile(path.join(evidence,'dsh-host-stderr.txt'),result.stderr);
 const stdout=path.join(work,'dsh.out');await fs.writeFile(stdout,result.stdout);const verified=await run([path.join(fixtures,'verify-e2e.mjs'),diag,path.join(ws,'memory.db'),stdout]);
 const diagnostics=(await fs.readFile(diag,'utf8')).trim().split(String.fromCharCode(10)).map(line=>JSON.parse(line));assert.ok(diagnostics.some(row=>row.has_mcp_tool));assert.ok(diagnostics.some(row=>row.round==='after_tool'&&(row.has_mcp_result||row.has_search_result)),'Real MCP result must return to model, not a fabricated success');assert.ok(diagnostics.some(row=>row.has_skill_tool));assert.ok(diagnostics.some(row=>row.has_loaded_skill),'Deployed Skill full text must return through real host invocation');
 assert.ok(diagnostics.some(row=>row.has_search_tool));assert.ok(diagnostics.some(row=>row.has_search_result),'Functional search refs must return to real model');assert.ok(diagnostics.some(row=>row.has_search_cache),'Repeated query must return cache hit');const explicitSelection=process.env.HUB_DSH_EXPLICIT_SELECTION!=='0';const expectedQueries=explicitSelection?['Node SQLite python documentation','Node SQLite python documentation site:docs.python.org']:['aurora glacier'];assert.equal(searchFixture.requests.length,expectedQueries.length,'Cached second query must not fetch provider again');assert.deepEqual(searchFixture.requests.map(r=>r.query),expectedQueries);if(explicitSelection)assert.ok(diagnostics.some(row=>row.has_explicit_selection),'Explicit provider selection must return to model');await fs.access(path.join(env.SC_DATA_DIR,'cache.db'));
 if(process.env.HUB_DSH_PARALLEL_DISCOVERY!=='0'){assert.ok(diagnostics.some(row=>row.has_mcp_result),'Discovery result must actually return to the model');assert.ok(diagnostics.some(row=>row.has_static_discovery),'Discovery must report stable static mode');assert.ok(!JSON.stringify(diagnostics).includes('unknown tool'),'Concurrent calls must not lose tool registrations');}
 if(deployment)await uninstallDeployment(root,work,deployment.id,{approved:true});if(bundle)await verifyDshBundle(bundle.bundle);
 const after=await dshFingerprint(root,installation);assert.equal(after.host_sha256,fingerprint.host_sha256);assert.equal(after.assets_sha256,fingerprint.assets_sha256);
 const report={status:'PASS',parallel_discovery:process.env.HUB_DSH_PARALLEL_DISCOVERY!=='0',search:{queried:true,refs_returned:true,cache_hit:true,explicit_selection_verified:process.env.HUB_DSH_EXPLICIT_SELECTION!=='0',provider_requests:searchFixture.requests.length,cache_isolated:true,source:'Local SearXNG-compatible fixture; not public web'},bundle_test:!!bundle,fingerprint,memory:{persisted:true,prompt_injection:true,auto_observe:true,self_filter:true},skill:{name:'asset-management',deployed:true,invoked:true,full_content_seen_by_model:true},mcp:{tool:'mcp__search-core__search',registered:true,result_returned_to_model:true,source:'Generated DSH MCP patch + real Search-core stdio server'},host_version:JSON.parse(await fs.readFile(path.join(installation,'package.json'),'utf8')).version,scope:'Actual isolated DSH headless profile, local scripted OpenAI-compatible model, real plugin/tool execution and SQLite; not live user profile or paid model.',checks:verified.stdout.trim().split(String.fromCharCode(10)),user_profile_modified:false,telemetry:'DISABLED'};
 await fs.writeFile(path.join(evidence,bundle?'dsh-bundle-host.json':'dsh-host.json'),JSON.stringify(report,null,2)+String.fromCharCode(10));const acceptance_file=await saveDshAcceptance(root,report);console.log(JSON.stringify({status:report.status,host_version:report.host_version,bundle_test:report.bundle_test,parallel_discovery:report.parallel_discovery,search:report.search,skill:report.skill,mcp:report.mcp,memory:report.memory,acceptance_file},null,2));
}catch(e){await fs.writeFile(path.join(evidence,'dsh-host-failure.txt'),String(e)+String.fromCharCode(10)+JSON.stringify({search_requests:searchFixture?.requests})+String.fromCharCode(10)+mockLog);throw e;}
finally{if(mock&&mock.exitCode===null){const exited=new Promise(resolve=>mock.once('exit',resolve));mock.kill();await exited;}if(searchFixture)await searchFixture.close();if(bundle)await fs.rm(bundle.bundle,{recursive:true,force:true});if(view)await fs.rm(view.destination,{recursive:true,force:true});await fs.rm(work,{recursive:true,force:true});}
