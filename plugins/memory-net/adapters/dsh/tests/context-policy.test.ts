import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {resolveBinding,guardScopeDirectory,assemblyAgent} from '../src/context.js'
import {resolveConfig} from '../src/config.js'
import {apply} from '../src/index.js'
test('context modes and missing services fail closed without creating a shared library',()=>{
 assert.equal(resolveConfig().context.mode,'session');assert.equal(resolveConfig({context:{mode:'shared'}}).context.mode,'shared');assert.throws(()=>resolveConfig({context:{mode:'bad'}}),/context/)
 const tools:any[]=[],sections:any[]=[],ctx:any={provide:()=>{},tools:{register:(d:any)=>tools.push(d)},systemPrompt:{section:(d:any)=>sections.push(d)}}
 const api=apply(ctx,{workspaces_root:path.join(os.tmpdir(),'mn-missing-'+Date.now())})!
 try {assert.throws(()=>tools[0].execute({},{}),/context/);assert.equal(sections[0].text({}),'');assert.equal(fs.existsSync(api.workspaceDir),false);assert.equal((api as any)[Symbol.iterator],undefined);assert.equal((api as any).then,undefined)}finally{api.close()}
})
test('canonical project aliases share scope but planted database symlinks cannot select another library',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mn-canonical-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const project=path.join(root,'project'),alias=path.join(root,'alias');fs.mkdirSync(project);fs.symlinkSync(project,alias,'junction');let cwd=project
 const agent={id:'A',session:{id:'A',header:{id:'A'}}},ctx:any={agents:{get:()=>agent},workingDirectory:{get:()=>cwd}},cfg=resolveConfig({workspaces_root:path.join(root,'memory')})
 const a=resolveBinding(ctx,cfg,agent);cwd=alias;assert.equal(resolveBinding(ctx,cfg,agent).scopeId,a.scopeId);fs.mkdirSync(a.dir,{recursive:true});guardScopeDirectory(cfg,a.dir)
 const target=path.join(a.dir,'memory.db'),original=fs.lstatSync;
 const mock=t.mock.method(fs,'lstatSync',((p:any,...args:any[])=>String(p)===target?{isSymbolicLink:()=>true}:(original as any)(p,...args)) as any);
 assert.throws(()=>guardScopeDirectory(cfg,a.dir),/symlink/);mock.mock.restore()
 // Windows file symlinks require privileges. Directory junctions are tested physically above; file-link rejection is an injected stat fixture.
 assert.throws(()=>resolveBinding(ctx,cfg,{...agent}),/stale|Unregistered/);assert.throws(()=>assemblyAgent({agent,scope:{...agent}}),/mismatch/);assert.throws(()=>resolveBinding(ctx,cfg,agent,AbortSignal.abort()),/abort/i)
})
