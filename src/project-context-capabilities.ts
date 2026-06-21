import type {
  ProjectContext as ProjectContextContract,
  ProjectContextEnvelope,
  ProjectContextRequest,
  ProjectContextResult,
} from './domain/project-context/index.js';
import {
  type ArchitectureIntelligenceInput,
  type ArchitectureIntelligenceReport,
  analyzeArchitectureIntelligence,
} from './service/project-context/architectureIntelligence/index.js';
import {
  aggregateDynamicPlanningSignals,
  buildDimensionPlanningAids,
  type DimensionPlanningAidInput,
  type DimensionPlanningAidReport,
  type DynamicSignalGatewayInput,
  type DynamicSignalReport,
  resolveSignalAwareActiveDimensions,
  type SignalAwareDimensionSelectionInput,
  type SignalAwareDimensionSelectionResult,
} from './service/project-context/dimensionPlanning/index.js';
import { ProjectContext } from './service/project-context/ProjectContextService.js';

export type * from './service/project-context/architectureIntelligence/index.js';
export {
  ArchitectureStyleClassifier,
  analyzeArchitectureIntelligence,
  analyzeArchitectureIntelligenceFromProjectContext,
  ComplexityAnalyzer,
  DomainSignalDetector,
  ProjectInformationSupplementAnalyzer,
} from './service/project-context/architectureIntelligence/index.js';
export type * from './service/project-context/dimensionPlanning/index.js';
export {
  aggregateDynamicPlanningSignals,
  buildDimensionPlanningAids,
  DynamicSignalGateway,
  ModuleDeltaDetector,
  queryPerModuleCoverage,
  resolveSignalAwareActiveDimensions,
} from './service/project-context/dimensionPlanning/index.js';

export type ProjectContextCapabilityQuery<TPayload = unknown> = Omit<
  ProjectContextRequest<TPayload>,
  'kind'
>;

export interface ProjectContextCapabilities {
  execute<TPayload = unknown>(
    input: ProjectContextRequest<TPayload>
  ): Promise<ProjectContextEnvelope<ProjectContextResult>>;
  executeAnchorRangeQuery<TPayload = unknown>(
    input: ProjectContextCapabilityQuery<TPayload>
  ): Promise<ProjectContextEnvelope<ProjectContextResult>>;
  executeSpaceQuery<TPayload = unknown>(
    input: ProjectContextCapabilityQuery<TPayload>
  ): Promise<ProjectContextEnvelope<ProjectContextResult>>;
  executeRepoQuery<TPayload = unknown>(
    input: ProjectContextCapabilityQuery<TPayload>
  ): Promise<ProjectContextEnvelope<ProjectContextResult>>;
  executeProjectMapQuery<TPayload = unknown>(
    input: ProjectContextCapabilityQuery<TPayload>
  ): Promise<ProjectContextEnvelope<ProjectContextResult>>;
  executeModuleQuery<TPayload = unknown>(
    input: ProjectContextCapabilityQuery<TPayload>
  ): Promise<ProjectContextEnvelope<ProjectContextResult>>;
  executeModuleLayersQuery<TPayload = unknown>(
    input: ProjectContextCapabilityQuery<TPayload>
  ): Promise<ProjectContextEnvelope<ProjectContextResult>>;
  executeFileFlowQuery<TPayload = unknown>(
    input: ProjectContextCapabilityQuery<TPayload>
  ): Promise<ProjectContextEnvelope<ProjectContextResult>>;
  executeFileSymbolsQuery<TPayload = unknown>(
    input: ProjectContextCapabilityQuery<TPayload>
  ): Promise<ProjectContextEnvelope<ProjectContextResult>>;
  executeSourceSliceQuery<TPayload = unknown>(
    input: ProjectContextCapabilityQuery<TPayload>
  ): Promise<ProjectContextEnvelope<ProjectContextResult>>;
  analyzeArchitectureIntelligence(
    input: ArchitectureIntelligenceInput
  ): ArchitectureIntelligenceReport;
  resolveSignalAwareActiveDimensions(
    input: SignalAwareDimensionSelectionInput
  ): SignalAwareDimensionSelectionResult;
  buildDimensionPlanningAids(input: DimensionPlanningAidInput): DimensionPlanningAidReport;
  aggregateDynamicPlanningSignals(input: DynamicSignalGatewayInput): DynamicSignalReport;
}

export function createProjectContextCapabilities(
  projectContext: ProjectContextContract = ProjectContext
): ProjectContextCapabilities {
  const capabilities: ProjectContextCapabilities = {
    execute: <TPayload = unknown>(input: ProjectContextRequest<TPayload>) =>
      projectContext.execute(input),
    executeAnchorRangeQuery: <TPayload = unknown>(input: ProjectContextCapabilityQuery<TPayload>) =>
      projectContext.execute({ ...input, kind: 'anchor-range' }),
    executeSpaceQuery: <TPayload = unknown>(input: ProjectContextCapabilityQuery<TPayload>) =>
      projectContext.execute({ ...input, kind: 'space' }),
    executeRepoQuery: <TPayload = unknown>(input: ProjectContextCapabilityQuery<TPayload>) =>
      projectContext.execute({ ...input, kind: 'repo' }),
    executeProjectMapQuery: <TPayload = unknown>(input: ProjectContextCapabilityQuery<TPayload>) =>
      projectContext.execute({ ...input, kind: 'map' }),
    executeModuleQuery: <TPayload = unknown>(input: ProjectContextCapabilityQuery<TPayload>) =>
      projectContext.execute({ ...input, kind: 'module' }),
    executeModuleLayersQuery: <TPayload = unknown>(
      input: ProjectContextCapabilityQuery<TPayload>
    ) => projectContext.execute({ ...input, kind: 'module-layers' }),
    executeFileFlowQuery: <TPayload = unknown>(input: ProjectContextCapabilityQuery<TPayload>) =>
      projectContext.execute({ ...input, kind: 'file-flow' }),
    executeFileSymbolsQuery: <TPayload = unknown>(input: ProjectContextCapabilityQuery<TPayload>) =>
      projectContext.execute({ ...input, kind: 'file-symbols' }),
    executeSourceSliceQuery: <TPayload = unknown>(input: ProjectContextCapabilityQuery<TPayload>) =>
      projectContext.execute({ ...input, kind: 'source-slice' }),
    analyzeArchitectureIntelligence: (input: ArchitectureIntelligenceInput) =>
      analyzeArchitectureIntelligence(input),
    resolveSignalAwareActiveDimensions: (input: SignalAwareDimensionSelectionInput) =>
      resolveSignalAwareActiveDimensions(input),
    buildDimensionPlanningAids: (input: DimensionPlanningAidInput) =>
      buildDimensionPlanningAids(input),
    aggregateDynamicPlanningSignals: (input: DynamicSignalGatewayInput) =>
      aggregateDynamicPlanningSignals(input),
  };
  return Object.freeze(capabilities);
}

export const ProjectContextCapabilities = createProjectContextCapabilities(ProjectContext);
