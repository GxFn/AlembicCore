import path from 'node:path';

import { analyzeSourceFile, reloadProjectAstPlugins } from '../../core/ast/index.js';
import {
  parseFlutterPluginsDeps,
  parseNxWorkspace,
  parseReactNativeProject,
} from '../../core/discovery/index.js';
import {
  type EvidenceEntry,
  isValidEvidenceEntry,
} from '../../domain/knowledge/evidence-ledger/EvidenceLedgerContract.js';
import type {
  ProjectContextRef,
  ProjectContextRequestKind,
} from '../../domain/project-context/index.js';
import {
  buildFactQueryCatalogSnapshot,
  type CertifiedPlanningFactsV1,
  type FactHarvestObligationV1,
  type FactQueryCatalogSnapshotV1,
  type FactQueryFamilyV1,
  type MiningWorkScheduleV1,
} from '../plan/intent/coldStartProductionPlan.js';
import {
  hashBytes,
  hashCanonicalJson,
  toProjectFactsJson,
} from '../project-context/foundation/canonical.js';
import { verifyCertifiedProjectFactsArtifact } from '../project-context/foundation/capture.js';
import type {
  CanonicalSha256,
  CertifiedProjectFactsArtifactV1,
  ProjectFactsInventoryFileV1,
  ProjectFactsJson,
} from '../project-context/foundation/contracts.js';
import { readCertifiedProjectFactsFrozenFile } from '../project-context/foundation/frozen.js';
import { resolveAstParserLanguage } from '../project-context/shared/parserLanguage.js';
import { createProjectContextFileRef } from '../project-context/shared/sourceSlice-fileSymbols/contracts.js';
import {
  createFactRecordV1,
  type FactRecordV1,
  validateFactRecordGraphV1,
} from './StrictAnalysisContracts.js';
import {
  assertFactQueryExecutionReceiptV1,
  type FactQueryExecutionReceiptV1,
  type StrictFactFileExecutionV1,
} from './StrictFactExecutionReceipt.js';

export {
  assertFactQueryExecutionReceiptV1,
  type FactQueryExecutionReceiptV1,
  type StrictFactFileExecutionV1,
} from './StrictFactExecutionReceipt.js';

export type StrictFactSubjectSelectorV1 =
  | {
      readonly kind: 'repository';
      readonly repoId: string;
    }
  | {
      readonly kind: 'owner-module';
      readonly repoId: string;
      readonly ownerModuleId: string;
    };

export interface StrictFactSubjectBindingV1 {
  readonly schemaVersion: 1;
  readonly sourceArtifactId: string;
  readonly sourceRevisionVectorHash: string;
  readonly planningFactsHash: string;
  readonly canonicalSubjectRef: string;
  readonly selector: StrictFactSubjectSelectorV1;
  readonly eligibleFiles: readonly StrictFactBackendFileV1[];
  readonly denominatorHash: string;
  readonly bindingHash: string;
}

/**
 * Evidence Ledger / ProjectContext ref 的宿主权威绑定。Core 校验其 frozen path/blob/revision，
 * 但不自行捏造 ledger ID；Main 必须从真实 Evidence Ledger/PC Ref 适配器提供这些字段。
 */
export interface StrictFactDirectWitnessBindingV1 {
  readonly schemaVersion: 1;
  readonly sourceArtifactId: string;
  readonly sourceRevisionVectorHash: string;
  readonly repoId: string;
  readonly relativePath: string;
  readonly blobHash: string;
  readonly evidenceEntryId: string;
  readonly evidenceSessionId: string;
  readonly evidenceContentHash: string;
  readonly evidenceEntryHash: string;
  readonly evidenceEntry: EvidenceEntry;
  readonly evidenceLedgerSnapshotHash: string;
  readonly projectContextRefId: string;
  readonly projectContextRefHash: string;
  readonly projectContextRef: ProjectContextRef;
  readonly bindingHash: string;
}

export interface StrictFactWitnessAuthorityPortV1 {
  readonly authorityHash: string;
  resolveEvidenceEntry(input: {
    readonly evidenceSessionId: string;
    readonly evidenceEntryId: string;
    readonly evidenceLedgerSnapshotHash: string;
  }): Promise<EvidenceEntry | null>;
  resolveProjectContextRef(input: {
    readonly sourceArtifactId: string;
    readonly projectContextRefId: string;
  }): Promise<ProjectContextRef | null>;
}

export interface StrictEvidenceLedgerSnapshotV1 {
  readonly schemaVersion: 1;
  readonly entries: readonly EvidenceEntry[];
  readonly complete: true;
  readonly truncated: false;
  readonly continuation: null;
  readonly snapshotHash: string;
}

export interface StrictFactBackendFileV1 {
  readonly repoId: string;
  readonly relativePath: string;
  readonly language: string;
  readonly blobHash: string;
  readonly byteLength: number;
}

export interface StrictFactBackendCandidateV1 {
  readonly value: unknown;
  readonly range?: {
    readonly startLine: number;
    readonly endLine: number;
    readonly startColumn?: number;
    readonly endColumn?: number;
  };
}

export interface StrictFactBackendFileResultV1 {
  readonly status: 'complete' | 'failed' | 'unknown';
  readonly reasonCode: string;
  readonly facts: readonly StrictFactBackendCandidateV1[];
  readonly inspectedBlobHash: string;
  readonly truncated: boolean;
  readonly continuation: string | null;
}

export interface StrictFactBackendExecutionContextV1 {
  readonly artifact: CertifiedProjectFactsArtifactV1;
  readonly obligation: FactHarvestObligationV1;
  readonly file: StrictFactBackendFileV1;
  readonly content: Uint8Array;
  readonly contentText: string;
  readonly signal: AbortSignal;
}

export interface StrictAstFactQueryPackV1 {
  readonly schemaVersion: 1;
  readonly familyId: string;
  readonly queryId: string;
  readonly queryVersion: string;
  readonly extractorId: 'declarations-v1';
  readonly queryPackHash: string;
}

/**
 * Catalog 元数据只能证明“声明已加载”；严格执行还要求同一对象携带真实函数。
 * 函数不参与 hash，五个 load/fixture hash 与 catalog 行逐字段匹配。
 */
export interface StrictFactQueryBackendV1 extends FactQueryFamilyV1 {
  executeFile(context: StrictFactBackendExecutionContextV1): Promise<StrictFactBackendFileResultV1>;
}

export interface StrictFactBackendRegistryV1 {
  readonly schemaVersion: 1;
  readonly backends: readonly StrictFactQueryBackendV1[];
  readonly registryHash: string;
}

export interface CodeFactGenerationManifestV1 {
  readonly schemaVersion: 1;
  readonly sourceArtifactId: string;
  readonly sourceRevisionVectorHash: string;
  readonly factQueryCatalogHash: string;
  readonly factHarvestScheduleHash: string;
  readonly backendRegistryHash: string;
  readonly obligationCount: number;
  readonly terminalReceiptIds: readonly string[];
  readonly terminalReceiptHashes: readonly string[];
  readonly terminalReceiptSetHash: string;
  readonly harvestReceiptHashes: readonly string[];
  readonly harvestCount: number;
  readonly denominatorHashes: readonly string[];
  readonly witnessBindingSetHash: string;
  readonly factIds: readonly string[];
  readonly factCount: number;
  readonly unexecutableCatalogFamilyIds: readonly string[];
  readonly unregisteredBackendFamilyIds: readonly string[];
  readonly failedObligationIds: readonly string[];
  readonly unknownObligationIds: readonly string[];
  readonly verdict: 'passed' | 'failed';
  readonly manifestHash: string;
}

export interface StrictFactScheduleExecutionResultV1 {
  readonly facts: readonly FactRecordV1[];
  readonly receipts: readonly FactQueryExecutionReceiptV1[];
  readonly manifest: CodeFactGenerationManifestV1;
}

export interface StrictFactScheduleExecutionInputV1 {
  readonly artifact: CertifiedProjectFactsArtifactV1;
  readonly planningFacts: CertifiedPlanningFactsV1;
  readonly catalog: FactQueryCatalogSnapshotV1;
  readonly schedule: MiningWorkScheduleV1;
  readonly subjectBindings: readonly StrictFactSubjectBindingV1[];
  readonly witnessBindings: readonly StrictFactDirectWitnessBindingV1[];
  readonly witnessAuthority: StrictFactWitnessAuthorityPortV1;
  readonly registry: StrictFactBackendRegistryV1;
  readonly perFileTimeoutMs?: number;
}

type StrictFactBackendKindV1 = 'ast' | 'project-context' | 'config';

interface StrictFactBackendRuntimeAuthorityV1 {
  readonly kind: StrictFactBackendKindV1;
  readonly queryPackHash: string;
  readonly configurationHash: string;
}

interface StrictFactHarvestExecutionV1 {
  readonly harvestKey: string;
  readonly harvestReceiptHash: string;
  readonly stagedFacts: readonly FactRecordV1[];
  readonly fileExecutions: readonly StrictFactFileExecutionV1[];
  readonly terminalStatus: 'complete' | 'failed' | 'unknown';
  readonly terminalReason: string;
}

/**
 * 执行权限只保存在 Core 模块私有 WeakMap 中，不进入 backend 对象。
 * 对象展开、序列化或替换 executeFile 都会产生新 identity，因此不能复制加载权限。
 */
const STRICT_FACT_BACKEND_AUTHORITIES = new WeakMap<
  StrictFactQueryBackendV1,
  StrictFactBackendRuntimeAuthorityV1
>();
const STRICT_FACT_WITNESS_AUTHORITIES = new WeakMap<
  StrictFactWitnessAuthorityPortV1,
  {
    readonly sourceArtifactId: string;
    readonly sourceRevisionVectorHash: string;
    readonly evidenceLedgerSnapshotHash: string;
    readonly evidenceLedgerSnapshot: StrictEvidenceLedgerSnapshotV1;
  }
>();

const AST_BACKEND_PRODUCER = 'loaded:strict-ast-fact-backend-v1';
const PROJECT_CONTEXT_BACKEND_PRODUCER = 'loaded:strict-project-context-fact-backend-v1';
const CONFIG_BACKEND_PRODUCER = 'loaded:strict-config-fact-backend-v1';

export function createStrictAstFactQueryPackV1(input: {
  readonly familyId: string;
  readonly queryId: string;
  readonly queryVersion: string;
  readonly extractorId: 'declarations-v1';
}): StrictAstFactQueryPackV1 {
  const semantic = {
    schemaVersion: 1 as const,
    familyId: input.familyId.trim(),
    queryId: input.queryId.trim(),
    queryVersion: input.queryVersion.trim(),
    extractorId: input.extractorId,
  };
  if (!semantic.familyId || !semantic.queryId || !semantic.queryVersion) {
    throw new Error('STRICT_FACT_QUERY_PACK_INVALID');
  }
  return freezeDeep({ ...semantic, queryPackHash: hashCanonicalJson(semantic) });
}

export function createAstFactQueryFamilyV1(input: {
  readonly queryPack: StrictAstFactQueryPackV1;
  readonly supportedScales: readonly FactQueryFamilyV1['supportedScales'][number][];
}): FactQueryFamilyV1 {
  assertStrictAstQueryPack(input.queryPack);
  return createDerivedBackendFamily({
    id: input.queryPack.familyId,
    capabilityId: 'tree-sitter-query',
    supportedScales: input.supportedScales,
    loadedProducer: AST_BACKEND_PRODUCER,
    queryPackHash: input.queryPack.queryPackHash,
    backendKind: 'ast',
    configuration: {
      extractorId: input.queryPack.extractorId,
      queryId: input.queryPack.queryId,
      queryVersion: input.queryPack.queryVersion,
    },
    fixtures: astFixtureDefinitions(),
  });
}

