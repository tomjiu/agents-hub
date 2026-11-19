---
name: firmware-analysis
description: Use for firmware image analysis (router/IoT dumps) — binwalk extract, filesystem recovery, light emulation pointers. Authorized hardware/firmware only. Prefer official tool docs from local catalog.
---

# Firmware Analysis

## Authorization

Only on firmware/images you own or have written permission to analyze.

## Local catalog / mirrors

- `<agents-hub>/catalog/sources.toml` → `firmware`
- Awesome lists under `sources/re-security-mirrors\` (related security lists)
- Tools (install separately): Binwalk, FirmAE, Firmadyne, EMBA — URLs in catalog

## Minimal flow

1. Identify image type (`file`, entropy, headers)
2. `binwalk -e` / signature scan; extract FS
3. Inventory: busybox, web UI, hardcoded keys, outdated libs
4. Optional: emulated runtime (FirmAE etc.) only if needed and licensed
5. Notes + findings; no weaponized exploit delivery by default

## Related

- `reverse-engineering-workflow`
- `security-workflow`
- `source-index`

Portability: resolve upstream URLs from catalog/sources.toml at the agents-hub root. Optional mirrors are not bundled or assumed installed; review versions and licenses before enabling.

