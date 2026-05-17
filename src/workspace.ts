export {
  type AlembicFolderNames,
  DEFAULT_FOLDER_NAMES,
  type PartialAlembicFolderNames,
  resolveFolderNames,
  validateFolderNameSegment,
} from './shared/folder-names.js';
export {
  DEFAULT_KNOWLEDGE_BASE_DIR,
  DEFAULT_SUB_REPO_DIR,
  detectKnowledgeBaseDir,
  isAlembicProject,
  isGitRepo,
  PROJECT_MARKER_DIRS,
  RUNTIME_DIR,
  readSubRepoDirFromConfig,
  readSubRepoUrlFromConfig,
  resolveSubRepoPath,
  SPEC_FILENAME,
} from './shared/ProjectMarkers.js';
export {
  type GhostMarker,
  generateProjectId,
  getGhostWorkspaceDir,
  getProjectRegistryDir,
  getProjectRegistryPath,
  normalizeProjectPath,
  type ProjectEntry,
  ProjectRegistry,
  type ProjectRegistryInspection,
  type WorkspaceMode,
} from './shared/ProjectRegistry.js';
export {
  resolveDataRoot,
  resolveKnowledgeScanDirs,
  resolveProjectRoot,
  resolveWorkspace,
} from './shared/resolveProjectRoot.js';
export { type WorkspaceFacts, WorkspaceResolver } from './shared/WorkspaceResolver.js';
