import path from 'node:path';
import Logger from '../../../infrastructure/logging/Logger.js';
import { parseSwiftPackageManifest } from '../../../shared/SwiftPackageManifest.js';
import { hashBytes, hashCanonicalJson } from './canonical.js';
import type {
  ProjectContextDependencyOwnershipEntryV1,
  ProjectContextDependencyOwnershipV1,
  ProjectContextFoundationFileDescriptor,
  ProjectContextFoundationRepositoryInput,
} from './contracts.js';
import { createProjectContextDependencyOwnershipV1 } from './nodePorts.js';

/**
 * 依赖归属目录的生成：从认证清单里的包清单文件，得出"哪个名字归哪个仓库的哪个模块"。
 *
 * 认证捕获里，`map` 把不属于任何模块种子的依赖报成"外部依赖"。在多仓库范围里，这些名字有一部分
 * 其实是范围内另一个仓库的包（JS 的 package name / exports，Swift 包里的模块名）。有了这份目录，
 * host port 才能把它们归成"兄弟仓库的依赖"或"本仓库内部的导入"，并附上归属证据；没有目录时只能
 * 按名字猜，一律记成外部。
 *
 * 证据只取清单内的文件：归属条目的出处（`package.json`、`Package.swift`）必须是这次认证清单里的
 * 一个文件，捕获时会按内容哈希复核。宿主的清单策略不包含某种清单文件时，对应的声明不产生条目，
 * 并在返回值里说明——不会悄悄少一块。
 */

/** 一个仓库的清单：捕获前由 host port 枚举得到。 */
export interface ProjectContextDependencyOwnershipRepository {
  repository: ProjectContextFoundationRepositoryInput;
  files: readonly ProjectContextFoundationFileDescriptor[];
}

/** 没能变成归属条目的声明，以及原因。 */
export interface ProjectContextDependencyOwnershipGap {
  repoId: string;
  /** 清单文件的仓库相对路径。 */
  manifest: string;
  /** 具体是哪一条声明；整份清单都没用上时省略。 */
  declaration?: string;
  reason:
    | 'manifest-not-in-certified-inventory'
    | 'manifest-unparseable'
    | 'package-has-no-name'
    | 'no-certified-owner-module'
    | 'import-target-outside-repository';
}

export interface BuiltProjectContextDependencyOwnership {
  ownership: ProjectContextDependencyOwnershipV1;
  gaps: ProjectContextDependencyOwnershipGap[];
  /**
   * 同一个名字被不止一个模块声明。目录照实保留这些条目：真有依赖用到这个名字时，
   * host port 会把它判为"归属有歧义"的确认缺陷，而不是替它挑一个。
   */
  ambiguousPatterns: Array<{ pattern: string; owners: string[] }>;
}

export interface BuildProjectContextDependencyOwnershipInput {
  repositories: readonly ProjectContextDependencyOwnershipRepository[];
  /** 读清单内的一个文件；与捕获用同一个端口，读到的就是之后会被认证的字节。 */
  readFile(input: {
    repository: ProjectContextFoundationRepositoryInput;
    relativePath: string;
    signal?: AbortSignal;
  }): Promise<Uint8Array>;
  signal?: AbortSignal;
}

const NODE_MANIFEST = 'package.json';
const SWIFT_MANIFEST = 'Package.swift';

