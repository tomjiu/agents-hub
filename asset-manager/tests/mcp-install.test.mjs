import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
import {parse,stringify} from 'smol-toml';
import {tree} from '../core/files.mjs';
import {mergeMcpConfig,prepareMcpInstall,applyMcpInstall,rollbackMcpInstall,inspectMcpInstall} from '../core/mcp-install.mjs';
import {childEnv,validateLaunch} from '../mcp-launcher.mjs';
async function fixture(t,client='opencode'){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hub-mcp-install-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const root=path.join(dir,'hub'),project=path.join(dir,'consumer');await fs.mkdir(project);
 for(const p of ['catalog/assets','catalog/profiles','experts','mcp/servers/demo','asset-manager'])await fs.mkdir(path.join(root,p),{recursive:true});
 await fs.copyFile(fileURLToPath(new URL('../mcp-launcher.mjs',import.meta.url)),path.join(root,'asset-manager/mcp-launcher.mjs'));
 await fs.writeFile(path.join(root,'mcp/servers/demo/server.mjs'),'console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}));');
 const baseline=await tree(path.join(root,'mcp/servers/demo'));
 await fs.writeFile(path.join(root,'catalog/assets/mcp.demo.toml'),stringify({id:'mcp.demo',kind:'mcp',path:'mcp/servers/demo',registry_id:'demo',source:{kind:'local'},version:{sha256:baseline.sha256}}));
 await fs.writeFile(path.join(root,'experts/core.toml'),stringify({name:'core',mcp:['mcp.demo']}));
 await fs.writeFile(path.join(root,'catalog/profiles',client+'.toml'),stringify({schema:1,client,experts:['core'],enabled:false,deploy:'explicit',overwrite_user_config:false}));
 await fs.writeFile(path.join(root,'mcp/registry.toml'),stringify({schema:1,servers:[{id:'demo',transport:'stdio',command:process.execPath,args:['mcp/servers/demo/server.mjs','literal & argument'],cwd:'mcp/servers/demo',status:'build-required'}]}));
 return {dir,root,project};
}
const targets={opencode:'opencode.json',codex:'.codex/config.toml',dsh:'.dsh/agents-hub-mcp.patch.yml'};
const prior={opencode:'{\n  "theme": "user", "mcp": {"existing": {"type":"local", "command":["user-server"], "enabled":false}}\n}\n',codex:'# keep user comment\nmodel = "user-model"\n[mcp_servers.existing]\ncommand = "user-server"\n',dsh:'# preserve comment\n- insert:\n    - id: custom-user-plugin\n      name: user-plugin\n      config: {}\n'};
test('merge preserves unrelated JSON and appends TOML bytes/comments and DSH operations',()=>{
 const json=JSON.parse(mergeMcpConfig('opencode',prior.opencode,JSON.stringify({mcp:{demo:{type:'local',command:['node','test'],enabled:true}}})));assert.equal(json.theme,'user');assert.equal(json.mcp.existing.enabled,false);
 const toml=mergeMcpConfig('codex',prior.codex,stringify({mcp_servers:{demo:{command:'node',args:['test']}}}));assert.ok(toml.startsWith(prior.codex));assert.equal(parse(toml).mcp_servers.existing.command,'user-server');
 const yaml=mergeMcpConfig('dsh',prior.dsh,YAML.stringify([{insert:[{id:'agents-hub-mcp-demo',name:'@deepseek-ai/dsh-mcp-client',config:{transport:'stdio',serverName:'demo',command:'node',args:[]}}]}]));assert.ok(yaml.includes('preserve comment'));assert.equal(YAML.parse(yaml).length,2);
});
test('existing server names and invalid configuration shapes fail before effects',()=>{
 assert.throws(()=>mergeMcpConfig('opencode','{"mcp":{"demo":{}}}','{"mcp":{"demo":{}}}'),/preserved/);
 assert.throws(()=>mergeMcpConfig('codex','[mcp_servers.demo]\ncommand="x"', '[mcp_servers.demo]\ncommand="y"'),/preserved/);
 assert.throws(()=>mergeMcpConfig('dsh','- insert:\n  - id: original\n    config: {serverName: demo}', '- insert:\n  - id: new\n    config: {serverName: demo}'),/preserved/);
 assert.throws(()=>mergeMcpConfig('opencode','{"mcp":[]}','{"mcp":{}}'),/Invalid/);
 assert.throws(()=>mergeMcpConfig('dsh','foo: bar','[]'),/sequence/);
});
test('each client requires approval, preserves original bytes, and rollback restores exact configuration',async t=>{
 for(const client of Object.keys(targets)){
  const {root,project}=await fixture(t,client),file=path.join(project,targets[client]);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,prior[client]);
  const change=await prepareMcpInstall(root,client,project);assert.equal(change.status,'PREPARED');assert.equal(await fs.readFile(file,'utf8'),prior[client]);
  await assert.rejects(applyMcpInstall(root,change.id),/approval/);const applied=await applyMcpInstall(root,change.id,{approved:true});assert.equal(applied.status,'APPLIED');assert.equal(applied.auto_loaded,false);
  assert.equal(await fs.readFile(applied.backup,'utf8'),prior[client]);await assert.rejects(applyMcpInstall(root,change.id,{approved:true}),/not prepared/);
  await assert.rejects(rollbackMcpInstall(root,change.id),/approval/);const rolled=await rollbackMcpInstall(root,change.id,{approved:true});assert.equal(rolled.status,'ROLLED_BACK');assert.equal(await fs.readFile(file,'utf8'),prior[client]);await fs.access(rolled.quarantine);
 }
});
test('new configuration rollback removes registration but preserves bytes in quarantine',async t=>{
 const {root,project}=await fixture(t,'opencode');const change=await prepareMcpInstall(root,'opencode',project);await assert.rejects(fs.access(path.join(project,targets.opencode)));
 await applyMcpInstall(root,change.id,{approved:true});const r=await rollbackMcpInstall(root,change.id,{approved:true});await assert.rejects(fs.access(path.join(project,targets.opencode)));await fs.access(r.quarantine);
});
test('consumer edits after review or apply stop subsequent mutation',async t=>{
 const {root,project}=await fixture(t);const file=path.join(project,targets.opencode);await fs.writeFile(file,prior.opencode);const change=await prepareMcpInstall(root,'opencode',project);
 await fs.writeFile(file,'{"user-change":true}');await assert.rejects(applyMcpInstall(root,change.id,{approved:true}),/changed since review/);assert.equal(await fs.readFile(file,'utf8'),'{"user-change":true}');
 await fs.writeFile(file,prior.opencode);await applyMcpInstall(root,change.id,{approved:true});await fs.appendFile(file,'\n ');await assert.rejects(rollbackMcpInstall(root,change.id,{approved:true}),/Local configuration edits/);
});
test('candidate or launch descriptor tampering blocks approved apply',async t=>{
 const {root,project}=await fixture(t);const a=await prepareMcpInstall(root,'opencode',project);await fs.appendFile(a.candidate,' ');await assert.rejects(applyMcpInstall(root,a.id,{approved:true}),/Candidate changed/);
 const b=await prepareMcpInstall(root,'opencode',project);const rec=JSON.parse(await fs.readFile(path.join(path.dirname(b.candidate),'change.json'),'utf8'));await fs.appendFile(path.join(rec.view_path,'launch/demo.json'),' ');await assert.rejects(applyMcpInstall(root,b.id,{approved:true}),/view or launch descriptor changed/);await assert.rejects(fs.access(path.join(project,targets.opencode)));
});
test('OpenCode no-shell launcher runs from registered cwd and preserves literal arguments',async t=>{
 const {root,project}=await fixture(t);const change=await prepareMcpInstall(root,'opencode',project);await applyMcpInstall(root,change.id,{approved:true});
 const cfg=JSON.parse(await fs.readFile(path.join(project,targets.opencode),'utf8'));const [command,...args]=cfg.mcp.demo.command;
 const result=JSON.parse(execFileSync(command,args,{cwd:project,maxBuffer:1024*1024}).toString());assert.equal(result.cwd,path.join(root,'mcp/servers/demo'));assert.deepEqual(result.args,['literal & argument']);
});
test('DSH environment secrets are not silently embedded or lost',async t=>{
 const {root,project}=await fixture(t,'dsh');const registry=path.join(root,'mcp/registry.toml');await fs.writeFile(registry,stringify({schema:1,servers:[{id:'demo',transport:'stdio',command:'node',args:[],cwd:'.',status:'build-required',env_names:['API_TOKEN']}]}));
 await assert.rejects(prepareMcpInstall(root,'dsh',project),/environment mapping/);assert.deepEqual(await fs.readdir(project),[]);
});
test('launcher environment scrub forwards only declared secret names and requires them',()=>{
 const spec=validateLaunch({schema:1,command:'node',args:['literal'],cwd:os.tmpdir(),required_env:['DECLARED_TOKEN'],forward_env:['DECLARED_TOKEN']});
 const env=childEnv(spec,{PATH:'bin',OTHER_TOKEN:'never',DECLARED_TOKEN:'fixture',DSH_HOME:'stale'});assert.equal(env.DECLARED_TOKEN,'fixture');assert.equal(env.OTHER_TOKEN,undefined);assert.equal(env.DSH_HOME,undefined);assert.equal(env.PATH,'bin');
 assert.throws(()=>childEnv(spec,{PATH:'bin'}),/missing/);assert.throws(()=>validateLaunch({...spec,cwd:'relative'}),/Invalid/);
});
test('linked config targets and invalid receipts cannot escape consumer scope',async t=>{
 const {root,project,dir}=await fixture(t);const outside=path.join(dir,'outside.json');await fs.writeFile(outside,'{}');
 try{await fs.symlink(outside,path.join(project,'opencode.json'),'file');}catch(e){if(e.code==='EPERM'){t.skip('File symlink privilege unavailable');return;}throw e;}
 await assert.rejects(prepareMcpInstall(root,'opencode',project),/Links/);assert.equal(await fs.readFile(outside,'utf8'),'{}');
 await assert.rejects(applyMcpInstall(root,'../escape',{approved:true}),/Invalid/);
});

