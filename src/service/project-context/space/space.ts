import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  HotspotSummary,
  PathSummary,
  ProjectContextJson,
  ProjectContextQueryError,
  ProjectContextRef,
  ProjectContextScope,
  ProjectContextUnavailableData,
  ProjectSpaceSummary,
  RepoBoundarySummary,
  RepoSummary,
  SourceFolderSummary,
  SpaceContext,
} from '../../../domain/project-context/index.js';
import type { ProjectFolderDescriptor } from '../../../shared/ProjectScope.js';
import {
  type ProjectDescriptor,
  readProjectScopeFromWorkspaceConfig,
} from '../../../shared/ProjectScope.js';
import type { ProjectContextHandler, ProjectContextHandlerResult } from '../interface/contracts.js';
import {
  createProjectContextRepoSpaceMetadata,
  createProjectContextRepoSpacePathRef,
  createProjectContextRepoSpacePathSummary,
  createProjectContextRepoSpaceRepoRef,
  createProjectContextRepoSpaceSourceFolderSummary,
} from '../shared/repo-space/index.js';
import type { SpaceRequestPayload } from './contracts.js';

const DEFAULT_TREE_NODE_LIMIT = 80;
const HOTSPOT_LIMIT = 8;
const TREE_EXCLUDE_DIRS = new Set([
  '.asd',
  '.git',
  '.workspace-active',
  '.workspace-local',
  'coverage',
  'dist',
  'node_modules',
]);

interface SpaceFolder {
  absolutePath: string;
  childCount: number;
  displayName: string;
  folderId: string;
  missing: boolean;
  outsideSpace: boolean;
  realpath?: string;
  relativePath: string;
  repoId: string;
  repoRef: ProjectContextRef;
  role: string;
  sourceFolder: SourceFolderSummary;
}

interface SpaceResolution {
  displayName: string;
  errors: ProjectContextQueryError[];
  folders: SpaceFolder[];
  projectId: string;
  projectRoot: string;
  projectScope?: ProjectDescriptor;
  projectScopeId?: string;
  rootRealpath: string;
}

interface ActiveFileFact {
  folder: SpaceFolder;
  ref: ProjectContextRef;
  summary: PathSummary;
}

interface ActiveFileResolution {
  activeFileProvided: boolean;
  errors: ProjectContextQueryError[];
  fact?: ActiveFileFact;
}

export const spaceProjectContextHandler: ProjectContextHandler = async (
  request
): Promise<ProjectContextHandlerResult> => {
  const payload = readSpacePayload(request.payload);
  const resolution = await resolveSpace({
    payload,
    scope: request.scope,
  });
  if (!resolution.ok) {
    return createSpaceFailure(resolution.error, resolution.errors);
  }

  const errors = [...resolution.space.errors];
  const activeFile = await resolveActiveFileFact({
    payload,
    requestScope: request.scope,
    space: resolution.space,
  });
  errors.push(...activeFile.errors);
  const active = selectActiveRepo({
    activeFile,
    payload,
    projectScope: resolution.space.projectScope,
    requestScope: request.scope,
    space: resolution.space,
  });
  errors.push(...active.errors);

  const repos = createRepoSummaries(resolution.space.folders);
  const boundaries = createBoundarySummaries(resolution.space.folders);
  const treeFacts =
    payload.includeProjectTree === false
      ? { errors: [], hotspots: [], tree: undefined, treeRefs: [] }
      : createProjectTreeFacts({
          activeFile: activeFile.fact,
          includeStructuralHotspots: payload.includeStructuralHotspots,
          maxTreeEntries: payload.maxTreeEntries ?? DEFAULT_TREE_NODE_LIMIT,
          space: resolution.space,
        });
  errors.push(...treeFacts.errors);

  const sourceRefFacts = await normalizeSourceRefs({
    sourceRefs: payload.sourceRefs,
    space: resolution.space,
  });
  errors.push(...sourceRefFacts.errors);

  const spaceRef = createProjectContextSpaceRef({
    projectId: resolution.space.projectId,
    projectRoot: resolution.space.projectRoot,
    projectScopeId: resolution.space.projectScopeId,
  });
  const sourceFolders = resolution.space.folders.map((folder) => folder.sourceFolder);
  const space: ProjectSpaceSummary = {
    displayName: resolution.space.displayName,
    id: resolution.space.projectId,
    projectScopeId: resolution.space.projectScopeId,
    root: '.',
    sourceFolders,
  };
  const nextRefs = dedupeRefs([
    spaceRef,
    ...repos.map((repo) => repo.ref),
    ...sourceFolders.map((folder) => folder.repoRef),
    ...boundaries.map((boundary) => boundary.repoRef),
    activeFile.fact?.ref,
    ...(treeFacts.treeRefs ?? []),
    ...treeFacts.hotspots.map((hotspot) => hotspot.ref),
    ...sourceRefFacts.refs,
  ]);

  const data: SpaceContext = {
    activeRepo: active.repoRef,
    boundaries,
    nextRefs,
    projectTree: treeFacts.tree,
    repos,
    sourceFolders,
    space,
    structuralHotspots: treeFacts.hotspots,
  };

  return {
    data,
    errors: errors.length > 0 ? dedupeErrors(errors) : undefined,
    refs: dedupeRefs([spaceRef, ...nextRefs]),
  };
};

