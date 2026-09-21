/**
 * @module CustomConfigDiscoverer
 * @description 自研配置文件发现器 — 识别使用非标准/自研构建系统的项目
 *
 * 两级检测策略：
 *  Level 1: 已知自研工具指纹匹配 (confidence 0.70-0.80)
 *  Level 2: 启发式目录结构探测 (confidence 0.50-0.65)
 *
 * 当前支持：
 *  - Baidu EasyBox (Boxfile + *.boxspec)
 *  - Tuist (Project.swift)
 *  - XcodeGen (project.yml)
 */

import { dirname, extname, join, relative, sep } from 'node:path';
import {
  everySourceExists,
  readSourceText,
  someSourceExists,
  sourceExists,
} from '../../infrastructure/io/ProjectSourceReader.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { LanguageService } from '../../shared/LanguageService.js';
import type { ProjectSourceReader } from '../../types/projectSourceReader.js';
import {
  type DependencyGraph,
  type DependencyGraphLayer,
  type DiscoveredFile,
  type DiscoveredTarget,
  ProjectDiscoverer,
} from './ProjectDiscoverer.js';
import { locateProjectSpec } from './ProjectSpecLocator.js';
import { parseCMakeProject } from './parsers/CMakeParser.js';
import { inferConventionRole, parseGradleProject } from './parsers/GradleDslParser.js';
import {
  parseFlutterPluginsDeps,
  parseNxWorkspace,
  parseReactNativeProject,
} from './parsers/JsonConfigParser.js';
import {
  type ParsedLayer,
  type ParsedModuleSpec,
  type ParsedProjectConfig,
  parseBoxfile,
  parseModuleSpec,
} from './parsers/RubyDslParser.js';
import {
  type ParsedBuildFile,
  parseStarlarkBuildFile,
  RULE_TO_LANGUAGE,
} from './parsers/StarlarkParser.js';
import {
  parseMelosProject,
  parseXcodeGenProject,
  parseXcodeGenTarget,
} from './parsers/YamlConfigParser.js';
import { createSourceScanExcludeDirs } from './SourceScanExclusions.js';

// ── 已知自研构建系统配置表 ────────────────────────────

interface CustomSystemProfile {
  id: string;
  displayName: string;
  markers: string[];
  markerStrategy?: 'all' | 'any' | 'ordered';
  antiMarkers?: string[];
  moduleSpecPattern: string | null;
  language: readonly string[];
  confidence: number;
  parser: 'ruby-dsl' | 'yaml' | 'swift-dsl' | 'starlark' | 'gradle-dsl' | 'cmake' | 'json-config';
}

const KNOWN_CUSTOM_SYSTEMS: readonly CustomSystemProfile[] = Object.freeze([
  // ── Tier 1: Bazel / Buck2 (Starlark) ──
  {
    id: 'bazel',
    displayName: 'Bazel',
    markers: ['MODULE.bazel', 'WORKSPACE', 'WORKSPACE.bazel'],
    markerStrategy: 'any' as const,
    moduleSpecPattern: 'BUILD.bazel',
    language: Object.freeze([]),
    confidence: 0.85,
    parser: 'starlark' as const,
  },
  {
    id: 'buck2',
    displayName: 'Buck2',
    markers: ['.buckconfig', '.buckroot'],
    markerStrategy: 'any' as const,
    moduleSpecPattern: 'BUCK',
    language: Object.freeze([]),
    confidence: 0.85,
    parser: 'starlark' as const,
  },
  // ── Tier 1: Android Gradle Convention Plugins ──
  {
    id: 'gradle-convention',
    displayName: 'Gradle Convention Plugins',
    markers: ['build-logic/convention/', 'buildSrc/src/main/kotlin/'],
    markerStrategy: 'any' as const,
    moduleSpecPattern: null,
    language: Object.freeze(['kotlin', 'java']),
    confidence: 0.8,
    parser: 'gradle-dsl' as const,
  },
  // ── Tier 1: Flutter Melos ──
  {
    id: 'melos',
    displayName: 'Melos (Flutter Monorepo)',
    markers: ['melos.yaml'],
    moduleSpecPattern: null,
    language: Object.freeze(['dart']),
    confidence: 0.82,
    parser: 'yaml' as const,
  },
  // ── Tier 1: iOS 生态 ──
  {
    id: 'easybox',
    displayName: 'Baidu EasyBox',
    markers: ['Boxfile'],
    moduleSpecPattern: '*.boxspec',
    language: Object.freeze(['objectivec', 'swift']),
    confidence: 0.8,
    parser: 'ruby-dsl' as const,
  },
  {
    id: 'tuist',
    displayName: 'Tuist',
    markers: ['Tuist/Config.swift', 'Project.swift'],
    moduleSpecPattern: null,
    language: Object.freeze(['swift']),
    confidence: 0.8,
    parser: 'swift-dsl' as const,
  },
  {
    id: 'ks-component',
    displayName: 'KSComponent (快手)',
    markers: ['KSPodfile', 'Podfile.ks'],
    markerStrategy: 'any' as const,
    moduleSpecPattern: '*.podspec',
    language: Object.freeze(['swift', 'objectivec']),
    confidence: 0.8,
    parser: 'ruby-dsl' as const,
  },
  {
    id: 'mt-component',
    displayName: 'MTComponent (美团)',
    markers: ['MTModulefile', 'MTConfig.yml'],
    markerStrategy: 'any' as const,
    moduleSpecPattern: '*.podspec',
    language: Object.freeze(['swift', 'objectivec']),
    confidence: 0.78,
    parser: 'ruby-dsl' as const,
  },
  // ── Tier 1: 混合架构 ──
  {
    id: 'flutter-add-to-app',
    displayName: 'Flutter Add-to-App',
    markers: ['.flutter-plugins-dependencies', '.flutter-plugins'],
    markerStrategy: 'any' as const,
    moduleSpecPattern: 'pubspec.yaml',
    language: Object.freeze(['dart']),
    confidence: 0.78,
    parser: 'json-config' as const,
  },
  {
    id: 'react-native-hybrid',
    displayName: 'React Native Hybrid',
    markers: ['metro.config.js', 'metro.config.ts', 'react-native.config.js'],
    markerStrategy: 'any' as const,
    moduleSpecPattern: null,
    language: Object.freeze(['typescript', 'javascript']),
    confidence: 0.78,
    parser: 'json-config' as const,
  },
  {
    id: 'kotlin-multiplatform',
    displayName: 'Kotlin Multiplatform',
    markers: ['shared/build.gradle.kts'],
    moduleSpecPattern: null,
    language: Object.freeze(['kotlin']),
    confidence: 0.78,
    parser: 'gradle-dsl' as const,
  },
  // ── Tier 2: Nx / Pants / CMake ──
  {
    id: 'nx-monorepo',
    displayName: 'Nx Monorepo',
    markers: ['nx.json'],
    moduleSpecPattern: 'project.json',
    language: Object.freeze(['typescript', 'javascript']),
    confidence: 0.8,
    parser: 'json-config' as const,
  },
  {
    id: 'pants',
    displayName: 'Pants Build',
    markers: ['pants.toml'],
    moduleSpecPattern: 'BUILD',
    language: Object.freeze([]),
    confidence: 0.8,
    parser: 'starlark' as const,
  },
  {
    id: 'cmake-multiproject',
    displayName: 'CMake Multi-Project',
    markers: ['CMakeLists.txt'],
    antiMarkers: ['MODULE.bazel', 'WORKSPACE', 'meson.build'],
    moduleSpecPattern: 'CMakeLists.txt',
    language: Object.freeze(['cpp', 'c']),
    confidence: 0.75,
    parser: 'cmake' as const,
  },
  {
    id: 'xcodegen',
    displayName: 'XcodeGen',
    markers: ['project.yml', 'project.yaml'],
    markerStrategy: 'any' as const,
    moduleSpecPattern: null,
    language: Object.freeze(['swift', 'objectivec']),
    confidence: 0.75,
    parser: 'yaml' as const,
  },
]);

