# Memory Candidate Lifecycle Implementation Plan

> Execute inline with review checkpoints; no subagents. PR7 remains unmerged and no live adoption.

**Goal:** Preserve event evidence while a proposed reusable conclusion moves through explicit host review before curated admission.

**Architecture:** Candidate is an inference node with reserved host-authored payload.memory_candidate. No new table or schema migration. proposeCandidate validates source IDs, scope and immutable content digests inside BEGIN IMMEDIATE; it is idempotent for normalized text+source IDs+run. reviewCandidate is host-only with expected fingerprint, named reviewer, note and distinct active observation evidence. Review can accept or reject; acceptance records evidence/digests and status=promoted. This proves recorded review/provenance, not semantic truth. Curated activation rejects pending/rejected candidates even on literal query; accepted candidates revalidate source/evidence snapshots read-only and require promotion. Raw retains history. Model tools propose/list only; no model accept endpoint, model payload cannot forge review state.

**Tech Stack:** Existing Node SQLite, SHA256, TypeScript node:test, real isolated DSH scripted fixture. Parent PR7 head062611e in E:/Code/ai/mn-context; child branch memory-candidate-lifecycle in E:/Code/ai/mn-candidates.

## Execution status

PR7自审诊断异常红灯复现并修复25bbdd4，parent两版宿主重验315fdbf456b8；child5ea20e6同修复。核心提案/核验/过期证据/事务回滚红绿通过，adapter scoped工具闭环通过，两版实际候选三会话fixture通过。末轮export/import恢复回执测试通过；精确宿主指纹731d76d3b5fb，两版候选session闭环和共享兼容通过。根150通过/1跳过、核心44、adapter31、搜索335；当前待独立PR发布。无自动总结器、审核UI或live采用。

## Tasks
1. Self-review PR7: add nonthrowing memory diagnostic and replay/cancellation tests; make attribution hooks return the host continuation even if attribution/logger fails. Fix any reproduced correctness defect in parent PR and cherry-pick into child. Do not alter current Web.
2. Write core failing tests13-candidates.test.ts: pending not curated, proposal idempotence, source required/no inactive or wrong scope, host review role/CAS/name/note/distinct verification evidence, reject/accept idempotence/conflict, accepted recall and read-only source recheck, original observation unchanged, GC protects candidate evidence, transaction rollback.
3. Create src/candidates.ts pure fingerprint/validation helpers and types. store.ts methods proposeCandidate(input:{text,confidence,source_ids,run_id,task_id?}), reviewCandidate(id,{expected_fingerprint,decision,reviewer,note,evidence}), candidates(opts:{run_id?,limit?,status?}). Candidate reserved payload cannot be forged by model add; legacy direct host operations do not silently review.
4. Integrate curation before query-hit rule: pending/rejected status excluded; accepted requires current promotion/review/digests and same scope. Recheck content and active evidence read-only. Review state is not mutable body revision; no code anchors or transitive semantic validation.
5. Adapter bound host exposes proposal/review/list with immutable session attribution. Model tools memory_net_propose(text,confidence,source_ids), memory_net_candidates(query/limit) identify source events from current physical scope. No selectors; no review ability; existing session-mode inference writes become proposals requiring source_ids/based_on, advisory tips remain separately labelled tips.
6. Real two-version session probe fixture: event→model proposal→pending excluded→host fixture verification observation+review→accepted in curated prompt→scope-specific id readback, reject stale source/reviewer failures; no real user data. Preserve raw calls and PR7 boundaries.
7. Run core/adapter/root/search suites, session and compatibility hosts, update policy fingerprint/required candidate checks, source and dependency test audits. Scope/Lifecycle security requirements documented. Fresh verification before each commit/push.
8. Submit stacked PR against memory-session-boundary (PR7) with one scoped candidate change; update PR7 only for review bug fixes. No merge/deploy; report automatic semantic extraction is not implemented and host verification receipts are not a truth oracle.

## Deferred
Cross-session grants, automatic semantic summarizer, code anchors/immutable node revisions, arbitrary raw secret redaction, OS confidentiality, candidate review UI, unbounded historic source fetch and professional task correctness.
