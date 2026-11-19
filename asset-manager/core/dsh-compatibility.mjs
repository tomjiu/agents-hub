import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {requestJson} from '../providers/upstream.mjs';
import {sha256,tree,confined,createJson} from './files.mjs';
const seams=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-official-bundles','@deepseek-ai/dsh-tool-skill','@deepseek-ai/cordis','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-system-prompt','@deepseek-ai/dsh-skill-filesystem','@deepseek-ai/dsh-mcp-client','@deepseek-ai/dsh-llm-pi-ai','@deepseek-ai/dsh-headless'];
async function fingerprintPackage(require,name){
 const entry=require.resolve(name);let directory=path.dirname(entry),manifest;
 for(;;){try{const p=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));if(p.name===name){manifest=p;break;}}catch(e){if(e.code!=='ENOENT')throw e;}
  const parent=path.dirname(directory);if(parent===directory)throw new Error('Could not identify package '+name);directory=parent;
 }
 const hashes={};for(const p of ['package.json','lib','cordis.patch.yml']){const file=path.join(directory,p);try{const stat=await fs.stat(file);hashes[p]=stat.isDirectory()?(await tree(file)).sha256:sha256(await fs.readFile(file));}catch(e){if(e.code==='ENOENT'&&p==='lib'){hashes.entry=sha256(await fs.readFile(entry));}else if(e.code==='ENOENT'&&p==='cordis.patch.yml'){continue;}else throw e;}}
 return {name,version:manifest.version,hashes};
}
export async function dshFingerprint(root,installation){
 if(!installation)throw new Error('Explicit DSH installation directory required, not the user profile');
 const home=await fs.realpath(installation),meta=JSON.parse(await fs.readFile(path.join(home,'package.json'),'utf8'));
 if(meta.name!=='@deepseek-ai/dsh')throw new Error('Not a DSH installation');
 const require=createRequire(path.join(home,'package.json')),host=[];
 host.push({name:meta.name,version:meta.version,engines:meta.engines||{},package_sha256:sha256(await fs.readFile(path.join(home,'package.json'))),lib_sha256:(await tree(path.join(home,'lib'))).sha256});
 for(const name of seams)host.push(await fingerprintPackage(require,name));
 const assets={node_runtime:process.versions.node};
 for(const rel of ['plugins/memory-net/src','plugins/memory-net/adapters/dsh/src','plugins/memory-net/adapters/dsh/dist','mcp/servers/search-core/typescript/src','mcp/servers/search-core/typescript/dist'])assets[rel]=(await tree(await confined(root,rel))).sha256;
 for(const rel of ['plugins/memory-net/adapters/dsh/package.json','plugins/memory-net/adapters/dsh/package-lock.json','mcp/registry.toml','asset-manager/core/views.mjs','asset-manager/core/license-review.mjs','asset-manager/core/mcp-config.mjs','plugins/memory-net/adapters/dsh/dist/adapters/dsh/src/index.js','mcp/servers/search-core/typescript/package.json','mcp/servers/search-core/typescript/package-lock.json','mcp/servers/search-core/typescript/dist/mcp.js'])assets[rel]=sha256(await fs.readFile(await confined(root,rel)));
 return {schema:1,version:meta.version,host,host_sha256:sha256(JSON.stringify(host)),assets,assets_sha256:sha256(JSON.stringify(assets))};
}
export function classifyDshCompatibility(fingerprint,acceptances){
 if(!Array.isArray(acceptances))throw new Error('Invalid DSH acceptance registry');
 const match=acceptances.find(r=>r.status==='PASS'&&r.host_version===fingerprint.version&&r.fingerprint?.host_sha256===fingerprint.host_sha256&&r.fingerprint?.assets_sha256===fingerprint.assets_sha256&&r.skill?.full_content_seen_by_model===true&&r.mcp?.result_returned_to_model===true&&r.parallel_discovery===true&&['queried','refs_returned','cache_hit','cache_isolated'].every(key=>r.search?.[key]===true)&&['persisted','prompt_injection','auto_observe','self_filter'].every(key=>r.memory?.[key]===true));
 return {status:match?'VERIFIED':'NEEDS_ACCEPTANCE',host_version:fingerprint.version,host_sha256:fingerprint.host_sha256,assets_sha256:fingerprint.assets_sha256,supported_for_current_assets:!!match,auto_upgrade:false,auto_enable:false,reason:match?'Exact host and current asset fingerprints have passed real isolated DSH host tests.':'New/changed DSH or asset code requires real host acceptance; version string alone is insufficient.'};
}
export async function checkDshCompatibility(root,installation){
 const fingerprint=await dshFingerprint(root,installation),file=await confined(root,'catalog/runtime/dsh-compatibility.json');
 const registry=JSON.parse(await fs.readFile(file,'utf8'));if(registry.schema!==1||!Array.isArray(registry.acceptances))throw new Error('Invalid DSH compatibility registry');
 return {...classifyDshCompatibility(fingerprint,registry.acceptances),registry:'catalog/runtime/dsh-compatibility.json',scope:'DSH only. A passing gate is not permission to upgrade/install the live user profile.'};
}
export async function saveDshAcceptance(root,report){
 if(report.status!=='PASS'||!report.fingerprint||typeof report.host_version!=='string'||!/^[0-9]+[.][0-9]+[.][0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(report.host_version)||report.host_version!==report.fingerprint.version||!['host_sha256','assets_sha256'].every(key=>typeof report.fingerprint[key]==='string'&&/^[a-f0-9]{64}$/.test(report.fingerprint[key]))||!['persisted','prompt_injection','auto_observe','self_filter'].every(key=>report.memory?.[key]===true)||!['queried','refs_returned','cache_hit','cache_isolated'].every(key=>report.search?.[key]===true)||report.parallel_discovery!==true||!report.mcp?.result_returned_to_model||!report.skill?.full_content_seen_by_model)throw new Error('Complete host acceptance required');
 const dir=await confined(root,'.asset-state/evidence/dsh-compatibility',{mustExist:false});await fs.mkdir(dir,{recursive:true});
 const name=report.host_version+'-'+report.fingerprint.host_sha256.slice(0,12)+'-'+report.fingerprint.assets_sha256.slice(0,12)+'-parallel.json';
 const file=path.join(dir,name);try{await createJson(file,report);}catch(e){if(e.code!=='EEXIST')throw e;const prior=JSON.parse(await fs.readFile(file,'utf8'));if(prior.fingerprint.host_sha256!==report.fingerprint.host_sha256||prior.fingerprint.assets_sha256!==report.fingerprint.assets_sha256)throw new Error('Acceptance collision');}
 return file;
}

export async function checkDshUpstream(root,{request=requestJson}={}){
 const registry=JSON.parse(await fs.readFile(await confined(root,'catalog/runtime/dsh-compatibility.json'),'utf8'));
 if(registry.schema!==1||!Array.isArray(registry.acceptances))throw new Error('Invalid DSH compatibility registry');
 const tags=await request('https://registry.npmjs.org/-/package/@deepseek-ai%2fdsh/dist-tags');
 const versions={};
 for(const channel of ['latest','next']){const version=tags[channel];if(typeof version!=='string'||!version.match(/^[0-9]+[.][0-9]+[.][0-9]+(?:-[a-zA-Z0-9.-]+)?$/))throw new Error('Invalid npm DSH version tag');versions[channel]={version,has_recorded_acceptance:registry.acceptances.some(r=>r.status==='PASS'&&r.host_version===version)};}
 return {channels:versions,status:Object.values(versions).some(v=>!v.has_recorded_acceptance)?'ACCEPTANCE_REQUIRED':'CHANNELS_HAVE_EVIDENCE',auto_upgrade:false,auto_enable:false,scope:'Public npm release discovery only. check-dsh validates installed package and current plugin fingerprints; tag/version alone never authorizes adoption.'};
}
