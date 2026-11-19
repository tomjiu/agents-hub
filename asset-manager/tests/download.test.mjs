import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {stringify} from 'smol-toml';
import {createSecureGetter,downloadArtifact,limitedBody} from '../providers/upstream.mjs';
import {tree} from '../core/files.mjs';
const sri=bytes=>'sha256-'+crypto.createHash('sha256').update(bytes).digest('base64');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-download-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const p of ['catalog/assets','catalog/updates','skills/demo'])await fs.mkdir(path.join(root,p),{recursive:true});
 await fs.writeFile(path.join(root,'skills/demo/SKILL.md'),'Original user content');
 await fs.writeFile(path.join(root,'catalog/assets/demo.toml'),stringify({id:'demo',kind:'skills',path:'skills/demo',source:{kind:'npm',url:'https://registry.example/package'},version:{sha256:(await tree(path.join(root,'skills/demo'))).sha256}}));
 await fs.writeFile(path.join(root,'catalog/updates/skills.toml'),stringify({defaults:{check:true,download:true,apply:false},protection:{overwrite:false,auto_merge:false,preserve_local_changes:true,require_validation:true,require_approval:true}}));
 return root;
}
function transport({status=200,headers={},action}={}){
 const observations={calls:0,request_destroyed:false,response_destroyed:false};
 const get=createSecureGetter({resolveUrl:async raw=>new URL(raw),lookup:async()=>[{address:'8.8.8.8',family:4}],get:(url,options,ready)=>{
  observations.calls++;options.lookup(url.hostname,{all:false},(error,ip,family)=>{assert.equal(ip,'8.8.8.8');assert.equal(family,4);});
  const req=new EventEmitter();req.destroy=()=>{observations.request_destroyed=true;};
  queueMicrotask(()=>{const response=new PassThrough();response.statusCode=status;response.headers=headers;response.complete=true;response.on('close',()=>observations.response_destroyed=true);ready(response);if(!response.destroyed)action?.(response,options);});return req;
 }});
 return {get,observations};
}
test('HTTPS getter pins DNS address and accepts only complete bounded body',async()=>{
 const {get,observations}=transport({headers:{'content-length':'3'},action:r=>r.end('abc')});assert.equal((await get('https://fixture.example/body',5,1000)).toString(),'abc');assert.equal(observations.calls,1);
});
test('HTTP redirects advertised excess and streamed excess fail without retries',async()=>{
 for(const fixture of [{status:302},{headers:{'content-length':'100'}},{action:r=>r.end('abcdef')}]){
  const {get,observations}=transport(fixture);await assert.rejects(get('https://fixture.example/body',3,1000),/HTTP 302|too large/);assert.equal(observations.calls,1);assert.equal(observations.request_destroyed,true);
 }
});
test('truncated close aborted stream and false complete never return success',async()=>{
 for(const fixture of [{headers:{'content-length':'5'},action:r=>r.end('abc')},{action:r=>{r.write('abc');r.destroy();}},{action:r=>{r.complete=false;r.end('abc');}},{action:r=>r.emit('aborted')}]){
  const {get}=transport(fixture);await assert.rejects(get('https://fixture.example/body',20,1000),/incomplete|before complete|interrupted/);
 }
});
test('abort cancels transport and private DNS address is rejected',async()=>{
 const ac=new AbortController(),{get,observations}=transport({action:r=>{r.write('abc');ac.abort(new Error('user interrupted'));}});
 await assert.rejects(get('https://fixture.example/body',20,1000,{signal:ac.signal}),/user interrupted/);assert.equal(observations.request_destroyed,true);
 let calls=0;const denied=createSecureGetter({resolveUrl:async raw=>new URL(raw),lookup:async()=>[{address:'127.0.0.1',family:4}],get:()=>{calls++;}});await assert.rejects(denied('https://fixture.example/body',20,1000),/Private address/);assert.equal(calls,0);
});
test('successful download is independent raw bytes and never replaces checkout',async t=>{
 const root=await fixture(t),body=Buffer.from('new reviewed raw artifact');let calls=0;
 const result=await downloadArtifact(root,'demo',{url:'https://registry.example/package.tgz',integrity:sri(body)},{resolveUrl:async raw=>new URL(raw),get:async()=>{calls++;return body;}});
 assert.equal(result.status,'DOWNLOADED');assert.equal(result.executed,false);assert.equal(result.extracted,false);assert.equal(result.applied,false);assert.equal(calls,1);assert.deepEqual(await fs.readFile(result.artifact),body);assert.equal(await fs.readFile(path.join(root,'skills/demo/SKILL.md'),'utf8'),'Original user content');assert.equal(JSON.parse(await fs.readFile(path.join(path.dirname(result.artifact),'download.json'),'utf8')).status,'DOWNLOADED');
});
test('origin mismatch invalid SRI mismatch and network interruption do not create success artifacts',async t=>{
 const root=await fixture(t),body=Buffer.from('artifact');let calls=0;const deps={resolveUrl:async raw=>new URL(raw),get:async()=>{calls++;return body;}};
 await assert.rejects(downloadArtifact(root,'demo',{url:'https://unregistered.example/body',integrity:sri(body)},deps),/origin/);assert.equal(calls,0);
 await assert.rejects(downloadArtifact(root,'demo',{url:'https://registry.example/body',integrity:'sha256-YQ=='},deps),/length or encoding/);assert.equal(calls,0);
 await assert.rejects(downloadArtifact(root,'demo',{url:'https://registry.example/body',integrity:sri(Buffer.from('different'))},deps),/integrity mismatch/);
 await assert.rejects(downloadArtifact(root,'demo',{url:'https://registry.example/body',integrity:sri(body)},{...deps,get:async()=>{throw new Error('interrupted stream');}}),/interrupted stream/);
 await assert.rejects(fs.access(path.join(root,'.asset-state/downloads')));
});
test('report write failure removes only owned incomplete directory preserving old downloads',async t=>{
 const root=await fixture(t),body=Buffer.from('artifact');const downloads=path.join(root,'.asset-state/downloads/demo');await fs.mkdir(path.join(downloads,'prior'),{recursive:true});await fs.writeFile(path.join(downloads,'prior/artifact'),'previous success');const original=fs.writeFile;
 fs.writeFile=async (dest,...args)=>{if(String(dest).endsWith('download.json'))throw new Error('injected metadata failure');return original(dest,...args);};
 try{await assert.rejects(downloadArtifact(root,'demo',{url:'https://registry.example/body',integrity:sri(body)},{resolveUrl:async raw=>new URL(raw),get:async()=>body}),/metadata failure/);}finally{fs.writeFile=original;}
 assert.deepEqual(await fs.readdir(downloads),['prior']);assert.equal(await fs.readFile(path.join(downloads,'prior/artifact'),'utf8'),'previous success');
});
test('abort after download before publish has no side effects',async t=>{
 const root=await fixture(t),body=Buffer.from('artifact'),ac=new AbortController();
 await assert.rejects(downloadArtifact(root,'demo',{url:'https://registry.example/body',integrity:sri(body),signal:ac.signal},{resolveUrl:async raw=>new URL(raw),get:async()=>{ac.abort(new Error('stop before publish'));return body;}}),/stop before publish/);await assert.rejects(fs.access(path.join(root,'.asset-state/downloads')));
});
test('limitedBody cancels oversized advertised stream immediately',async()=>{
 let cancelled=false;const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-length':'100'}});await assert.rejects(limitedBody(response,5),/too large/);assert.equal(cancelled,true);await assert.rejects(limitedBody(new Response(null),5),/Missing/);
});

