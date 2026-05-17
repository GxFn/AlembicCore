export {
  FieldLevel,
  getAgentAdapterFieldSpec,
  getAllRequiredFieldNames,
  getExpectedFieldNames,
  getExternalAgentRequiredFields,
  getFieldDef,
  getFieldsByLevel,
  getInternalAgentRequiredFields,
  getRequiredFieldNames,
  getRequiredFieldsDescription,
  getSystemInjectedFields,
  STANDARD_CATEGORIES,
  V3_FIELD_SPEC,
  VALID_KINDS,
  VALID_TOPIC_HINTS,
  WHITELISTED_CATEGORIES,
} from './domain/knowledge/FieldSpec.js';
export {
  CANDIDATE_LIFECYCLES,
  CANDIDATE_STATES,
  CONSUMABLE_LIFECYCLES,
  CONSUMABLE_STATES,
  COUNTABLE_LIFECYCLES,
  DEGRADED_STATES,
  GUARD_LIFECYCLES,
  inferKind,
  isCandidate,
  isConsumable,
  isDegraded,
  isValidLifecycle,
  isValidTransition,
  KnowledgeEntry,
  KnowledgeRepository,
  Lifecycle,
  lifecycleInSql,
  NON_DEPRECATED_LIFECYCLES,
  PUBLISHED_LIFECYCLES,
} from './domain/knowledge/index.js';
export type { KnowledgeEntryProps } from './domain/knowledge/KnowledgeEntry.js';
export {
  checkReadinessFromCandidate,
  checkRecipeReadiness,
  STANDARD_CATEGORIES as READINESS_STANDARD_CATEGORIES,
  WHITELISTED_CATEGORIES as READINESS_WHITELISTED_CATEGORIES,
} from './domain/knowledge/RecipeReadinessChecker.js';
export {
  createStatelessValidator,
  UnifiedValidator,
} from './domain/knowledge/UnifiedValidator.js';
export {
  Constraints,
  Content,
  Quality,
  RELATION_BUCKETS,
  Reasoning,
  Relations,
  Stats,
} from './domain/knowledge/values/index.js';
export type {
  KnowledgeFileScanner,
  KnowledgeFileStore,
} from './repository/knowledge/KnowledgeFileStore.js';
export type {
  RecipeSourceRefEntity,
  RecipeSourceRefInsert,
} from './repository/sourceref/RecipeSourceRefRepository.js';
export {
  type CreateRecipeItem,
  type CreateRecipeRequest,
  type CreateRecipeResult,
  type GatewayDeps,
  type GatewaySource,
  KnowledgeService,
  RecipeProductionGateway,
} from './service/knowledge/index.js';
