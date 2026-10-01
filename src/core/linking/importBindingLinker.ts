import type {
  ExtractedFileFlowCallSite,
  ExtractedFileFlowImport,
  ExtractedFileSymbol,
} from '../facts/contracts.js';
import { type ModuleGraphAccess, resolveExportedDeclaration } from './exportTable.js';

/** 目标是如何从一条 import 绑定推到声明的；随关系一起记录，供索引与诊断区分证据强度。 */
export type ImportBindingStrategy =
  /** `import { a } from './m'; a()` */
  | 'named-import'
  /** `import a from './m'; a()` */
  | 'default-import'
  /** `import * as ns from './m'; ns.a()` */
  | 'namespace-member'
  /** `import { Type } from './m'; Type.member()`：导入符号上的成员。 */
  | 'imported-member';

export interface ImportBoundTarget {
  /** 调用点在输入 callSites 里的下标。 */
  index: number;
  filePath: string;
  symbol: ExtractedFileSymbol;
  strategy: ImportBindingStrategy;
  viaReexport: boolean;
}

type ImportBinding = NonNullable<ExtractedFileFlowImport['bindings']>[number] & {
  specifier: string;
};

/** 能被 import 绑定证明的调用形态：普通调用、`new`、JSX 元素。 */
const LINKABLE_SYNTAX = new Set(['call', 'new', 'jsx']);

/**
 * JS/TS 的导入绑定链接：调用点的被调标识符在词法上绑定到一条 import，
 * 沿"说明符 → 目标文件 → 导出表"找到声明。
 *
 * 依据全部来自语法事实（词法绑定范围、import 绑定表、导出表），没有按名字相似度的推断；
 * 任何一步无法唯一确定就不产出目标。只处理相对说明符——包名与路径别名交给外部链接器。
 */
export async function linkImportBoundCallSites(input: {
  filePath: string;
  imports: readonly ExtractedFileFlowImport[];
  callSites: readonly ExtractedFileFlowCallSite[];
  access: ModuleGraphAccess;
}): Promise<ImportBoundTarget[]> {
  const bindings: ImportBinding[] = input.imports.flatMap((record) =>
    (record.bindings ?? []).map((binding) => ({ ...binding, specifier: record.specifier }))
  );
  if (bindings.length === 0) {
    return [];
  }
  const modules = new Map<string, Promise<string | undefined>>();
  const moduleOf = (specifier: string) => {
    let pending = modules.get(specifier);
    if (!pending) {
      pending = input.access.resolveModule(input.filePath, specifier);
      modules.set(specifier, pending);
    }
    return pending;
  };

  const targets: ImportBoundTarget[] = [];
  for (const [index, site] of input.callSites.entries()) {
    const binding = importBindingOf(site, bindings);
    if (!binding) {
      continue;
    }
    const targetFile = await moduleOf(binding.specifier);
    if (!targetFile || targetFile === input.filePath) {
      continue;
    }
    const target = await resolveSite(input.access, targetFile, site, binding);
    if (target) {
      targets.push({ index, ...target });
    }
  }
  return targets;
}

/** 调用点词法绑定到的 import；类型导入不是运行时绑定，参数或局部变量遮蔽时范围不会相等。 */
function importBindingOf(
  site: ExtractedFileFlowCallSite,
  bindings: readonly ImportBinding[]
): ImportBinding | undefined {
  const range = site.calleeBindingRange;
  if (!range || !LINKABLE_SYNTAX.has(site.syntaxKind ?? '')) {
    return undefined;
  }
  return bindings.find(
    (binding) =>
      !binding.typeOnly &&
      sameRange(binding.range, range) &&
      (site.receiver ? site.receiver === binding.local : site.callee === binding.local)
  );
}

async function resolveSite(
  access: ModuleGraphAccess,
  targetFile: string,
  site: ExtractedFileFlowCallSite,
  binding: ImportBinding
): Promise<Omit<ImportBoundTarget, 'index'> | undefined> {
  if (!site.receiver) {
    if (binding.imported === '*') {
      // 命名空间对象本身不可调用。
      return undefined;
    }
    const declared = await resolveExportedDeclaration(access, targetFile, binding.imported);
    return declared
      ? {
          ...declared,
          strategy: binding.imported === 'default' ? 'default-import' : 'named-import',
        }
      : undefined;
  }
  if (binding.imported === '*') {
    const declared = await resolveExportedDeclaration(access, targetFile, site.callee);
    return declared ? { ...declared, strategy: 'namespace-member' } : undefined;
  }
  // 导入符号上的成员：先定位拥有者声明，再在它所在文件里找唯一的同名成员。
  const owner = await resolveExportedDeclaration(access, targetFile, binding.imported);
  if (!owner) {
    return undefined;
  }
  const module = await access.declarations(owner.filePath);
  const members = (module?.symbols ?? []).filter(
    (symbol) => symbol.container === owner.symbol.name && symbol.name === site.callee
  );
  return members.length === 1
    ? {
        filePath: owner.filePath,
        symbol: members[0],
        strategy: 'imported-member',
        viaReexport: owner.viaReexport,
      }
    : undefined;
}

function sameRange(
  left: { startLine: number; endLine: number; startColumn?: number; endColumn?: number },
  right: typeof left
): boolean {
  return (
    left.startLine === right.startLine &&
    left.endLine === right.endLine &&
    left.startColumn === right.startColumn &&
    left.endColumn === right.endColumn
  );
}
