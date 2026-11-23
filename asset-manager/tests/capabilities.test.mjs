import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {stringify} from 'smol-toml';
import {listCapabilities,findCapabilities,validateCapabilities} from '../core/capabilities.mjs';
import {sha256,tree} from '../core/files.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url));
test('reviewed task routes find specific assets without fragment matches',async()=>{
 for(const [query,id] of [['需求分析与规划','writing-plans'],['办公质量验收','verification-before-completion'],['UI设计','frontend-design'],['自动化测试','webapp-testing'],['浏览器自动化','playwright']]){
  const r=await findCapabilities(root,query);assert.ok(r.routes.length);assert.ok(r.routes[0].providers.some(p=>p.id===id),query);assert.equal(r.activated,false);
 }
 assert.equal((await findCapabilities(root,'quantum agriculture')).status,'NO_MATCH');
 assert.equal((await findCapabilities(root,'build pipeline')).status,'NO_MATCH');
 const partial=await findCapabilities(root,'办公质量验收');assert.equal(partial.routes[0].coverage,'partial');assert.ok(partial.routes[0].limitations.length);
});
test('directory separates facets from paths and retains source restrictions',async()=>{
 const dir=await listCapabilities(root);assert.equal(dir.classification_scope,'curated_subset');
 const ui=dir.routes.find(r=>r.id==='ui-design');assert.ok(ui.domains.includes('design'));assert.ok(ui.providers.find(p=>p.id==='frontend-design').path.includes('/document/'));
 const vendor=ui.providers.find(p=>p.id==='workbuddy.ardot-ui-design');assert.equal(vendor.usability,'BLOCKED');assert.ok(vendor.blockers.length);assert.equal(vendor.source.kind,'workbuddy-installer');
 const doc=dir.routes.find(r=>r.id==='word-document');assert.equal(doc.status,'UNAVAILABLE');assert.ok(doc.providers.some(p=>p.declared_restriction));
 assert.ok(dir.unmapped_asset_ids.length>0);assert.ok((await listCapabilities(root,{group:'office'})).routes.every(r=>r.group==='office'));
});
async function fixture(t){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'hub-capabilities-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const rel='skills/demo';await fs.mkdir(path.join(home,rel),{recursive:true});await fs.mkdir(path.join(home,'catalog/assets'),{recursive:true});
 const text=['---','name: demo','description: fixture','---','body',''].join(String.fromCharCode(10));await fs.writeFile(path.join(home,rel,'SKILL.md'),text);
 await fs.writeFile(path.join(home,'catalog/assets/demo.toml'),stringify({id:'demo',kind:'skills',path:rel,source:{kind:'local'},version:{sha256:(await tree(path.join(home,rel))).sha256}}));
 const data={schema:1,groups:[{id:'office',title:'办公工作'}],routes:[{id:'demo-task',title:'演示任务',group:'office',domains:['workflow'],stages:['plan'],aliases:['任务规划','plan task'],coverage:'partial',limitations:['Not execution acceptance'],providers:[{id:'demo',reviewed_skill_sha256:sha256(text),fit:'supporting',reason:'Fixture scope review',limitations:['Fixture only']}]}]};
 const file=path.join(home,'catalog/capabilities.json');await fs.writeFile(file,JSON.stringify(data));return {home,file,data,source:path.join(home,rel,'SKILL.md')};
}
test('changed or unavailable effective source invalidates the mapping and never writes state',async t=>{
 const f=await fixture(t);let r=await findCapabilities(f.home,'任务规划');assert.equal(r.routes[0].providers[0].mapping_status,'CURRENT');
 await fs.appendFile(f.source,'changed');r=await findCapabilities(f.home,'任务规划');assert.equal(r.routes[0].status,'UNAVAILABLE');assert.equal(r.routes[0].providers[0].mapping_status,'REVIEW_NEEDED');
 await fs.rm(f.source);r=await findCapabilities(f.home,'任务规划');assert.equal(r.routes[0].status,'UNAVAILABLE');assert.ok(r.routes[0].providers[0].blockers.length);
 assert.equal(await fs.stat(path.join(f.home,'.asset-state')).then(()=>true,()=>false),false);
});
test('registry and options reject malformed duplicate unknown or unsafe references',async t=>{
 const f=await fixture(t);
 for(const change of [d=>d.schema=2,d=>d.routes.push(d.routes[0]),d=>d.routes[0].group='bad',d=>d.routes[0].providers[0].id='missing',d=>d.routes[0].providers[0].reviewed_skill_sha256='bad',d=>d.routes[0].aliases=[],d=>d.routes[0].stages=['fake'],d=>d.routes[0].providers.push(d.routes[0].providers[0]),d=>d.routes[0].enabled=true]){
  const d=structuredClone(f.data);change(d);await fs.writeFile(f.file,JSON.stringify(d));await assert.rejects(validateCapabilities(f.home));
 }
 await fs.writeFile(f.file,JSON.stringify(f.data));
 for(const query of ['', ' ', '!'.repeat(501)])await assert.rejects(findCapabilities(f.home,query));
 for(const opts of [{group:'bad'},{client:'bad'},{limit:0},{limit:21},{limit:1.2}])await assert.rejects(findCapabilities(f.home,'任务规划',opts));
 assert.equal((await findCapabilities(f.home,'plan tasks')).status,'NO_MATCH');
 assert.equal((await findCapabilities(f.home,'DEMO-TASK')).total_matches,1);
});
test('multiple task matches remain explicit and limits do not hide total coverage',async()=>{
 const all=await findCapabilities(root,'UI设计和自动化测试');assert.ok(all.total_matches>=2);const one=await findCapabilities(root,'UI设计和自动化测试',{limit:1});assert.equal(one.total_matches,all.total_matches);assert.equal(one.routes.length,1);
});

