import type { SQL } from 'drizzle-orm';
import { and, count, desc, eq, like, or } from 'drizzle-orm';
import {
  createSourceFileNode,
  createSourceGraphEdge,
  createSourceGraphFreshness,
  createSourceGraphSnapshot,
  createSourceSymbolNode,
  type SourceFileNode,
  type SourceFileNodeInput,
  type SourceGraphEdge,
  type SourceGraphEdgeInput,
  type SourceGraphFreshness,
  type SourceGraphFreshnessState,
  type SourceGraphParseError,
  type SourceGraphSnapshot,
  type SourceGraphSnapshotInput,
  type SourceGraphSnapshotStatus,
  type SourceRange,
  type SourceSymbolNode,
  type SourceSymbolNodeInput,
} from '../../domain/source-graph/index.js';
import type { DrizzleDB } from '../../infrastructure/database/drizzle/index.js';
import {
  sourceGraphEdges,
  sourceGraphFiles,
  sourceGraphGenerations,
  sourceGraphSymbols,
} from '../../infrastructure/database/drizzle/schema.js';
import { RepositoryBase } from '../base/RepositoryBase.js';

type GenerationRow = typeof sourceGraphGenerations.$inferSelect;
type FileRow = typeof sourceGraphFiles.$inferSelect;
type SymbolRow = typeof sourceGraphSymbols.$inferSelect;
type EdgeRow = typeof sourceGraphEdges.$inferSelect;

export interface SourceGraphSymbolInsert extends SourceSymbolNodeInput {
  projectRoot?: string;
}

export interface SourceGraphEdgeInsert extends SourceGraphEdgeInput {
  projectRoot?: string;
}

export interface SourceGraphReplaceInput {
  snapshot: SourceGraphSnapshotInput;
  files?: SourceFileNodeInput[];
  symbols?: SourceGraphSymbolInsert[];
  edges?: SourceGraphEdgeInsert[];
}

export interface SourceGraphStats {
  generationId: string;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
  parseErrorCount: number;
  languageCoverage: string[];
  freshness: SourceGraphFreshness;
}

export interface SourceGraphClearResult {
  generations: number;
  files: number;
  symbols: number;
  edges: number;
}

export interface SourceGraphSymbolSearchOptions {
  limit?: number;
  kind?: string;
  filePath?: string;
}

export interface SourceGraphEdgeQueryOptions {
  limit?: number;
  kind?: string;
  fromSymbolId?: string;
  toSymbolId?: string;
  filePath?: string;
}

export type SourceGraphEdgeDirection = 'incoming' | 'outgoing' | 'both';

export class SourceGraphRepositoryImpl extends RepositoryBase<
  typeof sourceGraphGenerations,
  SourceGraphSnapshot
