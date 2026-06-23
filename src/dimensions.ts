export type {
  DimensionAnalysisGuide,
  DimensionCatalogPayloadItem,
  DimensionLanguageApplicability,
  DimensionSubmissionSpec,
  PlanDimensionDefinitionResolution,
  ProjectLanguageFrameworkFacts,
} from './domain/dimension/index.js';
export {
  ALL_DIMENSION_IDS,
  buildDimensionCatalogPayload,
  buildTierPlan,
  classifyRecipeToDimension,
  DIMENSION_DISPLAY_GROUP,
  DIMENSION_REGISTRY,
  DimensionCopy,
  FRAMEWORK_DIM_IDS,
  getDimension,
  getDimensionFocusKeywords,
  getDimensionSOP,
  getDimensionsByLayer,
  LANGUAGE_DIM_IDS,
  PRE_SUBMIT_CHECKLIST,
  resolveDimensionLanguageApplicability,
  resolvePlanDimensionDefinitions,
  sopToCompactText,
  UNIVERSAL_DIM_IDS,
} from './domain/dimension/index.js';
export {
  dimensionTags,
  isKnownDimensionId,
  recipeBelongsToDimension,
  recipeDimensionIdOrUnknown,
  recipeStorageBucket,
  resolveRecipeDimensionId,
} from './domain/dimension/RecipeDimension.js';
export type {
  DimensionId,
  FrameworkDimId,
  LanguageDimId,
  UnifiedDimension,
  UniversalDimId,
} from './domain/dimension/UnifiedDimension.js';
export type * from './service/project-context/dimensionPlanning/index.js';
export {
  aggregateDynamicPlanningSignals,
  DynamicSignalGateway,
  ModuleDeltaDetector,
  queryPerModuleCoverage,
} from './service/project-context/dimensionPlanning/index.js';
