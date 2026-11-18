import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {stringify} from 'smol-toml';
import {tree,sha256} from '../core/files.mjs';
import {stage,validateVersion,approve,activate,rollback,inspect} from '../core/lifecycle.mjs';
import {exportRecovery,restoreRecovery,inspectRecovery,restoreRecoverySelection} from '../core/recovery.mjs';
async function setup(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hub-recover-history-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const root=path.join(dir,'hub'),incoming=path.join(dir,'incoming');await fs.mkdir(incoming);
 for(const p of ['skills/demo','catalog/assets','catalog/provenance','catalog/updates'])await fs.mkdir(path.join(root,p),{recursive:true});
 const base=['---','name: demo','description: recovery fixture','---','baseline'].join(String.fromCharCode(10));await fs.writeFile(path.join(root,'skills/demo/SKILL.md'),base);
 const snapshot=await tree(path.join(root,'skills/demo'));await fs.writeFile(path.join(root,'catalog/assets/demo.toml'),stringify({id:'demo',kind:'skills',path:'skills/demo',source:{kind:'local'},version:{sha256:snapshot.sha256,local:'1',upstream:'unknown'}}));await fs.writeFile(path.join(root,'catalog/provenance/demo.json'),JSON.stringify(snapshot));
 await fs.writeFile(path.join(root,'catalog/updates/skills.toml'),stringify({defaults:{check:true,download:true,apply:false},protection:{overwrite:false,auto_merge:false,preserve_local_changes:true,require_validation:true,require_approval:true}}));
 const add=async text=>{await fs.writeFile(path.join(incoming,'SKILL.md'),base+String.fromCharCode(10)+text);const version=await stage(root,'demo',incoming);await validateVersion(root,'demo',version.version);await approve(root,'demo',version.version,{reviewer:'test-human',note:'Reviewed fixture only'});await activate(root,'demo',version.version);return version;};
 const clean=async name=>{const target=path.join(dir,name);await fs.cp(root,target,{recursive:true,filter:p=>!p.includes('.asset-state')});return target;};return {dir,root,incoming,base,add,clean};
}
const approveSelection={approved:true,reviewer:'test-human',note:'Explicitly recover isolated state'};
async function absentState(root){await assert.rejects(fs.access(path.join(root,'.asset-state/active.json')));}
test('three recovered versions restore selection only on approval then rollback successively to baseline',async t=>{
 const {dir,root,add,clean,base}=await setup(t);const a=await add('A'),b=await add('B'),c=await add('C');const bundle=path.join(dir,'backup');assert.equal((await exportRecovery(root,bundle)).versions,3);
 const target=await clean('restore');const preview=await inspectRecovery(target,bundle);assert.equal(preview.history_complete,true);assert.equal(preview.versions.length,3);
 await assert.rejects(restoreRecoverySelection(target,bundle,approveSelection),/Restore all version/);await absentState(target);
 assert.equal((await restoreRecovery(target,bundle)).restored,3);await absentState(target);await assert.rejects(restoreRecoverySelection(target,bundle),/approval/);await absentState(target);
 const selected=await restoreRecoverySelection(target,bundle,approveSelection);assert.equal(selected.selected,1);assert.equal(selected.services_started,false);assert.equal(selected.revision,4);assert.equal((await inspect(target,'demo')).active.version,c.version);
 await rollback(target,'demo',{expectedRevision:4});assert.equal((await inspect(target,'demo')).active.version,b.version);await rollback(target,'demo');assert.equal((await inspect(target,'demo')).active.version,a.version);await rollback(target,'demo');assert.equal((await inspect(target,'demo')).active,null);assert.equal(await fs.readFile(path.join(target,'skills/demo/SKILL.md'),'utf8'),base);
 await assert.rejects(restoreRecoverySelection(target,bundle,approveSelection),/Existing selection/);
});
test('history remains consistent after rollback followed by new activation and after returning to baseline',async t=>{
 const {dir,root,add,clean}=await setup(t);const a=await add('A');await add('B');await rollback(root,'demo');const c=await add('C');const bundle=path.join(dir,'backup');assert.equal((await exportRecovery(root,bundle)).versions,3);
 const target=await clean('restore');await restoreRecovery(target,bundle);await restoreRecoverySelection(target,bundle,approveSelection);assert.equal((await inspect(target,'demo')).active.version,c.version);await rollback(target,'demo');assert.equal((await inspect(target,'demo')).active.version,a.version);await rollback(target,'demo');assert.equal((await inspect(target,'demo')).active,null);
 await rollback(root,'demo');await rollback(root,'demo');const baselineBundle=path.join(dir,'baseline-backup');assert.equal((await exportRecovery(root,baselineBundle)).versions,3);const second=await clean('baseline-restore');await restoreRecovery(second,baselineBundle);assert.equal((await restoreRecoverySelection(second,baselineBundle,approveSelection)).selected,0);await assert.rejects(rollback(second,'demo'),/No activation history/);
});
test('schema1 contents still restore but incomplete historical selection is never applied',async t=>{
 const {dir,root,add,clean}=await setup(t);const version=await add('A'),legacy=path.join(dir,'legacy');await fs.mkdir(legacy);const versionDir=path.join(root,'.asset-state/versions/demo',version.version);await fs.cp(versionDir,path.join(legacy,'demo'),{recursive:true});
 await fs.writeFile(path.join(legacy,'recovery.json'),JSON.stringify({schema:1,revision:1,records:[{id:'demo',kind:'skills',version:version.version,sha256:version.sha256,bundle_sha256:(await tree(path.join(legacy,'demo'))).sha256}]}));
 const target=await clean('legacy-restore');assert.equal((await inspectRecovery(target,legacy)).history_complete,false);await restoreRecovery(target,legacy);await absentState(target);await assert.rejects(restoreRecoverySelection(target,legacy,approveSelection),/Legacy/);await absentState(target);await activate(target,'demo',version.version);assert.equal((await inspect(target,'demo')).active.version,version.version);
});
test('missing older version blocks export and does not leave a partial backup',async t=>{
 const {dir,root,add}=await setup(t);const a=await add('A');await add('B');await fs.rm(path.join(root,'.asset-state/versions/demo',a.version),{recursive:true});const bundle=path.join(dir,'bad-backup');await assert.rejects(exportRecovery(root,bundle));await assert.rejects(fs.access(bundle));
});
test('tampered selection history and incomplete version closure are rejected before restore',async t=>{
 const {dir,root,add,clean}=await setup(t);await add('A');await add('B');const bundle=path.join(dir,'backup');await exportRecovery(root,bundle);const file=path.join(bundle,'recovery.json'),original=JSON.parse(await fs.readFile(file,'utf8')),target=await clean('restore');
 const bad={...original,records:original.records.slice(1)};await fs.writeFile(file,JSON.stringify(bad));await assert.rejects(restoreRecovery(target,bundle),/closure incomplete/);await absentState(target);
 const manipulated=structuredClone(original);manipulated.selection.history[1].previous=null;manipulated.selection_sha256=sha256(JSON.stringify(manipulated.selection));await fs.writeFile(file,JSON.stringify(manipulated));await assert.rejects(restoreRecovery(target,bundle),/history mismatch/);await absentState(target);
 const changed=structuredClone(original);changed.selection.revision++;await fs.writeFile(file,JSON.stringify(changed));await assert.rejects(inspectRecovery(target,bundle),/selection integrity/);
});
test('changed restored approval or checkout is preserved and blocks selection',async t=>{
 const {dir,root,add,clean,base}=await setup(t);const a=await add('A');const bundle=path.join(dir,'backup');await exportRecovery(root,bundle);const target=await clean('restore');await restoreRecovery(target,bundle);
 const approval=path.join(target,'.asset-state/versions/demo',a.version,'approval.json'),original=await fs.readFile(approval);await fs.appendFile(approval,' ');await assert.rejects(restoreRecoverySelection(target,bundle,approveSelection),/record changed/);await fs.writeFile(approval,original);await absentState(target);
 await fs.writeFile(path.join(target,'skills/demo/SKILL.md'),base+'local customization');await assert.rejects(restoreRecoverySelection(target,bundle,approveSelection),/checkout differs/);assert.match(await fs.readFile(path.join(target,'skills/demo/SKILL.md'),'utf8'),/customization/);await absentState(target);
});
test('copy failure rolls back owned restored versions without changing existing source',async t=>{
 const {dir,root,add,clean}=await setup(t);await add('A');await add('B');const bundle=path.join(dir,'backup');await exportRecovery(root,bundle);const target=await clean('restore'),original=fs.writeFile;let approvals=0;
 fs.writeFile=async (dest,...args)=>{if(String(dest).startsWith(target)&&String(dest).endsWith('approval.json')&&++approvals===2)throw new Error('Injected restore write failure');return original(dest,...args);};
 try{await assert.rejects(restoreRecovery(target,bundle),/write failure/);}finally{fs.writeFile=original;}
 assert.deepEqual(await fs.readdir(path.join(target,'.asset-state/versions/demo')),[]);await absentState(target);assert.equal((await inspect(root,'demo')).active!==null,true);
});
test('selection publish failure and concurrent state are preserved without overwrite',async t=>{
 const {dir,root,add,clean}=await setup(t);await add('A');const bundle=path.join(dir,'backup');await exportRecovery(root,bundle);const target=await clean('restore');await restoreRecovery(target,bundle);const file=path.join(target,'.asset-state/active.json'),original=fs.link;
 fs.link=async (source,dest)=>{if(dest===file){await fs.writeFile(file,'user-created state',{flag:'wx'});throw new Error('Concurrent publish');}return original(source,dest);};
 try{await assert.rejects(restoreRecoverySelection(target,bundle,approveSelection),/Concurrent publish/);}finally{fs.link=original;}
 assert.equal(await fs.readFile(file,'utf8'),'user-created state');assert.ok((await fs.readdir(path.join(target,'.asset-state/recovery-selections'))).every(name=>!name.endsWith('.state.json')));
});
test('export and restore locks fail closed, links and duplicate records are rejected',async t=>{
 const {dir,root,add,clean}=await setup(t);await add('A');const bundle=path.join(dir,'backup');await exportRecovery(root,bundle);await assert.rejects(exportRecovery(root,bundle),/target exists/);
 await fs.writeFile(path.join(root,'.asset-state/operation.lock'),'existing owner');await assert.rejects(exportRecovery(root,path.join(dir,'locked-backup')),/holds lock/);assert.equal(await fs.readFile(path.join(root,'.asset-state/operation.lock'),'utf8'),'existing owner');await fs.unlink(path.join(root,'.asset-state/operation.lock'));
 const target=await clean('restore');await fs.mkdir(path.join(target,'.asset-state'));await fs.mkdir(path.join(dir,'external'));await fs.symlink(path.join(dir,'external'),path.join(target,'.asset-state/versions'),'junction');await assert.rejects(restoreRecovery(target,bundle),/Links/);assert.deepEqual(await fs.readdir(path.join(dir,'external')),[]);
 const file=path.join(bundle,'recovery.json'),doc=JSON.parse(await fs.readFile(file,'utf8'));doc.records.push(doc.records[0]);await fs.writeFile(file,JSON.stringify(doc));await assert.rejects(inspectRecovery(root,bundle),/Duplicate/);
});

