import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  FileSummary,
  ProjectContextJson,
  ProjectContextMetadata,
  ProjectContextQueryError,
  ProjectContextRef,
  ProjectContextRefScope,
  ProjectContextScope,
} from '../../../../domain/project-context/index.js';
import { loadSourceSliceFile } from '../../sourceSlice/fileAccess.js';
import { createProjectContextFileRef } from '../sourceSlice-fileSymbols/index.js';

export interface ProjectContextModuleSeed {
  id: string;
  name: string;
  kind?: string;
  modulePath?: string;
  ownedFiles: FileSummary[];
  ref: ProjectContextRef;
  role?: string;
  roleConfidence?: number;
  configLayer?: string;
}

export interface ProjectContextModuleSeedInput {
  projectRoot: string;
  moduleName: string;
  ownedFiles: readonly FileSummary[];
  repoId?: string;
  sourceFolder?: string;
  kind?: string;
  modulePath?: string;
  role?: string;
  roleConfidence?: number;
  configLayer?: string;
  parentRef?: string;
}

export interface ProjectContextModuleLayerRefInput {
  projectRoot: string;
  moduleName: string;
  layerName: string;
  repoId?: string;
  sourceFolder?: string;
  modulePath?: string;
  layerKind?: 'file-group' | 'layer';
  order?: number;
  fileGroups?: readonly string[];
  parentRef?: string;
}

export type ResolveProjectContextModuleSeedResult =
  | { ok: true; seed: ProjectContextModuleSeed; errors: ProjectContextQueryError[] }
  | { ok: false; error: ProjectContextQueryError; errors: ProjectContextQueryError[] };

export async function resolveProjectContextModuleSeed(input: {
  payload: unknown;
  scope: ProjectContextScope;
}): Promise<ResolveProjectContextModuleSeedResult> {
  const payload = isRecord(input.payload) ? input.payload : {};
  const ref = readProjectContextRef(payload.ref);
  const metadata = isRecord(ref?.metadata) ? ref.metadata : {};
  const modulePath = normalizeProjectPath(
    readString(payload.modulePath) ?? readMetadataString(metadata, 'modulePath'),
    input.scope.projectRoot
  );
  const requestedOwnedFiles = dedupeStrings([
    ...readOwnedFilePaths(payload.ownedFiles),
    ...readMetadataStringArray(metadata, 'ownedFiles'),
  ]);
  const ownedFilePaths =
    requestedOwnedFiles.length > 0
      ? requestedOwnedFiles
      : modulePath
        ? await readModuleDirectoryFiles({
            includeGenerated: input.scope.includeGenerated,
            includeVendor: input.scope.includeVendor,
            modulePath,
            projectRoot: input.scope.projectRoot,
          })
        : [];

  if (ownedFilePaths.length === 0) {
    return {
      error: createQueryError({
        code: 'invalid-scope',
        message: 'module payload.ownedFiles or payload.modulePath is required.',
        retryable: false,
      }),
      errors: [],
      ok: false,
    };
  }

  const errors: ProjectContextQueryError[] = [];
  const ownedFiles: FileSummary[] = [];
  for (const filePath of ownedFilePaths) {
    const fileAccess = await loadSourceSliceFile({
      filePath,
      projectRoot: input.scope.projectRoot,
      repoId: input.scope.repoId,
      sourceFolder: input.scope.sourceFolder,
    });
    if (!fileAccess.ok) {
      errors.push(
        createQueryError({
          ...fileAccess.failure,
          retryable: fileAccess.failure.retryable ?? false,
        })
      );
      continue;
    }
    const fileRef = createProjectContextFileRef({
      filePath: fileAccess.facts.filePath,
      hash: fileAccess.facts.hash,
      projectRoot: fileAccess.facts.projectRoot,
      repoId: fileAccess.facts.repoId,
      sourceFolder: fileAccess.facts.sourceFolder,
    });
    ownedFiles.push({
      filePath: fileAccess.facts.filePath,
      hash: fileAccess.facts.hash,
      language: fileAccess.facts.language,
      lineCount: fileAccess.facts.lineCount,
      mtimeMs: fileAccess.facts.mtimeMs,
      ref: fileRef,
      repoId: fileAccess.facts.repoId,
    });
  }

  if (ownedFiles.length === 0) {
    return {
      error: createQueryError({
        code: errors.some((error) => error.code === 'outside-scope')
          ? 'outside-scope'
          : 'not-found',
        message: 'module owned files could not be resolved inside scope.projectRoot.',
        retryable: false,
      }),
      errors,
      ok: false,
    };
  }

  const moduleName =
    readString(payload.moduleName) ??
    readMetadataString(metadata, 'moduleName') ??
    ref?.label ??
    inferModuleName(modulePath, ownedFiles);
  const role =
    readString(payload.role) ??
    readMetadataString(metadata, 'role') ??
    inferModuleRole({
      moduleName,
      modulePath,
      ownedFiles,
    });
  const roleConfidence = role
    ? inferRoleConfidence(role, moduleName, modulePath, ownedFiles)
    : undefined;
  const seed = createProjectContextModuleSeed({
    configLayer: readString(payload.configLayer) ?? readMetadataString(metadata, 'configLayer'),
    kind: readString(payload.kind) ?? readMetadataString(metadata, 'kind') ?? 'source-module',
    moduleName,
    modulePath,
    ownedFiles,
    projectRoot: input.scope.projectRoot,
    repoId: input.scope.repoId,
    role,
    roleConfidence,
    sourceFolder: input.scope.sourceFolder,
  });

  return { errors, ok: true, seed };
}

