/**
 * 既有 service/vector 入口保持转发；协议适配实现归 infrastructure，供批处理和服务共同使用。
 * src/vector.ts 与 service barrel 的现有消费者继续使用同一类/类型，不扩展公共出口。
 */
export type {
  EmbeddingCapabilityDescriptor,
  EmbeddingExecutionContext,
  EmbeddingInputKind,
  EmbeddingPort,
  LegacyEmbedProvider,
  LegacyEmbedProviderAdapterOptions,
} from '../../infrastructure/vector/EmbeddingPort.js';
export {
  asEmbeddingPort,
  isEmbeddingPort,
  LegacyEmbedProviderAdapter,
} from '../../infrastructure/vector/EmbeddingPort.js';
