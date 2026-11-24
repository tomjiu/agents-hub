/** Trusted host context only. Model input never selects a physical scope. */
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import type {DshCtx} from './contract.js'
import type {AdapterConfig} from './config.js'
export interface MemoryBinding {dir:string;sessionId:string;project:string;scopeId:string}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex')
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'?v as Record<string,unknown>:{}
export function resolveBinding(ctx:DshCtx,cfg:AdapterConfig,agent:unknown,signal?:AbortSignal):MemoryBinding {
 signal?.throwIfAborted()
 const a=object(agent),session=object(a.session),header=object(session.header)
 if(typeof a.id!=='string'||!a.id||a.id.length>512||session.id!==a.id||header.id!==a.id)throw new Error('Trusted memory agent context required')
 if(!ctx.agents||typeof ctx.agents.get!=='function'||ctx.agents.get(a.id)!==agent)throw new Error('Unregistered or stale memory agent context')
 if(!ctx.workingDirectory||typeof ctx.workingDirectory.get!=='function')throw new Error('Memory project context unavailable')
 const cwd=ctx.workingDirectory.get(session)
 if(typeof cwd!=='string'||!path.isAbsolute(cwd))throw new Error('Absolute memory project context required')
 let project=fs.realpathSync(cwd)
 if(!fs.statSync(project).isDirectory())throw new Error('Memory project context is not a directory')
 if(process.platform==='win32')project=project.toLowerCase()
 const scopeId=sha(JSON.stringify([project,a.id]))
 return {dir:path.join(cfg.workspaces_root,'scoped-v1','p-'+sha(project),'s-'+sha(a.id)),sessionId:a.id,project,scopeId}
}
export function assemblyAgent(context:unknown):unknown {
 const c=object(context)
 if(!c.agent||c.scope!==c.agent)throw new Error('Memory assembly agent/scope context mismatch')
 return c.agent
}
export function rejectSelectors(args:Record<string,unknown>):void {
 for(const key of ['workspace','run_id','task_id','agent','session_id','project'])if(Object.hasOwn(args,key))throw new Error('Model memory scope selectors forbidden: '+key)
}
/** Reject planted aliases beneath the configured root; no OS-level confidentiality is claimed. */
export function guardScopeDirectory(cfg:AdapterConfig,dir:string):void {
 const relative=path.relative(path.resolve(cfg.workspaces_root),path.resolve(dir))
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Memory context directory escaped root')
 let current=path.resolve(cfg.workspaces_root)
 for(const part of relative.split(path.sep)) {
  current=path.join(current,part)
  try {if(fs.lstatSync(current).isSymbolicLink())throw new Error('Memory scope symlink forbidden')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
 }
 for(const filename of ['memory.db','memory.db-wal','memory.db-shm']) {
  try {if(fs.lstatSync(path.join(dir,filename)).isSymbolicLink())throw new Error('Memory database symlink forbidden')}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
 }
}
