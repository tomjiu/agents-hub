import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {classifyDshCompatibility,checkDshUpstream,saveDshAcceptance} from '../core/dsh-compatibility.mjs';
const fingerprint={version:'0.2.2-rc.1',host_sha256:'host-A',assets_sha256:'assets-A'};
const accepted={status:'PASS',parallel_discovery:true,search:{queried:true,refs_returned:true,cache_hit:true,cache_isolated:true,explicit_selection_verified:true,quality_verified:true},host_version:fingerprint.version,fingerprint,skill:{full_content_seen_by_model:true},mcp:{result_returned_to_model:true},memory:{persisted:true,prompt_injection:true,auto_observe:true,self_filter:true}};
test('matching exact host and asset fingerprints passes but never grants auto-upgrade',()=>{
 const result=classifyDshCompatibility(fingerprint,[accepted]);assert.equal(result.status,'VERIFIED');assert.equal(result.auto_upgrade,false);assert.equal(result.auto_enable,false);
});
test('new DSH version or same-version binary modification requires acceptance',()=>{
 for(const value of [{...fingerprint,version:'0.2.2-rc.4'},{...fingerprint,host_sha256:'host-modified'}])assert.equal(classifyDshCompatibility(value,[accepted]).status,'NEEDS_ACCEPTANCE');
});
test('memory/search edits invalidate old acceptance instead of declaring all versions compatible',()=>{
 assert.equal(classifyDshCompatibility({...fingerprint,assets_sha256:'changed-plugin'},[accepted]).status,'NEEDS_ACCEPTANCE');
});
test('partial fixture or failed host run is not accepted',()=>{
 for(const record of [{...accepted,status:'FAIL'},{...accepted,memory:{}},{...accepted,mcp:{}},{...accepted,skill:{}},{...accepted,search:{}},{...accepted,parallel_discovery:false},{...accepted,search:{...accepted.search,explicit_selection_verified:false}},{...accepted,search:{...accepted.search,quality_verified:false}}])assert.equal(classifyDshCompatibility(fingerprint,[record]).status,'NEEDS_ACCEPTANCE');
 assert.equal(classifyDshCompatibility(fingerprint,[]).status,'NEEDS_ACCEPTANCE');assert.throws(()=>classifyDshCompatibility(fingerprint,null),/Invalid/);
});

test('release discovery detects new next version without download upgrade or activation',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-dsh-tags-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'catalog/runtime'),{recursive:true});
 await fs.writeFile(path.join(root,'catalog/runtime/dsh-compatibility.json'),JSON.stringify({schema:1,acceptances:[accepted]}));
 const calls=[];const result=await checkDshUpstream(root,{request:async url=>{calls.push(url);return {latest:'0.2.2-rc.1',next:'0.2.2-rc.5'};}});
 assert.equal(calls.length,1);assert.equal(result.status,'ACCEPTANCE_REQUIRED');assert.equal(result.channels.next.has_recorded_acceptance,false);assert.equal(result.auto_upgrade,false);assert.equal(result.auto_enable,false);
 await assert.rejects(checkDshUpstream(root,{request:async()=>({latest:'../invalid',next:'0.2.2-rc.5'})}),/Invalid npm/);
 await assert.rejects(checkDshUpstream(root,{request:async()=>{throw new Error('Private address blocked');}}),/Private address/);
});

test('acceptance evidence rejects partial run unsafe version and malformed hashes',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-dsh-accept-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const report={...accepted,fingerprint:{version:accepted.host_version,host_sha256:'a'.repeat(64),assets_sha256:'b'.repeat(64)}};
 for(const bad of [{...report,host_version:'../../escape'},{...report,memory:{persisted:true}},{...report,fingerprint:{...report.fingerprint,host_sha256:'not-a-hash'}},{...report,host_version:'0.2.2-rc.4'}])await assert.rejects(saveDshAcceptance(root,bad),/Complete host acceptance/);
 const file=await saveDshAcceptance(root,report);assert.equal(JSON.parse(await fs.readFile(file,'utf8')).host_version,report.host_version);
 const original=await fs.readFile(file,'utf8');await saveDshAcceptance(root,report);assert.equal(await fs.readFile(file,'utf8'),original);
});
