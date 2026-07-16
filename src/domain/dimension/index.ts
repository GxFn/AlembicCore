/**
 * dimension domain — 统一维度体系
 *
 * @module domain/dimension
 */

export type {
  DimensionAnalysisGuide,
  DimensionCatalogPayloadItem,
  DimensionLanguageApplicability,
  DimensionSubmissionSpec,
  ProjectLanguageFrameworkFacts,
} from './DimensionCatalogPayload.js';
export {
  buildDimensionCatalogPayload,
  resolveDimensionLanguageApplicability,
} from './DimensionCatalogPayload.js';
export { DimensionCopy } from './DimensionCopy.js';
export type { PlanDimensionDefinitionResolution } from './DimensionRegistry.js';
export {
  buildTierPlan,
  classifyRecipeToDimension,
  DIMENSION_DISPLAY_GROUP,
  DIMENSION_REGISTRY,
  getDimension,
  getDimensionsByLayer,
  resolvePlanDimensionDefinitions,
} from './DimensionRegistry.js';
export {
  getDimensionFocusKeywords,
  getDimensionSOP,
  PRE_SUBMIT_CHECKLIST,
  sopToCompactText,
} from './DimensionSop.js';
export {
  dimensionTags,
  isKnownDimensionId,
  recipeBelongsToDimension,
  recipeDimensionIdOrUnknown,
  recipeStorageBucket,
  resolveRecipeDimensionId,
} from './RecipeDimension.js';
export type {
  DimensionId,
  FrameworkDimId,
  LanguageDimId,
  SynthesisDimId,
  UnifiedDimension,
  UniversalDimId,
} from './UnifiedDimension.js';
export {
  ALL_DIMENSION_IDS,
  FRAMEWORK_DIM_IDS,
  LANGUAGE_DIM_IDS,
  SYNTHESIS_DIM_IDS,
  UNIVERSAL_DIM_IDS,
} from './UnifiedDimension.js';
