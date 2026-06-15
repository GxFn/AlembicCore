import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { type ConflictResult, getDiscovererRegistry } from '../../../core/discovery/index.js';
import type {
  DiscoveredFile,
  DiscoveredTarget,
} from '../../../core/discovery/ProjectDiscoverer.js';
import { createSourceScanExcludeDirs } from '../../../core/discovery/SourceScanExclusions.js';
import type {
  BuildSystemSummary,
  CommandSummary,
  ConfigFileSummary,
  EntrypointSummary,
  LanguageSummary,
  PackageSummary,
  PackageSystemSummary,
  PathSummary,
  ProjectContextJson,
  ProjectContextMetadata,
  ProjectContextQueryError,
  ProjectContextRef,
  ProjectContextRefScope,
  ProjectContextScope,
  ProjectContextUnavailableData,
  ProjectMap,
  RepoContext,
  RepoSummary,
  TargetSummary,
} from '../../../domain/project-context/index.js';
import { LanguageService } from '../../../shared/LanguageService.js';
import {
  readProjectScopeFromWorkspaceConfig,
  resolveProjectScopeForFolder,
} from '../../../shared/ProjectScope.js';
import type {
  CanonicalProjectContextRequest,
  ProjectContextHandler,
  ProjectContextHandlerResult,
} from '../interface/contracts.js';
import { mapProjectContextHandler } from '../map/index.js';
import {
  createProjectContextMapRepoSummary,
  type ProjectContextMapRepoSummary,
  selectProjectContextMapRef,
} from '../shared/map-repo/index.js';
import { createProjectContextRepoSpaceRepoRef } from '../shared/repo-space/index.js';
import { createProjectContextFileRef } from '../shared/sourceSlice-fileSymbols/index.js';
import type { RepoRequestPayload } from './contracts.js';

const SOURCE_SCAN_EXCLUDE_DIRS = createSourceScanExcludeDirs();
const DEFAULT_MAX_FILES = 2000;
const TOP_AREA_LIMIT = 12;

const CONFIG_FILE_KINDS: Record<string, string> = {
  'biome.json': 'biome',
  'build.gradle': 'gradle',
  'Cargo.toml': 'cargo',
  'go.mod': 'go',
  'jest.config.cjs': 'jest',
  'jest.config.js': 'jest',
  'package.json': 'package-manifest',
  'Package.swift': 'swift-package',
  'pnpm-workspace.yaml': 'pnpm-workspace',
  'pyproject.toml': 'python-package',
  'rollup.config.js': 'rollup',
  'rollup.config.mjs': 'rollup',
  'rollup.config.ts': 'rollup',
  'tsconfig.json': 'typescript',
  'tsup.config.ts': 'tsup',
  'vite.config.js': 'vite',
  'vite.config.mjs': 'vite',
  'vite.config.ts': 'vite',
  'vitest.config.js': 'vitest',
  'vitest.config.mjs': 'vitest',
  'vitest.config.ts': 'vitest',
  'webpack.config.js': 'webpack',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
  'package-lock.json': 'npm',
};

const SOURCE_ROOT_CANDIDATES = [
  'src',
  'lib',
  'app',
  'Sources',
  'cmd',
  'internal',
  'pkg',
  'packages',
  'test',
  'tests',
  'scripts',
  'bin',
];

const HIGH_PRIORITY_ENTRY_FILES = [
  'src/index.ts',
  'src/index.tsx',
  'src/main.ts',
  'src/main.tsx',
  'src/project-context.ts',
  'index.ts',
  'index.js',
  'main.ts',
  'main.js',
  'bin/index.ts',
  'bin/index.js',
];

interface RepoIdentity {
  absoluteRoot: string;
  projectRoot: string;
  relativeRoot: string;
  repo: RepoSummary;
  repoId: string;
  repoName: string;
  sourceFolder?: string;
}

interface RepoManifestFacts {
  packageJson?: PackageJsonRecord;
  packageJsonRef?: ProjectContextRef;
  configFiles: ConfigFileSummary[];
  errors: ProjectContextQueryError[];
}

interface RepoContextFacts {
  buildSystems: BuildSystemSummary[];
  commands: CommandSummary[];
  configFiles: ConfigFileSummary[];
  entrypoints: EntrypointSummary[];
  errors: ProjectContextQueryError[];
  localPackages: PackageSummary[];
  mapSummary?: ProjectContextMapRepoSummary;
  packageSystems: PackageSystemSummary[];
  repo: RepoIdentity;
  sourceFiles: SourceFileFact[];
  sourceRoots: PathSummary[];
  targets: TargetSummary[];
  topAreas: PathSummary[];
}

interface DiscoveryFacts {
  conflict?: ConflictResult;
  discovererId?: string;
  discovererName?: string;
  discovererConfidence?: number;
  discovererReason?: string;
  files: SourceFileFact[];
  targets: DiscoveredTarget[];
  errors: ProjectContextQueryError[];
  truncated: boolean;
}

interface SourceFileFact {
  filePath: string;
  language: string;
  targetName?: string;
}

type PackageJsonRecord = Record<string, unknown>;

export const repoProjectContextHandler: ProjectContextHandler = async (
  request
): Promise<ProjectContextHandlerResult> => {
  const payload = readRepoPayload(request.payload);
  const repoIdentity = await resolveRepoIdentity({
    payload,
    projectRoot: request.scope.projectRoot,
    repoId: request.scope.repoId,
    sourceFolder: request.scope.sourceFolder,
  });
  if (!repoIdentity.ok) {
    return createRepoFailure(repoIdentity.error, repoIdentity.errors);
  }

  const facts = await collectRepoContextFacts({
    initialErrors: repoIdentity.errors,
    payload,
    project: request.project,
    repo: repoIdentity.identity,
    requestScope: request.scope,
  });
  const data = createRepoContextData(facts);

  return {
    data,
    errors: facts.errors.length > 0 ? dedupeErrors(facts.errors) : undefined,
    refs: dedupeRefs([facts.repo.repo.ref, ...data.nextRefs]),
  };
};

