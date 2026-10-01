import path from 'node:path';
import {
  aliasModuleBases,
  inheritedModuleConfigPath,
  MODULE_CONFIG_FILE_NAMES,
  type ModuleAliasConfig,
  mergeInheritedModuleConfigs,
  parseModuleConfig,
  resolveModuleAliasConfig,
} from './moduleAliases.js';
import { moduleSourceCandidates } from './moduleTargets.js';
import {
  matchesGlobSegment,
  type PackageBuildLayout,
  type PackageManifest,
  packageEntryBases,
  parsePackageManifest,
  parseWorkspaceGlobs,
  resolveSubpathTargets,
  splitPackageSpecifier,
  splitWorkspaceGlobs,
  WORKSPACE_MANIFEST_FILE_NAMES,
} from './packageEntries.js';

/**
 * 说明符解析读项目配置、判断候选文件是否存在的唯一通道。
 * 实现方决定内容从哪里来（live 读取器、冻结快照、索引清单），解析规则本身不读磁盘，
 * 因此同一份输入必得同一个目标。路径都是项目相对路径，项目根是空串。
 */
export interface ModuleResolutionAccess {
  /** 一个项目内文件的文本；文件不存在或不在范围内时返回 undefined。 */
  readText(filePath: string): Promise<string | undefined>;
  /** 候选路径是否是范围内的文件。 */
  hasFile(filePath: string): Promise<boolean>;
  /** 目录下的直接子目录名；目录不存在时返回空。 */
  listDirectories(directory: string): Promise<readonly string[]>;
  /** 同一输入视图下的派生结果（某目录适用的配置、workspace 成员表）只算一次。 */
  memo<T>(key: string, create: () => Promise<T>): Promise<T>;
  /** 解析过程里的取舍（忽略了什么、为什么没有目标），由实现方写进日志。 */
  note?(event: string, details: Record<string, unknown>): void;
}

export interface ResolvedModule {
  filePath: string;
  /**
   * relative：相对路径；path-alias：tsconfig / jsconfig 的 paths、baseUrl；
   * package-entry：项目内另一个包（或本包自身）的入口；package-import：本包 `imports` 的 `#` 说明符。
   */
  via: 'relative' | 'path-alias' | 'package-entry' | 'package-import';
  /**
   * 目标是按目录惯例从构建产物换回的源码（如 `dist/index.js` → `src/index.ts`），没有配置为证。
   * 其余情况说明符都是经语言规则或配置落到这个文件的。
   */
  conventional: boolean;
}

export type ModuleResolution =
  | ({ status: 'found' } & ResolvedModule)
  /** outside-scope：相对路径逃出项目根；not-found：相对路径在项目内但没有对应文件；external：项目外的包。 */
  | { status: 'outside-scope' | 'not-found' | 'external' };

export interface ModuleResolutionOptions {
  /** 说明符可落到的扩展名，顺序即优先级。 */
  extensions: readonly string[];
  /** 是否允许按目录惯例把指向构建产物的包入口换回源码。 */
  conventions: boolean;
}

/** 配置继承链的跟随上限；真实项目只有两三层。 */
const MAX_EXTENDS_DEPTH = 4;
/** `**` 向下展开的层数与一次 workspace 展开的目录上限：防止病态配置把整个项目遍历一遍。 */
const MAX_GLOBSTAR_DEPTH = 4;
const MAX_WORKSPACE_DIRECTORIES = 2000;

/**
 * 模块说明符 → 项目内的源码文件。这是全仓唯一的一份解析规则，协议与索引都经它得到目标：
 *
 * 1. 相对路径：按导入方所在目录。
 * 2. 路径别名：离导入方最近的 tsconfig.json / jsconfig.json 的 paths、baseUrl，跟随相对 extends。
 * 3. 项目内的包：本包自引用、`file:` / `link:` 依赖、workspace 成员；入口取 exports，其次是
 *    source / types / module / main，指向构建产物时换回源码。
 * 4. `#` 开头的说明符：导入方所在包的 imports。
 *
 * 都不是的就是项目外的包，没有目标。
 */
