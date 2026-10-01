import path from 'node:path';
import yaml from 'js-yaml';

/**
 * 项目内的包（monorepo 的 workspace 成员、包自身）如何把说明符落到源码文件。
 *
 * 这里全是纯函数：清单文本 → 结构，说明符 → 包名与子路径，exports / imports 映射 → 目标，
 * 目标 → 源码候选路径。读清单、判断文件是否存在由 moduleResolver 经访问通道完成。
 */

/** package.json 里与模块解析有关的部分。 */
export interface PackageManifest {
  name?: string;
  /** `exports` 原样保留；有这一项时子路径只能经它解析。 */
  exports?: unknown;
  /** `imports`（`#` 开头的包内私有说明符）原样保留。 */
  imports?: unknown;
  /** 没有 exports 时包主入口的候选，按"越接近源码越优先"排列。 */
  entryFields: string[];
  /** 各类依赖声明合并后的版本说明；用来识别 `file:` / `link:` 指向的本地包。 */
  dependencies: Record<string, string>;
  /** 本清单声明的 workspace 成员模式（npm / yarn / bun 写法）。 */
  workspaces?: string[];
}

/** 声明 workspace 成员的清单文件名；同一目录下几种都读，模式取并集。 */
export const WORKSPACE_MANIFEST_FILE_NAMES: readonly string[] = [
  'pnpm-workspace.yaml',
  'package.json',
  'lerna.json',
];

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/** 读出 package.json 的解析相关字段；内容不是合法 JSON 对象时返回 undefined。 */
export function parsePackageManifest(text: string): PackageManifest | undefined {
  const value = parseJsonRecord(text);
  if (!value) {
    return undefined;
  }
  const dependencies: Record<string, string> = {};
  for (const field of DEPENDENCY_FIELDS) {
    const entries = value[field];
    if (isRecord(entries)) {
      for (const [name, spec] of Object.entries(entries)) {
        if (typeof spec === 'string' && !(name in dependencies)) {
          dependencies[name] = spec;
        }
      }
    }
  }
  const workspaces = readStringList(
    isRecord(value.workspaces) ? value.workspaces.packages : value.workspaces
  );
  return {
    ...(typeof value.name === 'string' && value.name.trim() ? { name: value.name.trim() } : {}),
    ...(value.exports === undefined ? {} : { exports: value.exports }),
    ...(value.imports === undefined ? {} : { imports: value.imports }),
    // source 是显式的源码入口；types 在 TypeScript 的解析里先于 main；module 先于 main。
    entryFields: [value.source, value.types, value.typings, value.module, value.main].filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0
    ),
    dependencies,
    ...(workspaces.length > 0 ? { workspaces } : {}),
  };
}

/**
 * 一份清单声明的 workspace 成员模式。
 * package.json 取 `workspaces`（数组，或 `{ packages }`）；pnpm-workspace.yaml 与 lerna.json 取 `packages`。
 * 没有声明或内容不合法时返回空数组。
 */
