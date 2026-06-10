import { createHash } from 'node:crypto';
import path from 'node:path';

export const PROJECT_SCOPE_CONTRACT_VERSION = 1;

export const PROJECT_SCOPE_STORAGE_KINDS = ['ghost'] as const;

export const PROJECT_SCOPE_FOLDER_ROLES = ['primary-source', 'source'] as const;

export const PROJECT_SCOPE_FOLDER_STATES = ['active'] as const;

export const PROJECT_SCOPE_RESOLUTION_REASONS = [
  'matched-folder',
  'folder-not-bound',
  'empty-scope',
] as const;

export const PROJECT_SCOPE_OPERATIONS = [
  'project-scope.read',
  'project-folders.add',
  'project-folders.list',
  'project-folders.resolve',
] as const;

export const ALEMBIC_PROJECT_SCOPE_ENDPOINTS = {
  addFolder: '/api/v1/project-scope/folders',
  listFolders: '/api/v1/project-scope/folders',
  readScope: '/api/v1/project-scope',
  resolveFolder: '/api/v1/project-scope/resolve-folder',
} as const;

export type ProjectScopeStorageKind = (typeof PROJECT_SCOPE_STORAGE_KINDS)[number];
export type ProjectScopeFolderRole = (typeof PROJECT_SCOPE_FOLDER_ROLES)[number];
export type ProjectScopeFolderState = (typeof PROJECT_SCOPE_FOLDER_STATES)[number];
export type ProjectScopeResolutionReason = (typeof PROJECT_SCOPE_RESOLUTION_REASONS)[number];
export type ProjectScopeOperation = (typeof PROJECT_SCOPE_OPERATIONS)[number];

export interface ProjectControlRoot {
  includedInFolders: false;
  kind: 'workspace-control-root';
  path: string;
}

export interface ProjectScopeStorage {
  dataRoot: string;
  dataRootSource: 'ghost-registry';
  kind: 'ghost';
  projectRootWriteAllowed: false;
  standardWriteAllowed: false;
}

export interface ProjectFolderDescriptor {
  addedAt: string | null;
  displayName: string;
  id: string;
  metadata: Record<string, unknown>;
  path: string;
  realpath: string | null;
  repositoryId: string | null;
  role: ProjectScopeFolderRole;
  state: 'active';
}

export interface ProjectDescriptor {
  contractVersion: typeof PROJECT_SCOPE_CONTRACT_VERSION;
  controlRoot: ProjectControlRoot;
  createdAt: string | null;
  currentFolderId: string | null;
  dataRoot: string;
  displayName: string;
  folders: ProjectFolderDescriptor[];
  metadata: Record<string, unknown>;
  projectId: string;
  projectScopeId: string;
  storage: ProjectScopeStorage;
  updatedAt: string | null;
}

export interface ProjectScopeFolderSummary {
  displayName: string;
  folderId: string;
  path: string;
  realpath: string | null;
  repositoryId: string | null;
  role: ProjectScopeFolderRole;
  state: 'active';
}

export interface ProjectScopeSummary {
  contractVersion: typeof PROJECT_SCOPE_CONTRACT_VERSION;
  controlRoot: string;
  controlRootIncludedInFolders: false;
  currentFolderId: string | null;
  currentFolderPath: string | null;
  dataRoot: string;
  dataRootSource: 'ghost-registry';
  displayName: string;
  folderCount: number;
  folders: ProjectScopeFolderSummary[];
  projectId: string;
  projectRootWriteAllowed: false;
  projectScopeId: string;
  standardWriteAllowed: false;
  storageKind: 'ghost';
}

export interface ProjectScopeResolution {
  controlRoot: ProjectControlRoot;
  currentFolder: ProjectFolderDescriptor | null;
  currentFolderId: string | null;
  dataRoot: string;
  folderPath: string;
  folderRealpath: string | null;
  matched: boolean;
  projectScope: ProjectDescriptor;
  projectScopeId: string;
  reason: ProjectScopeResolutionReason;
}

