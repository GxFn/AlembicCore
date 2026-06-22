import { and, eq } from 'drizzle-orm';
import type { DrizzleDB } from '../../infrastructure/database/drizzle/index.js';
import { gitDiffCheckpoints } from '../../infrastructure/database/drizzle/schema.js';

export type GitDiffCheckpointRouteStatus =
  | 'initialized'
  | 'routed'
  | 'catch-up-routed'
  | 'skipped'
  | 'truncated'
  | 'failed'
  | 'non-ancestor'
  | 'unresolved';

export interface GitDiffCheckpointScope {
  projectRoot: string;
  scopeId: string;
  folderId: string;
}

export interface GitDiffCheckpointRecord extends GitDiffCheckpointScope {
  checkpointCommit: string | null;
  initialFromPlanCommit: string | null;
  mergeBaseCommit: string | null;
  targetCommit: string | null;
  lastRouteStatus: GitDiffCheckpointRouteStatus;
  lastRouteReason: string | null;
  lastScannedAt: number | null;
  advancedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertGitDiffCheckpointInput extends GitDiffCheckpointScope {
  checkpointCommit?: string | null;
  initialFromPlanCommit?: string | null;
  mergeBaseCommit?: string | null;
  targetCommit?: string | null;
  lastRouteStatus?: GitDiffCheckpointRouteStatus;
  lastRouteReason?: string | null;
  lastScannedAt?: number | null;
  advancedAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
}

type GitDiffCheckpointRow = typeof gitDiffCheckpoints.$inferSelect;

const GIT_DIFF_CHECKPOINT_ROUTE_STATUSES = new Set<GitDiffCheckpointRouteStatus>([
  'initialized',
  'routed',
  'catch-up-routed',
  'skipped',
  'truncated',
  'failed',
  'non-ancestor',
  'unresolved',
]);

export class GitDiffCheckpointRepository {
  readonly #drizzle: DrizzleDB;

  constructor(drizzle: DrizzleDB) {
    this.#drizzle = drizzle;
  }

  get(scope: GitDiffCheckpointScope): GitDiffCheckpointRecord | null {
    const row = this.#drizzle
      .select()
      .from(gitDiffCheckpoints)
      .where(GitDiffCheckpointRepository.#scopeWhere(scope))
      .limit(1)
      .get();
    return row ? GitDiffCheckpointRepository.#mapRow(row) : null;
  }

  listByProjectRoot(projectRoot: string): GitDiffCheckpointRecord[] {
    const rows = this.#drizzle
      .select()
      .from(gitDiffCheckpoints)
      .where(eq(gitDiffCheckpoints.projectRoot, projectRoot))
      .all();
    return rows.map((row) => GitDiffCheckpointRepository.#mapRow(row));
  }

  upsert(input: UpsertGitDiffCheckpointInput): GitDiffCheckpointRecord {
    const existing = this.get(input);
    const now = input.updatedAt ?? Date.now();
    const createdAt = input.createdAt ?? existing?.createdAt ?? now;

    this.#drizzle
      .insert(gitDiffCheckpoints)
      .values({
        projectRoot: input.projectRoot,
        scopeId: input.scopeId,
        folderId: input.folderId,
        checkpointCommit: input.checkpointCommit ?? null,
        initialFromPlanCommit: input.initialFromPlanCommit ?? null,
        mergeBaseCommit: input.mergeBaseCommit ?? null,
        targetCommit: input.targetCommit ?? null,
        lastRouteStatus: input.lastRouteStatus ?? 'initialized',
        lastRouteReason: input.lastRouteReason ?? null,
        lastScannedAt: input.lastScannedAt ?? null,
        advancedAt: input.advancedAt ?? null,
        createdAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          gitDiffCheckpoints.projectRoot,
          gitDiffCheckpoints.scopeId,
          gitDiffCheckpoints.folderId,
        ],
        set: {
          checkpointCommit: input.checkpointCommit ?? null,
          initialFromPlanCommit: input.initialFromPlanCommit ?? null,
          mergeBaseCommit: input.mergeBaseCommit ?? null,
          targetCommit: input.targetCommit ?? null,
          lastRouteStatus: input.lastRouteStatus ?? 'initialized',
          lastRouteReason: input.lastRouteReason ?? null,
          lastScannedAt: input.lastScannedAt ?? null,
          advancedAt: input.advancedAt ?? null,
          updatedAt: now,
        },
      })
      .run();

    const saved = this.get(input);
    if (!saved) {
      throw new Error(
        `Git diff checkpoint was not persisted: ${input.projectRoot}/${input.scopeId}/${input.folderId}`
      );
    }
    return saved;
  }

  delete(scope: GitDiffCheckpointScope): boolean {
    const result = this.#drizzle
      .delete(gitDiffCheckpoints)
      .where(GitDiffCheckpointRepository.#scopeWhere(scope))
      .run();
    return result.changes > 0;
  }

  static #scopeWhere(scope: GitDiffCheckpointScope) {
    return and(
      eq(gitDiffCheckpoints.projectRoot, scope.projectRoot),
      eq(gitDiffCheckpoints.scopeId, scope.scopeId),
      eq(gitDiffCheckpoints.folderId, scope.folderId)
    );
  }

  static #mapRow(row: GitDiffCheckpointRow): GitDiffCheckpointRecord {
    return {
      projectRoot: row.projectRoot,
      scopeId: row.scopeId,
      folderId: row.folderId,
      checkpointCommit: row.checkpointCommit ?? null,
      initialFromPlanCommit: row.initialFromPlanCommit ?? null,
      mergeBaseCommit: row.mergeBaseCommit ?? null,
      targetCommit: row.targetCommit ?? null,
      lastRouteStatus: normalizeRouteStatus(row.lastRouteStatus),
      lastRouteReason: row.lastRouteReason ?? null,
      lastScannedAt: row.lastScannedAt ?? null,
      advancedAt: row.advancedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

function normalizeRouteStatus(value: string): GitDiffCheckpointRouteStatus {
  if (GIT_DIFF_CHECKPOINT_ROUTE_STATUSES.has(value as GitDiffCheckpointRouteStatus)) {
    return value as GitDiffCheckpointRouteStatus;
  }
  return 'initialized';
}
