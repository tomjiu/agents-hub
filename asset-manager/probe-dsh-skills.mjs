import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createProfileView} from './core/views.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const entry=process.env.HUB_DSH_SKILL_PROVIDER;
if(!entry)throw new Error('Set HUB_DSH_SKILL_PROVIDER to the installed dsh-skill-filesystem/lib/index.js; no host package is changed.');
const {FileSystemSkillProvider}=await import(pathToFileURL(path.resolve(entry)).href);
const view=await createProfileView(root,'dsh');const ac=new AbortController(),warnings=[];
const provider=new FileSystemSkillProvider({get:()=>undefined,logger:{warn:x=>warnings.push(x)}},{signal:ac.signal,invalidate:()=>{}},{includeDefaultRoots:false,customSkillDirs:[path.join(view.destination,'skills')],watch:false});
try {
 const result=await provider.list({cwd:root});const candidates=Array.isArray(result)?result:result.candidates;
 assert.equal(candidates.length,view.skills.length);const loaded=[];
 for(const candidate of candidates){const definition=await provider.get(candidate,{cwd:root});assert.ok(definition?.content);loaded.push(definition.name);}
 assert.deepEqual(loaded.sort(),view.skills.map(x=>x.name).sort());assert.deepEqual(warnings,[]);
 const report={status:'PASS',profile:'dsh',skills:loaded,warnings,user_config_modified:false,scope:'Installed DSH filesystem provider list/get using isolated host context; not live profile or plugin installation.'};
 await fs.mkdir(path.join(root,'.asset-state/evidence'),{recursive:true});await fs.writeFile(path.join(root,'.asset-state/evidence/dsh-skill-profile.json'),JSON.stringify(report,null,2)+String.fromCharCode(10));console.log(JSON.stringify(report,null,2));
} finally {ac.abort();await provider.dispose();await fs.rm(view.destination,{recursive:true,force:true});}
