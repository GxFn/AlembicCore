# Public API Gates

Status: CO1 surface convergence, 2026-06-12. Machine-readable policy:
`config/public-api-boundary.json`. The policy file is the single source of
truth; this document explains the gate set and the standing decisions.

## Gate set in `npm run check` (all blocking)

| Order | Gate | Script | What failing means |
| --- | --- | --- | --- |
| 1 | `build:check` | `tsc --noEmit` | Type errors. |
| 2 | `lint:public-api-boundary` | `scripts/check-public-api-boundary.mjs` | Surface drift: unclassified exports, count growth, a removed export resurrected, unowned transitional surface, missing deprecation/review-by marks, a provisional facade above its narrowness budget, raised maxCounts, or a broken source-graph canonical invariant. |
| 3 | `lint:consumer-core-imports` | `scripts/lint-consumer-core-imports-all.mjs` | A sibling consumer repository (Alembic, AlembicAgent, AlembicPlugin) imports Core outside its own boundary config. Siblings absent from the checkout are reported as skipped — their own CI guards their trees. |
| 4 | `smoke:public-api` | `scripts/smoke-public-api.mjs` | A public entrypoint no longer imports, or a required symbol/type declaration is missing. |
| 5 | `test` | vitest | Behavior regressions. |
| 6 | `lint` | biome | Style/correctness lint. |

Gates 2 (narrowness checks) and 4 import the built `dist/`; run
`npm run build` after changing the export surface, otherwise they fail with an
explicit import error rather than passing silently.

## Smoke scope (honest statement)

`smoke:public-api` verifies **import accessibility only**: every exact export
path resolves and imports from `dist/`, required runtime symbols exist, and
required type names appear in declaration files. It is **not a behavioral
contract test** — behavior is covered by the vitest suites. A green smoke run
means "the surface is reachable", nothing more.

## Why `release:check` stays release-time

`release:check` (`scripts/check-release-readiness.mjs`) aggregates
release-shipping concerns (publish metadata, vendor/packaging readiness) that
are meaningful at release cut, not per-commit: they depend on release-only
state and would either fail spuriously or degrade to a no-op as a per-commit
gate. Keeping it release-time preserves its failure signal. CO5 runs it as
part of the final acceptance matrix.

## Prescriptive boundary rules (enforced by gate 2)

- **Removed exports stay removed.** `closeout.removedExports` records each
  removal with date, replacement facade, and scan evidence; re-adding the key
  fails the gate.
- **Zero unowned transitional surface.** Every transitional/wildcard export
  must have a facade mapping (`closeout.facadeReadiness`), a manual category,
  a deprecation mark, or an ownership record (`closeout.transitionalOwnership`
  with owner + consumer + cleanup trigger).
- **SD-5 phase-1 marks are complete.** Zero-consumer candidates carry
  `closeout.deprecations` (date + removal release); must-keep-transitional and
  keep-provisional entries carry `closeout.reviewBy` dates. Phase-2 deletion
  is release-aligned and gated on the post-CKG AlembicPlugin vendor refresh;
  a fresh consumer scan before deletion remains mandatory.
- **Narrowness budgets are shrink-only.** Each provisional facade has a frozen
  runtime-symbol budget in `closeout.narrowness.baselines`; exceeding it fails
  the gate. Raising a budget requires a controller decision recorded in the
  policy file.
- **Counts are shrink-only.** Transitional/wildcard/provisional counts may not
  exceed the last `closeout.trend.history` entry, and `closeout.maxCounts` may
  never be raised. Append trend entries with
  `node scripts/check-public-api-boundary.mjs --record-trend` after
  intentional shrink waves.
- **Source-graph canonical.** `./source-graph` is the single canonical facade
  (shape frozen for CKG2/CKG4); the removed variant facades may not return.

## AlembicPlugin keep-alive constraint

AlembicPlugin consumes Core through a live `file:../AlembicCore` link. Its
frozen keep-alive specifier list (see `closeout.transitionalOwnership`
`plugin-keep-alive`) is a hard runtime constraint: every listed specifier must
stay importable and behavior-identical until the Plugin migrates post-CKG. The
list may only shrink via Plugin-side commits. Core-side waves never edit
AlembicPlugin.
