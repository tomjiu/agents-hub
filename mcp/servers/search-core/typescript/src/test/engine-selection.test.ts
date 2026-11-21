import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SearchCore} from '../engine.js';
import {Router} from '../router.js';
import {Cache} from '../cache.js';
import {HealthTracker} from '../providers/base.js';
import {loadConfig} from '../config.js';
import {plan} from '../planner.js';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {serveHttp} from '../http.js';
import {once} from 'node:events';
process.env.SC_DDG_MIN_INTERVAL_MS='0';
function fixture(t:any){const dir=mkdtempSync(join(tmpdir(),'sc-selection-')),calls:string[]=[];
 const core=new SearchCore({config:{dataDir:dir,engines:['searxng','keenable'],keySlots:'auto',timeoutMs:500,softDeadlineMs:500,earlyHarvestMs:0,searxng:{baseUrl:'https://selected.example',instances:[]}},fetchImpl:async input=>{const url=String(input);calls.push(url);if(url.startsWith('https://selected.example/'))return Response.json({results:[{url:'https://evidence.example/selected',title:'Selected result',content:'Node SQLite python github fixture'}]});return new Response('forbidden',{status:403});}});
 t.after(()=>{core.close();rmSync(dir,{recursive:true,force:true});});return {core,calls};}
for(const query of ['Node SQLite python tutorial','github actions cache','site:x.com agent memory'])test('explicit engines constrain route '+query,async t=>{const {core,calls}=fixture(t);const r=await core.search(query,{engines:['searxng'],noCache:true});assert.ok(r.refs.length);assert.deepEqual(r.meta.enginesUsed,['searxng']);assert.ok(calls.length);assert.ok(calls.every(url=>url.startsWith('https://selected.example/')),calls.join(','));});
test('explicit empty engines performs no requests even for domain github and X',async t=>{const {core,calls}=fixture(t);for(const query of ['Node SQLite python tutorial','github actions cache','site:x.com task']){const r=await core.search(query,{engines:[]});assert.deepEqual(r.refs,[]);assert.deepEqual(r.meta.enginesUsed,[]);}assert.deepEqual(calls,[]);});
test('explicit failed engine does not rescue outside selection',async t=>{const {core,calls}=fixture(t);const r=await core.search('normal query',{engines:['keenable'],noCache:true});assert.deepEqual(r.refs,[]);assert.equal(r.meta.rescued,false);assert.ok(calls.length);assert.ok(calls.every(url=>url.includes('keenable')));});
test('invalid or unknown selection fails before network and cache lookup',async t=>{const {core,calls}=fixture(t);for(const engines of [null,'searxng',[''],[' searxng'],['unknown'],[1]])await assert.rejects(core.search('query',{engines:engines as any}),/engine/i);assert.deepEqual(calls,[]);});
test('router options override generated plan and empty selection does not add key slots',async t=>{const dir=mkdtempSync(join(tmpdir(),'sc-router-selection-')),cache=new Cache(dir),called:string[]=[];t.after(()=>{cache.close();rmSync(dir,{recursive:true,force:true});});const provider=(name:string,keySlot=false)=>({name,needsKey:false,keySlot,isConfigured:()=>true,search:async()=>{called.push(name);return [{url:'https://evidence.example/'+name,title:name,snippet:'fixture',engines:[name]}];}});const router=new Router({config:loadConfig({dataDir:dir,engines:['alpha'],keySlots:'auto'}),health:new HealthTracker(cache),providers:[provider('alpha'),provider('beta',true)]});await router.run('q',{engines:['alpha']},['beta']);assert.deepEqual(called,['alpha']);called.length=0;await router.run('q',{engines:[]});assert.deepEqual(called,[]);await router.run('q',{},[]);assert.deepEqual(called,[]);await router.run('q',{});assert.deepEqual(called,['alpha','beta']);});
test('cached selected results cannot be contaminated by another provider',async t=>{const {core,calls}=fixture(t);const first=await core.search('ordinary fixture query',{engines:['searxng']});assert.ok(first.refs.length);const after=calls.length;const second=await core.search('ordinary fixture query',{engines:['searxng']});assert.equal(second.meta.fromCache,true);assert.equal(calls.length,after);const empty=await core.search('ordinary fixture query',{engines:[]});assert.deepEqual(empty.refs,[]);assert.equal(calls.length,after);});