export function parseWorkspaceGlobs(fileName: string, text: string): string[] {
  if (fileName === 'package.json') {
    return parsePackageManifest(text)?.workspaces ?? [];
  }
  if (fileName === 'lerna.json') {
    return readStringList(parseJsonRecord(text)?.packages);
  }
  if (fileName === 'pnpm-workspace.yaml') {
    try {
      const value = yaml.load(text);
      return isRecord(value) ? readStringList(value.packages) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * 包名说明符拆成包名与子路径：`@scope/name/sub` → `@scope/name` + `./sub`，`name` → `name` + `.`。
 * 相对路径、绝对路径、`#` 开头的包内说明符、带协议的说明符（`node:fs`）都不是包名。
 */
export function splitPackageSpecifier(
  specifier: string
): { name: string; subpath: string } | undefined {
  if (
    !specifier ||
    specifier.startsWith('.') ||
    specifier.startsWith('#') ||
    specifier.startsWith('/') ||
    specifier.includes(':') ||
    specifier.includes('\\')
  ) {
    return undefined;
  }
  const segments = specifier.split('/');
  const nameLength = specifier.startsWith('@') ? 2 : 1;
  if (segments.length < nameLength || segments.slice(0, nameLength).some((part) => !part)) {
    return undefined;
  }
  const rest = segments.slice(nameLength).join('/');
  return {
    name: segments.slice(0, nameLength).join('/'),
    subpath: rest ? `./${rest}` : '.',
  };
}

/** 条件名的尝试顺序：先是指向源码的，再是常规的；其余条件按清单里的书写顺序排在后面。 */
const CONDITION_PRIORITY = [
  'source',
  'development',
  'types',
  'import',
  'module',
  'default',
  'require',
  'node',
];

function conditionRank(condition: string): number {
  // 自定义的源码条件（`@acme/source`、`ts`、`typescript`）与 source 同等优先。
  if (/(^|[/:@_-])source$/.test(condition) || /^(ts|typescript|src)$/.test(condition)) {
    return 0;
  }
  const rank = CONDITION_PRIORITY.indexOf(condition);
  return rank === -1 ? CONDITION_PRIORITY.length : rank;
}

/**
 * exports / imports 映射里一个子路径对应的全部目标，按尝试顺序排列。
 *
 * 遵循 Node 的规则：精确键优先，其次是带 `*` 的模式键里前缀最长的那个；条件对象逐层展开。
 * 与运行时不同的是这里不挑唯一一个条件，而是把各条件的目标都列出来——分析要找的是源码文件，
 * 由调用方按顺序找到第一个确实存在的。exports 的目标必须以 `./` 开头；imports 的目标可以是
 * 别的包名，那不是包内文件，不在结果里。
 */
export function resolveSubpathTargets(map: unknown, subpath: string): string[] {
  if (map === undefined || map === null) {
    return [];
  }
  if (!isSubpathMap(map)) {
    // 整个 exports 就是主入口的简写（字符串、数组或条件对象）。
    return subpath === '.' ? collectTargets(map, '') : [];
  }
  const exact = map[subpath];
  if (exact !== undefined) {
    return collectTargets(exact, '');
  }
  let best: { key: string; prefixLength: number; captured: string } | undefined;
  for (const key of Object.keys(map)) {
    const star = key.indexOf('*');
    if (star === -1) {
      // 以 `/` 结尾的目录键是旧写法：其下的任意子路径都映射到目标目录里的同名路径。
      if (key.endsWith('/') && subpath.startsWith(key) && subpath.length > key.length) {
        if (!best || key.length > best.prefixLength) {
          best = { key, prefixLength: key.length, captured: subpath.slice(key.length) };
        }
      }
      continue;
    }
    if (star !== key.lastIndexOf('*')) {
      continue;
    }
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (
      subpath.length >= prefix.length + suffix.length &&
      subpath.startsWith(prefix) &&
      subpath.endsWith(suffix) &&
      (!best ||
        prefix.length > best.prefixLength ||
        (prefix.length === best.prefixLength && key.length > best.key.length))
    ) {
      best = {
        key,
        prefixLength: prefix.length,
        captured: subpath.slice(prefix.length, subpath.length - suffix.length),
      };
    }
  }
  if (!best) {
    return [];
  }
  return collectTargets(map[best.key], best.captured, best.key.endsWith('/'));
}

function collectTargets(value: unknown, captured: string, directoryKey = false): string[] {
  const targets: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      const target = directoryKey ? `${node}${captured}` : node.replaceAll('*', captured);
      if (target.startsWith('./') && !targets.includes(target)) {
        targets.push(target);
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
    } else if (isRecord(node)) {
      const conditions = Object.keys(node)
        .map((condition, order) => ({ condition, order }))
        .sort(
          (left, right) =>
            conditionRank(left.condition) - conditionRank(right.condition) ||
            left.order - right.order
        );
      for (const { condition } of conditions) {
        visit(node[condition]);
      }
    }
  };
  visit(value);
  return targets;
}

/** 键以 `.`（exports）或 `#`（imports）开头的对象是子路径映射；否则是条件对象。 */
function isSubpathMap(map: unknown): map is Record<string, unknown> {
  return (
    isRecord(map) && Object.keys(map).some((key) => key.startsWith('.') || key.startsWith('#'))
  );
}

/** 编译配置里的输出目录与源码根（项目相对路径）；两者都明确写出时才能把产物路径换回源码。 */
export interface PackageBuildLayout {
  outDir: string;
  rootDir: string;
}

/** 一个源码候选的基路径，以及它是怎么得到的。 */
export interface PackageEntryBase {
  /** 项目相对路径，可能带扩展名；具体文件由 moduleSourceCandidates 展开。 */
  base: string;
  /**
   * declared：清单写的就是这个路径；build-layout：按编译配置的 outDir / rootDir 换回源码；
   * convention：按"产物目录对应 src 或包根"的惯例换回源码，没有配置为证。
   */
  proof: 'declared' | 'build-layout' | 'convention';
}

/** 只放构建产物的目录：包入口指到这里时，目标不能是它本身，只能是换回的源码。 */
const BUILD_OUTPUT_DIRECTORIES = new Set(['dist', 'build', 'out']);
/** 可能是产物、也可能本身就是源码的目录：先试换回的源码，再试它本身。 */
const AMBIGUOUS_OUTPUT_DIRECTORIES = new Set(['lib', 'esm', 'cjs', 'es', 'umd']);
const DECLARATION_SUFFIX = /\.d\.(ts|mts|cts)$/;

/**
 * 清单里的一个入口目标 → 源码候选基路径，按尝试顺序排列。
 *
 * 包的入口通常指向构建产物（`./dist/index.js`、`./dist/index.d.ts`），而分析要的是源码。
 * 换回源码有两种依据：包自己的编译配置（outDir → rootDir），以及目录惯例（dist / lib … → src 或包根）。
 * 目标逃出包目录时没有候选。
 */
export function packageEntryBases(input: {
  /** 包目录，项目相对；项目根是空串。 */
  packageDirectory: string;
  /** 清单里的目标，如 `./dist/index.js`；不带 `./` 的旧写法同样接受。 */
  target: string;
  layout?: PackageBuildLayout;
  /** 是否允许按目录惯例换回源码。 */
  conventions: boolean;
}): PackageEntryBase[] {
  const relative = path.posix.normalize(input.target.replace(/^\.\//, ''));
  if (!relative || relative === '.' || relative.startsWith('../') || relative === '..') {
    return [];
  }
  // 声明文件对应的源码与它同名：去掉 `.d.ts` 后按无扩展名的基路径找。
  const withinPackage = relative.replace(DECLARATION_SUFFIX, '');
  const declared = joinPath(input.packageDirectory, withinPackage);
  const bases: PackageEntryBase[] = [];
  const add = (base: string, proof: PackageEntryBase['proof']) => {
    if (!bases.some((item) => item.base === base)) {
      bases.push({ base, proof });
    }
  };

  const { layout } = input;
  const underOutDir =
    layout !== undefined &&
    layout.outDir !== layout.rootDir &&
    (declared === layout.outDir || declared.startsWith(`${layout.outDir}/`));
  if (layout && underOutDir) {
    add(joinPath(layout.rootDir, declared.slice(layout.outDir.length + 1)), 'build-layout');
  }

  const segments = withinPackage.split('/');
  let leading = 0;
  while (
    leading < segments.length - 1 &&
    (BUILD_OUTPUT_DIRECTORIES.has(segments[leading]) ||
      AMBIGUOUS_OUTPUT_DIRECTORIES.has(segments[leading]))
  ) {
    leading += 1;
  }
  const inBuildOutput = underOutDir || BUILD_OUTPUT_DIRECTORIES.has(segments[0]);
  if (leading > 0 && input.conventions) {
    const rest = segments.slice(leading).join('/');
    // `dist/src/index.js`（rootDir 是包根的 tsc 输出）去掉产物目录后已经带着 src。
    if (!rest.startsWith('src/')) {
      add(joinPath(input.packageDirectory, `src/${rest}`), 'convention');
    }
    add(joinPath(input.packageDirectory, rest), 'convention');
  }
  if (!inBuildOutput) {
    add(declared, 'declared');
    if (withinPackage !== relative) {
      // 手写的声明文件（不在产物目录里）本身也可以是目标，排在同名源码之后。
      add(joinPath(input.packageDirectory, relative), 'declared');
    }
  }
  return bases;
}

/**
 * workspace 成员模式拆成"要匹配的目录模式"与"排除模式"。
 * 模式相对声明它的清单所在目录；`!` 开头的是排除。
 */
export function splitWorkspaceGlobs(globs: readonly string[]): {
  include: string[][];
  exclude: RegExp[];
} {
  const include: string[][] = [];
  const exclude: RegExp[] = [];
  for (const raw of globs) {
    const negated = raw.startsWith('!');
    const pattern = path.posix
      .normalize((negated ? raw.slice(1) : raw).trim().replace(/^\.\//, ''))
      .replace(/\/+$/, '');
    if (!pattern || pattern === '.' || pattern.startsWith('../') || pattern.startsWith('/')) {
      continue;
    }
    if (negated) {
      exclude.push(globToRegExp(pattern));
    } else {
      include.push(pattern.split('/'));
    }
  }
  return { include, exclude };
}

/** 模式里一段目录名的匹配：`*` 匹配任意个非分隔符字符。 */
export function matchesGlobSegment(pattern: string, name: string): boolean {
  if (!pattern.includes('*')) {
    return pattern === name;
  }
  return new RegExp(`^${escapeForGlob(pattern)}$`).test(name);
}

/** 排除模式匹配目录及其下的一切；`**` 匹配零到多层目录。 */
function globToRegExp(pattern: string): RegExp {
  const segments = pattern.split('/');
  let source = '';
  for (const [index, segment] of segments.entries()) {
    const last = index === segments.length - 1;
    if (segment === '**') {
      // 末尾的 `**` 由结尾的"及其下的一切"覆盖。
      source = last ? source.replace(/\/$/, '') : `${source}(?:[^/]+/)*`;
    } else {
      source += `${escapeForGlob(segment)}${last ? '' : '/'}`;
    }
  }
  return new RegExp(`^${source}(?:/.*)?$`);
}

function escapeForGlob(segment: string): string {
  return segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*');
}

function joinPath(directory: string, relative: string): string {
  return directory ? `${directory}/${relative}` : relative;
}

function parseJsonRecord(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