export interface ProjectScopeEndpointCapability {
  available: boolean;
  endpoints: typeof ALEMBIC_PROJECT_SCOPE_ENDPOINTS;
  projectRootWriteAllowed: false;
  storageKind: 'ghost';
  supportedOperations: ProjectScopeOperation[];
  supportsFolderDisable: false;
  supportsFolderRemove: false;
  supportsStandardStorage: false;
}

export interface ProjectScopeEvidenceRef {
  absolutePath: string | null;
  folderId: string | null;
  folderPath: string | null;
  projectScopeId: string;
  relativePath: string;
  sourceKind: 'artifact' | 'report' | 'source-file' | 'unknown';
}

export interface CanonicalSourceIdentity {
  absolutePath: string | null;
  folderDisplayName: string | null;
  folderId: string | null;
  folderPath: string | null;
  folderRelativeRoot: string | null;
  projectScopeId: string | null;
  qualifiedPath: string;
  relativePath: string;
}

export interface CanonicalSourceIdentityInput {
  folderDisplayName?: string | null;
  folderId?: string | null;
  folderPath?: string | null;
  projectRoot?: string | null;
  projectScopeId?: string | null;
  relativePath?: string | null;
  sourcePath: string;
}

export type ProjectScopeSourceRefResolutionStatus = 'resolved' | 'missing';

export interface ProjectScopeSourceRefResolution {
  identity: CanonicalSourceIdentity | null;
  input: string;
  reason: string;
  status: ProjectScopeSourceRefResolutionStatus;
}

export interface ProjectScopeSourceRefIndex {
  byQualifiedPath: ReadonlyMap<string, CanonicalSourceIdentity>;
}

export type ProjectScopeSourceRefNormalizationStatus = 'active' | 'missing';

export type ProjectScopeSourceRefNormalizationReason = 'qualified-path' | 'not-found';

export interface NormalizedProjectScopeSourceRef {
  absolutePath: string | null;
  folderDisplayName: string | null;
  folderId: string | null;
  folderPath: string | null;
  input: string;
  normalizedRef: string | null;
  projectScopeId: string | null;
  qualifiedPath: string | null;
  reason: ProjectScopeSourceRefNormalizationReason;
  relativePath: string | null;
  status: ProjectScopeSourceRefNormalizationStatus;
}

export interface ProjectScopeSourceRefNormalizationResult {
  activeSourceRefs: string[];
  normalized: NormalizedProjectScopeSourceRef[];
  rejected: NormalizedProjectScopeSourceRef[];
}

export interface ProjectScopeRegistryFolderIndexEntry {
  folderId: string;
  projectScopeId: string;
}

export interface ProjectScopeRegistryDocument {
  folderIndex: Record<string, ProjectScopeRegistryFolderIndexEntry>;
  scopes: Record<string, ProjectDescriptor>;
  version: typeof PROJECT_SCOPE_CONTRACT_VERSION;
}

export interface CreateProjectFolderDescriptorInput {
  addedAt?: string | null;
  displayName?: string | null;
  id?: string | null;
  metadata?: Record<string, unknown> | null;
  path: string;
  realpath?: string | null;
  repositoryId?: string | null;
  role?: ProjectScopeFolderRole | null;
}

export interface CreateProjectDescriptorInput {
  controlRoot: ProjectControlRoot | string;
  createdAt?: string | null;
  currentFolderId?: string | null;
  dataRoot?: string;
  displayName?: string | null;
  folders?: readonly (CreateProjectFolderDescriptorInput | ProjectFolderDescriptor)[];
  metadata?: Record<string, unknown> | null;
  projectId?: string | null;
  projectScopeId?: string | null;
  storage?: Partial<ProjectScopeStorage> & { kind?: unknown };
  updatedAt?: string | null;
}

export function normalizeProjectScopePath(value: string, label = 'path'): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`[ProjectScope] ${label} must be a non-empty string`);
  }
  return path.resolve(value);
}

export function createProjectControlRoot(input: ProjectControlRoot | string): ProjectControlRoot {
  const rootPath = typeof input === 'string' ? input : input.path;
  return {
    includedInFolders: false,
    kind: 'workspace-control-root',
    path: normalizeProjectScopePath(rootPath, 'controlRoot.path'),
  };
}

