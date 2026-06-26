import type { AlembicDatabaseHandle, DrizzleDB, SqliteDatabase } from './database.js';
import {
  BootstrapRepositoryImpl,
  type BootstrapSnapshotEntity,
  type BootstrapSnapshotInsert,
  type DimensionStatMeta,
  type DimFileEntry,
  type DimFileInsert,
} from './repository/bootstrap/BootstrapRepository.js';
import {
  type CodeEntity,
  type CodeEntityInsert,
  CodeEntityRepositoryImpl,
} from './repository/code/CodeEntityRepository.js';
import {
  type CoverageGrade,
  type CoverageLedgerRecord,
  CoverageLedgerRepository,
  type CoverageLedgerScope,
  type DeepMiningRoundRecord,
  type UpsertCoverageLedgerInput,
  type UpsertDeepMiningRoundInput,
} from './repository/evolution/CoverageLedgerRepository.js';
import {
  type GitDiffCheckpointRecord,
  GitDiffCheckpointRepository,
  type GitDiffCheckpointRouteStatus,
  type GitDiffCheckpointScope,
  type UpsertGitDiffCheckpointInput,
} from './repository/evolution/GitDiffCheckpointRepository.js';
import {
  LifecycleEventRepository,
  type RecordEventInput,
  type TransitionEventRow,
} from './repository/evolution/LifecycleEventRepository.js';
import {
  type CreateProposalInput,
  getProposalSourceLabel,
  type LegacyProposalType,
  normalizeProposalSource,
  type ProposalFilter,
  type ProposalRecord,
  ProposalRepository,
  type ProposalSource,
  type ProposalStatus,
  type ProposalType,
  proposalSourceStorageValues,
} from './repository/evolution/ProposalRepository.js';
import {
  type CreateWarningInput,
  type WarningFilter,
  type WarningRecord,
  WarningRepository,
  type WarningStatus,
  type WarningType,
} from './repository/evolution/WarningRepository.js';
import {
  type GuardViolationEntity,
  type GuardViolationInsert,
  GuardViolationRepositoryImpl,
  type PaginatedViolations,
  type ViolationRecord,
  type ViolationStatByRule,
  type ViolationStats,
} from './repository/guard/GuardViolationRepository.js';
import {
  type EdgeInsert,
  type EdgeStats,
  type KnowledgeEdge,
  KnowledgeEdgeRepositoryImpl,
} from './repository/knowledge/KnowledgeEdgeRepository.js';
import { KnowledgeRepositoryImpl } from './repository/knowledge/KnowledgeRepositoryImpl.js';
import {
  MemoryRepositoryImpl,
  type MemoryStats,
  type SemanticMemoryEntity,
  type SemanticMemoryInsert,
  type SemanticMemorySimilarityResult,
  type SemanticMemoryUpdate,
} from './repository/memory/MemoryRepository.js';
import {
  type SessionEntity,
  type SessionInsert,
  SessionRepositoryImpl,
} from './repository/session/SessionRepository.js';
import {
  type SourceGraphClearResult,
  type SourceGraphEdgeDirection,
  type SourceGraphEdgeInsert,
  type SourceGraphEdgeQueryOptions,
  type SourceGraphReplaceInput,
  SourceGraphRepositoryImpl,
  type SourceGraphStats,
  type SourceGraphSymbolInsert,
  type SourceGraphSymbolSearchOptions,
} from './repository/source-graph/SourceGraphRepository.js';
import {
  type RecipeSourceRefEntity,
  type RecipeSourceRefInsert,
  RecipeSourceRefRepositoryImpl,
} from './repository/sourceref/RecipeSourceRefRepository.js';
import { RawDbSyncAdapter, type SyncRepo } from './repository/sync/SyncRepoAdapter.js';
import { TokenUsageStore } from './repository/token/TokenUsageStore.js';

export type {
  BootstrapSnapshotEntity,
  BootstrapSnapshotInsert,
  CodeEntity,
  CodeEntityInsert,
  CoverageGrade,
  CoverageLedgerRecord,
  CoverageLedgerScope,
  CreateProposalInput,
  CreateWarningInput,
  DeepMiningRoundRecord,
  DimFileEntry,
  DimFileInsert,
  DimensionStatMeta,
  EdgeInsert,
  EdgeStats,
  GitDiffCheckpointRecord,
  GitDiffCheckpointRouteStatus,
  GitDiffCheckpointScope,
  GuardViolationEntity,
  GuardViolationInsert,
  KnowledgeEdge,
  LegacyProposalType,
  MemoryStats,
  PaginatedViolations,
  ProposalFilter,
  ProposalRecord,
  ProposalSource,
  ProposalStatus,
  ProposalType,
  RecipeSourceRefEntity,
  RecipeSourceRefInsert,
  RecordEventInput,
  SemanticMemoryEntity,
  SemanticMemoryInsert,
  SemanticMemorySimilarityResult,
  SemanticMemoryUpdate,
  SessionEntity,
  SessionInsert,
  SourceGraphClearResult,
  SourceGraphEdgeDirection,
  SourceGraphEdgeInsert,
  SourceGraphEdgeQueryOptions,
  SourceGraphReplaceInput,
  SourceGraphStats,
  SourceGraphSymbolInsert,
  SourceGraphSymbolSearchOptions,
  SyncRepo,
  TransitionEventRow,
  UpsertCoverageLedgerInput,
  UpsertDeepMiningRoundInput,
  UpsertGitDiffCheckpointInput,
  ViolationRecord,
  ViolationStatByRule,
  ViolationStats,
  WarningFilter,
  WarningRecord,
  WarningStatus,
  WarningType,
};

