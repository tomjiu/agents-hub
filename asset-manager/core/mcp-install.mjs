import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import {parse,stringify} from 'smol-toml';
import {loadCatalog,resolveProfile,resolveExpert} from './catalog.mjs';
import {createView} from './views.mjs';
import {confined,exists,createJson,atomicWrite,sha256,tree} from './files.mjs';
import {serialized} from './lifecycle.mjs';
import {withProjectLock} from './deployment.mjs';
function assertJsonNumbers(value){if(typeof value==='number'&&(!Number.isFinite(value)||!Number.isSafeInteger(value)&&Number.isInteger(value)))throw new Error('Existing JSON contains unsafe numbers; manual merge required');if(value&&typeof value==='object')for(const child of Object.values(value))assertJsonNumbers(child);}
const locations={opencode:'opencode.json',codex:'.codex/config.toml',dsh:'.dsh/agents-hub-mcp.patch.yml'};
const filenames={opencode:'opencode.json',codex:'config.toml',dsh:'dsh-mcp.patch.yml'};
function identity(client,id){if(!Object.hasOwn(locations,client))throw new Error('Unsupported configuration client');if(id!==undefined&&(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)))throw new Error('Invalid MCP configuration change ID');}
async function projectRoot(root,project){if(typeof project!=='string'||!project)throw new Error('Existing consumer project required');const p=await fs.realpath(project),r=await fs.realpath(root);if(p===r||p.startsWith(r+path.sep)||!(await fs.stat(p)).isDirectory())throw new Error('Not a consumer project');return p;}
function dictionary(v,name){if(v!==undefined&&(v===null||typeof v!=='object'||Array.isArray(v)))throw new Error('Invalid '+name+' configuration');return v||{};}
export function mergeMcpConfig(client,current,incoming){
 identity(client);
 if(client==='opencode'){
  const before=current?JSON.parse(current):{};dictionary(before,'root');assertJsonNumbers(before);const generated=JSON.parse(incoming);dictionary(generated.mcp,'mcp');const servers=dictionary(before.mcp,'existing mcp');
  for(const id of Object.keys(generated.mcp))if(Object.hasOwn(servers,id))throw new Error('Existing MCP registration preserved: '+id);
  const merged={...before,mcp:{...servers,...generated.mcp}};return JSON.stringify(merged,null,2)+String.fromCharCode(10);
 }
 if(client==='codex'){
  const before=current?parse(current):{},generated=parse(incoming);const servers=dictionary(before.mcp_servers,'mcp_servers');
  for(const id of Object.keys(generated.mcp_servers||{}))if(Object.hasOwn(servers,id))throw new Error('Existing MCP registration preserved: '+id);
  // Append new fully-qualified tables; preserve all original TOML bytes and comments.
  const addition=stringify({mcp_servers:generated.mcp_servers}).trimEnd();
  const output=(current?current+(current.endsWith(String.fromCharCode(10))?'':String.fromCharCode(10)):'')+String.fromCharCode(10)+addition+String.fromCharCode(10);
  const decoded=parse(output);for(const [key,value] of Object.entries(before))if(key!=='mcp_servers'&&JSON.stringify(decoded[key])!==JSON.stringify(value))throw new Error('Existing TOML semantics changed');return output;
 }
 const before=current?YAML.parseDocument(current):new YAML.Document([]);if(before.errors.length)throw new Error('Invalid DSH patch YAML');
 const old=before.toJSON()||[];if(!Array.isArray(old))throw new Error('DSH patch must be an operation sequence');
 for(const op of old){if(!op||typeof op!=='object'||Array.isArray(op))throw new Error('Invalid existing DSH operation');if(op.insert!==undefined&&!Array.isArray(op.insert))throw new Error('Invalid existing DSH insert operation');}
 const next=YAML.parse(incoming);if(!Array.isArray(next))throw new Error('Generated DSH patch must be a sequence');
 const ids=new Set(),names=new Set();for(const op of old)for(const node of op.insert||[]){if(node.id)ids.add(node.id);if(node.config?.serverName)names.add(node.config.serverName);}
 for(const op of next)for(const node of op.insert||[])if(ids.has(node.id)||names.has(node.config?.serverName))throw new Error('Existing DSH MCP instance preserved: '+node.id);
 for(const op of next)before.add(op);return before.toString();
}
async function readTarget(project,client){const file=await confined(project,locations[client],{mustExist:false});if(!(await exists(file)))return {file,bytes:null,sha256:null};const stat=await fs.stat(file);if(!stat.isFile())throw new Error('Configuration target is not a file');if(stat.size>2*1024*1024)throw new Error('Existing configuration exceeds review size');const bytes=await fs.readFile(file);try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('Existing config must be valid UTF-8');}return {file,bytes,sha256:sha256(bytes),mode:stat.mode & 0o777};}
export async function prepareMcpInstall(root,client,project,{expert}={}){
 identity(client);root=await fs.realpath(root);const target=await projectRoot(root,project),catalog=await loadCatalog(root);const selected=expert?await resolveExpert(root,expert,catalog):(await resolveProfile(root,client,catalog)).selected;
 if(selected.plugins.length)throw new Error('Plugin installation requires separate reviewed adapter');if(!selected.mcp.length)throw new Error('Profile selects no MCP services');
 if(client==='opencode'&&await exists(await confined(target,'opencode.jsonc',{mustExist:false})))throw new Error('Existing opencode.jsonc requires manual merge; do not create conflicting config');
 return serialized(root,async()=>{
  const view=await createView(root,client,'profile:'+client,{selection:{skills:[],mcp:selected.mcp,plugins:[]}});
  let prepared=false;
  try{
   const before=await readTarget(target,client),addition=await fs.readFile(path.join(view.destination,filenames[client]),'utf8');
   const content=mergeMcpConfig(client,before.bytes?.toString('utf8')||'',addition),id=crypto.randomUUID();
   const dir=await confined(root,'.asset-state/mcp-config/'+id,{mustExist:false});await fs.mkdir(dir,{recursive:true,mode:0o700});
   await fs.writeFile(path.join(dir,'candidate'),content,{flag:'wx',mode:0o600});
   if(before.bytes)await fs.writeFile(path.join(dir,'before'),before.bytes,{flag:'wx',mode:0o600});
   const record={schema:1,id,client,project:target,path:locations[client],services:selected.mcp,before_sha256:before.sha256,before_mode:before.mode||0o600,candidate_sha256:sha256(content),status:'PREPARED',selection:expert?'expert:'+expert:'profile:'+client,view_path:view.destination,view_sha256:(await tree(view.destination)).sha256,launcher_sha256:client==='opencode'?sha256(await fs.readFile(await confined(root,'asset-manager/mcp-launcher.mjs'))):null,approval:false,auto_loaded:false,created:new Date().toISOString()};
   await createJson(path.join(dir,'change.json'),record);prepared=true;return {...record,candidate:path.join(dir,'candidate'),notes:client==='dsh'?'Pass this patch explicitly to DSH; creating it does not change the live profile.':'Review candidate and before bytes; apply requires explicit approval.'};
  }finally{if(!prepared)await fs.rm(view.destination,{recursive:true,force:true});}
 });
}
async function recordFor(root,id){identity('dsh',id);const dir=await confined(root,'.asset-state/mcp-config/'+id);const record=JSON.parse(await fs.readFile(await confined(dir,'change.json'),'utf8'));identity(record.client,id);if(record.schema!==1||record.id!==id||record.path!==locations[record.client]||(record.before_sha256!==null&&!/^[a-f0-9]{64}$/.test(record.before_sha256))||!/^[a-f0-9]{64}$/.test(record.candidate_sha256)||!['PREPARED','APPLYING','APPLIED','ROLLING_BACK','ROLLED_BACK','FAILED'].includes(record.status))throw new Error('Invalid configuration record');const project=await projectRoot(root,record.project);if(project!==record.project)throw new Error('Consumer project moved since review');return {dir,record,project};}
export async function applyMcpInstall(root,id,{approved=false}={}){
 if(approved!==true)throw new Error('Explicit MCP configuration approval required');root=await fs.realpath(root);
 return serialized(root,async()=>{
  const {dir,record,project}=await recordFor(root,id);if(record.status!=='PREPARED')throw new Error('Configuration change is not prepared');
  return withProjectLock(project,async()=>{
  if(typeof record.view_path!=='string'||!record.view_path.startsWith(path.join(root,'.asset-state/views')+path.sep)||(await tree(await confined(root,path.relative(root,record.view_path).split(path.sep).join('/')))).sha256!==record.view_sha256)throw new Error('Reviewed MCP view or launch descriptor changed');
  const runtime=JSON.parse(await fs.readFile(path.join(record.view_path,'mcp-runtime.json'),'utf8'));
  for(const asset of runtime.assets){const rel=path.relative(root,asset.source).split(path.sep).join('/');if((await tree(await confined(root,rel))).sha256!==asset.source_sha256)throw new Error('MCP source changed since review: '+asset.id);for(const entry of asset.entry_files){const file=await confined(root,path.relative(root,entry.path).split(path.sep).join('/'));if(sha256(await fs.readFile(file))!==entry.sha256)throw new Error('MCP built entry changed since review: '+asset.id);}}
  if(record.client==='opencode'&&sha256(await fs.readFile(await confined(root,'asset-manager/mcp-launcher.mjs')))!==record.launcher_sha256)throw new Error('MCP launcher changed since review');
  if(record.client==='opencode'&&await exists(await confined(project,'opencode.jsonc',{mustExist:false})))throw new Error('Conflicting opencode.jsonc appeared since review');
  const current=await readTarget(project,record.client);if(current.sha256!==record.before_sha256)throw new Error('Consumer configuration changed since review; preserved');
  const candidate=await fs.readFile(await confined(dir,'candidate'));if(sha256(candidate)!==record.candidate_sha256)throw new Error('Candidate changed since preparation');
  const target=current.file;await fs.mkdir(path.dirname(target),{recursive:true});await confined(project,record.path,{mustExist:false});
  const saved=target+'.agents-hub-before-'+id,temp=target+'.agents-hub-new-'+id;
  if(await exists(saved)||await exists(temp))throw new Error('Existing temporary config artifacts require manual inspection');
  record.status='APPLYING';record.approval=true;await atomicWrite(path.join(dir,'change.json'),JSON.stringify(record,null,2)+String.fromCharCode(10));
  let moved=false;
  try{
   await fs.writeFile(temp,candidate,{flag:'wx',mode:record.before_mode||0o600});
   const check=await readTarget(project,record.client);if(check.sha256!==record.before_sha256)throw new Error('Consumer configuration changed before apply');
   if(current.bytes){await fs.rename(target,saved);moved=true;if(sha256(await fs.readFile(saved))!==record.before_sha256)throw new Error('Configuration changed while saving original');}
   // Link is exclusive: never overwrite a concurrently-created target.
   await fs.link(temp,target);await fs.unlink(temp);record.status='APPLIED';record.approval=true;record.original_backup=moved?path.basename(saved):null;record.applied=new Date().toISOString();await atomicWrite(path.join(dir,'change.json'),JSON.stringify(record,null,2)+String.fromCharCode(10));
   return {id,status:'APPLIED',project,path:record.path,services:record.services,backup:moved?saved:null,auto_loaded:false};
  }catch(e){if(moved&&!(await exists(target)))try{await fs.link(saved,target);}catch{};record.status='FAILED';record.error=e.message;record.recovery_artifacts={saved,temp};await atomicWrite(path.join(dir,'change.json'),JSON.stringify(record,null,2)+String.fromCharCode(10));throw e;}
  });
 });
}
export async function rollbackMcpInstall(root,id,{approved=false}={}){
 if(approved!==true)throw new Error('Explicit MCP configuration rollback approval required');root=await fs.realpath(root);
 return serialized(root,async()=>{
  const {dir,record,project}=await recordFor(root,id);if(record.status!=='APPLIED')throw new Error('Configuration change is not applied');
  return withProjectLock(project,async()=>{
  const current=await readTarget(project,record.client);if(current.sha256!==record.candidate_sha256)throw new Error('Local configuration edits preserved; rollback stopped');
  const before=record.before_sha256?await fs.readFile(await confined(dir,'before')):null;if(before&&sha256(before)!==record.before_sha256)throw new Error('Original backup integrity mismatch');
  const displaced=await confined(project,record.path+'.agents-hub-removed-'+id,{mustExist:false});if(await exists(displaced))throw new Error('Rollback quarantine already exists');record.status='ROLLING_BACK';await atomicWrite(path.join(dir,'change.json'),JSON.stringify(record,null,2)+String.fromCharCode(10));
  try{await fs.rename(current.file,displaced);if(sha256(await fs.readFile(displaced))!==record.candidate_sha256)throw new Error('Configuration changed during rollback');if(before)await fs.writeFile(current.file,before,{flag:'wx',mode:record.before_mode||0o600});record.status='ROLLED_BACK';record.rolled_back=new Date().toISOString();await atomicWrite(path.join(dir,'change.json'),JSON.stringify(record,null,2)+String.fromCharCode(10));return {id,status:'ROLLED_BACK',project,path:record.path,quarantine:displaced,auto_loaded:false};}
  catch(e){if(!(await exists(current.file))&&await exists(displaced))try{await fs.link(displaced,current.file);}catch{};record.status='FAILED';record.error=e.message;record.recovery_artifacts={displaced};await atomicWrite(path.join(dir,'change.json'),JSON.stringify(record,null,2)+String.fromCharCode(10));throw e;}
  });
 });
}

export async function inspectMcpInstall(root,id){
 root=await fs.realpath(root);const {dir,record,project}=await recordFor(root,id);
 const current=await readTarget(project,record.client),candidate=await fs.readFile(await confined(dir,'candidate'));
 return {id,client:record.client,status:record.status,project,path:record.path,services:record.services,approval:record.approval,auto_loaded:false,current_matches_before:current.sha256===record.before_sha256,current_matches_candidate:current.sha256===record.candidate_sha256,candidate_matches_review:sha256(candidate)===record.candidate_sha256,recovery_required:['APPLYING','ROLLING_BACK','FAILED'].includes(record.status)};
}
