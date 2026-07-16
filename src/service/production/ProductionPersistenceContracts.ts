import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  readAlembicMigrationBundleManifest,
  revokeAlembicDatabaseRoot,
} from '../../infrastructure/database/DatabaseConnection.js';
import {
  type AlembicDatabaseRuntime,
  openAlembicDatabase,
} from '../../infrastructure/database/openAlembicDatabase.js';
import type { WorkspaceResolver } from '../../shared/WorkspaceResolver.js';
import {
  canonicalJsonStringify,
  hashBytes,
  hashCanonicalJson,
} from '../project-context/foundation/canonical.js';
import { createPrivateCorpusRevisionResolverInternal } from './PrivateCorpusRevisionResolver.js';

export interface PrivateCorpusRevisionInitReceiptV1 {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly revisionId: string;
  readonly analysisFixpointHash: string;
  readonly projectRootHash: string;
  readonly projectId: string;
  readonly projectScopeId: string;
  readonly dataRootHash: string;
  readonly parentRealpathHash: string;
  readonly leafRealpathHash: string;
  readonly noSymlink: true;
  readonly migrationVersions: readonly string[];
  readonly migrationArtifacts: readonly {
    readonly version: string;
    readonly migrationArtifactSha256: string;
  }[];
  readonly migrationLedgerSemanticHash: string;
  readonly requiredMigration017Present: true;
  readonly sqliteIntegrity: 'ok';
  readonly foreignKeyViolationCount: 0;
  readonly configReceiptHash: string;
  readonly credentialLocationSymbol: string;
  readonly blankState: {
    readonly knowledgeEntries: 0;
    readonly sourceRefs: 0;
    readonly coverageRows: 0;
    readonly vectorRoutePresent: false;
    readonly publicationRoutePresent: false;
    readonly recipeFileCount: 0;
    readonly candidateFileCount: 0;
  };
  readonly initReceiptHash: string;
}

const ACTIVE_REVISION_HANDLES = new WeakSet<PrivateCorpusRevisionHandleV1>();
const PRIVATE_REVISION_INIT_AUTHORITY = Symbol('private-revision-init-authority');

export class PrivateCorpusRevisionHandleV1 {
  readonly schemaVersion = 1 as const;
  readonly resolver: WorkspaceResolver;
  readonly initReceipt: PrivateCorpusRevisionInitReceiptV1;
  #sealedRootManifestHash: string | null = null;
  readonly #runtimes = new Set<AlembicDatabaseRuntime>();

  constructor(
    resolver: WorkspaceResolver,
    initReceipt: PrivateCorpusRevisionInitReceiptV1,
    runtime: AlembicDatabaseRuntime,
    authority: symbol
  ) {
    if (authority !== PRIVATE_REVISION_INIT_AUTHORITY) {
      throw new Error('PRIVATE_CORPUS_REVISION_INIT_UNAUTHORIZED');
    }
    if (
      !fs.existsSync(resolver.dataRoot) ||
      hashPath(resolver.dataRoot) !== initReceipt.dataRootHash
    ) {
      throw new Error('PRIVATE_CORPUS_REVISION_INIT_ROOT_MISMATCH');
    }
    this.resolver = resolver;
    this.initReceipt = initReceipt;
    this.#runtimes.add(runtime);
    ACTIVE_REVISION_HANDLES.add(this);
  }

  static replace(
    previous: PrivateCorpusRevisionHandleV1,
    next: PrivateCorpusRevisionHandleV1,
    sealedRootManifestHash: string
  ): PrivateCorpusRevisionHandleV1 {
    assertPrivateCorpusRevisionHandleV1(previous);
    assertPrivateCorpusRevisionHandleV1(next);
    if (previous.initReceipt.runId !== next.initReceipt.runId) {
      throw new Error('PRIVATE_CORPUS_REVISION_CROSS_RUN_REPLACE');
    }
    if (previous.initReceipt.revisionId === next.initReceipt.revisionId) {
      throw new Error('PRIVATE_CORPUS_REVISION_REUSE');
    }
    if (previous.initReceipt.analysisFixpointHash === next.initReceipt.analysisFixpointHash) {
      throw new Error('PRIVATE_CORPUS_REVISION_FIXPOINT_UNCHANGED');
    }
    previous.seal(sealedRootManifestHash);
    previous.invalidate();
    return next;
  }

  registerRuntime(runtime: AlembicDatabaseRuntime): AlembicDatabaseRuntime {
    assertPrivateCorpusRevisionHandleV1(this);
    this.#runtimes.add(runtime);
    return runtime;
  }

  assertResolver(resolver: WorkspaceResolver): void {
    assertPrivateCorpusRevisionHandleV1(this);
    if (path.resolve(resolver.dataRoot) !== path.resolve(this.resolver.dataRoot)) {
      throw new Error('PRIVATE_CORPUS_REVISION_CROSS_REVISION_OPEN');
    }
  }

  seal(rootManifestHash: string): void {
    assertPrivateCorpusRevisionHandleV1(this);
    requireSha256(rootManifestHash, 'PRIVATE_CORPUS_REVISION_MANIFEST_REQUIRED');
    if (this.#sealedRootManifestHash && this.#sealedRootManifestHash !== rootManifestHash) {
      throw new Error('PRIVATE_CORPUS_REVISION_ALREADY_SEALED');
    }
    this.#sealedRootManifestHash = rootManifestHash;
  }

  get sealedRootManifestHash(): string | null {
    return this.#sealedRootManifestHash;
  }

  private invalidate(): void {
    revokeAlembicDatabaseRoot(this.resolver.dataRoot, {
      rootManifestHash: this.#sealedRootManifestHash ?? '',
      initReceiptHash: this.initReceipt.initReceiptHash,
    });
    for (const runtime of this.#runtimes) {
      runtime.close();
    }
    this.#runtimes.clear();
    ACTIVE_REVISION_HANDLES.delete(this);
  }
}

export interface InitializePrivateCorpusRevisionInputV1 {
  readonly runId: string;
  readonly revisionId: string;
  readonly analysisFixpointHash: string;
  readonly configReceiptHash: string;
  readonly credentialLocationSymbol: string;
  readonly acceptedMigrationBundleSemanticHash: string;
  readonly expectedMigrationVersions?: readonly string[];
}

export interface InitializedPrivateCorpusRevisionV1 {
  readonly handle: PrivateCorpusRevisionHandleV1;
  readonly runtime: AlembicDatabaseRuntime;
}

