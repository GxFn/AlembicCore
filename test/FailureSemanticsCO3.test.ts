/**
 * CO3 failure-semantics negative tests — one per remediated path.
 *
 * Posture: WRITE STRICT / READ TOLERANT (user-decided).
 *  - W1 audit-insert failure → PersistenceError (prepare + run)
 *  - W2 files-persisted-but-DB-failed → DivergenceError + stable diagnostic
 *  - W3 lifecycle bypass via update() → ValidationError (transition guard route)
 *  - W4 feedback save loss → PersistenceError
 *  - C9 feedback record input validation → ValidationError
 *  - R1 search index missing table → degraded-but-usable with stable reason
 *  - R2 feedback load failure → degraded-but-usable with stable diagnostic
 *  - V1 vector orphan reconcile → explicit contract + diagnostics
 *  - C6 similarity walk symlink/depth guards
 *  - C8 SyncCoordinator destroy unbinds all listeners
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeEntry } from '../src/domain/knowledge/KnowledgeEntry.js';
import { EventBus } from '../src/infrastructure/event/EventBus.js';
import Logger from '../src/infrastructure/logging/Logger.js';
import { KnowledgeUnitOfWork } from '../src/repository/knowledge/KnowledgeUnitOfWork.js';
import { RawDbSyncAdapter } from '../src/repository/sync/SyncRepoAdapter.js';
import { findSimilarRecipes } from '../src/service/candidate/SimilarityService.js';
import { KnowledgeService } from '../src/service/knowledge/KnowledgeService.js';
import { KnowledgeSyncService } from '../src/service/knowledge/KnowledgeSyncService.js';
import { FeedbackCollector } from '../src/service/quality/FeedbackCollector.js';
import { SearchEngine } from '../src/service/search/SearchEngine.js';
import { SyncCoordinator } from '../src/service/vector/SyncCoordinator.js';
import { CORE_DIAGNOSTIC_CODES } from '../src/shared/DiagnosticCodes.js';
import { DivergenceError, PersistenceError, ValidationError } from '../src/shared/errors/index.js';
import pathGuard from '../src/shared/PathGuard.js';

function makeTmpProject(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/* ═══ W1: audit-insert failure → typed error ═══ */

describe('W1 SyncRepoAdapter audit-insert failure', () => {
  test('prepare failure throws PersistenceError instead of returning null', () => {
    const db = {
      prepare(sql: string) {
        if (sql.includes('audit_logs')) {
          throw new Error('no such table: audit_logs');
        }
        return { run() {}, get() {}, all: () => [] };
      },
    };
    const adapter = new RawDbSyncAdapter(db as never);

    let caught: unknown;
    try {
      adapter.createAuditInsertStmt();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as PersistenceError).code).toBe('PERSISTENCE_ERROR');
    expect((caught as PersistenceError).details.operation).toBe('audit-insert-prepare');
  });

  test('audit insert run failure throws PersistenceError instead of warn-and-continue', () => {
    const svc = new KnowledgeSyncService('/tmp/co3-w1-not-used');
    const failingStmt = {
      run() {
        throw new Error('disk I/O error');
      },
    };

    let caught: unknown;
    try {
      svc._logViolation(failingStmt, 'entry-1', 'recipes/x.md', 'h1', 'h2');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as PersistenceError).details.operation).toBe('audit-insert-run');
    expect((caught as PersistenceError).details.entryId).toBe('entry-1');
  });
});

/* ═══ W2: files persisted + DB failed → DivergenceError + diagnostic ═══ */