> {
  constructor(drizzle: DrizzleDB) {
    super(drizzle, sourceGraphGenerations);
  }

  async findById(id: string | number): Promise<SourceGraphSnapshot | null> {
    if (typeof id === 'number') {
      const rows = this.drizzle
        .select()
        .from(this.table)
        .where(eq(this.table.id, id))
        .limit(1)
        .all();
      return rows.length > 0 ? mapGenerationRow(rows[0]) : null;
    }
    return this.getSnapshot(id);
  }

  async create(data: SourceGraphSnapshotInput): Promise<SourceGraphSnapshot> {
    return this.createGeneration(data);
  }

  async delete(id: string | number): Promise<boolean> {
    const snapshot = await this.findById(id);
    if (!snapshot) {
      return false;
    }
    const result = await this.clearGeneration(snapshot.generationId);
    return result.generations > 0;
  }

  async createGeneration(input: SourceGraphSnapshotInput): Promise<SourceGraphSnapshot> {
    const snapshot = createSourceGraphSnapshot(input);
    this.writeGeneration(snapshot);
    return this.getRequiredSnapshot(snapshot.generationId);
  }

  async completeGeneration(
    generationId: string,
    updates: Partial<SourceGraphSnapshotInput> = {}
  ): Promise<SourceGraphSnapshot> {
    const current = await this.getRequiredSnapshot(generationId);
    const now = Date.now();
    const next = createSourceGraphSnapshot({
      ...current,
      ...updates,
      generationId: current.generationId,
      projectRoot: current.projectRoot,
      completedAt: updates.completedAt ?? current.completedAt ?? now,
      indexedAt: updates.indexedAt ?? current.indexedAt ?? now,
      status: updates.status ?? 'indexed',
      freshness: {
        ...current.freshness,
        ...updates.freshness,
        generationId: current.generationId,
        indexedAt: updates.indexedAt ?? current.indexedAt ?? now,
        checkedAt: updates.freshness?.checkedAt ?? now,
        status: updates.freshness?.status ?? 'fresh',
      },
    });

    this.writeGeneration(next);
    return this.getRequiredSnapshot(generationId);
  }

  async replaceGeneration(input: SourceGraphReplaceInput): Promise<SourceGraphSnapshot> {
    const preparedSnapshot = createSourceGraphSnapshot(input.snapshot);
    const preparedFiles = (input.files ?? []).map((file) =>
      createSourceFileNode({
        ...file,
        generationId: preparedSnapshot.generationId,
        projectRoot: preparedSnapshot.projectRoot,
      })
    );
    const preparedSymbols = (input.symbols ?? []).map((symbol) =>
      createSourceSymbolNode({
        ...symbol,
        generationId: preparedSnapshot.generationId,
      })
    );
    const preparedEdges = (input.edges ?? []).map((edge) =>
      createSourceGraphEdge({
        ...edge,
        generationId: preparedSnapshot.generationId,
      })
    );
    const snapshot = await this.createGeneration(preparedSnapshot);

    this.drizzle
      .delete(sourceGraphEdges)
      .where(eq(sourceGraphEdges.generationId, snapshot.generationId))
      .run();
    this.drizzle
      .delete(sourceGraphSymbols)
      .where(eq(sourceGraphSymbols.generationId, snapshot.generationId))
      .run();
    this.drizzle
      .delete(sourceGraphFiles)
      .where(eq(sourceGraphFiles.generationId, snapshot.generationId))
      .run();

    for (const file of preparedFiles) {
      await this.upsertFile(
        {
          ...file,
          generationId: snapshot.generationId,
          projectRoot: snapshot.projectRoot,
        },
        false
      );
    }

    for (const symbol of preparedSymbols) {
      await this.upsertSymbol(
        {
          ...symbol,
          generationId: snapshot.generationId,
          projectRoot: snapshot.projectRoot,
        },
        false
      );
    }

    for (const edge of preparedEdges) {
      await this.upsertEdge(
        {
          ...edge,
          generationId: snapshot.generationId,
          projectRoot: snapshot.projectRoot,
        },
        false
      );
    }

    return (await this.refreshGenerationStats(snapshot.generationId)) ?? snapshot;
  }

  async getSnapshot(generationId: string): Promise<SourceGraphSnapshot | null> {
    const rows = this.drizzle
      .select()
      .from(this.table)
      .where(eq(this.table.generationId, generationId))
      .limit(1)
      .all();
    return rows.length > 0 ? mapGenerationRow(rows[0]) : null;
  }

  async getLatestSnapshot(
    projectRoot: string,
    repoId = 'default'
  ): Promise<SourceGraphSnapshot | null> {
    const rows = this.drizzle
      .select()
      .from(this.table)
      .where(and(eq(this.table.projectRoot, projectRoot), eq(this.table.repoId, repoId)))
      .orderBy(desc(this.table.indexedAt), desc(this.table.startedAt))
      .limit(1)
      .all();
    return rows.length > 0 ? mapGenerationRow(rows[0]) : null;
  }

  async getFreshness(projectRoot: string, repoId = 'default'): Promise<SourceGraphFreshness> {
    const snapshot = await this.getLatestSnapshot(projectRoot, repoId);
    if (!snapshot) {
      return createSourceGraphFreshness({
        status: 'uninitialized',
        reason: 'No source graph generation exists for this project.',
        nextAction: 'build_source_graph',
      });
    }
    return snapshot.freshness;
  }

  async upsertFile(input: SourceFileNodeInput, refreshStats = true): Promise<SourceFileNode> {
    const node = createSourceFileNode(input);
    this.drizzle
      .insert(sourceGraphFiles)
      .values({
        generationId: node.generationId,
        projectRoot: node.projectRoot,
        repoRelativePath: node.repoRelativePath,
        language: node.language,
        contentHash: node.contentHash,
        sizeBytes: node.sizeBytes,
        mtimeMs: node.mtimeMs,
        indexedAt: node.indexedAt,
        classification: node.classification,
        parseStatus: node.parseStatus,
        parseErrorsJson: JSON.stringify(node.parseErrors),
        lineCount: node.lineCount,
        metadataJson: JSON.stringify(node.metadata),
      })
      .onConflictDoUpdate({
        target: [sourceGraphFiles.generationId, sourceGraphFiles.repoRelativePath],
        set: {
          projectRoot: node.projectRoot,
          language: node.language,
          contentHash: node.contentHash,
          sizeBytes: node.sizeBytes,
          mtimeMs: node.mtimeMs,
          indexedAt: node.indexedAt,
          classification: node.classification,
          parseStatus: node.parseStatus,
          parseErrorsJson: JSON.stringify(node.parseErrors),
          lineCount: node.lineCount,
          metadataJson: JSON.stringify(node.metadata),
        },
      })
      .run();

    if (refreshStats) {
      await this.refreshGenerationStats(node.generationId);
    }

    return this.getRequiredFile(node.generationId, node.repoRelativePath);
  }

  async upsertSymbol(
    input: SourceGraphSymbolInsert,
    refreshStats = true
  ): Promise<SourceSymbolNode> {
    const node = createSourceSymbolNode(input);
    const projectRoot = await this.resolveProjectRoot(node.generationId, input.projectRoot);
    this.drizzle
      .insert(sourceGraphSymbols)
      .values({
        generationId: node.generationId,
        projectRoot,
        symbolId: node.symbolId,
        displayName: node.displayName,
        qualifiedName: node.qualifiedName,
        kind: node.kind,
        filePath: node.filePath,
        startLine: node.range.startLine,
        startColumn: node.range.startColumn,
        endLine: node.range.endLine,
        endColumn: node.range.endColumn,
        selectionStartLine: node.selectionRange?.startLine,
        selectionStartColumn: node.selectionRange?.startColumn,
        selectionEndLine: node.selectionRange?.endLine,
        selectionEndColumn: node.selectionRange?.endColumn,
        signature: node.signature,
        containerSymbolId: node.containerSymbolId,
        exported: node.exported ? 1 : 0,
        imported: node.imported ? 1 : 0,
        metadataJson: JSON.stringify(node.metadata),
        provenanceJson: JSON.stringify(node.provenance),
      })
      .onConflictDoUpdate({
        target: [sourceGraphSymbols.generationId, sourceGraphSymbols.symbolId],
        set: {
          projectRoot,
          displayName: node.displayName,
          qualifiedName: node.qualifiedName,
          kind: node.kind,
          filePath: node.filePath,
          startLine: node.range.startLine,
          startColumn: node.range.startColumn,
          endLine: node.range.endLine,
          endColumn: node.range.endColumn,
          selectionStartLine: node.selectionRange?.startLine,
          selectionStartColumn: node.selectionRange?.startColumn,
          selectionEndLine: node.selectionRange?.endLine,
          selectionEndColumn: node.selectionRange?.endColumn,
          signature: node.signature,
          containerSymbolId: node.containerSymbolId,
          exported: node.exported ? 1 : 0,
          imported: node.imported ? 1 : 0,
          metadataJson: JSON.stringify(node.metadata),
          provenanceJson: JSON.stringify(node.provenance),
        },
      })
      .run();

    if (refreshStats) {
      await this.refreshGenerationStats(node.generationId);
    }

    return this.getRequiredSymbol(node.generationId, node.symbolId);
  }

  async upsertEdge(input: SourceGraphEdgeInsert, refreshStats = true): Promise<SourceGraphEdge> {
    const edge = createSourceGraphEdge(input);
    const projectRoot = await this.resolveProjectRoot(edge.generationId, input.projectRoot);
    this.drizzle
      .insert(sourceGraphEdges)
      .values({
        generationId: edge.generationId,
        projectRoot,
        edgeId: edge.edgeId,
        kind: edge.kind,
        fromSymbolId: edge.fromSymbolId,
        toSymbolId: edge.toSymbolId,
        fromFilePath: edge.fromFilePath,
        toFilePath: edge.toFilePath,
        siteFilePath: edge.siteFilePath,
        siteStartLine: edge.site?.startLine,
        siteStartColumn: edge.site?.startColumn,
        siteEndLine: edge.site?.endLine,
        siteEndColumn: edge.site?.endColumn,
        provenance: edge.provenance,
        confidence: edge.confidence,
        source: edge.source,
        metadataJson: JSON.stringify(edge.metadata),
      })
      .onConflictDoUpdate({
        target: [sourceGraphEdges.generationId, sourceGraphEdges.edgeId],
        set: {
          projectRoot,
          kind: edge.kind,
          fromSymbolId: edge.fromSymbolId,
          toSymbolId: edge.toSymbolId,
          fromFilePath: edge.fromFilePath,
          toFilePath: edge.toFilePath,
          siteFilePath: edge.siteFilePath,
          siteStartLine: edge.site?.startLine,
          siteStartColumn: edge.site?.startColumn,
          siteEndLine: edge.site?.endLine,
          siteEndColumn: edge.site?.endColumn,
          provenance: edge.provenance,
          confidence: edge.confidence,
          source: edge.source,
          metadataJson: JSON.stringify(edge.metadata),
        },
      })
      .run();

    if (refreshStats) {
      await this.refreshGenerationStats(edge.generationId);
    }

    return this.getRequiredEdge(edge.generationId, edge.edgeId);
  }

  async findFile(generationId: string, repoRelativePath: string): Promise<SourceFileNode | null> {
    const rows = this.drizzle
      .select()
      .from(sourceGraphFiles)
      .where(
        and(
          eq(sourceGraphFiles.generationId, generationId),
          eq(sourceGraphFiles.repoRelativePath, repoRelativePath)
        )
      )
      .limit(1)
      .all();
    return rows.length > 0 ? mapFileRow(rows[0]) : null;
  }

  async listFiles(generationId: string): Promise<SourceFileNode[]> {
    const rows = this.drizzle
      .select()
      .from(sourceGraphFiles)
      .where(eq(sourceGraphFiles.generationId, generationId))
      .all();
    return rows.map(mapFileRow);
  }

  async getSymbol(generationId: string, symbolId: string): Promise<SourceSymbolNode | null> {
    const rows = this.drizzle
      .select()
      .from(sourceGraphSymbols)
      .where(
        and(
          eq(sourceGraphSymbols.generationId, generationId),
          eq(sourceGraphSymbols.symbolId, symbolId)
        )
      )
      .limit(1)
      .all();
    return rows.length > 0 ? mapSymbolRow(rows[0]) : null;
  }

  async listSymbols(generationId: string): Promise<SourceSymbolNode[]> {
    const rows = this.drizzle
      .select()
      .from(sourceGraphSymbols)
      .where(eq(sourceGraphSymbols.generationId, generationId))
      .all();
    return rows.map(mapSymbolRow);
  }

  async searchSymbols(
    generationId: string,
    query: string,
    options: SourceGraphSymbolSearchOptions = {}
  ): Promise<SourceSymbolNode[]> {
    const conditions: SQL[] = [eq(sourceGraphSymbols.generationId, generationId)];
    const trimmedQuery = query.trim();
    if (trimmedQuery !== '') {
      const search = `%${trimmedQuery}%`;
      const searchCondition = or(
        like(sourceGraphSymbols.displayName, search),
        like(sourceGraphSymbols.qualifiedName, search),
        like(sourceGraphSymbols.symbolId, search)
      );
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }
    if (options.kind) {
      conditions.push(eq(sourceGraphSymbols.kind, options.kind));
    }
    if (options.filePath) {
      conditions.push(eq(sourceGraphSymbols.filePath, options.filePath));
    }

    const rows = this.drizzle
      .select()
      .from(sourceGraphSymbols)
      .where(and(...conditions))
      .limit(normalizeLimit(options.limit))
      .all();
    return rows.map(mapSymbolRow);
  }

  async listEdges(
    generationId: string,
    options: SourceGraphEdgeQueryOptions = {}
  ): Promise<SourceGraphEdge[]> {
    const conditions: SQL[] = [eq(sourceGraphEdges.generationId, generationId)];
    if (options.kind) {
      conditions.push(eq(sourceGraphEdges.kind, options.kind));
    }
    if (options.fromSymbolId) {
      conditions.push(eq(sourceGraphEdges.fromSymbolId, options.fromSymbolId));
    }
    if (options.toSymbolId) {
      conditions.push(eq(sourceGraphEdges.toSymbolId, options.toSymbolId));
    }
    if (options.filePath) {
      const fileCondition = or(
        eq(sourceGraphEdges.fromFilePath, options.filePath),
        eq(sourceGraphEdges.toFilePath, options.filePath),
        eq(sourceGraphEdges.siteFilePath, options.filePath)
      );
      if (fileCondition) {
        conditions.push(fileCondition);
      }
    }

    const rows = this.drizzle
      .select()
      .from(sourceGraphEdges)
      .where(and(...conditions))
      .limit(normalizeLimit(options.limit))
      .all();
    return rows.map(mapEdgeRow);
  }

  async findEdgesForSymbol(
    generationId: string,
    symbolId: string,
    direction: SourceGraphEdgeDirection = 'both'
  ): Promise<SourceGraphEdge[]> {
    const conditions: SQL[] = [eq(sourceGraphEdges.generationId, generationId)];
    if (direction === 'incoming') {
      conditions.push(eq(sourceGraphEdges.toSymbolId, symbolId));
    } else if (direction === 'outgoing') {
      conditions.push(eq(sourceGraphEdges.fromSymbolId, symbolId));
    } else {
      const symbolCondition = or(
        eq(sourceGraphEdges.fromSymbolId, symbolId),
        eq(sourceGraphEdges.toSymbolId, symbolId)
      );
      if (symbolCondition) {
        conditions.push(symbolCondition);
      }
    }

    const rows = this.drizzle
      .select()
      .from(sourceGraphEdges)
      .where(and(...conditions))
      .all();
    return rows.map(mapEdgeRow);
  }

  async findEdgesForFile(generationId: string, filePath: string): Promise<SourceGraphEdge[]> {
    return this.listEdges(generationId, { filePath, limit: 500 });
  }

  async getStats(generationId: string): Promise<SourceGraphStats> {
    const snapshot =
      (await this.refreshGenerationStats(generationId)) ??
      (await this.getRequiredSnapshot(generationId));
    return {
      generationId,
      fileCount: snapshot.fileCount,
      symbolCount: snapshot.symbolCount,
      edgeCount: snapshot.edgeCount,
      parseErrorCount: snapshot.parseErrorCount,
      languageCoverage: snapshot.languageCoverage,
      freshness: snapshot.freshness,
    };
  }

  async clearGeneration(generationId: string): Promise<SourceGraphClearResult> {
    const files = countRows(
      this.drizzle
        .select({ cnt: count() })
        .from(sourceGraphFiles)
        .where(eq(sourceGraphFiles.generationId, generationId))
        .all()
    );
    const symbols = countRows(
      this.drizzle
        .select({ cnt: count() })
        .from(sourceGraphSymbols)
        .where(eq(sourceGraphSymbols.generationId, generationId))
        .all()
    );
    const edges = countRows(
      this.drizzle
        .select({ cnt: count() })
        .from(sourceGraphEdges)
        .where(eq(sourceGraphEdges.generationId, generationId))
        .all()
    );

    this.drizzle
      .delete(sourceGraphEdges)
      .where(eq(sourceGraphEdges.generationId, generationId))
      .run();
    this.drizzle
      .delete(sourceGraphSymbols)
      .where(eq(sourceGraphSymbols.generationId, generationId))
      .run();
    this.drizzle
      .delete(sourceGraphFiles)
      .where(eq(sourceGraphFiles.generationId, generationId))
      .run();
    const generationResult = this.drizzle
      .delete(this.table)
      .where(eq(this.table.generationId, generationId))
      .run();

    return {
      generations: generationResult.changes,
      files,
      symbols,
      edges,
    };
  }

  private writeGeneration(snapshot: SourceGraphSnapshot): void {
    const values = {
      generationId: snapshot.generationId,
      projectRoot: snapshot.projectRoot,
      repoId: snapshot.repoId,
      graphRoot: snapshot.graphRoot,
      projectScope: snapshot.projectScope,
      status: snapshot.status,
      extractionVersion: snapshot.extractionVersion,
      startedAt: snapshot.startedAt,
      completedAt: snapshot.completedAt,
      indexedAt: snapshot.indexedAt,
      freshnessStatus: snapshot.freshness.status,
      freshnessCheckedAt: snapshot.freshness.checkedAt,
      freshnessReason: snapshot.freshness.reason,
      freshnessNextAction: snapshot.freshness.nextAction,
      pendingFileCount: snapshot.freshness.pendingFileCount,
      staleFileCount: snapshot.freshness.staleFileCount,
      degradedReason: snapshot.degradedReason ?? snapshot.freshness.degradedReason,
      languageCoverageJson: JSON.stringify(snapshot.languageCoverage),
      fileCount: snapshot.fileCount,
      symbolCount: snapshot.symbolCount,
      edgeCount: snapshot.edgeCount,
      parseErrorCount: snapshot.parseErrorCount,
      metadataJson: JSON.stringify(snapshot.metadata),
    };

    this.drizzle
      .insert(this.table)
      .values(values)
      .onConflictDoUpdate({
        target: this.table.generationId,
        set: values,
      })
      .run();
  }

  private async refreshGenerationStats(generationId: string): Promise<SourceGraphSnapshot | null> {
    const snapshot = await this.getSnapshot(generationId);
    if (!snapshot) {
      return null;
    }

    const fileRows = this.drizzle
      .select({
        language: sourceGraphFiles.language,
        parseErrorsJson: sourceGraphFiles.parseErrorsJson,
      })
      .from(sourceGraphFiles)
      .where(eq(sourceGraphFiles.generationId, generationId))
      .all();
    const symbolCount = countRows(
      this.drizzle
        .select({ cnt: count() })
        .from(sourceGraphSymbols)
        .where(eq(sourceGraphSymbols.generationId, generationId))
        .all()
    );
    const edgeCount = countRows(
      this.drizzle
        .select({ cnt: count() })
        .from(sourceGraphEdges)
        .where(eq(sourceGraphEdges.generationId, generationId))
        .all()
    );
    const languageCoverage = Array.from(
      new Set(fileRows.map((row) => row.language).filter((language) => language.trim() !== ''))
    ).sort();
    const parseErrorCount = fileRows.reduce(
      (total, row) => total + parseJsonArray<SourceGraphParseError>(row.parseErrorsJson).length,
      0
    );
    const now = Date.now();

    this.drizzle
      .update(this.table)
      .set({
        fileCount: fileRows.length,
        symbolCount,
        edgeCount,
        parseErrorCount,
        languageCoverageJson: JSON.stringify(languageCoverage),
        freshnessCheckedAt: now,
      })
      .where(eq(this.table.generationId, generationId))
      .run();

    return this.getSnapshot(generationId);
  }

  private async resolveProjectRoot(
    generationId: string,
    explicitProjectRoot?: string
  ): Promise<string> {
    if (explicitProjectRoot?.trim()) {
      return explicitProjectRoot.trim();
    }
    const snapshot = await this.getRequiredSnapshot(generationId);
    return snapshot.projectRoot;
  }

  private async getRequiredSnapshot(generationId: string): Promise<SourceGraphSnapshot> {
    const snapshot = await this.getSnapshot(generationId);
    if (!snapshot) {
      throw new Error(`Source graph generation not found: ${generationId}`);
    }
    return snapshot;
  }

  private async getRequiredFile(
    generationId: string,
    repoRelativePath: string
  ): Promise<SourceFileNode> {
    const file = await this.findFile(generationId, repoRelativePath);
    if (!file) {
      throw new Error(`Source graph file not found: ${generationId}:${repoRelativePath}`);
    }
    return file;
  }

  private async getRequiredSymbol(
    generationId: string,
    symbolId: string
  ): Promise<SourceSymbolNode> {
    const symbol = await this.getSymbol(generationId, symbolId);
    if (!symbol) {
      throw new Error(`Source graph symbol not found: ${generationId}:${symbolId}`);
    }
    return symbol;
  }

  private async getRequiredEdge(generationId: string, edgeId: string): Promise<SourceGraphEdge> {
    const rows = this.drizzle
      .select()
      .from(sourceGraphEdges)
      .where(
        and(eq(sourceGraphEdges.generationId, generationId), eq(sourceGraphEdges.edgeId, edgeId))
      )
      .limit(1)
      .all();
    if (rows.length === 0) {
      throw new Error(`Source graph edge not found: ${generationId}:${edgeId}`);
    }
    return mapEdgeRow(rows[0]);
  }
}

