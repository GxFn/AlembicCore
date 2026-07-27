import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDatabaseConnection,
  openAlembicDatabase,
  readAlembicMigrationBundleManifest,
} from '../src/database.js';
import {
  assertStrictAdmissionReceiptV1,
  canonicalizeCandidateAttemptBatchV1,
  classifyPublicKnowledgeRouteRecoveryV1,
  createCandidateCoverageReceiptV1,
  createFinalCoverageBindingReceiptV1,
  createRecipeCandidateFingerprintProjectionV1,
  createRecipeProductionBindingV1,
  createRefReconciliationReceiptV1,
  createServingSnapshotManifestV1,
  createStrictAcceptedCorpusInspectionV1,
  createStrictAdmissionReceiptV1,
  createStrictG1ReceiptV1,
  createStrictG2ReceiptV1,
  createStrictPersistenceReceiptV1,
  createStrictPublicationMarkerV1,
  createStrictPublicationSnapshotIdV1,
  createStrictRecipePersistedPayloadV1,
  type PublicKnowledgeRouteV1,
  parseStrictPublicationSnapshotIdV1,
  preparePublicKnowledgeRouteV1,
  prepareRecipePersistenceV1,
  STRICT_G1_HARD_AXES_V1,
  STRICT_G2_HARD_AXES_V1,
  validateSerialAdmissionLedgerV1,
} from '../src/knowledge.js';
import { createAlembicRepositories } from '../src/repositories.js';
import { hashCanonicalJson } from '../src/service/project-context/foundation/canonical.js';
import { createProjectDescriptor } from '../src/shared/ProjectScope.js';
import {
  assertPrivateCorpusRevisionHandleV1,
  createPrivateCorpusRevisionCheckpointV1,
  initializePrivateCorpusRevisionV1,
  PrivateCorpusRevisionHandleV1,
  type PrivateCorpusRevisionInitReceiptV1,
  rehydratePrivateCorpusRevisionV1,
  validatePrivateCorpusRevisionCheckpointV1,
  WorkspaceResolver,
} from '../src/workspace.js';

