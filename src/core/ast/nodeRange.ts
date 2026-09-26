/** AST与CodeGraph对应使用的真实节点位置；行1-based，WASM字符串列为UTF-16的0-based偏移。 */
export function astNodeRange(node: Pick<TreeSitterNode, 'startPosition' | 'endPosition'>) {
  return {
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column,
    endColumn: node.endPosition.column,
  };
}
