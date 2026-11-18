# Fixed-start vs on-demand

## Fixed-start (keep loaded / always discoverable)

These should stay in `selected/` and tool skill dirs:

| Skill | Why |
|-------|-----|
| `source-index` | Local catalog + mirror map |
| `repository-skills` | Search remote repos, download, review, then promote |
| `systematic-debugging` | Default bug path |
| `verification-before-completion` | Don't claim done without evidence |
| `writing-plans` / `executing-plans` | Multi-step work |
| `test-driven-development` | Feature/bugfix discipline |
| `mcp-builder` | When building MCP servers |
| `skill-creator` | When authoring skills |

Optional fixed if you use them daily: `playwright`, `pdf`/`docx`/`xlsx`.

## On-demand (many is OK)

- Domain packs: reverse / security / Godot / language performance
- Full Superpowers / Addy packs (install pieces, not whole universe every session)
- Marketplace MCP servers from Glama/Smithery after index lookup

## Install policy

1. Lookup URL via `source-index` + `catalog/sources.yaml`
2. Prefer official org repo
3. Install into `sources/` or `archive/` first; promote to `selected/` only if weekly use
4. Codex: **copy** into `~/.codex/skills` (don't delete app skills)
5. OpenCode: `skills.paths` points at `selected/` only

## Expand plan

Grow `sources.yaml` toward 300–500 entries by appending:

- vendor official MCPs
- RE/DFIR awesome lists + org roots
- agent ecosystem skills/rules repos
- CN mirrors: ModelScope / SkillHub
