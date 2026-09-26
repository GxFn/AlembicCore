import fs from 'node:fs/promises';
import path from 'node:path';
import { COMMON_SOURCE_SCAN_EXCLUDE_DIRS } from '../../core/discovery/SourceScanExclusions.js';
import { getCodeGraphProjectContextIdentity } from '../../infrastructure/analysis/CodeGraphProcess.js';
import { throwIfSourceReadAborted } from '../../infrastructure/io/ProjectSourceReader.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { listProjectScopeFolders, type ProjectDescriptor } from '../../shared/ProjectScope.js';
import {
  createSourceGraphIndexIdentity,
  type SourceGraphIndexIdentity,
} from './SourceGraphIndexIdentity.js';

export const SOURCE_GRAPH_INDEXER_VERSION = 'source-graph-indexer-v1';
// SDK身份还不足以描述SourceGraph的ID、kind和导入投影；此版本归本模块自身所有。
const CODEGRAPH_PROJECTION_VERSION = 'source-graph-codegraph-v1';

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
  /** 显式接入SDK；旧入口保持Node 22.0和既有提取行为，宿主提供自己的私有数据目录。 */
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
const DEFAULT_IGNORE_DIRECTORIES = [
  ...COMMON_SOURCE_SCAN_EXCLUDE_DIRS,
  '.workspace-active',
  '.workspace-local',
  '.asd',
  '.swiftpm',
];
export const PARSABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
export const CODEGRAPH_PARSABLE_EXTENSIONS = new Set([...PARSABLE_EXTENSIONS, '.mts', '.cts']);

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
  } else {
    Logger.debug('Source graph retains its explicit legacy extraction contract', {
      projectRoot,
      extractorVersion,
      reason: 'codegraph-option-absent',
    });
  }
  throwIfSourceReadAborted(input);
  const includeExtensions = new Set(
    (
      input.includeExtensions ?? [
        ...DEFAULT_INCLUDE_EXTENSIONS,
        ...(input.codeGraph ? ['.mts', '.cts'] : []),
      ]
    ).map(normalizeExtension)
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
