import fs from 'node:fs/promises';
import path from 'node:path';
import {loadCatalog} from './catalog.mjs';
import {confined} from './files.mjs';

// Inspect explicit references only; examples/placeholders are not executable dependencies.
export async function auditSkillResources(root){
 root=await fs.realpath(root);const catalog=await loadCatalog(root),assets=[];
 for(const asset of catalog.values()){
  if(asset.kind!=='skills')continue;
  const source=await confined(root,asset.path),text=await fs.readFile(await confined(source,'SKILL.md'),'utf8');
  const candidates=new Map();
  const add=(target,origin)=>{target=target.trim().replace(/^<|>$/g,'');if(!target||target.startsWith('#')||/^(https?:|mailto:)/i.test(target))return;
   target=target.split('#')[0];try{target=decodeURIComponent(target);}catch{}
   if(!target)return;target=target.replace(/^([.][/])+/,'');
   const prior=candidates.get(target)||new Set();prior.add(origin);candidates.set(target,prior);
  };
  for(const part of text.split('](').slice(1)){const target=part.split(')')[0].split(/\s+["']/)[0];add(target,'markdown-link');}
  // Only known local resource prefixes and literal script names, not arbitrary prose file names.
  for(const match of text.matchAll(/(?:scripts|references|examples|assets|agents|eval-viewer)\/[A-Za-z0-9_./-]+\.(?:py|sh|mjs|js|json|md|html|xml|txt)\b/g))add(match[0],'local-resource');
  for(const match of text.matchAll(/skills\/skills\/[A-Za-z0-9_./-]+\.(?:py|sh|md)\b/g))add(match[0],'legacy-command');
  for(const match of text.matchAll(/skills[/](?:individual|collections)[/][A-Za-z0-9_./-]+[.](?:py|sh|md)\b/g))add(match[0],'repository-command');
  const references=[];
  for(const [target,origins] of candidates){
   let status,reason;
   if(target==='URL'||/[<>*{}$]|(?:^|\/)(?:your[-_]|my[-_]|example[-_]|path\/to)/i.test(target)){status='EXAMPLE_OR_DYNAMIC';reason='Placeholder or generated/example path, not a verified bundled dependency';}
   else if(path.isAbsolute(target)||target.includes(':')||target.includes('\\')){status='EXTERNAL_PATH';reason='Absolute/machine-specific or unsupported reference; do not resolve outside asset boundary';}
   else{
    const repositoryReference=origins.has('legacy-command')||target.startsWith('skills/')||target.startsWith('asset-manager/')||target.startsWith('catalog/')||target.startsWith('mcp/');
    try{const resolved=repositoryReference?path.resolve(root,target):path.resolve(source,target),base=await fs.realpath(root);if(resolved!==base&&!resolved.startsWith(base+path.sep))throw new Error('Resource reference escapes repository');const rel=path.relative(base,resolved).split(path.sep).join('/');await confined(root,rel);status='FOUND';reason=resolved.startsWith(source+path.sep)?'Skill-relative bundled reference':'Repository reference: available in checkout, not necessarily standalone deployment';}
    catch(e){status=e.code==='ENOENT'?'MISSING':'UNSAFE_OR_INVALID';reason=e.code==='ENOENT'?'Explicit reference not present at documented path':e.message;}
   }
   references.push({target,origins:[...origins],status,reason,interpretation:status==='MISSING'?'Needs manual review: may be an omitted dependency or a generated example, not an automatic repair directive':undefined});
  }
  assets.push({id:asset.id,path:asset.path,restricted_or_vendor:!!asset.runtime_review_required||asset.source.license_status==='restricted-declared',references});
 }
 const refs=assets.flatMap(a=>a.references);return {schema:1,skills_checked:assets.length,counts:{explicit_references:refs.length,found:refs.filter(r=>r.status==='FOUND').length,missing:refs.filter(r=>r.status==='MISSING').length,unresolved_examples:refs.filter(r=>r.status==='EXAMPLE_OR_DYNAMIC').length,unsafe_or_external:refs.filter(r=>['EXTERNAL_PATH','UNSAFE_OR_INVALID'].includes(r.status)).length},assets,scope:'Read-only explicit Markdown links and literal bundled resource references in all canonical SKILL.md; not exhaustive natural-language dependency detection, script execution or legal approval.'};
}