export function createProjectContextModuleSeed(
  input: ProjectContextModuleSeedInput
): ProjectContextModuleSeed {
  const sortedFiles = [...input.ownedFiles].sort(compareFiles);
  const id = createProjectContextModuleRefId(input);
  const ref = createProjectContextModuleRef({
    ...input,
    ownedFiles: sortedFiles,
  });
  return {
    configLayer: input.configLayer,
    id,
    kind: input.kind,
    modulePath: input.modulePath,
    name: input.moduleName,
    ownedFiles: sortedFiles,
    ref,
    role: input.role,
    roleConfidence: input.roleConfidence,
  };
}

export function createProjectContextModuleRef(
  input: ProjectContextModuleSeedInput
): ProjectContextRef {
  const metadata: ProjectContextMetadata = {
    kind: input.kind ?? 'source-module',
    moduleName: input.moduleName,
    ownedFileCount: input.ownedFiles.length,
    ownedFiles: input.ownedFiles.map((file) => file.filePath),
  };
  setOptionalMetadata(metadata, 'modulePath', input.modulePath);
  setOptionalMetadata(metadata, 'role', input.role);
  setOptionalMetadata(metadata, 'configLayer', input.configLayer);
  if (input.roleConfidence !== undefined) {
    metadata.roleConfidence = input.roleConfidence;
  }

  return {
    id: createProjectContextModuleRefId(input),
    kind: 'module',
    label: input.moduleName,
    level: 'module',
    metadata,
    parentRef: input.parentRef,
    scope: createModuleScope(input),
  };
}

export function createProjectContextModuleLayerRef(
  input: ProjectContextModuleLayerRefInput
): ProjectContextRef {
  const metadata: ProjectContextMetadata = {
    layerKind: input.layerKind ?? 'layer',
    layerName: input.layerName,
    moduleName: input.moduleName,
  };
  setOptionalMetadata(metadata, 'modulePath', input.modulePath);
  if (input.order !== undefined) {
    metadata.order = input.order;
  }
  if (input.fileGroups && input.fileGroups.length > 0) {
    metadata.fileGroups = [...input.fileGroups].sort();
  }

  return {
    id: createProjectContextModuleLayerRefId(input),
    kind: 'module-layer',
    label: `${input.moduleName}/${input.layerName}`,
    level: 'module-layers',
    metadata,
    parentRef: input.parentRef,
    scope: createModuleScope(input),
  };
}

export function createProjectContextModuleRefId(input: {
  moduleName: string;
  repoId?: string;
  modulePath?: string;
}): string {
  const repo = encodeRefPart(input.repoId ?? 'root');
  const modulePath = encodeRefPart(input.modulePath ?? input.moduleName);
  return `module:${repo}:${encodeRefPart(input.moduleName)}:${modulePath}`;
}

export function createProjectContextModuleLayerRefId(
  input: Pick<
    ProjectContextModuleLayerRefInput,
    'layerKind' | 'layerName' | 'moduleName' | 'modulePath' | 'repoId'
  >
): string {
  const repo = encodeRefPart(input.repoId ?? 'root');
  const modulePath = encodeRefPart(input.modulePath ?? input.moduleName);
  return `module-layer:${repo}:${encodeRefPart(input.moduleName)}:${modulePath}:${encodeRefPart(
    input.layerKind ?? 'layer'
  )}:${encodeRefPart(input.layerName)}`;
}

function readOwnedFilePaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      if (isRecord(item) && typeof item.filePath === 'string') {
        return item.filePath;
      }
      const ref = readProjectContextRef(item);
      return ref?.scope.filePath;
    })
    .filter((filePath): filePath is string => Boolean(filePath))
    .map((filePath) => filePath.trim())
    .filter(Boolean);
}

async function readModuleDirectoryFiles(input: {
  projectRoot: string;
  modulePath: string;
  includeGenerated: boolean;
  includeVendor: boolean;
}): Promise<string[]> {
  const absoluteRoot = path.resolve(input.projectRoot);
  const absoluteModulePath = path.resolve(absoluteRoot, input.modulePath);
  const relativeModulePath = path.relative(absoluteRoot, absoluteModulePath);
  if (!isContainedRelativePath(relativeModulePath)) {
    return [];
  }

  const files: string[] = [];
  const pending = [absoluteModulePath];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    const entries = await readDirectoryEntries(current);
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = toProjectContextPath(path.relative(absoluteRoot, absolutePath));
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name, input)) {
          continue;
        }
        pending.push(absolutePath);
        continue;
      }
      if (entry.isFile() && isSupportedModuleFile(relativePath)) {
        files.push(relativePath);
      }
    }
  }
  return files.sort();
}

