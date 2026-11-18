import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import {parse,stringify} from 'smol-toml';
import {loadCatalog,readToml,resolveExpert,resolveProfile} from './catalog.mjs';
import {effectivePath} from './lifecycle.mjs';
import {confined,exists,snapshot,tree,createJson,sha256} from './files.mjs';
export async function createView(root,client,expert,{allowRestricted=false,selection,profileMeta}={}) {
 if(!['codex','opencode','dsh','generic'].includes(client))throw new Error('Unknown client');
 const catalog=await loadCatalog(root),selected=selection||await resolveExpert(root,expert,catalog);
 for(const k of ['skills','mcp','plugins']){if(!Array.isArray(selected[k]))throw new Error('Invalid selected list '+k);for(const id of selected[k])if(catalog.get(id)?.kind!==k)throw new Error('Invalid selected '+k+' reference '+id);}
 const parent=await confined(root,'.asset-state/views',{mustExist:false});await fs.mkdir(parent,{recursive:true});const view=path.join(parent,client+'-'+crypto.randomUUID());await fs.mkdir(view);
 try {
  const skills=path.join(view,'skills');await fs.mkdir(skills);const used=new Set(),records=[];
  for(const id of selected.skills){const a=catalog.get(id);if(a.runtime_review_required&&!allowRestricted)throw new Error('Restricted vendor asset needs explicit license/runtime review: '+id);
   const source=await effectivePath(root,a),text=await fs.readFile(path.join(source,'SKILL.md'),'utf8');
   const front=/^---\r?\n([\s\S]*?)\r?\n---/.exec(text);if(!front)throw new Error('Invalid Skill frontmatter '+id);const fm=YAML.parse(front[1]);
   if(typeof fm.description!=='string'||!fm.description.trim())throw new Error('Invalid skill description '+id);
   const name=fm.name;if(typeof name!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))throw new Error('Client-incompatible skill name '+id);
   if(used.has(name))throw new Error('Multiple assets have client skill name '+name+'; select one implementation');used.add(name);
   const t=await snapshot(source,path.join(skills,name));records.push({id,name,sha256:t.sha256});
  }
  const registry=await readToml(path.join(root,'mcp/registry.toml'));const mcp={},unsupported=[];
  for(const id of selected.mcp) {
   const a=catalog.get(id),s=registry.servers.find(s=>s.id===a.registry_id);if(!s)throw new Error('Missing MCP registration '+id);
   if(['unlocked-upstream','external-install-required','review-required','upstream-diff-pending'].includes(s.status))throw new Error('MCP not deployable before review: '+id);
   let entry;
   if(s.transport==='http')entry={url:s.url};
   else {if(client==='opencode'&&s.cwd&&s.cwd!=='.')throw new Error('OpenCode local MCP cwd adapter not yet verified: '+id);if(!s.command||!Array.isArray(s.args))throw new Error('Incomplete MCP command '+id);const args=[];for(const arg of s.args){if(typeof arg!=='string')throw new Error('Invalid MCP arg');if(arg.startsWith('mcp/')){const prefix=a.path+'/';const source=await effectivePath(root,a);const full=arg.startsWith(prefix)?await confined(source,arg.slice(prefix.length)):await confined(root,arg);args.push(full);}else args.push(arg);}entry={command:s.command,args};if(s.cwd&&s.cwd!=='.')entry.cwd=s.cwd===a.path?await effectivePath(root,a):await confined(root,s.cwd);}
   if(s.env_names?.length)entry.required_env=s.env_names;
   mcp[s.id]=entry;
  }
  for(const id of selected.plugins) {if(client!=='dsh')unsupported.push({id,reason:'Host-specific plugin; no adapter for '+client});else unsupported.push({id,reason:'DSH plugin requires explicit package build/profile configuration; view does not auto-install or patch host.'});}
  if(client==='opencode')await createJson(path.join(view,'opencode.json'),{skills:{paths:[skills]},mcp:Object.fromEntries(Object.entries(mcp).map(([id,e])=>[id,e.url?{type:'remote',url:e.url,enabled:true}:{type:'local',command:[e.command,...e.args],enabled:true}]))});
  else if(client==='codex')await fs.writeFile(path.join(view,'config.toml'),stringify({mcp_servers:Object.fromEntries(Object.entries(mcp).map(([id,e])=>[id,e.url?{url:e.url}:{command:e.command,args:e.args,...e.cwd?{cwd:e.cwd}:{}}]))}),{flag:'wx'});
  else await createJson(path.join(view,'mcp.json'),{mcpServers:mcp});
  if(client==='dsh')await fs.writeFile(path.join(view,'dsh-skills.yml'),YAML.stringify({'@deepseek-ai/dsh-skill-filesystem':{includeDefaultRoots:true,customSkillDirs:[skills]}}),{flag:'wx'});
  const report={schema:1,client,expert,skills:records,mcp_ids:Object.keys(mcp),plugins:selected.plugins,unsupported,destination:view,user_config_modified:false,deployment_copy:true,maintenance_source:'Repository catalog + reviewed version store',...profileMeta};
  await createJson(path.join(view,'view.json'),report);return report;
 }catch(e){await fs.rm(view,{recursive:true,force:true});throw e;}
}
export async function composeRules(root,projectFile,output,{fragments=[]}={}) {
 const base=await fs.readFile(path.join(root,'agents-md/base/AGENTS.md'),'utf8'),project=await fs.readFile(projectFile,'utf8');
 if(/待填写|\[待确认\]/.test(project))throw new Error('Project template is incomplete');
 if(await exists(output)||await exists(output+'.sources.json'))throw new Error('Output exists: generate a new candidate and review diff');
 const pieces=[base],sources=[{path:'agents-md/base/AGENTS.md',sha256:sha256(base)}];
 for(const name of fragments){if(!/^[a-z0-9-]+$/.test(name))throw new Error('Invalid fragment');const rel='agents-md/fragments/'+name+'.md',text=await fs.readFile(await confined(root,rel),'utf8');pieces.push(text);sources.push({path:rel,sha256:sha256(text)});}
 pieces.push(project);sources.push({path:path.basename(projectFile),sha256:sha256(project)});
 await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,pieces.map(x=>x.trim()).join('\n\n')+'\n',{flag:'wx'});
 await createJson(output+'.sources.json',{schema:1,sources,output_sha256:sha256(await fs.readFile(output)),review_required:true,semantic_conflicts_checked:false});return {output,sources,review_required:true};
}

export async function createProfileView(root,client,options={}) {
 const catalog=await loadCatalog(root),{profile,selected}=await resolveProfile(root,client,catalog);
 const report=await createView(root,client,'profile:'+client,{...options,selection:selected,profileMeta:{profile_enabled:profile.enabled,explicit_selection:true}});
 await createJson(path.join(report.destination,'profile-selection.json'),{schema:1,client,profile,selected});
 return report;
}
