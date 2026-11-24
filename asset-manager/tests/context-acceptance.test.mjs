import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDshCompatibility,saveDshAcceptance} from '../core/dsh-compatibility.mjs';
const fingerprint={version:'0.2.2-rc.1',host_sha256:'a'.repeat(64),assets_sha256:'b'.repeat(64),assets:{memory_context_policy:'session-v1'}};
const base={status:'PASS',host_version:fingerprint.version,fingerprint,fetch:{literal_refused:true},parallel_discovery:true,search:{queried:true,refs_returned:true,cache_hit:true,cache_isolated:true,explicit_selection_verified:true,quality_verified:true},memory:{persisted:true,prompt_injection:true,auto_observe:true,self_filter:true},skill:{full_content_seen_by_model:true},mcp:{result_returned_to_model:true}};
test('session policy rejects otherwise complete shared-only acceptance',async()=>{
 assert.equal(classifyDshCompatibility(fingerprint,[base]).status,'NEEDS_ACCEPTANCE');
 await assert.rejects(saveDshAcceptance('.',base),/Complete host acceptance/);
 const fields=['same_project_sessions_isolated','different_project_isolated','model_scope_selectors_refused','default_root_untouched','contextual_prompt','raw_scope_preserved','auto_attribution'];
 const session_boundary=Object.fromEntries(fields.map(k=>[k,true]));assert.equal(classifyDshCompatibility(fingerprint,[{...base,session_boundary}]).status,'VERIFIED');
 for(const k of fields)assert.equal(classifyDshCompatibility(fingerprint,[{...base,session_boundary:{...session_boundary,[k]:false}}]).status,'NEEDS_ACCEPTANCE');
});
test('candidate-review policy additionally requires full event-to-review host receipt',()=>{
 const f={...fingerprint,assets:{...fingerprint.assets,memory_candidate_policy:'review-v1'}},session_boundary=Object.fromEntries(['same_project_sessions_isolated','different_project_isolated','model_scope_selectors_refused','default_root_untouched','contextual_prompt','raw_scope_preserved','auto_attribution'].map(k=>[k,true]));
 const report={...base,fingerprint:f,session_boundary};assert.equal(classifyDshCompatibility(f,[report]).status,'NEEDS_ACCEPTANCE');
 const candidate_lifecycle={pending_excluded:true,host_reviewed:true,accepted_curated:true,evidence_persisted:true};assert.equal(classifyDshCompatibility(f,[{...report,candidate_lifecycle}]).status,'VERIFIED');
 for(const k of Object.keys(candidate_lifecycle))assert.equal(classifyDshCompatibility(f,[{...report,candidate_lifecycle:{...candidate_lifecycle,[k]:false}}]).status,'NEEDS_ACCEPTANCE');
})
test('cache safe policy refuses old or incomplete request-prefix evidence',async()=>{
 const f={...fingerprint,assets:{memory_cache_policy:'tail-v1'}},report={...base,fingerprint:f};
 assert.equal(classifyDshCompatibility(f,[report]).status,'NEEDS_ACCEPTANCE');await assert.rejects(saveDshAcceptance('.',report),/Complete host acceptance/);
 const cache_safe_context={stable_system:true,stable_tools:true,append_only_messages:true,no_diagnostic_churn:true,literal_memory:true,stale_retraction:true};
 assert.equal(classifyDshCompatibility(f,[{...report,cache_safe_context}]).status,'VERIFIED');
 for(const k of Object.keys(cache_safe_context))assert.equal(classifyDshCompatibility(f,[{...report,cache_safe_context:{...cache_safe_context,[k]:false}}]).status,'NEEDS_ACCEPTANCE');
})