// ── 启发式信号 ──────────────────────────────────────

interface HeuristicSignal {
  pattern: RegExp;
  type: 'module-dir' | 'custom-dsl' | 'spec-file' | 'xcode';
  boost: number;
}

const HEURISTIC_SIGNALS: readonly HeuristicSignal[] = Object.freeze([
  { pattern: /^(Local)?Modules?$/i, type: 'module-dir' as const, boost: 0.15 },
  { pattern: /^Packages$/i, type: 'module-dir' as const, boost: 0.1 },
  { pattern: /^[A-Z]\w+file$/, type: 'custom-dsl' as const, boost: 0.2 },
  { pattern: /\.\w+spec$/, type: 'spec-file' as const, boost: 0.2 },
  { pattern: /\.xcodeproj$/, type: 'xcode' as const, boost: 0.05 },
]);

// 排除已知的标准 Ruby DSL 文件
const KNOWN_STANDARD_FILES = new Set([
  'Gemfile',
  'Podfile',
  'Fastfile',
  'Rakefile',
  'Vagrantfile',
  'Guardfile',
  'Brewfile',
  'Berksfile',
  'Capfile',
]);

const EXCLUDE_DIRS = createSourceScanExcludeDirs(['.gradle', '.easybox']);

const SOURCE_EXTENSIONS = new Set(['.m', '.h', '.swift', '.mm', '.c', '.cpp', '.cc']);

// ── User Custom Systems (boxspec.json) ──────────────

/**
 * 从 boxspec.json 读取用户自定义配置系统
 *
 * boxspec.json 中可选字段：
 * ```json
 * {
 *   "customDiscoverer": {
 *     "id": "my-build-tool",
 *     "displayName": "MyBuildTool",
 *     "markers": ["MyBuildfile"],
 *     "moduleSpecPattern": "*.myspec",
 *     "language": ["swift"],
 *     "confidence": 0.85,
 *     "parser": "ruby-dsl"
 *   }
 * }
 * ```
 * 或数组形式支持多个自定义系统。
 */
async function loadUserCustomSystems(
  projectRoot: string,
  sourceReader: ProjectSourceReader
): Promise<CustomSystemProfile[]> {
  try {
    const specPath = await locateProjectSpec(projectRoot, sourceReader);
    if (!(await sourceExists(sourceReader, specPath))) {
      return [];
    }

    const raw = JSON.parse(await readSourceText(sourceReader, specPath));
    const custom = raw?.customDiscoverer;
    if (!custom) {
      return [];
    }

    const items = Array.isArray(custom) ? custom : [custom];
    const results: CustomSystemProfile[] = [];

    for (const item of items) {
      if (!item?.id || !item?.markers || !Array.isArray(item.markers)) {
        continue;
      }

      results.push({
        id: String(item.id),
        displayName: String(item.displayName ?? item.id),
        markers: item.markers.map(String),
        moduleSpecPattern: item.moduleSpecPattern ? String(item.moduleSpecPattern) : null,
        language: Array.isArray(item.language) ? item.language.map(String) : ['swift'],
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.75,
        parser: [
          'ruby-dsl',
          'yaml',
          'swift-dsl',
          'starlark',
          'gradle-dsl',
          'cmake',
          'json-config',
        ].includes(item.parser)
          ? item.parser
          : 'ruby-dsl',
        markerStrategy: ['all', 'any', 'ordered'].includes(item.markerStrategy)
          ? item.markerStrategy
          : undefined,
        antiMarkers: Array.isArray(item.antiMarkers) ? item.antiMarkers.map(String) : undefined,
      });
    }

    return results;
  } catch (error) {
    throwIfSourceControlError(sourceReader, error);
    return [];
  }
}

/**
 * 获取合并后的系统配置表：用户自定义 + 内置
 * 用户自定义系统优先匹配
 */
async function getEffectiveSystemProfiles(
  projectRoot: string,
  sourceReader: ProjectSourceReader
): Promise<readonly CustomSystemProfile[]> {
  const userSystems = await loadUserCustomSystems(projectRoot, sourceReader);
  if (userSystems.length === 0) {
    return KNOWN_CUSTOM_SYSTEMS;
  }
  return [...userSystems, ...KNOWN_CUSTOM_SYSTEMS];
}

