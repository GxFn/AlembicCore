# Core Semantic Glossary

Status: R-3 doc sync, 2026-06-29. Current shipped names use `AppRuntime` for
the Alembic bootstrap runtime and `HostAgent*` for the Core host-agent facade.
Compatibility aliases remain public where already shipped: Alembic keeps
`Bootstrap` as an `AppRuntime` alias, and Core keeps `IDEAgent*` aliases over
`HostAgent*` analysis-packet contracts. This glossary records the current names
without changing frozen public values, persistence formats, or compatibility
exports.

## Knowledge lifecycle nouns

| Term | Meaning | Primary types |
| --- | --- | --- |
| **Candidate** | A submitted-but-not-yet-published unit of knowledge. Lives in `candidates/`, lifecycle `candidate`. Subject to validation (`validateCandidatesUnified`) and dedup. | `KnowledgeEntry` (lifecycle=candidate), `RecipeCandidate` (validator input shape) |
| **Recipe** | A PUBLISHED, actionable knowledge unit. Lives in `recipes/`, lifecycle active/deprecated. What consumers search and inject. | `KnowledgeEntry` (lifecycle=active), recipe repositories |
| **Knowledge entry** | The umbrella entity for both of the above: one `KnowledgeEntry` aggregate whose `lifecycle` field decides candidate vs recipe. "Entry" is the storage/domain word; "candidate"/"recipe" are lifecycle stages of it. | `KnowledgeEntry` |

Rule of thumb: candidate → (validation, review) → recipe; both are knowledge
entries. Code that says "recipe candidate" means a candidate whose target
lifecycle is recipe — not a third entity.

## Dimension: key vs concept

- **Dimension-as-key** — the string id used to partition scans, checkpoints,
  and storage buckets (e.g. `architecture`, `testing`). Types:
  `DimensionDef.id`, `dimensionIds: string[]`, checkpoint keys. It is an
  opaque key: stable, kebab-case, registry-controlled
  (`domain/dimension/DimensionRegistry`).
- **Dimension-as-concept** — the analysis FACET that the key names: the
  registry row carrying copy, ordering, and scan semantics (`DimensionDef`,
  `DimensionCopy`). Concept changes (renaming a facet, changing its meaning)
  are registry-level decisions; key strings must stay stable because they are
  persisted in checkpoints and .md frontmatter.

When code passes `dimension: string` it means the key. When it consumes
`DimensionDef` it means the concept.

## Session vs snapshot

- **Session** — a LIVE, stateful execution context with a beginning and an end
  (e.g. `BootstrapSession`, mining sessions). Sessions accumulate progress and
  are owned by the workflow that started them.
- **Snapshot** — an IMMUTABLE, persisted projection of state at a point in
  time (e.g. `WorkflowSnapshotStore` records, `ProjectSnapshot`,
  `types/snapshot-views` projections). Snapshots are read-model artifacts;
  re-running produces a new snapshot, never mutates an old one.

A session WRITES snapshots; a snapshot never holds live state. If a type needs
both words, it is two types.

## Cold-start: internal-agent vs host-agent intents (D4)

`workflows/cold-start/ColdStartIntent.ts` deliberately carries two intent
factories over one `ColdStartWorkflowIntent` shape:

- **internal-agent** (`createInternalColdStartIntent`) — the in-process
  executor: `completionPolicy: 'auto-fill'`, optional `internalExecution`
  skip switches (`skipAsyncFill`, `skipTargetDelivery`), AST context on.
- **host-agent** (`createHostAgentColdStartIntent`) — the host-agent-driven
  executor: `completionPolicy: 'host-agent-dimension-complete'`, no internal
  skip switches, AST context off (the host agent gathers its own).

This duality is DOCUMENTED, not restructured: CKG1 owns the cold-start area
rebuild. The B6 skip-flag-to-mode-type refactor is deferred (the flags are
reachable from the package export `./workflows/cold-start`, so the type shape
is public; owner: AlembicCore window, trigger: CKG1 area rebuild).

## Validation vocabulary (B3 adjunct)

- **Validate** — deterministic pass/fail with reasons (`UnifiedValidator`,
  `RecipeCandidateValidator`, unified entry `validateCandidatesUnified`).
- **Score** — advisory quality measurement, never a gate in Core
  (`QualityScorer`); enforcement belongs to CKG3.
- **Aggregate** — batch dedup before validation (`aggregateCandidates`).