test('actual CLI routes task wording and rejects unknown or incomplete options',()=>{
 const call=(...args)=>JSON.parse(execFileSync(process.execPath,[path.join(root,'asset-manager/cli.mjs'),...args],{cwd:root,encoding:'utf8'}));
 const result=call('find-capability','UI设计');assert.equal(result.routes[0].id,'ui-design');assert.equal(result.activated,false);
 assert.equal(call('find-capability','unknown topic').status,'NO_MATCH');
 assert.ok(call('capabilities','--group','office').routes.every(r=>r.group==='office'));
 for(const args of [['capabilities','extra'],['capabilities','--group'],['capabilities','--limit','1'],['find-capability'],['find-capability','UI设计','--limit'],['find-capability','UI设计','--limit','0'],['find-capability','UI设计','--unknown','x'],['find-capability','UI设计','--group','design','--group','office']]){
  assert.throws(()=>call(...args),args.join(' '));
 }
});

test('active snapshots require fresh body mapping and respect snapshot integrity',async t=>{
 const f=await fixture(t),version='00000000-0000-4000-8000-000000000001';
 const content=path.join(f.home,'.asset-state/versions/demo',version,'content');
 await fs.mkdir(content,{recursive:true});await fs.copyFile(f.source,path.join(content,'SKILL.md'));
 const state={schema:1,revision:1,active:{demo:{version,sha256:(await tree(content)).sha256}},history:[]};
 const stateFile=path.join(f.home,'.asset-state/active.json');await fs.writeFile(stateFile,JSON.stringify(state));
 const before=await fs.readFile(stateFile,'utf8');
 let result=await findCapabilities(f.home,'任务规划');assert.equal(result.routes[0].providers[0].mapping_status,'CURRENT');
 await fs.appendFile(path.join(content,'SKILL.md'),'new version');
 state.active.demo.sha256=(await tree(content)).sha256;await fs.writeFile(stateFile,JSON.stringify(state));
 result=await findCapabilities(f.home,'任务规划');assert.equal(result.routes[0].providers[0].mapping_status,'REVIEW_NEEDED');assert.equal(result.routes[0].status,'UNAVAILABLE');
 await fs.appendFile(path.join(content,'SKILL.md'),'tamper');
 result=await findCapabilities(f.home,'任务规划');assert.ok(result.routes[0].providers[0].blockers.some(b=>b.code==='source-integrity'));
 assert.equal(await fs.readFile(stateFile,'utf8'),JSON.stringify(state));assert.ok(before.length);
});
test('ASCII boundaries, NFKC, none coverage and metadata rejection are explicit',async t=>{
 const f=await fixture(t);
 assert.equal((await findCapabilities(f.home,'请做 PLAN TASK，然后继续')).total_matches,1);
 assert.equal((await findCapabilities(f.home,'ＰＬＡＮ ＴＡＳＫ')).total_matches,1);
 assert.equal((await findCapabilities(f.home,'foo.plan task')).total_matches,0);
 for(const change of [d=>d.groups.push(d.groups[0]),d=>d.routes[0].providers[0].fit='invalid',d=>d.routes[0].domains=['bad'],d=>d.routes[0].coverage='none',d=>d.routes[0].aliases=['task','TASK']]){
  const d=structuredClone(f.data);change(d);await fs.writeFile(f.file,JSON.stringify(d));await assert.rejects(validateCapabilities(f.home));
 }
 const d=structuredClone(f.data);d.routes[0].coverage='none';d.routes[0].providers=[];await fs.writeFile(f.file,JSON.stringify(d));
 const result=await findCapabilities(f.home,'任务规划');assert.equal(result.routes[0].status,'UNAVAILABLE');assert.deepEqual(result.routes[0].providers,[]);
});
test('generated user directory stays synchronized with curated metadata',async()=>{
 const {renderCapabilityDirectory}=await import('../core/capabilities.mjs');
 assert.equal(await fs.readFile(path.join(root,'catalog/CAPABILITIES.md'),'utf8'),await renderCapabilityDirectory(root));
});

test('optional validation ignores only absent registry, not missing dependencies',async t=>{
 const {validateCapabilitiesIfPresent}=await import('../core/capabilities.mjs');
 const f=await fixture(t);
 assert.equal((await validateCapabilitiesIfPresent(f.home)).status,'PASS');
 await fs.rename(path.join(f.home,'catalog/assets'),path.join(f.home,'catalog/assets-moved'));
 await assert.rejects(validateCapabilitiesIfPresent(f.home),/ENOENT/);
 await fs.rm(f.file);
 assert.equal(await validateCapabilitiesIfPresent(f.home),null);
});