export function createProjectContextFactQueryFamilyV1(input: {
  readonly familyId: string;
  readonly supportedScales: readonly FactQueryFamilyV1['supportedScales'][number][];
  readonly requestKinds?: readonly ProjectContextRequestKind[];
}): FactQueryFamilyV1 {
  const requestKinds = input.requestKinds ? [...new Set(input.requestKinds)].sort() : ['*'];
  return createDerivedBackendFamily({
    id: input.familyId,
    capabilityId: 'project-context-query',
    supportedScales: input.supportedScales,
    loadedProducer: PROJECT_CONTEXT_BACKEND_PRODUCER,
    queryPackHash: hashCanonicalJson({
      schemaVersion: 1,
      familyId: input.familyId,
      queryId: 'certified-project-context-outcomes-v1',
      requestKinds,
    }),
    backendKind: 'project-context',
    configuration: { requestKinds },
    fixtures: projectContextFixtureDefinitions(),
  });
}

export function createConfigFactQueryFamilyV1(input: {
  readonly familyId: string;
  readonly supportedScales: readonly FactQueryFamilyV1['supportedScales'][number][];
  readonly parser: StrictConfigParserIdV1;
}): FactQueryFamilyV1 {
  return createDerivedBackendFamily({
    id: input.familyId,
    capabilityId: 'config-parser',
    supportedScales: input.supportedScales,
    loadedProducer: CONFIG_BACKEND_PRODUCER,
    queryPackHash: hashCanonicalJson({
      schemaVersion: 1,
      familyId: input.familyId,
      queryId: input.parser,
      parser: input.parser,
    }),
    backendKind: 'config',
    configuration: { parser: input.parser },
    fixtures: configFixtureDefinitions(input.parser),
  });
}

export function createStrictFactSubjectBindingV1(input: {
  readonly artifact: CertifiedProjectFactsArtifactV1;
  readonly planningFacts: CertifiedPlanningFactsV1;
  readonly selector: StrictFactSubjectSelectorV1;
}): StrictFactSubjectBindingV1 {
  verifyCertifiedProjectFactsArtifact(input.artifact);
  assertPlanningFactsAuthority(input.artifact, input.planningFacts);
  const canonicalSubjectRef = deriveCanonicalSubjectRef(
    input.artifact,
    input.planningFacts,
    input.selector
  );
  if (!canonicalSubjectRef || !selectorExistsInArtifact(input.artifact, input.selector)) {
    throw new Error('STRICT_FACT_SUBJECT_AUTHORITY_INVALID');
  }
  const eligibleFiles = selectFilesForSelector(input.artifact, input.selector).map(projectFile);
  if (eligibleFiles.length === 0) {
    throw new Error('STRICT_FACT_SUBJECT_DENOMINATOR_EMPTY');
  }
  const denominatorHash = hashCanonicalJson(eligibleFiles);
  const semantic = {
    schemaVersion: 1 as const,
    sourceArtifactId: input.artifact.artifactId,
    sourceRevisionVectorHash: input.artifact.sourceVectorHash,
    planningFactsHash: hashCanonicalJson(input.planningFacts),
    canonicalSubjectRef,
    selector: { ...input.selector },
    eligibleFiles,
    denominatorHash,
  };
  return freezeDeep({ ...semantic, bindingHash: hashCanonicalJson(semantic) });
}

export function createStrictEvidenceLedgerSnapshotV1(
  entries: readonly EvidenceEntry[]
): StrictEvidenceLedgerSnapshotV1 {
  const ordered = entries
    .map((entry) => ({ ...entry, ...(entry.range ? { range: { ...entry.range } } : {}) }))
    .sort(
      (left, right) =>
        left.sessionId.localeCompare(right.sessionId) ||
        left.id.localeCompare(right.id) ||
        left.callId.localeCompare(right.callId)
    );
  if (
    ordered.length === 0 ||
    ordered.some(
      (entry) =>
        !isValidEvidenceEntry(entry) ||
        !/^sha256:[0-9a-f]{64}$/.test(entry.contentHash) ||
        hashBytes(Buffer.from(entry.content)) !== entry.contentHash
    ) ||
    new Set(ordered.map((entry) => `${entry.sessionId}\u0000${entry.id}`)).size !== ordered.length
  ) {
    throw new Error('STRICT_FACT_EVIDENCE_LEDGER_SNAPSHOT_INVALID');
  }
  const semantic = {
    schemaVersion: 1 as const,
    entries: ordered,
    complete: true as const,
    truncated: false as const,
    continuation: null,
  };
  return freezeDeep({ ...semantic, snapshotHash: hashCanonicalJson(semantic) });
}

/**
 * 宿主先把真实 Evidence Ledger 完整快照与 PC file refs 载入，再由 Core 封成不可复制
 * authority。executor 只接受该 factory 生成的对象，原样回显 resolver 不再是授权。
 */
export function createStrictFactWitnessAuthorityV1(input: {
  readonly artifact: CertifiedProjectFactsArtifactV1;
  readonly evidenceLedgerSnapshot: StrictEvidenceLedgerSnapshotV1;
  readonly projectContextRefs: readonly ProjectContextRef[];
}): StrictFactWitnessAuthorityPortV1 {
  verifyCertifiedProjectFactsArtifact(input.artifact);
  const rebuiltSnapshot = createStrictEvidenceLedgerSnapshotV1(
    input.evidenceLedgerSnapshot.entries
  );
  if (
    input.evidenceLedgerSnapshot.complete !== true ||
    input.evidenceLedgerSnapshot.truncated !== false ||
    input.evidenceLedgerSnapshot.continuation !== null ||
    rebuiltSnapshot.snapshotHash !== input.evidenceLedgerSnapshot.snapshotHash
  ) {
    throw new Error('STRICT_FACT_EVIDENCE_LEDGER_SNAPSHOT_INVALID');
  }
  const entries = new Map(
    rebuiltSnapshot.entries.map((entry) => [`${entry.sessionId}\u0000${entry.id}`, entry])
  );
  const refs = new Map<string, ProjectContextRef>();
  for (const ref of input.projectContextRefs) {
    const file = input.artifact.facts.inventory.files.find(
      (candidate) =>
        createProjectContextFileRef({
          projectRoot: ref.scope.projectRoot,
          repoId: candidate.repoId,
          filePath: candidate.relativePath,
          hash: candidate.blobSha256,
        }).id === ref.id
    );
    if (
      !file ||
      refs.has(ref.id) ||
      hashCanonicalJson(ref) !==
        hashCanonicalJson(
          createProjectContextFileRef({
            projectRoot: ref.scope.projectRoot,
            repoId: file.repoId,
            filePath: file.relativePath,
            hash: file.blobSha256,
          })
        )
    ) {
      throw new Error('STRICT_FACT_PROJECT_CONTEXT_REF_SNAPSHOT_INVALID');
    }
    refs.set(ref.id, freezeDeep({ ...ref }));
  }
  if (refs.size === 0) {
    throw new Error('STRICT_FACT_PROJECT_CONTEXT_REF_SNAPSHOT_INVALID');
  }
  const authoritySemantic = {
    schemaVersion: 1 as const,
    sourceArtifactId: input.artifact.artifactId,
    sourceRevisionVectorHash: input.artifact.sourceVectorHash,
    evidenceLedgerSnapshotHash: rebuiltSnapshot.snapshotHash,
    projectContextRefHashes: [...refs.values()].map((ref) => hashCanonicalJson(ref)).sort(),
  };
  const authority: StrictFactWitnessAuthorityPortV1 = freezeDeep({
    authorityHash: hashCanonicalJson(authoritySemantic),
    resolveEvidenceEntry: async (request: {
      evidenceSessionId: string;
      evidenceEntryId: string;
      evidenceLedgerSnapshotHash: string;
    }) =>
      request.evidenceLedgerSnapshotHash === rebuiltSnapshot.snapshotHash
        ? (entries.get(`${request.evidenceSessionId}\u0000${request.evidenceEntryId}`) ?? null)
        : null,
    resolveProjectContextRef: async (request: {
      sourceArtifactId: string;
      projectContextRefId: string;
    }) =>
      request.sourceArtifactId === input.artifact.artifactId
        ? (refs.get(request.projectContextRefId) ?? null)
        : null,
  });
  STRICT_FACT_WITNESS_AUTHORITIES.set(authority, {
    sourceArtifactId: authoritySemantic.sourceArtifactId,
    sourceRevisionVectorHash: authoritySemantic.sourceRevisionVectorHash,
    evidenceLedgerSnapshotHash: authoritySemantic.evidenceLedgerSnapshotHash,
    evidenceLedgerSnapshot: rebuiltSnapshot,
  });
  return authority;
}

export function createStrictFactDirectWitnessBindingV1(input: {
  readonly artifact: CertifiedProjectFactsArtifactV1;
  readonly repoId: string;
  readonly relativePath: string;
  readonly evidenceEntry: EvidenceEntry;
  readonly evidenceLedgerSnapshot: StrictEvidenceLedgerSnapshotV1;
  readonly projectContextRef: ProjectContextRef;
}): StrictFactDirectWitnessBindingV1 {
  verifyCertifiedProjectFactsArtifact(input.artifact);
  const file = input.artifact.facts.inventory.files.find(
    (candidate) =>
      candidate.repoId === input.repoId && candidate.relativePath === input.relativePath
  );
  if (!file) {
    throw new Error('STRICT_FACT_WITNESS_AUTHORITY_INVALID');
  }
  const frozenBytes = readCertifiedProjectFactsFrozenFile(input.artifact, file);
  const expectedEvidenceBytes = selectFrozenEvidenceBytes(frozenBytes, input.evidenceEntry.range);
  const expectedProjectContextRef = createProjectContextFileRef({
    projectRoot: input.projectContextRef.scope.projectRoot,
    repoId: file.repoId,
    filePath: file.relativePath,
    hash: file.blobSha256,
  });
  const rebuiltSnapshot = createStrictEvidenceLedgerSnapshotV1(
    input.evidenceLedgerSnapshot.entries
  );
  const snapshotEntry = rebuiltSnapshot.entries.find(
    (entry) =>
      entry.sessionId === input.evidenceEntry.sessionId && entry.id === input.evidenceEntry.id
  );
  if (
    !isValidEvidenceEntry(input.evidenceEntry) ||
    input.evidenceEntry.tool !== 'code.read' ||
    input.evidenceEntry.file !== file.relativePath ||
    !/^sha256:[0-9a-f]{64}$/.test(input.evidenceEntry.contentHash) ||
    hashBytes(Buffer.from(input.evidenceEntry.content)) !== input.evidenceEntry.contentHash ||
    !expectedEvidenceBytes ||
    !Buffer.from(input.evidenceEntry.content).equals(Buffer.from(expectedEvidenceBytes)) ||
    input.evidenceLedgerSnapshot.complete !== true ||
    input.evidenceLedgerSnapshot.truncated !== false ||
    input.evidenceLedgerSnapshot.continuation !== null ||
    rebuiltSnapshot.snapshotHash !== input.evidenceLedgerSnapshot.snapshotHash ||
    !snapshotEntry ||
    hashCanonicalJson(snapshotEntry) !== hashCanonicalJson(input.evidenceEntry) ||
    hashCanonicalJson(input.projectContextRef) !== hashCanonicalJson(expectedProjectContextRef)
  ) {
    throw new Error('STRICT_FACT_WITNESS_AUTHORITY_INVALID');
  }
  const semantic = {
    schemaVersion: 1 as const,
    sourceArtifactId: input.artifact.artifactId,
    sourceRevisionVectorHash: input.artifact.sourceVectorHash,
    repoId: file.repoId,
    relativePath: file.relativePath,
    blobHash: file.blobSha256,
    evidenceEntryId: input.evidenceEntry.id,
    evidenceSessionId: input.evidenceEntry.sessionId,
    evidenceContentHash: input.evidenceEntry.contentHash,
    evidenceEntryHash: hashCanonicalJson(input.evidenceEntry),
    evidenceEntry: { ...input.evidenceEntry },
    evidenceLedgerSnapshotHash: rebuiltSnapshot.snapshotHash,
    projectContextRefId: input.projectContextRef.id,
    projectContextRefHash: hashCanonicalJson(input.projectContextRef),
    projectContextRef: { ...input.projectContextRef },
  };
  return freezeDeep({ ...semantic, bindingHash: hashCanonicalJson(semantic) });
}

