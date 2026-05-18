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
import { KnowledgeRepositoryImpl } from './repository/knowledge/KnowledgeRepository.impl.js';
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
  type RecipeSourceRefEntity,
  type RecipeSourceRefInsert,
  RecipeSourceRefRepositoryImpl,
} from './repository/sourceref/RecipeSourceRefRepository.js';

export type {
  BootstrapSnapshotEntity,
  BootstrapSnapshotInsert,
  CodeEntity,
  CodeEntityInsert,
  CreateProposalInput,
  CreateWarningInput,
  DimFileEntry,
  DimFileInsert,
  DimensionStatMeta,
  EdgeInsert,
  EdgeStats,
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
  TransitionEventRow,
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
export type SourceRefRepository = RecipeSourceRefRepositoryImpl;
export type EvolutionProposalRepository = ProposalRepository;
export type EvolutionWarningRepository = WarningRepository;
export type EvolutionLifecycleEventRepository = LifecycleEventRepository;

export { getProposalSourceLabel, normalizeProposalSource, proposalSourceStorageValues };

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
  proposalRepository: EvolutionProposalRepository;
  warningRepository: EvolutionWarningRepository;
  lifecycleEventRepository: EvolutionLifecycleEventRepository;
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
  'proposalRepository',
  'warningRepository',
  'lifecycleEventRepository',
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
    proposalRepository: new ProposalRepository(drizzle),
    warningRepository: new WarningRepository(drizzle),
    lifecycleEventRepository: new LifecycleEventRepository(drizzle),
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