async function collectRepoContextFacts(input: {
  initialErrors: readonly ProjectContextQueryError[];
  payload: RepoRequestPayload;
  project: CanonicalProjectContextRequest['project'];
  repo: RepoIdentity;
  requestScope: ProjectContextScope;
}): Promise<RepoContextFacts> {
  const errors = [...input.initialErrors];
  const manifestFacts = await readRepoManifestFacts(input.repo);
  errors.push(...manifestFacts.errors);

  const sourceFacts = await collectRepoSourceFacts({
    maxFiles: input.payload.maxFiles,
    repo: input.repo,
  });
  errors.push(...sourceFacts.errors);

  const packageSystems = createPackageSystemSummaries({
    configFiles: manifestFacts.configFiles,
    packageJsonRef: manifestFacts.packageJsonRef,
  });
  if (packageSystems.length === 0) {
    errors.push(createMissingPackageMetadataError());
  }

  const buildSystems = createBuildSystemSummaries({
    configFiles: manifestFacts.configFiles,
    packageJson: manifestFacts.packageJson,
    packageJsonRef: manifestFacts.packageJsonRef,
  });
  const targets = createTargetSummaries({
    discovery: sourceFacts.discovery,
    repo: input.repo,
    sourceFiles: sourceFacts.sourceFiles,
  });
  const localPackages = createLocalPackageSummaries({
    packageJson: manifestFacts.packageJson,
    packageJsonRef: manifestFacts.packageJsonRef,
    repo: input.repo,
    targets: sourceFacts.discovery.targets,
  });
  const entrypoints =
    input.payload.includeEntrypoints === false
      ? []
      : await createEntrypointSummaries({ manifestFacts, repo: input.repo });
  const commands =
    input.payload.includeCommands === false
      ? []
      : createCommandSummaries({
          packageJson: manifestFacts.packageJson,
          packageJsonRef: manifestFacts.packageJsonRef,
        });
  const topAreas =
    input.payload.includeTopAreas === false
      ? []
      : await createTopAreaSummaries({
          configFiles: manifestFacts.configFiles,
          localPackages,
          repo: input.repo,
          sourceRoots: sourceFacts.sourceRoots,
          targets,
        });
  const mapFacts = await createRepoMapFacts({
    payload: input.payload,
    project: input.project,
    repo: input.repo,
    requestScope: input.requestScope,
  });
  errors.push(...mapFacts.errors);

  return {
    buildSystems,
    commands,
    configFiles: manifestFacts.configFiles,
    entrypoints,
    errors,
    localPackages,
    mapSummary: mapFacts.summary,
    packageSystems,
    repo: input.repo,
    sourceFiles: sourceFacts.sourceFiles,
    sourceRoots: sourceFacts.sourceRoots,
    targets,
    topAreas,
  };
}

async function collectRepoSourceFacts(input: { repo: RepoIdentity; maxFiles?: number }): Promise<{
  discovery: DiscoveryFacts;
  errors: ProjectContextQueryError[];
  sourceFiles: SourceFileFact[];
  sourceRoots: PathSummary[];
}> {
  const errors: ProjectContextQueryError[] = [];
  const discovery = await collectDiscoveryFacts({
    maxFiles: input.maxFiles ?? DEFAULT_MAX_FILES,
    repo: input.repo,
  });
  errors.push(...discovery.errors);

  const sourceRoots = await createSourceRootSummaries({
    repo: input.repo,
    targets: discovery.targets,
  });
  const fallbackFiles =
    discovery.files.length > 0
      ? { errors: [], files: [] }
      : await collectFallbackSourceFiles({
          maxFiles: input.maxFiles,
          repo: input.repo,
          sourceRoots,
        });
  errors.push(...fallbackFiles.errors);

  return {
    discovery,
    errors,
    sourceFiles: discovery.files.length > 0 ? discovery.files : fallbackFiles.files,
    sourceRoots,
  };
}

function createRepoContextData(facts: RepoContextFacts): RepoContext {
  return {
    buildSystems: facts.buildSystems,
    commands: facts.commands,
    configFiles: facts.configFiles,
    entrypoints: facts.entrypoints,
    languages: createLanguageSummaries(facts.sourceFiles),
    localPackages: facts.localPackages,
    mapRef: facts.mapSummary?.mapRef,
    mapSummary: facts.mapSummary,
    nextRefs: createNextRefs(facts),
    packageSystems: facts.packageSystems,
    repo: facts.repo.repo,
    sourceRoots: facts.sourceRoots,
    targets: facts.targets,
    topAreas: facts.topAreas,
  };
}

function createMissingPackageMetadataError(): ProjectContextQueryError {
  return createQueryError({
    code: 'query-unavailable',
    message: 'repo package metadata is unavailable because no package manifest was found.',
    retryable: false,
  });
}

function readRepoPayload(payload: unknown): RepoRequestPayload {
  if (!isRecord(payload)) {
    return {};
  }
  return {
    includeCommands: readBoolean(payload.includeCommands),
    includeEntrypoints: readBoolean(payload.includeEntrypoints),
    includeMapSummary: readBoolean(payload.includeMapSummary),
    includeTopAreas: readBoolean(payload.includeTopAreas),
    maxFiles: readPositiveInteger(payload.maxFiles),
    modules: readUnknownArray(payload.modules),
    moduleSeeds: readUnknownArray(payload.moduleSeeds),
    ref: readProjectContextRef(payload.ref),
    repoId: readString(payload.repoId),
    repoName: readString(payload.repoName),
    repoRoot: readString(payload.repoRoot),
  };
}

