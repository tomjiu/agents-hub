import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {stringify} from 'smol-toml';
import {tree} from '../core/files.mjs';
import {planDeployment,deployProfile,inspectDeployment,uninstallDeployment,deployedDigest} from '../core/deployment.mjs';

async function setup(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hub-deploy-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const root=path.join(dir,'hub'),project=path.join(dir,'project');await fs.mkdir(project);
 for(const p of ['skills/demo','catalog/assets','catalog/profiles','experts','mcp'])await fs.mkdir(path.join(root,p),{recursive:true});
 const text='---\nname: demo\ndescription: Test deployment\n---\nReal skill body\n';
 await fs.writeFile(path.join(root,'skills/demo/SKILL.md'),text);
 const baseline=await tree(path.join(root,'skills/demo'));
 await fs.writeFile(path.join(root,'catalog/assets/demo.toml'),stringify({id:'demo',kind:'skills',path:'skills/demo',source:{kind:'local',url:'https://example.test/demo'},version:{sha256:baseline.sha256,local:'1',upstream:'1'}}));
 await fs.writeFile(path.join(root,'experts/core.toml'),stringify({name:'core',skills:['demo'],mcp:[],plugins:[]}));
 await fs.writeFile(path.join(root,'mcp/registry.toml'),stringify({schema:1,servers:[]}));
 for(const client of ['dsh','codex','opencode'])await fs.writeFile(path.join(root,'catalog/profiles',client+'.toml'),stringify({schema:1,client,experts:['core'],skills:[],mcp:[],plugins:[],enabled:false,deploy:'explicit',overwrite_user_config:false}));
 return {root,project,text,dir};
}
const roots={dsh:'.dsh/skills',codex:'.agents/skills',opencode:'.opencode/skills'};
test('preview is read-only for consumer and deploy requires explicit approval',async t=>{
 const {root,project}=await setup(t);const p=await planDeployment(root,'dsh',project);
 assert.equal(p.approved,false);assert.deepEqual(p.conflicts,[]);assert.equal(p.profile_enabled,false);
 assert.deepEqual(await fs.readdir(project),[]);await assert.rejects(deployProfile(root,'dsh',project),/approval/);assert.deepEqual(await fs.readdir(project),[]);
});
test('approved deployment installs each client project root and preserves existing config',async t=>{
 const {root,project,text}=await setup(t);await fs.writeFile(path.join(project,'AGENTS.md'),'User project rules');
 for(const [client,rel] of Object.entries(roots)){
  const config=path.join(project,client+'.config');await fs.writeFile(config,'user-owned configuration');
  const receipt=await deployProfile(root,client,project,{approved:true});assert.equal(receipt.status,'INSTALLED');assert.equal(receipt.config_modified,false);
  assert.equal(await fs.readFile(path.join(project,rel,'demo/SKILL.md'),'utf8'),text);
  const check=await inspectDeployment(root,project,receipt.id);assert.equal(check.skills[0].matches,true);
  const removed=await uninstallDeployment(root,project,receipt.id,{approved:true});assert.equal(removed.status,'REMOVED');assert.equal(removed.quarantined,1);
  await assert.rejects(fs.access(path.join(project,rel,'demo')));assert.equal(await fs.readFile(path.join(project,removed.quarantine,'demo/SKILL.md'),'utf8'),text);
  assert.equal(await fs.readFile(config,'utf8'),'user-owned configuration');await assert.rejects(uninstallDeployment(root,project,receipt.id,{approved:true}),/already removed/);
 }
 assert.equal(await fs.readFile(path.join(project,'AGENTS.md'),'utf8'),'User project rules');
 assert.equal(await fs.readFile(path.join(root,'skills/demo/SKILL.md'),'utf8'),text);
});
test('existing skill conflict blocks all writes without adopting user content',async t=>{
 const {root,project}=await setup(t);const dir=path.join(project,'.dsh/skills/demo');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'SKILL.md'),'Existing custom skill');
 const plan=await planDeployment(root,'dsh',project);assert.deepEqual(plan.conflicts,['.dsh/skills/demo']);
 await assert.rejects(deployProfile(root,'dsh',project,{approved:true}),/conflicts/);assert.equal(await fs.readFile(path.join(dir,'SKILL.md'),'utf8'),'Existing custom skill');
 await assert.rejects(fs.access(path.join(project,'.agents-hub/deployments')));await assert.rejects(fs.access(path.join(project,'.agents-hub/operation.lock')));
});
test('uninstall refuses local modifications and leaves installed content untouched',async t=>{
 const {root,project}=await setup(t);const r=await deployProfile(root,'dsh',project,{approved:true});const p=path.join(project,r.skills[0].path,'SKILL.md');await fs.appendFile(p,'Local note');
 await assert.rejects(uninstallDeployment(root,project,r.id,{approved:true}),/Local changes/);assert.match(await fs.readFile(p,'utf8'),/Local note/);
 const check=await inspectDeployment(root,project,r.id);assert.equal(check.status,'INSTALLED');assert.equal(check.skills[0].matches,false);
});
test('excluded source-cache names and empty new directories still block uninstall',async t=>{
 const {root,project}=await setup(t);const r=await deployProfile(root,'dsh',project,{approved:true});const base=path.join(project,r.skills[0].path);
 for(const name of ['node_modules','dist','.git','empty-user-folder']){
  await fs.mkdir(path.join(base,name));await assert.rejects(uninstallDeployment(root,project,r.id,{approved:true}),/Local changes/);await fs.rmdir(path.join(base,name));
 }
 await fs.writeFile(path.join(base,'.user-note'),'keep me');await assert.rejects(uninstallDeployment(root,project,r.id,{approved:true}),/Local changes/);
});
test('uninstall approval and receipt path validation prevent unauthorized removal',async t=>{
 const {root,project}=await setup(t);const r=await deployProfile(root,'dsh',project,{approved:true});
 await assert.rejects(uninstallDeployment(root,project,r.id),/approval/);await assert.rejects(inspectDeployment(root,project,'../../elsewhere'),/Invalid deployment ID/);
 const file=path.join(project,'.agents-hub/deployments',r.id+'.json');const doc=JSON.parse(await fs.readFile(file,'utf8'));doc.skills[0].path='../unrelated';await fs.writeFile(file,JSON.stringify(doc));
 await assert.rejects(uninstallDeployment(root,project,r.id,{approved:true}),/Unsafe/);await fs.access(path.join(project,'.dsh/skills/demo/SKILL.md'));
});
test('consumer lock fails closed and is never removed by another operation',async t=>{
 const {root,project}=await setup(t);await fs.mkdir(path.join(project,'.agents-hub'));const lock=path.join(project,'.agents-hub/operation.lock');await fs.writeFile(lock,'another operation');
 await assert.rejects(deployProfile(root,'dsh',project,{approved:true}),/lock exists/);assert.equal(await fs.readFile(lock,'utf8'),'another operation');
});
test('project inside maintenance repository and nonexistent target are rejected',async t=>{
 const {root,project}=await setup(t);await assert.rejects(planDeployment(root,'dsh',root),/consumer/);await assert.rejects(planDeployment(root,'dsh',path.join(root,'skills/demo')),/consumer/);
 await assert.rejects(planDeployment(root,'unknown',project),/Unknown/);await assert.rejects(planDeployment(root,'dsh',path.join(project,'absent')));
});
test('MCP/plugin selections refuse partial skill-only deployment',async t=>{
 const {root,project}=await setup(t);
 const source=await tree(path.join(root,'skills/demo'));
 await fs.writeFile(path.join(root,'catalog/assets/plugin.demo.toml'),stringify({id:'plugin.demo',kind:'plugins',path:'skills/demo',source:{kind:'local'},version:{sha256:source.sha256}}));
 const profile={schema:1,client:'dsh',experts:['core'],plugins:['plugin.demo'],enabled:false,deploy:'explicit',overwrite_user_config:false};await fs.writeFile(path.join(root,'catalog/profiles/dsh.toml'),stringify(profile));
 await assert.rejects(planDeployment(root,'dsh',project),/supports skills only/);assert.deepEqual(await fs.readdir(project),[]);
});
test('linked consumer skills root is rejected before writes',async t=>{
 const {root,project,dir}=await setup(t);await fs.mkdir(path.join(project,'.dsh'));const external=path.join(dir,'external');await fs.mkdir(external);
 await fs.symlink(external,path.join(project,'.dsh/skills'),'junction');await assert.rejects(planDeployment(root,'dsh',project),/Links/);assert.deepEqual(await fs.readdir(external),[]);
});
test('removal is idempotent with absent installed path and retains receipt history',async t=>{
 const {root,project}=await setup(t);const r=await deployProfile(root,'dsh',project,{approved:true});await fs.rm(path.join(project,r.skills[0].path),{recursive:true});
 const result=await uninstallDeployment(root,project,r.id,{approved:true});assert.equal(result.quarantined,0);const history=await inspectDeployment(root,project,r.id);assert.equal(history.status,'REMOVED');
});

