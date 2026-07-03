# AlembicCore

**English** | [简体中文](./README.zh-CN.md)

`@alembic/core` is the shared, headless, deterministic knowledge kernel of the
Alembic runtime family. It owns the models, persistence, analysis, search, and
workflow contracts that every Alembic host builds on — and deliberately nothing
host-shaped: no agent runtime, no tool system, no AI provider, no CLI or
Dashboard UI, no Codex/MCP delivery surface. Four boundary-wall tests
(`test/CoreDeliveryBoundary.test.ts`, `test/CoreToolSystemBoundary.test.ts`,
`test/CoreCodexBoundary.test.ts`, `test/CorePackage.test.ts`) enforce that
positioning on every check run.

It is the first package in the Alembic release chain: downstream release
staging for `@alembic/agent` and the main `alembic-ai` package consumes the
published `@alembic/core` registry version.

## Capabilities

- **Knowledge lifecycle** — one `KnowledgeEntry` aggregate whose `lifecycle`
  field distinguishes *candidates* (submitted, unpublished) from *recipes*
  (published, actionable). Unified candidate validation
  (`validateCandidatesUnified`: batch dedup → V3 structural validation →
  field/quality/uniqueness checks), advisory quality scoring that is never a
  gate, and a six-state evolution machine (staging → evolving → active →
  decaying → deprecated, plus proposal generation and GC sweeps).
- **Guard** — `GuardCheckEngine` checks code against published recipe
  standards using real AST analysis and returns structured verdicts.
- **Project intelligence** — ProjectContext assembly (space → repo → module →
  file query ladder), module/entrypoint discovery, source-graph relations,
  freshness/partial annotations, and plan-facts projections that project facts
  without ranking or recommending (the host agent decides).
- **AST analysis leaf** — multi-language parsing and call-graph analysis on
  `web-tree-sitter`, with 11 bundled WASM grammars (TypeScript, TSX,
  JavaScript, Swift, Objective-C, Kotlin, Java, Dart, Python, Go, Rust) and
  graceful degradation when a grammar is absent.
- **Search + vector** — recipe/knowledge search, ranking, semantic vector
  retrieval, and AST-aware chunking.
- **Host-agent workflows** — cold-start and knowledge-rescan orchestration:
  mission briefings, budgeted analysis packets with stable unit keys,
  per-dimension completion with coverage write-back, and session → snapshot
  persistence.
- **Persistence** — SQLite via `better-sqlite3` + `drizzle-orm` with versioned
  migrations, repository contracts and implementations, and a file-first
  knowledge store: the `.md` file is the source of truth, the database is an
  index cache, and divergence is surfaced as a typed error with a documented
  reconcile path.
- **Runtime contracts** — daemon-less job/runtime display and resident-service
  contracts, output budgets with honest truncation, stable diagnostic codes,
  and failure/field taxonomies.

## Architecture

`src/` is organized into nine source areas plus root facades, under an
enforced dependency contract (`config/layer-contract.json`, human contract in
`docs/layer-contract.md`, blocking lint `scripts/lint-layer-contract.mjs`).
Runtime imports may only point downward; `import type` is exempt as a type
bridge.

| Area | Responsibility | May import (runtime) |
| --- | --- | --- |
| `shared/` | Leaf utilities: errors, schemas, taxonomies, similarity, path guard, language profiles, output budgets | — |
| `types/` | Cross-layer type bridges (snapshots, views, wire contracts) | shared |
| `domain/` | Entities and domain contracts (knowledge, dimension, evolution mechanism, similarity, snippet, source-graph, project-context, recipe-context) | shared, types |
| `core/` | Multi-language AST / discovery / capability **analysis leaf** | shared, types, infrastructure |
| `infrastructure/` | Database (drizzle/migrations), io, logging, signal, report, vector, config plumbing | shared, types |
| `repository/` | Persistence contracts and implementations (SQLite + `.md` file store) | shared, types, domain, infrastructure |
| `service/` | Business orchestration and rules | + core*, repository |
| `workflows/` | High-level orchestration: `surfaces/` (host-agent{session,briefing,delivery}, planning, coverage, persistence, presentation) + `project-index/` plans/presenters | + service |
| `daemon/` | Job/runtime display and resident-service contracts | shared, types |
| `src/*.ts` | Root facades — public package entrypoints | any |

