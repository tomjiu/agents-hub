import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export function validateLaunch(spec){
 if(spec?.schema!==1||typeof spec.command!=='string'||!spec.command||!Array.isArray(spec.args)||spec.args.some(x=>typeof x!=='string')||typeof spec.cwd!=='string'||!path.isAbsolute(spec.cwd))throw new Error('Invalid MCP launch descriptor');
 for(const key of ['required_env','forward_env'])if(spec[key]!==undefined&&(!Array.isArray(spec[key])||spec[key].some(x=>typeof x!=='string'||!/^[_A-Z][_A-Z0-9]*$/.test(x))))throw new Error('Invalid environment-name list');
 if([...spec.command].some(c=>[0,10,13].includes(c.charCodeAt(0)))||spec.args.some(x=>x.includes(String.fromCharCode(0))))throw new Error('Invalid executable argument');
 return spec;
}
export function childEnv(spec,parent){
 const env={};
 for(const [key,value] of Object.entries(parent))if(value!==undefined&&!/token|secret|password|credential|api_?key/i.test(key)&&!key.startsWith('DSH_'))env[key]=value;
 for(const key of spec.forward_env||[])if(parent[key]!==undefined)env[key]=parent[key];
 for(const key of spec.required_env||[])if(!env[key])throw new Error('Required environment variable missing: '+key);
 return env;
}
export async function launch(file){
 const spec=validateLaunch(JSON.parse(await fs.readFile(file,'utf8')));
 const child=spawn(spec.command,spec.args,{cwd:spec.cwd,env:childEnv(spec,process.env),stdio:'inherit',shell:false});
 const stop=()=>{if(child.exitCode===null&&!child.killed)child.kill('SIGTERM');};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 return await new Promise((resolve,reject)=>{
  child.once('error',reject);child.once('exit',(code,signal)=>resolve({code:code??1,signal}));
 }).finally(()=>{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try{if(!process.argv[2])throw new Error('Provide a reviewed launch descriptor');const result=await launch(process.argv[2]);process.exitCode=result.code;}catch(e){console.error(e.message);process.exitCode=1;}
}
