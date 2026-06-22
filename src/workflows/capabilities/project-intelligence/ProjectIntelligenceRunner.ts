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
 *   Phase 3   → Guard 规则审计
 *   Phase 4   → signal-aware 维度选择 + Enhancement Pack + 语言画像
 */

import { DimensionCopy } from '../../../domain/dimension/DimensionCopy.js';
import type { SourceGraphRepositoryImpl } from '../../../repository/source-graph/SourceGraphRepository.js';
import type {
  ArchitectureDomain,
  ArchitectureEvidence,
  DomainSignalReport,
} from '../../../service/project-context/architectureIntelligence/index.js';
import { resolveSignalAwareActiveDimensions } from '../../../service/project-context/dimensionPlanning/index.js';
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
import { type BaseDimension, toBaseDimension } from '../planning/dimensions/BaseDimensions.js';
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

type ProjectAnalysisSignalPattern = {
  label: string;
  pattern: RegExp;
  weight: number;
};

const PROJECT_ANALYSIS_DOMAIN_ORDER: readonly ArchitectureDomain[] = [
  'auth',
  'api',
  'ui',
  'database',
  'concurrency',
  'security',
  'observability',
  'error-handling',
  'testing',
];

const PROJECT_ANALYSIS_SIGNAL_PATTERNS: Readonly<
  Record<ArchitectureDomain, readonly ProjectAnalysisSignalPattern[]>
> = {
  auth: [
    { label: 'auth', pattern: /\b(auth|oauth|login|session|credential|token)\b/i, weight: 0.65 },
  ],
  api: [
    { label: 'api', pattern: /\b(api|endpoint|request|response|rest|graphql)\b/i, weight: 0.6 },
    { label: 'http', pattern: /\b(fetch|axios|urlsession|httpclient|https?)\b/i, weight: 0.7 },
  ],
  ui: [
    { label: 'ui', pattern: /\b(ui|view|screen|component|button|navigation)\b/i, weight: 0.58 },
    { label: 'SwiftUI', pattern: /\bswiftui\b/i, weight: 0.75 },
    { label: 'React', pattern: /\b(react|tsx|jsx)\b/i, weight: 0.72 },
    { label: 'Vue', pattern: /\b(vue|nuxt)\b/i, weight: 0.72 },
  ],
  database: [
    {
      label: 'database',
      pattern: /\b(database|sqlite|sql|repository|coredata|realm|prisma|typeorm|modelcontext)\b/i,
      weight: 0.66,
    },
  ],
  concurrency: [
    { label: 'async', pattern: /\b(async|await|actor|task|promise|thread|queue)\b/i, weight: 0.64 },
    { label: 'Combine', pattern: /\bcombine\b/i, weight: 0.72 },
  ],
  security: [
    {
      label: 'security',
      pattern: /\b(security|permission|encrypt|decrypt|keychain|csrf|xss)\b/i,
      weight: 0.66,
    },
  ],
  observability: [
    { label: 'logging', pattern: /\b(log|logger|trace|metric|telemetry|span)\b/i, weight: 0.6 },
  ],
  'error-handling': [
    { label: 'error handling', pattern: /\b(error|exception|retry|timeout)\b/i, weight: 0.58 },
  ],
  testing: [
    { label: 'test', pattern: /\b(test|spec|mock|fixture|assert|expect)\b/i, weight: 0.6 },
    { label: 'XCTest', pattern: /\bxctest\b/i, weight: 0.76 },
    { label: 'Vitest', pattern: /\bvitest\b/i, weight: 0.74 },
    { label: 'Jest', pattern: /\bjest\b/i, weight: 0.74 },
  ],
};

function buildProjectAnalysisDomainSignals({
  allFiles,
  allTargets,
  detectedFrameworks,
}: {
  allFiles: BootstrapFileEntry[];
  allTargets: TargetItem[];
  detectedFrameworks: readonly string[];
}): DomainSignalReport {
  const buckets = new Map<ArchitectureDomain, ArchitectureEvidence[]>();

  const addEvidence = (domain: ArchitectureDomain, evidence: ArchitectureEvidence) => {
    const bucket = buckets.get(domain) ?? [];
    if (
      !bucket.some((item) => item.label === evidence.label && item.filePath === evidence.filePath)
    ) {
      bucket.push(evidence);
      buckets.set(domain, bucket);
    }
  };

  const inspectText = (
    text: string,
    sourceLabel: string,
    sourceWeight: number,
    filePath?: string
  ) => {
    for (const domain of PROJECT_ANALYSIS_DOMAIN_ORDER) {
      for (const signal of PROJECT_ANALYSIS_SIGNAL_PATTERNS[domain]) {
        if (signal.pattern.test(text)) {
          addEvidence(domain, {
            source: 'derived',
            label: `${signal.label}: ${sourceLabel}`,
            weight: Math.max(sourceWeight, signal.weight),
            filePath,
          });
        }
      }
    }
  };

  for (const framework of detectedFrameworks) {
    inspectText(framework, `framework ${framework}`, 0.72);
  }
  for (const target of allTargets) {
    if (typeof target === 'string') {
      inspectText(target, `target ${target}`, 0.5);
      continue;
    }
    const targetText = [target.name, target.framework, target.type, target.packageName]
      .filter(Boolean)
      .join(' ');
    inspectText(targetText, `target ${target.name}`, 0.55);
  }
  for (const file of allFiles) {
    const filePath = file.relativePath || file.path;
    inspectText(
      `${file.name} ${file.relativePath} ${file.targetName}`,
      `file ${filePath}`,
      0.5,
      filePath
    );
    inspectText(
      file.content.slice(0, 25_000),
      `content ${filePath}`,
      file.isTest ? 0.76 : 0.64,
      filePath
    );
    if (file.isTest) {
      addEvidence('testing', {
        source: 'derived',
        label: `test file: ${filePath}`,
        weight: 0.78,
        filePath,
      });
    }
  }

  const domains = PROJECT_ANALYSIS_DOMAIN_ORDER.map((domain) => {
    const evidence = (buckets.get(domain) ?? [])
      .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
      .slice(0, 8);
    const totalWeight = evidence.reduce((sum, item) => sum + item.weight, 0);
    const confidence =
      evidence.length > 0 ? Math.min(0.95, 0.3 + Math.min(0.65, totalWeight / 3)) : 0;
    return {
      domain,
      present: evidence.length > 0,
      confidence,
      evidence,
      moduleSignals: [],
    };
  });

  return {
    domains,
    projectPresentDomains: domains
      .filter((domain) => domain.present)
      .map((domain) => domain.domain),
    evidenceCount: domains.reduce((count, domain) => count + domain.evidence.length, 0),
  };
}

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

// ── Phase 4: signal-aware 维度解析 + Enhancement Pack ───────

/**
 * Phase 4: signal-aware 维度选择 + Enhancement Pack 动态追加 + 语言画像 + Skill 增强
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

  const domainSignals = buildProjectAnalysisDomainSignals({
    allFiles,
    allTargets,
    detectedFrameworks,
  });
  const signalAwareSelection = resolveSignalAwareActiveDimensions({
    primaryLanguage: primaryLang,
    detectedFrameworks,
    domainSignals,
  });
  const activeDimensions = signalAwareSelection.activeDimensions.map(toBaseDimension);
  const selectedBaseDimensionCount = activeDimensions.length;

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
          `+${activeDimensions.length - selectedBaseDimensionCount} dims, ${enhancementGuardRules.length} guard rules, ${enhancementPatterns.length} patterns`
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
    panoramaResult: null,
    isEmpty: false,
  };
}
