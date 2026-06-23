export interface ProjectAnalysisPreparationOptions {
  clearOldData?: boolean;
  dataRoot?: string;
}

export interface ProjectAnalysisScanOptions {
  maxFiles?: number;
  contentMaxLines?: number;
  skipGuard?: boolean;
  sourceTag?: string;
  summaryPrefix?: string;
  generateReport?: boolean;
  generateAstContext?: boolean;
  incremental?: boolean;
  logPrefix?: string;
}

export interface ProjectAnalysisMaterializationPlan {
  sourceGraph: boolean;
  dependencyEdges: boolean;
  moduleEntities: boolean;
  guardViolations: boolean;
}