export async function initializePrivateCorpusRevisionV1(
  baseResolver: WorkspaceResolver,
  input: InitializePrivateCorpusRevisionInputV1
): Promise<InitializedPrivateCorpusRevisionV1> {
  if (!baseResolver.projectId || !baseResolver.projectScope?.projectScopeId) {
    throw new Error('PRIVATE_CORPUS_REVISION_PROJECT_SCOPE_IDENTITY_REQUIRED');
  }
  requireSha256(input.configReceiptHash, 'PRIVATE_CORPUS_REVISION_CONFIG_HASH_INVALID');
  requireSha256(input.analysisFixpointHash, 'PRIVATE_CORPUS_REVISION_FIXPOINT_HASH_INVALID');
  requireSha256(
    input.acceptedMigrationBundleSemanticHash,
    'PRIVATE_CORPUS_REVISION_MIGRATION_BUNDLE_HASH_INVALID'
  );
  if (!/^(env|keychain|config-ref):[A-Za-z0-9_.-]+$/.test(input.credentialLocationSymbol)) {
    throw new Error('PRIVATE_CORPUS_REVISION_CREDENTIAL_LOCATION_INVALID');
  }
  const resolver = createPrivateCorpusRevisionResolverInternal(baseResolver, {
    schemaVersion: 1,
    runId: input.runId,
    revisionId: input.revisionId,
  });
  const approvedRootRealpath = fs.realpathSync(baseResolver.dataRoot);
  const migrationArtifacts = readAlembicMigrationBundleManifest();
  const migrationLedgerSemanticHash = hashCanonicalJson(migrationArtifacts);
  if (migrationLedgerSemanticHash !== input.acceptedMigrationBundleSemanticHash) {
    throw new Error('PRIVATE_CORPUS_REVISION_MIGRATION_BUNDLE_MISMATCH');
  }
  const leafRealpath = createConfinedRevisionLeaf(
    baseResolver.dataRoot,
    resolver.dataRoot,
    approvedRootRealpath
  );
  const parentRealpath = fs.realpathSync(path.dirname(resolver.dataRoot));
  fs.mkdirSync(resolver.recipesDir, { recursive: true });
  fs.mkdirSync(resolver.candidatesDir, { recursive: true });

  let runtime: AlembicDatabaseRuntime | null = null;
  try {
    runtime = await openAlembicDatabase(
      { path: resolver.databasePath },
      { workspaceResolver: resolver, runMigrations: true }
    );
    const sqlite = runtime.sqlite;
    const migrationVersions = (
      sqlite.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
        version: string;
      }>
    ).map((row) => row.version);
    if (!migrationVersions.includes('017_recipe_retrieval_profile')) {
      throw new Error('PRIVATE_CORPUS_REVISION_MIGRATION_017_MISSING');
    }
    if (
      canonicalJsonStringify(migrationVersions) !==
      canonicalJsonStringify(migrationArtifacts.map((row) => row.version))
    ) {
      throw new Error('PRIVATE_CORPUS_REVISION_MIGRATION_SET_MISMATCH');
    }
    if (
      input.expectedMigrationVersions &&
      canonicalJsonStringify([...input.expectedMigrationVersions].sort()) !==
        canonicalJsonStringify(migrationVersions)
    ) {
      throw new Error('PRIVATE_CORPUS_REVISION_MIGRATION_SET_MISMATCH');
    }
    const integrity = sqlite.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error('PRIVATE_CORPUS_REVISION_SQLITE_INTEGRITY_FAILED');
    }
    const foreignKeys = sqlite.pragma('foreign_key_check') as unknown[];
    if (foreignKeys.length !== 0) {
      throw new Error('PRIVATE_CORPUS_REVISION_FOREIGN_KEY_FAILED');
    }
    const blankState = {
      knowledgeEntries: countRows(sqlite, 'knowledge_entries'),
      sourceRefs: countRows(sqlite, 'recipe_source_refs'),
      coverageRows: countRows(sqlite, 'coverage_ledger'),
      vectorRoutePresent: fs.existsSync(
        path.join(resolver.contextDir, 'recipe-vector-active.json')
      ),
      publicationRoutePresent: fs.existsSync(
        path.join(resolver.contextDir, 'recipe-publications', 'active.json')
      ),
      recipeFileCount: countRegularFiles(resolver.recipesDir),
      candidateFileCount: countRegularFiles(resolver.candidatesDir),
    };
    if (Object.values(blankState).some((value) => value !== 0 && value !== false)) {
      throw new Error('PRIVATE_CORPUS_REVISION_NOT_BLANK');
    }
    const semantic = {
      schemaVersion: 1 as const,
      runId: input.runId,
      revisionId: input.revisionId,
      analysisFixpointHash: input.analysisFixpointHash,
      projectRootHash: hashPath(baseResolver.projectRoot),
      projectId: baseResolver.projectId,
      projectScopeId: baseResolver.projectScope.projectScopeId,
      dataRootHash: hashPath(resolver.dataRoot),
      parentRealpathHash: hashPath(parentRealpath),
      leafRealpathHash: hashPath(leafRealpath),
      noSymlink: true as const,
      migrationVersions,
      migrationArtifacts,
      migrationLedgerSemanticHash,
      requiredMigration017Present: true as const,
      sqliteIntegrity: 'ok' as const,
      foreignKeyViolationCount: 0 as const,
      configReceiptHash: input.configReceiptHash,
      credentialLocationSymbol: input.credentialLocationSymbol,
      blankState: {
        knowledgeEntries: 0 as const,
        sourceRefs: 0 as const,
        coverageRows: 0 as const,
        vectorRoutePresent: false as const,
        publicationRoutePresent: false as const,
        recipeFileCount: 0 as const,
        candidateFileCount: 0 as const,
      },
    };
    const initReceipt = {
      ...semantic,
      initReceiptHash: hashCanonicalJson(semantic),
    } satisfies PrivateCorpusRevisionInitReceiptV1;
    return {
      handle: new PrivateCorpusRevisionHandleV1(
        resolver,
        initReceipt,
        runtime,
        PRIVATE_REVISION_INIT_AUTHORITY
      ),
      runtime,
    };
  } catch (error) {
    runtime?.close();
    throw error;
  }
}

export function assertPrivateCorpusRevisionHandleV1(handle: PrivateCorpusRevisionHandleV1): void {
  if (!ACTIVE_REVISION_HANDLES.has(handle)) {
    throw new Error('PRIVATE_CORPUS_REVISION_HANDLE_INACTIVE');
  }
}

export async function openPrivateCorpusRevisionDatabaseV1(
  handle: PrivateCorpusRevisionHandleV1
): Promise<AlembicDatabaseRuntime> {
  assertPrivateCorpusRevisionHandleV1(handle);
  handle.assertResolver(handle.resolver);
  return handle.registerRuntime(
    await openAlembicDatabase(
      { path: handle.resolver.databasePath },
      { workspaceResolver: handle.resolver, runMigrations: true }
    )
  );
}

