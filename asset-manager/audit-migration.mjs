import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from './core/files.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const plan=JSON.parse(await fs.readFile(path.join(root,'catalog/audit/migration-2026-11.json'),'utf8'));
const changed=[],missing=[];
for(const f of plan.files){try{const bytes=await fs.readFile(path.join(root,f.target));const current=sha256(bytes);if(current!==f.sha256)changed.push({original:f.path,target:f.target,baseline_sha256:f.sha256,current_sha256:current});}catch(e){if(e.code==='ENOENT')missing.push(f);else throw e;}}
const report={schema:1,baseline_commit:plan.baseline_commit,files:plan.files.length,unchanged:plan.files.length-changed.length-missing.length,missing,changed,note:'Migration apply verified all original hashes before local modifications. Subsequent repairs and new behavior are explicitly listed; original versions remain in preserved Git history.'};
const text=JSON.stringify(report,null,2)+'\n';if(process.argv[2])await fs.writeFile(path.resolve(process.argv[2]),text);console.log(JSON.stringify({files:report.files,unchanged:report.unchanged,missing:missing.length,changed:changed.map(x=>x.target)}));if(missing.length)process.exitCode=1;