const roots: string[] = [];
const acceptedMigrationBundleSemanticHash = hashCanonicalJson(readAlembicMigrationBundleManifest());
const configReceiptHash = `sha256:${'c'.repeat(64)}`;
const runtimeReceiptHash = `sha256:${'d'.repeat(64)}`;

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('production persistence contracts', () => {
  it('rehydrates an initialized private revision through the public workspace API', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-private-revision-'));
    roots.push(root);
    const base = privateScopeResolver(root);
    const initialized = await initializePrivateCorpusRevisionV1(base, {
      runId: 'run-rehydrate',
      revisionId: 'revision-1',
      analysisFixpointHash: `sha256:${'1'.repeat(64)}`,
      configReceiptHash,
      runtimeReceiptHash,
      credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
      acceptedMigrationBundleSemanticHash,
    });
    const repositories = createAlembicRepositories(initialized.runtime.connection);
    await repositories.sessionRepository.create({
      id: 'durable-session',
      scope: 'strict-run',
      scopeId: 'run-rehydrate',
      context: { durableStage: 'PERSIST_PREPARED' },
      metadata: { revisionId: 'revision-1' },
      actor: 'alembic-main',
      createdAt: 1,
    });
    const expectedDataRoot = initialized.handle.resolver.dataRoot;
    const sealedReceipt = JSON.parse(
      JSON.stringify(initialized.handle.initReceipt)
    ) as typeof initialized.handle.initReceipt;
    initialized.runtime.close();

    const rehydrated = await rehydratePrivateCorpusRevisionV1(
      base,
      sealedReceipt,
      expectedRevisionContext(sealedReceipt)
    );
    expect(rehydrated.handle.resolver.dataRoot).toBe(expectedDataRoot);
    expect(rehydrated.handle.initReceipt).toEqual(sealedReceipt);
    const reopenedRepositories = createAlembicRepositories(rehydrated.runtime.connection);
    await expect(
      reopenedRepositories.sessionRepository.findById('durable-session')
    ).resolves.toMatchObject({
      id: 'durable-session',
      context: { durableStage: 'PERSIST_PREPARED' },
      metadata: { revisionId: 'revision-1' },
    });
    const next = await initializePrivateCorpusRevisionV1(base, {
      runId: 'run-rehydrate',
      revisionId: 'revision-2',
      analysisFixpointHash: `sha256:${'2'.repeat(64)}`,
      configReceiptHash,
      runtimeReceiptHash,
      credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
      acceptedMigrationBundleSemanticHash,
    });
    PrivateCorpusRevisionHandleV1.replace(
      rehydrated.handle,
      next.handle,
      `sha256:${'f'.repeat(64)}`
    );
    expect(() => assertPrivateCorpusRevisionHandleV1(initialized.handle)).toThrow(
      'PRIVATE_CORPUS_REVISION_HANDLE_INACTIVE'
    );
    expect(() => rehydrated.runtime.sqlite.prepare('SELECT 1').get()).toThrow();
    expect(next.runtime.sqlite.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 });
    next.runtime.close();
  });

  it('rejects an old revision receipt and checkpoint under a new current context', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-private-revision-'));
    roots.push(root);
    const base = privateScopeResolver(root);
    const initialized = await initializePrivateCorpusRevisionV1(base, {
      runId: 'run-current-context',
      revisionId: 'revision-1',
      analysisFixpointHash: `sha256:${'1'.repeat(64)}`,
      configReceiptHash,
      runtimeReceiptHash,
      credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
      acceptedMigrationBundleSemanticHash,
    });
    const sealedReceipt = cloneReceipt(initialized.handle.initReceipt);
    const current = expectedRevisionContext(sealedReceipt);
    const checkpoint = createPrivateCorpusRevisionCheckpointV1(
      initialized.handle,
      initialized.runtime,
      current
    );
    expect(validatePrivateCorpusRevisionCheckpointV1(checkpoint, sealedReceipt, current)).toEqual(
      checkpoint
    );
    const other = await initializePrivateCorpusRevisionV1(base, {
      runId: 'run-current-context',
      revisionId: 'revision-2',
      analysisFixpointHash: `sha256:${'2'.repeat(64)}`,
      configReceiptHash,
      runtimeReceiptHash,
      credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
      acceptedMigrationBundleSemanticHash,
    });
    expect(() =>
      createPrivateCorpusRevisionCheckpointV1(initialized.handle, other.runtime, current)
    ).toThrow('PRIVATE_CORPUS_REVISION_RUNTIME_MISMATCH');
    other.runtime.close();
    initialized.runtime.close();

    const replacementContext = {
      ...current,
      revisionId: 'revision-2',
      analysisFixpointHash: `sha256:${'2'.repeat(64)}`,
    };
    await expect(
      rehydratePrivateCorpusRevisionV1(base, sealedReceipt, replacementContext)
    ).rejects.toThrow('PRIVATE_CORPUS_REVISION_CURRENT_CONTEXT_MISMATCH');
    expect(() =>
      validatePrivateCorpusRevisionCheckpointV1(checkpoint, sealedReceipt, replacementContext)
    ).toThrow('PRIVATE_CORPUS_REVISION_CURRENT_CONTEXT_MISMATCH');
  });

  it('fails closed on tampered init receipts and mismatched project scope', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-private-revision-'));
    roots.push(root);
    const base = privateScopeResolver(root);
    const initialized = await initializePrivateCorpusRevisionV1(base, {
      runId: 'run-rehydrate-negative',
      revisionId: 'revision-1',
      analysisFixpointHash: `sha256:${'1'.repeat(64)}`,
      configReceiptHash,
      runtimeReceiptHash,
      credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
      acceptedMigrationBundleSemanticHash,
    });
    const sealedReceipt = cloneReceipt(initialized.handle.initReceipt);
    initialized.runtime.close();

    await expect(
      rehydratePrivateCorpusRevisionV1(
        base,
        undefined as never,
        expectedRevisionContext(sealedReceipt)
      )
    ).rejects.toThrow('PRIVATE_CORPUS_REVISION_INIT_RECEIPT_INVALID');

    const tamperedConfig = cloneReceipt(sealedReceipt) as unknown as {
      configReceiptHash: string;
    };
    tamperedConfig.configReceiptHash = `sha256:${'d'.repeat(64)}`;
    await expect(
      rehydratePrivateCorpusRevisionV1(
        base,
        tamperedConfig as never,
        expectedRevisionContext(sealedReceipt)
      )
    ).rejects.toThrow('PRIVATE_CORPUS_REVISION_INIT_RECEIPT_HASH_MISMATCH');

    const tamperedScope = cloneReceipt(sealedReceipt) as unknown as { projectScopeId: string };
    tamperedScope.projectScopeId = 'scope-tampered';
    await expect(
      rehydratePrivateCorpusRevisionV1(
        base,
        tamperedScope as never,
        expectedRevisionContext(sealedReceipt)
      )
    ).rejects.toThrow('PRIVATE_CORPUS_REVISION_INIT_RECEIPT_HASH_MISMATCH');

    const tamperedMigration = cloneReceipt(sealedReceipt) as unknown as {
      migrationArtifacts: Array<{ migrationArtifactSha256: string }>;
    };
    const firstArtifact = tamperedMigration.migrationArtifacts[0];
    if (!firstArtifact) {
      throw new Error('Expected at least one migration artifact.');
    }
    firstArtifact.migrationArtifactSha256 = `sha256:${'e'.repeat(64)}`;
    await expect(
      rehydratePrivateCorpusRevisionV1(
        base,
        tamperedMigration as never,
        expectedRevisionContext(sealedReceipt)
      )
    ).rejects.toThrow('PRIVATE_CORPUS_REVISION_INIT_RECEIPT_HASH_MISMATCH');

    const wrongScopeBase = privateScopeResolver(root, {
      projectId: 'project-private-corpus-other',
      projectScopeId: 'scope-private-corpus-other',
    });
    await expect(
      rehydratePrivateCorpusRevisionV1(
        wrongScopeBase,
        sealedReceipt,
        expectedRevisionContext(sealedReceipt)
      )
    ).rejects.toThrow('PRIVATE_CORPUS_REVISION_PROJECT_SCOPE_MISMATCH');
  });

  it('fails closed when an initialized revision is missing or symlinked', async () => {
    const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-private-revision-'));
    const symlinkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-private-revision-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-private-outside-'));
    roots.push(missingRoot, symlinkRoot, outside);

    const missingBase = privateScopeResolver(missingRoot);
    const missing = await initializePrivateCorpusRevisionV1(missingBase, {
      runId: 'run-missing',
      revisionId: 'revision-1',
      analysisFixpointHash: `sha256:${'1'.repeat(64)}`,
      configReceiptHash,
      runtimeReceiptHash,
      credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
      acceptedMigrationBundleSemanticHash,
    });
    const missingReceipt = cloneReceipt(missing.handle.initReceipt);
    const missingLeaf = missing.handle.resolver.dataRoot;
    missing.runtime.close();
    fs.rmSync(missingLeaf, { recursive: true });
    await expect(
      rehydratePrivateCorpusRevisionV1(
        missingBase,
        missingReceipt,
        expectedRevisionContext(missingReceipt)
      )
    ).rejects.toThrow('PRIVATE_CORPUS_REVISION_LEAF_MISSING');
    expect(fs.existsSync(missingLeaf)).toBe(false);

    const symlinkBase = privateScopeResolver(symlinkRoot);
    const symlinked = await initializePrivateCorpusRevisionV1(symlinkBase, {
      runId: 'run-symlink',
      revisionId: 'revision-1',
      analysisFixpointHash: `sha256:${'1'.repeat(64)}`,
      configReceiptHash,
      runtimeReceiptHash,
      credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
      acceptedMigrationBundleSemanticHash,
    });
    const symlinkReceipt = cloneReceipt(symlinked.handle.initReceipt);
    const symlinkLeaf = symlinked.handle.resolver.dataRoot;
    const movedLeaf = path.join(outside, 'revision-1');
    symlinked.runtime.close();
    fs.renameSync(symlinkLeaf, movedLeaf);
    fs.symlinkSync(movedLeaf, symlinkLeaf, 'dir');
    await expect(
      rehydratePrivateCorpusRevisionV1(
        symlinkBase,
        symlinkReceipt,
        expectedRevisionContext(symlinkReceipt)
      )
    ).rejects.toThrow('PRIVATE_CORPUS_REVISION_CONFINEMENT_FAILED');
  });

  it('fails closed when the existing database migration ledger drifts', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-private-revision-'));
    roots.push(root);
    const base = privateScopeResolver(root);
    const initialized = await initializePrivateCorpusRevisionV1(base, {
      runId: 'run-migration-drift',
      revisionId: 'revision-1',
      analysisFixpointHash: `sha256:${'1'.repeat(64)}`,
      configReceiptHash,
      runtimeReceiptHash,
      credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
      acceptedMigrationBundleSemanticHash,
    });
    const sealedReceipt = cloneReceipt(initialized.handle.initReceipt);
    initialized.runtime.sqlite
      .prepare('DELETE FROM schema_migrations WHERE version = ?')
      .run('017_recipe_retrieval_profile');
    initialized.runtime.close();

    await expect(
      rehydratePrivateCorpusRevisionV1(base, sealedReceipt, expectedRevisionContext(sealedReceipt))
    ).rejects.toThrow('PRIVATE_CORPUS_REVISION_MIGRATION_SET_MISMATCH');
  });

  it('allocates each private revision under a fixed absent-before-create namespace and revokes the old handle', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-private-revision-'));
    roots.push(root);
    const base = privateScopeResolver(root);
    const first = await initializePrivateCorpusRevisionV1(base, {
      runId: 'run-1',
      revisionId: 'revision-1',
      analysisFixpointHash: `sha256:${'1'.repeat(64)}`,
      configReceiptHash,
      runtimeReceiptHash,
      credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
      acceptedMigrationBundleSemanticHash,
    });
    expect(first.handle.resolver.projectRoot).toBe(base.projectRoot);
    expect(first.handle.resolver.dataRoot).toContain(
      path.join('.asd', 'context', 'recipe-runs', 'run-1', 'corpora', 'revision-1')
    );
    expect(first.handle.initReceipt.requiredMigration017Present).toBe(true);
    expect(Object.isFrozen(first.handle.initReceipt)).toBe(true);
    expect(Object.isFrozen(first.handle.initReceipt.migrationArtifacts)).toBe(true);
    expect(
      first.handle.initReceipt.migrationArtifacts.some((row) => row.version.startsWith('017'))
    ).toBe(true);
    expect(first.handle.initReceipt.blankState).toEqual({
      knowledgeEntries: 0,
      sourceRefs: 0,
      coverageRows: 0,
      vectorRoutePresent: false,
      publicationRoutePresent: false,
      recipeFileCount: 0,
      candidateFileCount: 0,
    });

    await expect(
      initializePrivateCorpusRevisionV1(base, {
        runId: 'run-1',
        revisionId: 'revision-1',
        analysisFixpointHash: `sha256:${'1'.repeat(64)}`,
        configReceiptHash,
        runtimeReceiptHash,
        credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
        acceptedMigrationBundleSemanticHash,
      })
    ).rejects.toThrow('PRIVATE_CORPUS_REVISION_LEAF_ALREADY_EXISTS');

    const second = await initializePrivateCorpusRevisionV1(base, {
      runId: 'run-1',
      revisionId: 'revision-2',
      analysisFixpointHash: `sha256:${'2'.repeat(64)}`,
      configReceiptHash,
      runtimeReceiptHash,
      credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
      acceptedMigrationBundleSemanticHash,
    });
    expect(second.handle.initReceipt.migrationLedgerSemanticHash).toBe(
      first.handle.initReceipt.migrationLedgerSemanticHash
    );
    const sealedRootManifestHash = `sha256:${'f'.repeat(64)}`;
    PrivateCorpusRevisionHandleV1.replace(first.handle, second.handle, sealedRootManifestHash);
    expect(() => assertPrivateCorpusRevisionHandleV1(first.handle)).toThrow(
      'PRIVATE_CORPUS_REVISION_HANDLE_INACTIVE'
    );
    expect(() => first.runtime.sqlite.prepare('SELECT 1').get()).toThrow();
    await expect(
      openAlembicDatabase(
        { path: first.handle.resolver.databasePath },
        { workspaceResolver: first.handle.resolver }
      )
    ).rejects.toThrow('ALEMBIC_DATABASE_ROOT_REVOKED');
    await expect(
      rehydratePrivateCorpusRevisionV1(
        base,
        cloneReceipt(first.handle.initReceipt),
        expectedRevisionContext(first.handle.initReceipt)
      )
    ).rejects.toThrow('ALEMBIC_DATABASE_ROOT_REVOKED');
    expect(first.handle.sealedRootManifestHash).toBe(sealedRootManifestHash);
    expect(() => second.handle.assertResolver(first.handle.resolver)).toThrow(
      'PRIVATE_CORPUS_REVISION_CROSS_REVISION_OPEN'
    );
    second.runtime.close();
  });

  it('terminates every public runtime opened before private revision replacement', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-private-revision-'));
    roots.push(root);
    const base = privateScopeResolver(root);
    const first = await initializePrivateCorpusRevisionV1(base, {
      runId: 'run-public-bypass',
      revisionId: 'revision-1',
      analysisFixpointHash: `sha256:${'1'.repeat(64)}`,
      configReceiptHash,
      runtimeReceiptHash,
      credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
      acceptedMigrationBundleSemanticHash,
    });
    const publicBypass = await openAlembicDatabase(
      { path: first.handle.resolver.databasePath },
      { workspaceResolver: first.handle.resolver }
    );
    const ordinaryRuntime = await openAlembicDatabase(
      { path: base.databasePath },
      { workspaceResolver: base }
    );
    const preparedBypassRead = publicBypass.sqlite.prepare('SELECT 1 AS value');
    const preparedBypassWrite = publicBypass.sqlite.prepare(
      'CREATE TABLE forbidden_after_revoke (id INTEGER)'
    );
    expect(preparedBypassRead.get()).toEqual({ value: 1 });

    const second = await initializePrivateCorpusRevisionV1(base, {
      runId: 'run-public-bypass',
      revisionId: 'revision-2',
      analysisFixpointHash: `sha256:${'2'.repeat(64)}`,
      configReceiptHash,
      runtimeReceiptHash,
      credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
      acceptedMigrationBundleSemanticHash,
    });
    PrivateCorpusRevisionHandleV1.replace(first.handle, second.handle, `sha256:${'f'.repeat(64)}`);

    expect(() => preparedBypassRead.get()).toThrow();
    expect(() => preparedBypassWrite.run()).toThrow();
    expect(() => first.runtime.sqlite.prepare('SELECT 1 AS value').get()).toThrow();
    await expect(
      openAlembicDatabase(
        { path: first.handle.resolver.databasePath },
        { workspaceResolver: first.handle.resolver }
      )
    ).rejects.toThrow('ALEMBIC_DATABASE_ROOT_REVOKED');
    expect(second.runtime.sqlite.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 });
    expect(ordinaryRuntime.sqlite.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 });
    second.runtime.sqlite.exec('CREATE TABLE next_revision_alive (id INTEGER)');
    ordinaryRuntime.sqlite.exec('CREATE TABLE ordinary_root_alive (id INTEGER)');

    ordinaryRuntime.close();
    second.runtime.close();
  });

  it('rejects a second active native handle on one public DatabaseConnection', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-private-revision-'));
    roots.push(root);
    const base = privateScopeResolver(root);
    const first = await initializePrivateCorpusRevisionV1(base, {
      runId: 'run-double-connect',
      revisionId: 'revision-1',
      analysisFixpointHash: `sha256:${'1'.repeat(64)}`,
      configReceiptHash,
      runtimeReceiptHash,
      credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
      acceptedMigrationBundleSemanticHash,
    });
    const connection = createDatabaseConnection(
      { path: first.handle.resolver.databasePath },
      first.handle.resolver
    );
    const firstNativeHandle = await connection.connect();
    const preparedRead = firstNativeHandle.prepare('SELECT 1 AS value');
    const preparedWrite = firstNativeHandle.prepare(
      'CREATE TABLE forbidden_double_connect_write (id INTEGER)'
    );
    let secondRevision: Awaited<ReturnType<typeof initializePrivateCorpusRevisionV1>> | null = null;

    try {
      await expect(connection.connect()).rejects.toThrow('ALEMBIC_DATABASE_ALREADY_CONNECTED');
      expect(preparedRead.get()).toEqual({ value: 1 });
      secondRevision = await initializePrivateCorpusRevisionV1(base, {
        runId: 'run-double-connect',
        revisionId: 'revision-2',
        analysisFixpointHash: `sha256:${'2'.repeat(64)}`,
        configReceiptHash,
        runtimeReceiptHash,
        credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
        acceptedMigrationBundleSemanticHash,
      });
      PrivateCorpusRevisionHandleV1.replace(
        first.handle,
        secondRevision.handle,
        `sha256:${'f'.repeat(64)}`
      );

      expect(() => preparedRead.get()).toThrow();
      expect(() => preparedWrite.run()).toThrow();
      expect(secondRevision.runtime.sqlite.prepare('SELECT 1 AS value').get()).toEqual({
        value: 1,
      });
    } finally {
      connection.close();
      if (firstNativeHandle.open) {
        firstNativeHandle.close();
      }
      secondRevision?.runtime.close();
      first.runtime.close();
    }
  });

  it('allows a public DatabaseConnection to reconnect after explicit close', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-database-reconnect-'));
    roots.push(root);
    const base = privateScopeResolver(root);
    const connection = createDatabaseConnection({ path: base.databasePath }, base);

    try {
      const firstNativeHandle = await connection.connect();
      expect(firstNativeHandle.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 });
      connection.close();
      expect(firstNativeHandle.open).toBe(false);

      const secondNativeHandle = await connection.connect();
      expect(secondNativeHandle).not.toBe(firstNativeHandle);
      expect(secondNativeHandle.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 });
    } finally {
      connection.close();
    }
  });

  it('rejects arbitrary or escaping revision coordinates', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-private-revision-'));
    roots.push(root);
    const base = privateScopeResolver(root);
    await expect(
      initializePrivateCorpusRevisionV1(base, {
        runId: '../escape',
        revisionId: 'revision-1',
        analysisFixpointHash: `sha256:${'1'.repeat(64)}`,
        configReceiptHash,
        runtimeReceiptHash,
        credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
        acceptedMigrationBundleSemanticHash,
      })
    ).rejects.toThrow('PRIVATE_CORPUS_REVISION_INVALID_RUNID');
  });

  it('rejects symlinked ancestors in the private revision namespace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-private-revision-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-private-outside-'));
    roots.push(root, outside);
    fs.symlinkSync(outside, path.join(root, '.asd'), 'dir');

    await expect(
      initializePrivateCorpusRevisionV1(privateScopeResolver(root), {
        runId: 'run-1',
        revisionId: 'revision-1',
        analysisFixpointHash: `sha256:${'1'.repeat(64)}`,
        configReceiptHash,
        runtimeReceiptHash,
        credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
        acceptedMigrationBundleSemanticHash,
      })
    ).rejects.toThrow('PRIVATE_CORPUS_REVISION_CONFINEMENT_FAILED');
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('derives a deterministic prepared Recipe ID from journal-bound identity', () => {
    const input = {
      runId: 'run-1',
      analysisFixpointHash: 'sha256:fixpoint',
      privateCorpusRevision: 'revision-1',
      admissionId: 'admission:one',
      cellId: 'core::architecture',
      authoredFingerprint: 'sha256:authored',
      causalParentIds: ['parent-2', 'parent-1'],
      expectedDbHash: 'sha256:db-row',
      expectedFileHash: 'sha256:file',
      journalStepHash: 'sha256:journal-step',
    };
    const left = prepareRecipePersistenceV1(input);
    const right = prepareRecipePersistenceV1({
      ...input,
      causalParentIds: [...input.causalParentIds].reverse(),
    });
    expect(right.preparedRecipeId).toBe(left.preparedRecipeId);
    const relocated = prepareRecipePersistenceV1({
      ...input,
      cellId: 'knowledge::reliability',
      causalParentIds: ['different-parent'],
    });
    expect(relocated.preparedRecipeId).toBe(left.preparedRecipeId);
    expect(relocated.preparedHash).not.toBe(left.preparedHash);
    expect(
      prepareRecipePersistenceV1({ ...input, admissionId: 'admission:two' }).preparedRecipeId
    ).not.toBe(left.preparedRecipeId);
    expect(left.preparedRecipeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('enforces the deterministic G1 hard-axis allowlist and existing retrieval readiness binding', () => {
    const rows = STRICT_G1_HARD_AXES_V1.map((axis) => ({
      axis,
      verdict: 'pass' as const,
      reasonCode: 'verified',
      evidenceRefs: [`evidence:${axis}`],
    }));
    const receipt = createStrictG1ReceiptV1({
      candidateFingerprint: 'sha256:candidate',
      retrievalReadinessHash: 'sha256:retrieval-ready',
      rows: [...rows].reverse(),
    });
    expect(receipt.verdict).toBe('pass');
    expect(receipt.rows.map((row) => row.axis)).toEqual([...STRICT_G1_HARD_AXES_V1].sort());
    expect(() =>
      createStrictG1ReceiptV1({
        candidateFingerprint: 'sha256:candidate',
        retrievalReadinessHash: 'sha256:retrieval-ready',
        rows: rows.slice(1),
      })
    ).toThrow('STRICT_G1_AXIS_SET_MISMATCH');
  });

  it('rejects corpus summaries that diverge from the sealed authored projection', () => {
    const projection = createRecipeCandidateFingerprintProjectionV1({
      title: 'Sealed accepted Recipe',
      kind: 'pattern',
      category: 'architecture',
      trigger: '@sealed-recipe',
      whenClause: 'When admitting a reviewed candidate',
      doText: 'Compare against the complete accepted corpus',
      dontText: 'Do not trust an unsealed summary',
      coreCode: 'inspectAcceptedCorpus()',
      pattern: 'inspectAcceptedCorpus(*)',
      markdown: '# Sealed accepted Recipe',
      usageGuide: 'Use during serial admission.',
      retrievalProfile: { intents: ['serial admission'] },
      negativeIntents: ['unsealed summary'],
      scopeId: 'repo:core',
      moduleId: 'knowledge',
      dimensionId: 'reliability',
      evidenceRefs: ['E-17'],
      lineageHashes: ['sha256:fixpoint'],
      persistedPayload: createStrictRecipePersistedPayloadV1(
        {
          title: 'Sealed accepted Recipe',
          kind: 'pattern',
          category: 'architecture',
          trigger: '@sealed-recipe',
          whenClause: 'When admitting a reviewed candidate',
          doClause: 'Compare against the complete accepted corpus',
          dontClause: 'Do not trust an unsealed summary',
          coreCode: 'inspectAcceptedCorpus()',
          content: {
            pattern: 'inspectAcceptedCorpus(*)',
            markdown: '# Sealed accepted Recipe',
          },
          usageGuide: 'Use during serial admission.',
          retrievalProfile: { intents: ['serial admission'] } as never,
          scope: 'repo:core',
          moduleName: 'knowledge',
          dimensionId: 'reliability',
          sourceRefs: ['E-17'],
        },
        'alembic-agent'
      ),
    });

    expect(() =>
      createStrictAcceptedCorpusInspectionV1({
        runId: 'run-1',
        analysisFixpointHash: 'sha256:fixpoint',
        privateCorpusRevision: 'revision-1',
        revisionRootManifestHash: `sha256:${'9'.repeat(64)}`,
        entries: [
          {
            recipeId: 'accepted-1',
            projection,
            admissionSummary: {
              title: 'Hidden duplicate title',
              category: projection.category,
              trigger: projection.trigger,
              whenClause: projection.whenClause,
              doClause: projection.doText,
              dontClause: projection.dontText,
              coreCode: projection.coreCode,
              guardPattern: projection.pattern,
              markdown: projection.markdown,
            },
          },
        ],
      })
    ).toThrow('STRICT_ADMISSION_CORPUS_ENTRY_PROJECTION_MISMATCH');
  });

  it('rejects a rehashed admit receipt that contains a corpus match', () => {
    const authority = strictPersistenceAuthority('sha256:candidate');
    const {
      receiptHash: _receiptHash,
      admissionId: _admissionId,
      ...baseSemantic
    } = authority.admissionReceipt;
    const semantic = {
      ...baseSemantic,
      semanticMatches: [
        {
          recipeId: 'ghost',
          fingerprint: 'sha256:ghost',
          similarity: 0.99,
        },
      ],
    };
    const admissionId = `admission:${hashCanonicalJson(semantic).slice('sha256:'.length)}`;
    const forged = {
      ...semantic,
      admissionId,
      receiptHash: hashCanonicalJson({ ...semantic, admissionId }),
    };

    expect(() => assertStrictAdmissionReceiptV1(forged)).toThrow(
      'STRICT_ADMISSION_RECEIPT_INVALID'
    );
  });

  it('separates authored fingerprint, persistence, refs, and production binding receipts', () => {
    const authored = createRecipeCandidateFingerprintProjectionV1({
      title: 'Atomic file replacement',
      kind: 'pattern',
      category: 'reliability',
      trigger: '@atomic-file-replacement',
      whenClause: 'When replacing a durable file',
      doText: 'fsync the file before rename',
      dontText: 'do not expose partial bytes',
      coreCode: 'await fsyncAndRename()',
      pattern: 'rename(tempPath, finalPath)',
      markdown: 'Use a same-directory temporary file.',
      usageGuide: 'Apply to durable knowledge writes.',
      retrievalProfile: { intents: ['safe write'] },
      negativeIntents: ['in-memory-only'],
      scopeId: 'repo:core',
      moduleId: 'knowledge',
      dimensionId: 'reliability',
      evidenceRefs: ['E-17'],
      lineageHashes: ['sha256:fixpoint'],
      persistedPayload: createStrictRecipePersistedPayloadV1(
        {
          title: 'Atomic file replacement',
          kind: 'pattern',
          category: 'reliability',
          trigger: '@atomic-file-replacement',
          whenClause: 'When replacing a durable file',
          doClause: 'fsync the file before rename',
          dontClause: 'do not expose partial bytes',
          coreCode: 'await fsyncAndRename()',
          content: {
            pattern: 'rename(tempPath, finalPath)',
            markdown: 'Use a same-directory temporary file.',
          },
          usageGuide: 'Apply to durable knowledge writes.',
          retrievalProfile: { intents: ['safe write'] } as never,
          scope: 'repo:core',
          moduleName: 'knowledge',
          dimensionId: 'reliability',
          sourceRefs: ['E-17'],
        },
        'alembic-agent'
      ),
    });
    const authority = strictPersistenceAuthority(authored.authoredFingerprint);
    const prepared = prepareRecipePersistenceV1({
      runId: 'run-1',
      analysisFixpointHash: 'sha256:fixpoint',
      privateCorpusRevision: 'revision-1',
      admissionId: authority.admissionReceipt.admissionId,
      cellId: 'knowledge::reliability',
      authoredFingerprint: authored.authoredFingerprint,
      causalParentIds: ['root-1'],
      expectedDbHash: 'sha256:db-row',
      expectedFileHash: 'sha256:file',
      journalStepHash: 'sha256:journal-step',
    });
    const persistence = createStrictPersistenceReceiptV1({
      prepared,
      ...authority,
      actualRecipeId: prepared.preparedRecipeId,
      actualAuthoredFingerprint: authored.authoredFingerprint,
      storageHash: 'sha256:storage',
      databaseRowHash: 'sha256:db-row',
      fileHash: 'sha256:file',
      actualLifecycle: 'pending',
    });
    const refs = createRefReconciliationReceiptV1({
      persistence,
      sourceRefIds: ['ref-2', 'ref-1'],
      reasoningSourceIds: ['ref-1', 'ref-2'],
      bridgeRefIds: ['ref-2', 'ref-1'],
      blockerCodes: [],
    });
    const binding = createRecipeProductionBindingV1({
      persistence,
      refReconciliation: refs,
      runId: 'run-1',
      manifestHash: 'sha256:manifest',
      planHash: 'sha256:plan',
      cellId: 'knowledge::reliability',
      moduleId: 'knowledge',
    });
    expect(binding.recipeId).toBe(prepared.preparedRecipeId);
    expect(() =>
      createStrictPersistenceReceiptV1({
        prepared,
        ...authority,
        actualRecipeId: '00000000-0000-5000-8000-000000000000',
        actualAuthoredFingerprint: authored.authoredFingerprint,
        storageHash: 'sha256:storage',
        databaseRowHash: 'sha256:db-row',
        fileHash: 'sha256:file',
        actualLifecycle: 'pending',
      })
    ).toThrow('STRICT_PERSISTENCE_PREPARED_ID_MISMATCH');
    expect(() =>
      createStrictPersistenceReceiptV1({
        prepared,
        ...authority,
        admissionReceipt: {
          ...authority.admissionReceipt,
          finalAdmittedFingerprint: 'sha256:tampered',
        },
        actualRecipeId: prepared.preparedRecipeId,
        actualAuthoredFingerprint: authored.authoredFingerprint,
        storageHash: 'sha256:storage',
        databaseRowHash: 'sha256:db-row',
        fileHash: 'sha256:file',
        actualLifecycle: 'pending',
      })
    ).toThrow('STRICT_PERSISTENCE_AUTHORITY_MISMATCH');
  });

  it('buffers and sorts a whole candidate pass before enforcing caps', () => {
    const attempts = [
      candidateAttempt('ui::architecture', 'standard', 'fp-b'),
      candidateAttempt('core::architecture', 'critical', 'fp-a'),
    ] as const;
    const batch = canonicalizeCandidateAttemptBatchV1({
      attempts,
      existingAttemptCount: 0,
      candidateAttemptCap: 2,
      maxAuthoredCandidatesPerCellPass: 1,
    });
    expect(batch.attempts.map((row) => row.cellId)).toEqual([
      'core::architecture',
      'ui::architecture',
    ]);
    expect(() =>
      canonicalizeCandidateAttemptBatchV1({
        attempts,
        existingAttemptCount: 1,
        candidateAttemptCap: 2,
        maxAuthoredCandidatesPerCellPass: 1,
      })
    ).toThrow('CANDIDATE_CAP_OVERFLOW');
    expect(() =>
      canonicalizeCandidateAttemptBatchV1({
        attempts: [attempts[0], { ...attempts[0], authoredFingerprint: 'fp-c' }],
        existingAttemptCount: 0,
        candidateAttemptCap: 10,
        maxAuthoredCandidatesPerCellPass: 1,
      })
    ).toThrow('CANDIDATE_CAP_OVERFLOW');
  });

  it('serial admission observes only the actually accepted predecessor', () => {
    const ledger = validateSerialAdmissionLedgerV1({
      initialAcceptedCorpusHash: 'sha256:empty',
      rows: [
        {
          proposalId: 'candidate-attempt:p1',
          attemptHash: `sha256:${'1'.repeat(64)}`,
          authoredFingerprint: 'fingerprint:p1',
          observedAcceptedCorpusHash: 'sha256:empty',
          terminalFate: 'rejected',
          resultingAcceptedCorpusHash: 'sha256:empty',
          terminalReceiptId: 'r1',
          terminalReceiptHash: `sha256:${'3'.repeat(64)}`,
        },
        {
          proposalId: 'candidate-attempt:p2',
          attemptHash: `sha256:${'2'.repeat(64)}`,
          authoredFingerprint: 'fingerprint:p2',
          observedAcceptedCorpusHash: 'sha256:empty',
          terminalFate: 'accepted',
          resultingAcceptedCorpusHash: 'sha256:recipe-2',
          terminalReceiptId: 'r2',
          terminalReceiptHash: `sha256:${'4'.repeat(64)}`,
        },
      ],
    });
    expect(ledger.finalAcceptedCorpusHash).toBe('sha256:recipe-2');
    expect(() =>
      validateSerialAdmissionLedgerV1({
        initialAcceptedCorpusHash: 'sha256:empty',
        rows: [
          {
            proposalId: 'candidate-attempt:p1',
            attemptHash: `sha256:${'1'.repeat(64)}`,
            authoredFingerprint: 'fingerprint:p1',
            observedAcceptedCorpusHash: 'sha256:empty',
            terminalFate: 'rejected',
            resultingAcceptedCorpusHash: 'sha256:rejected-proposal',
            terminalReceiptId: 'r1',
            terminalReceiptHash: `sha256:${'3'.repeat(64)}`,
          },
        ],
      })
    ).toThrow('SERIAL_ADMISSION_REJECTED_PREDECESSOR_RETAINED');
  });

  it('separates candidate coverage from final serving binding and rejects unknown cells', () => {
    expect(() =>
      createCandidateCoverageReceiptV1({
        planBaselineHash: 'sha256:plan',
        finalExpandedScheduleHash: 'sha256:schedule',
        analysisFixpointHash: 'sha256:fixpoint',
        evidenceLedgerHash: 'sha256:evidence',
        candidateDatabaseHash: 'sha256:db',
        candidateFilesHash: 'sha256:files',
        requiredCellIds: ['core::architecture'],
        cells: [
          {
            cellId: 'core::architecture',
            candidateDisposition: 'unknown',
            contentReadyRecipeIds: [],
            contentReadyRecipeFingerprints: [],
            productionBindingHashes: [],
            lensBindingIds: [],
            expressionSetReceiptIds: [],
          },
        ],
      })
    ).toThrow('CANDIDATE_COVERAGE_NONTERMINAL');

    const candidate = createCandidateCoverageReceiptV1({
      planBaselineHash: 'sha256:plan',
      finalExpandedScheduleHash: 'sha256:schedule',
      analysisFixpointHash: 'sha256:fixpoint',
      evidenceLedgerHash: 'sha256:evidence',
      candidateDatabaseHash: 'sha256:db',
      candidateFilesHash: 'sha256:files',
      requiredCellIds: ['core::architecture'],
      cells: [
        {
          cellId: 'core::architecture',
          candidateDisposition: 'covered-by-content-ready-candidate',
          contentReadyRecipeIds: ['recipe-1'],
          contentReadyRecipeFingerprints: ['sha256:recipe-1'],
          productionBindingHashes: ['sha256:binding-1'],
          lensBindingIds: ['lens-1'],
          expressionSetReceiptIds: ['set-1'],
        },
      ],
    });
    const final = createFinalCoverageBindingReceiptV1({
      candidateCoverage: candidate,
      g4ReceiptHash: 'sha256:g4',
      candidateDataManifestHash: 'sha256:data',
      cells: [
        {
          cellId: 'core::architecture',
          finalDisposition: 'covered-by-ready-recipe',
          finalRecipeIds: ['recipe-1'],
          finalRecipeFingerprints: ['sha256:recipe-1'],
        },
      ],
    });
    expect(final.candidateCoverageReceiptHash).toBe(candidate.receiptHash);
  });

  it('uses byte-exact public-route crash recovery; semantic equality is not enough', () => {
    const route = publicRoute('2026-07-16T00:00:00.000Z');
    const prepared = preparePublicKnowledgeRouteV1(route);
    expect(classifyPublicKnowledgeRouteRecoveryV1(null, prepared)).toBe('write-prepared-route');
    expect(classifyPublicKnowledgeRouteRecoveryV1(prepared.canonicalBytes, prepared)).toBe(
      'recover-rename-succeeded'
    );

    const sameSemanticDifferentBytes = preparePublicKnowledgeRouteV1(
      publicRoute('2026-07-16T00:00:01.000Z')
    );
    expect(sameSemanticDifferentBytes.semanticHash).toBe(prepared.semanticHash);
    expect(
      classifyPublicKnowledgeRouteRecoveryV1(sameSemanticDifferentBytes.canonicalBytes, prepared)
    ).toBe('conflict');
  });

  it('creates an exact consumer-neutral strict publication marker', () => {
    const marker = createStrictPublicationMarkerV1(
      strictPublicationMarkerInput(`sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`)
    );
    expect(marker).toMatchObject({
      schemaVersion: 1,
      mode: 'strict-v1',
      routeSchemaVersion: 1,
      projectIdentityHash: `sha256:${'a'.repeat(64)}`,
      migrationBundleHash: `sha256:${'b'.repeat(64)}`,
    });
    expect(marker.markerHash).toBe(
      hashCanonicalJson({
        schemaVersion: 1,
        mode: 'strict-v1',
        routeSchemaVersion: 1,
        projectIdentityHash: `sha256:${'a'.repeat(64)}`,
        migrationBundleHash: `sha256:${'b'.repeat(64)}`,
      })
    );
    expect(Object.isFrozen(marker)).toBe(true);
    expect(
      createStrictPublicationMarkerV1(
        strictPublicationMarkerInput(`sha256:${'c'.repeat(64)}`, `sha256:${'b'.repeat(64)}`)
      ).markerHash
    ).not.toBe(marker.markerHash);
    expect(
      createStrictPublicationMarkerV1(
        strictPublicationMarkerInput(`sha256:${'a'.repeat(64)}`, `sha256:${'d'.repeat(64)}`)
      ).markerHash
    ).not.toBe(marker.markerHash);

    const validInput = strictPublicationMarkerInput(
      `sha256:${'a'.repeat(64)}`,
      `sha256:${'b'.repeat(64)}`
    );
    for (const key of Object.keys(validInput)) {
      const missingField = { ...validInput } as Record<string, unknown>;
      delete missingField[key];
      expect(() => createStrictPublicationMarkerV1(missingField as never)).toThrow(
        'STRICT_PUBLICATION_MARKER_FIELDS_INVALID'
      );
    }
    expect(() =>
      createStrictPublicationMarkerV1({
        ...validInput,
        dataRoot: '/tmp/leak',
      } as never)
    ).toThrow('STRICT_PUBLICATION_MARKER_FIELDS_INVALID');
    expect(() =>
      createStrictPublicationMarkerV1({
        projectId: 'project-old',
        projectScopeId: 'scope-old',
        strictConfigReceiptHash: `sha256:${'a'.repeat(64)}`,
        publicationModeVersion: 'strict-v1',
      } as never)
    ).toThrow('STRICT_PUBLICATION_MARKER_FIELDS_INVALID');

    for (const invalid of [
      strictPublicationMarkerInput('', `sha256:${'b'.repeat(64)}`),
      strictPublicationMarkerInput(`sha256:${'a'.repeat(64)}`, ''),
      strictPublicationMarkerInput('sha256:not-canonical', `sha256:${'b'.repeat(64)}`),
      strictPublicationMarkerInput(`sha256:${'a'.repeat(64)}`, 'sha256:not-canonical'),
      strictPublicationMarkerInput(`SHA256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`),
      {
        ...strictPublicationMarkerInput(`sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`),
        mode: 'legacy',
      },
      {
        ...validInput,
        routeSchemaVersion: 0,
      },
      {
        ...validInput,
        routeSchemaVersion: 2,
      },
    ]) {
      expect(() => createStrictPublicationMarkerV1(invalid as never)).toThrow(
        'STRICT_PUBLICATION_MARKER_FIELDS_INVALID'
      );
    }
  });

  it('binds tool-neutral serving validation into the serving manifest', () => {
    const validationA = createServingSnapshotManifestV1(
      servingSnapshotInput(`sha256:${'a'.repeat(64)}`)
    );
    const validationB = createServingSnapshotManifestV1(
      servingSnapshotInput(`sha256:${'b'.repeat(64)}`)
    );
    expect(validationA.servingSnapshotValidationHash).toBe(`sha256:${'a'.repeat(64)}`);
    expect(validationA.manifestHash).not.toBe(validationB.manifestHash);
    expect(validationA).not.toHaveProperty('candidateOracleHash');

    const { servingSnapshotValidationHash: _missingValidation, ...missingValidation } =
      servingSnapshotInput(`sha256:${'a'.repeat(64)}`);
    expect(() => createServingSnapshotManifestV1(missingValidation as never)).toThrow(
      'SERVING_SNAPSHOT_FIELDS_INVALID'
    );
    expect(() => createServingSnapshotManifestV1(servingSnapshotInput('') as never)).toThrow(
      'SERVING_SNAPSHOT_FIELDS_INVALID'
    );
    expect(() =>
      createServingSnapshotManifestV1(servingSnapshotInput('sha256:not-canonical') as never)
    ).toThrow('SERVING_SNAPSHOT_FIELDS_INVALID');
    expect(() =>
      createServingSnapshotManifestV1({
        ...servingSnapshotInput(`sha256:${'a'.repeat(64)}`),
        candidateOracleHash: `sha256:${'c'.repeat(64)}`,
      } as never)
    ).toThrow('SERVING_SNAPSHOT_FIELDS_INVALID');

    const route = publicRoute('2026-07-16T00:00:00.000Z');
    expect(route.servingSnapshotManifestHash).toBe('sha256:serving');
    expect(route).not.toHaveProperty('servingSnapshotValidationHash');
    expect(route).not.toHaveProperty('candidateOracleHash');
  });

  it('shares one canonical base/repaired snapshot ID parser across serving boundaries', () => {
    const dataManifestHash = `sha256:${'d'.repeat(64)}`;
    const base = createStrictPublicationSnapshotIdV1(dataManifestHash);
    const repaired = createStrictPublicationSnapshotIdV1(
      dataManifestHash,
      '123e4567-e89b-42d3-a456-426614174000'
    );

    expect(base).toBe(`snapshot-${'d'.repeat(64)}`);
    expect(parseStrictPublicationSnapshotIdV1(base)).toEqual({
      schemaVersion: 1,
      snapshotId: base,
      baseSnapshotId: base,
      candidateDataManifestHash: dataManifestHash,
      collisionUuid: null,
    });
    expect(parseStrictPublicationSnapshotIdV1(repaired)).toMatchObject({
      baseSnapshotId: base,
      candidateDataManifestHash: dataManifestHash,
      collisionUuid: '123e4567-e89b-42d3-a456-426614174000',
    });
    expect(() =>
      createServingSnapshotManifestV1({
        ...servingSnapshotInput(`sha256:${'a'.repeat(64)}`),
        snapshotId: repaired,
      })
    ).not.toThrow();
    expect(() =>
      createServingSnapshotManifestV1({
        ...servingSnapshotInput(`sha256:${'a'.repeat(64)}`),
        snapshotId: `snapshot-${'e'.repeat(64)}`,
      })
    ).toThrow('SERVING_SNAPSHOT_FIELDS_INVALID');
    for (const invalid of [
      'snapshot-1',
      `snapshot-${'D'.repeat(64)}`,
      `snapshot-${'d'.repeat(63)}`,
      `snapshot-${'d'.repeat(64)}-../escape`,
      `snapshot-${'d'.repeat(64)}-123e4567-e89b-12d3-a456-426614174000`,
      `snapshot-${'d'.repeat(64)}-123e4567-e89b-42d3-7456-426614174000`,
    ]) {
      expect(() => parseStrictPublicationSnapshotIdV1(invalid)).toThrow(
        'STRICT_PUBLICATION_SNAPSHOT_ID_INVALID'
      );
    }
  });

  it('rejects unknown or nested private fields at public snapshot and route boundaries', () => {
    expect(() =>
      createServingSnapshotManifestV1({
        ...servingSnapshotInput(`sha256:${'a'.repeat(64)}`),
        privateCorpusRevision: 'revision-private',
      } as never)
    ).toThrow('SERVING_SNAPSHOT_FIELDS_INVALID');

    expect(() =>
      preparePublicKnowledgeRouteV1({
        ...publicRoute('2026-07-16T00:00:00.000Z'),
        metadata: { token: 'private-token', privateCorpusRevision: 'revision-private' },
      } as never)
    ).toThrow('PUBLIC_ROUTE_FIELDS_INVALID');
  });
});

function strictPersistenceAuthority(candidateFingerprint: string) {
  const g1Receipt = createStrictG1ReceiptV1({
    candidateFingerprint,
    retrievalReadinessHash: 'sha256:retrieval-ready',
    rows: STRICT_G1_HARD_AXES_V1.map((axis) => ({
      axis,
      verdict: 'pass' as const,
      reasonCode: 'verified',
      evidenceRefs: [`evidence:${axis}`],
    })),
  });
  const corpusInspection = createStrictAcceptedCorpusInspectionV1({
    runId: 'run-1',
    analysisFixpointHash: 'sha256:fixpoint',
    privateCorpusRevision: 'revision-1',
    revisionRootManifestHash: `sha256:${'9'.repeat(64)}`,
    entries: [],
  });
  const admissionReceipt = createStrictAdmissionReceiptV1({
    g1Receipt,
    corpusInspection,
    inputFingerprint: candidateFingerprint,
    finalAdmittedFingerprint: candidateFingerprint,
    exactMatches: [],
    semanticMatches: [],
    consolidation: {
      action: 'create',
      reasonCode: 'strict-test-novel-candidate',
      targetRecipeId: null,
      targetFingerprint: null,
    },
    algorithmVersion: 'gateway-admission-v1',
  });
  const g2Receipt = createStrictG2ReceiptV1({
    g1Receipt,
    admissionReceipt,
    reviewedFingerprint: candidateFingerprint,
    producer: {
      identity: 'producer-model',
      method: 'recipe-expression-v1',
      modelHash: 'sha256:producer-model',
      promptHash: 'sha256:producer-prompt',
    },
    reviewer: {
      identity: 'independent-reviewer',
      method: 'value-gate-v1',
      modelHash: 'sha256:reviewer-model',
      promptHash: 'sha256:reviewer-prompt',
    },
    rows: STRICT_G2_HARD_AXES_V1.map((axis) => ({
      axis,
      axisVerdict: 'pass' as const,
      score: 2 as const,
      reasonCode: 'verified',
      evidenceRefs: [`evidence:${axis}`],
      repairable: false,
    })),
    novelty: {
      decision: 'novel-project-specific',
      reasonCode: 'project-specific-mechanism',
      evidenceRefs: ['E-1'],
    },
    duplicate: {
      decision: 'no-match',
      reasonCode: 'complete-corpus-no-match',
      evidenceRefs: ['E-1'],
      admissionAlgorithmVersion: admissionReceipt.algorithmVersion,
      comparedPrivateCorpusRevision: admissionReceipt.privateCorpusRevision,
      matchedRecipeIds: [],
      matchedFingerprints: [],
      targetRecipeId: null,
      consolidationFingerprint: null,
    },
    repairAttempt: 0,
    calibrationReceiptHash: 'sha256:calibration',
    ruleVersion: 'strict-g2-rule-v1',
    permittedRepairFields: [],
  });
  return { g1Receipt, admissionReceipt, g2Receipt };
}

function strictPublicationMarkerInput(projectIdentityHash: string, migrationBundleHash: string) {
  return {
    mode: 'strict-v1' as const,
    routeSchemaVersion: 1 as const,
    projectIdentityHash,
    migrationBundleHash,
  };
}

function servingSnapshotInput(servingSnapshotValidationHash: string) {
  const candidateDataManifestHash = `sha256:${'d'.repeat(64)}`;
  return {
    sessionId: 'session-1',
    snapshotId: createStrictPublicationSnapshotIdV1(candidateDataManifestHash),
    candidateDataManifestHash,
    finalCoverageBindingHash: 'sha256:coverage',
    servingSnapshotValidationHash,
    vectorGenerationId: 'vector-1',
    vectorManifestHash: 'sha256:vector',
    certifiedProjectFactsHash: 'sha256:facts',
    sourceRevisionVectorHash: 'sha256:source',
    analysisFixpointHash: 'sha256:fixpoint',
  };
}

function publicRoute(committedAt: string): PublicKnowledgeRouteV1 & Record<string, unknown> {
  return {
    schemaVersion: 1,
    sessionId: 'session-1',
    snapshotId: createStrictPublicationSnapshotIdV1(`sha256:${'d'.repeat(64)}`),
    servingSnapshotManifestHash: 'sha256:serving',
    vectorGenerationId: 'vector-1',
    vectorManifestHash: 'sha256:vector',
    certifiedProjectFactsHash: 'sha256:facts',
    sourceRevisionVectorHash: 'sha256:source',
    planCognitionLineageHash: 'sha256:lineage',
    compiledPlanHash: 'sha256:plan',
    factQueryCatalogHash: 'sha256:queries',
    requiredApplicabilityUniverseHash: 'sha256:applicability',
    baselineScheduleHash: 'sha256:baseline',
    expansionLedgerHeadHash: 'sha256:expansion',
    finalExpandedScheduleHash: 'sha256:final-schedule',
    analysisFixpointHash: 'sha256:fixpoint',
    hypothesisExpressionSetManifestHash: 'sha256:expressions',
    finalCodeFactGenerationManifestHash: 'sha256:facts-final',
    committedAt,
  };
}

function candidateAttempt(
  cellId: string,
  criticality: 'critical' | 'standard' | 'non-critical',
  authoredFingerprint: string
) {
  return {
    runId: 'run-1',
    analysisFixpointHash: 'sha256:fixpoint',
    privateCorpusRevision: 'revision-1',
    hypothesisId: `hypothesis:${authoredFingerprint}`,
    expressionSetReceiptId: `expression-set:${authoredFingerprint}`,
    expressionId: `expression:${authoredFingerprint}`,
    terminalReceiptId: `terminal:${authoredFingerprint}`,
    terminalReceiptHash: `sha256:${'5'.repeat(64)}`,
    cellId,
    criticality,
    passOrdinal: 0,
    authoredFingerprint,
    causalParentIds: [],
  };
}

function cloneReceipt(
  receipt: PrivateCorpusRevisionInitReceiptV1
): PrivateCorpusRevisionInitReceiptV1 {
  return JSON.parse(JSON.stringify(receipt)) as PrivateCorpusRevisionInitReceiptV1;
}

function expectedRevisionContext(receipt: PrivateCorpusRevisionInitReceiptV1) {
  return {
    runId: receipt.runId,
    revisionId: receipt.revisionId,
    analysisFixpointHash: receipt.analysisFixpointHash,
    configReceiptHash: receipt.configReceiptHash,
    runtimeReceiptHash: receipt.runtimeReceiptHash,
  };
}

function privateScopeResolver(
  root: string,
  identity: {
    projectId?: string;
    projectScopeId?: string;
  } = {}
): WorkspaceResolver {
  const folderId = 'folder-private-corpus';
  const projectScope = createProjectDescriptor({
    controlRoot: path.dirname(root),
    dataRoot: root,
    projectId: identity.projectId ?? 'project-private-corpus',
    projectScopeId: identity.projectScopeId ?? 'scope-private-corpus',
    currentFolderId: folderId,
    folders: [{ id: folderId, path: root }],
  });
  return new WorkspaceResolver({ projectRoot: root, projectScope, currentFolderId: folderId });
}
