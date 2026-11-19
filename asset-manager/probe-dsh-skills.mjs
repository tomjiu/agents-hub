import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createProfileView,createView} from './core/views.mjs';
import {auditAssetUsability,selectionConflicts} from './core/usability.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const entry=process.env.HUB_DSH_SKILL_PROVIDER;
if(!entry)throw new Error('Set HUB_DSH_SKILL_PROVIDER to the installed dsh-skill-filesystem/lib/index.js; no host package is changed.');
const {FileSystemSkillProvider}=await import(pathToFileURL(path.resolve(entry)).href);
const all=process.env.HUB_DSH_ALL_USABLE_SKILLS==='1';const audit=all?await auditAssetUsability(root):null;const selected=all?{skills:audit.assets.filter(a=>a.kind==='skills'&&a.status==='CONTENT_READY').map(a=>a.id),mcp:[],plugins:[]}:null;
if(all)assert.deepEqual(await selectionConflicts(root,selected),[]);const view=all?await createView(root,'dsh','usable-skill-inventory',{selection:selected}):await createProfileView(root,'dsh');const ac=new AbortController(),warnings=[];
const provider=new FileSystemSkillProvider({get:()=>undefined,logger:{warn:x=>warnings.push(x)}},{signal:ac.signal,invalidate:()=>{}},{includeDefaultRoots:false,customSkillDirs:[path.join(view.destination,'skills')],watch:false});
try {
 const result=await provider.list({cwd:root});const candidates=Array.isArray(result)?result:result.candidates;
 assert.equal(candidates.length,view.skills.length);const loaded=[];
 for(const candidate of candidates){const definition=await provider.get(candidate,{cwd:root});assert.ok(definition?.content);const deployed=await fs.readFile(path.join(view.destination,'skills',definition.name,'SKILL.md'),'utf8');const body=/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(deployed)?.[1];assert.equal(definition.content.replaceAll(String.fromCharCode(13),'').trim(),body?.replaceAll(String.fromCharCode(13),'').trim(),'Returned Skill full body must match canonical deployment: '+definition.name);loaded.push(definition.name);}
 assert.deepEqual(loaded.sort(),view.skills.map(x=>x.name).sort());assert.deepEqual(warnings,[]);
 const report={status:'PASS',profile:all?'all-content-ready':'dsh',skills:loaded,excluded:all?audit.assets.filter(a=>a.kind==='skills'&&a.status!=='CONTENT_READY').map(a=>({id:a.id,status:a.status,blockers:a.blockers})):undefined,warnings,user_config_modified:false,scope:'Installed DSH filesystem provider list/get using isolated host context; not live profile or plugin installation.'};
 await fs.mkdir(path.join(root,'.asset-state/evidence'),{recursive:true});await fs.writeFile(path.join(root,'.asset-state/evidence',all?'dsh-all-usable-skills.json':'dsh-skill-profile.json'),JSON.stringify(report,null,2)+String.fromCharCode(10));console.log(JSON.stringify(report,null,2));
} finally {ac.abort();await provider.dispose();await fs.rm(view.destination,{recursive:true,force:true});}
