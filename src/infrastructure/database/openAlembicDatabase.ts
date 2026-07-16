import type { WorkspaceResolver } from '../../shared/WorkspaceResolver.js';
import { DatabaseConnection, type SqliteDatabase } from './DatabaseConnection.js';
import type { DrizzleDB } from './drizzle/index.js';

export interface AlembicDatabaseConfig {
  path: string;
  verbose?: boolean;
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

  try {
    if (options.runMigrations !== false) {
      await connection.runMigrations();
      migrated = true;
    }
  } catch (error) {
    connection.close();
    throw error;
  }

  return {
    connection,
    sqlite,
    drizzle: connection.getDrizzle(),
    migrated,
    close: () => connection.close(),
  };
}
