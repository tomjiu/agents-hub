import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {loadCatalog,resolveProfile} from './catalog.mjs';
import {createProfileView} from './views.mjs';
import {confined,exists,createJson,atomicWrite,sha256,snapshot} from './files.mjs';

const skillRoots={dsh:'.dsh/skills',codex:'.agents/skills',opencode:'.opencode/skills'};
const clients=Object.keys(skillRoots);
function clientName(client){if(!clients.includes(client))throw new Error('Unknown deployment client');return client;}
function deploymentId(id){if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))throw new Error('Invalid deployment ID');return id;}
async function projectRoot(root,project){
 if(typeof project!=='string'||!project)throw new Error('Explicit existing project directory required');
 const resolved=await fs.realpath(project);
 if(!(await fs.stat(resolved)).isDirectory())throw new Error('Project must be a directory');
 const source=await fs.realpath(root);
 if(resolved===source||resolved.startsWith(source+path.sep))throw new Error('Deploy to a consumer project, not the maintenance repository');
 return resolved;
}
async function withProjectLock(project,fn){
 const state=await confined(project,'.agents-hub',{mustExist:false});await fs.mkdir(state,{recursive:true});
 const lock=await confined(project,'.agents-hub/operation.lock',{mustExist:false});let handle;
 try{handle=await fs.open(lock,'wx');}catch(e){if(e.code==='EEXIST')throw new Error('Project deployment lock exists; inspect owner before recovery');throw e;}
 try{await handle.writeFile(JSON.stringify({pid:process.pid,time:new Date().toISOString()}));return await fn();}
 finally{await handle.close();await fs.unlink(lock);}
}
// No exclusions here: a user's new node_modules, cache, dotfile or symlink also blocks uninstall.
export async function deployedDigest(dir){
 const files=[];
 async function visit(current,rel=''){
  const entries=(await fs.readdir(current,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  for(const e of entries){const key=rel?rel+'/'+e.name:e.name,p=path.join(current,e.name);const stat=await fs.lstat(p);
   if(stat.isSymbolicLink())throw new Error('Deployment has a linked file: '+key);
   if(stat.isDirectory()){files.push({path:key,directory:true});await visit(p,key);}
   else if(stat.isFile()){const bytes=await fs.readFile(p);files.push({path:key,bytes:bytes.length,sha256:sha256(bytes)});}
   else throw new Error('Deployment contains unsupported file: '+key);
  }
 }
 if((await fs.lstat(dir)).isSymbolicLink())throw new Error('Deployment root is linked');
 await visit(dir);return sha256(JSON.stringify(files));
}
export async function planDeployment(root,client,project){
 clientName(client);const target=await projectRoot(root,project),catalog=await loadCatalog(root);
 const {profile,selected}=await resolveProfile(root,client,catalog);
 // Non-skill installation needs separate verified adapters, not a silent partial success.
 if(selected.mcp.length||selected.plugins.length)throw new Error('This installer supports skills only; selected MCP/plugins require explicit reviewed adapters');
 const view=await createProfileView(root,client);
 try{
  const entries=[];
  for(const s of view.skills){const rel=skillRoots[client]+'/'+s.name,dest=await confined(target,rel,{mustExist:false});entries.push({id:s.id,name:s.name,path:rel,sha256:s.sha256,digest:await deployedDigest(path.join(view.destination,'skills',s.name)),conflict:await exists(dest)});}
  return {schema:1,client,project:target,profile_enabled:profile.enabled,skills:entries,conflicts:entries.filter(e=>e.conflict).map(e=>e.path),approved:false,config_modified:false,scope:'Project-local Skill deployment; Codex/OpenCode discovery still needs actual client verification.'};
 }finally{await fs.rm(view.destination,{recursive:true,force:true});}
}
export async function deployProfile(root,client,project,{approved=false}={}){
 if(approved!==true)throw new Error('Explicit approval required: use --approve for this project-local deployment');
 clientName(client);const target=await projectRoot(root,project);
 return withProjectLock(target,async()=>{
  const plan=await planDeployment(root,client,target);
  if(plan.conflicts.length)throw new Error('Existing skills are preserved; deployment conflicts: '+plan.conflicts.join(', '));
  const view=await createProfileView(root,client),id=crypto.randomUUID();
  const receiptPath=await confined(target,'.agents-hub/deployments/'+id+'.json',{mustExist:false});
  const receipt={...plan,id,status:'PREPARED',approved:true,created:new Date().toISOString(),maintenance_source:await fs.realpath(root),skills:plan.skills.map(s=>({...s,installed:false}))};
  let receiptCreated=false;
  try{
   // Record expected complete contents before effects, so interrupted copies are never mistaken for disposable garbage.
   for(const s of receipt.skills){const actual=await deployedDigest(path.join(view.destination,'skills',s.name));if(actual!==s.digest)throw new Error('Skill selection changed during deployment');}
   await createJson(receiptPath,receipt);receiptCreated=true;
   for(const s of receipt.skills){
    const dest=await confined(target,s.path,{mustExist:false});if(await exists(dest))throw new Error('Target appeared during deployment; not overwritten: '+s.path);
    await fs.mkdir(path.dirname(dest),{recursive:true});
    await confined(target,s.path,{mustExist:false});
    await snapshot(path.join(view.destination,'skills',s.name),dest);
    if(await deployedDigest(dest)!==s.digest)throw new Error('Deployed content changed: '+s.path);
    s.installed=true;await atomicWrite(receiptPath,JSON.stringify(receipt,null,2)+'\n');
   }
   receipt.status='INSTALLED';await atomicWrite(receiptPath,JSON.stringify(receipt,null,2)+'\n');
   return receipt;
  }catch(e){
   if(receiptCreated){receipt.status='FAILED';receipt.error=e.message;await atomicWrite(receiptPath,JSON.stringify(receipt,null,2)+'\n');}
   throw e;
  }finally{await fs.rm(view.destination,{recursive:true,force:true});}
 });
}
async function loadReceipt(project,id){
 const file=await confined(project,'.agents-hub/deployments/'+deploymentId(id)+'.json');const receipt=JSON.parse(await fs.readFile(file,'utf8'));
 if(receipt.schema!==1||receipt.approved!==true||receipt.id!==id||receipt.project!==project||!clients.includes(receipt.client)||!Array.isArray(receipt.skills)||!['PREPARED','INSTALLED','FAILED','REMOVING','REMOVED'].includes(receipt.status))throw new Error('Invalid deployment receipt');
 const seen=new Set();for(const s of receipt.skills){if(typeof s.installed!=='boolean'||typeof s.name!=='string'||typeof s.path!=='string'||typeof s.digest!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(s.name)||s.path!==skillRoots[receipt.client]+'/'+s.name||!/^[a-f0-9]{64}$/.test(s.digest)||seen.has(s.path))throw new Error('Unsafe deployment receipt entry');seen.add(s.path);}
 return {file,receipt};
}
export async function inspectDeployment(root,project,id){
 const target=await projectRoot(root,project),{receipt}=await loadReceipt(target,id),changes=[];
 for(const s of receipt.skills){const dest=await confined(target,s.path,{mustExist:false});changes.push({path:s.path,exists:await exists(dest),matches:await exists(dest)?await deployedDigest(dest)===s.digest:false});}
 return {id,status:receipt.status,project:target,skills:changes};
}
export async function uninstallDeployment(root,project,id,{approved=false}={}){
 if(approved!==true)throw new Error('Explicit uninstall approval required');
 const target=await projectRoot(root,project);
 return withProjectLock(target,async()=>{
  const {file,receipt}=await loadReceipt(target,id);
  if(receipt.status==='REMOVED')throw new Error('Deployment already removed');
  if(receipt.status==='REMOVING')throw new Error('Uninstall interrupted; inspect quarantine before continuing');
  // Validate all paths first. Do not partially remove the rest if any local changes exist.
  const present=[];
  for(const s of receipt.skills){const dest=await confined(target,s.path,{mustExist:false});if(!(await exists(dest)))continue;if(s.installed!==true)throw new Error('Unconfirmed partial deployment preserved for manual recovery: '+s.path);if(await deployedDigest(dest)!==s.digest)throw new Error('Local changes or unexpected files preserved: '+s.path);present.push({s,dest});}
  const quarantine=await confined(target,'.agents-hub/quarantine/'+id,{mustExist:false});if(await exists(quarantine))throw new Error('Existing quarantine requires manual inspection');await fs.mkdir(quarantine,{recursive:true});
  receipt.status='REMOVING';await atomicWrite(file,JSON.stringify(receipt,null,2)+'\n');const moved=[];
  try{
   for(const item of present){const dest=await confined(target,item.s.path);if(await deployedDigest(dest)!==item.s.digest)throw new Error('Content changed during uninstall');const q=path.join(quarantine,item.s.name);await fs.rename(dest,q);moved.push({...item,q});if(await deployedDigest(q)!==item.s.digest)throw new Error('Content changed while quarantining');}
   // Retain complete bytes in quarantine; no permanent data deletion is part of uninstall.
   receipt.status='REMOVED';receipt.quarantine='.agents-hub/quarantine/'+id;receipt.removed=new Date().toISOString();await atomicWrite(file,JSON.stringify(receipt,null,2)+'\n');
   return {id,status:'REMOVED',project:target,quarantined:moved.length,quarantine:receipt.quarantine,user_config_modified:false};
  }catch(e){
   const unresolved=[];for(const m of [...moved].reverse()){if(await exists(m.dest)){unresolved.push(m.s.path);continue;}try{await fs.rename(m.q,m.dest);}catch{unresolved.push(m.s.path);}}
   receipt.status=unresolved.length?'REMOVING':'FAILED';receipt.error=e.message;receipt.unresolved=unresolved;await atomicWrite(file,JSON.stringify(receipt,null,2)+'\n');throw e;
  }
 });
}
