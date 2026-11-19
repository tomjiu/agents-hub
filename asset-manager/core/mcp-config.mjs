import path from 'node:path';
import YAML from 'yaml';
import {stringify} from 'smol-toml';
import {confined,createJson} from './files.mjs';
import {validateLaunch} from '../mcp-launcher.mjs';

export async function clientMcpConfig(root,view,client,servers){
 const config={};
 for(const [id,s] of Object.entries(servers)){
  if(!/^[a-zA-Z0-9_-]{1,32}$/.test(id)||['__proto__','constructor','prototype'].includes(id))throw new Error('Invalid MCP server name '+id);
  if(s.required_env!==undefined&&(!Array.isArray(s.required_env)||s.required_env.some(x=>typeof x!=='string'||!/^[_A-Z][_A-Z0-9]*$/.test(x))))throw new Error('Invalid required environment names');
  if(client==='dsh'&&s.required_env?.length)throw new Error('DSH credential environment mapping requires reviewed adapter: '+id);
  if(s.url){const url=new URL(s.url);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('Remote MCP requires credential-free HTTPS URL');if(s.required_env?.length)throw new Error('Remote MCP authentication mapping requires reviewed adapter: '+id);
   config[id]=client==='opencode'?{type:'remote',url:s.url,enabled:true}:client==='dsh'?{transport:'streamable-http',serverName:id,url:s.url}:{url:s.url};
  }else{
   if(!s.command||!Array.isArray(s.args))throw new Error('Incomplete MCP launch configuration');
   if(client==='opencode'){
    const spec=validateLaunch({schema:1,command:s.command,args:s.args,cwd:s.cwd||root,required_env:s.required_env||[],forward_env:s.required_env||[]});
    const rel='launch/'+id+'.json';await createJson(path.join(view,rel),spec);
    const launcher=await confined(root,'asset-manager/mcp-launcher.mjs');
    config[id]={type:'local',command:[process.execPath,launcher,path.join(view,rel)],enabled:true};
   }else if(client==='dsh')config[id]={transport:'stdio',serverName:id,command:s.command,args:s.args,cwd:s.cwd||root,failOnStartupError:true,...id==='search-core'?{env:{SC_MCP_DISCLOSURE:'static'}}:{}};
   else config[id]={command:s.command,args:s.args,cwd:s.cwd||root,...s.required_env?.length?{env_vars:s.required_env}:{}};
  }
 }
 return config;
}
export function encodeClientConfig(client,config){
 if(client==='codex')return stringify({mcp_servers:config}).trimEnd()+String.fromCharCode(10);
 if(client==='opencode')return JSON.stringify({mcp:config},null,2)+String.fromCharCode(10);
 if(client==='dsh')return YAML.stringify([{insert:Object.entries(config).map(([id,value])=>({id:'agents-hub-mcp-'+id,name:'@deepseek-ai/dsh-mcp-client',config:value}))}]);
 throw new Error('Unsupported MCP configuration client');
}
