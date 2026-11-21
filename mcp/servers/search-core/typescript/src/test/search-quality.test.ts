import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SearchCore} from '../engine.js';
import {bingrss} from '../providers/keyless-apis.js';
import {fuseSemantic} from '../fusion.js';
import {Cache} from '../cache.js';
import {plan} from '../planner.js';
const ref=(title:string,snippet:string,url='https://evidence.example/article')=>({title,snippet,url,engines:['bing-rss']});
const query='Node.js node:sqlite DatabaseSync stability synchronous Node 22 26 official documentation';
test('core rejects captured unrelated and broad-only RSS results instead of reporting healthy refs',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'sc-quality-'));const core=new SearchCore({config:{dataDir:dir,engines:['bingrss'],keySlots:'off',timeoutMs:500,softDeadlineMs:1000,earlyHarvestMs:0},fetchImpl:async input=>{const q=new URL(String(input)).searchParams.get('q')!;return new Response('<rss><channel><link>https://www.bing.com/search?q='+encodeURIComponent(q)+'</link><item><title>搜狗输入法官网</title><link>https://shurufa.sogou.com/</link><description>下载输入法</description></item><item><title>Node.js Home</title><link>https://nodejs.org/</link><description>Run JavaScript everywhere</description></item></channel></rss>');}});t.after(()=>{core.close();rmSync(dir,{recursive:true,force:true});});const result=await core.search(query,{engines:['bingrss'],noCache:true});assert.deepEqual(result.refs,[]);assert.equal(result.meta.degraded,true);assert.equal((result.meta as any).quality.status,'no_relevant_results');assert.ok((result.meta as any).quality.rejected>=2);
});
test('Bing RSS rejects positive response with a changed query in channel link',async()=>{const ctx={fetchImpl:async()=>new Response('<rss><channel><link>https://www.bing.com/search?q=sogou</link><item><title>搜狗</title><link>https://sogou.com/</link></item></channel></rss>'),signal:AbortSignal.timeout(1000),ua:'test',opts:{}};await assert.rejects(bingrss.search('SQLite WAL concurrency',ctx as any),/query.*mismatch/i);});
test('quality gate retains specific SQLite docs while discarding broad pages even on embedding failure',async()=>{
 const results=[ref('SQLite | Node.js Documentation','DatabaseSync executes synchronously','https://nodejs.org/api/sqlite.html'),ref('SQLite Home Page','SQLite is a C library','https://sqlite.org/index.html'),ref('搜狗输入法','download sogou','https://sogou.com/')];
 const result=await fuseSemantic(results,{query:'SQLite WAL concurrency',evidenceGate:true,embedder:{name:'broken',embed:async()=>{throw new Error('offline');}},domainCap:0} as any);assert.deepEqual(result.refs,[]);
 const valid=await fuseSemantic(results,{query,evidenceGate:true,domainCap:0} as any);assert.equal(valid.refs.length,1);assert.ok(valid.refs[0].url.includes('/api/sqlite'));
});