test('linked config directory and malformed receipts fail without file symlink privilege',async t=>{
 const {root,project,dir}=await fixture(t,'codex');const external=path.join(dir,'external');await fs.mkdir(external);await fs.symlink(external,path.join(project,'.codex'),'junction');
 await assert.rejects(prepareMcpInstall(root,'codex',project),/Links/);assert.deepEqual(await fs.readdir(external),[]);
 await assert.rejects(applyMcpInstall(root,'../escape',{approved:true}),/Invalid/);
});
test('existing JSONC is not shadowed by a newly generated JSON config',async t=>{
 const {root,project}=await fixture(t);await fs.writeFile(path.join(project,'opencode.jsonc'),'// user comment');await assert.rejects(prepareMcpInstall(root,'opencode',project),/manual merge/);
 await assert.rejects(fs.access(path.join(project,'opencode.json')));
});
test('launcher tampering, project lock and interrupted states fail closed',async t=>{
 const {root,project}=await fixture(t);const plan=await prepareMcpInstall(root,'opencode',project);const launcher=path.join(root,'asset-manager/mcp-launcher.mjs'),bytes=await fs.readFile(launcher);
 await fs.appendFile(launcher,' ');await assert.rejects(applyMcpInstall(root,plan.id,{approved:true}),/launcher changed/);await fs.writeFile(launcher,bytes);
 await fs.writeFile(path.join(project,'.agents-hub/operation.lock'),'other-owner');await assert.rejects(applyMcpInstall(root,plan.id,{approved:true}),/lock exists/);assert.equal(await fs.readFile(path.join(project,'.agents-hub/operation.lock'),'utf8'),'other-owner');await fs.unlink(path.join(project,'.agents-hub/operation.lock'));
 const file=path.join(path.dirname(plan.candidate),'change.json'),record=JSON.parse(await fs.readFile(file,'utf8'));record.status='APPLYING';await fs.writeFile(file,JSON.stringify(record));
 await assert.rejects(applyMcpInstall(root,plan.id,{approved:true}),/not prepared/);assert.equal((await inspectMcpInstall(root,plan.id)).recovery_required,true);await assert.rejects(fs.access(path.join(project,'opencode.json')));
});
test('original-byte backup tampering stops rollback before displacing current configuration',async t=>{
 const {root,project}=await fixture(t);await fs.writeFile(path.join(project,'opencode.json'),prior.opencode);const plan=await prepareMcpInstall(root,'opencode',project);await applyMcpInstall(root,plan.id,{approved:true});
 const current=await fs.readFile(path.join(project,'opencode.json'));await fs.appendFile(path.join(path.dirname(plan.candidate),'before'),' ');await assert.rejects(rollbackMcpInstall(root,plan.id,{approved:true}),/integrity mismatch/);assert.deepEqual(await fs.readFile(path.join(project,'opencode.json')),current);
});
test('exclusive publish failure preserves original config and records recovery artifacts',async t=>{
 const {root,project}=await fixture(t);await fs.writeFile(path.join(project,'opencode.json'),prior.opencode);const plan=await prepareMcpInstall(root,'opencode',project);const originalLink=fs.link;
 fs.link=async (source,dest)=>{if(source.includes('.agents-hub-new-'))throw new Error('injected publish failure');return originalLink(source,dest);};
 try{await assert.rejects(applyMcpInstall(root,plan.id,{approved:true}),/injected publish/);}finally{fs.link=originalLink;}
 assert.equal(await fs.readFile(path.join(project,'opencode.json'),'utf8'),prior.opencode);const rec=JSON.parse(await fs.readFile(path.join(path.dirname(plan.candidate),'change.json'),'utf8'));assert.equal(rec.status,'FAILED');await fs.access(rec.recovery_artifacts.saved);await fs.access(rec.recovery_artifacts.temp);assert.equal((await inspectMcpInstall(root,plan.id)).recovery_required,true);
});

