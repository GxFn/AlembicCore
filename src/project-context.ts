export type {
  AnchorRangeContext,
  AnchorRangeRadius,
  FileFlowContext,
  FileSymbolContext,
  HotspotSummary,
  ModuleContext,
  ModuleLayerContext,
  ProjectContext as ProjectContextContract,
  ProjectContextAnchor,
  ProjectContextEnvelope,
  ProjectContextExecutionContext,
  ProjectContextLevel,
  ProjectContextPresenterInput,
  ProjectContextPresenterUnavailable,
  ProjectContextPresenterWarning,
  ProjectContextProject,
  ProjectContextQueryError,
  ProjectContextQueryErrorCode,
  ProjectContextRef,
  ProjectContextRefKind,
  ProjectContextRequest,
  ProjectContextRequestKind,
  ProjectContextResult,
  ProjectContextScopeInput,
  ProjectMap,
  ProjectMapSummary,
  RepoContext,
  SourceSliceContext,
  SpaceContext,
} from './domain/project-context/index.js';
export { buildProjectContextPresenterInput } from './domain/project-context/index.js';
export type {
  ArchitectureCodeEntitySnapshot,
  ArchitectureDimensionCoverageSnapshot,
  ArchitectureDomain,
  ArchitectureEvidence,
  ArchitectureEvidenceSource,
  ArchitectureGraphModuleSnapshot,
  ArchitectureGraphSnapshot,
  ArchitectureIntelligenceInput,
  ArchitectureIntelligenceReport,
  ArchitectureKnowledgeEdgeSnapshot,
  ArchitectureManifestDependency,
  ArchitectureStyle,
  ArchitectureStyleReport,
  ComplexityReport,
  DomainSignal,
  DomainSignalReport,
  ProjectContextCapabilities as ProjectContextCapabilitiesContract,
  ProjectContextCapabilityQuery,
  ProjectInformationSupplementReport,
} from './project-context-capabilities.js';
export {
  createProjectContextCapabilities,
  ProjectContextCapabilities,
} from './project-context-capabilities.js';
export { ProjectContext } from './service/project-context/ProjectContextService.js';
// 解析语言单源(2026-07-11 P-D D6):Plugin 图适配层的 file-flow 目标选择消费同一
// 扩展名词表(此前它持第 6 份 JS-only 私有白名单,.swift 在选择层即被丢弃)。
export {
  AST_PARSER_LANGUAGES,
  EXTENSION_PARSER_LANGUAGE,
  JS_FAMILY_LANGUAGES,
  resolveAstParserLanguage,
} from './service/project-context/shared/parserLanguage.js';
// PC-F final-artifact 合约冻结 foundation 聚合面；文件引用 helper 属于 live ProjectContext 公共能力。
export { createProjectContextFileRef } from './service/project-context/shared/sourceSlice-fileSymbols/contracts.js';
