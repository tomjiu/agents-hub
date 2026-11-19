# Security review checklist

Local companion added during agents-hub resource audit; not claimed as recovered upstream material. This is review guidance, not penetration-test authorization.

## OWASP Top 10 (2021 ordering)

A01 Broken Access Control; A02 Cryptographic Failures; A03 Injection; A04 Insecure Design; A05 Security Misconfiguration; A06 Vulnerable and Outdated Components; A07 Identification and Authentication Failures; A08 Software and Data Integrity Failures; A09 Security Logging and Monitoring Failures; A10 Server-Side Request Forgery. Labels describe the 2021 list, not a claim about a later edition.

## Before release

- Identify assets, actors and trust boundaries; map authn/authz checks server-side.
- Validate input size/schema; parameterize queries; encode output; do not execute model/tool output as code.
- Test unauthorized cross-user access, replay, path traversal, malicious uploads, redirects/private-address requests, timeouts and cancellation.
- Keep secrets outside source/logs/prompts; scoped credential mapping only.
- Check secure session cookies, CSRF requirements, CORS, HTTPS and applicable security headers.
- Ensure errors do not leak internals; audit security events without logging private payloads.
- Record remaining risks and explicit human decisions. Keyword scans and this checklist are not a complete security/legal audit.

## Dependency boundary

Use the workspace that owns the authoritative lockfile. Corroborate packageManager, lockfile and CI. Stop on conflicting managers; use the recorded tool version. Review new dependency identity, transitive packages and install hooks. Examples after review: npm ci --ignore-scripts, pnpm install --frozen-lockfile --ignore-scripts, Yarn classic --frozen-lockfile --ignore-scripts, modern Yarn --immutable with enableScripts=false configured. Do not mix managers or overwrite project policy to make an install pass.

Run that manager native audit against the lockfile where supported (npm audit, pnpm audit, Yarn classic audit, modern Yarn npm audit); triage reachability and fix risk. Commands require installed/version-pinned tools and may need network. Audit availability or zero findings is not proof of safety.
