import path from 'node:path';
import { hashCanonicalJson } from '../../shared/canonicalJson.js';
import type { ProjectSourceReader } from '../../types/projectSourceReader.js';
import Logger from '../logging/Logger.js';
import { normalizePrivateDirectories } from './ProjectInputScope.js';
import {
  type ProjectInputSnapshotView,
  ProjectSourceInputDriftError,
  readProjectInputSnapshotView,
} from './ProjectInputSnapshot.js';
import { bindProjectSourceDirectoryView } from './ProjectSourceReader.js';

export interface ProjectInputViewPolicy {
  excludedDirectories: string[];
}

/** 目录发现策略独立于原始FS事实；SDK额外runtime策略保留原持久化键以兼容旧闭包。 */
export async function readProjectInputView(
  reader: ProjectSourceReader,
  view: ProjectInputSnapshotView,
  projectRoot: string,
  privateDirectories: readonly string[],
  signal?: AbortSignal,
  kind: 'project-input-view' | 'codegraph-input-view' = 'project-input-view'
): Promise<ProjectInputViewPolicy> {
  const key = path.join(projectRoot, `.alembic-${kind}`);
  const recorded = view.snapshot.observations.some(
    (row) =>
      row.operation === kind &&
      path.resolve(
        view.roots.find((root) => root.id === row.path.rootId)!.path,
        row.path.relativePath
      ) === key
  );
  if (reader.mode === 'replay' && !recorded) {
    Logger.debug('Project analysis replays legacy input without a directory-view policy', {
      projectRoot,
      kind,
    });
    return { excludedDirectories: [] };
  }
  const directories = normalizePrivateDirectories(privateDirectories);
  const expected = {
    excludedDirectories: directories.filter((directory) =>
      view.roots.some((root) => inside(directory, root.path))
    ),
  };
  const policy = await reader.readConfiguration<ProjectInputViewPolicy>(kind, key, () => expected, {
    signal,
  });
  if (
    !policy ||
    !Array.isArray(policy.excludedDirectories) ||
    policy.excludedDirectories.some((item) => typeof item !== 'string' || !path.isAbsolute(item))
  ) {
    throw new TypeError('Invalid captured project directory-view policy.');
  }
  // Replay只校验解码后的原策略；本次宿主目录不能否决旧输入视图。
  if (policy.excludedDirectories.some((directory) => inside(projectRoot, directory))) {
    throw new TypeError('A private directory must not replace the source repository.');
  }
  if (reader.mode === 'record' && hashCanonicalJson(policy) !== hashCanonicalJson(expected)) {
    const error = new ProjectSourceInputDriftError(kind, projectRoot);
    reader.invalidate(error);
    throw error;
  }
  Logger.debug('Project analysis uses the captured directory-discovery policy', {
    kind,
    projectRoot,
    mode: reader.mode,
    excludedDirectories: policy.excludedDirectories,
    rawDirectoryObservations: 'preserved',
  });
  return policy;
}

/** 原始reader继续持有真实FS事实，投影视图仅改变发现消费者看到的目录成员。 */
export async function createProjectInputDiscoveryView(
  reader: ProjectSourceReader,
  privateDirectories: readonly string[],
  signal?: AbortSignal
): Promise<ProjectSourceReader> {
  const view = await readProjectInputSnapshotView(reader);
  if (!view) {
    Logger.debug('Project directory discovery retains an unregistered reader', {
      mode: reader.mode,
      reason: 'no-captured-view-capability',
    });
    return reader;
  }
  const directories: string[] = [];
  for (const root of view.roots) {
    const policy = await readProjectInputView(reader, view, root.path, privateDirectories, signal);
    directories.push(...policy.excludedDirectories);
  }
  const excluded = normalizePrivateDirectories(directories);
  if (!excluded.length) {
    return reader;
  }
  // /var、sourceFolder软链接等运行时别名只在内存映射；持久化策略仍是RootBinding路径。
  const aliases = view.roots
    .flatMap((root) => (root.aliases ?? []).map((alias) => ({ alias, root: root.path })))
    .sort((left, right) => right.alias.length - left.alias.length);
  return bindProjectSourceDirectoryView(reader, (directory, entries) => {
    const resolved = path.resolve(directory);
    const binding = aliases.find(({ alias }) => inside(resolved, alias));
    const canonical = binding
      ? path.resolve(binding.root, path.relative(binding.alias, resolved))
      : resolved;
    const visible = entries.filter(
      (entry) => !excluded.some((root) => inside(path.join(canonical, entry.name), root))
    );
    if (visible.length !== entries.length) {
      Logger.debug('Project directory discovery excluded declared host state', {
        directory,
        excludedEntryCount: entries.length - visible.length,
        rawObservations: 'preserved',
      });
    }
    return visible;
  });
}

function inside(file: string, root: string): boolean {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
