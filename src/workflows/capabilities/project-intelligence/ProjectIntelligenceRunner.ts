/**
 * ProjectIntelligenceRunner — 共享 Phase 1-4 项目分析管线
 *
 * 冷启动 (ColdStart) 和增量扫描 (KnowledgeRescan) 共享完全相同的
 * 项目分析逻辑，内部/宿主 Agent 均通过 ProjectIntelligenceCapability 调用此模块。
 *
 * Phase 概览:
 *   Phase 1   → 文件收集（DiscovererRegistry → 多语言项目类型检测）
 *   Phase 1.5 → AST 代码结构分析（tree-sitter + SFC 预处理）
 *   Phase 1.6 → Code Entity Graph（代码实体关系图谱）
 *   Phase 2   → 依赖关系 → knowledge_edges
 *   Phase 2.1 → Module 实体写入 Entity Graph
 *   Phase 2.2 → Panorama 全景汇总（RoleRefiner + CouplingAnalyzer + LayerInferrer）
 *   Phase 3   → Guard 规则审计
 *   Phase 4   → 维度条件化过滤 + Enhancement Pack + 语言画像
 */

import { DimensionCopy } from '../../../domain/dimension/DimensionCopy.js';
import type { SourceGraphRepositoryImpl } from '../../../repository/source-graph/SourceGraphRepository.js';
import {
  type AllPhasesContext,
  type AllPhasesOptions,
  type BootstrapFileEntry,
  type GuardAuditLike,
  type GuardAuditOptions,
  type GuardCheckEngineConstructor,
  type GuardEngineLike,
  importOptionalModule,
  type Phase4Params,
  type PhaseContainer,
  type PhaseLogger,
  type PhaseReport,
  type ProjectAnalysisSourceGraphOptions,
  resolveProjectAnalysisMaterialization,
  runPhase1_5_AstAnalysis,
  runPhase1_6_EntityGraph,
  runPhase1_7_CallGraph,
  runPhase1_FileCollection,
  runPhase2_1_ModuleEntities,
  runPhase2_DependencyGraph,
  type TargetItem,
} from '../../../service/project-intelligence/AnalysisPhaseRunners.js';
import {
  type SourceGraphLifecycleResult,
  SourceGraphLifecycleService,
} from '../../../service/source-graph/SourceGraphLifecycle.js';
import { LanguageService } from '../../../shared/LanguageService.js';
import type { IncrementalPlan } from '../../../types/workflows.js';
import {
  type BaseDimension,
  baseDimensions,
  resolveActiveDimensions,
} from '../planning/dimensions/BaseDimensions.js';
import { detectPrimaryLanguage } from '../presentation/LanguageExtensionBuilder.js';
import { evaluateProjectAnalysisIncrementalPlan } from './ProjectIntelligenceIncrementalPlanner.js';
import {
  buildProjectAnalysisLocalPackageModules,
  buildProjectAnalysisTargetsSummary,
} from './ProjectIntelligenceResultProjection.js';

// ── Re-exports: the phase runners moved to service/project-intelligence
// (Train A IC4 inversion repair); the public project-intelligence surface
// keeps exporting the exact same symbols from this module.
export {
  analyzeProjectCallGraph,
  buildEntityGraphInput,
  collectDependencyGraph,
  DEFAULT_PROJECT_ANALYSIS_MATERIALIZATION,
  type DependencyEdgeMaterializationOptions,
  type EntityGraphMaterializationOptions,
  isAlembicGenerated,
  type ModuleEntityMaterializationOptions,
  materializeCallGraph,
  materializeEntityGraph,
  materializeModuleEntities,
  type PhaseReport,
  type ProjectAnalysisMaterializationInput,
  type ProjectAnalysisMaterializationOptions,
  type ProjectAnalysisSourceGraphOptions,
  type ProjectEntityGraphInput,
  resolveProjectAnalysisMaterialization,
  runPhase1_5_AstAnalysis,
  runPhase1_6_EntityGraph,
  runPhase1_7_CallGraph,
  runPhase1_FileCollection,
  runPhase2_1_ModuleEntities,
  runPhase2_DependencyGraph,
  writeDependencyEdges,
} from '../../../service/project-intelligence/AnalysisPhaseRunners.js';

// ── Phase 3: Guard 审计 ────────────────────────────────────

