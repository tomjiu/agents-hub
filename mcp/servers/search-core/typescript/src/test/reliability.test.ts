import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Cache} from '../cache.js';
import {HealthTracker} from '../providers/base.js';
import type {Provider,SearchCtx} from '../providers/base.js';
import {Router} from '../router.js';
import {loadConfig} from '../config.js';
import {SearchCore} from '../engine.js';
import {searxng} from '../providers/searxng.js';
const ref=(url:string,title='SQLite WAL concurrency')=>({url,title,snippet:title,engines:['fixture']});
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function fixture(t:any,providers:Provider[],cfg:any={}) {
 const dir=mkdtempSync(join(tmpdir(),'sc-reliable-')),cache=new Cache(dir),health=new HealthTracker(cache);
 const router=new Router({cache,health,config:loadConfig({dataDir:dir,keySlots:'off',timeoutMs:350,softDeadlineMs:100,earlyHarvestMs:30,recoveryDeadlineMs:280,...cfg}),providers});
 t.after(()=>{cache.close();rmSync(dir,{recursive:true,force:true});});return {router,health,cache};
}
const provider=(name:string,ms:number,refs:any[]):Provider=>({name,needsKey:false,isConfigured:()=>true,search:async()=>{await pause(ms);return refs;}});
test('irrelevant fast results cannot early-harvest useful slow evidence',async t=>{
 const fasts=['a','b','c'].map(n=>provider(n,0,Array.from({length:10},(_,i)=>ref('https://noise.example/'+n+i,'Pasta recipes'))));
 const {router}=fixture(t,[...fasts,provider('useful',150,[ref('https://sqlite.org/wal.html')])]);
 const r=await (router.run as any)('retrieval query',{},['a','b','c','useful'],'SQLite WAL concurrency');
 assert.ok(r.used.includes('useful'));assert.ok(r.refs.some((x:any)=>x.url.endsWith('/wal.html')));
});
test('empty-evidence soft edge grants bounded recovery; useful evidence still cuts at soft edge',async t=>{
 const {router}=fixture(t,[provider('slow',150,[ref('https://sqlite.org/wal.html')])]);
 const r=await (router.run as any)('SQLite WAL concurrency',{},['slow'],'SQLite WAL concurrency');assert.deepEqual(r.used,['slow']);
 const {router:bounded,health}=fixture(t,[provider('fast',0,[ref('https://sqlite.org/wal.html')]),provider('late',300,[ref('https://late.example/')])]);
 const started=Date.now();const x=await (bounded.run as any)('SQLite WAL concurrency',{},['fast','late'],'SQLite WAL concurrency');assert.ok(Date.now()-started<260);assert.equal(x.failed.length,1);
 assert.equal(health.snapshot('late',true,false).fail,0,'orchestrator cancellation is not upstream failure');
 await pause(330);assert.equal(health.snapshot('late',true,false).ok,0,'late result never mutates health');
});
test('hard deadline bounds uncooperative providers even with soft deadline disabled',async t=>{
 const {router}=fixture(t,[{name:'hang',needsKey:false,isConfigured:()=>true,search:()=>new Promise(()=>{})}],{timeoutMs:60,softDeadlineMs:0});
 const started=Date.now();const r=await Promise.race([router.run('q',{},['hang']),pause(300).then(()=>null)]);assert.ok(r,'router must settle');assert.ok(Date.now()-started<250);assert.equal(r!.failed[0].status,'timeout');
});
test('SearX instance timeout leaves time for fallback and outer abort stops chain',async()=>{
 const old=searxng.config;searxng.config={baseUrl:'https://stall.example',instances:['https://good.example']};let calls:string[]=[];
 try {
  const ctx:SearchCtx={signal:AbortSignal.timeout(500),ua:'fixture',opts:{timeoutMs:400},fetchImpl:async(url,init)=>{calls.push(url);if(url.includes('stall')){init!.signal!.throwIfAborted();return new Promise((_,reject)=>{init!.signal!.addEventListener('abort',()=>reject(new Error('instance timeout')),{once:true});});}return Response.json({results:[{url:'https://sqlite.org/wal.html',title:'SQLite WAL concurrency'}]});}};
  const r=await Promise.race([searxng.search('SQLite WAL concurrency',ctx),pause(700).then(()=>null)]);assert.ok(r?.length);assert.equal(calls.length,2);
  calls=[];await assert.rejects(searxng.search('q',{...ctx,signal:AbortSignal.abort()}));assert.equal(calls.length,0);
 } finally {searxng.config=old;}
});
test('quality-empty batches trigger unattempted allowed rescue and degraded empties do not poison cache',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'sc-rescue-evidence-'));let requests:string[]=[];
 const core=new SearchCore({config:{dataDir:dir,engines:['github','duckduckgo','mojeek','searxng'],keySlots:'off',searxng:{baseUrl:'https://rescue.example',instances:[]}},fetchImpl:async input=>{const u=String(input);requests.push(u);if(u.includes('api.github'))return Response.json({items:[{html_url:'https://noise.example/',full_name:'pasta/recipes',description:'unrelated'}]});if(u.includes('rescue.example'))return Response.json({results:[{url:'https://github.com/example/cache',title:'github actions cache',content:'docker layers cache'}]});return new Response('forbidden',{status:403});}});
 t.after(()=>{core.close();rmSync(dir,{recursive:true,force:true});});
 const r=await core.search('github actions cache docker layers');assert.ok(r.meta.rescued);assert.ok(r.refs.length);requests=[];await core.search('github actions cache docker layers');assert.ok(requests.length,'degraded recovery result must be retried instead of cached');
 requests=[];const limited=await core.search('github actions cache docker layers',{engines:['github']});assert.equal(limited.refs.length,0);assert.ok(requests.every(u=>u.includes('api.github')));
});
