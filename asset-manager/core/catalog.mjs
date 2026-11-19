import fs from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'smol-toml';
import {confined,assetId} from './files.mjs';
export async function readToml(p){return parse(await fs.readFile(p,'utf8'));}
export const writeToml = value => stringify(value)+'\n';
export const kinds=['skills','mcp','plugins','agents-md'];
export async function loadCatalog(root) {
  const dir=path.join(root,'catalog/assets');const assets=new Map();
  for(const file of (await fs.readdir(dir)).filter(x=>x.endsWith('.toml')).sort()) {
    const a=await readToml(await confined(root,'catalog/assets/'+file));assetId(a.id);
    if(!a.version||!/^([0-9a-f]{64})$/.test(a.version.sha256)||!a.source||typeof a.source.kind!=='string')throw new Error('Invalid asset manifest '+a.id);
    if(a.import?.baseline_commit&&(a.source.commit===a.import.baseline_commit||a.version.commit===a.import.baseline_commit))throw new Error('Import baseline misrepresented as upstream commit '+a.id);
    if(a.source.license_evidence)await confined(root,a.source.license_evidence);
    if(assets.has(a.id))throw new Error('Duplicate asset '+a.id);
    if(!kinds.includes(a.kind))throw new Error('Unknown asset kind '+a.kind);
    await confined(root,a.path); assets.set(a.id,a);
  }
  return assets;
}
export async function policy(root,asset) {
  const doc=await readToml(await confined(root,'catalog/updates/'+asset.kind+'.toml'));
  const p={...doc.defaults,...doc.protection,...asset.policy};
  if(typeof p.check!=='boolean'||typeof p.download!=='boolean')throw new Error('Invalid update policy '+asset.id);
  if(p.overwrite!==false||p.auto_merge!==false||p.preserve_local_changes!==true||p.require_validation!==true||p.require_approval!==true||p.apply!==false)throw new Error('Unsafe update policy '+asset.id);
  return p;
}
export async function resolveExpert(root,name,catalog,seen=new Set()) {
  assetId(name);if(seen.has(name))throw new Error('Expert inheritance cycle '+name);
  const next=new Set([...seen,name]);
  const expert=await readToml(await confined(root,'experts/'+name+'.toml'));
  if(expert.name!==name)throw new Error('Expert filename/name mismatch '+name);
  const result={skills:[],mcp:[],plugins:[]};
  for(const key of ['extends','skills','mcp','plugins','optional_skills','optional_mcp','optional_plugins','conflicts'])if(expert[key]!==undefined&&(!Array.isArray(expert[key])||expert[key].some(x=>typeof x!=='string')))throw new Error('Expert '+name+' invalid list '+key);
  for(const parent of expert.extends||[]) {const r=await resolveExpert(root,parent,catalog,next);for(const k of ['skills','mcp','plugins'])result[k].push(...r[k]);}
  for(const k of ['skills','mcp','plugins'])for(const id of [...expert[k]||[], ...expert['optional_'+k]||[]]) {
    if(!catalog.has(id)||catalog.get(id).kind!==k)throw new Error('Expert '+name+' has invalid '+k+' reference '+id);
    if((expert[k]||[]).includes(id))result[k].push(id);
  }
  for(const k of ['skills','mcp','plugins'])result[k]=[...new Set(result[k])];
  for(const id of expert.conflicts||[]) if(Object.values(result).flat().includes(id))throw new Error('Expert conflict: '+id);
  return result;
}

export async function resolveProfile(root,client,catalog) {
  if(!['codex','opencode','dsh'].includes(client))throw new Error('Unknown profile client');
  const profile=await readToml(await confined(root,'catalog/profiles/'+client+'.toml'));
  if(profile.schema!==1||profile.client!==client||profile.overwrite_user_config!==false||profile.deploy!=='explicit'||typeof profile.enabled!=='boolean')throw new Error('Invalid or unsafe profile '+client);
  const selected={skills:[],mcp:[],plugins:[]};
  for(const key of ['experts','skills','mcp','plugins'])if(profile[key]!==undefined&&(!Array.isArray(profile[key])||profile[key].some(x=>typeof x!=='string')))throw new Error('Invalid profile list '+key);
  for(const name of profile.experts||[]){const recipe=await resolveExpert(root,name,catalog);for(const k of ['skills','mcp','plugins'])selected[k].push(...recipe[k]);}
  for(const k of ['skills','mcp','plugins'])for(const id of profile[k]||[]){if(catalog.get(id)?.kind!==k)throw new Error('Profile invalid '+k+' reference '+id);selected[k].push(id);}
  for(const k of ['skills','mcp','plugins'])selected[k]=[...new Set(selected[k])];
  return {client,profile,selected};
}
