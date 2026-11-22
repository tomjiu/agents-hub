import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {lookup} from 'node:dns/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
if(!process.argv.includes('--live'))throw new Error('Explicit --live required: uses explicitly trusted local TUN for public official URLs; changes no Clash config.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sdk=path.join(root,'mcp/servers/search-core/typescript/node_modules/@modelcontextprotocol/sdk/dist/esm');
const {Client}=await import(pathToFileURL(path.join(sdk,'client/index.js')).href);
const {StdioClientTransport}=await import(pathToFileURL(path.join(sdk,'client/stdio.js')).href);
const work=await fs.mkdtemp(path.join(os.tmpdir(),'hub-tun-live-')),rows=[],dns=[];let client;
const env={HOME:work,USERPROFILE:work,SC_DATA_DIR:work,SC_MCP_DISCLOSURE:'static'};for(const k of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'])if(process.env[k])env[k]=process.env[k];
const sources=[{url:'https://nodejs.org/docs/v26.13.1/api/sqlite.html',focus:'DatabaseSync deprecated alias synchronous',expected:['DatabaseSync','deprecated']},{url:'https://www.sqlite.org/wal.html',focus:'only one writer concurrency',expected:['writer','WAL']}];
let status='FAIL';
try{
 for(const source of sources)dns.push({host:new URL(source.url).hostname,answers:await lookup(new URL(source.url).hostname,{all:true})});
 for(const mode of ['strict','trusted-tun']){
  await fs.writeFile(path.join(work,'config.json'),JSON.stringify({keySlots:'off',fetchNetworkMode:mode,fakeIpCidrs:['198.18.0.0/15'],ssrf:'strict'}));
  client=new Client({name:'hub-tun-probe',version:'1'});const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/servers/search-core/typescript/dist/mcp.js')],cwd:work,env,stderr:'pipe'});transport.stderr?.on('data',()=>{});await client.connect(transport);
  for(const source of sources){const start=Date.now(),args={url:source.url,focus:source.focus,max_chars:20000};const response=await client.callTool({name:'fetch',arguments:args},undefined,{timeout:60000});let payload;const text=response.content.find(c=>c.type==='text')?.text;try{payload=JSON.parse(text);}catch{payload=text;}const row={mode,url:source.url,elapsed_ms:Date.now()-start,isError:!!response.isError,payload};rows.push(row);
   if(mode==='strict'){assert.equal(response.isError,true);assert.match(String(payload),/private address blocked/);}else{assert.notEqual(response.isError,true);assert.equal(payload.transport.mode,mode);assert.equal(payload.transport.remoteIpVerified,false);assert.equal(payload.from_cache,false);const body=JSON.stringify(payload.segments??payload.text);for(const term of source.expected)assert.ok(body.toLowerCase().includes(term.toLowerCase()),'Missing actual source evidence '+term);
    const repeat=await client.callTool({name:'fetch',arguments:args},undefined,{timeout:10000});const cached=JSON.parse(repeat.content.find(c=>c.type==='text').text);assert.equal(cached.from_cache,true);assert.deepEqual(cached.segments??cached.text,payload.segments??payload.text);row.cache_verified=true;
   }console.log(JSON.stringify(row,null,2));
  }
  await client.close();client=null;
 }
 status='PASS_FOR_CURRENT_TRUSTED_TUN_OFFICIAL_FETCH';
}finally{try{await client?.close();}finally{try{await fs.mkdir(path.join(root,'.asset-state/evidence'),{recursive:true});await fs.writeFile(path.join(root,'.asset-state/evidence/tun-fetch-live.json'),JSON.stringify({status,dns,rows,credentials_used:false,clash_config_changed:false,live_dsh_changed:false,remote_proxy_ip_verified:false,scope:'Actual domain URL fetch under current local trusted TUN. TLS defaults retained; no packet-capture proof or remote IP SSRF guarantee.'},null,2)+'\n');}finally{await fs.rm(work,{recursive:true,force:true});}}}
