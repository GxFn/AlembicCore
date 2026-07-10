import crypto from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { COMMON_SOURCE_SCAN_EXCLUDE_DIRS } from '../../core/discovery/SourceScanExclusions.js';
import {
  createSourceGraphDiagnostic,
  createSourceGraphFreshness,
  createSourceGraphStatusResult,
  type SourceFileNode,
  type SourceFileNodeInput,
  type SourceGraphDiagnostic,
  type SourceGraphDiagnosticInput,
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
import type { SourceGraphRepositoryImpl } from '../../repository/source-graph/SourceGraphRepository.js';
import {
  listProjectScopeFolders,
  type ProjectDescriptor,
  type ProjectFolderDescriptor,
} from '../../shared/ProjectScope.js';

export const SOURCE_GRAPH_INDEXER_VERSION = 'source-graph-indexer-v1';

export interface SourceGraphIndexOptions {
  projectRoot: string;
  repoId?: string;
  projectScope?: string;
  projectScopeDescriptor?: ProjectDescriptor | null;
  generationId?: string;
  extractorVersion?: string;
  now?: number;
  includeExtensions?: string[];
  ignoreDirectories?: string[];
  maxFileSizeBytes?: number;
  maxParseBytes?: number;
}

export interface SourceGraphIncrementalIndexOptions extends SourceGraphIndexOptions {
  baseGenerationId?: string;
  changedFiles?: string[];
  deletedFiles?: string[];
}

// W4 批A(T1):IndexBuildResult/FreshnessReport 本体下沉 domain/source-graph 契约家;re-export 保表面。
export type {
  SourceGraphFreshnessReport,
  SourceGraphIndexBuildResult,
} from '../../domain/source-graph/SourceGraphContracts.js';

export interface SourceGraphFreshnessOptions extends SourceGraphIndexOptions {
  generationId?: string;
}

interface NormalizedIndexOptions {
  projectRoot: string;
  repoId: string;
  projectScope?: string;
  graphRoot: string;
  graphRoots: string[];
  extractorVersion: string;
  now: number;
  includeExtensions: Set<string>;
  ignoreDirectories: Set<string>;
  maxFileSizeBytes: number;
  maxParseBytes: number;
}

interface InventoryFile {
  absolutePath: string;
  repoRelativePath: string;
  language: string;
  classification: SourceFileNodeInput['classification'];
  sizeBytes: number;
  mtimeMs: number;
  extension: string;
}

interface ParsedFile {
  file: SourceFileNodeInput;
  symbols: SourceSymbolNode[];
  edges: SourceGraphEdgeInput[];
  diagnostics: SourceGraphDiagnosticInput[];
}

interface SourceGraphSourceRoots {
  graphRoots: string[];
  projectScope?: string;
}

const DEFAULT_INCLUDE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.yml',
  '.yaml',
  '.swift',
  '.py',
  '.rb',
  '.java',
  '.kt',
  '.go',
  '.rs',
  '.toml',
];

// Track2 激活真机复核(2026-07-10 BiliDili):私有排除表漏 '.build'(SPM 检出物),
// 首次全量 1408 文件里 87% 是 .build 依赖源码——与 ReDoS 事故同源的污染入口。
// 改为对齐共享排除家族(COMMON_SOURCE_SCAN_EXCLUDE_DIRS:含 .build/Pods/
// DerivedData/Carthage 等),叠加本索引器的 workspace 运行时目录。
const DEFAULT_IGNORE_DIRECTORIES = [
  ...COMMON_SOURCE_SCAN_EXCLUDE_DIRS,
  '.workspace-active',
  '.workspace-local',
  '.asd',
  '.swiftpm',
];

const PARSABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const DEFAULT_MAX_FILE_SIZE_BYTES = 512 * 1024;
const DEFAULT_MAX_PARSE_BYTES = 256 * 1024;

export class SourceGraphIndexer {
  constructor(private readonly repository: SourceGraphRepositoryImpl) {}

