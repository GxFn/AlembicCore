export * from './evolution.js';
export * from './KnowledgeWire.js';
export type {
  AstSummary,
  GenerateSessionShape,
  CallGraphResult,
  CodeEntityGraphResult,
  DependencyEdge,
  DependencyGraph,
  DependencyNode,
  DimensionDef,
  DiscovererInfo,
  EnhancementPackInfo,
  ExistingRecipeInfo,
  GuardAudit,
  GuardAuditFileEntry,
  GuardAuditSummary,
  GuardViolation,
  LanguageProfile,
  LocalPackageModule,
  MissionBriefingResult,
  PanoramaResult,
  PhaseReport,
  ProjectMetrics,
  SnapshotFile,
  SnapshotTarget,
} from './ProjectSnapshot.js';
export * from './ReactiveEvolution.js';
// RecipeAuthoringSpec §C.11 注入端口与违规类型（domain 模块保持纯净，fs/session 通过这些端口注入）
export type {
  RecipeAuthoringSubmitPath,
  RecipeAuthoringViolation,
  RecipeSessionScope,
  RecipeSourceRefEvidence,
  RecipeSourceRefResolver,
} from './recipeAuthoringSpec.js';
export type {
  GenerateFile,
  DimensionCheckpointResult,
  FileDiffPlan,
  IncrementalPlan,
  LoggerLike,
  McpContext,
  RestoredEpisodicMemory,
  SaveSnapshotParams,
  WorkflowDatabaseLike,
  WorkflowMcpContext,
  WorkflowServiceContainer,
  WorkflowSkillHooks,
} from './workflows.js';