/**
 * Evidence Ledger 的 `code.read` 行段使用 1-indexed 闭区间，并以 LF 分行、保留 CR 字节。
 * 这里直接在冻结字节上定位边界，避免先解码再编码把非法 UTF-8 或换行差异变成相同文本。
 */
function selectFrozenEvidenceBytes(
  frozenBytes: Uint8Array,
  range: EvidenceEntry['range']
): Uint8Array | null {
  if (!range) {
    return frozenBytes;
  }
  const lineStarts = [0];
  for (let index = 0; index < frozenBytes.byteLength; index += 1) {
    if (frozenBytes[index] === 0x0a) {
      lineStarts.push(index + 1);
    }
  }
  if (range.start > lineStarts.length || range.end > lineStarts.length) {
    return null;
  }
  const startOffset = lineStarts[range.start - 1]!;
  const endOffset =
    range.end < lineStarts.length ? lineStarts[range.end]! - 1 : frozenBytes.byteLength;
  return frozenBytes.slice(startOffset, endOffset);
}

export function createStrictFactBackendRegistryV1(
  backends: readonly StrictFactQueryBackendV1[]
): StrictFactBackendRegistryV1 {
  const ordered = [...backends].sort((left, right) => left.id.localeCompare(right.id));
  if (
    new Set(ordered.map((backend) => backend.id)).size !== ordered.length ||
    ordered.some(
      (backend) =>
        typeof backend.executeFile !== 'function' || !STRICT_FACT_BACKEND_AUTHORITIES.has(backend)
    )
  ) {
    throw new Error('STRICT_FACT_BACKEND_REGISTRY_INVALID');
  }
  const registryProjection = ordered.map(projectRegisteredBackend);
  return freezeDeep({
    schemaVersion: 1,
    backends: ordered,
    registryHash: hashCanonicalJson(registryProjection),
  });
}

export async function executeStrictFactScheduleV1(
  input: StrictFactScheduleExecutionInputV1
): Promise<StrictFactScheduleExecutionResultV1> {
  verifyStrictFactExecutionInputs(input);
  const state = createStrictFactExecutionState(input);
  const acceptedFacts: FactRecordV1[] = [];
  const receipts: FactQueryExecutionReceiptV1[] = [];
  for (const obligation of [...input.schedule.factHarvestObligations].sort((left, right) =>
    left.obligationId.localeCompare(right.obligationId)
  )) {
    const outcome = await executeStrictFactObligation(input, state, obligation);
    acceptedFacts.push(...outcome.facts);
    receipts.push(outcome.receipt);
  }
  return createStrictFactScheduleResult(input, state, acceptedFacts, receipts);
}

interface StrictFactExecutionStateV1 {
  readonly families: ReadonlyMap<string, FactQueryFamilyV1>;
  readonly backends: ReadonlyMap<string, StrictFactQueryBackendV1>;
  readonly bindings: ReadonlyMap<string, StrictFactSubjectBindingV1>;
  readonly witnessBindings: ReadonlyMap<string, StrictFactDirectWitnessBindingV1>;
  readonly harvests: Map<string, StrictFactHarvestExecutionV1>;
}

function createStrictFactExecutionState(
  input: StrictFactScheduleExecutionInputV1
): StrictFactExecutionStateV1 {
  return {
    families: new Map(input.catalog.families.map((family) => [family.id, family])),
    backends: new Map(input.registry.backends.map((backend) => [backend.id, backend])),
    bindings: new Map(
      input.subjectBindings.map((binding) => [binding.canonicalSubjectRef, binding])
    ),
    witnessBindings: new Map(
      input.witnessBindings.map((binding) => [
        `${binding.repoId}\u0000${binding.relativePath}`,
        binding,
      ])
    ),
    harvests: new Map(),
  };
}

async function executeStrictFactObligation(
  input: StrictFactScheduleExecutionInputV1,
  state: StrictFactExecutionStateV1,
  obligation: FactHarvestObligationV1
): Promise<{
  readonly facts: readonly FactRecordV1[];
  readonly receipt: FactQueryExecutionReceiptV1;
}> {
  const family = state.families.get(obligation.factFamilyId);
  const backend = state.backends.get(obligation.factFamilyId);
  const binding = state.bindings.get(obligation.canonicalSubjectRef);
  const files = binding ? selectCompleteSubjectFiles(input.artifact, binding) : [];
  const unavailableReason = resolveFactObligationUnavailableReason(
    input.artifact,
    obligation,
    family,
    backend,
    binding,
    files
  );
  if (unavailableReason || !family || !backend || !binding) {
    return {
      facts: [],
      receipt: createUnavailableReceipt(
        input.artifact,
        obligation,
        family,
        binding,
        unavailableReason ?? 'FACT_QUERY_BACKEND_UNAVAILABLE'
      ),
    };
  }
  const harvestKey = createStrictFactHarvestKey(input.artifact, family, binding, obligation);
  let harvest = state.harvests.get(harvestKey);
  if (!harvest) {
    harvest = await executeStrictDirectFactHarvest({
      artifact: input.artifact,
      obligation,
      family,
      backend,
      binding,
      files,
      witnessBindings: state.witnessBindings,
      witnessAuthority: input.witnessAuthority,
      perFileTimeoutMs: input.perFileTimeoutMs ?? 30_000,
    });
    state.harvests.set(harvestKey, harvest);
  }
  return finalizeStrictFactObligation(
    input.artifact,
    obligation,
    family,
    binding,
    files,
    state.witnessBindings,
    harvest
  );
}

function resolveFactObligationUnavailableReason(
  artifact: CertifiedProjectFactsArtifactV1,
  obligation: FactHarvestObligationV1,
  family: FactQueryFamilyV1 | undefined,
  backend: StrictFactQueryBackendV1 | undefined,
  binding: StrictFactSubjectBindingV1 | undefined,
  files: readonly ProjectFactsInventoryFileV1[]
): string | null {
  if (!family) {
    return 'FACT_QUERY_FAMILY_UNAVAILABLE';
  }
  if (!binding) {
    return 'FACT_SUBJECT_BINDING_UNAVAILABLE';
  }
  if (files.length === 0) {
    return 'FACT_SUBJECT_DENOMINATOR_EMPTY';
  }
  if (!backend || !sameBackendIdentity(family, backend)) {
    return 'FACT_QUERY_BACKEND_UNAVAILABLE';
  }
  if (
    family.capabilityId !== obligation.capabilityId ||
    !family.supportedScales.includes(obligation.analysisScale)
  ) {
    return 'FACT_QUERY_CAPABILITY_SCALE_MISMATCH';
  }
  return isSubjectScaleAuthorized(artifact, binding, obligation.analysisScale)
    ? null
    : 'FACT_SUBJECT_SCALE_MISMATCH';
}

function finalizeStrictFactObligation(
  artifact: CertifiedProjectFactsArtifactV1,
  obligation: FactHarvestObligationV1,
  family: FactQueryFamilyV1,
  binding: StrictFactSubjectBindingV1,
  files: readonly ProjectFactsInventoryFileV1[],
  witnessBindings: ReadonlyMap<string, StrictFactDirectWitnessBindingV1>,
  harvest: StrictFactHarvestExecutionV1
): {
  readonly facts: readonly FactRecordV1[];
  readonly receipt: FactQueryExecutionReceiptV1;
} {
  const directFacts = uniqueFacts(harvest.stagedFacts).sort((left, right) =>
    left.factId.localeCompare(right.factId)
  );
  const derivedFacts = createDerivedAggregateFacts(
    artifact,
    obligation,
    directFacts,
    harvest.terminalStatus
  );
  const facts =
    harvest.terminalStatus === 'complete'
      ? [...directFacts, ...derivedFacts].sort((left, right) =>
          left.factId.localeCompare(right.factId)
        )
      : [];
  const fileExecutions = finalizeStrictFileExecutions(harvest.fileExecutions, facts);
  return {
    facts,
    receipt: createExecutionReceipt({
      artifact,
      obligation,
      family,
      fileExecutions,
      derivedFactIds: derivedFacts.map((fact) => fact.factId),
      emittedFactIds: facts.map((fact) => fact.factId),
      terminalStatus: harvest.terminalStatus,
      terminalReason: harvest.terminalReason,
      binding,
      harvestKey: harvest.harvestKey,
      harvestReceiptHash: harvest.harvestReceiptHash,
      witnessBindingHash: hashCanonicalJson(
        files.map(
          (file) =>
            witnessBindings.get(`${file.repoId}\u0000${file.relativePath}`)?.bindingHash ??
            'missing'
        )
      ),
    }),
  };
}

function createDerivedAggregateFacts(
  artifact: CertifiedProjectFactsArtifactV1,
  obligation: FactHarvestObligationV1,
  directFacts: readonly FactRecordV1[],
  terminalStatus: StrictFactHarvestExecutionV1['terminalStatus']
): FactRecordV1[] {
  if (
    terminalStatus !== 'complete' ||
    !isAggregateScale(obligation.analysisScale) ||
    directFacts.length === 0
  ) {
    return [];
  }
  const premiseFactIds = directFacts.map((fact) => fact.factId);
  return [
    createFactRecordV1({
      factFamilyId: obligation.factFamilyId,
      canonicalSubjectRef: obligation.canonicalSubjectRef,
      primaryScale: obligation.analysisScale,
      sourceRevisionVectorHash: artifact.sourceVectorHash,
      value: {
        backend: 'strict-multiscale-aggregate-v1',
        analysisScale: obligation.analysisScale,
        premiseFactIds,
      },
      witnesses: [
        {
          kind: 'derived',
          derivationRuleId: `strict-${obligation.analysisScale}-aggregate-v1`,
          orderedPremiseFactIds: premiseFactIds,
          sourceRevisionVectorHash: artifact.sourceVectorHash,
        },
      ],
    }),
  ];
}

function finalizeStrictFileExecutions(
  executions: readonly StrictFactFileExecutionV1[],
  facts: readonly FactRecordV1[]
): StrictFactFileExecutionV1[] {
  const finalFactIds = new Set(facts.map((fact) => fact.factId));
  return executions.map((execution) => {
    const emittedFactIds = execution.stagedFactIds.filter((factId) => finalFactIds.has(factId));
    const discardedFactIds = execution.stagedFactIds.filter((factId) => !finalFactIds.has(factId));
    const semantic = {
      repoId: execution.repoId,
      relativePath: execution.relativePath,
      blobHash: execution.blobHash,
      status: execution.status,
      reasonCode: execution.reasonCode,
      truncated: execution.truncated,
      continuation: execution.continuation,
      witnessBindingHash: execution.witnessBindingHash,
      evidenceEntryId: execution.evidenceEntryId,
      projectContextRefId: execution.projectContextRefId,
      stagedFactIds: execution.stagedFactIds,
      discardedFactIds,
      emittedFactIds,
    };
    return freezeDeep({ ...semantic, executionHash: hashCanonicalJson(semantic) });
  });
}

