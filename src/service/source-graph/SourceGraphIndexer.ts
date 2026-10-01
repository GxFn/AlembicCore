import { EXTENSION_PARSER_LANGUAGE } from '../../core/facts/parserLanguage.js';
import {
  createSourceGraphDiagnostic,
  createSourceGraphFreshness,
  createSourceGraphStatusResult,
  type SourceFileNode,
  type SourceFileNodeInput,
  type SourceGraphDiagnostic,
  type SourceGraphEdge,
  type SourceGraphEdgeInput,
  type SourceGraphFreshness,
  type SourceGraphSnapshotStatus,
  type SourceSymbolNode,
} from '../../domain/source-graph/index.js';
import type {
  SourceGraphFreshnessReport,
  SourceGraphIndexBuildResult,
} from '../../domain/source-graph/SourceGraphContracts.js';
import { indexWithCodeGraphNative } from '../../infrastructure/analysis/CodeGraphNativeIndex.js';
import { throwIfSourceReadAborted } from '../../infrastructure/io/ProjectSourceReader.js';
import Logger from '../../infrastructure/logging/Logger.js';
import type { SourceGraphRepositoryImpl } from '../../repository/source-graph/SourceGraphRepository.js';
import { EXTERNAL_EDGE_RULES_VERSION, importExternalEdges } from './SourceGraphExternalEdges.js';
import {
  analyzeInventoryFile,
  diagnosticsForRetainedFile,
  type FileLinkFacts,
  type InventoryFile,
} from './SourceGraphFileAnalyzer.js';
import { compareSourceGraphIndexIdentity } from './SourceGraphIndexIdentity.js';
import {
  DEFAULT_EXTERNAL_TIMEOUT_MS,
  LINKED_MODULE_EXTENSIONS,
  type NormalizedIndexOptions,
  normalizeIndexOptions,
  type SourceGraphFreshnessOptions,
  type SourceGraphIncrementalIndexOptions,
  type SourceGraphIndexOptions,
} from './SourceGraphIndexOptions.js';
import {
  collectInventory,
  detectChangedFiles,
  normalizeRepoPathList,
} from './SourceGraphInventory.js';
import { linkFile } from './SourceGraphLinker.js';

export type {
  SourceGraphFreshnessReport,
  SourceGraphIndexBuildResult,
} from '../../domain/source-graph/SourceGraphContracts.js';
export type {
  SourceGraphFreshnessOptions,
  SourceGraphIncrementalIndexOptions,
  SourceGraphIndexOptions,
} from './SourceGraphIndexOptions.js';
export { SOURCE_GRAPH_INDEXER_VERSION } from './SourceGraphIndexOptions.js';

export class SourceGraphIndexer {
  constructor(private readonly repository: SourceGraphRepositoryImpl) {}

  async buildFull(input: SourceGraphIndexOptions): Promise<SourceGraphIndexBuildResult> {
    const options = await normalizeIndexOptions(input);
    const inventory = await collectInventory(options);
    return this.buildGeneration({
      options,
      generationId: input.generationId ?? createGenerationId(options.repoId, options.now),
      inventory,
      currentByPath: new Map(inventory.map((file) => [file.repoRelativePath, file])),
      changedFiles: inventory.map((file) => file.repoRelativePath),
      deletedFiles: [],
      baseGenerationId: undefined,
    });
  }