test('failed or prepared receipt cannot adopt and remove unconfirmed matching content',async t=>{
 const {root,project}=await setup(t);const r=await deployProfile(root,'dsh',project,{approved:true});const file=path.join(project,'.agents-hub/deployments',r.id+'.json');
 const doc=JSON.parse(await fs.readFile(file,'utf8'));doc.status='FAILED';doc.skills[0].installed=false;await fs.writeFile(file,JSON.stringify(doc));
 await assert.rejects(uninstallDeployment(root,project,r.id,{approved:true}),/Unconfirmed/);await fs.access(path.join(project,doc.skills[0].path,'SKILL.md'));
});

test('one conflict blocks an entire multi-skill deployment before copying any skill',async t=>{
 const {root,project}=await setup(t);await fs.mkdir(path.join(root,'skills/second'));
 await fs.writeFile(path.join(root,'skills/second/SKILL.md'),'---\nname: second\ndescription: Another skill\n---\nSecond body');
 const hash=(await tree(path.join(root,'skills/second'))).sha256;
 await fs.writeFile(path.join(root,'catalog/assets/second.toml'),stringify({id:'second',kind:'skills',path:'skills/second',source:{kind:'local'},version:{sha256:hash}}));
 await fs.writeFile(path.join(root,'experts/core.toml'),stringify({name:'core',skills:['demo','second']}));
 await fs.mkdir(path.join(project,'.dsh/skills/second'),{recursive:true});await fs.writeFile(path.join(project,'.dsh/skills/second/SKILL.md'),'User-owned second');
 await assert.rejects(deployProfile(root,'dsh',project,{approved:true}),/conflicts/);await assert.rejects(fs.access(path.join(project,'.dsh/skills/demo')));
 assert.equal(await fs.readFile(path.join(project,'.dsh/skills/second/SKILL.md'),'utf8'),'User-owned second');
});
test('one edited skill prevents partially uninstalling a multi-skill receipt',async t=>{
 const {root,project}=await setup(t);await fs.mkdir(path.join(root,'skills/second'));
 await fs.writeFile(path.join(root,'skills/second/SKILL.md'),'---\nname: second\ndescription: Another skill\n---\nSecond body');
 const hash=(await tree(path.join(root,'skills/second'))).sha256;
 await fs.writeFile(path.join(root,'catalog/assets/second.toml'),stringify({id:'second',kind:'skills',path:'skills/second',source:{kind:'local'},version:{sha256:hash}}));
 await fs.writeFile(path.join(root,'experts/core.toml'),stringify({name:'core',skills:['demo','second']}));
 const receipt=await deployProfile(root,'dsh',project,{approved:true});await fs.appendFile(path.join(project,'.dsh/skills/second/SKILL.md'),'Consumer local edit');
 await assert.rejects(uninstallDeployment(root,project,receipt.id,{approved:true}),/Local changes/);await fs.access(path.join(project,'.dsh/skills/demo/SKILL.md'));await fs.access(path.join(project,'.dsh/skills/second/SKILL.md'));
 await assert.rejects(fs.access(path.join(project,'.agents-hub/quarantine',receipt.id)));
});

