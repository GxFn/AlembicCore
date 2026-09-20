/**
 * VectorMigration — JSON → HNSW 二进制索引自动迁移
 *
 * 场景:
 * 1. 首次启动, 无任何索引 → 返回 'new'
 * 2. 存在 vector_index.json → 读取 JSON, 批量插入 HNSW, 重命名旧文件
 * 3. 存在 .asvec 二进制索引 → 返回 'binary' (已迁移)
 *
 * @module infrastructure/vector/VectorMigration
 */

import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import Logger from '../logging/Logger.js';

export class VectorMigration {
  /**
   * 检测并执行自动迁移
   *
   * @param indexDir 索引目录路径
   * @param adapter HNSW 适配器实例
   */
  static async migrate(
    indexDir: string,
    adapter: {
      batchUpsert: (
        items: Array<{
          id: string;
          content: string;
          vector: number[];
          metadata: Record<string, unknown>;
        }>
      ) => Promise<void>;
    }
  ) {
    const jsonPath = join(indexDir, 'vector_index.json');
    const hnswPath = join(indexDir, 'vector_index.asvec');

    // 场景 3: 已有二进制索引 (需验证有效性)
    if (existsSync(hnswPath)) {
      // 如果 .asvec 损坏且同时存在 .json, 从 JSON 迁移
      const { BinaryPersistence } = await import('./BinaryPersistence.js');
      if (BinaryPersistence.isValid(hnswPath)) {
        return 'binary';
      }
      // .asvec 损坏, 检查是否有 JSON 可迁移
      if (!existsSync(jsonPath)) {
        return 'binary'; // 无 JSON 可回退, 保持现状
      }
      // 有 JSON, 将从 JSON 迁移 (跳过这个 if, 进入下方迁移逻辑)
    }

    // 场景 2: 存在旧 JSON 索引
    if (existsSync(jsonPath)) {
      let itemList: Array<{
        id?: string;
        content?: string;
        vector?: number[];
        metadata?: Record<string, unknown>;
      }>;
      try {
        const raw = readFileSync(jsonPath, 'utf-8');
        const items = JSON.parse(raw);
        itemList = Array.isArray(items)
          ? items
          : Object.entries(items).map(([id, item]) => ({
              ...(item as Record<string, unknown>),
              id,
            }));
      } catch (error) {
        // 只对旧文件读取/解析保持宽容；不能把目标存储失败归为“新安装”。
        Logger.getInstance().warn(
          '[VectorMigration] legacy JSON unreadable; using new-index fallback',
          {
            jsonPath,
            errorType: error instanceof Error ? error.name : typeof error,
            result: 'new-json-retained',
          }
        );
        return 'new';
      }

      if (itemList.length > 0) {
        const validItems = itemList.filter((item) => item?.id);
        if (validItems.length > 0) {
          // 迁移调用方在此回调内完成所需持久化；成功之前保留唯一 JSON 恢复输入。
          await adapter.batchUpsert(
            validItems.map((item) => ({
              id: item.id!,
              content: item.content || '',
              vector: item.vector || [],
              metadata: item.metadata || {},
            }))
          );
        }

        try {
          renameSync(jsonPath, `${jsonPath}.bak`);
        } catch (error) {
          // 已完成批次不能因备份归档失败反转为失败；保留旧输入供宿主后续清理。
          Logger.getInstance().warn(
            '[VectorMigration] legacy JSON archive failed after migration',
            {
              jsonPath,
              errorType: error instanceof Error ? error.name : typeof error,
              result: 'migrated-json-retained',
            }
          );
        }
        return 'migrated';
      }
    }

    // 场景 1: 全新安装
    return 'new';
  }

  /** 检查是否需要迁移 */
  static needsMigration(indexDir: string) {
    const jsonPath = join(indexDir, 'vector_index.json');
    const hnswPath = join(indexDir, 'vector_index.asvec');
    return existsSync(jsonPath) && !existsSync(hnswPath);
  }
}