  async buildIncremental(
    input: SourceGraphIncrementalIndexOptions
  ): Promise<SourceGraphIndexBuildResult> {
    const options = await normalizeIndexOptions(input);
    const baseSnapshot = input.baseGenerationId
      ? await this.repository.getSnapshot(input.baseGenerationId)
      : await this.repository.getLatestSnapshot(options.projectRoot, options.repoId);
    throwIfSourceReadAborted(options);

    if (!baseSnapshot) {
      return this.buildFull(input);
    }
    const identityChange = compareSourceGraphIndexIdentity(baseSnapshot, options.indexIdentity);
    if (identityChange) {
      // 内容未变不等于事实可继承；同一次重建不能给旧符号/旧解析预算盖上新引擎身份。
      Logger.getInstance().info(
        'Source graph index identity changed; rebuilding the complete generation',
        {
          projectRoot: options.projectRoot,
          baseGenerationId: baseSnapshot.generationId,
          previousExtractorVersion: baseSnapshot.extractionVersion,
          extractorVersion: options.extractorVersion,
          reason: identityChange,
        }
      );
      return this.buildFull(input);
    }

    const inventory = await collectInventory(options);
    const currentByPath = new Map(inventory.map((file) => [file.repoRelativePath, file]));
    const baseFiles = await this.repository.listFiles(baseSnapshot.generationId);
    const detected = await detectChangedFiles(options, baseFiles, currentByPath);
    const changedFiles = normalizeRepoPathList(
      [...(input.changedFiles ?? []), ...detected.changedFiles],
      options.projectRoot
    ).filter((repoPath) => currentByPath.has(repoPath));
    const deletedFiles = normalizeRepoPathList(
      [...(input.deletedFiles ?? []), ...detected.deletedFiles],
      options.projectRoot
    );
    const changedSet = new Set(changedFiles);
    const deletedSet = new Set(deletedFiles);
    const basePaths = new Set(baseFiles.map((file) => file.repoRelativePath));
    const addedFiles = changedFiles.filter((filePath) => !basePaths.has(filePath));
    const baseEdges = await this.repository.listGenerationEdges(baseSnapshot.generationId);
    // 没改内容的文件也可能要重新链接，因为它的出边依赖别的文件：
    // - 文件集合变了：相对导入可能落到别的文件（目标消失/恢复、同名入口优先级变化），
    //   所有会做模块解析的文件都重来。
    // - 只有内容变了：直接导入它的文件，以及经 re-export 链拿到它声明的文件，调用目标可能变化。
    const fileSetChanged = addedFiles.length > 0 || deletedFiles.length > 0;
    const relinkCandidates = fileSetChanged
      ? inventory
          .filter((file) => LINKED_MODULE_EXTENSIONS.has(file.extension))
          .map((file) => file.repoRelativePath)
      : [...collectImporterClosure(baseEdges, new Set(changedFiles))];
    const reparsedFiles = relinkCandidates
      .filter(
        (filePath) =>
          currentByPath.has(filePath) && !changedSet.has(filePath) && !deletedSet.has(filePath)
      )
      .sort();
    const indexedFiles = new Set([...changedFiles, ...reparsedFiles]);
    const impacted = new Set([...indexedFiles, ...deletedSet]);
    if (reparsedFiles.length > 0) {
      Logger.getInstance().info(
        'Source graph re-links unchanged files after their inputs changed',
        {
          baseGenerationId: baseSnapshot.generationId,
          addedFiles,
          deletedFiles,
          changedFiles,
          reparsedFiles,
          reason: fileSetChanged
            ? 'relative-import-targets-changed'
            : 'imported-declarations-changed',
        }
      );
    }
    const preservedFiles = baseFiles
      .filter(
        (file) => !impacted.has(file.repoRelativePath) && currentByPath.has(file.repoRelativePath)
      )
      .map((file) => ({ ...file, generationId: input.generationId ?? '' }));
    const preservedSymbols = (await this.repository.listSymbols(baseSnapshot.generationId))
      .filter((symbol) => !impacted.has(symbol.filePath))
      .map((symbol) => ({ ...symbol, generationId: input.generationId ?? '' }));
    const contentChanged = new Set([...changedSet, ...deletedSet]);
    const preservedEdges = baseEdges
      .filter((edge) => {
        // 外部引擎的边每一代整体重新导入，从不沿用。
        if (isExternalEdge(edge)) {
          return false;
        }
        // 来源文件被重新分析的边一律重算，不沿用。
        if (
          (edge.fromFilePath && indexedFiles.has(edge.fromFilePath)) ||
          (edge.siteFilePath && indexedFiles.has(edge.siteFilePath))
        ) {
          return false;
        }
        if (edge.kind === 'imports' && edge.toSymbolId === undefined) {
          // 文件级依赖在目标内容变化后仍成立，只有目标被删除才失效。
          return !edgeTouchesFiles(edge, deletedSet);
        }
        // 符号边：目标文件内容变了，声明可能已删除或改名，不能留到新的 fresh generation。
        // 目标只是被重连（内容没变）时声明和标识都没变，边继续成立。
        return !edgeTouchesFiles(edge, contentChanged);
      })
      .map((edge) => ({ ...edge, generationId: input.generationId ?? '' }));
    const changedInventory = [...indexedFiles]
      .sort()
      .map((repoPath) => currentByPath.get(repoPath))
      .filter((file): file is InventoryFile => file !== undefined);

    return this.buildGeneration({
      options,
      generationId: input.generationId ?? createGenerationId(options.repoId, options.now),
      inventory: changedInventory,
      currentByPath,
      changedFiles,
      deletedFiles,
      baseGenerationId: baseSnapshot.generationId,
      preservedFiles,
      preservedSymbols,
      preservedEdges,
    });
  }

