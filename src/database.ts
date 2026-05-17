import {
  DatabaseConnection,
  type SqliteDatabase,
} from './infrastructure/database/DatabaseConnection.js';
import type { DrizzleDB } from './infrastructure/database/drizzle/index.js';
import type { WorkspaceResolver } from './shared/WorkspaceResolver.js';

export { DatabaseConnection };
export type { DrizzleDB, SqliteDatabase };

export interface AlembicDatabaseConfig {
  path: string;
  verbose?: boolean;
}

export interface AlembicDatabaseHandle {
  getDb(): SqliteDatabase;
  getDrizzle(): DrizzleDB;
  runMigrations?(): Promise<void> | void;
  close?(): void;
}

export interface OpenAlembicDatabaseOptions {
  workspaceResolver?: WorkspaceResolver | null;
  runMigrations?: boolean;
}

export interface AlembicDatabaseRuntime {
  connection: DatabaseConnection;
  sqlite: SqliteDatabase;
  drizzle: DrizzleDB;
  migrated: boolean;
  close(): void;
}

export function createDatabaseConnection(
  config: AlembicDatabaseConfig,
  workspaceResolver?: WorkspaceResolver | null
): DatabaseConnection {
  return new DatabaseConnection(config, workspaceResolver);
}

export async function openAlembicDatabase(
  config: AlembicDatabaseConfig,
  options: OpenAlembicDatabaseOptions = {}
): Promise<AlembicDatabaseRuntime> {
  const connection = createDatabaseConnection(config, options.workspaceResolver ?? null);
  const sqlite = await connection.connect();
  let migrated = false;

  if (options.runMigrations !== false) {
    await connection.runMigrations();
    migrated = true;
  }

  return {
    connection,
    sqlite,
    drizzle: connection.getDrizzle(),
    migrated,
    close: () => connection.close(),
  };
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
