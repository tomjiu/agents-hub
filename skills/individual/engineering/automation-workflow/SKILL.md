---
name: automation-workflow
description: Use when building batch automation, agent pipelines, scheduled jobs, or multi-step unattended scripts. Prefer durable plans, checkpoints, and authorized scopes only.
---

# Automation Workflow

## When

- Multi-step jobs without constant human steering
- Batch RE/analysis, scraping, report generation, CI-like local loops
- Hermes cron / Codex long jobs / shell pipelines

## Rules

1. **Scope + authorization** written first (paths, targets, rate limits).
2. **Idempotent steps** + checkpoint files (resume after crash).
3. Log inputs/outputs; never invent tool results.
4. Prefer existing tools (Hikari search, keenable fetch, Ghidra headless, project CLIs) over new frameworks.
5. Offensive automation only on authorized systems.

## Pattern

```text
plan.md          # goals, steps, success criteria
state.json       # current step, retries, artifacts
artifacts/       # outputs
```

1. Write plan (or load `writing-plans`)
2. Execute step N; write artifact; update state
3. On failure: record error, backoff, do not silently skip verification
4. Finish with `verification-before-completion`

## Related local assets

- Search: Keenable / Tavily Hikari MCP
- RE batch: `ghidra-headless-mcp` mirror (enable when Ghidra ready)
- Skills: `writing-plans`, `executing-plans`, `reverse-engineering-workflow`

## Avoid

- Unbounded browser MCP loops for simple HTTP
- Loading every reverse skill at once