async function resolveRepoIdentity(input: {
  projectRoot: string;
  sourceFolder?: string;
  repoId?: string;
  payload: RepoRequestPayload;
}): Promise<
  | { ok: true; identity: RepoIdentity; errors: ProjectContextQueryError[] }
  | { ok: false; error: ProjectContextQueryError; errors: ProjectContextQueryError[] }
> {
  const projectRoot = path.resolve(input.projectRoot);
  const projectRootRealpath = await readRealpath(projectRoot);
  if (!projectRootRealpath) {
    const error = createQueryError({
      code: 'invalid-scope',
      message: 'ProjectContext scope.projectRoot must exist before repo can read manifests.',
      path: projectRoot,
      retryable: false,
    });
    return { error, errors: [], ok: false };
  }

  const requestedRepoRoot =
    input.payload.repoRoot ??
    input.payload.ref?.scope.sourceFolder ??
    input.payload.ref?.scope.filePath ??
    input.sourceFolder ??
    '.';
  const normalizedRepoRoot = normalizeContainedProjectPath(projectRoot, requestedRepoRoot);
  if (!normalizedRepoRoot.ok) {
    const error = createQueryError({
      code: 'outside-scope',
      message: 'repo payload.repoRoot/ref must stay inside scope.projectRoot.',
      path: requestedRepoRoot,
      retryable: false,
    });
    return { error, errors: [], ok: false };
  }

  const absoluteRoot = path.resolve(projectRoot, normalizedRepoRoot.path);
  const rootRealpath = await readRealpath(absoluteRoot);
  if (!rootRealpath) {
    const error = createQueryError({
      code: 'not-found',
      message: `repo root was not found: ${normalizedRepoRoot.path}`,
      path: normalizedRepoRoot.path,
      retryable: false,
    });
    return { error, errors: [], ok: false };
  }
  if (!isInsidePath(projectRootRealpath, rootRealpath)) {
    const error = createQueryError({
      code: 'outside-scope',
      message: 'repo root realpath must stay inside scope.projectRoot.',
      path: normalizedRepoRoot.path,
      retryable: false,
    });
    return { error, errors: [], ok: false };
  }

  const projectScope = readProjectScopeFromWorkspaceConfig(projectRoot);
  const scopeResolution = projectScope
    ? resolveProjectScopeForFolder(projectScope, absoluteRoot, { folderRealpath: rootRealpath })
    : null;
  const scopeFolder = scopeResolution?.currentFolder ?? null;
  const repoId =
    input.payload.repoId ??
    input.repoId ??
    scopeFolder?.repositoryId ??
    scopeFolder?.id ??
    createRepoIdFromPath(normalizedRepoRoot.path, absoluteRoot);
  const repoName =
    input.payload.repoName ??
    scopeFolder?.displayName ??
    readString(input.payload.ref?.label) ??
    path.basename(absoluteRoot) ??
    repoId;
  const repoRef = createProjectContextRepoSpaceRepoRef({
    metadata: {
      projectScopeFolderId: scopeFolder?.id ?? null,
      source: 'project-context-repo-scope',
    },
    projectRoot,
    repoId,
    repoName,
    sourceFolder: normalizedRepoRoot.path === '.' ? input.sourceFolder : normalizedRepoRoot.path,
  });

  return {
    errors:
      scopeResolution && !scopeResolution.matched
        ? [
            createQueryError({
              code: 'query-unavailable',
              message: 'repo project-scope folder could not be matched; using single-repo scope.',
              path: normalizedRepoRoot.path,
              retryable: false,
            }),
          ]
        : [],
    identity: {
      absoluteRoot,
      projectRoot,
      relativeRoot: normalizedRepoRoot.path,
      repo: {
        id: repoId,
        name: repoName,
        ref: repoRef,
        root: normalizedRepoRoot.path,
      },
      repoId,
      repoName,
      sourceFolder: normalizedRepoRoot.path === '.' ? input.sourceFolder : normalizedRepoRoot.path,
    },
    ok: true,
  };
}

async function readRepoManifestFacts(repo: RepoIdentity): Promise<RepoManifestFacts> {
  const configFiles: ConfigFileSummary[] = [];
  const errors: ProjectContextQueryError[] = [];
  for (const [filePath, kind] of Object.entries(CONFIG_FILE_KINDS)) {
    const absolutePath = path.join(repo.absoluteRoot, filePath);
    if (!(await pathExists(absolutePath))) {
      continue;
    }
    configFiles.push({
      kind,
      path: filePath,
      ref: createProjectContextFileRef({
        filePath: toRepoFilePath(repo, filePath),
        projectRoot: repo.projectRoot,
        repoId: repo.repoId,
        sourceFolder: repo.sourceFolder,
      }),
    });
  }

  const packageJsonRef = configFiles.find((file) => file.path === 'package.json')?.ref;
  const packageJsonPath = path.join(repo.absoluteRoot, 'package.json');
  const packageJsonResult = await readJsonObject(packageJsonPath, 'package.json');
  if (packageJsonResult.error) {
    errors.push(packageJsonResult.error);
  }

  return {
    configFiles: configFiles.sort(compareConfigFiles),
    errors,
    packageJson: packageJsonResult.value,
    packageJsonRef,
  };
}