/**
 * Phase 3: Guard 规则审计
 *
 * @param allFiles Phase 1 收集的文件
 * @param [options.summaryPrefix='Bootstrap scan'] - ViolationsStore 摘要前缀
 * @returns >}
 */
export async function runGuardAudit(
  allFiles: BootstrapFileEntry[],
  container: PhaseContainer,
  logger: PhaseLogger
) {
  const warnings: string[] = [];
  let guardAudit: GuardAuditLike | null = null;
  let guardEngine: GuardEngineLike | null = null;

  try {
    const modulePath = '../../../service/guard/GuardCheckEngine.js';
    const guardModule = await importOptionalModule<{
      GuardCheckEngine: GuardCheckEngineConstructor;
    }>(modulePath);
    if (!guardModule?.GuardCheckEngine) {
      throw new Error('GuardCheckEngine service is not available in this Core stage');
    }
    const { GuardCheckEngine } = guardModule;
    const db = container.get('database');
    const engine = new GuardCheckEngine(db) as unknown as GuardEngineLike;
    guardEngine = engine;
    const guardFiles = allFiles.map((f: BootstrapFileEntry) => ({
      path: f.path,
      content: f.content,
      isTest: f.isTest,
    }));
    guardAudit = engine.auditFiles(guardFiles, { scope: 'project' });
  } catch (e: unknown) {
    logger.warn(`[Bootstrap] Guard audit failed: ${e instanceof Error ? e.message : String(e)}`);
    warnings.push(`Guard audit failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { guardAudit, guardEngine, warnings };
}

export function writeGuardViolations({
  guardAudit,
  container,
  summaryPrefix,
  tool,
}: {
  guardAudit: GuardAuditLike | null;
  container: PhaseContainer;
  summaryPrefix?: string;
  /** Writer attribution: the invoking MCP tool, when the caller knows it. */
  tool?: string | null;
}) {
  if (!guardAudit) {
    return;
  }

  try {
    const violationsStore = container.get('violationsStore');
    const prefix = summaryPrefix || 'Bootstrap scan';
    for (const fileResult of guardAudit.files || []) {
      if (fileResult.violations.length > 0) {
        const fileSummary = (fileResult as unknown as Record<string, unknown>).summary as
          | { errors: number; warnings: number }
          | undefined;
        violationsStore.appendRun({
          filePath: fileResult.filePath,
          violations: fileResult.violations,
          summary: `${prefix}: ${fileSummary?.errors ?? 0}E ${fileSummary?.warnings ?? 0}W`,
          tool: tool ?? null,
          surface: 'project-intelligence/guard-audit',
        });
      }
    }
  } catch {
    /* ViolationsStore not available */
  }
}

export async function runPhase3_GuardAudit(
  allFiles: BootstrapFileEntry[],
  container: PhaseContainer,
  logger: PhaseLogger,
  options: GuardAuditOptions = {}
) {
  if (options.skipGuard) {
    return { guardAudit: null, guardEngine: null, warnings: [] };
  }

  const audit = await runGuardAudit(allFiles, container, logger);
  if (options.writeViolations !== false) {
    writeGuardViolations({
      guardAudit: audit.guardAudit,
      container,
      summaryPrefix: options.summaryPrefix,
      tool: (options.tool as string | undefined) ?? null,
    });
  }

  return audit;
}

// ── Phase 4: 维度解析 + Enhancement Pack ───────────────────

/**
 * Phase 4: 维度条件化过滤 + Enhancement Pack 动态追加 + 语言画像 + Skill 增强
 *
 * @param params.astProjectSummary AST 结果（供 Enhancement Pack 模式检测）
 * @param params.guardEngine Guard 引擎（供 Enhancement Pack 规则注入）
 * @param params.allFiles 文件列表（供 Guard 二次审计）
 * @returns {Promise<{
 *   activeDimensions: Array,
 *   enhancementPackInfo: Array,
 *   enhancementPatterns: Array,
 *   enhancementGuardRules: Array,
 *   langProfile: object,
 *   detectedFrameworks: string[],
 *   guardAudit: object|null
 * }>}
 */
export async function runPhase4_DimensionResolve(params: Phase4Params) {
  const { primaryLang, langStats, allTargets, astProjectSummary, guardEngine, allFiles, logger } =
    params;

  // 框架检测
  const detectedFrameworks = allTargets
    .map((t: TargetItem) => (typeof t === 'object' ? t.framework : null))
    .filter(Boolean) as string[];

  // 条件维度过滤
  const activeDimensions = resolveActiveDimensions(baseDimensions, primaryLang, detectedFrameworks);

  // Enhancement Pack 动态追加
  const enhancementPackInfo: { id: string; displayName: string }[] = [];
  const enhancementGuardRules: unknown[] = [];
  const enhancementPatterns: Array<Record<string, unknown>> = [];
  let guardAudit: GuardAuditLike | null = null;

  try {
    const { initEnhancementRegistry } = await import('../../../core/enhancement/index.js');
    const enhReg = await initEnhancementRegistry();
    const matchedPacks = enhReg.resolve(primaryLang, detectedFrameworks);

    for (const pack of matchedPacks) {
      enhancementPackInfo.push({ id: pack.id, displayName: pack.displayName });

      // 追加额外维度
      for (const dim of pack.getExtraDimensions()) {
        if (!activeDimensions.some((d: BaseDimension) => d.id === dim.id)) {
          activeDimensions.push(dim);
        }
      }

      // 收集 Guard 规则
      const guardRules = pack.getGuardRules();
      if (guardRules.length > 0) {
        enhancementGuardRules.push(...guardRules);
      }

      // AST 模式检测
      if (astProjectSummary) {
        try {
          const patterns = pack.detectPatterns(astProjectSummary);
          if (patterns.length > 0) {
            enhancementPatterns.push(
              ...patterns.map((p: Record<string, unknown>) => ({ ...p, source: pack.id }))
            );
          }
        } catch {
          /* graceful degradation */
        }
      }
    }

    if (matchedPacks.length > 0) {
      logger.info(
        `[Bootstrap] Enhancement packs: ${matchedPacks.map((p) => p.id).join(', ')} → ` +
          `+${activeDimensions.length - baseDimensions.length} dims, ${enhancementGuardRules.length} guard rules, ${enhancementPatterns.length} patterns`
      );
    }
  } catch (enhErr: unknown) {
    logger.warn(
      `[Bootstrap] Enhancement packs skipped: ${enhErr instanceof Error ? enhErr.message : String(enhErr)}`
    );
  }

  // Enhancement Pack Guard 规则注入 + 补充审计
  if (enhancementGuardRules.length > 0 && guardEngine) {
    try {
      guardEngine.injectExternalRules(enhancementGuardRules);
      const guardFiles = allFiles.map((f: BootstrapFileEntry) => ({
        path: f.path,
        content: f.content,
        isTest: f.isTest,
      }));
      const reAudit = guardEngine.auditFiles(guardFiles, { scope: 'project' });
      guardAudit = reAudit;
      logger.info(
        `[Bootstrap] Guard re-audit with ${guardEngine.getExternalRuleCount()} Enhancement Pack rules → ${reAudit.summary?.totalViolations ?? 0} total violations`
      );
    } catch (e: unknown) {
      logger.warn(
        `[Bootstrap] Enhancement Pack guard re-audit failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // 语言画像 + 差异化文案
  const langProfile = LanguageService.detectProfile(langStats);
  DimensionCopy.applyMulti(activeDimensions, langProfile.primary, langProfile.secondary);

  return {
    activeDimensions,
    enhancementPackInfo,
    enhancementPatterns,
    enhancementGuardRules,
    langProfile,
    detectedFrameworks,
    guardAudit,
  };
}

export async function materializeProjectPanorama({
  container,
  logger,
  report,
}: {
  container: PhaseContainer;
  logger: PhaseLogger;
  report: PhaseReport | null;
}) {
  const warnings: string[] = [];
  let panoramaResult: Record<string, unknown> | null = null;

  try {
    const panoramaService = container.get('panoramaService');
    if (
      panoramaService &&
      typeof (panoramaService as { invalidate?: () => void }).invalidate === 'function'
    ) {
      const pPanoStart = Date.now();
      (panoramaService as { invalidate: () => void }).invalidate();
      const result = await (
        panoramaService as { getResult: () => Promise<Record<string, unknown>> }
      ).getResult();
      panoramaResult = result;
      logger.info(`[Bootstrap] Phase 2.2: Panorama computed in ${Date.now() - pPanoStart}ms`);
      if (report) {
        const overview = await (
          panoramaService as { getOverview: () => Promise<Record<string, unknown>> }
        ).getOverview();
        report.phases.panorama = {
          moduleCount: (overview as { moduleCount?: number }).moduleCount ?? 0,
          layerCount: (overview as { layerCount?: number }).layerCount ?? 0,
          ms: Date.now() - pPanoStart,
        };
      }
    }
  } catch (err: unknown) {
    warnings.push(
      `Phase 2.2 panorama failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return { panoramaResult, warnings };
}

export async function runPhase1_8_SourceGraphLifecycle({
  projectRoot,
  container,
  logger,
  incrementalPlan,
  options,
}: {
  projectRoot: string;
  container: PhaseContainer;
  logger: PhaseLogger;
  incrementalPlan: IncrementalPlan | null;
  options: ProjectAnalysisSourceGraphOptions;
}): Promise<{ sourceGraphResult: SourceGraphLifecycleResult | null; warnings: string[] }> {
  const warnings: string[] = [];
  const repository = resolveSourceGraphRepository(container);
  if (!repository) {
    warnings.push('Source graph lifecycle skipped: sourceGraphRepository is not available.');
    return { sourceGraphResult: null, warnings };
  }

  try {
    const lifecycle = new SourceGraphLifecycleService(repository);
    const common = {
      projectRoot,
      repoId: options.repoId ?? 'default',
      projectScope: options.projectScope,
      includeExtensions: options.includeExtensions,
      maxFileSizeBytes: options.maxFileSizeBytes,
      maxParseBytes: options.maxParseBytes,
      now: options.now,
    };
    const changedFiles = incrementalPlan?.diff
      ? [...incrementalPlan.diff.added, ...incrementalPlan.diff.modified]
      : [];
    const deletedFiles = incrementalPlan?.diff?.deleted ?? [];
    const sourceGraphResult =
      incrementalPlan?.mode === 'incremental' && incrementalPlan.diff
        ? await lifecycle.syncFileChanges({
            ...common,
            changedFiles,
            deletedFiles,
          })
        : await lifecycle.buildColdStartIndex(common);

    logger.info(
      `[Bootstrap] Source Graph ${sourceGraphResult.action}: ` +
        `${sourceGraphResult.durableTables.source_graph_files} files, ` +
        `${sourceGraphResult.durableTables.source_graph_symbols} symbols, ` +
        `${sourceGraphResult.durableTables.source_graph_edges} edges, ` +
        `freshness=${sourceGraphResult.freshness.status}`
    );

    return { sourceGraphResult, warnings };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[Bootstrap] Source Graph lifecycle failed (degraded): ${message}`);
    warnings.push(`Source Graph lifecycle failed: ${message}`);
    return { sourceGraphResult: null, warnings };
  }
}

function resolveSourceGraphRepository(container: PhaseContainer): SourceGraphRepositoryImpl | null {
  try {
    const repository = container.get('sourceGraphRepository');
    return isSourceGraphRepository(repository) ? repository : null;
  } catch {
    return null;
  }
}

function isSourceGraphRepository(value: unknown): value is SourceGraphRepositoryImpl {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { getLatestSnapshot?: unknown }).getLatestSnapshot === 'function' &&
    typeof (value as { replaceGeneration?: unknown }).replaceGeneration === 'function'
  );
}