function readSpacePayload(payload: unknown): SpaceRequestPayload {
  if (!isRecord(payload)) {
    return {};
  }
  return {
    activeFile: readString(payload.activeFile),
    currentFolderId: readString(payload.currentFolderId),
    displayName: readString(payload.displayName),
    includeProjectTree: readBoolean(payload.includeProjectTree),
    includeStructuralHotspots: readBoolean(payload.includeStructuralHotspots),
    maxTreeEntries: readPositiveInteger(payload.maxTreeEntries),
    projectId: readString(payload.projectId),
    ref: readProjectContextRef(payload.ref),
    sourceFolders: readUnknownArray(payload.sourceFolders),
    sourceRefs: readStringArray(payload.sourceRefs),
  };
}

async function resolveSpace(input: {
  payload: SpaceRequestPayload;
  scope: ProjectContextScope;
}): Promise<
  | { ok: true; space: SpaceResolution }
  | { ok: false; error: ProjectContextQueryError; errors: ProjectContextQueryError[] }
> {
  const projectRoot = path.resolve(input.scope.projectRoot);
  const rootRealpath = await readRealpath(projectRoot);
  if (!rootRealpath) {
    const error = createQueryError({
      code: 'invalid-scope',
      message: 'ProjectContext scope.projectRoot must exist before space can read project facts.',
      path: projectRoot,
      retryable: false,
    });
    return { error, errors: [], ok: false };
  }

  const errors: ProjectContextQueryError[] = [];
  const hasExplicitFolders = (input.payload.sourceFolders?.length ?? 0) > 0;
  const workspaceConfigPath = path.join(projectRoot, 'workspace.config.json');
  const workspaceConfigExists = await pathExists(workspaceConfigPath);
  const projectScope = hasExplicitFolders ? null : readProjectScopeFromWorkspaceConfig(projectRoot);
  if (workspaceConfigExists && !projectScope && !hasExplicitFolders) {
    errors.push(
      createQueryError({
        code: 'query-unavailable',
        message:
          'space workspace.config.json was unreadable or did not contain project source folders; using single-folder fallback.',
        path: 'workspace.config.json',
        retryable: true,
      })
    );
  }

  const folderInputs = hasExplicitFolders
    ? readExplicitFolderInputs(projectRoot, input.payload.sourceFolders ?? [])
    : projectScope
      ? projectScope.folders.map((folder) => projectFolderToInput(projectRoot, folder))
      : [
          {
            displayName: input.payload.displayName ?? path.basename(projectRoot),
            folderId: input.scope.repoId ?? createRepoIdFromPath('.', projectRoot),
            path: projectRoot,
            repositoryId: input.scope.repoId ?? createRepoIdFromPath('.', projectRoot),
            role: 'primary-source',
          },
        ];

  const folders: SpaceFolder[] = [];
  for (const folder of folderInputs) {
    const resolved = await createSpaceFolder({
      folder,
      projectRoot,
      rootRealpath,
    });
    folders.push(resolved.folder);
    errors.push(...resolved.errors);
  }

  errors.push(...createDuplicateErrors(folders));
  const projectId =
    input.payload.projectId ??
    projectScope?.projectId ??
    input.payload.ref?.metadata?.projectId?.toString() ??
    createProjectId(projectRoot);
  if (
    input.payload.projectId &&
    projectScope &&
    input.payload.projectId !== projectScope.projectId
  ) {
    errors.push(
      createQueryError({
        code: 'ambiguous',
        message: `space payload.projectId does not match workspace projectId: ${input.payload.projectId}`,
        retryable: false,
      })
    );
  }

  return {
    ok: true,
    space: {
      displayName:
        input.payload.displayName ?? projectScope?.displayName ?? path.basename(projectRoot),
      errors,
      folders,
      projectId,
      projectRoot,
      projectScope: projectScope ?? undefined,
      projectScopeId: projectScope?.projectScopeId,
      rootRealpath,
    },
  };
}

