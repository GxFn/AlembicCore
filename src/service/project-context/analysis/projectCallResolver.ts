import type { FileFlowExtractionResult } from '../fileFlow/contracts.js';
import type { ProjectContextHandlerExecutionContext } from '../interface/contracts.js';
import type { SourceSliceFileFacts } from '../sourceSlice/contracts.js';
import type { ProjectContextSymbolExtractor } from './SymbolExtractor.js';

export type ProjectCallResolver = (
  facts: SourceSliceFileFacts,
  flow: FileFlowExtractionResult,
  context?: ProjectContextHandlerExecutionContext
) => Promise<FileFlowExtractionResult>;

// 能力仅随SDK factory创建的后端对象存在，不存当前项目或跨会话全局图。
const resolvers = new WeakMap<ProjectContextSymbolExtractor, ProjectCallResolver>();
export function bindProjectCallResolver(
  backend: ProjectContextSymbolExtractor,
  resolver: ProjectCallResolver
): void {
  resolvers.set(backend, resolver);
}
export function projectCallResolver(
  backend: ProjectContextSymbolExtractor | undefined
): ProjectCallResolver | undefined {
  return backend ? resolvers.get(backend) : undefined;
}
