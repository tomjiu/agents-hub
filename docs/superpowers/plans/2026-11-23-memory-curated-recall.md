# Memory Curated Recall Implementation Plan

> Execute inline after the search reliability milestone; no subagents.

**Goal:** Keep durable decisions and task-relevant tips visible instead of injecting raw automatic tool logs.

**Architecture:** Add a read-only curated projection over existing nodes, not a schema migration or deletion. Core activate keeps raw mode by default for API compatibility; DSH recall/injection uses curated mode by default, with explicit raw recall for diagnosis. Constraints remain protected; task/run scope and query evidence filter optional material. Reviewed inference remains an inference, not a verified fact. Expose excluded counts/reasons and IDs/dependency IDs without automatically promoting evidence.

**Tech Stack:** Existing SQLite store, pure TypeScript selection, node:test; no embeddings, new databases or credentials.

### 1. Non-destructive projection
Files: `plugins/memory-net/src/curation.ts`, `src/types.ts`, `src/store.ts`, `tests/12-curated-recall.test.ts`.
- [ ] Seed 30 automatic observations (payload.tool and no subject key), one relevant tip, one reviewed inference, one unrelated tip, task A/B progress, and an active constraint. Capture exportPackage before/after.
- [ ] Add `ActivateOpts.view?: "raw"|"curated"` and `ActivationResult.curation?: {view,excluded,reasons}`. Assert `activate("SQLite WAL",{view:"curated",task_id:"A"})` excludes automatic logs/unrelated task B material, retains constraint/task A/tip/promoted, and does not mutate the export. Assert raw still exposes observations.
- [ ] Implement pure candidate eligibility: automatic observations carrying payload.tool are excluded; explicit semantic observations may pass query evidence; unrelated scoped material is excluded; nonempty query requires literal token hit; empty-query projection keeps tips/reviewed inference and matched-context decisions only, not all active inference or all other tasks progress. No CJK fuzzy semantic claims.
- [ ] Keep frozen constraints; curated progress freezes only explicit current context (or unscoped progress with no current context), not every task. Filter competitors before rank/budget; add excluded stats. Preserve lifecycle/GC/evidence graph.
- [ ] Run core tests, verify no deletion/rewrite, commit.

### 2. DSH entry and rendering
Files: `plugins/memory-net/adapters/dsh/src/config.ts`, `src/bridge.ts`, `src/index.ts`, `tests/curated-recall.test.ts`.
- [ ] Add config `recall.view` default curated, opt-in raw; memory_net_recall schema gets view enum and rejects malformed view at execution. activateOpts accepts optional view and forwards it. Automatic prompt injection uses config view; tool explicit raw affects that call only.
- [ ] Regression with real adapter mock: seed raw observation noise plus durable tip, assert prompt/recall show tip not raw; explicit raw returns diagnostic observation. Existing raw/core callers remain compatible.
- [ ] Render ID, based_on and promoted status as reviewed inference; never call promoted a verified observation. Display curation counts.
- [ ] Run adapter/core/root tests and actual isolated DSH host probe with auto-observation persistence unchanged; host probe injection fixture can select raw for legacy path and separately exercises curated projection.
- [ ] Document modes, storage/noise limits, query matching and lack of immutable revisions/code anchors; add audit with captured before/after fixture and host evidence.

### 3. Submission
- [ ] Both hosts, full search/core/adapter/root regression, catalog validation and original-asset checks. Do not change canonical Skills, profile, current runtime bundle or user database.
- [ ] Push isolated branch and review PR; report improvement and remaining external reliability/semantic recall/GC and concurrency limitations honestly.