async function readDirectoryEntries(directoryPath: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function normalizeProjectPath(value: string | undefined, projectRoot: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replaceAll('\\', '/').trim();
  if (!normalized || normalized.split('/').includes('..')) {
    return undefined;
  }
  const absolutePath = path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : path.resolve(projectRoot, normalized);
  const relativePath = path.relative(projectRoot, absolutePath);
  return isContainedRelativePath(relativePath) ? toProjectContextPath(relativePath) : undefined;
}

function shouldSkipDirectory(
  directoryName: string,
  input: { includeGenerated: boolean; includeVendor: boolean }
): boolean {
  if (!input.includeVendor && ['node_modules', 'vendor', '.git'].includes(directoryName)) {
    return true;
  }
  if (
    !input.includeGenerated &&
    ['dist', 'build', 'coverage', '__generated__', 'generated'].includes(directoryName)
  ) {
    return true;
  }
  return false;
}

function isSupportedModuleFile(filePath: string): boolean {
  return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'].includes(
    path.extname(filePath).toLowerCase()
  );
}

function inferModuleName(
  modulePath: string | undefined,
  ownedFiles: readonly FileSummary[]
): string {
  if (modulePath) {
    return path.posix.basename(modulePath) || modulePath;
  }
  const commonDirectory = findCommonDirectory(ownedFiles.map((file) => file.filePath));
  return path.posix.basename(commonDirectory) || commonDirectory || 'root';
}

function inferModuleRole(input: {
  moduleName: string;
  modulePath?: string;
  ownedFiles: readonly FileSummary[];
}): string | undefined {
  const haystack = [
    input.moduleName,
    input.modulePath,
    ...input.ownedFiles.map((file) => file.filePath),
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
  if (/\b(test|spec|fixture)\b/.test(haystack)) {
    return 'test';
  }
  if (/\b(api|interface|controller|route)\b/.test(haystack)) {
    return 'interface';
  }
  if (/\b(service|workflow|usecase)\b/.test(haystack)) {
    return 'service';
  }
  if (/\b(domain|model|entity)\b/.test(haystack)) {
    return 'domain';
  }
  if (/\b(infra|repository|database|persistence)\b/.test(haystack)) {
    return 'infrastructure';
  }
  return undefined;
}

function inferRoleConfidence(
  role: string,
  moduleName: string,
  modulePath: string | undefined,
  ownedFiles: readonly FileSummary[]
): number {
  const evidence = [moduleName, modulePath, ...ownedFiles.map((file) => file.filePath)]
    .filter((value): value is string => Boolean(value))
    .filter((value) => value.toLowerCase().includes(role)).length;
  return evidence > 0 ? 0.75 : 0.45;
}

function findCommonDirectory(filePaths: readonly string[]): string {
  const directories = filePaths.map((filePath) => path.posix.dirname(filePath));
  const [first, ...rest] = directories;
  if (!first) {
    return '';
  }
  const parts = first.split('/');
  let end = parts.length;
  for (const directory of rest) {
    const currentParts = directory.split('/');
    let index = 0;
    while (index < end && parts[index] === currentParts[index]) {
      index += 1;
    }
    end = index;
  }
  return parts.slice(0, end).join('/');
}

function createModuleScope(input: {
  projectRoot: string;
  repoId?: string;
  sourceFolder?: string;
  modulePath?: string;
}): ProjectContextRefScope {
  return {
    filePath: input.modulePath,
    projectRoot: input.projectRoot,
    repoId: input.repoId,
    sourceFolder: input.sourceFolder,
  };
}

function createQueryError(input: {
  code: ProjectContextQueryError['code'];
  message: string;
  path?: string;
  retryable: boolean;
}): ProjectContextQueryError {
  return {
    code: input.code,
    message: input.message,
    path: input.path,
    retryable: input.retryable,
    severity: input.code === 'query-unavailable' ? 'warning' : 'error',
  };
}

function readProjectContextRef(value: unknown): ProjectContextRef | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.kind !== 'string') {
    return undefined;
  }
  if (!isRecord(value.scope)) {
    return undefined;
  }
  return value as unknown as ProjectContextRef;
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readMetadataStringArray(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function setOptionalMetadata(
  metadata: ProjectContextMetadata,
  key: string,
  value: ProjectContextJson | undefined
): void {
  if (value !== undefined && value !== '') {
    metadata[key] = value;
  }
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function compareFiles(left: FileSummary, right: FileSummary): number {
  return left.filePath.localeCompare(right.filePath);
}

function isContainedRelativePath(value: string): boolean {
  return value !== '' && !value.startsWith('..') && !path.isAbsolute(value);
}

function toProjectContextPath(value: string): string {
  return value.split(path.sep).join('/');
}

function encodeRefPart(value: string): string {
  return encodeURIComponent(value).replaceAll('%2F', '/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
