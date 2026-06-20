// Internal RecipeContext read facade (GMAP-2). The public package route moved
// to ./recipe-context-capabilities; this source file stays for Core-local
// service tests and implementation wiring. It still exposes the read-only ports
// and service adapters used inside Core, and nothing here can mutate recipe
// state.

export type {
  RecipeContext as RecipeContextContract,
  RecipeContextEnvelope,
  RecipeContextJson,
  RecipeContextMetadata,
  RecipeContextQueryError,
  RecipeContextQueryErrorCode,
  RecipeContextRef,
  RecipeContextRefKind,
  RecipeContextRequest,
  RecipeContextRequestKind,
  RecipeContextResult,
  RecipeContextScalar,
  RecipeContextUnavailableData,
  RecipeDetailContext,
  RecipeDetailPayload,
  RecipeListContext,
  RecipeListPayload,
  RecipeMetadataFilter,
  RecipePrimeContext,
  RecipePrimePayload,
  RecipeRecord,
  RecipeRelationChainView,
  RecipeRelationContext,
  RecipeRelationEdge,
  RecipeRelationPayload,
  RecipeRelationScoreImpact,
  RecipeRelationStep,
  RecipeSearchContext,
  RecipeSearchHitView,
  RecipeSearchPayload,
  RecipeSemanticRegionBlock,
  RecipeSourceLocation,
  RecipeSourceRefContext,
  RecipeSourceRefGroup,
  RecipeSourceRefLineRange,
  RecipeSourceRefPayload,
  RecipeSourceRefView,
} from './domain/recipe-context/index.js';
export {
  isRecipeContextRequestKind,
  RECIPE_CONTEXT_CONTRACT_VERSION,
  RECIPE_CONTEXT_REQUEST_KIND_VALUES,
} from './domain/recipe-context/index.js';
export type {
  KnowledgeReadFacade,
  RecipeContextCoreParts,
  SearchEngineFacade,
  SourceRefRepositoryFacade,
  VectorServiceFacade,
} from './service/recipe-context/adapters/index.js';
export {
  createRecipeContextServiceFromCore,
  knowledgeReadPortFromService,
  recipeRecordFromWire,
  searchPortFromEngine,
  sourceRefPortFromRepository,
  vectorPortFromService,
} from './service/recipe-context/adapters/index.js';
export {
  normalizeRecipeRef,
  selectRecipeContextRefs,
} from './service/recipe-context/interface/refs.js';
export type {
  RecipeContextDeps,
  RecipeReadPage,
  RecipeReadPort,
  RecipeRegionPortHit,
  RecipeRegionPortResult,
  RecipeSearchPort,
  RecipeSearchPortHit,
  RecipeSearchPortResult,
  RecipeSourceRefPort,
  RecipeSourceRefRow,
  RecipeVectorPort,
} from './service/recipe-context/ports.js';
export {
  createRecipeContextService,
  RecipeContextService,
} from './service/recipe-context/RecipeContextService.js';