test('normalized selections share cache but old unrestricted and contaminated caches cannot be reused',async t=>{
 const {core,calls}=fixture(t),query='ordinary cached query',decision=plan(query);
 const oldKey=Cache.hash(JSON.stringify({q:decision.queries,r:decision.route,o:{e:['searxng']}}));
 const bad={query,refs:[{url:'https://outside.example/',title:'not selected',snippet:'bad',engines:['github']}],meta:{enginesUsed:['github'],enginesFailed:[],elapsedMs:1,fromCache:false}};
 core.cache.putSearch(oldKey,bad);
 const first=await core.search(query,{engines:['searxng','searxng']});assert.equal(first.meta.fromCache,false);assert.deepEqual(first.meta.engineSelection,{mode:'explicit',requested:['searxng']});
 const count=calls.length;const second=await core.search(query,{engines:['searxng']});assert.equal(second.meta.fromCache,true);assert.equal(calls.length,count);
 const key=Cache.hash(JSON.stringify({policy:'provider-allowlist-v1',q:decision.queries,r:decision.route,o:{e:['searxng']}}));core.cache.putSearch(key,bad);
 const next=await core.search(query,{engines:['searxng']});assert.equal(next.meta.fromCache,false);assert.ok(calls.length>count);assert.ok(next.refs.every(ref=>ref.engines.every(name=>name==='searxng')));
});
test('explicit X API uses selected provider only and preserves failure metadata',async t=>{
 const {core,calls}=fixture(t);const result=await core.xSearch('task memory','tweets',{engines:['keenable']});assert.equal(result.meta.degraded,true);assert.ok(result.meta.enginesFailed.every(f=>f.name==='keenable'));assert.deepEqual(result.meta.engineSelection,{mode:'explicit',requested:['keenable']});assert.ok(calls.every(url=>url.includes('keenable')));
 calls.length=0;const empty=await core.xSearch('task','users',{engines:[]});assert.deepEqual(empty.refs,[]);assert.deepEqual(calls,[]);
});
test('multi-query and circuit-open selections never trigger a replacement provider',async t=>{
 const {core,calls}=fixture(t);await core.search('python vs rust',{engines:['searxng'],noCache:true});assert.ok(calls.length>1);assert.ok(calls.every(url=>url.startsWith('https://selected.example/')));
 calls.length=0;for(let i=0;i<6;i++)core.health.record('searxng',false,5,'network failure');const result=await core.search('ordinary query',{engines:['searxng'],noCache:true});assert.deepEqual(calls,[]);assert.equal(result.meta.rescued,false);assert.ok(result.meta.enginesSkipped?.some(s=>s.name==='searxng'));
});
test('CLI empty selection and unsupported flags are fail-closed without external requests',t=>{
 const {dir}=(()=>{const dir=mkdtempSync(join(tmpdir(),'sc-cli-selection-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return {dir};})();const cli=fileURLToPath(new URL('../cli.js',import.meta.url));
 const env={...process.env,SC_DATA_DIR:dir,HOME:dir,USERPROFILE:dir};
 const r=spawnSync(process.execPath,[cli,'search','Node SQLite','--engines','','--json'],{env,encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);assert.deepEqual(result.refs,[]);assert.deepEqual(result.meta.engineSelection,{mode:'explicit',requested:[]});
 for(const args of [['search','query','--engines'],['search','query','--engines','unknown'],['research','topic','--engines','searxng'],['serve','--engines','searxng']]){const result=spawnSync(process.execPath,[cli,...args],{env,encoding:'utf8',timeout:10000});assert.equal(result.status,1);assert.match(result.stderr,/engine/i);}
});

test('HTTP search and X honor selection and research rejects unsupported lists before SSE',async t=>{
 const {core,calls}=fixture(t),server=serveHttp(core,0,undefined,{host:'127.0.0.1',installSignalHandlers:false});await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
 const address=server.address();if(!address||typeof address==='string')throw new Error('No HTTP port');const base='http://127.0.0.1:'+address.port;
 const post=async(route:string,body:unknown)=>{const response=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json() as any};};
 for(const route of ['/search','/x_search']){const r=await post(route,{query:'Node SQLite python',engines:['searxng']});assert.equal(r.status,200);assert.deepEqual(r.body.meta.engineSelection,{mode:'explicit',requested:['searxng']});assert.deepEqual(r.body.meta.enginesUsed,['searxng']);}
 const count=calls.length;for(const route of ['/search','/x_search']){const r=await post(route,{query:'github query',engines:[]});assert.equal(r.status,200);assert.deepEqual(r.body.refs,[]);}
 for(const route of ['/search','/x_search','/research','/research/resume']){const r=await post(route,{query:'query',engines:['unknown']});assert.equal(r.status,400);assert.match(r.body.error,/engine|allowlist/i);}
 assert.equal(calls.length,count);assert.ok(calls.every(url=>url.startsWith('https://selected.example/')));
});
test('research API rejects engines rather than treating it as an ignored authorization constraint',async t=>{const {core,calls}=fixture(t);await assert.rejects(core.deepResearch('query',{engines:[]} as any),/allowlist/);await assert.rejects(core.resumeResearch('unknown',{engines:[]} as any),/allowlist/);assert.deepEqual(calls,[]);});
test('legacy RSS provenance labels do not invalidate a legitimate selected-provider cache',async t=>{
 const {core,calls}=fixture(t),query='ordinary cache label query',decision=plan(query);
 const key=Cache.hash(JSON.stringify({policy:'provider-allowlist-v1',q:decision.queries,r:decision.route,o:{e:['bingrss']}}));
 core.cache.putSearch(key,{query,refs:[{url:'https://evidence.example/rss',title:'RSS',snippet:'fixture',engines:['bing-rss']}],meta:{enginesUsed:['bingrss'],enginesFailed:[],engineSelection:{mode:'explicit',requested:['bingrss']},elapsedMs:1,fromCache:false}});
 const result=await core.search(query,{engines:['bingrss']});assert.equal(result.meta.fromCache,true);assert.deepEqual(calls,[]);
});
