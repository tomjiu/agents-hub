# Memory Host Context Boundary Implementation Plan

> Execute inline; no subagents. Do not alter current Web/profile or user data.

**Goal:** Bind automatic observations, writes, recall and prompt injection to trusted session/project identity rather than model workspace selectors.

**Architecture:** Adapter context.mode defaults session; explicit shared preserves old host-controlled behavior. Required DSH injections agents/workingDirectory are verified from rc.1 installed declarations and source. ToolRunContext.agent and AssembleContext.agent/scope resolve through agents.get(exact session ID) identity comparison; use workingDirectory.get(session), canonical realpath and platform case normalization. Derive physical root scoped-v1/p-SHA256/s-SHA256; invalid/missing identity fails closed (tools reject, automatic observation skipped with warning, prompt empty). No process-global current agent state. Session ID drives run_id and session-context progress slot; not a business task ID. Keep host services capability-based with forAgent(agent), revalidate exact identity/current directory on each bound operation. Legacy methods denied in session mode; close works. No automatic old database import.

**Tech stack:** Node TypeScript, fs.realpathSync/SHA256, SQLite existing schema. Use short isolated worktree E:/Code/ai/mn-context (nested unused worktree move failed because held directory; no loaded runtime moved).

## Execution status

Implemented inline in short branch memory-session-boundary at E:/Code/ai/mn-context. Nested unused worktree move failed and was left intact; no live runtime moved. Three behavioral red regressions reproduced and fixed. Both real rc.1/rc.5 probes pass three-session/project isolation and shared compatibility. Core39, adapter29, search335, root149 pass/1 skip. No live adoption; candidate extraction remains later stage. Checkboxes below are replay steps, not deployment authorization.

## Tasks
- [ ] Add adapter tests reproducing two project/two session isolation, forged handles, model workspace/run/task injection, missing context, cancellation, registered identity, cwd switch, resumed same session, concurrent async event completion and prompt agent/scope mismatch. Compare database counts and prevent old root access.
- [ ] Run red; then context.ts resolver, structural contract additions, explicit session/shared configuration. Required injection changes wrapper dsh-bundle and tests; missing services may keep plugin inactive in real Cordis (safe). Manual missing-service tools reject/empty prompt; never fallback shared.
- [ ] Add HostApi.forAgent and stateless bound execution. Model execute accepts exec.agent, strips scope selectors from schema and rejects them at runtime in session mode. Auto-observe resolves execution agent independently. Prompt resolves assembly agent/scope and requests current run/session-context slot. Do not use latest global agent or model arguments.
- [ ] Update legacy adapter fixtures/probes to explicit shared mode and declare additional injections. Raw mode is selection only, not escape from context authorization.
- [ ] Verify core/adapter/search/root regressions and package integrity; inspect generated wrapper injections.
- [ ] Actual isolated rc.1/rc.5 headless probes: two sessions in same project with separate scoped stores, second project, explicit forbidden selectors, prompt matches trusted identity, default root untouched; local scripted model not live user account. Seed durable tips via bound host fixture, automatic logs still persisted. Repeat same bound session in same host contract test; fresh process resume only if actually exercised, otherwise disclose.
- [ ] Record audit, mode migration/access limits and dependent candidate-extraction future stage. Submit independent PR with reviewed head; no live adoption or automatic merge.

## Limits
Physical cwd is project boundary, not git root; moving projects creates a new scope and symlink aliases canonicalize. Root filesystem/host tools remain privileged, this is adapter access control not OS confidentiality. Independent sessions do not auto-share decisions, forks do not inherit private scopes. Business task IDs and explicit cross-session/project candidate promotion are deferred. No immutable revisions, code commit anchors, semantic candidate extraction or secret redaction in this stage.