export function createProjectFolderDescriptor(
  input: CreateProjectFolderDescriptorInput | ProjectFolderDescriptor
): ProjectFolderDescriptor {
  const folderPath = normalizeProjectScopePath(input.path, 'folder.path');
  const role = normalizeProjectScopeFolderRole(input.role);
  const id = normalizeNullableString(input.id) ?? stableProjectScopeId('folder', folderPath);
  return {
    addedAt: normalizeNullableString(input.addedAt),
    displayName: normalizeNullableString(input.displayName) ?? path.basename(folderPath),
    id,
    metadata: cloneRecord(input.metadata),
    path: folderPath,
    realpath: normalizeNullableString(input.realpath),
    repositoryId: normalizeNullableString(input.repositoryId),
    role,
    state: 'active',
  };
}

export function createProjectDescriptor(input: CreateProjectDescriptorInput): ProjectDescriptor {
  const controlRoot = createProjectControlRoot(input.controlRoot);
  const storage = normalizeProjectScopeStorage(input);
  const projectScopeId =
    normalizeNullableString(input.projectScopeId) ??
    stableProjectScopeId('project-scope', `${controlRoot.path}:${storage.dataRoot}`);
  const projectId =
    normalizeNullableString(input.projectId) ?? stableProjectScopeId('project', projectScopeId);
  const folders = normalizeProjectScopeFolders(input.folders ?? [], controlRoot.path);
  const currentFolderId =
    normalizeNullableString(input.currentFolderId) ?? folders.find(Boolean)?.id ?? null;

  assertKnownFolderId(folders, currentFolderId, 'currentFolderId');

  return {
    contractVersion: PROJECT_SCOPE_CONTRACT_VERSION,
    controlRoot,
    createdAt: normalizeNullableString(input.createdAt),
    currentFolderId,
    dataRoot: storage.dataRoot,
    displayName: normalizeNullableString(input.displayName) ?? path.basename(controlRoot.path),
    folders,
    metadata: cloneRecord(input.metadata),
    projectId,
    projectScopeId,
    storage,
    updatedAt: normalizeNullableString(input.updatedAt),
  };
}

export function addProjectScopeFolder(
  scope: ProjectDescriptor,
  folderInput: CreateProjectFolderDescriptorInput | ProjectFolderDescriptor,
  options: { currentFolderId?: string | null; updatedAt?: string | null } = {}
): ProjectDescriptor {
  const folder = createProjectFolderDescriptor(folderInput);
  assertFolderCanEnterScope(scope.controlRoot.path, folder);

  const existingByPath = scope.folders.find((candidate) =>
    pathsEquivalent(candidate.path, folder.path)
  );
  const existingById = scope.folders.find((candidate) => candidate.id === folder.id);

  if (existingById && !pathsEquivalent(existingById.path, folder.path)) {
    throw new Error(`[ProjectScope] duplicate folder id points to another path: ${folder.id}`);
  }

  const folders = existingByPath
    ? scope.folders.map((candidate) => (candidate.id === existingByPath.id ? folder : candidate))
    : [...scope.folders, folder];
  const currentFolderId =
    normalizeNullableString(options.currentFolderId) ?? scope.currentFolderId ?? folder.id;

  assertKnownFolderId(folders, currentFolderId, 'currentFolderId');

  return {
    ...scope,
    currentFolderId,
    folders,
    updatedAt: normalizeNullableString(options.updatedAt) ?? scope.updatedAt,
  };
}

export function listProjectScopeFolders(scope: ProjectDescriptor): ProjectFolderDescriptor[] {
  return scope.folders.map((folder) => ({ ...folder, metadata: cloneRecord(folder.metadata) }));
}

export function resolveProjectScopeForFolder(
  scope: ProjectDescriptor,
  folderPath: string,
  options: { folderRealpath?: string | null } = {}
): ProjectScopeResolution {
  const normalizedFolderPath = normalizeProjectScopePath(folderPath, 'folderPath');
  const normalizedRealpath = normalizeNullableString(options.folderRealpath);
  const currentFolder = findBestProjectScopeFolder(
    scope.folders,
    normalizedFolderPath,
    normalizedRealpath
  );
  return {
    controlRoot: scope.controlRoot,
    currentFolder,
    currentFolderId: currentFolder?.id ?? null,
    dataRoot: scope.dataRoot,
    folderPath: normalizedFolderPath,
    folderRealpath: normalizedRealpath,
    matched: currentFolder !== null,
    projectScope: scope,
    projectScopeId: scope.projectScopeId,
    reason: currentFolder
      ? 'matched-folder'
      : scope.folders.length === 0
        ? 'empty-scope'
        : 'folder-not-bound',
  };
}