function mapGenerationRow(row: GenerationRow): SourceGraphSnapshot {
  return createSourceGraphSnapshot({
    generationId: row.generationId,
    projectRoot: row.projectRoot,
    repoId: row.repoId,
    graphRoot: row.graphRoot,
    projectScope: row.projectScope ?? undefined,
    extractionVersion: row.extractionVersion,
    status: row.status as SourceGraphSnapshotStatus,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? undefined,
    indexedAt: row.indexedAt ?? undefined,
    freshness: {
      status: row.freshnessStatus as SourceGraphFreshnessState,
      checkedAt: row.freshnessCheckedAt,
      generationId: row.generationId,
      indexedAt: row.indexedAt ?? undefined,
      reason: row.freshnessReason ?? undefined,
      nextAction: row.freshnessNextAction ?? undefined,
      pendingFileCount: row.pendingFileCount,
      staleFileCount: row.staleFileCount,
      degradedReason: row.degradedReason ?? undefined,
    },
    languageCoverage: parseJsonArray<string>(row.languageCoverageJson),
    fileCount: row.fileCount,
    symbolCount: row.symbolCount,
    edgeCount: row.edgeCount,
    parseErrorCount: row.parseErrorCount,
    degradedReason: row.degradedReason ?? undefined,
    metadata: parseJsonRecord(row.metadataJson),
  });
}

