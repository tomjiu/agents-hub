import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateAllWorkflows} from '../core/workflows.mjs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('G0-3 office artifact acceptance rubric contract is registered, valid and gated (red-first for the rubric gap)',async()=>{
  const report = await validateAllWorkflows(root);
  assert.equal(report.status,'PASS','existing contracts must stay valid: '+JSON.stringify(report.workflows?.map(w=>w.problems)));
  const contract = report.workflows.find(w=>w.id==='office-artifact-acceptance');
  assert.ok(contract,'office-artifact-acceptance contract must exist (G0-3: office artifact acceptance lacked rubrics/approval flow)');
  assert.equal(contract.valid,true);
  const doc = JSON.parse(await fs.readFile(path.join(root,'catalog/workflows/office-artifact-acceptance.json'),'utf8'));
  // approval flow: verdict and delivery are explicit human gates
  for(const ap of ['acceptance-verdict','handoff']) assert.ok(doc.approval_points.includes(ap),'approval point '+ap+' required');
  assert.equal((doc.steps.filter(s=>s.approval===true)).length,2,'exactly the two human gates are approval steps');
  // rubric must cover every office artifact type named by the gap
  for(const t of ['docx','pdf','pptx','xlsx']) assert.ok(JSON.stringify(doc).includes(t),'rubric must cover '+t);
  // mandatory criteria are checkable, not vibes: every review-stage step carries a validator
  for(const s of doc.steps) if(s.stage==='review') assert.ok(s.validator&&s.validator.length>20,'review step '+s.id+' needs a concrete validator');
  // failure paths hand off honestly
  assert.ok(doc.failure_paths.cancel&&doc.failure_paths.missing_dependency);
  // restricted format skills stay restricted: the contract routes to them but never claims they are deployable
  assert.ok(doc.notes.some(n=>n.includes('restricted')),'contract must state restricted-provider status explicitly');
});
