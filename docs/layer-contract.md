# Core Layer Contract

Status: CO2, 2026-06-12. Enforced by `npm run lint:layer-contract`
(`scripts/lint-layer-contract.mjs`, blocking in `npm run check`). Machine-readable
rules: `config/layer-contract.json`. This document is the human contract; the
config file must stay in sync with it.

## Area responsibilities

| Area (src/…) | Responsibility |
| --- | --- |
| `shared/` | Leaf utilities: errors, schemas, taxonomies, similarity, path guard, language profiles, target classification. No business orchestration. |
| `types/` | Cross-layer TYPE bridges (snapshots, views, workflow contracts). Type-only by nature; runtime helpers stay minimal. |
| `domain/` | Entities and domain contracts (knowledge, dimension, evolution, snippet). Isolated: knows nothing about services, repositories, or workflows. |
| `core/` | Multi-language AST / discovery / capability ANALYSIS LEAF. **User decision 2026-06-12: `core/` is blessed as an importable analysis leaf for `service/` and `workflows/`** — no service-adapter layer is introduced. It must never import service/workflows/repository. |
| `infrastructure/` | Technical support: database (drizzle/migrations), io, logging, signal, report, vector, config plumbing. |
| `repository/` | Persistence implementations and persistence CONTRACTS over drizzle/SQLite and the .md file store. |
| `service/` | Business orchestration and rules (knowledge, evolution, candidate, recipe, guard, panorama, search, vector, quality, bootstrap). |
| `workflows/` | High-level orchestration: cold-start, knowledge-rescan, capabilities (host-agent, persistence, planning, presentation, project-intelligence). |
| `daemon/` | Job/runtime display and resident-service contracts. |
| Root facades (`src/*.ts`) | Public package entrypoints; may compose every area. |

## Allowed RUNTIME import directions

A runtime import from row-area into column-area is allowed only where marked.
`import type { … }` (type-only) imports are exempt: `types/` and contracts may
bridge layers without creating runtime coupling. Mixed imports
(`import { type A, b }`) count as runtime.

| from \ to | shared | types | domain | core | infrastructure | repository | service | workflows | daemon |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| shared | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| types | ✓ | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| domain | ✓ | ✓ | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| core | ✓ | ✓ | ✗ | — | ✓ | ✗ | ✗ | ✗ | ✗ |
| infrastructure | ✓ | ✓ | ✗ | ✗ | — | ✗ | ✗ | ✗ | ✗ |
| repository | ✓ | ✓ | ✓ | ✗ | ✓ | — | ✗ | ✗ | ✗ |
| service | ✓ | ✓ | ✓ | ✓* | ✓ | ✓ | — | ✗ | ✗ |
| workflows | ✓ | ✓ | ✓ | ✓* | ✓ | ✓ | ✓ | — | ✗ |
| daemon | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | — |
| root facades | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

`✓*` = blessed core-leaf imports, see below.

## Blessed imports (written reasons)

- **`service/guard/GuardCheckEngine.ts` → `core/AstAnalyzer`** — guard rule
  checks need real AST analysis; `core/` is the blessed analysis leaf and the
  engine lazy-loads it. Introducing an adapter layer would duplicate the
  analyzer surface for no isolation gain (user decision 2026-06-12).
- **`workflows/capabilities/project-intelligence/ProjectIntelligenceRunner.ts`
  → `core/AstAnalyzer`, `core/analysis/CallGraphAnalyzer`** — project
  intelligence IS the orchestration of core analysis; the runner is the
  designated consumer of the analysis leaf (user decision 2026-06-12).
- **`infrastructure/database/migrations/009_knowledge_dimension_id.ts` →
  `domain/dimension/DimensionRegistry`** — file-level exception: the data
  migration backfills dimension ids and must use the single registry source of
  truth instead of duplicating the id list. Scope: this migration file only.
- **`infrastructure/vector/ASTChunker.ts` → `core/ast`, `core/AstAnalyzer`**
  — file-level blessing: semantic chunking lazily consumes the analysis leaf
  (`parseToTree`) with graceful fallback when grammars are absent. Extends the
  core-as-leaf ruling to vector chunking; scope: this file only.

## Known debt — TEMPORARY exception (controller-routed)

- **`service/panorama/PanoramaScanner.ts` → `workflows/capabilities/project-intelligence/ProjectIntelligenceRunner`**
  (dynamic import of six phase functions). A second genuine service→workflows
  inversion that the original audit missed because the import is dynamic; found
  by this lint at CO2. Repair exceeds the CO2 mandate (one extraction only), so
  it is recorded as a temporary exception, NOT a blessing. Owner: AlembicCore
  window; cleanup trigger: a controller-routed repair wave extracting the
  project-intelligence phase runners to a contract-clean home (post-CO sequence
  or CKG1 area rebuild).

## Known exception (D3) — host-agent ↔ persistence straddle

`workflows/surfaces/host-agent/BootstrapSession.ts` ↔
`workflows/surfaces/persistence/WorkflowSnapshotStore.ts` ↔
`workflows/surfaces/host-agent/HostAgentDimensionCompletionWorkflow.ts`
couple session state, snapshot persistence, and dimension-completion
orchestration inside `workflows/surfaces/`. This is a KNOWN straddle, not a
contract violation (same area), but its responsibility split is unsettled.
**No repair in CO2.** Owner: AlembicCore window; trigger: post-CKG1
restructuring of the cold-start/host-agent area.

## Write-strategy boundary (B4): KnowledgeFileStore vs KnowledgeFileWriter

- `repository/knowledge/KnowledgeFileStore.ts` owns the **write contract**: the
  interface every persistence coordinator (e.g. `KnowledgeUnitOfWork`) depends
  on. The .md file is the source of truth; the DB is an index cache.
- `service/knowledge/KnowledgeFileWriter.ts` owns the **write strategy**: the
  implementation of serialization format, file naming, directory placement, and
  lifecycle moves.
- Direction is contract-legal (service implements a repository interface; the
  repository layer never imports the service implementation). There is exactly
  one file-write implementation. New write capabilities extend the interface
  first, then the implementation. Code notes live in both files.

## Repairs done in CO2

- The single genuine direction violation found by the audit —
  `service/panorama/ModuleDiscoverer.ts` runtime-importing
  `workflows/surfaces/presentation/TargetClassifier` — was repaired by
  moving `TargetClassifier` to `shared/TargetClassifier.ts` (pure, dependency-
  free utility). The presentation facade re-exports the same symbols, so the
  public surface is unchanged. `TargetClassifier` is deliberately NOT added to
  `shared/index.ts` (the `./shared` facade has a frozen narrowness budget).

## Validator entry (B3)

`service/candidate/CandidateValidationFacade.ts#validateCandidatesUnified`
(exported via the stable `./knowledge` facade) is the unified candidate
validation entry: it composes `aggregateCandidates` (dedup),
`RecipeCandidateValidator` (V3 structure), and `UnifiedValidator`
(fields/quality/uniqueness) without changing any individual verdict. Advisory
quality scoring (`QualityScorer`) stays separate; enforcement semantics belong
to CKG3 and are out of scope here.

## Changing this contract

Contract changes require a controller decision. The lint config
(`config/layer-contract.json`) may only be edited together with this document;
adding a blessed exception requires a written reason and an owner.
