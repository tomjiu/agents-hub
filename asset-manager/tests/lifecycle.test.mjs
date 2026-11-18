import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {stringify} from 'smol-toml';
import {tree,confined,compareTrees} from '../core/files.mjs';
import {stage,inspect,validateVersion,approve,activate,rollback,effectivePath,exportLocks} from '../core/lifecycle.mjs';
import {loadCatalog,resolveExpert} from '../core/catalog.mjs';
import {exportRecovery,restoreRecovery} from '../core/recovery.mjs';
async function setup(t) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'agents-hub-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const root=path.join(dir,'hub'),incoming=path.join(dir,'incoming');
 await fs.mkdir(path.join(root,'skills/demo'),{recursive:true});await fs.mkdir(incoming);
 const base='---\nname: demo\ndescription: Demo test skill\n---\nbase\n';
 await fs.writeFile(path.join(root,'skills/demo/SKILL.md'),base);await fs.writeFile(path.join(incoming,'SKILL.md'),base+'incoming\n');
 for(const p of ['catalog/assets','catalog/updates','catalog/provenance','experts'])await fs.mkdir(path.join(root,p),{recursive:true});
 const baseline=await tree(path.join(root,'skills/demo'));
 await fs.writeFile(path.join(root,'catalog/assets/demo.toml'),stringify({id:'demo',kind:'skills',path:'skills/demo',source:{kind:'local',url:'https://example.test/demo'},version:{sha256:baseline.sha256,upstream:'1',local:'1'}}));
 await fs.writeFile(path.join(root,'catalog/provenance/demo.json'),JSON.stringify(baseline));
 await fs.writeFile(path.join(root,'catalog/updates/skills.toml'),stringify({defaults:{check:true,download:true,apply:false},protection:{overwrite:false,auto_merge:false,preserve_local_changes:true,require_validation:true,require_approval:true}}));
 return {dir,root,incoming,base};
}
async function review(root,version) {assert.equal((await validateVersion(root,'demo',version)).status,'VALIDATED');await approve(root,'demo',version,{reviewer:'test human',note:'Reviewed isolated fixture; no external calls'});}
test('staging never modifies checkout and activation requires approval',async t=>{
 const {root,incoming,base}=await setup(t);const s=await stage(root,'demo',incoming);
 assert.equal(await fs.readFile(path.join(root,'skills/demo/SKILL.md'),'utf8'),base);
 assert.equal((await inspect(root,'demo')).active,null);
 await assert.rejects(activate(root,'demo',s.version));await review(root,s.version);
 const state=await activate(root,'demo',s.version,{expectedRevision:0});assert.equal(state.revision,1);
 const c=(await loadCatalog(root)).get('demo');assert.match(await fs.readFile(path.join(await effectivePath(root,c),'SKILL.md'),'utf8'),/incoming/);
 await assert.rejects(activate(root,'demo',s.version,{expectedRevision:0}),/Stale/);
 await rollback(root,'demo',{expectedRevision:1});assert.equal(await effectivePath(root,c),path.join(root,'skills/demo'));
 await assert.rejects(rollback(root,'demo'),/No activation history/);
 assert.equal(await fs.readFile(path.join(root,'skills/demo/SKILL.md'),'utf8'),base);
});
test('local changes survive stage and require explicit human resolution',async t=>{
 const {root,incoming,base}=await setup(t);const p=path.join(root,'skills/demo/SKILL.md');await fs.writeFile(p,base+'local\n');
 const s=await stage(root,'demo',incoming);assert.equal(s.local_modified,true);assert.ok(s.diff.some(d=>d.conflict));
 await validateVersion(root,'demo',s.version);await assert.rejects(approve(root,'demo',s.version,{reviewer:'test',note:'review'}),/Local edits/);
 await approve(root,'demo',s.version,{reviewer:'test',note:'Keeping local checkout; selecting reviewed independent incoming version',resolveLocalChanges:true});
 await activate(root,'demo',s.version);assert.equal(await fs.readFile(p,'utf8'),base+'local\n');
});
test('changed checkout after review blocks activation',async t=>{
 const {root,incoming,base}=await setup(t);const s=await stage(root,'demo',incoming);await review(root,s.version);
 await fs.writeFile(path.join(root,'skills/demo/SKILL.md'),base+'new local edits');
 await assert.rejects(activate(root,'demo',s.version),/checkout changed/);assert.equal((await inspect(root,'demo')).active,null);
});
test('corrupted snapshot, failed validation and bad checksum preserve current',async t=>{
 const {root,incoming}=await setup(t);await assert.rejects(stage(root,'demo',incoming,{expectedSha256:'0'.repeat(64)}),/checksum/);
 const s=await stage(root,'demo',incoming);await fs.writeFile(path.join(root,'.asset-state/versions/demo',s.version,'content/SKILL.md'),'corrupt');
 assert.equal((await validateVersion(root,'demo',s.version)).status,'FAILED');await assert.rejects(approve(root,'demo',s.version,{reviewer:'test',note:'bad'}),/validation/);
 assert.equal((await inspect(root,'demo')).active,null);
});
test('tampering after approval is detected',async t=>{
 const {root,incoming}=await setup(t);const s=await stage(root,'demo',incoming);await review(root,s.version);
 await fs.writeFile(path.join(root,'.asset-state/versions/demo',s.version,'content/SKILL.md'),'changed');
 await assert.rejects(activate(root,'demo',s.version),/Integrity/);
});
test('private files fail validation rather than becoming active',async t=>{
 const {root,incoming}=await setup(t);await fs.writeFile(path.join(incoming,'credentials.json'),'{}');const s=await stage(root,'demo',incoming);
 const v=await validateVersion(root,'demo',s.version);assert.equal(v.status,'FAILED');assert.ok(v.errors.some(x=>x.includes('credential')));
});
test('rollback twice restores successive approved snapshots and then baseline',async t=>{
 const {root,incoming,base}=await setup(t);const a=await stage(root,'demo',incoming);await review(root,a.version);await activate(root,'demo',a.version);
 await fs.writeFile(path.join(incoming,'SKILL.md'),base+'second\n');const b=await stage(root,'demo',incoming);await review(root,b.version);await activate(root,'demo',b.version);
 const c=(await loadCatalog(root)).get('demo');await rollback(root,'demo');assert.ok((await effectivePath(root,c)).includes(a.version));
 await rollback(root,'demo');assert.equal(await effectivePath(root,c),path.join(root,'skills/demo'));
});
test('operation lock fails closed and never deletes another operation lock',async t=>{
 const {root,incoming}=await setup(t);await fs.mkdir(path.join(root,'.asset-state'));await fs.writeFile(path.join(root,'.asset-state/operation.lock'),'owned by other job');
 await assert.rejects(stage(root,'demo',incoming),/holds lock/);assert.equal(await fs.readFile(path.join(root,'.asset-state/operation.lock'),'utf8'),'owned by other job');
});
test('invalid relative paths and symlinked asset content are rejected',async t=>{
 const {root,incoming}=await setup(t);for(const p of ['../escape','/tmp/file','a/../b','a\\b','a:stream','nul','target.'])await assert.rejects(confined(root,p,{mustExist:false}));
 const link=path.join(incoming,'linked');try{await fs.symlink(path.join(root,'skills/demo'),link,'junction');}catch(e){if(e.code==='EPERM'){t.skip('Windows link privilege unavailable');return;}throw e;}
 await assert.rejects(stage(root,'demo',incoming),/symlink/);
});
test('expert missing reference, wrong asset kind and inheritance cycle fail',async t=>{
 const {root}=await setup(t);const write=(name,v)=>fs.writeFile(path.join(root,'experts',name+'.toml'),stringify({name,...v}));
 await write('bad',{skills:['missing']});await assert.rejects(resolveExpert(root,'bad',await loadCatalog(root)),/invalid/);
 await write('wrong',{mcp:['demo']});await assert.rejects(resolveExpert(root,'wrong',await loadCatalog(root)),/invalid/);
 await write('a',{extends:['b']});await write('b',{extends:['a']});await assert.rejects(resolveExpert(root,'a',await loadCatalog(root)),/cycle/);
});
test('locks export only to a new directory and reflects selected versions',async t=>{
 const {root,incoming,dir}=await setup(t);const s=await stage(root,'demo',incoming);await review(root,s.version);await activate(root,'demo',s.version);
 const dest=path.join(dir,'locks');await exportLocks(root,dest);const text=await fs.readFile(path.join(dest,'skills.lock.toml'),'utf8');assert.ok(text.includes(s.version));
 await assert.rejects(exportLocks(root,dest));
});
test('three-way comparison handles independent edits and deletion',()=>{
 const t=files=>({files:Object.entries(files).map(([path,sha256])=>({path,sha256}))});
 const d=compareTrees(t({a:'base',b:'same'}),t({a:'local',b:'same'}),t({a:'base'}));
 assert.equal(d.find(x=>x.path==='a').conflict,false);assert.equal(d.find(x=>x.path==='b').incoming,null);
});