test('actual CLI inspects restores and explicitly selects history before consecutive rollbacks',async t=>{
 const {dir,root,add,clean}=await setup(t);const a=await add('A'),b=await add('B');const sourceRoot=fileURLToPath(new URL('../..',import.meta.url));
 const target=await clean('cli-restore');
 await fs.cp(path.join(sourceRoot,'asset-manager'),path.join(root,'asset-manager'),{recursive:true,filter:p=>!p.includes(path.sep+'tests')});await fs.cp(path.join(sourceRoot,'asset-manager'),path.join(target,'asset-manager'),{recursive:true,filter:p=>!p.includes(path.sep+'tests')});await fs.writeFile(path.join(target,'package.json'),'{"type":"module"}');await fs.symlink(path.join(sourceRoot,'node_modules'),path.join(root,'node_modules'),'junction');await fs.writeFile(path.join(root,'package.json'),'{"type":"module"}');
 await fs.symlink(path.join(sourceRoot,'node_modules'),path.join(target,'node_modules'),'junction').catch(e=>{if(e.code!=='EEXIST')throw e;});
 const call=(hub,...args)=>JSON.parse(execFileSync(process.execPath,[path.join(hub,'asset-manager/cli.mjs'),...args],{cwd:hub,maxBuffer:4*1024*1024}).toString());
 const bundle=path.join(dir,'cli-backup');assert.equal(call(root,'export-recovery',bundle).versions,2);assert.equal(call(target,'inspect-recovery',bundle).history_complete,true);
 assert.equal(call(target,'restore-recovery',bundle).activated,false);await absentState(target);
 const selected=call(target,'restore-selection',bundle,'--approve','--reviewer','CLI reviewer','--note','Isolated CLI recovery');assert.equal(selected.selected,1);assert.equal(call(target,'inspect','demo').active.version,b.version);
 call(target,'rollback','demo');assert.equal(call(target,'inspect','demo').active.version,a.version);call(target,'rollback','demo');assert.equal(call(target,'inspect','demo').active,null);
});

