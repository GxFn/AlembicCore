import type {
  GitDiffCheckpointRecord,
  GitDiffCheckpointRepository,
  GitDiffCheckpointRouteStatus,
  GitDiffCheckpointScope,
} from '../../repository/evolution/GitDiffCheckpointRepository.js';
import type { PlanRepositoryImpl } from '../../repository/plan/index.js';

export type {
  GitDiffCheckpointRecord,
  GitDiffCheckpointRouteStatus,
  GitDiffCheckpointScope,
} from '../../repository/evolution/GitDiffCheckpointRepository.js';

export type GitDiffCheckpointInitializationSource =
  | 'existing-checkpoint'
  | 'active-confirmed-plan'
  | 'empty';

export interface GitDiffCheckpointServiceRepositories {
  checkpointRepository: GitDiffCheckpointRepository;
  planRepository: Pick<PlanRepositoryImpl, 'getActiveConfirmed'>;
}

export interface EnsureGitDiffCheckpointInput extends GitDiffCheckpointScope {
  now?: number;
}

export interface EnsureGitDiffCheckpointResult {
  checkpoint: GitDiffCheckpointRecord;
  source: GitDiffCheckpointInitializationSource;
}

export interface RecordGitDiffCheckpointRouteInput extends GitDiffCheckpointScope {
  targetCommit: string;
  routeStatus: GitDiffCheckpointRouteStatus;
  mergeBaseCommit?: string | null;
  routeReason?: string | null;
  scannedAt?: number;
  advancedAt?: number;
}

export interface RecordGitDiffCheckpointRouteResult {
  checkpoint: GitDiffCheckpointRecord;
  advanced: boolean;
  reason: string;
  unresolvedRange: {
    fromCommit: string | null;
    toCommit: string;
    mergeBaseCommit: string | null;
  } | null;
}

const ADVANCING_ROUTE_STATUSES = new Set<GitDiffCheckpointRouteStatus>([
  'routed',
  'catch-up-routed',
]);

export class GitDiffCheckpointService {
  readonly #checkpointRepository: GitDiffCheckpointRepository;
  readonly #planRepository: Pick<PlanRepositoryImpl, 'getActiveConfirmed'>;

  constructor(repositories: GitDiffCheckpointServiceRepositories) {
    this.#checkpointRepository = repositories.checkpointRepository;
    this.#planRepository = repositories.planRepository;
  }

  ensureCheckpoint(input: EnsureGitDiffCheckpointInput): EnsureGitDiffCheckpointResult {
    const existing = this.#checkpointRepository.get(input);
    if (existing) {
      const planCommit =
        this.#planRepository.getActiveConfirmed(input.projectRoot)?.lastUpdatedFromCommit ?? null;
      if (planCommit && isEmptyCheckpointInitialization(existing)) {
        const now = input.now ?? Date.now();
        const checkpoint = this.#checkpointRepository.upsert({
          projectRoot: input.projectRoot,
          scopeId: input.scopeId,
          folderId: input.folderId,
          checkpointCommit: planCommit,
          initialFromPlanCommit: planCommit,
          mergeBaseCommit: existing.mergeBaseCommit,
          targetCommit: existing.targetCommit,
          lastRouteStatus: existing.lastRouteStatus,
          lastRouteReason: existing.lastRouteReason,
          lastScannedAt: existing.lastScannedAt,
          advancedAt: existing.advancedAt,
          createdAt: existing.createdAt,
          updatedAt: now,
        });
        return { checkpoint, source: 'active-confirmed-plan' };
      }
      return { checkpoint: existing, source: 'existing-checkpoint' };
    }

    const planCommit =
      this.#planRepository.getActiveConfirmed(input.projectRoot)?.lastUpdatedFromCommit ?? null;
    const now = input.now ?? Date.now();
    const checkpoint = this.#checkpointRepository.upsert({
      projectRoot: input.projectRoot,
      scopeId: input.scopeId,
      folderId: input.folderId,
      checkpointCommit: planCommit,
      initialFromPlanCommit: planCommit,
      lastRouteStatus: 'initialized',
      createdAt: now,
      updatedAt: now,
    });

    return {
      checkpoint,
      source: planCommit ? 'active-confirmed-plan' : 'empty',
    };
  }

  recordRouteOutcome(input: RecordGitDiffCheckpointRouteInput): RecordGitDiffCheckpointRouteResult {
    const current = this.ensureCheckpoint(input).checkpoint;
    const scannedAt = input.scannedAt ?? Date.now();
    const advanced = ADVANCING_ROUTE_STATUSES.has(input.routeStatus);
    const nextCheckpointCommit = advanced ? input.targetCommit : current.checkpointCommit;
    const advancedAt = advanced ? (input.advancedAt ?? scannedAt) : current.advancedAt;
    const routeReason = input.routeReason ?? defaultRouteReason(input.routeStatus);

    const checkpoint = this.#checkpointRepository.upsert({
      projectRoot: input.projectRoot,
      scopeId: input.scopeId,
      folderId: input.folderId,
      checkpointCommit: nextCheckpointCommit,
      initialFromPlanCommit: current.initialFromPlanCommit,
      mergeBaseCommit: input.mergeBaseCommit ?? current.mergeBaseCommit,
      targetCommit: input.targetCommit,
      lastRouteStatus: input.routeStatus,
      lastRouteReason: routeReason,
      lastScannedAt: scannedAt,
      advancedAt,
      createdAt: current.createdAt,
      updatedAt: scannedAt,
    });

    return {
      checkpoint,
      advanced,
      reason: routeReason,
      unresolvedRange: advanced
        ? null
        : {
            fromCommit: current.checkpointCommit,
            toCommit: input.targetCommit,
            mergeBaseCommit: input.mergeBaseCommit ?? current.mergeBaseCommit,
          },
    };
  }
}

function isEmptyCheckpointInitialization(checkpoint: GitDiffCheckpointRecord): boolean {
  return checkpoint.checkpointCommit === null && checkpoint.initialFromPlanCommit === null;
}

function defaultRouteReason(status: GitDiffCheckpointRouteStatus): string {
  switch (status) {
    case 'routed':
      return 'Git diff range routed successfully.';
    case 'catch-up-routed':
      return 'Git diff catch-up range routed successfully.';
    case 'skipped':
      return 'Git diff scan skipped; checkpoint was not advanced.';
    case 'truncated':
      return 'Git diff range was truncated; checkpoint was not advanced.';
    case 'failed':
      return 'Git diff routing failed; checkpoint was not advanced.';
    case 'non-ancestor':
      return 'Git diff checkpoint is not an ancestor of target; checkpoint was not advanced.';
    case 'unresolved':
      return 'Git diff range is unresolved; checkpoint was not advanced.';
    case 'initialized':
      return 'Git diff checkpoint initialized.';
  }
}
