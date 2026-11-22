import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {stringify} from 'smol-toml';
import YAML from 'yaml';
import {createDshBundle,verifyDshBundle} from '../core/dsh-bundle.mjs';
import {dshFingerprint} from '../core/dsh-compatibility.mjs';
import {tree} from '../core/files.mjs';
async function fixture(t){
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'hub-bundle-test-'));t.after(()=>fs.rm(work,{recursive:true,force:true}));const root=path.join(work,'hub'),host=path.join(work,'dsh');
 for(const rel of ['catalog/assets','catalog/runtime','experts','skills/demo','mcp','plugins/memory-net/src','plugins/memory-net/adapters/dsh/src','plugins/memory-net/adapters/dsh/dist/adapters/dsh/src','mcp/servers/search-core/typescript/src','mcp/servers/search-core/typescript/dist','asset-manager/core'])await fs.mkdir(path.join(root,rel),{recursive:true});
 for(const name of ['@deepseek-ai/dsh-base','@deepseek-ai/dsh-official-bundles','@deepseek-ai/dsh-tool-skill','@deepseek-ai/cordis','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-system-prompt','@deepseek-ai/dsh-skill-filesystem','@deepseek-ai/dsh-mcp-client','@deepseek-ai/dsh-llm-pi-ai','@deepseek-ai/dsh-headless']){
  const directory=path.join(host,'node_modules',name);await fs.mkdir(path.join(directory,'lib'),{recursive:true});await fs.writeFile(path.join(directory,'package.json'),JSON.stringify({name,version:'test',main:'lib/index.js'}));await fs.writeFile(path.join(directory,'lib/index.js'),'module.exports = {};');
 }
 await fs.mkdir(path.join(host,'lib'));await fs.writeFile(path.join(host,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh',version:'0.2.2-rc.1'}));await fs.writeFile(path.join(host,'lib/bin.js'),'// test-only host');
 for(const rel of ['plugins/memory-net/adapters/dsh/package.json','plugins/memory-net/adapters/dsh/package-lock.json','mcp/servers/search-core/typescript/package.json','mcp/servers/search-core/typescript/package-lock.json'])await fs.writeFile(path.join(root,rel),'{}');
 for(const rel of ['asset-manager/core/views.mjs','asset-manager/core/usability.mjs','asset-manager/core/catalog.mjs','asset-manager/core/license-review.mjs','asset-manager/core/mcp-config.mjs','mcp/servers/search-core/typescript/dist/mcp.js'])await fs.writeFile(path.join(root,rel),'// fixture');
 await fs.writeFile(path.join(root,'plugins/memory-net/adapters/dsh/dist/adapters/dsh/src/index.js'),'export function apply() {return {}; }');
 await fs.writeFile(path.join(root,'mcp/registry.toml'),stringify({schema:1,servers:[]}));await fs.writeFile(path.join(root,'skills/demo/SKILL.md'),['---','name: demo','description: Fixture','---','fixture'].join(String.fromCharCode(10)));
 const version={sha256:(await tree(path.join(root,'skills/demo'))).sha256};await fs.writeFile(path.join(root,'catalog/assets/demo.toml'),stringify({id:'demo',kind:'skills',path:'skills/demo',source:{kind:'local'},version}));await fs.writeFile(path.join(root,'catalog/assets/memory-net.toml'),stringify({id:'memory-net',kind:'plugins',path:'plugins/memory-net',source:{kind:'local'},version:{sha256:(await tree(path.join(root,'plugins/memory-net'))).sha256}}));
 await fs.writeFile(path.join(root,'experts/research.toml'),stringify({name:'research',skills:['demo'],mcp:[],plugins:[]}));const fingerprint=await dshFingerprint(root,host);
 const report={status:'PASS',fetch:{literal_refused:true},parallel_discovery:true,search:{queried:true,refs_returned:true,cache_hit:true,cache_isolated:true,explicit_selection_verified:true,quality_verified:true},host_version:fingerprint.version,fingerprint,skill:{full_content_seen_by_model:true},mcp:{result_returned_to_model:true},memory:{persisted:true,prompt_injection:true,auto_observe:true,self_filter:true}};
 await fs.writeFile(path.join(root,'catalog/runtime/dsh-compatibility.json'),JSON.stringify({schema:1,acceptances:[report]}));return {root,host,work};
}
test('bundle copies selected skills and compiled memory without changing profile',async t=>{
 const {root,host}=await fixture(t);const first=await createDshBundle(root,host,{memory:true});assert.equal(first.profile_installed,false);assert.equal(first.auto_loaded,false);
 assert.equal((await verifyDshBundle(first.bundle)).status,'VERIFIED');assert.equal((await verifyDshBundle(first.bundle)).memory,true);
 const patch=YAML.parse(await fs.readFile(first.patch,'utf8'));assert.equal(patch[0].id,'skill-filesystem');const memory=patch.flatMap(op=>op.insert||[]).find(op=>op.id==='agents-hub-memory-net');assert.ok(memory.name.startsWith('file:'));assert.ok(memory.config.workspaces_root.startsWith(first.bundle));
 const second=await createDshBundle(root,host,{memory:false});assert.notEqual(first.bundle,second.bundle);assert.equal((await verifyDshBundle(second.bundle)).memory,false);await assert.rejects(fs.access(path.join(host,'profiles')));
});
test('bundle artifact compiled runtime and unexpected user files fail verification',async t=>{
 const {root,host}=await fixture(t);const bundle=await createDshBundle(root,host,{memory:true});
 const patch=await fs.readFile(bundle.patch);await fs.appendFile(bundle.patch,' ');await assert.rejects(verifyDshBundle(bundle.bundle),/artifact changed/);await fs.writeFile(bundle.patch,patch);
 const runtime=path.join(bundle.bundle,'memory-runtime/adapters/dsh/src/index.js'),bytes=await fs.readFile(runtime);await fs.appendFile(runtime,' ');await assert.rejects(verifyDshBundle(bundle.bundle),/runtime changed/);await fs.writeFile(runtime,bytes);
 const note=path.join(bundle.bundle,'skills/demo/user-file');await fs.writeFile(note,'user data');await assert.rejects(verifyDshBundle(bundle.bundle),/runtime changed/);await fs.unlink(note);
 await fs.mkdir(path.join(bundle.bundle,'state'));const external=path.join(root,'external');await fs.mkdir(external);await fs.symlink(external,path.join(bundle.bundle,'state/memory-net'),'junction');await assert.rejects(verifyDshBundle(bundle.bundle),/Links/);
});
test('new host bytes and malformed bundle ownership require new acceptance',async t=>{
 const {root,host}=await fixture(t);const bundle=await createDshBundle(root,host,{memory:false});await fs.appendFile(path.join(host,'lib/bin.js'),' changed');await assert.rejects(createDshBundle(root,host),/acceptance required/);await assert.rejects(verifyDshBundle(bundle.bundle),/no longer match/);
 const manifest=JSON.parse(await fs.readFile(path.join(bundle.bundle,'bundle.json'),'utf8'));manifest.id='invalid';await fs.writeFile(path.join(bundle.bundle,'bundle.json'),JSON.stringify(manifest));await assert.rejects(verifyDshBundle(bundle.bundle),/Invalid/);
});

test('bundle targets one installation and cannot verify as a different running host',async t=>{
 const {root,host}=await fixture(t);const bundle=await createDshBundle(root,host,{memory:true});
 await assert.rejects(verifyDshBundle(bundle.bundle,{requireRunningHost:true}),/Running DSH does not match/);
 const manifestFile=path.join(bundle.bundle,'bundle.json'),manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));manifest.artifacts['../outside']='a'.repeat(64);await fs.writeFile(manifestFile,JSON.stringify(manifest));
 await assert.rejects(verifyDshBundle(bundle.bundle),/Invalid bundle content ownership/);
});

