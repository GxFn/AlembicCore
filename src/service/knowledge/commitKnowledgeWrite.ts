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
export async function commitKnowledgeWrite<T extends { id: string } | null>({
  entry,
  fileStore,
  operation,
  commit,
  fileOperation = 'persist',
  reconcileVia = 'KnowledgeSyncService.sync',
  fileFailureMessage = `Knowledge file write failed during ${operation}: ${entry.id}`,
  dbFailureMessage = 'Knowledge file persisted but DB update failed — run knowledge sync to rebuild DB truth',
}: {
  entry: KnowledgeEntry;
  fileStore: KnowledgeFileStore | null;
  operation: string;
  commit: () => Promise<T>;
  fileOperation?: 'persist' | 'moveOnLifecycleChange' | 'remove';
  reconcileVia?: string;
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

  let fileOpsCompleted = 0;
  try {
    const fileResult = fileStore[fileOperation](entry);
    if (fileResult === null) {
      throw new Error('Knowledge file store returned null');
    }
    if (fileResult === false) {
      // remove 的旧布尔契约：false 表示没有匹配文件；读取/权限/归属不明必须抛错。
      logger.info('Knowledge removal found no matching file; continuing index cleanup', {
        entryId: entry.id,
        operation,
        fileOperation,
      });
    } else {
      fileOpsCompleted = 1;
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
    // 更新使用 repository 写后读回；删除回调在确认受影响行/已不存在后返回 id 凭据。
    // 不在协调层重复读取 DB；更新遇到并发删除而返回 null 也属于分歧。
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
      fileOpsCompleted,
      operation,
      reconcileVia,
      sqliteBusy: isSqliteBusyError(error),
    };
    logger.error('Knowledge mutation left file/DB divergence', {
      ...details,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new DivergenceError(dbFailureMessage, details, { cause: error });
  }
}