export function summarizeProjectScopeDescriptor(
  scope: ProjectDescriptor,
  currentFolderId: string | null = scope.currentFolderId
): ProjectScopeSummary {
  const currentFolder = currentFolderId
    ? (scope.folders.find((folder) => folder.id === currentFolderId) ?? null)
    : null;
  return {
    contractVersion: PROJECT_SCOPE_CONTRACT_VERSION,
    controlRoot: scope.controlRoot.path,
    controlRootIncludedInFolders: false,
    currentFolderId: currentFolder?.id ?? null,
    currentFolderPath: currentFolder?.path ?? null,
    dataRoot: scope.dataRoot,
    dataRootSource: 'ghost-registry',
    displayName: scope.displayName,
    folderCount: scope.folders.length,
    folders: scope.folders.map(projectFolderToSummary),
    projectId: scope.projectId,
    projectRootWriteAllowed: false,
    projectScopeId: scope.projectScopeId,
    standardWriteAllowed: false,
    storageKind: 'ghost',
  };
}

export function normalizeProjectScopeSummary(value: unknown): ProjectScopeSummary | null {
  const scope = asRecord(value);
  const projectScopeId = normalizeNullableString(scope?.projectScopeId);
  const projectId = normalizeNullableString(scope?.projectId);
  const dataRoot = normalizeNullableString(scope?.dataRoot);
  const controlRoot = normalizeNullableString(scope?.controlRoot);
  if (!projectScopeId || !projectId || !dataRoot || !controlRoot) {
    return null;
  }

  const folders = Array.isArray(scope?.folders)
    ? scope.folders.map(normalizeProjectScopeFolderSummary).filter(isProjectScopeFolderSummary)
    : [];
  const currentFolderId = normalizeNullableString(scope?.currentFolderId);
  const currentFolder =
    folders.find((folder) => folder.folderId === currentFolderId) ??
    folders.find((folder) => folder.path === normalizeNullableString(scope?.currentFolderPath)) ??
    null;

  return {
    contractVersion: PROJECT_SCOPE_CONTRACT_VERSION,
    controlRoot,
    controlRootIncludedInFolders: false,
    currentFolderId: currentFolder?.folderId ?? currentFolderId,
    currentFolderPath: currentFolder?.path ?? normalizeNullableString(scope?.currentFolderPath),
    dataRoot,
    dataRootSource: 'ghost-registry',
    displayName: normalizeNullableString(scope?.displayName) ?? path.basename(controlRoot),
    folderCount: folders.length,
    folders,
    projectId,
    projectRootWriteAllowed: false,
    projectScopeId,
    standardWriteAllowed: false,
    storageKind: 'ghost',
  };
}

export function createProjectScopeEndpointCapability(
  options: Partial<ProjectScopeEndpointCapability> = {}
): ProjectScopeEndpointCapability {
  return {
    available: options.available ?? false,
    endpoints: ALEMBIC_PROJECT_SCOPE_ENDPOINTS,
    projectRootWriteAllowed: false,
    storageKind: 'ghost',
    supportedOperations: [...(options.supportedOperations ?? PROJECT_SCOPE_OPERATIONS)],
    supportsFolderDisable: false,
    supportsFolderRemove: false,
    supportsStandardStorage: false,
  };
}

export function createProjectScopeEvidenceRef(input: {
  absolutePath?: string | null;
  folderId?: string | null;
  folderPath?: string | null;
  projectScopeId: string;
  relativePath: string;
  sourceKind?: ProjectScopeEvidenceRef['sourceKind'];
}): ProjectScopeEvidenceRef {
  return {
    absolutePath: normalizeNullableString(input.absolutePath),
    folderId: normalizeNullableString(input.folderId),
    folderPath: normalizeNullableString(input.folderPath),
    projectScopeId: input.projectScopeId,
    relativePath: input.relativePath,
    sourceKind: input.sourceKind ?? 'unknown',
  };
}

