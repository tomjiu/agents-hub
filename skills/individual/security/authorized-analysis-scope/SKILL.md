---
name: authorized-analysis-scope
description: Use before reverse engineering, security testing, firmware, mobile instrumentation, or automation against live systems — write explicit authorization and scope; refuse unclear targets.
---

# Authorized Analysis Scope

## Required before sensitive work

Create or update `SCOPE.md` in the project:

```markdown
# Scope
- Owner / authorization: ...
- Targets (hosts, binaries, APKs, firmware): ...
- Allowed techniques: static | dynamic | network (list)
- Out of scope: ...
- Data handling: where artifacts stored
- End date: ...
```

## Rules

- No scope file / no clear authorization → **do not** run dynamic instrumentation, scanning of third-party systems, or exploit-style automation.
- Prefer static analysis and local files when scope is narrow.
- Stickers/chat media are not “targets” for RE tooling.

## Related

- `reverse-engineering-workflow`
- `security-workflow`
- `firmware-analysis`
- `automation-workflow`
