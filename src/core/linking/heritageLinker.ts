import type { ExtractedFileFlowImport, ExtractedFileSymbol } from '../facts/contracts.js';
import { type ModuleGraphAccess, resolveExportedDeclaration } from './exportTable.js';

export type HeritageStrategy =
  | 'same-file-declaration'
  | 'named-import'
  | 'default-import'
  | 'namespace-member';

export interface HeritageTarget {
  /** 写出父类型的声明。 */
  from: ExtractedFileSymbol;
  relation: 'extends' | 'implements';
  /** 源码里写的名字。 */
  name: string;
  filePath: string;
  symbol: ExtractedFileSymbol;
  strategy: HeritageStrategy;
  viaReexport: boolean;
  /** 到达声明的路上有一步是按目录惯例解析的模块。 */
  conventional?: boolean;
}

/** 可以出现在 extends / implements 位置的声明种类。 */
const TYPE_LIKE_KINDS = new Set(['class', 'interface', 'type', 'enum']);

/**
 * JS/TS 的类型层级链接：类与接口写出的父类型名字是模块作用域里的标识符，
 * 要么是同文件的顶层声明，要么是一条 import 绑定。两种情形都有语法证明。
 *
 * 类型导入（`import type`）在这里有效：implements 与接口继承只需要类型。
 * 说明符落不到项目内文件（项目外的包）或找不到唯一声明时不产出。
 */
export async function linkHeritage(input: {
  filePath: string;
  symbols: readonly ExtractedFileSymbol[];
  imports: readonly ExtractedFileFlowImport[];
  access: ModuleGraphAccess;
}): Promise<HeritageTarget[]> {
  const bindings = input.imports.flatMap((record) =>
    (record.bindings ?? []).map((binding) => ({ ...binding, specifier: record.specifier }))
  );
  const targets: HeritageTarget[] = [];
  for (const from of input.symbols) {
    // 成员与嵌套声明不在模块作用域，名字不能按模块绑定解释。
    if (!from.heritage || from.container) {
      continue;
    }
    for (const relation of ['extends', 'implements'] as const) {
      for (const name of from.heritage[relation]) {
        const target = await resolveTypeName(input, bindings, name);
        if (target && target.symbol !== from) {
          targets.push({ from, relation, name, ...target });
        }
      }
    }
  }
  return targets;
}

async function resolveTypeName(
  input: {
    filePath: string;
    symbols: readonly ExtractedFileSymbol[];
    access: ModuleGraphAccess;
  },
  bindings: readonly {
    local: string;
    imported: string;
    specifier: string;
  }[],
  name: string
): Promise<
  | Pick<HeritageTarget, 'filePath' | 'symbol' | 'strategy' | 'viaReexport' | 'conventional'>
  | undefined
> {
  const parts = name.split('.');
  if (parts.length > 2 || parts.some((part) => !/^[A-Za-z_$][\w$]*$/.test(part))) {
    // 表达式形式的父类（mixin 调用等）没有可指向的声明。
    return undefined;
  }
  const binding = bindings.filter((candidate) => candidate.local === parts[0]);
  if (parts.length === 2) {
    // `ns.Base`：ns 必须是命名空间导入。
    if (binding.length !== 1 || binding[0].imported !== '*') {
      return undefined;
    }
    const module = await input.access.resolveModule(input.filePath, binding[0].specifier);
    const declared = module
      ? await resolveExportedDeclaration(input.access, module.filePath, parts[1])
      : undefined;
    return declared
      ? {
          ...declared,
          strategy: 'namespace-member',
          ...(module?.conventional || declared.conventional ? { conventional: true } : {}),
        }
      : undefined;
  }

  const local = input.symbols.filter(
    (symbol) => !symbol.container && symbol.name === name && TYPE_LIKE_KINDS.has(symbol.kind)
  );
  if (local.length === 1 && binding.length === 0) {
    return {
      filePath: input.filePath,
      symbol: local[0],
      strategy: 'same-file-declaration',
      viaReexport: false,
    };
  }
  // 同名的本地声明与导入并存（声明合并）时无法唯一确定，不猜。
  if (local.length > 0 || binding.length !== 1 || binding[0].imported === '*') {
    return undefined;
  }
  const module = await input.access.resolveModule(input.filePath, binding[0].specifier);
  if (!module || module.filePath === input.filePath) {
    return undefined;
  }
  const declared = await resolveExportedDeclaration(
    input.access,
    module.filePath,
    binding[0].imported
  );
  return declared
    ? {
        ...declared,
        strategy: binding[0].imported === 'default' ? 'default-import' : 'named-import',
        ...(module.conventional || declared.conventional ? { conventional: true } : {}),
      }
    : undefined;
}
