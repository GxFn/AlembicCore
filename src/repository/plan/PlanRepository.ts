import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { DrizzleDB } from '../../infrastructure/database/drizzle/index.js';
import { plans } from '../../infrastructure/database/drizzle/schema.js';
import type {
  ConfirmPlanInput,
  PlanChangeLogEntry,
  PlanIntent,
  PlanRecord,
  PlanStatus,
  SavePlanDraftInput,
} from '../../service/planLedger/contracts.js';

type PlanRow = typeof plans.$inferSelect;

export class PlanRepositoryImpl {
  readonly #drizzle: DrizzleDB;

  constructor(drizzle: DrizzleDB) {
    this.#drizzle = drizzle;
  }

  saveDraft(input: SavePlanDraftInput): PlanRecord {
    const now = input.createdAt ?? Date.now();
    const planId = input.planId ?? PlanRepositoryImpl.generatePlanId(now);
    const version = input.version ?? this.#nextVersion(planId);
    const changeLog: PlanChangeLogEntry[] = [
      {
        at: now,
        actor: input.createdBy ?? 'agent',
        action: 'drafted',
        detail: 'Plan draft intent persisted.',
      },
    ];

    this.#drizzle
      .insert(plans)
      .values({
        planId,
        version,
        status: 'draft',
        projectRoot: input.projectRoot,
        projectContextSignature: input.projectContextSignature,
        lastUpdatedFromCommit: input.lastUpdatedFromCommit ?? null,
        createdBy: input.createdBy ?? 'agent',
        confirmedBy: null,
        confirmedAt: null,
        createdAt: now,
        updatedAt: now,
        supersedesPlanId: null,
        intentJson: JSON.stringify(input.intent),
        planningBriefJson: input.planningBrief ? JSON.stringify(input.planningBrief) : null,
        rationaleJson: JSON.stringify(input.rationale ?? []),
        changeLogJson: JSON.stringify(changeLog),
      })
      .run();

    const saved = this.get(planId, version);
    if (!saved) {
      throw new Error(`Plan draft was not persisted: ${planId}@${version}`);
    }
    return saved;
  }

  confirm(input: ConfirmPlanInput): PlanRecord {
    const existing = this.get(input.planId, input.version);
    if (!existing) {
      throw new Error(`Cannot confirm missing plan: ${input.planId}@${input.version}`);
    }
    if (existing.status !== 'draft' && existing.status !== 'confirmed') {
      throw new Error(`Cannot confirm ${existing.status} plan: ${input.planId}@${input.version}`);
    }

    const now = input.confirmedAt ?? Date.now();
    const actor = input.confirmedBy ?? 'agent';
    const intent = input.intentPatch
      ? ({ ...existing.intent, ...input.intentPatch } as PlanIntent)
      : existing.intent;
    const rationale = input.rationale ?? existing.rationale;
    const changeLog = [
      ...existing.intentChangeLog,
      {
        at: now,
        actor,
        action: 'confirmed' as const,
        detail: 'Plan intent confirmed for downstream generation.',
      },
    ];

    this.#drizzle
      .update(plans)
      .set({
        status: 'superseded',
        updatedAt: now,
        supersedesPlanId: input.planId,
      })
      .where(and(eq(plans.projectRoot, existing.projectRoot), eq(plans.status, 'confirmed')))
      .run();

    this.#drizzle
      .update(plans)
      .set({
        status: 'confirmed',
        confirmedBy: actor,
        confirmedAt: now,
        updatedAt: now,
        intentJson: JSON.stringify(intent),
        rationaleJson: JSON.stringify(rationale),
        changeLogJson: JSON.stringify(changeLog),
      })
      .where(and(eq(plans.planId, input.planId), eq(plans.version, input.version)))
      .run();

    const confirmed = this.get(input.planId, input.version);
    if (!confirmed) {
      throw new Error(`Confirmed plan disappeared: ${input.planId}@${input.version}`);
    }
    return confirmed;
  }

