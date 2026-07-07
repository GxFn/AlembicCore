import path from 'node:path';
import {
  listProjectScopeFolders,
  loadProjectScopeForFolder,
  type ProjectDescriptor,
  readProjectScopeRegistryDocument,
} from '../../shared/ProjectScope.js';
import type { ProjectAnalysisMaterializationPlan } from '../shared/ProjectAnalysisPlanTypes.js';
import type { ColdStartWorkflowIntent } from './ColdStartIntent.js';
import type { KnowledgeRescanWorkflowIntent } from './KnowledgeRescanIntent.js';

export type GenerateWorkflowRunMode = 'full' | 'incremental';

type ProjectIndexIntentByMode = {
  full: ColdStartWorkflowIntent;
  incremental: KnowledgeRescanWorkflowIntent;
};

type ProjectIndexCleanupByMode = {
  full: {
    policy: 'full-reset';
    projectRoot: string;
    dataRoot: string;
  };
  incremental: {
    policy: 'none' | 'force-rescan' | 'rescan-clean';
    projectRoot: string;
  };
};

export interface GenerateWorkflowPlanParts<Mode extends GenerateWorkflowRunMode> {
  cleanup: ProjectIndexCleanupByMode[Mode];
  projectAnalysis: {
    projectRoot: string;
    prepare: Mode extends 'full'
      ? { clearOldData: true; dataRoot?: string }
      : Record<string, never>;
    scan: {
      maxFiles: number;
      contentMaxLines: number;
      sourceFolders?: string[];
      skipGuard?: boolean;
      sourceTag: ProjectIndexIntentByMode[Mode]['projectAnalysis']['sourceTag'];
      summaryPrefix?: string;
      generateReport: true;
      generateAstContext: boolean;
      incremental: boolean;
      logPrefix: Mode extends 'full' ? 'Bootstrap' : 'Rescan';
    };
    materialize: ProjectAnalysisMaterializationPlan;
  };
}

type BuildProjectIndexWorkflowPlanPartsInput<Mode extends GenerateWorkflowRunMode> = {
  dataRoot: string;
  intent: ProjectIndexIntentByMode[Mode];
  mode: Mode;
  projectRoot: string;
};

export function buildGenerateWorkflowPlanParts<Mode extends GenerateWorkflowRunMode>(
  input: BuildProjectIndexWorkflowPlanPartsInput<Mode>
): GenerateWorkflowPlanParts<Mode> {
  const materialize: ProjectAnalysisMaterializationPlan = {
    sourceGraph: true,
    dependencyEdges: true,
    moduleEntities: true,
    guardViolations: true,
  };

  if (input.mode === 'full') {
    const intent = input.intent as ColdStartWorkflowIntent;
    const analysisScope = resolveFullProjectAnalysisScope({
      projectRoot: input.projectRoot,
      sourceFolders: intent.projectAnalysis.sourceFolders,
    });
    const cleanupProjectRoot =
      intent.executor === 'host-agent' ? input.dataRoot : input.projectRoot;
    assertFullResetCleanupRoot({
      cleanupProjectRoot,
      projectScope: analysisScope.projectScope,
    });
    return {
      cleanup: {
        policy: 'full-reset',
        projectRoot: cleanupProjectRoot,
        dataRoot: input.dataRoot,
      },
      projectAnalysis: {
        projectRoot: analysisScope.projectRoot,
        prepare: {
          clearOldData: true,
          ...(intent.executor === 'host-agent' ? { dataRoot: input.dataRoot } : {}),
        },
        scan: {
          maxFiles: intent.projectAnalysis.maxFiles,
          contentMaxLines: intent.projectAnalysis.contentMaxLines,
          ...(analysisScope.sourceFolders ? { sourceFolders: analysisScope.sourceFolders } : {}),
          skipGuard: intent.projectAnalysis.skipGuard,
          sourceTag: intent.projectAnalysis.sourceTag,
          summaryPrefix: intent.projectAnalysis.summaryPrefix,
          generateReport: true,
          generateAstContext: intent.projectAnalysis.generateAstContext,
          incremental: false,
          logPrefix: 'Bootstrap',
        },
        materialize,
      },
    } as GenerateWorkflowPlanParts<Mode>;
  }

  const intent = input.intent as KnowledgeRescanWorkflowIntent;
  return {
    cleanup: {
      policy: intent.cleanupPolicy,
      projectRoot: input.dataRoot,
    },
    projectAnalysis: {
      projectRoot: input.projectRoot,
      prepare: {},
      scan: {
        maxFiles: intent.projectAnalysis.maxFiles,
        contentMaxLines: intent.projectAnalysis.contentMaxLines,
        sourceTag: intent.projectAnalysis.sourceTag,
        summaryPrefix: intent.projectAnalysis.summaryPrefix,
        generateReport: true,
        generateAstContext: intent.projectAnalysis.generateAstContext,
        incremental: intent.analysisMode === 'incremental',
        logPrefix: 'Rescan',
      },
      materialize,
    },
  } as GenerateWorkflowPlanParts<Mode>;
}

