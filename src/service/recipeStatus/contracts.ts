import type { PlanEvidenceRef, PlanIntent, PlanProjectProfile } from '../planIntent/index.js';

export interface RecipeStatusReadRepositories {
  knowledgeRepository: {
    findAllByLifecycles(lifecycles: readonly string[]): Promise<readonly RecipeLike[]>;
  };
  recipeSourceRefRepository: {
    findAll(): readonly SourceRefLike[];
  };
  proposalRepository?: {
    findActive(): readonly Record<string, unknown>[];
  };
  lifecycleEventRepository?: {
    findRecent(limit?: number): readonly Record<string, unknown>[];
  };
}

export interface RecipeLike {
  id: string;
  title?: string;
  lifecycle?: string;
  dimensionId?: string;
  category?: string;
  sourceFile?: string | null;
  toJSON?: () => Record<string, unknown>;
}

export interface SourceRefLike {
  recipeId: string;
  sourcePath: string;
  status: string;
  newPath?: string | null;
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

export interface PlanSignatureComparison {
  matches: boolean;
  expected: string;
  actual: string;
  reason: 'match' | 'mismatch';
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
  intent: PlanIntent;
  state: PlanGenerationState;
  signature: PlanSignatureComparison;
}

export interface PlanDraftInformationPackage {
  draftSource: 'plugin-collected-facts';
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