test('recovery preserves snapshot bytes and never silently activates or overwrites',async t=>{
 const {root,incoming,dir}=await setup(t);const s=await stage(root,'demo',incoming);await review(root,s.version);await activate(root,'demo',s.version);
 const bundle=path.join(dir,'recovery');await exportRecovery(root,bundle);
 const target=path.join(dir,'clean-hub');await fs.cp(root,target,{recursive:true,filter:p=>!p.includes('.asset-state')});
 const restored=await restoreRecovery(target,bundle);assert.equal(restored.restored,1);assert.equal(restored.activated,false);assert.equal((await inspect(target,'demo')).active,null);
 await assert.rejects(restoreRecovery(target,bundle),/exists/);await activate(target,'demo',s.version);assert.equal((await inspect(target,'demo')).active.version,s.version);
 await fs.writeFile(path.join(bundle,'demo',s.version,'content/SKILL.md'),'tamper');const another=path.join(dir,'another-hub');await fs.cp(root,another,{recursive:true,filter:p=>!p.includes('.asset-state')});
 await assert.rejects(restoreRecovery(another,bundle),/integrity/);assert.equal((await inspect(another,'demo')).active,null);
});
test('malformed frontmatter cannot pass validation with field-like body text',async t=>{
 const {root,incoming}=await setup(t);await fs.writeFile(path.join(incoming,'SKILL.md'),'---\ninvalid: [\n---\nname: demo\ndescription: body only\n');const s=await stage(root,'demo',incoming);
 assert.equal((await validateVersion(root,'demo',s.version)).status,'FAILED');
});

test('recovery includes historical versions needed for successive rollbacks',async t=>{
 const {root,incoming,dir,base}=await setup(t);
 const a=await stage(root,'demo',incoming);await review(root,a.version);await activate(root,'demo',a.version);
 await fs.writeFile(path.join(incoming,'SKILL.md'),base+'second version');const b=await stage(root,'demo',incoming);await review(root,b.version);await activate(root,'demo',b.version);
 const bundle=path.join(dir,'history-recovery');const exported=await exportRecovery(root,bundle);assert.equal(exported.versions,2,'Export must include both current and previous snapshots');
 const target=path.join(dir,'history-clean');await fs.cp(root,target,{recursive:true,filter:p=>!p.includes('.asset-state')});
 const restored=await restoreRecovery(target,bundle);assert.equal(restored.restored,2);assert.equal(restored.activated,false);
});