function createStrictFactScheduleResult(
  input: StrictFactScheduleExecutionInputV1,
  state: StrictFactExecutionStateV1,
  acceptedFacts: readonly FactRecordV1[],
  receipts: readonly FactQueryExecutionReceiptV1[]
): StrictFactScheduleExecutionResultV1 {
  const facts = uniqueFacts(acceptedFacts).sort((left, right) =>
    left.factId.localeCompare(right.factId)
  );
  validateFactRecordGraphV1(facts);
  const orderedReceipts = [...receipts].sort((left, right) =>
    left.obligationId.localeCompare(right.obligationId)
  );
  const failedObligationIds = obligationIdsByDisposition(orderedReceipts, 'failed');
  const unknownObligationIds = obligationIdsByDisposition(orderedReceipts, 'unknown');
  const terminalReceiptHashes = orderedReceipts.map((receipt) => receipt.receiptHash);
  const harvestReceiptHashes = uniqueSorted(
    orderedReceipts.map((receipt) => receipt.harvestReceiptHash)
  );
  const denominatorHashes = uniqueSorted(orderedReceipts.map((receipt) => receipt.denominatorHash));
  const unexecutableCatalogFamilyIds = input.catalog.families
    .filter((family) => {
      const backend = state.backends.get(family.id);
      return !backend || !sameBackendIdentity(family, backend);
    })
    .map((family) => family.id)
    .sort();
  const catalogFamilyIds = new Set(input.catalog.families.map((family) => family.id));
  const unregisteredBackendFamilyIds = input.registry.backends
    .filter((backend) => !catalogFamilyIds.has(backend.id))
    .map((backend) => backend.id)
    .sort();
  const manifestSemantic = {
    schemaVersion: 1 as const,
    sourceArtifactId: input.artifact.artifactId,
    sourceRevisionVectorHash: input.artifact.sourceVectorHash,
    factQueryCatalogHash: input.catalog.catalogHash,
    factHarvestScheduleHash: input.schedule.factHarvestScheduleHash,
    backendRegistryHash: input.registry.registryHash,
    obligationCount: input.schedule.factHarvestObligations.length,
    terminalReceiptIds: orderedReceipts.map((receipt) => receipt.terminalReceiptId),
    terminalReceiptHashes,
    terminalReceiptSetHash: hashCanonicalJson(terminalReceiptHashes),
    harvestReceiptHashes,
    harvestCount: harvestReceiptHashes.length,
    denominatorHashes,
    witnessBindingSetHash: hashCanonicalJson(
      orderedReceipts.map((receipt) => receipt.witnessBindingHash).sort()
    ),
    factIds: facts.map((fact) => fact.factId),
    factCount: facts.length,
    unexecutableCatalogFamilyIds,
    unregisteredBackendFamilyIds,
    failedObligationIds,
    unknownObligationIds,
    verdict: strictFactManifestVerdict(
      input,
      orderedReceipts,
      failedObligationIds,
      unknownObligationIds,
      unexecutableCatalogFamilyIds,
      unregisteredBackendFamilyIds
    ),
  };
  const result = freezeDeep({
    facts,
    receipts: orderedReceipts,
    manifest: { ...manifestSemantic, manifestHash: hashCanonicalJson(manifestSemantic) },
  });
  assertCodeFactGenerationManifestV1(result);
  return result;
}

