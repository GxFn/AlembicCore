/**
 * @module SpmDiscoverer
 * @description SPM 项目发现器，适配 ProjectDiscoverer 接口
 *
 * 内置 Package.swift 正则解析，提供模块列表和文件遍历。
 *
 * 检测: 项目根或子目录存在 Package.swift
 */

import { basename, dirname, extname, join } from 'node:path';
import { readSourceText, sourceExists } from '../../infrastructure/io/ProjectSourceReader.js';
import { LanguageService } from '../../shared/LanguageService.js';
import {
  parseSwiftPackageManifest,
  type SwiftPackageManifest,
} from '../../shared/SwiftPackageManifest.js';
import type { ProjectSourceStat } from '../../types/projectSourceReader.js';
import { ProjectDiscoverer } from './ProjectDiscoverer.js';
import { createSourceScanExcludeDirs } from './SourceScanExclusions.js';

/** Package.swift 解析结果，带上清单文件自己的路径。 */
interface ParsedPackage extends SwiftPackageManifest {
  path: string;
}

const SKIP_DIRS = createSourceScanExcludeDirs(['.swiftpm', 'Build']);

export class SpmDiscoverer extends ProjectDiscoverer {
  #projectRoot: string | null = null;
  #parsedPackages: { pkgPath: string; parsed: ParsedPackage }[] = [];

  get id() {
    return 'spm';
  }
  get displayName() {
    return 'Swift Package Manager (SPM)';
  }
  override get supportsSourceReader() {
    return true;
  }

