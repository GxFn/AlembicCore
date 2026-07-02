# Core Layer Contract

Status: CO2, 2026-06-12; revised W4, 2026-07-03 (workspace unification: plan/validation
merges, host-agent split, types inversion repairs; stale references to retired
project-intelligence/panorama removed). Enforced by `npm run lint:layer-contract`
(`scripts/lint-layer-contract.mjs`, blocking in `npm run check`). Machine-readable
rules: `config/layer-contract.json`. This document is the human contract; the
config file must stay in sync with it.

## Area responsibilities

| Area (src/…) | Responsibility |
| --- | --- |
| `shared/` | Leaf utilities: errors, schemas, taxonomies, similarity primitives, path guard, language profiles, target classification. No business orchestration. |
| `types/` | Cross-layer TYPE bridges (snapshots, views, planning views, workflow contracts). Type-only by nature; runtime helpers stay minimal. Must not import service/workflows even type-only — pure data contracts sink to `types/` or `domain/` instead (W4 repairs T1–T4). |
| `domain/` | Entities and domain contracts (knowledge, dimension, evolution mechanism, project-context, recipe-context, similarity, snippet, source-graph contracts). Isolated: knows nothing about services, repositories, or workflows. |
| `core/` | Multi-language AST / discovery ANALYSIS LEAF. **User decision 2026-06-12: `core/` is blessed as an importable analysis leaf for `service/` and `workflows/`** — no service-adapter layer is introduced. It must never import service/workflows/repository. Note (W4): `core/capability` (CapabilityProbe) is infra-natured, not an analysis leaf member; its relocation is deferred to the future core/ area rework (kept in place — no violation, `./capability` stable export). |
| `infrastructure/` | Technical support: database (drizzle/migrations), io, logging, signal, report, vector, config plumbing. |
| `repository/` | Persistence implementations and persistence CONTRACTS over drizzle/SQLite and the .md file store (knowledge, session, coverage, evolution-proposal families…). |
| `service/` | Business orchestration and rules: bootstrap, guard, knowledge (incl. `knowledge/validation/{candidate,quality,recipe}`, W4), plan (`plan/{facts,intent,status}`, W4), project-context, recipe-context, search, source-graph, sustain, vector. |
| `workflows/` | High-level orchestration: `surfaces/` (coverage, host-agent{session,briefing,delivery — W4}, persistence, planning{dimensions,knowledge}, presentation), `project-index/` (cold-start / knowledge-rescan plans + presenters), `shared/`, and the frozen 1-line shim dirs `cold-start/`, `knowledge-rescan/` (export-subpath targets). |
| `daemon/` | Job/runtime display and resident-service contracts. |
| Root facades (`src/*.ts`) | Public package entrypoints; may compose every area. **Reverse ban (W4, from repairs R1–R3): non-facade areas must never import a root facade** — that creates service→root-facade runtime cycles; import the owning area directly instead. |

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
- **`workflows` → `core` (matrix edge, currently 0 live edges)** — the edge is
  retained as the blessed channel for workflows-side analysis consumption
  (e.g. host-agent evidence building). Its original named consumer
  (`ProjectIntelligenceRunner`) was retired with the project-intelligence
  route; deleting the edge is a contract narrowing that requires a
  controller/user decision (recorded W4, left open).
- **`infrastructure/database/migrations/009_knowledge_dimension_id.ts` →
  `domain/dimension/DimensionRegistry`** — file-level exception: the data
  migration backfills dimension ids and must use the single registry source of
  truth instead of duplicating the id list. Scope: this migration file only.
- **`infrastructure/vector/ASTChunker.ts` → `core/ast`, `core/AstAnalyzer`**
  — file-level blessing: semantic chunking lazily consumes the analysis leaf
  (`parseToTree`) with graceful fallback when grammars are absent. Extends the
  core-as-leaf ruling to vector chunking; scope: this file only.

## Known exception (D3) — host-agent session ↔ persistence straddle

`workflows/surfaces/host-agent/session/GenerateSession.ts` ↔
`workflows/surfaces/persistence/WorkflowSnapshotStore.ts` ↔
`workflows/surfaces/host-agent/session/HostAgentDimensionCompletionWorkflow.ts`
couple session state, snapshot persistence, and dimension-completion
orchestration inside `workflows/surfaces/`. This is a KNOWN straddle, not a
contract violation (same area); the W4 split groups the session side under
`host-agent/session/` without changing the coupling. Owner: AlembicCore
window; trigger: post-CKG1 restructuring of the cold-start/host-agent area.

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
  (Historical note: `service/panorama` itself has since been retired; the
  CO2-era temporary exception `PanoramaScanner → project-intelligence` is
  dissolved — both endpoints no longer exist.)

## Repairs done in W4 (2026-07-03)

- Three service→root-facade runtime inversions (the CO2-era lint's live reds)
  repaired: `baseDimensions` sank to `domain/dimension/BaseDimensions.ts`
  (1-line shim left at the old planning/dimensions address);
  `ProjectContextCapabilities` assembly sank to
  `service/project-context/capabilities.ts` (root facade is now a pure
  re-export); plan facts now import `domain/dimension` directly.
- Four types→service/workflows type-only bridges dissolved by sinking pure
  data contracts: `types/planningViews.ts` (EvolutionPrescreen family,
  RecipeSnapshotEntry, rescan execution decisions) and
  `domain/source-graph/SourceGraphContracts.ts` (Indexer/Lifecycle results).
  Old definition sites re-export, so all facades are byte-stable.

## Validator entry (B3)

`service/knowledge/validation/candidate/CandidateValidationFacade.ts#validateCandidatesUnified`
(exported via the stable `./knowledge` facade) is the unified candidate
validation entry: it composes `aggregateCandidates` (dedup),
`RecipeCandidateValidator` (V3 structure), and `UnifiedValidator`
(fields/quality/uniqueness) without changing any individual verdict. Advisory
quality scoring (`QualityScorer`) stays separate; enforcement semantics belong
to CKG3 and are out of scope here.

## Export-surface policy (W4, 4-6)

1. **`service/index.ts` barrel is frozen, not completed.** It keeps exactly its
   current members (paths may move; membership may not grow): completing it
   would pour ~5k lines of plan/project-context symbols into the stable root
   `.` surface with same-name DTO collision risk. Consumers use the proper
   routes instead (`./plans`, `./service/planFacts`, `./project-context`).
2. **One aggregation facade per lifecycle ring**, and it is the preferred exit
   for new symbols: `plans.ts` (Plan), `host-agent-workflows.ts` (Generate
   workflow surface), `knowledge.ts` (Curate), `sustain.ts` (Sustain;
   `evolution.ts` is its frozen wire shim). Deep-path subpath exports exist
   only for whole-module integration.
3. **All existing deep-path export keys are frozen.** Directory reorganization
   is always "key unchanged + target repointed" (W4 batches C/D precedent);
   new directories get no new keys.

## Changing this contract

Contract changes require a controller decision. The lint config
(`config/layer-contract.json`) may only be edited together with this document;
adding a blessed exception requires a written reason and an owner.
