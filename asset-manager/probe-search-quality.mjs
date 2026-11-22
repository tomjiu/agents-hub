import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
if(!process.argv.includes('--live'))throw new Error('Explicit --live required; public queries only, no user credentials/config.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sdk=path.join(root,'mcp/servers/search-core/typescript/node_modules/@modelcontextprotocol/sdk/dist/esm');
const {Client}=await import(pathToFileURL(path.join(sdk,'client/index.js')).href);
const {StdioClientTransport}=await import(pathToFileURL(path.join(sdk,'client/stdio.js')).href);
const work=await fs.mkdtemp(path.join(os.tmpdir(),'hub-quality-live-'));
const env={HOME:work,USERPROFILE:work,SC_DATA_DIR:work,SC_MCP_DISCLOSURE:'static'};for(const k of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'])if(process.env[k])env[k]=process.env[k];
const client=new Client({name:'hub-search-quality',version:'1'});let stderr='';const rows=[];
try{
 await fs.writeFile(path.join(work,'config.json'),JSON.stringify({keySlots:'off',engines:['bingrss','keenable','mdn'],timeoutMs:8000,softDeadlineMs:10000,earlyHarvestMs:0,ssrf:'strict'}));
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/servers/search-core/typescript/dist/mcp.js')],cwd:work,env,stderr:'pipe'});transport.stderr?.on('data',b=>{stderr=(stderr+b.toString()).slice(-8000);});await client.connect(transport);
 for(const [name,args] of [
 ['search',{query:'Node.js node:sqlite DatabaseSync stability synchronous Node 22 26 official documentation',engines:['bingrss','keenable','mdn'],top_n:5,no_cache:true}],
 ['search',{query:'SQLite WAL concurrency',engines:['bingrss','keenable'],top_n:5,no_cache:true}],
 ['search',{query:'Node SQLite DatabaseSync',top_n:5,no_cache:true}],
 ['fetch',{url:'https://nodejs.org/docs/v26.13.1/api/sqlite.html',focus:'DatabaseSync synchronous',max_chars:8000,no_cache:true}],
 ['fetch',{url:'https://www.sqlite.org/wal.html',focus:'one writer concurrency',max_chars:8000,no_cache:true}]
 ]){const start=Date.now();try{const r=await client.callTool({name,arguments:args},undefined,{timeout:45000});const text=r.content?.find(c=>c.type==='text')?.text;let payload;try{payload=JSON.parse(text);}catch{payload=text;}rows.push({name,args,elapsed_ms:Date.now()-start,isError:!!r.isError,payload});}catch(e){rows.push({name,args,elapsed_ms:Date.now()-start,error:e.message});}console.log(JSON.stringify(rows.at(-1),null,2));}
}finally{try{await client.close();}finally{try{await fs.mkdir(path.join(root,'.asset-state/evidence'),{recursive:true});await fs.writeFile(path.join(root,'.asset-state/evidence/search-quality-live.json'),JSON.stringify({real_network:true,scripted_model:false,credentials_used:false,config_isolated:true,quality_not_automatically_certified:true,rows,stderr},null,2)+'\n');}finally{await fs.rm(work,{recursive:true,force:true});}}}