  private async buildGeneration(input: {
    options: NormalizedIndexOptions;
    generationId: string;
    /** 本次要分析的文件；增量构建里是变化的文件加上需要重连的文件。 */
    inventory: InventoryFile[];
    /** 当前磁盘上的完整清单，供链接时按需读取沿用自上一代的目标文件。 */
    currentByPath: ReadonlyMap<string, InventoryFile>;
    changedFiles: string[];
    deletedFiles: string[];
    baseGenerationId?: string;
    preservedFiles?: SourceFileNode[];
    preservedSymbols?: SourceSymbolNode[];
    preservedEdges?: SourceGraphEdge[];
  }): Promise<SourceGraphIndexBuildResult> {
    const { options, generationId } = input;
    const analyzedFiles = await mapInOrder(input.inventory, ANALYSIS_CONCURRENCY, (file) =>
      analyzeInventoryFile(file, options, generationId)
    );
    throwIfSourceReadAborted(options);

    const knownPaths = new Set([
      ...input.inventory.map((file) => file.repoRelativePath),
      ...(input.preservedFiles ?? []).map((file) => file.repoRelativePath),
    ]);
    const facts = new Map<string, Promise<FileLinkFacts | undefined>>(
      analyzedFiles.map((file) => [file.file.repoRelativePath, Promise.resolve(file.facts)])
    );
    const preservedByPath = new Map(
      (input.preservedFiles ?? []).map((file) => [file.repoRelativePath, file])
    );
    const factsOf = (filePath: string): Promise<FileLinkFacts | undefined> => {
      let pending = facts.get(filePath);
      if (!pending) {
        pending = this.readPreservedFacts(
          input.currentByPath.get(filePath),
          preservedByPath.get(filePath),
          options,
          generationId
        );
        facts.set(filePath, pending);
      }
      return pending;
    };
    const linkedEdges: SourceGraphEdgeInput[] = [];
    for (const analyzed of analyzedFiles) {
      throwIfSourceReadAborted(options);
      if (!analyzed.facts) {
        continue;
      }
      const linked = await linkFile(analyzed.facts, { generationId, knownPaths, factsOf });
      linkedEdges.push(...linked.edges);
      analyzed.file.metadata = { ...analyzed.file.metadata, callSites: linked.callSites };
      // 调用点只为链接而留；声明与导出表继续供后面的文件当链接目标。
      analyzed.facts.callSites = undefined;
    }
    throwIfSourceReadAborted(options);
    // 未重解析的文件仍保留上一代的解析缺口。只汇总本轮 diagnostics 会把
    // failed/skipped/partial 文件误报为 fresh；诊断从持久化 parseErrors 恢复，
    // 文件被重解析或删除后自然消失，不永久继承上一代整体降级状态。
    const diagnostics = [
      ...(input.preservedFiles ?? []).flatMap(diagnosticsForRetainedFile),
      ...analyzedFiles.flatMap((file) => file.diagnostics),
    ]
      .map(createSourceGraphDiagnostic)
      .sort((left, right) => (left.filePath ?? '').localeCompare(right.filePath ?? ''));
    const filesForReplace = [
      ...(input.preservedFiles ?? []).map((file) => ({
        ...file,
        generationId: input.generationId,
        projectRoot: input.options.projectRoot,
      })),
      ...analyzedFiles.map((file) => file.file),
    ];
    const symbolsForReplace = [
      ...(input.preservedSymbols ?? []).map((symbol) => ({
        ...symbol,
        generationId: input.generationId,
      })),
      ...analyzedFiles.flatMap((file) => file.symbols),
    ];
    const ownEdges: SourceGraphEdgeInput[] = [
      ...(input.preservedEdges ?? []).map((edge) => ({
        ...edge,
        generationId: input.generationId,
      })),
      ...linkedEdges,
    ];
    const external = input.options.codeGraph
      ? await this.linkExternalEdges({
          options,
          generationId,
          currentByPath: input.currentByPath,
          files: filesForReplace,
          symbols: symbolsForReplace,
          ownEdges,
        })
      : undefined;
    // 存储顺序即查询读到的顺序：文件依赖在前、跨文件关系其次、文件内关系最后，
    // 受预算截断的查询因此先拿到跨文件信息；全量与增量构建的顺序也由此一致。
    const edgesForReplace = [...ownEdges, ...(external?.edges ?? [])].sort(compareEdgesForStorage);
    const status = chooseSnapshotStatus(filesForReplace, diagnostics);
    throwIfSourceReadAborted(input.options);
    const snapshot = await this.repository.replaceGeneration({
      snapshot: {
        generationId: input.generationId,
        projectRoot: input.options.projectRoot,
        repoId: input.options.repoId,
        graphRoot: input.options.graphRoot,
        projectScope: input.options.projectScope,
        extractionVersion: input.options.extractorVersion,
        status,
        startedAt: input.options.now,
        completedAt: input.options.now,
        indexedAt: input.options.now,
        degradedReason: summarizeDegradedReason(diagnostics),
        freshness: createFreshness(status, input.generationId, input.options.now, diagnostics),
        metadata: {
          mode: input.baseGenerationId ? 'incremental' : 'full',
          baseGenerationId: input.baseGenerationId,
          changedFiles: input.changedFiles,
          deletedFiles: input.deletedFiles,
          extractorVersion: input.options.extractorVersion,
          indexIdentity: input.options.indexIdentity,
          ...(external ? { externalLinker: external.metadata } : {}),
        },
      },
      files: filesForReplace,
      symbols: symbolsForReplace,
      edges: edgesForReplace,
    });
    const files = await this.repository.listFiles(snapshot.generationId);
    const symbols = await this.repository.listSymbols(snapshot.generationId);
    const edges = await this.repository.listGenerationEdges(snapshot.generationId);
    const statusResult = createSourceGraphStatusResult({
      generationId: snapshot.generationId,
      projectRoot: snapshot.projectRoot,
      repoId: snapshot.repoId,
      freshness: snapshot.freshness,
      snapshot,
      diagnostics,
    });

    return {
      snapshot,
      status: statusResult,
      diagnostics,
      changedFiles: input.changedFiles,
      deletedFiles: input.deletedFiles,
      files,
      symbols,
      edges,
    };
  }