// ── CustomConfigDiscoverer ──────────────────────────

export class CustomConfigDiscoverer extends ProjectDiscoverer {
  #projectRoot: string | null = null;
  #matchedSystem: CustomSystemProfile | null = null;
  #parsedConfig: ParsedProjectConfig | null = null;
  #moduleSpecs = new Map<string, ParsedModuleSpec>();
  #targets: DiscoveredTarget[] = [];
  #dependencyEdges: DependencyGraph['edges'] = [];

  override get supportsSourceReader(): boolean {
    return true;
  }

  get id() {
    return 'customConfig';
  }

  get displayName() {
    if (this.#matchedSystem) {
      return `Custom Config (${this.#matchedSystem.displayName})`;
    }
    return 'Custom Config (Heuristic)';
  }

  // ── detect ────────────────────────────────────────

  async detect(projectRoot: string) {
    // Level 1: 已知自研工具指纹匹配（含用户自定义系统）
    const systems = await getEffectiveSystemProfiles(projectRoot, this.sourceReader);
    for (const system of systems) {
      // antiMarkers 排除检查
      if (
        system.antiMarkers &&
        (await someSourceExists(
          this.sourceReader,
          system.antiMarkers.map((am) => join(projectRoot, am))
        ))
      ) {
        continue;
      }

      const strategy = system.markerStrategy ?? 'all';
      let markerFound = false;

      if (strategy === 'any') {
        markerFound = await someSourceExists(
          this.sourceReader,
          system.markers.map((marker) => join(projectRoot, marker))
        );
      } else {
        // 'all' 和 'ordered' 都要求所有 markers 存在（ordered 未来可扩展）
        markerFound = await everySourceExists(
          this.sourceReader,
          system.markers.map((marker) => join(projectRoot, marker))
        );
      }

      if (markerFound) {
        return {
          match: true,
          confidence: system.confidence,
          reason: `${system.displayName} detected (${system.markers.join(', ')})`,
        };
      }
    }

    // Level 2: 启发式目录结构探测
    let heuristicScore = 0.35; // 基础分
    const signals: string[] = [];

    try {
      const entries = await this.sourceReader.readDirectory(projectRoot);

      for (const entry of entries) {
        if (entry.name.startsWith('.')) {
          continue;
        }

        for (const signal of HEURISTIC_SIGNALS) {
          if (signal.pattern.test(entry.name)) {
            // 排除已知的标准文件
            if (signal.type === 'custom-dsl' && KNOWN_STANDARD_FILES.has(entry.name)) {
              continue;
            }

            // 对 module-dir 类型，要求目录内有多个子目录
            if (signal.type === 'module-dir' && entry.isDirectory()) {
              const subCount = await countSubdirsWithSpecs(
                join(projectRoot, entry.name),
                this.sourceReader
              );
              if (subCount < 2) {
                continue;
              }
            }

            heuristicScore += signal.boost;
            signals.push(`${entry.name} (${signal.type})`);
          }
        }
      }
    } catch (error) {
      throwIfSourceControlError(this.sourceReader, error);
      /* skip */
    }

    // 限制最高分
    heuristicScore = Math.min(heuristicScore, 0.65);

    if (heuristicScore >= 0.5 && signals.length >= 2) {
      return {
        match: true,
        confidence: heuristicScore,
        reason: `Heuristic signals: ${signals.join(', ')}`,
      };
    }

    return { match: false, confidence: 0, reason: 'No custom config detected' };
  }

  // ── load ──────────────────────────────────────────

  async load(projectRoot: string) {
    this.#projectRoot = projectRoot;
    this.#parsedConfig = null;
    this.#moduleSpecs.clear();
    this.#targets = [];
    this.#dependencyEdges = [];

    // 确定匹配的系统（含用户自定义系统）
    this.#matchedSystem = null;
    const systems = await getEffectiveSystemProfiles(projectRoot, this.sourceReader);
    for (const system of systems) {
      if (
        system.antiMarkers &&
        (await someSourceExists(
          this.sourceReader,
          system.antiMarkers.map((am) => join(projectRoot, am))
        ))
      ) {
        continue;
      }
      const strategy = system.markerStrategy ?? 'all';
      const markerFound =
        strategy === 'any'
          ? await someSourceExists(
              this.sourceReader,
              system.markers.map((marker) => join(projectRoot, marker))
            )
          : await everySourceExists(
              this.sourceReader,
              system.markers.map((marker) => join(projectRoot, marker))
            );
      if (markerFound) {
        this.#matchedSystem = system;
        break;
      }
    }

    if (!this.#matchedSystem) {
      await this.#loadHeuristic(projectRoot);
      return;
    }

    switch (this.#matchedSystem.parser) {
      case 'ruby-dsl':
        await this.#loadRubyDsl(projectRoot);
        break;
      case 'yaml':
        await this.#loadYaml(projectRoot);
        break;
      case 'starlark':
        await this.#loadStarlark(projectRoot);
        break;
      case 'gradle-dsl':
        await this.#loadGradleDsl(projectRoot);
        break;
      case 'cmake':
        await this.#loadCMake(projectRoot);
        break;
      case 'json-config':
        await this.#loadJsonConfig(projectRoot);
        break;
      default:
        await this.#loadHeuristic(projectRoot);
    }
  }

  // ── listTargets ───────────────────────────────────

  async listTargets(): Promise<DiscoveredTarget[]> {
    return this.#targets;
  }

  // ── getTargetFiles ────────────────────────────────

  async getTargetFiles(target: DiscoveredTarget): Promise<DiscoveredFile[]> {
    const targetPath =
      typeof target === 'string' ? this.#targets.find((t) => t.name === target)?.path : target.path;

    if (!targetPath || !(await sourceExists(this.sourceReader, targetPath))) {
      return [];
    }

    // 如果有 spec 文件，优先使用 sources 字段定位
    const targetName = typeof target === 'string' ? target : target.name;
    const spec = this.#moduleSpecs.get(targetName);

    let sourceDir = targetPath;
    if (spec?.sources) {
      const specSourceDir = join(targetPath, spec.sources);
      if (await sourceExists(this.sourceReader, specSourceDir)) {
        sourceDir = specSourceDir;
      }
    }

    const files: DiscoveredFile[] = [];
    await this.#collectSourceFiles(sourceDir, targetPath, files);
    return files;
  }

