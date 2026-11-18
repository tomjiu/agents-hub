import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {stringify,parse} from 'smol-toml';
import {tree} from '../core/files.mjs';
import {loadCatalog} from '../core/catalog.mjs';
import {createView} from '../core/views.mjs';
import {auditProvenance} from '../core/provenance.mjs';
import {assertDeployableLicense,declaredRestriction} from '../core/license-review.mjs';
import {stage,validateVersion,approve,activate,exportLocks} from '../core/lifecycle.mjs';
const restriction='ADDITIONAL RESTRICTIONS: users may not: Distribute, sublicense, or transfer these materials to any third party';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-provenance-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const p of ['catalog/assets','catalog/updates','catalog/locks','catalog/provenance','skills/demo','experts','mcp'])await fs.mkdir(path.join(root,p),{recursive:true});
 await fs.writeFile(path.join(root,'skills/demo/SKILL.md'),['---','name: demo','description: fixture','---','fixture'].join(String.fromCharCode(10)));
 const baseline=await tree(path.join(root,'skills/demo'));
 const asset={id:'demo',kind:'skills',path:'skills/demo',source:{kind:'local',url:'https://example.test/maintenance',commit:'',upstream_identity_status:'unverified',license:'review-required'},import:{baseline_commit:'a'.repeat(40)},version:{sha256:baseline.sha256,upstream:'unknown',commit:'',local:'imported'}};
 await fs.writeFile(path.join(root,'catalog/assets/demo.toml'),stringify(asset));await fs.writeFile(path.join(root,'catalog/provenance/demo.json'),JSON.stringify(baseline));
 await fs.writeFile(path.join(root,'catalog/updates/skills.toml'),stringify({defaults:{check:true,download:true,apply:false},protection:{overwrite:false,auto_merge:false,preserve_local_changes:true,require_validation:true,require_approval:true}}));
 await fs.writeFile(path.join(root,'mcp/registry.toml'),stringify({servers:[]}));await fs.writeFile(path.join(root,'experts/core.toml'),stringify({name:'core',skills:['demo']}));
 return {root,asset,baseline};
}
test('local import baseline cannot be mislabeled as upstream commit',async t=>{
 const {root,asset}=await fixture(t);asset.source.commit=asset.import.baseline_commit;await fs.writeFile(path.join(root,'catalog/assets/demo.toml'),stringify(asset));await assert.rejects(loadCatalog(root),/misrepresented/);
});
test('read-only audit retains unknown origin and detects exact duplicate candidates without removing content',async t=>{
 const {root,asset}=await fixture(t);await fs.writeFile(path.join(root,'catalog/assets/other.toml'),stringify({...asset,id:'other'}));
 const before=await fs.readFile(path.join(root,'skills/demo/SKILL.md'));const report=await auditProvenance(root);assert.equal(report.counts.upstream_unverified,2);assert.deepEqual(report.exact_content_groups,[['demo','other']]);assert.deepEqual(await fs.readFile(path.join(root,'skills/demo/SKILL.md')),before);
});
test('declared restrictive license blocks views even with vendor review flag or removed metadata',async t=>{
 const {root}=await fixture(t);const source=path.join(root,'skills/demo');await fs.writeFile(path.join(source,'LICENSE.txt'),restriction);
 assert.equal(declaredRestriction(restriction),true);assert.equal(declaredRestriction('Apache License Version 2.0'),false);
 await assert.rejects(createView(root,'dsh','core',{allowRestricted:true}),/license restriction/);assert.deepEqual(await fs.readdir(path.join(root,'.asset-state/views')),[]);
 await assert.rejects(assertDeployableLicense({id:'demo',source:{license_status:'restricted-declared'}},source),/restriction/);
});
test('restricted incoming version can be preserved and statically reviewed but not activated',async t=>{
 const {root}=await fixture(t);const incoming=await fs.mkdtemp(path.join(os.tmpdir(),'hub-license-incoming-'));t.after(()=>fs.rm(incoming,{recursive:true,force:true}));
 await fs.copyFile(path.join(root,'skills/demo/SKILL.md'),path.join(incoming,'SKILL.md'));await fs.writeFile(path.join(incoming,'LICENSE.txt'),restriction);
 const version=await stage(root,'demo',incoming);assert.equal((await validateVersion(root,'demo',version.version)).status,'VALIDATED');await approve(root,'demo',version.version,{reviewer:'fixture',note:'Static fixture approval does not override license'});
 await assert.rejects(activate(root,'demo',version.version),/license restriction/);await assert.rejects(fs.access(path.join(root,'.asset-state/active.json')));
});
test('exported baseline identity distinguishes local import and actual upstream',async t=>{
 const {root}=await fixture(t);const dest=path.join(root,'new-locks');await exportLocks(root,dest);const doc=parse(await fs.readFile(path.join(dest,'skills.lock.toml'),'utf8'));assert.equal(doc.assets[0].upstream_version,'unknown');assert.equal(doc.assets[0].upstream_commit,'');assert.equal(doc.assets[0].import_baseline_commit,'a'.repeat(40));
});

test('active lock exports the reviewed incoming upstream rather than checkout metadata',async t=>{
 const {root}=await fixture(t);const incoming=await fs.mkdtemp(path.join(os.tmpdir(),'hub-upstream-incoming-'));t.after(()=>fs.rm(incoming,{recursive:true,force:true}));
 await fs.copyFile(path.join(root,'skills/demo/SKILL.md'),path.join(incoming,'SKILL.md'));
 const staged=await stage(root,'demo',incoming,{upstreamVersion:'release-2',upstreamCommit:'b'.repeat(40)});await validateVersion(root,'demo',staged.version);await approve(root,'demo',staged.version,{reviewer:'test',note:'reviewed fixture'});await activate(root,'demo',staged.version);
 const output=path.join(root,'active-locks');await exportLocks(root,output);const lock=parse(await fs.readFile(path.join(output,'skills.lock.toml'),'utf8'));assert.equal(lock.assets[0].upstream_version,'release-2');assert.equal(lock.assets[0].upstream_commit,'b'.repeat(40));assert.equal(lock.assets[0].enabled,true);
 await fs.appendFile(path.join(root,'.asset-state/versions/demo',staged.version,'content/SKILL.md'),'tampered');await assert.rejects(exportLocks(root,path.join(root,'invalid-locks')),/identity mismatch/);
});
