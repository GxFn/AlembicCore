export * from './CoreContractSpine.js';
export * from './concurrency.js';
export * from './constants.js';
export * from './contentHash.js';
export * from './developerIdentity.js';
export * from './diffParser.js';
// The ./shared facade error surface is frozen at the original seven classes
// (CO1 shrink-only narrowness budget). CO3's taxonomy additions
// (PersistenceError, DivergenceError) are deliberately NOT re-exported here:
// consumers observe them as BaseError instances with stable codes
// (PERSISTENCE_ERROR / STATE_DIVERGENCE). SD-5 phase-2 (B2=re-point) routes
// their named import path through the ROOT facade (@alembic/core), not this
// frozen ./shared facade — see src/index.ts.
export {
  BaseError,
  ConflictError,
  ConstitutionViolation,
  InternalError,
  NotFoundError,
  PermissionDenied,
  ValidationError,
} from './errors/index.js';
export * from './FailureTaxonomy.js';
export * from './FieldTaxonomy.js';
export * from './folderNames.js';
export * from './isOwnDevRepo.js';
export * from './LanguageProfiles.js';
export * from './LanguageService.js';
export * from './lifecycle.js';
export * from './markdownUtils.js';
export { default as pathGuard, PathGuardError } from './PathGuard.js';
export * from './ProjectMarkers.js';
export * from './ProjectRegistry.js';
export type * from './ProjectScope.js';
export {
  ALEMBIC_PROJECT_SCOPE_ENDPOINTS,
  addProjectScopeFolder,
  addProjectScopeFolderToRegistry,
  buildProjectScopeSourceRefIndex,
  createCanonicalSourceIdentity,
  createProjectControlRoot,
  createProjectDescriptor,
  createProjectFolderDescriptor,
  createProjectScopeEndpointCapability,
  createProjectScopeEvidenceRef,
  createProjectScopeRegistryDocument,
  createProjectScopeSourceRef,
  listProjectScopeFolders,
  normalizeProjectScopePath,
  normalizeProjectScopeSourceRef,
  normalizeProjectScopeSourceRefs,
  normalizeProjectScopeSummary,
  PROJECT_SCOPE_CONTRACT_VERSION,
  PROJECT_SCOPE_FOLDER_ROLES,
  PROJECT_SCOPE_FOLDER_STATES,
  PROJECT_SCOPE_OPERATIONS,
  PROJECT_SCOPE_RESOLUTION_REASONS,
  PROJECT_SCOPE_STORAGE_KINDS,
  resolveProjectScopeForFolder,
  resolveProjectScopeRegistryFolder,
  resolveProjectScopeSourceRef,
  summarizeProjectScopeDescriptor,
  upsertProjectScopeInRegistry,
} from './ProjectScope.js';
export * from './packageRoot.js';
export * from './recipeTokens.js';
export * from './resolveProjectRoot.js';
export * from './schemas/index.js';
export * from './similarity.js';
export * from './sourceContracts.js';
export * from './TimerRegistry.js';
export * from './testMode.js';
export * from './tokenUtils.js';
export * from './utils/common.js';
export * from './WorkspaceResolver.js';
export * from './WorkspaceSettingsStore.js';