describe('W2 KnowledgeUnitOfWork file/DB divergence', () => {
  function makeFileStore() {
    return {
      persisted: [] as string[],
      removed: [] as string[],
      persist(entry: KnowledgeEntry) {
        this.persisted.push(entry.id);
      },
      moveOnLifecycleChange() {},
      remove(entry: KnowledgeEntry) {
        this.removed.push(entry.id);
      },
    };
  }

  test('DB transaction failure after file success throws DivergenceError, keeps files', () => {
    const fileStore = makeFileStore();
    const busyErr = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    const drizzle = {
      transaction() {
        throw busyErr;
      },
    };
    const uow = new KnowledgeUnitOfWork(drizzle as never, fileStore as never);
    const entry = new KnowledgeEntry({ id: 'k1', title: 'T1' });
    uow.registerFileOp({ type: 'write', entry });
    uow.registerDbChange(() => {});

    let caught: unknown;
    try {
      uow.commit();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DivergenceError);
    const divergence = caught as DivergenceError;
    expect(divergence.code).toBe('STATE_DIVERGENCE');
    expect(divergence.details.code).toBe(CORE_DIAGNOSTIC_CODES.knowledgeFileDbDivergence);
    expect(divergence.details.entryIds).toEqual(['k1']);
    expect(divergence.details.reconcileVia).toBe('KnowledgeSyncService.sync');
    // C7 busy diagnostics: contention is classified, not retried away.
    expect(divergence.details.sqliteBusy).toBe(true);
    // Files are the source of truth — never rolled back on DB failure.
    expect(fileStore.persisted).toEqual(['k1']);
    expect(fileStore.removed).toEqual([]);
  });

  test('successful commit reports dbCommitted with completed file ops', () => {
    const fileStore = makeFileStore();
    const drizzle = {
      transaction(fn: (tx: unknown) => void) {
        fn({});
      },
    };
    const uow = new KnowledgeUnitOfWork(drizzle as never, fileStore as never);
    uow.registerFileOp({ type: 'write', entry: new KnowledgeEntry({ id: 'k2', title: 'T2' }) });
    uow.registerDbChange(() => {});

    const result = uow.commit();
    expect(result).toEqual({ dbCommitted: true, fileOpsCompleted: 1 });
  });
});

/* ═══ W3: lifecycle bypass via update() → typed error ═══ */