function projectFolderToInput(
  projectRoot: string,
  folder: ProjectFolderDescriptor
): ExplicitFolderInput {
  return {
    displayName: folder.displayName,
    folderId: folder.id,
    path: folder.path,
    realpath: folder.realpath ?? undefined,
    repositoryId: folder.repositoryId ?? undefined,
    role: folder.role,
    state: folder.state,
    source: readString(folder.metadata?.source),
  };
}

async function createSpaceFolder(input: {
  folder: ExplicitFolderInput;
  projectRoot: string;
  rootRealpath: string;
}): Promise<{ folder: SpaceFolder; errors: ProjectContextQueryError[] }> {
  const errors: ProjectContextQueryError[] = [];
  const absolutePath = path.isAbsolute(input.folder.path)
    ? path.resolve(input.folder.path)
    : path.resolve(input.projectRoot, input.folder.path);
  const relativePath = normalizeRelativePath(path.relative(input.projectRoot, absolutePath) || '.');
  const repoId = input.folder.repositoryId ?? input.folder.folderId;
  const displayName = input.folder.displayName ?? repoId;
  const realpath = (await readRealpath(absolutePath)) ?? input.folder.realpath;
  const missing = !realpath;
  const outsideSpace = Boolean(realpath && !isInsidePath(input.rootRealpath, realpath));
  if (missing) {
    errors.push(
      createQueryError({
        code: 'not-found',
        message: `space configured source folder is missing: ${relativePath}`,
        path: relativePath,
        retryable: false,
      })
    );
  } else if (outsideSpace) {
    errors.push(
      createQueryError({
        code: 'outside-scope',
        message: `space configured source folder realpath is outside project root: ${relativePath}`,
        path: relativePath,
        retryable: false,
      })
    );
  }

  const repoRef = createProjectContextRepoSpaceRepoRef({
    metadata: createProjectContextRepoSpaceMetadata({
      projectScopeFolderId: input.folder.folderId,
      source: input.folder.source ?? 'project-context-space',
    }),
    projectRoot: input.projectRoot,
    repoId,
    repoName: displayName,
    sourceFolder: relativePath,
  });
  const childCount = missing || outsideSpace ? 0 : await countTopLevelChildren(absolutePath);
  const sourceFolder = createProjectContextRepoSpaceSourceFolderSummary({
    displayName,
    folderId: input.folder.folderId,
    missing: missing || outsideSpace,
    path: relativePath,
    projectRoot: input.projectRoot,
    realpath,
    repoRef,
    repositoryId: repoId,
    role: input.folder.role,
    state: input.folder.state,
  });

  return {
    errors,
    folder: {
      absolutePath,
      childCount,
      displayName,
      folderId: input.folder.folderId,
      missing: missing || outsideSpace,
      outsideSpace,
      realpath,
      relativePath,
      repoId,
      repoRef,
      role: input.folder.role ?? 'source',
      sourceFolder,
    },
  };
}

