import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { KnowledgeService, KnowledgeSyncService } from '../../src/knowledge.js';
import {
  HnswVectorAdapter,
  IndexingPipeline,
  VectorService,
  buildRecipeSemanticRegionChunks,
} from '../../src/vector.js';
import { EventBus } from '../../src/infrastructure/event/EventBus.js';
import { readAlembicMigrationBundleManifest } from '../../src/database.js';
import {
  WorkspaceResolver,
  initializePrivateCorpusRevisionV1,
  openPrivateCorpusRevisionDatabaseV1,
  createPrivateCorpusRevisionCheckpointV1,
  validatePrivateCorpusRevisionCheckpointV1,
} from '../../src/workspace.js';
import { createProjectDescriptor } from '../../src/shared/ProjectScope.js';
import { hashBytes, hashCanonicalJson } from '../../src/projectContextFoundation.js';
import { createKnowledgeRuntime } from '../../test/support/knowledge-runtime.js';
import { observeCase } from './observation.js';

const context = { userId: 'atlas-fixture' };
const seed = (id: string) => ({
  id,
  title: 'Atlas durable recovery specimen',
  language: 'typescript',
  category: 'architecture',
  kind: 'pattern' as const,
  lifecycle: 'active' as const,
  content: { markdown: 'Use the exact identity to inspect durable recovery.' },
  whenClause: 'When a durable mutation fails',
  doClause: 'Inspect durable truth before retry',
  reasoning: { whyStandard: 'Controlled Atlas fixture', sources: ['src/example.ts:1'] },
});
const rowCount = (
  db: Awaited<ReturnType<typeof createKnowledgeRuntime>>['runtime']['sqlite'],
  id: string,
) =>
  (db.prepare('SELECT count(*) AS n FROM knowledge_entries WHERE id = ?').get(id) as { n: number })
    .n;

