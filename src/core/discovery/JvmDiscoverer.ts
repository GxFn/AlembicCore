/**
 * @module JvmDiscoverer
 * @description Java / Kotlin 项目结构发现器
 *
 * 检测信号: build.gradle, build.gradle.kts, pom.xml, settings.gradle
 * 支持: Gradle (单模块/多模块), Maven (单模块/多模块)
 *
 * ⚠️ 不尝试精确解析 Gradle DSL，仅用正则启发式提取关键信息
 */

import { basename, extname, join, relative, resolve } from 'node:path';
import {
  readSourceText,
  someSourceExists,
  sourceExists,
} from '../../infrastructure/io/ProjectSourceReader.js';
import { LanguageService } from '../../shared/LanguageService.js';
import {
  type DependencyGraph,
  type DiscoveredFile,
  type DiscoveredTarget,
  ProjectDiscoverer,
} from './ProjectDiscoverer.js';
import { createSourceScanExcludeDirs } from './SourceScanExclusions.js';

const SOURCE_EXTENSIONS = new Set(['.java', '.kt', '.kts']);
const EXCLUDE_DIRS = createSourceScanExcludeDirs(['.gradle', '.kotlin']);

export class JvmDiscoverer extends ProjectDiscoverer {
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: 完整复制迁移保留 JVM discoverer 的项目根状态槽位。
  #projectRoot: string | null = null;
  #targets: DiscoveredTarget[] = [];
  #depGraph: DependencyGraph = { nodes: [], edges: [] };
  #buildSystem: string | null = null; // 'gradle' | 'maven'

  override get supportsSourceReader() {
    return true;
  }

  get id() {
    return 'jvm';
  }
  get displayName() {
    return `JVM (${this.#buildSystem === 'maven' ? 'Maven' : 'Gradle'})`;
  }

  async detect(projectRoot: string) {
    let confidence = 0;
    const reasons: string[] = [];

    // Gradle
    if (
      (await sourceExists(this.sourceReader, join(projectRoot, 'build.gradle'))) ||
      (await sourceExists(this.sourceReader, join(projectRoot, 'build.gradle.kts')))
    ) {
      confidence = 0.9;
      reasons.push('build.gradle(.kts) exists');
    }
    if (
      (await sourceExists(this.sourceReader, join(projectRoot, 'settings.gradle'))) ||
      (await sourceExists(this.sourceReader, join(projectRoot, 'settings.gradle.kts')))
    ) {
      confidence = Math.max(confidence, 0.85);
      confidence = Math.min(confidence + 0.05, 1.0);
      reasons.push('settings.gradle(.kts) exists');
    }

    // Maven
    if (await sourceExists(this.sourceReader, join(projectRoot, 'pom.xml'))) {
      confidence = Math.max(confidence, 0.85);
      reasons.push('pom.xml exists');
    }

    return {
      match: confidence > 0,
      confidence: Math.min(confidence, 1.0),
      reason: reasons.join(', ') || 'No JVM markers found',
    };
  }

  async load(projectRoot: string) {
    this.#projectRoot = projectRoot;
    this.#targets = [];
    this.#depGraph = { nodes: [], edges: [] };

    // 判断构建系统
    const hasGradle =
      (await sourceExists(this.sourceReader, join(projectRoot, 'build.gradle'))) ||
      (await sourceExists(this.sourceReader, join(projectRoot, 'build.gradle.kts')));
    const hasMaven = await sourceExists(this.sourceReader, join(projectRoot, 'pom.xml'));

    if (hasGradle) {
      this.#buildSystem = 'gradle';
      await this.#loadGradle(projectRoot);
    } else if (hasMaven) {
      this.#buildSystem = 'maven';
      await this.#loadMaven(projectRoot);
    }
  }

  async listTargets() {
    return this.#targets;
  }