function selectActiveRepo(input: {
  activeFile: ActiveFileResolution;
  payload: SpaceRequestPayload;
  projectScope?: ProjectDescriptor;
  requestScope: ProjectContextScope;
  space: SpaceResolution;
}): { repoRef?: ProjectContextRef; errors: ProjectContextQueryError[] } {
  const errors: ProjectContextQueryError[] = [];
  if (input.activeFile.activeFileProvided && input.activeFile.errors.length > 0) {
    return { errors };
  }

  const currentFolder = input.payload.currentFolderId
    ? input.space.folders.find(
        (folder) =>
          folder.folderId === input.payload.currentFolderId ||
          folder.repoId === input.payload.currentFolderId
      )
    : undefined;
  if (currentFolder && !currentFolder.missing) {
    return { errors, repoRef: currentFolder.repoRef };
  }

  if (input.activeFile.fact) {
    return { errors, repoRef: input.activeFile.fact.folder.repoRef };
  }

  const requestedSourceFolder =
    input.requestScope.sourceFolder ?? input.payload.ref?.scope.sourceFolder;
  if (requestedSourceFolder) {
    const matched = findFolderForRelativePath(input.space.folders, requestedSourceFolder);
    if (matched && !matched.missing) {
      return { errors, repoRef: matched.repoRef };
    }
  }

  const projectCurrentFolder = input.projectScope?.currentFolderId
    ? input.space.folders.find(
        (folder) =>
          folder.folderId === input.projectScope?.currentFolderId ||
          folder.repoId === input.projectScope?.currentFolderId
      )
    : undefined;
  if (projectCurrentFolder && !projectCurrentFolder.missing) {
    return { errors, repoRef: projectCurrentFolder.repoRef };
  }

  const firstAvailable = input.space.folders.find((folder) => !folder.missing);
  return { errors, repoRef: firstAvailable?.repoRef };
}

function createRepoSummaries(folders: readonly SpaceFolder[]): RepoSummary[] {
  return dedupeBy(
    folders
      .filter((folder) => !folder.missing)
      .map((folder) => ({
        id: folder.repoId,
        name: folder.displayName,
        ref: folder.repoRef,
        root: folder.relativePath,
      })),
    (repo) => `${repo.id}:${repo.root}`
  ).sort(compareRepos);
}

function createBoundarySummaries(folders: readonly SpaceFolder[]): RepoBoundarySummary[] {
  return folders
    .filter((folder) => !folder.missing)
    .map((folder) => ({
      notes: [
        `source-folder:${folder.sourceFolder.id}`,
        `role:${folder.sourceFolder.role ?? 'source'}`,
      ],
      repoRef: folder.repoRef,
      sourceFolders: [folder.sourceFolder],
    }))
    .sort((left, right) => left.repoRef.id.localeCompare(right.repoRef.id));
}

async function resolveActiveFileFact(input: {
  payload: SpaceRequestPayload;
  requestScope: ProjectContextScope;
  space: SpaceResolution;
}): Promise<ActiveFileResolution> {
  const activeFileValue =
    input.payload.activeFile ?? input.requestScope.activeFile ?? input.payload.ref?.scope.filePath;
  if (!activeFileValue) {
    return { activeFileProvided: false, errors: [] };
  }

  const activeFile = normalizeContainedProjectPath(input.space.projectRoot, activeFileValue);
  if (activeFile.ok === false) {
    return {
      activeFileProvided: true,
      errors: [
        createQueryError({
          code: 'outside-scope',
          message: 'space payload.activeFile/ref must stay inside scope.projectRoot.',
          path: activeFileValue,
          retryable: false,
        }),
      ],
    };
  }

  const matched = findFolderForRelativePath(input.space.folders, activeFile.path);
  if (!matched || matched.missing) {
    return {
      activeFileProvided: true,
      errors: [
        createQueryError({
          code: 'outside-scope',
          message: 'space activeFile is inside projectRoot but outside configured project space.',
          path: activeFile.path,
          retryable: false,
        }),
      ],
    };
  }

  const exists = await pathExists(path.join(input.space.projectRoot, activeFile.path));
  const ref = createProjectContextRepoSpacePathRef({
    exists,
    metadata: createProjectContextRepoSpaceMetadata({
      activeFile: true,
      nodeType: 'file',
      partOf: matched.relativePath,
      projectScopeFolderId: matched.folderId,
      source: 'project-context-space-active-file',
      treeSource: 'project-context-space-tree',
    }),
    path: activeFile.path,
    projectRoot: input.space.projectRoot,
    repoId: matched.repoId,
    role: 'active-file',
    sourceFolder: matched.relativePath,
  });

  return {
    activeFileProvided: true,
    errors: [],
    fact: {
      folder: matched,
      ref,
      summary: {
        exists,
        path: activeFile.path,
        ref,
        role: 'active-file',
      },
    },
  };
}

