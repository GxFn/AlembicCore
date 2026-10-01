/**
 * 语法包落后于语言本身时，合法源码也会带 ERROR 节点。这里只认两类已知且不影响运行时事实的情形：
 *
 * 1. `export type * from './x'`：语法包把 `type` 包进 ERROR，语句其余部分按 `export * from` 正常解析。
 * 2. ERROR 完全落在类型位置（类型实参、类型标注、类型别名、接口体）：例如类型实参里的
 *    `import('./types').Name`。类型位置不产出声明、导入导出或调用点。
 *
 * 其余任何 ERROR，以及任何 MISSING 节点（缺括号、缺分号等结构性损坏），都不容忍。
 */
const TYPE_ONLY_ANCESTORS: ReadonlySet<string> = new Set([
  'type_arguments',
  'type_annotation',
  'type_parameters',
  'type_alias_declaration',
  'interface_body',
]);

/** 树里的语法错误是否全部属于可容忍的类型层缺口。没有错误时也返回 true。 */
export function hasOnlyTolerableSyntaxErrors(root: TreeSitterNode): boolean {
  const visit = (node: TreeSitterNode, inTypeContext: boolean): boolean => {
    if (node.isMissing) {
      return false;
    }
    if (node.type === 'ERROR') {
      return inTypeContext || isTypeOnlyStarExport(node);
    }
    if (!node.hasError) {
      // 子树没有错误，不必下探。
      return true;
    }
    const typeContext = inTypeContext || TYPE_ONLY_ANCESTORS.has(node.type);
    for (const child of node.children) {
      if (!visit(child, typeContext)) {
        return false;
      }
    }
    return true;
  };
  return visit(root, false);
}

function isTypeOnlyStarExport(error: TreeSitterNode): boolean {
  const statement = error.parent;
  return (
    error.text === 'type' &&
    statement?.type === 'export_statement' &&
    statement.childForFieldName('source') !== null &&
    statement.children.some((child) => child.type === '*' || child.type === 'namespace_export')
  );
}
