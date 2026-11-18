import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dep=path.join(root,'mcp/servers/search-core/typescript/node_modules/@modelcontextprotocol/sdk/dist/esm');
const {Client}=await import(pathToFileURL(path.join(dep,'client/index.js')).href);
const {StdioClientTransport}=await import(pathToFileURL(path.join(dep,'client/stdio.js')).href);
const client=new Client({name:'agents-hub-migration-probe',version:'2.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/servers/search-core/typescript/dist/mcp.js')],stderr:'pipe',env:{...process.env,SC_HOME:path.join(root,'.asset-state/probe-search')}});
let stderr='';transport.stderr?.on('data',x=>stderr+=x.toString());
try{await client.connect(transport);const result=await client.listTools();assert.ok(result.tools.length>0);assert.ok(result.tools.some(t=>t.name.includes('search')));console.log(JSON.stringify({status:'PASS',protocol:'MCP stdio initialize + tools/list',tools:result.tools.map(t=>t.name),scope:'Real server process; no search calls, credentials or external API requests'}));}
finally{await client.close();}
