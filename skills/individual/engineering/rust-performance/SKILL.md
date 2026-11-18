---
name: rust-performance
description: Use when optimizing Rust code or investigating slow builds/runtime — criterion benches, profiling, release flags, alloc pressure. Measure first; prefer official perf guidance.
---

# Rust Performance

## Official / canonical

- The Rust Performance Book: https://nnethercote.github.io/perf-book/
- Cargo benches: https://doc.rust-lang.org/cargo/reference/profiles.html
- Local catalog: `<agents-hub>/catalog/sources.toml` → `languages_perf`

## Rules

1. Always use **`--release`** for runtime perf claims.
2. Prefer **criterion** (or built-in benches) over one-off `time`.
3. Fix algorithmic/IO issues before micro-optimizing.

## Commands

```bash
cargo build --release
cargo test --release
cargo bench

# CPU (Windows: use cargo-instruments on macOS; on Windows try cargo flamegraph / samply if installed)
# cargo install flamegraph
# cargo flamegraph --bin mybin

# Allocation / heap (platform tools vary)
# RUST_LOG=... for app-level timing first
```

## Checklist

- [ ] Baseline bench numbers recorded
- [ ] Profile under realistic input
- [ ] Hot function identified
- [ ] Change + bench delta reported
- [ ] Unsafe only with clear justification + tests

## Related

- `performance-optimization`
- `test-driven-development` for regression benches
- reverse/debug tools only if native ABI issues

Portability: resolve upstream URLs from catalog/sources.toml at the agents-hub root. Optional mirrors are not bundled or assumed installed; review versions and licenses before enabling.