export type KnowledgeRepository = KnowledgeRepositoryImpl;
export type KnowledgeEdgeRepository = KnowledgeEdgeRepositoryImpl;
export type CodeEntityRepository = CodeEntityRepositoryImpl;
export type BootstrapRepository = BootstrapRepositoryImpl;
export type GuardViolationRepository = GuardViolationRepositoryImpl;
export type MemoryRepository = MemoryRepositoryImpl;
export type SessionRepository = SessionRepositoryImpl;
export type SourceGraphRepository = SourceGraphRepositoryImpl;
export type SourceRefRepository = RecipeSourceRefRepositoryImpl;
export type EvolutionProposalRepository = ProposalRepository;
export type EvolutionWarningRepository = WarningRepository;
export type EvolutionLifecycleEventRepository = LifecycleEventRepository;
export type EvolutionGitDiffCheckpointRepository = GitDiffCheckpointRepository;
export type EvolutionCoverageLedgerRepository = CoverageLedgerRepository;

export {
  BootstrapRepositoryImpl,
  CodeEntityRepositoryImpl,
  CoverageLedgerRepository,
  GuardViolationRepositoryImpl,
  GitDiffCheckpointRepository,
  KnowledgeEdgeRepositoryImpl,
  KnowledgeRepositoryImpl,
  LifecycleEventRepository,
  MemoryRepositoryImpl,
  ProposalRepository,
  RawDbSyncAdapter,
  RecipeSourceRefRepositoryImpl,
  SessionRepositoryImpl,
  SourceGraphRepositoryImpl,
  TokenUsageStore,
  WarningRepository,
  getProposalSourceLabel,
  normalizeProposalSource,
  proposalSourceStorageValues,
};

export interface AlembicRepositoryDatabase extends AlembicDatabaseHandle {
  getDb(): SqliteDatabase;
  getDrizzle(): DrizzleDB;
}

export interface AlembicRepositoryBundle {
  knowledgeRepository: KnowledgeRepository;
  knowledgeEdgeRepository: KnowledgeEdgeRepository;
  codeEntityRepository: CodeEntityRepository;
  bootstrapRepository: BootstrapRepository;
  guardViolationRepository: GuardViolationRepository;
  memoryRepository: MemoryRepository;
  sessionRepository: SessionRepository;
  sourceGraphRepository: SourceGraphRepository;
  proposalRepository: EvolutionProposalRepository;
  warningRepository: EvolutionWarningRepository;
  lifecycleEventRepository: EvolutionLifecycleEventRepository;
  gitDiffCheckpointRepository: EvolutionGitDiffCheckpointRepository;
  coverageLedgerRepository: EvolutionCoverageLedgerRepository;
  recipeSourceRefRepository: SourceRefRepository;
}

export const ALEMBIC_REPOSITORY_KEYS = [
  'knowledgeRepository',
  'knowledgeEdgeRepository',
  'codeEntityRepository',
  'bootstrapRepository',
  'guardViolationRepository',
  'memoryRepository',
  'sessionRepository',
  'sourceGraphRepository',
  'proposalRepository',
  'warningRepository',
  'lifecycleEventRepository',
  'gitDiffCheckpointRepository',
  'coverageLedgerRepository',
  'recipeSourceRefRepository',
] as const;

export type AlembicRepositoryKey = (typeof ALEMBIC_REPOSITORY_KEYS)[number];

export function createAlembicRepositories(
  database: AlembicRepositoryDatabase
): AlembicRepositoryBundle {
  const { drizzle } = resolveRepositoryDatabase(database);

  return {
    knowledgeRepository: new KnowledgeRepositoryImpl(database, drizzle),
    knowledgeEdgeRepository: new KnowledgeEdgeRepositoryImpl(drizzle),
    codeEntityRepository: new CodeEntityRepositoryImpl(drizzle),
    bootstrapRepository: new BootstrapRepositoryImpl(drizzle),
    guardViolationRepository: new GuardViolationRepositoryImpl(drizzle),
    memoryRepository: new MemoryRepositoryImpl(drizzle),
    sessionRepository: new SessionRepositoryImpl(drizzle),
    sourceGraphRepository: new SourceGraphRepositoryImpl(drizzle),
    proposalRepository: new ProposalRepository(drizzle),
    warningRepository: new WarningRepository(drizzle),
    lifecycleEventRepository: new LifecycleEventRepository(drizzle),
    gitDiffCheckpointRepository: new GitDiffCheckpointRepository(drizzle),
    coverageLedgerRepository: new CoverageLedgerRepository(drizzle),
    recipeSourceRefRepository: new RecipeSourceRefRepositoryImpl(drizzle),
  };
}

export function isAlembicRepositoryKey(value: string): value is AlembicRepositoryKey {
  return (ALEMBIC_REPOSITORY_KEYS as readonly string[]).includes(value);
}

function resolveRepositoryDatabase(database: AlembicRepositoryDatabase): {
  sqlite: SqliteDatabase;
  drizzle: DrizzleDB;
} {
  if (
    !database ||
    typeof database.getDb !== 'function' ||
    typeof database.getDrizzle !== 'function'
  ) {
    throw new Error('Repository factory requires a connected Alembic database handle.');
  }

  try {
    return {
      sqlite: database.getDb(),
      drizzle: database.getDrizzle(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Repository factory requires a connected Alembic database: ${message}`);
  }
}
