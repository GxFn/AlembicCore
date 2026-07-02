/**
 * ProjectContextCapabilities 装配 —— W4 批A(R2)从根 facade project-context-capabilities.ts
 * 下沉:装配(interface+create+冻结单例)属 service 层职责,根 facade 只做纯转发;
 * 消解 service/planFacts → root-facade 的运行时反向边。对外 wire 面
 * `@alembic/core/project-context-capabilities` 经 facade 转发保持不变。
 */
import type {
  ProjectContext as ProjectContextContract,
  ProjectContextEnvelope,
  ProjectContextRequest,
  ProjectContextResult,
} from '../../domain/project-context/index.js';
import {
  type ArchitectureIntelligenceInput,
  type ArchitectureIntelligenceReport,
  analyzeArchitectureIntelligence,
} from './architectureIntelligence/index.js';
import {
  aggregateDynamicPlanningSignals,
  type DynamicSignalGatewayInput,
  type DynamicSignalReport,
} from './dimensionPlanning/index.js';
import { ProjectContext } from './ProjectContextService.js';

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
    aggregateDynamicPlanningSignals: (input: DynamicSignalGatewayInput) =>
      aggregateDynamicPlanningSignals(input),
  };
  return Object.freeze(capabilities);
}

/** 默认冻结单例(与下沉前根 facade 行为一致:绑定全局 ProjectContext)。 */
export const ProjectContextCapabilities = createProjectContextCapabilities(ProjectContext);