export async function resolveModuleSpecifier(
  access: ModuleResolutionAccess,
  importerFile: string,
  specifier: string,
  options: ModuleResolutionOptions
): Promise<ModuleResolution> {
  const directory = directoryOf(importerFile);
  if (isRelativeSpecifier(specifier)) {
    const base = normalizeProjectPath(path.posix.join(directory, specifier));
    if (base === undefined) {
      return { status: 'outside-scope' };
    }
    const filePath = await firstExistingCandidate(access, base, options.extensions);
    return filePath
      ? { status: 'found', filePath, via: 'relative', conventional: false }
      : { status: 'not-found' };
  }
  if (!specifier || path.posix.isAbsolute(specifier)) {
    return { status: 'external' };
  }

  const aliases = await moduleConfigFor(access, directory);
  for (const base of aliases ? aliasModuleBases(aliases, specifier) : []) {
    const filePath = await firstExistingCandidate(access, base, options.extensions);
    if (filePath) {
      return { status: 'found', filePath, via: 'path-alias', conventional: false };
    }
  }

  const viaPackage = await resolvePackageModule(access, directory, specifier, options);
  return viaPackage ? { status: 'found', ...viaPackage } : { status: 'external' };
}

/** 某个目录适用的模块配置：本目录的配置文件，没有就沿用上级目录的，到项目根为止。 */
function moduleConfigFor(
  access: ModuleResolutionAccess,
  directory: string
): Promise<ModuleAliasConfig | undefined> {
  return access.memo(`module-config-for:${directory}`, async () => {
    const own = await moduleConfigAt(access, directory);
    if (own) {
      return own;
    }
    return directory === '' ? undefined : moduleConfigFor(access, parentOf(directory));
  });
}

/** 一个目录自己的模块配置（tsconfig.json 优先于 jsconfig.json），已叠加继承来的内容。 */
function moduleConfigAt(
  access: ModuleResolutionAccess,
  directory: string
): Promise<ModuleAliasConfig | undefined> {
  return access.memo(`module-config-at:${directory}`, async () => {
    for (const name of MODULE_CONFIG_FILE_NAMES) {
      const config = await readModuleConfig(access, joinPath(directory, name), 0);
      if (config) {
        return config;
      }
    }
    return undefined;
  });
}

async function readModuleConfig(
  access: ModuleResolutionAccess,
  configFile: string,
  depth: number
): Promise<ModuleAliasConfig | undefined> {
  const text = await access.readText(configFile);
  if (text === undefined) {
    return undefined;
  }
  const source = parseModuleConfig(text);
  if (!source) {
    access.note?.('module-config-unparseable', { configFile });
    return undefined;
  }
  const inherited: ModuleAliasConfig[] = [];
  for (const reference of source.extends) {
    const parent = inheritedModuleConfigPath(configFile, reference);
    if (!parent || depth >= MAX_EXTENDS_DEPTH) {
      // 包名形式的共享预设不在项目里；超过层数的继承链不再跟随。
      access.note?.('module-config-extends-not-followed', {
        configFile,
        reference,
        reason: parent ? 'extends-depth-limit' : 'package-or-outside-project',
      });
      continue;
    }
    const loaded = await readModuleConfig(access, parent, depth + 1);
    if (loaded) {
      inherited.push(loaded);
    }
  }
  return resolveModuleAliasConfig(configFile, source, mergeInheritedModuleConfigs(inherited));
}

interface LocatedPackage {
  /** 包目录；项目根是空串。 */
  directory: string;
  manifest: PackageManifest;
}

async function resolvePackageModule(
  access: ModuleResolutionAccess,
  importerDirectory: string,
  specifier: string,
  options: ModuleResolutionOptions
): Promise<ResolvedModule | undefined> {
  const importerPackage = await nearestPackage(access, importerDirectory);
  if (specifier.startsWith('#')) {
    if (!importerPackage) {
      return undefined;
    }
    const entry = await firstPackageEntry(
      access,
      importerPackage,
      resolveSubpathTargets(importerPackage.manifest.imports, specifier),
      options
    );
    return entry ? { ...entry, via: 'package-import' } : undefined;
  }
  const parts = splitPackageSpecifier(specifier);
  if (!parts) {
    return undefined;
  }
  const target = await locatePackage(access, importerPackage, importerDirectory, parts.name);
  if (!target) {
    return undefined;
  }
  const { manifest } = target;
  const targets =
    manifest.exports !== undefined
      ? resolveSubpathTargets(manifest.exports, parts.subpath)
      : parts.subpath === '.'
        ? // 没有任何入口字段时，包的主入口是根目录下的 index。
          [...manifest.entryFields, './index.js']
        : [parts.subpath];
  const entry = await firstPackageEntry(access, target, targets, options);
  if (!entry) {
    access.note?.('package-entry-not-in-project', {
      package: parts.name,
      subpath: parts.subpath,
      packageDirectory: target.directory,
      declaredTargets: targets.length,
    });
    return undefined;
  }
  return { ...entry, via: 'package-entry' };
}

