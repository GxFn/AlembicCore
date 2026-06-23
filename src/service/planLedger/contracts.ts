export type PlanStatus = 'draft' | 'confirmed' | 'superseded' | 'archived';
export type PlanStageId = 'coldStart' | 'deepMining' | 'moduleMining';
export type PlanDraftSource = 'plugin-collected-facts' | 'host-agent' | 'test-fixture';

export interface PlanProjectProfile {
  projectType?: string;
  primaryLanguage?: string;
  secondaryLanguages?: readonly string[];
  frameworks?: readonly string[];
  moduleCount?: number;
  fileCount?: number;
  architectureHints?: readonly string[];
}

export interface PlanDimensionIntent {
  dimensionId: string;
  priority: number;
  rationale: string;
  stage: PlanStageId;
  targetRecipes: number;
}

export interface PlanScaleDecision {
  totalRecipeBudget: number;
  perStage: {
    coldStart: number;
    deepMining: number;
    module: number;
  };
  depthLevels: readonly string[];
  budgetLevel?: string;
  scale?: string;
}

export interface PlanModuleBinding {
  modulePath: string;
  moduleId?: string;
  dimensions: readonly string[];
  targetRecipes: number;
  priority: number;
}

export interface PlanStageTarget {
  dimensions: readonly string[];
  breadthBudget?: number;
  depthBudget?: number;
  focusModules?: readonly string[];
}

export interface PlanStages {
  coldStart: PlanStageTarget;
  deepMining: PlanStageTarget;
  moduleMining: {
    perModule: readonly PlanModuleBinding[];
  };
}

export interface PlanNextAction {
  tool: string;
  reason: string;
  order: number;
  dimensionIds?: readonly string[];
  modulePaths?: readonly string[];
}

export interface PlanEvidenceRef {
  kind: 'project-context' | 'recipe-context' | 'evolution' | 'lifecycle' | 'human';
  ref: string;
  detail?: string;
}

export interface PlanIntent {
  projectProfile: PlanProjectProfile;
  dimensions: readonly PlanDimensionIntent[];
  scale: PlanScaleDecision;
  moduleBindings: readonly PlanModuleBinding[];
  stages: PlanStages;
  plannedNextActions: readonly PlanNextAction[];
  evidenceRefs: readonly PlanEvidenceRef[];
  draftSource: PlanDraftSource;
}

export interface PlanChangeLogEntry {
  at: number;
  actor: string;
  action: 'drafted' | 'confirmed' | 'superseded' | 'archived' | 'updated';
  detail: string;
}

export interface PlanRecord {
  planId: string;
  version: number;
  status: PlanStatus;
  projectRoot: string;
  projectContextSignature: string;
  lastUpdatedFromCommit: string | null;
  createdBy: string;
  confirmedBy: string | null;
  confirmedAt: number | null;
  createdAt: number;
  updatedAt: number;
  supersedesPlanId: string | null;
  intent: PlanIntent;
  planningBrief: Record<string, unknown> | null;
  rationale: readonly string[];
  intentChangeLog: readonly PlanChangeLogEntry[];
}

export interface SavePlanDraftInput {
  planId?: string;
  version?: number;
  projectRoot: string;
  projectContextSignature: string;
  lastUpdatedFromCommit?: string | null;
  createdBy?: string;
  planningBrief?: Record<string, unknown> | null;
  rationale?: readonly string[];
  createdAt?: number;
}

export interface ConfirmPlanInput {
  planId: string;
  version: number;
  confirmedBy?: string;
  rationale?: readonly string[];
  intent: PlanIntent;
  confirmedAt?: number;
}

export interface PlanSignatureComparison {
  matches: boolean;
  expected: string;
  actual: string;
  reason: 'match' | 'mismatch';
}

export interface ProjectContextSignatureInput {
  projectRoot?: string;
  commit?: string | null;
  primaryLanguage?: string;
  frameworks?: readonly string[];
  files?: readonly {
    filePath?: string;
    path?: string;
    contentHash?: string;
    language?: string;
    lineCount?: number;
    sizeBytes?: number;
  }[];
  modules?: readonly {
    moduleId?: string;
    id?: string;
    name?: string;
    role?: string;
    fingerprint?: string;
    files?: readonly string[];
  }[];
  metadata?: Record<string, unknown>;
}

export interface PlanCodeRecipeMapping {
  codeRegion: string;
  recipeIds: readonly string[];
  status: 'planned' | 'generated' | 'stale' | 'missing';
  dimensionIds: readonly string[];
  modulePath?: string;
  evidenceRefs: readonly PlanEvidenceRef[];
}

export interface PlanCoverageBucket {
  planned: number;
  generated: number;
  stale: number;
  missing: number;
}

export type PlanModuleDimensionCoverage = Readonly<
  Record<string, Readonly<Record<string, PlanCoverageBucket>>>
>;

export interface PlanCoverageGap {
  dimensionId: string;
  modulePath?: string;
  planned: number;
  generated: number;
  missing: number;
}

export interface PlanGenerationState {
  codeRecipeMapping: readonly PlanCodeRecipeMapping[];
  coverage: {
    byDimension: Readonly<Record<string, PlanCoverageBucket>>;
    byModule: Readonly<Record<string, PlanCoverageBucket & { dimensions: readonly string[] }>>;
    byModuleDimension: PlanModuleDimensionCoverage;
    generated: number;
    planned: number;
    gaps: readonly PlanCoverageGap[];
  };
  pendingProposals: readonly Record<string, unknown>[];
  generationChangeLog: readonly Record<string, unknown>[];
}

export interface PlanView {
  intent: PlanRecord;
  state: PlanGenerationState;
  signature: PlanSignatureComparison;
}

export interface PlanDraftInformationPackage {
  draftSource: Extract<PlanDraftSource, 'plugin-collected-facts'>;
  planningBrief: Record<string, unknown>;
  sourceReports: {
    planningAids?: Record<string, unknown>;
    missionBriefing?: Record<string, unknown>;
    dynamicSignals?: Record<string, unknown>;
  };
}

export interface BuildPlanDraftInformationPackageInput {
  projectProfile: PlanProjectProfile;
  projectContextSignature: string;
  planningAids?: Record<string, unknown>;
  missionBriefing?: Record<string, unknown>;
  dynamicSignals?: Record<string, unknown>;
  hints?: {
    focusModules?: readonly string[];
    maxBudget?: number;
    createdBy?: string;
  };
}
