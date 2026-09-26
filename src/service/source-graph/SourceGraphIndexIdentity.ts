import type { SourceGraphSnapshot } from '../../domain/source-graph/SourceGraphContracts.js';
import { type CanonicalSha256, hashCanonicalJson } from '../../shared/canonicalJson.js';

/**
 * 内部继承依据：调用方先解析默认值和路径，本层只统一集合表示。
 * 只收会改变事实范围/覆盖的选项；now、generationId 和随机 worker 目录不属于解析身份。
 */
export interface SourceGraphIndexIdentityOptions {
  projectRoot: string;
  repoId: string;
  projectScope?: string;
  graphRoots: readonly string[];
  extractorVersion: string;
  includeExtensions: readonly string[];
  ignoreDirectories: readonly string[];
  maxFileSizeBytes: number;
  maxParseBytes: number;
  backendTimeoutMs?: number;
  privateRuntimeRoot?: string;
}

export interface SourceGraphIndexIdentity {
  schemaVersion: 1;
  hash: CanonicalSha256;
  config: SourceGraphIndexIdentityOptions;
}

export function createSourceGraphIndexIdentity(
  options: SourceGraphIndexIdentityOptions
): SourceGraphIndexIdentity {
  // 显式投影避免调用方追加运行时字段后，意外把 signal/dataRoot/session 纳入持久化身份。
  const config: SourceGraphIndexIdentityOptions = {
    projectRoot: options.projectRoot,
    repoId: options.repoId,
    projectScope: options.projectScope,
    graphRoots: sortedSet(options.graphRoots),
    extractorVersion: options.extractorVersion,
    includeExtensions: sortedSet(options.includeExtensions),
    ignoreDirectories: sortedSet(options.ignoreDirectories),
    maxFileSizeBytes: options.maxFileSizeBytes,
    maxParseBytes: options.maxParseBytes,
    backendTimeoutMs: options.backendTimeoutMs,
    privateRuntimeRoot: options.privateRuntimeRoot,
  };
  const schemaVersion = 1;
  return {
    schemaVersion,
    hash: hashCanonicalJson({ schemaVersion, config }),
    config,
  };
}

/**
 * undefined 才允许继承；其他返回值交给编排层记录诊断并整代重建。
 * 老快照未记录完整策略，不能从 extractionVersion 或当前默认值猜测其可复用性。
 */
export function compareSourceGraphIndexIdentity(
  snapshot: Pick<SourceGraphSnapshot, 'metadata'>,
  current: SourceGraphIndexIdentity
): string | undefined {
  const stored = snapshot.metadata.indexIdentity;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return 'source-graph-index-identity-missing';
  }
  if (!('schemaVersion' in stored) || stored.schemaVersion !== current.schemaVersion) {
    return 'source-graph-index-identity-schema-mismatch';
  }
  if (
    !('config' in stored) ||
    !stored.config ||
    typeof stored.config !== 'object' ||
    Array.isArray(stored.config) ||
    !('hash' in stored) ||
    typeof stored.hash !== 'string'
  ) {
    return 'source-graph-index-identity-incomplete';
  }
  return stored.hash === current.hash ? undefined : 'source-graph-index-identity-mismatch';
}

function sortedSet(values: readonly string[]): string[] {
  // 用代码点顺序而非 localeCompare，使同一配置在不同宿主 locale 下拥有相同身份。
  return [...new Set(values)].sort();
}
