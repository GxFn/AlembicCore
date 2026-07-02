// W4 批A(R2):装配本体下沉 service/project-context/capabilities.ts,本 facade 只做纯转发,
// `@alembic/core/project-context-capabilities` wire 面(外部 8 处消费)导出集合不变。
export type * from './service/project-context/architectureIntelligence/index.js';
export {
  ArchitectureStyleClassifier,
  analyzeArchitectureIntelligence,
  analyzeArchitectureIntelligenceFromProjectContext,
  ComplexityAnalyzer,
  DomainSignalDetector,
  ProjectInformationSupplementAnalyzer,
} from './service/project-context/architectureIntelligence/index.js';
export {
  createProjectContextCapabilities,
  ProjectContextCapabilities,
  type ProjectContextCapabilityQuery,
} from './service/project-context/capabilities.js';
export type * from './service/project-context/dimensionPlanning/index.js';
export {
  aggregateDynamicPlanningSignals,
  DynamicSignalGateway,
  ModuleDeltaDetector,
  queryPerModuleCoverage,
} from './service/project-context/dimensionPlanning/index.js';
