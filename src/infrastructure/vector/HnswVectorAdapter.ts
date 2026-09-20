/**
 * HnswVectorAdapter — 基于 HNSW 的向量存储实现
 *
 * 实现 VectorStore 接口, 内部使用:
 * - HnswIndex: 纯 JS HNSW 近似最近邻索引
 * - ScalarQuantizer: SQ8 量化 (文档数 > threshold 时自动启用)
 * - BinaryPersistence: .asvec 二进制持久化
 *
 * 特点:
 * - O(log N) 搜索, 替代暴力 O(N)
 * - 75% 内存节省 (SQ8 量化)
 * - 异步 debounced 持久化
 * - 自动从 JSON 旧格式迁移
 *
 * @module infrastructure/vector/HnswVectorAdapter
 */

import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join, relative } from 'node:path';
import pathGuard from '../../shared/PathGuard.js';
import { WeightedRrfAccumulator } from '../../shared/WeightedRrfAccumulator.js';
import type { WriteZone } from '../io/WriteZone.js';
import Logger from '../logging/Logger.js';
import { AsyncPersistence, WAL_OP } from './AsyncPersistence.js';
import { BinaryPersistence } from './BinaryPersistence.js';
import { HnswIndex } from './HnswIndex.js';
import { ScalarQuantizer } from './ScalarQuantizer.js';
import { matchesVectorMetadataFilter } from './VectorMetadataFilter.js';
import { VectorStore } from './VectorStore.js';

export class HnswVectorAdapter extends VectorStore {
  #index;
  /** id → metadata */
  #metadata;
  /** id → content */
  #contents;
  #quantizer: ScalarQuantizer | null;
  /** 向量维度 (首次 upsert 自动检测) */
  #dimension = 0;
  /** 数据是否已修改 */
  #dirty = false;
  /** 内存写入代次，异步快照只能确认其开始时的代次。 */
  #revision = 0;
  /** flush 定时器 */
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** 待刷盘操作计数 */
  #pendingOps = 0;
  /** WAL与兼容非WAL路径共用同一写入锁，禁止旧快照晚完成覆盖新快照。 */
  #persistPromise: Promise<void> | null = null;
  #destroyed = false;
  /** WAL 持久化管理 */
  #wal: AsyncPersistence | null = null;

  // ── 配置 ──
  #config;
  #indexDir;
  #indexPath; // .asvec 文件路径
  #wz: WriteZone | null;

  /**
   * @param [options.quantize='auto'] 'auto' | 'sq8' | 'none'
   * @param [options.walEnabled=true] 启用 WAL 持久化
   */
  constructor(
    projectRoot: string,
    options: {
      M?: number;
      efConstruct?: number;
      efSearch?: number;
      quantize?: string;
      quantizeThreshold?: number;
      indexDir?: string;
      flushIntervalMs?: number;
      flushBatchSize?: number;
      walEnabled?: boolean;
      writeZone?: WriteZone;
    } = {}
  ) {
    super();
    this.#config = {
      M: options.M || 16,
      efConstruct: options.efConstruct || 200,
      efSearch: options.efSearch || 100,
      quantize: options.quantize ?? 'auto',
      quantizeThreshold: options.quantizeThreshold || 3000,
      flushIntervalMs: options.flushIntervalMs || 2000,
      flushBatchSize: options.flushBatchSize || 100,
      walEnabled: options.walEnabled !== false,
    };
    this.#indexDir = options.indexDir || join(projectRoot, '.asd/context/index');
    this.#indexPath = join(this.#indexDir, 'vector_index.asvec');
    this.#metadata = new Map();
    this.#contents = new Map();
    this.#quantizer = null;
    this.#wz = options.writeZone ?? null;