async function collectDiscoveryFacts(input: {
  repo: RepoIdentity;
  maxFiles: number;
}): Promise<DiscoveryFacts> {
  const registry = getDiscovererRegistry();
  const errors: ProjectContextQueryError[] = [];
  let conflict: ConflictResult | undefined;
  try {
    conflict = await registry.analyzeConflict(input.repo.absoluteRoot);
  } catch (error) {
    errors.push(
      createQueryError({
        code: 'query-unavailable',
        message: `repo discoverer conflict analysis failed: ${readErrorMessage(error)}`,
        retryable: true,
      })
    );
  }

  if (conflict?.ambiguous) {
    errors.push(
      createQueryError({
        code: 'ambiguous',
        message: conflict.reason ?? 'repo discoverer selection is ambiguous.',
        retryable: false,
      })
    );
    return { conflict, errors, files: [], targets: [], truncated: false };
  }

  const selectedId = conflict?.recommended?.discovererId;
  const selected = selectedId
    ? registry.getAll().find((candidate) => candidate.id === selectedId)
    : await registry.detect(input.repo.absoluteRoot);
  if (!selected) {
    errors.push(
      createQueryError({
        code: 'query-unavailable',
        message: 'repo discoverer selection did not return a usable discoverer.',
        retryable: false,
      })
    );
    return { conflict, errors, files: [], targets: [], truncated: false };
  }

  try {
    await selected.load(input.repo.absoluteRoot);
  } catch (error) {
    errors.push(
      createQueryError({
        code: 'query-unavailable',
        message: `repo discoverer load failed for ${selected.id}: ${readErrorMessage(error)}`,
        retryable: true,
      })
    );
    return {
      conflict,
      discovererConfidence: conflict?.recommended?.confidence,
      discovererId: selected.id,
      discovererName: selected.displayName,
      discovererReason: conflict?.recommended?.displayName,
      errors,
      files: [],
      targets: [],
      truncated: false,
    };
  }

  const targets = await readDiscovererTargets(selected, errors);
  const sourceFiles: SourceFileFact[] = [];
  let truncated = false;
  for (const target of targets) {
    const files = await readTargetFiles(selected, target, errors);
    for (const file of files) {
      const sourceFile = normalizeDiscoveredFile(input.repo, target, file);
      if (!sourceFile) {
        continue;
      }
      sourceFiles.push(sourceFile);
      if (sourceFiles.length >= input.maxFiles) {
        truncated = true;
        break;
      }
    }
    if (truncated) {
      break;
    }
  }

  if (truncated) {
    errors.push(
      createQueryError({
        code: 'query-unavailable',
        message: `repo source file collection was truncated at ${input.maxFiles} files.`,
        retryable: false,
      })
    );
  }

  return {
    conflict,
    discovererConfidence: conflict?.recommended?.confidence,
    discovererId: selected.id,
    discovererName: selected.displayName,
    discovererReason: conflict?.recommended?.displayName,
    errors,
    files: dedupeSourceFiles(sourceFiles),
    targets,
    truncated,
  };
}

async function readDiscovererTargets(
  discoverer: { listTargets(): Promise<DiscoveredTarget[]>; id: string },
  errors: ProjectContextQueryError[]
): Promise<DiscoveredTarget[]> {
  try {
    return (await discoverer.listTargets()).sort(compareDiscoveredTargets);
  } catch (error) {
    errors.push(
      createQueryError({
        code: 'query-unavailable',
        message: `repo discoverer target listing failed for ${discoverer.id}: ${readErrorMessage(
          error
        )}`,
        retryable: true,
      })
    );
    return [];
  }
}

async function readTargetFiles(
  discoverer: {
    getTargetFiles(target: DiscoveredTarget): Promise<DiscoveredFile[]>;
    id: string;
  },
  target: DiscoveredTarget,
  errors: ProjectContextQueryError[]
): Promise<DiscoveredFile[]> {
  try {
    return await discoverer.getTargetFiles(target);
  } catch (error) {
    errors.push(
      createQueryError({
        code: 'query-unavailable',
        message: `repo discoverer file collection failed for ${target.name}: ${readErrorMessage(
          error
        )}`,
        retryable: true,
      })
    );
    return [];
  }
}

function normalizeDiscoveredFile(
  repo: RepoIdentity,
  target: DiscoveredTarget,
  file: DiscoveredFile
): SourceFileFact | undefined {
  const absolutePath = path.resolve(file.path);
  const relativePath = path.relative(repo.absoluteRoot, absolutePath);
  if (!isContainedRelativePath(relativePath)) {
    const targetRelativePath = normalizeRelativePath(file.relativePath);
    const targetRoot = normalizeTargetPath(repo, target);
    if (!targetRoot) {
      return undefined;
    }
    return {
      filePath: normalizeRelativePath(path.join(targetRoot, targetRelativePath)),
      language: normalizeLanguage(file.language, targetRelativePath),
      targetName: target.name,
    };
  }
  return {
    filePath: normalizeRelativePath(relativePath),
    language: normalizeLanguage(file.language, relativePath),
    targetName: target.name,
  };
}

async function createSourceRootSummaries(input: {
  repo: RepoIdentity;
  targets: readonly DiscoveredTarget[];
}): Promise<PathSummary[]> {
  const paths = new Set<string>();
  for (const candidate of SOURCE_ROOT_CANDIDATES) {
    if (await pathExists(path.join(input.repo.absoluteRoot, candidate))) {
      paths.add(candidate);
    }
  }
  for (const target of input.targets) {
    const targetPath = normalizeTargetPath(input.repo, target);
    if (!targetPath || targetPath === '.') {
      continue;
    }
    const sourceChild = path.join(input.repo.absoluteRoot, targetPath, 'src');
    paths.add(
      (await pathExists(sourceChild))
        ? normalizeRelativePath(path.join(targetPath, 'src'))
        : targetPath
    );
  }
  return [...paths].sort().map((pathValue) =>
    createPathSummary({
      metadata: { source: 'project-context-repo-source-root' },
      path: pathValue,
      repo: input.repo,
      role: 'source-root',
    })
  );
}

