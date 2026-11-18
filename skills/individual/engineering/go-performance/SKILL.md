---
name: go-performance
description: Use when optimizing Go services or diagnosing CPU/memory/latency issues — pprof, benchmarks, escape analysis, tracing. Measure first; prefer official Go diagnostics.
---

# Go Performance

## Official sources (prefer)

- Diagnostics overview: https://go.dev/doc/diagnostics
- Profiling blog: https://go.dev/blog/profiling-go-programs
- pprof: https://github.com/google/pprof
- Local catalog: `<agents-hub>/catalog/sources.toml` → `languages_perf`

## Rules

1. **Measure before change** — no micro-optimizations without profile evidence.
2. Collect **one profile type at a time** (CPU vs heap vs mutex interfere).
3. Optimize the hot path that shows in flamegraph / top, not guesses.

## Commands

```bash
# Benchmarks
go test -bench=. -benchmem ./...
go test -bench=BenchmarkFoo -cpuprofile=cpu.out -memprofile=mem.out .

# Interactive pprof
go tool pprof -http=:0 cpu.out
go tool pprof mem.out

# HTTP pprof (import _ "net/http/pprof" + expose carefully)
# curl -o cpu.pb.gz "http://127.0.0.1:6060/debug/pprof/profile?seconds=30"

# Escape / inlining notes (debug builds)
go build -gcflags=all="-m=2" ./...

# Execution trace
go test -trace=trace.out .
go tool trace trace.out
```

## Profile types (runtime/pprof)

| Profile | Use for |
|---------|---------|
| cpu | hot functions, CPU-bound work |
| heap | allocations, leaks, GC pressure |
| goroutine | leaks, stuck stacks |
| block / mutex | contention (enable rates first) |

## Checklist

- [ ] Repro load exists (bench or realistic traffic)
- [ ] CPU or heap profile captured
- [ ] Top offenders mapped to code
- [ ] Change + re-bench / re-profile
- [ ] No prod pprof left open publicly

## Related

- `performance-optimization` (general)
- `source-driven-development` + Context7 for API docs
- `verification-before-completion`

Portability: resolve upstream URLs from catalog/sources.toml at the agents-hub root. Optional mirrors are not bundled or assumed installed; review versions and licenses before enabling.