  async buildFull(input: SourceGraphIndexOptions): Promise<SourceGraphIndexBuildResult> {
    const options = normalizeIndexOptions(input);
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
    const options = normalizeIndexOptions(input);
    const baseSnapshot = input.baseGenerationId
      ? await this.repository.getSnapshot(input.baseGenerationId)
      : await this.repository.getLatestSnapshot(options.projectRoot, options.repoId);

    if (!baseSnapshot) {
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
    const impacted = new Set([...changedSet, ...deletedSet]);
    const preservedFiles = baseFiles
      .filter(
        (file) => !impacted.has(file.repoRelativePath) && currentByPath.has(file.repoRelativePath)
      )
      .map((file) => ({ ...file, generationId: input.generationId ?? '' }));
    const preservedSymbols = (await this.repository.listSymbols(baseSnapshot.generationId))
      .filter((symbol) => !impacted.has(symbol.filePath))
      .map((symbol) => ({ ...symbol, generationId: input.generationId ?? '' }));
    const preservedEdges = (await this.repository.listEdges(baseSnapshot.generationId))
      .filter((edge) => !edgeTouchesFiles(edge, impacted))
      .map((edge) => ({ ...edge, generationId: input.generationId ?? '' }));
    const changedInventory = changedFiles
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
    const parsedFiles = await Promise.all(
      input.inventory.map((file) =>
        parseInventoryFile(file, input.options, input.generationId, knownPaths)
      )
    );
    const diagnostics = parsedFiles
      .flatMap((file) => file.diagnostics)
      .map(createSourceGraphDiagnostic);
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
        },
      },
      files: filesForReplace,
      symbols: symbolsForReplace,
      edges: edgesForReplace,
    });
    const files = await this.repository.listFiles(snapshot.generationId);
    const symbols = await this.repository.listSymbols(snapshot.generationId);
    const edges = await this.repository.listEdges(snapshot.generationId);
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
    const options = normalizeIndexOptions(input);
    const snapshot = input.generationId
      ? await this.repository.getSnapshot(input.generationId)
      : await this.repository.getLatestSnapshot(options.projectRoot, options.repoId);

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

    const inventory = await collectInventory(options);
    const currentByPath = new Map(inventory.map((file) => [file.repoRelativePath, file]));
    const baseFiles = await this.repository.listFiles(snapshot.generationId);
    const detected = await detectChangedFiles(options, baseFiles, currentByPath);
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

function normalizeIndexOptions(input: SourceGraphIndexOptions): NormalizedIndexOptions {
  const projectRoot = path.resolve(input.projectRoot);
  const projectScope = normalizeProjectScope(input.projectScope);
  const sourceRoots = resolveSourceGraphSourceRoots(projectRoot, input, projectScope);
  const graphRoot = projectScope ? path.join(projectRoot, projectScope) : projectRoot;
  return {
    projectRoot,
    repoId: input.repoId?.trim() || 'default',
    projectScope: projectScope ?? sourceRoots.projectScope,
    graphRoot,
    graphRoots: sourceRoots.graphRoots,
    extractorVersion: input.extractorVersion?.trim() || SOURCE_GRAPH_INDEXER_VERSION,
    now: input.now ?? Date.now(),
    includeExtensions: new Set(
      (input.includeExtensions ?? DEFAULT_INCLUDE_EXTENSIONS).map(normalizeExtension)
    ),
    ignoreDirectories: new Set(input.ignoreDirectories ?? DEFAULT_IGNORE_DIRECTORIES),
    maxFileSizeBytes: input.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES,
    maxParseBytes: input.maxParseBytes ?? DEFAULT_MAX_PARSE_BYTES,
  };
}

function resolveSourceGraphSourceRoots(
  projectRoot: string,
  input: SourceGraphIndexOptions,
  projectScope: string | undefined
): SourceGraphSourceRoots {
  if (projectScope) {
    return { graphRoots: [path.join(projectRoot, projectScope)], projectScope };
  }

  const explicitFolders = activeProjectScopeFolders(input.projectScopeDescriptor);
  if (explicitFolders.length > 0) {
    return {
      graphRoots: explicitFolders.map((folder) => folder.path),
      projectScope: input.projectScopeDescriptor?.projectScopeId,
    };
  }

  return { graphRoots: [projectRoot], projectScope: undefined };
}

function activeProjectScopeFolders(
  projectScope: ProjectDescriptor | null | undefined
): ProjectFolderDescriptor[] {
  return projectScope
    ? listProjectScopeFolders(projectScope).filter((folder) => folder.state === 'active')
    : [];
}

