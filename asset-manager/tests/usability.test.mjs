import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {stringify} from 'smol-toml';
import {auditAssetUsability,preflightSelection} from '../core/usability.mjs';
import {searchAssets} from '../core/discovery.mjs';
import {createView} from '../core/views.mjs';
import {loadCatalog} from '../core/catalog.mjs';
import {tree} from '../core/files.mjs';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-usability-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'catalog/assets'),{recursive:true});await fs.mkdir(path.join(root,'mcp'));await fs.writeFile(path.join(root,'mcp/registry.toml'),stringify({servers:[]}));
 async function add(id,{name=id,kind='skills',...fields}={}){const rel=(kind==='skills'?'skills/':'assets/')+id;await fs.mkdir(path.join(root,rel),{recursive:true});await fs.writeFile(path.join(root,rel,'SKILL.md'),['---','name: '+name,'description: Synthetic fixture skill','---','# Body'].join(String.fromCharCode(10)));const asset={id,kind,path:rel,source:{kind:'local'},version:{sha256:(await tree(path.join(root,rel))).sha256},...fields};await fs.writeFile(path.join(root,'catalog/assets/'+id+'.toml'),stringify(asset));return asset;}
 return {root,add};
}
test('all registered assets show explicit content readiness or restrictions without state writes',async t=>{
 const {root,add}=await fixture(t);await add('ready');await add('restricted',{source:{kind:'local',license_status:'restricted-declared'}});await add('vendor',{runtime_review_required:true});await add('bad-name',{name:'Vendor Name'});await add('template',{kind:'agents-md'});
 const r=await auditAssetUsability(root);assert.equal(r.counts.total,5);assert.equal(r.counts.content_ready,1);assert.equal(r.counts.conditional,1);assert.equal(r.counts.blocked,3);assert.equal(r.assets.find(a=>a.id==='restricted').declared_restriction,true);await assert.rejects(fs.access(path.join(root,'.asset-state')));
 const found=await searchAssets(root,'restricted');assert.equal(found.results[0].usability,'BLOCKED');assert.ok(found.results[0].blockers.some(b=>b.code==='license'));
});
test('effective LICENSE restrictions cannot be hidden by removing metadata flags',async t=>{
 const {root,add}=await fixture(t);const a=await add('license-in-content');await fs.writeFile(path.join(root,a.path,'LICENSE.txt'),'ADDITIONAL RESTRICTIONS users may not Distribute, sublicense, or transfer');const r=await auditAssetUsability(root);assert.equal(r.assets[0].status,'BLOCKED');assert.equal(r.assets[0].declared_restriction,true);
});
test('declared dependencies and conflicts reject a view before any asset contents are published',async t=>{
 const {root,add}=await fixture(t);await add('base');await add('requires-base',{requires:['base']});await add('alternative',{conflicts:['base']});
 assert.ok((await preflightSelection(root,{ids:['requires-base']})).conflicts.some(c=>c.code==='missing-dependency'));assert.equal((await preflightSelection(root,{ids:['requires-base','base']})).status,'CONTENT_READY');assert.ok((await preflightSelection(root,{ids:['alternative','base']})).conflicts.some(c=>c.code==='declared-conflict'));
 await assert.rejects(createView(root,'dsh','synthetic',{selection:{skills:['alternative','base'],mcp:[],plugins:[]}}),/declare incompatibility/);assert.deepEqual(await fs.readdir(path.join(root,'.asset-state/views')),[]);
});
test('duplicate asset IDs client names and dependency cycles are explicit composition conflicts',async t=>{
 const {root,add}=await fixture(t);await add('a',{name:'same',requires:['b']});await add('b',{name:'same',requires:['a']});const r=await preflightSelection(root,{ids:['a','b','a']});for(const code of ['duplicate-selection','duplicate-skill-name','dependency-cycle'])assert.ok(r.conflicts.some(c=>c.code===code));await fs.access(path.join(root,'skills/a/SKILL.md'));
});
test('invalid aliases and unknown dependency targets fail catalog validation',async t=>{
 const {root,add}=await fixture(t);const a=await add('bad',{requires:['missing']});await assert.rejects(loadCatalog(root),/requires reference/);
 for(const discovery of [{aliases:'not-list'},{aliases:['']},{description:1}]){await fs.writeFile(path.join(root,'catalog/assets/bad.toml'),stringify({...a,requires:[],discovery}));await assert.rejects(loadCatalog(root),/discovery metadata/);}
});
test('MCP missing build auth mapping malformed lists and missing registration report barriers',async t=>{
 const {root,add}=await fixture(t);await add('mcp.demo',{kind:'mcp',registry_id:'demo'});const file=path.join(root,'mcp/registry.toml');
 await fs.writeFile(file,stringify({servers:[{id:'demo',transport:'stdio',command:'node',args:['mcp/missing.js'],status:'build-required',clients:['dsh'],env_names:['PRIVATE_TOKEN']}]}));let r=await auditAssetUsability(root);for(const code of ['build-entry','auth-mapping'])assert.ok(r.assets[0].blockers.some(b=>b.code===code));
 await fs.writeFile(file,stringify({servers:[{id:'demo',transport:'stdio',command:'node',args:'invalid',status:'review-required',clients:'invalid',env_names:'invalid'}]}));r=await auditAssetUsability(root);assert.equal(r.assets[0].status,'BLOCKED');for(const code of ['launch','mcp-review','host-metadata','auth-metadata'])assert.ok(r.assets[0].blockers.some(b=>b.code===code));
 await fs.writeFile(file,stringify({servers:[]}));assert.equal((await auditAssetUsability(root)).assets[0].blockers[0].code,'mcp-registration');
});
test('actual CLI finds natural task queries and returns nonzero for blocked combination',()=>{
 const root=fileURLToPath(new URL('../..',import.meta.url)),cli=path.join(root,'asset-manager/cli.mjs');const call=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd:root,maxBuffer:8*1024*1024}).toString());
 assert.equal(call('search-assets','记忆插件','--kind','plugins','--limit','1').results[0].id,'memory-net');assert.equal(call('preflight','--expert','core').status,'CONTENT_READY');const r=call('audit-usability');assert.equal(r.assets.length,137);assert.equal(r.auto_enabled,false);
 let failure;try{call('preflight','docx,trae.docx');}catch(e){failure=e;}assert.ok(failure);assert.equal(failure.status,1);const blocked=JSON.parse(failure.stdout.toString());assert.equal(blocked.status,'BLOCKED');assert.ok(blocked.conflicts.some(c=>c.code==='duplicate-skill-name'));assert.ok(blocked.blockers.some(b=>b.code==='license'));
});

