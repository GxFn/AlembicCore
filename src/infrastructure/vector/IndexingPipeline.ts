/**
 * IndexingPipeline v2 — 索引管线
 * scan → chunk (AST / section / fixed) → detect incremental changes (sourceHash) → batch embed → batch upsert
 *
 * v2 变更:
 * - 集成 BatchEmbedder: 批量 embed 替代串行 per-chunk embed, ~50× 加速
 * - 集成 Chunker v2: auto 策略自动选择 AST / section / fixed 分块
 * - 新增 onProgress 回调支持
 * - 新增 chunking 配置透传 (strategy, maxChunkTokens, overlapTokens, useAST)
 */

import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import type { EmbeddingPort, LegacyEmbedProvider } from '../../service/vector/EmbeddingPort.js';
import { computeContentHash } from '../../shared/contentHash.js';
import { LanguageService } from '../../shared/LanguageService.js';
import { KNOWLEDGE_BASE_DIR } from '../config/Defaults.js';
import Logger from '../logging/Logger.js';
import { ensureParser, isASTChunkerAvailable } from './ASTChunker.js';
import { BatchEmbedder } from './BatchEmbedder.js';
import { chunk, estimateTokens } from './Chunker.js';
import type { VectorStore } from './VectorStore.js';

/** Chunk enrichment 接口 (可选, 由外层 service adapter 注入) */
interface ChunkEnricherLike {
  enrichChunks(
    document: { title: string; content: string; kind: string; sourcePath?: string },
    chunks: Array<{ content: string; metadata: Record<string, unknown> }>
  ): Promise<Array<{ content: string; metadata: Record<string, unknown> }>>;
}

interface IndexedSourceFile {
  absolutePath: string;
  relativePath: string;
  type: string;
}

interface StoredFileChunk {
  id: string;
  content: unknown;
  vector: unknown;
  metadata: Record<string, unknown>;
  owned: boolean;
}

// 只标记本管线实际生成/核实并重写的块；历史 sourcePath 本身不足以证明删除权限。
const FILE_INDEXING_PRODUCER = 'file-indexing-pipeline-v1';

const SCANNABLE_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.swift',
  '.m',
  '.h',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.py',
  '.java',
  '.kt',
  '.go',
  '.rs',
  '.rb',
]);

export class IndexingPipeline {
  #vectorStore; // VectorStore 实例
  #aiProvider; // AiProvider 实例 (可选, 用于 embedding)
  #batchEmbedder: BatchEmbedder | null = null; // 自动从 aiProvider 创建，撤销 provider 时同步清空
  #scanDirs; // 要扫描的目录
  #projectRoot;
  #chunkingOptions; // Chunker v2 透传选项
  #contextualEnricher: ChunkEnricherLike | null; // 上下文增强器 (可选)

