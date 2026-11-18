import fs from 'node:fs/promises';
import path from 'node:path';
import {loadCatalog} from './catalog.mjs';
import {serialized} from './lifecycle.mjs';
import {confined,exists,snapshot,tree,createJson,assetId} from './files.mjs';
export async function exportRecovery(root,destination) {
 const catalog=await loadCatalog(root),stateFile=await confined(root,'.asset-state/active.json');
 const state=JSON.parse(await fs.readFile(stateFile,'utf8'));
 if(await exists(destination))throw new Error('Recovery export target exists');
 const records=[];await fs.mkdir(destination,{recursive:false});
 try {
  for(const [id,active] of Object.entries(state.active)) {
   const a=catalog.get(assetId(id));if(!a||!/^[a-f0-9-]{36}$/.test(active.version))throw new Error('Invalid active version');
   const dir=await confined(root,'.asset-state/versions/'+id+'/'+active.version);
   if((await tree(path.join(dir,'content'))).sha256!==active.sha256)throw new Error('Active snapshot changed');
   const target=path.join(destination,id);const saved=await snapshot(dir,target);
   records.push({id,kind:a.kind,version:active.version,sha256:active.sha256,bundle_sha256:saved.sha256});
  }
  await createJson(path.join(destination,'recovery.json'),{schema:1,revision:state.revision,records,active:state.active,history:state.history});
  if(await fs.readFile(stateFile,'utf8')!==JSON.stringify(state,null,2)+'\n') {
   const current=JSON.parse(await fs.readFile(stateFile,'utf8'));
   if(current.revision!==state.revision)throw new Error('Active state changed during export');
  }
  return {destination,versions:records.length,revision:state.revision};
 }catch(e){await fs.rm(destination,{recursive:true,force:true});throw e;}
}
export async function restoreRecovery(root,bundle) {
 return serialized(root,async()=>{
 const source=await fs.realpath(bundle),catalog=await loadCatalog(root);
 const record=JSON.parse(await fs.readFile(await confined(source,'recovery.json'),'utf8'));
 if(record.schema!==1||!Array.isArray(record.records))throw new Error('Invalid recovery bundle');
 const items=[],seen=new Set();
 for(const r of record.records) {
  if(seen.has(r.id))throw new Error('Duplicate recovery asset');seen.add(r.id);
  const a=catalog.get(assetId(r.id));if(!a||a.kind!==r.kind||!/^[a-f0-9-]{36}$/.test(r.version))throw new Error('Unregistered recovery asset');
  const src=await confined(source,r.id);if((await tree(src)).sha256!==r.bundle_sha256||(await tree(path.join(src,'content'))).sha256!==r.sha256)throw new Error('Recovery integrity mismatch');
  const metadata=JSON.parse(await fs.readFile(path.join(src,'version.json'),'utf8'));
  if(metadata.id!==r.id||metadata.version!==r.version||metadata.sha256!==r.sha256)throw new Error('Recovery metadata mismatch');
  const dst=await confined(root,'.asset-state/versions/'+r.id+'/'+r.version,{mustExist:false});
  if(await exists(dst))throw new Error('Restore target exists; current state untouched');
  items.push({src,dst});
 }
 const created=[];
 try{for(const item of items){await fs.mkdir(path.dirname(item.dst),{recursive:true});await snapshot(item.src,item.dst);created.push(item.dst);}}
 catch(e){for(const p of created)await fs.rm(p,{recursive:true,force:true});throw e;}
 return {restored:items.length,activated:false,note:'Restored version contents and review records only; inspect and explicitly activate. Existing active selection is untouched.'};
 });
}