function mapFileRow(row: FileRow): SourceFileNode {
  return createSourceFileNode({
    generationId: row.generationId,
    projectRoot: row.projectRoot,
    repoRelativePath: row.repoRelativePath,
    language: row.language,
    contentHash: row.contentHash,
    sizeBytes: row.sizeBytes,
    mtimeMs: row.mtimeMs,
    indexedAt: row.indexedAt,
    classification: row.classification as SourceFileNode['classification'],
    parseStatus: row.parseStatus as SourceFileNode['parseStatus'],
    parseErrors: parseJsonArray<SourceGraphParseError>(row.parseErrorsJson),
    lineCount: row.lineCount ?? undefined,
    metadata: parseJsonRecord(row.metadataJson),
  });
}

function mapSymbolRow(row: SymbolRow): SourceSymbolNode {
  return createSourceSymbolNode({
    generationId: row.generationId,
    symbolId: row.symbolId,
    displayName: row.displayName,
    qualifiedName: row.qualifiedName ?? undefined,
    kind: row.kind,
    filePath: row.filePath,
    range: {
      startLine: row.startLine,
      startColumn: row.startColumn,
      endLine: row.endLine,
      endColumn: row.endColumn,
    },
    selectionRange: mapOptionalRange(
      row.selectionStartLine,
      row.selectionStartColumn,
      row.selectionEndLine,
      row.selectionEndColumn
    ),
    signature: row.signature ?? undefined,
    containerSymbolId: row.containerSymbolId ?? undefined,
    exported: row.exported === 1,
    imported: row.imported === 1,
    metadata: parseJsonRecord(row.metadataJson),
    provenance: parseJsonRecord(row.provenanceJson),
  });
}

