/**
 * @module GenericDiscoverer
 * @description 通用兜底项目结构发现器
 *
 * 始终匹配，confidence 0.1。
 * 按语言统计最多的扩展名确定主语言。
 * 按顶层目录分 Target。
 */

import fs from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import { LanguageService } from '../../shared/LanguageService.js';
import {
  type DiscoveredFile,
  type DiscoveredTarget,
  ProjectDiscoverer,
  type ProjectDiscoveryExecutionContext,
  throwIfProjectDiscoveryAborted,
} from './ProjectDiscoverer.js';
import { createSourceScanExcludeDirs } from './SourceScanExclusions.js';

const EXCLUDE_DIRS = createSourceScanExcludeDirs(['.gradle']);

const SOURCE_EXTENSIONS = LanguageService.sourceExts;

export class GenericDiscoverer extends ProjectDiscoverer {
  #projectRoot: string | null = null;
  #targets: DiscoveredTarget[] = [];
  #primaryLang = 'unknown';

  get id() {
    return 'generic';
  }
  get displayName() {
    return 'Generic (directory scan)';
  }

  async detect(projectRoot: string, context?: ProjectDiscoveryExecutionContext) {
    throwIfProjectDiscoveryAborted(context);
    // 始终匹配
    return { match: true, confidence: 0.1, reason: 'Generic fallback discoverer' };
  }

  async load(projectRoot: string, context?: ProjectDiscoveryExecutionContext) {
    throwIfProjectDiscoveryAborted(context);
    this.#projectRoot = projectRoot;
    this.#targets = [];

    // 统计语言分布
    const langStats: Record<string, number> = {};
    await this.#scanLangStats(projectRoot, langStats, 0, context);

    // 找到主语言
    let maxCount = 0;
    for (const [lang, count] of Object.entries(langStats)) {
      throwIfProjectDiscoveryAborted(context);
      if (count > maxCount) {
        maxCount = count;
        this.#primaryLang = lang;
      }
    }

    // 按顶层约定目录分 Target
    const targetDirs = ['src', 'lib', 'app', 'pkg', 'cmd', 'internal', 'test', 'tests'];
    let foundTargets = false;

    try {
      const entries = await fs.readdir(projectRoot, { withFileTypes: true });
      throwIfProjectDiscoveryAborted(context);
      for (const entry of entries) {
        throwIfProjectDiscoveryAborted(context);
        if (!entry.isDirectory()) {
          continue;
        }
        if (entry.name.startsWith('.') || EXCLUDE_DIRS.has(entry.name)) {
          continue;
        }

        if (targetDirs.includes(entry.name.toLowerCase())) {
          const isTest = /^tests?$/.test(entry.name);
          this.#targets.push({
            name: entry.name,
            path: join(projectRoot, entry.name),
            type: isTest ? 'test' : 'library',
            language: this.#primaryLang,
          });
          foundTargets = true;
        }
      }
    } catch (_error) {
      if (context?.signal?.aborted) {
        throwIfProjectDiscoveryAborted(context);
      }
      /* skip */
    }

    // 没有约定目录则整个项目为一个 Target
    if (!foundTargets) {
      this.#targets.push({
        name: basename(projectRoot),
        path: projectRoot,
        type: 'library',
        language: this.#primaryLang,
      });
    }
  }

  async listTargets(context?: ProjectDiscoveryExecutionContext) {
    throwIfProjectDiscoveryAborted(context);
    return this.#targets;
  }

  async getTargetFiles(target: DiscoveredTarget, context?: ProjectDiscoveryExecutionContext) {
    throwIfProjectDiscoveryAborted(context);
    const targetPath =
      typeof target === 'string'
        ? this.#targets.find((t) => t.name === target)?.path || this.#projectRoot
        : target.path;

    if (!targetPath || !(await pathExists(targetPath))) {
      return [];
    }

    const files: DiscoveredFile[] = [];
    await this.#collectFiles(targetPath, targetPath, files, 0, context);
    return files;
  }

  async getDependencyGraph(context?: ProjectDiscoveryExecutionContext) {
    throwIfProjectDiscoveryAborted(context);
    // GenericDiscoverer 无法推断依赖图
    return { nodes: this.#targets.map((t) => t.name), edges: [] };
  }

  // ── 内部实现 ──

  async #scanLangStats(
    dir: string,
    stats: Record<string, number>,
    depth: number,
    context?: ProjectDiscoveryExecutionContext
  ): Promise<void> {
    throwIfProjectDiscoveryAborted(context);
    if (depth > 5) {
      return; // 限制深度, 只采样
    }
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      throwIfProjectDiscoveryAborted(context);
      for (const entry of entries) {
        throwIfProjectDiscoveryAborted(context);
        if (entry.name.startsWith('.')) {
          continue;
        }
        if (EXCLUDE_DIRS.has(entry.name)) {
          continue;
        }

        if (entry.isDirectory()) {
          await this.#scanLangStats(join(dir, entry.name), stats, depth + 1, context);
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (SOURCE_EXTENSIONS.has(ext)) {
            const lang = LanguageService.inferLang(entry.name) || 'unknown';
            stats[lang] = (stats[lang] || 0) + 1;
          }
        }
      }
    } catch (_error) {
      if (context?.signal?.aborted) {
        throwIfProjectDiscoveryAborted(context);
      }
      /* skip */
    }
  }

  async #collectFiles(
    dir: string,
    rootDir: string,
    files: DiscoveredFile[],
    depth = 0,
    context?: ProjectDiscoveryExecutionContext
  ): Promise<void> {
    throwIfProjectDiscoveryAborted(context);
    if (depth > 15) {
      return;
    }
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      throwIfProjectDiscoveryAborted(context);
      for (const entry of entries) {
        throwIfProjectDiscoveryAborted(context);
        if (entry.name.startsWith('.')) {
          continue;
        }
        if (EXCLUDE_DIRS.has(entry.name)) {
          continue;
        }

        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.#collectFiles(fullPath, rootDir, files, depth + 1, context);
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (SOURCE_EXTENSIONS.has(ext)) {
            const lang = LanguageService.inferLang(entry.name) || 'unknown';
            files.push({
              name: entry.name,
              path: fullPath,
              relativePath: relative(rootDir, fullPath),
              language: lang,
            });
          }
        }
      }
    } catch (_error) {
      if (context?.signal?.aborted) {
        throwIfProjectDiscoveryAborted(context);
      }
      /* skip */
    }
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
