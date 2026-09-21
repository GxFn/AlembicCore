/** 用户偏好存储与分析输入加载；不承载项目发现/冲突判定。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorkspaceResolver } from '../../shared/WorkspaceResolver.js';
import type { ProjectSourceReader } from '../../types/projectSourceReader.js';
import { nodeProjectSourceReader } from '../io/ProjectSourceReader.js';

export interface DiscovererPreferenceData {
  selectedDiscoverer: string;
  selectedAt: string;
  alternatives: string[];
  userConfirmed: boolean;
}

const PREFERENCE_FILE = 'discoverer-preference.json';

// ── Preference Persistence ──────────────────────────

/**
 * 获取偏好文件路径
 * @param root dataRoot（Ghost 模式下为外置工作区）或 projectRoot
 */
function getPreferencePath(root: string): string {
  return join(root, '.asd', PREFERENCE_FILE);
}

/**
 * 加载已保存的 Discoverer 偏好
 * @param dataRoot dataRoot（Ghost 模式下为外置工作区）或 projectRoot
 * @returns 偏好数据，或 null（无偏好/文件不存在/损坏）
 */
export function loadPreference(dataRoot: string): DiscovererPreferenceData | null {
  const prefPath = getPreferencePath(dataRoot);

  if (!existsSync(prefPath)) {
    return null;
  }

  try {
    const content = readFileSync(prefPath, 'utf8');
    const data = JSON.parse(content) as DiscovererPreferenceData;

    // 基本结构校验
    if (typeof data.selectedDiscoverer !== 'string' || typeof data.userConfirmed !== 'boolean') {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/** 分析会话捕获已接受的偏好值；replay 由 reader 返回记录，不再访问宿主 scope registry。 */
export function loadProjectDiscovererPreference(
  projectRoot: string,
  reader: ProjectSourceReader = nodeProjectSourceReader
): Promise<DiscovererPreferenceData | null> {
  return reader.readConfiguration('discoverer-preference', projectRoot, () => {
    const dataRoot = WorkspaceResolver.fromProjectScopeRegistry(projectRoot).dataRoot;
    return loadPreference(dataRoot);
  });
}

/**
 * 保存 Discoverer 偏好
 * @param dataRoot dataRoot（Ghost 模式下为外置工作区）或 projectRoot
 */
export function savePreference(
  dataRoot: string,
  discovererId: string,
  alternatives: string[],
  userConfirmed: boolean
): void {
  const prefPath = getPreferencePath(dataRoot);
  const prefDir = join(dataRoot, '.asd');

  if (!existsSync(prefDir)) {
    mkdirSync(prefDir, { recursive: true });
  }

  const data: DiscovererPreferenceData = {
    selectedDiscoverer: discovererId,
    selectedAt: new Date().toISOString(),
    alternatives,
    userConfirmed,
  };

  writeFileSync(prefPath, JSON.stringify(data, null, 2), 'utf8');
}
