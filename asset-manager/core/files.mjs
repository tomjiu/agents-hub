import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
export function assetId(id) {
  if(typeof id!=='string'|| !/^[a-z0-9][a-z0-9._-]{0,159}$/.test(id)||['.','..'].includes(id)) throw new Error('Invalid asset ID');
  return id;
}
export async function exists(p) { try{await fs.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;} }
export async function confined(root, rel, {mustExist=true}={}) {
  if(typeof rel!=='string'||!rel||path.isAbsolute(rel)||rel.includes('\\')||rel.includes(':')||rel.split('/').some(x=>!x||x==='.'||x==='..'||/[. ]$/.test(x)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(x))) throw new Error('Invalid relative path: '+rel);
  const base=await fs.realpath(root), result=path.resolve(base,rel);
  for(let p=result;p!==base;p=path.dirname(p)) {
    if(!(p.startsWith(base+path.sep)))throw new Error('Path escapes root');
    try {if((await fs.lstat(p)).isSymbolicLink())throw new Error('Links are not permitted: '+rel);}catch(e){if(e.code==='ENOENT'&&!mustExist)continue;throw e;}
  }
  if(mustExist)await fs.access(result);
  return result;
}
export async function tree(root) {
  const entries=[];let bytes=0;
  async function visit(dir,rel='') {
    for(const e of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)) {
      if(['.git','node_modules','.asset-state','__pycache__','.pytest_cache','.gocache'].includes(e.name))continue;
      if(e.name==='dist'&&e.isDirectory()&&!rel.endsWith('vendor/memory-net'))continue;
      const key=rel?rel+'/'+e.name:e.name;const full=path.join(dir,e.name);
      if(e.isSymbolicLink())throw new Error('Asset contains symlink: '+key);
      if(e.isDirectory())await visit(full,key);
      else if(e.isFile()){const data=await fs.readFile(full);bytes+=data.length;if(bytes>256*1024*1024)throw new Error('Asset snapshot exceeds 256 MiB');entries.push({path:key,bytes:data.length,sha256:sha256(data)});}
      else throw new Error('Asset contains unsupported file: '+key);
    }
  }
  if((await fs.lstat(root)).isSymbolicLink())throw new Error('Linked asset root');
  await visit(root);
  if(entries.length>20000)throw new Error('Asset has too many files');
  const seen=new Set();for(const e of entries){const k=e.path.toLowerCase();if(seen.has(k))throw new Error('Case collision: '+e.path);seen.add(k);}
  return {sha256:sha256(JSON.stringify(entries)),files:entries,bytes};
}
export async function snapshot(source,dest) {
  const before=await tree(source);
  if(await exists(dest))throw new Error('Snapshot target already exists');
  await fs.mkdir(dest,{recursive:false});
  try {
    for(const f of before.files){const p=await confined(dest,f.path,{mustExist:false});await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,await fs.readFile(await confined(source,f.path)),{flag:'wx'});}
    const after=await tree(dest),final=await tree(source);
    if(after.sha256!==before.sha256||final.sha256!==before.sha256)throw new Error('Source changed during snapshot');
    return after;
  } catch(e) {await fs.rm(dest,{recursive:true,force:true});throw e;}
}
export async function createJson(p,value){await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
export async function atomicWrite(p,text) {
  await fs.mkdir(path.dirname(p),{recursive:true});const tmp=p+'.tmp-'+crypto.randomUUID();
  try{await fs.writeFile(tmp,text,{flag:'wx'});await fs.rename(tmp,p);}finally{await fs.rm(tmp,{force:true});}
}
export function compareTrees(base,current,incoming) {
  const maps=[base,current,incoming].map(t=>new Map(t.files.map(f=>[f.path,f.sha256])));
  return [...new Set(maps.flatMap(m=>[...m.keys()]))].sort().flatMap(p=>{
    const [b,c,n]=maps.map(m=>m.get(p)||null);
    if(c===n&&b===c)return [];
    return [{path:p,base:b,current:c,incoming:n,local_changed:b!==c,upstream_changed:b!==n,conflict:b!==c&&b!==n&&c!==n}];
  });
}
