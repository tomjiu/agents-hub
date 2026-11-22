# Performance review checklist

Local companion restored during agents-hub resource audit; not recovered upstream text.

1. Record the actual symptom, workload, hardware/runtime versions and success budget. The sample budgets in SKILL.md are examples, not universal SLAs.
2. Measure baseline latency distributions (p50/p95/p99), throughput, memory and error rate under the same input. Separate warm/cold cache and synthetic/real-user observations.
3. Trace the slow path: network, CPU, allocations, DB query count, render work. Do not optimize an unrelated microbenchmark.
4. Change one bottleneck at a time, preserve output and authorization semantics, and test normal/failure/concurrent paths.
5. Compare multiple repeated runs with the same workload. Report regressions, variance and trade-offs; do not claim improvement from one fastest sample.
6. Bound caches and check invalidation, user partitioning, sensitive-data exposure and eviction. Cache-Control public is inappropriate for private/authenticated responses.
7. Use project-pinned profiling/test tools; inspect dependencies before installing. Do not execute npx latest on a production project just to run a sample command.
8. Publish baseline/after evidence, unresolved limits and rollback steps. Add a regression test or monitoring budget grounded in user requirements.
