import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import {fileURLToPath} from 'node:url';
import {stringify,parse} from 'smol-toml';
import {createView,createProfileView,composeRules} from '../core/views.mjs';
import {loadCatalog,resolveProfile} from '../core/catalog.mjs';
import {publicUrl,limitedBody,checkUpstream} from '../providers/upstream.mjs';
import {tree} from '../core/files.mjs';
async function fixture(t) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hub-view-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 for(const p of ['skills/demo','catalog/assets','catalog/updates','catalog/profiles','experts','mcp','agents-md/base','agents-md/fragments'])await fs.mkdir(path.join(dir,p),{recursive:true});
 await fs.writeFile(path.join(dir,'skills/demo/SKILL.md'),'---\nname: demo\ndescription: Demo\n---\nTest\n');
 const hash=(await tree(path.join(dir,'skills/demo'))).sha256;
 await fs.writeFile(path.join(dir,'catalog/assets/demo.toml'),stringify({id:'demo',kind:'skills',path:'skills/demo',source:{kind:'trae-cdn',url:'https://example.test/artifact',discovery:'restricted'},version:{sha256:hash,upstream:'1',local:'1'}}));
 await fs.writeFile(path.join(dir,'experts/core.toml'),stringify({name:'core',skills:['demo'],mcp:[],plugins:[]}));
 await fs.writeFile(path.join(dir,'mcp/registry.toml'),stringify({schema:1,servers:[]}));
 await fs.writeFile(path.join(dir,'catalog/updates/skills.toml'),stringify({defaults:{check:true,download:true,apply:false},protection:{overwrite:false,auto_merge:false,preserve_local_changes:true,require_validation:true,require_approval:true}}));
 await fs.writeFile(path.join(dir,'agents-md/base/AGENTS.md'),'# AGENTS.md\nCommon rules\n');
 await fs.writeFile(path.join(dir,'agents-md/fragments/ui-acceptance.md'),'## UI\nClick to verify\n');
 return dir;
}
test('client views produce parseable config and standalone skill deployments',async t=>{
 const root=await fixture(t);const views=[];
 for(const client of ['codex','opencode','dsh','generic']) {
  const v=await createView(root,client,'core');views.push(v.destination);assert.equal(v.user_config_modified,false);assert.equal(v.skills.length,1);
  assert.equal(await fs.readFile(path.join(v.destination,'skills/demo/SKILL.md'),'utf8'),await fs.readFile(path.join(root,'skills/demo/SKILL.md'),'utf8'));
  if(client==='codex')assert.equal(Object.keys(parse(await fs.readFile(path.join(v.destination,'config.toml'),'utf8')).mcp_servers).length,0);
  if(client==='opencode')assert.ok(JSON.parse(await fs.readFile(path.join(v.destination,'opencode.json'),'utf8')).skills.paths[0].endsWith('skills'));
 }
 assert.equal(new Set(views).size,4);
 const dshView=views.find(x=>x.includes('dsh-'));assert.ok((await fs.readFile(path.join(dshView,'dsh-skills.yml'),'utf8')).includes('customSkillDirs'));
});
test('vendor review and duplicate client names block views without leaving partial view',async t=>{
 const root=await fixture(t);const p=path.join(root,'catalog/assets/demo.toml'),a=parse(await fs.readFile(p,'utf8'));a.runtime_review_required=true;await fs.writeFile(p,stringify(a));
 await assert.rejects(createView(root,'codex','core'),/Restricted/);assert.equal((await fs.readdir(path.join(root,'.asset-state/views'))).length,0);
 assert.equal((await createView(root,'generic','core',{allowRestricted:true})).skills.length,1);
});
test('composition is complete text and never overwrites project customization',async t=>{
 const root=await fixture(t),project=path.join(root,'project.md'),out=path.join(root,'AGENTS.candidate.md');await fs.writeFile(project,'## Project\nProject-specific rules');
 const r=await composeRules(root,project,out,{fragments:['ui-acceptance']});assert.equal(r.review_required,true);const s=await fs.readFile(out,'utf8');assert.ok(s.includes('Common rules'));assert.ok(s.includes('Click to verify'));assert.ok(s.includes('Project-specific'));
 await assert.rejects(composeRules(root,project,out),/exists/);assert.equal(await fs.readFile(out,'utf8'),s);
 await fs.writeFile(project,'[待填写]');await assert.rejects(composeRules(root,project,path.join(root,'bad.md')),/incomplete/);
});
test('restricted discovery is honest and makes no external request',async t=>{
 const root=await fixture(t);const r=await checkUpstream(root,'demo');assert.equal(r.status,'RESTRICTED');assert.ok(r.reason.includes('not been verified'));
});
test('URL policy rejects local addresses unsafe protocols credentials and ports',async()=>{
 for(const u of ['http://example.com','https://127.0.0.1/a','https://10.0.0.1/','https://localhost/','https://user:pass@example.com','https://example.com:123/','https://[::1]/','https://192.168.1.1/'])await assert.rejects(publicUrl(u));
});
test('download cap catches advertised and streamed excess',async()=>{
 await assert.rejects(limitedBody(new Response('abc',{headers:{'content-length':'1000'}}),5),/too large/);
 await assert.rejects(limitedBody(new Response('abcdef'),3),/too large/);
 assert.equal((await limitedBody(new Response('abc'),3)).toString(),'abc');
});

