import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {stringify} from 'smol-toml';
import {searchAssets,inspectSkillDirectory} from '../core/discovery.mjs';
import {tree} from '../core/files.mjs';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-discovery-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'catalog/assets'),{recursive:true});await fs.mkdir(path.join(root,'skills/individual/research/source-index'),{recursive:true});
 const rel='skills/individual/research/source-index',file=path.join(root,rel,'SKILL.md');await fs.writeFile(file,'---'+String.fromCharCode(10)+YAML.stringify({name:'source-index',description:'本地技能索引与技能搜索'})+'---'+String.fromCharCode(10)+'body');
 const asset={id:'source-index',kind:'skills',path:rel,source:{kind:'local'},version:{sha256:(await tree(path.join(root,rel))).sha256}};await fs.writeFile(path.join(root,'catalog/assets/source-index.toml'),stringify(asset));
 await fs.writeFile(path.join(root,'catalog/assets/memory-net.toml'),stringify({...asset,id:'memory-net',kind:'plugins'}));return {root,file,asset};
}
test('local discovery matches IDs and Chinese descriptions with kind and limit controls',async t=>{
 const {root}=await fixture(t);assert.equal((await searchAssets(root,'索引',{kind:'skills'})).results[0].id,'source-index');assert.equal((await searchAssets(root,'memory-net',{kind:'plugins'})).results[0].id,'memory-net');assert.equal((await searchAssets(root,'memory-net',{kind:'skills'})).total_matches,0);assert.equal((await searchAssets(root,'not-found')).results.length,0);assert.equal((await searchAssets(root,'source-index')).activated,false);
 for(const query of ['', ' ', '!!!'])await assert.rejects(searchAssets(root,query));await assert.rejects(searchAssets(root,'source',{limit:0}));await assert.rejects(searchAssets(root,'source',{kind:'unknown'}));
});
test('inventory reports invalid and unregistered skills without hiding all other results',async t=>{
 const {root,file}=await fixture(t);await fs.writeFile(file,'---'+String.fromCharCode(10)+'name: source-index'+String.fromCharCode(10)+'description: invalid: mapping'+String.fromCharCode(10)+'---');
 const result=await searchAssets(root,'source-index');assert.equal(result.results[0].metadata_valid,false);const report=await inspectSkillDirectory(root);assert.equal(report.invalid.length,1);
 await fs.mkdir(path.join(root,'skills/unregistered'));await fs.writeFile(path.join(root,'skills/unregistered/SKILL.md'),'bad');assert.equal((await inspectSkillDirectory(root)).unregistered.length,1);
});
test('duplicate client names are exposed as alternative IDs and no contents are removed',async t=>{
 const {root,file,asset}=await fixture(t);const rel='skills/collections/vendors/fixture/source-index';await fs.mkdir(path.join(root,rel),{recursive:true});await fs.copyFile(file,path.join(root,rel,'SKILL.md'));await fs.writeFile(path.join(root,'catalog/assets/vendor.index.toml'),stringify({...asset,id:'vendor.index',path:rel,runtime_review_required:true}));
 const report=await inspectSkillDirectory(root);assert.equal(report.total,2);assert.equal(report.registered,2);assert.deepEqual(report.missing,[]);assert.equal(report.duplicate_client_names[0].entries.length,2);assert.equal((await searchAssets(root,'索引',{limit:1})).total_matches,2);await fs.access(file);
});

test('real repository priority assets are registered and onboarding links resolve',async()=>{
 const {fileURLToPath}=await import('node:url');const root=fileURLToPath(new URL('../..',import.meta.url));
 const report=await inspectSkillDirectory(root);assert.deepEqual(report.invalid,[]);assert.deepEqual(report.unregistered,[]);assert.deepEqual(report.missing,[]);assert.equal(report.total,report.registered);
 for(const [query,kind,id] of [['source-index','skills','source-index'],['skill-search','skills','skill-search'],['search-core','mcp','mcp.search-core'],['memory-net','plugins','memory-net']])assert.equal((await searchAssets(root,query,{kind,limit:1})).results[0].id,id);
 const guidance=await fs.readFile(path.join(root,'AGENTS.md'),'utf8');const links=guidance.split('](').slice(1).map(part=>part.split(')')[0]);assert.ok(links.length>=10);for(const target of links){if(!target.startsWith('http'))await fs.access(path.join(root,target));}
 const {resolveExpert,loadCatalog}=await import('../core/catalog.mjs');const recipe=await resolveExpert(root,'research',await loadCatalog(root));assert.ok(recipe.skills.includes('skill-search'));assert.ok(recipe.skills.includes('source-index'));assert.ok(recipe.mcp.includes('mcp.search-core'));
});
