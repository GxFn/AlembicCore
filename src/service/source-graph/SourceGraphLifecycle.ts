import type {
  SourceGraphLifecycleAction,
  SourceGraphLifecycleReason,
  SourceGraphLifecycleResult,
} from '../../domain/source-graph/SourceGraphContracts.js';
import type { SourceGraphRepositoryImpl } from '../../repository/source-graph/SourceGraphRepository.js';
import type {
  SourceGraphFreshnessReport,
  SourceGraphIncrementalIndexOptions,
  SourceGraphIndexBuildResult,
  SourceGraphIndexOptions,
} from './SourceGraphIndexer.js';
import { SourceGraphService } from './SourceGraphService.js';

// W4 批A(T1):Lifecycle 结果契约本体下沉 domain/source-graph 契约家;re-export 保表面。
export type {
  SourceGraphLifecycleAction,
  SourceGraphLifecycleReason,
  SourceGraphLifecycleResult,
} from '../../domain/source-graph/SourceGraphContracts.js';

/**
 * SourceGraphLifecycleService 是宿主启动/冷启动/文件变化监听的 Core 入口。
 * 它只编排现有 Indexer/inspect，不引入宿主 MCP、文件监听器或 UI 责任。
 */
export class SourceGraphLifecycleService {
  readonly #service: SourceGraphService;

  constructor(repository: SourceGraphRepositoryImpl) {
    this.#service = new SourceGraphService(repository);
  }

  async buildColdStartIndex(input: SourceGraphIndexOptions): Promise<SourceGraphLifecycleResult> {
    const build = await this.#service.buildFullIndex(input);
    return lifecycleFromBuild('cold-start', 'built-full', build);
  }

  async catchUpOnStartup(input: SourceGraphIndexOptions): Promise<SourceGraphLifecycleResult> {
    const { generationId: nextGenerationId, ...inspectionInput } = input;
    const inspection = await this.#service.inspectFreshness(inspectionInput);
    if (!inspection.snapshot) {
      const build = await this.#service.buildFullIndex(input);
      return lifecycleFromBuild('startup-catch-up', 'built-full', build);
    }
    if (
      inspection.freshness.status === 'stale' ||
      inspection.freshness.pendingFileCount > 0 ||
      inspection.freshness.staleFileCount > 0
    ) {
      const build = await this.#service.buildIncrementalIndex({
        ...input,
        generationId: nextGenerationId,
        baseGenerationId: inspection.snapshot.generationId,
        changedFiles: inspection.changedFiles,
        deletedFiles: inspection.deletedFiles,
      });
      return lifecycleFromBuild('startup-catch-up', 'built-incremental', build);
    }
    return lifecycleFromInspection('startup-catch-up', 'fresh-noop', inspection, input);
  }

  async syncFileChanges(
    input: SourceGraphIncrementalIndexOptions
  ): Promise<SourceGraphLifecycleResult> {
    const build = await this.#service.buildIncrementalIndex(input);
    return lifecycleFromBuild('file-change', 'built-incremental', build);
  }

  async inspect(input: SourceGraphIndexOptions): Promise<SourceGraphLifecycleResult> {
    const inspection = await this.#service.inspectFreshness(input);
    return lifecycleFromInspection('startup-catch-up', 'inspected', inspection, input);
  }
}

function lifecycleFromBuild(
  reason: SourceGraphLifecycleReason,
  action: SourceGraphLifecycleAction,
  build: SourceGraphIndexBuildResult
): SourceGraphLifecycleResult {
  return {
    operation: 'source-graph-lifecycle',
    reason,
    action,
    projectRoot: build.snapshot.projectRoot,
    repoId: build.snapshot.repoId,
    generationId: build.snapshot.generationId,
    freshness: build.snapshot.freshness,
    status: build.status,
    diagnostics: build.diagnostics,
    changedFiles: build.changedFiles,
    deletedFiles: build.deletedFiles,
    durableTables: {
      source_graph_generations: 1,
      source_graph_files: build.files.length,
      source_graph_symbols: build.symbols.length,
      source_graph_edges: build.edges.length,
    },
    build,
  };
}

function lifecycleFromInspection(
  reason: SourceGraphLifecycleReason,
  action: SourceGraphLifecycleAction,
  inspection: SourceGraphFreshnessReport,
  input: SourceGraphIndexOptions
): SourceGraphLifecycleResult {
  return {
    operation: 'source-graph-lifecycle',
    reason,
    action,
    projectRoot: inspection.snapshot?.projectRoot ?? input.projectRoot,
    repoId: inspection.snapshot?.repoId ?? input.repoId?.trim() ?? 'default',
    generationId: inspection.snapshot?.generationId ?? input.generationId,
    freshness: inspection.freshness,
    status: inspection.status,
    diagnostics: inspection.diagnostics,
    changedFiles: inspection.changedFiles,
    deletedFiles: inspection.deletedFiles,
    durableTables: {
      source_graph_generations: inspection.snapshot ? 1 : 0,
      source_graph_files: inspection.snapshot?.fileCount ?? 0,
      source_graph_symbols: inspection.snapshot?.symbolCount ?? 0,
      source_graph_edges: inspection.snapshot?.edgeCount ?? 0,
    },
    inspection,
  };
}