`core*` marks the blessed analysis-leaf exception: `service/` and `workflows/`
may import `core/` directly (e.g. `GuardCheckEngine`, AST chunking) instead of
going through an adapter layer. Every exception carries a written reason in
the contract config.

## Package entrypoints

The package exposes its API through `package.json` `exports` subpaths (65 at
v0.2.0) — the root facade plus grouped domain, layer, and workflow entries:

```ts
import { applyOutputBudget, DivergenceError } from '@alembic/core';
import { validateCandidatesUnified } from '@alembic/core/knowledge';
import { createGuardCheckEngine } from '@alembic/core/guard';
import { createAlembicRepositories } from '@alembic/core/repositories';
import { runHostAgentDimensionCompletionWorkflow } from '@alembic/core/host-agent-workflows';
```

Every exported subpath is classified in `config/public-api-boundary.json` as
**stable** (long-term contract, shrink-only), **provisional** (narrowness
budget, may only shrink without controlled authorization), or **transitional**
(migration-period surface with a named target facade). The classification is
enforced by `scripts/check-public-api-boundary.mjs` on every check run, and
consumer repositories are reverse-scanned by
`scripts/lint-consumer-core-imports.mjs` against their own allowlists.

The root facade (`src/index.ts`) is deliberately narrow: small areas are
re-exported wholesale, large areas (repositories, types, workflows) export
named symbols only, to keep same-name DTOs from colliding. Shipped
compatibility aliases stay public: `HostAgent*` ↔ `IDEAgent*`, `Bootstrap` ↔
`AppRuntime`.

## Getting started

Requirements: Node.js >= 22, npm.

```bash
npm ci
npm run build:check   # TypeScript no-emit check
npm run test          # full Vitest suite
npm run build         # emit dist/
npm run check         # full gate chain (see below)
```

Consumption:

- **Workspace development** — downstream repositories link the sibling source:
  `"@alembic/core": "file:../AlembicCore"`. Build `dist/` locally before
  linking; never commit `dist/`.
- **Release staging** — published manifests must consume the registry version
  instead of sibling links. `AlembicPlugin` portable runtime snapshots may pin
  `file:vendor/AlembicCore` with source metadata.

## Quality gates

`npm run check` runs the blocking gate chain:

```text
build:check → lint:public-api-boundary → lint:layer-contract
→ lint:consumer-core-imports → lint:scope-resolution → smoke:public-api
→ check:output-budgets → check:space-edges → lint:doctrine → lint:naming
→ test → lint
```

Highlights:

- **Boundary walls** — the four `Core*Boundary`/`CorePackage` tests reject
  host-shaped code (forbidden directories, export prefixes, and named
  implementation files).
- **Layer contract** — runtime import directions between `src/` areas.
- **Public API boundary** — export tiers, narrowness budgets, and removed
  exports that must not resurrect.
- **Output budgets** — per-tool byte budgets with honest `truncated` signals,
  measured against real fixtures.
- **Doctrine & naming lints** — code-comment and naming conventions.

## Release

Core releases are guarded by:

```text
npm run check
npm run build
npm run smoke:public-api
npm run release:check
```

The release workflow supports a manual dry-run staging path and publishes only
from a `v<package.version>` tag with npm provenance enabled. See
[RELEASE-PLAYBOOK.md](./RELEASE-PLAYBOOK.md) for the full sequence, failure
handling, and the downstream staging order.

## Repository role

`AlembicCore` must not depend on the local full Alembic app or the Codex
plugin repository. The dependency direction is:

```text
AlembicCore
  ^
  |- AlembicAgent
  |- Alembic
  |- AlembicPlugin portable runtime snapshot
```

Shared capability fixes land here first; downstream repositories keep only
adapters, wiring, transport, and host experience.

## Further reading

- [docs/layer-contract.md](./docs/layer-contract.md) — the layer contract,
  blessed exceptions, and known debt.
- [docs/semantic-glossary.md](./docs/semantic-glossary.md) — candidate vs
  recipe, dimension key vs concept, session vs snapshot, validate vs score.
- [docs/public-api-gates.md](./docs/public-api-gates.md) — export boundary
  policy.
- [docs/entrypoint-effects.md](./docs/entrypoint-effects.md),
  [docs/realtime-delivery-contract.md](./docs/realtime-delivery-contract.md),
  [docs/foundational-health-register.md](./docs/foundational-health-register.md).

## License

MIT