  /**
   * 外部引擎（CodeGraph）的边。它是可选的补充：引擎没装、超时或出错时本代照常发布，
   * 只是没有这部分边，并在代际元数据里写明原因。取消不算降级，照常向上抛。
   */
  private async linkExternalEdges(input: {
    options: NormalizedIndexOptions;
    generationId: string;
    currentByPath: ReadonlyMap<string, InventoryFile>;
    files: readonly SourceFileNodeInput[];
    symbols: readonly SourceSymbolNode[];
    ownEdges: readonly SourceGraphEdgeInput[];
  }): Promise<{ edges: SourceGraphEdgeInput[]; metadata: Record<string, unknown> }> {
    const { options } = input;
    const base = { engine: 'codegraph', rulesVersion: EXTERNAL_EDGE_RULES_VERSION };
    // 交给外部引擎的文件：自有分析完整解析过的源码（两边的声明才对得上），外加模块解析要读的配置。
    const mirror = input.files.flatMap((file) => {
      const inventory = input.currentByPath.get(file.repoRelativePath);
      if (!inventory) {
        return [];
      }
      const source =
        file.parseStatus === 'parsed' && inventory.extension in EXTENSION_PARSER_LANGUAGE;
      const support = MODULE_CONFIG_FILE.test(file.repoRelativePath);
      return source || support
        ? [{ relativePath: file.repoRelativePath, absolutePath: inventory.absolutePath }]
        : [];
    });
    if (mirror.length === 0) {
      return { edges: [], metadata: { ...base, status: 'skipped', reason: 'no-source-files' } };
    }
    const started = performance.now();
    try {
      const result = await indexWithCodeGraphNative({
        dataRoot: options.codeGraph!.dataRoot,
        files: mirror,
        signal: options.signal,
        timeoutMs: options.codeGraph!.timeoutMs ?? DEFAULT_EXTERNAL_TIMEOUT_MS,
      });
      throwIfSourceReadAborted(options);
      const imported = importExternalEdges({
        generationId: input.generationId,
        result,
        symbols: input.symbols,
        contentHashes: new Map(
          input.files.map((file) => [file.repoRelativePath, file.contentHash])
        ),
        ownEdges: input.ownEdges,
      });
      Logger.getInstance().info('Source graph imported external edges', {
        generationId: input.generationId,
        engine: 'codegraph',
        sdkVersion: result.engine.sdkVersion,
        mirrorFiles: mirror.length,
        indexedFiles: result.files.length,
        durationMs: Math.round(performance.now() - started),
        ...imported.summary,
      });
      return {
        edges: imported.edges,
        metadata: {
          ...base,
          status: 'linked',
          sdkVersion: result.engine.sdkVersion,
          ...imported.summary,
        },
      };
    } catch (error) {
      throwIfSourceReadAborted(options);
      const reason = error instanceof Error ? error.message : String(error);
      // 降级：自有的符号与边不受影响，本代只是没有外部边。
      Logger.getInstance().warn('Source graph external linker is unavailable; own edges only', {
        generationId: input.generationId,
        engine: 'codegraph',
        code: error instanceof Error && 'code' in error ? String(error.code) : undefined,
        reason,
        mirrorFiles: mirror.length,
        durationMs: Math.round(performance.now() - started),
      });
      return { edges: [], metadata: { ...base, status: 'unavailable', reason } };
    }
  }

