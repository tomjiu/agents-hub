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