async function collectInventory(options: NormalizedIndexOptions): Promise<InventoryFile[]> {
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
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
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

async function parseInventoryFile(
  file: InventoryFile,
  options: NormalizedIndexOptions,
  generationId: string,
  knownPaths: Set<string>
): Promise<ParsedFile> {
  const content = await fs.readFile(file.absolutePath, 'utf8');
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');
  const lineCount = countLines(content);
  const baseFile: SourceFileNodeInput = {
    generationId,
    projectRoot: options.projectRoot,
    repoRelativePath: file.repoRelativePath,
    language: file.language,
    contentHash,
    sizeBytes: file.sizeBytes,
    mtimeMs: file.mtimeMs,
    indexedAt: options.now,
    classification: file.classification,
    parseStatus: 'parsed',
    lineCount,
    metadata: {
      extractorVersion: options.extractorVersion,
    },
  };

  if (file.sizeBytes > options.maxFileSizeBytes) {
    return skippedFile(
      baseFile,
      'large-file-skipped',
      'File exceeded source graph index size limit.'
    );
  }
  if (!PARSABLE_EXTENSIONS.has(file.extension)) {
    return skippedFile(
      baseFile,
      'unsupported-language',
      `Unsupported source graph language: ${file.language}.`
    );
  }
  if (file.sizeBytes > options.maxParseBytes) {
    return partialFile(baseFile, 'parser-timeout', 'File exceeded source graph parser budget.');
  }
  if (content.includes('SOURCE_GRAPH_PARSE_FAILURE')) {
    return failedFile(baseFile, 'Source graph parser failed for this file.');
  }

  const symbols = extractSymbols(content, file, generationId, options.extractorVersion, lineCount);
  const edges = extractImportEdges(content, file, generationId, knownPaths);
  return {
    file: baseFile,
    symbols,
    edges,
    diagnostics: [],
  };
}

function skippedFile(
  file: SourceFileNodeInput,
  code: 'large-file-skipped' | 'unsupported-language',
  message: string
): ParsedFile {
  return {
    file: {
      ...file,
      parseStatus: 'skipped',
      parseErrors: [{ message, severity: 'warning', code }],
    },
    symbols: [],
    edges: [],
    diagnostics: [
      {
        code,
        message,
        filePath: file.repoRelativePath,
      },
    ],
  };
}

function partialFile(
  file: SourceFileNodeInput,
  code: 'parser-timeout',
  message: string
): ParsedFile {
  return {
    file: {
      ...file,
      parseStatus: 'partial',
      parseErrors: [{ message, severity: 'warning', code }],
    },
    symbols: [moduleSymbol(file, 1)],
    edges: [],
    diagnostics: [
      {
        code,
        message,
        filePath: file.repoRelativePath,
      },
    ],
  };
}

function failedFile(file: SourceFileNodeInput, message: string): ParsedFile {
  return {
    file: {
      ...file,
      parseStatus: 'failed',
      parseErrors: [{ message, severity: 'error', code: 'parse-failed' }],
    },
    symbols: [],
    edges: [],
    diagnostics: [
      {
        code: 'catch-up-failed',
        message,
        filePath: file.repoRelativePath,
        metadata: { parseErrorCode: 'parse-failed' },
      },
    ],
  };
}

function extractSymbols(
  content: string,
  file: InventoryFile,
  generationId: string,
  extractorVersion: string,
  lineCount: number
): SourceSymbolNode[] {
  const symbols: SourceSymbolNode[] = [
    moduleSymbolFromInventory(file, generationId, extractorVersion, lineCount),
  ];
  const lines = content.split(/\r\n|\n|\r/);
  const symbolPattern =
    /\b(export\s+)?(?:abstract\s+)?(class|interface|enum|function|type|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(symbolPattern)) {
      const kind = symbolKindForDeclaration(match[2]);
      const displayName = match[3];
      symbols.push({
        generationId,
        symbolId: `${file.repoRelativePath}#${displayName}`,
        displayName,
        qualifiedName: displayName,
        kind,
        filePath: file.repoRelativePath,
        range: {
          startLine: index + 1,
          startColumn: match.index ?? 0,
          endLine: index + 1,
          endColumn: (match.index ?? 0) + match[0].length,
        },
        exported: Boolean(match[1]),
        imported: false,
        metadata: {
          extractorVersion,
          declarationKind: match[2],
        },
        provenance: {
          extractor: 'source-graph-regex-symbols',
        },
      });
    }
  }
  return symbols;
}