export const STRICT_G1_HARD_AXES_V1 = [
  'schema-and-field-policy',
  'manifest-session-cell-module-identity',
  'source-confinement-revision-and-snippet',
  'claimed-graph-and-source-ref-integrity',
  'retrieval-usage-negative-intent-provenance',
  'credential-private-data-redaction',
  'structured-lineage-and-fingerprint',
  'fact-population-cluster-hypothesis-falsification-lineage',
] as const;

export type StrictG1HardAxisV1 = (typeof STRICT_G1_HARD_AXES_V1)[number];

export interface StrictG1AxisResultV1 {
  readonly axis: StrictG1HardAxisV1;
  readonly verdict: 'pass' | 'fail' | 'unknown';
  readonly reasonCode: string;
  readonly evidenceRefs: readonly string[];
}

export interface StrictG1ReceiptV1 {
  readonly schemaVersion: 1;
  readonly candidateFingerprint: string;
  readonly retrievalReadinessHash: string;
  readonly rows: readonly StrictG1AxisResultV1[];
  readonly verdict: 'pass' | 'fail';
  readonly receiptHash: string;
}

export function createStrictG1ReceiptV1(input: {
  readonly candidateFingerprint: string;
  readonly retrievalReadinessHash: string;
  readonly rows: readonly StrictG1AxisResultV1[];
}): StrictG1ReceiptV1 {
  const rows = input.rows
    .map((row) => ({ ...row, evidenceRefs: normalizeStrings(row.evidenceRefs) }))
    .sort((left, right) => left.axis.localeCompare(right.axis));
  const expected = new Set<string>(STRICT_G1_HARD_AXES_V1);
  if (
    rows.length !== STRICT_G1_HARD_AXES_V1.length ||
    new Set(rows.map((row) => row.axis)).size !== rows.length ||
    rows.some((row) => !expected.has(row.axis))
  ) {
    throw new Error('STRICT_G1_AXIS_SET_MISMATCH');
  }
  for (const row of rows) {
    requireText(row.reasonCode, 'STRICT_G1_REASON_REQUIRED');
    if (row.evidenceRefs.length === 0) {
      throw new Error('STRICT_G1_EVIDENCE_REQUIRED');
    }
  }
  const semantic = {
    schemaVersion: 1 as const,
    candidateFingerprint: input.candidateFingerprint,
    retrievalReadinessHash: input.retrievalReadinessHash,
    rows,
    verdict: rows.every((row) => row.verdict === 'pass') ? ('pass' as const) : ('fail' as const),
  };
  return freezeDeep({ ...semantic, receiptHash: hashCanonicalJson(semantic) });
}

export interface PreparedRecipePersistenceV1 {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly cellId: string;
  readonly authoredFingerprint: string;
  readonly causalParentIds: readonly string[];
  readonly preparedRecipeId: string;
  readonly expectedDbHash: string;
  readonly expectedFileHash: string;
  readonly journalStepHash: string;
  readonly preparedHash: string;
}

export function prepareRecipePersistenceV1(input: {
  readonly runId: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly cellId: string;
  readonly authoredFingerprint: string;
  readonly causalParentIds: readonly string[];
  readonly expectedDbHash: string;
  readonly expectedFileHash: string;
  readonly journalStepHash: string;
}): PreparedRecipePersistenceV1 {
  const identity = {
    runId: input.runId,
    analysisFixpointHash: input.analysisFixpointHash,
    privateCorpusRevision: input.privateCorpusRevision,
    cellId: input.cellId,
    authoredFingerprint: input.authoredFingerprint,
    causalParentIds: normalizeStrings(input.causalParentIds),
  };
  const preparedRecipeId = deterministicUuid(hashCanonicalJson(identity));
  const semantic = {
    schemaVersion: 1 as const,
    ...identity,
    preparedRecipeId,
    expectedDbHash: input.expectedDbHash,
    expectedFileHash: input.expectedFileHash,
    journalStepHash: input.journalStepHash,
  };
  return freezeDeep({ ...semantic, preparedHash: hashCanonicalJson(semantic) });
}

export interface RecipeCandidateFingerprintProjectionV1 {
  readonly schemaVersion: 1;
  readonly title: string;
  readonly kind: string;
  readonly doText: string;
  readonly dontText: string;
  readonly markdown: string;
  readonly usageGuide: string;
  readonly retrievalProfile: unknown;
  readonly negativeIntents: readonly string[];
  readonly scopeId: string;
  readonly moduleId: string;
  readonly dimensionId: string;
  readonly evidenceRefs: readonly string[];
  readonly lineageHashes: readonly string[];
  readonly authoredFingerprint: string;
}

export function createRecipeCandidateFingerprintProjectionV1(
  input: Omit<RecipeCandidateFingerprintProjectionV1, 'schemaVersion' | 'authoredFingerprint'>
): RecipeCandidateFingerprintProjectionV1 {
  const semantic = {
    schemaVersion: 1 as const,
    title: input.title.trim(),
    kind: input.kind.trim(),
    doText: input.doText.trim(),
    dontText: input.dontText.trim(),
    markdown: input.markdown.trim(),
    usageGuide: input.usageGuide.trim(),
    retrievalProfile: input.retrievalProfile,
    negativeIntents: normalizeStrings(input.negativeIntents),
    scopeId: input.scopeId.trim(),
    moduleId: input.moduleId.trim(),
    dimensionId: input.dimensionId.trim(),
    evidenceRefs: normalizeStrings(input.evidenceRefs),
    lineageHashes: normalizeStrings(input.lineageHashes),
  };
  if (
    !semantic.title ||
    !semantic.kind ||
    !semantic.doText ||
    !semantic.usageGuide ||
    !semantic.scopeId ||
    !semantic.moduleId ||
    !semantic.dimensionId ||
    semantic.evidenceRefs.length === 0 ||
    semantic.lineageHashes.length === 0
  ) {
    throw new Error('RECIPE_CANDIDATE_FINGERPRINT_INCOMPLETE');
  }
  return freezeDeep({ ...semantic, authoredFingerprint: hashCanonicalJson(semantic) });
}

export interface StrictPersistenceReceiptV1 {
  readonly schemaVersion: 1;
  readonly preparedHash: string;
  readonly g1ReceiptHash: string;
  readonly admissionReceiptHash: string;
  readonly g2ReceiptHash: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly runId: string;
  readonly cellId: string;
  readonly recipeId: string;
  readonly authoredFingerprint: string;
  readonly storageHash: string;
  readonly databaseRowHash: string;
  readonly fileHash: string;
  readonly lifecycle: 'pending' | 'staging';
  readonly receiptHash: string;
}

