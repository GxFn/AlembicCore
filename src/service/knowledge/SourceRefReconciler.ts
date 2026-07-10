/**
 * SourceRefReconciler — Recipe 来源引用健康检查 + 自动修复
 *
 * 从 knowledge_entries.reasoning.sources 填充 recipe_source_refs 桥接表，
 * 验证路径存在性，检测 git rename，修复路径引用。
 *
 * 状态机:
 *   active  — 文件存在，路径有效
 *   renamed — 文件已移动到 new_path，等待修复
 *   stale   — 路径失效，无法自动修复
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import Logger from '../../infrastructure/logging/Logger.js';
import type { SignalBus } from '../../infrastructure/signal/SignalBus.js';
import type KnowledgeRepositoryImpl from '../../repository/knowledge/KnowledgeRepositoryImpl.js';
import type {
  RecipeSourceRefEntity,
  RecipeSourceRefRepositoryImpl,
} from '../../repository/sourceref/RecipeSourceRefRepository.js';
import { computeContentHash } from '../../shared/contentHash.js';
import {
  buildProjectScopeSourceRefIndex,
  type CanonicalSourceIdentity,
  type ProjectScopeSourceRefIndex,
  resolveProjectScopeSourceRef,
} from '../../shared/ProjectScope.js';
import { classifyRegionDrift } from './driftClassifier.js';
import { rewriteRecipePaths } from './RecipePathRewriter.js';

const execFileAsync = promisify(execFile);

export interface ReconcileReport {
  /** 新插入的 sourceRef 条目 */
  inserted: number;
  /** 验证为 active 的条目 */
  active: number;
  /** 标记为 stale 的条目 */
  stale: number;
  /** 跳过的条目（24h 内已验证） */
  skipped: number;
  /** 处理的 recipe 数 */
  recipesProcessed: number;
  /** 反向清理的旧行（不再被 reasoning.sources 引用） */
  cleaned?: number;
  /** 解析失败或缺失来源字段的 recipe 数 */
  failed?: number;
  /** U6：内容指纹漂移（文件在、region 内容变）标记为 drifted 的条目数 */
  drifted?: number;
  /** P3 observe-only：drifted 中判为「行号漂移」(旧块在新文件整块出现)的条目数。 */
  driftLineShift?: number;
  /** P3 observe-only：drifted 中判为「内容实变」(旧块在新文件找不到)的条目数。 */
  driftContentChange?: number;
  /** 阻止 source_ref 更新的可审计原因 */
  blockers?: string[];
}

export interface ReconcileRecipeSourceRefsInput {
  id: string;
  reasoning?: unknown;
}

export interface RepairReport {
  /** 成功检测到 rename 的条目 */
  renamed: number;
  /** 仍然 stale 的条目 */
  stillStale: number;
}

export interface ApplyReport {
  /** 成功写回 .md 的条目 */
  applied: number;
  /** 写回失败的条目 */
  failed: number;
}

/* ────────────────────── Class ────────────────────── */

/** 默认跳过 24h 内已验证的条目 */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

type ReasoningSourcesSuccess = { sources: readonly string[]; status: 'valid' | 'valid-empty' };
type ReasoningSourcesFailure = { reason: string; status: 'missing' | 'parse-error' };
type ReasoningSourcesParseResult = ReasoningSourcesFailure | ReasoningSourcesSuccess;

function hasReasoningSources(
  parsed: ReasoningSourcesParseResult
): parsed is ReasoningSourcesSuccess {
  return 'sources' in parsed;
}

export class SourceRefReconciler {
  #projectRoot: string;
  #sourceRefRepo: RecipeSourceRefRepositoryImpl;
  #knowledgeRepo: KnowledgeRepositoryImpl;
  #signalBus: SignalBus | null;
  #logger = Logger.getInstance();
  #ttlMs: number;
  #sourceRefIndex: ProjectScopeSourceRefIndex | null;
  #gitReader: ((commit: string, relPath: string) => string | null) | null = null;