function moduleSymbolFromInventory(
  file: InventoryFile,
  generationId: string,
  extractorVersion: string,
  lineCount: number
): SourceSymbolNode {
  return {
    generationId,
    symbolId: `${file.repoRelativePath}#module`,
    displayName: path.basename(file.repoRelativePath),
    qualifiedName: file.repoRelativePath,
    kind: 'module',
    filePath: file.repoRelativePath,
    range: { startLine: 1, startColumn: 0, endLine: Math.max(1, lineCount), endColumn: 0 },
    exported: true,
    imported: false,
    metadata: {
      extractorVersion,
      language: file.language,
    },
    provenance: {
      extractor: 'source-graph-file-inventory',
    },
  };
}

function moduleSymbol(file: SourceFileNodeInput, lineCount: number): SourceSymbolNode {
  return {
    generationId: file.generationId,
    symbolId: `${file.repoRelativePath}#module`,
    displayName: path.basename(file.repoRelativePath),
    qualifiedName: file.repoRelativePath,
    kind: 'module',
    filePath: file.repoRelativePath,
    range: { startLine: 1, startColumn: 0, endLine: Math.max(1, lineCount), endColumn: 0 },
    exported: true,
    imported: false,
    metadata: {
      language: file.language,
    },
    provenance: {
      extractor: 'source-graph-file-inventory',
    },
  };
}

function extractImportEdges(
  content: string,
  file: InventoryFile,
  generationId: string,
  knownPaths: Set<string>
): SourceGraphEdgeInput[] {
  const lines = content.split(/\r\n|\n|\r/);
  const edges: SourceGraphEdgeInput[] = [];
  const importPattern =
    /\bimport\s+(?:type\s+)?(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2];
      const target = resolveRelativeImport(file.repoRelativePath, specifier, knownPaths);
      if (!target) {
        continue;
      }
      edges.push({
        generationId,
        edgeId: `${file.repoRelativePath}:imports:${target}`,
        kind: 'imports',
        fromSymbolId: `${file.repoRelativePath}#module`,
        fromFilePath: file.repoRelativePath,
        toFilePath: target,
        siteFilePath: file.repoRelativePath,
        site: {
          startLine: index + 1,
          startColumn: match.index ?? 0,
          endLine: index + 1,
          endColumn: (match.index ?? 0) + match[0].length,
        },
        provenance: 'deterministic',
        confidence: 1,
        source: specifier,
      });
    }
  }
  return edges;
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
    const current = currentByPath.get(baseFile.repoRelativePath);
    if (!current) {
      deletedFiles.add(baseFile.repoRelativePath);
      continue;
    }
    if (current.sizeBytes !== baseFile.sizeBytes || current.mtimeMs !== baseFile.mtimeMs) {
      const content = await fs.readFile(current.absolutePath, 'utf8');
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      if (hash !== baseFile.contentHash) {
        changedFiles.add(current.repoRelativePath);
      }
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

function resolveRelativeImport(
  currentFile: string,
  specifier: string,
  knownPaths: Set<string>
): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  const base = normalizeRepoRelative(
    path.posix.normalize(path.posix.join(path.posix.dirname(currentFile), specifier))
  );
  const candidates = [
    base,
    ...Array.from(PARSABLE_EXTENSIONS).map((extension) => `${base}${extension}`),
    ...Array.from(PARSABLE_EXTENSIONS).map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => knownPaths.has(candidate));
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

function normalizeProjectScope(scope: string | undefined): string | undefined {
  if (!scope?.trim()) {
    return undefined;
  }
  return normalizeRepoRelative(scope);
}

function toRepoRelative(projectRoot: string, absolutePath: string): string {
  return normalizeRepoRelative(path.relative(projectRoot, absolutePath));
}

function normalizeRepoRelative(value: string): string {
  return value.replaceAll(path.sep, '/').replace(/^\.\//, '');
}

function normalizeExtension(extension: string): string {
  return extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
}

function languageForExtension(extension: string): string {
  switch (extension) {
    case '.ts':
    case '.tsx':
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

function symbolKindForDeclaration(kind: string): SourceSymbolNode['kind'] {
  switch (kind) {
    case 'class':
      return 'class';
    case 'interface':
      return 'interface';
    case 'enum':
      return 'enum';
    case 'function':
      return 'function';
    case 'type':
      return 'type';
    case 'const':
    case 'let':
    case 'var':
      return 'variable';
    default:
      return 'unknown';
  }
}

function countLines(content: string): number {
  return Math.max(1, content.split(/\r\n|\n|\r/).length);
}

function createGenerationId(repoId: string, now: number): string {
  return `${repoId.replace(/[^A-Za-z0-9_-]/g, '-').toLowerCase()}-${now}`;
}
