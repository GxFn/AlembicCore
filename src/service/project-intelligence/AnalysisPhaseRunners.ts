/**
 * AnalysisPhaseRunners — 共享 Phase 1-2.1 项目分析阶段函数
 *
 * Extracted from workflows/capabilities/project-intelligence/
 * ProjectIntelligenceRunner.ts (Train A IC4): PanoramaScanner (service
 * layer) consumes these phase runners, and the old location forced a
 * service→workflows dependency inversion that lived as a blessed
 * layer-contract exception (CO2-PANORAMA-RUNNER-INVERSION). The phase
 * functions only depend on core/shared/types, so they belong below the
 * workflows layer; ProjectIntelligenceRunner re-exports them so the
 * public `@alembic/core/project-intelligence` surface is unchanged.
 *
 * Phase 概览:
 *   Phase 1   → 文件收集（DiscovererRegistry → 多语言项目类型检测）
 *   Phase 1.5 → AST 代码结构分析（tree-sitter + SFC 预处理）
 *   Phase 1.6 → Code Entity Graph（代码实体关系图谱）
 *   Phase 1.7 → Call Graph（调用关系图）
 *   Phase 2   → 依赖关系 → knowledge_edges
 *   Phase 2.1 → Module 实体写入 Entity Graph
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ProjectAnalysisResult } from '../../core/AstAnalyzer.js';
import {
  analyzeProject,
  isAvailable as astIsAvailable,
  generateContextForAgent,
} from '../../core/AstAnalyzer.js';
import type { CallGraphResult as CallGraphAnalysisResult } from '../../core/analysis/CallGraphAnalyzer.js';
import { LanguageService } from '../../shared/LanguageService.js';
import {
  type CanonicalSourceIdentity,
  createCanonicalSourceIdentity,
  type ProjectDescriptor,
  type ProjectFolderDescriptor,
} from '../../shared/ProjectScope.js';
import type { GuardAudit } from '../../types/project-snapshot.js';

/** Logger with required info/warn (compatible with Logger singleton) */
export interface PhaseLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error?(...args: unknown[]): void;
  debug?(...args: unknown[]): void;
}

/** Minimal DI container shape (extends McpServiceContainer pattern) */
export interface PhaseContainer {
  // biome-ignore lint/suspicious/noExplicitAny: DI container services are resolved by string token.
  get(name: string): any;
  // biome-ignore lint/suspicious/noExplicitAny: legacy MCP contexts attach dynamic services.
  [key: string]: any;
}

/** Single file entry collected during Phase 1 */
export interface BootstrapFileEntry {
  name: string;
  path: string;
  relativePath: string;
  sourceIdentity?: CanonicalSourceIdentity;
  content: string;
  targetName: string;
  /** Whether this file belongs to a test target or matches test file naming patterns */
  isTest: boolean;
}

/** Target item — either a plain string or an object with metadata */
export type TargetItem =
  | string
  | {
      name: string;
      framework?: string | null;
      type?: string;
      packageName?: string;
      [key: string]: unknown;
    };

