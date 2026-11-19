---
name: security-workflow
description: "Use when designing or reviewing software security (AppSec) — threat model, secure coding, dependency/SAST/secrets scanning, supply chain. Index of tools: where to get, how to install, how to run, how chains fit. Prefer defense for product design."
---

# Security Workflow (defensive / product design)

Goal: when building software, the agent knows **which tools exist, where to download them, how to run them, and how they chain** — not necessarily pre-installed.

## When to load sibling skills

| Need | Skill |
|------|--------|
| Language secure coding (Py/JS/TS/Go) | `security-best-practices` |
| Threat model a repo/path | `security-threat-model` |
| Who owns sensitive code / bus factor | `security-ownership-map` |
| Checklist hardening (OWASP-style) | `security-and-hardening` |
| Incident / forensics | `dfir-workflow` |
| Firmware images | `firmware-analysis` |
| Find URLs | `source-index` + `catalog/sources.yaml` |

## Tool map (download + use)

### A. Dependencies & supply chain

| Tool | Get | Typical use |
|------|-----|-------------|
| **OSV-Scanner** | https://github.com/google/osv-scanner | `osv-scanner -r .` known vulns in lockfiles |
| **Trivy** | https://github.com/aquasecurity/trivy | `trivy fs .` / `trivy image <img>` FS+image CVEs |
| **npm audit / pip-audit / govulncheck** | language toolchains | `govulncheck ./...`, `pip-audit`, `npm audit` |
| **Syft + Grype** | Anchore | SBOM + vuln match |

### B. SAST / code patterns

| Tool | Get | Typical use |
|------|-----|-------------|
| **Semgrep** | https://github.com/semgrep/semgrep | `semgrep --config=auto .` |
| **CodeQL** | https://codeql.github.com | CI + GitHub Advanced Security |
| **Bandit** (Python) | pypi bandit | `bandit -r .` |
| **gosec** | securego/gosec | `gosec ./...` |

### C. Secrets

| Tool | Get | Typical use |
|------|-----|-------------|
| **gitleaks** | https://github.com/gitleaks/gitleaks | `gitleaks detect -v` |
| **trufflehog** | trufflesecurity | history + verified secrets |
| **detect-secrets** | Yelp | baseline + CI |

### D. Container / K8s / IaC (when relevant)

| Tool | Get | Typical use |
|------|-----|-------------|
| **Trivy** | above | image + config |
| **Checkov / tfsec** | bridgecrew / aquasecurity | Terraform/K8s policy |
| **Hadolint** | hadolint | Dockerfile lint |

### E. Web app (dev/staging you control)

| Tool | Get | Typical use |
|------|-----|-------------|
| **OWASP ZAP** | https://www.zaproxy.org | baseline / API scan |
| **Nuclei** | https://github.com/projectdiscovery/nuclei | template scans on **owned** staging |
| **httpx / katana** | projectdiscovery | recon helpers for assets you own |

### F. Standards & design

| Resource | URL |
|----------|-----|
| OWASP ASVS / Top 10 / Cheat Sheets | https://github.com/OWASP |
| MITRE ATT&CK (context) | catalog `security` |
| Secure SDLC | threat-model skill + ASVS |

Official org list also in `catalog/sources.yaml` section `security`.

## Recommended chains (product software)

### New feature / greenfield
1. `security-threat-model` (trust boundaries, assets)
2. Implement with `security-best-practices` for stack
3. Pre-commit: gitleaks + fmt/lint
4. CI: Semgrep + OSV/Trivy + unit tests
5. `verification-before-completion`

### Existing codebase review
1. Inventory (languages, auth, data stores)
2. `security-best-practices` + Semgrep/govulncheck
3. Secrets scan (gitleaks)
4. Deps (osv-scanner / trivy fs)
5. Optional: `security-ownership-map` for sensitive paths
6. Write findings with severity + fix PR

### Before release
1. Threat model delta (what changed)
2. Full dep + image scan
3. AuthZ checks on new endpoints
4. Logging/PII review (`observability` if available)

## Install notes (agent)

- Prefer **official GitHub releases** or language package managers.
- Windows: many tools ship `.exe` or `winget`/`scoop`/`choco`; Linux: release tarballs or distro packages.
- Do **not** invent CLI flags — read tool `--help` or official README after install.
- If tool missing: print exact download URL + one install command; do not fake scan results.

## Related local mirrors

- `sources/re-security-mirrors/awesome-pentest` (includes defensive tools too)
- `sources/mcp-ecosystem` (not security scanners by default)
- MCP draft: `catalog/mcp.draft.toml` (Ghidra/Frida when doing deep analysis)
- Offensive **methodology index** (tool chains, no payloads): `offensive-methodology`

## Output format for design discussions

When user is designing software, answer with:
1. Risks / trust boundaries
2. Controls (authn/z, crypto, validation, tenancy)
3. Tooling checklist (which scanner at which stage)
4. Links from catalog / this skill