function obligationIdsByDisposition(
  receipts: readonly FactQueryExecutionReceiptV1[],
  disposition: FactQueryExecutionReceiptV1['disposition']
): string[] {
  return receipts
    .filter((receipt) => receipt.disposition === disposition)
    .map((receipt) => receipt.obligationId);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function strictFactManifestVerdict(
  input: StrictFactScheduleExecutionInputV1,
  receipts: readonly FactQueryExecutionReceiptV1[],
  failed: readonly string[],
  unknown: readonly string[],
  unexecutable: readonly string[],
  unregistered: readonly string[]
): CodeFactGenerationManifestV1['verdict'] {
  return failed.length === 0 &&
    unknown.length === 0 &&
    unexecutable.length === 0 &&
    unregistered.length === 0 &&
    receipts.length === input.schedule.factHarvestObligations.length
    ? 'passed'
    : 'failed';
}

function createStrictFactHarvestKey(
  artifact: CertifiedProjectFactsArtifactV1,
  family: FactQueryFamilyV1,
  binding: StrictFactSubjectBindingV1,
  obligation: FactHarvestObligationV1
): string {
  return hashCanonicalJson({
    schemaVersion: 1,
    sourceRevisionVectorHash: artifact.sourceVectorHash,
    factFamilyId: family.id,
    capabilityId: obligation.capabilityId,
    canonicalSubjectRef: obligation.canonicalSubjectRef,
    subjectBindingHash: binding.bindingHash,
    denominatorHash: binding.denominatorHash,
    backendLoadReceiptHash: family.loadReceiptHash,
    queryPackHash: family.queryPackHash,
  });
}

interface StrictDirectFactHarvestInputV1 {
  readonly artifact: CertifiedProjectFactsArtifactV1;
  readonly obligation: FactHarvestObligationV1;
  readonly family: FactQueryFamilyV1;
  readonly backend: StrictFactQueryBackendV1;
  readonly binding: StrictFactSubjectBindingV1;
  readonly files: readonly ProjectFactsInventoryFileV1[];
  readonly witnessBindings: ReadonlyMap<string, StrictFactDirectWitnessBindingV1>;
  readonly witnessAuthority: StrictFactWitnessAuthorityPortV1;
  readonly perFileTimeoutMs: number;
}

async function executeStrictDirectFactHarvest(
  input: StrictDirectFactHarvestInputV1
): Promise<StrictFactHarvestExecutionV1> {
  const harvestKey = createStrictFactHarvestKey(
    input.artifact,
    input.family,
    input.binding,
    input.obligation
  );
  const stagedFacts: FactRecordV1[] = [];
  const fileExecutions: StrictFactFileExecutionV1[] = [];
  let terminalStatus: 'complete' | 'failed' | 'unknown' = 'complete';
  let terminalReason = 'COMPLETE_FROZEN_SUBJECT_INSPECTED';

  for (const file of input.files) {
    const { execution, facts, receipt } = await executeStrictFactFile(input, file);
    if (execution.status === 'complete') {
      stagedFacts.push(...facts);
    } else if (execution.status === 'failed') {
      terminalStatus = 'failed';
      terminalReason = execution.reasonCode;
    } else if (terminalStatus !== 'failed') {
      terminalStatus = 'unknown';
      terminalReason = execution.reasonCode;
    }
    fileExecutions.push(receipt);
  }

  const orderedStagedFacts = uniqueFacts(stagedFacts).sort((left, right) =>
    left.factId.localeCompare(right.factId)
  );
  const harvestSemantic = {
    schemaVersion: 1 as const,
    harvestKey,
    fileExecutions,
    stagedFactIds: orderedStagedFacts.map((fact) => fact.factId),
    terminalStatus,
    terminalReason,
  };
  return freezeDeep({
    harvestKey,
    harvestReceiptHash: hashCanonicalJson(harvestSemantic),
    stagedFacts: orderedStagedFacts,
    fileExecutions,
    terminalStatus,
    terminalReason,
  });
}

async function executeStrictFactFile(
  input: StrictDirectFactHarvestInputV1,
  file: ProjectFactsInventoryFileV1
): Promise<{
  readonly execution: StrictFactBackendFileResultV1;
  readonly facts: readonly FactRecordV1[];
  readonly receipt: StrictFactFileExecutionV1;
}> {
  const bytes = readCertifiedProjectFactsFrozenFile(input.artifact, file);
  const contentText = Buffer.from(bytes).toString('utf8');
  const witnessBinding = input.witnessBindings.get(`${file.repoId}\u0000${file.relativePath}`);
  let execution: StrictFactBackendFileResultV1;
  let facts: FactRecordV1[] = [];
  try {
    if (!witnessBinding) {
      throw new Error('FACT_WITNESS_BINDING_UNAVAILABLE');
    }
    await assertResolvedWitnessAuthority(input, witnessBinding);
    assertWitnessBinding(input.artifact, file, witnessBinding);
    execution = normalizeBackendResult(
      await executeBackendWithDeadline(
        input.backend,
        {
          artifact: input.artifact,
          obligation: input.obligation,
          file: {
            repoId: file.repoId,
            relativePath: file.relativePath,
            language: file.language,
            blobHash: file.blobSha256,
            byteLength: bytes.byteLength,
          },
          content: bytes,
          contentText,
        },
        input.perFileTimeoutMs
      ),
      file.blobSha256
    );
    facts =
      execution.status === 'complete'
        ? createStrictDirectFacts(input, file, witnessBinding, execution.facts, contentText)
        : [];
  } catch (error: unknown) {
    execution = failedFactFileExecution(file, error);
    facts = [];
  }
  return {
    execution,
    facts,
    receipt: createStrictFactFileExecutionReceipt(file, witnessBinding, execution, facts),
  };
}

async function assertResolvedWitnessAuthority(
  input: StrictDirectFactHarvestInputV1,
  binding: StrictFactDirectWitnessBindingV1
): Promise<void> {
  const [entry, ref] = await Promise.all([
    input.witnessAuthority.resolveEvidenceEntry({
      evidenceSessionId: binding.evidenceSessionId,
      evidenceEntryId: binding.evidenceEntryId,
      evidenceLedgerSnapshotHash: binding.evidenceLedgerSnapshotHash,
    }),
    input.witnessAuthority.resolveProjectContextRef({
      sourceArtifactId: input.artifact.artifactId,
      projectContextRefId: binding.projectContextRefId,
    }),
  ]);
  if (
    !entry ||
    !ref ||
    hashCanonicalJson(entry) !== binding.evidenceEntryHash ||
    hashCanonicalJson(ref) !== binding.projectContextRefHash
  ) {
    throw new Error('FACT_WITNESS_AUTHORITY_UNRESOLVED');
  }
}

function createStrictDirectFacts(
  input: StrictDirectFactHarvestInputV1,
  file: ProjectFactsInventoryFileV1,
  binding: StrictFactDirectWitnessBindingV1,
  candidates: readonly StrictFactBackendCandidateV1[],
  contentText: string
): FactRecordV1[] {
  // 已验收的 ProjectContextRef.id 是本 revision 的 canonical subject；不得在 Main/Core
  // 交界重新拼接一个缺 blob identity 的近似字符串。
  const canonicalFileSubjectRef = binding.projectContextRefId;
  const facts = candidates.map((candidate) => {
    assertCandidateRange(candidate, contentText);
    return createFactRecordV1({
      factFamilyId: input.obligation.factFamilyId,
      canonicalSubjectRef: canonicalFileSubjectRef,
      primaryScale: 'file',
      sourceRevisionVectorHash: input.artifact.sourceVectorHash,
      value: candidate.value,
      witnesses: [
        {
          kind: 'direct',
          evidenceEntryId: binding.evidenceEntryId,
          evidenceSessionId: binding.evidenceSessionId,
          evidenceContentHash: binding.evidenceContentHash,
          sourceRevisionVectorHash: input.artifact.sourceVectorHash,
          projectContextRefId: binding.projectContextRefId,
          projectContextRefHash: binding.projectContextRefHash,
          canonicalSubjectRef: canonicalFileSubjectRef,
          anchor: {
            relativePath: file.relativePath,
            blobHash: file.blobSha256,
            ...(candidate.range ? { range: candidate.range } : {}),
          },
        },
      ],
    });
  });
  if (new Set(facts.map((fact) => fact.factId)).size !== facts.length) {
    throw new Error('FACT_BACKEND_DUPLICATE_CANDIDATE');
  }
  return facts;
}

function failedFactFileExecution(
  file: ProjectFactsInventoryFileV1,
  error: unknown
): StrictFactBackendFileResultV1 {
  const message = error instanceof Error ? error.message : '';
  const reasonCode =
    message === 'FACT_BACKEND_EXECUTION_TIMEOUT'
      ? message
      : message.startsWith('FACT_')
        ? message
        : 'FACT_BACKEND_EXECUTION_ERROR';
  return {
    status: 'failed',
    reasonCode,
    facts: [],
    inspectedBlobHash: file.blobSha256,
    truncated: false,
    continuation: null,
  };
}

function createStrictFactFileExecutionReceipt(
  file: ProjectFactsInventoryFileV1,
  binding: StrictFactDirectWitnessBindingV1 | undefined,
  execution: StrictFactBackendFileResultV1,
  facts: readonly FactRecordV1[]
): StrictFactFileExecutionV1 {
  const semantic = {
    repoId: file.repoId,
    relativePath: file.relativePath,
    blobHash: file.blobSha256,
    status: execution.status,
    reasonCode: execution.reasonCode,
    truncated: execution.truncated,
    continuation: execution.continuation,
    witnessBindingHash: binding?.bindingHash ?? null,
    evidenceEntryId: binding?.evidenceEntryId ?? null,
    projectContextRefId: binding?.projectContextRefId ?? null,
    stagedFactIds: facts.map((fact) => fact.factId).sort(),
    discardedFactIds: [],
    emittedFactIds: [],
  };
  return { ...semantic, executionHash: hashCanonicalJson(semantic) };
}

export function assertCodeFactGenerationManifestV1(
  result: StrictFactScheduleExecutionResultV1
): void {
  validateFactRecordGraphV1(result.facts);
  assertFactExecutionReceipts(result.receipts);
  assertHarvestReceiptConservation(result.receipts);
  const receiptHashes = result.receipts.map((receipt) => receipt.receiptHash);
  const harvestReceiptHashes = uniqueSorted(
    result.receipts.map((receipt) => receipt.harvestReceiptHash)
  );
  const terminalReceiptIds = result.receipts.map((receipt) => receipt.terminalReceiptId);
  const factIds = result.facts.map((fact) => fact.factId);
  const emittedUnion = uniqueSorted(result.receipts.flatMap((receipt) => receipt.emittedFactIds));
  const failedObligationIds = obligationIdsByDisposition(result.receipts, 'failed');
  const unknownObligationIds = obligationIdsByDisposition(result.receipts, 'unknown');
  const { manifestHash, ...manifestSemantic } = result.manifest;
  const invalid = [
    new Set(result.receipts.map((receipt) => receipt.obligationId)).size !== result.receipts.length,
    hashCanonicalJson(receiptHashes) !== result.manifest.terminalReceiptSetHash,
    !sameStrings(harvestReceiptHashes, result.manifest.harvestReceiptHashes),
    result.manifest.harvestCount !== harvestReceiptHashes.length,
    hashCanonicalJson(result.receipts.map((receipt) => receipt.witnessBindingHash).sort()) !==
      result.manifest.witnessBindingSetHash,
    !sameStrings(
      uniqueSorted(result.receipts.map((receipt) => receipt.denominatorHash)),
      result.manifest.denominatorHashes
    ),
    !sameStrings(receiptHashes, result.manifest.terminalReceiptHashes),
    !sameStrings(terminalReceiptIds, result.manifest.terminalReceiptIds),
    !sameStrings(factIds, result.manifest.factIds),
    !sameStrings(emittedUnion, factIds),
    result.manifest.factCount !== factIds.length,
    !sameStrings(failedObligationIds, result.manifest.failedObligationIds),
    !sameStrings(unknownObligationIds, result.manifest.unknownObligationIds),
    result.manifest.verdict !== expectedStrictFactManifestVerdict(result),
    hashCanonicalJson(manifestSemantic) !== manifestHash,
    result.receipts.some((receipt) => invalidReceiptFactConservation(receipt, factIds)),
  ];
  if (invalid.some(Boolean)) {
    throw new Error('STRICT_FACT_GENERATION_MANIFEST_INVALID');
  }
}

function assertFactExecutionReceipts(receipts: readonly FactQueryExecutionReceiptV1[]): void {
  for (const receipt of receipts) {
    try {
      assertFactQueryExecutionReceiptV1(receipt);
    } catch {
      throw new Error('STRICT_FACT_GENERATION_MANIFEST_INVALID');
    }
  }
}

function assertHarvestReceiptConservation(receipts: readonly FactQueryExecutionReceiptV1[]): void {
  const harvestByKey = new Map<string, string>();
  for (const receipt of receipts) {
    const existing = harvestByKey.get(receipt.harvestKey);
    if (existing && existing !== receipt.harvestReceiptHash) {
      throw new Error('STRICT_FACT_GENERATION_MANIFEST_INVALID');
    }
    harvestByKey.set(receipt.harvestKey, receipt.harvestReceiptHash);
  }
}

function expectedStrictFactManifestVerdict(
  result: StrictFactScheduleExecutionResultV1
): CodeFactGenerationManifestV1['verdict'] {
  const terminal =
    result.manifest.failedObligationIds.length === 0 &&
    result.manifest.unknownObligationIds.length === 0 &&
    result.manifest.unexecutableCatalogFamilyIds.length === 0 &&
    result.manifest.unregisteredBackendFamilyIds.length === 0 &&
    result.receipts.length === result.manifest.obligationCount;
  return terminal ? 'passed' : 'failed';
}

function invalidReceiptFactConservation(
  receipt: FactQueryExecutionReceiptV1,
  factIds: readonly string[]
): boolean {
  const emitted = uniqueSorted([
    ...receipt.fileExecutions.flatMap((execution) => execution.emittedFactIds),
    ...receipt.derivedFactIds,
  ]);
  return [
    receipt.expectedFileCount !== receipt.denominatorFileIds.length,
    receipt.inspectedFileCount !== receipt.fileExecutions.length,
    hashCanonicalJson(receipt.denominatorFileIds) !== receipt.denominatorHash,
    !sameStrings(receipt.emittedFactIds, emitted),
    receipt.emittedFactIds.some((factId) => !factIds.includes(factId)),
  ].some(Boolean);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createAstFactQueryBackendV1(input: {
  readonly family: FactQueryFamilyV1;
  readonly queryPack: StrictAstFactQueryPackV1;
}): StrictFactQueryBackendV1 {
  const expectedFamily = createAstFactQueryFamilyV1({
    queryPack: input.queryPack,
    supportedScales: input.family.supportedScales,
  });
  assertExactDerivedBackendFamily(input.family, expectedFamily);
  assertBackendFamilyAuthority(input.family, 'ast', AST_BACKEND_PRODUCER, 'tree-sitter-query');
  let grammarLoad: Promise<void> | null = null;
  let fixtureVerification: Promise<void> | null = null;
  return createAuthorizedBackend(
    input.family,
    {
      kind: 'ast',
      queryPackHash: input.queryPack.queryPackHash,
      configurationHash: hashCanonicalJson({
        grammar: 'core-ast-runtime',
        extractorId: input.queryPack.extractorId,
      }),
    },
    {
      ...copyFamily(input.family),
      executeFile: async (context: StrictFactBackendExecutionContextV1) => {
        const language = resolveAstParserLanguage(context.file.relativePath, context.file.language);
        if (!language) {
          return {
            status: 'unknown' as const,
            reasonCode: 'AST_LANGUAGE_UNSUPPORTED',
            facts: [],
            inspectedBlobHash: context.file.blobHash,
            truncated: false,
            continuation: null,
          };
        }
        grammarLoad ??= reloadProjectAstPlugins().then(() => undefined);
        await grammarLoad;
        fixtureVerification ??= verifyAstBackendFixtures(input.queryPack);
        await fixtureVerification;
        const summary = analyzeSourceFile(context.contentText, language);
        if (!summary) {
          return {
            status: 'failed' as const,
            reasonCode: 'AST_PARSER_UNAVAILABLE',
            facts: [],
            inspectedBlobHash: context.file.blobHash,
            truncated: false,
            continuation: null,
          };
        }
        const facts = extractAstQueryCandidates(
          summary,
          input.queryPack,
          context.contentText.split('\n').length
        );
        return {
          status: 'complete' as const,
          reasonCode: 'AST_ANALYSIS_COMPLETE',
          facts: facts.map((fact) => ({
            ...fact,
            value: {
              backend: 'strict-ast-fact-backend-v1',
              language,
              queryId: input.queryPack.queryId,
              queryVersion: input.queryPack.queryVersion,
              occurrence: fact.value,
            },
          })),
          inspectedBlobHash: context.file.blobHash,
          truncated: false,
          continuation: null,
        };
      },
    }
  );
}

export function createProjectContextFactQueryBackendV1(input: {
  readonly family: FactQueryFamilyV1;
  readonly requestKinds?: readonly ProjectContextRequestKind[];
}): StrictFactQueryBackendV1 {
  const expectedFamily = createProjectContextFactQueryFamilyV1({
    familyId: input.family.id,
    supportedScales: input.family.supportedScales,
    requestKinds: input.requestKinds,
  });
  assertExactDerivedBackendFamily(input.family, expectedFamily);
  assertBackendFamilyAuthority(
    input.family,
    'project-context',
    PROJECT_CONTEXT_BACKEND_PRODUCER,
    'project-context-query'
  );
  const acceptedKinds = input.requestKinds ? new Set(input.requestKinds) : null;
  return createAuthorizedBackend(
    input.family,
    {
      kind: 'project-context',
      queryPackHash: input.family.queryPackHash!,
      configurationHash: hashCanonicalJson({
        requestKinds: input.requestKinds ? [...input.requestKinds].sort() : ['*'],
      }),
    },
    {
      ...copyFamily(input.family),
      executeFile: async (context: StrictFactBackendExecutionContextV1) => {
        const outcomes = context.artifact.facts.requestOutcomes
          .filter(
            (outcome) =>
              (!acceptedKinds || acceptedKinds.has(outcome.kind)) &&
              outcome.sourceRanges.some(
                (range) =>
                  range.repoId === context.file.repoId &&
                  range.relativePath === context.file.relativePath
              )
          )
          .sort(
            (left, right) =>
              left.kind.localeCompare(right.kind) || left.outputHash.localeCompare(right.outputHash)
          );
        if (outcomes.some((outcome) => outcome.continuation)) {
          return {
            status: 'failed' as const,
            reasonCode: 'PROJECT_CONTEXT_OUTCOME_TRUNCATED',
            facts: [],
            inspectedBlobHash: context.file.blobHash,
            truncated: true,
            continuation: outcomes.find((outcome) => outcome.continuation)?.continuation ?? null,
          };
        }
        const nonterminal = outcomes.find((outcome) => outcome.terminalStatus !== 'completed');
        if (nonterminal) {
          return {
            status:
              nonterminal.terminalStatus === 'failed' ||
              nonterminal.terminalStatus === 'unavailable'
                ? ('failed' as const)
                : ('unknown' as const),
            reasonCode: `PROJECT_CONTEXT_${nonterminal.terminalStatus.toUpperCase()}`,
            facts: [],
            inspectedBlobHash: context.file.blobHash,
            truncated: false,
            continuation: null,
          };
        }
        if (outcomes.length === 0) {
          return {
            status: 'unknown' as const,
            reasonCode: 'PROJECT_CONTEXT_OUTCOME_BINDING_MISSING',
            facts: [],
            inspectedBlobHash: context.file.blobHash,
            truncated: false,
            continuation: null,
          };
        }
        return {
          status: 'complete' as const,
          reasonCode: 'PROJECT_CONTEXT_OUTCOMES_COMPLETE',
          facts: outcomes.map((outcome) => {
            const range = outcome.sourceRanges.find(
              (candidate) =>
                candidate.repoId === context.file.repoId &&
                candidate.relativePath === context.file.relativePath
            );
            return {
              ...(range ? { range: { startLine: range.startLine, endLine: range.endLine } } : {}),
              value: {
                backend: 'strict-project-context-fact-backend-v1',
                requestKind: outcome.kind,
                outputHash: outcome.outputHash,
                output: outcome.output,
              },
            };
          }),
          inspectedBlobHash: context.file.blobHash,
          truncated: false,
          continuation: null,
        };
      },
    }
  );
}

export type StrictConfigParserIdV1 =
  | 'nx-project-json'
  | 'react-native-package-json'
  | 'flutter-plugins-dependencies-json';

export function createConfigFactQueryBackendV1(input: {
  readonly family: FactQueryFamilyV1;
  readonly parser: StrictConfigParserIdV1;
}): StrictFactQueryBackendV1 {
  const expectedFamily = createConfigFactQueryFamilyV1({
    familyId: input.family.id,
    supportedScales: input.family.supportedScales,
    parser: input.parser,
  });
  assertExactDerivedBackendFamily(input.family, expectedFamily);
  verifyConfigBackendFixtures(input.parser);
  assertBackendFamilyAuthority(input.family, 'config', CONFIG_BACKEND_PRODUCER, 'config-parser');
  return createAuthorizedBackend(
    input.family,
    {
      kind: 'config',
      queryPackHash: input.family.queryPackHash!,
      configurationHash: hashCanonicalJson({ parser: input.parser }),
    },
    {
      ...copyFamily(input.family),
      executeFile: async (context: StrictFactBackendExecutionContextV1) => {
        if (!configParserApplies(input.parser, context.file.relativePath)) {
          return {
            status: 'complete' as const,
            reasonCode: 'CONFIG_PARSER_NOT_APPLICABLE',
            facts: [],
            inspectedBlobHash: context.file.blobHash,
            truncated: false,
            continuation: null,
          };
        }
        try {
          // 现有 parser 为兼容普通发现流程会吞 JSON 错误；严格适配器先做语法门，禁止空结果伪装成功。
          JSON.parse(context.contentText);
          const parsed = parseConfigWithStrictParser(input.parser, context.contentText);
          return {
            status: 'complete' as const,
            reasonCode: 'CONFIG_PARSE_COMPLETE',
            facts: [
              {
                range: {
                  startLine: 1,
                  endLine: Math.max(1, context.contentText.split('\n').length),
                },
                value: {
                  backend: 'strict-config-fact-backend-v1',
                  parser: input.parser,
                  parsed,
                },
              },
            ],
            inspectedBlobHash: context.file.blobHash,
            truncated: false,
            continuation: null,
          };
        } catch (_error: unknown) {
          return {
            status: 'failed' as const,
            reasonCode: 'CONFIG_PARSE_FAILED',
            facts: [],
            inspectedBlobHash: context.file.blobHash,
            truncated: false,
            continuation: null,
          };
        }
      },
    }
  );
}

function verifyStrictFactExecutionInputs(input: StrictFactScheduleExecutionInputV1): void {
  verifyCertifiedProjectFactsArtifact(input.artifact);
  assertPlanningFactsAuthority(input.artifact, input.planningFacts);
  assertStrictFrozenArtifact(input.artifact);
  assertStrictFactCatalog(input.catalog);
  assertStrictFactSchedule(input.schedule);
  assertStrictFactExecutionAuthorities(input);
}

function assertStrictFrozenArtifact(artifact: CertifiedProjectFactsArtifactV1): void {
  const invalid = [
    artifact.readiness.verdict !== 'passed',
    !artifact.manifest.projectScopeManifest,
    !artifact.manifest.requestMatrixHash,
    !artifact.manifest.frozenFileManifestHash,
    !artifact.facts.detail.frozenFiles,
    artifact.facts.detail.frozenFiles?.length !== artifact.facts.inventory.files.length,
  ];
  if (invalid.some(Boolean)) {
    throw new Error('STRICT_FACT_FROZEN_ARTIFACT_REQUIRED');
  }
}

function assertStrictFactCatalog(catalog: FactQueryCatalogSnapshotV1): void {
  if (
    catalog.schemaVersion !== 1 ||
    buildFactQueryCatalogSnapshot(catalog.families).catalogHash !== catalog.catalogHash
  ) {
    throw new Error('STRICT_FACT_QUERY_CATALOG_DRIFT');
  }
}

function assertStrictFactSchedule(schedule: MiningWorkScheduleV1): void {
  const scheduleDrift = [
    hashCanonicalJson(schedule.factHarvestObligations) !== schedule.factHarvestScheduleHash,
    hashCanonicalJson(schedule.lensBindings) !== schedule.lensBindingsHash,
    hashCanonicalJson({
      factHarvestScheduleHash: schedule.factHarvestScheduleHash,
      lensBindingsHash: schedule.lensBindingsHash,
    }) !== schedule.baselineScheduleHash,
  ];
  if (scheduleDrift.some(Boolean)) {
    throw new Error('STRICT_FACT_SCHEDULE_DRIFT');
  }
  const obligationIds = schedule.factHarvestObligations.map((row) => row.obligationId);
  if (
    new Set(obligationIds).size !== obligationIds.length ||
    schedule.factHarvestObligations.some(hasInvalidObligationId)
  ) {
    throw new Error('STRICT_FACT_SCHEDULE_DUPLICATE_OBLIGATION');
  }
}

function hasInvalidObligationId(row: FactHarvestObligationV1): boolean {
  const identity = {
    factFamilyId: row.factFamilyId,
    capabilityId: row.capabilityId,
    canonicalSubjectRef: row.canonicalSubjectRef,
    analysisScale: row.analysisScale,
    denominator: row.denominator,
  };
  return row.obligationId !== `fact:${hashCanonicalJson(identity).slice(7, 31)}`;
}

function assertStrictFactExecutionAuthorities(input: StrictFactScheduleExecutionInputV1): void {
  const subjectRefs = input.subjectBindings.map((binding) => binding.canonicalSubjectRef);
  const witnessKeys = input.witnessBindings.map(
    (binding) => `${binding.repoId}\u0000${binding.relativePath}`
  );
  const backendIds = input.registry.backends.map((backend) => backend.id);
  const witnessAuthority = STRICT_FACT_WITNESS_AUTHORITIES.get(input.witnessAuthority);
  const invalid = [
    new Set(subjectRefs).size !== subjectRefs.length,
    input.subjectBindings.some((binding) => invalidSubjectBinding(input, binding)),
    new Set(witnessKeys).size !== witnessKeys.length,
    input.witnessBindings.some(invalidWitnessBinding),
    input.registry.schemaVersion !== 1,
    !witnessAuthority,
    witnessAuthority?.sourceArtifactId !== input.artifact.artifactId,
    witnessAuthority?.sourceRevisionVectorHash !== input.artifact.sourceVectorHash,
    typeof input.witnessAuthority?.resolveEvidenceEntry !== 'function',
    typeof input.witnessAuthority?.resolveProjectContextRef !== 'function',
    input.registry.backends.some((backend) => !STRICT_FACT_BACKEND_AUTHORITIES.has(backend)),
    JSON.stringify(backendIds) !== JSON.stringify([...backendIds].sort()),
    new Set(backendIds).size !== backendIds.length,
    hashCanonicalJson(input.registry.backends.map(projectRegisteredBackend)) !==
      input.registry.registryHash,
    invalidTimeout(input.perFileTimeoutMs),
  ];
  if (invalid.some(Boolean)) {
    throw new Error('STRICT_FACT_EXECUTION_AUTHORITY_DRIFT');
  }
}

function invalidSubjectBinding(
  input: StrictFactScheduleExecutionInputV1,
  binding: StrictFactSubjectBindingV1
): boolean {
  try {
    const { bindingHash, ...semantic } = binding;
    const rebuilt = createStrictFactSubjectBindingV1({
      artifact: input.artifact,
      planningFacts: input.planningFacts,
      selector: binding.selector,
    });
    return hashCanonicalJson(semantic) !== bindingHash || rebuilt.bindingHash !== bindingHash;
  } catch {
    return true;
  }
}

function invalidWitnessBinding(binding: StrictFactDirectWitnessBindingV1): boolean {
  try {
    const { bindingHash, ...semantic } = binding;
    return hashCanonicalJson(semantic) !== bindingHash;
  } catch {
    return true;
  }
}

function invalidTimeout(timeoutMs: number | undefined): boolean {
  return timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1);
}

function selectCompleteSubjectFiles(
  artifact: CertifiedProjectFactsArtifactV1,
  binding: StrictFactSubjectBindingV1
): ProjectFactsInventoryFileV1[] {
  const files = selectFilesForSelector(artifact, binding.selector);
  if (
    files.length === 0 ||
    hashCanonicalJson(files.map(projectFile)) !== binding.denominatorHash ||
    hashCanonicalJson(binding.eligibleFiles) !== binding.denominatorHash
  ) {
    throw new Error('STRICT_FACT_SUBJECT_DENOMINATOR_MISMATCH');
  }
  for (const file of files) {
    const frozen = artifact.facts.detail.frozenFiles?.find(
      (candidate) =>
        candidate.repoId === file.repoId && candidate.relativePath === file.relativePath
    );
    if (!frozen || frozen.blobHash !== file.blobSha256) {
      throw new Error('STRICT_FACT_FROZEN_SUBJECT_MISMATCH');
    }
  }
  return files;
}

function normalizeBackendResult(
  result: StrictFactBackendFileResultV1,
  expectedBlobHash: string
): StrictFactBackendFileResultV1 {
  if (
    !['complete', 'failed', 'unknown'].includes(result.status) ||
    !result.reasonCode?.trim() ||
    !Array.isArray(result.facts) ||
    (result.status !== 'complete' && result.facts.length > 0) ||
    result.inspectedBlobHash !== expectedBlobHash ||
    typeof result.truncated !== 'boolean' ||
    (result.continuation !== null && !result.continuation.trim()) ||
    (result.status === 'complete' && (result.truncated || result.continuation !== null))
  ) {
    throw new Error('STRICT_FACT_BACKEND_RESULT_INVALID');
  }
  return {
    status: result.status,
    reasonCode: result.reasonCode.trim(),
    inspectedBlobHash: result.inspectedBlobHash,
    truncated: result.truncated,
    continuation: result.continuation,
    facts: result.facts.map((fact) => ({
      value: toProjectFactsJson(fact.value),
      ...(fact.range ? { range: { ...fact.range } } : {}),
    })),
  };
}

function createUnavailableReceipt(
  artifact: CertifiedProjectFactsArtifactV1,
  obligation: FactHarvestObligationV1,
  family: FactQueryFamilyV1 | undefined,
  binding: StrictFactSubjectBindingV1 | undefined,
  reasonCode: string
): FactQueryExecutionReceiptV1 {
  const harvestKey = hashCanonicalJson({
    schemaVersion: 1,
    sourceRevisionVectorHash: artifact.sourceVectorHash,
    factFamilyId: obligation.factFamilyId,
    capabilityId: obligation.capabilityId,
    canonicalSubjectRef: obligation.canonicalSubjectRef,
    bindingHash: binding?.bindingHash ?? null,
    queryPackHash: family?.queryPackHash ?? null,
  });
  return createExecutionReceipt({
    artifact,
    obligation,
    family,
    fileExecutions: [],
    derivedFactIds: [],
    emittedFactIds: [],
    terminalStatus: 'failed',
    terminalReason: reasonCode,
    binding,
    harvestKey,
    harvestReceiptHash: hashCanonicalJson({ harvestKey, reasonCode, status: 'unavailable' }),
    witnessBindingHash: hashCanonicalJson([]),
  });
}

function createExecutionReceipt(input: {
  artifact: CertifiedProjectFactsArtifactV1;
  obligation: FactHarvestObligationV1;
  family: FactQueryFamilyV1 | undefined;
  fileExecutions: readonly StrictFactFileExecutionV1[];
  derivedFactIds: readonly string[];
  emittedFactIds: readonly string[];
  terminalStatus: 'complete' | 'failed' | 'unknown';
  terminalReason: string;
  binding?: StrictFactSubjectBindingV1;
  harvestKey: string;
  harvestReceiptHash: string;
  witnessBindingHash: string;
}): FactQueryExecutionReceiptV1 {
  const denominatorFileIds =
    input.binding?.eligibleFiles.map(
      (file) => `${file.repoId}:${file.relativePath}@${file.blobHash}`
    ) ?? [];
  const expectedFileCount = denominatorFileIds.length;
  const disposition =
    input.terminalStatus === 'failed'
      ? ('failed' as const)
      : input.terminalStatus === 'unknown'
        ? ('unknown' as const)
        : input.emittedFactIds.length > 0
          ? ('matched' as const)
          : ('inspected-no-pattern' as const);
  const continuations = input.fileExecutions
    .flatMap((execution) => (execution.continuation ? [execution.continuation] : []))
    .sort();
  const semantic = {
    schemaVersion: 1 as const,
    obligationId: input.obligation.obligationId,
    factFamilyId: input.obligation.factFamilyId,
    capabilityId: input.obligation.capabilityId,
    canonicalSubjectRef: input.obligation.canonicalSubjectRef,
    analysisScale: input.obligation.analysisScale,
    denominator: 'complete-frozen-subject' as const,
    sourceRevisionVectorHash: input.artifact.sourceVectorHash,
    backendProducer: input.family?.loadedProducer ?? 'unavailable',
    backendManifestHash: input.family?.producerManifestHash ?? hashCanonicalJson(null),
    backendLoadReceiptHash: input.family?.loadReceiptHash ?? hashCanonicalJson(null),
    queryPackHash: input.family?.queryPackHash ?? hashCanonicalJson(null),
    harvestKey: input.harvestKey,
    harvestReceiptHash: input.harvestReceiptHash,
    expectedFileCount,
    inspectedFileCount: input.fileExecutions.length,
    denominatorFileIds,
    denominatorHash: hashCanonicalJson(denominatorFileIds),
    witnessBindingHash: input.witnessBindingHash,
    fileExecutions: [...input.fileExecutions],
    derivedFactIds: [...input.derivedFactIds].sort(),
    emittedFactIds: [...input.emittedFactIds].sort(),
    disposition,
    reasonCode: input.terminalReason,
    truncated: input.fileExecutions.some((execution) => execution.truncated),
    continuation: continuations.length > 0 ? JSON.stringify(continuations) : null,
  };
  const outputHash = hashCanonicalJson({
    obligationId: semantic.obligationId,
    denominatorHash: semantic.denominatorHash,
    fileExecutionHashes: semantic.fileExecutions.map((execution) => execution.executionHash),
    derivedFactIds: semantic.derivedFactIds,
    emittedFactIds: semantic.emittedFactIds,
    disposition: semantic.disposition,
    truncated: semantic.truncated,
    continuation: semantic.continuation,
  });
  const receiptHash = hashCanonicalJson({ ...semantic, outputHash });
  return freezeDeep({
    ...semantic,
    outputHash,
    terminalReceiptId: `fact-execution:${receiptHash.slice(7, 31)}`,
    receiptHash,
  });
}

function sameBackendIdentity(
  family: FactQueryFamilyV1,
  backend: StrictFactQueryBackendV1
): boolean {
  return (
    hashCanonicalJson(projectBackendIdentity(family)) ===
    hashCanonicalJson(projectBackendIdentity(backend))
  );
}

function projectRegisteredBackend(backend: StrictFactQueryBackendV1): ProjectFactsJson {
  const authority = STRICT_FACT_BACKEND_AUTHORITIES.get(backend);
  if (!authority) {
    throw new Error('STRICT_FACT_BACKEND_REGISTRY_INVALID');
  }
  return toProjectFactsJson({
    family: projectBackendIdentity(backend),
    runtimeAuthority: authority,
  });
}

function projectBackendIdentity(family: FactQueryFamilyV1): ProjectFactsJson {
  return toProjectFactsJson({
    id: family.id,
    capabilityId: family.capabilityId,
    queryPackHash: family.queryPackHash ?? null,
    supportedScales: [...family.supportedScales].sort(),
    loadedProducer: family.loadedProducer,
    producerManifestHash: family.producerManifestHash,
    loadReceiptHash: family.loadReceiptHash,
    positiveFixtureHash: family.positiveFixtureHash,
    negativeFixtureHash: family.negativeFixtureHash,
    edgeFixtureHash: family.edgeFixtureHash,
  });
}

function createAuthorizedBackend(
  family: FactQueryFamilyV1,
  authority: StrictFactBackendRuntimeAuthorityV1,
  backend: StrictFactQueryBackendV1
): StrictFactQueryBackendV1 {
  if (!/^sha256:[0-9a-f]{64}$/.test(authority.queryPackHash)) {
    throw new Error('STRICT_FACT_BACKEND_QUERY_PACK_INVALID');
  }
  if (family.queryPackHash !== authority.queryPackHash) {
    throw new Error('STRICT_FACT_BACKEND_QUERY_PACK_MISMATCH');
  }
  const authorized = freezeDeep({ ...backend });
  if (!sameBackendIdentity(family, authorized)) {
    throw new Error('STRICT_FACT_BACKEND_FAMILY_MISMATCH');
  }
  STRICT_FACT_BACKEND_AUTHORITIES.set(authorized, freezeDeep({ ...authority }));
  return authorized;
}

function createDerivedBackendFamily(input: {
  readonly id: string;
  readonly capabilityId: string;
  readonly supportedScales: readonly FactQueryFamilyV1['supportedScales'][number][];
  readonly loadedProducer: string;
  readonly queryPackHash: string;
  readonly backendKind: StrictFactBackendKindV1;
  readonly configuration: unknown;
  readonly fixtures: readonly [unknown, unknown, unknown];
}): FactQueryFamilyV1 {
  const id = input.id.trim();
  const supportedScales = [...new Set(input.supportedScales)].sort();
  if (!id || supportedScales.length === 0 || !/^sha256:[0-9a-f]{64}$/.test(input.queryPackHash)) {
    throw new Error('STRICT_FACT_BACKEND_FAMILY_AUTHORITY_INVALID');
  }
  const [positiveFixture, negativeFixture, edgeFixture] = input.fixtures;
  const positiveFixtureHash = hashCanonicalJson(positiveFixture);
  const negativeFixtureHash = hashCanonicalJson(negativeFixture);
  const edgeFixtureHash = hashCanonicalJson(edgeFixture);
  const configurationHash = hashCanonicalJson(input.configuration);
  const producerManifestHash = hashCanonicalJson({
    schemaVersion: 1,
    backendKind: input.backendKind,
    loadedProducer: input.loadedProducer,
    executorModule: 'service/production/StrictFactExecution',
    executorVersion: 1,
    runtimeModules:
      input.backendKind === 'ast'
        ? ['core/ast', 'project-context/shared/parserLanguage']
        : input.backendKind === 'project-context'
          ? ['project-context/foundation/certified-request-outcomes']
          : ['core/discovery/parsers/JsonConfigParser'],
    queryPackHash: input.queryPackHash,
    configurationHash,
    positiveFixtureHash,
    negativeFixtureHash,
    edgeFixtureHash,
  });
  const loadReceiptHash = hashCanonicalJson({
    schemaVersion: 1,
    authorization: 'core-factory-only',
    runtimeVerification:
      input.backendKind === 'ast'
        ? 'grammar-load-and-fixtures-before-first-file'
        : input.backendKind === 'config'
          ? 'fixtures-before-registry-admission'
          : 'certified-outcome-validation-per-file',
    producerManifestHash,
    queryPackHash: input.queryPackHash as CanonicalSha256,
    configurationHash,
    positiveFixtureHash,
    negativeFixtureHash,
    edgeFixtureHash,
  });
  return freezeDeep({
    id,
    capabilityId: input.capabilityId,
    supportedScales,
    loadedProducer: input.loadedProducer,
    queryPackHash: input.queryPackHash as CanonicalSha256,
    producerManifestHash,
    loadReceiptHash,
    positiveFixtureHash,
    negativeFixtureHash,
    edgeFixtureHash,
  });
}

function assertExactDerivedBackendFamily(
  actual: FactQueryFamilyV1,
  expected: FactQueryFamilyV1
): void {
  if (
    hashCanonicalJson(projectBackendIdentity(actual)) !==
    hashCanonicalJson(projectBackendIdentity(expected))
  ) {
    throw new Error('STRICT_FACT_BACKEND_FAMILY_AUTHORITY_INVALID');
  }
}

function assertStrictAstQueryPack(queryPack: StrictAstFactQueryPackV1): void {
  const { queryPackHash, ...semantic } = queryPack;
  if (
    queryPack.schemaVersion !== 1 ||
    queryPack.extractorId !== 'declarations-v1' ||
    hashCanonicalJson(semantic) !== queryPackHash
  ) {
    throw new Error('STRICT_FACT_QUERY_PACK_INVALID');
  }
}

function astFixtureDefinitions(): readonly [unknown, unknown, unknown] {
  return [
    {
      kind: 'positive',
      language: 'typescript',
      content: 'export class FixtureClass { run(): void {} }',
      expectation: 'one-or-more-declarations',
    },
    {
      kind: 'negative',
      language: 'typescript',
      content: 'export const fixtureValue = 1;',
      expectation: 'zero-declarations',
    },
    {
      kind: 'edge',
      language: 'typescript',
      content: 'export interface FixtureContract { run(): void }',
      expectation: 'one-or-more-declarations',
    },
  ];
}

async function verifyAstBackendFixtures(queryPack: StrictAstFactQueryPackV1): Promise<void> {
  assertStrictAstQueryPack(queryPack);
  const [positive, negative, edge] = astFixtureDefinitions() as readonly [
    { content: string; language: string },
    { content: string; language: string },
    { content: string; language: string },
  ];
  const positiveSummary = analyzeSourceFile(positive.content, positive.language);
  const negativeSummary = analyzeSourceFile(negative.content, negative.language);
  const edgeSummary = analyzeSourceFile(edge.content, edge.language);
  if (
    !positiveSummary ||
    !negativeSummary ||
    !edgeSummary ||
    extractAstQueryCandidates(positiveSummary, queryPack, 1).length === 0 ||
    extractAstQueryCandidates(negativeSummary, queryPack, 1).length !== 0 ||
    extractAstQueryCandidates(edgeSummary, queryPack, 1).length === 0
  ) {
    throw new Error('FACT_BACKEND_FIXTURE_VERIFICATION_FAILED');
  }
}

function extractAstQueryCandidates(
  summary: Record<string, unknown>,
  queryPack: StrictAstFactQueryPackV1,
  lineCount: number
): StrictFactBackendCandidateV1[] {
  assertStrictAstQueryPack(queryPack);
  const declarations = ['classes', 'protocols', 'categories', 'methods', 'properties']
    .flatMap((key) => {
      const rows = summary[key];
      return Array.isArray(rows)
        ? rows.map((row) => ({ occurrenceType: key.slice(0, -1), occurrence: row }))
        : [];
    })
    .map((row) => {
      const occurrence =
        row.occurrence && typeof row.occurrence === 'object'
          ? (row.occurrence as Record<string, unknown>)
          : null;
      const line = occurrence?.line;
      const sourceLine =
        typeof line === 'number' && Number.isSafeInteger(line) && line >= 1 && line <= lineCount
          ? line
          : 1;
      return {
        range: { startLine: sourceLine, endLine: sourceLine },
        value: row,
      };
    });
  return declarations.sort((left, right) =>
    hashCanonicalJson(left).localeCompare(hashCanonicalJson(right))
  );
}

function projectContextFixtureDefinitions(): readonly [unknown, unknown, unknown] {
  return [
    {
      kind: 'positive',
      outcome: { terminalStatus: 'completed', continuation: null, sourceRangeCount: 1 },
    },
    {
      kind: 'negative',
      outcome: { terminalStatus: 'completed', continuation: null, sourceRangeCount: 0 },
    },
    {
      kind: 'edge',
      outcome: { terminalStatus: 'partial', continuation: 'required', sourceRangeCount: 1 },
    },
  ];
}

function configFixtureDefinitions(
  parser: StrictConfigParserIdV1
): readonly [unknown, unknown, unknown] {
  const positiveContent =
    parser === 'nx-project-json'
      ? '{"name":"fixture","sourceRoot":"src","projectType":"library","targets":{}}'
      : parser === 'react-native-package-json'
        ? '{"name":"fixture","dependencies":{"react-native":"1.0.0"}}'
        : '{"info":"fixture","plugins":{}}';
  const positiveValue =
    parser === 'nx-project-json'
      ? {
          projects: [{ name: 'fixture', root: 'src', projectType: 'library', tags: [] }],
        }
      : parser === 'react-native-package-json'
        ? {
            isReactNative: true,
            name: 'fixture',
            rnVersion: '1.0.0',
            hasFabric: false,
            hasTurboModules: false,
          }
        : { plugins: [] };
  const edgeValue =
    parser === 'nx-project-json'
      ? { projects: [] }
      : parser === 'react-native-package-json'
        ? { isReactNative: false, name: '' }
        : { plugins: [] };
  return [
    {
      kind: 'positive',
      parser,
      content: positiveContent,
      expectedStatus: 'complete',
      expectedValue: positiveValue,
    },
    { kind: 'negative', parser, content: '{"invalid":', expectedStatus: 'failed' },
    {
      kind: 'edge',
      parser,
      content: '{}',
      expectedStatus: 'complete',
      expectedValue: edgeValue,
    },
  ];
}

function verifyConfigBackendFixtures(parser: StrictConfigParserIdV1): void {
  const [positive, negative, edge] = configFixtureDefinitions(parser) as readonly [
    { content: string; expectedValue: unknown },
    { content: string },
    { content: string; expectedValue: unknown },
  ];
  try {
    JSON.parse(positive.content);
    const positiveValue = parseConfigWithStrictParser(parser, positive.content);
    JSON.parse(edge.content);
    const edgeValue = parseConfigWithStrictParser(parser, edge.content);
    if (
      hashCanonicalJson(positiveValue) !== hashCanonicalJson(positive.expectedValue) ||
      hashCanonicalJson(edgeValue) !== hashCanonicalJson(edge.expectedValue)
    ) {
      throw new Error('STRICT_FACT_BACKEND_FIXTURE_VERIFICATION_FAILED');
    }
  } catch {
    throw new Error('STRICT_FACT_BACKEND_FIXTURE_VERIFICATION_FAILED');
  }
  try {
    JSON.parse(negative.content);
    throw new Error('STRICT_FACT_BACKEND_FIXTURE_VERIFICATION_FAILED');
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message === 'STRICT_FACT_BACKEND_FIXTURE_VERIFICATION_FAILED'
    ) {
      throw error;
    }
  }
}

