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

With a knowledge file store configured, `KnowledgeService` create, edit,
quality, lifecycle and delete commands, Guard mutations and sustain updates share an
internal single-entry write coordinator. File rejection raises `FileWriteError`
before the DB write. For creation and updates, DB failure or mismatched write readback raises
`DivergenceError` (`STATE_DIVERGENCE`), retains the durable file and names
`KnowledgeSyncService.sync` as the repair route. Success events follow the
confirmed write. The SQLite repository also rejects an UPDATE that affected
zero rows, since reading an old row with the same ID does not confirm a write.

Automatic relationships and reverse-reference cleanup also persist their
Markdown truth. Deletion waits for reverse-reference cleanup before removing
the main row; the repository removes dependent proposals, warnings and
lifecycle rows in one SQLite transaction. For a failed DB deletion the repair
route is `KnowledgeService.delete` with the same ID. An already absent file
is compatible with index cleanup; unreadable or ambiguous ownership is an
error. Deletion does not promise atomic rollback of multiple files and DB rows.

Constructors without a file store keep the legacy DB-only behavior and emit a
diagnostic. Synchronous multi-entry `KnowledgeUnitOfWork` transactions remain
separate: neither coordinator promises atomic rollback across Markdown files
and SQLite. Shared coordination does not change caller permissions, lifecycle
rules, storage layout or public constructor parameters.

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
