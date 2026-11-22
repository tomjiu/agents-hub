import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {loadCatalog,kinds} from './catalog.mjs';
import {confined,sha256} from './files.mjs';
import {describeAssetUsability,skillMetadata} from './usability.mjs';
import {effectivePath} from './lifecycle.mjs';
function tokens(text){const runs=text.toLowerCase().match(/[a-z0-9][a-z0-9._-]*|[\u3400-\u9fff]+/g)||[];return [...new Set(runs.flatMap(run=>/[\u3400-\u9fff]/.test(run)&&run.length>2?[run,...Array.from({length:run.length-1},(_,i)=>run.slice(i,i+2))]:[run]))];}
export async function searchAssets(root,query,{kind,limit=10,client='dsh'}={}){
 if(typeof query!=='string'||!query.trim()||query.length>500)throw new Error('Provide a nonempty query up to 500 characters');
 if(kind&&!kinds.includes(kind))throw new Error('Unknown asset kind');if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error('Limit must be 1..50');
 const catalog=await loadCatalog(root),words=tokens(query),results=[];if(!words.length)throw new Error('Query needs searchable letters or digits');
 for(const asset of catalog.values()){
  if(kind&&asset.kind!==kind)continue;let name=asset.id,description=asset.discovery?.description||asset.notes||'',metadata_valid=true;
  if(asset.kind==='skills'){try{const metadata=await skillMetadata(await effectivePath(root,asset));name=metadata.name;description=metadata.description;}catch{metadata_valid=false;description+=' [Invalid or unavailable effective Skill: inspect asset state and skills-status]';}}
  const id=(asset.id+' '+name).toLowerCase(),aliases=(asset.discovery?.aliases||[]).join(' ').toLowerCase(),body=(description+' '+asset.path+' '+(asset.source.url||'')).toLowerCase();let score=0;const phrase=query.trim().toLowerCase();if(asset.id.toLowerCase()===phrase)score+=100;else if(id.includes(phrase))score+=20;if(aliases.includes(phrase))score+=25;if(body.includes(phrase))score+=5;
  for(const word of words){if(id.includes(word))score+=5;if(aliases.includes(word))score+=4;if(body.includes(word))score+=1;}if(!score)continue;
  results.push({id:asset.id,kind:asset.kind,name,path:asset.path,description:description.length>500?description.slice(0,500)+'…':description,metadata_valid,score,source_kind:asset.source.kind,upstream:asset.version.upstream||'unknown',review_required:asset.runtime_review_required===true||asset.source.redistribution_review_required===true,declared_restriction:asset.source.license_status==='restricted-declared',instructions:'Read the canonical asset and inspect state before deployment; search never enables content.'});
 }
 results.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));const top=results.slice(0,limit),readiness=await describeAssetUsability(root,top.map(a=>a.id),{client});for(let i=0;i<top.length;i++){const r=readiness[i];Object.assign(top[i],{usability:r.status,blockers:r.blockers,requirements:r.requirements,warnings:r.warnings,declared_restriction:r.declared_restriction,next_step:r.next_step});}return {query,kind:kind||'all',client,total_matches:results.length,results:top,activated:false,scope:'Local registered metadata and Skill frontmatter; lexical matching, not semantic search or upstream discovery.'};
}
export async function inspectSkillDirectory(root){
 const catalog=await loadCatalog(root),skills=[...catalog.values()].filter(a=>a.kind==='skills'),registered=new Map(skills.map(a=>[a.path+'/SKILL.md',a.id]));if(registered.size!==skills.length)throw new Error('Multiple asset IDs point to one canonical Skill path');
 const files=[];async function visit(directory,rel){for(const entry of await fs.readdir(directory,{withFileTypes:true})){if(['node_modules','.git','.asset-state'].includes(entry.name))continue;const child=rel+'/'+entry.name;if(entry.isSymbolicLink())throw new Error('Linked skill directory is not permitted: '+child);if(entry.isDirectory())await visit(path.join(directory,entry.name),child);else if(entry.name==='SKILL.md')files.push(child);}}
 await visit(await confined(root,'skills'),'skills');files.sort();const records=[],invalid=[],incompatible=[],unregistered=[];const names=new Map();
 for(const file of files){const text=await fs.readFile(await confined(root,file),'utf8');const match=/^---\r?\n([\s\S]*?)\r?\n---/.exec(text);let data,error;try{if(!match)throw new Error('Missing YAML frontmatter');data=YAML.parse(match[1]);if(typeof data?.name!=='string'||!data.name.trim()||typeof data?.description!=='string'||!data.description.trim())throw new Error('Missing name/description');}catch(e){error=e.message;invalid.push({path:file,error});}
  const id=registered.get(file);if(typeof data?.name==='string'&&!/^[a-z0-9][a-z0-9-]{0,63}$/.test(data.name))incompatible.push({id:id||null,path:file,name:data.name,reason:'Client-safe lowercase name required before deployment; preserve vendor original'});if(!id)unregistered.push(file);const record={id:id||null,path:file,name:data?.name||null,description:data?.description||null,sha256:sha256(text),valid:!error};records.push(record);if(record.name){if(!names.has(record.name))names.set(record.name,[]);names.get(record.name).push({id:record.id,path:file});}}
 const missing=[...registered.keys()].filter(file=>!files.includes(file));
 const by_scope={individual:records.filter(r=>r.path.startsWith('skills/individual/')).length,vendors:records.filter(r=>r.path.startsWith('skills/collections/vendors/')).length,management:records.filter(r=>r.path.startsWith('skills/asset-management/')).length,other:records.filter(r=>!['skills/individual/','skills/collections/vendors/','skills/asset-management/'].some(prefix=>r.path.startsWith(prefix))).length};
 return {schema:1,total:files.length,registered:registered.size,by_scope,invalid,incompatible,unregistered,missing,duplicate_client_names:[...names].filter(([,entries])=>entries.length>1).map(([name,entries])=>({name,entries})),records,scope:'Read-only canonical SKILL.md inventory. Duplicate client names are alternative providers, not automatic deletion candidates.'};
}