export function createProjectScopeSourceRef(input: {
  folderId?: string | null;
  folderPath?: string | null;
  projectScopeId: string;
  sourcePath: string;
}): ProjectScopeEvidenceRef {
  return createProjectScopeEvidenceRef({
    folderId: input.folderId,
    folderPath: input.folderPath,
    projectScopeId: input.projectScopeId,
    relativePath: input.sourcePath,
    sourceKind: 'source-file',
  });
}

export function createCanonicalSourceIdentity(
  input: CanonicalSourceIdentityInput
): CanonicalSourceIdentity {
  const sourcePath = normalizeSlashPath(input.sourcePath, 'sourcePath');
  const relativePath = normalizeSlashPath(input.relativePath ?? sourcePath, 'relativePath');
  const folderDisplayName = normalizeNullableString(input.folderDisplayName);
  const folderPath = normalizeNullableString(input.folderPath);
  const projectRoot = normalizeNullableString(input.projectRoot);
  const folderRelativeRoot =
    folderPath && projectRoot
      ? normalizeComparableSourcePath(path.relative(projectRoot, folderPath))
      : null;
  const qualifiedPath = folderDisplayName
    ? normalizeComparableSourcePath(`${folderDisplayName}/${relativePath}`)
    : relativePath;

  return {
    absolutePath: folderPath ? path.resolve(folderPath, relativePath) : null,
    folderDisplayName,
    folderId: normalizeNullableString(input.folderId),
    folderPath,
    folderRelativeRoot,
    projectScopeId: normalizeNullableString(input.projectScopeId),
    qualifiedPath,
    relativePath,
  };
}

export function buildProjectScopeSourceRefIndex(
  identities: readonly CanonicalSourceIdentity[]
): ProjectScopeSourceRefIndex {
  const byQualifiedPath = new Map<string, CanonicalSourceIdentity>();

  for (const identity of identities) {
    byQualifiedPath.set(normalizeComparableSourcePath(identity.qualifiedPath), identity);
  }

  return { byQualifiedPath };
}

export function resolveProjectScopeSourceRef(
  sourceRef: string,
  index: ProjectScopeSourceRefIndex
): ProjectScopeSourceRefResolution {
  const normalized = normalizeComparableSourcePath(sourceRef);
  const qualified = index.byQualifiedPath.get(normalized);
  if (qualified) {
    return { identity: qualified, input: sourceRef, reason: 'qualified-path', status: 'resolved' };
  }
  return { identity: null, input: sourceRef, reason: 'not-found', status: 'missing' };
}

export function normalizeProjectScopeSourceRef(
  sourceRef: string,
  index: ProjectScopeSourceRefIndex
): NormalizedProjectScopeSourceRef {
  const resolution = resolveProjectScopeSourceRef(sourceRef, index);
  if (resolution.status === 'resolved' && resolution.identity) {
    return normalizeResolvedProjectScopeSourceRef(sourceRef, resolution.identity, 'qualified-path');
  }

  return normalizeRejectedProjectScopeSourceRef(sourceRef, {
    reason: 'not-found',
    status: 'missing',
  });
}

export function normalizeProjectScopeSourceRefs(
  sourceRefs: readonly string[],
  index: ProjectScopeSourceRefIndex
): ProjectScopeSourceRefNormalizationResult {
  const normalized = sourceRefs.map((sourceRef) =>
    normalizeProjectScopeSourceRef(sourceRef, index)
  );
  const activeSourceRefs = Array.from(
    new Set(
      normalized
        .filter((sourceRef) => sourceRef.status === 'active' && sourceRef.normalizedRef)
        .map((sourceRef) => sourceRef.normalizedRef as string)
    )
  );
  return {
    activeSourceRefs,
    normalized,
    rejected: normalized.filter((sourceRef) => sourceRef.status !== 'active'),
  };
}

