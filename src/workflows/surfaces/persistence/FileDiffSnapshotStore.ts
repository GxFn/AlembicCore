/**
 * FileDiffSnapshotStore — workflow 文件快照的写入
 *
 * 负责:
 * 1. 保存每次 workflow 完成后的文件指纹 (path → hash)
 * 2. 记录每个维度引用了哪些文件
 * 3. 持久化 EpisodicMemory 摘要
 *
 * 只有写入一侧。按快照算增量 diff、推断受影响维度的读取一侧原先也在这里，但从未有调用方：
 * 主体的增量计划读的是 ProjectContext 文件快照那张表，自己算 diff。那一侧已删除；
 * 需要读这两张表的地方用 repository/bootstrap 的 GenerateRepository。
 *
 * 存储: SQLite bootstrap_snapshots + bootstrap_dim_files 表（runtime schema 兼容名）
 * 所有操作使用 Drizzle 类型安全 API。
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { sql } from 'drizzle-orm';
import { type DrizzleDB, getDrizzle } from '../../../infrastructure/database/drizzle/index.js';
import {
  generateDimFiles,
  generateSnapshots,
} from '../../../infrastructure/database/drizzle/schema.js';
import { computeContentHash } from '../../../shared/contentHash.js';
import type { LoggerLike } from '../../../types/workflows.js';

// ──────────────────────────────────────────────────────────────────
// 本地类型定义
// ──────────────────────────────────────────────────────────────────

/** db 可能包含 getDrizzle/getDb 方法的包装 */
interface DbWrapper {
  getDrizzle?: () => DrizzleDB;
  getDb?: () => unknown;
}

/** 文件条目 */
interface SnapshotFile {
  path: string;
  relativePath?: string;
  content?: string;
  targetName?: string;
}

/** save() 参数 */
interface SaveParams {
  sessionId?: string;
  projectRoot: string;
  allFiles: SnapshotFile[];
  dimensionStats?: Record<string, DimensionStatInput>;
  episodicData?: unknown;
  meta?: {
    durationMs?: number;
    candidateCount?: number;
    primaryLang?: string;
    [key: string]: unknown;
  };
  isIncremental?: boolean;
  parentId?: unknown;
  changedFiles?: string[];
  affectedDims?: string[];
}

/** 维度统计输入 */
interface DimensionStatInput {
  candidateCount?: number;
  analysisChars?: number;
  referencedFiles?: number;
  durationMs?: number;
  referencedFilesList?: string[];
  [key: string]: unknown;
}

/** 维度元数据（序列化后） */
interface DimensionStatMeta {
  candidateCount: number;
  analysisChars: number;
  referencedFiles: number;
  durationMs: number;
}

