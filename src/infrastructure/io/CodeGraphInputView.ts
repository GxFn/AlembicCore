import path from 'node:path';
import { hashCanonicalJson } from '../../shared/canonicalJson.js';
import type { ProjectSourceReader } from '../../types/projectSourceReader.js';
import Logger from '../logging/Logger.js';
import {
  type ProjectInputSnapshotView,
  ProjectSourceInputDriftError,
} from './ProjectInputSnapshot.js';

export interface CodeGraphInputViewPolicy {
  excludedDirectories: string[];
}

/** SDK目录发现的可移植策略；底层reader保留真实目录，显式文件读取仍走同一reader。 */
export async function readCodeGraphInputView(
  reader: ProjectSourceReader,
  view: ProjectInputSnapshotView,
  projectRoot: string,
  runtimeRoot: string,
  signal?: AbortSignal
): Promise<CodeGraphInputViewPolicy> {
  const key = path.join(projectRoot, '.alembic-codegraph-input-view');
  const recorded = view.snapshot.observations.some(
    (row) =>
      row.operation === 'codegraph-input-view' &&
      path.resolve(
        view.roots.find((root) => root.id === row.path.rootId)!.path,
        row.path.relativePath
      ) === key
  );
  if (reader.mode === 'replay' && !recorded) {
    Logger.debug('CodeGraph replays legacy input without a directory-view policy', { projectRoot });
    return { excludedDirectories: [] };
  }
  const stateRoot = path.dirname(runtimeRoot);
  const expected = {
    excludedDirectories: view.roots.some((root) => inside(stateRoot, root.path)) ? [stateRoot] : [],
  };
  const policy = await reader.readConfiguration<CodeGraphInputViewPolicy>(
    'codegraph-input-view',
    key,
    () => expected,
    { signal }
  );
  if (
    !policy ||
    !Array.isArray(policy.excludedDirectories) ||
    policy.excludedDirectories.some((item) => typeof item !== 'string' || !path.isAbsolute(item))
  ) {
    throw new TypeError('Invalid captured CodeGraph directory-view policy.');
  }
  if (reader.mode === 'record' && hashCanonicalJson(policy) !== hashCanonicalJson(expected)) {
    const error = new ProjectSourceInputDriftError('codegraph-input-view', projectRoot);
    reader.invalidate(error);
    throw error;
  }
  Logger.debug('CodeGraph uses the captured SDK directory-discovery policy', {
    projectRoot,
    mode: reader.mode,
    excludedDirectories: policy.excludedDirectories,
    rawDirectoryObservations: 'preserved',
  });
  return policy;
}

function inside(file: string, root: string): boolean {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