function createProjectTreeFacts(input: {
  activeFile?: ActiveFileFact;
  includeStructuralHotspots?: boolean;
  maxTreeEntries: number;
  space: SpaceResolution;
}): {
  errors: ProjectContextQueryError[];
  hotspots: HotspotSummary[];
  tree?: { roots: PathSummary[]; truncated: boolean };
  treeRefs: ProjectContextRef[];
} {
  const errors: ProjectContextQueryError[] = [];
  const sortedFolders = [...input.space.folders].sort(compareFolders);
  const selectedFolders = sortedFolders.slice(0, input.maxTreeEntries);
  const truncated = sortedFolders.length > selectedFolders.length;
  if (truncated) {
    errors.push(
      createQueryError({
        code: 'query-unavailable',
        message: `space project tree sampling was truncated at ${input.maxTreeEntries} roots.`,
        retryable: false,
      })
    );
  }

  const roots = dedupeBy(
    [
      ...selectedFolders.map((folder) =>
        createProjectContextRepoSpacePathSummary({
          exists: !folder.missing,
          metadata: createProjectContextRepoSpaceMetadata({
            childCount: folder.childCount,
            nodeType: 'repo',
            partOf: input.space.projectId,
            projectScopeFolderId: folder.folderId,
            source: 'project-context-space-tree',
          }),
          path: folder.relativePath,
          projectRoot: input.space.projectRoot,
          repoId: folder.repoId,
          role: folder.role === 'primary-source' ? 'primary-repo' : 'repo',
          sourceFolder: folder.relativePath,
        })
      ),
      input.activeFile?.summary,
    ].filter((item): item is PathSummary => item !== undefined),
    (root) => root.ref?.id ?? root.path
  ).sort(comparePathSummaries);
  const hotspots =
    input.includeStructuralHotspots === false
      ? []
      : roots
          .filter((root) => root.ref && root.exists !== false)
          .map((root) => ({
            reason: `${root.path} has ${Number(root.ref?.metadata?.childCount ?? 0)} top-level project-space entries.`,
            ref: root.ref as ProjectContextRef,
            score: Number(root.ref?.metadata?.childCount ?? 0),
          }))
          .filter((hotspot) => hotspot.score > 0)
          .sort(
            (left, right) => right.score - left.score || left.ref.id.localeCompare(right.ref.id)
          )
          .slice(0, HOTSPOT_LIMIT);

  return {
    errors,
    hotspots,
    tree: {
      roots,
      truncated,
    },
    treeRefs: roots.map((root) => root.ref).filter((ref): ref is ProjectContextRef => Boolean(ref)),
  };
}

