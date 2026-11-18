---
name: dfir-workflow
description: Use for digital forensics / incident response workflows — memory, disk, timeline. Defensive investigation. Prefer Volatility3, Velociraptor, Plaso, Autopsy from catalog URLs.
---

# DFIR Workflow

## Scope

Defensive investigation on systems/data you are authorized to examine.

## Canonical tools (catalog)

| Need | Tool | Catalog section |
|------|------|-----------------|
| Memory | Volatility3 | `dfir` |
| Endpoint | Velociraptor | `dfir` |
| Timeline | Plaso / Timesketch | `dfir` |
| Disk | Autopsy / Sleuth Kit | `dfir` |

Local URLs: `<agents-hub>/catalog/sources.toml`

## Flow

1. Preserve evidence (hash, read-only)
2. Triage: what, when, which hosts
3. Memory and/or disk analysis with official tools
4. Timeline + IOCs
5. Report: facts first, confidence levels

## Related

- `security-workflow`
- `systematic-debugging` for tooling failures
- `verification-before-completion` before closing incident

Portability: resolve upstream URLs from catalog/sources.toml at the agents-hub root. Optional mirrors are not bundled or assumed installed; review versions and licenses before enabling.