async function collectFallbackSourceFiles(input: {
  repo: RepoIdentity;
  sourceRoots: readonly PathSummary[];
  maxFiles?: number;
}): Promise<{ files: SourceFileFact[]; errors: ProjectContextQueryError[] }> {
  const maxFiles = input.maxFiles ?? DEFAULT_MAX_FILES;
  const files: SourceFileFact[] = [];
  const roots = input.sourceRoots.length > 0 ? input.sourceRoots.map((item) => item.path) : ['.'];
  for (const root of roots) {
    await collectSourceFilesUnder({
      absoluteRoot: path.join(input.repo.absoluteRoot, root),
      files,
      maxFiles,
      repoRoot: input.repo.absoluteRoot,
    });
    if (files.length >= maxFiles) {
      return {
        errors: [
          createQueryError({
            code: 'query-unavailable',
            message: `repo fallback source file collection was truncated at ${maxFiles} files.`,
            retryable: false,
          }),
        ],
        files: dedupeSourceFiles(files),
      };
    }
  }
  return { errors: [], files: dedupeSourceFiles(files) };
}

async function collectSourceFilesUnder(input: {
  absoluteRoot: string;
  repoRoot: string;
  files: SourceFileFact[];
  maxFiles: number;
}): Promise<void> {
  const pending = [input.absoluteRoot];
  while (pending.length > 0 && input.files.length < input.maxFiles) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    const entries = await readDirectoryEntries(current);
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SOURCE_SCAN_EXCLUDE_DIRS.has(entry.name)) {
          continue;
        }
        pending.push(absolutePath);
        continue;
      }
      if (!entry.isFile() || !LanguageService.isSourceExt(path.extname(entry.name))) {
        continue;
      }
      const relativePath = normalizeRelativePath(path.relative(input.repoRoot, absolutePath));
      if (!isContainedRelativePath(relativePath)) {
        continue;
      }
      input.files.push({
        filePath: relativePath,
        language: normalizeLanguage(undefined, relativePath),
      });
      if (input.files.length >= input.maxFiles) {
        break;
      }
    }
  }
}

function createPackageSystemSummaries(input: {
  configFiles: readonly ConfigFileSummary[];
  packageJsonRef?: ProjectContextRef;
}): PackageSystemSummary[] {
  const systems: PackageSystemSummary[] = [];
  if (input.packageJsonRef) {
    systems.push({ kind: 'node/package-json', manifestRefs: [input.packageJsonRef] });
  }
  for (const file of input.configFiles) {
    if (file.path === 'package-lock.json' && file.ref) {
      systems.push({ kind: 'npm', manifestRefs: [file.ref] });
    }
    if (file.path === 'pnpm-lock.yaml' && file.ref) {
      systems.push({ kind: 'pnpm', manifestRefs: [file.ref] });
    }
    if (file.path === 'pnpm-workspace.yaml' && file.ref) {
      systems.push({ kind: 'pnpm-workspace', manifestRefs: [file.ref] });
    }
    if (file.path === 'yarn.lock' && file.ref) {
      systems.push({ kind: 'yarn', manifestRefs: [file.ref] });
    }
  }
  return systems.sort(comparePackageSystems);
}

function createBuildSystemSummaries(input: {
  configFiles: readonly ConfigFileSummary[];
  packageJson?: PackageJsonRecord;
  packageJsonRef?: ProjectContextRef;
}): BuildSystemSummary[] {
  const byKind = new Map<string, ProjectContextRef[]>();
  for (const file of input.configFiles) {
    if (!file.ref) {
      continue;
    }
    const buildKind = readBuildSystemKind(file);
    if (!buildKind) {
      continue;
    }
    const refs = byKind.get(buildKind) ?? [];
    refs.push(file.ref);
    byKind.set(buildKind, refs);
  }
  if (input.packageJsonRef && Object.keys(readPackageScripts(input.packageJson)).length > 0) {
    const refs = byKind.get('node-scripts') ?? [];
    refs.push(input.packageJsonRef);
    byKind.set('node-scripts', refs);
  }
  return [...byKind.entries()]
    .map(([kind, refs]) => ({ configRefs: dedupeRefs(refs), kind }))
    .sort((left, right) => left.kind.localeCompare(right.kind));
}

function readBuildSystemKind(file: ConfigFileSummary): string | undefined {
  if (['npm', 'pnpm', 'pnpm-workspace', 'yarn', 'package-manifest'].includes(file.kind)) {
    return undefined;
  }
  return file.kind;
}

function createTargetSummaries(input: {
  discovery: DiscoveryFacts;
  repo: RepoIdentity;
  sourceFiles: readonly SourceFileFact[];
}): TargetSummary[] {
  return input.discovery.targets
    .map((target) => {
      const targetPath = normalizeTargetPath(input.repo, target) ?? '.';
      const metadata = createMetadata({
        discovererId: input.discovery.discovererId ?? null,
        fileCount: input.sourceFiles.filter((file) => file.targetName === target.name).length,
        framework: readString(target.framework),
        language: readString(target.language),
        source: 'project-context-repo-target',
      });
      const ref = createProjectContextPathRef({
        metadata,
        path: targetPath,
        repo: input.repo,
        role: 'target',
      });
      return {
        kind: readString(target.type),
        name: target.name,
        refs: [ref],
      };
    })
    .sort(compareTargets);
}

