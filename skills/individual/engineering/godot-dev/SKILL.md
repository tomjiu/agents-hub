---
name: godot-dev
description: Use when working on Godot 4.x projects (GDScript/C#, scenes, signals, export, debugging). Prefer local Godot skill packs under sources/packs before inventing patterns.
---

# Godot Development

## Optional packs (resolve using catalog/sources.toml)

| Pack | Path | Role |
|------|------|------|
| **haxqer/godot-skill** (Codex-oriented) | `<optional-local-mirrors>/packs\godot-skill-haxqer\` | Project checks, scenes, nodes, signals, run/debug, export |
| **GodotPrompter** | `<optional-local-mirrors>/packs\godot-prompter\skills\` | Many domain skills (2d/3d, animation, save-load…) |
| **agent-skill-godot** | `<optional-local-mirrors>/packs\agent-skill-godot\` | Typing, docs lookup, GUT tests, editor MCP notes |

Primary single skill file often at:

- `godot-skill-haxqer/skill/godot/SKILL.md`
- `agent-skill-godot/SKILL.md`

## Official

- Engine: https://github.com/godotengine/godot
- Docs: https://docs.godotengine.org

## Minimal workflow

1. Confirm Godot **4.x** version and project root (`project.godot`).
2. Load the matching pack skill (prefer haxqer for Codex).
3. Scene/node changes → keep signals explicit; prefer typed GDScript when pack recommends.
4. Run from editor or CLI; fix errors before art polish.
5. Export only after run/debug passes.

## Do not

- Invent APIs that contradict current Godot docs.
- Dump entire GodotPrompter (59 skills) into context — open **one** domain skill.

## Related

- `source-index` for URLs
- `web-search-hikari` / Context7 if docs offline mirror missing

Portability: resolve upstream URLs from catalog/sources.toml at the agents-hub root. Optional mirrors are not bundled or assumed installed; review versions and licenses before enabling.

