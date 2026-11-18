import fs from 'node:fs/promises';
import {loadCatalog} from './catalog.mjs';
import {confined,tree,sha256} from './files.mjs';
export async function auditProvenance(root){
 const catalog=await loadCatalog(root),assets=[],groups=new Map(),warnings=[];
 for(const a of catalog.values()){
  const current=await tree(await confined(root,a.path));const record={id:a.id,kind:a.kind,path:a.path,maintenance_url:a.source.url||'',source_kind:a.source.kind,upstream_commit:a.source.commit||'',upstream_version:a.source.version||a.version.upstream||'unknown',identity_status:a.source.upstream_identity_status||'declared-not-verified',import_baseline:a.import?.baseline_commit||'',license:a.source.license||'unknown',license_status:a.source.license_status||'review-required',deployment_restricted:a.source.license_status==='restricted-declared'||a.source.redistribution_review_required===true||a.runtime_review_required===true,current_sha256:current.sha256,baseline_sha256:a.version.sha256,local_modified:current.sha256!==a.version.sha256};
  if(a.source.license_evidence){const file=await confined(root,a.source.license_evidence);record.license_evidence={path:a.source.license_evidence,sha256:sha256(await fs.readFile(file))};}
  if(a.source.commit&&a.version.commit!==a.source.commit)warnings.push('Upstream commit differs between source/version: '+a.id);
  if(a.import?.baseline_commit&&[a.source.commit,a.version.commit].includes(a.import.baseline_commit))warnings.push('Local import commit mislabeled as upstream: '+a.id);
  assets.push(record);const key=a.kind+':'+current.sha256;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(a.id);
 }
 return {schema:1,assets,counts:{assets:assets.length,upstream_unverified:assets.filter(a=>a.identity_status==='unverified').length,declared_restricted:assets.filter(a=>a.license_status==='restricted-declared').length,vendor_runtime_review:assets.filter(a=>catalog.get(a.id).runtime_review_required).length},exact_content_groups:[...groups.values()].filter(ids=>ids.length>1),warnings,scope:'Read-only metadata, source-content and declared-license evidence. Identical bytes are duplicate candidates, not proof of common origin or permission to remove. Historical locks/provenance remain unchanged.'};
}