test('JSON unsafe integer and malformed DSH operation are rejected without lossy merge',()=>{
 assert.throws(()=>mergeMcpConfig('opencode','{"counter":9007199254740993}','{"mcp":{"new":{}}}'),/unsafe numbers/);
 assert.throws(()=>mergeMcpConfig('dsh','- null','[]'),/Invalid existing/);
 assert.throws(()=>mergeMcpConfig('dsh','- insert: invalid','[]'),/Invalid existing/);
});
test('remote auth mapping and unsupported registered client refuse incomplete deployment',async t=>{
 const {root,project}=await fixture(t);const file=path.join(root,'mcp/registry.toml');
 await fs.writeFile(file,stringify({schema:1,servers:[{id:'demo',transport:'http',url:'https://example.test/mcp',status:'build-required',env_names:['AUTH_TOKEN']}]}));
 await assert.rejects(prepareMcpInstall(root,'opencode',project),/authentication mapping/);
 await fs.writeFile(file,stringify({schema:1,servers:[{id:'demo',transport:'stdio',command:'node',args:[],status:'build-required',clients:['codex']}]}));
 await assert.rejects(prepareMcpInstall(root,'opencode',project),/client not registered/);assert.deepEqual(await fs.readdir(project),[]);
});
test('rollback restore failure retains applied bytes and records recovery requirement',async t=>{
 const {root,project}=await fixture(t);const target=path.join(project,'opencode.json');await fs.writeFile(target,prior.opencode);const plan=await prepareMcpInstall(root,'opencode',project);await applyMcpInstall(root,plan.id,{approved:true});const applied=await fs.readFile(target);
 const originalWrite=fs.writeFile;fs.writeFile=async (dest,...args)=>{if(dest===target)throw new Error('injected restore failure');return originalWrite(dest,...args);};
 try{await assert.rejects(rollbackMcpInstall(root,plan.id,{approved:true}),/injected restore/);}finally{fs.writeFile=originalWrite;}
 assert.deepEqual(await fs.readFile(target),applied);const record=JSON.parse(await fs.readFile(path.join(path.dirname(plan.candidate),'change.json'),'utf8'));assert.equal(record.status,'FAILED');await fs.access(record.recovery_artifacts.displaced);
});

test('MCP source edits after review block apply without changing consumer config',async t=>{
 const {root,project}=await fixture(t);const plan=await prepareMcpInstall(root,'opencode',project);await fs.appendFile(path.join(root,'mcp/servers/demo/server.mjs'),' // changed');
 await assert.rejects(applyMcpInstall(root,plan.id,{approved:true}),/source changed/);await assert.rejects(fs.access(path.join(project,'opencode.json')));
});
