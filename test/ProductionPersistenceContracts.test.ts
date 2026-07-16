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
  canonicalizeCandidateAttemptBatchV1,
  classifyPublicKnowledgeRouteRecoveryV1,
  createCandidateCoverageReceiptV1,
  createFinalCoverageBindingReceiptV1,
  createRecipeCandidateFingerprintProjectionV1,
  createRecipeProductionBindingV1,
  createRefReconciliationReceiptV1,
  createServingSnapshotManifestV1,
  createStrictG1ReceiptV1,
  createStrictPersistenceReceiptV1,
  type PublicKnowledgeRouteV1,
  preparePublicKnowledgeRouteV1,
  prepareRecipePersistenceV1,
  STRICT_G1_HARD_AXES_V1,
  validateSerialAdmissionLedgerV1,
} from '../src/knowledge.js';
import { hashCanonicalJson } from '../src/service/project-context/foundation/canonical.js';
import { createProjectDescriptor } from '../src/shared/ProjectScope.js';
import {
  assertPrivateCorpusRevisionHandleV1,
  initializePrivateCorpusRevisionV1,
  PrivateCorpusRevisionHandleV1,
  WorkspaceResolver,
} from '../src/workspace.js';

const roots: string[] = [];
const acceptedMigrationBundleSemanticHash = hashCanonicalJson(readAlembicMigrationBundleManifest());
const configReceiptHash = `sha256:${'c'.repeat(64)}`;

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('production persistence contracts', () => {
  it('allocates each private revision under a fixed absent-before-create namespace and revokes the old handle', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-private-revision-'));
    roots.push(root);
    const base = privateScopeResolver(root);
    const first = await initializePrivateCorpusRevisionV1(base, {
      runId: 'run-1',
      revisionId: 'revision-1',
      analysisFixpointHash: `sha256:${'1'.repeat(64)}`,
      configReceiptHash,
      credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
      acceptedMigrationBundleSemanticHash,
    });
    expect(first.handle.resolver.projectRoot).toBe(base.projectRoot);
    expect(first.handle.resolver.dataRoot).toContain(
      path.join('.asd', 'context', 'recipe-runs', 'run-1', 'corpora', 'revision-1')
    );
    expect(first.handle.initReceipt.requiredMigration017Present).toBe(true);
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
        credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
        acceptedMigrationBundleSemanticHash,
      })
    ).rejects.toThrow('PRIVATE_CORPUS_REVISION_LEAF_ALREADY_EXISTS');

    const second = await initializePrivateCorpusRevisionV1(base, {
      runId: 'run-1',
      revisionId: 'revision-2',
      analysisFixpointHash: `sha256:${'2'.repeat(64)}`,
      configReceiptHash,
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

  it('separates authored fingerprint, persistence, refs, and production binding receipts', () => {
    const authored = createRecipeCandidateFingerprintProjectionV1({
      title: 'Atomic file replacement',
      kind: 'pattern',
      doText: 'fsync the file before rename',
      dontText: 'do not expose partial bytes',
      markdown: 'Use a same-directory temporary file.',
      usageGuide: 'Apply to durable knowledge writes.',
      retrievalProfile: { intents: ['safe write'] },
      negativeIntents: ['in-memory-only'],
      scopeId: 'repo:core',
      moduleId: 'knowledge',
      dimensionId: 'reliability',
      evidenceRefs: ['E-17'],
      lineageHashes: ['sha256:fixpoint'],
    });
    const prepared = prepareRecipePersistenceV1({
      runId: 'run-1',
      analysisFixpointHash: 'sha256:fixpoint',
      privateCorpusRevision: 'revision-1',
      cellId: 'knowledge::reliability',
      authoredFingerprint: authored.authoredFingerprint,
      causalParentIds: ['root-1'],
      expectedDbHash: 'sha256:db-row',
      expectedFileHash: 'sha256:file',
      journalStepHash: 'sha256:journal-step',
    });
    const persistence = createStrictPersistenceReceiptV1({
      prepared,
      g1ReceiptHash: 'sha256:g1',
      admissionReceiptHash: 'sha256:admission',
      g2ReceiptHash: 'sha256:g2',
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
        g1ReceiptHash: 'sha256:g1',
        admissionReceiptHash: 'sha256:admission',
        g2ReceiptHash: 'sha256:g2',
        actualRecipeId: '00000000-0000-5000-8000-000000000000',
        actualAuthoredFingerprint: authored.authoredFingerprint,
        storageHash: 'sha256:storage',
        databaseRowHash: 'sha256:db-row',
        fileHash: 'sha256:file',
        actualLifecycle: 'pending',
      })
    ).toThrow('STRICT_PERSISTENCE_PREPARED_ID_MISMATCH');
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
          proposalId: 'p1',
          observedAcceptedCorpusHash: 'sha256:empty',
          terminalFate: 'rejected',
          resultingAcceptedCorpusHash: 'sha256:empty',
          terminalReceiptId: 'r1',
        },
        {
          proposalId: 'p2',
          observedAcceptedCorpusHash: 'sha256:empty',
          terminalFate: 'accepted',
          resultingAcceptedCorpusHash: 'sha256:recipe-2',
          terminalReceiptId: 'r2',
        },
      ],
    });
    expect(ledger.finalAcceptedCorpusHash).toBe('sha256:recipe-2');
    expect(() =>
      validateSerialAdmissionLedgerV1({
        initialAcceptedCorpusHash: 'sha256:empty',
        rows: [
          {
            proposalId: 'p1',
            observedAcceptedCorpusHash: 'sha256:empty',
            terminalFate: 'rejected',
            resultingAcceptedCorpusHash: 'sha256:rejected-proposal',
            terminalReceiptId: 'r1',
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

  it('rejects unknown or nested private fields at public snapshot and route boundaries', () => {
    expect(() =>
      createServingSnapshotManifestV1({
        sessionId: 'session-1',
        snapshotId: 'snapshot-1',
        candidateDataManifestHash: 'sha256:data',
        finalCoverageBindingHash: 'sha256:coverage',
        candidateOracleHash: 'sha256:oracle',
        vectorGenerationId: 'vector-1',
        vectorManifestHash: 'sha256:vector',
        certifiedProjectFactsHash: 'sha256:facts',
        sourceRevisionVectorHash: 'sha256:source',
        analysisFixpointHash: 'sha256:fixpoint',
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

function publicRoute(committedAt: string): PublicKnowledgeRouteV1 & Record<string, unknown> {
  return {
    schemaVersion: 1,
    sessionId: 'session-1',
    snapshotId: 'snapshot-1',
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
    cellId,
    criticality,
    passOrdinal: 0,
    authoredFingerprint,
    causalParentIds: [],
  };
}

function privateScopeResolver(root: string): WorkspaceResolver {
  const folderId = 'folder-private-corpus';
  const projectScope = createProjectDescriptor({
    controlRoot: path.dirname(root),
    dataRoot: root,
    projectId: 'project-private-corpus',
    projectScopeId: 'scope-private-corpus',
    currentFolderId: folderId,
    folders: [{ id: folderId, path: root }],
  });
  return new WorkspaceResolver({ projectRoot: root, projectScope, currentFolderId: folderId });
}