test('inherited expert exclusions and duplicate MCP runtime IDs survive composition',async t=>{
 const {root,add}=await fixture(t);await add('excluded');await add('safe');await fs.mkdir(path.join(root,'experts'));await fs.writeFile(path.join(root,'experts/parent.toml'),stringify({name:'parent',skills:['safe'],conflicts:['excluded']}));await fs.writeFile(path.join(root,'experts/child.toml'),stringify({name:'child',extends:['parent'],skills:['excluded']}));
 await assert.rejects(preflightSelection(root,{expert:'child'}),/Expert conflict/);
 await add('mcp.one',{kind:'mcp',registry_id:'same'});await add('mcp.two',{kind:'mcp',registry_id:'same'});
 const result=await preflightSelection(root,{ids:['mcp.one','mcp.two']});assert.ok(result.conflicts.some(c=>c.code==='duplicate-mcp-runtime'));
});
test('exact stable ID ranks first and unknown asset subsets fail safely',async t=>{
 const {root,add}=await fixture(t);await add('query');await add('query-extra');const result=await searchAssets(root,'query',{limit:1});assert.equal(result.results[0].id,'query');assert.equal(result.total_matches,2);
 await assert.rejects(preflightSelection(root,{ids:['not-registered']}),/Unknown asset/);await assert.rejects(preflightSelection(root,{ids:['query'],expert:'core'}),/not both/);
});

test('profile explicit additions cannot evade inherited expert exclusions',async t=>{
 const {root,add}=await fixture(t);await add('excluded');await add('safe');await fs.mkdir(path.join(root,'experts'));await fs.mkdir(path.join(root,'catalog/profiles'));
 await fs.writeFile(path.join(root,'experts/parent.toml'),stringify({name:'parent',skills:['safe'],conflicts:['excluded']}));await fs.writeFile(path.join(root,'catalog/profiles/dsh.toml'),stringify({schema:1,client:'dsh',experts:['parent'],skills:['excluded'],enabled:false,deploy:'explicit',overwrite_user_config:false}));
 const {resolveProfile}=await import('../core/catalog.mjs');await assert.rejects(resolveProfile(root,'dsh',await loadCatalog(root)),/expert exclusion/);
});
test('missing effective Skill does not hide other catalog results and stays blocked',async t=>{
 const {root,add}=await fixture(t);const asset=await add('missing-skill');await add('safe');await fs.unlink(path.join(root,asset.path,'SKILL.md'));
 const search=await searchAssets(root,'missing-skill');assert.equal(search.results[0].metadata_valid,false);assert.equal(search.results[0].usability,'BLOCKED');assert.equal((await searchAssets(root,'safe')).results[0].id,'safe');
});

test('adapted workflows respect host hierarchy and a no-subagent user decision',async()=>{
 const root=fileURLToPath(new URL('../..',import.meta.url));const dir=path.join(root,'skills/individual/engineering');const superpowers=await fs.readFile(path.join(dir,'using-superpowers/SKILL.md'),'utf8');assert.ok(superpowers.includes('workflow is opt-in'));assert.ok(superpowers.includes('system instructions first'));assert.ok(!superpowers.includes('Superpowers skills override default system prompt behavior'));assert.ok(!superpowers.includes('yes, even 1%'));
 for(const name of ['writing-plans','executing-plans','requesting-code-review']){const body=await fs.readFile(path.join(dir,name,'SKILL.md'),'utf8');assert.ok(/prohibited|no subagents|no-subagents|subagents are prohibited/.test(body));assert.ok(/inline/.test(body));}
});

test('duplicate MCP registry rows cannot bypass preflight by creating a view directly',async t=>{
 const {root,add}=await fixture(t);await add('mcp.demo',{kind:'mcp',registry_id:'demo'});const server={id:'demo',transport:'stdio',command:'node',args:[],status:'build-required'};
 await fs.writeFile(path.join(root,'mcp/registry.toml'),stringify({servers:[server,server]}));assert.ok((await preflightSelection(root,{ids:['mcp.demo']})).blockers.some(b=>b.code==='mcp-registration'));
 await assert.rejects(createView(root,'dsh','explicit',{selection:{skills:[],mcp:['mcp.demo'],plugins:[]}}),/exactly once/);assert.deepEqual(await fs.readdir(path.join(root,'.asset-state/views')),[]);
});