export function createStrictPersistenceReceiptV1(input: {
  readonly prepared: PreparedRecipePersistenceV1;
  readonly g1ReceiptHash: string;
  readonly admissionReceiptHash: string;
  readonly g2ReceiptHash: string;
  readonly actualRecipeId: string;
  readonly actualAuthoredFingerprint: string;
  readonly storageHash: string;
  readonly databaseRowHash: string;
  readonly fileHash: string;
  readonly actualLifecycle: StrictPersistenceReceiptV1['lifecycle'];
}): StrictPersistenceReceiptV1 {
  if (input.actualRecipeId !== input.prepared.preparedRecipeId) {
    throw new Error('STRICT_PERSISTENCE_PREPARED_ID_MISMATCH');
  }
  if (input.actualAuthoredFingerprint !== input.prepared.authoredFingerprint) {
    throw new Error('STRICT_PERSISTENCE_FINGERPRINT_MISMATCH');
  }
  if (
    input.databaseRowHash !== input.prepared.expectedDbHash ||
    input.fileHash !== input.prepared.expectedFileHash
  ) {
    throw new Error('STRICT_PERSISTENCE_DURABLE_HASH_MISMATCH');
  }
  if (input.actualLifecycle !== 'pending' && input.actualLifecycle !== 'staging') {
    throw new Error('STRICT_PERSISTENCE_LIFECYCLE_INVALID');
  }
  const semantic = {
    schemaVersion: 1 as const,
    preparedHash: input.prepared.preparedHash,
    g1ReceiptHash: input.g1ReceiptHash,
    admissionReceiptHash: input.admissionReceiptHash,
    g2ReceiptHash: input.g2ReceiptHash,
    analysisFixpointHash: input.prepared.analysisFixpointHash,
    privateCorpusRevision: input.prepared.privateCorpusRevision,
    runId: input.prepared.runId,
    cellId: input.prepared.cellId,
    recipeId: input.actualRecipeId,
    authoredFingerprint: input.actualAuthoredFingerprint,
    storageHash: input.storageHash,
    databaseRowHash: input.databaseRowHash,
    fileHash: input.fileHash,
    lifecycle: input.actualLifecycle,
  };
  return freezeDeep({ ...semantic, receiptHash: hashCanonicalJson(semantic) });
}

export interface RefReconciliationReceiptV1 {
  readonly schemaVersion: 1;
  readonly persistenceReceiptHash: string;
  readonly recipeId: string;
  readonly sourceRefIds: readonly string[];
  readonly reasoningSourceIds: readonly string[];
  readonly bridgeRefIds: readonly string[];
  readonly blockerCodes: readonly [];
  readonly receiptHash: string;
}

export function createRefReconciliationReceiptV1(input: {
  readonly persistence: StrictPersistenceReceiptV1;
  readonly sourceRefIds: readonly string[];
  readonly reasoningSourceIds: readonly string[];
  readonly bridgeRefIds: readonly string[];
  readonly blockerCodes: readonly string[];
}): RefReconciliationReceiptV1 {
  const sourceRefIds = normalizeStrings(input.sourceRefIds);
  const reasoningSourceIds = normalizeStrings(input.reasoningSourceIds);
  const bridgeRefIds = normalizeStrings(input.bridgeRefIds);
  if (
    input.blockerCodes.length > 0 ||
    sourceRefIds.length === 0 ||
    canonicalJsonStringify(sourceRefIds) !== canonicalJsonStringify(reasoningSourceIds) ||
    canonicalJsonStringify(sourceRefIds) !== canonicalJsonStringify(bridgeRefIds)
  ) {
    throw new Error('STRICT_REF_RECONCILIATION_FAILED');
  }
  const semantic = {
    schemaVersion: 1 as const,
    persistenceReceiptHash: input.persistence.receiptHash,
    recipeId: input.persistence.recipeId,
    sourceRefIds,
    reasoningSourceIds,
    bridgeRefIds,
    blockerCodes: [] as const,
  };
  return freezeDeep({ ...semantic, receiptHash: hashCanonicalJson(semantic) });
}

export interface RecipeProductionBindingV1 {
  readonly schemaVersion: 1;
  readonly recipeId: string;
  readonly runId: string;
  readonly manifestHash: string;
  readonly planHash: string;
  readonly cellId: string;
  readonly moduleId: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly authoredFingerprint: string;
  readonly persistenceReceiptHash: string;
  readonly refReconciliationReceiptHash: string;
  readonly bindingHash: string;
}

export function createRecipeProductionBindingV1(input: {
  readonly persistence: StrictPersistenceReceiptV1;
  readonly refReconciliation: RefReconciliationReceiptV1;
  readonly runId: string;
  readonly manifestHash: string;
  readonly planHash: string;
  readonly cellId: string;
  readonly moduleId: string;
}): RecipeProductionBindingV1 {
  if (
    input.refReconciliation.persistenceReceiptHash !== input.persistence.receiptHash ||
    input.refReconciliation.recipeId !== input.persistence.recipeId
  ) {
    throw new Error('RECIPE_PRODUCTION_BINDING_REF_MISMATCH');
  }
  if (input.runId !== input.persistence.runId || input.cellId !== input.persistence.cellId) {
    throw new Error('RECIPE_PRODUCTION_BINDING_PREPARED_LINEAGE_MISMATCH');
  }
  const semantic = {
    schemaVersion: 1 as const,
    recipeId: input.persistence.recipeId,
    runId: input.runId,
    manifestHash: input.manifestHash,
    planHash: input.planHash,
    cellId: input.cellId,
    moduleId: input.moduleId,
    analysisFixpointHash: input.persistence.analysisFixpointHash,
    privateCorpusRevision: input.persistence.privateCorpusRevision,
    authoredFingerprint: input.persistence.authoredFingerprint,
    persistenceReceiptHash: input.persistence.receiptHash,
    refReconciliationReceiptHash: input.refReconciliation.receiptHash,
  };
  return freezeDeep({ ...semantic, bindingHash: hashCanonicalJson(semantic) });
}

export interface CandidateAttemptInputV1 {
  readonly runId: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly cellId: string;
  readonly criticality: 'critical' | 'standard' | 'non-critical';
  readonly passOrdinal: number;
  readonly authoredFingerprint: string;
  readonly causalParentIds: readonly string[];
}

export interface CandidateAttemptBatchV1 {
  readonly schemaVersion: 1;
  readonly passOrdinal: number;
  readonly attempts: readonly CandidateAttemptInputV1[];
  readonly batchHash: string;
}

