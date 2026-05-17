export * from './core/index.js';
export * from './daemon/index.js';
export * from './domain/index.js';
export * from './infrastructure/index.js';
export * from './service/index.js';
export * from './shared/index.js';

// 阶段 14：根入口只暴露外层收敛需要的稳定契约，避免把内部重复类型通过 export * 撞到一起。
export { KnowledgeRepositoryImpl } from './repository/knowledge/index.js';
export { ProjectIntelligenceCapability } from './workflows/capabilities/project-intelligence/index.js';
export {
  createExternalWorkflowSession,
  type ExternalMissionBriefingInput,
  type ExternalMissionBriefingResult,
  type ExternalMissionSessionContainer,
  type ExternalMissionWorkflowSession,
} from './workflows/capabilities/execution/external/index.js';
