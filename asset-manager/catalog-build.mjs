import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
import {stringify} from 'smol-toml';
import {tree,exists} from './core/files.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(await exists(path.join(root,'catalog/locks/skills.lock.toml')))throw new Error('Initial catalog already locked; use registered lifecycle commands, not baseline regeneration.');
async function toml(rel,obj){const p=path.join(root,rel);if(await exists(p)){const current=await fs.readFile(p,'utf8');if(current===stringify(obj)+'\n')return;throw new Error('Refuse overwriting changed catalog: '+rel);}await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,stringify(obj)+'\n',{flag:'wx'});}
async function skills(dir){let out=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await skills(p));else if(e.name==='SKILL.md')out.push(p);}return out;}
const slug=x=>x.toLowerCase().replace(/[^a-z0-9._-]+/g,'-');
const baseline='4f1911081477b49a6610e52537bea1057f216530';
const assets=[];
async function add(id,kind,rel,source,extra={}){const snap=await tree(path.join(root,rel));assets.push({id,kind,path:rel,source,version:{upstream:source.version||'unknown',commit:source.commit||'',local:'imported-2026-11-18',sha256:snap.sha256,local_modified:'unknown',enabled:false},...extra});}
for(const p of await skills(path.join(root,'skills/individual'))) {
  const rel=path.relative(root,path.dirname(p)).replaceAll(path.sep,'/'),id=path.basename(path.dirname(p));
  await add(id,'skills',rel,{kind:'local',url:'https://github.com/tomjiu/agents-hub',commit:baseline,license:'review-required',provenance:'catalog/audit/migration-2026-11.json'});
}
const manifest=JSON.parse(await fs.readFile(path.join(root,'skills/collections/vendors/trae/MANIFEST.json'),'utf8'));
for(const p of await skills(path.join(root,'skills/collections/vendors/trae'))) {
  const name=path.basename(path.dirname(p)),up=manifest.skills.find(s=>s.name===name);
  await add('trae.'+slug(name),'skills',path.relative(root,path.dirname(p)).replaceAll(path.sep,'/'),{kind:'trae-cdn',url:up?.url||'',version:up?.version||'unknown',build:up?.path||'',license:'vendor-restricted',discovery:'restricted',snapshot:manifest.retrieved},{collection:'trae',runtime_review_required:true});
}
const wb='skills/collections/vendors/workbuddy';
for(const p of await skills(path.join(root,wb))) {
  const rel=path.relative(root,path.dirname(p)).replaceAll(path.sep,'/');
  const tail=rel.substring(wb.length+1).split('/');
  const simple=tail[0]==='workbuddy-builtin'&&tail[1]==='skills';
  const id='workbuddy.'+(simple?slug(tail.at(-1)):tail.slice(2).map(slug).join('.'));
  await add(id,'skills',rel,{kind:'workbuddy-installer',url:'',version:'5.4.2',license:'vendor-restricted',discovery:'restricted',provenance:wb+'/README.md'},{collection:'workbuddy',runtime_review_required:true});
}
const legacy=YAML.parse(await fs.readFile(path.join(root,'catalog/audit/legacy/catalog/sources.yaml'),'utf8'));
const sourceEntries=[];
for(const [section,list] of Object.entries(legacy)) if(Array.isArray(list))for(const x of list)if(x.url)sourceEntries.push({id:'source-'+sourceEntries.length,name:x.name,url:x.url,tags:x.tags||[],category:section,available_locally:false});
await toml('catalog/sources.toml',{schema:1,entries:sourceEntries});
const mcp=YAML.parse(await fs.readFile(path.join(root,'catalog/audit/legacy/mcp/enabled.yaml'),'utf8'));
const servers=[];
for(const s of mcp.servers) {
  const id=s.id==='zai'?'zai-bridge':s.id==='node_repl'?'node-repl':s.id;
  const entry={id,transport:s.type==='remote'?'http':'stdio',enabled:false,clients:s.clients||[],env_names:s.env||[],status:'review-required',notes:s.notes||''};
  if(s.url)entry.url=s.url;
  if(s.command) {const [cmd,...args]=s.command;entry.command=cmd;entry.args=args;}
  if(id==='zai-bridge'){entry.command='go';entry.args=['run','.'];entry.cwd='mcp/servers/zai-bridge';entry.status='build-required';entry.env_names=['ZAI_TOKEN','ZAI_ACCOUNTS_FILE'];}
  if(id==='firefox-devtools'){entry.command='npx';entry.args=['-y','@mozilla/firefox-devtools-mcp@0.9.5','--connectExisting','--marionettePort','2828'];entry.status='upstream-diff-pending';entry.local_candidate='mcp/servers/firefox-devtools-mcp';}
  if(id==='brp'){delete entry.args;entry.status='external-install-required';entry.notes='BRP adapter is not bundled; configure an explicit local executable path after installing extension and bridge.';}
  if(entry.args?.some(x=>x.includes('@latest')))entry.status='unlocked-upstream';
  servers.push(entry);
}
servers.push({id:'search-core',transport:'stdio',enabled:false,clients:['dsh','codex','opencode'],command:'node',args:['mcp/servers/search-core/typescript/dist/mcp.js'],cwd:'.',env_names:[],status:'build-required',implementations:['typescript','go']});
await toml('mcp/registry.toml',{schema:1,servers});
for(const s of servers){
  const rel=s.id==='zai-bridge'?'mcp/servers/zai-bridge':s.id==='search-core'?'mcp/servers/search-core':s.id==='firefox-devtools'?'mcp/servers/firefox-devtools-mcp':'catalog/audit/legacy/mcp/servers/'+(s.id==='node-repl'?'node_repl':s.id);
  await add('mcp.'+s.id,'mcp',rel,{kind:s.id==='firefox-devtools'?'npm':s.url?'http':'local',url:s.id==='firefox-devtools'?'https://registry.npmjs.org/@mozilla/firefox-devtools-mcp':s.url||'https://github.com/tomjiu/agents-hub',version:s.id==='firefox-devtools'?'0.9.5':s.id==='zai-bridge'?'0.3.1':'unknown',license:s.id==='firefox-devtools'?'MIT OR Apache-2.0':'review-required',commit:baseline},{registry_id:s.id});
}
await add('memory-net','plugins','plugins/memory-net',{kind:'local',url:'https://github.com/tomjiu/memory-net',version:'1.0.0',license:'MIT',commit:baseline},{host:'dsh',adapter:'adapters/dsh',console_vendor_pin:'e3dda9d56fac3598452ed0902898d693c4a6e5f2'});
await add('agents-md.base','agents-md','agents-md/base',{kind:'local',url:'https://github.com/tomjiu/agents-hub',version:'0.3.0-draft',license:'review-required'});
await add('agents-md.project','agents-md','agents-md/templates',{kind:'local',url:'https://github.com/tomjiu/agents-hub',version:'0.1.0-draft',license:'review-required'});
await add('agents-md.ui-acceptance','agents-md','agents-md/fragments',{kind:'local',url:'https://github.com/tomjiu/agents-hub',version:'0.1.0-draft',license:'review-required'});
const ids=new Set();for(const a of assets){if(ids.has(a.id))throw new Error('Duplicate '+a.id);ids.add(a.id);await toml('catalog/assets/'+a.id+'.toml',a);}
for(const kind of ['skills','mcp','plugins','agents-md']) {
 await toml('catalog/updates/'+kind+'.toml',{schema:1,kind,defaults:{check:true,download:true,apply:false},protection:{overwrite:false,auto_merge:false,preserve_local_changes:true,require_validation:true,require_approval:true}});
 await toml('catalog/locks/'+kind+'.lock.toml',{schema:1,kind,assets:assets.filter(a=>a.kind===kind).map(a=>({id:a.id,path:a.path,source_url:a.source.url,upstream_version:a.version.upstream,upstream_commit:a.version.commit,sha256:a.version.sha256,local_version:a.version.local,local_modified:a.version.local_modified,enabled:false}))});
}
await toml('skills/collections/vendors/trae/collection.toml',{id:'trae',kind:'collection',source:'trae-cdn',manifest:'MANIFEST.json',license:'vendor-restricted',default_enabled:false,discovery:'restricted',assets:assets.filter(a=>a.collection==='trae').map(a=>a.id)});
await toml('skills/collections/vendors/workbuddy/collection.toml',{id:'workbuddy',kind:'collection',source:'workbuddy-installer',license:'vendor-restricted',default_enabled:false,discovery:'restricted',expert_candidates:'curated-experts.json',candidates_reviewed:false,assets:assets.filter(a=>a.collection==='workbuddy').map(a=>a.id)});
console.log(JSON.stringify({assets:assets.length,kinds:Object.fromEntries(['skills','mcp','plugins','agents-md'].map(k=>[k,assets.filter(a=>a.kind===k).length])),sources:sourceEntries.length}));
