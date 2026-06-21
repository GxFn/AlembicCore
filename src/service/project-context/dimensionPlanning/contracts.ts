import type { UnifiedDimension } from '../../../domain/dimension/index.js';
import type {
  ArchitectureDomain,
  ArchitectureEvidence,
  ArchitectureIntelligenceReport,
  ArchitectureStyleReport,
  ComplexityReport,
  DomainSignalReport,
  ProjectInformationSupplementReport,
} from '../architectureIntelligence/index.js';

export type DimensionSelectionDecisionKind =
  | 'active'
  | 'skipped'
  | 'low-confidence'
  | 'unavailable';

export type DimensionSelectionReason =
  | 'foundational'
  | 'language-match'
  | 'framework-match'
  | 'framework-evidence'
  | 'domain-signal'
  | 'style-signal'
  | 'complexity-signal'
  | 'low-confidence-domain'
  | 'language-mismatch'
  | 'framework-signal-missing'
  | 'domain-signal-missing';

export interface DimensionSelectionDecision {
  dimension: UnifiedDimension;
  kind: DimensionSelectionDecisionKind;
  reasons: readonly DimensionSelectionReason[];
  confidence: number;
  domains: readonly ArchitectureDomain[];
  evidence: readonly ArchitectureEvidence[];
  detail: string;
}

export interface SignalAwareDimensionSelectionInput {
  primaryLanguage: string;
  detectedFrameworks?: readonly string[];
  architectureIntelligence?: ArchitectureIntelligenceReport;
  domainSignals?: DomainSignalReport;
  styles?: ArchitectureStyleReport;
  complexity?: ComplexityReport;
  supplements?: ProjectInformationSupplementReport;
  dimensions?: readonly UnifiedDimension[];
  confidenceThreshold?: number;
}

export interface SignalAwareDimensionSelectionResult {
  activeDimensions: readonly UnifiedDimension[];
  skippedDimensions: readonly UnifiedDimension[];
  lowConfidenceDimensions: readonly DimensionSelectionDecision[];
  decisions: readonly DimensionSelectionDecision[];
  unavailableSignals: readonly string[];
}

export type ProjectPlanningScale = 'small' | 'medium' | 'large' | 'very-large';
export type ProjectPlanningBudgetLevel = 'focused' | 'standard' | 'expanded';

export interface DimensionInformationStep {
  stepId: string;
  tool:
    | 'project-context.repo'
    | 'project-context.map'
    | 'project-context.module'
    | 'project-context.file-flow'
    | 'project-context.file-symbols'
    | 'project-context.source-slice'
    | 'recipe-context.coverage'
    | 'evolution.proposals';
  dimensions: readonly string[];
  reason: string;
  priority: number;
}

export interface RecommendedDimension {
  dimension: UnifiedDimension;
  priorityScore: number;
  reasons: readonly string[];
  evidence: readonly ArchitectureEvidence[];
  informationSteps: readonly DimensionInformationStep[];
}

export interface ProjectScaleDecision {
  scale: ProjectPlanningScale;
  budgetLevel: ProjectPlanningBudgetLevel;
  maxDimensionsPerDraft: number;
  moduleBatchSize: number;
  reasons: readonly string[];
}

export interface CrossDimensionConstraint {
  id: string;
  dimensions: readonly string[];
  severity: 'required' | 'recommended';
  reason: string;
}

export interface DimensionPlanningAidInput extends SignalAwareDimensionSelectionInput {
  dynamicSignals?: DynamicSignalReport;
  maxRecommendedDimensions?: number;
}

export interface DimensionPlanningAidReport {
  selection: SignalAwareDimensionSelectionResult;
  recommendedDimensions: readonly RecommendedDimension[];
  dimensionOrder: readonly string[];
  informationGatheringSteps: readonly DimensionInformationStep[];
  scaleDecision: ProjectScaleDecision;
  subsetHints: readonly string[];
  crossDimensionConstraints: readonly CrossDimensionConstraint[];
  lowConfidenceSignals: readonly string[];
  unavailableSignals: readonly string[];
}

export interface ModuleDeltaSnapshot {
  moduleId: string;
  moduleName: string;
  files?: readonly string[];
  fingerprint?: string;
  role?: string;
}

