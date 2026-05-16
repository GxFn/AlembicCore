import {
  type AlembicFolderNames,
  type PartialAlembicFolderNames,
  resolveFolderNames,
} from './folder-names.js';

export interface AlembicRuntimeOptions {
  projectRoot: string;
  dataRoot?: string;
  folderNames?: PartialAlembicFolderNames;
}

export interface AlembicRuntime {
  projectRoot: string;
  dataRoot: string;
  folderNames: AlembicFolderNames;
}

export function createAlembicRuntime(options: AlembicRuntimeOptions): AlembicRuntime {
  const projectRoot = normalizeRequiredPath(options.projectRoot, 'projectRoot');
  const dataRoot = options.dataRoot
    ? normalizeRequiredPath(options.dataRoot, 'dataRoot')
    : projectRoot;

  return {
    projectRoot,
    dataRoot,
    folderNames: resolveFolderNames(options.folderNames),
  };
}

function normalizeRequiredPath(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty path`);
  }
  return value;
}
