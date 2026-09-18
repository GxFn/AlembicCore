/**
 * KnowledgeUnitOfWork — 文件真相优先的知识写入协调器
 *
 * 策略: "文件优先 + DB 补偿"
 *
 *   1. 收集所有 DB 变更意图（不执行）
 *   2. 依次执行文件操作（writeFileSync 同步写入）
 *   3. 若任何文件操作失败 → 保留已完成的写入/移动，尽力重建已删文件，中止 DB 提交
 *   4. 全部文件操作成功 → 开启 SQLite 事务，提交所有 DB 变更
 *   5. 若 DB 事务失败 → 文件保留（真相源），抛出 DivergenceError 并发出
 *      file/DB 分歧诊断（CO3 W2 write-strict：不再静默等待 SyncService）
 *
 * 为何 "文件优先" 而非 "DB 优先"？
 *   - .md 文件 = 唯一真相源（第一原则）
 *   - 文件写成功 + DB 失败 → SyncService 可从文件重建 DB ✅
 *   - DB 写成功 + 文件写失败 → DB 有记录但无对应文件
 *     → SyncService 会标记 deprecated → 数据丢失 ❌
 *   - 文件优先确保：无论哪步失败，.md 文件的存在性始终是判定真相的依据
 *
 * 本类只协调显式注册的批次，不保证文件批次原子回滚：fileStore 没有旧字节快照，
 * 无法安全区分新建与覆盖写。后续失败时删除已写文件可能直接删掉已有知识真相。
 * 部分文件成功必须以 FileWriteError + 明细诊断暴露，并由 SyncService 对齐 DB。
 */

import type { KnowledgeEntry } from '../../domain/knowledge/KnowledgeEntry.js';
import { isSqliteBusyError } from '../../infrastructure/database/DatabaseConnection.js';
import type { DrizzleDB } from '../../infrastructure/database/drizzle/index.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { CORE_DIAGNOSTIC_CODES } from '../../shared/DiagnosticCodes.js';
import { DivergenceError } from '../../shared/errors/index.js';
import type { DrizzleTx } from '../base/RepositoryBase.js';
import type { KnowledgeFileStore } from './KnowledgeFileStore.js';

/* ═══ 类型定义 ═══ */

export interface PendingFileOp {
  type: 'write' | 'move' | 'delete';
  entry: KnowledgeEntry;
  /** move 操作的旧路径（用于回滚时恢复） */
  oldPath?: string;
}

export interface UnitOfWorkResult {
  /** DB 事务是否成功提交 */
  dbCommitted: boolean;
  /** 完成的文件操作列表 */
  fileOpsCompleted: number;
}

export class FileWriteError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FileWriteError';
  }
}

/* ═══ UnitOfWork 实现 ═══ */

export class KnowledgeUnitOfWork {
  #drizzle: DrizzleDB;
  #fileStore: KnowledgeFileStore;
  #pendingFileOps: PendingFileOp[] = [];
  #dbChanges: Array<(tx: DrizzleTx) => void> = [];
  #completedFileOps: PendingFileOp[] = [];
  #logger = Logger.getInstance();

  constructor(drizzle: DrizzleDB, fileStore: KnowledgeFileStore) {
    this.#drizzle = drizzle;
    this.#fileStore = fileStore;
  }

  /** 注册 DB 变更意图（延迟执行） */
  registerDbChange(fn: (tx: DrizzleTx) => void): void {
    this.#dbChanges.push(fn);
  }

  /** 注册文件操作意图 */
  registerFileOp(op: PendingFileOp): void {
    this.#pendingFileOps.push(op);
  }

  /**
   * 提交：文件操作 → DB 事务
   *
   * 失败模式:
   *   1. 文件写失败：中止、不触碰 DB；保留已写真相，尽力恢复删除，抛 FileWriteError。
   *      已完成文件不代表整批成功；诊断列明条目/完成数和后续同步路径。
   *   2. 文件全成功 + DB 失败：文件保留（真相源不回滚）→ 抛出 DivergenceError，
   *      携带分歧明细与修复路径（KnowledgeSyncService.sync 从文件重建 DB），
   *      并以稳定码 core.diagnostic.knowledge.file-db-divergence 记录诊断。
   *      调用方必须感知该分歧，不得当作写入成功（CO3 W2 write-strict）。
   *   3. 文件全成功 + DB 成功：完美一致
   */
  commit(): UnitOfWorkResult {
    // Phase 1: 文件操作 (must-succeed)
    this.#completedFileOps = [];
    for (const op of this.#pendingFileOps) {
      try {
        this.#executeFileOp(op);
        this.#completedFileOps.push(op);
      } catch (err: unknown) {
        const partialTruth = {
          entryIds: this.#completedFileOps.map((completed) => completed.entry.id),
          fileOpsCompleted: this.#completedFileOps.length,
          reconcileVia: 'KnowledgeSyncService.sync',
        };
        this.#compensateFileOps();
        this.#logger.error(
          'UoW: file batch aborted; partial file truth retained, DB not committed',
          {
            ...partialTruth,
            failedEntryId: op.entry.id,
            failedOperation: op.type,
            error: err instanceof Error ? err.message : String(err),
          }
        );
        this.#reset();
        throw new FileWriteError(
          `File operation failed: ${op.type} for ${op.entry.id}; partial file truth retained: ` +
            `entryIds=${JSON.stringify(partialTruth.entryIds)}, fileOpsCompleted=${partialTruth.fileOpsCompleted}; ` +
            `reconcileVia=${partialTruth.reconcileVia}`,
          { cause: err }
        );
      }
    }

