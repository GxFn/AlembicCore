/**
 * ProjectContext certified facts foundation 独立入口。
 *
 * live ProjectContext envelope 继续保留绝对 root 与兼容字段；只有本入口构建的 durable
 * projection 会移除 host path，并按 non-circular manifest 顺序生成内容身份。
 */

export type {
  CertifiedProjectFactsArtifactV1,
  CertifiedProjectFactsConsumerBindingV1,
  ProjectContextFoundationCaptureInput,
  ProjectContextFoundationHostPorts,
  SourceRevisionVectorV1,
} from './service/project-context/foundation/contracts.js';
export * from './service/project-context/foundation/index.js';
export { createProjectContextFileRef } from './service/project-context/shared/sourceSlice-fileSymbols/contracts.js';
