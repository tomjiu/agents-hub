import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import https from 'node:https';
import {loadCatalog,policy} from '../core/catalog.mjs';
import {assetId,createJson,confined} from '../core/files.mjs';
function privateIP(s){if(net.isIP(s)===4){const [a,b]=s.split('.').map(Number);return a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&[0,168].includes(b))||(a===198&&[18,19].includes(b));}return s==='::1'||s==='::'||/^f[cd]|^fe[89ab]|^ff/i.test(s)||s.toLowerCase().includes('ffff:');}
export async function publicUrl(raw) {
 const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))throw new Error('Only public HTTPS URLs without credentials on port 443 are supported');
 if(u.hostname==='localhost'||u.hostname.endsWith('.local'))throw new Error('Private host blocked');
 const host=u.hostname.replace(/^\[|\]$/g,'');const ips=net.isIP(host)?[{address:host}]:await dns.lookup(host,{all:true});
 if(!ips.length||ips.some(x=>privateIP(x.address)))throw new Error('Private address blocked');return u;
}
async function secureGet(raw,limit,timeout) {
 const u=await publicUrl(raw),host=u.hostname.replace(/^\[|\]$/g,'');
 const addresses=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await dns.lookup(host,{all:true});
 if(!addresses.length||addresses.some(x=>privateIP(x.address)))throw new Error('Private address blocked');
 const pinned=addresses[0];
 return new Promise((resolve,reject)=>{
  const req=https.get(u,{signal:AbortSignal.timeout(timeout),headers:{accept:'application/json','user-agent':'agents-hub/2.0'},lookup(_host,options,callback){callback(null,options?.all?[pinned]:pinned.address,pinned.family);}},response=>{
   if(response.statusCode!==200){response.resume();reject(new Error('Upstream HTTP '+response.statusCode+'; redirects and automatic retries disabled'));return;}
   const chunks=[];let total=0;
   response.on('data',chunk=>{total+=chunk.length;if(total>limit){response.destroy(new Error('Download too large'));return;}chunks.push(chunk);});
   response.on('error',reject);response.on('end',()=>resolve(Buffer.concat(chunks)));
  });req.on('error',reject);
 });
}
export async function requestJson(url) {return JSON.parse((await secureGet(url,2*1024*1024,20000)).toString('utf8'));}
export async function limitedBody(response,limit) {
 const len=Number(response.headers.get('content-length'));if(Number.isFinite(len)&&len>limit)throw new Error('Download too large');
 const chunks=[];let total=0;try{for await(const chunk of response.body){total+=chunk.length;if(total>limit)throw new Error('Download too large');chunks.push(chunk);}return Buffer.concat(chunks);}catch(e){await response.body?.cancel().catch(()=>{});throw e;}
}
export async function checkUpstream(root,id) {
 const asset=(await loadCatalog(root)).get(assetId(id));if(!asset)throw new Error('Unknown asset');const p=await policy(root,asset);if(!p.check)throw new Error('Checks disabled by policy');
 const source=asset.source;
 if(source.discovery==='restricted'||['trae-cdn','workbuddy-installer'].includes(source.kind))return {id,status:'RESTRICTED',reason:'Automatic marketplace/installer discovery has not been verified.',known_version:source.version||'unknown',pinned_url:source.url||''};
 if(source.kind==='npm') {
  const name=new URL(source.url).pathname.slice(1),j=await requestJson('https://registry.npmjs.org/'+encodeURIComponent(name)+'/latest');
  return {id,status:j.version===asset.version.upstream?'CURRENT':'UPDATE_AVAILABLE',version:j.version,pinned_version:asset.version.upstream,artifact:j.dist?.tarball||'',integrity:j.dist?.integrity||'',commit:j.gitHead||'',applied:false};
 }
 if(source.kind==='github') {
  const u=new URL(source.url),parts=u.pathname.replace(/\.git$/,'').split('/').filter(Boolean);if(u.hostname!=='github.com'||parts.length!==2)throw new Error('Invalid GitHub source');
  const repo=await requestJson('https://api.github.com/repos/'+parts.join('/'));
  const j=await requestJson('https://api.github.com/repos/'+parts.join('/')+'/commits/'+encodeURIComponent(repo.default_branch));
  return {id,status:j.sha===asset.version.commit?'CURRENT':'UPDATE_AVAILABLE',commit:j.sha,branch:repo.default_branch,applied:false};
 }
 return {id,status:'MANUAL',reason:'Local/self-maintained assets and HTTP services do not imply a downloadable release.',applied:false};
}
export async function downloadArtifact(root,id,{url,integrity}={}) {
 const asset=(await loadCatalog(root)).get(assetId(id));if(!asset)throw new Error('Unknown asset');const p=await policy(root,asset);if(!p.download)throw new Error('Downloads disabled');
 if(!url||!integrity)throw new Error('Explicit pinned URL and integrity are required');
 const match=/^(sha256|sha512)-([A-Za-z0-9+/=]+)$/.exec(integrity);if(!match)throw new Error('Integrity must be SRI sha256 or sha512');
 const u=await publicUrl(url);
 const allowed=new URL(asset.source.url);if(u.origin!==allowed.origin)throw new Error('Artifact origin must match registered source; register/review origin first');
 const content=await secureGet(u.href,64*1024*1024,60000);const digest=crypto.createHash(match[1]).update(content).digest('base64');if(digest!==match[2])throw new Error('Artifact integrity mismatch');
 const dir=await confined(root,'.asset-state/downloads/'+id+'/'+crypto.randomUUID(),{mustExist:false});await fs.mkdir(dir,{recursive:true});
 const artifact=path.join(dir,'artifact');await fs.writeFile(artifact,content,{flag:'wx'});
 const report={schema:1,id,status:'DOWNLOADED',url:u.href,integrity,bytes:content.length,artifact,executed:false,extracted:false,applied:false};await createJson(path.join(dir,'download.json'),report);return report;
}