export function canonicalizeCandidateAttemptBatchV1(input: {
  readonly attempts: readonly CandidateAttemptInputV1[];
  readonly existingAttemptCount: number;
  readonly candidateAttemptCap: number;
  readonly maxAuthoredCandidatesPerCellPass: number;
}): CandidateAttemptBatchV1 {
  if (input.attempts.length === 0) {
    throw new Error('CANDIDATE_BATCH_EMPTY');
  }
  const passOrdinals = new Set(input.attempts.map((row) => row.passOrdinal));
  if (passOrdinals.size !== 1) {
    throw new Error('CANDIDATE_BATCH_MIXED_PASS');
  }
  const attempts = input.attempts
    .map((row) => ({ ...row, causalParentIds: normalizeStrings(row.causalParentIds) }))
    .sort(
      (left, right) =>
        criticalityRank(left.criticality) - criticalityRank(right.criticality) ||
        left.cellId.localeCompare(right.cellId) ||
        left.passOrdinal - right.passOrdinal ||
        left.authoredFingerprint.localeCompare(right.authoredFingerprint)
    );
  const identities = new Set<string>();
  const perCell = new Map<string, number>();
  for (const attempt of attempts) {
    const identity = canonicalJsonStringify({
      runId: attempt.runId,
      analysisFixpointHash: attempt.analysisFixpointHash,
      privateCorpusRevision: attempt.privateCorpusRevision,
      cellId: attempt.cellId,
      authoredFingerprint: attempt.authoredFingerprint,
      causalParentIds: attempt.causalParentIds,
    });
    if (identities.has(identity)) {
      throw new Error('CANDIDATE_BATCH_DUPLICATE_ATTEMPT');
    }
    identities.add(identity);
    perCell.set(attempt.cellId, (perCell.get(attempt.cellId) ?? 0) + 1);
  }
  if ([...perCell.values()].some((count) => count > input.maxAuthoredCandidatesPerCellPass)) {
    throw new Error('CANDIDATE_CAP_OVERFLOW');
  }
  if (input.existingAttemptCount + attempts.length > input.candidateAttemptCap) {
    throw new Error('CANDIDATE_CAP_OVERFLOW');
  }
  const semantic = {
    schemaVersion: 1 as const,
    passOrdinal: attempts[0]?.passOrdinal ?? 0,
    attempts,
  };
  return freezeDeep({ ...semantic, batchHash: hashCanonicalJson(semantic) });
}

export interface SerialAdmissionRowV1 {
  readonly proposalId: string;
  readonly observedAcceptedCorpusHash: string;
  readonly terminalFate: 'accepted' | 'rejected' | 'revise';
  readonly resultingAcceptedCorpusHash: string;
  readonly terminalReceiptId: string;
}

export interface SerialAdmissionLedgerV1 {
  readonly schemaVersion: 1;
  readonly initialAcceptedCorpusHash: string;
  readonly rows: readonly SerialAdmissionRowV1[];
  readonly finalAcceptedCorpusHash: string;
  readonly ledgerHash: string;
}

export function validateSerialAdmissionLedgerV1(input: {
  readonly initialAcceptedCorpusHash: string;
  readonly rows: readonly SerialAdmissionRowV1[];
}): SerialAdmissionLedgerV1 {
  let acceptedCorpusHash = input.initialAcceptedCorpusHash;
  const rows = [...input.rows];
  const proposalIds = new Set<string>();
  for (const row of rows) {
    if (proposalIds.has(row.proposalId)) {
      throw new Error('SERIAL_ADMISSION_PROPOSAL_DUPLICATE');
    }
    proposalIds.add(row.proposalId);
    if (row.observedAcceptedCorpusHash !== acceptedCorpusHash) {
      throw new Error('SERIAL_ADMISSION_STALE_PREDECESSOR');
    }
    if (!row.terminalReceiptId) {
      throw new Error('SERIAL_ADMISSION_TERMINAL_RECEIPT_REQUIRED');
    }
    if (row.terminalFate === 'accepted') {
      if (row.resultingAcceptedCorpusHash === acceptedCorpusHash) {
        throw new Error('SERIAL_ADMISSION_ACCEPTED_CORPUS_UNCHANGED');
      }
      acceptedCorpusHash = row.resultingAcceptedCorpusHash;
    } else if (row.resultingAcceptedCorpusHash !== acceptedCorpusHash) {
      throw new Error('SERIAL_ADMISSION_REJECTED_PREDECESSOR_RETAINED');
    }
  }
  const semantic = {
    schemaVersion: 1 as const,
    initialAcceptedCorpusHash: input.initialAcceptedCorpusHash,
    rows,
    finalAcceptedCorpusHash: acceptedCorpusHash,
  };
  return freezeDeep({ ...semantic, ledgerHash: hashCanonicalJson(semantic) });
}

export type CandidateCoverageDisposition =
  | 'covered-by-content-ready-candidate'
  | 'investigated-empty'
  | 'failed'
  | 'unknown';

export interface CandidateCoverageCellV1 {
  readonly cellId: string;
  readonly candidateDisposition: CandidateCoverageDisposition;
  readonly contentReadyRecipeIds: readonly string[];
  readonly contentReadyRecipeFingerprints: readonly string[];
  readonly productionBindingHashes: readonly string[];
  readonly lensBindingIds: readonly string[];
  readonly expressionSetReceiptIds: readonly string[];
  readonly investigatedEmptyDecisionHash?: string;
}

export interface CandidateCoverageReceiptV1 {
  readonly schemaVersion: 1;
  readonly planBaselineHash: string;
  readonly finalExpandedScheduleHash: string;
  readonly analysisFixpointHash: string;
  readonly evidenceLedgerHash: string;
  readonly candidateDatabaseHash: string;
  readonly candidateFilesHash: string;
  readonly requiredCellIdsHash: string;
  readonly cells: readonly CandidateCoverageCellV1[];
  readonly receiptHash: string;
}

