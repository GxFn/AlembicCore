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

export type PlanRepositoryDataErrorCode = 'plan-row-invalid-json' | 'plan-row-unknown-status';

export class PlanRepositoryDataError extends Error {
  readonly code: PlanRepositoryDataErrorCode;
  readonly field: string;
  readonly planId: string;
  readonly version: number;

  constructor(input: {
    code: PlanRepositoryDataErrorCode;
    field: string;
    message: string;
    planId: string;
    version: number;
  }) {
    super(input.message);
    this.name = 'PlanRepositoryDataError';
    this.code = input.code;
    this.field = input.field;
    this.planId = input.planId;
    this.version = input.version;
  }
}

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
        detail: 'Plan draft facts placeholder persisted.',
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
        intentJson: JSON.stringify(emptyPlanIntent()),
        planningBriefJson: null,
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
    const intent = normalizeConfirmedPlanIntent(input.intent);
    const rationale = input.rationale ?? existing.rationale;
    if (rationale.length === 0) {
      throw new Error('Cannot confirm incomplete Plan intent: rationale is required');
    }
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
        planningBriefJson: null,
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
    const records: PlanRecord[] = [];
    for (const row of rows) {
      records.push(PlanRepositoryImpl.mapRow(row));
    }
    return records;
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
      status: normalizePlanStatus(row.status, row),
      projectRoot: row.projectRoot,
      projectContextSignature: row.projectContextSignature,
      lastUpdatedFromCommit: row.lastUpdatedFromCommit ?? null,
      createdBy: row.createdBy,
      confirmedBy: row.confirmedBy ?? null,
      confirmedAt: row.confirmedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      supersedesPlanId: row.supersedesPlanId ?? null,
      intent: parsePlanJson(row, 'intent_json', row.intentJson, emptyPlanIntent()),
      planningBrief: parsePlanJson(row, 'planning_brief_json', row.planningBriefJson, null),
      rationale: parsePlanJson(row, 'rationale_json', row.rationaleJson, []),
      intentChangeLog: parsePlanJson(row, 'change_log_json', row.changeLogJson, []),
    };
  }

  #nextVersion(planId: string): number {
    const latest = this.get(planId);
    return latest ? latest.version + 1 : 1;
  }
}

function normalizePlanStatus(value: string, row: PlanRow): PlanStatus {
  if (
    value === 'draft' ||
    value === 'confirmed' ||
    value === 'superseded' ||
    value === 'archived'
  ) {
    return value;
  }
  throw new PlanRepositoryDataError({
    code: 'plan-row-unknown-status',
    field: 'status',
    message: `Plan row has unknown status: ${row.planId}@${row.version} status=${value}`,
    planId: row.planId,
    version: row.version,
  });
}

function parsePlanJson<T>(
  row: PlanRow,
  field: string,
  json: string | null | undefined,
  fallback: T
): T {
  if (!json) {
    return fallback;
  }
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PlanRepositoryDataError({
      code: 'plan-row-invalid-json',
      field,
      message: `Plan row has invalid JSON: ${row.planId}@${row.version} ${field}: ${detail}`,
      planId: row.planId,
      version: row.version,
    });
  }
}

function normalizeConfirmedPlanIntent(intent: PlanIntent): PlanIntent {
  validateCompletePlanIntent(intent);
  return {
    ...intent,
    dimensions: [...intent.dimensions],
    moduleBindings: [...intent.moduleBindings],
    plannedNextActions: [...intent.plannedNextActions],
    evidenceRefs: [...intent.evidenceRefs],
    draftSource: 'host-agent',
    stages: {
      coldStart: { ...intent.stages.coldStart },
      deepMining: { ...intent.stages.deepMining },
      moduleMining: { perModule: [...intent.stages.moduleMining.perModule] },
    },
  };
}

function validateCompletePlanIntent(intent: PlanIntent): void {
  const issues: string[] = [];
  const dimensionIds = new Set(intent.dimensions.map((dimension) => dimension.dimensionId));
  if (intent.dimensions.length === 0) {
    issues.push('dimensions are required');
  }
  for (const dimension of intent.dimensions) {
    if (!dimension.dimensionId) {
      issues.push('dimension.dimensionId is required');
    }
    if (!dimension.rationale) {
      issues.push(`dimension ${dimension.dimensionId || '<unknown>'} rationale is required`);
    }
    if (dimension.targetRecipes <= 0) {
      issues.push(`dimension ${dimension.dimensionId || '<unknown>'} targetRecipes must be > 0`);
    }
  }
  if (intent.scale.totalRecipeBudget <= 0) {
    issues.push('scale.totalRecipeBudget must be > 0');
  }
  if (!hasPositiveStageBudget(intent.scale.perStage)) {
    issues.push('scale.perStage must include at least one positive budget');
  }
  if (intent.scale.depthLevels.length === 0) {
    issues.push('scale.depthLevels are required');
  }
  if (intent.moduleBindings.length === 0) {
    issues.push('moduleBindings are required');
  }
  for (const binding of intent.moduleBindings) {
    if (!binding.modulePath) {
      issues.push('moduleBinding.modulePath is required');
    }
    if (binding.dimensions.length === 0) {
      issues.push(`moduleBinding ${binding.modulePath || '<unknown>'} dimensions are required`);
    }
    if (binding.targetRecipes <= 0) {
      issues.push(`moduleBinding ${binding.modulePath || '<unknown>'} targetRecipes must be > 0`);
    }
    for (const dimensionId of binding.dimensions) {
      if (!dimensionIds.has(dimensionId)) {
        issues.push(
          `moduleBinding ${binding.modulePath} references unknown dimension ${dimensionId}`
        );
      }
    }
  }
  const stageDimensionIds = [
    ...intent.stages.coldStart.dimensions,
    ...intent.stages.deepMining.dimensions,
  ];
  if (stageDimensionIds.length === 0) {
    issues.push('stages must include coldStart or deepMining dimensions');
  }
  for (const dimensionId of stageDimensionIds) {
    if (!dimensionIds.has(dimensionId)) {
      issues.push(`stage references unknown dimension ${dimensionId}`);
    }
  }
  if (intent.plannedNextActions.length === 0) {
    issues.push('plannedNextActions are required');
  }
  if (intent.evidenceRefs.length === 0) {
    issues.push('evidenceRefs are required');
  }
  if (issues.length > 0) {
    throw new Error(`Cannot confirm incomplete Plan intent: ${unique(issues).join('; ')}`);
  }
}

function hasPositiveStageBudget(perStage: {
  coldStart: number;
  deepMining: number;
  module: number;
}): boolean {
  return perStage.coldStart > 0 || perStage.deepMining > 0 || perStage.module > 0;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function emptyPlanIntent(
  draftSource: PlanIntent['draftSource'] = 'plugin-collected-facts'
): PlanIntent {
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
    draftSource,
  };
}