test('evidence floor handles CJK terms, denies domain/provider-label-only evidence and short substring hits',async()=>{
 const {relevanceEvidence}=await import('../relevance.js');
 assert.equal(relevanceEvidence('记忆插件 sqlite',{...ref('SQLite持久化记忆插件','工作区任务状态')}).accepted,true);
 assert.equal(relevanceEvidence('react',{...ref('Reactive systems','reactivity guide')}).accepted,false);
 assert.equal(relevanceEvidence('SQLite WAL concurrency',ref('Home','Library','https://sqlite-wal-concurrency.example/')).accepted,false);
 assert.equal(relevanceEvidence('bing',ref('Pasta','[bing-rss] Carbonara recipe')).accepted,false);
 assert.equal(relevanceEvidence('SQLite WAL concurrency',ref('SQLite Write-Ahead Logging','WAL permits concurrency','https://sqlite.org/wal.html')).accepted,true);
});
test('RSS q normalization tolerates case/spacing but query loss in redirect is refused',async()=>{
 const body='<rss><channel><link>https://www.bing.com/search?q=SQLITE++WAL</link><item><title>SQLite WAL</title><link>https://sqlite.org/wal.html</link><description>Write ahead log</description></item></channel></rss>';
 const ctx={fetchImpl:async()=>new Response(body),signal:AbortSignal.timeout(1000),ua:'test',opts:{}};
 assert.equal((await bingrss.search('sqlite wal',ctx as any)).length,1);
 const response=new Response(body);Object.defineProperty(response,'url',{value:'https://cn.bing.com/search?q=sqlite'});
 await assert.rejects(bingrss.search('sqlite wal',{...ctx,fetchImpl:async()=>response} as any),/query mismatch/);
});
test('healthy relevant and irrelevant mix stays candidate-only and discloses removals',async()=>{
 const result=await fuseSemantic([ref('SQLite WAL','SQLite concurrency'),ref('Home','C library','https://sqlite.org/')],{query:'SQLite WAL concurrency',evidenceGate:true,domainCap:0} as any);
 assert.equal(result.refs.length,1);assert.equal(result.meta.quality?.rejected,1);assert.equal(result.meta.quality?.status,'candidate_results');
});

test('embedding dedup failure cannot restore evidence-gate rejects',async()=>{
 let calls=0;const result=await fuseSemantic([ref('SQLite WAL concurrency','writer lock'),ref('SQLite WAL locks','WAL concurrency','https://other.example/wal'),ref('搜狗','下载','https://sogou.com/')],{query:'SQLite WAL concurrency',evidenceGate:true,domainCap:0,embedder:{name:'broken',embed:async()=>{calls++;throw new Error('unavailable');}}} as any);
 assert.equal(calls,1);assert.equal(result.meta.embedderFailed,true);assert.equal(result.refs.length,2);assert.ok(result.refs.every(r=>!r.url.includes('sogou')));
});

test('new quality cache cannot be spoofed with a passing policy label and unrelated refs',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'sc-quality-cache-'));let calls=0;const core=new SearchCore({config:{dataDir:dir,engines:['keenable'],keySlots:'off'},fetchImpl:async()=>{calls++;return Response.json({results:[{url:'https://sqlite.org/wal.html',title:'SQLite WAL concurrency',description:'SQLite single writer WAL locking'}]});}});t.after(()=>{core.close();rmSync(dir,{recursive:true,force:true});});
 const query='SQLite WAL concurrency',decision=plan(query);const key=Cache.hash(JSON.stringify({policy:'provider-allowlist-v1+lexical-evidence-v1',q:decision.queries,r:decision.route,o:{e:['keenable']}}));
 core.cache.putSearch(key,{query,refs:[{...ref('搜狗输入法','typing tools'),engines:['keenable']}],meta:{enginesUsed:['keenable'],enginesFailed:[],elapsedMs:1,fromCache:false,quality:{policy:'lexical-evidence-v1',status:'candidate_results',evaluated:1,rejected:0,reasons:{}}}});
 const result=await core.search(query,{engines:['keenable']});assert.equal(result.meta.fromCache,false);assert.ok(calls);assert.ok(result.refs.length);assert.ok(result.refs.every(r=>!r.title.includes('搜狗')));
});

test('reserved fake-IP diagnostics do not send a request or exempt the forbidden range',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'sc-quality-dns-'));let calls=0;const core=new SearchCore({config:{dataDir:dir,ssrf:'strict',keySlots:'off'},fetchImpl:async()=>{calls++;throw new Error('Blocked target must never be requested');}});t.after(()=>{core.close();rmSync(dir,{recursive:true,force:true});});
 await assert.rejects(core.fetch('https://198.18.0.2/'),/possible TUN.*fake-IP mapping/);assert.equal(calls,0);
});
