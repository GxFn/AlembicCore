import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RecipeFreshnessService,
  type RecipeFreshnessVectorService,
  SourceRefReconciler,
} from '../src/knowledge.js';
import type {
  RecipeSourceRefEntity,
  RecipeSourceRefInsert,
} from '../src/repository/sourceref/RecipeSourceRefRepository.js';

class InMemorySourceRefRepository {
  accessible = true;
  rows: RecipeSourceRefEntity[];

  constructor(rows: RecipeSourceRefEntity[] = []) {
    this.rows = rows;
  }

  isAccessible(): boolean {
    return this.accessible;
  }

  findByRecipeId(recipeId: string): RecipeSourceRefEntity[] {
    return this.rows.filter((row) => row.recipeId === recipeId);
  }

  findOne(recipeId: string, sourcePath: string): RecipeSourceRefEntity | null {
    return (
      this.rows.find((row) => row.recipeId === recipeId && row.sourcePath === sourcePath) ?? null
    );
  }

  deleteOne(recipeId: string, sourcePath: string): boolean {
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (row) => !(row.recipeId === recipeId && row.sourcePath === sourcePath)
    );
    return this.rows.length !== before;
  }

  upsert(data: RecipeSourceRefInsert): void {
    const existing = this.findOne(data.recipeId, data.sourcePath);
    const row: RecipeSourceRefEntity = {
      newPath: data.newPath ?? null,
      recipeId: data.recipeId,
      sourcePath: data.sourcePath,
      status: data.status ?? 'active',
      verifiedAt: data.verifiedAt,
    };
    if (existing) {
      Object.assign(existing, row);
      return;
    }
    this.rows.push(row);
  }
}

function buildReconciler(
  projectRoot: string,
  repo: InMemorySourceRefRepository
): SourceRefReconciler {
  return new SourceRefReconciler(
    projectRoot,
    repo as never,
    { findAllIdAndReasoning: async () => [] } as never,
    { ttlMs: 0 }
  );
}

function availableVectorService(): RecipeFreshnessVectorService {
  return {
    getAvailability: vi.fn(async () => ({
      available: true,
      embedProviderConfigured: true,
      probeStatus: 'available',
      reason: 'embed-provider-ready',
      status: 'available',
    })),
    syncEntry: vi.fn(async () => undefined),
    syncRecipeSemanticRegions: vi.fn(async () => ({
      embedded: 1,
      errors: [],
      generated: 1,
      generatedMetadata: [],
      removed: 0,
      scanned: 1,
      skipped: 0,
      status: 'completed',
      upserted: 1,
    })),
  };
}

