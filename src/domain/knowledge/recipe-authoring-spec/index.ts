/**
 * recipe-authoring-spec — the canonical, single source of truth for Recipe authoring.
 *
 * One table (`gateRules()`) is read by BOTH projections:
 *   - enforcement: `validateAgainst` (the gates delegate to it; byte-identical predicates), and
 *   - guidance:    `renderGuidance` / the builders (every guidance surface renders from it).
 * That shared read is what makes "guidance == gate" structurally true instead of hand-maintained.
 *
 * Layer purity (§C.1): this module imports only `shared` + `types`. The two runtime couplings —
 * on-disk source-ref reads and bootstrap-session scope — are injected as the typed ports defined in
 * `types/recipe-authoring-spec.ts`, so the domain stays fs-free and the layer contract holds while
 * the gates stay byte-identically strict.
 *
 * Surfaced to consumers via the existing `@alembic/core/knowledge` facade (no new subpath minted).
 */

// ── §C.11 typed ports + shared violation types (re-exported from the types layer) ──
export type {
  RecipeAuthoringProfile,
  RecipeAuthoringSubmitPath,
  RecipeAuthoringViolation,
  RecipeSessionScope,
  RecipeSourceRefEvidence,
  RecipeSourceRefResolver,
} from '../../../types/recipeAuthoringSpec.js';
// ── SECTION 3: content contract ──
export {
  contentContract,
  type DocScoreTargets,
  type DocScoreTextTarget,
  PROJECT_SNAPSHOT_STYLE_GUIDE,
} from './contentContract.js';
// ── SECTION 7: depth contract (P0/C3) — 深度价值契约(超越门禁的价值要求，两宿主单源) ──
export {
  buildDepthScaffold,
  buildDepthSelfReviewChecklist,
  DEPTH_DIMENSIONS,
  type DepthDimension,
} from './depthContract.js';
// ── SECTION 8: depth review (P0/C4) — 确定性深度接地裁判(只认已解析 file:line，防刷分) ──
export {
  type DepthReviewInput,
  type DepthReviewResult,
  reviewRecipeDepth,
} from './depthReview.js';
// ── SECTION 6: worked examples (P0 default stub) ──
export { example, type WorkedExample } from './examples/index.js';
// ── SECTION 5: failure-mode catalog (computed from gateRules) ──
export { type FailureMode, failureModes } from './failureModes.js';
// ── SECTION 1: field spec re-export (AS-IS from FieldSpec) ──
export {
  FieldLevel,
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
} from './fields.js';
// ── SECTION 2: the gate-rules table + enforcement (validateAgainst) ──
export {
  codeFingerprint,
  type GateRule,
  gateRule,
  gateRules,
  getEvidenceFloorPolicy,
  getImperativeVerbAllowlist,
  getStage3FieldPolicy,
  resolveAuthoringProfile,
  resolveGroundedSourcePaths,
  type Stage3FieldPolicy,
  type ValidateAgainstOptions,
  validateAgainst,
} from './gateRules.js';
// ── SECTION 4: guidance projection (renderGuidance + builders) ──
export {
  buildPreSubmitChecklist,
  buildSubmissionSpec,
  buildSubmitKnowledgeContract,
  describeSubmitToolFields,
  type GuidanceBlock,
  renderGuidance,
  type SubmissionSpec,
  type SubmitContract,
} from './guidanceGenerator.js';