export interface ModuleChange {
  moduleId: string;
  moduleName: string;
  previous?: ModuleDeltaSnapshot;
  current?: ModuleDeltaSnapshot;
  changedFiles: readonly string[];
  reason: 'added' | 'removed' | 'changed';
}

export interface ModuleRenameCandidate {
  previousModuleId: string;
  currentModuleId: string;
  previousName: string;
  currentName: string;
  similarity: number;
  sharedFiles: readonly string[];
}

export interface ModuleDeltaDetectorInput {
  previousModules: readonly ModuleDeltaSnapshot[];
  currentModules: readonly ModuleDeltaSnapshot[];
  changedFiles?: readonly string[];
  renameSimilarityThreshold?: number;
}

export interface ModuleDeltaReport {
  added: readonly ModuleChange[];
  changed: readonly ModuleChange[];
  removed: readonly ModuleChange[];
  renameCandidates: readonly ModuleRenameCandidate[];
  affectedModuleIds: readonly string[];
}

export interface ModuleCoverageRecord {
  moduleId: string;
  moduleName?: string;
  dimensionId: string;
  recipeId: string;
  status?: 'active' | 'evolving' | 'staging' | 'decaying' | 'deprecated' | 'unknown';
  sourceRefs?: readonly string[];
  weight?: number;
}

export interface ModuleCoverageQueryInput {
  records: readonly ModuleCoverageRecord[];
  moduleIds?: readonly string[];
  dimensionIds?: readonly string[];
  targetPerModuleDimension?: number;
}

export interface ModuleDimensionCoverage {
  dimensionId: string;
  healthyCount: number;
  decayingCount: number;
  recipeIds: readonly string[];
  sourceRefs: readonly string[];
  gap: number;
  status: 'covered' | 'weak' | 'missing';
}

export interface ModuleCoverageSummary {
  moduleId: string;
  moduleName?: string;
  dimensions: readonly ModuleDimensionCoverage[];
}

export interface ModuleCoverageReport {
  targetPerModuleDimension: number;
  byModule: readonly ModuleCoverageSummary[];
  gaps: readonly {
    moduleId: string;
    moduleName?: string;
    dimensionId: string;
    gap: number;
    status: 'weak' | 'missing';
  }[];
}

export interface DynamicProposalSignal {
  id: string;
  type?: string;
  status?: string;
  targetRecipeId?: string;
  relatedRecipeIds?: readonly string[];
  confidence?: number;
  description?: string;
  evidence?: readonly Record<string, unknown>[];
}

export interface DynamicDecaySignal {
  id: string;
  targetRecipeId?: string;
  status?: string;
  confidence?: number;
  description?: string;
  evidence?: readonly string[] | readonly Record<string, unknown>[];
}

export interface DynamicDimensionCoverageInput {
  dimensionId: string;
  existingCount: number;
  targetCount: number;
  decayingRecipeIds?: readonly string[];
}

export interface DynamicPlanningSignal {
  kind: 'proposal' | 'decay' | 'coverage-gap' | 'new-module' | 'changed-module' | 'hotspot';
  priority: number;
  dimensionIds: readonly string[];
  moduleIds: readonly string[];
  recipeIds: readonly string[];
  reason: string;
}

export interface DynamicSignalGatewayInput {
  architectureIntelligence?: ArchitectureIntelligenceReport;
  proposals?: readonly DynamicProposalSignal[];
  decaySignals?: readonly DynamicDecaySignal[];
  dimensionCoverage?: readonly DynamicDimensionCoverageInput[];
  moduleCoverage?: ModuleCoverageQueryInput;
  moduleDelta?: ModuleDeltaDetectorInput;
}

export interface DynamicSignalReport {
  proposals: {
    activeCount: number;
    byStatus: Readonly<Record<string, number>>;
    byType: Readonly<Record<string, number>>;
  };
  decay: {
    openCount: number;
    affectedRecipeIds: readonly string[];
  };
  coverage: ModuleCoverageReport;
  moduleDelta: ModuleDeltaReport;
  hotspotModuleIds: readonly string[];
  planSignals: readonly DynamicPlanningSignal[];
}