export function normalizeSnapshotPath(
  file: { path?: string; relativePath?: string },
  projectRoot: string
): string {
  const rawPath = typeof file.path === 'string' ? file.path : '';
  if (rawPath) {
    const fromPath = isAbsolute(rawPath) ? relative(projectRoot, rawPath) : rawPath;
    if (fromPath && !fromPath.startsWith('..')) {
      return toPosixPath(fromPath);
    }
  }
  return toPosixPath(file.relativePath || rawPath);
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

// ──────────────────────────────────────────────────────────────
// 常量
// ──────────────────────────────────────────────────────────────

/** 快照保留数量 (最多保留 N 个历史快照) */
const MAX_SNAPSHOTS = 5;

// ──────────────────────────────────────────────────────────────
// FileDiffSnapshotStore 类
// ──────────────────────────────────────────────────────────────

export class FileDiffSnapshotStore {
  #drizzle: DrizzleDB;

  #logger: LoggerLike | null;

  /** @param db DatabaseConnection 或 better-sqlite3 实例 */
  constructor(db: unknown, { logger }: { logger?: LoggerLike | null } = {}) {
    if (!db) {
      throw new Error('FileDiffSnapshotStore requires a database instance');
    }
    const wrappedDrizzle = (db as DbWrapper).getDrizzle;
    this.#drizzle = typeof wrappedDrizzle === 'function' ? wrappedDrizzle.call(db) : getDrizzle();
    this.#logger = logger || null;
  }

  // ─── 快照保存 ─────────────────────────────────────────

  /**
   * 保存一次 workflow 完成后的快照
   *
   * @param params.sessionId Workflow 会话 ID
   * @param params.projectRoot 项目根目录
   * @param params.allFiles 扫描到的文件列表
   * @param params.dimensionStats { dimId: { referencedFiles: string[] } }
   * @param [params.episodicData] EpisodicMemory.toJSON()
   * @param [params.meta] { durationMs, candidateCount, primaryLang }
   * @param [params.isIncremental] 是否 file-diff incremental
   * @param [params.parentId] 增量时的父快照 ID
   * @param [params.changedFiles] 增量时的变更文件
   * @param [params.affectedDims] 增量时受影响的维度
   * @returns 快照 ID
   */
  save(params: SaveParams): string {
    const {
      sessionId,
      projectRoot,
      allFiles,
      dimensionStats,
      episodicData,
      meta = {},
      isIncremental = false,
      parentId = null,
      changedFiles = [],
      affectedDims = [],
    } = params;

    const id = `snap_${randomUUID().replace(/-/g, '').substring(0, 12)}`;
    const now = new Date().toISOString();

    // 计算文件指纹
    const fileHashes: Record<string, string> = {};
    for (const f of allFiles) {
      const rel = normalizeSnapshotPath(f, projectRoot);
      // 显式空内容也是扫描事实；仅缺失 content 时回读磁盘。
      fileHashes[rel] = this.#computeContentHash(f.content ?? this.#readFileContent(f.path));
    }

    // 构建维度-文件映射
    const dimensionMeta: Record<string, DimensionStatMeta> = {};
    for (const [dimId, stat] of Object.entries(dimensionStats || {}) as [
      string,
      DimensionStatInput,
    ][]) {
      dimensionMeta[dimId] = {
        candidateCount: stat.candidateCount || 0,
        analysisChars: stat.analysisChars || 0,
        referencedFiles: stat.referencedFiles || 0,
        durationMs: stat.durationMs || 0,
      };
    }

    // 事务保存（Drizzle 类型安全）
    this.#drizzle.transaction((tx) => {
      // 主记录
      tx.insert(generateSnapshots)
        .values({
          id,
          sessionId: sessionId || null,
          projectRoot,
          createdAt: now,
          durationMs: meta.durationMs || 0,
          fileCount: allFiles.length,
          dimensionCount: Object.keys(dimensionStats || {}).length,
          candidateCount: meta.candidateCount || 0,
          primaryLang: meta.primaryLang || null,
          fileHashes: JSON.stringify(fileHashes),
          dimensionMeta: JSON.stringify(dimensionMeta),
          episodicData: episodicData ? JSON.stringify(episodicData) : null,
          isIncremental: isIncremental ? 1 : 0,
          parentId: parentId as string | null,
          changedFiles: JSON.stringify(changedFiles),
          affectedDims: JSON.stringify(affectedDims),
          status: 'complete',
        })
        .run();

      // 维度-文件关联
      for (const [dimId, stat] of Object.entries(dimensionStats || {}) as [
        string,
        DimensionStatInput,
      ][]) {
        const refFiles = stat.referencedFilesList || [];
        for (const filePath of refFiles) {
          const rel =
            typeof filePath === 'string'
              ? filePath.startsWith('/')
                ? relative(projectRoot, filePath)
                : filePath
              : filePath;
          tx.insert(generateDimFiles)
            .values({
              snapshotId: id,
              dimId,
              filePath: rel,
              role: 'referenced',
            })
            .onConflictDoNothing()
            .run();
        }
      }

      // 容量控制: 保留最新 N 个
      this.#enforceCapacity(projectRoot, tx);
    });

    this.#log(
      `Snapshot saved: ${id} (${allFiles.length} files, ${Object.keys(dimensionStats || {}).length} dims)`
    );
    return id;
  }

  // ─── 内部方法 ─────────────────────────────────────────

  #computeContentHash(content: string): string {
    return computeContentHash(content);
  }

  #readFileContent(filePath: string): string {
    try {
      return readFileSync(filePath, 'utf-8');
    } catch {
      return '';
    }
  }

  #enforceCapacity(projectRoot: string, db: DrizzleDB = this.#drizzle) {
    try {
      db.delete(generateSnapshots)
        .where(
          sql`${generateSnapshots.projectRoot} = ${projectRoot}
          AND ${generateSnapshots.id} NOT IN (
            SELECT ${generateSnapshots.id} FROM ${generateSnapshots}
            WHERE ${generateSnapshots.projectRoot} = ${projectRoot}
            ORDER BY ${generateSnapshots.createdAt} DESC
            LIMIT ${MAX_SNAPSHOTS}
          )`
        )
        .run();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.#log(`Capacity enforcement failed: ${msg}`, 'warn');
    }
  }

  #log(msg: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info') {
    this.#logger?.[level]?.(`[FileDiffSnapshotStore] ${msg}`);
  }
}

export default FileDiffSnapshotStore;
