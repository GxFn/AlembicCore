import crypto from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createSourceGraphDiagnostic,
  createSourceGraphFreshness,
  createSourceGraphStatusResult,
  type SourceFileNode,
  type SourceFileNodeInput,
  type SourceGraphDiagnostic,
  type SourceGraphEdge,
  type SourceGraphFreshness,
  type SourceGraphSnapshotStatus,
  type SourceSymbolNode,
} from '../../domain/source-graph/index.js';
import type {
  SourceGraphFreshnessReport,
  SourceGraphIndexBuildResult,
} from '../../domain/source-graph/SourceGraphContracts.js';
import { throwIfSourceReadAborted } from '../../infrastructure/io/ProjectSourceReader.js';
import Logger from '../../infrastructure/logging/Logger.js';
import type { SourceGraphRepositoryImpl } from '../../repository/source-graph/SourceGraphRepository.js';
import { withCodeGraphAnalysis } from '../code-analysis/withCodeGraphAnalysis.js';
import type { ProjectContextSymbolExtractor } from '../project-context/analysis/SymbolExtractor.js';
import {
  diagnosticsForRetainedFile,
  type InventoryFile,
  type ParsedFile,
  parseInventoryFile,
} from './SourceGraphFileAnalyzer.js';
import { compareSourceGraphIndexIdentity } from './SourceGraphIndexIdentity.js';
import {
  CODEGRAPH_PARSABLE_EXTENSIONS,
  type NormalizedIndexOptions,
  normalizeExtension,
  normalizeIndexOptions,
  normalizeRepoRelative,
  PARSABLE_EXTENSIONS,
  type SourceGraphFreshnessOptions,
  type SourceGraphIncrementalIndexOptions,
  type SourceGraphIndexOptions,
} from './SourceGraphIndexOptions.js';

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
    // import 边属于来源文件：只改目标内容不使边失效。文件集合变化则可能改变相对路径
    // 解析（目标消失/恢复或同名入口优先级变化），需要重新解析未修改的 JS/TS 来源文件。
    const reparsedFiles =
      addedFiles.length > 0 || deletedFiles.length > 0
        ? inventory
            .filter(
              (file) =>
                (options.codeGraph ? CODEGRAPH_PARSABLE_EXTENSIONS : PARSABLE_EXTENSIONS).has(
                  file.extension
                ) &&
                !changedSet.has(file.repoRelativePath) &&
                !deletedSet.has(file.repoRelativePath)
            )
            .map((file) => file.repoRelativePath)
        : [];
    const indexedFiles = new Set([...changedFiles, ...reparsedFiles]);
    const impacted = new Set([...indexedFiles, ...deletedSet]);
    if (reparsedFiles.length > 0) {
      Logger.getInstance().info('Source graph re-resolves imports after file inventory changed', {
        baseGenerationId: baseSnapshot.generationId,
        addedFiles,
        deletedFiles,
        reparsedFiles,
        reason: 'relative-import-targets-changed',
      });
    }
    const preservedFiles = baseFiles
      .filter(
        (file) => !impacted.has(file.repoRelativePath) && currentByPath.has(file.repoRelativePath)
      )
      .map((file) => ({ ...file, generationId: input.generationId ?? '' }));
    const preservedSymbols = (await this.repository.listSymbols(baseSnapshot.generationId))
      .filter((symbol) => !impacted.has(symbol.filePath))
      .map((symbol) => ({ ...symbol, generationId: input.generationId ?? '' }));
    const preservedEdges = (await this.repository.listGenerationEdges(baseSnapshot.generationId))
      .filter((edge) => {
        // 只有文件级 import 在目标内容变化后仍成立；符号边可能指向已删除/改名的声明，
        // 沿用旧失效规则，不能随 import 修复一起保留到新的 fresh generation。
        if (edge.kind !== 'imports' || edge.toSymbolId !== undefined) {
          return !edgeTouchesFiles(edge, impacted);
        }
        return (
          !edgeTouchesFiles(edge, deletedSet) &&
          !(edge.fromFilePath && indexedFiles.has(edge.fromFilePath)) &&
          !(edge.siteFilePath && indexedFiles.has(edge.siteFilePath))
        );
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
    inventory: InventoryFile[];
    changedFiles: string[];
    deletedFiles: string[];
    baseGenerationId?: string;
    preservedFiles?: SourceFileNode[];
    preservedSymbols?: SourceSymbolNode[];
    preservedEdges?: SourceGraphEdge[];
  }): Promise<SourceGraphIndexBuildResult> {
    const knownPaths = new Set([
      ...input.inventory.map((file) => file.repoRelativePath),
      ...(input.preservedFiles ?? []).map((file) => file.repoRelativePath),
    ]);
    const parseFiles = async (extractor?: ProjectContextSymbolExtractor) => {
      if (!extractor) {
        return Promise.all(
          input.inventory.map((file) =>
            parseInventoryFile(file, input.options, input.generationId, knownPaths)
          )
        );
      }
      const parsed: ParsedFile[] = [];
      // 单个SDK worker本来按序提取；逐文件读取避免同时把整仓文本堆入宿主/IPC队列。
      for (const file of input.inventory) {
        throwIfSourceReadAborted(input.options);
        parsed.push(
          await parseInventoryFile(file, input.options, input.generationId, knownPaths, extractor)
        );
      }
      return parsed;
    };
    const codeGraph = input.options.codeGraph;
    const hasEligibleFiles = input.inventory.some(
      (file) =>
        CODEGRAPH_PARSABLE_EXTENSIONS.has(file.extension) &&
        file.sizeBytes <= input.options.maxParseBytes &&
        file.sizeBytes <= input.options.maxFileSizeBytes
    );
    let parsedFiles: ParsedFile[];
    if (codeGraph && hasEligibleFiles) {
      parsedFiles = await withCodeGraphAnalysis(
        { ...codeGraph, signal: input.options.signal },
        async (extractor, runtime) => {
          if (runtime.engineHash !== input.options.engineHash) {
            throw new Error('Source graph CodeGraph identity changed before extraction.');
          }
          return parseFiles(extractor);
        }
      );
    } else {
      if (codeGraph) {
        Logger.debug(
          'Source graph does not open SDK without eligible JavaScript or TypeScript files',
          {
            generationId: input.generationId,
            files: input.inventory.length,
            reason: 'no-eligible-sdk-input',
          }
        );
      }
      parsedFiles = await parseFiles();
    }
    // worker真实退出后才提交SQLite；取消或清理失败不能留下一个“成功”的新generation。
    throwIfSourceReadAborted(input.options);
    // 未重解析的文件仍保留上一代的解析缺口。只汇总本轮 diagnostics 会把
    // failed/skipped/partial 文件误报为 fresh；诊断从持久化 parseErrors 恢复，
    // 文件被重解析或删除后自然消失，不永久继承上一代整体降级状态。
    const diagnostics = [
      ...(input.preservedFiles ?? []).flatMap(diagnosticsForRetainedFile),
      ...parsedFiles.flatMap((file) => file.diagnostics),
    ]
      .map(createSourceGraphDiagnostic)
      .sort((left, right) => (left.filePath ?? '').localeCompare(right.filePath ?? ''));
    const filesForReplace = [
      ...(input.preservedFiles ?? []).map((file) => ({
        ...file,
        generationId: input.generationId,
        projectRoot: input.options.projectRoot,
      })),
      ...parsedFiles.map((file) => file.file),
    ];
    const symbolsForReplace = [
      ...(input.preservedSymbols ?? []).map((symbol) => ({
        ...symbol,
        generationId: input.generationId,
      })),
      ...parsedFiles.flatMap((file) => file.symbols),
    ];
    const edgesForReplace = [
      ...(input.preservedEdges ?? []).map((edge) => ({
        ...edge,
        generationId: input.generationId,
      })),
      ...parsedFiles.flatMap((file) => file.edges),
    ];
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

async function collectInventory(options: NormalizedIndexOptions): Promise<InventoryFile[]> {
  throwIfSourceReadAborted(options);
  const files: InventoryFile[] = [];
  for (const graphRoot of options.graphRoots) {
    await walkDirectory(graphRoot, options, files);
  }
  return files.sort((left, right) => left.repoRelativePath.localeCompare(right.repoRelativePath));
}

async function walkDirectory(
  directory: string,
  options: NormalizedIndexOptions,
  files: InventoryFile[]
): Promise<void> {
  throwIfSourceReadAborted(options);
  let entries: Dirent[];
  try {
    if (
      options.privateRuntimeRoot &&
      (await fs.realpath(directory)) === options.privateRuntimeRoot
    ) {
      Logger.debug('Source graph excludes its private SDK runtime directory', {
        directory,
        reason: 'codegraph-runtime',
      });
      return;
    }
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    // 不完整清单不能被解释成“文件已删除”，否则增量索引会发布空的新一代事实。
    Logger.getInstance().error('Source graph inventory failed; previous generation retained', {
      directory,
      projectRoot: options.projectRoot,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    throwIfSourceReadAborted(options);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!options.ignoreDirectories.has(entry.name)) {
        await walkDirectory(absolutePath, options, files);
      }
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const extension = normalizeExtension(path.extname(entry.name));
    if (!options.includeExtensions.has(extension)) {
      continue;
    }
    const stat = await fs.stat(absolutePath);
    files.push({
      absolutePath,
      repoRelativePath: toRepoRelative(options.projectRoot, absolutePath),
      language: languageForExtension(extension),
      classification: classificationForPath(absolutePath),
      sizeBytes: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
      extension,
    });
  }
}

async function detectChangedFiles(
  options: NormalizedIndexOptions,
  baseFiles: SourceFileNode[],
  currentByPath: Map<string, InventoryFile>
): Promise<{ changedFiles: string[]; deletedFiles: string[] }> {
  const changedFiles = new Set<string>();
  const deletedFiles = new Set<string>();
  const baseByPath = new Map(baseFiles.map((file) => [file.repoRelativePath, file]));

  for (const baseFile of baseFiles) {
    throwIfSourceReadAborted(options);
    const current = currentByPath.get(baseFile.repoRelativePath);
    if (!current) {
      deletedFiles.add(baseFile.repoRelativePath);
      continue;
    }
    // size/mtime可被编辑器或恢复操作保持，不能证明事实仍对应正文；hash语义与索引时一致。
    const content = await fs.readFile(current.absolutePath, {
      encoding: 'utf8',
      signal: options.signal,
    });
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    if (hash !== baseFile.contentHash) {
      changedFiles.add(current.repoRelativePath);
      Logger.getInstance().debug('Source graph detected changed source content', {
        filePath: current.repoRelativePath,
        previousHash: baseFile.contentHash,
        contentHash: hash,
        metadataUnchanged:
          current.sizeBytes === baseFile.sizeBytes && current.mtimeMs === baseFile.mtimeMs,
      });
    }
  }

  for (const repoPath of currentByPath.keys()) {
    if (!baseByPath.has(repoPath)) {
      changedFiles.add(repoPath);
    }
  }

  return {
    changedFiles: Array.from(changedFiles).sort(),
    deletedFiles: Array.from(deletedFiles).sort(),
  };
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

function normalizeRepoPathList(paths: string[], projectRoot: string): string[] {
  return Array.from(new Set(paths.map((item) => normalizeInputPath(item, projectRoot)))).sort();
}

function normalizeInputPath(input: string, projectRoot: string): string {
  const trimmed = input.trim();
  if (path.isAbsolute(trimmed)) {
    return toRepoRelative(projectRoot, trimmed);
  }
  return normalizeRepoRelative(trimmed);
}

function toRepoRelative(projectRoot: string, absolutePath: string): string {
  return normalizeRepoRelative(path.relative(projectRoot, absolutePath));
}

function languageForExtension(extension: string): string {
  switch (extension) {
    case '.ts':
    case '.tsx':
    case '.mts':
    case '.cts':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.json':
      return 'json';
    case '.md':
    case '.mdx':
      return 'markdown';
    case '.yml':
    case '.yaml':
      return 'yaml';
    case '.swift':
      return 'swift';
    case '.py':
      return 'python';
    case '.rb':
      return 'ruby';
    case '.java':
      return 'java';
    case '.kt':
      return 'kotlin';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    case '.toml':
      return 'toml';
    default:
      return 'unknown';
  }
}

function classificationForPath(filePath: string): SourceFileNodeInput['classification'] {
  const normalized = filePath.replaceAll(path.sep, '/').toLowerCase();
  if (
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    /\.test\.[jt]sx?$/.test(normalized)
  ) {
    return 'test';
  }
  if (normalized.endsWith('.md') || normalized.endsWith('.mdx')) {
    return 'documentation';
  }
  if (/\.(json|ya?ml|toml)$/.test(normalized)) {
    return 'config';
  }
  if (normalized.includes('/dist/') || normalized.includes('/generated/')) {
    return 'generated';
  }
  return 'source';
}

function createGenerationId(repoId: string, now: number): string {
  return `${repoId.replace(/[^A-Za-z0-9_-]/g, '-').toLowerCase()}-${now}`;
}
