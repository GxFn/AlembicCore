import type {
  ProjectContextEnvelope,
  ProjectContextPresenterInput,
  ProjectContextRef,
  ProjectContextResult,
} from '../../../domain/project-context/index.js';
import type { ModuleRole } from '../../../shared/LanguageProfiles.js';

export type ArchitectureDomain =
  | 'auth'
  | 'api'
  | 'ui'
  | 'database'
  | 'concurrency'
  | 'security'
  | 'observability'
  | 'error-handling'
  | 'testing';

export type ArchitectureEvidenceSource =
  | 'project-context-import'
  | 'project-context-symbol'
  | 'project-context-config'
  | 'project-context-manifest'
  | 'project-context-map'
  | 'shared-graph-entity'
  | 'shared-graph-edge'
  | 'shared-graph-health'
  | 'derived';

export interface ArchitectureEvidence {
  source: ArchitectureEvidenceSource;
  label: string;
  weight: number;
  moduleId?: string;
  filePath?: string;
  ref?: ProjectContextRef;
}

export interface ModuleDomainSignal {
  moduleId: string;
  moduleName: string;
  domain: ArchitectureDomain;
  present: boolean;
  confidence: number;
  evidence: ArchitectureEvidence[];
}

export interface DomainSignal {
  domain: ArchitectureDomain;
  present: boolean;
  confidence: number;
  evidence: ArchitectureEvidence[];
  moduleSignals: ModuleDomainSignal[];
}

export interface DomainSignalReport {
  domains: DomainSignal[];
  projectPresentDomains: ArchitectureDomain[];
  evidenceCount: number;
}

export type ArchitectureStyle =
  | 'monolith'
  | 'layered'
  | 'microservices'
  | 'event-driven'
  | 'cli'
  | 'library'
  | 'plugin'
  | 'frontend'
  | 'backend';

export interface ArchitectureStyleSignal {
  style: ArchitectureStyle;
  present: boolean;
  confidence: number;
  evidence: ArchitectureEvidence[];
}

export interface ArchitectureStyleReport {
  primary: ArchitectureStyle;
  confidence: number;
  styles: ArchitectureStyleSignal[];
}

export interface ArchitectureCodeEntitySnapshot {
  entityId: string;
  entityType: string;
  name: string;
  filePath?: string | null;
  lineNumber?: number | null;
  superclass?: string | null;
  protocols?: readonly string[];
  metadata?: Record<string, unknown>;
}

export interface ArchitectureKnowledgeEdgeSnapshot {
  fromId: string;
  fromType: string;
  toId: string;
  toType: string;
  relation: string;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface ArchitectureGraphModuleSnapshot {
  moduleId: string;
  name: string;
  files?: readonly string[];
  role?: ModuleRole | string;
  configLayer?: string;
  metadata?: Record<string, unknown>;
}

export interface ArchitectureManifestDependency {
  name: string;
  version?: string;
  source?: string;
  moduleId?: string;
  ref?: ProjectContextRef;
}

export interface ArchitectureDimensionCoverageSnapshot {
  id: string;
  name?: string;
  recipeCount: number;
  status?: 'strong' | 'adequate' | 'weak' | 'missing';
  weight?: number;
  relatedRoles?: readonly string[];
  suggestedTopics?: readonly string[];
}

export interface ArchitectureGraphSnapshot {
  modules?: readonly ArchitectureGraphModuleSnapshot[];
  entities?: readonly ArchitectureCodeEntitySnapshot[];
  edges?: readonly ArchitectureKnowledgeEdgeSnapshot[];
  manifestDependencies?: readonly ArchitectureManifestDependency[];
  dimensionCoverage?: readonly ArchitectureDimensionCoverageSnapshot[];
}

export interface ArchitectureIntelligenceInput {
  projectContext?:
    | ProjectContextPresenterInput
    | readonly ProjectContextEnvelope<ProjectContextResult>[];
  graph?: ArchitectureGraphSnapshot;
  projectRoot?: string;
  primaryLanguage?: string;
}

export interface RefinedModuleRole {
  moduleId: string;
  moduleName: string;
  refinedRole: ModuleRole | string;
  confidence: number;
  resolution: 'clear' | 'uncertain' | 'fallback';
  evidence: ArchitectureEvidence[];
  alternatives: Array<{ role: ModuleRole | string; score: number }>;
}

export interface CouplingMetric {
  moduleId: string;
  moduleName: string;
  fanIn: number;
  fanOut: number;
}

export interface CouplingEdge {
  from: string;
  to: string;
  relation: string;
  weight: number;
  evidence: ArchitectureEvidence[];
}

export interface CouplingCycle {
  cycle: string[];
  severity: 'warning' | 'error';
}

export interface CouplingAnalysisReport {
  metrics: CouplingMetric[];
  edges: CouplingEdge[];
  cycles: CouplingCycle[];
}

export interface LayerInferenceLevel {
  level: number;
  name: string;
  modules: string[];
  evidence: ArchitectureEvidence[];
}

export interface LayerViolation {
  from: string;
  to: string;
  fromLayer: number;
  toLayer: number;
  relation: string;
}

export interface LayerInferenceReport {
  levels: LayerInferenceLevel[];
  violations: LayerViolation[];
  configBased: boolean;
}

export interface HealthGap {
  dimension: string;
  dimensionName: string;
  recipeCount: number;
  status: 'weak' | 'missing';
  priority: 'high' | 'medium' | 'low';
  suggestedTopics: string[];
  affectedRoles: string[];
  evidence: ArchitectureEvidence[];
}

export interface CallFlowAggregateReport {
  topCalled: Array<{ id: string; callCount: number }>;
  entryPoints: string[];
  dataProducers: string[];
  dataConsumers: string[];
}

export interface ProjectInformationSupplementReport {
  roles: RefinedModuleRole[];
  coupling: CouplingAnalysisReport;
  layers: LayerInferenceReport;
  healthGaps: HealthGap[];
  callFlow: CallFlowAggregateReport;
  panoramaServiceFree: true;
}

export interface ModuleComplexityMetric {
  moduleId: string;
  moduleName: string;
  fileCount: number;
  lineCount: number;
  fanIn: number;
  fanOut: number;
  cycleCount: number;
  hotspotScore: number;
  complexityScore: number;
  severity: 'low' | 'medium' | 'high';
  evidence: ArchitectureEvidence[];
}

export interface ProjectComplexityMetric {
  moduleCount: number;
  fileCount: number;
  lineCount: number;
  dependencyEdgeCount: number;
  cycleCount: number;
  hotspotCount: number;
  complexityScore: number;
  severity: 'low' | 'medium' | 'high';
}

export interface ComplexityReport {
  project: ProjectComplexityMetric;
  modules: ModuleComplexityMetric[];
  hotspots: ModuleComplexityMetric[];
}

export interface ArchitectureIntelligenceReport {
  domains: DomainSignalReport;
  styles: ArchitectureStyleReport;
  complexity: ComplexityReport;
  supplements: ProjectInformationSupplementReport;
}
