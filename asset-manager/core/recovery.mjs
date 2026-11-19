import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {loadCatalog,policy} from './catalog.mjs';
import {serialized} from './lifecycle.mjs';
import {assertDeployableLicense} from './license-review.mjs';
import {confined,exists,snapshot,tree,createJson,assetId,sha256} from './files.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest=/^[a-f0-9]{64}$/;
async function noLinkedOutput(target){for(let p=path.resolve(target);;p=path.dirname(p)){try{if((await fs.lstat(p)).isSymbolicLink())throw new Error('Linked recovery output ancestor');}catch(e){if(e.code!=='ENOENT')throw e;}if(path.dirname(p)===p)break;}}
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const same=(a,b)=>a==null&&b==null||!!a&&!!b&&a.version===b.version&&a.sha256===b.sha256;
function pointer(id,p,catalog){
 const asset=catalog.get(assetId(id));if(!asset||!isObject(p)||typeof p.version!=='string'||!uuid.test(p.version)||typeof p.sha256!=='string'||!digest.test(p.sha256)||(p.kind!==undefined&&p.kind!==asset.kind))throw new Error('Invalid recovery version pointer');
 return {id,kind:asset.kind,version:p.version,sha256:p.sha256};
}
// Replaying history checks that a restore cannot install an unrelated current pointer or skip a rollback.
function referencedVersions(state,catalog){
 if(!isObject(state)||state.schema!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!isObject(state.active)||!Array.isArray(state.history))throw new Error('Invalid recovery selection state');
 const versions=new Map(),current=new Map(),stacks=new Map();
 const add=(id,p)=>{if(p==null)return;const r=pointer(id,p,catalog),key=id+'/'+r.version,prior=versions.get(key);if(prior&&prior.sha256!==r.sha256)throw new Error('Recovery history hash conflict');versions.set(key,r);};
 for(const h of state.history){
  if(!isObject(h)||typeof h.id!=='string')throw new Error('Invalid recovery history event');assetId(h.id);if(!catalog.has(h.id))throw new Error('Unregistered recovery history asset');
  const previous=current.get(h.id)||null;let stack=stacks.get(h.id);if(!stack){stack=[];stacks.set(h.id,stack);}
  if(h.rollback===true){
   if(!stack.length||!same(previous,h.from))throw new Error('Recovery rollback history mismatch');add(h.id,h.from);const entry=stack.pop();if(entry.event.rolled_back!==true)throw new Error('Recovery rolled-back flag mismatch');current.set(h.id,entry.previous);
  }else{
   if(h.rollback!==undefined&&h.rollback!==false)throw new Error('Invalid rollback flag');if(h.rolled_back!==undefined&&typeof h.rolled_back!=='boolean')throw new Error('Invalid rolled-back flag');
   if(!same(previous,h.previous)||!h.next)throw new Error('Recovery activation history mismatch');add(h.id,h.previous);add(h.id,h.next);stack.push({previous,event:h});current.set(h.id,h.next);
  }
 }
 for(const stack of stacks.values())if(stack.some(entry=>entry.event.rolled_back===true))throw new Error('Recovery history contains unmatched rollback');
 for(const [id,p] of Object.entries(state.active)){pointer(id,p,catalog);add(id,p);if(!same(current.get(id),p))throw new Error('Recovery current selection/history mismatch');}
 for(const [id,p] of current)if(p&&!Object.hasOwn(state.active,id))throw new Error('Recovery selection missing current asset');
 return [...versions.values()].sort((a,b)=>(a.id+'/'+a.version).localeCompare(b.id+'/'+b.version));
}
async function metadataFor(dir,r){
 const content=await confined(dir,'content');if((await tree(content)).sha256!==r.sha256)throw new Error('Recovery integrity mismatch');
 const metadata=JSON.parse(await fs.readFile(await confined(dir,'version.json'),'utf8'));
 if(metadata.schema!==1||metadata.id!==r.id||metadata.kind!==r.kind||metadata.version!==r.version||metadata.sha256!==r.sha256)throw new Error('Recovery metadata mismatch');
 return metadata;
}
async function readBundle(root,bundle){
 const source=await fs.realpath(bundle),catalog=await loadCatalog(root);
 const record=JSON.parse(await fs.readFile(await confined(source,'recovery.json'),'utf8'));
 if(![1,2].includes(record.schema)||!Array.isArray(record.records))throw new Error('Invalid recovery bundle');
 let refs;
 if(record.schema===2){
  if(!isObject(record.selection)||record.revision!==record.selection.revision||record.selection_sha256!==sha256(JSON.stringify(record.selection)))throw new Error('Recovery selection integrity mismatch');
  refs=referencedVersions(record.selection,catalog);
 }
 const items=[],seen=new Set();
 for(const r of record.records){
  const version=pointer(r.id,r,catalog),key=r.id+'/'+r.version;if(r.kind!==version.kind)throw new Error('Recovery asset kind mismatch');
  if(seen.has(key)||(record.schema===1&&items.some(item=>item.r.id===r.id)))throw new Error('Duplicate recovery asset version');seen.add(key);
  if(typeof r.bundle_sha256!=='string'||!digest.test(r.bundle_sha256))throw new Error('Invalid recovery bundle digest');
  const rel=record.schema===2?r.id+'/'+r.version:r.id;
  if(record.schema===2&&r.path!==rel)throw new Error('Recovery record path mismatch');
  const src=await confined(source,rel);if((await tree(src)).sha256!==r.bundle_sha256)throw new Error('Recovery integrity mismatch');await metadataFor(src,version);
  const dst=await confined(root,'.asset-state/versions/'+key,{mustExist:false});items.push({r:version,src,dst,bundleDigest:r.bundle_sha256});
 }
 if(refs&&(refs.length!==items.length||refs.some(ref=>!items.some(item=>item.r.id===ref.id&&item.r.version===ref.version&&item.r.sha256===ref.sha256))))throw new Error('Recovery history closure incomplete');
 return {source,record,catalog,items};
}
export async function exportRecovery(root,destination){
 return serialized(root,async()=>{
  const catalog=await loadCatalog(root),stateFile=await confined(root,'.asset-state/active.json'),text=await fs.readFile(stateFile,'utf8'),state=JSON.parse(text);
  const refs=referencedVersions(state,catalog);destination=path.resolve(destination);
  const versionsRoot=path.join(await fs.realpath(root),'.asset-state/versions');if(destination===versionsRoot||destination.startsWith(versionsRoot+path.sep))throw new Error('Recovery export cannot be nested inside version storage');
  await noLinkedOutput(destination);if(await exists(destination))throw new Error('Recovery export target exists');await fs.mkdir(destination,{recursive:false});
  try{
   const records=[];
   for(const ref of refs){
    const dir=await confined(root,'.asset-state/versions/'+ref.id+'/'+ref.version);await metadataFor(dir,ref);
    const rel=ref.id+'/'+ref.version,target=path.join(destination,rel);await fs.mkdir(path.dirname(target),{recursive:true});const saved=await snapshot(dir,target);await metadataFor(target,ref);
    records.push({...ref,path:rel,bundle_sha256:saved.sha256});
   }
   if(await fs.readFile(stateFile,'utf8')!==text)throw new Error('Active state changed during export');
   await createJson(path.join(destination,'recovery.json'),{schema:2,revision:state.revision,records,selection:state,selection_sha256:sha256(JSON.stringify(state)),scope:'All versions referenced by current selection and activation/rollback history; not unreferenced stages, client config or memory databases.'});
   return {destination,versions:records.length,active_assets:Object.keys(state.active).length,revision:state.revision,history_complete:true};
  }catch(e){await fs.rm(destination,{recursive:true,force:true});throw e;}
 });
}
export async function inspectRecovery(root,bundle){
 const {record,items}=await readBundle(root,bundle),versions=[];
 for(const item of items){const present=await exists(item.dst);let matches=false;if(present)matches=(await tree(item.dst)).sha256===(await tree(item.src)).sha256;versions.push({...item.r,present,matches});}
 return {schema:record.schema,versions,history_complete:record.schema===2,selection_restoration_supported:record.schema===2,activated:false};
}
export async function restoreRecovery(root,bundle){
 return serialized(root,async()=>{
  const {record,items}=await readBundle(root,bundle);
  for(const item of items)if(await exists(item.dst))throw new Error('Restore target exists; current state untouched');
  const created=[];
  try{for(const item of items){await fs.mkdir(path.dirname(item.dst),{recursive:true});await confined(root,path.relative(root,item.dst).split(path.sep).join('/'),{mustExist:false});const copied=await snapshot(item.src,item.dst);created.push(item.dst);if(copied.sha256!==item.bundleDigest)throw new Error('Recovery source changed after verification');await metadataFor(item.dst,item.r);}}
  catch(e){for(const p of created)await fs.rm(p,{recursive:true,force:true});throw e;}
  return {restored:items.length,activated:false,history_complete:record.schema===2,note:'Restored version contents and review records only. Existing selection unchanged; schema 2 selection requires separate explicit approval.'};
 });
}
export async function restoreRecoverySelection(root,bundle,{approved=false,reviewer,note}={}){
 if(approved!==true||typeof reviewer!=='string'||!reviewer.trim()||typeof note!=='string'||!note.trim())throw new Error('Explicit selection approval, reviewer and note required');
 return serialized(root,async()=>{
  const {source,record,catalog,items}=await readBundle(root,bundle);if(record.schema!==2)throw new Error('Legacy recovery contains current snapshots only; selection history cannot be restored');
  const stateFile=await confined(root,'.asset-state/active.json',{mustExist:false});if(await exists(stateFile))throw new Error('Existing selection state preserved; use a clean runtime state');
  for(const item of items){
   if(!(await exists(item.dst)))throw new Error('Restore all version contents before selecting recovery state');
   if((await tree(item.dst)).sha256!==(await tree(item.src)).sha256)throw new Error('Restored version or approval record changed');
   const metadata=await metadataFor(item.dst,item.r),asset=catalog.get(item.r.id);await policy(root,asset);
   const validation=JSON.parse(await fs.readFile(await confined(item.dst,'latest-validation.json'),'utf8')),approval=JSON.parse(await fs.readFile(await confined(item.dst,'approval.json'),'utf8'));
   for(const doc of [validation,approval])if(doc.schema!==1||doc.id!==item.r.id||doc.version!==item.r.version||doc.sha256!==item.r.sha256)throw new Error('Recovery validation/approval identity mismatch');
   if(validation.status!=='VALIDATED'||typeof approval.reviewer!=='string'||!approval.reviewer.trim()||typeof approval.note!=='string'||!approval.note.trim())throw new Error('Recovery passing review required');
   if((await tree(await confined(root,asset.path))).sha256!==metadata.checkout_sha256)throw new Error('Local checkout differs from reviewed recovery baseline');
   await assertDeployableLicense(asset,await confined(item.dst,'content'));
  }
  const event={schema:1,id:crypto.randomUUID(),bundle:source,selection_sha256:record.selection_sha256,reviewer,note,time:new Date().toISOString()};
  const restored={...record.selection,revision:record.selection.revision+1,recovery_selection:event};
  if(!Number.isSafeInteger(restored.revision))throw new Error('Recovery revision overflow');
  await createJson(await confined(root,'.asset-state/recovery-selections/'+event.id+'.json',{mustExist:false}),event);
  // Exclusive final publication never replaces an existing state, even if another writer appears.
  const pending=await confined(root,'.asset-state/recovery-selections/'+event.id+'.state.json',{mustExist:false});
  if(await exists(pending))throw new Error('Recovery pending state already exists');
  let pendingCreated=false;
  try{const handle=await fs.open(pending,'wx');pendingCreated=true;try{await handle.writeFile(JSON.stringify(restored,null,2)+'\n');}finally{await handle.close();}
   await confined(root,'.asset-state/active.json',{mustExist:false});await fs.link(pending,stateFile);
  }finally{if(pendingCreated)await fs.unlink(pending);}
  return {selected:Object.keys(restored.active).length,revision:restored.revision,history_events:restored.history.length,approved:true,activated:true,client_config_modified:false,services_started:false};
 });
}
