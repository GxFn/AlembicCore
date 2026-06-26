/**
 * CoverageLedgerRepository — deepMining 多轮覆盖账本 CRUD（U2a）。
 *
 * 复刻 git-diff checkpoint 仓的 upsert/onConflictDoUpdate/listByProjectRoot/#mapRow 语义，
 * 键由 (project_root, scope_id, folder_id) 改为 **(project_root, module_id, dimension_id)** cell 键，
 * 并加 listByModule。同管理 deep_mining_rounds（轮次边际产出）。
 *
 * 红线：本仓只持久化「覆盖状态」，不含计划/会话字段。
 */
import { and, asc, eq } from 'drizzle-orm';
import type { DrizzleDB } from '../../infrastructure/database/drizzle/index.js';
import { coverageLedger, deepMiningRounds } from '../../infrastructure/database/drizzle/schema.js';

export type CoverageGrade = 'empty' | 'thin' | 'partial' | 'covered';

export interface CoverageLedgerScope {
  projectRoot: string;
  moduleId: string;
  dimensionId: string;
}

export interface CoverageLedgerRecord extends CoverageLedgerScope {
  coveredCount: number;
  totalCandidateCount: number;
  grade: CoverageGrade;
  exhausted: boolean;
  /** Agent 主观「已尽」理由（exhausted_source='agent-declared' 时有意义）。 */
  exhaustedReason: string | null;
  exhaustedSource: string | null;
  coveredSourceRefs: string[];
  uncoveredHints: string[];
  valueScore: number | null;
  lastRound: number | null;
  deferred: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertCoverageLedgerInput extends CoverageLedgerScope {
  coveredCount?: number;
  totalCandidateCount?: number;
  grade?: CoverageGrade;
  exhausted?: boolean;
  exhaustedReason?: string | null;
  exhaustedSource?: string | null;
  coveredSourceRefs?: string[];
  uncoveredHints?: string[];
  valueScore?: number | null;
  lastRound?: number | null;
  deferred?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface DeepMiningRoundRecord {
  projectRoot: string;
  roundIndex: number;
  startedAt: number | null;
  completedAt: number | null;
  newRecipesThisRound: number;
  triggerActor: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertDeepMiningRoundInput {
  projectRoot: string;
  roundIndex: number;
  startedAt?: number | null;
  completedAt?: number | null;
  newRecipesThisRound?: number;
  triggerActor?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

type CoverageLedgerRow = typeof coverageLedger.$inferSelect;
type DeepMiningRoundRow = typeof deepMiningRounds.$inferSelect;

const COVERAGE_GRADES = new Set<CoverageGrade>(['empty', 'thin', 'partial', 'covered']);

export class CoverageLedgerRepository {
  readonly #drizzle: DrizzleDB;

  constructor(drizzle: DrizzleDB) {
    this.#drizzle = drizzle;
  }

  /* ─── coverage_ledger（per module×dimension cell） ─── */

  getCell(scope: CoverageLedgerScope): CoverageLedgerRecord | null {
    const row = this.#drizzle
      .select()
      .from(coverageLedger)
      .where(CoverageLedgerRepository.#cellWhere(scope))
      .limit(1)
      .get();
    return row ? CoverageLedgerRepository.#mapCell(row) : null;
  }

  listByProjectRoot(projectRoot: string): CoverageLedgerRecord[] {
    const rows = this.#drizzle
      .select()
      .from(coverageLedger)
      .where(eq(coverageLedger.projectRoot, projectRoot))
      .all();
    return rows.map((row) => CoverageLedgerRepository.#mapCell(row));
  }

  listByModule(projectRoot: string, moduleId: string): CoverageLedgerRecord[] {
    const rows = this.#drizzle
      .select()
      .from(coverageLedger)
      .where(
        and(eq(coverageLedger.projectRoot, projectRoot), eq(coverageLedger.moduleId, moduleId))
      )
      .all();
    return rows.map((row) => CoverageLedgerRepository.#mapCell(row));
  }

  upsertCell(input: UpsertCoverageLedgerInput): CoverageLedgerRecord {
    const existing = this.getCell(input);
    const now = input.updatedAt ?? Date.now();
    const createdAt = input.createdAt ?? existing?.createdAt ?? now;

    // 可变字段集合（onConflictDoUpdate 复用，但更新时不重写 created_at）。
    const mutable = {
      coveredCount: input.coveredCount ?? 0,
      totalCandidateCount: input.totalCandidateCount ?? 0,
      grade: input.grade ?? 'empty',
      exhausted: input.exhausted ?? false,
      exhaustedReason: input.exhaustedReason ?? null,
      exhaustedSource: input.exhaustedSource ?? null,
      coveredSourceRefs: input.coveredSourceRefs ?? [],
      uncoveredHints: input.uncoveredHints ?? [],
      valueScore: input.valueScore ?? null,
      lastRound: input.lastRound ?? null,
      deferred: input.deferred ?? false,
      updatedAt: now,
    };

    this.#drizzle
      .insert(coverageLedger)
      .values({
        projectRoot: input.projectRoot,
        moduleId: input.moduleId,
        dimensionId: input.dimensionId,
        createdAt,
        ...mutable,
      })
      .onConflictDoUpdate({
        target: [coverageLedger.projectRoot, coverageLedger.moduleId, coverageLedger.dimensionId],
        set: mutable,
      })
      .run();

    const saved = this.getCell(input);
    if (!saved) {
      throw new Error(
        `Coverage ledger cell was not persisted: ${input.projectRoot}/${input.moduleId}/${input.dimensionId}`
      );
    }
    return saved;
  }

  /* ─── deep_mining_rounds（轮次边际产出） ─── */

  getRound(projectRoot: string, roundIndex: number): DeepMiningRoundRecord | null {
    const row = this.#drizzle
      .select()
      .from(deepMiningRounds)
      .where(
        and(
          eq(deepMiningRounds.projectRoot, projectRoot),
          eq(deepMiningRounds.roundIndex, roundIndex)
        )
      )
      .limit(1)
      .get();
    return row ? CoverageLedgerRepository.#mapRound(row) : null;
  }

  listRoundsByProjectRoot(projectRoot: string): DeepMiningRoundRecord[] {
    const rows = this.#drizzle
      .select()
      .from(deepMiningRounds)
      .where(eq(deepMiningRounds.projectRoot, projectRoot))
      .orderBy(asc(deepMiningRounds.roundIndex))
      .all();
    return rows.map((row) => CoverageLedgerRepository.#mapRound(row));
  }

  upsertRound(input: UpsertDeepMiningRoundInput): DeepMiningRoundRecord {
    const existing = this.getRound(input.projectRoot, input.roundIndex);
    const now = input.updatedAt ?? Date.now();
    const createdAt = input.createdAt ?? existing?.createdAt ?? now;

    const mutable = {
      startedAt: input.startedAt ?? existing?.startedAt ?? null,
      completedAt: input.completedAt ?? existing?.completedAt ?? null,
      newRecipesThisRound: input.newRecipesThisRound ?? existing?.newRecipesThisRound ?? 0,
      triggerActor: input.triggerActor ?? existing?.triggerActor ?? null,
      updatedAt: now,
    };

    this.#drizzle
      .insert(deepMiningRounds)
      .values({
        projectRoot: input.projectRoot,
        roundIndex: input.roundIndex,
        createdAt,
        ...mutable,
      })
      .onConflictDoUpdate({
        target: [deepMiningRounds.projectRoot, deepMiningRounds.roundIndex],
        set: mutable,
      })
      .run();

    const saved = this.getRound(input.projectRoot, input.roundIndex);
    if (!saved) {
      throw new Error(
        `Deep mining round was not persisted: ${input.projectRoot}/round-${input.roundIndex}`
      );
    }
    return saved;
  }

  /* ─── helpers ─── */

  static #cellWhere(scope: CoverageLedgerScope) {
    return and(
      eq(coverageLedger.projectRoot, scope.projectRoot),
      eq(coverageLedger.moduleId, scope.moduleId),
      eq(coverageLedger.dimensionId, scope.dimensionId)
    );
  }

  static #mapCell(row: CoverageLedgerRow): CoverageLedgerRecord {
    return {
      projectRoot: row.projectRoot,
      moduleId: row.moduleId,
      dimensionId: row.dimensionId,
      coveredCount: row.coveredCount,
      totalCandidateCount: row.totalCandidateCount,
      grade: normalizeGrade(row.grade),
      exhausted: row.exhausted,
      exhaustedReason: row.exhaustedReason ?? null,
      exhaustedSource: row.exhaustedSource ?? null,
      coveredSourceRefs: row.coveredSourceRefs ?? [],
      uncoveredHints: row.uncoveredHints ?? [],
      valueScore: row.valueScore ?? null,
      lastRound: row.lastRound ?? null,
      deferred: row.deferred,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  static #mapRound(row: DeepMiningRoundRow): DeepMiningRoundRecord {
    return {
      projectRoot: row.projectRoot,
      roundIndex: row.roundIndex,
      startedAt: row.startedAt ?? null,
      completedAt: row.completedAt ?? null,
      newRecipesThisRound: row.newRecipesThisRound,
      triggerActor: row.triggerActor ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

function normalizeGrade(value: string): CoverageGrade {
  if (COVERAGE_GRADES.has(value as CoverageGrade)) {
    return value as CoverageGrade;
  }
  return 'empty';
}
