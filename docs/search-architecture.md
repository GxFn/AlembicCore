# Search responsibilities and compatibility

The preferred public facade is `@alembic/core/search`. Existing deep entrypoints,
constructor options and legacy result types remain compatible. Internal helpers
below are implementation details and do not add package exports.

| Owner | Input → output | Responsibility |
| --- | --- | --- |
| `repository/search/KnowledgeSearchProjection.ts` | Schema columns → full/incremental index selection | One list of index facts for Drizzle and raw SQLite; old optional-column defaults |
| `KnowledgeRepositoryImpl` / `RawDbKnowledgeAdapter` | Bound query → rows | Storage access, non-deprecated/detail filtering and inclusive second-resolution refresh watermark |
| `service/search/SearchDocumentProjection.ts` | Row → sparse text + metadata | JSON compatibility and one canonical Recipe document projection per indexed row |
| `SearchEngine` | Request + configured ports → response | Mode selection, cache, fallback, live-record lookup, filters, ranking orchestration and telemetry |
| `FieldWeightedScorer`, `CoarseRanker`, `MultiSignalRanker`, `contextBoost` | Documents/candidates → ordered scores | Distinct lexical, coarse, signal and session-context algorithms |
| `SearchTypes` | Typed values → response/slim/group helpers | Existing DTO, response and workspace-identity compatibility surface; Engine uses its shared `groupByKind` |
| `KnowledgeRetrieval` / `HybridRetriever` | Different retrieval contracts → candidates | Canonical Recipe truth/budget policy and legacy weighted RRF remain separate |

## Read and projection boundaries

Full and incremental indexing use the same 27-column projection. The raw adapter
reads one schema snapshot on construction. Only previously supported optional
columns receive defaults; existing SQL NULL values are retained, and missing
required columns still fail visibly during indexing.

Keyword LIKE patterns are supplied by SearchEngine with literal `%`, `_` and
backslash escaped. Both storage implementations use the same SQLite ESCAPE
semantics. Keyword mode also merges canonical sparse facts that SQL columns alone
do not express; it is not an exact-match-only query mode.

Detail rows include the classification and scope facts needed when vector metadata
omits them. Existing metadata precedence remains unchanged. The pure document
projector returns text and metadata together so build/refresh do not repeat
canonical document construction. `_buildDocText` and `_buildDocMeta` remain as
compatibility entrypoints for direct callers.

## Recall, ranking and presentation

VectorService and direct vector-store responses retain their source-specific
score and content conventions. They share dense result mapping and the ordered
post-processing chain: entry deduplication → live DB lookup → type/metadata
filters → limit → response. An empty raw lane can select the next fallback; an
orphan-only lane that becomes empty after truth filtering keeps its existing
semantic response. Canonical retrieval and legacy RRF keep their own contracts.

MultiSignalRanker scores current candidate facts and context; its legacy
`signalBus` constructor option remains accepted, but no unused quality/usage
subscriptions are retained. SearchEngine still publishes search signals.
Unknown scenario, language and difficulty names use their existing defaults;
prototype-property names are ordinary keys. Grouping preserves input order in
three buckets (`rule`, `pattern`, `fact`), with unknown kinds falling into pattern.

## Verification ownership

- `SearchRanking.test.ts` owns tokenizer, lexical scorer/index lifecycle, ranking
  formulas, configuration compatibility, context behavior and legacy HybridRetriever
  RRF defaults/payload contracts. HNSW store fusion remains in `HnswVector.test.ts`.
- `SearchEngine.test.ts` owns storage/recall integration, fallback, filtering,
  source differences, telemetry and the one-projection-per-row boundary.
- `KnowledgeRetrievalPolicy`, `KnowledgeTruthProjector` and
  `RecipeRetrievalProduction` retain canonical truth, budget and document-role
  coverage. Public entrypoint, output-budget and host Search/Prime checks retain
  their separate integration responsibilities.
