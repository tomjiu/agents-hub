import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {ToolListChangedNotificationSchema} from '@modelcontextprotocol/sdk/types.js';
import {SearchCore} from '../engine.js';
import {createSearchMcpServer,disclosureMode,type McpDisclosure} from '../mcp.js';

async function setup(mode: McpDisclosure) {
 const dir=await mkdtemp(join(tmpdir(),'search-mcp-disclosure-'));
 const core=new SearchCore({config:{dataDir:dir,engines:['searxng'],keySlots:'off',searxng:{baseUrl:'https://fixture.example',instances:[]}},fetchImpl:async()=>new Response(JSON.stringify({results:[{url:'https://fixture.example/aurora',title:'Aurora glacier',content:'fixture reference'}]}),{headers:{'content-type':'application/json'}})});
 const server=createSearchMcpServer(core,mode),client=new Client({name:'disclosure-test',version:'1'});
 let changes=0;client.setNotificationHandler(ToolListChangedNotificationSchema,async()=>{changes++;});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 return {client,changes:()=>changes,close:async()=>{await client.close();await server.close();core.cache.close();await rm(dir,{recursive:true,force:true});}};
}
function content(result: any){assert.notEqual(result.isError,true);return JSON.parse(result.content.find((item: any)=>item.type==='text').text);}
test('static disclosure exposes all real tools before discovery and never emits list changes',async()=>{
 const h=await setup('static');try{
  const before=await h.client.listTools();assert.equal(before.tools.length,8);assert.ok(before.tools.some(t=>t.name==='search_providers'));
  const result=content(await h.client.callTool({name:'tool_search',arguments:{query:'engine health',limit:1}}));assert.equal(result.disclosure,'static');assert.deepEqual(result.newly_activated,[]);assert.ok(result.matches.length);assert.equal(h.changes(),0);
  assert.deepEqual((await h.client.listTools()).tools.map(t=>t.name),before.tools.map(t=>t.name));
  assert.ok(content(await h.client.callTool({name:'search_providers',arguments:{}})).providers.length>0);
 }finally{await h.close();}
});
test('parallel static discovery and search return actual results with a stable tool list',async()=>{
 const h=await setup('static');try{
  const results=await Promise.all([h.client.callTool({name:'tool_search',arguments:{query:'engine health',limit:1}}),h.client.callTool({name:'search',arguments:{query:'aurora glacier',engines:['searxng']}})]);
  assert.equal(content(results[0]).disclosure,'static');assert.equal(content(results[1]).refs[0].title,'Aurora glacier');assert.equal(h.changes(),0);
 }finally{await h.close();}
});
test('dynamic default still progressively registers matched capabilities and notifies once',async()=>{
 const h=await setup('dynamic');try{
  assert.equal((await h.client.listTools()).tools.length,3);
  const result=content(await h.client.callTool({name:'tool_search',arguments:{query:'engine health',limit:1}}));assert.equal(result.disclosure,'dynamic');assert.equal(result.newly_activated.length,1);assert.equal((await h.client.listTools()).tools.length,4);assert.ok(h.changes()>0);
  const notifications=h.changes();const second=content(await h.client.callTool({name:'tool_search',arguments:{query:'engine health',limit:1}}));assert.deepEqual(second.newly_activated,[]);assert.equal(h.changes(),notifications);
 }finally{await h.close();}
});
test('invalid mode is rejected rather than silently falling back to unsafe host behavior',()=>{
 assert.equal(disclosureMode(undefined),'dynamic');assert.equal(disclosureMode('static'),'static');assert.equal(disclosureMode('dynamic'),'dynamic');assert.throws(()=>disclosureMode('invalid'),/must be/);
});
