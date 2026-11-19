import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import YAML from 'yaml';
import {parse} from 'smol-toml';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dep=path.join(root,'mcp/servers/search-core/typescript/node_modules/@modelcontextprotocol/sdk/dist/esm');
const {Client}=await import(pathToFileURL(path.join(dep,'client/index.js')).href);
const {StdioClientTransport}=await import(pathToFileURL(path.join(dep,'client/stdio.js')).href);
const work=await fs.mkdtemp(path.join(os.tmpdir(),'hub-mcp-actual-'));
const reports=[],owned=[];
const isolatedEnv={HOME:work,USERPROFILE:work};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'])if(process.env[key])isolatedEnv[key]=process.env[key];
const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[path.join(root,'asset-manager/cli.mjs'),...args],{cwd:root,maxBuffer:4*1024*1024}).toString());
try{
 for(const kind of ['opencode','codex','dsh']){
  const project=path.join(work,kind);await fs.mkdir(project);await fs.writeFile(path.join(project,'AGENTS.md'),'Keep existing consumer rules');
  if(kind==='opencode')await fs.writeFile(path.join(project,'opencode.json'),'{}');
  if(kind==='codex'){await fs.mkdir(path.join(project,'.codex'));await fs.writeFile(path.join(project,'.codex/config.toml'),'# User configuration'+String.fromCharCode(10));}
  const plan=cli('plan-mcp',kind,project,'--expert','research');owned.push(plan);
  assert.equal(plan.approval,false);assert.equal(cli('inspect-mcp',plan.id).status,'PREPARED');
  const applied=cli('apply-mcp',plan.id,'--approve');assert.equal(applied.status,'APPLIED');
  const text=await fs.readFile(path.join(project,applied.path),'utf8');let command,args,cwd;
  if(kind==='opencode'){const cfg=JSON.parse(text).mcp['search-core'];[command,...args]=cfg.command;cwd=project;}
  if(kind==='codex'){const cfg=parse(text).mcp_servers['search-core'];({command,args,cwd}=cfg);}
  if(kind==='dsh'){const cfg=YAML.parse(text)[0].insert[0].config;({command,args,cwd}=cfg);assert.equal(cfg.transport,'stdio');assert.equal(cfg.serverName,'search-core');
   if(process.env.HUB_DSH_MCP_CLIENT){const {Config}=await import(pathToFileURL(path.resolve(process.env.HUB_DSH_MCP_CLIENT)).href);const checked=Config(cfg);assert.equal(checked.transport,'stdio');assert.equal(checked.serverName,'search-core');}
  }
  const client=new Client({name:'agents-hub-config-probe',version:'2.0.0'});const transport=new StdioClientTransport({command,args,cwd,stderr:'pipe',env:{...isolatedEnv,SC_DATA_DIR:path.join(work,'cache-'+kind)}});
  try{
   await client.connect(transport);const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='tool_search'));
   const call=await client.callTool({name:'tool_search',arguments:{query:'engine health',limit:1}});assert.notEqual(call.isError,true);assert.ok(call.content.some(c=>c.type==='text'&&c.text.includes('matches')));
   reports.push({client_config:kind,checks:['CLI plan/apply/inspect','MCP initialize','tools/list','tool_search local call','Byte-protected rollback'],initial_tools:tools.tools.map(t=>t.name),dsh_schema:kind==='dsh'?(process.env.HUB_DSH_MCP_CLIENT?'installed Config verified':'not checked'):'not applicable'});
  }finally{await client.close();}
  const rolled=cli('rollback-mcp',plan.id,'--approve');assert.equal(rolled.status,'ROLLED_BACK');assert.equal(await fs.readFile(path.join(project,'AGENTS.md'),'utf8'),'Keep existing consumer rules');
 }
 const report={status:'PASS',results:reports,scope:'Actual CLI-generated configs start real MCP and execute a local discovery call via standard SDK; not actual Codex/OpenCode host loading or live DSH plugin installation. No external search or account API called.'};
 await fs.mkdir(path.join(root,'.asset-state/evidence'),{recursive:true});await fs.writeFile(path.join(root,'.asset-state/evidence/mcp-config-probe.json'),JSON.stringify(report,null,2)+String.fromCharCode(10));console.log(JSON.stringify(report,null,2));
}finally{
 for(const plan of owned){await fs.rm(path.dirname(plan.candidate),{recursive:true,force:true});await fs.rm(plan.view_path,{recursive:true,force:true});}
 await fs.rm(work,{recursive:true,force:true});
}