  async detect(projectRoot: string) {
    const hasRoot = await sourceExists(this.sourceReader, join(projectRoot, 'Package.swift'));
    if (hasRoot) {
      return { match: true, confidence: 0.95, reason: 'Package.swift found at project root' };
    }

    try {
      const entries = await this.sourceReader.readDirectory(projectRoot);
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          if (
            await sourceExists(this.sourceReader, join(projectRoot, entry.name, 'Package.swift'))
          ) {
            return {
              match: true,
              confidence: 0.85,
              reason: `Package.swift found in ${entry.name}/`,
            };
          }
        }
      }
    } catch {
      /* ignore */
    }

    return { match: false, confidence: 0, reason: 'No Package.swift found' };
  }

  async load(projectRoot: string) {
    this.#projectRoot = projectRoot;
    this.#parsedPackages = [];

    const allPaths = await this.#findAllPackageSwifts(projectRoot);
    for (const pkgPath of allPaths) {
      try {
        const parsed = await this.#parsePackageSwift(pkgPath);
        if (parsed) {
          this.#parsedPackages.push({ pkgPath, parsed });
        }
      } catch {
        // 解析失败，跳过
      }
    }
  }

  async listTargets() {
    const targets: {
      name: string;
      path: string;
      type: string;
      language: string;
      metadata: Record<string, unknown>;
    }[] = [];
    for (const { pkgPath, parsed } of this.#parsedPackages) {
      const pkgDir = dirname(pkgPath);
      const isMainPackage =
        this.#projectRoot !== null && pkgPath === join(this.#projectRoot, 'Package.swift');
      for (const t of parsed.targets || []) {
        targets.push({
          name: t.name,
          // RepoContext 以 DiscoveredTarget.path 作为 target ownership 真值；
          // 只展开主包显式 path；本地子包与无 path target 保持既有包根语义。
          path: isMainPackage && t.path ? join(pkgDir, t.path) : pkgDir,
          type: t.type || 'library',
          language: 'swift',
          metadata: {
            ...t,
            packageName: parsed.name,
            packagePath: pkgPath,
            targetDir: pkgDir,
          },
        });
      }
    }
    return targets;
  }

  async getTargetFiles(target: string | { name: string }) {
    const targetName = typeof target === 'string' ? target : target.name;

    let sourcesDir: string | null = null;
    for (const { pkgPath, parsed } of this.#parsedPackages) {
      const matchTarget = parsed.targets?.find((t: { name: string }) => t.name === targetName);
      if (matchTarget) {
        const pkgDir = dirname(pkgPath);
        const candidates: string[] = [];
        if (matchTarget.path) {
          candidates.push(join(pkgDir, matchTarget.path));
        }
        candidates.push(
          join(pkgDir, matchTarget.type === 'testTarget' ? 'Tests' : 'Sources', targetName)
        );
        candidates.push(join(pkgDir, targetName));
        for (const dir of candidates) {
          if (await sourceExists(this.sourceReader, dir)) {
            sourcesDir = dir;
            break;
          }
        }
        if (sourcesDir) {
          break;
        }
      }
    }

    if (!sourcesDir) {
      const fallback = join(this.#projectRoot!, 'Sources', targetName);
      if (await sourceExists(this.sourceReader, fallback)) {
        sourcesDir = fallback;
      } else {
        return [];
      }
    }

    return (await this.#walkSourceFiles(sourcesDir)).map((f) => ({
      name: f.name,
      path: f.path,
      relativePath: f.relativePath,
      language: this.#inferLang(f.path),
    }));
  }

  async getDependencyGraph() {
    if (!this.#projectRoot) {
      return { nodes: [], edges: [] };
    }

    if (this.#parsedPackages.length === 0) {
      return { nodes: [], edges: [] };
    }

    const nodes: {
      id: string;
      label: string;
      type: string;
      fullPath?: string;
      targetCount?: number;
      parent?: string;
      targetType?: string;
      indirect?: boolean;
    }[] = [];
    const edges: { from: string; to: string; type: string }[] = [];
    const pkgNameSet = new Set();
    const targetToPkg = new Map();

    const allParsed: (ParsedPackage & { _dir: string })[] = [];
    const umbrellaNames = new Set();
    for (const { pkgPath, parsed } of this.#parsedPackages) {
      if (pkgNameSet.has(parsed.name)) {
        continue;
      }
      pkgNameSet.add(parsed.name);
      allParsed.push({ ...parsed, _dir: dirname(pkgPath) });

      const hasTargets = parsed.targets && parsed.targets.length > 0;
      const hasProducts = parsed.products && parsed.products.length > 0;
      if (!hasTargets && !hasProducts) {
        umbrellaNames.add(parsed.name);
        continue;
      }

      nodes.push({
        id: parsed.name,
        label: parsed.name,
        type: 'package',
        fullPath: dirname(pkgPath),
        targetCount: parsed.targets.length,
      });

      for (const t of parsed.targets) {
        nodes.push({
          id: t.name,
          label: t.name,
          type: 'target',
          parent: parsed.name,
          targetType: t.type,
        });
        targetToPkg.set(t.name, parsed.name);
      }

      for (const prod of parsed.products || []) {
        if (!targetToPkg.has(prod.name)) {
          targetToPkg.set(prod.name, parsed.name);
        }
      }
    }

    for (const parsed of allParsed) {
      if (umbrellaNames.has(parsed.name)) {
        continue;
      }

      for (const dep of parsed.dependencies || []) {
        if (dep.type === 'local' && 'path' in dep && dep.path) {
          const depPkgSwift = join(parsed._dir, dep.path, 'Package.swift');
          if (await sourceExists(this.sourceReader, depPkgSwift)) {
            try {
              const depParsed = await this.#parsePackageSwift(depPkgSwift);
              if (!umbrellaNames.has(depParsed.name)) {
                edges.push({ from: parsed.name, to: depParsed.name, type: 'depends_on' });
              }
            } catch {
              const targetName = basename(dep.path);
              if (!umbrellaNames.has(targetName)) {
                edges.push({ from: parsed.name, to: targetName, type: 'depends_on' });
              }
            }
          }
        } else if ('url' in dep && dep.url) {
          const remoteName = basename(dep.url).replace(/\.git$/, '');
          if (!pkgNameSet.has(remoteName)) {
            pkgNameSet.add(remoteName);
            nodes.push({ id: remoteName, label: remoteName, type: 'remote', indirect: true });
          }
          edges.push({ from: parsed.name, to: remoteName, type: 'depends_on' });
        }
      }

      for (const t of parsed.targets || []) {
        edges.push({ from: parsed.name, to: t.name, type: 'contains' });

        for (const depName of t.dependencies || []) {
          if (!umbrellaNames.has(depName)) {
            edges.push({ from: t.name, to: depName, type: 'depends_on' });
          }
        }
      }
    }

    return { nodes, edges };
  }

  // ─────────────── Private Helpers ───────────────

  /** 向下递归扫描所有 Package.swift（支持多 Package 项目） */
  async #findAllPackageSwifts(rootDir: string): Promise<string[]> {
    const results: string[] = [];

    const scan = async (dir: string, depth = 0): Promise<void> => {
      if (depth > 5) {
        return;
      }
      try {
        const entries = await this.sourceReader.readDirectory(dir);
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) {
              continue;
            }
            await scan(join(dir, entry.name), depth + 1);
          } else if (entry.name === 'Package.swift') {
            results.push(join(dir, entry.name));
          }
        }
      } catch {
        // 权限错误等，跳过
      }
    };

    await scan(rootDir);
    return results;
  }

  /** 读取并解析 Package.swift；解析规则在 shared/SwiftPackageManifest。 */
  async #parsePackageSwift(packagePath: string): Promise<ParsedPackage> {
    if (!packagePath || !(await sourceExists(this.sourceReader, packagePath))) {
      throw new Error(`Package.swift not found: ${packagePath}`);
    }

    const content = await readSourceText(this.sourceReader, packagePath);
    return { path: packagePath, ...parseSwiftPackageManifest(content) };
  }

  async #walkSourceFiles(dir: string) {
    const CODE_EXTS = new Set(['.swift', '.m', '.h', '.c', '.cpp', '.mm']);
    const SKIP_DIRS = new Set([
      'node_modules',
      '.git',
      'dist',
      'build',
      '.build',
      'DerivedData',
      'Pods',
      'Carthage',
    ]);
    const MAX_FILES = 300;
    const files: { name: string; path: string; relativePath: string }[] = [];

    const walk = async (d: string, rel = ''): Promise<void> => {
      if (files.length >= MAX_FILES) {
        return;
      }
      let entries: string[];
      try {
        // 原遍历逐项 stat（会跟随符号链接）；只替换读取入口，不改目录判定和预算。
        entries = (await this.sourceReader.readDirectory(d)).map((entry) => entry.name);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (files.length >= MAX_FILES) {
          break;
        }
        if (entry.startsWith('.')) {
          continue;
        }
        const full = join(d, entry);
        const relPath = rel ? `${rel}/${entry}` : entry;
        let st: ProjectSourceStat;
        try {
          st = await this.sourceReader.stat(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (!SKIP_DIRS.has(entry)) {
            await walk(full, relPath);
          }
        } else if (CODE_EXTS.has(extname(entry).toLowerCase())) {
          if (st.size <= 512 * 1024) {
            files.push({ name: entry, path: full, relativePath: relPath });
          }
        }
      }
    };
    await walk(dir);
    return files;
  }

  #inferLang(filePath: string) {
    return LanguageService.inferLang(filePath);
  }
}
