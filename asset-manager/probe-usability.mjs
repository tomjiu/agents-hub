import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {loadCatalog} from './core/catalog.mjs';
import {searchAssets} from './core/discovery.mjs';
import {auditAssetUsability,preflightSelection} from './core/usability.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const start=performance.now(),catalog=await loadCatalog(root),lookups=[];
for(const asset of catalog.values()){
 const time=performance.now(),found=await searchAssets(root,asset.id,{kind:asset.kind,limit:1});assert.equal(found.results[0]?.id,asset.id,'Stable ID must remain discoverable: '+asset.id);
 lookups.push({id:asset.id,kind:asset.kind,status:found.results[0].usability,milliseconds:Math.round(performance.now()-time)});
}
const tasks=[];
for(const [query,kind,expected] of [['记忆插件','plugins','memory-net'],['搜索插件','mcp','mcp.search-core'],['查找技能','skills','skill-search'],['来源索引','skills','source-index']]){
 const found=await searchAssets(root,query,{kind,limit:3});assert.ok(found.results.some(a=>a.id===expected),'Task lookup missing: '+query);tasks.push({query,kind,expected,found:found.results.map(a=>a.id)});
}
const audit=await auditAssetUsability(root),combinations=[];
for(const expert of ['core','research','reverse-engineering','document-engineering']){
 const preview=await preflightSelection(root,{expert});combinations.push({expert,status:preview.status,conflicts:preview.conflicts,blockers:preview.blockers,requirements:preview.requirements});
}
assert.equal(combinations.find(c=>c.expert==='core').status,'CONTENT_READY');assert.equal(combinations.find(c=>c.expert==='research').status,'CONDITIONAL');assert.equal(combinations.find(c=>c.expert==='document-engineering').status,'BLOCKED');
const collisions=await preflightSelection(root,{ids:['skill-creator','trae.skill-creator']});assert.ok(collisions.conflicts.some(c=>c.code==='duplicate-skill-name'));
const report={schema:1,status:'PASS_WITH_EXPLICIT_ASSET_BARRIERS',total_assets:catalog.size,exact_id_lookups:lookups,task_queries:tasks,counts:audit.counts,combination_previews:combinations,duplicate_example:{ids:['skill-creator','trae.skill-creator'],status:collisions.status,conflicts:collisions.conflicts},duration_ms:Math.round(performance.now()-start),scope:'Actual local search/preflight API used by CLI; all137 stable IDs exercised. No inference quality, license grant, credentials or external services certified.'};
await fs.mkdir(path.join(root,'.asset-state/evidence'),{recursive:true});await fs.writeFile(path.join(root,'.asset-state/evidence/usability-experience.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,total_assets:catalog.size,lookup_success:lookups.length,task_queries:tasks,counts:report.counts,combinations:combinations.map(c=>({expert:c.expert,status:c.status,blockers:c.blockers.length})),duration_ms:report.duration_ms},null,2));
