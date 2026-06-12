# Entrypoint Effects — Declared Inflow/Outflow (AD6)

Core's public entrypoint families and what each MAY touch. Pinned by
`test/EntrypointEffects.test.ts` (no-undeclared-effects snapshots on
representative calls with temp data roots). Effects not listed here are
undeclared — finding one is a doctrine violation to report, not to absorb.

## Family 1 — package facades (`@alembic/core` root + subpath exports)

Consumed by Alembic, AlembicAgent, AlembicPlugin (space-edge config).

- **Importing performs NO work**: no filesystem, no network, no env-driven
  branching beyond constant construction (AD4 doctrine; proven by the
  clean-child-process import snapshot across eight facade families).
- **Runtime persistence** happens only after explicit configuration and
  only under the provided data root: SQLite files under `<root>/.asd/`
  (PathGuard-checked), knowledge-base files under `<root>/<kbDir>/`,
  logs under the configured log dir (write-safety redirected otherwise),
  global caches only under `~/.asd/{cache,snippets}` via the documented
  Paths helpers.
- **Network**: none. Core owns no transports (charter); embedding/LLM
  calls go through INJECTED providers owned by the caller.

## Family 2 — shipped scripts tooling (`files[]` scripts/, no bin)

`package.json` has NO `bin` field — Core ships no installable CLI. The
shipped `scripts/*.mjs` are read-only verification gates (boundary,
consumer-import, release-readiness, closeout report) run locally via
`node`; they read the repo + sibling checkouts and write nothing but
their stdout reports.

## Families that do not exist here (charter-confirmed)

- HTTP/server hosting: none (Alembic owns routes/daemon).
- Daemon processes: `@alembic/core/daemon` exports CONTRACT types and
  feature flags only — no process is started by Core.
- UI: none.