    // Phase 2: DB 事务（文件已安全落盘）
    if (this.#dbChanges.length > 0) {
      try {
        this.#drizzle.transaction((tx) => {
          for (const change of this.#dbChanges) {
            change(tx);
          }
        });
      } catch (err: unknown) {
        // CO3 W2 (write-strict): files are persisted but the DB commit
        // failed — a real file/DB divergence. It used to degrade to a warn
        // log and a dbCommitted=false flag nobody checked. Now: record the
        // divergence, emit the diagnostic with a stable code, and throw a
        // typed error that names the reconciliation path. Files are NOT
        // rolled back — .md files are the source of truth.
        const divergence = {
          entryIds: this.#completedFileOps.map((op) => op.entry.id),
          fileOpsCompleted: this.#completedFileOps.length,
          reconcileVia: 'KnowledgeSyncService.sync',
          sqliteBusy: isSqliteBusyError(err),
        };
        this.#logger.error('UoW: file/DB divergence — DB transaction failed after file success', {
          code: CORE_DIAGNOSTIC_CODES.knowledgeFileDbDivergence,
          ...divergence,
          ...(divergence.sqliteBusy ? { busyCode: CORE_DIAGNOSTIC_CODES.sqliteBusy } : {}),
          error: err instanceof Error ? err.message : String(err),
        });
        this.#reset();
        throw new DivergenceError(
          'Knowledge files persisted but DB commit failed — run knowledge sync to rebuild DB rows from files',
          { code: CORE_DIAGNOSTIC_CODES.knowledgeFileDbDivergence, ...divergence },
          { cause: err }
        );
      }
    }

    const result: UnitOfWorkResult = {
      // commit() now throws on DB failure, so a returned result always
      // means the DB side is consistent with the files.
      dbCommitted: true,
      fileOpsCompleted: this.#completedFileOps.length,
    };

    this.#reset();
    return result;
  }

  /** 回滚：清空所有挂起操作（不执行已注册但未提交的操作） */
  rollback(): void {
    this.#reset();
  }

  #executeFileOp(op: PendingFileOp): void {
    let result: string | null | boolean;
    switch (op.type) {
      case 'write':
        result = this.#fileStore.persist(op.entry);
        break;
      case 'move':
        result = this.#fileStore.moveOnLifecycleChange(op.entry);
        break;
      case 'delete':
        result = this.#fileStore.remove(op.entry);
        break;
    }
    // 文件 port 用 null / false 表达失败，不保证抛错；真相源未写成时不能提交 DB。
    // 交给 commit 的既有异常路径做补偿，并统一向调用方抛 FileWriteError。
    if (result === null || result === false) {
      this.#logger.error('UoW: file operation returned a failure result; DB commit aborted', {
        type: op.type,
        entryId: op.entry.id,
        sourceFile: op.entry.sourceFile,
        result,
      });
      throw new Error(`File store rejected ${op.type} for ${op.entry.id}`);
    }
  }

  /** 尽力恢复删除；写入和移动缺少旧快照，必须保留而不能伪造原子回滚。 */
  #compensateFileOps(): void {
    for (const op of [...this.#completedFileOps].reverse()) {
      try {
        switch (op.type) {
          case 'write':
            // 新建与覆盖都保留；删除“覆盖后的文件”会把原有知识一起抹掉。
            break;
          case 'delete':
            if (this.#fileStore.persist(op.entry) === null) {
              throw new Error('File store could not restore the deleted entry');
            }
            break;
          case 'move':
            // move 回滚较复杂，记录日志等 SyncService 修复
            this.#logger.warn('UoW: Cannot auto-rollback move op', {
              entryId: op.entry.id,
            });
            break;
        }
      } catch {
        // 回滚失败不再抛出，记录日志
        this.#logger.error('UoW: File compensation failed', {
          type: op.type,
          entryId: op.entry.id,
        });
      }
    }
  }

  #reset(): void {
    this.#dbChanges = [];
    this.#pendingFileOps = [];
    this.#completedFileOps = [];
  }
}