  // ── getDependencyGraph ────────────────────────────

  async getDependencyGraph(): Promise<DependencyGraph> {
    if (!this.#parsedConfig) {
      return {
        nodes: this.#targets.map((t) => t.name),
        edges: this.#dependencyEdges.map((edge) => ({ ...edge })),
      };
    }

    const config = this.#parsedConfig;
    const nodes: DependencyGraph['nodes'] = [];
    const edges: DependencyGraph['edges'] = [];
    const nodeIds = new Set<string>();

    // 宿主应用节点
    if (config.hostApp) {
      const hostId = config.hostApp.name;
      nodes.push({
        id: hostId,
        label: hostId,
        type: 'host',
        version: config.hostApp.version,
      });
      nodeIds.add(hostId);
    }

    // 遍历所有层级，添加模块节点
    for (const layer of config.layers) {
      for (const mod of layer.modules) {
        if (nodeIds.has(mod.name)) {
          continue;
        }
        nodeIds.add(mod.name);

        nodes.push({
          id: mod.name,
          label: mod.name,
          type: mod.isLocal ? 'local' : 'external',
          layer: layer.name,
          version: mod.version || undefined,
          group: mod.group || undefined,
          fullPath:
            mod.isLocal && mod.localPath && this.#projectRoot
              ? join(this.#projectRoot, mod.localPath)
              : undefined,
        });
      }
    }

    // 全局依赖
    for (const mod of config.globalDependencies) {
      if (nodeIds.has(mod.name)) {
        continue;
      }
      nodeIds.add(mod.name);

      nodes.push({
        id: mod.name,
        label: mod.name,
        type: mod.isLocal ? 'local' : 'external',
        version: mod.version || undefined,
        group: mod.group || undefined,
        fullPath:
          mod.isLocal && mod.localPath && this.#projectRoot
            ? join(this.#projectRoot, mod.localPath)
            : undefined,
      });
    }

    // 从 boxspec 依赖声明生成边
    for (const [moduleName, spec] of this.#moduleSpecs) {
      for (const depName of spec.dependencies) {
        // 确保依赖目标存在于节点列表中
        if (!nodeIds.has(depName)) {
          nodeIds.add(depName);
          nodes.push({
            id: depName,
            label: depName,
            type: 'external',
            indirect: true,
          });
        }

        edges.push({
          from: moduleName,
          to: depName,
          type: 'depends_on',
        });
      }
    }

    // 宿主应用 → 所有本地模块的 contains 关系
    if (config.hostApp) {
      for (const layer of config.layers) {
        for (const mod of layer.modules) {
          if (mod.isLocal) {
            edges.push({
              from: config.hostApp.name,
              to: mod.name,
              type: 'contains',
            });
          }
        }
      }
    }

    // 层级元数据
    const layers: DependencyGraphLayer[] = config.layers.map((l) => ({
      name: l.name,
      order: l.order,
      accessibleLayers: l.accessibleLayers,
    }));

    return { nodes, edges, layers };
  }

  // ── Private: Ruby DSL 加载 ─────────────────────────

  async #loadRubyDsl(projectRoot: string) {
    // 读取 Boxfile
    const boxfilePath = join(projectRoot, 'Boxfile');
    if (!(await sourceExists(this.sourceReader, boxfilePath))) {
      return;
    }

    let content: string;
    try {
      content = await readSourceText(this.sourceReader, boxfilePath);
    } catch (error) {
      throwIfSourceControlError(this.sourceReader, error);
      return;
    }

    // 解析 Boxfile
    this.#parsedConfig = parseBoxfile(content);

    // 尝试合并 Boxfile.local 覆盖
    await this.#mergeLocalOverrides(projectRoot);

    // 遍历本地模块，解析 spec 文件
    const allModules = [
      ...this.#parsedConfig.layers.flatMap((l) => l.modules),
      ...this.#parsedConfig.globalDependencies,
    ];

    for (const mod of allModules) {
      if (!mod.isLocal || !mod.localPath) {
        continue;
      }

      const modulePath = join(projectRoot, mod.localPath);
      if (!(await sourceExists(this.sourceReader, modulePath))) {
        continue;
      }

      // 查找 spec 文件
      const specPath = await this.#findSpecFile(modulePath, mod.name);
      if (specPath) {
        try {
          const specContent = await readSourceText(this.sourceReader, specPath);
          const spec = parseModuleSpec(specContent);
          this.#moduleSpecs.set(mod.name, spec);
        } catch (error) {
          throwIfSourceControlError(this.sourceReader, error);
          /* skip unreadable spec */
        }
      }
    }

    // 构建 targets（仅 local 模块 + 宿主应用）
    await this.#buildTargets(projectRoot);
  }

  /**
   * 合并 Boxfile.local 中的覆盖配置
   * Boxfile.local 中 :path 覆盖可以将远程依赖切换为本地源码
   */
  async #mergeLocalOverrides(projectRoot: string) {
    const localPath = join(projectRoot, 'Boxfile.local');
    if (!(await sourceExists(this.sourceReader, localPath))) {
      return;
    }

    try {
      const localContent = await readSourceText(this.sourceReader, localPath);
      const localConfig = parseBoxfile(localContent);

      if (!this.#parsedConfig) {
        return;
      }

      // 合并本地覆盖：将 Boxfile.local 中的 local module 覆盖到主配置
      const allLocalModules = localConfig.layers.flatMap((l) => l.modules);
      for (const localMod of allLocalModules) {
        if (!localMod.isLocal) {
          continue;
        }

        // 查找主配置中的同名模块并覆盖
        const configLayers: ParsedLayer[] = this.#parsedConfig.layers;
        for (const layer of configLayers) {
          const existingIdx = layer.modules.findIndex(
            (m: { name: string }) => m.name === localMod.name
          );
          if (existingIdx >= 0) {
            layer.modules[existingIdx] = { ...layer.modules[existingIdx], ...localMod };
          }
        }
      }
    } catch (error) {
      throwIfSourceControlError(this.sourceReader, error);
      /* skip */
    }
  }

