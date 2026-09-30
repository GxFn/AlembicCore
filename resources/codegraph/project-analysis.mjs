import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const projectHash = (value) =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

export function projectNode(node) {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    qualifiedName: node.qualifiedName,
    startLine: node.startLine,
    endLine: node.endLine,
    startColumn: node.startColumn,
    endColumn: node.endColumn,
    isExported: node.isExported,
  };
}

/** 每个输入视图独立新图；缺项同步等reader事实，不让未知配置进入SDK后再重建。 */
export async function analyzeFrozenProject(sdk, io, directory, input, readInput) {
  const viewRoot = await fs.mkdtemp(path.join(directory, 'project-'));
  // 为合法的父级配置留独立的虚拟祖先；不会按support相对路径向宿主写回文件。
  const physicalRoot = path.join(viewRoot, ...Array.from({ length: 16 }, () => 'scope'));
  await fs.mkdir(physicalRoot, { recursive: true });
  io.begin({ ...input, physicalRoot, viewRoot, readInput });
  let graph;
  let result;
  let error;
  try {
    graph = await sdk.CodeGraph.init(physicalRoot, { index: false });
    const index = await graph.indexFiles(input.files);
    const records = new Map(graph.getFiles().map((file) => [file.path, file]));
    const files = input.files.map((filePath) => {
      const nodes = graph.getNodesInFile(filePath);
      const record = records.get(filePath);
      return {
        filePath,
        nodes: nodes.map(projectNode),
        contentHash: record?.contentHash,
        // SDK同id入库覆盖不能冒充一个唯一声明；保守拒绝该文件的跨文件端点。
        ambiguous: !record || record.nodeCount !== nodes.length,
      };
    });
    graph.reinitializeResolver();
    const resolution = graph.resolveReferences();
    const bindings = resolution.resolved.flatMap((entry) => {
      const original = entry.original;
      if (
        !['calls', 'instantiates'].includes(original.referenceKind) ||
        !Number.isInteger(original.line) ||
        !Number.isInteger(original.column)
      ) {
        return [];
      }
      return [
        {
          filePath: original.filePath,
          fromNodeId: original.fromNodeId,
          referenceName: original.referenceName,
          referenceKind: original.referenceKind,
          line: original.line,
          column: original.column,
          targetNodeId: entry.targetNodeId,
          resolvedBy: entry.resolvedBy,
          confidence: entry.confidence,
        },
      ];
    });
    result = {
      status: 'ready',
      files,
      bindings,
      errors: index.errors.filter((item) => item.severity === 'error').map((item) => item.message),
      unresolvedCount: resolution.unresolved.length,
    };
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
  } finally {
    try {
      graph?.close();
    } catch (failure) {
      error ??= `SDK graph close failed: ${String(failure)}`;
    }
  }
  const audit = io.finish();
  await fs.rm(viewRoot, { recursive: true, force: true });
  if (audit.failure) {
    return { status: 'unavailable', reason: audit.failure };
  }
  if (error) {
    return { status: 'unavailable', reason: error };
  }
  return result;
}