test('search bundle passes an explicit private SC_DATA_DIR to DSH MCP config',async t=>{
 const {root,host}=await fixture(t);
 await fs.mkdir(path.join(root,'mcp/servers/search-core/typescript'),{recursive:true});
 const hash=(await tree(path.join(root,'mcp/servers/search-core/typescript'))).sha256;
 await fs.writeFile(path.join(root,'catalog/assets/mcp.search-core.toml'),stringify({id:'mcp.search-core',kind:'mcp',path:'mcp/servers/search-core/typescript',registry_id:'search-core',source:{kind:'local'},version:{sha256:hash}}));
 await fs.writeFile(path.join(root,'experts/research.toml'),stringify({name:'research',skills:['demo'],mcp:['mcp.search-core'],plugins:[]}));
 await fs.writeFile(path.join(root,'mcp/registry.toml'),stringify({schema:1,servers:[{id:'search-core',transport:'stdio',command:'node',args:['mcp/servers/search-core/typescript/dist/mcp.js'],cwd:'.',status:'build-required'}]}));
 const fingerprint=await dshFingerprint(root,host);const evidence={status:'PASS',fetch:{literal_refused:true},parallel_discovery:true,host_version:fingerprint.version,fingerprint,skill:{full_content_seen_by_model:true},mcp:{result_returned_to_model:true},search:{queried:true,refs_returned:true,cache_hit:true,cache_isolated:true,explicit_selection_verified:true,quality_verified:true},memory:{persisted:true,prompt_injection:true,auto_observe:true,self_filter:true}};
 await fs.writeFile(path.join(root,'catalog/runtime/dsh-compatibility.json'),JSON.stringify({schema:1,acceptances:[evidence]}));
 const bundle=await createDshBundle(root,host,{memory:true});const patch=YAML.parse(await fs.readFile(bundle.patch,'utf8'));const mcp=patch.flatMap(op=>op.insert||[]).find(op=>op.config?.serverName==='search-core');assert.equal(mcp.config.env.SC_DATA_DIR,path.join(bundle.bundle,'state/search-core'));assert.equal(mcp.config.env.SC_MCP_DISCLOSURE,'static');assert.equal((await verifyDshBundle(bundle.bundle)).status,'VERIFIED');
});
