import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {composeRules} from '../core/views.mjs';
import {sha256} from '../core/files.mjs';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-compose-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'agents-md/base'),{recursive:true});await fs.mkdir(path.join(root,'agents-md/fragments'));
 await fs.writeFile(path.join(root,'agents-md/base/AGENTS.md'),'# Base rules');await fs.writeFile(path.join(root,'agents-md/fragments/ui.md'),'## UI rules');
 const project=path.join(root,'project.md'),output=path.join(root,'AGENTS.candidate.md');await fs.writeFile(project,'# Project-only rules');return {root,project,output};
}
async function noPartial(root,output){await assert.rejects(fs.access(output));await assert.rejects(fs.access(output+'.sources.json'));await assert.rejects(fs.access(output+'.compose.lock'));assert.ok((await fs.readdir(root)).every(name=>!name.startsWith('.agents-compose-')));}
test('candidate source hashes match complete original text and independent output',async t=>{
 const {root,project,output}=await fixture(t);await composeRules(root,project,output,{fragments:['ui']});const text=await fs.readFile(output,'utf8'),metadata=JSON.parse(await fs.readFile(output+'.sources.json','utf8'));
 assert.ok(text.includes('Base rules')&&text.includes('UI rules')&&text.includes('Project-only rules'));assert.equal(metadata.output_sha256,sha256(text));assert.equal(metadata.sources.at(-1).sha256,sha256(await fs.readFile(project)));assert.equal(metadata.semantic_conflicts_checked,false);
});
test('two concurrent composers produce one complete pair without overriding',async t=>{
 const {root,project,output}=await fixture(t);const results=await Promise.allSettled([composeRules(root,project,output),composeRules(root,project,output)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const record=JSON.parse(await fs.readFile(output+'.sources.json','utf8'));assert.equal(record.output_sha256,sha256(await fs.readFile(output)));await assert.rejects(fs.access(output+'.compose.lock'));
});
test('existing output sidecar and other-owner lock remain untouched',async t=>{
 const {root,project,output}=await fixture(t);await fs.writeFile(output+'.sources.json','user metadata');await assert.rejects(composeRules(root,project,output),/exists/);assert.equal(await fs.readFile(output+'.sources.json','utf8'),'user metadata');await fs.unlink(output+'.sources.json');
 await fs.writeFile(output+'.compose.lock','other owner');await assert.rejects(composeRules(root,project,output),/output lock/);assert.equal(await fs.readFile(output+'.compose.lock','utf8'),'other owner');await assert.rejects(fs.access(output));
});
test('metadata write and content publication failures remove only owned candidate artifacts',async t=>{
 const {root,project,output}=await fixture(t);const originalWrite=fs.writeFile;
 fs.writeFile=async(p,...args)=>{if(String(p).endsWith(path.sep+'sources'))throw new Error('metadata write failed');return originalWrite(p,...args);};
 try{await assert.rejects(composeRules(root,project,output),/metadata write failed/);}finally{fs.writeFile=originalWrite;}await noPartial(root,output);
 const originalLink=fs.link;fs.link=async(src,dest)=>{if(dest===output)throw new Error('content publication failed');return originalLink(src,dest);};
 try{await assert.rejects(composeRules(root,project,output),/content publication failed/);}finally{fs.link=originalLink;}await noPartial(root,output);
});
test('project changing while preparing candidate is rejected before publish',async t=>{
 const {root,project,output}=await fixture(t);const original=fs.writeFile;let changed=false;
 fs.writeFile=async(dest,...args)=>{const result=await original(dest,...args);if(String(dest).endsWith(path.sep+'content')&&!changed){changed=true;await original(project,'New project rules');}return result;};
 try{await assert.rejects(composeRules(root,project,output),/source changed/);}finally{fs.writeFile=original;}await noPartial(root,output);assert.equal(await fs.readFile(project,'utf8'),'New project rules');
});
test('content created by another writer during publication is preserved',async t=>{
 const {root,project,output}=await fixture(t);const originalLink=fs.link;fs.link=async(src,dest)=>{if(dest===output)await fs.writeFile(output,'Concurrent user content',{flag:'wx'});return originalLink(src,dest);};
 try{await assert.rejects(composeRules(root,project,output));}finally{fs.link=originalLink;}assert.equal(await fs.readFile(output,'utf8'),'Concurrent user content');await assert.rejects(fs.access(output+'.sources.json'));await assert.rejects(fs.access(output+'.compose.lock'));
});
test('linked output parent incomplete base and duplicate fragment are rejected',async t=>{
 const {root,project,output}=await fixture(t);await fs.mkdir(path.join(root,'external'));await fs.symlink(path.join(root,'external'),path.join(root,'linked'),'junction');await assert.rejects(composeRules(root,project,path.join(root,'linked/output.md')),/Linked/);assert.deepEqual(await fs.readdir(path.join(root,'external')),[]);
 await assert.rejects(composeRules(root,project,output,{fragments:['ui','ui']}),/Duplicate/);await fs.writeFile(path.join(root,'agents-md/base/AGENTS.md'),'待填写');await assert.rejects(composeRules(root,project,output),/incomplete/);await noPartial(root,output);
});
