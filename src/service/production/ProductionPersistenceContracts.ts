import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  isAlembicDatabaseRootRevoked,
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
  toProjectFactsJson,
} from '../project-context/foundation/canonical.js';
import {
  createPrivateCorpusRevisionResolverInternal,
  resolveExistingPrivateCorpusRevisionInternal,
} from './PrivateCorpusRevisionResolver.js';

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
  readonly runtimeReceiptHash: string;
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

  assertRuntime(runtime: AlembicDatabaseRuntime): void {
    assertPrivateCorpusRevisionHandleV1(this);
    if (!this.#runtimes.has(runtime)) {
      throw new Error('PRIVATE_CORPUS_REVISION_RUNTIME_MISMATCH');
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
  readonly runtimeReceiptHash: string;
  readonly credentialLocationSymbol: string;
  readonly acceptedMigrationBundleSemanticHash: string;
  readonly expectedMigrationVersions?: readonly string[];
}

export interface PrivateCorpusRevisionExpectedContextV1 {
  readonly runId: string;
  readonly revisionId: string;
  readonly analysisFixpointHash: string;
  readonly configReceiptHash: string;
  readonly runtimeReceiptHash: string;
}

export interface PrivateCorpusRevisionCheckpointReceiptV1
  extends PrivateCorpusRevisionExpectedContextV1 {
  readonly schemaVersion: 1;
  readonly initReceiptHash: string;
  readonly databaseHash: string;
  readonly sqliteIntegrity: 'ok';
  readonly foreignKeyViolationCount: 0;
  readonly checkpointHash: string;
}

export interface InitializedPrivateCorpusRevisionV1 {
  readonly handle: PrivateCorpusRevisionHandleV1;
  readonly runtime: AlembicDatabaseRuntime;
}

export interface RehydratedPrivateCorpusRevisionV1 {
  readonly handle: PrivateCorpusRevisionHandleV1;
  readonly runtime: AlembicDatabaseRuntime;
}

export async function initializePrivateCorpusRevisionV1(
  baseResolver: WorkspaceResolver,
  input: InitializePrivateCorpusRevisionInputV1
): Promise<InitializedPrivateCorpusRevisionV1> {
  validatePrivateCorpusRevisionInitializationInput(baseResolver, input);
  const prepared = preparePrivateCorpusRevisionRoot(baseResolver, input);
  let runtime: AlembicDatabaseRuntime | null = null;
  try {
    runtime = await openAlembicDatabase(
      { path: prepared.resolver.databasePath },
      { workspaceResolver: prepared.resolver, runMigrations: true }
    );
    const initReceipt = createPrivateCorpusRevisionInitReceipt(
      baseResolver,
      input,
      prepared,
      runtime
    );
    return {
      handle: new PrivateCorpusRevisionHandleV1(
        prepared.resolver,
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

function validatePrivateCorpusRevisionInitializationInput(
  baseResolver: WorkspaceResolver,
  input: InitializePrivateCorpusRevisionInputV1
): void {
  if (!baseResolver.projectId || !baseResolver.projectScope?.projectScopeId) {
    throw new Error('PRIVATE_CORPUS_REVISION_PROJECT_SCOPE_IDENTITY_REQUIRED');
  }
  requireSha256(input.configReceiptHash, 'PRIVATE_CORPUS_REVISION_CONFIG_HASH_INVALID');
  requireSha256(input.runtimeReceiptHash, 'PRIVATE_CORPUS_REVISION_RUNTIME_HASH_INVALID');
  requireSha256(input.analysisFixpointHash, 'PRIVATE_CORPUS_REVISION_FIXPOINT_HASH_INVALID');
  requireSha256(
    input.acceptedMigrationBundleSemanticHash,
    'PRIVATE_CORPUS_REVISION_MIGRATION_BUNDLE_HASH_INVALID'
  );
  if (!/^(env|keychain|config-ref):[A-Za-z0-9_.-]+$/.test(input.credentialLocationSymbol)) {
    throw new Error('PRIVATE_CORPUS_REVISION_CREDENTIAL_LOCATION_INVALID');
  }
}

function preparePrivateCorpusRevisionRoot(
  baseResolver: WorkspaceResolver,
  input: InitializePrivateCorpusRevisionInputV1
) {
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
  return {
    resolver,
    migrationArtifacts,
    migrationLedgerSemanticHash,
    leafRealpath,
    parentRealpath,
  };
}

function createPrivateCorpusRevisionInitReceipt(
  baseResolver: WorkspaceResolver,
  input: InitializePrivateCorpusRevisionInputV1,
  prepared: ReturnType<typeof preparePrivateCorpusRevisionRoot>,
  runtime: AlembicDatabaseRuntime
): PrivateCorpusRevisionInitReceiptV1 {
  const projectId = baseResolver.projectId;
  const projectScopeId = baseResolver.projectScope?.projectScopeId;
  if (!projectId || !projectScopeId) {
    throw new Error('PRIVATE_CORPUS_REVISION_PROJECT_SCOPE_IDENTITY_REQUIRED');
  }
  const migrationVersions = readAndValidateRevisionMigrations(
    runtime.sqlite,
    prepared.migrationArtifacts,
    input.expectedMigrationVersions
  );
  assertBlankPrivateCorpusRevision(runtime.sqlite, prepared.resolver);
  const semantic = {
    schemaVersion: 1 as const,
    runId: input.runId,
    revisionId: input.revisionId,
    analysisFixpointHash: input.analysisFixpointHash,
    projectRootHash: hashPath(baseResolver.projectRoot),
    projectId,
    projectScopeId,
    dataRootHash: hashPath(prepared.resolver.dataRoot),
    parentRealpathHash: hashPath(prepared.parentRealpath),
    leafRealpathHash: hashPath(prepared.leafRealpath),
    noSymlink: true as const,
    migrationVersions,
    migrationArtifacts: prepared.migrationArtifacts,
    migrationLedgerSemanticHash: prepared.migrationLedgerSemanticHash,
    requiredMigration017Present: true as const,
    sqliteIntegrity: 'ok' as const,
    foreignKeyViolationCount: 0 as const,
    configReceiptHash: input.configReceiptHash,
    runtimeReceiptHash: input.runtimeReceiptHash,
    credentialLocationSymbol: input.credentialLocationSymbol,
    blankState: emptyPrivateCorpusRevisionState(),
  };
  return freezeDeep({
    ...semantic,
    initReceiptHash: hashCanonicalJson(semantic),
  } satisfies PrivateCorpusRevisionInitReceiptV1);
}

function readAndValidateRevisionMigrations(
  sqlite: AlembicDatabaseRuntime['sqlite'],
  migrationArtifacts: ReturnType<typeof readAlembicMigrationBundleManifest>,
  expectedMigrationVersions: readonly string[] | undefined
): string[] {
  const migrationVersions = (
    sqlite.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
      version: string;
    }>
  ).map((row) => row.version);
  if (!migrationVersions.includes('017_recipe_retrieval_profile')) {
    throw new Error('PRIVATE_CORPUS_REVISION_MIGRATION_017_MISSING');
  }
  const acceptedVersions = migrationArtifacts.map((row) => row.version);
  const expectedVersions = expectedMigrationVersions
    ? [...expectedMigrationVersions].sort()
    : migrationVersions;
  if (
    canonicalJsonStringify(migrationVersions) !== canonicalJsonStringify(acceptedVersions) ||
    canonicalJsonStringify(expectedVersions) !== canonicalJsonStringify(migrationVersions)
  ) {
    throw new Error('PRIVATE_CORPUS_REVISION_MIGRATION_SET_MISMATCH');
  }
  return migrationVersions;
}

function assertBlankPrivateCorpusRevision(
  sqlite: AlembicDatabaseRuntime['sqlite'],
  resolver: WorkspaceResolver
): void {
  if (sqlite.pragma('integrity_check', { simple: true }) !== 'ok') {
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
    vectorRoutePresent: fs.existsSync(path.join(resolver.contextDir, 'recipe-vector-active.json')),
    publicationRoutePresent: fs.existsSync(
      path.join(resolver.contextDir, 'recipe-publications', 'active.json')
    ),
    recipeFileCount: countRegularFiles(resolver.recipesDir),
    candidateFileCount: countRegularFiles(resolver.candidatesDir),
  };
  if (Object.values(blankState).some((value) => value !== 0 && value !== false)) {
    throw new Error('PRIVATE_CORPUS_REVISION_NOT_BLANK');
  }
}

function emptyPrivateCorpusRevisionState(): PrivateCorpusRevisionInitReceiptV1['blankState'] {
  return {
    knowledgeEntries: 0,
    sourceRefs: 0,
    coverageRows: 0,
    vectorRoutePresent: false,
    publicationRoutePresent: false,
    recipeFileCount: 0,
    candidateFileCount: 0,
  };
}

/**
 * Reopens one already initialized private revision without creating or migrating it.
 * The sealed init receipt is the only lineage input; all current filesystem,
 * migration-bundle, ledger, and SQLite facts must still match it exactly.
 */
export async function rehydratePrivateCorpusRevisionV1(
  baseResolver: WorkspaceResolver,
  sealedInitReceipt: PrivateCorpusRevisionInitReceiptV1,
  expectedCurrentContext: PrivateCorpusRevisionExpectedContextV1
): Promise<RehydratedPrivateCorpusRevisionV1> {
  try {
    return await rehydratePrivateCorpusRevisionInternal(
      baseResolver,
      sealedInitReceipt,
      expectedCurrentContext
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN_REHYDRATE_FAILURE';
    process.stderr.write(
      `[Alembic] Private revision rehydrate rejected (${code}); no revision root was created or migrated\n`
    );
    throw error;
  }
}

async function rehydratePrivateCorpusRevisionInternal(
  baseResolver: WorkspaceResolver,
  sealedInitReceipt: PrivateCorpusRevisionInitReceiptV1,
  expectedCurrentContext: PrivateCorpusRevisionExpectedContextV1
): Promise<RehydratedPrivateCorpusRevisionV1> {
  if (!baseResolver.projectId || !baseResolver.projectScope?.projectScopeId) {
    throw new Error('PRIVATE_CORPUS_REVISION_PROJECT_SCOPE_IDENTITY_REQUIRED');
  }
  const initReceipt = validatePrivateCorpusRevisionInitReceiptV1(
    sealedInitReceipt,
    expectedCurrentContext
  );
  if (
    initReceipt.projectRootHash !== hashPath(baseResolver.projectRoot) ||
    initReceipt.projectId !== baseResolver.projectId ||
    initReceipt.projectScopeId !== baseResolver.projectScope.projectScopeId
  ) {
    throw new Error('PRIVATE_CORPUS_REVISION_PROJECT_SCOPE_MISMATCH');
  }

  const resolver = resolveExistingPrivateCorpusRevisionInternal(baseResolver, {
    schemaVersion: 1,
    runId: initReceipt.runId,
    revisionId: initReceipt.revisionId,
  });
  const leafRealpath = assertExistingConfinedRevisionLeaf(baseResolver.dataRoot, resolver.dataRoot);
  const parentRealpath = fs.realpathSync(path.dirname(resolver.dataRoot));
  if (
    initReceipt.dataRootHash !== hashPath(resolver.dataRoot) ||
    initReceipt.parentRealpathHash !== hashPath(parentRealpath) ||
    initReceipt.leafRealpathHash !== hashPath(leafRealpath)
  ) {
    throw new Error('PRIVATE_CORPUS_REVISION_INIT_ROOT_MISMATCH');
  }
  assertExistingConfinedDatabase(resolver.dataRoot, resolver.databasePath, leafRealpath);

  const migrationArtifacts = readAlembicMigrationBundleManifest();
  const migrationLedgerSemanticHash = hashCanonicalJson(migrationArtifacts);
  if (
    migrationLedgerSemanticHash !== initReceipt.migrationLedgerSemanticHash ||
    canonicalJsonStringify(migrationArtifacts) !==
      canonicalJsonStringify(initReceipt.migrationArtifacts)
  ) {
    throw new Error('PRIVATE_CORPUS_REVISION_MIGRATION_BUNDLE_MISMATCH');
  }

  let runtime: AlembicDatabaseRuntime | null = null;
  try {
    runtime = await openAlembicDatabase(
      { path: resolver.databasePath },
      { workspaceResolver: resolver, runMigrations: false }
    );
    const sqlite = runtime.sqlite;
    const migrationLedgerExists = sqlite
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .get();
    if (!migrationLedgerExists) {
      throw new Error('PRIVATE_CORPUS_REVISION_MIGRATION_LEDGER_MISSING');
    }
    const migrationVersions = (
      sqlite.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
        version: string;
      }>
    ).map((row) => row.version);
    if (
      canonicalJsonStringify(migrationVersions) !==
        canonicalJsonStringify(initReceipt.migrationVersions) ||
      canonicalJsonStringify(migrationVersions) !==
        canonicalJsonStringify(migrationArtifacts.map((row) => row.version))
    ) {
      throw new Error('PRIVATE_CORPUS_REVISION_MIGRATION_SET_MISMATCH');
    }
    if (!migrationVersions.includes('017_recipe_retrieval_profile')) {
      throw new Error('PRIVATE_CORPUS_REVISION_MIGRATION_017_MISSING');
    }
    if (sqlite.pragma('integrity_check', { simple: true }) !== 'ok') {
      throw new Error('PRIVATE_CORPUS_REVISION_SQLITE_INTEGRITY_FAILED');
    }
    const foreignKeys = sqlite.pragma('foreign_key_check') as unknown[];
    if (foreignKeys.length !== initReceipt.foreignKeyViolationCount) {
      throw new Error('PRIVATE_CORPUS_REVISION_FOREIGN_KEY_FAILED');
    }

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
  if (
    !ACTIVE_REVISION_HANDLES.has(handle) ||
    isAlembicDatabaseRootRevoked(handle.resolver.dataRoot)
  ) {
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

export interface StrictAcceptedCorpusEntryV1 {
  readonly recipeId: string;
  readonly projection: RecipeCandidateFingerprintProjectionV1;
  /**
   * 现有 validation/dedup/consolidation 算法所需的真实字段投影。
   * 该投影与 accepted corpus 一起被 inspectionHash 封印，严格准入不得回读其他 repository。
   */
  readonly admissionSummary: StrictAcceptedRecipeAdmissionSummaryV1;
}

export interface StrictAcceptedRecipeAdmissionSummaryV1 {
  readonly title: string;
  readonly category: string | null;
  readonly trigger: string | null;
  readonly whenClause: string | null;
  readonly doClause: string | null;
  readonly dontClause: string | null;
  readonly coreCode: string | null;
  readonly guardPattern: string | null;
  readonly markdown: string | null;
}

export interface StrictAcceptedCorpusInspectionV1 {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly revisionRootManifestHash: string;
  readonly entries: readonly StrictAcceptedCorpusEntryV1[];
  readonly inspectedAcceptedCorpusCount: number;
  readonly complete: true;
  readonly truncated: false;
  readonly continuation: null;
  readonly acceptedCorpusHash: string;
  readonly inspectionHash: string;
}

export function createStrictAcceptedCorpusInspectionV1(input: {
  readonly runId: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly revisionRootManifestHash: string;
  readonly entries: readonly StrictAcceptedCorpusEntryV1[];
}): StrictAcceptedCorpusInspectionV1 {
  requireText(input.runId, 'STRICT_ADMISSION_CORPUS_COORDINATES_INVALID');
  requireText(input.analysisFixpointHash, 'STRICT_ADMISSION_CORPUS_COORDINATES_INVALID');
  requireText(input.privateCorpusRevision, 'STRICT_ADMISSION_CORPUS_COORDINATES_INVALID');
  requireSha256(input.revisionRootManifestHash, 'STRICT_ADMISSION_CORPUS_COORDINATES_INVALID');
  const entries = input.entries
    .map((entry) => {
      const projection = canonicalRecipeCandidateProjection(entry.projection);
      const admissionSummary = normalizeStrictAcceptedRecipeAdmissionSummary(
        entry.admissionSummary
      );
      if (
        admissionSummary.title !== projection.title ||
        admissionSummary.category !== (projection.category || null) ||
        admissionSummary.trigger !== (projection.trigger || null) ||
        admissionSummary.whenClause !== (projection.whenClause || null) ||
        admissionSummary.doClause !== (projection.doText || null) ||
        admissionSummary.dontClause !== (projection.dontText || null) ||
        admissionSummary.coreCode !== (projection.coreCode || null) ||
        admissionSummary.guardPattern !== (projection.pattern || null) ||
        admissionSummary.markdown !== (projection.markdown || null)
      ) {
        throw new Error('STRICT_ADMISSION_CORPUS_ENTRY_PROJECTION_MISMATCH');
      }
      return {
        recipeId: entry.recipeId.trim(),
        projection,
        admissionSummary,
      };
    })
    .sort((left, right) => left.recipeId.localeCompare(right.recipeId));
  if (
    entries.some((entry) => !entry.recipeId) ||
    new Set(entries.map((entry) => entry.recipeId)).size !== entries.length
  ) {
    throw new Error('STRICT_ADMISSION_CORPUS_ENTRY_INVALID');
  }
  const acceptedCorpusHash = hashCanonicalJson(entries);
  const semantic = {
    schemaVersion: 1 as const,
    runId: input.runId,
    analysisFixpointHash: input.analysisFixpointHash,
    privateCorpusRevision: input.privateCorpusRevision,
    revisionRootManifestHash: input.revisionRootManifestHash,
    entries,
    inspectedAcceptedCorpusCount: entries.length,
    complete: true as const,
    truncated: false as const,
    continuation: null,
    acceptedCorpusHash,
  };
  return freezeDeep({ ...semantic, inspectionHash: hashCanonicalJson(semantic) });
}

export interface StrictAdmissionExactMatchV1 {
  readonly recipeId: string;
  readonly fingerprint: string;
}

export interface StrictAdmissionSemanticMatchV1 extends StrictAdmissionExactMatchV1 {
  readonly similarity: number;
}

export interface StrictAdmissionConsolidationV1 {
  readonly action: 'create' | 'merge' | 'reorganize' | 'insufficient' | 'reject';
  readonly reasonCode: string;
  readonly targetRecipeId: string | null;
  readonly targetFingerprint: string | null;
}

export interface StrictAdmissionReceiptV1 {
  readonly schemaVersion: 1;
  readonly admissionId: string;
  readonly runId: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly revisionRootManifestHash: string;
  readonly g1ReceiptHash: string;
  readonly inputFingerprint: string;
  readonly finalAdmittedFingerprint: string;
  readonly acceptedCorpusInspectionHash: string;
  readonly acceptedCorpusHash: string;
  readonly inspectedAcceptedCorpusCount: number;
  readonly complete: true;
  readonly truncated: false;
  readonly continuation: null;
  readonly exactMatches: readonly StrictAdmissionExactMatchV1[];
  readonly semanticMatches: readonly StrictAdmissionSemanticMatchV1[];
  readonly consolidation: StrictAdmissionConsolidationV1;
  readonly algorithmVersion: string;
  readonly disposition: 'admit' | 'merge' | 'duplicate' | 'reject';
  readonly receiptHash: string;
}

export function createStrictAdmissionReceiptV1(input: {
  readonly g1Receipt: StrictG1ReceiptV1;
  readonly corpusInspection: StrictAcceptedCorpusInspectionV1;
  readonly inputFingerprint: string;
  readonly finalAdmittedFingerprint: string;
  readonly exactMatches: readonly StrictAdmissionExactMatchV1[];
  readonly semanticMatches: readonly StrictAdmissionSemanticMatchV1[];
  readonly consolidation: StrictAdmissionConsolidationV1;
  readonly algorithmVersion: string;
}): StrictAdmissionReceiptV1 {
  assertStrictG1ReceiptV1(input.g1Receipt);
  assertStrictAcceptedCorpusInspectionV1(input.corpusInspection);
  if (
    input.g1Receipt.verdict !== 'pass' ||
    input.g1Receipt.candidateFingerprint !== input.inputFingerprint
  ) {
    throw new Error('STRICT_ADMISSION_G1_MISMATCH');
  }
  requireText(input.finalAdmittedFingerprint, 'STRICT_ADMISSION_FINGERPRINT_INVALID');
  requireText(input.algorithmVersion, 'STRICT_ADMISSION_ALGORITHM_INVALID');
  const corpusById = new Map(
    input.corpusInspection.entries.map((entry) => [entry.recipeId, entry])
  );
  const exactMatches = normalizeAdmissionMatches(input.exactMatches, corpusById);
  const semanticMatches = normalizeAdmissionSemanticMatches(input.semanticMatches, corpusById);
  const consolidation = normalizeAdmissionConsolidation(input.consolidation, corpusById);
  const disposition = deriveAdmissionDisposition(consolidation);
  if (
    disposition === 'admit' &&
    (exactMatches.length > 0 ||
      semanticMatches.length > 0 ||
      input.finalAdmittedFingerprint !== input.inputFingerprint)
  ) {
    throw new Error('STRICT_ADMISSION_CONSOLIDATION_MISMATCH');
  }
  const semantic = {
    schemaVersion: 1 as const,
    runId: input.corpusInspection.runId,
    analysisFixpointHash: input.corpusInspection.analysisFixpointHash,
    privateCorpusRevision: input.corpusInspection.privateCorpusRevision,
    revisionRootManifestHash: input.corpusInspection.revisionRootManifestHash,
    g1ReceiptHash: input.g1Receipt.receiptHash,
    inputFingerprint: input.inputFingerprint,
    finalAdmittedFingerprint: input.finalAdmittedFingerprint,
    acceptedCorpusInspectionHash: input.corpusInspection.inspectionHash,
    acceptedCorpusHash: input.corpusInspection.acceptedCorpusHash,
    inspectedAcceptedCorpusCount: input.corpusInspection.inspectedAcceptedCorpusCount,
    complete: true as const,
    truncated: false as const,
    continuation: null,
    exactMatches,
    semanticMatches,
    consolidation,
    algorithmVersion: input.algorithmVersion,
    disposition,
  };
  const semanticHash = hashCanonicalJson(semantic);
  const withId = {
    ...semantic,
    admissionId: `admission:${semanticHash.slice('sha256:'.length)}`,
  };
  return freezeDeep({ ...withId, receiptHash: hashCanonicalJson(withId) });
}

export const STRICT_G2_HARD_AXES_V1 = [
  'entailment',
  'contradiction-free',
  'project-specificity-nontriviality',
  'actionability',
  'scope-generalization-correctness',
  'retrieval-negative-intent-fitness',
] as const;

export type StrictG2HardAxisV1 = (typeof STRICT_G2_HARD_AXES_V1)[number];

export interface StrictG2AxisResultV1 {
  readonly axis: StrictG2HardAxisV1;
  readonly axisVerdict: 'pass' | 'revise' | 'fail' | 'unknown';
  readonly score: 2 | 1 | 0 | null;
  readonly reasonCode: string;
  readonly evidenceRefs: readonly string[];
  readonly repairable: boolean;
}

export interface StrictG2ActorV1 {
  readonly identity: string;
  readonly method: string;
  readonly modelHash: string;
  readonly promptHash: string;
}

export interface StrictG2NoveltyDecisionV1 {
  readonly decision:
    | 'novel-project-specific'
    | 'useful-extension'
    | 'generic'
    | 'already-covered'
    | 'unknown';
  readonly reasonCode: string;
  readonly evidenceRefs: readonly string[];
}

export interface StrictG2DuplicateDecisionV1 {
  readonly decision: 'no-match' | 'exact-match' | 'semantic-match' | 'consolidated' | 'unknown';
  readonly reasonCode: string;
  readonly evidenceRefs: readonly string[];
  readonly admissionAlgorithmVersion: string;
  readonly comparedPrivateCorpusRevision: string;
  readonly matchedRecipeIds: readonly string[];
  readonly matchedFingerprints: readonly string[];
  readonly targetRecipeId: string | null;
  readonly consolidationFingerprint: string | null;
}

export interface StrictG2ReceiptV1 {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly revisionRootManifestHash: string;
  readonly candidateFingerprint: string;
  readonly reviewedFingerprint: string;
  readonly g1ReceiptHash: string;
  readonly admissionReceiptHash: string;
  readonly producer: StrictG2ActorV1;
  readonly reviewer: StrictG2ActorV1;
  readonly rows: readonly StrictG2AxisResultV1[];
  readonly novelty: StrictG2NoveltyDecisionV1;
  readonly duplicate: StrictG2DuplicateDecisionV1;
  readonly repairAttempt: number;
  readonly calibrationReceiptHash: string;
  readonly ruleVersion: string;
  readonly permittedRepairFields: readonly string[];
  readonly verdict: 'pass' | 'revise' | 'reject';
  readonly receiptHash: string;
}

export function createStrictG2ReceiptV1(input: {
  readonly g1Receipt: StrictG1ReceiptV1;
  readonly admissionReceipt: StrictAdmissionReceiptV1;
  readonly reviewedFingerprint: string;
  readonly producer: StrictG2ActorV1;
  readonly reviewer: StrictG2ActorV1;
  readonly rows: readonly StrictG2AxisResultV1[];
  readonly novelty: StrictG2NoveltyDecisionV1;
  readonly duplicate: StrictG2DuplicateDecisionV1;
  readonly repairAttempt: number;
  readonly calibrationReceiptHash: string;
  readonly ruleVersion: string;
  readonly permittedRepairFields: readonly string[];
}): StrictG2ReceiptV1 {
  assertStrictG1ReceiptV1(input.g1Receipt);
  assertStrictAdmissionReceiptV1(input.admissionReceipt);
  if (
    input.g1Receipt.verdict !== 'pass' ||
    input.admissionReceipt.disposition !== 'admit' ||
    input.admissionReceipt.g1ReceiptHash !== input.g1Receipt.receiptHash ||
    input.admissionReceipt.inputFingerprint !== input.reviewedFingerprint ||
    input.admissionReceipt.finalAdmittedFingerprint !== input.reviewedFingerprint
  ) {
    throw new Error('STRICT_G2_AUTHORITY_MISMATCH');
  }
  const producer = normalizeStrictG2Actor(input.producer);
  const reviewer = normalizeStrictG2Actor(input.reviewer);
  if (producer.identity === reviewer.identity) {
    throw new Error('STRICT_G2_REVIEWER_NOT_INDEPENDENT');
  }
  const rows = normalizeStrictG2Rows(input.rows);
  const novelty = normalizeStrictG2Novelty(input.novelty);
  const duplicate = normalizeStrictG2Duplicate(input.duplicate);
  if (
    duplicate.decision !== 'no-match' ||
    duplicate.admissionAlgorithmVersion !== input.admissionReceipt.algorithmVersion ||
    duplicate.comparedPrivateCorpusRevision !== input.admissionReceipt.privateCorpusRevision ||
    duplicate.matchedRecipeIds.length !== 0 ||
    duplicate.matchedFingerprints.length !== 0 ||
    duplicate.targetRecipeId !== null ||
    duplicate.consolidationFingerprint !== null
  ) {
    throw new Error('STRICT_G2_ADMISSION_DUPLICATE_MISMATCH');
  }
  if (!Number.isSafeInteger(input.repairAttempt) || input.repairAttempt < 0) {
    throw new Error('STRICT_G2_REPAIR_ATTEMPT_INVALID');
  }
  requireText(input.calibrationReceiptHash, 'STRICT_G2_CALIBRATION_REQUIRED');
  requireText(input.ruleVersion, 'STRICT_G2_RULE_VERSION_REQUIRED');
  const permittedRepairFields = normalizeStrings(input.permittedRepairFields);
  const verdict = deriveStrictG2Verdict(rows, novelty, duplicate);
  if (verdict !== 'revise' && permittedRepairFields.length > 0) {
    throw new Error('STRICT_G2_REPAIR_FIELDS_INVALID');
  }
  const semantic = {
    schemaVersion: 1 as const,
    runId: input.admissionReceipt.runId,
    analysisFixpointHash: input.admissionReceipt.analysisFixpointHash,
    privateCorpusRevision: input.admissionReceipt.privateCorpusRevision,
    revisionRootManifestHash: input.admissionReceipt.revisionRootManifestHash,
    candidateFingerprint: input.admissionReceipt.finalAdmittedFingerprint,
    reviewedFingerprint: input.reviewedFingerprint,
    g1ReceiptHash: input.g1Receipt.receiptHash,
    admissionReceiptHash: input.admissionReceipt.receiptHash,
    producer,
    reviewer,
    rows,
    novelty,
    duplicate,
    repairAttempt: input.repairAttempt,
    calibrationReceiptHash: input.calibrationReceiptHash,
    ruleVersion: input.ruleVersion,
    permittedRepairFields,
    verdict,
  };
  return freezeDeep({ ...semantic, receiptHash: hashCanonicalJson(semantic) });
}

export interface PreparedRecipePersistenceV1 {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly analysisFixpointHash: string;
  readonly privateCorpusRevision: string;
  readonly admissionId: string;
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
  readonly admissionId: string;
  readonly cellId: string;
  readonly authoredFingerprint: string;
  readonly causalParentIds: readonly string[];
  readonly expectedDbHash: string;
  readonly expectedFileHash: string;
  readonly journalStepHash: string;
}): PreparedRecipePersistenceV1 {
  for (const value of [
    input.runId,
    input.analysisFixpointHash,
    input.privateCorpusRevision,
    input.admissionId,
    input.cellId,
    input.authoredFingerprint,
    input.expectedDbHash,
    input.expectedFileHash,
    input.journalStepHash,
  ]) {
    requireText(value, 'STRICT_PREPARED_RECEIPT_INVALID');
  }
  const preparedIdentity = {
    runId: input.runId,
    analysisFixpointHash: input.analysisFixpointHash,
    privateCorpusRevision: input.privateCorpusRevision,
    admissionId: input.admissionId,
    authoredFingerprint: input.authoredFingerprint,
  };
  const preparedRecipeId = deterministicUuid(hashCanonicalJson(preparedIdentity));
  const semantic = {
    schemaVersion: 1 as const,
    ...preparedIdentity,
    cellId: input.cellId,
    causalParentIds: normalizeStrings(input.causalParentIds),
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
  readonly category: string;
  readonly trigger: string;
  readonly whenClause: string;
  readonly doText: string;
  readonly dontText: string;
  readonly coreCode: string;
  readonly pattern: string;
  readonly markdown: string;
  readonly usageGuide: string;
  readonly retrievalProfile: unknown;
  readonly negativeIntents: readonly string[];
  readonly scopeId: string;
  readonly moduleId: string;
  readonly dimensionId: string;
  readonly evidenceRefs: readonly string[];
  readonly lineageHashes: readonly string[];
  /** strict Gateway 最终写入（不含 prepared id）的完整 caller-controlled canonical payload。 */
  readonly persistedPayload: ReturnType<typeof toProjectFactsJson>;
  readonly authoredFingerprint: string;
}

export function createRecipeCandidateFingerprintProjectionV1(
  input: Omit<RecipeCandidateFingerprintProjectionV1, 'schemaVersion' | 'authoredFingerprint'>
): RecipeCandidateFingerprintProjectionV1 {
  const semantic = {
    schemaVersion: 1 as const,
    title: input.title.trim(),
    kind: input.kind.trim(),
    category: input.category.trim(),
    trigger: input.trigger.trim(),
    whenClause: input.whenClause.trim(),
    doText: input.doText.trim(),
    dontText: input.dontText.trim(),
    coreCode: input.coreCode.trim(),
    pattern: input.pattern.trim(),
    markdown: input.markdown.trim(),
    usageGuide: input.usageGuide.trim(),
    retrievalProfile: input.retrievalProfile,
    negativeIntents: normalizeStrings(input.negativeIntents),
    scopeId: input.scopeId.trim(),
    moduleId: input.moduleId.trim(),
    dimensionId: input.dimensionId.trim(),
    evidenceRefs: normalizeStrings(input.evidenceRefs),
    lineageHashes: normalizeStrings(input.lineageHashes),
    persistedPayload: toProjectFactsJson(input.persistedPayload),
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
  assertRecipeProjectionPayloadAlignment(semantic);
  return freezeDeep({ ...semantic, authoredFingerprint: hashCanonicalJson(semantic) });
}

function assertRecipeProjectionPayloadAlignment(input: {
  readonly title: string;
  readonly kind: string;
  readonly category: string;
  readonly trigger: string;
  readonly whenClause: string;
  readonly doText: string;
  readonly dontText: string;
  readonly coreCode: string;
  readonly pattern: string;
  readonly markdown: string;
  readonly usageGuide: string;
  readonly retrievalProfile: unknown;
  readonly scopeId: string;
  readonly moduleId: string;
  readonly dimensionId: string;
  readonly evidenceRefs: readonly string[];
  readonly persistedPayload: ReturnType<typeof toProjectFactsJson>;
}): void {
  if (
    !input.persistedPayload ||
    typeof input.persistedPayload !== 'object' ||
    Array.isArray(input.persistedPayload)
  ) {
    throw new Error('RECIPE_CANDIDATE_PERSISTED_PAYLOAD_INVALID');
  }
  const payload = input.persistedPayload as Record<string, ReturnType<typeof toProjectFactsJson>>;
  const content =
    payload.content && typeof payload.content === 'object' && !Array.isArray(payload.content)
      ? (payload.content as Record<string, ReturnType<typeof toProjectFactsJson>>)
      : {};
  const scalarPairs: ReadonlyArray<readonly [unknown, string]> = [
    [payload.title, input.title],
    [payload.kind, input.kind],
    [payload.category, input.category],
    [payload.trigger, input.trigger],
    [payload.whenClause, input.whenClause],
    [payload.doClause, input.doText],
    [payload.dontClause, input.dontText],
    [payload.coreCode, input.coreCode],
    [content.pattern ?? '', input.pattern],
    [content.markdown ?? '', input.markdown],
    [payload.usageGuide, input.usageGuide],
    [payload.scope, input.scopeId],
    [payload.moduleName, input.moduleId],
    [payload.dimensionId, input.dimensionId],
  ];
  if (
    scalarPairs.some(([actual, expected]) => actual !== expected) ||
    canonicalJsonStringify(payload.retrievalProfile ?? null) !==
      canonicalJsonStringify(input.retrievalProfile ?? null) ||
    canonicalJsonStringify(payload.sourceRefs ?? []) !== canonicalJsonStringify(input.evidenceRefs)
  ) {
    throw new Error('RECIPE_CANDIDATE_PERSISTED_PAYLOAD_MISMATCH');
  }
}

export function assertStrictPersistenceAuthorityV1(input: {
  readonly prepared: PreparedRecipePersistenceV1;
  readonly g1Receipt: StrictG1ReceiptV1;
  readonly admissionReceipt: StrictAdmissionReceiptV1;
  readonly g2Receipt: StrictG2ReceiptV1;
  readonly reviewedFingerprint: string;
}): void {
  try {
    assertPreparedRecipePersistenceV1(input.prepared);
    assertStrictG1ReceiptV1(input.g1Receipt);
    assertStrictAdmissionReceiptV1(input.admissionReceipt);
    assertStrictG2ReceiptV1(input.g2Receipt);
    if (strictPersistenceAuthorityMismatches(input).some(Boolean)) {
      throw new Error('authority mismatch');
    }
  } catch (_error: unknown) {
    throw new Error('STRICT_PERSISTENCE_AUTHORITY_MISMATCH');
  }
}

function strictPersistenceAuthorityMismatches(input: {
  readonly prepared: PreparedRecipePersistenceV1;
  readonly g1Receipt: StrictG1ReceiptV1;
  readonly admissionReceipt: StrictAdmissionReceiptV1;
  readonly g2Receipt: StrictG2ReceiptV1;
  readonly reviewedFingerprint: string;
}): readonly boolean[] {
  return [
    input.g1Receipt.verdict !== 'pass',
    input.g2Receipt.verdict !== 'pass',
    input.admissionReceipt.disposition !== 'admit',
    input.prepared.authoredFingerprint !== input.reviewedFingerprint,
    input.g1Receipt.candidateFingerprint !== input.reviewedFingerprint,
    input.admissionReceipt.inputFingerprint !== input.reviewedFingerprint,
    input.admissionReceipt.finalAdmittedFingerprint !== input.reviewedFingerprint,
    input.g2Receipt.candidateFingerprint !== input.reviewedFingerprint,
    input.g2Receipt.reviewedFingerprint !== input.reviewedFingerprint,
    input.g2Receipt.duplicate.decision !== 'no-match',
    input.g2Receipt.duplicate.admissionAlgorithmVersion !== input.admissionReceipt.algorithmVersion,
    input.g2Receipt.duplicate.comparedPrivateCorpusRevision !==
      input.admissionReceipt.privateCorpusRevision,
    input.g2Receipt.duplicate.matchedRecipeIds.length !== 0,
    input.g2Receipt.duplicate.matchedFingerprints.length !== 0,
    input.g2Receipt.duplicate.targetRecipeId !== null,
    input.g2Receipt.duplicate.consolidationFingerprint !== null,
    input.admissionReceipt.g1ReceiptHash !== input.g1Receipt.receiptHash,
    input.g2Receipt.g1ReceiptHash !== input.g1Receipt.receiptHash,
    input.g2Receipt.admissionReceiptHash !== input.admissionReceipt.receiptHash,
    input.prepared.admissionId !== input.admissionReceipt.admissionId,
    input.admissionReceipt.runId !== input.prepared.runId,
    input.g2Receipt.runId !== input.prepared.runId,
    input.admissionReceipt.analysisFixpointHash !== input.prepared.analysisFixpointHash,
    input.g2Receipt.analysisFixpointHash !== input.prepared.analysisFixpointHash,
    input.admissionReceipt.privateCorpusRevision !== input.prepared.privateCorpusRevision,
    input.g2Receipt.privateCorpusRevision !== input.prepared.privateCorpusRevision,
    input.g2Receipt.revisionRootManifestHash !== input.admissionReceipt.revisionRootManifestHash,
  ];
}

export interface StrictPersistenceReceiptV1 {
  readonly schemaVersion: 1;
  readonly preparedHash: string;
  readonly admissionId: string;
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
  readonly g1Receipt: StrictG1ReceiptV1;
  readonly admissionReceipt: StrictAdmissionReceiptV1;
  readonly g2Receipt: StrictG2ReceiptV1;
  readonly actualRecipeId: string;
  readonly actualAuthoredFingerprint: string;
  readonly storageHash: string;
  readonly databaseRowHash: string;
  readonly fileHash: string;
  readonly actualLifecycle: StrictPersistenceReceiptV1['lifecycle'];
}): StrictPersistenceReceiptV1 {
  assertStrictPersistenceAuthorityV1({
    prepared: input.prepared,
    g1Receipt: input.g1Receipt,
    admissionReceipt: input.admissionReceipt,
    g2Receipt: input.g2Receipt,
    reviewedFingerprint: input.actualAuthoredFingerprint,
  });
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
    admissionId: input.admissionReceipt.admissionId,
    g1ReceiptHash: input.g1Receipt.receiptHash,
    admissionReceiptHash: input.admissionReceipt.receiptHash,
    g2ReceiptHash: input.g2Receipt.receiptHash,
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
  validateCandidateCoverageInputShape(input);
  const requiredCellIds = normalizeStrings(input.requiredCellIds);
  const cells = normalizeCandidateCoverageCells(input.cells);
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
    validateCandidateCoverageCell(cell);
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

function validateCandidateCoverageInputShape(input: {
  readonly requiredCellIds: readonly string[];
  readonly cells: readonly CandidateCoverageCellV1[];
}): void {
  const invalidCell = input.cells?.some(
    (cell) =>
      !Array.isArray(cell.contentReadyRecipeIds) ||
      !Array.isArray(cell.contentReadyRecipeFingerprints) ||
      !Array.isArray(cell.productionBindingHashes) ||
      !Array.isArray(cell.lensBindingIds) ||
      !Array.isArray(cell.expressionSetReceiptIds)
  );
  if (!Array.isArray(input.requiredCellIds) || !Array.isArray(input.cells) || invalidCell) {
    throw new Error('CANDIDATE_COVERAGE_REQUIRED_UNIVERSE_MISMATCH');
  }
}

function normalizeCandidateCoverageCells(
  cells: readonly CandidateCoverageCellV1[]
): CandidateCoverageCellV1[] {
  return cells
    .map((cell) => ({
      ...cell,
      contentReadyRecipeIds: normalizeStrings(cell.contentReadyRecipeIds),
      contentReadyRecipeFingerprints: normalizeStrings(cell.contentReadyRecipeFingerprints),
      productionBindingHashes: normalizeStrings(cell.productionBindingHashes),
      lensBindingIds: normalizeStrings(cell.lensBindingIds),
      expressionSetReceiptIds: normalizeStrings(cell.expressionSetReceiptIds),
    }))
    .sort(byId('cellId'));
}

function validateCandidateCoverageCell(cell: CandidateCoverageCellV1): void {
  if (!CANDIDATE_COVERAGE_DISPOSITIONS.has(cell.candidateDisposition)) {
    throw new Error('CANDIDATE_COVERAGE_DISPOSITION_INVALID');
  }
  if (cell.candidateDisposition === 'failed' || cell.candidateDisposition === 'unknown') {
    throw new Error('CANDIDATE_COVERAGE_NONTERMINAL');
  }
  if (cell.candidateDisposition === 'covered-by-content-ready-candidate') {
    if (
      cell.contentReadyRecipeIds.length === 0 ||
      cell.contentReadyRecipeIds.length !== cell.contentReadyRecipeFingerprints.length ||
      cell.contentReadyRecipeIds.length !== cell.productionBindingHashes.length ||
      cell.lensBindingIds.length === 0 ||
      cell.expressionSetReceiptIds.length === 0
    ) {
      throw new Error('CANDIDATE_COVERAGE_CONTENT_READY_LINEAGE_MISSING');
    }
    return;
  }
  if (!cell.investigatedEmptyDecisionHash) {
    throw new Error('CANDIDATE_COVERAGE_EMPTY_DECISION_MISSING');
  }
  if (
    cell.contentReadyRecipeIds.length > 0 ||
    cell.contentReadyRecipeFingerprints.length > 0 ||
    cell.productionBindingHashes.length > 0 ||
    cell.expressionSetReceiptIds.length > 0
  ) {
    throw new Error('CANDIDATE_COVERAGE_EMPTY_BINDING_CONFLICT');
  }
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
  assertCandidateCoverageReceiptHash(input.candidateCoverage);
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
    const candidateCell = input.candidateCoverage.cells.find(
      (candidate) => candidate.cellId === cell.cellId
    );
    validateFinalCoverageCell(cell, candidateCell);
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

function assertCandidateCoverageReceiptHash(receipt: CandidateCoverageReceiptV1): void {
  const { receiptHash, ...semantic } = receipt;
  if (receiptHash !== hashCanonicalJson(semantic)) {
    throw new Error('FINAL_COVERAGE_CANDIDATE_RECEIPT_HASH_MISMATCH');
  }
}

function validateFinalCoverageCell(
  cell: FinalCoverageBindingReceiptV1['cells'][number],
  candidateCell: CandidateCoverageCellV1 | undefined
): void {
  if (!FINAL_COVERAGE_DISPOSITIONS.has(cell.finalDisposition)) {
    throw new Error('FINAL_COVERAGE_DISPOSITION_INVALID');
  }
  if (!candidateCell) {
    throw new Error('FINAL_COVERAGE_CANDIDATE_UNIVERSE_MISMATCH');
  }
  if (cell.finalDisposition === 'failed' || cell.finalDisposition === 'unknown') {
    throw new Error('FINAL_COVERAGE_NONTERMINAL');
  }
  if (cell.finalDisposition === 'covered-by-ready-recipe') {
    validateFinalReadyCoverageCell(cell, candidateCell);
    return;
  }
  if (candidateCell.candidateDisposition !== 'investigated-empty') {
    throw new Error('FINAL_COVERAGE_CANDIDATE_LINEAGE_MISMATCH');
  }
  if (cell.finalRecipeIds.length > 0 || cell.finalRecipeFingerprints.length > 0) {
    throw new Error('FINAL_COVERAGE_EMPTY_BINDING_CONFLICT');
  }
}

function validateFinalReadyCoverageCell(
  cell: FinalCoverageBindingReceiptV1['cells'][number],
  candidateCell: CandidateCoverageCellV1
): void {
  if (
    cell.finalRecipeIds.length === 0 ||
    cell.finalRecipeIds.length !== cell.finalRecipeFingerprints.length
  ) {
    throw new Error('FINAL_COVERAGE_READY_BINDING_MISMATCH');
  }
  if (
    candidateCell.candidateDisposition !== 'covered-by-content-ready-candidate' ||
    canonicalJsonStringify(cell.finalRecipeIds) !==
      canonicalJsonStringify(candidateCell.contentReadyRecipeIds) ||
    canonicalJsonStringify(cell.finalRecipeFingerprints) !==
      canonicalJsonStringify(candidateCell.contentReadyRecipeFingerprints)
  ) {
    throw new Error('FINAL_COVERAGE_CANDIDATE_LINEAGE_MISMATCH');
  }
}

export interface StrictPublicationMarkerV1 {
  readonly schemaVersion: 1;
  readonly mode: 'strict-v1';
  readonly routeSchemaVersion: 1;
  readonly projectIdentityHash: string;
  readonly migrationBundleHash: string;
  readonly markerHash: string;
}

export function createStrictPublicationMarkerV1(
  input: Omit<StrictPublicationMarkerV1, 'schemaVersion' | 'markerHash'>
): StrictPublicationMarkerV1 {
  assertExactKeys(
    input as unknown as Record<string, unknown>,
    STRICT_PUBLICATION_MARKER_INPUT_KEYS,
    'STRICT_PUBLICATION_MARKER_FIELDS_INVALID'
  );
  if (input.mode !== 'strict-v1' || input.routeSchemaVersion !== 1) {
    throw new Error('STRICT_PUBLICATION_MARKER_FIELDS_INVALID');
  }
  requireSha256(input.projectIdentityHash, 'STRICT_PUBLICATION_MARKER_FIELDS_INVALID');
  requireSha256(input.migrationBundleHash, 'STRICT_PUBLICATION_MARKER_FIELDS_INVALID');
  // Core 只冻结消费者中立语义；marker 路径、写入和解析属于外层运行时。
  const semantic = {
    schemaVersion: 1 as const,
    mode: 'strict-v1' as const,
    routeSchemaVersion: 1 as const,
    projectIdentityHash: input.projectIdentityHash,
    migrationBundleHash: input.migrationBundleHash,
  };
  return freezeDeep({ ...semantic, markerHash: hashCanonicalJson(semantic) });
}

export interface StrictPublicationSnapshotIdV1 {
  readonly schemaVersion: 1;
  readonly snapshotId: string;
  readonly baseSnapshotId: string;
  readonly candidateDataManifestHash: string;
  readonly collisionUuid: string | null;
}

const STRICT_PUBLICATION_SNAPSHOT_ID_RE =
  /^snapshot-([a-f0-9]{64})(?:-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}))?$/;

export function createStrictPublicationSnapshotIdV1(
  candidateDataManifestHash: string,
  collisionUuid?: string
): string {
  requireSha256(candidateDataManifestHash, 'STRICT_PUBLICATION_SNAPSHOT_ID_INVALID');
  const snapshotId = `snapshot-${candidateDataManifestHash.slice('sha256:'.length)}${
    collisionUuid ? `-${collisionUuid}` : ''
  }`;
  parseStrictPublicationSnapshotIdV1(snapshotId);
  return snapshotId;
}

export function parseStrictPublicationSnapshotIdV1(
  snapshotId: string
): StrictPublicationSnapshotIdV1 {
  const match = STRICT_PUBLICATION_SNAPSHOT_ID_RE.exec(snapshotId);
  if (!match) {
    throw new Error('STRICT_PUBLICATION_SNAPSHOT_ID_INVALID');
  }
  const baseSnapshotId = `snapshot-${match[1]}`;
  return freezeDeep({
    schemaVersion: 1,
    snapshotId,
    baseSnapshotId,
    candidateDataManifestHash: `sha256:${match[1]}`,
    collisionUuid: match[2] ?? null,
  });
}

export interface ServingSnapshotManifestV1 {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly snapshotId: string;
  readonly candidateDataManifestHash: string;
  readonly finalCoverageBindingHash: string;
  // 只绑定消费者中立的 sealed-bundle validation，不承载 Plugin/MCP oracle 语义。
  readonly servingSnapshotValidationHash: string;
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
  requireSha256(input.servingSnapshotValidationHash, 'SERVING_SNAPSHOT_FIELDS_INVALID');
  let parsedSnapshot: StrictPublicationSnapshotIdV1;
  try {
    parsedSnapshot = parseStrictPublicationSnapshotIdV1(input.snapshotId);
  } catch (_error: unknown) {
    throw new Error('SERVING_SNAPSHOT_FIELDS_INVALID');
  }
  if (parsedSnapshot.candidateDataManifestHash !== input.candidateDataManifestHash) {
    throw new Error('SERVING_SNAPSHOT_FIELDS_INVALID');
  }
  const semantic = {
    schemaVersion: 1 as const,
    sessionId: input.sessionId,
    snapshotId: input.snapshotId,
    candidateDataManifestHash: input.candidateDataManifestHash,
    finalCoverageBindingHash: input.finalCoverageBindingHash,
    servingSnapshotValidationHash: input.servingSnapshotValidationHash,
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
  try {
    parseStrictPublicationSnapshotIdV1(input.snapshotId);
  } catch (_error: unknown) {
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

function assertExistingConfinedRevisionLeaf(approvedRoot: string, leaf: string): string {
  const resolvedRoot = path.resolve(approvedRoot);
  const resolvedLeaf = path.resolve(leaf);
  const rootStat = fs.lstatSync(resolvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('PRIVATE_CORPUS_REVISION_CONFINEMENT_FAILED');
  }
  const approvedRootRealpath = fs.realpathSync(resolvedRoot);
  const relativeLeaf = path.relative(resolvedRoot, resolvedLeaf);
  if (!relativeLeaf || relativeLeaf.startsWith('..') || path.isAbsolute(relativeLeaf)) {
    throw new Error('PRIVATE_CORPUS_REVISION_CONFINEMENT_FAILED');
  }
  let current = resolvedRoot;
  for (const segment of relativeLeaf.split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      throw new Error('PRIVATE_CORPUS_REVISION_LEAF_MISSING');
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

function assertExistingConfinedDatabase(
  revisionRoot: string,
  databasePath: string,
  revisionRootRealpath: string
): void {
  const relativeDatabase = path.relative(path.resolve(revisionRoot), path.resolve(databasePath));
  if (!relativeDatabase || relativeDatabase.startsWith('..') || path.isAbsolute(relativeDatabase)) {
    throw new Error('PRIVATE_CORPUS_REVISION_DATABASE_CONFINEMENT_FAILED');
  }
  let current = path.resolve(revisionRoot);
  const segments = relativeDatabase.split(path.sep);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index] ?? '');
    if (!fs.existsSync(current)) {
      throw new Error('PRIVATE_CORPUS_REVISION_DATABASE_MISSING');
    }
    const stat = fs.lstatSync(current);
    const realpath = fs.realpathSync(current);
    const databaseFile = index === segments.length - 1;
    if (
      stat.isSymbolicLink() ||
      (databaseFile ? !stat.isFile() : !stat.isDirectory()) ||
      !realpath.startsWith(`${revisionRootRealpath}${path.sep}`)
    ) {
      throw new Error('PRIVATE_CORPUS_REVISION_DATABASE_CONFINEMENT_FAILED');
    }
  }
}

export function validatePrivateCorpusRevisionInitReceiptV1(
  receipt: PrivateCorpusRevisionInitReceiptV1,
  expectedCurrentContext: PrivateCorpusRevisionExpectedContextV1
): PrivateCorpusRevisionInitReceiptV1 {
  validatePrivateCorpusRevisionReceiptShape(receipt);
  validatePrivateCorpusRevisionReceiptScalars(receipt);
  const { migrationVersions, migrationArtifacts } =
    normalizePrivateCorpusRevisionMigrations(receipt);
  validatePrivateCorpusRevisionBlankState(receipt.blankState);
  const semantic = {
    schemaVersion: 1 as const,
    runId: receipt.runId,
    revisionId: receipt.revisionId,
    analysisFixpointHash: receipt.analysisFixpointHash,
    projectRootHash: receipt.projectRootHash,
    projectId: receipt.projectId,
    projectScopeId: receipt.projectScopeId,
    dataRootHash: receipt.dataRootHash,
    parentRealpathHash: receipt.parentRealpathHash,
    leafRealpathHash: receipt.leafRealpathHash,
    noSymlink: true as const,
    migrationVersions,
    migrationArtifacts,
    migrationLedgerSemanticHash: receipt.migrationLedgerSemanticHash,
    requiredMigration017Present: true as const,
    sqliteIntegrity: 'ok' as const,
    foreignKeyViolationCount: 0 as const,
    configReceiptHash: receipt.configReceiptHash,
    runtimeReceiptHash: receipt.runtimeReceiptHash,
    credentialLocationSymbol: receipt.credentialLocationSymbol,
    blankState: emptyPrivateCorpusRevisionState(),
  };
  if (hashCanonicalJson(semantic) !== receipt.initReceiptHash) {
    throw new Error('PRIVATE_CORPUS_REVISION_INIT_RECEIPT_HASH_MISMATCH');
  }
  assertPrivateCorpusRevisionExpectedContextV1(receipt, expectedCurrentContext);
  return freezeDeep({ ...semantic, initReceiptHash: receipt.initReceiptHash });
}

function validatePrivateCorpusRevisionReceiptShape(
  receipt: PrivateCorpusRevisionInitReceiptV1
): void {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('PRIVATE_CORPUS_REVISION_INIT_RECEIPT_INVALID');
  }
  assertExactKeys(
    receipt as unknown as Record<string, unknown>,
    new Set([
      'schemaVersion',
      'runId',
      'revisionId',
      'analysisFixpointHash',
      'projectRootHash',
      'projectId',
      'projectScopeId',
      'dataRootHash',
      'parentRealpathHash',
      'leafRealpathHash',
      'noSymlink',
      'migrationVersions',
      'migrationArtifacts',
      'migrationLedgerSemanticHash',
      'requiredMigration017Present',
      'sqliteIntegrity',
      'foreignKeyViolationCount',
      'configReceiptHash',
      'runtimeReceiptHash',
      'credentialLocationSymbol',
      'blankState',
      'initReceiptHash',
    ]),
    'PRIVATE_CORPUS_REVISION_INIT_RECEIPT_FIELDS_INVALID'
  );
}

function validatePrivateCorpusRevisionReceiptScalars(
  receipt: PrivateCorpusRevisionInitReceiptV1
): void {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.noSymlink !== true ||
    receipt.requiredMigration017Present !== true ||
    receipt.sqliteIntegrity !== 'ok' ||
    receipt.foreignKeyViolationCount !== 0
  ) {
    throw new Error('PRIVATE_CORPUS_REVISION_INIT_RECEIPT_INVALID');
  }
  for (const value of [
    receipt.analysisFixpointHash,
    receipt.projectRootHash,
    receipt.dataRootHash,
    receipt.parentRealpathHash,
    receipt.leafRealpathHash,
    receipt.migrationLedgerSemanticHash,
    receipt.configReceiptHash,
    receipt.runtimeReceiptHash,
    receipt.initReceiptHash,
  ]) {
    requireSha256(value, 'PRIVATE_CORPUS_REVISION_INIT_RECEIPT_HASH_INVALID');
  }
  if (!/^(env|keychain|config-ref):[A-Za-z0-9_.-]+$/.test(receipt.credentialLocationSymbol)) {
    throw new Error('PRIVATE_CORPUS_REVISION_CREDENTIAL_LOCATION_INVALID');
  }
  for (const value of [
    receipt.runId,
    receipt.revisionId,
    receipt.projectId,
    receipt.projectScopeId,
  ]) {
    requireText(value, 'PRIVATE_CORPUS_REVISION_INIT_RECEIPT_IDENTITY_INVALID');
  }
}

function normalizePrivateCorpusRevisionMigrations(
  receipt: PrivateCorpusRevisionInitReceiptV1
): Pick<PrivateCorpusRevisionInitReceiptV1, 'migrationVersions' | 'migrationArtifacts'> {
  if (!Array.isArray(receipt.migrationVersions) || !Array.isArray(receipt.migrationArtifacts)) {
    throw new Error('PRIVATE_CORPUS_REVISION_MIGRATION_RECEIPT_INVALID');
  }
  const migrationVersions = [...receipt.migrationVersions];
  const migrationArtifacts = receipt.migrationArtifacts.map((artifact) => {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      throw new Error('PRIVATE_CORPUS_REVISION_MIGRATION_RECEIPT_INVALID');
    }
    assertExactKeys(
      artifact as unknown as Record<string, unknown>,
      new Set(['version', 'migrationArtifactSha256']),
      'PRIVATE_CORPUS_REVISION_MIGRATION_RECEIPT_INVALID'
    );
    requireText(artifact.version, 'PRIVATE_CORPUS_REVISION_MIGRATION_RECEIPT_INVALID');
    requireSha256(
      artifact.migrationArtifactSha256,
      'PRIVATE_CORPUS_REVISION_MIGRATION_RECEIPT_INVALID'
    );
    return { ...artifact };
  });
  if (
    new Set(migrationVersions).size !== migrationVersions.length ||
    canonicalJsonStringify([...migrationVersions].sort()) !==
      canonicalJsonStringify(migrationVersions) ||
    canonicalJsonStringify(migrationArtifacts.map((row) => row.version)) !==
      canonicalJsonStringify(migrationVersions)
  ) {
    throw new Error('PRIVATE_CORPUS_REVISION_MIGRATION_RECEIPT_INVALID');
  }
  return { migrationVersions, migrationArtifacts };
}

function validatePrivateCorpusRevisionBlankState(
  blankState: PrivateCorpusRevisionInitReceiptV1['blankState']
): void {
  if (!blankState || typeof blankState !== 'object') {
    throw new Error('PRIVATE_CORPUS_REVISION_BLANK_RECEIPT_INVALID');
  }
  assertExactKeys(
    blankState as unknown as Record<string, unknown>,
    new Set([
      'knowledgeEntries',
      'sourceRefs',
      'coverageRows',
      'vectorRoutePresent',
      'publicationRoutePresent',
      'recipeFileCount',
      'candidateFileCount',
    ]),
    'PRIVATE_CORPUS_REVISION_BLANK_RECEIPT_INVALID'
  );
  if (Object.values(blankState).some((value) => value !== 0 && value !== false)) {
    throw new Error('PRIVATE_CORPUS_REVISION_BLANK_RECEIPT_INVALID');
  }
}

export function assertPrivateCorpusRevisionExpectedContextV1(
  receipt: PrivateCorpusRevisionInitReceiptV1,
  expected: PrivateCorpusRevisionExpectedContextV1
): void {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    throw new Error('PRIVATE_CORPUS_REVISION_EXPECTED_CONTEXT_REQUIRED');
  }
  for (const value of [
    expected.analysisFixpointHash,
    expected.configReceiptHash,
    expected.runtimeReceiptHash,
  ]) {
    requireSha256(value, 'PRIVATE_CORPUS_REVISION_EXPECTED_CONTEXT_HASH_INVALID');
  }
  requireText(expected.runId, 'PRIVATE_CORPUS_REVISION_EXPECTED_CONTEXT_IDENTITY_INVALID');
  requireText(expected.revisionId, 'PRIVATE_CORPUS_REVISION_EXPECTED_CONTEXT_IDENTITY_INVALID');
  if (
    receipt.runId !== expected.runId ||
    receipt.revisionId !== expected.revisionId ||
    receipt.analysisFixpointHash !== expected.analysisFixpointHash ||
    receipt.configReceiptHash !== expected.configReceiptHash ||
    receipt.runtimeReceiptHash !== expected.runtimeReceiptHash
  ) {
    throw new Error('PRIVATE_CORPUS_REVISION_CURRENT_CONTEXT_MISMATCH');
  }
}

/**
 * WAL checkpoint 与当前 run/fixpoint/config/runtime identity 同时封存。恢复端必须再次提供
 * expected context，不能仅凭一张历史 receipt 打开旧 revision。
 */
export function createPrivateCorpusRevisionCheckpointV1(
  handle: PrivateCorpusRevisionHandleV1,
  runtime: AlembicDatabaseRuntime,
  expectedCurrentContext: PrivateCorpusRevisionExpectedContextV1
): PrivateCorpusRevisionCheckpointReceiptV1 {
  assertPrivateCorpusRevisionHandleV1(handle);
  handle.assertRuntime(runtime);
  assertPrivateCorpusRevisionExpectedContextV1(handle.initReceipt, expectedCurrentContext);
  runtime.sqlite.pragma('wal_checkpoint(FULL)');
  if (runtime.sqlite.pragma('integrity_check', { simple: true }) !== 'ok') {
    throw new Error('PRIVATE_CORPUS_REVISION_SQLITE_INTEGRITY_FAILED');
  }
  const foreignKeys = runtime.sqlite.pragma('foreign_key_check') as unknown[];
  if (foreignKeys.length !== 0) {
    throw new Error('PRIVATE_CORPUS_REVISION_FOREIGN_KEY_FAILED');
  }
  const semantic = {
    schemaVersion: 1 as const,
    ...expectedCurrentContext,
    initReceiptHash: handle.initReceipt.initReceiptHash,
    databaseHash: hashBytes(fs.readFileSync(handle.resolver.databasePath)),
    sqliteIntegrity: 'ok' as const,
    foreignKeyViolationCount: 0 as const,
  };
  return freezeDeep({ ...semantic, checkpointHash: hashCanonicalJson(semantic) });
}

export function validatePrivateCorpusRevisionCheckpointV1(
  receipt: PrivateCorpusRevisionCheckpointReceiptV1,
  initReceipt: PrivateCorpusRevisionInitReceiptV1,
  expectedCurrentContext: PrivateCorpusRevisionExpectedContextV1
): PrivateCorpusRevisionCheckpointReceiptV1 {
  const validatedInit = validatePrivateCorpusRevisionInitReceiptV1(
    initReceipt,
    expectedCurrentContext
  );
  if (
    receipt.schemaVersion !== 1 ||
    receipt.sqliteIntegrity !== 'ok' ||
    receipt.foreignKeyViolationCount !== 0 ||
    receipt.initReceiptHash !== validatedInit.initReceiptHash
  ) {
    throw new Error('PRIVATE_CORPUS_REVISION_CHECKPOINT_INVALID');
  }
  assertPrivateCorpusRevisionExpectedContextV1(validatedInit, receipt);
  for (const value of [receipt.databaseHash, receipt.checkpointHash]) {
    requireSha256(value, 'PRIVATE_CORPUS_REVISION_CHECKPOINT_HASH_INVALID');
  }
  const { checkpointHash, ...semantic } = receipt;
  if (hashCanonicalJson(semantic) !== checkpointHash) {
    throw new Error('PRIVATE_CORPUS_REVISION_CHECKPOINT_HASH_MISMATCH');
  }
  return freezeDeep({ ...semantic, checkpointHash });
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

function canonicalRecipeCandidateProjection(
  projection: RecipeCandidateFingerprintProjectionV1
): RecipeCandidateFingerprintProjectionV1 {
  const canonical = createRecipeCandidateFingerprintProjectionV1({
    title: projection.title,
    kind: projection.kind,
    category: projection.category,
    trigger: projection.trigger,
    whenClause: projection.whenClause,
    doText: projection.doText,
    dontText: projection.dontText,
    coreCode: projection.coreCode,
    pattern: projection.pattern,
    markdown: projection.markdown,
    usageGuide: projection.usageGuide,
    retrievalProfile: projection.retrievalProfile,
    negativeIntents: projection.negativeIntents,
    scopeId: projection.scopeId,
    moduleId: projection.moduleId,
    dimensionId: projection.dimensionId,
    evidenceRefs: projection.evidenceRefs,
    lineageHashes: projection.lineageHashes,
    persistedPayload: projection.persistedPayload,
  });
  if (
    projection.schemaVersion !== 1 ||
    canonical.authoredFingerprint !== projection.authoredFingerprint
  ) {
    throw new Error('RECIPE_CANDIDATE_FINGERPRINT_INVALID');
  }
  return canonical;
}

export function assertStrictG1ReceiptV1(receipt: StrictG1ReceiptV1): void {
  const rebuilt = createStrictG1ReceiptV1({
    candidateFingerprint: receipt.candidateFingerprint,
    retrievalReadinessHash: receipt.retrievalReadinessHash,
    rows: receipt.rows,
  });
  if (canonicalJsonStringify(rebuilt) !== canonicalJsonStringify(receipt)) {
    throw new Error('STRICT_G1_RECEIPT_INVALID');
  }
}

export function assertStrictAcceptedCorpusInspectionV1(
  inspection: StrictAcceptedCorpusInspectionV1
): void {
  if (
    inspection.schemaVersion !== 1 ||
    inspection.complete !== true ||
    inspection.truncated !== false ||
    inspection.continuation !== null
  ) {
    throw new Error('STRICT_ADMISSION_CORPUS_INCOMPLETE');
  }
  const rebuilt = createStrictAcceptedCorpusInspectionV1({
    runId: inspection.runId,
    analysisFixpointHash: inspection.analysisFixpointHash,
    privateCorpusRevision: inspection.privateCorpusRevision,
    revisionRootManifestHash: inspection.revisionRootManifestHash,
    entries: inspection.entries,
  });
  if (canonicalJsonStringify(rebuilt) !== canonicalJsonStringify(inspection)) {
    throw new Error('STRICT_ADMISSION_CORPUS_INSPECTION_INVALID');
  }
}

export function assertStrictAdmissionReceiptV1(receipt: StrictAdmissionReceiptV1): void {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.complete !== true ||
    receipt.truncated !== false ||
    receipt.continuation !== null ||
    !receipt.admissionId.startsWith('admission:') ||
    receipt.inspectedAcceptedCorpusCount < 0 ||
    !Number.isSafeInteger(receipt.inspectedAcceptedCorpusCount)
  ) {
    throw new Error('STRICT_ADMISSION_RECEIPT_INVALID');
  }
  const exactMatches = [...receipt.exactMatches].sort(compareAdmissionMatches);
  const semanticMatches = [...receipt.semanticMatches].sort(compareAdmissionMatches);
  if (
    canonicalJsonStringify(exactMatches) !== canonicalJsonStringify(receipt.exactMatches) ||
    canonicalJsonStringify(semanticMatches) !== canonicalJsonStringify(receipt.semanticMatches) ||
    semanticMatches.some(
      (match) => !Number.isFinite(match.similarity) || match.similarity < 0 || match.similarity > 1
    ) ||
    receipt.disposition !== deriveAdmissionDisposition(receipt.consolidation) ||
    (receipt.disposition === 'admit' &&
      (exactMatches.length > 0 ||
        semanticMatches.length > 0 ||
        receipt.finalAdmittedFingerprint !== receipt.inputFingerprint))
  ) {
    throw new Error('STRICT_ADMISSION_RECEIPT_INVALID');
  }
  const { receiptHash: _receiptHash, admissionId: _admissionId, ...semantic } = receipt;
  const semanticHash = hashCanonicalJson(semantic);
  const admissionId = `admission:${semanticHash.slice('sha256:'.length)}`;
  if (
    admissionId !== receipt.admissionId ||
    hashCanonicalJson({ ...semantic, admissionId }) !== receipt.receiptHash
  ) {
    throw new Error('STRICT_ADMISSION_RECEIPT_INVALID');
  }
}

export function assertStrictG2ReceiptV1(receipt: StrictG2ReceiptV1): void {
  if (receipt.schemaVersion !== 1) {
    throw new Error('STRICT_G2_RECEIPT_INVALID');
  }
  const producer = normalizeStrictG2Actor(receipt.producer);
  const reviewer = normalizeStrictG2Actor(receipt.reviewer);
  const rows = normalizeStrictG2Rows(receipt.rows);
  const novelty = normalizeStrictG2Novelty(receipt.novelty);
  const duplicate = normalizeStrictG2Duplicate(receipt.duplicate);
  const permittedRepairFields = normalizeStrings(receipt.permittedRepairFields);
  const verdict = deriveStrictG2Verdict(rows, novelty, duplicate);
  if (
    producer.identity === reviewer.identity ||
    verdict !== receipt.verdict ||
    canonicalJsonStringify(rows) !== canonicalJsonStringify(receipt.rows) ||
    canonicalJsonStringify(permittedRepairFields) !==
      canonicalJsonStringify(receipt.permittedRepairFields) ||
    (verdict !== 'revise' && permittedRepairFields.length > 0)
  ) {
    throw new Error('STRICT_G2_RECEIPT_INVALID');
  }
  const { receiptHash: _receiptHash, ...semantic } = receipt;
  if (hashCanonicalJson(semantic) !== receipt.receiptHash) {
    throw new Error('STRICT_G2_RECEIPT_INVALID');
  }
}

function assertPreparedRecipePersistenceV1(prepared: PreparedRecipePersistenceV1): void {
  const rebuilt = prepareRecipePersistenceV1({
    runId: prepared.runId,
    analysisFixpointHash: prepared.analysisFixpointHash,
    privateCorpusRevision: prepared.privateCorpusRevision,
    admissionId: prepared.admissionId,
    cellId: prepared.cellId,
    authoredFingerprint: prepared.authoredFingerprint,
    causalParentIds: prepared.causalParentIds,
    expectedDbHash: prepared.expectedDbHash,
    expectedFileHash: prepared.expectedFileHash,
    journalStepHash: prepared.journalStepHash,
  });
  if (canonicalJsonStringify(rebuilt) !== canonicalJsonStringify(prepared)) {
    throw new Error('STRICT_PREPARED_RECEIPT_INVALID');
  }
}

function normalizeStrictAcceptedRecipeAdmissionSummary(
  summary: StrictAcceptedRecipeAdmissionSummaryV1
): StrictAcceptedRecipeAdmissionSummaryV1 {
  const textOrNull = (value: string | null): string | null => {
    const normalized = value?.trim() ?? '';
    return normalized || null;
  };
  const normalized = {
    title: summary.title.trim(),
    category: textOrNull(summary.category),
    trigger: textOrNull(summary.trigger),
    whenClause: textOrNull(summary.whenClause),
    doClause: textOrNull(summary.doClause),
    dontClause: textOrNull(summary.dontClause),
    coreCode: textOrNull(summary.coreCode),
    guardPattern: textOrNull(summary.guardPattern),
    markdown: textOrNull(summary.markdown),
  };
  if (!normalized.title) {
    throw new Error('STRICT_ADMISSION_CORPUS_ENTRY_INVALID');
  }
  return normalized;
}

function normalizeAdmissionMatches(
  matches: readonly StrictAdmissionExactMatchV1[],
  corpusById: ReadonlyMap<string, StrictAcceptedCorpusEntryV1>
): StrictAdmissionExactMatchV1[] {
  const normalized = matches
    .map((match) => ({
      recipeId: match.recipeId.trim(),
      fingerprint: match.fingerprint.trim(),
    }))
    .sort(compareAdmissionMatches);
  if (
    new Set(normalized.map((match) => match.recipeId)).size !== normalized.length ||
    normalized.some(
      (match) =>
        !match.recipeId ||
        !match.fingerprint ||
        corpusById.get(match.recipeId)?.projection.authoredFingerprint !== match.fingerprint
    )
  ) {
    throw new Error('STRICT_ADMISSION_MATCH_INVALID');
  }
  return normalized;
}

function normalizeAdmissionSemanticMatches(
  matches: readonly StrictAdmissionSemanticMatchV1[],
  corpusById: ReadonlyMap<string, StrictAcceptedCorpusEntryV1>
): StrictAdmissionSemanticMatchV1[] {
  const normalized = matches
    .map((match) => ({
      recipeId: match.recipeId.trim(),
      fingerprint: match.fingerprint.trim(),
      similarity: match.similarity,
    }))
    .sort(compareAdmissionMatches);
  if (
    new Set(normalized.map((match) => match.recipeId)).size !== normalized.length ||
    normalized.some(
      (match) =>
        !match.recipeId ||
        !match.fingerprint ||
        !Number.isFinite(match.similarity) ||
        match.similarity < 0 ||
        match.similarity > 1 ||
        corpusById.get(match.recipeId)?.projection.authoredFingerprint !== match.fingerprint
    )
  ) {
    throw new Error('STRICT_ADMISSION_MATCH_INVALID');
  }
  return normalized;
}

function compareAdmissionMatches(
  left: StrictAdmissionExactMatchV1,
  right: StrictAdmissionExactMatchV1
): number {
  return (
    left.recipeId.localeCompare(right.recipeId) || left.fingerprint.localeCompare(right.fingerprint)
  );
}

function normalizeAdmissionConsolidation(
  consolidation: StrictAdmissionConsolidationV1,
  corpusById: ReadonlyMap<string, StrictAcceptedCorpusEntryV1>
): StrictAdmissionConsolidationV1 {
  if (!['create', 'merge', 'reorganize', 'insufficient', 'reject'].includes(consolidation.action)) {
    throw new Error('STRICT_ADMISSION_CONSOLIDATION_INVALID');
  }
  requireText(consolidation.reasonCode, 'STRICT_ADMISSION_CONSOLIDATION_INVALID');
  const targetRecipeId = consolidation.targetRecipeId?.trim() || null;
  const targetFingerprint = consolidation.targetFingerprint?.trim() || null;
  if (
    (targetRecipeId === null) !== (targetFingerprint === null) ||
    (targetRecipeId !== null &&
      corpusById.get(targetRecipeId)?.projection.authoredFingerprint !== targetFingerprint) ||
    (consolidation.action === 'create' && targetRecipeId !== null) ||
    (['merge', 'reorganize', 'insufficient'].includes(consolidation.action) &&
      targetRecipeId === null)
  ) {
    throw new Error('STRICT_ADMISSION_CONSOLIDATION_INVALID');
  }
  return {
    action: consolidation.action,
    reasonCode: consolidation.reasonCode.trim(),
    targetRecipeId,
    targetFingerprint,
  };
}

function deriveAdmissionDisposition(
  consolidation: StrictAdmissionConsolidationV1
): StrictAdmissionReceiptV1['disposition'] {
  if (consolidation.action === 'create') {
    return 'admit';
  }
  if (consolidation.action === 'merge' || consolidation.action === 'reorganize') {
    return 'merge';
  }
  if (consolidation.action === 'insufficient') {
    return 'duplicate';
  }
  return 'reject';
}

function normalizeStrictG2Actor(actor: StrictG2ActorV1): StrictG2ActorV1 {
  for (const value of [actor.identity, actor.method, actor.modelHash, actor.promptHash]) {
    requireText(value, 'STRICT_G2_ACTOR_INVALID');
  }
  return {
    identity: actor.identity.trim(),
    method: actor.method.trim(),
    modelHash: actor.modelHash.trim(),
    promptHash: actor.promptHash.trim(),
  };
}

function normalizeStrictG2Rows(rows: readonly StrictG2AxisResultV1[]): StrictG2AxisResultV1[] {
  const normalized = rows
    .map((row) => ({
      ...row,
      reasonCode: row.reasonCode.trim(),
      evidenceRefs: normalizeStrings(row.evidenceRefs),
    }))
    .sort((left, right) => left.axis.localeCompare(right.axis));
  const expected = new Set<string>(STRICT_G2_HARD_AXES_V1);
  if (
    normalized.length !== STRICT_G2_HARD_AXES_V1.length ||
    new Set(normalized.map((row) => row.axis)).size !== normalized.length ||
    normalized.some(
      (row) =>
        !expected.has(row.axis) ||
        !row.reasonCode ||
        row.evidenceRefs.length === 0 ||
        !strictG2ScoreMatchesVerdict(row)
    )
  ) {
    throw new Error('STRICT_G2_AXIS_SET_INVALID');
  }
  return normalized;
}

function strictG2ScoreMatchesVerdict(row: StrictG2AxisResultV1): boolean {
  return (
    (row.axisVerdict === 'pass' && row.score === 2 && !row.repairable) ||
    (row.axisVerdict === 'revise' && row.score === 1 && row.repairable) ||
    (row.axisVerdict === 'fail' && row.score === 0) ||
    (row.axisVerdict === 'unknown' && row.score === null)
  );
}

function normalizeStrictG2Novelty(novelty: StrictG2NoveltyDecisionV1): StrictG2NoveltyDecisionV1 {
  if (
    ![
      'novel-project-specific',
      'useful-extension',
      'generic',
      'already-covered',
      'unknown',
    ].includes(novelty.decision)
  ) {
    throw new Error('STRICT_G2_NOVELTY_INVALID');
  }
  requireText(novelty.reasonCode, 'STRICT_G2_NOVELTY_INVALID');
  const evidenceRefs = normalizeStrings(novelty.evidenceRefs);
  if (evidenceRefs.length === 0) {
    throw new Error('STRICT_G2_NOVELTY_INVALID');
  }
  return { ...novelty, reasonCode: novelty.reasonCode.trim(), evidenceRefs };
}

function normalizeStrictG2Duplicate(
  duplicate: StrictG2DuplicateDecisionV1
): StrictG2DuplicateDecisionV1 {
  if (
    !['no-match', 'exact-match', 'semantic-match', 'consolidated', 'unknown'].includes(
      duplicate.decision
    )
  ) {
    throw new Error('STRICT_G2_DUPLICATE_INVALID');
  }
  requireText(duplicate.reasonCode, 'STRICT_G2_DUPLICATE_INVALID');
  requireText(duplicate.admissionAlgorithmVersion, 'STRICT_G2_DUPLICATE_INVALID');
  requireText(duplicate.comparedPrivateCorpusRevision, 'STRICT_G2_DUPLICATE_INVALID');
  const evidenceRefs = normalizeStrings(duplicate.evidenceRefs);
  const matchedRecipeIds = normalizeStrings(duplicate.matchedRecipeIds);
  const matchedFingerprints = normalizeStrings(duplicate.matchedFingerprints);
  const targetRecipeId = duplicate.targetRecipeId?.trim() || null;
  const consolidationFingerprint = duplicate.consolidationFingerprint?.trim() || null;
  if (
    evidenceRefs.length === 0 ||
    matchedRecipeIds.length !== matchedFingerprints.length ||
    (targetRecipeId === null) !== (consolidationFingerprint === null)
  ) {
    throw new Error('STRICT_G2_DUPLICATE_INVALID');
  }
  return {
    ...duplicate,
    reasonCode: duplicate.reasonCode.trim(),
    evidenceRefs,
    admissionAlgorithmVersion: duplicate.admissionAlgorithmVersion.trim(),
    comparedPrivateCorpusRevision: duplicate.comparedPrivateCorpusRevision.trim(),
    matchedRecipeIds,
    matchedFingerprints,
    targetRecipeId,
    consolidationFingerprint,
  };
}

function deriveStrictG2Verdict(
  rows: readonly StrictG2AxisResultV1[],
  novelty: StrictG2NoveltyDecisionV1,
  duplicate: StrictG2DuplicateDecisionV1
): StrictG2ReceiptV1['verdict'] {
  const noveltyPass = ['novel-project-specific', 'useful-extension'].includes(novelty.decision);
  const duplicatePass = ['no-match', 'consolidated'].includes(duplicate.decision);
  if (
    rows.every((row) => row.axisVerdict === 'pass' && row.score === 2) &&
    noveltyPass &&
    duplicatePass
  ) {
    return 'pass';
  }
  if (
    rows.some((row) => row.axisVerdict === 'revise') &&
    rows.every((row) => ['pass', 'revise'].includes(row.axisVerdict)) &&
    noveltyPass &&
    duplicatePass
  ) {
    return 'revise';
  }
  return 'reject';
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
const STRICT_PUBLICATION_MARKER_INPUT_KEYS = new Set<string>([
  'mode',
  'routeSchemaVersion',
  'projectIdentityHash',
  'migrationBundleHash',
]);
const SERVING_SNAPSHOT_INPUT_KEYS = new Set<string>([
  'sessionId',
  'snapshotId',
  'candidateDataManifestHash',
  'finalCoverageBindingHash',
  'servingSnapshotValidationHash',
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