  /**
   * 沿用自上一代的文件被本次分析的文件导入时，按需读一遍它的声明作为链接目标。
   * 内容必须仍是上一代记录的那一份；清单检查之后又被改动的文件不当目标，
   * 下一次新鲜度检查会把它判成变化并重连它的导入方。
   */
  private async readPreservedFacts(
    file: InventoryFile | undefined,
    preserved: SourceFileNode | undefined,
    options: NormalizedIndexOptions,
    generationId: string
  ): Promise<FileLinkFacts | undefined> {
    if (!file || !preserved || preserved.parseStatus !== 'parsed') {
      return undefined;
    }
    const analyzed = await analyzeInventoryFile(file, options, generationId, true);
    if (analyzed.file.contentHash !== preserved.contentHash) {
      Logger.getInstance().warn(
        'Source graph skipped a link target that changed during the build',
        {
          filePath: file.repoRelativePath,
          indexedHash: preserved.contentHash,
          contentHash: analyzed.file.contentHash,
          nextAction: 'run_incremental_source_graph_index',
        }
      );
      return undefined;
    }
    return analyzed.facts;
  }
}

export class SourceGraphFreshnessService {
  constructor(private readonly repository: SourceGraphRepositoryImpl) {}

  async inspect(input: SourceGraphFreshnessOptions): Promise<SourceGraphFreshnessReport> {
    const options = await normalizeIndexOptions(input);
    const snapshot = input.generationId
      ? await this.repository.getSnapshot(input.generationId)
      : await this.repository.getLatestSnapshot(options.projectRoot, options.repoId);
    throwIfSourceReadAborted(options);

    if (!snapshot) {
      const freshness = createSourceGraphFreshness({
        status: 'uninitialized',
        checkedAt: options.now,
        reason: 'No source graph generation exists for this project.',
        nextAction: 'build_source_graph',
      });
      const diagnostics = [
        createSourceGraphDiagnostic({
          code: 'source-ref-unproven',
          message: 'No source graph generation exists for this project.',
          nextAction: 'build_source_graph',
        }),
      ];
      return {
        freshness,
        diagnostics,
        changedFiles: [],
        deletedFiles: [],
        status: createSourceGraphStatusResult({
          projectRoot: options.projectRoot,
          repoId: options.repoId,
          freshness,
          diagnostics,
        }),
      };
    }

    const identityChange = compareSourceGraphIndexIdentity(snapshot, options.indexIdentity);
    if (identityChange) {
      const reason =
        'Source graph extraction identity or indexing policy changed; a full rebuild is required.';
      Logger.getInstance().info(reason, {
        generationId: snapshot.generationId,
        previousExtractorVersion: snapshot.extractionVersion,
        extractorVersion: options.extractorVersion,
        reason: identityChange,
      });
      const freshness = createSourceGraphFreshness({
        status: 'stale',
        checkedAt: options.now,
        generationId: snapshot.generationId,
        indexedAt: snapshot.indexedAt,
        reason,
        nextAction: 'rebuild_source_graph',
      });
      const diagnostics = [
        createSourceGraphDiagnostic({
          code: 'source-ref-unproven',
          message: reason,
          nextAction: 'rebuild_source_graph',
          metadata: { reason: identityChange, expectedIdentity: options.indexIdentity.hash },
        }),
      ];
      return {
        snapshot,
        freshness,
        diagnostics,
        changedFiles: [],
        deletedFiles: [],
        status: createSourceGraphStatusResult({
          generationId: snapshot.generationId,
          projectRoot: snapshot.projectRoot,
          repoId: snapshot.repoId,
          freshness,
          snapshot,
          diagnostics,
        }),
      };
    }

    const inventory = await collectInventory(options);
    const currentByPath = new Map(inventory.map((file) => [file.repoRelativePath, file]));
    const baseFiles = await this.repository.listFiles(snapshot.generationId);
    const detected = await detectChangedFiles(options, baseFiles, currentByPath);
    throwIfSourceReadAborted(options);
    const isStale = detected.changedFiles.length > 0 || detected.deletedFiles.length > 0;
    const freshness = isStale
      ? createSourceGraphFreshness({
          status: 'stale',
          checkedAt: options.now,
          generationId: snapshot.generationId,
          indexedAt: snapshot.indexedAt,
          reason: 'Source graph generation no longer matches the filesystem inventory.',
          nextAction: 'run_incremental_source_graph_index',
          pendingFileCount: detected.changedFiles.length,
          staleFileCount: detected.deletedFiles.length,
        })
      : createSourceGraphFreshness({
          ...snapshot.freshness,
          checkedAt: options.now,
          generationId: snapshot.generationId,
          indexedAt: snapshot.indexedAt,
        });
    const diagnostics = isStale
      ? [
          createSourceGraphDiagnostic({
            code: 'pending-file-in-response',
            message: 'Filesystem changes are pending source graph catch-up.',
            metadata: {
              changedFiles: detected.changedFiles,
              deletedFiles: detected.deletedFiles,
            },
          }),
        ]
      : [];

    return {
      snapshot,
      freshness,
      diagnostics,
      changedFiles: detected.changedFiles,
      deletedFiles: detected.deletedFiles,
      status: createSourceGraphStatusResult({
        generationId: snapshot.generationId,
        projectRoot: snapshot.projectRoot,
        repoId: snapshot.repoId,
        freshness,
        snapshot,
        diagnostics,
      }),
    };
  }
}