function createLocalPackageSummaries(input: {
  repo: RepoIdentity;
  packageJson?: PackageJsonRecord;
  packageJsonRef?: ProjectContextRef;
  targets: readonly DiscoveredTarget[];
}): PackageSummary[] {
  const packages: PackageSummary[] = [];
  const rootPackageName = readString(input.packageJson?.name);
  if (rootPackageName) {
    packages.push({
      name: rootPackageName,
      path: '.',
      ref: input.packageJsonRef,
    });
  }
  for (const target of input.targets) {
    const targetPath = normalizeTargetPath(input.repo, target);
    const metadata = readRecord(target.metadata);
    const targetPackageJson = readRecord(metadata?.packageJson);
    const packageName = readString(targetPackageJson?.name) ?? target.name;
    if (!targetPath || targetPath === '.' || !packageName) {
      continue;
    }
    packages.push({
      name: packageName,
      path: targetPath,
      ref: createProjectContextFileRef({
        filePath: toRepoFilePath(input.repo, path.join(targetPath, 'package.json')),
        projectRoot: input.repo.projectRoot,
        repoId: input.repo.repoId,
        sourceFolder: input.repo.sourceFolder,
      }),
    });
  }
  return dedupeBy(packages, (item) => `${item.name}:${item.path ?? ''}`).sort(comparePackages);
}

async function createEntrypointSummaries(input: {
  repo: RepoIdentity;
  manifestFacts: RepoManifestFacts;
}): Promise<EntrypointSummary[]> {
  const entrypoints: EntrypointSummary[] = [];
  const packageJson = input.manifestFacts.packageJson;
  if (packageJson) {
    for (const field of ['main', 'module', 'types', 'typings', 'browser']) {
      const value = readString(packageJson[field]);
      if (!value) {
        continue;
      }
      entrypoints.push(
        createEntrypointSummary({
          kind: `manifest:${field}`,
          name: field,
          pathValue: value,
          repo: input.repo,
        })
      );
    }
    for (const bin of readBinEntrypoints(packageJson.bin)) {
      entrypoints.push(
        createEntrypointSummary({
          kind: 'manifest:bin',
          name: `bin:${bin.name}`,
          pathValue: bin.path,
          repo: input.repo,
        })
      );
    }
    for (const exportEntry of readExportEntrypoints(packageJson.exports).slice(0, 12)) {
      entrypoints.push(
        createEntrypointSummary({
          kind: 'manifest:exports',
          name: `exports:${exportEntry.name}`,
          pathValue: exportEntry.path,
          repo: input.repo,
        })
      );
    }
  }

  for (const filePath of HIGH_PRIORITY_ENTRY_FILES) {
    if (!(await pathExists(path.join(input.repo.absoluteRoot, filePath)))) {
      continue;
    }
    entrypoints.push(
      createEntrypointSummary({
        kind: 'source-entry',
        name: filePath,
        pathValue: filePath,
        repo: input.repo,
      })
    );
  }

  return dedupeBy(entrypoints, (entrypoint) => `${entrypoint.kind}:${entrypoint.name}`).sort(
    compareEntrypoints
  );
}

function createEntrypointSummary(input: {
  repo: RepoIdentity;
  name: string;
  kind: string;
  pathValue: string;
}): EntrypointSummary {
  const ref = createProjectContextFileRef({
    filePath: toRepoFilePath(input.repo, normalizeManifestPath(input.pathValue)),
    projectRoot: input.repo.projectRoot,
    repoId: input.repo.repoId,
    sourceFolder: input.repo.sourceFolder,
  });
  return {
    kind: input.kind,
    name: input.name,
    refs: [ref],
  };
}

