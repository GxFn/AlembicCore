/**
 * 语法节点的真实位置：声明、调用点与外部引擎的边靠它对应。
 * 行 1-based；列是 UTF-16 的 0-based 偏移（WASM 字符串的列）。
 */
export function astNodeRange(node: Pick<TreeSitterNode, 'startPosition' | 'endPosition'>) {
  return {
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column,
    endColumn: node.endPosition.column,
  };
}
