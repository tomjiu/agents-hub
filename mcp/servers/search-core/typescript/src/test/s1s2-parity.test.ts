// S1/S2 TS 对等 (issue #3): 全局多批收割协调 + minRelevant 证据感知 + 不足诊断
// + Retry-After 退避 + bingweb 进编程专线。红灯先行: 本文件在修复前失败, 修复后全绿。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Cache} from '../cache.js';
import {HealthTracker,httpErr} from '../providers/base.js';
import type {Provider} from '../providers/base.js';
import {Router} from '../router.js';
import {loadConfig} from '../config.js';
import {SearchCore} from '../engine.js';
import {lookupDomains} from '../domains.js';

process.env.SC_DDG_MIN_INTERVAL_MS='0';
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const ref=(url:string,title:string)=>({url,title,snippet:title,engines:['fixture']});
const provider=(name:string,ms:number,refs:any[]):Provider=>({name,needsKey:false,isConfigured:()=>true,search:async()=>{await pause(ms);return refs;}});
const stall=(name:string):Provider=>({name,needsKey:false,isConfigured:()=>true,search:()=>new Promise(()=>{})}) as Provider;

function routerFixture(t:any,providers:Provider[],cfg:any={}) {
  const dir=mkdtempSync(join(tmpdir(),'sc-s1s2-')),cache=new Cache(dir),health=new HealthTracker(cache);
  const router=new Router({cache,health,config:loadConfig({dataDir:dir,keySlots:'off',timeoutMs:4000,softDeadlineMs:1500,earlyHarvestMs:300,recoveryDeadlineMs:2500,...cfg}),providers});
  t.after(()=>{cache.close();rmSync(dir,{recursive:true,force:true});});
  return {router,health,cache};
}

function coreFixture(t:any,fetchImpl: (input:any,init?:any)=>Promise<Response>, cfg:any={}) {
  const dir=mkdtempSync(join(tmpdir(),'sc-s1s2-core-'));
  const core=new SearchCore({config:{dataDir:dir,keySlots:'off',timeoutMs:4000,softDeadlineMs:1500,earlyHarvestMs:300,recoveryDeadlineMs:2500,searxng:{baseUrl:'https://searx.example',instances:[]},...cfg},fetchImpl});
  t.after(()=>{core.close();rmSync(dir,{recursive:true,force:true});});
  return core;
}
const Q='python sqlite wal tutorial';
// 标题/摘要逐条差异化: 同文 refs 会被 embedding 去重合并(fusion >0.75), 测试要的是证据计数
// 每条 ref 的尾缀从 150 词互斥词块取词: TF-hash 余弦 << 0.75 (fusion 不合并), 查询词保留满足证据门;
const WPOOL=Array.from({length:150},(_,i)=>`topic${i}`);
const relevantRefs=(n:number,host='evidence.example')=>Array.from({length:n},(_,i)=>
  ref(`https://ev${i%6}.example/${i}`,`${Q} ${WPOOL.slice(i*6,(i+1)*6).join(' ')}`));
const noiseRefs=(n:number)=>Array.from({length:n},(_,i)=>ref(`https://noise.example/${i}`,'pasta recipes cooking blog'));

// ---------- F1: 多批全局收割协调 (S1 验收: 不能让慢腿拖延已经满足任务的响应) ----------
test('S1 global: domain multi-batch — slow site: leg must not drag after sufficient evidence', async t=>{
  const calls:string[]=[];
  const core=coreFixture(t, async input=>{
    const url=String(input); calls.push(url);
    if (url.startsWith('https://searx.example/')) return Response.json({results:relevantRefs(16)});
    if (url.includes('html.duckduckgo.com')) return new Promise<Response>(()=>{}); // 永不返回(真断腿)
    return new Response('forbidden',{status:403}); // 其余腿快败
  });
  const t0=Date.now();
  const r=await core.search(Q,{maxResults:25}); // searxng 车道按 maxResults 截断(默认10)
  const dt=Date.now()-t0;
  // 红灯(当前): site: 腿的 ddg 独立预算拖到 recovery(2500ms) — 证据 300ms 已足够
  assert.ok(dt<1400,`domain query dragged ${dt}ms despite sufficient leg-0 evidence`);
  assert.ok(r.refs.length>=5,`refs=${r.refs.length}`);
  assert.ok(r.meta.harvest?.early===true,'meta.harvest.early must be true');
  assert.equal(r.meta.harvest?.minRelevant,5);
  assert.ok(r.meta.harvest?.abortedPending!>=1,'slow site: leg aborted');
  assert.ok(r.meta.enginesFailed.some(f=>f.name==='duckduckgo'&&f.cancellation==='early_harvest'),'ddg aborted by global early harvest');
});