test('new recovery selection cannot override a newly restricted license',async t=>{
 const {dir,root,add,clean}=await setup(t);await add('A');const bundle=path.join(dir,'backup');await exportRecovery(root,bundle);const target=await clean('restore');await restoreRecovery(target,bundle);
 const file=path.join(target,'catalog/assets/demo.toml');
 const text=await fs.readFile(file,'utf8');await fs.writeFile(file,text.replace('[source]','[source]\nlicense_status = "restricted-declared"'));
 await assert.rejects(restoreRecoverySelection(target,bundle,approveSelection),/license restriction/);await absentState(target);
});
test('backup output cannot follow a linked directory or corrupt version storage',async t=>{
 const {dir,root,add}=await setup(t);await add('A');const external=path.join(dir,'external');await fs.mkdir(external);await fs.symlink(external,path.join(dir,'linked-output'),'junction');
 await assert.rejects(exportRecovery(root,path.join(dir,'linked-output/new-backup')),/Linked recovery/);assert.deepEqual(await fs.readdir(external),[]);
 await assert.rejects(exportRecovery(root,path.join(root,'.asset-state/versions/backup')),/nested inside/);
});
test('tampered history references for previous versions cannot be substituted in recovery',async t=>{
 const {dir,root,add,clean}=await setup(t);await add('A');const b=await add('B');const bundle=path.join(dir,'backup');await exportRecovery(root,bundle);const file=path.join(bundle,'recovery.json');const record=JSON.parse(await fs.readFile(file,'utf8'));
 record.selection.history[1].previous.sha256='0'.repeat(64);record.selection_sha256=sha256(JSON.stringify(record.selection));await fs.writeFile(file,JSON.stringify(record));const target=await clean('restore');await assert.rejects(restoreRecovery(target,bundle),/history mismatch|hash conflict/);await absentState(target);assert.equal((await inspect(root,'demo')).active.version,b.version);
});

