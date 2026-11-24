# Cache-Safe Memory Injection Implementation Plan

> Execute inline. No subagents, no live enablement/profile edits. Stacked on PR8.

**Goal:** Memory/log diagnostics must not rewrite the leading system prefix. Genuine memory updates must arrive as literal append-only runtime-context snapshots with existing scope/review/expiry policy intact.

**Architecture:** Static memory usage rules alone in systemPrompt.section. Actual memory via systemPrompt.context (interpolate:false, required:true), with deterministic selected-node order and no exclusion/token/dropped counts. Native DSH RuntimeContextProjection compares the entire current context to the retained snapshot, emits nothing if unchanged, appends a new durable user message when changed. No plugin latest-agent/global debounce/cache: each request revalidates current bound memory and stale evidence. Explicit empty snapshot retracts earlier memory, not silent empty return. Missing context API never falls back to dynamic system injection; tools remain and emit diagnostic. Tool recall keeps detailed statistics.

**Community reference:** haitang1/dsh-memory a218c920 v0.5.8 uses systemPrompt.context with interpolate:false and keeps stats separate; LZMW/dsh-memory3551f4c uses first-step append, but its once-per-agent freeze is unsuitable for our evidence invalidation. Read-only source, MIT metadata verified, no install/copy execution.

## Steps
- [x] Behavioral red: memory is not part of system; adding auto logs cannot change system or runtime memory bytes; explicit recall still reports counts; braces literal; valid new tip changes context only; invalidated accepted candidate disappears and explicit current-none snapshot supersedes old values; current scope switching retained; no context service -> never dynamic system fallback.
- [x] Implement prompt.ts pure static rules + content renderer. Preserve immutable ID/provenance labels and stable ordering; no volatile clock/counters. systemPrompt.context declared structurally optional, no extra services.
- [x] Adapt legacy unit fixtures to explicit context capture. Existing injection semantics now context not system; scoped raw/propose/review permissions unchanged.
- [x] Extend actual three-session scripted host model diagnostics: record leading system hash/length, previous messages-prefix comparison, constant tools hash. Observe memory none -> tip -> logs/no memory change -> candidate pending -> accept memory -> source invalidation -> retraction. Assert no system memory snapshots or diagnostic counters, literal braces preserved, append-only retained messages, no duplicate memory snapshots for counter-only changes. Source failure/context-clear must not freeze stale memory.
- [x] Two installed DSH rc.1/rc.5, both shared compatibility and scoped candidate loop. Fingerprint includes cache-safe policy; gate requires immutable system/append-only message evidence. Do not assert real provider hit rates from local model fixtures.
- [x] Full core/adapter/search/root regression, working-byte checks, community and incident audit (no private conversation export), stacked review PR. Web stays disabled, no re-enable without user explicit request.

## Limits
Whole runtime snapshot may append when other host contexts change; not each memory change alone. Compaction/model/tool changes and upstream TTL still affect cache. User-role memory remains untrusted context under stable system rules, not stronger system authority. Context renderer cannot revoke already-retained raw diagnostics, but current snapshot tells model old snapshots are superseded. Token budget approximate and frozen constraints may exceed soft budget. No semantic extraction/OS privacy/new grants.

## Verification record

TDD: original three cache behavior tests failed before changes; final four adapter tests pass. Gate failed with missing cache proof, now rejects old/incomplete evidence. Actual rc.1/rc.5 plus shared compatibility passed exact assets7a1b283f583a: static system/tools, prior full messages preserved as prefix, no counter churn, literal braces, candidate invalidation and empty retraction. Full root151pass/1skip, core44, adapter35, search335; catalog137PASS with baseline warnings. Current Web config equals user-shutdown receipt and memory tools absent. Working-byte check and PR publication are the remaining delivery steps, not live adoption.