    this.#index = new HnswIndex({
      M: this.#config.M,
      efConstruct: this.#config.efConstruct,
      efSearch: this.#config.efSearch,
    });
  }

  /**
   * 初始化: 加载已有索引或创建新索引
   * 自动检测 JSON 旧索引并迁移
   */
  async init() {
    this.#destroyed = false;
    // 确保目录存在
    if (this.#wz) {
      const rel = relative(this.#wz.dataRoot, this.#indexDir);
      this.#wz.ensureDir(this.#wz.data(rel));
    } else {
      pathGuard.assertProjectWriteSafe(this.#indexDir);
      if (!existsSync(this.#indexDir)) {
        mkdirSync(this.#indexDir, { recursive: true });
      }
    }

    // 只把解码失败归为旧索引损坏；WAL 恢复后的写盘失败必须向调用方传播。
    let snapshotLoaded = false;
    if (existsSync(this.#indexPath) && BinaryPersistence.isValid(this.#indexPath)) {
      try {
        const loaded = BinaryPersistence.load(this.#indexPath);
        const { indexData, quantizerData, metadata, contents, dimension } = loaded;

        // 恢复 HNSW 索引
        this.#index = HnswIndex.deserialize(indexData);
        this.#index.efSearch = this.#config.efSearch;
        this.#dimension = dimension;

        // 恢复量化器
        if (quantizerData) {
          this.#quantizer = ScalarQuantizer.deserialize(quantizerData);
          // 从 quantizer 重新编码量化向量到 HNSW 节点 (qvector 不序列化, 启动时重建)
          this.#index.setQuantizedVectors(this.#quantizer);
        }

        // 恢复 metadata 和 contents
        this.#metadata = metadata;
        this.#contents = contents;
        snapshotLoaded = true;
      } catch {
        // 损坏的文件, 忽略, 重新构建
      }
    }
    if (snapshotLoaded) {
      this.#initWal();
      const { replayed } = this.#wal?.recover() || { replayed: 0 };
      if (replayed > 0) {
        this.#markDirty();
        await this.#wal?.flush();
      }
      return;
    }

    // 尝试从 JSON 迁移
    const { VectorMigration } = await import('./VectorMigration.js');
    const migrationResult = await VectorMigration.migrate(this.#indexDir, this);
    if (migrationResult === 'migrated') {
      // 迁移完成, 数据已加载到内存
      await this.#persist();
    }

    // 初始化 WAL + replay 未刷盘操作 (即使是空索引也创建, 以便后续操作写 WAL)
    this.#initWal();
    const { replayed } = this.#wal?.recover() || { replayed: 0 };
    if (replayed > 0) {
      this.#markDirty();
      await this.#wal?.flush();
    }
  }

  /**
   * 同步初始化 (兼容 JsonVectorAdapter)
   * 注意: 同步路径无法执行 async 迁移, 但会尝试同步加载 JSON
   */
  initSync() {
    this.#destroyed = false;
    if (this.#wz) {
      const rel = relative(this.#wz.dataRoot, this.#indexDir);
      this.#wz.ensureDir(this.#wz.data(rel));
    } else {
      pathGuard.assertProjectWriteSafe(this.#indexDir);
      if (!existsSync(this.#indexDir)) {
        mkdirSync(this.#indexDir, { recursive: true });
      }
    }

    // 同步恢复也区分解码失败与落盘失败，后者不能触发迁移 fallback。
    let snapshotLoaded = false;
    if (existsSync(this.#indexPath) && BinaryPersistence.isValid(this.#indexPath)) {
      try {
        const loaded = BinaryPersistence.load(this.#indexPath);
        const { indexData, quantizerData, metadata, contents, dimension } = loaded;
        this.#index = HnswIndex.deserialize(indexData);
        this.#index.efSearch = this.#config.efSearch;
        this.#dimension = dimension;
        if (quantizerData) {
          this.#quantizer = ScalarQuantizer.deserialize(quantizerData);
          // 从 quantizer 重新编码量化向量到 HNSW 节点 (qvector 不序列化, 启动时重建)
          this.#index.setQuantizedVectors(this.#quantizer);
        }
        this.#metadata = metadata;
        this.#contents = contents;
        snapshotLoaded = true;
      } catch {
        // 损坏或不兼容, 尝试从 JSON 迁移
      }
    }

    // 同步迁移: 读取 JSON 索引并加载到内存
    if (!snapshotLoaded) {
      this.#syncMigrateFromJson();
    }

    // 初始化 WAL + replay 未刷盘操作
    this.#initWal();
    const { replayed } = this.#wal?.recover() || { replayed: 0 };
    if (replayed > 0) {
      this.#markDirty();
      BinaryPersistence.save(
        this.#indexPath,
        {
          index: this.#index,
          quantizer: this.#quantizer,
          metadata: this.#metadata,
          contents: this.#contents,
        },
        this.#wz ?? undefined
      );
      this.#dirty = false;
      // initSync 已同步保存；WAL 留到下一次异步 flush 确认，崩溃最多重复重放。
    }
  }

  /** 同步从 JSON 索引迁移 (用于 initSync 路径) */
  #syncMigrateFromJson() {
    const jsonPath = join(this.#indexDir, 'vector_index.json');
    if (!existsSync(jsonPath)) {
      return;
    }

    try {
      const raw = readFileSync(jsonPath, 'utf-8');
      const items = JSON.parse(raw);
      const itemList = Array.isArray(items)
        ? items
        : Object.entries(items).map(([id, item]) => ({ ...(item as Record<string, unknown>), id }));

      for (const item of itemList) {
        if (!item?.id) {
          continue;
        }
        const vector = item.vector || [];
        if (vector.length > 0 && this.#dimension === 0) {
          this.#dimension = vector.length;
        }
        this.#metadata.set(item.id, {
          ...(item.metadata || {}),
          updatedAt: Date.now(),
        });
        this.#contents.set(item.id, item.content || '');
        if (vector.length > 0) {
          this.#index.addPoint(item.id, vector);
        }
      }

      // 同步保存二进制索引
      BinaryPersistence.save(
        this.#indexPath,
        {
          index: this.#index,
          quantizer: this.#quantizer,
          metadata: this.#metadata,
          contents: this.#contents,
        },
        this.#wz ?? undefined
      );
      this.#dirty = false;

      // 重命名旧文件
      try {
        if (this.#wz) {
          const relSrc = relative(this.#wz.dataRoot, jsonPath);
          const relDest = relative(this.#wz.dataRoot, `${jsonPath}.bak`);
          this.#wz.rename(this.#wz.data(relSrc), this.#wz.data(relDest));
        } else {
          renameSync(jsonPath, `${jsonPath}.bak`);
        }
      } catch {
        /* ignore */
      }
    } catch {
      // JSON 解析失败, 保持空索引
    }
  }

  async upsert(item: {
    id: string;
    content?: string;
    vector?: number[] | Float32Array;
    metadata?: Record<string, unknown>;
  }) {
    if (!item?.id) {
      throw new Error('Item must have an id');
    }

    const vector = item.vector || [];

    // 自动检测维度 + 维度一致性守卫
    if (vector.length > 0) {
      if (this.#dimension === 0) {
        this.#dimension = vector.length;
      } else if (vector.length !== this.#dimension) {
        throw new Error(
          `Vector dimension mismatch: store has ${this.#dimension}d, ` +
            `new vector is ${vector.length}d. ` +
            `This usually means the embedding model was changed. ` +
            `Run 'alembic embed --clear --force' to rebuild with the new model.`
        );
      }
    }

    // 存储 metadata 和 content
    this.#metadata.set(item.id, {
      ...(item.metadata || {}),
      updatedAt: Date.now(),
    });
    this.#contents.set(item.id, item.content || '');

    // 如果有向量, 插入 HNSW 索引
    if (vector.length > 0) {
      const qvector = this.#quantizer?.trained ? this.#quantizer.encode(vector) : null;
      this.#index.addPoint(item.id, vector, { qvector });
    } else {
      // 空向量是新的关键词条目状态，不能继续召回此前内容的旧 embedding。
      this.#index.removePoint(item.id);
      Logger.getInstance().debug('[HnswVectorAdapter] upsert stored without ANN vector', {
        id: item.id,
      });
    }

    this.#markDirty();
    this.#pendingOps++;

    // 定期检查是否需要训练量化器 (每 500 次 upsert 检查一次)
    if (this.#pendingOps % 500 === 0) {
      this.#maybeTrainQuantizer();
    }

    // WAL 追加 + 调度 flush
    if (this.#wal) {
      this.#wal.appendWal({
        t: WAL_OP.UPSERT,
        id: item.id,
        c: item.content || '',
        v: vector.length > 0 ? Array.from(vector) : [],
        m: item.metadata || {},
      });
    } else {
      this.#scheduleFlush();
    }
  }

  async batchUpsert(
    items: Array<{
      id: string;
      content?: string;
      vector?: number[] | Float32Array;
      metadata?: Record<string, unknown>;
    }>
  ) {
    const walOps: { t: 1; id: string; c: string; v: unknown[]; m: Record<string, unknown> }[] = [];

    for (const item of items) {
      if (!item?.id) {
        continue;
      }

      const vector = item.vector || [];
      // 维度一致性守卫
      if (vector.length > 0) {
        if (this.#dimension === 0) {
          this.#dimension = vector.length;
        } else if (vector.length !== this.#dimension) {
          throw new Error(
            `Vector dimension mismatch: store has ${this.#dimension}d, ` +
              `new vector is ${vector.length}d. ` +
              `This usually means the embedding model was changed. ` +
              `Run 'alembic embed --clear --force' to rebuild with the new model.`
          );
        }
      }

      this.#metadata.set(item.id, {
        ...(item.metadata || {}),
        updatedAt: Date.now(),
      });
      this.#contents.set(item.id, item.content || '');

      if (vector.length > 0) {
        const qvector = this.#quantizer?.trained ? this.#quantizer.encode(vector) : null;
        this.#index.addPoint(item.id, vector, { qvector });
      } else {
        this.#index.removePoint(item.id);
        Logger.getInstance().debug('[HnswVectorAdapter] batch upsert stored without ANN vector', {
          id: item.id,
        });
      }

      walOps.push({
        t: WAL_OP.UPSERT,
        id: item.id,
        c: item.content || '',
        v: vector.length > 0 ? Array.from(vector) : [],
        m: item.metadata || {},
      });
    }

    this.#markDirty();
    this.#pendingOps += items.length;

    // 检查是否需要训练/重训练量化器
    this.#maybeTrainQuantizer();

    // WAL 批量追加
    if (this.#wal) {
      for (const op of walOps) {
        this.#wal.appendWal(op);
      }
    } else {
      this.#scheduleFlush();
    }
  }

  async remove(id: string) {
    this.#index.removePoint(id);
    this.#metadata.delete(id);
    this.#contents.delete(id);
    this.#markDirty();
    this.#pendingOps++;

    if (this.#wal) {
      this.#wal.appendWal({ t: WAL_OP.REMOVE, id });
    } else {
      this.#scheduleFlush();
    }
  }

  async getById(id: string) {
    if (!this.#metadata.has(id) && !this.#contents.has(id)) {
      return null;
    }

    const nodeIdx = this.#index.idToIndex.get(id);
    const node = nodeIdx !== undefined ? this.#index.nodes[nodeIdx] : null;

    return {
      id,
      content: this.#contents.get(id) || '',
      vector: node ? Array.from(node.vector) : [],
      metadata: this.#metadata.get(id) || {},
    };
  }

  /**
   * 向量相似度搜索 — HNSW O(log N)
   *
   * 当量化器已训练时启用 2-pass 搜索:
   * - Pass 1 (粗排): SQ8 量化距离在 HNSW 图中遍历, 获取 efSearch 个候选
   * - Pass 2 (精排): Float32 精确余弦距离对候选重排, 返回 top-K
   */
  async searchVector(
    queryVector: number[] | Float32Array,
    options: { topK?: number; filter?: Record<string, unknown> | null; minScore?: number } = {}
  ) {
    const { topK = 10, filter = null, minScore = 0 } = options;

    if (!queryVector || queryVector.length === 0) {
      return [];
    }

    // HNSW 搜索 (多召回一些, 后续过滤可能减少)
    const rawK = filter ? topK * 3 : topK;

    const runKnnPass = (k: number) => {
      let knnResults: { id: string | undefined; nodeIdx: number; dist: number }[];
      if (this.#quantizer?.trained && this.#index.size > this.#config.quantizeThreshold) {
        // 2-pass: SQ8 粗排 → Float32 精排
        const quantizedQuery = this.#quantizer.encode(queryVector);
        knnResults = this.#index.searchKnn(queryVector, k, {
          quantizedQuery,
          quantizer: this.#quantizer,
        });
      } else {
        // 直接 Float32 搜索
        knnResults = this.#index.searchKnn(queryVector, k);
      }

      // 转换为标准格式 + 过滤
      const aliveResults = knnResults.filter((r) => r.id); // 过滤掉已删除节点
      let passResults = aliveResults
        .map((r) => ({
          item: {
            id: r.id,
            content: this.#contents.get(r.id) || '',
            vector: this.#index.nodes[r.nodeIdx]
              ? Array.from(this.#index.nodes[r.nodeIdx]!.vector)
              : [],
            metadata: this.#metadata.get(r.id) || {},
          },
          score: 1 - r.dist, // 距离转相似度
        }))
        .filter((r) => r.score >= minScore);
      const afterScoreCount = passResults.length;

      // 应用过滤
      if (filter) {
        passResults = passResults.filter((r) => this.#matchFilter(r.item, filter));
      }
      return { knnResults, aliveResults, afterScoreCount, passResults };
    };

    let pass = runKnnPass(rawK);

    // 带 filter 的过召回不足额补偿（2026-07-06 语义零召回终局修复）：
    // 同一索引池混存异类向量（entry 全文向量 vs recipe-region 切片向量），带
    // type=recipe-semantic-region 过滤的检索会被距离更近的 entry 向量挤占全部
    // rawK 候选位——过滤后归零。此时扩大到全图重试一次：百级节点代价微秒级，
    // 大图也仅在"过滤后不足额"才触发，并留痕以便观察触发频率。
    if (filter && pass.passResults.length < topK && this.#index.size > rawK) {
      const fullPass = runKnnPass(this.#index.size);
      Logger.getInstance().info(
        `[HnswVectorAdapter] filter under-recall retry: rawK=${rawK} matched=${pass.passResults.length} fullScan=${this.#index.size} matchedAfter=${fullPass.passResults.length}`
      );
      pass = fullPass;
    }

    // 零结果诊断（2026-07-06 语义零召回排障加固）：图非空却零返回时，
    // 打出四道过滤各自的存活数与首个原始距离——直接指认断层在 knn / 软删 /
    // minScore / metadata filter 的哪一层。
    if (pass.passResults.length === 0 && this.#index.size > 0) {
      const firstAlive = pass.aliveResults[0];
      Logger.getInstance().warn(
        `[HnswVectorAdapter] empty search result diagnostics: knnRaw=${pass.knnResults.length} alive=${pass.aliveResults.length} afterScore=${pass.afterScoreCount} afterFilter=${pass.passResults.length} firstDist=${pass.knnResults[0]?.dist ?? 'n/a'} minScore=${minScore} indexSize=${this.#index.size} filter=${JSON.stringify(filter ?? null)} firstCandidateMeta=${JSON.stringify(firstAlive ? { id: firstAlive.id, meta: this.#metadata.get(firstAlive.id) ?? null } : null)?.slice(0, 400)}`
      );
    }

    return pass.passResults.slice(0, topK);
  }

  /**
   * 混合搜索: HNSW 向量 + 关键词, 使用 RRF (Reciprocal Rank Fusion) 融合
   *
   * score = α × 1/(k+rank_dense) + (1-α) × 1/(k+rank_sparse)
   *
   * @deprecated 优先使用 VectorService.hybridSearch() → HybridRetriever.fuse()
   * 此方法保留作为 VectorStore 层的本地混合搜索能力
   */
  async hybridSearch(
    queryVector: number[] | Float32Array | null,
    queryText: string,
    options: {
      topK?: number;
      filter?: Record<string, unknown> | null;
      rrfK?: number;
      alpha?: number;
    } = {}
  ) {
    const { topK = 10, filter = null, rrfK = 60, alpha = 0.5 } = options;
    const expandedK = topK * 3;

    // Dense: HNSW 向量搜索
    const vectorResults =
      queryVector && queryVector.length > 0
        ? await this.searchVector(queryVector, { topK: expandedK, filter })
        : [];

    // Sparse: 关键词搜索
    const keywordResults = this.#keywordSearch(queryText, expandedK, filter);

    const fusion = new WeightedRrfAccumulator<
      (typeof vectorResults)[number]['item'],
      string | undefined
    >(rrfK, alpha);
    vectorResults.forEach((result, rank) => {
      fusion.add(result.item.id, 'dense', rank, result.score).payload = result.item;
    });
    keywordResults.forEach((result, rank) => {
      const entry = fusion.add(result.id, 'sparse', rank, result.score, 'contribution');
      // Store 路径只在缺少 dense item 时构造 sparse payload，保留空 vector 与真实 metadata。
      entry.payload ??= {
        id: result.id,
        content: this.#contents.get(result.id) || '',
        vector: [],
        metadata: this.#metadata.get(result.id) || {},
      };
    });

    return fusion.ranked(topK).map((entry) => ({
      item: entry.payload!,
      score: entry.total,
      rrfContribution: {
        dense: entry.dense?.contribution ?? 0,
        sparse: entry.sparse?.contribution ?? 0,
        total: entry.total,
      },
      // HNSW 的缺通道字段仍是 own undefined，不能变成 HybridRetriever 的 Infinity。
      denseRank: entry.dense?.rank,
      denseSimilarity: entry.dense?.score,
      sparseRank: entry.sparse?.rank,
      sparseScore: entry.sparse?.score,
      vectorScore: entry.dense?.score,
      keywordScore: entry.sparse?.score,
    }));
  }

  /**
   * 关键词搜索 (token 匹配 + IDF 近似)
   * @returns >}
   */
  #keywordSearch(queryText: string, limit: number, filter: Record<string, unknown> | null) {
    if (!queryText) {
      return [];
    }

    const queryLower = queryText.toLowerCase();
    const words = queryLower.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      return [];
    }

    const results: { id: string; score: number }[] = [];
    for (const [id, content] of this.#contents) {
      if (filter) {
        const item = { metadata: this.#metadata.get(id) || {} };
        if (!this.#matchFilter(item, filter)) {
          continue;
        }
      }

      const textLower = content.toLowerCase();
      const hits = words.filter((w) => textLower.includes(w)).length;
      const keywordScore = hits / words.length;

      if (keywordScore > 0) {
        results.push({ id, score: keywordScore });
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** query() — SearchEngine 使用的向量搜索别名 */
  async query(queryVector: number[] | Float32Array, topK = 10) {
    const results = await this.searchVector(queryVector, { topK });
    return results.map((r) => ({
      id: r.item.id,
      similarity: r.score,
      score: r.score,
      content: r.item.content,
      metadata: r.item.metadata || {},
    }));
  }

  async searchByFilter(filter: Record<string, unknown>) {
    const results: { id: string; content: string; metadata: Record<string, unknown> }[] = [];
    for (const [id, meta] of this.#metadata) {
      const item = { id, content: this.#contents.get(id) || '', metadata: meta };
      if (this.#matchFilter(item, filter)) {
        results.push(item);
      }
    }
    return results;
  }

  async listIds() {
    return [...this.#metadata.keys()];
  }

  async clear() {
    this.#index = new HnswIndex({
      M: this.#config.M,
      efConstruct: this.#config.efConstruct,
      efSearch: this.#config.efSearch,
    });
    this.#metadata.clear();
    this.#contents.clear();
    this.#quantizer = null;
    this.#dimension = 0;
    this.#markDirty();

    if (this.#wal) {
      this.#wal.appendWal({ t: WAL_OP.CLEAR });
    } else {
      this.#scheduleFlush();
    }
  }

  async getStats() {
    const stats = this.#index.getStats();
    return {
      count: this.#metadata.size,
      indexSize: 0, // 实际文件大小在 flush 后才知道
      indexPath: this.#indexPath,
      hasVectors: stats.totalNodes,
      hnswLevels: stats.levels,
      hnswEdges: stats.totalEdges,
      quantized: this.#quantizer?.trained || false,
      dimension: this.#dimension,
    };
  }

  // ── 持久化 ──

  /** 初始化 WAL (Write-Ahead Log) */
  #initWal() {
    if (!this.#config.walEnabled) {
      return;
    }
    this.#wal = new AsyncPersistence({
      indexPath: this.#indexPath,
      enabled: true,
      flushIntervalMs: this.#config.flushIntervalMs,
      flushBatchSize: this.#config.flushBatchSize,
      onPersist: () => this.#persist(),
      onReplay: (op: Record<string, unknown>) => this.#replayOp(op),
      writeZone: this.#wz ?? undefined,
    });
  }

  /**
   * 重放 WAL 操作 (启动时恢复崩溃前未刷盘的操作)
   * @param op WAL 操作
   */
  #replayOp(op: Record<string, unknown>) {
    switch (op.t) {
      case WAL_OP.UPSERT: {
        const vector = (op.v || []) as number[];
        if (vector.length > 0 && this.#dimension === 0) {
          this.#dimension = vector.length;
        }
        this.#metadata.set(op.id as string, {
          ...((op.m || {}) as Record<string, unknown>),
          updatedAt: Date.now(),
        });
        this.#contents.set(op.id as string, (op.c || '') as string);
        if (vector.length > 0) {
          const qvector = this.#quantizer?.trained ? this.#quantizer.encode(vector) : null;
          this.#index.addPoint(op.id as string, vector, { qvector });
        } else {
          this.#index.removePoint(op.id as string);
          Logger.getInstance().debug('[HnswVectorAdapter] replay stored without ANN vector', {
            id: op.id,
          });
        }
        break;
      }
      case WAL_OP.REMOVE:
        this.#index.removePoint(op.id as string);
        this.#metadata.delete(op.id as string);
        this.#contents.delete(op.id as string);
        break;
      case WAL_OP.CLEAR:
        this.#index = new HnswIndex({
          M: this.#config.M,
          efConstruct: this.#config.efConstruct,
          efSearch: this.#config.efSearch,
        });
        this.#metadata.clear();
        this.#contents.clear();
        this.#quantizer = null;
        this.#dimension = 0;
        break;
    }
  }

  /** 手动触发持久化 (测试/关闭时使用) */
  async flush() {
    this.#cancelFlushTimer();
    if (this.#wal) {
      await this.#wal.flush();
    }
    // 显式关闭/flush必须覆盖等待期间的新操作，不能仅等第一个快照结束。
    while (this.#persistPromise || this.#dirty) {
      await this.#persist();
    }
    this.#cancelFlushTimer();
  }

  #scheduleFlush(afterFailure = false) {
    if (this.#destroyed || this.#persistPromise || !this.#dirty) {
      return;
    }

    // 如果积累了足够操作, 立即 flush
    if (!afterFailure && this.#pendingOps >= this.#config.flushBatchSize) {
      this.#doFlush();
      return;
    }

    // 否则 debounced flush
    if (this.#flushTimer) {
      return;
    }
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.#doFlush();
    }, this.#config.flushIntervalMs);
    // unref() 使定时器不阻止 Node 进程退出
    if (this.#flushTimer?.unref) {
      this.#flushTimer.unref();
    }
  }

  async #doFlush() {
    try {
      await this.#persist();
    } catch {
      // 后台没有调用者接收拒绝；#persist已记录失败并安排有间隔的重试。
    }
  }

  async #persist() {
    while (this.#persistPromise) {
      await this.#persistPromise;
    }
    if (!this.#dirty) {
      return;
    }
    this.#cancelFlushTimer();
    // WAL路径的计数还驱动每500次upsert的量化检查，沿用既有累计语义。
    if (!this.#wal) {
      this.#pendingOps = 0;
    }
    const snapshotRevision = this.#revision;
    let failed = false;
    const saving = BinaryPersistence.saveAsync(
      this.#indexPath,
      {
        index: this.#index,
        quantizer: this.#quantizer,
        metadata: this.#metadata,
        contents: this.#contents,
      },
      this.#wz ?? undefined
    )
      .then(() => {
        this.#dirty = this.#revision !== snapshotRevision;
        if (this.#destroyed && this.#dirty) {
          // destroy保持同步void契约。在途旧写晚完成时，仅有界补存一次最新状态。
          Logger.getInstance().debug(
            '[HnswVectorAdapter] completing snapshot after destroy; saving latest revision',
            {
              indexPath: this.#indexPath,
              snapshotRevision,
              currentRevision: this.#revision,
            }
          );
          this.#persistSync();
        }
      })
      .catch((error: unknown) => {
        failed = true;
        this.#dirty = true;
        // 上层 WAL 只有收到成功才能确认本批；吞掉错误会把唯一恢复记录删掉。
        Logger.getInstance().warn(
          '[HnswVectorAdapter] snapshot write failed; retaining dirty state',
          {
            indexPath: this.#indexPath,
            error: error instanceof Error ? error.message : String(error),
          }
        );
        throw error;
      })
      .finally(() => {
        this.#persistPromise = null;
        // WAL自行管理批次确认与后续调度；非WAL仍须保存await期间的新revision。
        if (!this.#wal && this.#dirty) {
          this.#scheduleFlush(failed);
        }
      });
    this.#persistPromise = saving;
    await saving;
  }

  #markDirty() {
    this.#dirty = true;
    this.#revision++;
  }

  #cancelFlushTimer() {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
  }

  #persistSync() {
    BinaryPersistence.save(
      this.#indexPath,
      {
        index: this.#index,
        quantizer: this.#quantizer,
        metadata: this.#metadata,
        contents: this.#contents,
      },
      this.#wz ?? undefined
    );
    this.#dirty = false;
  }

  // ── 量化器 ──

  /** 检查是否需要训练量化器, 训练后批量设置量化向量到 HNSW 节点 */
  #maybeTrainQuantizer() {
    if (this.#config.quantize === 'none') {
      return;
    }
    if (this.#config.quantize === 'auto' && this.#index.size < this.#config.quantizeThreshold) {
      return;
    }

    // 已训练则跳过 (除非文档增长 50% 以上需要重训练)
    if (this.#quantizer?.trained) {
      return;
    }

    // 收集训练向量
    const vectors: Array<Float32Array | number[]> = [];
    for (const node of this.#index.nodes) {
      if (node && node.vector.length > 0) {
        vectors.push(node.vector);
      }
    }

    if (vectors.length < 100) {
      return; // 数据太少不训练
    }

    this.#quantizer = new ScalarQuantizer(this.#dimension);
    this.#quantizer.train(vectors);

    // 批量设置量化向量到 HNSW 节点 (用于 2-pass 搜索)
    this.#index.setQuantizedVectors(this.#quantizer);
  }

  // ── 过滤 ──

  #matchFilter(item: { metadata?: Record<string, unknown> }, filter: Record<string, unknown>) {
    return matchesVectorMetadataFilter(item.metadata, filter);
  }

  /** 销毁: 清理定时器 */
  destroy() {
    this.#destroyed = true;
    // 清理 WAL
    if (this.#wal) {
      this.#wal.destroy();
    }
    // 清理 legacy 定时器
    this.#cancelFlushTimer();
    // 同步最后一次 persist
    if (this.#dirty) {
      try {
        this.#persistSync();
      } catch (error) {
        Logger.getInstance().warn('[HnswVectorAdapter] synchronous shutdown snapshot failed', {
          indexPath: this.#indexPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
