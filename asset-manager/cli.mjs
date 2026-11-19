#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadCatalog,policy,resolveExpert,resolveProfile,readToml} from './core/catalog.mjs';
import {tree} from './core/files.mjs';
import {searchAssets,inspectSkillDirectory} from './core/discovery.mjs';
import {auditAssetUsability,preflightSelection} from './core/usability.mjs';
import {auditProvenance} from './core/provenance.mjs';
import {createDshBundle,verifyDshBundle} from './core/dsh-bundle.mjs';
import {checkDshCompatibility,checkDshUpstream} from './core/dsh-compatibility.mjs';
import {inspect,stage,validateVersion,approve,activate,rollback,exportLocks} from './core/lifecycle.mjs';
import {checkUpstream,downloadArtifact} from './providers/upstream.mjs';
import {createView,createProfileView,composeRules} from './core/views.mjs';
import {exportRecovery,restoreRecovery,inspectRecovery,restoreRecoverySelection} from './core/recovery.mjs';
import {prepareMcpInstall,applyMcpInstall,rollbackMcpInstall,inspectMcpInstall} from './core/mcp-install.mjs';
import {planDeployment,deployProfile,inspectDeployment,uninstallDeployment} from './core/deployment.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [command,id,value,...rest]=process.argv.slice(2);
const option=(name)=>{const i=rest.indexOf('--'+name);return i<0?undefined:rest[i+1];};
async function run(){
 if(command==='search-assets'){const args=[value,...rest],get=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};return searchAssets(root,id,{kind:get('kind'),limit:get('limit')===undefined?10:Number(get('limit')),client:get('client')||'dsh'});}
 if(command==='audit-usability'){const args=[id,value,...rest],get=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};return auditAssetUsability(root,{client:get('client')||'dsh',installation:get('installation')});}
 if(command==='preflight'){const args=[id,value,...rest],get=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};const report=await preflightSelection(root,{client:get('client')||'dsh',expert:get('expert'),ids:id&&!id.startsWith('--')?id.split(','):undefined,installation:get('installation')});if(report.status==='BLOCKED')process.exitCode=1;return report;}
 if(command==='skills-status'){const inventory=await inspectSkillDirectory(root);if(inventory.invalid.length||inventory.unregistered.length||inventory.missing.length)process.exitCode=1;if([id,value,...rest].includes('--verbose'))return inventory;const {records,...summary}=inventory;return summary;}
 if(command==='audit-provenance')return auditProvenance(root);
 if(command==='dsh-bundle'){const args=[value,...rest],index=args.indexOf('--expert');if(index>=0&&!args[index+1])throw new Error('--expert requires a recipe name');return createDshBundle(root,id,{expert:index>=0?args[index+1]:'research',memory:args.includes('--memory')});}
 if(command==='inspect-dsh-bundle')return verifyDshBundle(id);
 if(command==='check-dsh-upstream')return checkDshUpstream(root);
 if(command==='check-dsh'){const result=await checkDshCompatibility(root,id);if(result.status!=='VERIFIED')process.exitCode=1;return result;}
 if(command==='list')return [...(await loadCatalog(root)).values()].map(a=>({id:a.id,kind:a.kind,path:a.path,source:a.source.kind}));
 if(command==='inspect')return inspect(root,id);
 if(command==='check')return checkUpstream(root,id);
 if(command==='download')return downloadArtifact(root,id,{url:value,integrity:option('integrity')});
 if(command==='plan-mcp')return prepareMcpInstall(root,id,value,{expert:option('expert')});
 if(command==='inspect-mcp')return inspectMcpInstall(root,id);
 if(command==='apply-mcp')return applyMcpInstall(root,id,{approved:[value,...rest].includes('--approve')});
 if(command==='rollback-mcp')return rollbackMcpInstall(root,id,{approved:[value,...rest].includes('--approve')});
 if(command==='plan-deploy')return planDeployment(root,id,value);
 if(command==='deploy')return deployProfile(root,id,value,{approved:rest.includes('--approve')});
 if(command==='inspect-deployment')return inspectDeployment(root,id,value);
 if(command==='uninstall')return uninstallDeployment(root,id,value,{approved:rest.includes('--approve')});
 if(command==='profile-view')return createProfileView(root,id,{allowRestricted:[value,...rest].includes('--reviewed-vendor')});
 if(command==='view')return createView(root,id,value,{allowRestricted:rest.includes('--reviewed-vendor')});
 if(command==='compose')return composeRules(root,path.resolve(id),path.resolve(value),{fragments:option('fragments')?.split(',')||[]});
 if(command==='stage')return stage(root,id,path.resolve(value),{expectedSha256:option('sha256'),upstreamVersion:option('version')});
 if(command==='validate-version')return validateVersion(root,id,value);
 if(command==='approve')return approve(root,id,value,{reviewer:option('reviewer'),note:option('note'),resolveLocalChanges:rest.includes('--resolve-local-changes')});
 if(command==='activate')return activate(root,id,value,{expectedRevision:option('revision')===undefined?undefined:Number(option('revision'))});
 if(command==='rollback')return rollback(root,id,{expectedRevision:value===undefined?undefined:Number(value)});
 if(command==='export-locks')return exportLocks(root,path.resolve(id));
 if(command==='export-recovery')return exportRecovery(root,path.resolve(id));
 if(command==='inspect-recovery')return inspectRecovery(root,path.resolve(id));
 if(command==='restore-selection'){const args=[value,...rest],get=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};return restoreRecoverySelection(root,path.resolve(id),{approved:args.includes('--approve'),reviewer:get('reviewer'),note:get('note')});}
 if(command==='restore-recovery')return restoreRecovery(root,path.resolve(id));
 if(command==='expert')return resolveExpert(root,id,await loadCatalog(root));
 if(command==='validate'){
  const assets=await loadCatalog(root),errors=[],warnings=[];
  for(const a of assets.values()) {await policy(root,a);const t=await tree(path.join(root,a.path));if(t.sha256!==a.version.sha256)warnings.push('Local edits since catalog baseline: '+a.id);}
  for(const f of await fs.readdir(path.join(root,'experts')))if(f.endsWith('.toml'))try{await resolveExpert(root,f.slice(0,-5),assets);}catch(e){errors.push(e.message);}
  for(const client of ['codex','opencode','dsh'])try{await resolveProfile(root,client,assets);}catch(e){errors.push(e.message);}
  const inventory=await inspectSkillDirectory(root);for(const item of inventory.invalid)errors.push('Invalid Skill '+item.path+': '+item.error);for(const path of inventory.unregistered)errors.push('Unregistered Skill '+path);for(const path of inventory.missing)errors.push('Missing Skill '+path);
  if(errors.length)throw new Error(JSON.stringify({errors,warnings}));return {status:'PASS',assets:assets.size,warnings,scope:'Catalog IDs, paths, policies, expert and profile references; not runtime acceptance.'};
 }
 if(command==='help'||!command)return {commands:['audit-usability [--client dsh] [--installation DIR]','preflight <id,id> | --expert NAME [--client dsh] [--installation DIR]','search-assets <query> [--kind skills|mcp|plugins|agents-md] [--limit N] [--client dsh]','skills-status [--verbose]','audit-provenance','dsh-bundle <installation> --memory [--expert NAME]','inspect-dsh-bundle <bundle>','check-dsh-upstream','check-dsh <installation-directory>','plan-mcp <client> <project> [--expert NAME]','inspect-mcp <change-id>','apply-mcp <change-id> --approve','rollback-mcp <change-id> --approve','plan-deploy <client> <existing-project>','deploy <client> <existing-project> --approve','inspect-deployment <project> <deployment-id>','uninstall <project> <deployment-id> --approve','profile-view <dsh|codex|opencode>','export-recovery <new-directory>','restore-recovery <bundle-directory>','inspect-recovery <bundle-directory>','restore-selection <bundle> --approve --reviewer NAME --note TEXT','check <id>','download <id> <pinned-url> --integrity SRI','view <client> <expert>','compose <project.md> <new-output> [--fragments ui-acceptance]','list','inspect <id>','expert <name>','validate','stage <id> <incoming-directory> [--sha256 HASH] [--version VERSION]','validate-version <id> <version>','approve <id> <version> --reviewer NAME --note TEXT [--resolve-local-changes]','activate <id> <version> [--revision N]','rollback <id> [revision]','export-locks <new-directory>'],updates:'Never overwrites assets. Static validation is not approval. Runtime configurations are not changed automatically.'};
 throw new Error('Unknown command '+command);
}
try{console.log(JSON.stringify(await run(),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
