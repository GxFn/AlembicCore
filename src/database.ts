import {
  type AlembicMigrationArtifactV1,
  DatabaseConnection,
  readAlembicMigrationBundleManifest,
  type SqliteDatabase,
} from './infrastructure/database/DatabaseConnection.js';
import type { DrizzleDB } from './infrastructure/database/drizzle/index.js';

export {
  type AlembicDatabaseConfig,
  type AlembicDatabaseRuntime,
  createDatabaseConnection,
  type OpenAlembicDatabaseOptions,
  openAlembicDatabase,
} from './infrastructure/database/openAlembicDatabase.js';

export { DatabaseConnection, readAlembicMigrationBundleManifest };
export type { AlembicMigrationArtifactV1, DrizzleDB, SqliteDatabase };

export interface AlembicDatabaseHandle {
  getDb(): SqliteDatabase;
  getDrizzle(): DrizzleDB;
  runMigrations?(): Promise<void> | void;
  close?(): void;
}

export function assertAlembicDatabaseHandle(
  database: unknown
): asserts database is AlembicDatabaseHandle {
  if (!database || typeof database !== 'object') {
    throw new Error('Alembic database handle is required.');
  }

  const candidate = database as Partial<Record<keyof AlembicDatabaseHandle, unknown>>;
  if (typeof candidate.getDb !== 'function' || typeof candidate.getDrizzle !== 'function') {
    throw new Error('Alembic database handle must expose getDb() and getDrizzle().');
  }
}