function resolveFullProjectAnalysisScope(input: {
  projectRoot: string;
  sourceFolders?: readonly string[];
}): {
  projectRoot: string;
  projectScope: ProjectDescriptor | null;
  sourceFolders?: string[];
} {
  const projectScope = loadProjectScopeForProjectIndexRoot(input.projectRoot);
  const explicitSourceFolders = normalizeProjectIndexSourceFolders(input.sourceFolders);
  if (explicitSourceFolders) {
    const sourceFolders = projectScope
      ? sourceFoldersWithinProjectScope(projectScope, explicitSourceFolders)
      : explicitSourceFolders;
    return {
      projectRoot: projectScope?.controlRoot.path ?? input.projectRoot,
      projectScope,
      sourceFolders,
    };
  }
  if (!projectScope) {
    return {
      projectRoot: input.projectRoot,
      projectScope: null,
    };
  }
  const sourceFolders = sourceFoldersFromProjectScope(projectScope);
  if (!sourceFolders.length) {
    return {
      projectRoot: input.projectRoot,
      projectScope,
    };
  }
  return {
    projectRoot: projectScope.controlRoot.path,
    projectScope,
    sourceFolders,
  };
}

function loadProjectScopeForProjectIndexRoot(projectRoot: string): ProjectDescriptor | null {
  const matchedFolderScope = loadProjectScopeForFolder(projectRoot);
  if (matchedFolderScope) {
    return matchedFolderScope;
  }
  const normalizedProjectRoot = path.resolve(projectRoot);
  return (
    Object.values(readProjectScopeRegistryDocument().scopes).find(
      (scope) => path.resolve(scope.controlRoot.path) === normalizedProjectRoot
    ) ?? null
  );
}

function sourceFoldersFromProjectScope(projectScope: ProjectDescriptor): string[] {
  const folders: string[] = [];
  for (const folder of listProjectScopeFolders(projectScope)) {
    const relativePath = path.relative(projectScope.controlRoot.path, folder.path);
    const normalized = normalizeProjectIndexSourceFolder(relativePath);
    if (normalized) {
      folders.push(normalized);
    }
  }
  return dedupeSourceFolders(folders);
}

function sourceFoldersWithinProjectScope(
  projectScope: ProjectDescriptor,
  sourceFolders: readonly string[]
): string[] {
  const projectScopeSourceFolders = sourceFoldersFromProjectScope(projectScope);
  const boundedSourceFolders = sourceFolders.filter((sourceFolder) =>
    projectScopeSourceFolders.some((projectScopeSourceFolder) =>
      isSameOrInsidePosixPath(sourceFolder, projectScopeSourceFolder)
    )
  );
  return boundedSourceFolders.length ? boundedSourceFolders : projectScopeSourceFolders;
}

function normalizeProjectIndexSourceFolders(
  sourceFolders: readonly string[] | undefined
): string[] | undefined {
  if (!sourceFolders?.length) {
    return undefined;
  }
  const normalized = dedupeSourceFolders(
    sourceFolders.flatMap((folder) => {
      const value = normalizeProjectIndexSourceFolder(folder);
      return value ? [value] : [];
    })
  );
  return normalized.length ? normalized : undefined;
}

function normalizeProjectIndexSourceFolder(value: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || path.isAbsolute(trimmed)) {
    return null;
  }
  const normalized = path.posix.normalize(trimmed.replaceAll('\\', '/'));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return null;
  }
  return normalized;
}

function dedupeSourceFolders(sourceFolders: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const folder of sourceFolders) {
    if (seen.has(folder)) {
      continue;
    }
    seen.add(folder);
    normalized.push(folder);
  }
  return normalized;
}

function assertFullResetCleanupRoot(input: {
  cleanupProjectRoot: string;
  projectScope: ProjectDescriptor | null;
}): void {
  if (!input.projectScope) {
    return;
  }
  const cleanupRoot = path.resolve(input.cleanupProjectRoot);
  const unsafeFolder = listProjectScopeFolders(input.projectScope).find(
    (folder) =>
      isSameOrInsidePath(cleanupRoot, folder.path) ||
      (folder.realpath ? isSameOrInsidePath(cleanupRoot, folder.realpath) : false)
  );
  if (!unsafeFolder) {
    return;
  }
  throw new Error(
    `[ProjectIndexPlan] full-reset cleanup root must not point at a ProjectScope member folder: ${unsafeFolder.path}`
  );
}

function isSameOrInsidePath(candidatePath: string, parentPath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isSameOrInsidePosixPath(candidatePath: string, parentPath: string): boolean {
  const relativePath = path.posix.relative(parentPath, candidatePath);
  return (
    relativePath === '' || (!relativePath.startsWith('..') && !path.posix.isAbsolute(relativePath))
  );
}
