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
