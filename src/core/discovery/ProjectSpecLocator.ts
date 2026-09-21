import { join } from 'node:path';
import { sourceExists } from '../../infrastructure/io/ProjectSourceReader.js';
import { DEFAULT_KNOWLEDGE_BASE_DIR, SPEC_FILENAME } from '../../shared/ProjectMarkers.js';
import type { ProjectSourceReader } from '../../types/projectSourceReader.js';

/**
 * 分析私有定位入口：保留一级非点目录的原遍历顺序和默认目录回退，所有探测都经过 reader。
 * 不调用 getProjectSpecPath 的本机目录扫描，离线输入也能选择同一份用户自定义系统配置。
 */
export async function locateProjectSpec(
  projectRoot: string,
  reader: ProjectSourceReader
): Promise<string> {
  try {
    const entries = await reader.readDirectory(projectRoot);
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const candidate = join(projectRoot, entry.name, SPEC_FILENAME);
        if (await sourceExists(reader, candidate)) {
          return candidate;
        }
      }
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' ||
        ('code' in error && error.code === 'PROJECT_SOURCE_INPUT_UNCAPTURED'))
    ) {
      throw error;
    }
    reader.assertComplete();
  }
  return join(projectRoot, DEFAULT_KNOWLEDGE_BASE_DIR, SPEC_FILENAME);
}
