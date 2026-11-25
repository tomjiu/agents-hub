// S3 (issue #3) TS 对等: 矩阵 #33 版本适用性标注 + #34 来源构成 — 红灯先行。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SearchCore} from '../engine.js';
import {versionSignals,sourceMix} from '../relevance.js';

function coreFixture(t:any,results:{url:string;title:string;content:string}[],q:string){
  const dir=mkdtempSync(join(tmpdir(),'sc-s3par-'));
  const core=new SearchCore({config:{dataDir:dir,keySlots:'off',timeoutMs:3000,softDeadlineMs:1500,earlyHarvestMs:0,
    searxng:{baseUrl:'https://searx.example',instances:[]}},fetchImpl:async input=>{
    const url=String(input);
    if(url.startsWith('https://searx.example/')){
      // 每条结果分散域名(防 domainCap 截断) + 差异化词面(防 embedding 合并) + sourceKind 官方域覆盖
      return Response.json({results});
    }
    return new Response('forbidden',{status:403});
  }});
  t.after(()=>{core.close();rmSync(dir,{recursive:true,force:true});});
  return core;
}

// ---------- #33 版本适用性标注 (只标注不剔除; 查询无版本 → 不产出) ----------
test('S3 #33 versionSignals: 不同主版本 ref 被标注, 同主版本不标, 无版本查询不产出', ()=>{
  const refs:any[]=[
    {refId:1,url:'https://go.dev/doc/go1.25',title:'Go 1.25 Release Notes'},
    {refId:2,url:'https://go.dev/doc/go2.0',title:'Go 2.0 Draft Spec'},
    {refId:3,url:'https://go.dev/blog/go1.23',title:'Go 1.23 runtime'},
    {refId:4,url:'https://example.com/no-version',title:'Go release overview'},
  ];
  const vc=versionSignals('Go 1.23 release notes',refs)!;
  assert.equal(vc.queryVersion,'1.23');
  const flaggedIds=(vc.flagged??[]).map((f:any)=>f.refId);
  assert.ok(flaggedIds.includes(2),'different major (2.0 vs 1.23) flagged');
  assert.ok(!flaggedIds.includes(1),'same major 1.25 not flagged');
  assert.ok(!flaggedIds.includes(3),'same major 1.23 not flagged');
  assert.ok(!flaggedIds.includes(4),'no version in ref not flagged');
  assert.equal(vc.flagged!.find((f:any)=>f.refId===2)!.reason,'different_major_version');
  // 查询无版本 → undefined
  assert.equal(versionSignals('Go release notes',refs),undefined);
  // 单数字不算版本(Go 同款守卫: 单字符且无小数点; 注意 "10" 两位数 Go 语义也算版本 — 对等保留)
  assert.equal(versionSignals('top 5 go tips',refs),undefined);
});

// ---------- #34 来源构成 (official/community/unknown 计数, S3 来源透明) ----------
test('S3 #34 sourceMix: sourceKind 构成计数, 空→unknown', ()=>{
  const refs:any[]=[
    {sourceKind:'official'},{sourceKind:'official'},{sourceKind:'community'},{}, // 无 sourceKind → unknown
  ];
  assert.deepEqual(sourceMix(refs),{official:2,community:1,unknown:1});
  assert.deepEqual(sourceMix([]),{});
});

// ---------- 集成: meta.quality 携带 versionCheck + sourceMix ----------
test('S3 #33/#34 integration: search 结果 quality 输出版本标注与来源构成', async t=>{
  const q='Go 1.23 release notes';
  const WP=Array.from({length:60},(_,i)=>`aspect${i}`);
  // 3 域名分散(domainCap) + 差异化词面(embedding 合并防线)
  const results=[
    {url:`https://go.dev/doc/go1.23`,title:`${q} ${WP.slice(0,6).join(' ')}`,content:`${q} ${WP.slice(0,6).join(' ')}`},
    {url:`https://go.dev/doc/go2.0-draft`,title:`Go 2.0 draft release notes ${WP.slice(6,12).join(' ')}`,content:`Go 2.0 draft release notes spec ${WP.slice(6,12).join(' ')}`},
    {url:`https://blog.example.com/go123-notes`,title:`${q} ${WP.slice(12,18).join(' ')}`,content:`${q} summary ${WP.slice(12,18).join(' ')}`},
    {url:`https://wiki.example.org/go-release`,title:`${q} ${WP.slice(18,24).join(' ')}`,content:`${q} details ${WP.slice(18,24).join(' ')}`},
  ];
  const core=coreFixture(t,results,q);
  const r=await core.search(q,{engines:['searxng'],maxResults:10});
  assert.ok(r.refs.length>=2,`refs=${r.refs.length}`);
  assert.ok(r.meta.quality,'quality present');
  assert.equal(r.meta.quality!.versionCheck?.queryVersion,'1.23');
  assert.ok(r.meta.quality!.versionCheck!.flagged!.some((f:any)=>f.refVersion.startsWith('2.0')),'go2.0 flagged');
  assert.ok(r.meta.quality!.sourceMix && Object.keys(r.meta.quality!.sourceMix).length>0,
    `sourceMix=${JSON.stringify(r.meta.quality!.sourceMix)}`);
});