export async function buildProjectContextDependencyOwnershipV1(
  input: BuildProjectContextDependencyOwnershipInput
): Promise<BuiltProjectContextDependencyOwnership> {
  const entries = new Map<string, ProjectContextDependencyOwnershipEntryV1>();
  const gaps: ProjectContextDependencyOwnershipGap[] = [];
  const add = (entry: ProjectContextDependencyOwnershipEntryV1) => {
    entries.set(hashCanonicalJson(entry), entry);
  };

  for (const source of [...input.repositories].sort((left, right) =>
    left.repository.repoId.localeCompare(right.repository.repoId)
  )) {
    input.signal?.throwIfAborted();
    const inventory = new Set(source.files.map((file) => file.relativePath));
    for (const manifest of [NODE_MANIFEST, SWIFT_MANIFEST]) {
      input.signal?.throwIfAborted();
      const bytes = await readManifest(input, source, manifest);
      if (!bytes) {
        continue;
      }
      if (!inventory.has(manifest)) {
        // 清单文件在磁盘上，但不在这次的认证清单里：它的字节不会被认证，不能当归属证据。
        gaps.push({
          repoId: source.repository.repoId,
          manifest,
          reason: 'manifest-not-in-certified-inventory',
        });
        continue;
      }
      const context: ManifestContext = {
        repoId: source.repository.repoId,
        files: source.files,
        provenance: { relativePath: manifest, contentHash: hashBytes(bytes) },
        add,
        gaps,
      };
      if (manifest === NODE_MANIFEST) {
        addNodePackageEntries(context, bytes);
      } else {
        addSwiftPackageEntries(context, bytes);
      }
    }
  }

  const ownership = createProjectContextDependencyOwnershipV1([...entries.values()]);
  const ambiguousPatterns = findAmbiguousPatterns(ownership.entries);
  // 目录是可选的增强：生成了多少、哪些声明没用上、有没有重名，都留在日志里。
  Logger.info('ProjectContext dependency ownership catalog built', {
    repositories: input.repositories.length,
    entries: ownership.entries.length,
    ownershipHash: ownership.ownershipHash,
    gaps: gaps.map((gap) => `${gap.repoId}/${gap.manifest}:${gap.reason}`).slice(0, 20),
    gapCount: gaps.length,
    ambiguousPatterns: ambiguousPatterns.map((entry) => entry.pattern).slice(0, 20),
  });
  return { ownership, gaps, ambiguousPatterns };
}

interface ManifestContext {
  repoId: string;
  files: readonly ProjectContextFoundationFileDescriptor[];
  provenance: ProjectContextDependencyOwnershipEntryV1['provenance'];
  add(entry: ProjectContextDependencyOwnershipEntryV1): void;
  gaps: ProjectContextDependencyOwnershipGap[];
}

/** 读仓库根下的一个清单文件；不存在返回 undefined，别的读取错误照常抛出。 */
async function readManifest(
  input: BuildProjectContextDependencyOwnershipInput,
  source: ProjectContextDependencyOwnershipRepository,
  manifest: string
): Promise<Uint8Array | undefined> {
  try {
    return await input.readFile({
      repository: source.repository,
      relativePath: manifest,
      signal: input.signal,
    });
  } catch (error) {
    input.signal?.throwIfAborted();
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return undefined;
    }
    throw error;
  }
}

/**
 * `package.json`：包名、`exports` 的子路径、`imports` 的私有别名。
 *
 * - 没有 `exports` 字段的包，任何子路径都能被导入，记一条 `<name>/*`。
 * - 有 `exports` 时只认写出来的子路径；没写出来的子路径被导入，是导入方的问题（host port 会判为缺陷）。
 * - `imports` 里指向仓库外的别名（映射到另一个包名）不是本仓库的文件，不产生条目。
 */
function addNodePackageEntries(context: ManifestContext, bytes: Uint8Array): void {
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    context.gaps.push({
      repoId: context.repoId,
      manifest: NODE_MANIFEST,
      reason: 'manifest-unparseable',
    });
    return;
  }
  const record = isRecord(manifest) ? manifest : {};
  const packageName = typeof record.name === 'string' ? record.name.trim() : '';
  if (!packageName) {
    context.gaps.push({
      repoId: context.repoId,
      manifest: NODE_MANIFEST,
      reason: 'package-has-no-name',
    });
    return;
  }
  const ownerModuleId = selectPrimaryOwnerModuleId(context.files, packageName);
  if (!ownerModuleId) {
    context.gaps.push({
      repoId: context.repoId,
      manifest: NODE_MANIFEST,
      declaration: packageName,
      reason: 'no-certified-owner-module',
    });
    return;
  }
  const base = {
    repoId: context.repoId,
    ownerModuleId,
    ownerPackageName: packageName,
    provenance: context.provenance,
  };
  context.add({ ...base, source: 'package-name', pattern: packageName });

  if (record.exports === undefined) {
    context.add({ ...base, source: 'package-export', pattern: `${packageName}/*` });
  } else {
    for (const exportKey of readPackageMapKeys(record.exports, '.')) {
      if (exportKey !== '.') {
        context.add({
          ...base,
          source: 'package-export',
          pattern: `${packageName}${exportKey.slice(1)}`,
        });
      }
    }
  }

  const imports = isRecord(record.imports) ? record.imports : {};
  for (const importKey of readPackageMapKeys(imports, '#')) {
    const targetPatterns = readRepositoryTargets(imports[importKey]);
    if (!targetPatterns) {
      context.gaps.push({
        repoId: context.repoId,
        manifest: NODE_MANIFEST,
        declaration: importKey,
        reason: 'import-target-outside-repository',
      });
      continue;
    }
    context.add({ ...base, source: 'package-import', pattern: importKey, targetPatterns });
  }
}

