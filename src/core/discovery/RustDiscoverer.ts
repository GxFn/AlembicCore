/**
 * @module RustDiscoverer
 * @description Rust 项目结构发现器
 *
 * 检测信号: Cargo.toml, Cargo.lock, *.rs
 * 支持: 单 crate 项目、Cargo workspace（多 crate）、标准目录布局 (src/ tests/ benches/ examples/)
 */

import { basename, extname, join, relative } from 'node:path';
import { readSourceText, sourceExists } from '../../infrastructure/io/ProjectSourceReader.js';
import {
  type DependencyGraph,
  type DiscoveredFile,
  type DiscoveredTarget,
  ProjectDiscoverer,
} from './ProjectDiscoverer.js';
import { createSourceScanExcludeDirs } from './SourceScanExclusions.js';

const SOURCE_EXTENSIONS = new Set(['.rs']);

const EXCLUDE_DIRS = createSourceScanExcludeDirs(['.cargo']);

export class RustDiscoverer extends ProjectDiscoverer {
  #projectRoot: string | null = null;
  #targets: DiscoveredTarget[] = [];
  #depGraph: DependencyGraph = { nodes: [], edges: [] };
  #crateName: string | null = null;

  override get supportsSourceReader() {
    return true;
  }

  get id() {
    return 'rust';
  }
  get displayName() {
    return 'Rust (Cargo)';
  }

  async detect(projectRoot: string) {
    let confidence = 0;
    const reasons: string[] = [];

    if (await sourceExists(this.sourceReader, join(projectRoot, 'Cargo.toml'))) {
      confidence = 0.92;
      reasons.push('Cargo.toml exists');
    }
    if (await sourceExists(this.sourceReader, join(projectRoot, 'Cargo.lock'))) {
      confidence = Math.max(confidence, 0.7);
      if (confidence < 0.92) {
        confidence += 0.1;
      }
      reasons.push('Cargo.lock exists');
    }
    if (
      (await sourceExists(this.sourceReader, join(projectRoot, 'rust-toolchain.toml'))) ||
      (await sourceExists(this.sourceReader, join(projectRoot, 'rust-toolchain')))
    ) {
      confidence = Math.max(confidence, 0.85);
      reasons.push('rust-toolchain exists');
    }

    // 兜底: 根目录有 .rs 文件
    if (confidence === 0) {
      try {
        const entries = (await this.sourceReader.readDirectory(projectRoot)).map(
          (entry) => entry.name
        );
        if (entries.some((e) => e.endsWith('.rs'))) {
          confidence = 0.5;
          reasons.push('*.rs files found at root');
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }
        /* skip */
      }
    }

    return {
      match: confidence > 0,
      confidence: Math.min(confidence, 1.0),
      reason: reasons.join(', ') || 'No Rust markers found',
    };
  }