test('profiles compose expert and explicit assets without enabling user configuration',async t=>{
 const root=await fixture(t);
 for(const client of ['dsh','codex','opencode']) {
  const profile={schema:1,client,experts:['core'],skills:['demo'],mcp:[],plugins:[],enabled:false,deploy:'explicit',overwrite_user_config:false};
  await fs.writeFile(path.join(root,'catalog/profiles',client+'.toml'),stringify(profile));
  const selection=await resolveProfile(root,client,await loadCatalog(root));assert.deepEqual(selection.selected.skills,['demo']);
  const view=await createProfileView(root,client);assert.equal(view.skills.length,1);assert.equal(view.profile_enabled,false);assert.equal(view.user_config_modified,false);
  const stored=JSON.parse(await fs.readFile(path.join(view.destination,'view.json'),'utf8'));assert.equal(stored.profile_enabled,false);assert.equal(stored.explicit_selection,true);
  const record=JSON.parse(await fs.readFile(path.join(view.destination,'profile-selection.json'),'utf8'));assert.equal(record.client,client);assert.deepEqual(record.selected.skills,['demo']);
 }
});
test('profile validation rejects unsafe policy malformed lists and unknown assets before creating views',async t=>{
 const root=await fixture(t),file=path.join(root,'catalog/profiles/dsh.toml');
 const base={schema:1,client:'dsh',experts:['core'],skills:[],mcp:[],plugins:[],enabled:false,deploy:'explicit',overwrite_user_config:false};
 for(const change of [{overwrite_user_config:true},{schema:2},{client:'codex'},{enabled:'false'},{experts:'core'},{skills:['missing']},{mcp:['demo']},{plugins:['demo']}]) {
  await fs.writeFile(file,stringify({...base,...change}));await assert.rejects(createProfileView(root,'dsh'));
 }
 await assert.rejects(fs.access(path.join(root,'.asset-state/views')));
});

test('nonempty MCP views preserve stdio arguments and expose unsupported plugins honestly',async t=>{
 const root=await fixture(t);
 await fs.mkdir(path.join(root,'mcp/servers/demo'),{recursive:true});
 await fs.writeFile(path.join(root,'mcp/servers/demo/server.mjs'),'export const fixture = true;');
 const hash=(await tree(path.join(root,'mcp/servers/demo'))).sha256;
 await fs.writeFile(path.join(root,'catalog/assets/mcp.demo.toml'),stringify({id:'mcp.demo',kind:'mcp',path:'mcp/servers/demo',registry_id:'demo',source:{kind:'local',url:'https://example.test/demo'},version:{sha256:hash,local:'1',upstream:'1'}}));
 await fs.writeFile(path.join(root,'catalog/assets/plugin.demo.toml'),stringify({id:'plugin.demo',kind:'plugins',path:'skills/demo',source:{kind:'local',url:'https://example.test/plugin'},version:{sha256:(await tree(path.join(root,'skills/demo'))).sha256,local:'1',upstream:'1'}}));
 await fs.mkdir(path.join(root,'asset-manager'));await fs.copyFile(fileURLToPath(new URL('../mcp-launcher.mjs',import.meta.url)),path.join(root,'asset-manager/mcp-launcher.mjs'));
 await fs.writeFile(path.join(root,'mcp/registry.toml'),stringify({schema:1,servers:[{id:'demo',transport:'stdio',command:'node',args:['mcp/servers/demo/server.mjs','--safe'],cwd:'.',status:'build-required',env_names:[]}]}));
 await fs.writeFile(path.join(root,'experts/core.toml'),stringify({name:'core',skills:['demo'],mcp:['mcp.demo'],plugins:['plugin.demo']}));
 for(const client of ['codex','opencode','dsh','generic']) {
  const report=await createView(root,client,'core');assert.deepEqual(report.mcp_ids,['demo']);assert.equal(report.unsupported.length,1);assert.equal(report.unsupported[0].id,'plugin.demo');
  const expected=path.join(root,'mcp/servers/demo/server.mjs');
  if(client==='codex'){const doc=parse(await fs.readFile(path.join(report.destination,'config.toml'),'utf8'));assert.equal(doc.mcp_servers.demo.args[0],expected);assert.equal(doc.mcp_servers.demo.args[1],'--safe');}
  else if(client==='opencode'){const doc=JSON.parse(await fs.readFile(path.join(report.destination,'opencode.json'),'utf8'));assert.equal(doc.mcp.demo.command[0],process.execPath);const spec=JSON.parse(await fs.readFile(doc.mcp.demo.command[2],'utf8'));assert.deepEqual(spec.args,[expected,'--safe']);assert.equal(spec.cwd,root);}
  else {const doc=JSON.parse(await fs.readFile(path.join(report.destination,'mcp.json'),'utf8'));assert.equal(doc.mcpServers.demo.args[0],expected);if(client==='dsh'){const patch=YAML.parse(await fs.readFile(path.join(report.destination,'dsh-mcp.patch.yml'),'utf8'));assert.equal(patch[0].insert[0].config.transport,'stdio');assert.equal(patch[0].insert[0].config.serverName,'demo');}}
 }
});
test('duplicate client skill names reject the whole generated view',async t=>{
 const root=await fixture(t),hash=(await tree(path.join(root,'skills/demo'))).sha256;
 await fs.writeFile(path.join(root,'catalog/assets/other.toml'),stringify({id:'other',kind:'skills',path:'skills/demo',source:{kind:'local',url:'https://example.test/other'},version:{sha256:hash,local:'1',upstream:'1'}}));
 await fs.writeFile(path.join(root,'experts/core.toml'),stringify({name:'core',skills:['demo','other']}));
 await assert.rejects(createView(root,'generic','core'),/Multiple assets/);assert.deepEqual(await fs.readdir(path.join(root,'.asset-state/views')),[]);
});
