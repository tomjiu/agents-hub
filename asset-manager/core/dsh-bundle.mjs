import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import YAML from 'yaml';
import {checkDshCompatibility,dshFingerprint} from './dsh-compatibility.mjs';
import {createView} from './views.mjs';
import {loadCatalog,resolveExpert} from './catalog.mjs';
import {effectivePath} from './lifecycle.mjs';
import {confined,createJson,snapshot,tree,sha256} from './files.mjs';
import {deployedDigest} from './deployment.mjs';

export async function createDshBundle(root,installation,{expert='research',memory=false}={}){
 root=await fs.realpath(root);installation=await fs.realpath(installation);
 const gate=await checkDshCompatibility(root,installation);if(gate.status!=='VERIFIED')throw new Error('DSH/current asset acceptance required before packaging');
 const before=await dshFingerprint(root,installation),catalog=await loadCatalog(root),selected=await resolveExpert(root,expert,catalog);
 if(selected.mcp.some(id=>id!=='mcp.search-core'))throw new Error('Only Search-core MCP has real DSH bundle acceptance');
 if(selected.plugins.some(id=>id!=='memory-net'))throw new Error('Unsupported DSH plugin; no bundle adapter');
 if(selected.plugins.includes('memory-net')&&!memory)throw new Error('Explicit --memory required for memory-net workspace creation');
 const view=await createView(root,'dsh',expert,{selection:{...selected,plugins:[]}});
 const parent=await confined(root,'.asset-state/dsh-bundles',{mustExist:false});await fs.mkdir(parent,{recursive:true});const bundle=path.join(parent,crypto.randomUUID());await fs.mkdir(bundle);
 try{
  await snapshot(path.join(view.destination,'skills'),path.join(bundle,'skills'));
  const patch=YAML.parse(await fs.readFile(path.join(view.destination,'dsh-mcp.patch.yml'),'utf8'));
  for(const operation of patch)for(const node of operation.insert||[])if(node.name==='@deepseek-ai/dsh-mcp-client'&&node.config.serverName==='search-core')node.config.env={...node.config.env,SC_DATA_DIR:path.join(bundle,'state/search-core')};
  patch.unshift({id:'skill-filesystem',config:{includeDefaultRoots:true,customSkillDirs:[path.join(bundle,'skills')],watch:false}});
  if(memory){
   const asset=catalog.get('memory-net');if(!asset||asset.kind!=='plugins')throw new Error('memory-net is not registered');
   const source=await effectivePath(root,asset);if(source!==await confined(root,asset.path))throw new Error('Active memory snapshot requires its own built-runtime acceptance');const dist=await confined(source,'adapters/dsh/dist');
   await snapshot(dist,path.join(bundle,'memory-runtime'));
   await createJson(path.join(bundle,'memory-runtime/package.json'),{type:'module',private:true,description:'Generated deployment copy; not a maintenance source'});
   const entry=await confined(bundle,'memory-runtime/adapters/dsh/src/index.js');
   // Wrapper is loaded from a file URL: no modification of profile node_modules is needed.
   const guard=pathToFileURL(fileURLToPath(import.meta.url)).href;
   const wrapper=["import {verifyDshBundle} from "+JSON.stringify(guard)+";","export const name='agents-hub-memory-net';","export const inject=['systemPrompt','tools','agents','workingDirectory'];","export async function apply(ctx,config){await verifyDshBundle("+JSON.stringify(bundle)+",{requireRunningHost:true});const plugin=await import("+JSON.stringify(pathToFileURL(entry).href)+");if(!plugin.apply(ctx,config))throw new Error('Memory-net did not activate');}"].join(String.fromCharCode(10))+String.fromCharCode(10);
   await fs.writeFile(path.join(bundle,'memory-plugin.mjs'),wrapper,{flag:'wx'});
   patch.push({insert:[{id:'agents-hub-memory-net',name:pathToFileURL(path.join(bundle,'memory-plugin.mjs')).href,config:{enabled:true,context:{mode:'session'},workspaces_root:path.join(bundle,'state/memory-net'),default_workspace:'main',agent_id:'dsh-bundle',budgets:{max_nodes:24,max_tokens:2048},inject:{section_order:90},tools:{recall:true,write:true}}}]});
  }
  const runtime=JSON.parse(await fs.readFile(path.join(view.destination,'mcp-runtime.json'),'utf8'));for(const asset of runtime.assets)if(asset.source!==await confined(root,catalog.get(asset.id).path))throw new Error('Active MCP snapshot requires its own built-runtime acceptance');await createJson(path.join(bundle,'mcp-runtime.json'),runtime);
  await fs.writeFile(path.join(bundle,'bundle.patch.yml'),YAML.stringify(patch),{flag:'wx'});
  const artifacts={};for(const file of ['bundle.patch.yml','mcp-runtime.json',...(memory?['memory-plugin.mjs']:[])])artifacts[file]=sha256(await fs.readFile(path.join(bundle,file)));
  const directories={skills:await deployedDigest(path.join(bundle,'skills'))};if(memory)directories['memory-runtime']=await deployedDigest(path.join(bundle,'memory-runtime'));
  const after=await dshFingerprint(root,installation);if(after.host_sha256!==before.host_sha256||after.assets_sha256!==before.assets_sha256)throw new Error('DSH or assets changed during packaging');
  const manifest={schema:1,guard_sha256:sha256(await fs.readFile(fileURLToPath(import.meta.url))),id:path.basename(bundle),root,installation,host_version:gate.host_version,host_sha256:gate.host_sha256,assets_sha256:gate.assets_sha256,expert,skills:view.skills,mcp:runtime.assets.map(a=>a.id),memory,artifacts,directories,config_modified:false,profile_installed:false,auto_loaded:false};
  await createJson(path.join(bundle,'bundle.json'),manifest);
  return {...manifest,bundle,patch:path.join(bundle,'bundle.patch.yml'),verify:{command:process.execPath,args:[path.join(root,'asset-manager/cli.mjs'),'inspect-dsh-bundle',bundle]},launch:{command:process.execPath,args:[path.join(installation,'lib/bin.js'),'--profile','headless','--patch',path.join(bundle,'bundle.patch.yml')]},notes:'Review and verify before explicit launch. Memory defaults to private bundle state; no existing user database or profile is changed.'};
 }catch(e){await fs.rm(bundle,{recursive:true,force:true});throw e;}
 finally{await fs.rm(view.destination,{recursive:true,force:true});}
}
export async function verifyDshBundle(bundle,{requireRunningHost=false}={}){
 bundle=await fs.realpath(bundle);const manifest=JSON.parse(await fs.readFile(await confined(bundle,'bundle.json'),'utf8'));
 if(manifest.schema!==1||typeof manifest.memory!=='boolean'||!Array.isArray(manifest.skills)||!Array.isArray(manifest.mcp)||manifest.id!==path.basename(bundle)||typeof manifest.root!=='string'||typeof manifest.installation!=='string'||!manifest.artifacts||!manifest.directories)throw new Error('Invalid DSH bundle manifest');
 if(sha256(await fs.readFile(fileURLToPath(import.meta.url)))!==manifest.guard_sha256)throw new Error('Bundle verification implementation changed; rebuild candidate');
 const root=await fs.realpath(manifest.root);await confined(root,path.relative(root,bundle).split(path.sep).join('/'));
 if(path.dirname(bundle)!==path.join(root,'.asset-state/dsh-bundles'))throw new Error('Bundle not in registered state directory');
 if(requireRunningHost){if(!process.argv[1]||await fs.realpath(process.argv[1])!==await fs.realpath(path.join(manifest.installation,'lib/bin.js')))throw new Error('Running DSH does not match bundle target installation');}
 const gate=await checkDshCompatibility(root,manifest.installation);if(gate.status!=='VERIFIED'||gate.host_sha256!==manifest.host_sha256||gate.assets_sha256!==manifest.assets_sha256)throw new Error('DSH or current assets no longer match bundle acceptance');
 const expectedFiles=['bundle.patch.yml','mcp-runtime.json',...(manifest.memory?['memory-plugin.mjs']:[])],expectedDirs=['skills',...(manifest.memory?['memory-runtime']:[])];
 if(JSON.stringify(Object.keys(manifest.artifacts).sort())!==JSON.stringify(expectedFiles.sort())||JSON.stringify(Object.keys(manifest.directories).sort())!==JSON.stringify(expectedDirs.sort()))throw new Error('Invalid bundle content ownership');
 for(const [rel,hash] of Object.entries(manifest.artifacts))if(sha256(await fs.readFile(await confined(bundle,rel)))!==hash)throw new Error('DSH bundle artifact changed: '+rel);
 for(const [rel,hash] of Object.entries(manifest.directories))if(await deployedDigest(await confined(bundle,rel))!==hash)throw new Error('DSH bundle runtime changed: '+rel);
 if(manifest.memory)await confined(bundle,'state/memory-net',{mustExist:false});
 await confined(bundle,'state/search-core',{mustExist:false});
 const runtime=JSON.parse(await fs.readFile(await confined(bundle,'mcp-runtime.json'),'utf8'));
 for(const asset of runtime.assets){const source=await confined(root,path.relative(root,asset.source).split(path.sep).join('/'));if((await tree(source)).sha256!==asset.source_sha256)throw new Error('MCP source changed since bundle creation');for(const file of asset.entry_files){const entry=await confined(root,path.relative(root,file.path).split(path.sep).join('/'));if(sha256(await fs.readFile(entry))!==file.sha256)throw new Error('MCP entry changed since bundle creation');}}
 return {status:'VERIFIED',bundle,host_version:manifest.host_version,memory:manifest.memory,skills:manifest.skills.map(s=>s.name),mcp:manifest.mcp,auto_loaded:false,profile_modified:false};
}