// ---------- F2: minRelevant 证据感知阈值 (总refs>=15 + 相关refs>=minRelevant) ----------
test('S1 minRelevant: 6 relevant + 20 noise refs early-harvest (total>=15 AND relevant>=5)', async t=>{
  const {router}=routerFixture(t,[provider('r1',0,relevantRefs(6,'rel.example')),provider('n1',0,noiseRefs(20)),stall('slow')]);
  const r=await router.run(Q,{},['r1','n1','slow'],Q);
  // 红灯(当前): 纯证据计数 6<15 → 不收割, slow 拖到软截止
  assert.ok(r.failed.some(f=>f.name==='slow'&&f.cancellation==='early_harvest'),
    `6 relevant + 20 noise should early-harvest (got cancellations: ${r.failed.map(f=>f.name+':'+f.cancellation).join(',')})`);
});
test('S1 minRelevant floor: 4 relevant refs cannot early-harvest even with 24 total', async t=>{
  const {router}=routerFixture(t,[provider('r1',0,relevantRefs(4,'rel.example')),provider('n1',0,noiseRefs(20)),stall('slow')]);
  const r=await router.run(Q,{},['r1','n1','slow'],Q);
  assert.ok(!r.failed.some(f=>f.cancellation==='early_harvest'),'4 relevant < minRelevant 5 must not early-harvest');
  assert.ok(r.failed.some(f=>f.name==='slow'&&f.cancellation==='soft_deadline'),'slow leg cut at soft deadline instead');
});
test('S1 minRelevant=0 reverts to legacy TS evidence-counting semantics', async t=>{
  const {router}=routerFixture(t,[provider('r1',0,relevantRefs(6,'rel.example')),provider('n1',0,noiseRefs(20)),stall('slow')],{earlyHarvestMinRelevant:0});
  const r=await router.run(Q,{},['r1','n1','slow'],Q);
  assert.ok(!r.failed.some(f=>f.cancellation==='early_harvest'),'minRelevant=0 keeps legacy evidence>=15 gate (6<15 → no harvest)');
});

// ---------- F3: 收割诊断 meta.harvest (到期不足 → 已得候选 + 诊断, 不无限抢救) ----------
test('S1 diagnosis: deadline reached with insufficient relevant evidence → meta.harvest.insufficient', async t=>{
  const core=coreFixture(t, async input=>{
    const url=String(input);
    if (url.startsWith('https://searx.example/')) return Response.json({results:noiseRefs(20)}); // 全噪声: 证据门全拒
    if (url.includes('html.duckduckgo.com')) return new Promise<Response>(()=>{});
    return new Response('forbidden',{status:403});
  });
  const r=await core.search(Q);
  assert.equal(r.refs.length,0,'noise-only must yield zero refs');
  // 红灯(当前): meta.harvest 不存在
  assert.equal(r.meta.harvest?.insufficient,true,'insufficient flag');
  assert.match(r.meta.harvest?.diagnosis??'',/insufficient relevant evidence/,'diagnosis text');
  assert.equal(r.meta.harvest?.settledLegs!>=1,true);
  assert.equal(r.meta.harvest?.softDeadlineMs,1500);
});

