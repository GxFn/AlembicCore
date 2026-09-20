import { KnowledgeEntry } from '../../domain/knowledge/KnowledgeEntry.js';
import Logger from '../../infrastructure/logging/Logger.js';
import type { KnowledgeFileStore } from '../../repository/knowledge/KnowledgeFileStore.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { unixNow } from '../../shared/utils/common.js';
import { commitKnowledgeWrite } from './commitKnowledgeWrite.js';
import type { KnowledgeServiceRepository } from './KnowledgeServiceDependencies.js';

/**
 * sustain 内部的统一写边界：完整实体先持久化为 Markdown，再更新派生 DB。
 * 不公开生命周期绕过接口，也不把异步 repository.update 伪装成同步 SQLite 事务。
 */
export async function persistKnowledgeUpdate(
  repository: Pick<KnowledgeServiceRepository, 'findById' | 'update'>,
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
  await commitKnowledgeWrite({
    entry: prospective,
    fileStore,
    operation,
    commit: () => repository.update(entryId, prospective),
  });
}
