import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packages=['plugins/memory-net','plugins/memory-net/adapters/dsh','mcp/servers/search-core/typescript'];
for(const rel of packages){try{await fs.access(path.join(root,rel,'node_modules/typescript/bin/tsc'));}catch{throw new Error('Build dependency missing for '+rel+'. First run npm ci --ignore-scripts --no-audit --no-fund --prefix '+rel);}}
for(const rel of packages){const result=spawnSync(process.execPath,[path.join(root,rel,'scripts/build.mjs')],{cwd:path.join(root,rel),stdio:'inherit',shell:false});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);}
console.log(JSON.stringify({status:'BUILT',packages,installed_dependencies:false,host_upgraded:false,requires_acceptance:'Run probe-dsh-host.mjs before adopting changed compiled content.'}));
