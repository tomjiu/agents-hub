import fs from 'node:fs/promises';
import path from 'node:path';
import {exists,confined,sha256} from './files.mjs';

async function noLinkedAncestors(target) {
 for(let p=path.resolve(target);;p=path.dirname(p)){try{if((await fs.lstat(p)).isSymbolicLink())throw new Error('Linked composition path is not permitted');}catch(e){if(e.code!=='ENOENT')throw e;}if(path.dirname(p)===p)break;}
}
export async function composeRules(root,projectFile,output,{fragments=[]}={}) {
 if(!Array.isArray(fragments)||new Set(fragments).size!==fragments.length)throw new Error('Duplicate or invalid fragments');
 root=await fs.realpath(root);projectFile=path.resolve(projectFile);output=path.resolve(output);
 await noLinkedAncestors(projectFile);await noLinkedAncestors(output);
 const inputs=[{path:'agents-md/base/AGENTS.md',file:await confined(root,'agents-md/base/AGENTS.md')}];
 for(const name of fragments){if(typeof name!=='string'||!/^[a-z0-9-]+$/.test(name))throw new Error('Invalid fragment');const rel='agents-md/fragments/'+name+'.md';inputs.push({path:rel,file:await confined(root,rel)});}
 inputs.push({path:path.basename(projectFile),file:projectFile});
 const pieces=[];for(const item of inputs){item.text=await fs.readFile(item.file,'utf8');item.sha256=sha256(item.text);if(!item.text.trim()||item.text.includes('待填写')||item.text.includes('[待确认]'))throw new Error('Project template or selected rule source is incomplete');pieces.push(item.text.trim());}
 const sources=inputs.map(({path,sha256})=>({path,sha256}));
 if(await exists(output)||await exists(output+'.sources.json'))throw new Error('Output exists: generate a new candidate and review diff');
 await fs.mkdir(path.dirname(output),{recursive:true});await noLinkedAncestors(output);
 const lock=output+'.compose.lock';let handle;try{handle=await fs.open(lock,'wx');}catch(e){if(e.code==='EEXIST')throw new Error('Another composition holds output lock; inspect before recovery');throw e;}
 let temp,metadataPublished=false;
 const content=pieces.join(String.fromCharCode(10,10))+String.fromCharCode(10);
 const metadata=JSON.stringify({schema:1,sources,output_sha256:sha256(content),review_required:true,semantic_conflicts_checked:false},null,2)+String.fromCharCode(10);
 try{
  await handle.writeFile(JSON.stringify({pid:process.pid,output}));
  temp=await fs.mkdtemp(path.join(path.dirname(output),'.agents-compose-'));
  await fs.writeFile(path.join(temp,'content'),content,{flag:'wx'});await fs.writeFile(path.join(temp,'sources'),metadata,{flag:'wx'});
  for(const item of inputs)if(sha256(await fs.readFile(item.file))!==item.sha256)throw new Error('Rule source changed during composition');
  await noLinkedAncestors(output);if(await exists(output)||await exists(output+'.sources.json'))throw new Error('Output appeared during composition; preserved');
  // Sidecar first,正文 last: final output appears only after its provenance is prepared.
  await fs.link(path.join(temp,'sources'),output+'.sources.json');metadataPublished=true;
  await fs.link(path.join(temp,'content'),output);
  return {output,sources,review_required:true,semantic_conflicts_checked:false};
 }catch(e){
  if(metadataPublished){const bytes=await fs.readFile(output+'.sources.json').catch(()=>null);if(bytes&&sha256(bytes)===sha256(metadata))await fs.unlink(output+'.sources.json');else throw new Error(e.message+'; changed source sidecar preserved for manual recovery');}
  throw e;
 }finally{if(temp)await fs.rm(temp,{recursive:true,force:true});await handle.close();await fs.unlink(lock);}
}
