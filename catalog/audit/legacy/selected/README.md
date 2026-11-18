# `selected/` = **enabled skills only**

Put here only skills that Codex / OpenCode should **discover** (description list / on-demand load).

## Rules

1. **Skills only** — no MCP server code, no random git clones.
2. Prefer thin `SKILL.md` (+ small refs). Heavy packs stay in `../sources/packs/` and are **junctioned or linked by path** when needed.
3. New community skills: download under `../sources/` → review (`repository-skills`) → then copy/junction **here**.
4. Disable a skill = move to `../archive/` or remove from this folder (and remove Codex copy under `~/.codex/skills` if present).

## Wiring

| Client | How it sees this folder |
|--------|-------------------------|
| OpenCode | `skills.paths` → `E:\Code\skills\selected` |
| Codex | Skills **copied** to `~/.codex/skills` (app may not follow this path alone) |

## Not enabled skills

- Full packs: `../sources/packs/`
- Mirrors / awesome: `../sources/mcp-ecosystem/`, `../sources/re-security-mirrors/`
- Catalog only: `../catalog/`

## Index skills

- `source-index` — map of local catalog + mirrors
- `repository-skills` — search remote repos → download → review → promote **into this folder**