  get(planId: string, version?: number): PlanRecord | null {
    const rows = this.#drizzle
      .select()
      .from(plans)
      .where(
        version === undefined
          ? eq(plans.planId, planId)
          : and(eq(plans.planId, planId), eq(plans.version, version))
      )
      .orderBy(desc(plans.version))
      .limit(1)
      .all();
    return rows[0] ? PlanRepositoryImpl.mapRow(rows[0]) : null;
  }

  getActiveConfirmed(projectRoot: string): PlanRecord | null {
    const row = this.#drizzle
      .select()
      .from(plans)
      .where(and(eq(plans.projectRoot, projectRoot), eq(plans.status, 'confirmed')))
      .orderBy(desc(plans.updatedAt), desc(plans.version))
      .limit(1)
      .get();
    return row ? PlanRepositoryImpl.mapRow(row) : null;
  }

  listByProject(projectRoot: string, limit = 20): PlanRecord[] {
    const rows = this.#drizzle
      .select()
      .from(plans)
      .where(eq(plans.projectRoot, projectRoot))
      .orderBy(desc(plans.updatedAt), desc(plans.version))
      .limit(limit)
      .all();
    return rows.map((row) => PlanRepositoryImpl.mapRow(row));
  }

  archive(planId: string, version: number, actor = 'agent'): boolean {
    const existing = this.get(planId, version);
    if (!existing) {
      return false;
    }
    const now = Date.now();
    const changeLog = [
      ...existing.intentChangeLog,
      {
        at: now,
        actor,
        action: 'archived' as const,
        detail: 'Plan intent archived.',
      },
    ];
    const result = this.#drizzle
      .update(plans)
      .set({
        status: 'archived',
        updatedAt: now,
        changeLogJson: JSON.stringify(changeLog),
      })
      .where(and(eq(plans.planId, planId), eq(plans.version, version)))
      .run();
    return result.changes > 0;
  }

  static generatePlanId(timestamp = Date.now()): string {
    return `plan-${timestamp}-${randomBytes(4).toString('hex')}`;
  }

  static mapRow(row: PlanRow): PlanRecord {
    return {
      planId: row.planId,
      version: row.version,
      status: normalizePlanStatus(row.status),
      projectRoot: row.projectRoot,
      projectContextSignature: row.projectContextSignature,
      lastUpdatedFromCommit: row.lastUpdatedFromCommit ?? null,
      createdBy: row.createdBy,
      confirmedBy: row.confirmedBy ?? null,
      confirmedAt: row.confirmedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      supersedesPlanId: row.supersedesPlanId ?? null,
      intent: safeJsonParse(row.intentJson, emptyPlanIntent()),
      planningBrief: safeJsonParse(row.planningBriefJson, null),
      rationale: safeJsonParse(row.rationaleJson, []),
      intentChangeLog: safeJsonParse(row.changeLogJson, []),
    };
  }

  #nextVersion(planId: string): number {
    const latest = this.get(planId);
    return latest ? latest.version + 1 : 1;
  }
}

function normalizePlanStatus(value: string): PlanStatus {
  if (value === 'confirmed' || value === 'superseded' || value === 'archived') {
    return value;
  }
  return 'draft';
}

function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) {
    return fallback;
  }
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function emptyPlanIntent(): PlanIntent {
  return {
    projectProfile: {},
    dimensions: [],
    scale: {
      totalRecipeBudget: 0,
      perStage: { coldStart: 0, deepMining: 0, module: 0 },
      depthLevels: [],
    },
    moduleBindings: [],
    stages: {
      coldStart: { dimensions: [], breadthBudget: 0 },
      deepMining: { dimensions: [], depthBudget: 0, focusModules: [] },
      moduleMining: { perModule: [] },
    },
    plannedNextActions: [],
    evidenceRefs: [],
    draftSource: 'plugin-deterministic',
  };
}