describe('Recipe freshness primitives', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-core-rg7-'));
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/live.ts'), 'export const live = true;\n');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('refreshes source refs for one recipe without touching another recipe', async () => {
    const repo = new InMemorySourceRefRepository([
      {
        newPath: null,
        recipeId: 'r1',
        sourcePath: 'src/dropped.ts',
        status: 'active',
        verifiedAt: 1,
      },
      {
        newPath: null,
        recipeId: 'r2',
        sourcePath: 'src/dropped.ts',
        status: 'active',
        verifiedAt: 1,
      },
    ]);
    const reconciler = buildReconciler(tmpDir, repo);

    const report = await reconciler.reconcileRecipeSourceRefs(
      { id: 'r1', reasoning: { sources: ['src/live.ts', 'src/missing.ts'] } },
      { force: true }
    );

    expect(report).toMatchObject({
      active: 1,
      cleaned: 1,
      inserted: 2,
      recipesProcessed: 1,
      stale: 1,
    });
    expect(repo.findByRecipeId('r1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourcePath: 'src/live.ts', status: 'active' }),
        expect.objectContaining({ sourcePath: 'src/missing.ts', status: 'stale' }),
      ])
    );
    expect(repo.findOne('r1', 'src/dropped.ts')).toBeNull();
    expect(repo.findOne('r2', 'src/dropped.ts')).toMatchObject({ status: 'active' });
  });

  it('keeps existing source refs when reasoning.sources is missing', async () => {
    const repo = new InMemorySourceRefRepository([
      {
        newPath: null,
        recipeId: 'r1',
        sourcePath: 'src/live.ts',
        status: 'active',
        verifiedAt: 1,
      },
    ]);
    const reconciler = buildReconciler(tmpDir, repo);

    const report = await reconciler.reconcileRecipeSourceRefs(
      { id: 'r1', reasoning: { confidence: 0.8 } },
      { force: true }
    );

    expect(report).toMatchObject({
      failed: 1,
      recipesProcessed: 1,
    });
    expect(report.blockers?.[0]).toContain('missing');
    expect(repo.findOne('r1', 'src/live.ts')).toMatchObject({ status: 'active' });
  });

  it('keeps existing source refs when reasoning JSON cannot be parsed', async () => {
    const repo = new InMemorySourceRefRepository([
      {
        newPath: null,
        recipeId: 'r1',
        sourcePath: 'src/live.ts',
        status: 'active',
        verifiedAt: 1,
      },
    ]);
    const reconciler = buildReconciler(tmpDir, repo);

    const report = await reconciler.reconcileRecipeSourceRefs(
      { id: 'r1', reasoning: '{not-json' },
      { force: true }
    );

    expect(report).toMatchObject({
      failed: 1,
      recipesProcessed: 1,
    });
    expect(report.blockers?.[0]).toContain('parse-error');
    expect(repo.findOne('r1', 'src/live.ts')).toMatchObject({ status: 'active' });
  });

  it('clears dropped refs only when reasoning.sources is explicitly empty', async () => {
    const repo = new InMemorySourceRefRepository([
      {
        newPath: null,
        recipeId: 'r1',
        sourcePath: 'src/live.ts',
        status: 'active',
        verifiedAt: 1,
      },
    ]);
    const reconciler = buildReconciler(tmpDir, repo);

    const report = await reconciler.reconcileRecipeSourceRefs(
      { id: 'r1', reasoning: { sources: [] } },
      { force: true }
    );

    expect(report).toMatchObject({
      cleaned: 1,
      failed: 0,
      recipesProcessed: 1,
    });
    expect(report.blockers).toEqual([]);
    expect(repo.findOne('r1', 'src/live.ts')).toBeNull();
  });

  it('keeps existing project-relative source refs with line ranges active', async () => {
    const existingFeedRepository =
      'Sources/Infrastructure/Networking/Repository/FeedRepository.swift';
    const existingHomeView = 'Sources/Features/Home/Views/HomeCategoryView.swift';
    const missingVideoFeedViewModel = 'Sources/Features/VideoFeed/VideoFeedViewModel.swift';
    for (const sourcePath of [existingFeedRepository, existingHomeView]) {
      fs.mkdirSync(path.dirname(path.join(tmpDir, sourcePath)), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, sourcePath), 'let live = true\n');
    }

    const repo = new InMemorySourceRefRepository();
    const reconciler = buildReconciler(tmpDir, repo);

    const report = await reconciler.reconcileRecipeSourceRefs(
      {
        id: 'rg10-recipe',
        reasoning: {
          sources: [
            `${missingVideoFeedViewModel}:1-78`,
            `${existingFeedRepository}:1-69`,
            `${existingHomeView}:1-150`,
          ],
        },
      },
      { force: true }
    );

    expect(report).toMatchObject({
      active: 2,
      inserted: 3,
      recipesProcessed: 1,
      stale: 1,
    });
    expect(repo.findOne('rg10-recipe', `${existingFeedRepository}:1-69`)).toMatchObject({
      status: 'active',
    });
    expect(repo.findOne('rg10-recipe', `${existingHomeView}:1-150`)).toMatchObject({
      status: 'active',
    });
    expect(repo.findOne('rg10-recipe', `${missingVideoFeedViewModel}:1-78`)).toMatchObject({
      status: 'stale',
    });
  });

  it('refreshes source refs then vector entry and region indexes when vectors are available', async () => {
    const repo = new InMemorySourceRefRepository();
    const reconciler = buildReconciler(tmpDir, repo);
    const vectorService = availableVectorService();
    const service = new RecipeFreshnessService({
      sourceRefReconciler: reconciler,
      sourceRefRepository: repo,
      vectorService,
    });

    const result = await service.refreshRecipes([
      {
        content: { markdown: 'Use the live source file.' },
        id: 'r1',
        kind: 'recipe',
        reasoning: { sources: ['src/live.ts'] },
        title: 'Live source rule',
      },
    ]);

    expect(result).toMatchObject({
      errors: [],
      processed: 1,
      retrievalMayBeStale: false,
      status: 'completed',
    });
    expect(result.recipes[0]?.sourceRefsBridge).toEqual({
      refs: ['src/live.ts'],
      status: 'active',
    });
    expect(vectorService.syncEntry).not.toHaveBeenCalled();
    expect(result.recipes[0]?.vector.entrySyncStatus).toBe('retired');
    expect(vectorService.syncRecipeSemanticRegions).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'r1' })],
      { sourceRefsBridgeByRecipeId: { r1: { refs: ['src/live.ts'], status: 'active' } } }
    );
  });

  it('reports degraded vector availability and skips vector writes observably', async () => {
    const repo = new InMemorySourceRefRepository();
    const reconciler = buildReconciler(tmpDir, repo);
    const vectorService = availableVectorService();
    vi.mocked(vectorService.getAvailability).mockResolvedValue({
      available: false,
      embedProviderConfigured: false,
      probeStatus: 'not-applicable',
      reason: 'embed-provider-missing',
      status: 'unavailable',
    });
    const service = new RecipeFreshnessService({
      sourceRefReconciler: reconciler,
      sourceRefRepository: repo,
      vectorService,
    });

    const result = await service.refreshRecipes([
      { content: 'body', id: 'r1', reasoning: { sources: ['src/live.ts'] }, title: 'Recipe' },
    ]);

    expect(result.status).toBe('degraded');
    expect(result.retrievalMayBeStale).toBe(true);
    expect(result.recipes[0]?.vector).toMatchObject({
      degradedReason: 'embed-provider-missing',
      entrySyncStatus: 'skipped',
      regionSyncStatus: 'skipped',
      status: 'degraded',
    });
    expect(vectorService.syncEntry).not.toHaveBeenCalled();
    expect(vectorService.syncRecipeSemanticRegions).not.toHaveBeenCalled();
  });

  it('reports table-inaccessible source refs without pretending retrieval is fresh', async () => {
    const repo = new InMemorySourceRefRepository();
    repo.accessible = false;
    const reconciler = buildReconciler(tmpDir, repo);
    const service = new RecipeFreshnessService({
      sourceRefReconciler: reconciler,
      sourceRefRepository: repo,
      vectorService: null,
    });

    const result = await service.refreshRecipes([
      { content: 'body', id: 'r1', reasoning: { sources: ['src/live.ts'] }, title: 'Recipe' },
    ]);

    expect(result.status).toBe('failed');
    expect(result.errors).toContain('source_refs:table-inaccessible');
    expect(result.recipes[0]?.sourceRefs.status).toBe('table-inaccessible');
    expect(result.recipes[0]?.retrievalMayBeStale).toBe(true);
  });
});
