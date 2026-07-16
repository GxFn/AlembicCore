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
  targetRecipes: number;
}

export interface PlanScaleDecision {
  totalRecipeBudget: number;
  depthLevels: readonly string[];
  maxFiles?: number;
  contentMaxLines?: number;
  budgetLevel?: string;
  scale?: string;
  /**
   * P-2(2026-07-02 用户决策)：plan LLM 按各维度证据面给出的 per-dimension 候选预算。
   * 均分 totalRecipeBudget 会抹平维度差异(architecture 证据面远大于 performance)；
   * 有此字段时宿主折算建议区间优先用它，缺失 fallback 均分。可选，不破既有契约。
   */
  dimensionBudgets?: Readonly<Record<string, number>>;
}

export interface PlanModuleBinding {
  modulePath: string;
  moduleId?: string;
  dimensions: readonly string[];
  targetRecipes: number;
  priority: number;
}

export interface PlanNextAction {
  tool: string;
  reason: string;
  order: number;
  dimensionIds?: readonly string[];
  modulePaths?: readonly string[];
  /** Strict-v2 cognition fields are additive so legacy PlanIntent consumers remain wire-compatible. */
  questionId?: string;
  anatomyLensIds?: readonly string[];
  subjectRefs?: readonly string[];
  analysisScales?: readonly (
    | 'source-range'
    | 'symbol'
    | 'file'
    | 'module'
    | 'package'
    | 'repository'
    | 'project'
  )[];
  capabilityId?: string;
  queryFamilyId?: string;
  expectedSupport?: readonly string[];
  expectedCounterevidence?: readonly string[];
  synthesisTarget?: string;
  uncertainty?: string;
  priority?: 'critical' | 'high' | 'standard' | 'support';
  stopCondition?: string;
  escalationCondition?: string;
  budget?: {
    initialBreadth: number;
    expansionReserve: number;
    counterqueryReserve: number;
    starvationGuard: number;
  };
}

export interface PlanEvidenceRef {
  kind: 'project-context' | 'recipe-context' | 'evolution' | 'lifecycle' | 'human';
  ref: string;
  detail?: string;
}

export interface PlanIntent {
  generationStage: PlanStageId;
  projectProfile: PlanProjectProfile;
  dimensions: readonly PlanDimensionIntent[];
  scale: PlanScaleDecision;
  moduleBindings: readonly PlanModuleBinding[];
  plannedNextActions: readonly PlanNextAction[];
  evidenceRefs: readonly PlanEvidenceRef[];
  draftSource?: PlanDraftSource;
  /** Present only on the strict-v2 cognition path; legacy validators do not synthesize it. */
  investigationDecomposition?: import('./coldStartProductionPlan.js').PlanInvestigationDecompositionV1;
  /** Plan may allocate attention only inside accepted hard caps. */
  budgetStrategy?: import('./coldStartProductionPlan.js').PlanBudgetStrategyV1;
}

export interface PlanSelection {
  generationStage: PlanStageId;
  dimensions: readonly string[];
  scale: Pick<
    PlanScaleDecision,
    'totalRecipeBudget' | 'maxFiles' | 'contentMaxLines' | 'dimensionBudgets'
  > & {
    depthLevels?: readonly string[];
  };
  moduleBindings: readonly PlanModuleBinding[];
}
