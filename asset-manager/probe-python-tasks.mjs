import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const python=process.env.HUB_PYTHON_EXECUTABLE, deps=process.env.HUB_PYTHON_DEPS, git=process.env.HUB_GIT_EXECUTABLE;
if(!python||!deps||!git)throw new Error('Explicit HUB_PYTHON_EXECUTABLE, HUB_PYTHON_DEPS and HUB_GIT_EXECUTABLE required; no automatic installation');
for(const p of [python,deps,git])await fs.access(path.resolve(p));
const bootstrap='import os,sys,runpy;sys.dont_write_bytecode=True;sys.path.insert(0,os.environ["HUB_PYTHON_DEPS"]);sys.argv=sys.argv[1:];runpy.run_path(sys.argv[0],run_name="__main__")';
const env={};for(const name of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'])if(process.env[name])env[name]=process.env[name];Object.assign(env,{HUB_PYTHON_DEPS:path.resolve(deps),HUB_GIT_EXECUTABLE:path.resolve(git)});
const results=[];
for(const test of ['test_skill_packager.py','test_ownership_task.py','test_web_server.py']){const file=path.join(root,'asset-manager/tests/fixtures',test);const result=spawnSync(path.resolve(python),['-X','utf8','-c',bootstrap,file],{cwd:root,env,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});if(result.error)throw result.error;if(result.status!==0)throw new Error(test+' failed: '+result.stdout+result.stderr);results.push({test,status:'PASS',test_summary:result.stderr.trim(),scope:test.includes('packager')?'Actual CLI archive content, failure cleanup and no-overwrite on synthetic Skill':test.includes('web_server')?'Owned loopback HTTP services, noisy output, startup/test failure, bounded timeout, interruption and child cleanup; not browser UI acceptance':'Actual synthetic Git repository to security ownership CSV/JSON and bounded query; no user repository analysis'});}
const report={schema:1,status:'PASS',results,python_version:spawnSync(path.resolve(python),['--version'],{encoding:'utf8'}).stdout.trim(),scope:'Pinned test dependencies supplied externally; no downloads or user runtime changes; not all Skill scripts tested.'};
await fs.mkdir(path.join(root,'.asset-state/evidence'),{recursive:true});await fs.writeFile(path.join(root,'.asset-state/evidence/python-tasks.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