// ---------- F4: Retry-After 退避 (S2: 服务端明示下限, 取大者, 1h 有界; HTTP-date 如实忽略) ----------
test('S2 retry-after: breaker cooldown extends to Retry-After seconds (bounded 1h)', async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sc-s2ra-')),cache=new Cache(dir),health=new HealthTracker(cache);
  t.after(()=>{cache.close();rmSync(dir,{recursive:true,force:true});});
  const msg300='keenable http 429 (rate limited) (retry-after: 300s)';
  for (let i=0;i<4;i++) health.record('ra300',false,10,msg300,'rate_limited');
  assert.ok(health.isOpen('ra300'),'breaker open');
  const raw300=JSON.parse(cache.kvGet('health:ra300')!);
  assert.ok(raw300.openUntil>=Date.now()+299*1000,`cooldown must cover 300s (openUntil delta ${(raw300.openUntil-Date.now())/1000}s)`);
  const msgHuge='keenable http 429 (rate limited) (retry-after: 99999s)';
  for (let i=0;i<4;i++) health.record('raHuge',false,10,msgHuge,'rate_limited');
  const rawHuge=JSON.parse(cache.kvGet('health:raHuge')!);
  assert.ok(rawHuge.openUntil<=Date.now()+60*60*1000+2000,`99999s must cap at 1h (delta ${(rawHuge.openUntil-Date.now())/1000}s)`);
  const msgPlain='keenable http 429 (rate limited)';
  for (let i=0;i<4;i++) health.record('raPlain',false,10,msgPlain,'rate_limited');
  const rawPlain=JSON.parse(cache.kvGet('health:raPlain')!);
  assert.ok(rawPlain.openUntil<=Date.now()+2*60*1000+2000,`no retry-after → policy 2min (delta ${(rawPlain.openUntil-Date.now())/1000}s)`);
});
test('S2 retry-after: HTTP-date form is ignored honestly (no fabricated seconds)', async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sc-s2rad-')),cache=new Cache(dir),health=new HealthTracker(cache);
  t.after(()=>{cache.close();rmSync(dir,{recursive:true,force:true});});
  const msg='keenable http 429 (retry-after: Wed, 21 Oct 2015 07:28:00 GMT)';
  for (let i=0;i<4;i++) health.record('raDate',false,10,msg,'rate_limited');
  const raw=JSON.parse(cache.kvGet('health:raDate')!);
  assert.ok(raw.openUntil<=Date.now()+2*60*1000+2000,'HTTP-date must not extend cooldown beyond policy');
});
test('S2 httpErr: 429 response carries Retry-After header into error message', ()=>{
  const res:any={status:429,headers:{get:(n:string)=>n.toLowerCase()==='retry-after'?'29':null}};
  assert.equal(httpErr('keenable',res,'(rate limited: public lane)'),'keenable http 429 (rate limited: public lane) (retry-after: 29s)');
  const noRa:any={status:429,headers:{get:()=>null}};
  assert.equal(httpErr('searxng https://s.example',noRa),'searxng https://s.example http 429');
  const dateRa:any={status:429,headers:{get:(n:string)=>n.toLowerCase()==='retry-after'?'Wed, 21 Oct 2015 07:28:00 GMT':null}};
  assert.ok(!/\(retry-after:/.test(httpErr('ddg',dateRa)),'HTTP-date form not converted');
});

// ---------- F5: 负结果不缓存 (S2; 现状核验 — 若已实现则矩阵 #31 修正) ----------
test('S2 negative-cache: empty and degraded results are not cached', async t=>{
  let calls=0;
  const core=coreFixture(t, async input=>{
    calls++;
    return new Response('forbidden',{status:403});
  },{searxng:{baseUrl:'https://none.example',instances:[]}});
  const r1=await core.search('python sqlite wal tutorial');
  assert.equal(r1.refs.length,0);
  const first=calls;
  await core.search('python sqlite wal tutorial');
  assert.ok(calls>first,'empty result must not be served from cache');
});

// ---------- F6: bingweb 进编程专线 site 腿 ----------
test('F6: programming siteEngines include bingweb (major-engine lane joins domain route)', ()=>{
  const r=lookupDomains('python sqlite wal tutorial');
  assert.ok(r);
  // 红灯(当前): ["duckduckgo","bingrss"]
  assert.deepEqual(r!.siteEngines,['duckduckgo','bingrss','bingweb']);
});
test('F6 integration: domain query site: leg actually runs bingweb', async t=>{
  const calls:string[]=[];
  const core=coreFixture(t, async input=>{
    const url=String(input); calls.push(url);
    if (url.startsWith('https://searx.example/')) return Response.json({results:relevantRefs(16)});
    if (url.includes('www.bing.com/search')) return Response.json({}); // bingweb HTML 壳: 解析空也行, 断言出勤即可
    if (url.includes('html.duckduckgo.com')) return new Promise<Response>(()=>{});
    return new Response('forbidden',{status:403});
  });
  const r=await core.search(Q);
  assert.ok(r.meta.enginesUsed.includes('bingweb')||r.meta.enginesFailed.some(f=>f.name==='bingweb'),
    `bingweb must participate in programming site: leg (used=${r.meta.enginesUsed.join(',')} failed=${r.meta.enginesFailed.map(f=>f.name).join(',')})`);
  assert.ok(calls.some(u=>u.includes('www.bing.com/search')),'bingweb actually requested');
});