export function createCandidateCoverageReceiptV1(input: {
  readonly planBaselineHash: string;
  readonly finalExpandedScheduleHash: string;
  readonly analysisFixpointHash: string;
  readonly evidenceLedgerHash: string;
  readonly candidateDatabaseHash: string;
  readonly candidateFilesHash: string;
  readonly requiredCellIds: readonly string[];
  readonly cells: readonly CandidateCoverageCellV1[];
}): CandidateCoverageReceiptV1 {
  if (
    !Array.isArray(input.requiredCellIds) ||
    !Array.isArray(input.cells) ||
    input.cells.some(
      (cell) =>
        !Array.isArray(cell.contentReadyRecipeIds) ||
        !Array.isArray(cell.contentReadyRecipeFingerprints) ||
        !Array.isArray(cell.productionBindingHashes) ||
        !Array.isArray(cell.lensBindingIds) ||
        !Array.isArray(cell.expressionSetReceiptIds)
    )
  ) {
    throw new Error('CANDIDATE_COVERAGE_REQUIRED_UNIVERSE_MISMATCH');
  }
  const requiredCellIds = normalizeStrings(input.requiredCellIds);
  const cells = input.cells
    .map((cell) => ({
      ...cell,
      contentReadyRecipeIds: normalizeStrings(cell.contentReadyRecipeIds),
      contentReadyRecipeFingerprints: normalizeStrings(cell.contentReadyRecipeFingerprints),
      productionBindingHashes: normalizeStrings(cell.productionBindingHashes),
      lensBindingIds: normalizeStrings(cell.lensBindingIds),
      expressionSetReceiptIds: normalizeStrings(cell.expressionSetReceiptIds),
    }))
    .sort(byId('cellId'));
  if (new Set(cells.map((cell) => cell.cellId)).size !== cells.length) {
    throw new Error('CANDIDATE_COVERAGE_CELL_DUPLICATE');
  }
  if (
    requiredCellIds.length === 0 ||
    canonicalJsonStringify(cells.map((cell) => cell.cellId)) !==
      canonicalJsonStringify(requiredCellIds)
  ) {
    throw new Error('CANDIDATE_COVERAGE_REQUIRED_UNIVERSE_MISMATCH');
  }
  for (const cell of cells) {
    if (!CANDIDATE_COVERAGE_DISPOSITIONS.has(cell.candidateDisposition)) {
      throw new Error('CANDIDATE_COVERAGE_DISPOSITION_INVALID');
    }
    if (cell.candidateDisposition === 'failed' || cell.candidateDisposition === 'unknown') {
      throw new Error('CANDIDATE_COVERAGE_NONTERMINAL');
    }
    if (
      cell.candidateDisposition === 'covered-by-content-ready-candidate' &&
      (cell.contentReadyRecipeIds.length === 0 ||
        cell.contentReadyRecipeIds.length !== cell.contentReadyRecipeFingerprints.length ||
        cell.contentReadyRecipeIds.length !== cell.productionBindingHashes.length ||
        cell.lensBindingIds.length === 0 ||
        cell.expressionSetReceiptIds.length === 0)
    ) {
      throw new Error('CANDIDATE_COVERAGE_CONTENT_READY_LINEAGE_MISSING');
    }
    if (cell.candidateDisposition === 'investigated-empty' && !cell.investigatedEmptyDecisionHash) {
      throw new Error('CANDIDATE_COVERAGE_EMPTY_DECISION_MISSING');
    }
    if (
      cell.candidateDisposition === 'investigated-empty' &&
      (cell.contentReadyRecipeIds.length > 0 ||
        cell.contentReadyRecipeFingerprints.length > 0 ||
        cell.productionBindingHashes.length > 0 ||
        cell.expressionSetReceiptIds.length > 0)
    ) {
      throw new Error('CANDIDATE_COVERAGE_EMPTY_BINDING_CONFLICT');
    }
  }
  const semantic = {
    schemaVersion: 1 as const,
    planBaselineHash: input.planBaselineHash,
    finalExpandedScheduleHash: input.finalExpandedScheduleHash,
    analysisFixpointHash: input.analysisFixpointHash,
    evidenceLedgerHash: input.evidenceLedgerHash,
    candidateDatabaseHash: input.candidateDatabaseHash,
    candidateFilesHash: input.candidateFilesHash,
    requiredCellIdsHash: hashCanonicalJson(requiredCellIds),
    cells,
  };
  return freezeDeep({ ...semantic, receiptHash: hashCanonicalJson(semantic) });
}

export type FinalCoverageDisposition =
  | 'covered-by-ready-recipe'
  | 'investigated-empty'
  | 'failed'
  | 'unknown';

export interface FinalCoverageBindingReceiptV1 {
  readonly schemaVersion: 1;
  readonly candidateCoverageReceiptHash: string;
  readonly candidateCellSetHash: string;
  readonly g4ReceiptHash: string;
  readonly candidateDataManifestHash: string;
  readonly cells: readonly {
    readonly cellId: string;
    readonly finalDisposition: FinalCoverageDisposition;
    readonly finalRecipeIds: readonly string[];
    readonly finalRecipeFingerprints: readonly string[];
  }[];
  readonly receiptHash: string;
}

export function createFinalCoverageBindingReceiptV1(input: {
  readonly candidateCoverage: CandidateCoverageReceiptV1;
  readonly g4ReceiptHash: string;
  readonly candidateDataManifestHash: string;
  readonly cells: FinalCoverageBindingReceiptV1['cells'];
}): FinalCoverageBindingReceiptV1 {
  const candidateSemantic = {
    schemaVersion: 1 as const,
    planBaselineHash: input.candidateCoverage.planBaselineHash,
    finalExpandedScheduleHash: input.candidateCoverage.finalExpandedScheduleHash,
    analysisFixpointHash: input.candidateCoverage.analysisFixpointHash,
    evidenceLedgerHash: input.candidateCoverage.evidenceLedgerHash,
    candidateDatabaseHash: input.candidateCoverage.candidateDatabaseHash,
    candidateFilesHash: input.candidateCoverage.candidateFilesHash,
    requiredCellIdsHash: input.candidateCoverage.requiredCellIdsHash,
    cells: input.candidateCoverage.cells,
  };
  if (input.candidateCoverage.receiptHash !== hashCanonicalJson(candidateSemantic)) {
    throw new Error('FINAL_COVERAGE_CANDIDATE_RECEIPT_HASH_MISMATCH');
  }
  const cells = input.cells
    .map((cell) => ({
      ...cell,
      finalRecipeIds: normalizeStrings(cell.finalRecipeIds),
      finalRecipeFingerprints: normalizeStrings(cell.finalRecipeFingerprints),
    }))
    .sort(byId('cellId'));
  if (
    new Set(cells.map((cell) => cell.cellId)).size !== cells.length ||
    canonicalJsonStringify(cells.map((cell) => cell.cellId)) !==
      canonicalJsonStringify(input.candidateCoverage.cells.map((cell) => cell.cellId))
  ) {
    throw new Error('FINAL_COVERAGE_CANDIDATE_UNIVERSE_MISMATCH');
  }
  for (const cell of cells) {
    if (!FINAL_COVERAGE_DISPOSITIONS.has(cell.finalDisposition)) {
      throw new Error('FINAL_COVERAGE_DISPOSITION_INVALID');
    }
    const candidateCell = input.candidateCoverage.cells.find(
      (candidate) => candidate.cellId === cell.cellId
    );
    if (!candidateCell) {
      throw new Error('FINAL_COVERAGE_CANDIDATE_UNIVERSE_MISMATCH');
    }
    if (cell.finalDisposition === 'failed' || cell.finalDisposition === 'unknown') {
      throw new Error('FINAL_COVERAGE_NONTERMINAL');
    }
    if (
      cell.finalDisposition === 'covered-by-ready-recipe' &&
      (cell.finalRecipeIds.length === 0 ||
        cell.finalRecipeIds.length !== cell.finalRecipeFingerprints.length)
    ) {
      throw new Error('FINAL_COVERAGE_READY_BINDING_MISMATCH');
    }
    if (
      (candidateCell.candidateDisposition === 'covered-by-content-ready-candidate' &&
        (cell.finalDisposition !== 'covered-by-ready-recipe' ||
          canonicalJsonStringify(cell.finalRecipeIds) !==
            canonicalJsonStringify(candidateCell.contentReadyRecipeIds) ||
          canonicalJsonStringify(cell.finalRecipeFingerprints) !==
            canonicalJsonStringify(candidateCell.contentReadyRecipeFingerprints))) ||
      (candidateCell.candidateDisposition === 'investigated-empty' &&
        cell.finalDisposition !== 'investigated-empty')
    ) {
      throw new Error('FINAL_COVERAGE_CANDIDATE_LINEAGE_MISMATCH');
    }
    if (
      cell.finalDisposition === 'investigated-empty' &&
      (cell.finalRecipeIds.length > 0 || cell.finalRecipeFingerprints.length > 0)
    ) {
      throw new Error('FINAL_COVERAGE_EMPTY_BINDING_CONFLICT');
    }
  }
  const semantic = {
    schemaVersion: 1 as const,
    candidateCoverageReceiptHash: input.candidateCoverage.receiptHash,
    candidateCellSetHash: hashCanonicalJson(
      input.candidateCoverage.cells.map((cell) => cell.cellId)
    ),
    g4ReceiptHash: input.g4ReceiptHash,
    candidateDataManifestHash: input.candidateDataManifestHash,
    cells,
  };
  return freezeDeep({ ...semantic, receiptHash: hashCanonicalJson(semantic) });
}