function parseConfigWithStrictParser(parser: StrictConfigParserIdV1, content: string): unknown {
  return parser === 'nx-project-json'
    ? parseNxWorkspace(content)
    : parser === 'react-native-package-json'
      ? parseReactNativeProject(content)
      : parseFlutterPluginsDeps(content);
}

function assertBackendFamilyAuthority(
  family: FactQueryFamilyV1,
  kind: StrictFactBackendKindV1,
  expectedProducer: string,
  expectedCapability: string
): void {
  const allowedScales: Record<StrictFactBackendKindV1, ReadonlySet<string>> = {
    ast: new Set(['source-range', 'symbol', 'file', 'module', 'package', 'repository', 'project']),
    'project-context': new Set([
      'source-range',
      'symbol',
      'file',
      'module',
      'package',
      'repository',
      'project',
    ]),
    config: new Set(['file', 'module', 'package', 'repository']),
  };
  if (
    family.loadedProducer !== expectedProducer ||
    family.capabilityId !== expectedCapability ||
    !family.queryPackHash ||
    !/^sha256:[0-9a-f]{64}$/.test(family.queryPackHash) ||
    family.supportedScales.length === 0 ||
    family.supportedScales.some((scale) => !allowedScales[kind].has(scale)) ||
    [
      family.producerManifestHash,
      family.loadReceiptHash,
      family.positiveFixtureHash,
      family.negativeFixtureHash,
      family.edgeFixtureHash,
    ].some((hash) => !/^sha256:[0-9a-f]{64}$/.test(hash))
  ) {
    throw new Error('STRICT_FACT_BACKEND_FAMILY_AUTHORITY_INVALID');
  }
}

