import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {stringify} from 'smol-toml';
import {loadCatalog} from '../core/catalog.mjs';
import {tree} from '../core/files.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url));
const EVIDENCE='catalog/audit/skills-g0-5-upstream-verification.json';
const SHA=/^[0-9a-f]{40}$/;

async function readEvidence(){return JSON.parse(await fs.readFile(path.join(root,EVIDENCE),'utf8'));}
async function realAssets(){const assets=await loadCatalog(root);return [...assets.values()].filter(a=>a.source?.upstream_identity_status?.startsWith('verified-upstream'));}

test('G0-5: all 60 previously unverified assets now carry verified upstream identity with real commits',async()=>{
  const evidence=await readEvidence();
  const assets=await realAssets();
  assert.equal(assets.length,60,'expected the 60 G0-5 assets to be verified');
  const verifiedBase=assets.filter(a=>a.source.upstream_identity_status==='verified-upstream-base').map(a=>a.id).sort();
  assert.deepEqual(verifiedBase,['mcp.search-core','memory-net'],'only locally-developed assets may keep base-status');
  for(const a of assets){
    const c=a.source.commit;
    assert.match(c||'',SHA,a.id+': source.commit must be a real 40-hex upstream sha');
    assert.equal(a.source.upstream_commit,c,a.id+': upstream_commit must agree with source.commit');
    assert.equal(a.version.commit,c,a.id+': version.commit must agree with source.commit');
    assert.notEqual(c,a.import?.baseline_commit,a.id+': import baseline must not be misrepresented as upstream commit');
    assert.equal(a.source.upstream_evidence,EVIDENCE,a.id+': must point at the shared evidence audit');
    const rec=evidence.assets.find(x=>x.id===a.id);
    assert.ok(rec,a.id+': missing from evidence audit');
    assert.equal(rec.assigned_upstream_commit,c,a.id+': evidence commit disagrees with manifest');
    assert.ok(['verified-upstream-match','verified-upstream-base'].includes(rec.verdict),a.id+': evidence verdict invalid');
    assert.ok(rec.import_origin.files_verified+rec.import_origin.exceptions.length===rec.import_origin.files_total,a.id+': import-origin accounting must close');
    assert.ok(rec.current_content.files_total>0,a.id+': current-content verification required');
    if(rec.verdict==='verified-upstream-match'){
      assert.equal(rec.current_content.match_at_assigned,rec.current_content.files_total,a.id+': full match requires every file verified at the assigned commit');
      assert.equal(a.source.upstream_identity_status,'verified-upstream-match',a.id);
    } else {
      assert.ok(rec.current_content.match_at_assigned<rec.current_content.files_total,a.id+': base-status must record local divergence');
      assert.ok(rec.current_content.diverged_files.length>0,a.id+': diverged file list required for base-status');
    }
  }
});

test('G0-5: no asset keeps unverified identity unless the evidence audit lists it as not verified',async()=>{
  const evidence=await readEvidence();
  const notVerified=new Set((evidence.not_verified||[]).map(x=>x.id));
  const assets=await loadCatalog(root);
  for(const a of assets.values()){
    if(a.source?.upstream_identity_status==='unverified'){
      assert.ok(notVerified.has(a.id),a.id+': still unverified but absent from not_verified list');
    }
  }
  assert.equal(evidence.assets.length,60,'evidence must cover exactly the 60 G0-5 assets');
});

test('G0-5: service endpoints have live probe records with honest verdicts',async()=>{
  const evidence=await readEvidence();
  for(const id of ['mcp.keenable','mcp.tavily-hikari']){
    const rec=evidence.assets.find(x=>x.id===id);
    assert.ok(rec,id+': missing from evidence');
    assert.ok(rec.service_probe,'service asset requires a live probe record');
    assert.ok(['alive','degraded','down'].includes(rec.service_probe.verdict),id+': probe verdict must be alive/degraded/down');
    assert.ok(rec.service_probe.probed_at&&rec.service_probe.method,id+': probe must record time and method');
  }
});

test('G0-5: dead maintenance URL for memory-net is corrected and recorded, not silently dropped',async()=>{
  const evidence=await readEvidence();
  const rec=evidence.assets.find(x=>x.id==='memory-net');
  assert.ok(rec.url_history,'memory-net requires url history');
  const assets=await loadCatalog(root);
  const mn=assets.get('memory-net');
  assert.equal(mn.source.url,'https://github.com/tomjiu/agents-hub','memory-net url must point at the verified maintenance location');
  assert.equal(rec.url_history.former_url,'https://github.com/tomjiu/memory-net');
  assert.equal(rec.url_history.former_url_status,'dead-404');
});

test('G0-5: loadCatalog still rejects a fabricated commit and accepts only evidenced verification',async t=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'hub-g05-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
  for(const p of ['catalog/assets','catalog/updates','catalog/provenance','skills/demo','experts','mcp'])await fs.mkdir(path.join(home,p),{recursive:true});
  await fs.writeFile(path.join(home,'skills/demo/SKILL.md'),'---\nname: demo\ndescription: f\n---\nbody');
  const baseline=await tree(path.join(home,'skills/demo'));
  const mk=(source,extra={})=>({id:'demo',kind:'skills',path:'skills/demo',import:{baseline_commit:'a'.repeat(40)},source,version:{sha256:baseline.sha256,upstream:'unknown',commit:source.commit||'',local:'imported'},...extra});
  await fs.writeFile(path.join(home,'catalog/assets/demo.toml'),stringify(mk({kind:'local',url:'https://example.test/x',commit:'b'.repeat(40),upstream_identity_status:'verified-upstream-match',upstream_evidence:EVIDENCE})));
  await fs.writeFile(path.join(home,'catalog/provenance/demo.json'),JSON.stringify(baseline));
  await fs.writeFile(path.join(home,'catalog/updates/skills.toml'),stringify({defaults:{check:true,download:true,apply:false},protection:{overwrite:false,auto_merge:false,preserve_local_changes:true,require_validation:true,require_approval:true}}));
  await fs.writeFile(path.join(home,'mcp/registry.toml'),stringify({servers:[]}));await fs.writeFile(path.join(home,'experts/core.toml'),stringify({name:'core',skills:['demo']}));
  await loadCatalog(path.join(home,'.')); // evidenced non-baseline commit loads fine
  const bad=stringify(mk({kind:'local',url:'https://example.test/x',commit:'a'.repeat(40),upstream_identity_status:'verified-upstream-match'}));
  await fs.writeFile(path.join(home,'catalog/assets/demo.toml'),bad);
  await assert.rejects(loadCatalog(path.join(home,'.')),/misrepresented/);
});