// ── 一站式调用 ─────────────────────────────────────────────

/**
 * runAllPhases — 一站式执行 Phase 1~4 全部数据收集
 *
 * 内部 Agent 和宿主 Agent 均可调用此函数获取统一的分析结果。
 *
 * @param projectRoot 项目根目录
 * @param ctx { container, logger }
 * @param [options.incremental=false] 启用增量评估 (Phase 1 后执行)
 * @param [options.generateReport=false] 生成 Phase 级详细报告
 * @param [options.clearOldData=false] 先清除旧 checkpoints/snapshots
 * @param [options.generateAstContext=false] 生成 astContext 文本
 * @param [options.summaryPrefix='Bootstrap scan']
 */
export async function runAllPhases(
  projectRoot: string,
  ctx: AllPhasesContext,
  options: AllPhasesOptions = {}
) {
  const warnings: string[] = [];
  const materialization = resolveProjectAnalysisMaterialization(options.materialize);
  const report: PhaseReport | null = options.generateReport
    ? { phases: {}, startTime: Date.now() }
    : null;

  // ── Phase 1: 文件收集 ──
  const p1Start = Date.now();
  const phase1 = await runPhase1_FileCollection(projectRoot, ctx.logger, options);
  const { allFiles, allTargets, discoverer, langStats, truncated } = phase1;
  warnings.push(...phase1.warnings);

  if (truncated) {
    warnings.push(
      `File collection truncated at ${options.maxFiles || 500} files. Analysis may be incomplete.`
    );
  }

  if (report) {
    report.phases.fileCollection = {
      fileCount: allFiles.length,
      targetCount: allTargets.length,
      ms: Date.now() - p1Start,
    };
  }

  if (allFiles.length === 0) {
    return {
      allFiles,
      langStats,
      primaryLang: null,
      discoverer,
      allTargets,
      truncated,
      astProjectSummary: null,
      astContext: '',
      codeEntityResult: null,
      callGraphResult: null,
      depGraphData: null,
      depEdgesWritten: 0,
      guardAudit: null,
      guardEngine: null,
      activeDimensions: [],
      enhancementPackInfo: [],
      enhancementPatterns: [],
      enhancementGuardRules: [],
      langProfile: {},
      targetsSummary: [],
      localPackageModules: [],
      warnings,
      report: report || {},
      incrementalPlan: null,
      sourceGraphResult: null,
      panoramaResult: null,
      detectedFrameworks: [],
      isEmpty: true,
    };
  }

  // ── Incremental evaluation (Phase 1 后执行，需要 allFiles) ──
  const incrementalEvaluation = await evaluateProjectAnalysisIncrementalPlan({
    enabled: options.incremental === true,
    projectRoot,
    ctx,
    allFiles,
    report,
  });
  warnings.push(...incrementalEvaluation.warnings);
  const incrementalPlan: IncrementalPlan | null = incrementalEvaluation.incrementalPlan;

  let sourceGraphResult: SourceGraphLifecycleResult | null = null;
  if (materialization.sourceGraph) {
    const p18Start = Date.now();
    const sourceGraph = await runPhase1_8_SourceGraphLifecycle({
      projectRoot,
      container: ctx.container,
      logger: ctx.logger,
      incrementalPlan,
      options: options.sourceGraph ?? {},
    });
    sourceGraphResult = sourceGraph.sourceGraphResult;
    warnings.push(...sourceGraph.warnings);
    if (report) {
      report.phases.sourceGraph = {
        action: sourceGraphResult?.action ?? 'skipped',
        freshness: sourceGraphResult?.freshness.status ?? 'unavailable',
        generationId: sourceGraphResult?.generationId ?? null,
        fileCount: sourceGraphResult?.durableTables.source_graph_files ?? 0,
        symbolCount: sourceGraphResult?.durableTables.source_graph_symbols ?? 0,
        edgeCount: sourceGraphResult?.durableTables.source_graph_edges ?? 0,
        ms: Date.now() - p18Start,
      };
    }
  }

  // ── Phase 1.5: AST 分析 ──
  const p15Start = Date.now();
  const phase1_5 = await runPhase1_5_AstAnalysis(allFiles, langStats, ctx.logger, {
    generateAstContext: options.generateAstContext || false,
  });
  warnings.push(...phase1_5.warnings);
  if (report) {
    report.phases.ast = {
      classCount: phase1_5.astProjectSummary?.classes?.length || 0,
      ms: Date.now() - p15Start,
    };
  }

  // ── Phase 1.6: Entity Graph ──
  const p16Start = Date.now();
  const phase1_6 = await runPhase1_6_EntityGraph(
    phase1_5.astProjectSummary,
    projectRoot,
    ctx.container,
    ctx.logger,
    { materialize: materialization.codeEntityGraph }
  );
  warnings.push(...phase1_6.warnings);
  if (report) {
    report.phases.entityGraph = {
      entityCount: phase1_6.codeEntityResult?.entitiesUpserted || 0,
      edgeCount: phase1_6.codeEntityResult?.edgesCreated || 0,
      ms: Date.now() - p16Start,
    };
  }

  // ── Phase 1.7: Call Graph (Phase 5) ──
  const p17Start = Date.now();
  const phase1_7 = await runPhase1_7_CallGraph(
    phase1_5.astProjectSummary,
    projectRoot,
    ctx.container,
    ctx.logger,
    { materialize: materialization.callGraph }
  );
  warnings.push(...phase1_7.warnings);
  if (report) {
    report.phases.callGraph = { result: phase1_7.callGraphResult, ms: Date.now() - p17Start };
  }

  // ── Phase 2: 依赖图 ──
  const p2Start = Date.now();
  const phase2 = await runPhase2_DependencyGraph(
    discoverer,
    ctx.container,
    ctx.logger,
    options.sourceTag || 'bootstrap',
    { materializeEdges: materialization.dependencyEdges }
  );
  warnings.push(...phase2.warnings);
  if (report) {
    report.phases.depGraph = {
      edgesWritten: phase2.depEdgesWritten || 0,
      ms: Date.now() - p2Start,
    };
  }

  // ── Phase 2.1: Module 实体 ──
  await runPhase2_1_ModuleEntities(phase2.depGraphData, projectRoot, ctx.container, ctx.logger, {
    materialize: materialization.moduleEntities,
  });

  // ── Phase 2.2: Panorama 全景汇总 ──
  // 必须在 Phase 2.1 之后：此时 code_entities 中已有 module 记录
  let panoramaResult: Record<string, unknown> | null = null;
  if (materialization.panorama) {
    const panorama = await materializeProjectPanorama({
      container: ctx.container,
      logger: ctx.logger,
      report,
    });
    panoramaResult = panorama.panoramaResult;
    warnings.push(...panorama.warnings);
  }

  // ── Phase 3: Guard 审计 ──
  const p3Start = Date.now();
  const phase3 = await runPhase3_GuardAudit(allFiles, ctx.container, ctx.logger, {
    skipGuard: options.skipGuard || false,
    summaryPrefix: options.summaryPrefix || 'Bootstrap scan',
    writeViolations: materialization.guardViolations,
  });
  warnings.push(...phase3.warnings);
  if (report) {
    report.phases.guard = {
      ruleCount: phase3.guardAudit?.rules?.length || 0,
      ms: Date.now() - p3Start,
    };
  }

  // ── Phase 4: 维度解析 + Enhancement Pack ──
  const p4Start = Date.now();
  const primaryLang = detectPrimaryLanguage(langStats);
  const phase4 = await runPhase4_DimensionResolve({
    primaryLang,
    langStats,
    allTargets,
    astProjectSummary: phase1_5.astProjectSummary,
    guardEngine: phase3.guardEngine,
    allFiles,
    logger: ctx.logger,
  });
  if (report) {
    report.phases.dimension = {
      activeDimCount: phase4.activeDimensions?.length || 0,
      detectedFrameworks: phase4.detectedFrameworks,
      ms: Date.now() - p4Start,
    };
  }

  // 如果 Enhancement Pack 产生了新的 guardAudit，覆盖 Phase 3 的结果
  const finalGuardAudit = phase4.guardAudit || phase3.guardAudit;

  const targetsSummary = buildProjectAnalysisTargetsSummary({ allTargets, allFiles, projectRoot });
  const localPackageModules = buildProjectAnalysisLocalPackageModules({ targetsSummary, allFiles });

  // 完成报告
  if (report) {
    report.totalMs = Date.now() - report.startTime;
  }

  return {
    allFiles,
    langStats,
    primaryLang,
    discoverer,
    allTargets,
    truncated,
    astProjectSummary: phase1_5.astProjectSummary,
    astContext: phase1_5.astContext,
    codeEntityResult: phase1_6.codeEntityResult,
    callGraphResult: phase1_7.callGraphResult,
    depGraphData: phase2.depGraphData,
    depEdgesWritten: phase2.depEdgesWritten,
    guardAudit: finalGuardAudit,
    guardEngine: phase3.guardEngine,
    activeDimensions: phase4.activeDimensions,
    enhancementPackInfo: phase4.enhancementPackInfo,
    enhancementPatterns: phase4.enhancementPatterns,
    enhancementGuardRules: phase4.enhancementGuardRules,
    langProfile: phase4.langProfile,
    detectedFrameworks: phase4.detectedFrameworks,
    targetsSummary,
    localPackageModules, // 本地子包汇总（语言无关）
    warnings,
    report, // NEW: Phase 级报告 (null if generateReport=false)
    incrementalPlan, // NEW: 增量评估结果 (null if incremental=false)
    sourceGraphResult,
    panoramaResult, // Phase 2.2: 全景汇总 (null if panoramaService unavailable)
    isEmpty: false,
  };
}
