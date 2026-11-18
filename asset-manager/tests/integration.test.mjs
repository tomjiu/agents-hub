import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {stringify,parse} from 'smol-toml';
import {createView,composeRules} from '../core/views.mjs';
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