function copyFamily(family: FactQueryFamilyV1): FactQueryFamilyV1 {
  return {
    ...family,
    supportedScales: [...family.supportedScales],
  };
}

function selectorExistsInArtifact(
  artifact: CertifiedProjectFactsArtifactV1,
  selector: StrictFactSubjectSelectorV1
): boolean {
  const repositories = artifact.manifest.projectScopeManifest?.repositories ?? [];
  if (!repositories.some((repository) => repository.repoId === selector.repoId)) {
    return false;
  }
  return (
    selector.kind === 'repository' ||
    artifact.facts.inventory.files.some(
      (file) =>
        file.repoId === selector.repoId && file.ownerModuleIds.includes(selector.ownerModuleId)
    )
  );
}

function deriveCanonicalSubjectRef(
  artifact: CertifiedProjectFactsArtifactV1,
  planningFacts: CertifiedPlanningFactsV1,
  selector: StrictFactSubjectSelectorV1
): string {
  const repository = artifact.manifest.projectScopeManifest?.repositories.find(
    (candidate) => candidate.repoId === selector.repoId
  );
  if (!repository) {
    throw new Error('STRICT_FACT_SUBJECT_AUTHORITY_INVALID');
  }
  return selector.kind === 'repository'
    ? repository.scopeId
    : (planningFacts.modules.find((module) => module.moduleId === selector.ownerModuleId)
        ?.scopeId ?? '');
}