  async getTargetFiles(target: DiscoveredTarget) {
    const targetObj =
      typeof target === 'string' ? this.#targets.find((t) => t.name === target) : target;

    if (!targetObj?.path || !(await sourceExists(this.sourceReader, targetObj.path))) {
      return [];
    }

    const files: DiscoveredFile[] = [];
    // JVM 约定: src/main/java, src/main/kotlin, src/test/java, src/test/kotlin
    const sourceDirs = [
      join(targetObj.path, 'src', 'main', 'java'),
      join(targetObj.path, 'src', 'main', 'kotlin'),
      join(targetObj.path, 'src', 'test', 'java'),
      join(targetObj.path, 'src', 'test', 'kotlin'),
    ];

    // 也支持非标准布局 — 直接在 target 路径下搜索
    const hasSrcDir = await someSourceExists(this.sourceReader, sourceDirs);
    if (hasSrcDir) {
      for (const srcDir of sourceDirs) {
        if (await sourceExists(this.sourceReader, srcDir)) {
          await this.#collectFiles(srcDir, targetObj.path, files);
        }
      }
    } else {
      await this.#collectFiles(targetObj.path, targetObj.path, files);
    }

    return files;
  }

  async getDependencyGraph() {
    return this.#depGraph;
  }

  // ── Gradle ──

  async #loadGradle(projectRoot: string) {
    // 解析 settings.gradle 找子模块
    const submodules = await this.#parseGradleSettings(projectRoot);

