import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const r=spawnSync(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'-p',path.join(root,'tsconfig.json'),...process.argv.slice(2)],{cwd:root,stdio:'inherit'});
if(r.error)throw r.error;process.exitCode=r.status??1;