/**
 * 包名在项目里对应的目录。依次是：导入方所在的包自己；它用 `file:` / `link:` 声明的本地依赖；
 * 导入方所属 workspace 里同名的成员。同名成员不止一个时不选。
 */
async function locatePackage(
  access: ModuleResolutionAccess,
  importerPackage: LocatedPackage | undefined,
  importerDirectory: string,
  name: string
): Promise<LocatedPackage | undefined> {
  if (importerPackage?.manifest.name === name) {
    return importerPackage;
  }
  const spec = importerPackage?.manifest.dependencies[name];
  const local = spec?.match(/^(?:file|link):(.+)$/)?.[1];
  if (importerPackage && local) {
    const directory = normalizeProjectPath(path.posix.join(importerPackage.directory, local));
    return directory === undefined ? undefined : packageAt(access, directory);
  }
  // workspace 的根清单在导入方所在包的某一级上级目录里；由近及远找第一个认识这个名字的。
  let directory: string | undefined = importerPackage?.directory ?? importerDirectory;
  while (directory !== undefined) {
    const matches: LocatedPackage[] = (await workspaceMembers(access, directory)).get(name) ?? [];
    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length > 1) {
      access.note?.('workspace-package-ambiguous', {
        package: name,
        workspaceRoot: directory,
        directories: matches.map((match) => match.directory),
      });
      return undefined;
    }
    directory = directory === '' ? undefined : parentOf(directory);
  }
  return undefined;
}

/** 以某个目录为根的 workspace 的成员：包名 → 包。该目录没有声明 workspace 时为空。 */
function workspaceMembers(
  access: ModuleResolutionAccess,
  root: string
): Promise<Map<string, LocatedPackage[]>> {
  return access.memo(`workspace-members:${root}`, async () => {
    const globs: string[] = [];
    for (const name of WORKSPACE_MANIFEST_FILE_NAMES) {
      if (name === 'package.json') {
        // 包清单已经按目录读过一次，不再重读。
        globs.push(...((await packageAt(access, root))?.manifest.workspaces ?? []));
        continue;
      }
      const text = await access.readText(joinPath(root, name));
      if (text !== undefined) {
        globs.push(...parseWorkspaceGlobs(name, text));
      }
    }
    const members = new Map<string, LocatedPackage[]>();
    if (globs.length === 0) {
      return members;
    }
    const { include, exclude } = splitWorkspaceGlobs(globs);
    const directories = new Set<string>();
    for (const segments of include) {
      for (const directory of await expandWorkspaceGlob(access, root, segments)) {
        directories.add(directory);
      }
    }
    for (const directory of [...directories].sort()) {
      const relative = root ? directory.slice(root.length + 1) : directory;
      if (exclude.some((pattern) => pattern.test(relative))) {
        continue;
      }
      const located = await packageAt(access, directory);
      const name = located?.manifest.name;
      if (located && name) {
        members.set(name, [...(members.get(name) ?? []), located]);
      }
    }
    return members;
  });
}

async function expandWorkspaceGlob(
  access: ModuleResolutionAccess,
  root: string,
  segments: readonly string[]
): Promise<string[]> {
  let current = [root];
  for (const segment of segments) {
    const next = new Set<string>();
    for (const directory of current) {
      if (segment === '**') {
        for (const descendant of await descendantDirectories(access, directory)) {
          next.add(descendant);
        }
      } else if (segment.includes('*')) {
        for (const name of await access.listDirectories(directory)) {
          if (!isSkippedDirectory(name) && matchesGlobSegment(segment, name)) {
            next.add(joinPath(directory, name));
          }
        }
      } else {
        next.add(joinPath(directory, segment));
      }
    }
    current = [...next];
    if (current.length > MAX_WORKSPACE_DIRECTORIES) {
      access.note?.('workspace-glob-truncated', {
        workspaceRoot: root,
        pattern: segments.join('/'),
        directories: current.length,
        limit: MAX_WORKSPACE_DIRECTORIES,
      });
      current = current.slice(0, MAX_WORKSPACE_DIRECTORIES);
    }
  }
  return current;
}