function createCommandSummaries(input: {
  packageJson?: PackageJsonRecord;
  packageJsonRef?: ProjectContextRef;
}): CommandSummary[] {
  return Object.entries(readPackageScripts(input.packageJson))
    .map(([name, command]) => ({
      command,
      name,
      sourceRef: input.packageJsonRef,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function createTopAreaSummaries(input: {
  repo: RepoIdentity;
  sourceRoots: readonly PathSummary[];
  targets: readonly TargetSummary[];
  localPackages: readonly PackageSummary[];
  configFiles: readonly ConfigFileSummary[];
}): Promise<PathSummary[]> {
  const priorityPaths = [
    ...input.sourceRoots.map((item) => ({ path: item.path, role: 'source-root' })),
    ...input.targets.flatMap((target) =>
      target.refs.map((ref) => ({ path: ref.scope.filePath ?? '.', role: 'target' }))
    ),
    ...input.localPackages
      .map((item) => item.path)
      .filter((pathValue): pathValue is string => Boolean(pathValue))
      .map((pathValue) => ({ path: pathValue, role: 'local-package' })),
    ...input.configFiles.map((item) => ({ path: item.path, role: 'config' })),
  ];
  const directoryEntries = await readDirectoryEntries(input.repo.absoluteRoot);
  for (const entry of directoryEntries) {
    if (entry.name.startsWith('.') || SOURCE_SCAN_EXCLUDE_DIRS.has(entry.name)) {
      continue;
    }
    priorityPaths.push({
      path: entry.name,
      role: entry.isDirectory() ? 'top-directory' : 'top-file',
    });
  }

  const summaries: PathSummary[] = [];
  for (const item of dedupeBy(
    priorityPaths.filter((entry) => entry.path !== '.'),
    (entry) => entry.path
  ).slice(0, TOP_AREA_LIMIT)) {
    summaries.push(
      createPathSummary({
        metadata: {
          fileCount: await countTopAreaFiles(path.join(input.repo.absoluteRoot, item.path)),
          source: 'project-context-repo-top-area',
        },
        path: item.path,
        repo: input.repo,
        role: item.role,
      })
    );
  }
  return summaries.sort(comparePathSummaries);
}

async function createRepoMapFacts(input: {
  payload: RepoRequestPayload;
  project: CanonicalProjectContextRequest['project'];
  repo: RepoIdentity;
  requestScope: ProjectContextScope;
}): Promise<{ summary?: ProjectContextMapRepoSummary; errors: ProjectContextQueryError[] }> {
  if (input.payload.includeMapSummary === false) {
    return { errors: [] };
  }
  const moduleSeeds = [...(input.payload.moduleSeeds ?? []), ...(input.payload.modules ?? [])];
  if (moduleSeeds.length === 0) {
    return {
      errors: [
        createQueryError({
          code: 'query-unavailable',
          message:
            'repo map facts are unavailable because payload.moduleSeeds or payload.modules is missing.',
          retryable: false,
        }),
      ],
    };
  }

  const result = await mapProjectContextHandler({
    kind: 'map',
    payload: {
      moduleSeeds: moduleSeeds as ProjectContextJson[],
      repoName: input.repo.repoName,
    },
    project: input.project,
    scope: {
      ...input.requestScope,
      repoId: input.repo.repoId,
      sourceFolder: input.repo.sourceFolder,
    },
  });
  if (isUnavailableData(result.data)) {
    return {
      errors: [
        ...(result.errors ?? []),
        createQueryError({
          code: 'query-unavailable',
          message: 'repo map facts are unavailable because map query did not produce data.',
          retryable: false,
        }),
      ],
    };
  }

  const map = result.data as ProjectMap;
  return {
    errors: result.errors ?? [],
    summary: createProjectContextMapRepoSummary({
      map,
      mapRef: selectProjectContextMapRef(result.refs ?? []),
      refs: result.refs,
    }),
  };
}

function createNextRefs(input: {
  repo: RepoIdentity;
  buildSystems: readonly BuildSystemSummary[];
  commands: readonly CommandSummary[];
  configFiles: readonly ConfigFileSummary[];
  entrypoints: readonly EntrypointSummary[];
  localPackages: readonly PackageSummary[];
  mapSummary?: ProjectContextMapRepoSummary;
  packageSystems: readonly PackageSystemSummary[];
  sourceRoots: readonly PathSummary[];
  targets: readonly TargetSummary[];
  topAreas: readonly PathSummary[];
}): ProjectContextRef[] {
  return dedupeRefs([
    input.repo.repo.ref,
    ...input.buildSystems.flatMap((item) => item.configRefs),
    ...input.commands.map((item) => item.sourceRef),
    ...input.configFiles.map((item) => item.ref),
    ...input.entrypoints.flatMap((item) => item.refs),
    ...input.localPackages.map((item) => item.ref),
    input.mapSummary?.mapRef,
    ...(input.mapSummary?.nextRefs ?? []),
    ...input.packageSystems.flatMap((item) => item.manifestRefs),
    ...input.sourceRoots.map((item) => item.ref),
    ...input.targets.flatMap((item) => item.refs),
    ...input.topAreas.map((item) => item.ref),
  ]);
}

function createPathSummary(input: {
  repo: RepoIdentity;
  path: string;
  role: string;
  metadata?: ProjectContextMetadata;
}): PathSummary {
  return {
    exists: true,
    path: normalizeRelativePath(input.path),
    ref: createProjectContextPathRef(input),
    role: input.role,
  };
}

function createProjectContextPathRef(input: {
  repo: RepoIdentity;
  path: string;
  role: string;
  metadata?: ProjectContextMetadata;
}): ProjectContextRef {
  const normalizedPath = normalizeRelativePath(input.path);
  return {
    id: `path:${encodeRefPart(input.repo.repoId)}:${encodeRefPart(normalizedPath)}`,
    kind: 'path',
    label: normalizedPath,
    level: 'repo',
    metadata: {
      role: input.role,
      ...(input.metadata ?? {}),
    },
    parentRef: input.repo.repo.ref?.id,
    scope: {
      ...createProjectScope({
        projectRoot: input.repo.projectRoot,
        repoId: input.repo.repoId,
        sourceFolder: input.repo.sourceFolder,
      }),
      filePath: toRepoFilePath(input.repo, normalizedPath),
    },
  };
}

function createProjectScope(input: {
  projectRoot: string;
  repoId?: string;
  sourceFolder?: string;
}): ProjectContextRefScope {
  return {
    projectRoot: input.projectRoot,
    repoId: input.repoId,
    sourceFolder: input.sourceFolder,
  };
}

function createRepoFailure(
  error: ProjectContextQueryError,
  errors: readonly ProjectContextQueryError[]
): ProjectContextHandlerResult {
  return {
    data: {
      available: false,
      kind: 'repo',
      nextRefs: [],
      reason: error.message,
    },
    errors: [...errors, error],
    refs: [],
  };
}

function createMetadata(
  input: Record<string, ProjectContextJson | undefined>
): ProjectContextMetadata {
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, ProjectContextJson] => entry[1] !== undefined
    )
  );
}

function createLanguageSummaries(files: readonly SourceFileFact[]): LanguageSummary[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    if (file.language === 'unknown') {
      continue;
    }
    counts.set(file.language, (counts.get(file.language) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([language, fileCount]) => ({ fileCount, language }))
    .sort(
      (left, right) =>
        right.fileCount - left.fileCount || left.language.localeCompare(right.language)
    );
}

function readBinEntrypoints(value: unknown): { name: string; path: string }[] {
  if (typeof value === 'string') {
    return [{ name: 'default', path: value }];
  }
  const record = readRecord(value);
  if (!record) {
    return [];
  }
  return Object.entries(record)
    .map(([name, pathValue]) => {
      const filePath = readString(pathValue);
      return filePath ? { name, path: filePath } : undefined;
    })
    .filter((item): item is { name: string; path: string } => item !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function readExportEntrypoints(value: unknown): { name: string; path: string }[] {
  const result: { name: string; path: string }[] = [];
  const visit = (name: string, current: unknown): void => {
    const direct = readString(current);
    if (direct) {
      result.push({ name, path: direct });
      return;
    }
    const record = readRecord(current);
    if (!record) {
      return;
    }
    for (const [key, child] of Object.entries(record)) {
      visit(name === '.' ? key : `${name}/${key}`, child);
    }
  };
  visit('.', value);
  return dedupeBy(result, (item) => `${item.name}:${item.path}`).sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

function readPackageScripts(packageJson: PackageJsonRecord | undefined): Record<string, string> {
  const scripts = readRecord(packageJson?.scripts);
  if (!scripts) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(scripts)
      .map(([name, command]) => [name, readString(command)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

async function readJsonObject(
  absolutePath: string,
  relativePath: string
): Promise<{ value?: PackageJsonRecord; error?: ProjectContextQueryError }> {
  if (!(await pathExists(absolutePath))) {
    return {};
  }
  try {
    const parsed = JSON.parse(await fs.readFile(absolutePath, 'utf8')) as unknown;
    if (isRecord(parsed)) {
      return { value: parsed };
    }
    return {
      error: createQueryError({
        code: 'query-unavailable',
        message: `repo manifest is not a JSON object: ${relativePath}`,
        path: relativePath,
        retryable: false,
      }),
    };
  } catch (error) {
    return {
      error: createQueryError({
        code: 'query-unavailable',
        message: `repo manifest could not be read: ${relativePath}: ${readErrorMessage(error)}`,
        path: relativePath,
        retryable: true,
      }),
    };
  }
}

async function countTopAreaFiles(absolutePath: string): Promise<number> {
  const stat = await readStat(absolutePath);
  if (!stat) {
    return 0;
  }
  if (stat.isFile()) {
    return 1;
  }
  if (!stat.isDirectory()) {
    return 0;
  }
  let count = 0;
  const pending = [absolutePath];
  while (pending.length > 0 && count < 200) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    for (const entry of await readDirectoryEntries(current)) {
      if (entry.name.startsWith('.') || SOURCE_SCAN_EXCLUDE_DIRS.has(entry.name)) {
        continue;
      }
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(nextPath);
      } else if (entry.isFile()) {
        count += 1;
      }
    }
  }
  return count;
}

async function readStat(
  absolutePath: string
): Promise<{ isFile(): boolean; isDirectory(): boolean } | undefined> {
  try {
    return await fs.stat(absolutePath);
  } catch {
    return undefined;
  }
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

function normalizeTargetPath(repo: RepoIdentity, target: DiscoveredTarget): string | undefined {
  const targetPath = readString(target.path);
  if (!targetPath) {
    return undefined;
  }
  const absolutePath = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(repo.absoluteRoot, targetPath);
  const relativePath = path.relative(repo.absoluteRoot, absolutePath);
  return isContainedRelativePath(relativePath)
    ? normalizeRelativePath(relativePath || '.')
    : undefined;
}

function normalizeManifestPath(value: string): string {
  const clean = value.replace(/^\.\/+/, '');
  return normalizeRelativePath(clean);
}

function normalizeRelativePath(value: string): string {
  const normalized = value.split(path.sep).join('/').replaceAll('\\', '/');
  return normalized === '' ? '.' : normalized;
}

function toRepoFilePath(repo: RepoIdentity, repoRelativePath: string): string {
  const normalized = normalizeRelativePath(repoRelativePath);
  return repo.relativeRoot === '.'
    ? normalized
    : normalizeRelativePath(path.join(repo.relativeRoot, normalized));
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

function normalizeLanguage(value: unknown, filePath: string): string {
  const language = readString(value);
  const inferred = language ?? LanguageService.inferLang(filePath);
  return LanguageService.normalize(inferred);
}

function createRepoIdFromPath(relativeRoot: string, absoluteRoot: string): string {
  return relativeRoot === '.' ? path.basename(absoluteRoot) : relativeRoot.replaceAll('/', '-');
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

function isUnavailableData(value: unknown): value is ProjectContextUnavailableData {
  return isRecord(value) && value.available === false;
}

function isProjectContextRef(value: unknown): value is ProjectContextRef {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    isRecord(value.scope)
  );
}

function readProjectContextRef(value: unknown): ProjectContextRef | undefined {
  return isProjectContextRef(value) ? value : undefined;
}

function readUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, ProjectContextJson | unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function dedupeSourceFiles(files: readonly SourceFileFact[]): SourceFileFact[] {
  return dedupeBy(files, (file) => file.filePath).sort((left, right) =>
    left.filePath.localeCompare(right.filePath)
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

function compareConfigFiles(left: ConfigFileSummary, right: ConfigFileSummary): number {
  return left.path.localeCompare(right.path);
}

function compareDiscoveredTargets(left: DiscoveredTarget, right: DiscoveredTarget): number {
  return left.name.localeCompare(right.name) || String(left.path).localeCompare(String(right.path));
}

function compareEntrypoints(left: EntrypointSummary, right: EntrypointSummary): number {
  return left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name);
}

function comparePackageSystems(left: PackageSystemSummary, right: PackageSystemSummary): number {
  return left.kind.localeCompare(right.kind);
}

function comparePackages(left: PackageSummary, right: PackageSummary): number {
  return (left.path ?? '').localeCompare(right.path ?? '') || left.name.localeCompare(right.name);
}

function comparePathSummaries(left: PathSummary, right: PathSummary): number {
  return (left.role ?? '').localeCompare(right.role ?? '') || left.path.localeCompare(right.path);
}

function compareTargets(left: TargetSummary, right: TargetSummary): number {
  return left.name.localeCompare(right.name) || (left.kind ?? '').localeCompare(right.kind ?? '');
}

function encodeRefPart(value: string): string {
  return encodeURIComponent(value).replaceAll('%2F', '/');
}