  /**
   * 在模块目录中查找 spec 文件
   * 查找顺序: ModuleName.boxspec → ModuleName.podspec → 任意 *.boxspec → 任意 *.podspec
   */
  async #findSpecFile(modulePath: string, moduleName: string): Promise<string | null> {
    // 精确匹配
    for (const ext of ['.boxspec', '.podspec']) {
      const exactPath = join(modulePath, `${moduleName}${ext}`);
      if (await sourceExists(this.sourceReader, exactPath)) {
        return exactPath;
      }
    }

    // 模糊匹配
    try {
      const entries = (await this.sourceReader.readDirectory(modulePath)).map(
        (entry) => entry.name
      );
      for (const entry of entries) {
        if (entry.endsWith('.boxspec') || entry.endsWith('.podspec')) {
          return join(modulePath, entry);
        }
      }
    } catch (error) {
      throwIfSourceControlError(this.sourceReader, error);
      /* skip */
    }

    return null;
  }

  /**
   * 从解析结果构建 Target 列表
   * 仅包含本地模块和宿主应用（有源码可收集的目标）
   */
  async #buildTargets(projectRoot: string) {
    if (!this.#parsedConfig) {
      return;
    }

    const config = this.#parsedConfig;
    const primaryLang = this.#matchedSystem?.language[0] || 'objectivec';

    // 宿主应用
    if (config.hostApp) {
      const hostDir = join(projectRoot, config.hostApp.name);
      if (await sourceExists(this.sourceReader, hostDir)) {
        this.#targets.push({
          name: config.hostApp.name,
          path: hostDir,
          type: 'application',
          language: primaryLang,
          metadata: {
            layer: 'Application',
            version: config.hostApp.version,
          },
        });
      }
    }

    // 所有层级中的本地模块
    for (const layer of config.layers) {
      for (const mod of layer.modules) {
        if (!mod.isLocal || !mod.localPath) {
          continue;
        }

        const modulePath = join(projectRoot, mod.localPath);
        if (!(await sourceExists(this.sourceReader, modulePath))) {
          continue;
        }

        this.#targets.push({
          name: mod.name,
          path: modulePath,
          type: 'library',
          language: primaryLang,
          metadata: {
            layer: layer.name,
            version: mod.version,
            group: mod.group,
            specFile: this.#moduleSpecs.has(mod.name),
          },
        });
      }
    }

    // 全局本地模块
    for (const mod of config.globalDependencies) {
      if (!mod.isLocal || !mod.localPath) {
        continue;
      }

      const modulePath = join(projectRoot, mod.localPath);
      if (!(await sourceExists(this.sourceReader, modulePath))) {
        continue;
      }

      // 避免重复
      if (this.#targets.some((t) => t.name === mod.name)) {
        continue;
      }

      this.#targets.push({
        name: mod.name,
        path: modulePath,
        type: 'library',
        language: primaryLang,
        metadata: {
          version: mod.version,
          group: mod.group,
          specFile: this.#moduleSpecs.has(mod.name),
        },
      });
    }
  }

  // ── Private: YAML 加载 (XcodeGen) ──────────────────

  async #loadYaml(projectRoot: string) {
    const system = this.#matchedSystem!;

    // 查找可用的 YAML 配置文件
    let yamlContent: string | null = null;
    for (const marker of system.markers) {
      const markerPath = join(projectRoot, marker);
      if (await sourceExists(this.sourceReader, markerPath)) {
        try {
          yamlContent = await readSourceText(this.sourceReader, markerPath);
          break;
        } catch (error) {
          throwIfSourceControlError(this.sourceReader, error);
          /* 跳过不可读文件 */
        }
      }
    }

    if (!yamlContent) {
      await this.#loadHeuristic(projectRoot);
      return;
    }

    // Melos 项目走专用加载路径
    if (system.id === 'melos') {
      await this.#loadMelos(projectRoot, yamlContent);
      return;
    }

    // 解析 project.yml
    const config = parseXcodeGenProject(yamlContent);
    this.#parsedConfig = config;

    const primaryLang = system.language[0] as string;

    // 遍历 layers → targets
    for (const layer of config.layers) {
      for (const mod of layer.modules) {
        if (!mod.isLocal) {
          continue;
        }

        const modulePath = mod.localPath
          ? join(projectRoot, mod.localPath)
          : join(projectRoot, mod.name);

        this.#targets.push({
          name: mod.name,
          path: modulePath,
          type: layer.name === 'App' ? 'application' : 'library',
          language: primaryLang,
          metadata: {
            layer: layer.name,
            version: mod.version,
            group: mod.group,
          },
        });

        // 为每个 target 构建 ParsedModuleSpec
        const targetSpec = parseXcodeGenTarget(mod.name, yamlContent);
        if (targetSpec) {
          this.#moduleSpecs.set(mod.name, targetSpec);
        }
      }
    }

    // 全局 SPM 包依赖 → targets（标记为外部）
    for (const dep of config.globalDependencies) {
      if (this.#targets.some((t) => t.name === dep.name)) {
      }
      // 外部包不加入 targets，留给 getDependencyGraph 处理
    }
  }

  // ── Private: Melos 加载 ──────────────────────────────

  async #loadMelos(projectRoot: string, yamlContent: string) {
    const melos = parseMelosProject(yamlContent);

    // 使用 glob 模式扫描 pubspec.yaml 文件
    const pubspecFiles = await this.#findBuildFiles(projectRoot, ['pubspec.yaml']);

    for (const pf of pubspecFiles) {
      // 排除根目录 pubspec
      if (pf === join(projectRoot, 'pubspec.yaml')) {
        continue;
      }

      try {
        const content = await readSourceText(this.sourceReader, pf);
        const nameMatch = content.match(/^name:\s*(\S+)/m);
        if (nameMatch) {
          const modDir = join(pf, '..');
          const relPath = relative(projectRoot, modDir);

          this.#targets.push({
            name: nameMatch[1],
            path: modDir,
            type: 'library',
            language: 'dart',
            metadata: {
              melosProject: melos.name,
              pubspecPath: relative(projectRoot, pf),
              packageDir: relPath,
            },
          });
        }
      } catch (error) {
        throwIfSourceControlError(this.sourceReader, error);
        /* skip */
      }
    }
  }

  // ── Private: Starlark 加载 (Bazel/Buck2/Pants) ──────

  async #loadStarlark(projectRoot: string) {
    const system = this.#matchedSystem!;
    const specPattern = system.moduleSpecPattern ?? 'BUILD';
    const buildFileNames = specPattern === 'BUCK' ? ['BUCK'] : ['BUILD.bazel', 'BUILD'];

    // 扫描所有 BUILD 文件
    const buildFiles = await this.#findBuildFiles(projectRoot, buildFileNames);
    const allTargets: { target: ParsedBuildFile['targets'][number]; packagePath: string }[] = [];
    const detectedLanguages = new Set<string>();

    for (const buildFile of buildFiles) {
      try {
        const content = await readSourceText(this.sourceReader, buildFile);
        const parsed = parseStarlarkBuildFile(content);

        // 根BUILD也属于其父目录；对无斜杠的文件名做replace会错误留下BUILD自身。
        const modulePath = dirname(buildFile);
        const packagePath = relative(projectRoot, modulePath).split(sep).join('/');

        for (const target of parsed.targets) {
          allTargets.push({ target, packagePath });

          // 语言推断
          const lang = RULE_TO_LANGUAGE[target.rule];
          if (lang) {
            detectedLanguages.add(lang);
          }

          this.#targets.push({
            name: target.name,
            path: modulePath,
            type:
              target.rule.includes('binary') || target.rule.includes('executable')
                ? 'application'
                : 'library',
            language: lang ?? 'unknown',
            metadata: {
              rule: target.rule,
              visibility: target.visibility,
              buildFile: relative(projectRoot, buildFile),
            },
          });
        }
      } catch (error) {
        throwIfSourceControlError(this.sourceReader, error);
        /* skip unreadable BUILD files */
      }
    }
    const labels = new Map(
      allTargets.map(({ target, packagePath }) => [`//${packagePath}:${target.name}`, target.name])
    );
    const edges: DependencyGraph['edges'] = [];
    for (const { target, packagePath } of allTargets) {
      for (const dependency of target.deps) {
        const label = dependency.startsWith(':') ? `//${packagePath}${dependency}` : dependency;
        const resolved = labels.get(label);
        if (resolved) {
          edges.push({ from: target.name, to: resolved, type: 'depends_on' });
        } else {
          Logger.getInstance().debug(
            '[CustomConfigDiscoverer] dependency label unresolved; edge omitted',
            {
              from: target.name,
              dependency,
              packagePath,
            }
          );
        }
      }
    }
    this.#appendKnownDependencies(edges);
  }

  /** 保留既有target ID，只投影可唯一对应当前已发现目标的清单依赖。 */
  #appendKnownDependencies(edges: DependencyGraph['edges']) {
    const counts = new Map<string, number>();
    for (const target of this.#targets) {
      counts.set(target.name, (counts.get(target.name) ?? 0) + 1);
    }
    for (const edge of edges) {
      if (counts.get(edge.from) === 1 && counts.get(edge.to) === 1) {
        this.#dependencyEdges.push(edge);
      } else {
        Logger.getInstance().debug(
          '[CustomConfigDiscoverer] dependency target unknown or ambiguous; edge omitted',
          {
            from: edge.from,
            to: edge.to,
            sourceCount: counts.get(edge.from) ?? 0,
            targetCount: counts.get(edge.to) ?? 0,
          }
        );
      }
    }
  }

  async #findBuildFiles(dir: string, names: string[], depth = 0): Promise<string[]> {
    if (depth > 8) {
      return [];
    }
    const results: string[] = [];
    try {
      const entries = await this.sourceReader.readDirectory(dir);
      for (const entry of entries) {
        if (entry.name.startsWith('.') || EXCLUDE_DIRS.has(entry.name)) {
          continue;
        }
        const fullPath = join(dir, entry.name);
        if (entry.isFile() && names.includes(entry.name)) {
          results.push(fullPath);
        } else if (entry.isDirectory()) {
          results.push(...(await this.#findBuildFiles(fullPath, names, depth + 1)));
        }
      }
    } catch (error) {
      throwIfSourceControlError(this.sourceReader, error);
      /* skip */
    }
    return results;
  }

  // ── Private: Gradle DSL 加载 ─────────────────────────

  async #loadGradleDsl(projectRoot: string) {
    // 查找 settings.gradle.kts 或 settings.gradle
    let settingsContent: string | null = null;
    for (const name of ['settings.gradle.kts', 'settings.gradle']) {
      const settingsPath = join(projectRoot, name);
      if (await sourceExists(this.sourceReader, settingsPath)) {
        try {
          settingsContent = await readSourceText(this.sourceReader, settingsPath);
          break;
        } catch (error) {
          throwIfSourceControlError(this.sourceReader, error);
          /* skip */
        }
      }
    }

    if (!settingsContent) {
      await this.#loadHeuristic(projectRoot);
      return;
    }

    const project = parseGradleProject(settingsContent);
    const primaryLang = (this.#matchedSystem?.language[0] as string) || 'kotlin';
    const edges: DependencyGraph['edges'] = [];

    // 解析每个模块的 build.gradle.kts
    for (const mod of project.includedModules) {
      const modulePath = join(projectRoot, mod.directory);
      if (!(await sourceExists(this.sourceReader, modulePath))) {
        continue;
      }

      // 读取 build.gradle.kts 获取 dependencies 和 plugins
      for (const buildName of ['build.gradle.kts', 'build.gradle']) {
        const buildPath = join(modulePath, buildName);
        if (await sourceExists(this.sourceReader, buildPath)) {
          try {
            const buildContent = await readSourceText(this.sourceReader, buildPath);
            const updatedMod = parseGradleProject(buildContent, mod);
            // 更新 module 的 convention plugin 和 dependencies
            mod.conventionPlugin =
              updatedMod.includedModules[0]?.conventionPlugin ?? mod.conventionPlugin;
            mod.dependencies = updatedMod.includedModules[0]?.dependencies ?? mod.dependencies;
          } catch (error) {
            throwIfSourceControlError(this.sourceReader, error);
            /* skip */
          }
          break;
        }
      }

      const inferredRole = mod.conventionPlugin
        ? inferConventionRole(mod.conventionPlugin)
        : undefined;

      this.#targets.push({
        name: mod.path,
        path: modulePath,
        type: mod.path === ':app' ? 'application' : 'library',
        language: primaryLang,
        metadata: {
          gradlePath: mod.path,
          conventionPlugin: mod.conventionPlugin,
          conventionRole: inferredRole,
        },
      });
      for (const dependency of mod.dependencies) {
        if (dependency.isProject) {
          edges.push({
            from: mod.path,
            to: dependency.target,
            type: 'depends_on',
            configuration: dependency.configuration,
          });
        }
      }
    }
    this.#appendKnownDependencies(edges);
  }

  // ── Private: CMake 加载 ──────────────────────────────

  async #loadCMake(projectRoot: string) {
    const cmakePath = join(projectRoot, 'CMakeLists.txt');
    if (!(await sourceExists(this.sourceReader, cmakePath))) {
      await this.#loadHeuristic(projectRoot);
      return;
    }

    let content: string;
    try {
      content = await readSourceText(this.sourceReader, cmakePath);
    } catch (error) {
      throwIfSourceControlError(this.sourceReader, error);
      return;
    }

    const project = parseCMakeProject(content);
    const primaryLang = (this.#matchedSystem?.language[0] as string) || 'cpp';
    const edges: DependencyGraph['edges'] = [];

    // 主目标
    for (const target of project.targets) {
      this.#targets.push({
        name: target.name,
        path: projectRoot,
        type: target.type === 'executable' ? 'application' : 'library',
        language: primaryLang,
        metadata: {
          cmakeType: target.type,
        },
      });
      edges.push(
        ...target.linkDependencies.map((dependency) => ({
          from: target.name,
          to: dependency.target,
          type: 'depends_on',
          scope: dependency.scope,
        }))
      );
    }

    // 递归解析子目录的 CMakeLists.txt
    for (const subdir of project.subdirectories) {
      const subdirPath = join(projectRoot, subdir);
      const subdirCmakePath = join(subdirPath, 'CMakeLists.txt');
      if (!(await sourceExists(this.sourceReader, subdirCmakePath))) {
        continue;
      }

      try {
        const subcontent = await readSourceText(this.sourceReader, subdirCmakePath);
        const subproject = parseCMakeProject(subcontent);

        for (const target of subproject.targets) {
          this.#targets.push({
            name: target.name,
            path: subdirPath,
            type: target.type === 'executable' ? 'application' : 'library',
            language: primaryLang,
            metadata: {
              cmakeType: target.type,
              subdirectory: subdir,
            },
          });
          edges.push(
            ...target.linkDependencies.map((dependency) => ({
              from: target.name,
              to: dependency.target,
              type: 'depends_on',
              scope: dependency.scope,
            }))
          );
        }
      } catch (error) {
        throwIfSourceControlError(this.sourceReader, error);
        /* skip */
      }
    }
    this.#appendKnownDependencies(edges);
  }

  // ── Private: JSON Config 加载 (Nx/Flutter/RN) ────────

  async #loadJsonConfig(projectRoot: string) {
    const system = this.#matchedSystem!;

    switch (system.id) {
      case 'nx-monorepo':
        await this.#loadNx(projectRoot);
        break;
      case 'flutter-add-to-app':
        await this.#loadFlutterAddToApp(projectRoot);
        break;
      case 'react-native-hybrid':
        await this.#loadReactNative(projectRoot);
        break;
      default:
        await this.#loadHeuristic(projectRoot);
    }
  }

  async #loadNx(projectRoot: string) {
    const nxJsonPath = join(projectRoot, 'nx.json');
    if (!(await sourceExists(this.sourceReader, nxJsonPath))) {
      return;
    }

    // 扫描所有 project.json 文件
    const projectJsonFiles = await this.#findBuildFiles(projectRoot, ['project.json']);
    const projects: Array<{ name: string; root: string; projectType: string; tags: string[] }> = [];

    for (const pjFile of projectJsonFiles) {
      try {
        const content = await readSourceText(this.sourceReader, pjFile);
        const parsed = parseNxWorkspace(content);
        for (const proj of parsed.projects) {
          projects.push(proj);
          const modulePath = join(projectRoot, proj.root);

          this.#targets.push({
            name: proj.name,
            path: modulePath,
            type: proj.projectType === 'application' ? 'application' : 'library',
            language: 'typescript',
            metadata: {
              tags: proj.tags,
              nxProjectType: proj.projectType,
            },
          });
        }
      } catch (error) {
        throwIfSourceControlError(this.sourceReader, error);
        /* skip */
      }
    }
  }

  async #loadFlutterAddToApp(projectRoot: string) {
    // 解析 .flutter-plugins-dependencies
    const depsPath = join(projectRoot, '.flutter-plugins-dependencies');
    if (await sourceExists(this.sourceReader, depsPath)) {
      try {
        const content = await readSourceText(this.sourceReader, depsPath);
        const parsed = parseFlutterPluginsDeps(content);

        for (const plugin of parsed.plugins) {
          this.#targets.push({
            name: plugin.name,
            path: plugin.path,
            type: 'library',
            language: 'dart',
            metadata: {
              platform: plugin.platform,
              bridgeType: 'flutter-engine',
            },
          });
        }
      } catch (error) {
        throwIfSourceControlError(this.sourceReader, error);
        /* skip */
      }
    }

    // 查找嵌入的 pubspec.yaml
    const pubspecFiles = await this.#findBuildFiles(projectRoot, ['pubspec.yaml']);
    for (const pf of pubspecFiles) {
      // 排除根目录的 pubspec（交给 DartDiscoverer 处理）
      if (pf === join(projectRoot, 'pubspec.yaml')) {
        continue;
      }

      try {
        const content = await readSourceText(this.sourceReader, pf);
        const nameMatch = content.match(/^name:\s*(\S+)/m);
        if (nameMatch) {
          const modDir = join(pf, '..');
          this.#targets.push({
            name: nameMatch[1],
            path: modDir,
            type: 'library',
            language: 'dart',
            metadata: {
              pubspecPath: relative(projectRoot, pf),
            },
          });
        }
      } catch (error) {
        throwIfSourceControlError(this.sourceReader, error);
        /* skip */
      }
    }
  }

  async #loadReactNative(projectRoot: string) {
    const pkgJsonPath = join(projectRoot, 'package.json');
    if (!(await sourceExists(this.sourceReader, pkgJsonPath))) {
      return;
    }

    try {
      const content = await readSourceText(this.sourceReader, pkgJsonPath);
      const parsed = parseReactNativeProject(content);

      if (parsed.isReactNative) {
        this.#targets.push({
          name: parsed.name,
          path: projectRoot,
          type: 'application',
          language: 'typescript',
          metadata: {
            rnVersion: parsed.rnVersion,
            bridgeType: 'native-module',
          },
        });
      }
    } catch (error) {
      throwIfSourceControlError(this.sourceReader, error);
      /* skip */
    }
  }

  // ── Private: 启发式加载 ────────────────────────────

  async #loadHeuristic(projectRoot: string) {
    // 扫描根目录中可能包含模块的目录
    try {
      const entries = await this.sourceReader.readDirectory(projectRoot);

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || EXCLUDE_DIRS.has(entry.name)) {
          continue;
        }

        // 检查是否是模块容器目录
        if (/^(Local)?Modules?$|^Packages$/i.test(entry.name)) {
          await this.#scanModuleDirectory(join(projectRoot, entry.name));
        }
      }
    } catch (error) {
      throwIfSourceControlError(this.sourceReader, error);
      /* skip */
    }
  }

  /**
   * 扫描模块容器目录，每个有 spec 文件或源码的子目录视为一个模块
   */
  async #scanModuleDirectory(containerDir: string) {
    try {
      const entries = await this.sourceReader.readDirectory(containerDir);

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
          continue;
        }

        const modulePath = join(containerDir, entry.name);

        // 查找 spec 文件
        const specPath = await this.#findSpecFile(modulePath, entry.name);
        if (specPath) {
          try {
            const specContent = await readSourceText(this.sourceReader, specPath);
            const spec = parseModuleSpec(specContent);
            this.#moduleSpecs.set(entry.name, spec);
          } catch (error) {
            throwIfSourceControlError(this.sourceReader, error);
            /* skip */
          }
        }

        // 检查目录是否包含源码文件
        if (specPath || (await this.#hasSourceFiles(modulePath))) {
          this.#targets.push({
            name: entry.name,
            path: modulePath,
            type: 'library',
            language: 'objectivec',
            metadata: { specFile: specPath !== null },
          });
        }
      }
    } catch (error) {
      throwIfSourceControlError(this.sourceReader, error);
      /* skip */
    }
  }

  // ── Private: 文件工具 ──────────────────────────────

  /**
   * 递归收集源码文件
   */
  async #collectSourceFiles(dir: string, rootDir: string, files: DiscoveredFile[], depth = 0) {
    if (depth > 15 || files.length >= 500) {
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
          await this.#collectSourceFiles(fullPath, rootDir, files, depth + 1);
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (SOURCE_EXTENSIONS.has(ext) || LanguageService.sourceExts.has(ext)) {
            const lang = LanguageService.inferLang(entry.name) || 'unknown';
            files.push({
              name: entry.name,
              path: fullPath,
              relativePath: relative(rootDir, fullPath),
              language: lang,
            });
          }
        }

        if (files.length >= 500) {
          return;
        }
      }
    } catch (error) {
      throwIfSourceControlError(this.sourceReader, error);
      /* skip */
    }
  }

  /**
   * 检查目录中是否存在源码文件（浅层检查）
   */
  async #hasSourceFiles(dir: string, depth = 0): Promise<boolean> {
    if (depth > 3) {
      return false;
    }

    try {
      const entries = await this.sourceReader.readDirectory(dir);

      for (const entry of entries) {
        if (entry.name.startsWith('.')) {
          continue;
        }

        if (entry.isFile()) {
          const ext = extname(entry.name);
          if (SOURCE_EXTENSIONS.has(ext)) {
            return true;
          }
        } else if (entry.isDirectory() && !EXCLUDE_DIRS.has(entry.name)) {
          if (await this.#hasSourceFiles(join(dir, entry.name), depth + 1)) {
            return true;
          }
        }
      }
    } catch (error) {
      throwIfSourceControlError(this.sourceReader, error);
      /* skip */
    }

    return false;
  }
}

// ── Module-level helpers ────────────────────────────

/**
 * 计算目录下包含 spec 文件的子目录数量
 */
async function countSubdirsWithSpecs(
  containerDir: string,
  sourceReader: ProjectSourceReader
): Promise<number> {
  let count = 0;
  try {
    const entries = await sourceReader.readDirectory(containerDir);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      try {
        const subEntries = (await sourceReader.readDirectory(join(containerDir, entry.name))).map(
          (entry) => entry.name
        );
        const hasSpec = subEntries.some((e) => e.endsWith('.boxspec') || e.endsWith('.podspec'));
        if (hasSpec) {
          count++;
        }
      } catch (error) {
        throwIfSourceControlError(sourceReader, error);
        /* skip */
      }
    }
  } catch (error) {
    throwIfSourceControlError(sourceReader, error);
    /* skip */
  }
  return count;
}

/** 普通不可读输入保留旧降级；取消与缺失的重放记录不能被既有 catch 伪装成空结果。 */
function throwIfSourceControlError(reader: ProjectSourceReader, error: unknown): void {
  if (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      ('code' in error && error.code === 'PROJECT_SOURCE_INPUT_UNCAPTURED'))
  ) {
    throw error;
  }
  reader.assertComplete();
}