describe('Atlas persistence recovery', () => {
  it('deletion DB failure leaves a retryable identity', async () => {
    const env = await createKnowledgeRuntime();
    try {
      const id = '77777777-7777-4777-8777-777777777761';
      const entry = await env.seed(seed(id)),
        file = path.join(env.root, entry.sourceFile!);
      const eventBus = new EventBus();
      let events = 0;
      eventBus.on('knowledge:deleted', () => events++);
      const service = new KnowledgeService(env.repo, { log: async () => {} }, null, null, {
        fileWriter: env.writer,
        eventBus,
      });
      const before = {
        rows: rowCount(env.runtime.sqlite, id),
        fileExists: fs.existsSync(file),
        fileHash: hashBytes(fs.readFileSync(file)),
        events,
      };
      env.runtime.sqlite.exec(
        "CREATE TRIGGER atlas_delete_reject BEFORE DELETE ON knowledge_entries BEGIN SELECT RAISE(ABORT, 'atlas delete DB fault'); END;",
      );
      await expect(service.delete(id, context)).rejects.toMatchObject({
        name: 'DivergenceError',
        details: {
          entryIds: [id],
          operation: 'knowledge.delete',
          reconcileVia: 'KnowledgeService.delete',
        },
      });
      const failed = {
        rows: rowCount(env.runtime.sqlite, id),
        fileExists: fs.existsSync(file),
        events,
      };
      expect(failed).toEqual({ rows: 1, fileExists: false, events: 0 });
      env.runtime.sqlite.exec('DROP TRIGGER atlas_delete_reject');
      const result = await service.delete(id, context);
      const recovered = {
        id: result.id,
        rows: rowCount(env.runtime.sqlite, id),
        fileExists: fs.existsSync(file),
        events,
        sameId: result.id === id,
      };
      expect(recovered).toEqual({ id, rows: 0, fileExists: false, events: 1, sameId: true });
      observeCase('V06', 'V06-D7', 'delete-state', {
        fixture: 'real-markdown-sqlite',
        entryId: id,
        before,
        failed,
        recovered,
      });
    } finally {
      env.close();
    }
  });

  it('deletion listener failure does not restore committed truth', async () => {
    const env = await createKnowledgeRuntime();
    try {
      const id = '77777777-7777-4777-8777-777777777762';
      const entry = await env.seed(seed(id)),
        file = path.join(env.root, entry.sourceFile!);
      const bus = new EventBus();
      let auditAttempts = 0,
        listenerAttempts = 0;
      bus.on('knowledge:deleted', () => {
        listenerAttempts++;
        throw Error('atlas listener fault');
      });
      const service = new KnowledgeService(
        env.repo,
        {
          log: async () => {
            auditAttempts++;
            throw Error('atlas audit fault');
          },
        },
        null,
        null,
        { fileWriter: env.writer, eventBus: bus },
      );
      await expect(service.delete(id, context)).rejects.toThrow('atlas listener fault');
      expect(await env.repo.findById(id)).toBeNull();
      expect(fs.existsSync(file)).toBe(false);
      // audit失败为non-blocking；emit失败已位于持久删除之后。再次delete不能重放该消费者。
      await expect(service.delete(id, context)).rejects.toMatchObject({ name: 'NotFoundError' });
      expect({ auditAttempts, listenerAttempts }).toEqual({
        auditAttempts: 1,
        listenerAttempts: 1,
      });
      observeCase('V06', 'V06-D8', 'delete-post', {
        rows: rowCount(env.runtime.sqlite, id),
        fileExists: fs.existsSync(file),
        auditAttempts,
        listenerAttempts,
        retryRejectedAsNotFound: true,
        auditFailureWasNonBlocking: true,
      });
    } finally {
      env.close();
    }
  });

  it('sync maintenance rejection preserves DB changes and recovers the real vector store', async () => {
    const env = await createKnowledgeRuntime();
    const store = new HnswVectorAdapter(env.root, { quantize: 'none', flushIntervalMs: 60000 });
    let vector: VectorService | undefined, reopened: HnswVectorAdapter | undefined;
    try {
      const id = '77777777-7777-4777-8777-777777777771';
      const entry = await env.seed(seed(id)),
        file = path.join(env.root, entry.sourceFile!);
      await store.init();
      const regions = buildRecipeSemanticRegionChunks(entry.toJSON());
      expect(regions.length).toBeGreaterThan(0);
      const region = regions[0],
        legacy = `entry_${id}`;
      await store.upsert({
        id: legacy,
        content: 'Legacy competitor',
        vector: [1, 0, 0],
        metadata: { recipeId: id },
      });
      await store.upsert({ ...region, metadata: { ...region.metadata }, vector: [0, 1, 0] });
      await store.flush();
      const before = {
        lifecycle: (await env.repo.findById(id))!.lifecycle,
        fileExists: fs.existsSync(file),
        ids: (await store.listIds()).sort(),
      };
      vector = new VectorService({
        vectorStore: store,
        indexingPipeline: new IndexingPipeline({ vectorStore: store, projectRoot: env.root }),
        hybridRetriever: null,
        eventBus: new EventBus(),
        embedProvider: null,
        contextualEnricher: null,
        autoSyncOnCrud: true,
        syncDebounceMs: 60000,
        drizzle: env.runtime.drizzle,
      });
      await vector.initialize();
      const reports: Array<NonNullable<Awaited<ReturnType<VectorService['reconcileIndex']>>>> = [];
      const sync = new KnowledgeSyncService(env.root, {
        vectorMaintenance: {
          reconcileAuthoritativeCorpus: async () => {
            const report = await vector!.reconcileIndex();
            if (report) reports.push(report);
            // 这是fixture接线策略：Core返回errors，包装端口把不完整对账转为reject。
            if (!report || report.errors.length) throw Error('atlas maintenance incomplete');
            await store.flush();
            return report;
          },
        },
      });
      fs.unlinkSync(file);
      const remove = store.remove.bind(store);
      const fault = vi.spyOn(store, 'remove').mockImplementation(async (target) => {
        if (target === region.id) throw Error('atlas region remove fault');
        return remove(target);
      });
      await expect(sync.syncAll(env.runtime.sqlite)).rejects.toThrow(
        'atlas maintenance incomplete',
      );
      const failed = {
        lifecycle: (await env.repo.findById(id))!.lifecycle,
        fileExists: fs.existsSync(file),
        legacyPresent: (await store.getById(legacy)) !== null,
        regionPresent: (await store.getById(region.id)) !== null,
        report: reports[0],
        syncReturnedReport: false,
      };
      expect(failed.lifecycle).toBe('deprecated');
      expect(failed.legacyPresent).toBe(false);
      expect(failed.regionPresent).toBe(true);
      expect(reports[0].errors.length).toBeGreaterThan(0);
      fault.mockRestore();
      const report = await sync.syncAll(env.runtime.sqlite);
      expect(report.vectorMaintenanceStatus).toBe('completed');
      expect(reports.at(-1)!.errors).toEqual([]);
      expect(await store.listIds()).toEqual([]);
      await vector.destroy();
      vector = undefined;
      store.destroy();
      reopened = new HnswVectorAdapter(env.root, { quantize: 'none', flushIntervalMs: 60000 });
      await reopened.init();
      const recovered = {
        lifecycle: (await env.repo.findById(id))!.lifecycle,
        id: (await env.repo.findById(id))!.id,
        sameId: (await env.repo.findById(id))!.id === id,
        maintenanceStatus: report.vectorMaintenanceStatus,
        report: reports.at(-1),
        reopenedIds: await reopened.listIds(),
        legacyPresent: (await reopened.getById(legacy)) !== null,
        regionPresent: (await reopened.getById(region.id)) !== null,
      };
      expect(recovered.lifecycle).toBe('deprecated');
      expect(recovered.report).toMatchObject({ errors: [], finalInspection: { healthy: true } });
      expect(recovered.reopenedIds).toEqual([]);
      expect(recovered.legacyPresent || recovered.regionPresent).toBe(false);
      observeCase('V07', 'V07-S1', 'sync-vector', {
        fixture: 'real-markdown-sqlite-hnsw',
        entryId: id,
        adapterPolicy: 'reconcileIndex errors become rejection in fixture only',
        before,
        failed,
        recovered,
      });
    } finally {
      vi.restoreAllMocks();
      try {
        await vector?.destroy();
      } finally {
        try {
          reopened?.destroy();
        } finally {
          try {
            store.destroy();
          } finally {
            env.close();
          }
        }
      }
    }
  });

  it('sync completed can carry a failed maintenance business report', async () => {
    const env = await createKnowledgeRuntime();
    try {
      const sync = new KnowledgeSyncService(env.root, {
        vectorMaintenance: {
          reconcileAuthoritativeCorpus: async () => ({
            status: 'failed',
            reason: 'controlled-report',
          }),
        },
      });
      const report = await sync.syncAll(env.runtime.sqlite);
      expect(report.vectorMaintenanceStatus).toBe('completed');
      expect(report.vectorMaintenanceReport).toEqual({
        status: 'failed',
        reason: 'controlled-report',
      });
      observeCase('V07', 'V07-S2', 'sync-result', {
        invocationStatus: report.vectorMaintenanceStatus,
        businessReport: report.vectorMaintenanceReport,
        contractOnly: true,
      });
    } finally {
      env.close();
    }
  });

  it('sync read failure and real file absence produce distinguishable orphan observations', async () => {
    const env = await createKnowledgeRuntime();
    try {
      const id = '77777777-7777-4777-8777-777777777773';
      const entry = await env.seed(seed(id)),
        file = path.join(env.root, entry.sourceFile!);
      const initialHash = hashBytes(fs.readFileSync(file));
      const sync = new KnowledgeSyncService(env.root);
      const failOneRead = () => {
        const read = fs.readFileSync.bind(fs);
        let injected = false;
        return vi.spyOn(fs, 'readFileSync').mockImplementation((...args) => {
          if (!injected && args[0] === file) {
            injected = true;
            throw Error('atlas transient read fault');
          }
          return read(...args);
        });
      };
      let fault = failOneRead();
      const dryRun = await sync.syncAll(env.runtime.sqlite, { dryRun: true });
      fault.mockRestore();
      expect(dryRun.skipped).toBe(1);
      expect(dryRun.orphaned).toContain(id);
      expect((await env.repo.findById(id))!.lifecycle).toBe('active');
      fault = failOneRead();
      const write = await sync.syncAll(env.runtime.sqlite);
      fault.mockRestore();
      const failed = {
        skipped: write.skipped,
        orphaned: write.orphaned,
        lifecycle: (await env.repo.findById(id))!.lifecycle,
        fileExists: fs.existsSync(file),
        fileHash: hashBytes(fs.readFileSync(file)),
      };
      expect(failed.orphaned).toContain(id);
      expect(failed).toMatchObject({
        skipped: 1,
        lifecycle: 'deprecated',
        fileExists: true,
        fileHash: initialHash,
      });
      const retry = await sync.syncAll(env.runtime.sqlite);
      const recovered = {
        skipped: retry.skipped,
        orphaned: retry.orphaned,
        lifecycle: (await env.repo.findById(id))!.lifecycle,
        fileHash: hashBytes(fs.readFileSync(file)),
      };
      expect(recovered).toMatchObject({
        skipped: 0,
        orphaned: [],
        lifecycle: 'active',
        fileHash: initialHash,
      });
      fs.unlinkSync(file);
      const absent = await sync.syncAll(env.runtime.sqlite, { dryRun: true });
      expect(absent.orphaned).toContain(id);
      observeCase('V07', 'V07-S3', 'sync-read-skip', {
        entryId: id,
        dryRun: {
          skipped: dryRun.skipped,
          orphaned: dryRun.orphaned,
          maintenanceStatus: dryRun.vectorMaintenanceStatus,
        },
        failed,
        recovered,
        absentControl: { fileExists: fs.existsSync(file), orphaned: absent.orphaned },
        sameFileHash: initialHash === recovered.fileHash,
      });
    } finally {
      vi.restoreAllMocks();
      env.close();
    }
  });

  it('WAL reader blocking ends only after explicit release and checkpoint retry', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-wal-checkpoint-'));
    const folderId = 'atlas-wal-folder';
    const projectScope = createProjectDescriptor({
      controlRoot: path.dirname(root),
      dataRoot: root,
      projectId: 'atlas-wal-project',
      projectScopeId: 'atlas-wal-scope',
      currentFolderId: folderId,
      folders: [{ id: folderId, path: root }],
    });
    const expected = {
      runId: 'atlas-wal-run',
      revisionId: 'atlas-wal-revision',
      analysisFixpointHash: `sha256:${'1'.repeat(64)}`,
      configReceiptHash: `sha256:${'c'.repeat(64)}`,
      runtimeReceiptHash: `sha256:${'d'.repeat(64)}`,
    };
    type Runtime = Awaited<ReturnType<typeof initializePrivateCorpusRevisionV1>>['runtime'];
    let opened: Runtime | undefined;
    let openedReader: Runtime | undefined;
    try {
      const initialized = await initializePrivateCorpusRevisionV1(
        new WorkspaceResolver({ projectRoot: root, projectScope, currentFolderId: folderId }),
        {
          ...expected,
          credentialLocationSymbol: 'config-ref:atlas-wal-fixture',
          acceptedMigrationBundleSemanticHash: hashCanonicalJson(
            readAlembicMigrationBundleManifest(),
          ),
        },
      );
      const { handle, runtime } = initialized;
      opened = runtime;
      const reader = await openPrivateCorpusRevisionDatabaseV1(handle);
      openedReader = reader;
      const count = (db: typeof runtime.sqlite) =>
        (db.prepare('SELECT count(*) AS n FROM atlas_checkpoint_probe').get() as { n: number }).n;
      const checkpointState = () =>
        (
          runtime.sqlite.pragma('wal_checkpoint(PASSIVE)') as Array<{
            busy: number;
            log: number;
            checkpointed: number;
          }>
        )[0];
      runtime.sqlite.exec(
        'CREATE TABLE atlas_checkpoint_probe(id INTEGER); INSERT INTO atlas_checkpoint_probe VALUES(1)',
      );
      runtime.sqlite.pragma('wal_checkpoint(TRUNCATE)');
      const before = {
        writerRows: count(runtime.sqlite),
        databaseHash: hashBytes(fs.readFileSync(handle.resolver.databasePath)),
      };
      reader.sqlite.exec('BEGIN');
      count(reader.sqlite);
      runtime.sqlite.exec('INSERT INTO atlas_checkpoint_probe VALUES(2)');
      runtime.sqlite.pragma('busy_timeout = 1');
      const passive = checkpointState();
      expect(passive.log).toBeGreaterThan(passive.checkpointed);
      const staleHash = hashBytes(fs.readFileSync(handle.resolver.databasePath));
      expect(() => createPrivateCorpusRevisionCheckpointV1(handle, runtime, expected)).toThrow(
        'PRIVATE_CORPUS_REVISION_WAL_CHECKPOINT_INCOMPLETE',
      );
      const blocked = {
        writerRows: count(runtime.sqlite),
        readerRows: count(reader.sqlite),
        readerInTransaction: reader.sqlite.inTransaction,
        receiptIssued: false,
        passiveCheckpoint: passive,
        databaseHash: hashBytes(fs.readFileSync(handle.resolver.databasePath)),
      };
      expect(blocked).toMatchObject({
        writerRows: 2,
        readerRows: 1,
        readerInTransaction: true,
        receiptIssued: false,
      });
      reader.sqlite.exec('ROLLBACK');
      const receipt = createPrivateCorpusRevisionCheckpointV1(handle, runtime, expected);
      expect(
        validatePrivateCorpusRevisionCheckpointV1(receipt, handle.initReceipt, expected),
      ).toEqual(receipt);
      const recovered = {
        writerRows: count(runtime.sqlite),
        readerRows: count(reader.sqlite),
        readerInTransaction: reader.sqlite.inTransaction,
        databaseHash: receipt.databaseHash,
        actualDatabaseHash: hashBytes(fs.readFileSync(handle.resolver.databasePath)),
        checkpointHash: receipt.checkpointHash,
        initReceiptHash: receipt.initReceiptHash,
        validationPassed: true,
        checkpointAfterRetry: checkpointState(),
      };
      expect(recovered.databaseHash).toBe(recovered.actualDatabaseHash);
      expect(recovered.databaseHash).not.toBe(staleHash);
      expect(recovered).toMatchObject({ writerRows: 2, readerRows: 2, readerInTransaction: false });
      expect(recovered.checkpointAfterRetry.log).toBe(recovered.checkpointAfterRetry.checkpointed);
      observeCase('V09', 'V09-W3', 'checkpoint-state', {
        fixture: 'real-sqlite-two-connections',
        expected,
        before,
        staleHash,
        blocked,
        recovered,
        hashMatchesDisk: recovered.databaseHash === recovered.actualDatabaseHash,
        sourceMainFileChanged: recovered.databaseHash !== staleHash,
      });
    } finally {
      try {
        if (openedReader?.sqlite.inTransaction) openedReader.sqlite.exec('ROLLBACK');
      } finally {
        try {
          openedReader?.close();
        } finally {
          try {
            opened?.close();
          } finally {
            fs.rmSync(root, { recursive: true, force: true });
          }
        }
      }
    }
  });
});