export interface StrictPublicationMarkerV1 {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly projectScopeId: string;
  readonly strictConfigReceiptHash: string;
  readonly publicationModeVersion: string;
  readonly markerHash: string;
}

export function createStrictPublicationMarkerV1(
  input: Omit<StrictPublicationMarkerV1, 'schemaVersion' | 'markerHash'>
): StrictPublicationMarkerV1 {
  if (!input.projectId || !input.projectScopeId || !input.strictConfigReceiptHash) {
    throw new Error('STRICT_PUBLICATION_MARKER_IDENTITY_MISSING');
  }
  const semantic = { schemaVersion: 1 as const, ...input };
  return freezeDeep({ ...semantic, markerHash: hashCanonicalJson(semantic) });
}

export interface ServingSnapshotManifestV1 {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly snapshotId: string;
  readonly candidateDataManifestHash: string;
  readonly finalCoverageBindingHash: string;
  readonly candidateOracleHash: string;
  readonly vectorGenerationId: string;
  readonly vectorManifestHash: string;
  readonly certifiedProjectFactsHash: string;
  readonly sourceRevisionVectorHash: string;
  readonly analysisFixpointHash: string;
  readonly manifestHash: string;
}

export function createServingSnapshotManifestV1(
  input: Omit<ServingSnapshotManifestV1, 'schemaVersion' | 'manifestHash'>
): ServingSnapshotManifestV1 {
  assertExactKeys(
    input as unknown as Record<string, unknown>,
    SERVING_SNAPSHOT_INPUT_KEYS,
    'SERVING_SNAPSHOT_FIELDS_INVALID'
  );
  const semantic = {
    schemaVersion: 1 as const,
    sessionId: input.sessionId,
    snapshotId: input.snapshotId,
    candidateDataManifestHash: input.candidateDataManifestHash,
    finalCoverageBindingHash: input.finalCoverageBindingHash,
    candidateOracleHash: input.candidateOracleHash,
    vectorGenerationId: input.vectorGenerationId,
    vectorManifestHash: input.vectorManifestHash,
    certifiedProjectFactsHash: input.certifiedProjectFactsHash,
    sourceRevisionVectorHash: input.sourceRevisionVectorHash,
    analysisFixpointHash: input.analysisFixpointHash,
  };
  if (Object.values(semantic).some((value) => typeof value === 'string' && !value.trim())) {
    throw new Error('SERVING_SNAPSHOT_FIELDS_INVALID');
  }
  return freezeDeep({ ...semantic, manifestHash: hashCanonicalJson(semantic) });
}

export interface PublicKnowledgeRouteV1 {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly snapshotId: string;
  readonly servingSnapshotManifestHash: string;
  readonly vectorGenerationId: string;
  readonly vectorManifestHash: string;
  readonly certifiedProjectFactsHash: string;
  readonly sourceRevisionVectorHash: string;
  readonly planCognitionLineageHash: string;
  readonly compiledPlanHash: string;
  readonly factQueryCatalogHash: string;
  readonly requiredApplicabilityUniverseHash: string;
  readonly baselineScheduleHash: string;
  readonly expansionLedgerHeadHash: string;
  readonly finalExpandedScheduleHash: string;
  readonly analysisFixpointHash: string;
  readonly hypothesisExpressionSetManifestHash: string;
  readonly finalCodeFactGenerationManifestHash: string;
  readonly committedAt: string;
}

export interface PreparedPublicKnowledgeRouteV1 {
  readonly route: PublicKnowledgeRouteV1;
  readonly canonicalBytes: string;
  readonly routeBytesHash: string;
  readonly semanticHash: string;
}

