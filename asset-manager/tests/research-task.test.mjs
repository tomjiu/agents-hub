import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../..',import.meta.url));
test('real network research never starts without explicit live opt-in',()=>{for(const probe of ['probe-research-network.mjs','probe-search-quality.mjs','probe-tun-fetch.mjs']){const r=spawnSync(process.execPath,[path.join(root,'asset-manager',probe)],{cwd:root,encoding:'utf8',timeout:10000});assert.equal(r.status,1);assert.match(r.stderr,/Explicit --live required/);}});
test('published research separates failed fetch from alternate evidence and memory replay',async()=>{const report=JSON.parse(await fs.readFile(path.join(root,'catalog/audit/real-research-task.json'),'utf8'));assert.equal(report.network.real_network,true);assert.equal(report.acceptance.searchcore_official_fetch_passed,false);assert.equal(report.acceptance.entire_search_fetch_pipeline_passed,false);assert.equal(report.acceptance.independent_official_reader_passed,true);assert.equal(report.memory.readback.separate_process,true);const text=await fs.readFile(path.join(root,'catalog/audit/research-memory-sqlite.md'),'utf8');for(const url of report.memory.evidence_urls)assert.ok(text.includes(url));assert.ok(text.includes('尚未修复'));});

test('memory replay rejects incomplete report input rather than fabricating cited evidence',async t=>{const work=await fs.mkdtemp(path.join(os.tmpdir(),'hub-report-input-'));t.after(()=>fs.rm(work,{recursive:true,force:true}));const report=path.join(work,'unreviewed.md');await fs.writeFile(report,'Unverified conclusion without citations');const result=spawnSync(process.execPath,[path.join(root,'asset-manager/probe-research-memory.mjs'),report],{cwd:root,encoding:'utf8',timeout:10000});assert.equal(result.status,1);assert.match(result.stderr,/must cite the reviewed official source/);});
