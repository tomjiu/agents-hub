import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import {loadCatalog,policy,writeToml} from './catalog.mjs';
import {confined,tree,snapshot,createJson,atomicWrite,compareTrees,assetId} from './files.mjs';
const statePath=root=>path.join(root,'.asset-state');
async function readState(root){try{const p=await confined(root,'.asset-state/active.json');const state=JSON.parse(await fs.readFile(p,'utf8'));if(state.schema!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!state.active||typeof state.active!=='object'||Array.isArray(state.active)||!Array.isArray(state.history))throw new Error('Invalid active state');return state;}catch(e){if(e.code==='ENOENT')return {schema:1,revision:0,active:{},history:[]};throw e;}}
export async function serialized(root,fn) {
  const dir=await confined(root,'.asset-state',{mustExist:false});await fs.mkdir(dir,{recursive:true});const lock=path.join(dir,'operation.lock');let handle;
  try{handle=await fs.open(lock,'wx');}catch(e){if(e.code==='EEXIST')throw new Error('Another operation holds lock; inspect stale lock before recovery');throw e;}
  try{await handle.writeFile(JSON.stringify({pid:process.pid,time:new Date().toISOString()}));return await fn();}finally{await handle.close();await fs.unlink(lock);}
}
export async function inspect(root,id) {
  const catalog=await loadCatalog(root),a=catalog.get(assetId(id));if(!a)throw new Error('Unknown asset '+id);await policy(root,a);
  const current=await tree(await confined(root,a.path));const state=await readState(root);
  return {id,kind:a.kind,checkout_sha256:current.sha256,baseline_sha256:a.version.sha256,local_modified:current.sha256!==a.version.sha256,active:state.active[id]||null,source:a.source};
}
export async function stage(root,id,source,{expectedSha256,upstreamVersion='manual',upstreamCommit=''}={}) {
  return serialized(root,async()=>{
    const catalog=await loadCatalog(root),asset=catalog.get(assetId(id));if(!asset)throw new Error('Unknown asset '+id);await policy(root,asset);
    const checkout=await confined(root,asset.path);const resolved=await fs.realpath(source);
    if(resolved===checkout||resolved.startsWith(statePath(root)+path.sep))throw new Error('Use independent incoming source');
    const incoming=await tree(resolved);if(expectedSha256&&incoming.sha256!==expectedSha256)throw new Error('Incoming checksum mismatch');
    const version=crypto.randomUUID(),parent=await confined(root,'.asset-state/versions/'+id,{mustExist:false});await fs.mkdir(parent,{recursive:true});
    const dest=path.join(parent,version);await fs.mkdir(dest);
    try {
      const current=await tree(checkout);let baseline;
      try{baseline=JSON.parse(await fs.readFile(await confined(root,'catalog/provenance/'+id+'.json'),'utf8'));if(baseline.sha256!==asset.version.sha256)throw new Error('Catalog/provenance baseline mismatch');}
      catch(e){if(e.code!=='ENOENT')throw e;if(current.sha256!==asset.version.sha256)throw new Error('Missing baseline for locally modified asset');baseline=current;}
      const saved=await snapshot(resolved,path.join(dest,'content'));
      if(saved.sha256!==incoming.sha256)throw new Error('Incoming changed while staging');
      const diff=compareTrees(baseline,current,saved);
      const metadata={schema:1,id,kind:asset.kind,version,status:'STAGED',sha256:saved.sha256,checkout_sha256:current.sha256,baseline_sha256:baseline.sha256,upstreamVersion,upstreamCommit,created:new Date().toISOString(),diff,local_modified:current.sha256!==baseline.sha256};
      await createJson(path.join(dest,'version.json'),metadata);
      return metadata;
    } catch(e){await fs.rm(dest,{recursive:true,force:true});throw e;}
  });
}
async function versionDir(root,id,version){assetId(id);if(!/^[0-9a-f-]{36}$/.test(version))throw new Error('Invalid version');return confined(root,'.asset-state/versions/'+id+'/'+version);}
export async function validateVersion(root,id,version) {
  return serialized(root,async()=>{
    const dir=await versionDir(root,id,version),m=JSON.parse(await fs.readFile(path.join(dir,'version.json'),'utf8'));
    const asset=(await loadCatalog(root)).get(id);if(!asset||m.id!==id||m.version!==version||m.kind!==asset.kind)throw new Error('Invalid version identity or kind');await policy(root,asset);
    const content=path.join(dir,'content'),t=await tree(content);const errors=[],warnings=[];
    if(t.sha256!==m.sha256)errors.push('Snapshot was modified');
    if(m.kind==='skills') {
      const p=path.join(content,'SKILL.md');try{const s=await fs.readFile(p,'utf8');const front=/^---\r?\n([\s\S]*?)\r?\n---/.exec(s);const fields=front?YAML.parse(front[1]):null;if(!fields||typeof fields.name!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(fields.name)||typeof fields.description!=='string'||!fields.description.trim())errors.push('Invalid Skill frontmatter');}catch{errors.push('Missing SKILL.md or invalid YAML frontmatter');}
    }
    if(m.kind==='plugins') {try{const p=JSON.parse(await fs.readFile(path.join(content,'package.json'),'utf8'));if(!p.name)errors.push('Plugin package name missing');}catch{errors.push('Plugin package.json missing');}}
    for(const f of t.files) {
      if(/(^|\/)(\.env|accounts\.json|credentials\.json)$/.test(f.path))errors.push('Private credential-shaped file '+f.path);
      if(/\.(exe|dll|sh|ps1|js|mjs|cjs)$/.test(f.path))warnings.push('Executable requires review: '+f.path);
      if(/\.(md|js|mjs|ts|sh|ps1)$/.test(f.path)&&f.bytes<1024*1024){const s=await fs.readFile(path.join(content,f.path),'utf8');if(/ignore (all |previous )?instructions|disregard (the )?system/i.test(s))warnings.push('Instruction-hijack phrase requires contextual review: '+f.path);}
    }
    const report={schema:1,id,version,sha256:t.sha256,status:errors.length?'FAILED':'VALIDATED',errors,warnings,scope:'Static structure and integrity only; not license, runtime compatibility, or live-service approval.',time:new Date().toISOString()};
    await createJson(path.join(dir,'validation-'+crypto.randomUUID()+'.json'),report);
    await atomicWrite(path.join(dir,'latest-validation.json'),JSON.stringify(report,null,2)+'\n');return report;
  });
}
export async function approve(root,id,version,{reviewer,note,resolveLocalChanges=false}={}) {
 return serialized(root,async()=>{
   if(!reviewer?.trim()||!note?.trim())throw new Error('Reviewer and approval note are required');
   const dir=await versionDir(root,id,version),m=JSON.parse(await fs.readFile(path.join(dir,'version.json'),'utf8')),v=JSON.parse(await fs.readFile(path.join(dir,'latest-validation.json'),'utf8'));
   if(m.id!==id||m.version!==version||v.id!==id||v.version!==version||v.status!=='VALIDATED'||v.sha256!==m.sha256||(await tree(path.join(dir,'content'))).sha256!==m.sha256)throw new Error('Passing validation required');
   if(m.local_modified&&!resolveLocalChanges)throw new Error('Local edits need explicit review resolution; no auto merge');
   const approval={schema:1,id,version,sha256:m.sha256,reviewer,note,resolveLocalChanges,time:new Date().toISOString()};
   await createJson(path.join(dir,'approval.json'),approval);return approval;
 });
}
export async function activate(root,id,version,{expectedRevision}={}) {
 return serialized(root,async()=>{
   const catalog=await loadCatalog(root),a=catalog.get(id);if(!a)throw new Error('Unknown asset');await policy(root,a);
   const dir=await versionDir(root,id,version),m=JSON.parse(await fs.readFile(path.join(dir,'version.json'),'utf8'));
   const approval=JSON.parse(await fs.readFile(path.join(dir,'approval.json'),'utf8')),v=JSON.parse(await fs.readFile(path.join(dir,'latest-validation.json'),'utf8'));
   if(m.kind!==a.kind||m.id!==id||m.version!==version||approval.id!==id||approval.version!==version||v.id!==id||v.version!==version||v.sha256!==m.sha256||approval.sha256!==m.sha256||v.status!=='VALIDATED'||(await tree(path.join(dir,'content'))).sha256!==m.sha256)throw new Error('Integrity or approval invalid');
   const current=await tree(await confined(root,a.path));if(current.sha256!==m.checkout_sha256)throw new Error('Local checkout changed since review');
   const state=await readState(root);if(expectedRevision!==undefined&&state.revision!==expectedRevision)throw new Error('Stale activation revision');
   const previous=state.active[id]||null;state.history.push({id,previous,next:{version,sha256:m.sha256},time:new Date().toISOString()});state.active[id]={version,sha256:m.sha256,kind:a.kind};state.revision++;
   await atomicWrite(path.join(statePath(root),'active.json'),JSON.stringify(state,null,2)+'\n');return state;
 });
}
export async function rollback(root,id,{expectedRevision}={}) {
 return serialized(root,async()=>{
   const state=await readState(root);if(expectedRevision!==undefined&&state.revision!==expectedRevision)throw new Error('Stale rollback revision');
   const h=[...state.history].reverse().find(x=>x.id===id&&!x.rollback&&!x.rolled_back);if(!h)throw new Error('No activation history');
   h.rolled_back=true;const from=state.active[id]||null;
   if(h.previous){const dir=await versionDir(root,id,h.previous.version);if((await tree(path.join(dir,'content'))).sha256!==h.previous.sha256)throw new Error('Rollback snapshot modified');state.active[id]=h.previous;}else delete state.active[id];
   state.history.push({id,rollback:true,from,time:new Date().toISOString()});state.revision++;
   await atomicWrite(path.join(statePath(root),'active.json'),JSON.stringify(state,null,2)+'\n');return state;
 });
}
export async function effectivePath(root,a) {const s=await readState(root);const active=s.active[a.id];if(!active)return confined(root,a.path);const p=path.join(await versionDir(root,a.id,active.version),'content');if((await tree(p)).sha256!==active.sha256)throw new Error('Active version integrity mismatch');return p;}
export async function exportLocks(root,dest) {
 const state=await readState(root),catalog=await loadCatalog(root);await fs.mkdir(dest,{recursive:false});
 for(const kind of ['skills','mcp','plugins','agents-md']) {
 const rows=[...catalog.values()].filter(a=>a.kind===kind).map(a=>({id:a.id,source_url:a.source.url||'',upstream_version:a.version.upstream,path:a.path,sha256:state.active[a.id]?.sha256||a.version.sha256,local_version:state.active[a.id]?.version||a.version.local,enabled:!!state.active[a.id]}));
 await fs.writeFile(path.join(dest,kind+'.lock.toml'),writeToml({schema:1,revision:state.revision,assets:rows}),{flag:'wx'});
 }
 return {revision:state.revision,destination:dest};
}