function assertPlanningFactsAuthority(
  artifact: CertifiedProjectFactsArtifactV1,
  planningFacts: CertifiedPlanningFactsV1
): void {
  const moduleIds = planningFacts.modules.map((module) => module.moduleId);
  const scopeIds = planningFacts.modules.map((module) => module.scopeId);
  if (
    planningFacts.schemaVersion !== 1 ||
    planningFacts.factsHash !== artifact.factsContentHash ||
    planningFacts.sourceRevisionVectorHash !== artifact.sourceVectorHash ||
    planningFacts.sourceArtifactHash !== artifact.certificationBindingHash ||
    planningFacts.modules.length === 0 ||
    new Set(moduleIds).size !== moduleIds.length ||
    new Set(scopeIds).size !== scopeIds.length ||
    planningFacts.modules.some(
      (module) =>
        !module.moduleId.trim() ||
        !module.scopeId.trim() ||
        !Number.isSafeInteger(module.ownedProductionFileCount) ||
        module.ownedProductionFileCount < 0
    )
  ) {
    throw new Error('STRICT_FACT_PLANNING_AUTHORITY_INVALID');
  }
}

function selectFilesForSelector(
  artifact: CertifiedProjectFactsArtifactV1,
  selector: StrictFactSubjectSelectorV1
): ProjectFactsInventoryFileV1[] {
  return artifact.facts.inventory.files
    .filter(
      (file) =>
        file.repoId === selector.repoId &&
        (selector.kind === 'repository' || file.ownerModuleIds.includes(selector.ownerModuleId))
    )
    .sort(
      (left, right) =>
        left.repoId.localeCompare(right.repoId) ||
        left.relativePath.localeCompare(right.relativePath)
    );
}

function projectFile(file: ProjectFactsInventoryFileV1): StrictFactBackendFileV1 {
  return {
    repoId: file.repoId,
    relativePath: file.relativePath,
    language: file.language,
    blobHash: file.blobSha256,
    byteLength: file.sizeBytes,
  };
}

function assertWitnessBinding(
  artifact: CertifiedProjectFactsArtifactV1,
  file: ProjectFactsInventoryFileV1,
  binding: StrictFactDirectWitnessBindingV1
): void {
  if (
    binding.sourceArtifactId !== artifact.artifactId ||
    binding.sourceRevisionVectorHash !== artifact.sourceVectorHash ||
    binding.repoId !== file.repoId ||
    binding.relativePath !== file.relativePath ||
    binding.blobHash !== file.blobSha256
  ) {
    throw new Error('FACT_WITNESS_BINDING_MISMATCH');
  }
}

async function executeBackendWithDeadline(
  backend: StrictFactQueryBackendV1,
  context: Omit<StrictFactBackendExecutionContextV1, 'signal'>,
  timeoutMs: number
): Promise<StrictFactBackendFileResultV1> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      backend.executeFile({ ...context, signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort('STRICT_FACT_BACKEND_EXECUTION_TIMEOUT');
          reject(new Error('FACT_BACKEND_EXECUTION_TIMEOUT'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function assertCandidateRange(candidate: StrictFactBackendCandidateV1, contentText: string): void {
  if (!candidate.range) {
    return;
  }
  const lines = contentText.split('\n');
  const lineCount = Math.max(1, lines.length);
  const { startLine, endLine, startColumn, endColumn } = candidate.range;
  const startLineLength = lines[startLine - 1]?.length ?? 0;
  const endLineLength = lines[endLine - 1]?.length ?? 0;
  const invalid = [
    !Number.isSafeInteger(startLine),
    !Number.isSafeInteger(endLine),
    startLine < 1,
    endLine < startLine,
    endLine > lineCount,
    invalidColumn(startColumn, startLineLength),
    invalidColumn(endColumn, endLineLength),
    startLine === endLine &&
      startColumn !== undefined &&
      endColumn !== undefined &&
      endColumn < startColumn,
  ];
  if (invalid.some(Boolean)) {
    throw new Error('FACT_BACKEND_CANDIDATE_RANGE_INVALID');
  }
}

function invalidColumn(value: number | undefined, lineLength: number): boolean {
  return value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > lineLength);
}

function uniqueFacts(facts: readonly FactRecordV1[]): FactRecordV1[] {
  return [...new Map(facts.map((fact) => [fact.factId, fact])).values()];
}

function configParserApplies(parser: StrictConfigParserIdV1, relativePath: string): boolean {
  const basename = path.posix.basename(relativePath);
  if (parser === 'nx-project-json') {
    return basename === 'project.json';
  }
  if (parser === 'react-native-package-json') {
    return basename === 'package.json';
  }
  return basename === '.flutter-plugins-dependencies';
}

function isAggregateScale(
  scale: FactHarvestObligationV1['analysisScale']
): scale is 'module' | 'package' | 'repository' | 'project' {
  return ['module', 'package', 'repository', 'project'].includes(scale);
}

function isSubjectScaleAuthorized(
  artifact: CertifiedProjectFactsArtifactV1,
  binding: StrictFactSubjectBindingV1,
  scale: FactHarvestObligationV1['analysisScale']
): boolean {
  if (!isAggregateScale(scale)) {
    return true;
  }
  if (scale === 'module') {
    return binding.selector.kind === 'owner-module';
  }
  if (scale === 'package') {
    // 当前 frozen inventory 没有 package subject identity；不得把 module/repo 静默升级成 package。
    return false;
  }
  if (scale === 'repository') {
    const repository = artifact.manifest.projectScopeManifest?.repositories.find(
      (candidate) => candidate.repoId === binding.selector.repoId
    );
    return (
      binding.selector.kind === 'repository' && repository?.scopeId === binding.canonicalSubjectRef
    );
  }
  const projectScope = artifact.manifest.projectScopeManifest;
  return (
    binding.selector.kind === 'repository' &&
    projectScope?.repositories.length === 1 &&
    projectScope.projectIdentity.scopeId === binding.canonicalSubjectRef
  );
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