/** 目录自身及其下若干层的子目录（`**` 可以匹配零层）。 */
async function descendantDirectories(
  access: ModuleResolutionAccess,
  directory: string
): Promise<string[]> {
  const result = [directory];
  let frontier = [directory];
  for (let depth = 0; depth < MAX_GLOBSTAR_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const parent of frontier) {
      for (const name of await access.listDirectories(parent)) {
        if (!isSkippedDirectory(name)) {
          next.push(joinPath(parent, name));
        }
      }
    }
    result.push(...next);
    frontier = next;
    if (result.length > MAX_WORKSPACE_DIRECTORIES) {
      break;
    }
  }
  return result;
}

/** 一个目录自己的 package.json；没有或读不出时返回 undefined。 */
function packageAt(
  access: ModuleResolutionAccess,
  directory: string
): Promise<LocatedPackage | undefined> {
  return access.memo(`package-at:${directory}`, async () => {
    const file = joinPath(directory, 'package.json');
    const text = await access.readText(file);
    if (text === undefined) {
      return undefined;
    }
    const manifest = parsePackageManifest(text);
    if (!manifest) {
      access.note?.('package-manifest-unparseable', { file });
      return undefined;
    }
    return { directory, manifest };
  });
}

/** 包住某个目录的最近一个包。 */
function nearestPackage(
  access: ModuleResolutionAccess,
  directory: string
): Promise<LocatedPackage | undefined> {
  return access.memo(`nearest-package:${directory}`, async () => {
    const own = await packageAt(access, directory);
    if (own) {
      return own;
    }
    return directory === '' ? undefined : nearestPackage(access, parentOf(directory));
  });
}

/** 包自己的编译配置里的 outDir 与 rootDir；两者都明确写出时才返回。 */
function buildLayoutOf(
  access: ModuleResolutionAccess,
  packageDirectory: string
): Promise<PackageBuildLayout | undefined> {
  return access.memo(`build-layout:${packageDirectory}`, async () => {
    const config = await moduleConfigAt(access, packageDirectory);
    return config?.outDir !== undefined && config.rootDir !== undefined
      ? { outDir: config.outDir, rootDir: config.rootDir }
      : undefined;
  });
}

/**
 * 包的一组入口目标里第一个能落到项目内源码的。目标按清单给出的顺序尝试；
 * 命中的若是按惯例换回的路径，而另有一条配置明确给出的路径指向同一个文件，以后者为准。
 */
async function firstPackageEntry(
  access: ModuleResolutionAccess,
  located: LocatedPackage,
  targets: readonly string[],
  options: ModuleResolutionOptions
): Promise<Pick<ResolvedModule, 'filePath' | 'conventional'> | undefined> {
  if (targets.length === 0) {
    return undefined;
  }
  const layout = await buildLayoutOf(access, located.directory);
  const bases = targets.flatMap((target) =>
    packageEntryBases({
      packageDirectory: located.directory,
      target,
      layout,
      conventions: options.conventions,
    })
  );
  for (const [index, entry] of bases.entries()) {
    const filePath = await firstExistingCandidate(access, entry.base, options.extensions);
    if (!filePath) {
      continue;
    }
    if (entry.proof !== 'convention') {
      return { filePath, conventional: false };
    }
    for (const later of bases.slice(index + 1)) {
      if (
        later.proof !== 'convention' &&
        (await firstExistingCandidate(access, later.base, options.extensions)) === filePath
      ) {
        return { filePath, conventional: false };
      }
    }
    return { filePath, conventional: true };
  }
  return undefined;
}

async function firstExistingCandidate(
  access: ModuleResolutionAccess,
  base: string,
  extensions: readonly string[]
): Promise<string | undefined> {
  for (const candidate of moduleSourceCandidates(base, extensions)) {
    if (normalizeProjectPath(candidate) === candidate && (await access.hasFile(candidate))) {
      return candidate;
    }
  }
  return undefined;
}

function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  );
}

/** 依赖目录与构建工具的隐藏目录不是 workspace 成员所在的位置。 */
function isSkippedDirectory(name: string): boolean {
  return name === 'node_modules' || name.startsWith('.');
}

function directoryOf(filePath: string): string {
  const directory = path.posix.dirname(filePath);
  return directory === '.' ? '' : directory;
}

function parentOf(directory: string): string {
  const parent = path.posix.dirname(directory);
  return parent === '.' ? '' : parent;
}

function joinPath(directory: string, relative: string): string {
  return directory ? `${directory}/${relative}` : relative;
}

/** 规范化成项目相对路径；逃出项目根的返回 undefined，项目根本身是空串。 */
function normalizeProjectPath(value: string): string | undefined {
  const normalized = path.posix.normalize(value).replace(/\/$/, '');
  if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    return undefined;
  }
  return normalized === '.' ? '' : normalized;
}