/** Dependency graph data shape */
export interface DepGraphData {
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<{ from: string; to: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export type AstProjectSummaryLike = ProjectAnalysisResult;
export type GuardAuditLike = GuardAudit;

/** Minimal guard engine shape */
export interface GuardEngineLike {
  auditFiles(
    files: Array<{ path: string; content: string }>,
    opts?: Record<string, unknown>
  ): GuardAuditLike;
  injectExternalRules(rules: unknown[]): void;
  getExternalRuleCount(): number;
  [key: string]: unknown;
}

/** Minimal discoverer shape */
export interface DiscovererLike {
  id: string;
  displayName: string;
  load(root: string): Promise<void>;
  listTargets(): Promise<TargetItem[]>;
  getTargetFiles(
    target: unknown
  ): Promise<Array<string | { path: string; name?: string; relativePath?: string }>>;
  getDependencyGraph(): Promise<DepGraphData>;
  [key: string]: unknown;
}

/** Phase 4 dimension resolve params */
export interface Phase4Params {
  primaryLang: string;
  langStats: Record<string, number>;
  allTargets: TargetItem[];
  astProjectSummary: AstProjectSummaryLike | null;
  guardEngine: GuardEngineLike | null;
  allFiles: BootstrapFileEntry[];
  logger: PhaseLogger;
}

/** Phase 1 options */
interface Phase1Options {
  maxFiles?: number;
  projectScope?: ProjectDescriptor | null;
  [key: string]: unknown;
}

/** Phase 1.5 AST analysis options */
type AstProjectAnalyzer = typeof analyzeProject;
type AstAvailabilityProbe = typeof astIsAvailable;
type AstContextGenerator = typeof generateContextForAgent;

interface AstAnalysisOptions {
  generateAstContext?: boolean;
  /** 测试夹具专用：默认仍使用真实 analyzeProject，保持外部行为不变。 */
  analyzeProject?: AstProjectAnalyzer;
  /** 测试夹具专用：允许确定性触发 AST degraded 分支，不依赖本机 grammar 状态。 */
  isAstAvailable?: AstAvailabilityProbe;
  /** 测试夹具专用：只在 generateAstContext=true 时替换上下文生成器。 */
  generateContextForAgent?: AstContextGenerator;
  [key: string]: unknown;
}

/** Phase 1.7 incremental call graph options */
interface IncrementalCallGraphOpts {
  changedFiles?: string[];
  materialize?: boolean;
  [key: string]: unknown;
}

interface CallGraphAnalysisOptions {
  changedFiles?: string[];
  [key: string]: unknown;
}

export interface CallGraphMaterializationResult {
  entitiesUpserted: number;
  edgesCreated: number;
  durationMs: number;
}

interface CodeEntityGraphCallGraphLike {
  clearCallGraphForFiles(filePaths: string[] | null): Promise<unknown>;
  populateCallGraph(
    callEdges: CallGraphAnalysisResult['callEdges'],
    dataFlowEdges: CallGraphAnalysisResult['dataFlowEdges']
  ): Promise<CallGraphMaterializationResult>;
}

type CodeEntityGraphCallGraphConstructor = new (
  entityRepo: unknown,
  edgeRepo: unknown,
  options: { projectRoot: string }
) => CodeEntityGraphCallGraphLike;

type CodeEntityGraphConstructor = new (
  entityRepo: unknown,
  edgeRepo: unknown,
  options: { projectRoot: string }
) => {
  clearProject?: () => Promise<unknown>;
  populateFromAst?: (astProjectSummary: ProjectAnalysisResult) => Promise<{
    entitiesUpserted: number;
    edgesCreated: number;
    durationMs: number;
  }>;
  populateFromSpm?: (depGraphData: DepGraphData) => Promise<{ entitiesUpserted: number }>;
};

export type GuardCheckEngineConstructor = new (db: unknown) => GuardEngineLike;

export async function importOptionalModule<T extends Record<string, unknown>>(
  specifier: string
): Promise<T | null> {
  try {
    return (await import(specifier)) as T;
  } catch {
    return null;
  }
}

/** Phase 3 Guard audit options */
export interface GuardAuditOptions {
  skipGuard?: boolean;
  summaryPrefix?: string;
  writeViolations?: boolean;
  [key: string]: unknown;
}

/** runAllPhases context — callers pass McpContext variants with different shapes */
export interface AllPhasesContext {
  container: PhaseContainer;
  logger: PhaseLogger;
  // biome-ignore lint/suspicious/noExplicitAny: workflow callers pass dynamic MCP context shapes.
  [key: string]: any;
}

/** runAllPhases options */
export interface AllPhasesOptions {
  incremental?: boolean;
  generateReport?: boolean;
  clearOldData?: boolean;
  generateAstContext?: boolean;
  materialize?: ProjectAnalysisMaterializationInput;
  sourceGraph?: ProjectAnalysisSourceGraphOptions;
  maxFiles?: number;
  projectScope?: ProjectDescriptor | null;
  skipGuard?: boolean;
  sourceTag?: string;
  summaryPrefix?: string;
  dataRoot?: string;
  /** Log prefix for phase messages (default: 'Bootstrap'). Use 'Rescan' for incremental scans. */
  logPrefix?: string;
  [key: string]: unknown;
}

/** Phase report structure */
export interface PhaseReport {
  phases: Record<string, Record<string, unknown>>;
  startTime: number;
  totalMs?: number;
  [key: string]: unknown;
}

export interface ProjectAnalysisMaterializationOptions {
  codeEntityGraph: boolean;
  callGraph: boolean;
  sourceGraph: boolean;
  dependencyEdges: boolean;
  moduleEntities: boolean;
  guardViolations: boolean;
  panorama: boolean;
}

export type ProjectAnalysisMaterializationInput =
  | boolean
  | Partial<ProjectAnalysisMaterializationOptions>;

export const DEFAULT_PROJECT_ANALYSIS_MATERIALIZATION: ProjectAnalysisMaterializationOptions = {
  codeEntityGraph: true,
  callGraph: true,
  sourceGraph: true,
  dependencyEdges: true,
  moduleEntities: true,
  guardViolations: true,
  panorama: true,
};

export function resolveProjectAnalysisMaterialization(
  input: ProjectAnalysisMaterializationInput | undefined
): ProjectAnalysisMaterializationOptions {
  if (input === false) {
    return {
      codeEntityGraph: false,
      callGraph: false,
      sourceGraph: false,
      dependencyEdges: false,
      moduleEntities: false,
      guardViolations: false,
      panorama: false,
    };
  }

  if (input === true || input === undefined) {
    return { ...DEFAULT_PROJECT_ANALYSIS_MATERIALIZATION };
  }

  return { ...DEFAULT_PROJECT_ANALYSIS_MATERIALIZATION, ...input };
}

export interface ProjectAnalysisSourceGraphOptions {
  repoId?: string;
  projectScope?: string;
  includeExtensions?: string[];
  maxFileSizeBytes?: number;
  maxParseBytes?: number;
  now?: number;
}

// ── 类型定义 ────────────────────────────────────────────────

// ── R13: Alembic 生成物黑名单 ─────────────────────────

const ALEMBIC_GENERATED_BASENAMES = new Set(['AGENTS.md', 'CLAUDE.md', 'copilot-instructions.md']);
const ALEMBIC_GENERATED_PATH_SEGMENTS = [
  `${path.sep}.cursor${path.sep}`, // .cursor/rules/*.mdc
  `${path.sep}.github${path.sep}copilot-instructions.md`,
];

/** 判断文件是否为 Alembic 生成物（用于排除自引用循环知识） */
export function isAlembicGenerated(filePath: string) {
  const base = path.basename(filePath);
  if (ALEMBIC_GENERATED_BASENAMES.has(base)) {
    return true;
  }
  for (const seg of ALEMBIC_GENERATED_PATH_SEGMENTS) {
    if (filePath.includes(seg)) {
      return true;
    }
  }
  if (base.endsWith('.mdc')) {
    return true;
  }
  return false;
}

// ── Phase 1: 文件收集 ──────────────────────────────────────

/**
 * Phase 1: 通过 DiscovererRegistry 检测项目类型并收集源文件
 *
 * @param projectRoot 项目根目录
 * @returns >}
 */
export async function runPhase1_FileCollection(
  projectRoot: string,
  logger: PhaseLogger,
  options: Phase1Options = {}
) {
  const maxFiles = options.maxFiles || 500;
  const seenPaths = new Set<string>();
  const allFiles: BootstrapFileEntry[] = [];
  const allTargets: TargetItem[] = [];
  const warnings: string[] = [];
  const folderInputs = resolvePhase1SourceFolders(projectRoot, options.projectScope);
  const discoverers: DiscovererLike[] = [];

  for (const folderInput of folderInputs) {
    const { getDiscovererRegistry } = await import('../../core/discovery/index.js');
    const registry = getDiscovererRegistry();
    const discoverer = await registry.detect(folderInput.root);
    discoverers.push(discoverer as unknown as DiscovererLike);
    logger.info(
      `[Bootstrap] Project type: ${discoverer.displayName} (${discoverer.id})` +
        (folderInput.folder ? ` folder=${folderInput.folder.displayName}` : '')
    );

    await discoverer.load(folderInput.root);
    const targets = await discoverer.listTargets();
    allTargets.push(
      ...targets.map((target) => decorateProjectScopeTarget(target, folderInput.folder))
    );

    for (const t of targets) {
      const isTestTarget = typeof t === 'object' && /^test/i.test(t.type || '');
      try {
        const fileList = await discoverer.getTargetFiles(t);
        for (const f of fileList) {
          const fp = typeof f === 'string' ? f : f.path;
          if (seenPaths.has(fp)) {
            continue;
          }
          if (isAlembicGenerated(fp)) {
            continue; // R13: skip generated files
          }
          seenPaths.add(fp);
          try {
            const content = fs.readFileSync(fp, 'utf8');
            const relativePath = normalizePhase1RelativePath(
              typeof f === 'string' ? path.relative(folderInput.root, fp) : f.relativePath,
              fp,
              folderInput.root
            );
            allFiles.push({
              name: f.name || path.basename(fp),
              path: fp,
              relativePath,
              ...(folderInput.folder
                ? {
                    sourceIdentity: createCanonicalSourceIdentity({
                      folderDisplayName: folderInput.folder.displayName,
                      folderId: folderInput.folder.id,
                      folderPath: folderInput.folder.path,
                      projectRoot,
                      projectScopeId: options.projectScope?.projectScopeId ?? null,
                      relativePath,
                      sourcePath: relativePath,
                    }),
                  }
                : {}),
              content,
              targetName: buildProjectScopeTargetName(t, folderInput.folder),
              isTest: isTestTarget || LanguageService.isTestFile(fp),
            });
          } catch (err: unknown) {
            const reason = err instanceof Error ? err.message : String(err);
            warnings.push(`File collection skipped unreadable file ${fp}: ${reason}`);
          }
          if (allFiles.length >= maxFiles) {
            break;
          }
        }
      } catch (err: unknown) {
        const targetName = typeof t === 'string' ? t : t.name;
        const reason = err instanceof Error ? err.message : String(err);
        warnings.push(`File collection skipped target ${targetName}: ${reason}`);
      }
      if (allFiles.length >= maxFiles) {
        break;
      }
    }
    if (allFiles.length >= maxFiles) {
      break;
    }
  }

  // 文件截断警告：当达到 maxFiles 上限时，通知调用方分析可能不完整
  const truncated = seenPaths.size > allFiles.length || allFiles.length >= maxFiles;
  if (truncated) {
    logger.warn(
      `[Bootstrap] File collection truncated at ${maxFiles} files (total discovered: ${seenPaths.size}). ` +
        `Analysis may be incomplete — consider increasing maxFiles or narrowing target scope.`
    );
  }

  // 语言统计
  const langStats: Record<string, number> = {};
  for (const f of allFiles) {
    const ext = path.extname(f.name).replace('.', '') || 'unknown';
    langStats[ext] = (langStats[ext] || 0) + 1;
  }

  return {
    allFiles,
    allTargets: allTargets as unknown as TargetItem[],
    discoverer: summarizePhase1Discoverers(discoverers),
    langStats,
    truncated,
    warnings,
  };
}

interface Phase1SourceFolder {
  folder: ProjectFolderDescriptor | null;
  root: string;
}

function resolvePhase1SourceFolders(
  projectRoot: string,
  projectScope: ProjectDescriptor | null | undefined
): Phase1SourceFolder[] {
  const folders = projectScope?.folders.filter((folder) => folder.state === 'active') ?? [];
  if (!projectScope || folders.length === 0) {
    return [{ folder: null, root: projectRoot }];
  }
  return folders.map((folder) => ({ folder, root: folder.path }));
}

function decorateProjectScopeTarget(
  target: TargetItem,
  folder: ProjectFolderDescriptor | null
): TargetItem {
  if (!folder) {
    return target;
  }
  const name = buildProjectScopeTargetName(target, folder);
  return typeof target === 'string'
    ? { name, type: 'target', folderId: folder.id, folderDisplayName: folder.displayName }
    : { ...target, name, folderId: folder.id, folderDisplayName: folder.displayName };
}

function buildProjectScopeTargetName(
  target: TargetItem,
  folder: ProjectFolderDescriptor | null
): string {
  const name = typeof target === 'string' ? target : target.name;
  return folder ? `${folder.displayName}:${name}` : name;
}

function normalizePhase1RelativePath(
  relativePath: string | undefined,
  absolutePath: string,
  folderRoot: string
): string {
  return (relativePath || path.relative(folderRoot, absolutePath)).replace(/\\/g, '/');
}

function summarizePhase1Discoverers(discoverers: readonly DiscovererLike[]): DiscovererLike {
  if (discoverers.length === 1 && discoverers[0]) {
    return discoverers[0];
  }
  const ids = discoverers.map((discoverer) => discoverer.id).join('+') || 'unknown';
  return {
    id: `project-scope:${ids}`,
    displayName: `ProjectScope (${discoverers.map((d) => d.displayName).join(', ')})`,
    async load() {},
    async listTargets() {
      return [];
    },
    async getTargetFiles() {
      return [];
    },
    async getDependencyGraph() {
      return { nodes: [], edges: [] };
    },
  };
}

// ── Phase 1.5: AST 代码结构分析 ────────────────────────────

/**
 * Phase 1.5: tree-sitter AST 分析
 *   - 1.5a: 按需安装缺失的语法包
 *   - 1.5b: 执行 AST 分析 + SFC 预处理
 *
 * @param allFiles Phase 1 收集的文件
 * @param langStats 语言统计
 * @param [options.generateAstContext=false] 是否生成 astContext 文本
 * @returns >}
 */
export async function runPhase1_5_AstAnalysis(
  allFiles: BootstrapFileEntry[],
  langStats: Record<string, number>,
  logger: PhaseLogger,
  options: AstAnalysisOptions = {}
) {
  const warnings: string[] = [];
  let astProjectSummary: AstProjectSummaryLike | null = null;
  let astContext = '';

  // Phase 1.5a: 按需安装缺失的 tree-sitter 语法包
  try {
    const { ensureGrammars, inferLanguagesFromStats, reloadPlugins } = await import(
      '../../core/ast/ensure-grammars.js'
    );
    const neededLangs = inferLanguagesFromStats(langStats);
    if (neededLangs.length > 0) {
      const result = await ensureGrammars(neededLangs, { logger });
      if (result.installed.length > 0) {
        logger.info(`[Bootstrap] Installed grammars: ${result.installed.join(', ')}`);
        await reloadPlugins();
      }
    }
    await import('../../core/ast/index.js');
  } catch (e: unknown) {
    logger.warn(
      `[Bootstrap] Grammar auto-install skipped: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // Phase 1.5b: AST 分析
  const primaryLangEarly = LanguageService.detectPrimary(langStats);
  const isAstAvailable = options.isAstAvailable ?? astIsAvailable;
  const astAvailable = isAstAvailable();
  const analyzeProjectFn = options.analyzeProject ?? analyzeProject;
  const generateContextForAgentFn = options.generateContextForAgent ?? generateContextForAgent;
  if (astAvailable && primaryLangEarly) {
    try {
      const astFiles = allFiles.map((f: BootstrapFileEntry) => ({
        name: f.name,
        // ProjectScope 场景下 AST / callgraph 也必须使用 repo-qualified 路径，
        // 否则两个 folder 都有 lib/index.ts 时会在结构证据层发生碰撞。
        relativePath: f.sourceIdentity?.qualifiedPath ?? f.relativePath,
        content: f.content,
      }));

      // SFC 预处理 (.vue / .svelte)
      type AstPreprocessFn = (
        content: string,
        ext: string
      ) => { content: string; lang?: string } | null;
      let sfcPreprocessor: AstPreprocessFn | undefined;
      try {
        const { initEnhancementRegistry } = await import('../../core/enhancement/index.js');
        const enhReg = await initEnhancementRegistry();
        const preprocessPack = enhReg
          .all()
          .find(
            (p) => typeof (p as unknown as Record<string, unknown>).preprocessFile === 'function'
          );
        if (preprocessPack) {
          sfcPreprocessor = (
            preprocessPack as unknown as { preprocessFile: (...args: unknown[]) => unknown }
          ).preprocessFile.bind(preprocessPack) as AstPreprocessFn;
        }
      } catch {
        /* Enhancement 未加载 */
      }

      astProjectSummary = analyzeProjectFn(astFiles, primaryLangEarly, {
        preprocessFile: sfcPreprocessor,
      });

      // 内部 Agent 专用: 生成 astContext 文本
      if (options.generateAstContext) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- astProjectSummary flows from analyzeProject return
        astContext = generateContextForAgentFn(
          astProjectSummary as Parameters<typeof generateContextForAgent>[0]
        );
      }

      logger.info(
        `[Bootstrap] AST: ${astProjectSummary.classes.length} classes, ` +
          `${astProjectSummary.protocols.length} protocols` +
          (astProjectSummary.categories
            ? `, ${astProjectSummary.categories.length} categories`
            : '') +
          (astProjectSummary.patternStats
            ? `, ${Object.keys(astProjectSummary.patternStats).length} patterns`
            : '')
      );
    } catch (e: unknown) {
      logger.warn(
        `[Bootstrap] AST analysis failed (degraded): ${e instanceof Error ? e.message : String(e)}`
      );
      warnings.push(`AST analysis partially failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    logger.info(
      `[Bootstrap] AST skipped: tree-sitter ${astAvailable ? 'available' : 'not available'}, lang=${primaryLangEarly}`
    );
  }

  return { astProjectSummary, astContext, warnings };
}

// ── Phase 1.6: Code Entity Graph ───────────────────────────

export interface ProjectEntityGraphInput {
  astProjectSummary: AstProjectSummaryLike;
  projectRoot: string;
}

export interface EntityGraphMaterializationOptions {
  materialize?: boolean;
}

export function buildEntityGraphInput(
  astProjectSummary: AstProjectSummaryLike | null,
  projectRoot: string
): ProjectEntityGraphInput | null {
  if (!astProjectSummary) {
    return null;
  }

  return { astProjectSummary, projectRoot };
}

export async function materializeEntityGraph(
  input: ProjectEntityGraphInput,
  container: PhaseContainer,
  logger: PhaseLogger
) {
  const warnings: string[] = [];
  let codeEntityResult: {
    entitiesUpserted: number;
    edgesCreated: number;
    durationMs: number;
  } | null = null;

  try {
    const CodeEntityGraph =
      (await defaultGetCodeEntityGraphClass()) as unknown as CodeEntityGraphConstructor;
    const entityRepo = container.get('codeEntityRepository');
    const edgeRepo = container.get('knowledgeEdgeRepository');
    if (entityRepo && edgeRepo) {
      const ceg = new CodeEntityGraph(entityRepo, edgeRepo, { projectRoot: input.projectRoot });
      await ceg.clearProject?.();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- ProjectAnalysisResult structurally compatible at runtime
      const result = await ceg.populateFromAst?.(input.astProjectSummary);
      if (result) {
        codeEntityResult = result;
        logger.info(
          `[Bootstrap] Entity Graph: ${result.entitiesUpserted} entities, ${result.edgesCreated} edges`
        );
      }
    }
  } catch (e: unknown) {
    logger.warn(
      `[Bootstrap] Entity Graph failed (degraded): ${e instanceof Error ? e.message : String(e)}`
    );
    warnings.push(`Entity Graph failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { codeEntityResult, warnings };
}

/**
 * Phase 1.6: 从 AST 结果构建代码实体关系图谱
 *
 * @param astProjectSummary AST 分析结果
 * @param container ServiceContainer
 * @returns >}
 */
export async function runPhase1_6_EntityGraph(
  astProjectSummary: AstProjectSummaryLike | null,
  projectRoot: string,
  container: PhaseContainer,
  logger: PhaseLogger,
  options: EntityGraphMaterializationOptions = {}
) {
  const warnings: string[] = [];
  const codeEntityResult: {
    entitiesUpserted: number;
    edgesCreated: number;
    durationMs: number;
  } | null = null;

  const input = buildEntityGraphInput(astProjectSummary, projectRoot);
  if (!input || options.materialize === false) {
    return { codeEntityResult, warnings };
  }

  return materializeEntityGraph(input, container, logger);
}

// ── Phase 2: 依赖关系 ──────────────────────────────────────

/**
 * Phase 1.7: 跨文件调用图分析 (Phase 5)
 *
 * 从 AST 的 callSites 构建全局调用图并写入 CodeEntityGraph。
 *
 * @param astProjectSummary AST 分析结果 (含 fileSummaries[].callSites)
 * @param container ServiceContainer
 * @param [incrementalOpts] 增量分析选项
 * @param [incrementalOpts.changedFiles] 变更文件的相对路径
 * @returns >}
 */
export async function runPhase1_7_CallGraph(
  astProjectSummary: AstProjectSummaryLike | null,
  projectRoot: string,
  container: PhaseContainer,
  logger: PhaseLogger,
  incrementalOpts: IncrementalCallGraphOpts | null = null
) {
  const warnings: string[] = [];
  let callGraphResult: CallGraphMaterializationResult | null = null;

  const analysis = await analyzeProjectCallGraph(astProjectSummary, projectRoot, logger, {
    changedFiles: incrementalOpts?.changedFiles,
  });
  warnings.push(...analysis.warnings);

  if (!analysis.callGraphAnalysis || incrementalOpts?.materialize === false) {
    if (analysis.callGraphAnalysis && incrementalOpts?.materialize === false) {
      logger.info('[Bootstrap] Call Graph materialization skipped by workflow plan');
    }
    return { callGraphResult, callGraphAnalysis: analysis.callGraphAnalysis, warnings };
  }

  const materialized = await materializeCallGraph({
    callGraphAnalysis: analysis.callGraphAnalysis,
    projectRoot,
    container,
    logger,
    changedFiles: incrementalOpts?.changedFiles,
  });
  callGraphResult = materialized.callGraphResult;
  warnings.push(...materialized.warnings);

  return { callGraphResult, callGraphAnalysis: analysis.callGraphAnalysis, warnings };
}

export async function analyzeProjectCallGraph(
  astProjectSummary: AstProjectSummaryLike | null,
  projectRoot: string,
  logger: PhaseLogger,
  options: CallGraphAnalysisOptions = {}
) {
  const warnings: string[] = [];
  let callGraphAnalysis: CallGraphAnalysisResult | null = null;

  if (!astProjectSummary?.fileSummaries?.length) {
    return { callGraphAnalysis, warnings };
  }

  // 检查是否有 callSites 数据 (Phase 5 提取)
  const hasCallSites = astProjectSummary.fileSummaries.some(
    (f) => f.callSites && f.callSites.length > 0
  );
  if (!hasCallSites) {
    logger.info('[Bootstrap] Call Graph skipped: no call sites extracted');
    return { callGraphAnalysis, warnings };
  }

  try {
    const { CallGraphAnalyzer } = await import('../../core/analysis/CallGraphAnalyzer.js');

    const analyzer = new CallGraphAnalyzer(projectRoot);
    const changedFiles = options.changedFiles;
    const isIncremental =
      changedFiles !== undefined && changedFiles.length > 0 && changedFiles.length <= 10;

    // Phase 5 分析 (带超时保护 + 渐进式 partial result)
    const result = isIncremental
      ? // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- ProjectAnalysisResult structurally compatible with AstProjectSummary
        await analyzer.analyzeIncremental(
          astProjectSummary as unknown as Parameters<typeof analyzer.analyzeIncremental>[0],
          changedFiles,
          {
            timeout: 15_000,
            maxCallSitesPerFile: 500,
            minConfidence: 0.5,
          }
        )
      : // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- ProjectAnalysisResult structurally compatible with AstProjectSummary
        await analyzer.analyze(
          astProjectSummary as unknown as Parameters<typeof analyzer.analyze>[0],
          {
            timeout: 15_000,
            maxCallSitesPerFile: 500,
            minConfidence: 0.5,
          }
        );

    callGraphAnalysis = result;

    const partialTag = result.stats.partial ? ' [partial]' : '';
    const incrTag = isIncremental ? ' [incremental]' : '';
    logger.info(
      `[Bootstrap] Call Graph analysis${incrTag}${partialTag}: ${result.callEdges.length} call edges, ` +
        `${result.dataFlowEdges.length} data flow edges, ` +
        `resolution rate: ${(result.stats.resolvedRate * 100).toFixed(1)}%`
    );
  } catch (e: unknown) {
    logger.warn(
      `[Bootstrap] Call Graph failed (degraded): ${e instanceof Error ? e.message : String(e)}`
    );
    warnings.push(`Call Graph failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { callGraphAnalysis, warnings };
}

export async function materializeCallGraph({
  callGraphAnalysis,
  projectRoot,
  container,
  logger,
  changedFiles,
  getCodeEntityGraphClass = defaultGetCodeEntityGraphClass,
}: {
  callGraphAnalysis: CallGraphAnalysisResult | null;
  projectRoot: string;
  container: PhaseContainer;
  logger: PhaseLogger;
  changedFiles?: string[];
  getCodeEntityGraphClass?: () => Promise<CodeEntityGraphCallGraphConstructor>;
}) {
  const warnings: string[] = [];
  let callGraphResult: CallGraphMaterializationResult | null = null;

  if (!callGraphAnalysis) {
    return { callGraphResult, warnings };
  }

  if (callGraphAnalysis.callEdges.length === 0 && callGraphAnalysis.dataFlowEdges.length === 0) {
    logger.info(
      `[Bootstrap] Call Graph: ${callGraphAnalysis.stats.totalCallSites} call sites, 0 resolved edges`
    );
    return { callGraphResult, warnings };
  }

  try {
    const CodeEntityGraph = await getCodeEntityGraphClass();
    const entityRepo = container.get('codeEntityRepository');
    const edgeRepo = container.get('knowledgeEdgeRepository');
    if (entityRepo && edgeRepo) {
      const ceg = new CodeEntityGraph(entityRepo, edgeRepo, { projectRoot });

      // 增量模式: 先删除变更文件的旧边
      if (callGraphAnalysis.stats.incremental === true) {
        await ceg.clearCallGraphForFiles(changedFiles ?? null);
      }

      callGraphResult = await ceg.populateCallGraph(
        callGraphAnalysis.callEdges,
        callGraphAnalysis.dataFlowEdges
      );

      logger.info(
        `[Bootstrap] Call Graph materialized: ${callGraphResult.entitiesUpserted} method entities, ${callGraphResult.edgesCreated} graph edges`
      );
    }
  } catch (e: unknown) {
    logger.warn(
      `[Bootstrap] Call Graph materialization failed (degraded): ${e instanceof Error ? e.message : String(e)}`
    );
    warnings.push(
      `Call Graph materialization failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  return { callGraphResult, warnings };
}

async function defaultGetCodeEntityGraphClass() {
  const modulePath = '../../service/knowledge/CodeEntityGraph.js';
  const mod = await importOptionalModule<{ CodeEntityGraph: unknown }>(modulePath);
  if (!mod?.CodeEntityGraph) {
    throw new Error('CodeEntityGraph service is not available in this Core stage');
  }
  return mod.CodeEntityGraph as unknown as CodeEntityGraphCallGraphConstructor;
}

// ── Phase 2: 依赖关系 ──────────────────────────────────────

export interface DependencyEdgeMaterializationOptions {
  materializeEdges?: boolean;
}

export async function collectDependencyGraph(discoverer: DiscovererLike, logger: PhaseLogger) {
  const warnings: string[] = [];
  let depGraphData: DepGraphData | null = null;

  try {
    depGraphData = await discoverer.getDependencyGraph();
  } catch (e: unknown) {
    logger.warn(`[Bootstrap] DepGraph failed: ${e instanceof Error ? e.message : String(e)}`);
    warnings.push(`Dependency graph failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { depGraphData, warnings };
}

export async function writeDependencyEdges({
  depGraphData,
  discoverer,
  container,
  logger,
  sourceTag,
}: {
  depGraphData: DepGraphData | null;
  discoverer: DiscovererLike;
  container: PhaseContainer;
  logger: PhaseLogger;
  sourceTag: string;
}) {
  const warnings: string[] = [];
  let depEdgesWritten = 0;

  if (!depGraphData) {
    return { depEdgesWritten, warnings };
  }

  try {
    const knowledgeGraphService = container.get('knowledgeGraphService');
    if (knowledgeGraphService) {
      for (const edge of depGraphData.edges || []) {
        const result = await knowledgeGraphService.addEdge(
          edge.from,
          'module',
          edge.to,
          'module',
          'depends_on',
          { weight: 1.0, source: `${discoverer.id}-${sourceTag}` }
        );
        if (result?.success) {
          depEdgesWritten++;
        }
      }
    }
  } catch (e: unknown) {
    logger.warn(
      `[Bootstrap] DepGraph edge write failed: ${e instanceof Error ? e.message : String(e)}`
    );
    warnings.push(`Dependency edge write failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { depEdgesWritten, warnings };
}

/**
 * Phase 2: 获取依赖图并写入 knowledge_edges
 *
 * @param discoverer DiscovererRegistry 检测到的 discoverer
 * @param container ServiceContainer
 * @param [sourceTag='bootstrap'] edge 的 source 标签后缀
 * @returns >}
 */
export async function runPhase2_DependencyGraph(
  discoverer: DiscovererLike,
  container: PhaseContainer,
  logger: PhaseLogger,
  sourceTag = 'bootstrap',
  options: DependencyEdgeMaterializationOptions = {}
) {
  const warnings: string[] = [];
  let depEdgesWritten = 0;

  const collected = await collectDependencyGraph(discoverer, logger);
  warnings.push(...collected.warnings);

  if (options.materializeEdges !== false) {
    const written = await writeDependencyEdges({
      depGraphData: collected.depGraphData,
      discoverer,
      container,
      logger,
      sourceTag,
    });
    depEdgesWritten = written.depEdgesWritten;
    warnings.push(...written.warnings);
  }

  return { depGraphData: collected.depGraphData, depEdgesWritten, warnings };
}

// ── Phase 2.1: Module 实体写入 ─────────────────────────────

export interface ModuleEntityMaterializationOptions {
  materialize?: boolean;
}

/**
 * Phase 2.1: 将依赖图的 module 节点写入 Code Entity Graph
 *
 * @param depGraphData 依赖图数据
 */
export async function materializeModuleEntities(
  depGraphData: DepGraphData | null,
  projectRoot: string,
  container: PhaseContainer,
  logger: PhaseLogger
) {
  if (!depGraphData?.nodes?.length) {
    return;
  }

  try {
    const CodeEntityGraph =
      (await defaultGetCodeEntityGraphClass()) as unknown as CodeEntityGraphConstructor;
    const entityRepo = container.get('codeEntityRepository');
    const edgeRepo = container.get('knowledgeEdgeRepository');
    if (entityRepo && edgeRepo) {
      const ceg = new CodeEntityGraph(entityRepo, edgeRepo, { projectRoot });
      const result = await ceg.populateFromSpm?.(depGraphData);
      if (result) {
        logger.info(`[Bootstrap] Entity Graph modules: ${result.entitiesUpserted} entities`);
      }
    }
  } catch (e: unknown) {
    logger.warn(
      `[Bootstrap] Entity Graph modules failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

export async function runPhase2_1_ModuleEntities(
  depGraphData: DepGraphData | null,
  projectRoot: string,
  container: PhaseContainer,
  logger: PhaseLogger,
  options: ModuleEntityMaterializationOptions = {}
) {
  if (options.materialize === false) {
    return;
  }

  await materializeModuleEntities(depGraphData, projectRoot, container, logger);
}