  constructor(
    projectRoot: string,
    sourceRefRepo: RecipeSourceRefRepositoryImpl,
    knowledgeRepo: KnowledgeRepositoryImpl,
    options?: {
      sourceIdentities?: readonly CanonicalSourceIdentity[];
      signalBus?: SignalBus;
      ttlMs?: number;
      /**
       * P3 observe-only:读取某 commit 下文件内容的注入(通常 gitBlob.readFileAtCommit 偏应用)。
       * 提供 + reconcile 传 baselineCommit 时,drifted 分支会精判 line-shift vs content-change
       * 并记进 report(不改 status、不改 sourceRefs)。缺省=不精判,行为与既有完全一致。
       */
      gitReader?: (commit: string, relPath: string) => string | null;
    }
  ) {
    this.#projectRoot = projectRoot;
    this.#sourceRefRepo = sourceRefRepo;
    this.#knowledgeRepo = knowledgeRepo;
    this.#signalBus = options?.signalBus ?? null;
    this.#ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    this.#gitReader = options?.gitReader ?? null;
    this.#sourceRefIndex = options?.sourceIdentities?.length
      ? buildProjectScopeSourceRefIndex(options.sourceIdentities)
      : null;
  }

  /**
   * 从 knowledge_entries.reasoning 填充 recipe_source_refs 表。
   * 对已有条目验证路径存在性，更新 status。
   */
  async reconcile(opts?: { force?: boolean; baselineCommit?: string }): Promise<ReconcileReport> {
    const force = opts?.force ?? false;
    // P3 observe-only:整批 reconcile 的基线 commit(用于 drifted 精判);缺省=不精判。
    // 经参数链传递而非实例态——本类是 DI 单例且 MCP 处理并发,实例态会被并行轮次互踩。
    const baselineCommit = opts?.baselineCommit ?? null;
    const report: ReconcileReport = {
      inserted: 0,
      active: 0,
      stale: 0,
      skipped: 0,
      recipesProcessed: 0,
      failed: 0,
      blockers: [],
    };

    // 确保表可访问
    if (!this.#sourceRefRepo.isAccessible()) {
      this.#logger.warn('SourceRefReconciler: recipe_source_refs table not accessible, skipping');
      return report;
    }

    // 获取所有有 reasoning 的知识条目
    const rows = await this.#knowledgeRepo.findAllIdAndReasoning();

    const now = Date.now();

    for (const row of rows) {
      const parsed = this.#parseReasoningSources(row.reasoning);
      if (!hasReasoningSources(parsed)) {
        this.#recordSourceParseBlocker(row.id, parsed, report);
        continue;
      }

      this.#reconcileRecipeSourceRefs(row.id, parsed.sources, {
        baselineCommit,
        countRecipe: true,
        force,
        now,
        report,
      });
    }

    this.#logger.info('SourceRefReconciler: reconcile complete', {
      inserted: report.inserted,
      active: report.active,
      stale: report.stale,
      drifted: report.drifted ?? 0,
      skipped: report.skipped,
      recipesProcessed: report.recipesProcessed,
    });

    // 通过 SignalBus 发射信号 — 让 Governance 子系统感知 sourceRef 健康状况
    if (this.#signalBus && report.stale > 0) {
      this.#emitStaleSignals();
    }

    return report;
  }

  /**
   * RG7: refresh source_refs for one known Recipe immediately after create/evolve.
   *
   * Unlike the full reconcile path, an explicit per-recipe refresh treats an
   * empty `reasoning.sources` list as a real update and removes previously
   * bridged refs for that Recipe only. That is the create/evolve timing repair
   * boundary; unrelated Recipe rows stay untouched.
   */
  async reconcileRecipeSourceRefs(
    recipe: ReconcileRecipeSourceRefsInput,
    opts?: { force?: boolean; baselineCommit?: string }
  ): Promise<ReconcileReport> {
    const report: ReconcileReport = {
      inserted: 0,
      active: 0,
      stale: 0,
      skipped: 0,
      recipesProcessed: 0,
      failed: 0,
      blockers: [],
    };

    if (!this.#sourceRefRepo.isAccessible()) {
      this.#logger.warn('SourceRefReconciler: recipe_source_refs table not accessible, skipping', {
        recipeId: recipe.id,
      });
      return report;
    }

    const parsed = this.#parseReasoningSources(recipe.reasoning);
    if (!hasReasoningSources(parsed)) {
      this.#recordSourceParseBlocker(recipe.id, parsed, report);
      this.#logger.warn('SourceRefReconciler: recipe source refs refresh blocked', {
        reason: parsed.reason,
        recipeId: recipe.id,
        status: parsed.status,
      });
      return report;
    }

    // P3 observe-only:本轮基线 commit(用于 drifted 精判);缺省=不精判。参数链传递,
    // 不用实例态(DI 单例 + MCP 并发,实例态会被并行轮次互踩)。
    this.#reconcileRecipeSourceRefs(recipe.id, parsed.sources, {
      baselineCommit: opts?.baselineCommit ?? null,
      countRecipe: true,
      force: opts?.force ?? true,
      now: Date.now(),
      report,
    });

    this.#logger.info('SourceRefReconciler: recipe source refs refreshed', {
      active: report.active,
      cleaned: report.cleaned ?? 0,
      inserted: report.inserted,
      recipeId: recipe.id,
      skipped: report.skipped,
      stale: report.stale,
    });

    return report;
  }

  #parseReasoningSources(reasoningInput: unknown): ReasoningSourcesParseResult {
    try {
      const reasoning =
        typeof reasoningInput === 'string'
          ? (JSON.parse(reasoningInput) as { sources?: unknown })
          : (reasoningInput as { sources?: unknown } | null);
      if (!reasoning || !('sources' in reasoning)) {
        return { reason: 'reasoning.sources is missing', status: 'missing' };
      }
      if (!Array.isArray(reasoning.sources)) {
        return { reason: 'reasoning.sources is not an array', status: 'parse-error' };
      }
      if (reasoning.sources.length === 0) {
        return { sources: [], status: 'valid-empty' };
      }
      if (reasoning.sources.some((source) => typeof source !== 'string' || source.length === 0)) {
        return { reason: 'reasoning.sources contains non-string entries', status: 'parse-error' };
      }
      return { sources: reasoning.sources, status: 'valid' };
    } catch (error) {
      return {
        reason: error instanceof Error ? error.message : String(error),
        status: 'parse-error',
      };
    }
  }

  #recordSourceParseBlocker(
    recipeId: string,
    parsed: ReasoningSourcesFailure,
    report: ReconcileReport
  ): void {
    report.recipesProcessed++;
    report.failed = (report.failed ?? 0) + 1;
    report.blockers = [
      ...(report.blockers ?? []),
      `recipe_source_refs:${recipeId}:${parsed.status}:${parsed.reason}`,
    ];
  }

  #reconcileRecipeSourceRefs(
    recipeId: string,
    sources: readonly string[],
    opts: {
      baselineCommit: string | null;
      countRecipe: boolean;
      force: boolean;
      now: number;
      report: ReconcileReport;
    }
  ): void {
    if (opts.countRecipe) {
      opts.report.recipesProcessed++;
    }
    this.#deleteDroppedSourceRefs(recipeId, sources, opts.report);

    for (const sourcePath of sources) {
      this.#reconcileSourceRef(recipeId, sourcePath, {
        baselineCommit: opts.baselineCommit,
        force: opts.force,
        now: opts.now,
        report: opts.report,
      });
    }
  }

  #deleteDroppedSourceRefs(
    recipeId: string,
    sources: readonly string[],
    report: ReconcileReport
  ): void {
    const sourcesSet = new Set(sources);
    for (const ref of this.#sourceRefRepo.findByRecipeId(recipeId)) {
      if (!sourcesSet.has(ref.sourcePath)) {
        this.#sourceRefRepo.deleteOne(recipeId, ref.sourcePath);
        report.cleaned = (report.cleaned ?? 0) + 1;
      }
    }
  }

  #reconcileSourceRef(
    recipeId: string,
    sourcePath: string,
    opts: { baselineCommit: string | null; force: boolean; now: number; report: ReconcileReport }
  ): void {
    const existing = this.#sourceRefRepo.findOne(recipeId, sourcePath);
    if (existing && !opts.force && opts.now - existing.verifiedAt < this.#ttlMs) {
      this.#recordSkippedExisting(existing.status, opts.report);
      return;
    }

    const exists = this.#sourcePathExists(sourcePath);
    if (existing) {
      this.#updateExistingSourceRef(
        recipeId,
        sourcePath,
        exists,
        opts.now,
        opts.report,
        existing,
        opts.baselineCommit
      );
      return;
    }

    this.#insertSourceRef(recipeId, sourcePath, exists, opts.now, opts.report);
  }

  #recordSkippedExisting(status: string, report: ReconcileReport): void {
    report.skipped++;
    if (status === 'active') {
      report.active++;
    } else if (status === 'stale') {
      report.stale++;
    } else if (status === 'drifted') {
      report.drifted = (report.drifted ?? 0) + 1;
    }
  }

  /**
   * P6：唯一的「源路径 → 存在的绝对路径」解析出口。
   * 走 #resolveSourcePath（ProjectScope-aware）+ sourcePathFilesystemCandidates（行号/片段后缀剥离），
   * 供 #sourcePathExists（reconcile/repair）与 #sourceContentFingerprint（指纹读文件）共用，三处口径一致。
   */
  #resolveExistingSourceFile(sourcePath: string): string | null {
    for (const candidatePath of sourcePathFilesystemCandidates(sourcePath)) {
      const resolvedSource = this.#resolveSourcePath(candidatePath);
      if (resolvedSource.status === 'resolved' && fs.existsSync(resolvedSource.absolutePath)) {
        return resolvedSource.absolutePath;
      }
    }
    return null;
  }

  #sourcePathExists(sourcePath: string): boolean {
    return this.#resolveExistingSourceFile(sourcePath) !== null;
  }

  /**
   * U6：计算 sourcePath 指向 region 的内容指纹（独立于 computeKnowledgeHash）。
   * 复用同一 #resolveExistingSourceFile 出口定位文件，按 sourcePath 的行号后缀截 region。
   * 返回 null 表示文件解析不到或读失败（调用方据此保守续期、不误报 drift）。
   */
  #sourceContentFingerprint(sourcePath: string): string | null {
    const absPath = this.#resolveExistingSourceFile(sourcePath);
    if (!absPath) {
      return null;
    }
    try {
      const content = fs.readFileSync(absPath, 'utf8');
      return computeSourceRegionFingerprint(content, parseSourceLineRange(sourcePath));
    } catch (error) {
      // 读文件失败（权限/竞态）→ 安静降级 null：上层按 active 续期、不写指纹、不误报 drift。
      this.#logger.debug('SourceRefReconciler: content fingerprint read failed', {
        sourcePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  #updateExistingSourceRef(
    recipeId: string,
    sourcePath: string,
    exists: boolean,
    verifiedAt: number,
    report: ReconcileReport,
    existing: RecipeSourceRefEntity,
    baselineCommit: string | null
  ): void {
    if (!exists) {
      // 文件不存在 → stale；不写 content_fp，保留旧指纹以便文件复活后比对。
      this.#sourceRefRepo.upsert({
        recipeId,
        sourcePath,
        status: 'stale',
        verifiedAt,
      });
      report.stale++;
      return;
    }

    // 文件存在 → 算当前 region 指纹，比对 content_fp 决定 active 续期 / drifted。
    const currentFp = this.#sourceContentFingerprint(sourcePath);

    if (currentFp === null) {
      // 文件在但指纹算不出（读失败等）→ 保守 active 续期，不写指纹、不误报 drift。
      this.#sourceRefRepo.upsert({
        recipeId,
        sourcePath,
        status: 'active',
        newPath: null,
        verifiedAt,
      });
      report.active++;
      return;
    }

    if (existing.contentFp === null) {
      // CG⑥a：首轮 content_fp 为 null（迁移后/老行首填）→ 只回填指纹、不改 status，
      // 否则首次升级会把全量 active 误判 drifted。
      this.#sourceRefRepo.upsert({
        recipeId,
        sourcePath,
        status: 'active',
        newPath: null,
        verifiedAt,
        contentFp: currentFp,
      });
      report.active++;
      this.#logger.debug('SourceRefReconciler: content_fp first-fill, status unchanged (CG-6a)', {
        recipeId,
        sourcePath,
      });
      return;
    }

    if (existing.contentFp === currentFp) {
      // 指纹不变 → active 续期。
      this.#sourceRefRepo.upsert({
        recipeId,
        sourcePath,
        status: 'active',
        newPath: null,
        verifiedAt,
        contentFp: currentFp,
      });
      report.active++;
      return;
    }

    // 指纹变化 → drifted（文件在、region 内容变）；下游 gate 决 update/deprecate。
    this.#sourceRefRepo.upsert({
      recipeId,
      sourcePath,
      status: 'drifted',
      newPath: null,
      verifiedAt,
      contentFp: currentFp,
    });
    report.drifted = (report.drifted ?? 0) + 1;
    this.#logger.info('SourceRefReconciler: source region content drift → drifted', {
      recipeId,
      sourcePath,
      previousFp: existing.contentFp,
      currentFp,
    });
    // P3 observe-only 精判:有 git 读取器+基线 commit 时,判 drifted 是行号漂移还是内容实变,
    // 只记进 report + 日志,不改 status、不改 sourceRefs(自动修 range 是后续项)。
    this.#classifyDriftObserveOnly(recipeId, sourcePath, report, baselineCommit);
  }

  /**
   * P3 observe-only:分类 drifted 原因。缺 gitReader/baselineCommit/旧内容任一 → 静默跳过
   * (不精判,维持粗粒度 drifted)。绝不因精判失败影响 reconcile 主流程。
   */
  #classifyDriftObserveOnly(
    recipeId: string,
    sourcePath: string,
    report: ReconcileReport,
    baselineCommit: string | null
  ): void {
    const gitReader = this.#gitReader;
    if (!gitReader || !baselineCommit) {
      return;
    }
    try {
      const relPath = stripSourceRangeSuffix(sourcePath);
      const oldContent = gitReader(baselineCommit, relPath);
      const absPath = this.#resolveExistingSourceFile(sourcePath);
      if (oldContent === null || !absPath) {
        return;
      }
      const newContent = fs.readFileSync(absPath, 'utf8');
      const range = parseSourceLineRange(sourcePath);
      const classification = classifyRegionDrift(oldContent, newContent, {
        start: range.start ?? 1,
        end: range.end ?? range.start ?? 1,
      });
      if (classification.kind === 'line-shift') {
        report.driftLineShift = (report.driftLineShift ?? 0) + 1;
        this.#logger.info('SourceRefReconciler: drift classified as line-shift (observe-only)', {
          recipeId,
          sourcePath,
          suggestedRange: classification.newRange,
        });
      } else if (classification.kind === 'content-change') {
        report.driftContentChange = (report.driftContentChange ?? 0) + 1;
        this.#logger.info(
          'SourceRefReconciler: drift classified as content-change (observe-only)',
          {
            recipeId,
            sourcePath,
          }
        );
      }
    } catch (error) {
      // 精判是纯观测增强,任何失败静默降级(不影响已写入的 drifted)。
      this.#logger.debug('SourceRefReconciler: drift classification skipped', {
        recipeId,
        sourcePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #insertSourceRef(
    recipeId: string,
    sourcePath: string,
    exists: boolean,
    verifiedAt: number,
    report: ReconcileReport
  ): void {
    // 新行存在 → 立即算 region 指纹作基线（下次 reconcile 即可检 drift）；不存在 → stale 无指纹。
    const contentFp = exists ? this.#sourceContentFingerprint(sourcePath) : null;
    this.#sourceRefRepo.upsert({
      recipeId,
      sourcePath,
      status: exists ? 'active' : 'stale',
      verifiedAt,
      ...(contentFp ? { contentFp } : {}),
    });
    report.inserted++;
    if (exists) {
      report.active++;
    } else {
      report.stale++;
    }
  }

  /**
   * 为每个有 stale sourceRef 的 Recipe 发射 quality 信号。
   * 信号可被其他组件订阅处理。
   */
  #emitStaleSignals(): void {
    if (!this.#signalBus) {
      return;
    }
    try {
      const staleRecipes = this.#sourceRefRepo.getStaleCountsByRecipe();

      for (const row of staleRecipes) {
        const staleRatio = row.staleCount / row.totalCount;
        this.#signalBus.send('quality', 'SourceRefReconciler', staleRatio, {
          target: row.recipeId,
          metadata: {
            reason: 'source_ref_stale',
            staleCount: row.staleCount,
            totalRefs: row.totalCount,
          },
        });
      }
    } catch {
      // 信号发射失败不影响主流程
    }
  }

  /**
   * 对 stale 条目尝试 git rename 修复。
   * 使用 execFile() 安全执行 git log（防止命令注入）。
   */
  async repairRenames(): Promise<RepairReport> {
    const report: RepairReport = { renamed: 0, stillStale: 0 };

    // 获取所有 stale 条目
    const staleRows = this.#sourceRefRepo.findStale();

    if (staleRows.length === 0) {
      return report;
    }

    // 获取 git rename 映射
    const renameMap = await this.#getGitRenameMap();

    const now = Date.now();
    for (const row of staleRows) {
      const newPath = renameMap.get(row.sourcePath);
      if (newPath) {
        // P6：验证 newPath 存在 — 走 #sourcePathExists 同一 ProjectScope-aware resolve 出口，
        // 与 reconcile/fingerprint 口径一致（替换原裸 path.resolve + existsSync）。
        if (this.#sourcePathExists(newPath)) {
          this.#sourceRefRepo.upsert({
            recipeId: row.recipeId,
            sourcePath: row.sourcePath,
            status: 'renamed',
            newPath,
            verifiedAt: now,
          });
          report.renamed++;
          continue;
        }
      }
      report.stillStale++;
    }

    if (report.renamed > 0) {
      this.#logger.info('SourceRefReconciler: rename repair complete', {
        renamed: report.renamed,
        stillStale: report.stillStale,
      });

      // 修复成功 → 发射正向 quality 信号（value≈0 表示健康方向）
      if (this.#signalBus) {
        this.#signalBus.send('quality', 'SourceRefReconciler', 0.1, {
          metadata: {
            reason: 'source_ref_repaired',
            renamed: report.renamed,
            stillStale: report.stillStale,
          },
        });
      }
    }

    return report;
  }

  /**
   * 将 renamed 条目的 new_path 写回 Recipe .md 文件和 DB。
   * 同时更新 reasoning.sources、content.markdown、coreCode 中的路径引用。
   * 完成后 status → active（通过 replaceSourcePath）。
   */
  async applyRepairs(): Promise<ApplyReport> {
    const report: ApplyReport = { applied: 0, failed: 0 };

    const renamedRows = this.#sourceRefRepo.findRenamed();

    if (renamedRows.length === 0) {
      return report;
    }

    // 按 recipeId 分组
    const byRecipe = new Map<string, Array<{ sourcePath: string; newPath: string }>>();
    for (const row of renamedRows) {
      if (!byRecipe.has(row.recipeId)) {
        byRecipe.set(row.recipeId, []);
      }
      byRecipe.get(row.recipeId)?.push({ sourcePath: row.sourcePath, newPath: row.newPath! });
    }

    const now = Date.now();
    for (const [recipeId, renames] of byRecipe) {
      try {
        // 统一路径重写（DB 字段 + .md 文件）
        const pathRenames = renames.map((r) => ({ oldPath: r.sourcePath, newPath: r.newPath }));
        const rewriteResult = await rewriteRecipePaths(
          this.#knowledgeRepo,
          recipeId,
          pathRenames,
          this.#projectRoot
        );

        if (rewriteResult.updatedFields.length > 0 || rewriteResult.mdFileUpdated) {
          // 更新 recipe_source_refs 桥接表状态
          for (const rename of renames) {
            this.#sourceRefRepo.replaceSourcePath(recipeId, rename.sourcePath, rename.newPath, now);
          }

          report.applied += renames.length;
        } else {
          report.failed += renames.length;
        }
      } catch (err: unknown) {
        this.#logger.warn('SourceRefReconciler: applyRepairs failed for recipe', {
          recipeId,
          error: (err as Error).message,
        });
        report.failed += renames.length;
      }
    }

    if (report.applied > 0) {
      this.#logger.info('SourceRefReconciler: applyRepairs complete', report);
    }

    return report;
  }

  /* ═══ Private helpers ═══════════════════════════════ */

  /**
   * 通过 git log 获取 rename 映射（旧路径 → 新路径）
   * 使用 execFile 防止命令注入
   */
  async #getGitRenameMap(): Promise<Map<string, string>> {
    const renameMap = new Map<string, string>();

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['log', '--diff-filter=R', '--name-status', '--pretty=format:', '-n', '200'],
        {
          cwd: this.#projectRoot,
          timeout: 10000,
          maxBuffer: 1024 * 1024,
        }
      );

      // 解析 git log 输出: R100\told_path\tnew_path
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('R')) {
          continue;
        }
        const parts = trimmed.split('\t');
        if (parts.length >= 3) {
          const oldPath = parts[1];
          const newPath = parts[2];
          if (oldPath && newPath) {
            renameMap.set(oldPath, newPath);
          }
        }
      }
    } catch {
      // git 不可用或不在 git 仓库中 — 跳过 rename 检测
      this.#logger.debug('SourceRefReconciler: git rename detection unavailable');
    }

    return renameMap;
  }

  #resolveSourcePath(sourcePath: string): {
    absolutePath: string;
    reason: string;
    status: 'missing' | 'resolved';
  } {
    if (this.#sourceRefIndex) {
      const resolution = resolveProjectScopeSourceRef(sourcePath, this.#sourceRefIndex);
      if (resolution.identity?.absolutePath) {
        return {
          absolutePath: resolution.identity.absolutePath,
          reason: resolution.reason,
          status: 'resolved',
        };
      }
      return {
        absolutePath: path.resolve(this.#projectRoot, sourcePath),
        reason: resolution.reason,
        status: 'missing',
      };
    }

    return {
      absolutePath: path.resolve(this.#projectRoot, sourcePath),
      reason: 'legacy-project-root',
      status: 'resolved',
    };
  }
}

/**
 * U6 内容指纹域分隔标签：保证源 region 指纹与 .md 的 computeKnowledgeHash 即使输入相同也不撞，
 * 二者语义不同、互不调用（验收①「指纹独立」）。版本前缀便于未来口径升级时区分。
 */
const SOURCE_REGION_FP_TAG = 'alembic:source-region-fp:v1\n';

/**
 * 计算源文件 region 的内容指纹（U6 内容级保鲜）。
 *
 * 与 computeKnowledgeHash（KnowledgeFileWriter，.md 全文剥 _contentHash 行的 SHA-256）严格独立：
 * 输入是「源码文件指定行区间」、normalize（统一行尾 + trim）后加域标签再 SHA-256，二者输入与语义均不同、互不调用。
 * 复用底层 computeContentHash（shared/contentHash）做 16-hex SHA-256 原语。
 *
 * @param content 源文件全文
 * @param range 1-based 行区间（含端点）；缺省/无行号 → 全文
 * @returns 16 hex 指纹
 */
export function computeSourceRegionFingerprint(
  content: string,
  range?: { start?: number; end?: number }
): string {
  const lines = content.split(/\r\n|\n|\r/);
  const region =
    range?.start != null
      ? lines.slice(range.start - 1, range.end ?? range.start).join('\n')
      : content;
  return computeContentHash(`${SOURCE_REGION_FP_TAG}${region.trim()}`);
}

/**
 * 从 sourcePath 后缀解析 1-based 行区间，与 sourcePathFilesystemCandidates 的剥离正则配套：
 *   `:N` / `:N-M`（可带 `:col`） 或 `#LN` / `#LN-LM` / `#LN-M`；无后缀 → 空区间（全文）。
 */
export function parseSourceLineRange(sourcePath: string): { start?: number; end?: number } {
  const colon = sourcePath.match(/:(\d+)(?:-(\d+))?(?::\d+)?$/);
  if (colon) {
    const start = Number(colon[1]);
    return { start, end: colon[2] ? Number(colon[2]) : start };
  }
  const fragment = sourcePath.match(/#L(\d+)(?:-L?(\d+))?$/i);
  if (fragment) {
    const start = Number(fragment[1]);
    return { start, end: fragment[2] ? Number(fragment[2]) : start };
  }
  return {};
}

/**
 * P3:剥离 sourcePath 的行区间后缀,得到 repo 相对文件路径(git pathspec 口径)。
 * 与 parseSourceLineRange 配套:`:N`/`:N-M`(:col) 或 `#LN`/`#LN-LM` 后缀被去掉。
 */
export function stripSourceRangeSuffix(sourcePath: string): string {
  return sourcePath
    .replace(/:(\d+)(?:-(\d+))?(?::\d+)?$/, '')
    .replace(/#L(\d+)(?:-L?(\d+))?$/i, '')
    .replaceAll('\\', '/');
}

function sourcePathFilesystemCandidates(sourcePath: string): string[] {
  const candidates: string[] = [];
  const enqueue = (candidate: string): void => {
    const trimmed = candidate.trim();
    if (trimmed.length > 0 && !candidates.includes(trimmed)) {
      candidates.push(trimmed);
    }
  };

  enqueue(sourcePath);
  enqueue(stripSourceLocationSuffix(sourcePath));
  enqueue(stripSourceFragmentSuffix(sourcePath));
  enqueue(stripSourceFragmentSuffix(stripSourceLocationSuffix(sourcePath)));
  return candidates;
}

function stripSourceLocationSuffix(sourcePath: string): string {
  return sourcePath.replace(/:\d+(?:-\d+)?(?::\d+)?$/, '');
}

function stripSourceFragmentSuffix(sourcePath: string): string {
  return sourcePath.replace(/#L\d+(?:-L?\d+)?$/i, '');
}