export function preparePublicKnowledgeRouteV1(
  input: PublicKnowledgeRouteV1
): PreparedPublicKnowledgeRouteV1 {
  assertExactKeys(
    input as unknown as Record<string, unknown>,
    PUBLIC_ROUTE_KEYS,
    'PUBLIC_ROUTE_FIELDS_INVALID'
  );
  if (input.schemaVersion !== 1) {
    throw new Error('PUBLIC_ROUTE_FIELDS_INVALID');
  }
  const committed = Date.parse(input.committedAt);
  if (!Number.isFinite(committed)) {
    throw new Error('PUBLIC_ROUTE_TIMESTAMP_INVALID');
  }
  const route = freezeDeep({
    schemaVersion: 1 as const,
    sessionId: input.sessionId,
    snapshotId: input.snapshotId,
    servingSnapshotManifestHash: input.servingSnapshotManifestHash,
    vectorGenerationId: input.vectorGenerationId,
    vectorManifestHash: input.vectorManifestHash,
    certifiedProjectFactsHash: input.certifiedProjectFactsHash,
    sourceRevisionVectorHash: input.sourceRevisionVectorHash,
    planCognitionLineageHash: input.planCognitionLineageHash,
    compiledPlanHash: input.compiledPlanHash,
    factQueryCatalogHash: input.factQueryCatalogHash,
    requiredApplicabilityUniverseHash: input.requiredApplicabilityUniverseHash,
    baselineScheduleHash: input.baselineScheduleHash,
    expansionLedgerHeadHash: input.expansionLedgerHeadHash,
    finalExpandedScheduleHash: input.finalExpandedScheduleHash,
    analysisFixpointHash: input.analysisFixpointHash,
    hypothesisExpressionSetManifestHash: input.hypothesisExpressionSetManifestHash,
    finalCodeFactGenerationManifestHash: input.finalCodeFactGenerationManifestHash,
    committedAt: input.committedAt,
  });
  if (Object.values(route).some((value) => typeof value === 'string' && !value.trim())) {
    throw new Error('PUBLIC_ROUTE_FIELDS_INVALID');
  }
  const canonicalBytes = canonicalJsonStringify(route);
  const { committedAt: _committedAt, ...semanticRoute } = route;
  return freezeDeep({
    route,
    canonicalBytes,
    routeBytesHash: hashBytes(Buffer.from(canonicalBytes)),
    semanticHash: hashCanonicalJson(semanticRoute),
  });
}

export type PublicKnowledgeRouteRecoveryDecisionV1 =
  | 'write-prepared-route'
  | 'recover-rename-succeeded'
  | 'conflict';

export function classifyPublicKnowledgeRouteRecoveryV1(
  currentCanonicalBytes: string | null,
  prepared: PreparedPublicKnowledgeRouteV1
): PublicKnowledgeRouteRecoveryDecisionV1 {
  if (currentCanonicalBytes === null) {
    return 'write-prepared-route';
  }
  const currentBytesHash = hashBytes(Buffer.from(currentCanonicalBytes));
  if (
    currentCanonicalBytes === prepared.canonicalBytes &&
    currentBytesHash === prepared.routeBytesHash
  ) {
    return 'recover-rename-succeeded';
  }
  return 'conflict';
}

function createConfinedRevisionLeaf(
  approvedRoot: string,
  leaf: string,
  approvedRootRealpath: string
): string {
  const resolvedRoot = path.resolve(approvedRoot);
  const resolvedLeaf = path.resolve(leaf);
  const relativeLeaf = path.relative(resolvedRoot, resolvedLeaf);
  if (!relativeLeaf || relativeLeaf.startsWith('..') || path.isAbsolute(relativeLeaf)) {
    throw new Error('PRIVATE_CORPUS_REVISION_CONFINEMENT_FAILED');
  }
  const rootStat = fs.lstatSync(resolvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('PRIVATE_CORPUS_REVISION_CONFINEMENT_FAILED');
  }
  const segments = relativeLeaf.split(path.sep);
  let current = resolvedRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index] ?? '');
    const leafSegment = index === segments.length - 1;
    if (leafSegment) {
      try {
        fs.mkdirSync(current, { recursive: false, mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error('PRIVATE_CORPUS_REVISION_LEAF_ALREADY_EXISTS');
        }
        throw error;
      }
    } else if (!fs.existsSync(current)) {
      fs.mkdirSync(current, { recursive: false, mode: 0o700 });
    }
    const stat = fs.lstatSync(current);
    const realpath = fs.realpathSync(current);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !realpath.startsWith(`${approvedRootRealpath}${path.sep}`)
    ) {
      throw new Error('PRIVATE_CORPUS_REVISION_CONFINEMENT_FAILED');
    }
  }
  return fs.realpathSync(resolvedLeaf);
}

function countRows(sqlite: AlembicDatabaseRuntime['sqlite'], table: string): number {
  const exists = sqlite
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table);
  if (!exists) {
    return 0;
  }
  const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function countRegularFiles(root: string): number {
  if (!fs.existsSync(root)) {
    return 0;
  }
  let count = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) {
      count += countRegularFiles(child);
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

function deterministicUuid(hash: string): string {
  const hex = createHash('sha256').update(hash).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function criticalityRank(value: CandidateAttemptInputV1['criticality']): number {
  return value === 'critical' ? 0 : value === 'standard' ? 1 : 2;
}

function hashPath(value: string): string {
  return hashBytes(Buffer.from(path.resolve(value)));
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  code: string
): void {
  const actual = Object.keys(value);
  if (actual.length !== allowedKeys.size || actual.some((key) => !allowedKeys.has(key))) {
    throw new Error(code);
  }
}

function normalizeStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function byId<K extends string>(key: K) {
  return <T extends Record<K, string>>(left: T, right: T): number =>
    left[key].localeCompare(right[key]);
}

function requireText(value: string, code: string): void {
  if (!value?.trim()) {
    throw new Error(code);
  }
}

function requireSha256(value: string, code: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error(code);
  }
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezeDeep(child);
    }
  }
  return value;
}

const CANDIDATE_COVERAGE_DISPOSITIONS = new Set<CandidateCoverageDisposition>([
  'covered-by-content-ready-candidate',
  'investigated-empty',
  'failed',
  'unknown',
]);
const FINAL_COVERAGE_DISPOSITIONS = new Set<FinalCoverageDisposition>([
  'covered-by-ready-recipe',
  'investigated-empty',
  'failed',
  'unknown',
]);
const SERVING_SNAPSHOT_INPUT_KEYS = new Set<string>([
  'sessionId',
  'snapshotId',
  'candidateDataManifestHash',
  'finalCoverageBindingHash',
  'candidateOracleHash',
  'vectorGenerationId',
  'vectorManifestHash',
  'certifiedProjectFactsHash',
  'sourceRevisionVectorHash',
  'analysisFixpointHash',
]);
const PUBLIC_ROUTE_KEYS = new Set<string>([
  'schemaVersion',
  'sessionId',
  'snapshotId',
  'servingSnapshotManifestHash',
  'vectorGenerationId',
  'vectorManifestHash',
  'certifiedProjectFactsHash',
  'sourceRevisionVectorHash',
  'planCognitionLineageHash',
  'compiledPlanHash',
  'factQueryCatalogHash',
  'requiredApplicabilityUniverseHash',
  'baselineScheduleHash',
  'expansionLedgerHeadHash',
  'finalExpandedScheduleHash',
  'analysisFixpointHash',
  'hypothesisExpressionSetManifestHash',
  'finalCodeFactGenerationManifestHash',
  'committedAt',
]);
