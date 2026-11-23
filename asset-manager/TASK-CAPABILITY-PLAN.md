# Task Capability Discovery Implementation Plan

> Execute inline with review checkpoints; no subagents. Steps use checkbox syntax.

**Goal:** Add a curated task directory without moving Skill sources or weakening asset review.

**Architecture:** Separate catalog/capabilities.json describes task aliases, groups, stages and ordered asset references. Each reference pins the reviewed SKILL.md digest and discloses its limits. core/capabilities.mjs joins these references to live catalog metadata and existing usability checks; unknown queries return no match, changed Skill bodies require a new mapping review. No inventory search fallback, activation or automatic execution.

**Tech Stack:** Node ESM, existing catalog/usability helpers, SHA256, node:test; no new dependencies.

## Execution status

Implementation and local acceptance complete:14 routes/15 distinct Skill assets,10 targeted tests; full suite148 pass/1 permission skip. Original123 canonical Skills and137 assets preserved; no runtime adoption. Evidence: [task-capability-discovery](<../catalog/audit/task-capability-discovery.json>). Submission remains a separate review branch, no automatic merge. Plan checkboxes below describe the replay workflow, not authorization to repeat installation or deployment. The planned skills-directory link is provided through the root/catalog onboarding instead, keeping the entire skills source tree byte-identical.

## Contract and tasks

- [ ] Write asset-manager/tests/capabilities.test.mjs before implementation. Require listCapabilities(root,{group,client}) and findCapabilities(root,query,{group,client,limit}) exports, planning→writing-plans, acceptance→verification-before-completion, UI→frontend-design, automation testing→webapp-testing, browser CLI→playwright. Unknown topic must return NO_MATCH. Office workflows must disclose partial scope, not claim new Skills. Vendor and Office licensing blockers must remain visible.
- [ ] Run node --test asset-manager/tests/capabilities.test.mjs and confirm missing-module red result, then implement module and data. Strictly validate schema=1, groups, unique route/asset IDs, nonempty aliases/limits/reasons, known referenced Skill IDs, SHA256 digests, controlled stages and no undeclared fields.
- [ ] API outputs routes with id/title/group/domains/stages/aliases/limitations/providers. Provider joins id/name/path/source/license/usability/blockers/requirements/warnings/current digest/mapping_status/fit/reason/limitations. Mapping status CURRENT means only the reviewed body matches, not legal/runtime approval; changed/missing content is REVIEW_NEEDED. Status PARTIAL_CANDIDATE when route scope is partial, UNAVAILABLE if no current nonblocked provider, otherwise CANDIDATES. No MATCHED/VERIFIED runtime assertion.
- [ ] Matcher uses normalized NFKC complete literal aliases, ASCII word boundaries, never CJK fragments/description substring scoring. Preserve all matched intents; expose total_matches before limit. Exact route ID works. Validate query 1..500 and limit 1..20, client/group; unknown input rejects.
- [ ] Add temporary fixture tests for missing/changed source, malformed registry, duplicate/unknown IDs, vendor barriers, exact limits, no state writes. Re-read actual candidate bodies, pin current bytes, show uncovered capabilities explicitly; do not classify all123Skills from directory names.
- [ ] Add CLI capabilities and find-capability with strict option validation; tests spawn actual CLI. validate checks capability registry if present, not required for old recovery fixtures. Existing search-assets remains unchanged.
- [ ] Generate catalog/CAPABILITIES.md deterministically from registry labels/links/limits (not frozen readiness), document live CLI for statuses. Add README/catalog/skills links without altering Skill files, Experts, locks, provenance or runtime.
- [ ] Run new tests, complete root tests and catalog validation. Build original memory baseline in this worktree if existing root probes require dist; never touch original live artifacts. Verify git diff has no skills/,plugins/,mcp/ or catalog/assets changes. Commit meaningful stage, push separate branch and create one review PR, no auto-merge or live profile changes.

## Acceptance commands

~~~sh
node --test asset-manager/tests/capabilities.test.mjs
node asset-manager/cli.mjs find-capability "需求分析与规划"
node asset-manager/cli.mjs find-capability "办公质量验收"
node asset-manager/cli.mjs find-capability "UI设计"
node asset-manager/cli.mjs find-capability "自动化测试"
node asset-manager/cli.mjs capabilities --group office
node --test asset-manager/tests/*.test.mjs
node asset-manager/cli.mjs validate
~~~

These prove task routing and inventory barriers, not task execution, semantic understanding, full asset classification or DSH adoption. This CLI-only independent module does not change deployed Skill/runtime entry points. Memory PR4 remains separate.