test('pending-state write failure publishes no active selection and removes its owned temporary state',async t=>{
 const {dir,root,add,clean}=await setup(t);await add('A');const bundle=path.join(dir,'backup');await exportRecovery(root,bundle);const target=await clean('restore');await restoreRecovery(target,bundle);
 const original=fs.open;fs.open=async (file,...args)=>{const handle=await original(file,...args);if(String(file).startsWith(target)&&String(file).endsWith('.state.json'))handle.writeFile=async()=>{throw new Error('Pending state write failed');};return handle;};
 try{await assert.rejects(restoreRecoverySelection(target,bundle,approveSelection),/Pending state write failed/);}finally{fs.open=original;}
 await absentState(target);assert.ok((await fs.readdir(path.join(target,'.asset-state/recovery-selections'))).every(name=>!name.endsWith('.state.json')));await assert.rejects(fs.access(path.join(target,'.asset-state/operation.lock')));
});

test('declared kind revision and active-pointer shape are validated before restoring files',async t=>{
 const {dir,root,add,clean}=await setup(t);await add('A');const bundle=path.join(dir,'backup');await exportRecovery(root,bundle);const file=path.join(bundle,'recovery.json'),original=JSON.parse(await fs.readFile(file,'utf8')),target=await clean('restore');
 for(const mutate of [record=>{record.records[0].kind='mcp';},record=>{record.revision++;},record=>{record.selection.active.demo=null;record.selection_sha256=sha256(JSON.stringify(record.selection));}]){
  const record=structuredClone(original);mutate(record);await fs.writeFile(file,JSON.stringify(record));await assert.rejects(restoreRecovery(target,bundle),/kind mismatch|selection integrity|version pointer/);await absentState(target);await assert.rejects(fs.access(path.join(target,'.asset-state/versions')));
 }
});

test('backup modified after preflight cannot be copied as a successful restore',async t=>{
 const {dir,root,add,clean}=await setup(t);const a=await add('A');const bundle=path.join(dir,'backup');await exportRecovery(root,bundle);const target=await clean('restore'),parent=path.join(target,'.asset-state/versions/demo');
 const original=fs.mkdir;let modified=false;fs.mkdir=async(file,...args)=>{const result=await original(file,...args);if(file===parent&&!modified){modified=true;await fs.appendFile(path.join(bundle,'demo',a.version,'content/SKILL.md'),'Late tampering');}return result;};
 try{await assert.rejects(restoreRecovery(target,bundle),/source changed after verification/);}finally{fs.mkdir=original;}
 assert.deepEqual(await fs.readdir(parent),[]);await absentState(target);
});