function createFreshness(
  status: SourceGraphSnapshotStatus,
  generationId: string,
  now: number,
  diagnostics: SourceGraphDiagnostic[]
): SourceGraphFreshness {
  const freshnessStatus =
    status === 'indexed' ? 'fresh' : status === 'partial' ? 'partial' : 'degraded';
  return createSourceGraphFreshness({
    status: freshnessStatus,
    checkedAt: now,
    generationId,
    indexedAt: now,
    pendingFileCount: 0,
    staleFileCount: 0,
    reason:
      diagnostics.length > 0
        ? 'Source graph generation completed with degraded coverage.'
        : undefined,
    nextAction: diagnostics.length > 0 ? 'review_source_graph_diagnostics' : undefined,
    degradedReason: summarizeDegradedReason(diagnostics),
  });
}

function chooseSnapshotStatus(
  files: SourceFileNodeInput[],
  diagnostics: SourceGraphDiagnostic[]
): SourceGraphSnapshotStatus {
  if (diagnostics.length === 0) {
    return 'indexed';
  }
  return files.some((file) => file.parseStatus === 'parsed' || file.parseStatus === 'partial')
    ? 'partial'
    : 'degraded';
}

function summarizeDegradedReason(diagnostics: SourceGraphDiagnostic[]): string | undefined {
  if (diagnostics.length === 0) {
    return undefined;
  }
  return Array.from(new Set(diagnostics.map((diagnostic) => diagnostic.code))).join(',');
}

