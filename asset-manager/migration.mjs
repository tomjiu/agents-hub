import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
async function walk(dir, prefix = '') {
  const out = [];
  for (const e of (await fs.readdir(dir, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === '.asset-state') continue;
    const rel = prefix ? prefix + '/' + e.name : e.name;
    if (e.isSymbolicLink()) throw new Error('Inspect link before migration: ' + rel);
    if (e.isDirectory()) out.push(...await walk(path.join(dir,e.name),rel));
    else if (e.isFile()) { const data=await fs.readFile(path.join(dir,e.name)); out.push({path:rel,bytes:data.length,sha256:hash(data)}); }
  }
  return out;
}
const documents = new Set(['docx','pdf','pptx','xlsx','doc-coauthoring','theme-factory','frontend-design','webapp-testing']);
const research = new Set(['exa-search','keenable-cli','web-search-hikari','source-index','repository-skills', 'reverse-engineering-workflow', 'firmware-analysis','dfir-workflow']);
function target(p) {
  if (p.startsWith('selected/')) {
    const [_,name,...rest]=p.split('/');
    if (!rest.length) return 'catalog/audit/legacy/selected/'+name;
    const group = documents.has(name)?'document':name.includes('security')||name.includes('offensive')||name==='authorized-analysis-scope'?'security':research.has(name)||name.startsWith('tavily-')?'research':'engineering';
    return 'skills/individual/'+group+'/'+name+'/'+rest.join('/');
  }
  if(p.startsWith('cloud-vendors/trae/')) return p.replace('cloud-vendors/trae/','skills/collections/vendors/trae/');
  if(p.startsWith('cloud-vendors/workbuddy/')) return p.replace('cloud-vendors/workbuddy/','skills/collections/vendors/workbuddy/');
  if(p.startsWith('cloud-vendors/')) return p.replace('cloud-vendors/','catalog/audit/legacy/cloud-vendors/');
  if(p.startsWith('memory-net/')) return p.replace('memory-net/','plugins/memory-net/');
  if(p.startsWith('research/agents-md-audit/')) return p.replace('research/agents-md-audit/','agents-md/research/agents-md-audit/');
  if(p.startsWith('search-infra/core/')) return p.replace('search-infra/core/','mcp/servers/search-core/typescript/');
  if(p.startsWith('search-infra/go-port/')) return p.replace('search-infra/go-port/','mcp/servers/search-core/go/');
  if(p==='search-infra/SKILL.md') return 'skills/individual/research/search-core/SKILL.md';
  if(p.startsWith('search-infra/')) return p.replace('search-infra/','research/search-core/');
  if(p.startsWith('mcp/local/zai-bridge/')) return p.replace('mcp/local/zai-bridge/','mcp/servers/zai-bridge/');
  if(p.startsWith('mcp/local/firefox-devtools-mcp/')) return p.replace('mcp/local/firefox-devtools-mcp/','mcp/servers/firefox-devtools-mcp/');
  if(p.startsWith('mcp/')) return 'catalog/audit/legacy/'+p;
  if(p.startsWith('dsh-plugins/')) return p.replace('dsh-plugins/','catalog/audit/legacy/dsh-plugins/');
  if(p.startsWith('catalog/') && !p.startsWith('catalog/audit/')) return p.replace('catalog/','catalog/audit/legacy/catalog/');
  if(['README.md','SOURCES.md','_REDESIGN.md','_synctest.txt'].includes(p)) return 'catalog/audit/legacy/root/'+p;
  return p;
}
async function prune(dir) {
  for(const e of await fs.readdir(dir,{withFileTypes:true})) {
    if(e.name === '.git' || e.name === 'node_modules') continue;
    if(e.isDirectory()){const p=path.join(dir,e.name);await prune(p);if(!(await fs.readdir(p)).length) await fs.rmdir(p);}
  }
}
const record=path.join(root,'catalog/audit/migration-2026-11.json');
if(process.argv[2]==='plan') {
  try {await fs.access(record);throw new Error('Existing migration record; refuse new baseline');} catch(e){if(e.code!=='ENOENT') throw e;}
  const files=await walk(root);
  const plan={schema:1,baseline_commit:'4f1911081477b49a6610e52537bea1057f216530',files:files.map(f=>({...f,target:target(f.path)}))};
  const names=new Set();for(const f of plan.files){if(names.has(f.target.toLowerCase()))throw new Error('Collision '+f.target);names.add(f.target.toLowerCase());}
  await fs.mkdir(path.dirname(record),{recursive:true});await fs.writeFile(record,JSON.stringify(plan,null,2),{flag:'wx'});
  console.log(JSON.stringify({files:files.length,moves:plan.files.filter(f=>f.path!==f.target).length,bytes:files.reduce((n,f)=>n+f.bytes,0)}));
} else if(process.argv[2]==='apply') {
  const plan=JSON.parse(await fs.readFile(record,'utf8'));
  for(const f of plan.files){
    if(f.path===f.target)continue;
    const old=path.join(root,f.path),dest=path.join(root,f.target);
    let data;
    try{data=await fs.readFile(old);}catch(e){if(e.code==='ENOENT'&&hash(await fs.readFile(dest))===f.sha256)continue;throw e;}
    if(hash(data)!==f.sha256)throw new Error('Changed source '+f.path);
    await fs.mkdir(path.dirname(dest),{recursive:true});
    try{await fs.access(dest);throw new Error('Existing target '+f.target);}catch(e){if(e.code!=='ENOENT')throw e;}
    await fs.rename(old,dest);
  }
  const bad=[];for(const f of plan.files) if(hash(await fs.readFile(path.join(root,f.target)))!==f.sha256)bad.push(f.target);
  if(bad.length)throw new Error('Content loss '+bad.join(','));
  await prune(root);console.log('Migration content verified: '+plan.files.length+' files; no loss.');
} else throw new Error('Use plan or apply');