export function createProjectScopeRegistryDocument(
  scopes: readonly ProjectDescriptor[] = []
): ProjectScopeRegistryDocument {
  return scopes.reduce<ProjectScopeRegistryDocument>(
    (document, scope) => upsertProjectScopeInRegistry(document, scope),
    {
      folderIndex: {},
      scopes: {},
      version: PROJECT_SCOPE_CONTRACT_VERSION,
    }
  );
}

export function upsertProjectScopeInRegistry(
  document: ProjectScopeRegistryDocument,
  scope: ProjectDescriptor
): ProjectScopeRegistryDocument {
  const nextDocument: ProjectScopeRegistryDocument = {
    folderIndex: { ...document.folderIndex },
    scopes: { ...document.scopes, [scope.projectScopeId]: scope },
    version: PROJECT_SCOPE_CONTRACT_VERSION,
  };
  for (const folder of scope.folders) {
    nextDocument.folderIndex[folder.path] = {
      folderId: folder.id,
      projectScopeId: scope.projectScopeId,
    };
  }
  return nextDocument;
}

export function addProjectScopeFolderToRegistry(
  document: ProjectScopeRegistryDocument,
  projectScopeId: string,
  folderInput: CreateProjectFolderDescriptorInput | ProjectFolderDescriptor
): ProjectScopeRegistryDocument {
  const scope = document.scopes[projectScopeId];
  if (!scope) {
    throw new Error(`[ProjectScope] registry scope not found: ${projectScopeId}`);
  }
  return upsertProjectScopeInRegistry(document, addProjectScopeFolder(scope, folderInput));
}

export function resolveProjectScopeRegistryFolder(
  document: ProjectScopeRegistryDocument,
  folderPath: string
): ProjectScopeResolution | null {
  const normalizedPath = normalizeProjectScopePath(folderPath, 'folderPath');
  const scope = Object.values(document.scopes)
    .map((candidate) => ({
      resolution: resolveProjectScopeForFolder(candidate, normalizedPath),
      scope: candidate,
    }))
    .filter(({ resolution }) => resolution.matched)
    .sort(
      (left, right) =>
        (right.resolution.currentFolder?.path.length ?? 0) -
        (left.resolution.currentFolder?.path.length ?? 0)
    )[0]?.scope;

  return scope ? resolveProjectScopeForFolder(scope, normalizedPath) : null;
}

function normalizeProjectScopeStorage(input: CreateProjectDescriptorInput): ProjectScopeStorage {
  const kind = input.storage?.kind ?? 'ghost';
  if (kind !== 'ghost') {
    throw new Error(
      '[ProjectScope] new ProjectScope entries are Ghost-only; standard/project-root storage is not supported'
    );
  }
  const dataRoot = normalizeProjectScopePath(
    input.storage?.dataRoot ?? input.dataRoot ?? '',
    'dataRoot'
  );
  return {
    dataRoot,
    dataRootSource: 'ghost-registry',
    kind: 'ghost',
    projectRootWriteAllowed: false,
    standardWriteAllowed: false,
  };
}

function normalizeProjectScopeFolders(
  inputs: readonly (CreateProjectFolderDescriptorInput | ProjectFolderDescriptor)[],
  controlRoot: string
): ProjectFolderDescriptor[] {
  const folders: ProjectFolderDescriptor[] = [];
  for (const input of inputs) {
    const folder = createProjectFolderDescriptor(input);
    assertFolderCanEnterScope(controlRoot, folder);
    const duplicate = folders.find(
      (candidate) => candidate.id === folder.id || pathsEquivalent(candidate.path, folder.path)
    );
    if (!duplicate) {
      folders.push(folder);
    }
  }
  return folders;
}

function assertFolderCanEnterScope(controlRoot: string, folder: ProjectFolderDescriptor): void {
  // controlRoot 是总控边界，不是源码 folder，避免把整个 workspace 当成扫描源。
  if (pathsEquivalent(controlRoot, folder.path) || pathsEquivalent(controlRoot, folder.realpath)) {
    throw new Error('[ProjectScope] controlRoot cannot be included in folders');
  }
}

