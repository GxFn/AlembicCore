import { KnowledgeEntry } from '../../domain/knowledge/KnowledgeEntry.js';
import { isSqliteBusyError } from '../../infrastructure/database/DatabaseConnection.js';
import Logger from '../../infrastructure/logging/Logger.js';
import type { KnowledgeFileStore } from '../../repository/knowledge/KnowledgeFileStore.js';
import type KnowledgeRepositoryImpl from '../../repository/knowledge/KnowledgeRepositoryImpl.js';
import { FileWriteError } from '../../repository/knowledge/KnowledgeUnitOfWork.js';
import { CORE_DIAGNOSTIC_CODES } from '../../shared/DiagnosticCodes.js';
import { DivergenceError, NotFoundError } from '../../shared/errors/index.js';
import { unixNow } from '../../shared/utils/common.js';

/**
 * sustain 内部的统一写边界：完整实体先持久化为 Markdown，再更新派生 DB。
 * 不公开生命周期绕过接口，也不把异步 repository.update 伪装成同步 SQLite 事务。
 */
export async function persistKnowledgeUpdate(
  repository: Pick<KnowledgeRepositoryImpl, 'findById' | 'update'>,
  fileStore: KnowledgeFileStore | null,
  entryId: string,
  updates: Record<string, unknown>,
  operation: string
): Promise<void> {
  const logger = Logger.getInstance();
  if (!fileStore) {
    // 保留旧独立使用方的构造/DB-only 行为；两个正式宿主均显式注入 fileStore。
    logger.warn('Knowledge mutation uses legacy DB-only persistence: fileStore not configured', {
      entryId,
      operation,
      fields: Object.keys(updates),
    });
    await repository.update(entryId, updates);
    return;
  }

  const current = await repository.findById(entryId);
  if (!current) {
    throw new NotFoundError(`Knowledge entry not found: ${entryId}`);
  }
  const prospective = KnowledgeEntry.fromJSON({
    ...current.toJSON(),
    ...updates,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: unixNow(),
  });
  try {
    if (fileStore.persist(prospective) === null) {
      throw new Error('Knowledge file store returned null');
    }
  } catch (error) {
    logger.error('Knowledge mutation aborted before DB update: file persistence failed', {
      entryId,
      operation,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new FileWriteError(`Knowledge file write failed during ${operation}: ${entryId}`, {
      cause: error,
    });
  }

  try {
    const saved = await repository.update(entryId, prospective);
    // UPDATE 后并发删除也可能表现为 null 而非异常；没有同 id 读回不能声称 DB 已对齐。
    if (saved?.id !== entryId) {
      throw new Error(
        `KNOWLEDGE_UPDATE_READBACK_MISMATCH: expected=${entryId}, actual=${saved?.id ?? 'missing'}`
      );
    }
  } catch (error) {
    // 文件是已经持久化的真相，不能回滚；调用方必须知道需要从文件重建 DB。
    const details = {
      code: CORE_DIAGNOSTIC_CODES.knowledgeFileDbDivergence,
      entryIds: [entryId],
      fileOpsCompleted: 1,
      operation,
      reconcileVia: 'KnowledgeSyncService.sync',
      sqliteBusy: isSqliteBusyError(error),
    };
    logger.error('Knowledge mutation left file/DB divergence', {
      ...details,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new DivergenceError(
      'Knowledge file persisted but DB update failed — run knowledge sync to rebuild DB truth',
      details,
      { cause: error }
    );
  }
}
