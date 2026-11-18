# Third-party notices

## Aliyun captcha helper

`captcha/captcha-happy.ts` is adapted from [TriDefender/zcode-api](https://github.com/TriDefender/zcode-api). Copyright (c) 2026 TriDefender and the ZCode Proxy contributors.

The upstream work is licensed under **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International**. The unmodified upstream notice and full license text are preserved in [captcha/LICENSE.upstream](captcha/LICENSE.upstream). Adapted captcha source retains that license; do not treat it as MIT/ISC or use it commercially without separate permission.

This copy changes the integration to a Go-owned Node stdio sidecar, with context-bound process management, bounded output and cancellation/recovery. The captcha SDK itself is not vendored; runtime CDN downloads remain upstream-controlled. Source attribution does not establish SDK bypass guarantees.

## Other dependencies

`github.com/google/uuid` and npm dependencies (`happy-dom`, `undici`, `esbuild`) retain their respective upstream licenses. Their dependency source trees are not copied into this repository. Consult the license notices distributed by their versions before redistributing dependency bundles or binaries.

No new blanket license is asserted for unrelated agents-hub content by adding this directory.
