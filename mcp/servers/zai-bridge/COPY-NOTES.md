# Copy provenance

- Version: 0.3.1
- Copied from the locally repaired zai-bridge project on 2026-11-13.
- Destination: agents-hub/mcp/local/zai-bridge and the matching local skills collection.
- Includes Go source and tests, captcha TypeScript source, package lock, Docker/compose definitions, documentation and verification summary.
- Excludes real accounts/config credentials, HARs, private DSH overrides, `.tmp`, test/build caches, `node_modules` and Qwen analysis.
- Public repository contains source, not platform binaries or generated captcha build output. Build locally with Go and npm, or Docker. Local mirror additionally retains the existing 0.3.1 Windows/Linux binaries and generated captcha JS.
- No live Z.ai requests or message sends were used for copy validation. Existing DSH runtime configuration remains pointed at its original executable; this copy does not silently move it.

See [REPAIR-NOTES.md](REPAIR-NOTES.md) for behavior and testing limits, and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for the inherited captcha license.
