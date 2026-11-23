# Search Reliability Implementation Plan

> Execute inline with checkpoints; no subagents.

**Goal:** Deliver useful search candidates without letting irrelevant fast sources cancel useful slow sources or retaining transient empty results.

**Architecture:** Keep lexical evidence and source/SSRF policy unchanged. Router uses the original intent to count distinct relevant candidates, grants bounded recovery only when the soft cutoff has no evidence, and distinguishes orchestrator cancellation from provider failure. SearXNG divides the provider budget across its configured instances; empty or irrelevant primary batches trigger only allowed unattempted rescue providers. Degraded/empty responses are not stored as healthy search cache entries.

**Tech Stack:** Node TypeScript, node:test, injected fetch, isolated public-source probes. Baseline main 922fdb6; never build into the live review worktree.

## Execution status

Search milestone committed3210f79 with335 passing tests and isolated public-source samples; no live adoption. Compatibility decision: raw Router callers keep old raw-count semantics, SearchCore and Research pass original intent. Kept existing cache identity to preserve legitimate non-degraded selected-provider caches; empty/degraded reads and writes are now denied directly. Public samples are not paired A/B or guaranteed stable/updated results.

### 1. Scheduling and provider health
Files: `mcp/servers/search-core/typescript/src/router.ts`, `src/config.ts`, `src/types.ts`, `src/test/reliability.test.ts` (paths below the TypeScript package).
- [ ] Add regression: fast provider returns 20 unrelated refs, slow provider returns SQLite WAL evidence after early-harvest edge; assert slow evidence survives. Use four injected providers, `earlyHarvestMs:30`, `softDeadlineMs:100`, `timeoutMs:300`, `recoveryDeadlineMs:250`.
- [ ] Add regression: useful result at 140ms survives empty-evidence 100ms soft cutoff; useful fast result still cuts slow leg at soft cutoff; disabled soft cutoff respects hard timeout even for uncooperative providers.
- [ ] Add regression: canceled early-harvest leg remains visible in failures but does not open the provider breaker or write health after router return/Cache.close().
- [ ] Run `npm test --prefix mcp/servers/search-core/typescript` and confirm expected red assertions.
- [ ] Add CoreConfig recoveryDeadlineMs and SC_RECOVERY_DEADLINE_MS default 10000; clamp recovery to provider timeout. Pass original raw query as fourth optional Router.run argument from SearchCore. Compute qualified unique URLs using `filterEvidence(evidenceQuery,allRefs).refs`; early harvest requires >=15 qualified URLs and settled ratio >=.6. Soft edge with zero evidence extends only to bounded recovery deadline. Mark unfinished states before abort; late legs never write health. Return cancellation cause transparently, never count an orchestrator cutoff as upstream failure.
- [ ] Run targeted plus existing breaker/router/selection tests, then commit.

### 2. Endpoint fallback and recovery
Files: `src/providers/searxng.ts`, `src/engine.ts`, `src/test/reliability.test.ts`.
- [ ] Regression: first SearX instance stalls, second succeeds inside outer budget; outer abort must prevent remaining attempts.
- [ ] Give each SearX candidate `AbortSignal.any([ctx.signal,AbortSignal.timeout(instanceMs)])`, instanceMs derived from effective recovery/timeout divided across candidates, cap 2500ms. Stop immediately if ctx.signal.aborted; consume body inside attempt budget.
- [ ] Regression: narrow Github batch contains only unrelated raw results; allowed unattempted SearX rescue is called and returns evidence; explicit provider allowlist and [] never leak to other sources.
- [ ] Change rescue condition to `filterEvidence(rawQuery,batches.flatMap(b=>b.refs)).refs.length===0`, retain original-query evidence gate. Cache only non-degraded nonempty candidate responses; reject degraded cached entries. Include new policy version in cache identity.
- [ ] Run full search tests and isolated direct before/after probes on SQLite WAL concurrency and Zed DeltaDB; record per-source latency, HTTP errors and accepted/rejected refs. No claim that external endpoints always work.
- [ ] Commit code, tests and measured audit with explicit remaining gaps.

### 3. Acceptance boundary
- [ ] Run root tests/validate and both isolated DSH hosts after the memory stage. Verify pinned source fingerprints, static MCP discovery, result return and persistent isolated cache.
- [ ] Submit one review PR for the combined sequential work. Do not merge/adopt without a later request. Preserve current Web profile, its runtime source and user memory.