function mapEdgeRow(row: EdgeRow): SourceGraphEdge {
  return createSourceGraphEdge({
    generationId: row.generationId,
    edgeId: row.edgeId,
    kind: row.kind,
    fromSymbolId: row.fromSymbolId ?? undefined,
    toSymbolId: row.toSymbolId ?? undefined,
    fromFilePath: row.fromFilePath ?? undefined,
    toFilePath: row.toFilePath ?? undefined,
    siteFilePath: row.siteFilePath ?? undefined,
    site: mapOptionalRange(
      row.siteStartLine,
      row.siteStartColumn,
      row.siteEndLine,
      row.siteEndColumn
    ),
    provenance: row.provenance as SourceGraphEdge['provenance'],
    confidence: row.confidence,
    source: row.source ?? undefined,
    metadata: parseJsonRecord(row.metadataJson),
  });
}

function mapOptionalRange(
  startLine: number | null,
  startColumn: number | null,
  endLine: number | null,
  endColumn: number | null
): SourceRange | undefined {
  if (startLine === null || endLine === null) {
    return undefined;
  }
  return {
    startLine,
    startColumn: startColumn ?? 0,
    endLine,
    endColumn: endColumn ?? 0,
  };
}

function parseJsonRecord(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray<T>(raw: string | null): T[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function countRows(rows: Array<{ cnt: number }>): number {
  return rows[0]?.cnt ?? 0;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 50;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return 50;
  }
  return Math.min(limit, 500);
}
