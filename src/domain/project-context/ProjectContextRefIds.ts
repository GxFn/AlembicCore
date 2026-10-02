import type { ProjectContextRef, SourceRangeSummary } from './ProjectContextRefs.js';

/** 一条协议引用里能读出的定位信息。 */
export interface ParsedProjectContextRef {
  kind: 'file' | 'source-slice' | 'file-symbol' | 'relation-site';
  filePath: string;
  repoId?: string;
  range?: SourceRangeSummary;
  /** 引用生成时文件内容的短哈希；没有哈希的引用无法判断是否过期。 */
  hash?: string;
  /** file-symbol 的声明种类与（限定）名。 */
  symbolKind?: string;
  name?: string;
  /** relation-site 的关系种类，以及关系指向的符号名或文件。 */
  relationKind?: string;
  target?: string;
}

const RANGE = /^L(\d+)-L(\d+)$/;
const COLUMNS = /^(\d+)-(\d+)$/;

/**
 * 从引用对象或引用 id 读出定位信息。
 *
 * 引用对象直接取 scope 与 metadata；只有 id 字符串时按生成规则拆回去——各段用 `:` 分隔，
 * 段内的 `:` 生成时已经转义，所以按 `:` 拆是无歧义的。认不出的输入返回 undefined。
 */
export function parseProjectContextRef(
  input: ProjectContextRef | string | undefined
): ParsedProjectContextRef | undefined {
  if (!input) {
    return undefined;
  }
  if (typeof input !== 'string') {
    const kind = input.kind;
    const filePath = input.scope?.filePath;
    if (
      !filePath ||
      (kind !== 'file' &&
        kind !== 'source-slice' &&
        kind !== 'file-symbol' &&
        kind !== 'relation-site')
    ) {
      // 引用对象不完整时退回去解析它的 id。
      return typeof input.id === 'string' ? parseProjectContextRef(input.id) : undefined;
    }
    const metadata = input.metadata ?? {};
    return {
      kind,
      filePath,
      ...(input.scope.repoId ? { repoId: input.scope.repoId } : {}),
      ...(input.scope.range ? { range: input.scope.range } : {}),
      ...(typeof metadata.hash === 'string' ? { hash: metadata.hash } : {}),
      ...(kind === 'file-symbol' && typeof metadata.kind === 'string'
        ? { symbolKind: metadata.kind }
        : {}),
      ...(kind === 'file-symbol'
        ? {
            name:
              typeof metadata.qualifiedName === 'string'
                ? metadata.qualifiedName
                : typeof metadata.name === 'string'
                  ? metadata.name
                  : input.label,
          }
        : {}),
      ...(kind === 'relation-site'
        ? {
            ...(typeof metadata.kind === 'string' ? { relationKind: metadata.kind } : {}),
            ...relationTarget(metadata),
          }
        : {}),
    };
  }

  const parts = input.split(':');
  const kind = parts[0];
  if (
    kind !== 'file' &&
    kind !== 'source-slice' &&
    kind !== 'file-symbol' &&
    kind !== 'relation-site'
  ) {
    return undefined;
  }
  const decode = (value: string | undefined): string | undefined => {
    if (value === undefined) {
      return undefined;
    }
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  };
  const repo = decode(parts[1]);
  const filePath = decode(parts[2]);
  if (!repo || !filePath) {
    return undefined;
  }
  // file-symbol 与 relation-site 在文件之后各多两段（种类、名字或目标）。
  const headLength = kind === 'file-symbol' || kind === 'relation-site' ? 5 : 3;
  const rest = parts.slice(headLength);
  let range: SourceRangeSummary | undefined;
  if (kind !== 'file') {
    const lines = RANGE.exec(rest[0] ?? '');
    if (!lines) {
      return undefined;
    }
    range = { startLine: Number(lines[1]), endLine: Number(lines[2]) };
    rest.shift();
    const columns = COLUMNS.exec(rest[0] ?? '');
    if (columns) {
      range = { ...range, startColumn: Number(columns[1]), endColumn: Number(columns[2]) };
      rest.shift();
    }
  }
  const hash = decode(rest[0]);
  return {
    kind,
    filePath,
    ...(repo === 'root' ? {} : { repoId: repo }),
    ...(range ? { range } : {}),
    ...(hash ? { hash } : {}),
    ...(kind === 'file-symbol' ? { symbolKind: decode(parts[3]), name: decode(parts[4]) } : {}),
    ...(kind === 'relation-site'
      ? { relationKind: decode(parts[3]), target: decode(parts[4]) }
      : {}),
  };
}

/** 关系指向谁：与生成引用 id 时取目标的顺序一致。 */
function relationTarget(metadata: Record<string, unknown>): { target?: string } {
  for (const key of ['targetFilePath', 'specifier', 'qualifiedName', 'symbolName']) {
    const value = metadata[key];
    if (typeof value === 'string' && value) {
      return { target: value };
    }
  }
  return {};
}