function assertKnownFolderId(
  folders: readonly ProjectFolderDescriptor[],
  folderId: string | null,
  label: string
): void {
  if (folderId && !folders.some((folder) => folder.id === folderId)) {
    throw new Error(`[ProjectScope] ${label} must point to a known folder`);
  }
}

function findBestProjectScopeFolder(
  folders: readonly ProjectFolderDescriptor[],
  folderPath: string,
  folderRealpath: string | null
): ProjectFolderDescriptor | null {
  return (
    folders
      .filter(
        (folder) =>
          isSameOrInsidePath(folderPath, folder.path) ||
          (folderRealpath !== null && isSameOrInsidePath(folderRealpath, folder.path)) ||
          (folder.realpath !== null && isSameOrInsidePath(folderPath, folder.realpath)) ||
          (folderRealpath !== null &&
            folder.realpath !== null &&
            isSameOrInsidePath(folderRealpath, folder.realpath))
      )
      .sort((left, right) => right.path.length - left.path.length)[0] ?? null
  );
}

function projectFolderToSummary(folder: ProjectFolderDescriptor): ProjectScopeFolderSummary {
  return {
    displayName: folder.displayName,
    folderId: folder.id,
    path: folder.path,
    realpath: folder.realpath,
    repositoryId: folder.repositoryId,
    role: folder.role,
    state: folder.state,
  };
}

function normalizeProjectScopeFolderSummary(value: unknown): ProjectScopeFolderSummary | null {
  const folder = asRecord(value);
  const folderId = normalizeNullableString(folder?.folderId ?? folder?.id);
  const folderPath = normalizeNullableString(folder?.path);
  if (!folderId || !folderPath) {
    return null;
  }
  return {
    displayName: normalizeNullableString(folder?.displayName) ?? path.basename(folderPath),
    folderId,
    path: folderPath,
    realpath: normalizeNullableString(folder?.realpath),
    repositoryId: normalizeNullableString(folder?.repositoryId),
    role: normalizeProjectScopeFolderRole(folder?.role),
    state: 'active',
  };
}

function isProjectScopeFolderSummary(
  value: ProjectScopeFolderSummary | null
): value is ProjectScopeFolderSummary {
  return value !== null;
}

function normalizeProjectScopeFolderRole(value: unknown): ProjectScopeFolderRole {
  return PROJECT_SCOPE_FOLDER_ROLES.includes(value as never)
    ? (value as ProjectScopeFolderRole)
    : 'source';
}

function stableProjectScopeId(prefix: string, value: string): string {
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 12);
  return `${prefix}-${hash}`;
}

function isSameOrInsidePath(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function pathsEquivalent(left: string | null, right: string | null): boolean {
  if (!left || !right) {
    return false;
  }
  return path.resolve(left) === path.resolve(right);
}

function normalizeSlashPath(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`[ProjectScope] ${label} must be a non-empty string`);
  }
  return normalizeComparableSourcePath(value);
}

function normalizeComparableSourcePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function normalizeResolvedProjectScopeSourceRef(
  input: string,
  identity: CanonicalSourceIdentity,
  reason: ProjectScopeSourceRefNormalizationReason
): NormalizedProjectScopeSourceRef {
  return {
    absolutePath: identity.absolutePath,
    folderDisplayName: identity.folderDisplayName,
    folderId: identity.folderId,
    folderPath: identity.folderPath,
    input,
    normalizedRef: identity.qualifiedPath,
    projectScopeId: identity.projectScopeId,
    qualifiedPath: identity.qualifiedPath,
    reason,
    relativePath: identity.relativePath,
    status: 'active',
  };
}

function normalizeRejectedProjectScopeSourceRef(
  input: string,
  output: {
    reason: Exclude<ProjectScopeSourceRefNormalizationReason, 'qualified-path'>;
    status: Exclude<ProjectScopeSourceRefNormalizationStatus, 'active'>;
  }
): NormalizedProjectScopeSourceRef {
  return {
    absolutePath: null,
    folderDisplayName: null,
    folderId: null,
    folderPath: null,
    input,
    normalizedRef: null,
    projectScopeId: null,
    qualifiedPath: null,
    reason: output.reason,
    relativePath: null,
    status: output.status,
  };
}

function cloneRecord(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