describe('W3 KnowledgeService.update lifecycle bypass', () => {
  function makeService() {
    const repository = {
      async findById(id: string) {
        return new KnowledgeEntry({ id, title: 'T' });
      },
      updates: [] as Array<Record<string, unknown>>,
      async update(id: string, dbUpdates: Record<string, unknown>) {
        this.updates.push(dbUpdates);
        return new KnowledgeEntry({ id, title: (dbUpdates.title as string) || 'T' });
      },
    };
    const auditLogger = { async log() {} };
    const service = new KnowledgeService(repository as never, auditLogger, null, null, {});
    return { service, repository };
  }

  test('passing lifecycle directly is rejected with ValidationError', async () => {
    const { service, repository } = makeService();
    let caught: unknown;
    try {
      await service.update('k1', { lifecycle: 'active' } as never, { userId: 'u1' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const validation = caught as ValidationError;
    expect(validation.details.reason).toBe('lifecycle-transition-bypass');
    expect(validation.details.fields).toEqual(['lifecycle']);
    expect(validation.message).toContain('publish/deprecate/reactivate');
    expect(repository.updates).toEqual([]);
  });

  test('every lifecycle-managed field is guarded', async () => {
    const { service } = makeService();
    const bypass = {
      lifecycleHistory: [],
      publishedAt: 1,
      publishedBy: 'u',
      reviewedBy: 'u',
      reviewedAt: 1,
      rejectionReason: 'r',
      autoApprovable: true,
    };
    let caught: unknown;
    try {
      await service.update('k1', bypass as never, { userId: 'u1' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).details.fields).toEqual(Object.keys(bypass));
  });

  test('whitelisted fields still update (no over-blocking)', async () => {
    const { service, repository } = makeService();
    const updated = await service.update('k1', { title: 'New title' }, { userId: 'u1' });
    expect(updated.title).toBe('New title');
    expect(repository.updates).toHaveLength(1);
    expect(repository.updates[0].title).toBe('New title');
  });
});

/* ═══ W4 + C9 + R2: FeedbackCollector ═══ */

describe('FeedbackCollector failure semantics', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeTmpProject('co3-feedback-');
    pathGuard._reset();
    pathGuard.configure({ projectRoot });
  });

  afterEach(() => {
    pathGuard._reset();
    fs.rmSync(projectRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('W4: save loss surfaces as PersistenceError instead of silent drop', () => {
    const wz = {
      knowledge: (file: string) => path.join(projectRoot, 'Alembic', file),
      writeFile() {
        throw new Error('disk full');
      },
    };
    const collector = new FeedbackCollector(projectRoot, { wz: wz as never });

    let caught: unknown;
    try {
      collector.record('view', 'recipe-1');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as PersistenceError).details.operation).toBe('feedback-save');
  });

  test('C9: malformed inputs are rejected with ValidationError before any write', () => {
    const collector = new FeedbackCollector(projectRoot);
    expect(() => collector.record('', 'recipe-1')).toThrow(ValidationError);
    expect(() => collector.record('view', '')).toThrow(ValidationError);
    expect(() => collector.record('view', 'recipe-1', [] as never)).toThrow(ValidationError);
    expect(() => collector.record(undefined as never, 'recipe-1')).toThrow(ValidationError);
  });

  test('R2: corrupt feedback store degrades to empty-but-usable with stable diagnostic', () => {
    const feedbackDir = path.join(projectRoot, 'Alembic');
    fs.mkdirSync(feedbackDir, { recursive: true });
    fs.writeFileSync(path.join(feedbackDir, 'feedback.json'), '{not valid json');

    const warnSpy = vi.spyOn(Logger.getInstance(), 'warn');
    const collector = new FeedbackCollector(projectRoot);

    // Degradation carries the stable reason code.
    const loadWarning = warnSpy.mock.calls.find(
      (call) =>
        (call[1] as Record<string, unknown> | undefined)?.code ===
        CORE_DIAGNOSTIC_CODES.feedbackLoadFailed
    );
    expect(loadWarning).toBeDefined();

    // Read path stays usable: stats work and new events can be recorded.
    expect(collector.getGlobalStats().totalEvents).toBe(0);
    collector.record('view', 'recipe-1');
    expect(collector.getGlobalStats().totalEvents).toBe(1);
  });
});

/* ═══ R1: search index missing table → visibly degraded, usable ═══ */

describe('R1 SearchEngine degraded index', () => {
  test('missing knowledge table yields degraded searchMeta with stable reason, not a silent empty list', async () => {
    const knowledgeRepo = {
      findNonDeprecatedSync() {
        throw new Error('no such table: knowledge_entries');
      },
    };
    const sourceRefRepo = { searchSync: () => [] };
    const engine = new SearchEngine(
      { prepare: () => ({ all: () => [] }) } as never,
      {
        knowledgeRepo,
        sourceRefRepo,
      } as never
    );

    const response = await engine.search('anything', { mode: 'weighted' });

    expect(Array.isArray(response.items)).toBe(true); // read path usable
    expect(response.searchMeta?.degraded).toBe(true);
    expect(response.searchMeta?.degradedReason).toBe('knowledge-table-missing');
  });

  test('healthy index does not mark responses degraded', async () => {
    const knowledgeRepo = {
      findNonDeprecatedSync: () => [
        { id: 'k1', title: 'Hello world', lifecycle: 'active', kind: 'pattern' },
      ],
    };
    const sourceRefRepo = { searchSync: () => [] };
    const engine = new SearchEngine(
      { prepare: () => ({ all: () => [] }) } as never,
      {
        knowledgeRepo,
        sourceRefRepo,
      } as never
    );

    const response = await engine.search('hello', { mode: 'weighted' });
    expect(response.searchMeta?.degraded).toBeUndefined();
    expect(response.searchMeta?.degradedReason).toBeUndefined();
  });
});

/* ═══ V1: vector orphan reconcile contract + diagnostics ═══ */

describe('V1 SyncCoordinator reconcile', () => {
  function makeCoordinator(vectorStore: Record<string, unknown>) {
    return new SyncCoordinator({
      vectorStore: vectorStore as never,
      embedProvider: { embed: async () => [[0.1]] } as never,
      contextualEnricher: null,
      debounceMs: 5,
    });
  }

  test('orphan removal failures are counted in errors and logged with stable code', async () => {
    const removed: string[] = [];
    const vectorStore = {
      listIds: async () => ['entry_orphan-a', 'entry_orphan-b', 'unrelated_c'],
      remove: async (id: string) => {
        if (id === 'entry_orphan-a') {
          throw new Error('store locked');
        }
        removed.push(id);
      },
      batchUpsert: async () => {},
    };
    const warnSpy = vi.spyOn(Logger.getInstance(), 'warn');
    const coordinator = makeCoordinator(vectorStore);
    const db = { prepare: () => ({ all: () => [] }) };

    const result = await coordinator.reconcile(db);

    expect(result.orphansRemoved).toBe(1);
    expect(removed).toEqual(['entry_orphan-b']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('orphan-remove-failed:entry_orphan-a');
    const orphanWarning = warnSpy.mock.calls.find(
      (call) =>
        (call[1] as Record<string, unknown> | undefined)?.code ===
        CORE_DIAGNOSTIC_CODES.vectorOrphanRemoveFailed
    );
    expect(orphanWarning).toBeDefined();
    vi.restoreAllMocks();
    coordinator.destroy();
  });

  test('unavailable DB degrades reconcile with stable diagnostic instead of silent return', async () => {
    const vectorStore = {
      listIds: async () => ['entry_x'],
      remove: async () => {},
      batchUpsert: async () => {},
    };
    const warnSpy = vi.spyOn(Logger.getInstance(), 'warn');
    const coordinator = makeCoordinator(vectorStore);
    const db = {
      prepare: () => {
        throw new Error('no such table: knowledge_entries');
      },
    };

    const result = await coordinator.reconcile(db);

    expect(result).toEqual({ orphansRemoved: 0, missingSynced: 0, errors: [] });
    const dbWarning = warnSpy.mock.calls.find(
      (call) =>
        (call[1] as Record<string, unknown> | undefined)?.code ===
        CORE_DIAGNOSTIC_CODES.vectorReconcileDbUnavailable
    );
    expect(dbWarning).toBeDefined();
    vi.restoreAllMocks();
    coordinator.destroy();
  });

  test('C8: destroy unbinds both EventBus listeners (knowledge:deleted no longer leaks)', () => {
    const vectorStore = {
      listIds: async () => [],
      remove: async () => {},
      batchUpsert: async () => {},
    };
    const coordinator = makeCoordinator(vectorStore);
    const eventBus = new EventBus();

    coordinator.bindEventBus(eventBus);
    expect(eventBus.listenerCount('knowledge:changed')).toBe(1);
    expect(eventBus.listenerCount('knowledge:deleted')).toBe(1);

    coordinator.destroy();
    expect(eventBus.listenerCount('knowledge:changed')).toBe(0);
    expect(eventBus.listenerCount('knowledge:deleted')).toBe(0);

    // Idempotent second destroy.
    expect(() => coordinator.destroy()).not.toThrow();
  });
});

/* ═══ C6: similarity walk guards ═══ */

describe('C6 SimilarityService walk guards', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeTmpProject('co3-similarity-');
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('symlink cycles do not hang the walk and real recipes are still found', () => {
    const recipesDir = path.join(projectRoot, 'Alembic', 'recipes');
    fs.mkdirSync(recipesDir, { recursive: true });
    fs.writeFileSync(
      path.join(recipesDir, 'sample.md'),
      '# Singleton pattern\n\n```ts\nclass Singleton { static instance; }\n```\n'
    );
    // recipes/loop → recipes (cycle); without the symlink guard this recurses forever.
    fs.symlinkSync(recipesDir, path.join(recipesDir, 'loop'), 'dir');

    const results = findSimilarRecipes(
      projectRoot,
      {
        title: 'Singleton pattern',
        summary: 'Singleton pattern',
        code: 'class Singleton { static instance; }',
      },
      { threshold: 0.1 }
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe('sample.md');
  });

  test('walk truncates at the depth limit with a stable diagnostic', () => {
    const recipesDir = path.join(projectRoot, 'Alembic', 'recipes');
    let deep = recipesDir;
    for (let level = 0; level < 20; level++) {
      deep = path.join(deep, `level-${level}`);
    }
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, 'too-deep.md'), '# Too deep\n\n```ts\nconst x = 1;\n```\n');

    const warnSpy = vi.spyOn(Logger.getInstance(), 'warn');
    const results = findSimilarRecipes(
      projectRoot,
      { title: 'Too deep', summary: 'Too deep', code: 'const x = 1;' },
      { threshold: 0.1 }
    );

    expect(results).toEqual([]);
    const truncationWarning = warnSpy.mock.calls.find(
      (call) =>
        (call[1] as Record<string, unknown> | undefined)?.code ===
        CORE_DIAGNOSTIC_CODES.similarityWalkTruncated
    );
    expect(truncationWarning).toBeDefined();
  });
});
