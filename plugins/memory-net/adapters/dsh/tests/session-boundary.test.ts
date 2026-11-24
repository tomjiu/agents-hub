import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readdirSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {apply} from '../src/index.js'
import type {DshCtx,ToolDef,SectionDef} from '../src/contract.js'
function fixture(t:any){
 const root=mkdtempSync(join(tmpdir(),'mn-session-'));const projectA=join(root,'project-a'),projectB=join(root,'project-b');mkdirSync(projectA);mkdirSync(projectB)
 const agents=new Map(),cwd=new Map(),tools:ToolDef[]=[],sections:SectionDef[]=[],events=new Map<string,Function[]>(),warns:string[]=[]
 const ctx:any={provide:()=>{},agents:{get:(id:string)=>agents.get(id)},workingDirectory:{get:(s:any)=>cwd.get(s.id)},tools:{register:(d:ToolDef)=>tools.push(d)},systemPrompt:{section:()=>{},context:(d:SectionDef)=>sections.push(d)},logger:{warn:(s:string)=>warns.push(s)},on:(name:string,fn:Function)=>events.set(name,[...(events.get(name)||[]),fn])}
 const agent=(id:string,project:string)=>{const a={id,session:{id,header:{id,cwd:project}}};agents.set(id,a);cwd.set(id,project);return a}
 const a=agent('session-A',projectA),b=agent('session-B',projectA),c=agent('session-C',projectB)
 const api=apply(ctx,{workspaces_root:join(root,'memory'),default_workspace:'main'}) as any
 t.after(()=>{api?.close();rmSync(root,{recursive:true,force:true})});assert.ok(api)
 const tool=(name:string)=>tools.find(d=>d.name===name) as any
 const prompt=(a:any,scope:any=a)=>typeof sections[0]!.text==='function'?sections[0]!.text({agent:a,scope}):sections[0]!.text
 const start=(a:any,text:string)=>{const exec={name:'read',token:Symbol(text),callId:text,agent:a,arguments:{workspace:'victim'}};for(const fn of events.get('tools/pre-execute')||[])fn(exec,()=>Promise.resolve({}));return exec}
 const finish=(exec:any,text:string)=>{for(const fn of events.get('tools/result')||[])fn(exec,{value:text})}
 const emit=(a:any,text:string)=>finish(start(a,text),text)
 return {root,ctx,api,a,b,c,agent,cwd,agents,tool,prompt,emit,start,finish,warns}
}
test('diagnostic logger failure cannot prevent host tool admission',t=>{
 const f=fixture(t);f.ctx.logger.warn=()=>{throw new Error('logger offline')}
 assert.doesNotThrow(()=>f.start(undefined,'unknown owner'))
})

test('default mode isolates project/session writes prompt and raw; no default library opened',t=>{
 const f=fixture(t);assert.ok(!readdirSync(f.root).includes('memory'),'startup cannot touch existing user default DB')
 const write=f.tool('memory_net_write'),recall=f.tool('memory_net_recall')
 const sa=write.execute({kind:'tip',text:'PRIVATE-SESSION-A'},{agent:f.a}),sb=write.execute({kind:'tip',text:'PRIVATE-SESSION-B'},{agent:f.b})
 assert.ok(f.prompt(f.a).includes('PRIVATE-SESSION-A'));assert.ok(!f.prompt(f.a).includes('PRIVATE-SESSION-B'));assert.ok(!f.prompt(f.c).includes('PRIVATE-SESSION-A'))
 f.emit(f.a,'AUTO-A');f.emit(f.b,'AUTO-B');const raw=recall.execute({view:'raw'},{agent:f.a}).text
 assert.ok(raw.includes('AUTO-A'));assert.ok(!raw.includes('AUTO-B'));assert.ok(!f.prompt(f.a).includes('AUTO-A'))
 assert.equal(sa.workspace,'current');assert.equal(sb.workspace,'current');assert.throws(()=>f.api.exportPkg(),/agent|context/i)
 const bound=f.api.forAgent(f.a);bound.updateProgress(f.a.id,{summary:'session context progress'});assert.ok(f.prompt(f.a).includes('session context progress'));assert.ok(!f.prompt(f.b).includes('session context progress'))
 assert.ok(bound.exportPkg().nodes.every((n:any)=>n.run_id===f.a.id || n.kind==='progress'))
})
test('model selectors missing identity and copied agent handles fail closed',t=>{
 const f=fixture(t),write=f.tool('memory_net_write'),recall=f.tool('memory_net_recall');
 for(const k of ['workspace','run_id','task_id'])assert.throws(()=>write.execute({kind:'tip',text:'forged',[k]:'victim'},{agent:f.a}),/scope|context|selector/i)
 for(const k of ['workspace','run_id','task_id'])assert.throws(()=>recall.execute({view:'raw',[k]:'victim'},{agent:f.a}),/scope|context|selector/i)
 assert.throws(()=>write.execute({kind:'tip',text:'missing'}),/agent|context/i)
 assert.throws(()=>recall.execute({},{agent:{...f.a}}),/agent|context/i)
 assert.match(f.prompt(f.a,f.b),/unavailable/);assert.match(f.prompt(undefined),/unavailable/);f.emit(undefined,'unowned');assert.ok(f.warns.length)
 assert.throws(()=>write.execute({kind:'tip',text:'canceled'},{agent:f.a,signal:AbortSignal.abort()}),/abort|cancel/i)
 assert.equal(f.api.forAgent(f.a).exportPkg().nodes.length,0)
 assert.ok(!Object.hasOwn(write.parameters.properties,'workspace'));assert.ok(!Object.hasOwn(recall.parameters.properties,'run_id'))
})
test('directory changes and resume resolve stable scopes without sharing agent-global mutable state',async t=>{
 const f=fixture(t),write=f.tool('memory_net_write');write.execute({kind:'tip',text:'A-original'},{agent:f.a});const held=f.api.forAgent(f.a)
 const pending=f.start(f.a,'original-project')
 f.cwd.set(f.a.id,f.cwd.get(f.c.id));f.finish(pending,'RESULT-ORIGINAL-PROJECT');assert.throws(()=>held.addTip({text:'stale write'}),/context|changed/i)
 assert.ok(!f.prompt(f.a).includes('A-original'));write.execute({kind:'tip',text:'A-other-project'},{agent:f.a})
 f.cwd.set(f.a.id,f.a.session.header.cwd);const resumed=f.agent(f.a.id,f.a.session.header.cwd);assert.ok(f.prompt(resumed).includes('A-original'));assert.ok(f.api.forAgent(resumed).exportPkg().nodes.some((n:any)=>n.text.includes('RESULT-ORIGINAL-PROJECT')));assert.ok(!f.prompt(resumed).includes('A-other-project'))
 assert.throws(()=>f.api.forAgent(f.a),/agent|context/i)
 await Promise.all([Promise.resolve().then(()=>f.emit(resumed,'A-parallel')),Promise.resolve().then(()=>f.emit(f.b,'B-parallel'))])
 assert.ok(!f.api.forAgent(resumed).exportPkg().nodes.some((n:any)=>n.text.includes('B-parallel')))
 f.api.close();assert.throws(()=>write.execute({kind:'tip',text:'closed'},{agent:resumed}),/closed/)
})
