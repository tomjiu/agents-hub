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
// Dependency injection is for offline protocol tests, never exposed as a CLI or catalog bypass.
export function createSecureGetter({resolveUrl=publicUrl,lookup=(host,options)=>dns.lookup(host,options),get=(...args)=>https.get(...args)}={}) {
 return async function secureGet(raw,limit,timeout,{signal}={}) {
  if(!Number.isSafeInteger(limit)||limit<=0||!Number.isSafeInteger(timeout)||timeout<=0)throw new Error('Invalid network budget');
  const u=await resolveUrl(raw),host=u.hostname.replaceAll('[','').replaceAll(']','');
  const addresses=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await lookup(host,{all:true});
  if(!addresses.length||addresses.some(x=>privateIP(x.address)))throw new Error('Private address blocked');
  const pinned=addresses[0],abort=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
  abort.throwIfAborted();
  return new Promise((resolve,reject)=>{
   let response,settled=false;
   const cleanup=()=>abort.removeEventListener('abort',onAbort);
   const fail=error=>{if(settled)return;settled=true;cleanup();reject(error);response?.destroy();req?.destroy();};
   const onAbort=()=>fail(abort.reason||new Error('Download aborted'));
   let req;
   try{req=get(u,{signal:abort,headers:{accept:'application/json','user-agent':'agents-hub/2.0'},lookup(_host,options,callback){callback(null,options?.all?[pinned]:pinned.address,pinned.family);}},res=>{
    response=res;if(settled){res.destroy();return;}res.on('error',fail);res.on('aborted',()=>fail(new Error('Upstream body interrupted')));
    if(res.statusCode!==200){fail(new Error('Upstream HTTP '+res.statusCode+'; redirects and automatic retries disabled'));return;}
    const rawLength=res.headers['content-length'],length=rawLength===undefined?null:Number(rawLength);
    if(rawLength!==undefined&&(!Number.isSafeInteger(length)||length<0)){fail(new Error('Invalid upstream content length'));return;}
    if(length!==null&&length>limit){fail(new Error('Download too large'));return;}
    const chunks=[];let total=0;
    res.on('data',chunk=>{if(settled)return;const bytes=Buffer.from(chunk);total+=bytes.length;if(total>limit){fail(new Error('Download too large'));return;}chunks.push(bytes);});
    res.on('end',()=>{if(settled)return;if((length!==null&&length!==total)||res.complete===false){fail(new Error('Upstream body incomplete'));return;}settled=true;cleanup();resolve(Buffer.concat(chunks));});
    res.on('close',()=>{if(!settled)fail(new Error('Upstream closed before complete body'));});
   });req.on('error',fail);if(settled){req.destroy();return;}abort.addEventListener('abort',onAbort,{once:true});if(abort.aborted)onAbort();}
   catch(error){fail(error);}
  });
 };
}
const secureGet=createSecureGetter();
export async function requestJson(url) {return JSON.parse((await secureGet(url,2*1024*1024,20000)).toString('utf8'));}
export async function limitedBody(response,limit) {
 if(!response.body)throw new Error('Missing upstream body');
 const len=Number(response.headers.get('content-length'));if(Number.isFinite(len)&&len>limit){await response.body.cancel().catch(()=>{});throw new Error('Download too large');}
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
export async function downloadArtifact(root,id,{url,integrity,signal}={}, {resolveUrl=publicUrl,get=secureGet}={}) {
 const asset=(await loadCatalog(root)).get(assetId(id));if(!asset)throw new Error('Unknown asset');const p=await policy(root,asset);if(!p.download)throw new Error('Downloads disabled');
 if(!url||!integrity)throw new Error('Explicit pinned URL and integrity are required');
 const match=/^(sha256|sha512)-([A-Za-z0-9+/=]+)$/.exec(integrity);if(!match)throw new Error('Integrity must be SRI sha256 or sha512');
 const expected=Buffer.from(match[2],'base64');if(expected.length!==(match[1]==='sha256'?32:64)||expected.toString('base64')!==match[2])throw new Error('Invalid integrity digest length or encoding');
 const requested=new URL(url),allowed=new URL(asset.source.url);if(requested.origin!==allowed.origin)throw new Error('Artifact origin must match registered source; register/review origin first');
 signal?.throwIfAborted();const u=await resolveUrl(url),content=await get(u.href,64*1024*1024,60000,{signal});signal?.throwIfAborted();
 if(!Buffer.isBuffer(content)||content.length>64*1024*1024)throw new Error('Invalid or oversized artifact body');
 const digest=crypto.createHash(match[1]).update(content).digest();if(!crypto.timingSafeEqual(digest,expected))throw new Error('Artifact integrity mismatch');
 const dir=await confined(root,'.asset-state/downloads/'+id+'/'+crypto.randomUUID(),{mustExist:false});await fs.mkdir(dir,{recursive:true});
 try{
  const artifact=path.join(dir,'artifact');await fs.writeFile(artifact,content,{flag:'wx'});signal?.throwIfAborted();
  const report={schema:1,id,status:'DOWNLOADED',url:u.href,integrity,bytes:content.length,artifact,executed:false,extracted:false,applied:false};await createJson(path.join(dir,'download.json'),report);return report;
 }catch(error){await fs.rm(dir,{recursive:true,force:true});throw error;}
}
