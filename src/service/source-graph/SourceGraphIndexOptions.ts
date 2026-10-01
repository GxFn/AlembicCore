import fs from 'node:fs/promises';
import path from 'node:path';
import { COMMON_SOURCE_SCAN_EXCLUDE_DIRS } from '../../core/discovery/SourceScanExclusions.js';
import { EXTENSION_PARSER_LANGUAGE } from '../../core/facts/parserLanguage.js';
import { MODULE_SOURCE_EXTENSIONS } from '../../core/linking/moduleTargets.js';
import { getCodeGraphProjectContextIdentity } from '../../infrastructure/analysis/CodeGraphProcess.js';
import { throwIfSourceReadAborted } from '../../infrastructure/io/ProjectSourceReader.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { listProjectScopeFolders, type ProjectDescriptor } from '../../shared/ProjectScope.js';
import {
  createSourceGraphIndexIdentity,
  type SourceGraphIndexIdentity,
} from './SourceGraphIndexIdentity.js';

/**
 * 提取与链接规则的版本。v2：所有语言统一读文件事实，调用边由自有链接器写入。
 * 版本进入索引身份，旧版本的代际不会被增量沿用。
 */
export const SOURCE_GRAPH_INDEXER_VERSION = 'source-graph-indexer-v2';
// 启用外部引擎时，它的身份与本模块对其结果的投影规则一起进入提取版本。
const CODEGRAPH_PROJECTION_VERSION = 'source-graph-codegraph-v3';

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
  signal?: AbortSignal;
  /**
   * 外部引擎（CodeGraph）的接入点：宿主提供自己的私有数据目录。
   * 符号与自有链接不依赖它；它只影响索引身份，并把私有运行目录排除在清单之外。
   */
  codeGraph?: { dataRoot: string; timeoutMs?: number };
}

export interface SourceGraphIncrementalIndexOptions extends SourceGraphIndexOptions {
  baseGenerationId?: string;
  changedFiles?: string[];
  deletedFiles?: string[];
}

export type SourceGraphFreshnessOptions = SourceGraphIndexOptions;

export interface NormalizedIndexOptions {
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
  signal?: AbortSignal;
  codeGraph?: SourceGraphIndexOptions['codeGraph'];
  engineHash?: string;
  privateRuntimeRoot?: string;
  indexIdentity: SourceGraphIndexIdentity;
}

/** 有解析器的扩展名来自文件事实层的唯一映射；其余是只做清单、不做解析的文档与配置。 */
const DEFAULT_INCLUDE_EXTENSIONS = [
  ...Object.keys(EXTENSION_PARSER_LANGUAGE),
  '.json',
  '.md',
  '.mdx',
  '.yml',
  '.yaml',
  '.toml',
  '.rb',
];
const DEFAULT_IGNORE_DIRECTORIES = [
  ...COMMON_SOURCE_SCAN_EXCLUDE_DIRS,
  '.workspace-active',
  '.workspace-local',
  '.asd',
  '.swiftpm',
];
/** 相对导入会被解析成文件的扩展名；文件集合变化时这些文件要重新链接。 */
export const LINKED_MODULE_EXTENSIONS: ReadonlySet<string> = new Set(MODULE_SOURCE_EXTENSIONS);

export async function normalizeIndexOptions(
  input: SourceGraphIndexOptions
): Promise<NormalizedIndexOptions> {
  throwIfSourceReadAborted(input);
  const projectRoot = path.resolve(input.projectRoot);
  const explicitScope = input.projectScope?.trim()
    ? normalizeRepoRelative(input.projectScope.trim())
    : undefined;
  const folders = input.projectScopeDescriptor
    ? listProjectScopeFolders(input.projectScopeDescriptor).filter(
        (folder) => folder.state === 'active'
      )
    : [];
  if (!explicitScope && input.projectScopeDescriptor && folders.length === 0) {
    // 明确的空ProjectScope不是旧单目录模式；controlRoot契约声明它不属于源码folders。
    Logger.warn('Source graph cannot index a declared scope without a source folder', {
      projectRoot,
      projectScopeId: input.projectScopeDescriptor.projectScopeId,
      reason: 'empty-declared-project-scope',
      nextAction: 'add_project_source_folder',
    });
    throw new Error('Source graph requires an active source folder in the declared ProjectScope.');
  }
  const graphRoot = explicitScope ? path.join(projectRoot, explicitScope) : projectRoot;
  const graphRoots =
    explicitScope || folders.length === 0 ? [graphRoot] : folders.map((folder) => folder.path);
  const projectScope =
    explicitScope ??
    (folders.length > 0 ? input.projectScopeDescriptor?.projectScopeId : undefined);
  let extractorVersion = input.extractorVersion?.trim() || SOURCE_GRAPH_INDEXER_VERSION;
  let engineHash: string | undefined;
  let privateRuntimeRoot: string | undefined;
  if (input.codeGraph) {
    // 先验证输入根存在，再允许worker创建私有目录；不能制造一个缺失的sourceRoot。
    for (const sourceRoot of graphRoots) {
      await fs.realpath(sourceRoot);
    }
    engineHash = (await getCodeGraphProjectContextIdentity()).engineHash;
    privateRuntimeRoot = await canonicalFuturePath(
      path.resolve(input.codeGraph.dataRoot, '.asd', 'codegraph-sessions')
    );
    extractorVersion = `${CODEGRAPH_PROJECTION_VERSION}:${extractorVersion}:${engineHash}`;
  }
  throwIfSourceReadAborted(input);
  const includeExtensions = new Set(
    (input.includeExtensions ?? DEFAULT_INCLUDE_EXTENSIONS).map(normalizeExtension)
  );
  const ignoreDirectories = new Set(input.ignoreDirectories ?? DEFAULT_IGNORE_DIRECTORIES);
  const maxFileSizeBytes = input.maxFileSizeBytes ?? 512 * 1024;
  const maxParseBytes = input.maxParseBytes ?? 256 * 1024;
  const indexIdentity = createSourceGraphIndexIdentity({
    projectRoot,
    repoId: input.repoId?.trim() || 'default',
    projectScope,
    graphRoots,
    extractorVersion,
    includeExtensions: [...includeExtensions],
    ignoreDirectories: [...ignoreDirectories],
    maxFileSizeBytes,
    maxParseBytes,
    backendTimeoutMs: input.codeGraph ? (input.codeGraph.timeoutMs ?? 30_000) : undefined,
    privateRuntimeRoot,
  });
  return {
    projectRoot,
    repoId: input.repoId?.trim() || 'default',
    projectScope,
    graphRoot,
    graphRoots,
    extractorVersion,
    now: input.now ?? Date.now(),
    includeExtensions,
    ignoreDirectories,
    maxFileSizeBytes,
    maxParseBytes,
    signal: input.signal,
    codeGraph: input.codeGraph,
    engineHash,
    privateRuntimeRoot,
    indexIdentity,
  };
}

export function normalizeExtension(extension: string): string {
  return extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
}

export function normalizeRepoRelative(value: string): string {
  return value.replaceAll(path.sep, '/').replace(/^\.\//, '');
}

async function canonicalFuturePath(directory: string): Promise<string> {
  try {
    return await fs.realpath(directory);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
    // 私有目录可以尚未创建；解析已有祖先可保留dataRoot的symlink语义，inspect始终只读。
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw error;
    }
    const resolved = path.join(await canonicalFuturePath(parent), path.basename(directory));
    Logger.debug('Source graph resolved a not-yet-created private runtime path', {
      directory,
      resolved,
    });
    return resolved;
  }
}