  async load(projectRoot: string) {
    this.#projectRoot = projectRoot;
    this.#targets = [];
    this.#depGraph = { nodes: [], edges: [] };

    // 解析 Cargo.toml
    const cargoInfo = await this.#parseCargoToml(projectRoot);
    this.#crateName = cargoInfo?.name || basename(projectRoot);

    const framework = await this.#detectFramework(projectRoot);

    // 主 Target
    this.#targets.push({
      name: this.#crateName,
      path: projectRoot,
      type: cargoInfo?.isBin ? 'application' : 'library',
      language: 'rust',
      framework,
      metadata: {
        edition: cargoInfo?.edition || null,
        crateName: this.#crateName,
      },
    });
    this.#depGraph.nodes.push(this.#crateName);

    // Cargo workspace — 发现成员 crate
    const workspaceMembers = await this.#discoverWorkspaceMembers(projectRoot);
    for (const member of workspaceMembers) {
      this.#targets.push(member);
      this.#depGraph.nodes.push(member.name);
    }

    // examples/ 下的二进制示例
    await this.#discoverExamples(projectRoot, framework);

    // benches/ 下的 benchmark
    await this.#discoverBenches(projectRoot);

    // tests/ 集成测试
    const testsDir = join(projectRoot, 'tests');
    if (await sourceExists(this.sourceReader, testsDir)) {
      this.#targets.push({
        name: 'tests',
        path: testsDir,
        type: 'test',
        language: 'rust',
      });
    }

    // 解析依赖
    await this.#parseDependencies(projectRoot);

    // 发现内部模块
    await this.#discoverInternalModules(projectRoot);
  }

  async listTargets() {
    return this.#targets;
  }

  async getTargetFiles(target: DiscoveredTarget) {
    const targetPath =
      typeof target === 'string'
        ? this.#targets.find((t) => t.name === target)?.path || this.#projectRoot
        : target.path;

    if (!targetPath || !(await sourceExists(this.sourceReader, targetPath))) {
      return [];
    }

    const files: DiscoveredFile[] = [];
    await this.#collectRsFiles(targetPath, targetPath, files);
    return files;
  }

  async getDependencyGraph() {
    return this.#depGraph;
  }

  // ── 内部实现 ──

  /** 简易解析 Cargo.toml（无 TOML 解析器，使用正则） */
  async #parseCargoToml(projectRoot: string) {
    const cargoPath = join(projectRoot, 'Cargo.toml');
    if (!(await sourceExists(this.sourceReader, cargoPath))) {
      return null;
    }

    try {
      const content = await readSourceText(this.sourceReader, cargoPath);
      const name = content.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
      const edition = content.match(/^\s*edition\s*=\s*"([^"]+)"/m)?.[1];

      // 判断是 bin 还是 lib
      const hasMainRs = await sourceExists(this.sourceReader, join(projectRoot, 'src', 'main.rs'));
      const hasLibRs = await sourceExists(this.sourceReader, join(projectRoot, 'src', 'lib.rs'));
      const hasBinSection = /\[\[bin\]\]/.test(content);

      return {
        name,
        edition,
        isBin: hasMainRs || hasBinSection,
        isLib: hasLibRs,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      return null;
    }
  }

  /** 发现 Cargo workspace 成员 */
  async #discoverWorkspaceMembers(projectRoot: string) {
    const cargoPath = join(projectRoot, 'Cargo.toml');
    if (!(await sourceExists(this.sourceReader, cargoPath))) {
      return [];
    }

    try {
      const content = await readSourceText(this.sourceReader, cargoPath);

      // [workspace] members = ["crate_a", "crate_b", "crates/*"]
      const workspaceBlock = content.match(/\[workspace\]([\s\S]*?)(?:\n\[|\s*$)/);
      if (!workspaceBlock) {
        return [];
      }

      const membersLine = workspaceBlock[1].match(/members\s*=\s*\[([\s\S]*?)\]/);
      if (!membersLine) {
        return [];
      }

      const memberPatterns = membersLine[1]
        .split(',')
        .map((s) => s.replace(/["\s]/g, ''))
        .filter(Boolean);

      const members: DiscoveredTarget[] = [];
      for (const pattern of memberPatterns) {
        if (pattern.includes('*')) {
          // Glob — 展开
          const prefix = pattern.replace('/*', '');
          const parentDir = join(projectRoot, prefix);
          if (!(await sourceExists(this.sourceReader, parentDir))) {
            continue;
          }
          try {
            const entries = await this.sourceReader.readDirectory(parentDir);
            for (const entry of entries) {
              if (entry.isDirectory() && !entry.name.startsWith('.')) {
                const memberPath = join(parentDir, entry.name);
                if (await sourceExists(this.sourceReader, join(memberPath, 'Cargo.toml'))) {
                  const info = await this.#parseCargoToml(memberPath);
                  members.push({
                    name: info?.name || entry.name,
                    path: memberPath,
                    type: info?.isBin ? 'application' : 'library',
                    language: 'rust',
                    metadata: {
                      edition: info?.edition,
                      isWorkspaceMember: true,
                    },
                  });
                }
              }
            }
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              throw error;
            }
            /* skip */
          }
        } else {
          const memberPath = join(projectRoot, pattern);
          if (await sourceExists(this.sourceReader, join(memberPath, 'Cargo.toml'))) {
            const info = await this.#parseCargoToml(memberPath);
            members.push({
              name: info?.name || basename(pattern),
              path: memberPath,
              type: info?.isBin ? 'application' : 'library',
              language: 'rust',
              metadata: {
                edition: info?.edition,
                isWorkspaceMember: true,
              },
            });
          }
        }
      }

      return members;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      return [];
    }
  }

  /** 发现 examples/ 目录 */
  async #discoverExamples(projectRoot: string, framework: string | null) {
    const examplesDir = join(projectRoot, 'examples');
    if (!(await sourceExists(this.sourceReader, examplesDir))) {
      return;
    }

    try {
      const entries = await this.sourceReader.readDirectory(examplesDir);
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.rs')) {
          // 单文件示例不作为独立 target，只记录目录
        } else if (entry.isDirectory()) {
          const subDir = join(examplesDir, entry.name);
          if (await sourceExists(this.sourceReader, join(subDir, 'main.rs'))) {
            this.#targets.push({
              name: `examples/${entry.name}`,
              path: subDir,
              type: 'example',
              language: 'rust',
              framework,
            });
          }
        }
      }
      // 如果有任何 .rs 文件，添加整个 examples 目录
      if (entries.some((e) => e.isFile() && e.name.endsWith('.rs'))) {
        this.#targets.push({
          name: 'examples',
          path: examplesDir,
          type: 'example',
          language: 'rust',
        });
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      /* skip */
    }
  }

  /** 发现 benches/ 目录 */
  async #discoverBenches(projectRoot: string) {
    const benchDir = join(projectRoot, 'benches');
    if (!(await sourceExists(this.sourceReader, benchDir))) {
      return;
    }

    try {
      const entries = (await this.sourceReader.readDirectory(benchDir)).map((entry) => entry.name);
      if (entries.some((e) => e.endsWith('.rs'))) {
        this.#targets.push({
          name: 'benches',
          path: benchDir,
          type: 'benchmark',
          language: 'rust',
        });
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      /* skip */
    }
  }

  /** 检测 Rust Web/网络框架 */
  async #detectFramework(projectRoot: string) {
    const cargoPath = join(projectRoot, 'Cargo.toml');
    if (!(await sourceExists(this.sourceReader, cargoPath))) {
      return null;
    }

    try {
      const content = await readSourceText(this.sourceReader, cargoPath);

      if (/\bactix-web\b/.test(content)) {
        return 'actix-web';
      }
      if (/\baxum\b/.test(content)) {
        return 'axum';
      }
      if (/\brocket\b/.test(content)) {
        return 'rocket';
      }
      if (/\bwarp\b/.test(content)) {
        return 'warp';
      }
      if (/\btokio\b/.test(content) && /\bhyper\b/.test(content)) {
        return 'hyper';
      }
      if (/\btokio\b/.test(content)) {
        return 'tokio';
      }
      if (/\basync-std\b/.test(content)) {
        return 'async-std';
      }
      if (/\btauri\b/.test(content)) {
        return 'tauri';
      }
      if (/\bbevy\b/.test(content)) {
        return 'bevy';
      }
      if (/\bclap\b/.test(content)) {
        return 'clap-cli';
      }
      if (/\bserde\b/.test(content)) {
        return 'serde';
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      /* skip */
    }

    return null;
  }

  /** 解析 Cargo.toml 的 [dependencies] 到 depGraph */
  async #parseDependencies(projectRoot: string) {
    const cargoPath = join(projectRoot, 'Cargo.toml');
    if (!(await sourceExists(this.sourceReader, cargoPath))) {
      return;
    }

    const nodeSet = new Set(this.#depGraph.nodes.map((n) => (typeof n === 'string' ? n : n.id)));
    const rootNode =
      typeof this.#depGraph.nodes[0] === 'string'
        ? this.#depGraph.nodes[0]
        : this.#depGraph.nodes[0]?.id || 'root';

    try {
      const content = await readSourceText(this.sourceReader, cargoPath);

      // 匹配 [dependencies] 和 [dev-dependencies] 块
      const depSections = content.matchAll(
        /\[((?:dev-|build-)?dependencies)\]([\s\S]*?)(?=\n\[|$)/g
      );

      for (const section of depSections) {
        const sectionType = section[1];
        const isDev = sectionType.startsWith('dev-');
        const isBuild = sectionType.startsWith('build-');
        const lines = section[2].split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) {
            continue;
          }

          // dep = "version" 或 dep = { version = "...", ... }
          const depMatch = trimmed.match(/^(\S+)\s*=/);
          if (depMatch) {
            const depName = depMatch[1].replace(/"/g, '');
            if (!nodeSet.has(depName)) {
              this.#depGraph.nodes.push({
                id: depName,
                label: depName,
                type: 'external',
                isDev,
                isBuild,
              });
              nodeSet.add(depName);
            }
            this.#depGraph.edges.push({
              from: rootNode,
              to: depName,
              type: isDev ? 'dev-dependency' : isBuild ? 'build-dependency' : 'dependency',
            });
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      /* skip */
    }
  }

  /** 发现内部模块（src/ 子目录） */
  async #discoverInternalModules(projectRoot: string) {
    const srcDir = join(projectRoot, 'src');
    if (!(await sourceExists(this.sourceReader, srcDir))) {
      return;
    }

    const nodeSet = new Set(this.#depGraph.nodes.map((n) => (typeof n === 'string' ? n : n.id)));

    const walk = async (dir: string, relPath: string, depth: number): Promise<void> => {
      if (depth > 6) {
        return;
      }
      try {
        const entries = await this.sourceReader.readDirectory(dir);
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith('.') || EXCLUDE_DIRS.has(entry.name)) {
            continue;
          }
          const subDir = join(dir, entry.name);
          const subRel = relPath ? `${relPath}/${entry.name}` : entry.name;

          try {
            const subEntries = (await this.sourceReader.readDirectory(subDir)).map(
              (entry) => entry.name
            );
            const hasRsFiles = subEntries.some((e) => e.endsWith('.rs'));
            if (hasRsFiles && !nodeSet.has(subRel)) {
              this.#depGraph.nodes.push({ id: subRel, label: subRel, type: 'internal' });
              nodeSet.add(subRel);
            }
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              throw error;
            }
            /* skip */
          }

          await walk(subDir, subRel, depth + 1);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }
        /* skip */
      }
    };

    await walk(srcDir, '', 0);
  }

  /** 递归收集 .rs 文件 */
  async #collectRsFiles(dir: string, rootDir: string, files: DiscoveredFile[], depth = 0) {
    if (depth > 15) {
      return;
    }

    try {
      const entries = await this.sourceReader.readDirectory(dir);
      for (const entry of entries) {
        if (entry.name.startsWith('.')) {
          continue;
        }

        if (entry.isDirectory()) {
          if (EXCLUDE_DIRS.has(entry.name)) {
            continue;
          }
          await this.#collectRsFiles(join(dir, entry.name), rootDir, files, depth + 1);
        } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
          const fullPath = join(dir, entry.name);
          try {
            const content = await readSourceText(this.sourceReader, fullPath);
            files.push({
              name: entry.name,
              path: fullPath,
              relativePath: relative(rootDir, fullPath),
              language: 'rust',
              content,
            });
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              throw error;
            }
            /* unreadable */
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      /* permission error */
    }
  }
}