    if (submodules.length > 0) {
      // 多模块 Gradle 项目
      for (const mod of submodules) {
        const modPath = resolve(projectRoot, mod.replace(/:/g, '/'));
        if (!(await sourceExists(this.sourceReader, modPath))) {
          continue;
        }

        const framework = await this.#detectGradleFramework(modPath);
        const lang = await this.#detectPrimaryLang(modPath);

        this.#targets.push({
          name: mod,
          path: modPath,
          type: await this.#inferGradleTargetType(modPath, mod),
          language: lang,
          framework,
          metadata: { buildSystem: 'gradle', module: mod },
        });
        this.#depGraph.nodes.push(mod);
      }

      // 提取模块间依赖
      await this.#parseGradleModuleDeps(projectRoot, submodules);
    } else {
      // 单模块 Gradle 项目
      const framework = await this.#detectGradleFramework(projectRoot);
      const lang = await this.#detectPrimaryLang(projectRoot);
      const name = basename(projectRoot);

      this.#targets.push({
        name,
        path: projectRoot,
        type: 'app',
        language: lang,
        framework,
        metadata: { buildSystem: 'gradle' },
      });
      this.#depGraph.nodes.push(name);
    }

    // 提取外部依赖
    await this.#parseGradleExternalDeps(projectRoot);
  }

  async #parseGradleSettings(projectRoot: string) {
    const modules: string[] = [];
    for (const fname of ['settings.gradle', 'settings.gradle.kts']) {
      const settingsPath = join(projectRoot, fname);
      if (!(await sourceExists(this.sourceReader, settingsPath))) {
        continue;
      }

      try {
        const content = await readSourceText(this.sourceReader, settingsPath);
        // include ':app', ':lib:core', ...
        const includeMatches = content.matchAll(
          /include\s*\(?\s*((?:['"][^'"]+['"](?:\s*,\s*)?)+)/g
        );
        for (const m of includeMatches) {
          // 重复捕获组只留下末项，先取整个字面量列表再逐项读取。
          for (const entry of m[1].matchAll(/['"]([^'"]+)['"]/g)) {
            modules.push(entry[1].replace(/^:/, ''));
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }
        /* skip */
      }
    }
    return [...new Set(modules)];
  }

  async #detectGradleFramework(dir: string) {
    for (const fname of ['build.gradle', 'build.gradle.kts']) {
      const buildPath = join(dir, fname);
      if (!(await sourceExists(this.sourceReader, buildPath))) {
        continue;
      }
      try {
        const content = await readSourceText(this.sourceReader, buildPath);
        if (/com\.android|android\s*\{|apply.*android/.test(content)) {
          return 'android';
        }
        if (/org\.springframework|spring-boot/.test(content)) {
          return 'spring';
        }
        if (/io\.ktor/.test(content)) {
          return 'ktor';
        }
        if (/org\.jetbrains\.compose/.test(content)) {
          return 'compose';
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }
        /* skip */
      }
    }
    return null;
  }

  async #inferGradleTargetType(dir: string, name: string) {
    for (const fname of ['build.gradle', 'build.gradle.kts']) {
      const buildPath = join(dir, fname);
      if (!(await sourceExists(this.sourceReader, buildPath))) {
        continue;
      }
      try {
        const content = await readSourceText(this.sourceReader, buildPath);
        if (/application|com\.android\.application/.test(content)) {
          return 'app';
        }
        if (/java-library|com\.android\.library/.test(content)) {
          return 'library';
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }
        /* skip */
      }
    }
    if (/test/i.test(name)) {
      return 'test';
    }
    return 'library';
  }

  async #parseGradleModuleDeps(projectRoot: string, submodules: string[]) {
    const moduleSet = new Set(submodules);
    for (const mod of submodules) {
      const modPath = resolve(projectRoot, mod.replace(/:/g, '/'));
      for (const fname of ['build.gradle', 'build.gradle.kts']) {
        const buildPath = join(modPath, fname);
        if (!(await sourceExists(this.sourceReader, buildPath))) {
          continue;
        }
        try {
          const content = await readSourceText(this.sourceReader, buildPath);
          // project(':lib:core'), project(":lib:core")
          const projDeps = content.matchAll(/project\s*\(\s*['"][:.]?([^'"]+)['"]\s*\)/g);
          for (const m of projDeps) {
            const depMod = m[1].replace(/^:/, '');
            if (moduleSet.has(depMod)) {
              this.#depGraph.edges.push({ from: mod, to: depMod, type: 'depends_on' });
            }
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            throw error;
          }
          /* skip */
        }
      }
    }
  }

  async #parseGradleExternalDeps(projectRoot: string) {
    for (const fname of ['build.gradle', 'build.gradle.kts']) {
      const buildPath = join(projectRoot, fname);
      if (!(await sourceExists(this.sourceReader, buildPath))) {
        continue;
      }
      try {
        const content = await readSourceText(this.sourceReader, buildPath);
        const rootTarget = this.#targets[0]?.name;
        if (!rootTarget) {
          return;
        }

        // implementation 'group:artifact:version' or implementation("group:artifact:version")
        const depMatches = content.matchAll(
          /(?:implementation|api|compileOnly|runtimeOnly)\s*[("']+([^)'"]+)[)'"]+/g
        );
        for (const m of depMatches) {
          const parts = m[1].split(':');
          if (parts.length >= 2) {
            const depName = `${parts[0]}:${parts[1]}`;
            this.#depGraph.edges.push({ from: rootTarget, to: depName, type: 'depends_on' });
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }
        /* skip */
      }
    }
  }

  // ── Maven ──

  async #loadMaven(projectRoot: string) {
    const pomPath = join(projectRoot, 'pom.xml');
    if (!(await sourceExists(this.sourceReader, pomPath))) {
      return;
    }

    const pomContent = await readSourceText(this.sourceReader, pomPath);
    const projectName = this.#extractXmlValue(pomContent, 'artifactId') || basename(projectRoot);

    // 提取子模块
    const modules = this.#parseMavenModules(pomContent);

    if (modules.length > 0) {
      for (const mod of modules) {
        const modPath = resolve(projectRoot, mod);
        if (!(await sourceExists(this.sourceReader, modPath))) {
          continue;
        }

        const lang = await this.#detectPrimaryLang(modPath);
        const framework = await this.#detectMavenFramework(modPath);

        this.#targets.push({
          name: mod,
          path: modPath,
          type: /test/i.test(mod) ? 'test' : 'library',
          language: lang,
          framework,
          metadata: { buildSystem: 'maven', module: mod },
        });
        this.#depGraph.nodes.push(mod);
      }
    } else {
      const lang = await this.#detectPrimaryLang(projectRoot);
      const framework = await this.#detectMavenFramework(projectRoot);

      this.#targets.push({
        name: projectName,
        path: projectRoot,
        type: 'app',
        language: lang,
        framework,
        metadata: { buildSystem: 'maven' },
      });
      this.#depGraph.nodes.push(projectName);
    }

    // 提取外部依赖
    this.#parseMavenDeps(pomContent);
  }

  #parseMavenModules(pomContent: string) {
    const modules: string[] = [];
    const moduleMatches = pomContent.matchAll(/<module>([^<]+)<\/module>/g);
    for (const m of moduleMatches) {
      modules.push(m[1].trim());
    }
    return modules;
  }

  async #detectMavenFramework(dir: string) {
    const pomPath = join(dir, 'pom.xml');
    if (!(await sourceExists(this.sourceReader, pomPath))) {
      return null;
    }
    try {
      const content = await readSourceText(this.sourceReader, pomPath);
      if (/spring-boot|springframework/.test(content)) {
        return 'spring';
      }
      if (/android/.test(content)) {
        return 'android';
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      /* skip */
    }
    return null;
  }

  #parseMavenDeps(pomContent: string) {
    const rootTarget = this.#targets[0]?.name;
    if (!rootTarget) {
      return;
    }

    // 简化: 提取 <dependency> 中的 groupId:artifactId
    const depBlocks = pomContent.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g);
    for (const block of depBlocks) {
      const groupId = this.#extractXmlValue(block[1], 'groupId');
      const artifactId = this.#extractXmlValue(block[1], 'artifactId');
      if (groupId && artifactId) {
        this.#depGraph.edges.push({
          from: rootTarget,
          to: `${groupId}:${artifactId}`,
          type: 'depends_on',
        });
      }
    }
  }

  // ── 共用工具 ──

  async #detectPrimaryLang(dir: string) {
    let javaCount = 0;
    let kotlinCount = 0;

    const srcMain = join(dir, 'src', 'main');
    if (await sourceExists(this.sourceReader, join(srcMain, 'kotlin'))) {
      kotlinCount += 10;
    }
    if (await sourceExists(this.sourceReader, join(srcMain, 'java'))) {
      javaCount += 10;
    }

    // 快速采样
    const srcDirs = [join(srcMain, 'java'), join(srcMain, 'kotlin'), dir];
    for (const sd of srcDirs) {
      if (!(await sourceExists(this.sourceReader, sd))) {
        continue;
      }
      try {
        const files = (await this.sourceReader.readDirectory(sd))
          .map((entry) => entry.name)
          .slice(0, 20);
        for (const f of files) {
          if (f.endsWith('.kt') || f.endsWith('.kts')) {
            kotlinCount++;
          }
          if (f.endsWith('.java')) {
            javaCount++;
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }
        /* skip */
      }
    }

    return kotlinCount > javaCount ? 'kotlin' : 'java';
  }

  async #collectFiles(dir: string, rootDir: string, files: DiscoveredFile[], depth = 0) {
    if (depth > 15) {
      return;
    }
    try {
      const entries = await this.sourceReader.readDirectory(dir);
      for (const entry of entries) {
        if (entry.name.startsWith('.')) {
          continue;
        }
        if (EXCLUDE_DIRS.has(entry.name)) {
          continue;
        }

        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.#collectFiles(fullPath, rootDir, files, depth + 1);
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (SOURCE_EXTENSIONS.has(ext)) {
            files.push({
              name: entry.name,
              path: fullPath,
              relativePath: relative(rootDir, fullPath),
              language: LanguageService.inferLang(entry.name),
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

  #extractXmlValue(xml: string, tag: string) {
    const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return match ? match[1].trim() : null;
  }
}
