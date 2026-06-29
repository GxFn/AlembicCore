/**
 * ColdStartIntent — 冷启动工作流意图（双执行者，见 docs/semantic-glossary.md）
 *
 * D4（CO2，docs only）：冷启动有两个并存的执行者意图，不做结构重组
 * （CKG1 拥有该区域重建）：
 *  - internal-agent（createInternalColdStartIntent）：进程内执行，
 *    completionPolicy='auto-fill'，可带 internalExecution 跳过开关；
 *  - host-agent（createHostAgentColdStartIntent）：宿主 Agent 驱动，
 *    completionPolicy='host-agent-dimension-complete'，无内部跳过开关。
 *
 * B6（CO2 裁决）：skip* 布尔簇（skipGuard/skipAsyncFill/skipTargetDelivery）
 * 经 `export *` 从包导出 ./workflows/cold-start 可达，非 internal-only，
 * 故"布尔簇→模式类型"重构按任务规则 DEFER（owner=AlembicCore window，
 * 触发器=CKG1 冷启动区域重建或允许 keep-provisional 类型形状变化的表面波）。
 * 本文件类型形状保持不变。
 */
import path from 'node:path';
import { normalizeDimensionIds, type WorkflowExecutor } from '../shared/WorkflowTypes.js';

export type ColdStartExecutor = WorkflowExecutor;

export interface InternalColdStartArgs {
  maxFiles?: number;
  skipGuard?: boolean;
  contentMaxLines?: number;
  incremental?: boolean;
  skipAsyncFill?: boolean;
  skipTargetDelivery?: boolean;
  loadSkills?: boolean;
  dimensions?: string[];
  sourceFolders?: readonly string[];
  [key: string]: unknown;
}

export interface HostAgentColdStartArgs {
  sourceFolders?: readonly string[];
}

export interface ColdStartProjectAnalysisIntent {
  maxFiles: number;
  contentMaxLines: number;
  skipGuard: boolean;
  sourceTag: 'bootstrap' | 'bootstrap-host-agent';
  summaryPrefix?: string;
  generateAstContext: boolean;
  sourceFolders?: string[];
}

export interface InternalColdStartExecutionIntent {
  skipAsyncFill: boolean;
  skipTargetDelivery: boolean;
}

export interface ColdStartWorkflowIntent {
  kind: 'cold-start';
  executor: ColdStartExecutor;
  analysisMode: 'full';
  cleanupPolicy: 'full-reset';
  completionPolicy: 'auto-fill' | 'host-agent-dimension-complete';
  projectAnalysis: ColdStartProjectAnalysisIntent;
  dimensionIds?: string[];
  internalExecution?: InternalColdStartExecutionIntent;
  ignoredFileDiffIncremental: boolean;
}

export function createInternalColdStartIntent(
  args: InternalColdStartArgs = {}
): ColdStartWorkflowIntent {
  const sourceFolders = normalizeColdStartSourceFolders(args.sourceFolders);
  return {
    kind: 'cold-start',
    executor: 'internal-agent',
    analysisMode: 'full',
    cleanupPolicy: 'full-reset',
    completionPolicy: 'auto-fill',
    projectAnalysis: {
      maxFiles: args.maxFiles ?? 500,
      contentMaxLines: args.contentMaxLines ?? 120,
      skipGuard: args.skipGuard ?? false,
      sourceTag: 'bootstrap',
      generateAstContext: true,
      ...(sourceFolders ? { sourceFolders } : {}),
    },
    dimensionIds: normalizeDimensionIds(args.dimensions),
    internalExecution: {
      skipAsyncFill: args.skipAsyncFill ?? false,
      skipTargetDelivery: args.skipTargetDelivery ?? false,
    },
    ignoredFileDiffIncremental: args.incremental === true,
  };
}

export function createHostAgentColdStartIntent(
  args: HostAgentColdStartArgs = {}
): ColdStartWorkflowIntent {
  const sourceFolders = normalizeColdStartSourceFolders(args.sourceFolders);
  return {
    kind: 'cold-start',
    executor: 'host-agent',
    analysisMode: 'full',
    cleanupPolicy: 'full-reset',
    completionPolicy: 'host-agent-dimension-complete',
    projectAnalysis: {
      maxFiles: 500,
      contentMaxLines: 120,
      skipGuard: false,
      sourceTag: 'bootstrap-host-agent',
      summaryPrefix: 'Bootstrap host-agent scan',
      generateAstContext: false,
      ...(sourceFolders ? { sourceFolders } : {}),
    },
    ignoredFileDiffIncremental: false,
  };
}

function normalizeColdStartSourceFolders(
  sourceFolders: readonly string[] | undefined
): string[] | undefined {
  if (!sourceFolders?.length) {
    return undefined;
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of sourceFolders) {
    if (typeof value !== 'string') {
      continue;
    }
    const candidate = normalizeSourceFolder(value);
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    normalized.push(candidate);
  }
  return normalized.length ? normalized : undefined;
}

function normalizeSourceFolder(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || path.isAbsolute(trimmed)) {
    return null;
  }
  const normalized = path.posix.normalize(trimmed.replaceAll('\\', '/'));
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..') {
    return null;
  }
  return normalized;
}

// normalizeDimensionIds, normalizeStringArray → imported from WorkflowTypes
