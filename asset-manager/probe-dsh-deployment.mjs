import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {planDeployment,deployProfile,uninstallDeployment,inspectDeployment} from './core/deployment.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const entry=process.env.HUB_DSH_SKILL_PROVIDER;
if(!entry)throw new Error('Set HUB_DSH_SKILL_PROVIDER to installed dsh-skill-filesystem/lib/index.js.');
const {FileSystemSkillProvider}=await import(pathToFileURL(path.resolve(entry)).href);
const work=await fs.mkdtemp(path.join(os.tmpdir(),'hub-project-deploy-'));
const project=path.join(work,'project');await fs.mkdir(project);await fs.mkdir(path.join(project,'.git'));
await fs.writeFile(path.join(project,'AGENTS.md'),'Project-owned rules must survive deployment.');
const ac=new AbortController(),warnings=[];let provider;
try {
 const before=await planDeployment(root,'dsh',project);assert.equal(before.conflicts.length,0);assert.deepEqual((await fs.readdir(project)).sort(),['.git','AGENTS.md']);
 const receipt=await deployProfile(root,'dsh',project,{approved:true});assert.equal(receipt.status,'INSTALLED');
 const dshHome=path.join(work,'isolated-dsh-home'),agentsHome=path.join(work,'isolated-agents-home');await fs.mkdir(dshHome);await fs.mkdir(agentsHome);
 provider=new FileSystemSkillProvider({get:()=>undefined,logger:{warn:x=>warnings.push(x)}},{signal:ac.signal,invalidate:()=>{}},{includeDefaultRoots:true,dshHome,agentsHome,customSkillDirs:[],watch:false});
 const result=await provider.list({cwd:project});const candidates=Array.isArray(result)?result:result.candidates;
 const loaded=[];for(const candidate of candidates){const skill=await provider.get(candidate,{cwd:project});assert.ok(skill.content);loaded.push(skill.name);}
 assert.deepEqual(loaded.sort(),receipt.skills.map(s=>s.name).sort());assert.equal(warnings.length,0);
 const first=path.join(project,receipt.skills[0].path,'SKILL.md');const original=await fs.readFile(first,'utf8');await fs.appendFile(first,'\nConsumer edit');
 await assert.rejects(uninstallDeployment(root,project,receipt.id,{approved:true}),/Local changes/);assert.ok((await fs.readFile(first,'utf8')).includes('Consumer edit'));
 await fs.writeFile(first,original);const removed=await uninstallDeployment(root,project,receipt.id,{approved:true});assert.equal(removed.status,'REMOVED');
 const afterResult=await provider.list({cwd:project});const after=Array.isArray(afterResult)?afterResult:afterResult.candidates;assert.equal(after.length,0);
 assert.equal(await fs.readFile(path.join(project,'AGENTS.md'),'utf8'),'Project-owned rules must survive deployment.');
 const status=await inspectDeployment(root,project,receipt.id);assert.equal(status.status,'REMOVED');
 const report={status:'PASS',skills:loaded,discovered_through:'.dsh/skills project default root, no custom path',user_config_modified:false,checks:['Read-only preview','Approved installation','Native DSH list/get','Local-edit uninstall rejection','Quarantined uninstall','Native discovery empty after uninstall','Existing project rules preserved'],scope:'Installed DSH filesystem provider in isolated context; not running user profile or plugin installation.'};
 const output=path.join(root,'.asset-state/evidence/dsh-project-deployment.json');await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
} finally {ac.abort();if(provider)await provider.dispose();await fs.rm(work,{recursive:true,force:true});}