async function normalizeSourceRefs(input: {
  sourceRefs?: readonly string[];
  space: SpaceResolution;
}): Promise<{ refs: ProjectContextRef[]; errors: ProjectContextQueryError[] }> {
  const refs: ProjectContextRef[] = [];
  const errors: ProjectContextQueryError[] = [];
  for (const sourceRef of input.sourceRefs ?? []) {
    const normalized = normalizeRelativePath(sourceRef.replace(/^\.\//, ''));
    const qualified = resolveQualifiedSourceRef(normalized, input.space.folders);
    if (qualified) {
      refs.push(createSourceRef(qualified.folder, qualified.relativePath, input.space.projectRoot));
      continue;
    }

    const matches: { folder: SpaceFolder; relativePath: string }[] = [];
    for (const folder of input.space.folders.filter((candidate) => !candidate.missing)) {
      const absolutePath = path.join(folder.absolutePath, normalized);
      if (await pathExists(absolutePath)) {
        matches.push({ folder, relativePath: normalized });
      }
    }
    if (matches.length === 1) {
      refs.push(
        createSourceRef(matches[0].folder, matches[0].relativePath, input.space.projectRoot)
      );
      continue;
    }
    errors.push(
      createQueryError({
        code: matches.length > 1 ? 'ambiguous' : 'not-found',
        message:
          matches.length > 1
            ? `space sourceRef is ambiguous across repos and must be repo-qualified: ${sourceRef}`
            : `space sourceRef was not found in any source folder: ${sourceRef}`,
        path: sourceRef,
        retryable: false,
      })
    );
  }
  return { errors, refs: dedupeRefs(refs) };
}

function resolveQualifiedSourceRef(
  sourceRef: string,
  folders: readonly SpaceFolder[]
): { folder: SpaceFolder; relativePath: string } | undefined {
  for (const folder of folders.filter((candidate) => !candidate.missing)) {
    const prefixes = [folder.displayName, folder.repoId, folder.folderId]
      .filter(Boolean)
      .map((value) => normalizeRelativePath(value));
    for (const prefix of prefixes) {
      if (sourceRef === prefix) {
        return { folder, relativePath: '.' };
      }
      if (sourceRef.startsWith(`${prefix}/`)) {
        return {
          folder,
          relativePath: normalizeRelativePath(sourceRef.slice(prefix.length + 1)),
        };
      }
    }
  }
  return undefined;
}

function createSourceRef(
  folder: SpaceFolder,
  relativePath: string,
  projectRoot: string
): ProjectContextRef {
  const projectRelativePath = normalizeRelativePath(path.join(folder.relativePath, relativePath));
  return createProjectContextRepoSpacePathRef({
    exists: true,
    metadata: createProjectContextRepoSpaceMetadata({
      projectScopeFolderId: folder.folderId,
      source: 'project-context-space-source-ref',
    }),
    path: projectRelativePath,
    projectRoot,
    repoId: folder.repoId,
    role: relativePath === '.' ? 'source-folder' : 'source-ref',
    sourceFolder: folder.relativePath,
  });
}

function createProjectContextSpaceRef(input: {
  projectId: string;
  projectRoot: string;
  projectScopeId?: string;
}): ProjectContextRef {
  return {
    id: `space:${encodeRefPart(input.projectId)}`,
    kind: 'space',
    label: input.projectId,
    level: 'space',
    metadata: createProjectContextRepoSpaceMetadata({
      projectScopeId: input.projectScopeId,
      source: 'project-context-space',
    }),
    scope: {
      projectRoot: input.projectRoot,
    },
  };
}

function createSpaceFailure(
  error: ProjectContextQueryError,
  errors: readonly ProjectContextQueryError[]
): ProjectContextHandlerResult {
  return {
    data: {
      available: false,
      kind: 'space',
      nextRefs: [],
      reason: error.message,
    } satisfies ProjectContextUnavailableData,
    errors: [...errors, error],
    refs: [],
  };
}

function createDuplicateErrors(folders: readonly SpaceFolder[]): ProjectContextQueryError[] {
  const errors: ProjectContextQueryError[] = [];
  const repoIds = new Map<string, SpaceFolder[]>();
  const paths = new Map<string, SpaceFolder[]>();
  for (const folder of folders) {
    const repoMatches = repoIds.get(folder.repoId) ?? [];
    repoMatches.push(folder);
    repoIds.set(folder.repoId, repoMatches);
    const pathMatches = paths.get(folder.relativePath) ?? [];
    pathMatches.push(folder);
    paths.set(folder.relativePath, pathMatches);
  }
  for (const [repoId, matches] of repoIds) {
    if (matches.length > 1) {
      errors.push(
        createQueryError({
          code: 'ambiguous',
          message: `space repo id is duplicated and requires repo-qualified refs: ${repoId}`,
          retryable: false,
        })
      );
    }
  }
  for (const [pathValue, matches] of paths) {
    if (matches.length > 1) {
      errors.push(
        createQueryError({
          code: 'ambiguous',
          message: `space source folder path is duplicated: ${pathValue}`,
          path: pathValue,
          retryable: false,
        })
      );
    }
  }
  return errors;
}

function readExplicitFolderInputs(
  projectRoot: string,
  sourceFolders: readonly unknown[]
): ExplicitFolderInput[] {
  const folders: ExplicitFolderInput[] = [];
  sourceFolders.forEach((item, index) => {
    const folder = readRecord(item);
    const pathValue = readString(folder?.path ?? folder?.sourceFolder ?? folder?.root);
    if (!pathValue) {
      return;
    }
    const absolutePath = path.isAbsolute(pathValue)
      ? path.resolve(pathValue)
      : path.resolve(projectRoot, pathValue);
    const displayName =
      readString(folder?.displayName ?? folder?.name) ?? path.basename(absolutePath);
    folders.push({
      displayName,
      folderId:
        readString(folder?.id ?? folder?.folderId) ?? createRepoIdFromPath(pathValue, absolutePath),
      path: absolutePath,
      realpath: readString(folder?.realpath),
      repositoryId: readString(folder?.repositoryId ?? folder?.repoId) ?? displayName,
      role: readString(folder?.role) ?? (index === 0 ? 'primary-source' : 'source'),
      state: readString(folder?.state) ?? 'active',
      source: 'payload.sourceFolders',
    });
  });
  return folders;
}

interface ExplicitFolderInput {
  displayName?: string;
  folderId: string;
  path: string;
  realpath?: string;
  repositoryId?: string;
  role?: string;
  source?: string;
  state?: string;
}

function findFolderForRelativePath(
  folders: readonly SpaceFolder[],
  relativePath: string
): SpaceFolder | undefined {
  const normalized = normalizeRelativePath(relativePath);
  return folders
    .filter(
      (folder) => !folder.missing && isSameOrInsideRelativePath(normalized, folder.relativePath)
    )
    .sort((left, right) => right.relativePath.length - left.relativePath.length)[0];
}

async function countTopLevelChildren(absolutePath: string): Promise<number> {
  return (await readDirectoryEntries(absolutePath)).filter(
    (entry) => !entry.name.startsWith('.') && !TREE_EXCLUDE_DIRS.has(entry.name)
  ).length;
}

async function readDirectoryEntries(directoryPath: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function readRealpath(targetPath: string): Promise<string | undefined> {
  try {
    return await fs.realpath(path.resolve(targetPath));
  } catch {
    return undefined;
  }
}

function normalizeContainedProjectPath(
  projectRoot: string,
  value: string
): { ok: true; path: string } | { ok: false } {
  if (hasParentTraversal(value)) {
    return { ok: false };
  }
  const absolutePath = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(projectRoot, value);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (!relativePath) {
    return { ok: true, path: '.' };
  }
  if (!isContainedRelativePath(relativePath)) {
    return { ok: false };
  }
  return { ok: true, path: normalizeRelativePath(relativePath) };
}

function createProjectId(projectRoot: string): string {
  return `root:${path.basename(projectRoot)}`;
}

function createRepoIdFromPath(relativeRoot: string, absoluteRoot: string): string {
  const normalized = normalizeRelativePath(relativeRoot);
  return normalized === '.' ? path.basename(absoluteRoot) : normalized.replaceAll('/', '-');
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

function normalizeRelativePath(value: string): string {
  const normalized = value.split(path.sep).join('/').replaceAll('\\', '/');
  return normalized === '' ? '.' : normalized.replace(/\/+/g, '/');
}

function hasParentTraversal(value: string): boolean {
  return normalizeRelativePath(value).split('/').includes('..');
}

function isContainedRelativePath(value: string): boolean {
  return !value.startsWith('..') && !path.isAbsolute(value);
}

function isInsidePath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || isContainedRelativePath(relative);
}

function isSameOrInsideRelativePath(candidatePath: string, rootPath: string): boolean {
  if (rootPath === '.') {
    return true;
  }
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || isContainedRelativePath(relative);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map(readString).filter((item): item is string => item !== undefined);
}

function readUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readProjectContextRef(value: unknown): ProjectContextRef | undefined {
  return isProjectContextRef(value) ? value : undefined;
}

function isProjectContextRef(value: unknown): value is ProjectContextRef {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    isRecord(value.scope)
  );
}

function isRecord(value: unknown): value is Record<string, ProjectContextJson | unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function dedupeRefs(refs: readonly (ProjectContextRef | undefined)[]): ProjectContextRef[] {
  return dedupeBy(
    refs.filter((ref): ref is ProjectContextRef => ref !== undefined),
    (ref) => ref.id
  ).sort((left, right) => {
    const kindOrder = left.kind.localeCompare(right.kind);
    return kindOrder || left.id.localeCompare(right.id);
  });
}

function dedupeErrors(errors: readonly ProjectContextQueryError[]): ProjectContextQueryError[] {
  return dedupeBy(errors, (error) => `${error.code}:${error.path ?? ''}:${error.message}`).sort(
    (left, right) => left.message.localeCompare(right.message)
  );
}

function dedupeBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function compareRepos(left: RepoSummary, right: RepoSummary): number {
  return left.root.localeCompare(right.root) || left.id.localeCompare(right.id);
}

function compareFolders(left: SpaceFolder, right: SpaceFolder): number {
  return (
    left.relativePath.localeCompare(right.relativePath) || left.repoId.localeCompare(right.repoId)
  );
}

function comparePathSummaries(left: PathSummary, right: PathSummary): number {
  return (
    left.path.localeCompare(right.path) || (left.ref?.id ?? '').localeCompare(right.ref?.id ?? '')
  );
}

function encodeRefPart(value: string): string {
  return encodeURIComponent(value.replaceAll('\\', '/'));
}