test('concurrent deployment for one project produces a single owner and never duplicate copies',async t=>{
 const {root,project}=await setup(t);
 const results=await Promise.allSettled([deployProfile(root,'dsh',project,{approved:true}),deployProfile(root,'dsh',project,{approved:true})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const installed=results.find(r=>r.status==='fulfilled').value;assert.equal(installed.status,'INSTALLED');
 assert.deepEqual(await fs.readdir(path.join(project,'.agents-hub/deployments')),[installed.id+'.json']);
 assert.deepEqual(await fs.readdir(path.join(project,'.dsh/skills')),['demo']);
 await assert.rejects(fs.access(path.join(project,'.agents-hub/operation.lock')));
});
test('interrupted uninstall state refuses another removal and retains quarantine ownership',async t=>{
 const {root,project}=await setup(t);const r=await deployProfile(root,'dsh',project,{approved:true});
 const receipt=path.join(project,'.agents-hub/deployments',r.id+'.json'),doc=JSON.parse(await fs.readFile(receipt,'utf8'));doc.status='REMOVING';await fs.writeFile(receipt,JSON.stringify(doc));
 await assert.rejects(uninstallDeployment(root,project,r.id,{approved:true}),/interrupted/);
 await fs.access(path.join(project,'.dsh/skills/demo/SKILL.md'));assert.equal((await inspectDeployment(root,project,r.id)).status,'REMOVING');
});

test('actual CLI previews deploys inspects and quarantines default DSH Profile without changing project rules',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hub-cli-consumer-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'AGENTS.md'),'User-authored project policy');
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 const cli=path.join(root,'asset-manager/cli.mjs');
 const call=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd:root,maxBuffer:4*1024*1024}).toString());
 const preview=call('plan-deploy','dsh',dir);assert.equal(preview.skills.length,7);assert.equal(preview.approved,false);
 assert.deepEqual(await fs.readdir(dir),['AGENTS.md']);
 const result=call('deploy','dsh',dir,'--approve');assert.equal(result.status,'INSTALLED');assert.equal(result.skills.length,7);
 const state=call('inspect-deployment',dir,result.id);assert.ok(state.skills.every(s=>s.matches));
 const removed=call('uninstall',dir,result.id,'--approve');assert.equal(removed.quarantined,7);
 assert.equal(await fs.readFile(path.join(dir,'AGENTS.md'),'utf8'),'User-authored project policy');
 assert.deepEqual(await fs.readdir(path.join(dir,'.dsh/skills')),[]);
});
