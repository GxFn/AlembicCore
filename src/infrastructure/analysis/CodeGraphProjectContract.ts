import type { CodeGraphGitObservation } from '../io/CodeGraphGitInput.js';
import type { ProjectInputRootBinding, ProjectInputSnapshot } from '../io/ProjectInputSnapshot.js';
import type { CodeGraphNode } from './CodeGraphProcess.js';

/** 私有IPC输入，roots只用于此次读集重绑定，不进入公共graph DTO或artifact。 */
export interface CodeGraphProjectInput {
  logicalRoot: string;
  roots: ProjectInputRootBinding[];
  snapshot: ProjectInputSnapshot;
  files: string[];
  git: CodeGraphGitObservation[];
}
export interface CodeGraphInputRequest {
  operation: 'file' | 'directory' | 'stat' | 'realpath' | 'git';
  relativePath: string;
  args?: (string | { relative: string })[];
}
export interface CodeGraphProjectBinding {
  filePath: string;
  fromNodeId: string;
  referenceName: string;
  referenceKind: 'calls' | 'instantiates';
  line: number;
  column: number;
  targetNodeId: string;
  resolvedBy: string;
  confidence: number;
}
export type CodeGraphProjectResult =
  | { status: 'needs-input'; requests: CodeGraphInputRequest[] }
  | { status: 'unavailable'; reason: string }
  | {
      status: 'ready';
      files: {
        filePath: string;
        nodes: CodeGraphNode[];
        contentHash?: string;
        ambiguous: boolean;
      }[];
      bindings: CodeGraphProjectBinding[];
      errors: string[];
      unresolvedCount: number;
    };

export function isCodeGraphProjectResult(value: unknown): value is CodeGraphProjectResult {
  if (!record(value)) {
    return false;
  }
  if (value.status === 'unavailable') {
    return typeof value.reason === 'string';
  }
  if (value.status === 'needs-input') {
    return (
      Array.isArray(value.requests) &&
      value.requests.every(
        (item: unknown) =>
          record(item) &&
          ['file', 'directory', 'stat', 'realpath', 'git'].includes(String(item.operation)) &&
          typeof item.relativePath === 'string' &&
          (item.args === undefined ||
            (Array.isArray(item.args) &&
              item.args.every(
                (arg: unknown) =>
                  typeof arg === 'string' || (record(arg) && typeof arg.relative === 'string')
              )))
      )
    );
  }
  return (
    value.status === 'ready' &&
    Array.isArray(value.files) &&
    value.files.every(
      (file: unknown) =>
        record(file) &&
        typeof file.filePath === 'string' &&
        Array.isArray(file.nodes) &&
        typeof file.ambiguous === 'boolean' &&
        (file.contentHash === undefined || typeof file.contentHash === 'string') &&
        file.nodes.every(
          (node: unknown) =>
            record(node) &&
            ['id', 'kind', 'name', 'qualifiedName'].every((key) => typeof node[key] === 'string') &&
            Number.isInteger(node.startLine) &&
            Number.isInteger(node.endLine)
        )
    ) &&
    Array.isArray(value.bindings) &&
    value.bindings.every(
      (binding: unknown) =>
        record(binding) &&
        ['filePath', 'fromNodeId', 'referenceName', 'targetNodeId', 'resolvedBy'].every(
          (key) => typeof binding[key] === 'string'
        ) &&
        ['calls', 'instantiates'].includes(String(binding.referenceKind)) &&
        Number.isInteger(binding.line) &&
        Number.isInteger(binding.column) &&
        typeof binding.confidence === 'number' &&
        Number.isFinite(binding.confidence)
    ) &&
    Array.isArray(value.errors) &&
    value.errors.every((error: unknown) => typeof error === 'string') &&
    Number.isInteger(value.unresolvedCount)
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
