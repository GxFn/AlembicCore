export * from './CoreContractSpine.js';
export * from './concurrency.js';
export * from './constants.js';
export * from './content-hash.js';
export * from './developer-identity.js';
export * from './diff-parser.js';
// The ./shared facade error surface is frozen at the original seven classes
// (CO1 shrink-only narrowness budget). CO3's internal taxonomy additions
// (PersistenceError, DivergenceError) are deliberately NOT re-exported here:
// consumers observe them as BaseError instances with stable codes
// (PERSISTENCE_ERROR / STATE_DIVERGENCE); promoting them onto the facade is
// a separate export-surface decision.
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
export * from './folder-names.js';
export * from './isOwnDevRepo.js';
export * from './LanguageProfiles.js';
export * from './LanguageService.js';
export * from './lifecycle.js';
export * from './markdown-utils.js';
export { default as pathGuard, PathGuardError } from './PathGuard.js';
export * from './ProjectMarkers.js';
export * from './ProjectRegistry.js';
export * from './ProjectScope.js';
export * from './package-root.js';
export * from './recipe-tokens.js';
export * from './resolveProjectRoot.js';
export * from './schemas/index.js';
export * from './similarity.js';
export * from './source-contracts.js';
export * from './TimerRegistry.js';
export * from './test-mode.js';
export * from './token-utils.js';
export * from './utils/common.js';
export * from './WorkspaceResolver.js';
export * from './WorkspaceSettingsStore.js';
