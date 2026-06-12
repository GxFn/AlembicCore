# Foundational Health Register (AD5 — deliberate no-action entries)

The AD0-confirmed AD5 list closes with these areas recorded as healthy BY
DECISION — they were examined and deliberately left alone. Re-opening any
entry requires new measurement evidence, not vibes.

| Area | Verdict | Why no action | Review trigger |
| --- | --- | --- | --- |
| SQLite WAL + busy_timeout stance | healthy, deliberate | CO3 C7 user decision: WAL + 3s busy_timeout is the whole contention policy; busy errors surface via `core.diagnostic.db.sqlite-busy` instead of being retried away (documented in DatabaseConnection.ts) | real contention evidence accumulating under the busy diagnostic |
| Drizzle hybrid + gap-tolerant migrations | healthy | name-tracked per-file transactional runner with documented 002/003 gaps; re-run idempotency + partial-failure recovery proven by MigrationsRerunIdempotency suite (CO4) | a migration that cannot express itself in the current runner model |
| Pure-JS HNSW vector index | healthy | sparse-coverage tests owned; WAL-backed persistence (AsyncPersistence) with replay; no native dependency risk | measured recall/latency regression on real workloads |
| ConfigWatcher | healthy | native glob watcher + debounce; #disposed-guarded dispose verified in the AD4 listener census | watcher leaks or missed-change reports from a real host |

Companion registers: toolchain floor lives in
`config/space-allowed-edges.json` (AD1); lint debt in `docs/lint-debt.md`;
blessed singletons in `config/blessed-singletons.json` (AD4).