/** `Package.swift`：非测试的 target 名就是别的包 `import` 时写的模块名。 */
function addSwiftPackageEntries(context: ManifestContext, bytes: Uint8Array): void {
  const manifest = parseSwiftPackageManifest(new TextDecoder().decode(bytes));
  const moduleNames = [
    ...new Set(
      manifest.targets.filter((target) => target.type === 'target').map((target) => target.name)
    ),
  ].sort();
  for (const moduleName of moduleNames) {
    const ownerModuleId = selectPrimaryOwnerModuleId(context.files, moduleName);
    if (!ownerModuleId) {
      context.gaps.push({
        repoId: context.repoId,
        manifest: SWIFT_MANIFEST,
        declaration: moduleName,
        reason: 'no-certified-owner-module',
      });
      continue;
    }
    context.add({
      repoId: context.repoId,
      ownerModuleId,
      ownerPackageName: moduleName,
      source: 'module-alias',
      pattern: moduleName,
      provenance: context.provenance,
    });
  }
}

/**
 * 一个包名落到清单里的哪个模块：优先取目录名与包名相同的模块，否则取文件最多的那个。
 * 测试模块不参与。清单里没有任何带归属的源码文件时返回 undefined。
 */
function selectPrimaryOwnerModuleId(
  files: readonly ProjectContextFoundationFileDescriptor[],
  preferredName: string
): string | undefined {
  const counts = new Map<string, number>();
  for (const file of files) {
    for (const owner of file.ownerModuleIds ?? []) {
      if (!owner.startsWith('test:')) {
        counts.set(owner, (counts.get(owner) ?? 0) + 1);
      }
    }
  }
  const preferred = [...counts.keys()]
    .sort()
    .find((owner) => path.posix.basename(owner.slice(owner.indexOf(':') + 1)) === preferredName);
  return (
    preferred ??
    [...counts.entries()].sort(
      ([leftOwner, leftCount], [rightOwner, rightCount]) =>
        rightCount - leftCount || leftOwner.localeCompare(rightOwner)
    )[0]?.[0]
  );
}

function readPackageMapKeys(value: unknown, requiredPrefix: string): string[] {
  if (!isRecord(value)) {
    return [];
  }
  return Object.keys(value)
    .filter((key) => key.startsWith(requiredPrefix))
    .sort();
}

/**
 * `imports` 一条映射的目标：条件对象与数组展开后，全部是 `./` 开头的仓库内路径才算数。
 * 有任何一个目标指向仓库外（另一个包名）、为 null 或不是字符串，整条不作为仓库内归属。
 */
function readRepositoryTargets(value: unknown): string[] | undefined {
  const targets: string[] = [];
  let outside = false;
  const visit = (entry: unknown): void => {
    if (typeof entry === 'string') {
      if (entry.startsWith('./')) {
        targets.push(entry.slice(2));
      } else {
        outside = true;
      }
      return;
    }
    if (Array.isArray(entry)) {
      for (const child of entry) {
        visit(child);
      }
      return;
    }
    if (isRecord(entry)) {
      for (const child of Object.values(entry)) {
        visit(child);
      }
      return;
    }
    outside = true;
  };
  visit(value);
  return outside || targets.length === 0 ? undefined : [...new Set(targets)].sort();
}

function findAmbiguousPatterns(
  entries: readonly ProjectContextDependencyOwnershipEntryV1[]
): Array<{ pattern: string; owners: string[] }> {
  const ownersByPattern = new Map<string, Set<string>>();
  for (const entry of entries) {
    // 私有别名只在声明它的仓库里生效，不同仓库用同一个 `#name` 不冲突。
    if (entry.source === 'package-import') {
      continue;
    }
    const owners = ownersByPattern.get(entry.pattern) ?? new Set<string>();
    owners.add(`${entry.repoId}/${entry.ownerModuleId}`);
    ownersByPattern.set(entry.pattern, owners);
  }
  return [...ownersByPattern.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([pattern, owners]) => ({ pattern, owners: [...owners].sort() }))
    .sort((left, right) => left.pattern.localeCompare(right.pattern));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