  constructor(
    options: {
      vectorStore?: VectorStore;
      aiProvider?: EmbeddingPort | LegacyEmbedProvider;
      scanDirs?: string[];
      projectRoot?: string;
      batchSize?: number;
      maxConcurrency?: number;
      contextualEnricher?: ChunkEnricherLike | null;
      chunking?: {
        strategy?: string;
        maxChunkTokens?: number;
        overlapTokens?: number;
        useAST?: boolean;
      };
    } = {}
  ) {
    this.#vectorStore = options.vectorStore || null;
    this.#aiProvider = options.aiProvider || null;
    this.#scanDirs = options.scanDirs || [
      'recipes',
      'candidates',
      `${KNOWLEDGE_BASE_DIR}/recipes`,
      `${KNOWLEDGE_BASE_DIR}/candidates`,
    ];
    this.#projectRoot = options.projectRoot || process.cwd();
    this.#chunkingOptions = {
      strategy: options.chunking?.strategy ?? 'auto',
      maxChunkTokens: options.chunking?.maxChunkTokens ?? 512,
      overlapTokens: options.chunking?.overlapTokens ?? 50,
      useAST: options.chunking?.useAST ?? true,
    };

    this.#contextualEnricher = options.contextualEnricher || null;

    // 自动创建 BatchEmbedder (如果有 aiProvider)
    if (this.#aiProvider) {
      this.#batchEmbedder = new BatchEmbedder(this.#aiProvider, {
        batchSize: options.batchSize ?? 32,
        maxConcurrency: options.maxConcurrency ?? 2,
      });
    }
  }

  setVectorStore(store: VectorStore) {
    this.#vectorStore = store;
  }
  setAiProvider(provider: EmbeddingPort | LegacyEmbedProvider | null) {
    this.#aiProvider = provider;
    if (provider) {
      this.#batchEmbedder = new BatchEmbedder(provider, {
        batchSize: 32,
        maxConcurrency: 2,
      });
    } else {
      // 撤销 provider 同时撤销捕获旧 provider 的 batcher，后续只建立关键词索引。
      this.#batchEmbedder = null;
      Logger.getInstance().debug(
        '[IndexingPipeline] embedding provider detached; keyword indexing only'
      );
    }
  }

  setContextualEnricher(enricher: ChunkEnricherLike | null) {
    this.#contextualEnricher = enricher;
  }

  /**
   * 运行完整索引管线
   * @param options { force: boolean, dryRun: boolean, onProgress: function }
   * @returns >}
   */
  async run(
    options: {
      force?: boolean;
      dryRun?: boolean;
      clear?: boolean;
      onProgress?: (info: { phase: string; [key: string]: unknown }) => void;
    } = {}
  ) {
    const { force = false, dryRun = false, clear = false, onProgress } = options;
    const stats = {
      scanned: 0,
      chunked: 0,
      enriched: 0,
      embedded: 0,
      upserted: 0,
      skipped: 0,
      errors: 0,
    };

    if (!this.#vectorStore) {
      throw new Error('VectorStore not set');
    }

    // 0. clear — 清空现有索引后重建
    if (clear && !dryRun) {
      await this.#vectorStore.clear();
      onProgress?.({ phase: 'clear', detail: 'Existing index cleared' });
    }

    // 1. 扫描文件
    const scan = this.#scanInputs();
    const files = scan.files;
    let cleanupSafe = scan.complete;
    if (!scan.complete) {
      stats.errors++;
    }
    stats.scanned = files.length;

    // 2. 增量检测 + 分块 (先收集所有 chunks)
    const existingIds = new Set(await this.#vectorStore.listIds());
    const existingBySource = new Map<string, StoredFileChunk[]>();
    for (const id of existingIds) {
      try {
        const stored = await this.#vectorStore.getById(id);
        const metadata = stored?.metadata;
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
          continue;
        }
        const fields = metadata as Record<string, unknown>;
        if (typeof fields.sourcePath !== 'string' || !fields.sourcePath) {
          continue;
        }
        const sourcePath = this.#sourcePath(resolve(this.#projectRoot, fields.sourcePath));
        const owned = fields.indexingProducer === FILE_INDEXING_PRODUCER;
        const legacy =
          fields.indexingProducer === undefined &&
          Number.isInteger(fields.chunkIndex) &&
          typeof fields.sourceHash === 'string' &&
          typeof fields.totalChunks === 'number' &&
          ['recipe', 'code', 'readme'].includes(String(fields.type)) &&
          id === `${fields.sourcePath.replace(/\//g, '_')}_${fields.chunkIndex}`;
        if (!owned && !legacy) {
          continue;
        }
        const group = existingBySource.get(sourcePath) ?? [];
        group.push({
          id,
          content: stored?.content,
          vector: stored?.vector,
          metadata: fields,
          owned,
        });
        existingBySource.set(sourcePath, group);
      } catch (error) {
        cleanupSafe = false;
        stats.errors++;
        this.#logReadFailure('stored-chunk', id, error);
      }
    }
    const allChunks: {
      id: string;
      content: string;
      metadata: Record<string, unknown>;
      preservedVector?: number[];
    }[] = [];
    const staleIds = new Set<string>();

    for (const file of files) {
      try {
        const content = readFileSync(file.absolutePath, 'utf-8');
        const hash = this.hashContent(content);
        const existing = existingBySource.get(file.relativePath) ?? [];
        const owned = existing.filter((item) => item.owned);
        const totalChunks = owned[0]?.metadata.totalChunks;

        // 增量检测：hash 未变时跳过
        if (
          !force &&
          typeof totalChunks === 'number' &&
          totalChunks > 0 &&
          owned.length === totalChunks &&
          new Set(owned.map((item) => item.metadata.chunkIndex)).size === totalChunks &&
          owned.every(
            (item) =>
              item.metadata.sourceHash === hash &&
              item.metadata.totalChunks === totalChunks &&
              Number.isInteger(item.metadata.chunkIndex) &&
              Number(item.metadata.chunkIndex) >= 0 &&
              Number(item.metadata.chunkIndex) < totalChunks
          )
        ) {
          stats.skipped++;
          continue;
        }

        // 分块 (使用 Chunker v2 - 支持 AST 策略)
        const language = this.#detectLanguage(file.absolutePath);
        if (
          this.#chunkingOptions.useAST &&
          (this.#chunkingOptions.strategy === 'ast' ||
            (this.#chunkingOptions.strategy === 'auto' &&
              file.type === 'code' &&
              estimateTokens(content) > this.#chunkingOptions.maxChunkTokens))
        ) {
          const ready = await ensureParser();
          if (!ready || !isASTChunkerAvailable(language)) {
            Logger.getInstance().debug(
              '[IndexingPipeline] AST unavailable; using configured fallback',
              {
                sourcePath: file.relativePath,
                language,
                strategy: this.#chunkingOptions.strategy,
              }
            );
          }
        }
        const chunks = chunk(
          content,
          {
            type: file.type,
            sourcePath: file.relativePath,
            sourceHash: hash,
            language,
          },
          this.#chunkingOptions
        );
        stats.chunked += chunks.length;

        // 旧ID按实际sourcePath绑定继续使用；新块使用无损路径编码，避免 a/b 与 a_b 折叠。
        const fileChunks: typeof allChunks = [];
        for (let i = 0; i < chunks.length; i++) {
          const previous = existing.find((item) => item.metadata.chunkIndex === i);
          const id =
            previous?.id ??
            `file_chunk_${Buffer.from(file.relativePath, 'utf8').toString('base64url')}_${i}`;
          if (!previous && existingIds.has(id)) {
            throw new Error(`pipeline-id-owned-by-another-source:${id}`);
          }
          fileChunks.push({
            id,
            content: chunks[i].content,
            metadata: {
              ...chunks[i].metadata,
              chunkIndex: i,
              indexingProducer: FILE_INDEXING_PRODUCER,
            },
            // 核实旧块内容后原位迁移marker，无provider时也不丢已有同内容embedding。
            ...(!force &&
            !this.#contextualEnricher &&
            previous?.content === chunks[i].content &&
            previous.metadata.sourceHash === hash &&
            Array.isArray(previous.vector)
              ? { preservedVector: previous.vector as number[] }
              : {}),
          });
        }
        allChunks.push(...fileChunks);

        // 标记需要清理的旧 chunk
        const selectedIds = new Set(fileChunks.map((item) => item.id));
        for (const item of owned) {
          if (!selectedIds.has(item.id)) {
            staleIds.add(item.id);
          }
        }
      } catch (error: unknown) {
        cleanupSafe = false;
        stats.errors++;
        this.#logReadFailure('source-file', file.relativePath, error);
      }
    }

    // 扫描未返回不代表文件已删除。确认ENOENT且仍在本次扫描范围后才授权清理。
    const scannedPaths = new Set(files.map((file) => file.relativePath));
    for (const [sourcePath, stored] of existingBySource) {
      if (scannedPaths.has(sourcePath) || !this.#isWithinScanScope(sourcePath)) {
        continue;
      }
      try {
        lstatSync(resolve(this.#projectRoot, sourcePath));
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          cleanupSafe = false;
          stats.errors++;
          this.#logReadFailure('deleted-source-check', sourcePath, error);
          continue;
        }
        for (const item of stored) {
          if (item.owned) {
            staleIds.add(item.id);
          } else {
            Logger.getInstance().debug(
              '[IndexingPipeline] deleted legacy chunk retained; producer unproven',
              { id: item.id, sourcePath }
            );
          }
        }
      }
    }

    // 2.5. Contextual Enrichment (可选, 在 embed 之前)
    if (this.#contextualEnricher && allChunks.length > 0) {
      onProgress?.({ phase: 'enrich', detail: 'Running contextual enrichment...' });
      // 按 sourcePath 分组，每个文档的 chunks 一起 enrich
      const chunksBySource = new Map<
        string,
        Array<{ index: number; chunk: (typeof allChunks)[0] }>
      >();
      for (let i = 0; i < allChunks.length; i++) {
        const sourcePath = (allChunks[i].metadata.sourcePath as string) || 'unknown';
        if (!chunksBySource.has(sourcePath)) {
          chunksBySource.set(sourcePath, []);
        }
        chunksBySource.get(sourcePath)!.push({ index: i, chunk: allChunks[i] });
      }

      for (const [sourcePath, group] of chunksBySource) {
        try {
          // 读取原始文档内容作为上下文
          const firstChunk = group[0].chunk;
          const docTitle = (firstChunk.metadata.sourcePath as string) || sourcePath;
          const docKind = (firstChunk.metadata.type as string) || 'recipe';
          // 拼接所有 chunk 作为文档摘要（enricher 内部会截断）
          const docContent = group.map((g) => g.chunk.content).join('\n\n');

          const enrichedChunks = await this.#contextualEnricher!.enrichChunks(
            { title: docTitle, content: docContent, kind: docKind, sourcePath },
            group.map((g) => ({
              content: g.chunk.content,
              metadata: g.chunk.metadata,
            }))
          );

          // 回写 enriched 内容
          for (let j = 0; j < enrichedChunks.length; j++) {
            const originalIndex = group[j].index;
            const sourceMetadata = allChunks[originalIndex].metadata;
            allChunks[originalIndex] = {
              ...allChunks[originalIndex],
              content: enrichedChunks[j].content,
              // Enricher只扩展内容语义，来源/删除权限仍由本次真实扫描决定。
              metadata: {
                ...sourceMetadata,
                ...enrichedChunks[j].metadata,
                sourcePath: sourceMetadata.sourcePath,
                sourceHash: sourceMetadata.sourceHash,
                chunkIndex: sourceMetadata.chunkIndex,
                totalChunks: sourceMetadata.totalChunks,
                indexingProducer: FILE_INDEXING_PRODUCER,
              },
            };
            if (enrichedChunks[j].metadata.contextEnriched) {
              stats.enriched++;
            }
          }
        } catch {
          // enrichment 失败不阻塞，使用原始 chunks
        }
      }
      onProgress?.({ phase: 'enrich', detail: `Enriched ${stats.enriched} chunks` });
    }

    // 3. 批量 embed (使用 BatchEmbedder)
    const vectorMap = new Map(
      allChunks
        .filter((item) => item.preservedVector !== undefined)
        .map((item) => [item.id, item.preservedVector!] as const)
    );
    const toEmbed = allChunks.filter((item) => item.preservedVector === undefined);

    if (this.#batchEmbedder && toEmbed.length > 0) {
      try {
        const embedded = await this.#batchEmbedder.embedAll(
          toEmbed.map((c) => ({ id: c.id, content: c.content })),
          (embedded: number, total: number) => {
            stats.embedded = embedded;
            onProgress?.({ phase: 'embed', embedded, total });
          }
        );
        for (const [id, vector] of embedded) {
          vectorMap.set(id, vector);
        }
        stats.embedded = embedded.size;
      } catch {
        // embed 全部失败, 继续写入 (无向量)
      }
    }

    // 4. 批量写入
    if (!dryRun && allChunks.length > 0) {
      const batch = allChunks.map((c) => ({
        id: c.id,
        content: c.content,
        vector: vectorMap.get(c.id) || [],
        metadata: c.metadata,
      }));

      await this.#vectorStore.batchUpsert(batch);
      stats.upserted = batch.length;
      onProgress?.({ phase: 'upsert', upserted: stats.upserted });
    }

    // 5. 清理旧 chunks
    if (!dryRun && cleanupSafe) {
      for (const staleId of staleIds) {
        try {
          await this.#vectorStore.remove(staleId);
        } catch (error) {
          stats.errors++;
          this.#logReadFailure('stale-chunk-remove', staleId, error);
        }
      }
    } else if (!dryRun && !cleanupSafe) {
      Logger.getInstance().warn('[IndexingPipeline] cleanup skipped after incomplete scan/read', {
        staleCandidates: staleIds.size,
        errors: stats.errors,
      });
    }

    return stats;
  }

  /**
   * 扫描项目中的可索引文件
   * @returns >}
   */
  scan() {
    return this.#scanInputs().files;
  }

  #scanInputs(): { files: IndexedSourceFile[]; complete: boolean } {
    const files: IndexedSourceFile[] = [];
    let complete = true;

    for (const dir of this.#scanDirs) {
      const absDir = join(this.#projectRoot, dir);
      try {
        // ENOENT是确定缺失；权限错误、坏目录等不能被existsSync折叠为“已删除”。
        statSync(absDir);
        if (!this.#walkDir(absDir, files)) {
          complete = false;
        }
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          complete = false;
          this.#logReadFailure('scan-root', absDir, error);
        }
      }
    }

    // 也扫描根目录的 README
    const readmePath = join(this.#projectRoot, 'README.md');
    try {
      if (statSync(readmePath).isFile()) {
        files.push({ absolutePath: readmePath, relativePath: 'README.md', type: 'readme' });
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        complete = false;
        this.#logReadFailure('readme', readmePath, error);
      }
    }
    return { files, complete };
  }

  /** 计算内容 hash */
  hashContent(content: string) {
    return computeContentHash(content);
  }

  #walkDir(dir: string, files: IndexedSourceFile[]): boolean {
    let complete = true;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') {
            continue;
          }
          if (!this.#walkDir(fullPath, files)) {
            complete = false;
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (SCANNABLE_EXTENSIONS.has(ext)) {
            files.push({
              absolutePath: fullPath,
              relativePath: this.#sourcePath(fullPath),
              type: ext === '.md' || ext === '.markdown' ? 'recipe' : 'code',
            });
          }
        }
      }
    } catch (error) {
      complete = false;
      this.#logReadFailure('scan-directory', dir, error);
    }
    return complete;
  }

  #sourcePath(absolutePath: string): string {
    // 只规范本平台路径分隔符；POSIX文件名中的反斜杠仍是合法字节。
    return relative(this.#projectRoot, absolutePath).split(sep).join('/');
  }

  #isWithinScanScope(sourcePath: string): boolean {
    const absolute = resolve(this.#projectRoot, sourcePath);
    if (absolute === resolve(this.#projectRoot, 'README.md')) {
      return true;
    }
    return this.#scanDirs.some((dir) => {
      const root = resolve(this.#projectRoot, dir);
      if (!absolute.startsWith(`${root}${sep}`)) {
        return false;
      }
      const directories = relative(root, absolute).split(sep).slice(0, -1);
      return directories.every((part) => !part.startsWith('.') && part !== 'node_modules');
    });
  }

  #logReadFailure(stage: string, sourcePath: string, error: unknown) {
    Logger.getInstance().warn(
      '[IndexingPipeline] IO/processing failed; retaining existing chunks',
      {
        stage,
        sourcePath,
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }

  #detectLanguage(filePath: string) {
    const lang = LanguageService.inferLang(filePath);
    return lang === 'unknown' ? 'text' : lang;
  }
}
