import path from 'node:path';
import {
  loadProjectScopeForFolder,
  type ProjectDescriptor,
  readProjectScopeRegistryDocument,
} from '../../../shared/ProjectScope.js';
import type { ProjectSourceReader } from '../../../types/projectSourceReader.js';

/** 分析与新鲜度观察复用相同的接受配置语义；重放不会执行全局 registry loader。 */
export function readSourceFolderScope(
  reader: ProjectSourceReader,
  absolutePath: string
): Promise<ProjectDescriptor | null> {
  return reader.readConfiguration('scope-for-folder', absolutePath, () =>
    loadProjectScopeForFolder(absolutePath)
  );
}

export function readSourceControlRootScope(
  reader: ProjectSourceReader,
  absolutePath: string
): Promise<ProjectDescriptor | null> {
  const normalizedRoot = path.resolve(absolutePath);
  return reader.readConfiguration(
    'scope-for-control-root',
    absolutePath,
    () =>
      Object.values(readProjectScopeRegistryDocument().scopes).find(
        (scope) => path.resolve(scope.controlRoot.path) === normalizedRoot
      ) ?? null
  );
}
