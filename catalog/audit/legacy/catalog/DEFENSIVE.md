# Defensive security layer (product design)

**Standard:** agent should know tools → download URLs → how to run → which chain — not all pre-installed.

## Skills (selected)

| Skill | Role |
|-------|------|
| `security-workflow` | Master index: tool map + chains for design/review |
| `security-best-practices` | Lang/framework secure coding (Py/JS/TS/Go) |
| `security-threat-model` | Repo-grounded threat model |
| `security-ownership-map` | Sensitive code ownership / bus factor |
| `security-and-hardening` | Checklist-style hardening |
| `dfir-workflow` | Incident / forensics tool pointers |
| `firmware-analysis` | Firmware image analysis pointers |
| `authorized-analysis-scope` | SCOPE.md template when testing live systems |
| `verification-before-completion` | Evidence before “secure/fixed” |

## Tool chains (summary)

- **Design:** threat-model → ASVS/OWASP controls  
- **Code:** security-best-practices + Semgrep / gosec / bandit  
- **Deps:** OSV-Scanner, govulncheck, npm audit, Trivy fs  
- **Secrets:** gitleaks, trufflehog  
- **Images:** Trivy image  
- **Owned staging web:** ZAP / Nuclei (careful)

URLs live in `security-workflow` skill body + `sources.yaml` `security` / `dfir` / `firmware`.

## Not required open-box

Scanners need install at use time; skills only document get + run.

## Offensive capability index (no payloads)

- Skill: `offensive-methodology` — PT phases + tool map distilled from awesome-pentest/RE lists
- Explicitly excludes exploit PoCs and injection recipes; anti-prompt-injection rules included
- Pair with `security-workflow` when designing mitigations
