import path from 'node:path';

/**
 * 一份 tsconfig / jsconfig 里与模块解析有关的部分，路径都已换成项目相对路径。
 * 这里只做别名到候选路径的换算；读配置文件、判断候选是否存在由调用方负责。
 */
export interface ModuleAliasConfig {
  /** `baseUrl` 指向的目录；项目根是空串。没有 baseUrl 时不带这一项。 */
  baseUrl?: string;
  /** `paths` 的每一条：模式最多含一个 `*`，目标是项目相对路径（同样最多含一个 `*`）。 */
  paths: { pattern: string; targets: string[] }[];
}

/** 配置文件里读出的原始内容，尚未换算路径。 */
export interface ModuleConfigSource {
  baseUrl?: string;
  paths?: Record<string, string[]>;
  /** `extends` 指向的其他配置文件（原样）。 */
  extends: string[];
}

/** 模块配置文件的固定名字；同一目录下 tsconfig 优先。 */
export const MODULE_CONFIG_FILE_NAMES: readonly string[] = ['tsconfig.json', 'jsconfig.json'];

/**
 * 读出 tsconfig / jsconfig 的 `extends`、`compilerOptions.baseUrl`、`compilerOptions.paths`。
 * 这类文件允许注释与尾随逗号；内容不合法时返回 undefined，调用方按"没有别名配置"处理。
 */
export function parseModuleConfig(text: string): ModuleConfigSource | undefined {
  let value: unknown;
  try {
    value = JSON.parse(stripJsonComments(text));
  } catch {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const options = isRecord(value.compilerOptions) ? value.compilerOptions : {};
  const paths: Record<string, string[]> = {};
  if (isRecord(options.paths)) {
    for (const [pattern, targets] of Object.entries(options.paths)) {
      if (Array.isArray(targets)) {
        paths[pattern] = targets.filter((target): target is string => typeof target === 'string');
      }
    }
  }
  const inherited = Array.isArray(value.extends) ? value.extends : [value.extends];
  return {
    ...(typeof options.baseUrl === 'string' ? { baseUrl: options.baseUrl } : {}),
    ...(isRecord(options.paths) ? { paths } : {}),
    extends: inherited.filter((item): item is string => typeof item === 'string'),
  };
}

/**
 * 把一份配置换算成项目相对路径，并叠加在它继承的配置之上。
 * 规则与 TypeScript 一致：baseUrl 相对声明它的配置文件所在目录；paths 整体覆盖继承来的 paths，
 * 目标相对 baseUrl，没有 baseUrl 时相对声明 paths 的配置文件所在目录。
 */
export function resolveModuleAliasConfig(
  configFilePath: string,
  source: ModuleConfigSource,
  inherited?: ModuleAliasConfig
): ModuleAliasConfig {
  const directory = path.posix.dirname(configFilePath);
  const baseUrl =
    source.baseUrl === undefined ? inherited?.baseUrl : joinProjectPath(directory, source.baseUrl);
  if (source.paths === undefined) {
    return { ...(baseUrl === undefined ? {} : { baseUrl }), paths: inherited?.paths ?? [] };
  }
  const anchor = baseUrl ?? directory;
  const paths = Object.entries(source.paths).flatMap(([pattern, targets]) => {
    const resolved = targets.flatMap((target) => {
      const joined = joinProjectPath(anchor, target);
      return joined === undefined ? [] : [joined];
    });
    return isUsablePattern(pattern) && resolved.length > 0 ? [{ pattern, targets: resolved }] : [];
  });
  return { ...(baseUrl === undefined ? {} : { baseUrl }), paths };
}

/**
 * 非相对说明符按别名配置可能落到的基路径，按优先级排列：
 * 先是最具体的 `paths` 模式（完全相等优先，其次 `*` 之前的前缀最长者）的各个目标，
 * 没有模式命中时才用 baseUrl。相对说明符与逃出项目根的结果不在这里。
 */
export function aliasModuleBases(config: ModuleAliasConfig, specifier: string): string[] {
  if (specifier.startsWith('.') || path.posix.isAbsolute(specifier)) {
    return [];
  }
  let best: { prefixLength: number; captured: string; targets: string[] } | undefined;
  for (const { pattern, targets } of config.paths) {
    const star = pattern.indexOf('*');
    if (star === -1) {
      if (pattern === specifier) {
        best = { prefixLength: Number.POSITIVE_INFINITY, captured: '', targets };
      }
      continue;
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix) &&
      (!best || prefix.length > best.prefixLength)
    ) {
      best = {
        prefixLength: prefix.length,
        captured: specifier.slice(prefix.length, specifier.length - suffix.length),
        targets,
      };
    }
  }
  if (best) {
    const { captured, targets } = best;
    return targets.flatMap((target) => {
      const base = normalizeProjectPath(target.replace('*', captured));
      return base === undefined ? [] : [base];
    });
  }
  if (config.baseUrl === undefined) {
    return [];
  }
  const base = joinProjectPath(config.baseUrl, specifier);
  return base === undefined ? [] : [base];
}

/** 继承的配置文件路径：只跟随相对路径；包名形式的 extends（共享预设）不解析。 */
export function inheritedModuleConfigPath(
  configFilePath: string,
  reference: string
): string | undefined {
  if (!reference.startsWith('./') && !reference.startsWith('../')) {
    return undefined;
  }
  const joined = joinProjectPath(path.posix.dirname(configFilePath), reference);
  if (joined === undefined) {
    return undefined;
  }
  return path.posix.extname(joined) === '.json' ? joined : `${joined}.json`;
}

function isUsablePattern(pattern: string): boolean {
  return pattern.length > 0 && pattern.indexOf('*') === pattern.lastIndexOf('*');
}

function joinProjectPath(directory: string, relative: string): string | undefined {
  if (path.posix.isAbsolute(relative)) {
    return undefined;
  }
  return normalizeProjectPath(path.posix.join(directory === '.' ? '' : directory, relative));
}

function normalizeProjectPath(value: string): string | undefined {
  const normalized = path.posix.normalize(value);
  if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    return undefined;
  }
  const trimmed = normalized.replace(/\/$/, '');
  return trimmed === '.' ? '' : trimmed;
}

/** 去掉 JSON 里的注释与尾随逗号；字符串内容原样保留。 */
function stripJsonComments(text: string): string {
  let result = '';
  let plain = '';
  // 尾随逗号只可能出现在字符串之外的一段里；逐段处理，不碰字符串内容。
  const flush = () => {
    result += plain.replace(/,(\s*[}\]])/g, '$1');
    plain = '';
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      flush();
      const start = index;
      index += 1;
      while (index < text.length && text[index] !== '"') {
        index += text[index] === '\\' ? 2 : 1;
      }
      index += 1;
      result += text.slice(start, index);
    } else if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') {
        index += 1;
      }
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      plain += char;
      index += 1;
    }
  }
  flush();
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
