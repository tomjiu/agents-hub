---
name: ts-performance
description: Use when optimizing TypeScript/Node or frontend performance — profiling, bundle size, async bottlenecks, React render costs. Measure with real tooling before rewriting.
---

# TypeScript / JS Performance

## Sources

- Node diagnostics: https://nodejs.org/en/learn/diagnostics
- TypeScript: https://github.com/microsoft/TypeScript
- Web Vitals / browser: use DevTools Performance panel or Chrome DevTools MCP when UI-bound
- Local: `performance-optimization` skill (Addy) for broader checklist

## Rules

1. Separate **Node server** vs **browser** bottlenecks.
2. Prefer profiler evidence over “switch library” guesses.
3. Keep TypeScript `strict` gains; don’t disable checks for speed myths.

## Node

```bash
node --cpu-prof app.js
node --heap-prof app.js
# clinic / 0x / chrome://inspect as available
npm run build   # compare bundle analyzer if frontend
```

## Browser / frontend

- Performance panel: long tasks, layout thrash, LCP/CLS/INP
- React: unnecessary re-renders, list virtualization, memo only when measured
- Network: waterfalls, cache, compression

## Checklist

- [ ] Repro scenario fixed
- [ ] Profile captured (CPU or Performance trace)
- [ ] Top cost named with evidence
- [ ] Patch + before/after metric

## Related

- `performance-optimization`
- `browser-testing-with-devtools` / playwright MCP when UI
- `source-driven-development` for framework docs
