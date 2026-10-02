import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { SqliteDatabase } from './DatabaseConnection.js';
import type { DrizzleDB } from './drizzle/index.js';
import * as schema from './drizzle/schema.js';
import migrateSourceGraph from './migrations/010_source_graph.js';

export interface SourceIndexDatabase {
  drizzle: DrizzleDB;
  sqlite: SqliteDatabase;
  /** 库文件的绝对路径。 */
  path: string;
  close(): void;
}

/**
 * 只放源码索引的独立库。
 *
 * 宿主没有主库句柄（或不该往主库写）时，把索引放在自己私有数据目录下的一个文件里。
 * 这里只建源码索引的几张表，并且有意不走主库的那一套：
 * - 不动全局的 Drizzle 单例（`initDrizzle`）——同一进程里的主库连接不受影响；
 * - 不登记主库的迁移记录、根目录登记与吊销检查；
 * - 不做路径守卫与"排除项目"重定向——文件放哪由宿主决定，宿主对它负责。
 *
 * 并发策略与主库一致：WAL 加 busy_timeout，没有应用层重试。
 */
export function openSourceIndexDatabase(filePath: string): SourceIndexDatabase {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const sqlite = new Database(resolved);
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 3000');
    // 建表语句全部是 IF NOT EXISTS：新库建表，已有的库原样打开。
    migrateSourceGraph(sqlite);
    return {
      drizzle: drizzle(sqlite, { schema }),
      sqlite,
      path: resolved,
      close: () => {
        if (sqlite.open) {
          sqlite.close();
        }
      },
    };
  } catch (error) {
    if (sqlite.open) {
      sqlite.close();
    }
    throw error;
  }
}
