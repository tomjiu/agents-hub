import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createSearchFixture} from './search-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dep=path.join(root,'mcp/servers/search-core/typescript/node_modules/@modelcontextprotocol/sdk/dist/esm');
const {Client}=await import(pathToFileURL(path.join(dep,'client/index.js')).href);
const {StdioClientTransport}=await import(pathToFileURL(path.join(dep,'client/stdio.js')).href);
const work=await fs.mkdtemp(path.join(os.tmpdir(),'hub-search-functional-')),fixture=await createSearchFixture();
const env={SC_DATA_DIR:work};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'])if(process.env[key])env[key]=process.env[key];
env.HOME=work;env.USERPROFILE=work;
await fs.writeFile(path.join(work,'config.json'),JSON.stringify({engines:['searxng'],keySlots:'off',searxng:{baseUrl:fixture.url,instances:[]},timeoutMs:3000,softDeadlineMs:3000,earlyHarvestMs:0}));
const client=new Client({name:'agents-hub-search-probe',version:'2.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/servers/search-core/typescript/dist/mcp.js')],cwd:work,stderr:'pipe',env});
let stderr='';transport.stderr?.on('data',chunk=>stderr+=chunk.toString());
function payload(result){assert.notEqual(result.isError,true);const text=result.content.find(block=>block.type==='text')?.text;assert.ok(text);return JSON.parse(text);}
try{
 await client.connect(transport);const listed=await client.listTools();assert.ok(listed.tools.some(t=>t.name==='search'));
 const first=payload(await client.callTool({name:'search',arguments:{query:'aurora glacier',engines:['searxng'],top_n:3}}));assert.equal(first.refs.length,1);assert.match(first.refs[0].snippet,/DSH-SEARCH-FIXTURE/);assert.equal(first.meta.from_cache,false);assert.deepEqual(first.meta.engines_used,['searxng']);
 const second=payload(await client.callTool({name:'search',arguments:{query:'aurora glacier',engines:['searxng'],top_n:3}}));assert.equal(second.meta.from_cache,true);assert.equal(fixture.requests.length,1);
 const routed=payload(await client.callTool({name:'search',arguments:{query:'Node SQLite python documentation',engines:['searxng'],no_cache:true}}));assert.deepEqual(routed.meta.engine_selection,{mode:'explicit',requested:['searxng']});assert.deepEqual(routed.meta.engines_used,['searxng']);
 const beforeEmpty=fixture.requests.length;const empty=payload(await client.callTool({name:'search',arguments:{query:'github repository',engines:[]}}));assert.deepEqual(empty.refs,[]);assert.equal(fixture.requests.length,beforeEmpty);
 const unknown=await client.callTool({name:'search',arguments:{query:'query',engines:['not-registered']}});assert.equal(unknown.isError,true);assert.equal(fixture.requests.length,beforeEmpty);
 const failed=payload(await client.callTool({name:'search',arguments:{query:'fixture invalid',engines:['searxng'],no_cache:true}}));assert.equal(failed.refs.length,0);assert.equal(failed.meta.degraded,true);assert.ok(failed.meta.engines_failed.some(e=>e.name==='searxng'));
 await fs.access(path.join(work,'cache.db'));
 const report={status:'PASS',explicit_engine_selection:{domain_query:true,empty_list_no_requests:true,unknown_engine_no_requests:true,requested:['searxng']},protocol:'Real MCP initialize, search query, cached repeat and failed provider',tools:listed.tools.map(t=>t.name),provider_requests:fixture.requests,cache_isolated:true,scope:'Local SearXNG-compatible HTTP fixture with real search pipeline; no public-source availability or paid-account claims.'};
 await fs.mkdir(path.join(root,'.asset-state/evidence'),{recursive:true});await fs.writeFile(path.join(root,'.asset-state/evidence/search-functional.json'),JSON.stringify(report,null,2)+String.fromCharCode(10));console.log(JSON.stringify(report,null,2));
}finally{await client.close();await fixture.close();await fs.rm(work,{recursive:true,force:true});}