test('invalid declared length and invalid network budgets fail closed',async()=>{
 for(const value of ['abc','-1','1.5']){const {get}=transport({headers:{'content-length':value}});await assert.rejects(get('https://fixture.example/body',20,1000),/Invalid upstream content length/);}
 const {get,observations}=transport();await assert.rejects(get('https://fixture.example/body',0,1000),/Invalid network budget/);assert.equal(observations.calls,0);
});
test('sha512 raw download and post-write cancellation preserve original content',async t=>{
 const root=await fixture(t),body=Buffer.from('sha512 fixture');const integrity='sha512-'+crypto.createHash('sha512').update(body).digest('base64');
 const result=await downloadArtifact(root,'demo',{url:'https://registry.example/body',integrity},{resolveUrl:async raw=>new URL(raw),get:async()=>body});assert.deepEqual(await fs.readFile(result.artifact),body);
 const ac=new AbortController(),original=fs.writeFile;fs.writeFile=async(dest,...args)=>{const saved=await original(dest,...args);if(String(dest).endsWith(path.sep+'artifact'))ac.abort(new Error('cancel after file write'));return saved;};
 try{await assert.rejects(downloadArtifact(root,'demo',{url:'https://registry.example/body',integrity,signal:ac.signal},{resolveUrl:async raw=>new URL(raw),get:async()=>body}),/cancel after file write/);}finally{fs.writeFile=original;}
 assert.deepEqual(await fs.readdir(path.dirname(path.dirname(result.artifact))),[path.basename(path.dirname(result.artifact))]);assert.equal(await fs.readFile(path.join(root,'skills/demo/SKILL.md'),'utf8'),'Original user content');
});
