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
  /** 只控制SDK目录发现；raw目录事实不在传输层篡改。 */
  excludedDirectories?: string[];
}
export interface CodeGraphInputRequest {
  operation: 'file' | 'directory' | 'stat' | 'realpath' | 'git';
  relativePath: string;
  args?: (string | { relative: string })[];
}
/** 单项reader事实；不改变持久化snapshot，错误只允许真实文件不存在进入SDK。 */
export type CodeGraphInputOutcome =
  | {
      ok: true;
      value:
        | string
        | { name: string; kind: string }[]
        | { kind: string; mode: number; size: number }
        | CodeGraphGitObservation;
    }
  | { ok: false; code: 'ENOENT' | 'ENOTDIR' };
export type CodeGraphInputReader = (
  request: CodeGraphInputRequest,
  signal: AbortSignal
) => Promise<CodeGraphInputOutcome>;

// 原64次尝试×4096缺口的累计上界；流式读取不再有“每轮”的批次含义。
export const CODEGRAPH_MAX_SUPPORT_INPUTS = 64 * 4096;

export function isCodeGraphInputRequest(value: unknown): value is CodeGraphInputRequest {
  return (
    record(value) &&
    ['file', 'directory', 'stat', 'realpath', 'git'].includes(String(value.operation)) &&
    typeof value.relativePath === 'string' &&
    (value.args === undefined ||
      (Array.isArray(value.args) &&
        value.args.every(
          (arg: unknown) =>
            typeof arg === 'string' || (record(arg) && typeof arg.relative === 'string')
        )))
  );
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