function edgeTouchesFiles(edge: SourceGraphEdge, impacted: Set<string>): boolean {
  return (
    (edge.fromFilePath !== undefined && impacted.has(edge.fromFilePath)) ||
    (edge.toFilePath !== undefined && impacted.has(edge.toFilePath)) ||
    (edge.siteFilePath !== undefined && impacted.has(edge.siteFilePath))
  );
}

/** 外部引擎解析模块说明符时会读的配置文件。 */
const MODULE_CONFIG_FILE = /(^|\/)(tsconfig(\.[\w.-]+)?\.json|jsconfig\.json|package\.json)$/;

function isExternalEdge(edge: SourceGraphEdge): boolean {
  const resolution = edge.metadata.resolution;
  return (
    !!resolution &&
    typeof resolution === 'object' &&
    'linker' in resolution &&
    resolution.linker === 'codegraph'
  );
}

/** 分析是 CPU 密集的同步解析；并发只为重叠文件读取，并限制同时打开的文件数。 */
const ANALYSIS_CONCURRENCY = 16;

async function mapInOrder<T, R>(
  items: readonly T[],
  concurrency: number,
  map: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await map(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 内容变化的文件要连带重连哪些文件：直接导入它的文件；如果导入方又把它 re-export 出去，
 * 变化继续传给导入方的导入方。只做普通导入的文件不再往上传——它的导入方拿不到这些声明。
 */
function collectImporterClosure(
  baseEdges: readonly SourceGraphEdge[],
  changedFiles: ReadonlySet<string>
): Set<string> {
  const importers = new Map<string, { filePath: string; reexport: boolean }[]>();
  for (const edge of baseEdges) {
    if (
      edge.kind !== 'imports' ||
      edge.toSymbolId !== undefined ||
      !edge.fromFilePath ||
      !edge.toFilePath
    ) {
      continue;
    }
    const list = importers.get(edge.toFilePath) ?? [];
    list.push({ filePath: edge.fromFilePath, reexport: edge.metadata.reexport === true });
    importers.set(edge.toFilePath, list);
  }
  const relink = new Set<string>();
  const propagated = new Set(changedFiles);
  const queue = [...changedFiles];
  for (let target = queue.pop(); target !== undefined; target = queue.pop()) {
    for (const importer of importers.get(target) ?? []) {
      relink.add(importer.filePath);
      if (importer.reexport && !propagated.has(importer.filePath)) {
        propagated.add(importer.filePath);
        queue.push(importer.filePath);
      }
    }
  }
  return relink;
}

function compareEdgesForStorage(left: SourceGraphEdgeInput, right: SourceGraphEdgeInput): number {
  return (
    edgeStorageRank(left) - edgeStorageRank(right) ||
    (left.edgeId < right.edgeId ? -1 : left.edgeId > right.edgeId ? 1 : 0)
  );
}

function edgeStorageRank(edge: SourceGraphEdgeInput): number {
  if (edge.kind === 'imports') {
    return 0;
  }
  return edge.fromFilePath !== undefined && edge.fromFilePath === edge.toFilePath ? 2 : 1;
}

function createGenerationId(repoId: string, now: number): string {
  return `${repoId.replace(/[^A-Za-z0-9_-]/g, '-').toLowerCase()}-${now}`;
}
