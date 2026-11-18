# Skill audit (2026-07-18)

## Self-authored / promoted skills scanned
Patterns: ignore-previous, eval, curl|bash, powershell -enc, FromBase64String, etc.

| Skill | Result |
|-------|--------|
| offensive-methodology | Clean (hit on anti-injection wording only) |
| security-workflow, reverse-engineering-workflow, source-index | Clean |
| web-search-hikari, keenable-cli, exa-search | Clean |
| go/rust/ts-performance, godot-dev, automation-workflow | Clean |
| firmware-analysis, dfir-workflow, authorized-analysis-scope | Clean |
| security-best-practices / threat-model / ownership-map | From OpenAI curated; not rewritten |

## External pack junctions
addy + tavily-hikari skills are junctions into sources/packs — treat as third-party; load one at a time; repository-skills rules apply if updating.

## Policy
New downloads must pass repository-skills review before selected/ promotion.
