import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {loadCatalog,readToml,resolveExpert} from './catalog.mjs';
import {effectivePath} from './lifecycle.mjs';
import {assertDeployableLicense} from './license-review.mjs';
import {confined,assetId} from './files.mjs';
import {checkDshCompatibility} from './dsh-compatibility.mjs';
import {validateLaunch} from '../mcp-launcher.mjs';
export const blockedMcpStatuses=['unlocked-upstream','external-install-required','review-required','upstream-diff-pending'];
export async function skillMetadata(source){
 const text=await fs.readFile(await confined(source,'SKILL.md'),'utf8'),front=/^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
 if(!front)throw new Error('Missing Skill frontmatter');const data=YAML.parse(front[1]);
 if(typeof data?.name!=='string'||!data.name.trim()||typeof data?.description!=='string'||!data.description.trim())throw new Error('Invalid Skill name/description');
 return {name:data.name,description:data.description,portable:/^[a-z0-9][a-z0-9-]{0,63}$/.test(data.name)};
}
// Machine-checkable combination rules only. Does not claim to understand semantic prompt conflicts.
export async function selectionConflicts(root,selected,{catalog}={}){
 catalog=catalog||await loadCatalog(root);const issues=[],names=new Map(),ids=new Set();
 for(const kind of ['skills','mcp','plugins']){
  if(!Array.isArray(selected[kind]))throw new Error('Invalid selected list '+kind);
  for(const id of selected[kind]){assetId(id);if(catalog.get(id)?.kind!==kind)throw new Error('Invalid selected '+kind+' reference '+id);if(ids.has(id))issues.push({code:'duplicate-selection',ids:[id],reason:'Same asset selected more than once'});ids.add(id);}
 }
 for(const id of ids){const a=catalog.get(id);
  for(const required of a.requires||[])if(!ids.has(required))issues.push({code:'missing-dependency',ids:[id,required],reason:'Explicitly declared dependency is not selected'});
  for(const conflict of a.conflicts||[])if(ids.has(conflict)&&!issues.some(i=>i.code==='declared-conflict'&&i.ids.includes(id)&&i.ids.includes(conflict)))issues.push({code:'declared-conflict',ids:[id,conflict],reason:'Assets explicitly declare incompatibility'});
  if(a.kind==='skills'){try{const source=await effectivePath(root,a),m=await skillMetadata(source);if(!m.portable)issues.push({code:'client-name',ids:[id],reason:'Client-incompatible skill name '+m.name});const key=m.name.toLowerCase(),other=names.get(key);if(other)issues.push({code:'duplicate-skill-name',ids:[other,id],reason:'Multiple assets have client skill name '+m.name+'; select one implementation'});else names.set(key,id);}catch(e){issues.push({code:'invalid-skill',ids:[id],reason:e.message});}}
 }
 // Check runtime namespace separately from stable catalog IDs.
 const runtimeNames=new Map();for(const id of selected.mcp){const name=catalog.get(id).registry_id;if(!name){issues.push({code:'missing-runtime-id',ids:[id],reason:'MCP asset has no runtime registration ID'});continue;}if(runtimeNames.has(name))issues.push({code:'duplicate-mcp-runtime',ids:[runtimeNames.get(name),id],reason:'Multiple assets share MCP runtime ID '+name});else runtimeNames.set(name,id);}
 // Report declared cycles separately instead of auto-installing a dependency loop.
 const visiting=new Set(),visited=new Set();function visit(id,chain=[]){if(visiting.has(id)){issues.push({code:'dependency-cycle',ids:[...chain,id],reason:'Selected dependency cycle'});return;}if(visited.has(id))return;visiting.add(id);for(const dep of catalog.get(id).requires||[])if(ids.has(dep))visit(dep,[...chain,id]);visiting.delete(id);visited.add(id);}for(const id of ids)visit(id);
 return issues;
}
async function inspectOne(root,a,{client,registry,gate}){
 const blockers=[],warnings=[],requirements=[];let source,name=a.id,description=a.discovery?.description||a.notes||'',licenseBlocked=false;
 const block=(code,reason)=>blockers.push({code,reason});
 try{source=await effectivePath(root,a);}catch(e){block('source-integrity',e.message);}
 if(source){try{await assertDeployableLicense(a,source);}catch(e){licenseBlocked=e.message.startsWith('Declared license restriction');block(licenseBlocked?'license':'license-evidence',e.message);}}
 if(a.source?.upstream_identity_status==='unverified')warnings.push('Upstream identity unverified; maintenance URL is not provenance proof');
 if(a.source?.license==='review-required')warnings.push('License evidence still needs review; structural readiness is not legal approval');
 if(a.runtime_review_required)block('vendor-review','Vendor license/host requirements must be reviewed; not portable-by-default');
 if(a.kind==='skills'&&source){try{const m=await skillMetadata(source);name=m.name;description=m.description;if(!m.portable)block('client-name','Client-incompatible skill name '+m.name);}catch(e){block('skill-metadata',e.message);}}
 if(a.kind==='mcp'){
  const servers=registry?.servers?.filter(s=>s.id===a.registry_id)||[];const s=servers[0];
  if(servers.length!==1)block('mcp-registration','MCP runtime registration must exist exactly once');
  if(s){
   if(blockedMcpStatuses.includes(s.status))block('mcp-review','MCP not deployable before review: '+s.status);
   if(s.clients!==undefined&&(!Array.isArray(s.clients)||s.clients.some(x=>typeof x!=='string')))block('host-metadata','Invalid MCP client list');
   else if(s.clients&&!s.clients.includes(client)&&client!=='generic')block('host-mismatch','MCP not registered for '+client);
   if(!['stdio','http'].includes(s.transport))block('transport','Unknown MCP transport');
   if(s.transport==='stdio'){
    if(!s.command||!Array.isArray(s.args))block('launch','Incomplete MCP command/args');
    for(const arg of Array.isArray(s.args)?s.args:[]){if(typeof arg!=='string'){block('launch','MCP argument must be a string');continue;}if(path.isAbsolute(arg))try{await fs.access(arg);}catch(e){block('build-entry','Absolute MCP entry does not exist');}if(arg.startsWith('mcp/'))try{const prefix=a.path+'/';if(arg.startsWith(prefix)&&source)await confined(source,arg.slice(prefix.length));else await confined(root,arg);}catch(e){block('build-entry','Missing/unsafe MCP entry: '+arg);}}
    if(s.cwd&&s.cwd!=='.')try{await confined(root,s.cwd);}catch(e){block('cwd','Missing/unsafe MCP cwd');}
    if(s.command&&Array.isArray(s.args))try{validateLaunch({schema:1,command:s.command,args:s.args,cwd:root,required_env:[],forward_env:[]});}catch(e){block('launch',e.message);}
    if(s.command)requirements.push('Installed executable '+s.command+' and package dependencies; preflight does not execute it');
   }else try{const url=new URL(s.url);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('Unsafe URL');}catch(e){block('endpoint','Credential-free HTTPS MCP URL required');}
   if(s.env_names!==undefined&&(!Array.isArray(s.env_names)||s.env_names.some(x=>typeof x!=='string'||!/^[_A-Z][_A-Z0-9]*$/.test(x))))block('auth-metadata','Invalid credential environment-name list');
   else if(s.env_names?.length){requirements.push('Private environment: '+s.env_names.join(', '));if(client==='dsh'||s.transport==='http')block('auth-mapping','Credential mapping requires a reviewed adapter, not automatic environment forwarding');}
   if(a.id==='mcp.search-core'&&client==='dsh'){if(source!==path.resolve(root,a.path))block('runtime-snapshot','Active search snapshot needs separately built runtime acceptance');requirements.push('Generate explicit DSH static-disclosure patch or guarded bundle; keep SC_DATA_DIR private');if(gate?.status!=='VERIFIED')requirements.push('Exact DSH runtime check-dsh acceptance required');}
   else requirements.push('Actual host/service acceptance not certified by this preflight');
  }
 }
 if(a.kind==='plugins'){
  if(client!=='dsh'||a.host&&a.host!==client)block('host-mismatch','Host-specific plugin cannot load in '+client);
  if(a.id==='memory-net'&&client==='dsh'){
   if(source!==path.resolve(root,a.path))block('runtime-snapshot','Active memory snapshot needs separately built runtime acceptance');
   if(source)try{await confined(source,'adapters/dsh/dist/adapters/dsh/src/index.js');}catch(e){block('build-entry','Memory-net DSH adapter must be built first');}
   requirements.push('Explicit --memory and new private workspace; view alone does not install this plugin');if(gate?.status!=='VERIFIED')requirements.push('Exact DSH runtime check-dsh acceptance required');
  }else block('plugin-adapter','No verified asset-manager runtime bundle adapter for this plugin');
 }
 if(a.kind==='agents-md')requirements.push('Compose complete project candidate, review semantic conflicts and existing project rules; do not replace automatically');
 const status=blockers.length?'BLOCKED':requirements.length?'CONDITIONAL':'CONTENT_READY';
 return {id:a.id,kind:a.kind,path:a.path,name,description:description.length>500?description.slice(0,500)+'…':description,status,blockers,warnings,requirements,declared_restriction:licenseBlocked,runtime_review_required:!!a.runtime_review_required,declared_dependencies:a.requires||[],declared_conflicts:a.conflicts||[],client,runtime_verified_for_installation:blockers.length===0&&client==='dsh'&&['memory-net','mcp.search-core'].includes(a.id)&&gate?.status==='VERIFIED',next_step:status==='BLOCKED'?'Resolve listed blockers without overwriting original asset':a.kind==='skills'?'Read canonical SKILL.md, then select/deploy only for a reviewed task':requirements.join('; ')};
}
export async function describeAssetUsability(root,ids,{client='dsh',installation}={}){
 if(!['dsh','codex','opencode','generic'].includes(client))throw new Error('Unknown audit client');root=await fs.realpath(root);const catalog=await loadCatalog(root);let registry;try{registry=await readToml(await confined(root,'mcp/registry.toml'));}catch(e){if(e.code!=='ENOENT')throw e;registry={servers:[]};}
 if(!Array.isArray(registry.servers))throw new Error('Invalid MCP registry servers');
 let gate;if(installation){if(client!=='dsh')throw new Error('Installation gate only applies to DSH');gate=await checkDshCompatibility(root,installation);}
 return Promise.all(ids.map(id=>{const asset=catalog.get(assetId(id));if(!asset)throw new Error('Unknown asset '+id);return inspectOne(root,asset,{client,registry,gate});}));
}
export async function auditAssetUsability(root,{client='dsh',installation}={}){
 if(!['dsh','codex','opencode','generic'].includes(client))throw new Error('Unknown audit client');
 root=await fs.realpath(root);const catalog=await loadCatalog(root);let registry;try{registry=await readToml(await confined(root,'mcp/registry.toml'));}catch(e){if(e.code!=='ENOENT')throw e;registry={servers:[]};}
 if(!Array.isArray(registry.servers))throw new Error('Invalid MCP registry servers');
 let gate;if(installation){if(client!=='dsh')throw new Error('Installation gate only applies to DSH');gate=await checkDshCompatibility(root,installation);}
 const assets=[];for(const a of catalog.values())assets.push(await inspectOne(root,a,{client,registry,gate}));
 const selected={skills:[],mcp:[],plugins:[]};for(const a of catalog.values())if(Object.hasOwn(selected,a.kind))selected[a.kind].push(a.id);
 const conflicts=await selectionConflicts(root,selected,{catalog});
 const counts={total:assets.length,content_ready:assets.filter(a=>a.status==='CONTENT_READY').length,conditional:assets.filter(a=>a.status==='CONDITIONAL').length,blocked:assets.filter(a=>a.status==='BLOCKED').length};
 return {schema:1,client,counts,assets,whole_catalog_conflicts:conflicts,installation_gate:gate||null,auto_enabled:false,scope:'All registered assets checked for structure, declared license/host/launch barriers and explicit conflicts. CONTENT_READY means readable content, not tested instructions or runtime/legal certification. Do not load the whole catalog at once.'};
}
export async function preflightSelection(root,{client='dsh',ids,expert,installation}={}){
 if(!!ids===!!expert)throw new Error('Select explicit IDs or one expert, not both');
 const catalog=await loadCatalog(root),selected={skills:[],mcp:[],plugins:[]};
 if(expert!==undefined&&typeof expert!=='string')throw new Error('Expert must be a name');
 if(expert)Object.assign(selected,await resolveExpert(root,expert,catalog));else{if(!Array.isArray(ids)||!ids.length)throw new Error('Nonempty selected IDs required');for(const id of ids){assetId(id);const a=catalog.get(id);if(!a)throw new Error('Unknown asset '+id);if(!Object.hasOwn(selected,a.kind))throw new Error('Rules templates use compose, not a runtime asset selection: '+id);selected[a.kind].push(id);}}
 const audit=await auditAssetUsability(root,{client,installation}),selectedIds=Object.values(selected).flat(),assets=audit.assets.filter(a=>selectedIds.includes(a.id));const conflicts=await selectionConflicts(root,selected,{catalog});
 const blockers=assets.flatMap(a=>a.blockers.map(b=>({id:a.id,...b}))),requirements=assets.flatMap(a=>a.requirements.map(reason=>({id:a.id,reason})));
 return {schema:1,client,expert:expert||null,selected,assets,conflicts,blockers,requirements,status:conflicts.length||blockers.length?'BLOCKED':requirements.length?'CONDITIONAL':'CONTENT_READY',auto_enabled:false,writes:false,scope:'Read-only declared composition preflight; no semantic conflict guarantee, credentials checked or services started.'};
}
