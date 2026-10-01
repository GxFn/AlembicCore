import type { ExtractedFileFlowExport, ExtractedFileSymbol } from '../facts/contracts.js';

/** 一个模块对外可见的声明事实：顶层符号、导出记录、default 声明名。 */
export interface ModuleDeclarations {
  symbols: readonly ExtractedFileSymbol[];
  exports: readonly ExtractedFileFlowExport[];
  /** 保留重数：多个 default 声明不能因去重变成唯一目标。 */
  defaultExportNames: readonly string[];
}

/**
 * 链接器访问其他模块的唯一通道。实现方决定文件从哪里来（live 读取器、冻结快照、索引），
 * 链接器本身不读磁盘，因此同一份输入必得同一份结果。
 */
export interface ModuleGraphAccess {
  /** 取模块的声明事实；文件不存在或语法不可用时返回 undefined。 */
  declarations(filePath: string): Promise<ModuleDeclarations | undefined>;
  /** 把相对说明符解析成项目内文件；非相对说明符或找不到时返回 undefined。 */
  resolveModule(importerFile: string, specifier: string): Promise<string | undefined>;
}

export interface ExportedDeclaration {
  filePath: string;
  symbol: ExtractedFileSymbol;
  /** 是否经过 re-export（具名转发或 `export *`）才到达声明。 */
  viaReexport: boolean;
}

/** re-export 链的跟随上限；真实项目的 barrel 层数远低于此，超过即视为无法证明。 */
const MAX_REEXPORT_DEPTH = 8;

/**
 * 在模块的导出表里找名字对应的声明，跟随 re-export 链。
 * 只在能唯一确定时返回；任何歧义（多个同名声明、多个 `export *` 命中不同目标）都返回 undefined，
 * 不按顺序或距离猜一个。
 */
export async function resolveExportedDeclaration(
  access: ModuleGraphAccess,
  filePath: string,
  exportedName: string
): Promise<ExportedDeclaration | undefined> {
  return resolve(access, filePath, exportedName, 0, new Set(), false);
}

async function resolve(
  access: ModuleGraphAccess,
  filePath: string,
  exportedName: string,
  depth: number,
  visited: Set<string>,
  viaReexport: boolean
): Promise<ExportedDeclaration | undefined> {
  const key = `${filePath}\u0000${exportedName}`;
  if (depth > MAX_REEXPORT_DEPTH || visited.has(key)) {
    return undefined;
  }
  visited.add(key);
  const module = await access.declarations(filePath);
  if (!module) {
    return undefined;
  }

  // 1. 具名转发：export { a as b } from './x' / export { default } from './x'
  const forwarded = module.exports.filter(
    (item) =>
      item.specifier && item.name !== '*' && (item.exportedName ?? item.name) === exportedName
  );
  if (forwarded.length > 1) {
    return undefined;
  }
  if (forwarded.length === 1) {
    const target = await access.resolveModule(filePath, forwarded[0].specifier as string);
    return target
      ? resolve(access, target, forwarded[0].name, depth + 1, visited, true)
      : undefined;
  }

  // 2. 本模块声明：default 由 AST 的 default 标记给出，具名的先看本地别名再看同名声明。
  const localName = localNameFor(module, exportedName);
  if (localName !== undefined) {
    const declared = uniqueTopLevelDeclaration(module.symbols, localName);
    if (declared) {
      return { filePath, symbol: declared, viaReexport };
    }
  }
  if (exportedName === 'default') {
    // default 没有同名回退：匿名 default 或无法定位的表达式不指向任何声明。
    return undefined;
  }

  // 3. 星号转发：export * from './x'。default 不经 `export *` 转发，上面已返回。
  const hits = new Map<string, ExportedDeclaration>();
  for (const star of module.exports) {
    if (star.name !== '*' || !star.specifier || star.exportedName) {
      continue;
    }
    const target = await access.resolveModule(filePath, star.specifier);
    const hit = target
      ? await resolve(access, target, exportedName, depth + 1, new Set(visited), true)
      : undefined;
    if (hit) {
      hits.set(`${hit.filePath}\u0000${hit.symbol.name}\u0000${hit.symbol.range.startLine}`, hit);
    }
  }
  return hits.size === 1 ? [...hits.values()][0] : undefined;
}

/** 导出名在本模块里对应的本地名；undefined 表示本模块没有以该名字导出本地声明的证据。 */
function localNameFor(module: ModuleDeclarations, exportedName: string): string | undefined {
  if (exportedName === 'default') {
    return module.defaultExportNames.length === 1 ? module.defaultExportNames[0] : undefined;
  }
  const alias = module.exports.find(
    (item) => !item.specifier && item.exportedName === exportedName && item.name !== exportedName
  );
  return alias ? alias.name : exportedName;
}

/**
 * 顶层同名声明必须唯一。唯一的例外是函数重载：同名且全部是函数时取最后一个（实现签名）。
 * 其他合并形态（interface 与 class 同名等）不猜。
 */
function uniqueTopLevelDeclaration(
  symbols: readonly ExtractedFileSymbol[],
  name: string
): ExtractedFileSymbol | undefined {
  const candidates = symbols.filter((symbol) => !symbol.container && symbol.name === name);
  if (candidates.length === 1) {
    return candidates[0];
  }
  if (candidates.length > 1 && candidates.every((symbol) => symbol.kind === 'function')) {
    return [...candidates]
      .sort((left, right) => left.range.startLine - right.range.startLine)
      .at(-1);
  }
  return undefined;
}
