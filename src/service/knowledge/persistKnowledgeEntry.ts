import type { KnowledgeEntry } from '../../domain/knowledge/KnowledgeEntry.js';
import { isSqliteBusyError } from '../../infrastructure/database/DatabaseConnection.js';
import Logger from '../../infrastructure/logging/Logger.js';
import type { KnowledgeFileStore } from '../../repository/knowledge/KnowledgeFileStore.js';
import { FileWriteError } from '../../repository/knowledge/KnowledgeUnitOfWork.js';
import { CORE_DIAGNOSTIC_CODES } from '../../shared/DiagnosticCodes.js';
import { DivergenceError } from '../../shared/errors/index.js';

/**
 * 单条知识写入的内部协调边界。调用者负责权限、状态机和实体准备，这里只决定持久化顺序。
 * 与同步批次 UoW 分工：异步 repository 回调不能被包进 SQLite 同步事务；文件已成功后也不能回滚真相。
 */
export async function persistKnowledgeEntry<T extends { id: string } | null>({
  entry,
  fileStore,
  operation,
  commit,
  fileOperation = 'persist',
  fileFailureMessage = `Knowledge file write failed during ${operation}: ${entry.id}`,
  dbFailureMessage = 'Knowledge file persisted but DB update failed — run knowledge sync to rebuild DB truth',
}: {
  entry: KnowledgeEntry;
  fileStore: KnowledgeFileStore | null;
  operation: string;
  commit: () => Promise<T>;
  fileOperation?: 'persist' | 'moveOnLifecycleChange';
  fileFailureMessage?: string;
  dbFailureMessage?: string;
}): Promise<T> {
  const logger = Logger.getInstance();
  if (!fileStore) {
    // 独立旧消费者仍可只配置 DB；不对它们追加完整实体读回要求。
    logger.warn('Knowledge mutation uses legacy DB-only persistence: fileStore not configured', {
      entryId: entry.id,
      operation,
    });
    return commit();
  }

  try {
    if (fileStore[fileOperation](entry) === null) {
      throw new Error('Knowledge file store returned null');
    }
  } catch (error) {
    logger.error('Knowledge mutation aborted before DB commit: file persistence failed', {
      entryId: entry.id,
      operation,
      fileOperation,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new FileWriteError(fileFailureMessage, { cause: error });
  }

  try {
    const saved = await commit();
    // 不重复读取 DB：repository 的写后读回就是确认点；并发删除返回 null 也属于分歧。
    if (saved?.id !== entry.id) {
      throw new Error(
        `KNOWLEDGE_WRITE_READBACK_MISMATCH: expected=${entry.id}, actual=${saved?.id ?? 'missing'}`
      );
    }
    return saved;
  } catch (error) {
    const details = {
      code: CORE_DIAGNOSTIC_CODES.knowledgeFileDbDivergence,
      entryIds: [entry.id],
      fileOpsCompleted: 1,
      operation,
      reconcileVia: 'KnowledgeSyncService.sync',
      sqliteBusy: isSqliteBusyError(error),
    };
    logger.error('Knowledge mutation left file/DB divergence', {
      ...details,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new DivergenceError(dbFailureMessage, details, { cause: error });
  }
}
