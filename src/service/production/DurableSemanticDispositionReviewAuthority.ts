import {
  createPublicKey,
  type KeyObject,
  sign as signDetached,
  verify as verifyDetached,
} from 'node:crypto';
import { hashBytes, hashCanonicalJson } from '../project-context/foundation/canonical.js';
import type { StrictAcceptedCorpusInspectionV1 } from './ProductionPersistenceContracts.js';
import {
  assertSemanticDispositionReviewExecutionStructureV2ForDurableTrust,
  assertSemanticDispositionReviewRequestV1,
  createAgentSemanticDispositionReviewHostGatewayV2,
  createAgentSemanticDispositionReviewRequestV2,
  createProducerZeroDispositionAdmissionAuthorityFromVerifiedExecutionV1,
  createSemanticDispositionReviewEvidenceAuthorityV2,
  type ProducerZeroDispositionAdmissionAuthorityV1,
  type SemanticDispositionReviewEvidenceAuthorityV2,
  type SemanticDispositionReviewEvidenceV1,
  type SemanticDispositionReviewExecutionV2,
  type SemanticDispositionReviewerModelLoadReceiptV1,
  type SemanticDispositionReviewHostCallV2,
  type SemanticDispositionReviewHostResultV2,
  type SemanticDispositionReviewRequestV1,
} from './SemanticDispositionReviewExecution.js';
import {
  createKnowledgeDispositionReviewV1,
  type HypothesisExpressionSetReceiptV1,
} from './StrictAnalysisContracts.js';

export const SEMANTIC_DISPOSITION_REVIEW_DURABLE_ATTESTATION_ALGORITHM_V3 = 'Ed25519';

export interface SemanticDispositionReviewTrustPolicyV3 {
  readonly schemaVersion: 3;
  readonly trustRootId: string;
  readonly keyId: string;
  readonly signatureAlgorithm: typeof SEMANTIC_DISPOSITION_REVIEW_DURABLE_ATTESTATION_ALGORITHM_V3;
  readonly publicKeySpkiDerBase64: string;
  readonly publicKeyHash: string;
  readonly reviewerModelLoadReceiptHash: string;
  readonly evidenceStoreId: string;
  readonly evidenceStoreConfigHash: string;
  readonly policyHash: string;
}

export interface SemanticDispositionReviewEvidenceStoreLoadReceiptV3 {
  readonly schemaVersion: 3;
  readonly trustRootId: string;
  readonly evidenceStoreId: string;
  readonly evidenceStoreConfigHash: string;
  readonly loadOperationId: string;
  readonly evidenceEntryId: string;
  readonly evidenceSessionId: string;
  readonly evidenceEntryHash: string;
  readonly evidenceLedgerSnapshotHash: string;
  readonly witnessBindingHash: string;
  readonly projectContextRefId: string;
  readonly projectContextRefHash: string;
  readonly sourceRevisionVectorHash: string;
  readonly canonicalSubjectRef: string;
  readonly relativePath: string;
  readonly blobHash: string;
  readonly executionReceiptHash: string;
  readonly fileExecutionHash: string;
  readonly evidenceAuthorityHash: string;
  readonly loadReceiptHash: string;
}

export interface SemanticDispositionReviewDurableAttestationV3 {
  readonly schemaVersion: 3;
  readonly trustPolicyHash: string;
  readonly execution: SemanticDispositionReviewExecutionV2;
  readonly evidenceLoadReceipts: readonly SemanticDispositionReviewEvidenceStoreLoadReceiptV3[];
  readonly attestedPayloadHash: string;
  readonly signatureAlgorithm: typeof SEMANTIC_DISPOSITION_REVIEW_DURABLE_ATTESTATION_ALGORITHM_V3;
  readonly signatureBase64: string;
  readonly attestationHash: string;
}

export interface SemanticDispositionReviewEvidenceStoreLoadCallV3 {
  readonly semanticRequest: SemanticDispositionReviewRequestV1;
  readonly evidence: SemanticDispositionReviewEvidenceV1;
}

export interface SemanticDispositionReviewEvidenceStoreLoadResultV3 {
  readonly loadOperationId: string;
  readonly evidenceEntry: SemanticDispositionReviewEvidenceAuthorityV2['evidenceEntry'];
  readonly evidenceLedgerSnapshot: SemanticDispositionReviewEvidenceAuthorityV2['evidenceLedgerSnapshot'];
  readonly witnessBinding: SemanticDispositionReviewEvidenceAuthorityV2['witnessBinding'];
  readonly executionReceipt: SemanticDispositionReviewEvidenceAuthorityV2['executionReceipt'];
  readonly fileExecutionHash: string;
  readonly semanticRole: string;
}

export interface SemanticDispositionReviewEvidenceStoreAdapterV3 {
  readonly evidenceStoreId: string;
  readonly evidenceStoreConfigHash: string;
  load(
    call: SemanticDispositionReviewEvidenceStoreLoadCallV3
  ): Promise<SemanticDispositionReviewEvidenceStoreLoadResultV3>;
}

export interface SemanticDispositionReviewAgentReviewerHostAdapterV3 {
  readonly reviewerModelLoadReceipt: SemanticDispositionReviewerModelLoadReceiptV1;
  invoke(call: SemanticDispositionReviewHostCallV2): Promise<SemanticDispositionReviewHostResultV2>;
}

export interface SemanticDispositionReviewDurableGatewayV3 {
  readonly trustPolicy: SemanticDispositionReviewTrustPolicyV3;
  execute(
    semanticRequest: SemanticDispositionReviewRequestV1
  ): Promise<SemanticDispositionReviewDurableAttestationV3>;
}

/**
 * Agent 侧唯一持有私钥、真实 reviewer host 与 Evidence Ledger store adapter。
 * Main 只接收序列化 attestation 与预先批准的 public trust policy，不能从 production facade
 * 注入任意 invoke/load adapter 后给自己盖章。
 */
export function createAgentSemanticDispositionReviewDurableGatewayV3(input: {
  readonly trustRootId: string;
  readonly keyId: string;
  readonly privateKey: KeyObject;
  readonly reviewerHost: SemanticDispositionReviewAgentReviewerHostAdapterV3;
  readonly evidenceStore: SemanticDispositionReviewEvidenceStoreAdapterV3;
}): SemanticDispositionReviewDurableGatewayV3 {
  requireText(input.trustRootId, 'SEMANTIC_DISPOSITION_REVIEW_TRUST_ROOT_ID_REQUIRED');
  requireText(input.keyId, 'SEMANTIC_DISPOSITION_REVIEW_TRUST_KEY_ID_REQUIRED');
  requireText(
    input.evidenceStore.evidenceStoreId,
    'SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_STORE_ID_REQUIRED'
  );
  requireSha256(
    input.evidenceStore.evidenceStoreConfigHash,
    'SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_STORE_CONFIG_INVALID'
  );
  if (input.privateKey.type !== 'private' || input.privateKey.asymmetricKeyType !== 'ed25519') {
    fail('SEMANTIC_DISPOSITION_REVIEW_PRIVATE_KEY_INVALID');
  }
  if (typeof input.evidenceStore.load !== 'function') {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_STORE_ADAPTER_INVALID');
  }
  const trustPolicy = createTrustPolicyV3(input);
  const hostGateway = createAgentSemanticDispositionReviewHostGatewayV2(input.reviewerHost);
  return freezeDeep({
    trustPolicy,
    execute: async (semanticRequest: SemanticDispositionReviewRequestV1) => {
      assertSemanticDispositionReviewRequestV1(semanticRequest);
      const evidenceAuthorities: SemanticDispositionReviewEvidenceAuthorityV2[] = [];
      const evidenceLoadReceipts: SemanticDispositionReviewEvidenceStoreLoadReceiptV3[] = [];
      const loadOperationIds = new Set<string>();
      for (const evidence of semanticRequest.evidence) {
        const loaded = await input.evidenceStore.load(freezeDeep({ semanticRequest, evidence }));
        requireText(
          loaded.loadOperationId,
          'SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_LOAD_ID_REQUIRED'
        );
        if (loadOperationIds.has(loaded.loadOperationId)) {
          fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_LOAD_REUSED');
        }
        loadOperationIds.add(loaded.loadOperationId);
        if (
          loaded.evidenceEntry.id !== evidence.evidenceEntryId ||
          loaded.evidenceEntry.sessionId !== evidence.evidenceSessionId ||
          loaded.semanticRole !== evidence.semanticRole
        ) {
          fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_LOAD_MISMATCH');
        }
        const authority = createSemanticDispositionReviewEvidenceAuthorityV2({
          evidenceEntry: loaded.evidenceEntry,
          evidenceLedgerSnapshot: loaded.evidenceLedgerSnapshot,
          witnessBinding: loaded.witnessBinding,
          executionReceipt: loaded.executionReceipt,
          fileExecutionHash: loaded.fileExecutionHash,
          semanticRole: loaded.semanticRole,
        });
        evidenceAuthorities.push(authority);
        evidenceLoadReceipts.push(
          createEvidenceStoreLoadReceiptV3(trustPolicy, loaded.loadOperationId, authority)
        );
      }
      const request = createAgentSemanticDispositionReviewRequestV2({
        semanticRequest,
        evidenceAuthorities,
      });
      const execution = await hostGateway.execute(request);
      return createDurableAttestationV3(
        input.privateKey,
        trustPolicy,
        execution,
        evidenceLoadReceipts
      );
    },
  });
}

export function assertSemanticDispositionReviewTrustPolicyV3(
  policy: SemanticDispositionReviewTrustPolicyV3
): void {
  requireText(policy.trustRootId, 'SEMANTIC_DISPOSITION_REVIEW_TRUST_POLICY_INVALID');
  requireText(policy.keyId, 'SEMANTIC_DISPOSITION_REVIEW_TRUST_POLICY_INVALID');
  requireText(policy.evidenceStoreId, 'SEMANTIC_DISPOSITION_REVIEW_TRUST_POLICY_INVALID');
  requireSha256(policy.evidenceStoreConfigHash, 'SEMANTIC_DISPOSITION_REVIEW_TRUST_POLICY_INVALID');
  requireSha256(
    policy.reviewerModelLoadReceiptHash,
    'SEMANTIC_DISPOSITION_REVIEW_TRUST_POLICY_INVALID'
  );
  const publicKeyDer = decodeBase64(policy.publicKeySpkiDerBase64);
  const semantic = {
    schemaVersion: 3 as const,
    trustRootId: policy.trustRootId,
    keyId: policy.keyId,
    signatureAlgorithm: 'Ed25519' as const,
    publicKeySpkiDerBase64: policy.publicKeySpkiDerBase64,
    publicKeyHash: hashBytes(publicKeyDer),
    reviewerModelLoadReceiptHash: policy.reviewerModelLoadReceiptHash,
    evidenceStoreId: policy.evidenceStoreId,
    evidenceStoreConfigHash: policy.evidenceStoreConfigHash,
  };
  if (
    policy.schemaVersion !== 3 ||
    policy.signatureAlgorithm !== SEMANTIC_DISPOSITION_REVIEW_DURABLE_ATTESTATION_ALGORITHM_V3 ||
    policy.publicKeyHash !== semantic.publicKeyHash ||
    policy.policyHash !== hashCanonicalJson(semantic)
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_TRUST_POLICY_INVALID');
  }
  try {
    const publicKey = createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
    if (publicKey.asymmetricKeyType !== 'ed25519') {
      fail('SEMANTIC_DISPOSITION_REVIEW_TRUST_POLICY_INVALID');
    }
  } catch {
    fail('SEMANTIC_DISPOSITION_REVIEW_TRUST_POLICY_INVALID');
  }
}

/**
 * 该校验完全依赖可序列化 policy + attestation，不依赖 WeakMap、对象 identity 或同进程注册。
 * expectedTrustPolicy 必须由 Main 的 durable configuration / trust store 预先批准，不能取自任务
 * payload 本身。
 */
export function assertSemanticDispositionReviewDurableAttestationV3(input: {
  readonly attestation: SemanticDispositionReviewDurableAttestationV3;
  readonly expectedTrustPolicy: SemanticDispositionReviewTrustPolicyV3;
}): void {
  assertSemanticDispositionReviewTrustPolicyV3(input.expectedTrustPolicy);
  const attestation = input.attestation;
  if (
    attestation?.schemaVersion !== 3 ||
    attestation.trustPolicyHash !== input.expectedTrustPolicy.policyHash
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_TRUST_POLICY_MISMATCH');
  }
  assertSemanticDispositionReviewExecutionStructureV2ForDurableTrust(attestation.execution);
  if (
    attestation.execution.request.semanticRequest.calibration.reviewerModelLoadReceipt
      .loadReceiptHash !== input.expectedTrustPolicy.reviewerModelLoadReceiptHash
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_TRUST_POLICY_MISMATCH');
  }
  assertEvidenceStoreLoadReceiptsV3(
    attestation.evidenceLoadReceipts,
    attestation.execution.request.evidenceAuthorities,
    input.expectedTrustPolicy
  );
  const signedSemantic = durableAttestationSignedSemantic(
    attestation.trustPolicyHash,
    attestation.execution,
    attestation.evidenceLoadReceipts
  );
  const attestedPayloadHash = hashCanonicalJson(signedSemantic);
  const attestationWithoutHash = {
    ...signedSemantic,
    attestedPayloadHash,
    signatureAlgorithm: 'Ed25519' as const,
    signatureBase64: attestation.signatureBase64,
  };
  if (
    attestation.signatureAlgorithm !==
      SEMANTIC_DISPOSITION_REVIEW_DURABLE_ATTESTATION_ALGORITHM_V3 ||
    attestation.attestedPayloadHash !== attestedPayloadHash ||
    attestation.attestationHash !== hashCanonicalJson(attestationWithoutHash) ||
    !verifyAttestationSignatureV3(
      input.expectedTrustPolicy,
      attestedPayloadHash,
      attestation.signatureBase64
    )
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_DURABLE_ATTESTATION_INVALID');
  }
}

export function consumeMainSemanticDispositionReviewDurableAttestationV3(input: {
  readonly attestation: SemanticDispositionReviewDurableAttestationV3;
  readonly expectedSemanticRequest: SemanticDispositionReviewRequestV1;
  readonly expectedTrustPolicy: SemanticDispositionReviewTrustPolicyV3;
}) {
  assertSemanticDispositionReviewDurableAttestationV3(input);
  assertSemanticDispositionReviewRequestV1(input.expectedSemanticRequest);
  const execution = input.attestation.execution;
  const request = execution.request.semanticRequest;
  if (
    request.requestHash !== input.expectedSemanticRequest.requestHash ||
    hashCanonicalJson(request) !== hashCanonicalJson(input.expectedSemanticRequest)
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_MAIN_CONSUMER_MISMATCH');
  }
  return createKnowledgeDispositionReviewV1({
    reviewKind: request.reviewKind,
    currentAnalysisFixpointHash: request.currentAnalysisFixpointHash,
    populationHash: request.populationHash,
    proposedDispositionHash: request.proposedDispositionHash,
    executionReceipts: request.executionReceipts,
    finalExpandedSchedule: request.finalExpandedSchedule,
    terminalObligations: request.context.analysisFixpoint.terminalObligations,
    producer: request.producer,
    reviewer: execution.reviewer,
    calibrationReceiptHash: request.calibration.calibrationReceiptHash,
    verdict: execution.decision.verdict,
    reasonCode: execution.decision.reasonCode,
    semanticExecutionResultHash: execution.executionHash,
  });
}

export function createProducerZeroDispositionAdmissionAuthorityV1(input: {
  readonly attestation: SemanticDispositionReviewDurableAttestationV3;
  readonly expectedTrustPolicy: SemanticDispositionReviewTrustPolicyV3;
  readonly expressionSet: HypothesisExpressionSetReceiptV1;
  readonly corpusInspection: StrictAcceptedCorpusInspectionV1;
}): ProducerZeroDispositionAdmissionAuthorityV1 {
  assertSemanticDispositionReviewDurableAttestationV3(input);
  return createProducerZeroDispositionAdmissionAuthorityFromVerifiedExecutionV1({
    execution: input.attestation.execution,
    expressionSet: input.expressionSet,
    corpusInspection: input.corpusInspection,
  });
}

function createTrustPolicyV3(input: {
  readonly trustRootId: string;
  readonly keyId: string;
  readonly privateKey: KeyObject;
  readonly reviewerHost: SemanticDispositionReviewAgentReviewerHostAdapterV3;
  readonly evidenceStore: SemanticDispositionReviewEvidenceStoreAdapterV3;
}): SemanticDispositionReviewTrustPolicyV3 {
  const publicKeyDer = createPublicKey(input.privateKey).export({
    format: 'der',
    type: 'spki',
  });
  const semantic = {
    schemaVersion: 3 as const,
    trustRootId: input.trustRootId.trim(),
    keyId: input.keyId.trim(),
    signatureAlgorithm: 'Ed25519' as const,
    publicKeySpkiDerBase64: publicKeyDer.toString('base64'),
    publicKeyHash: hashBytes(publicKeyDer),
    reviewerModelLoadReceiptHash: input.reviewerHost.reviewerModelLoadReceipt.loadReceiptHash,
    evidenceStoreId: input.evidenceStore.evidenceStoreId.trim(),
    evidenceStoreConfigHash: input.evidenceStore.evidenceStoreConfigHash,
  };
  const policy = freezeDeep({ ...semantic, policyHash: hashCanonicalJson(semantic) });
  assertSemanticDispositionReviewTrustPolicyV3(policy);
  return policy;
}

function createEvidenceStoreLoadReceiptV3(
  policy: SemanticDispositionReviewTrustPolicyV3,
  loadOperationId: string,
  authority: SemanticDispositionReviewEvidenceAuthorityV2
): SemanticDispositionReviewEvidenceStoreLoadReceiptV3 {
  const fileExecution = authority.executionReceipt.fileExecutions.find(
    (candidate) => candidate.executionHash === authority.fileExecutionHash
  );
  if (!fileExecution) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_LOAD_MISMATCH');
  }
  const semantic = {
    schemaVersion: 3 as const,
    trustRootId: policy.trustRootId,
    evidenceStoreId: policy.evidenceStoreId,
    evidenceStoreConfigHash: policy.evidenceStoreConfigHash,
    loadOperationId: loadOperationId.trim(),
    evidenceEntryId: authority.evidenceEntry.id,
    evidenceSessionId: authority.evidenceEntry.sessionId,
    evidenceEntryHash: hashCanonicalJson(authority.evidenceEntry),
    evidenceLedgerSnapshotHash: authority.evidenceLedgerSnapshot.snapshotHash,
    witnessBindingHash: authority.witnessBinding.bindingHash,
    projectContextRefId: authority.witnessBinding.projectContextRefId,
    projectContextRefHash: authority.witnessBinding.projectContextRefHash,
    sourceRevisionVectorHash: authority.executionReceipt.sourceRevisionVectorHash,
    canonicalSubjectRef: authority.canonicalSubjectRef,
    relativePath: fileExecution.relativePath,
    blobHash: fileExecution.blobHash,
    executionReceiptHash: authority.executionReceiptHash,
    fileExecutionHash: authority.fileExecutionHash,
    evidenceAuthorityHash: authority.authorityHash,
  };
  return freezeDeep({ ...semantic, loadReceiptHash: hashCanonicalJson(semantic) });
}

function createDurableAttestationV3(
  privateKey: KeyObject,
  trustPolicy: SemanticDispositionReviewTrustPolicyV3,
  execution: SemanticDispositionReviewExecutionV2,
  evidenceLoadReceipts: readonly SemanticDispositionReviewEvidenceStoreLoadReceiptV3[]
): SemanticDispositionReviewDurableAttestationV3 {
  const signedSemantic = durableAttestationSignedSemantic(
    trustPolicy.policyHash,
    execution,
    evidenceLoadReceipts
  );
  const attestedPayloadHash = hashCanonicalJson(signedSemantic);
  const signatureBase64 = signDetached(
    null,
    Buffer.from(attestedPayloadHash, 'utf8'),
    privateKey
  ).toString('base64');
  const semantic = {
    ...signedSemantic,
    attestedPayloadHash,
    signatureAlgorithm: 'Ed25519' as const,
    signatureBase64,
  };
  const attestation = freezeDeep({
    ...semantic,
    attestationHash: hashCanonicalJson(semantic),
  });
  assertSemanticDispositionReviewDurableAttestationV3({
    attestation,
    expectedTrustPolicy: trustPolicy,
  });
  return attestation;
}

function durableAttestationSignedSemantic(
  trustPolicyHash: string,
  execution: SemanticDispositionReviewExecutionV2,
  evidenceLoadReceipts: readonly SemanticDispositionReviewEvidenceStoreLoadReceiptV3[]
) {
  return {
    schemaVersion: 3 as const,
    trustPolicyHash,
    execution,
    evidenceLoadReceipts: [...evidenceLoadReceipts],
  };
}

function assertEvidenceStoreLoadReceiptsV3(
  receipts: readonly SemanticDispositionReviewEvidenceStoreLoadReceiptV3[],
  authorities: readonly SemanticDispositionReviewEvidenceAuthorityV2[],
  policy: SemanticDispositionReviewTrustPolicyV3
): void {
  if (
    receipts.length === 0 ||
    receipts.length !== authorities.length ||
    new Set(receipts.map((receipt) => receipt.loadOperationId)).size !== receipts.length
  ) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_LOAD_RECEIPT_INVALID');
  }
  const byAuthorityHash = new Map(
    authorities.map((authority) => [authority.authorityHash, authority] as const)
  );
  for (const receipt of receipts) {
    const authority = byAuthorityHash.get(receipt.evidenceAuthorityHash);
    if (
      !authority ||
      receipt.trustRootId !== policy.trustRootId ||
      receipt.evidenceStoreId !== policy.evidenceStoreId ||
      receipt.evidenceStoreConfigHash !== policy.evidenceStoreConfigHash
    ) {
      fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_LOAD_RECEIPT_INVALID');
    }
    const rebuilt = createEvidenceStoreLoadReceiptV3(policy, receipt.loadOperationId, authority);
    if (hashCanonicalJson(rebuilt) !== hashCanonicalJson(receipt)) {
      fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_LOAD_RECEIPT_INVALID');
    }
    byAuthorityHash.delete(receipt.evidenceAuthorityHash);
  }
  if (byAuthorityHash.size !== 0) {
    fail('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_LOAD_RECEIPT_INVALID');
  }
}

function verifyAttestationSignatureV3(
  policy: SemanticDispositionReviewTrustPolicyV3,
  attestedPayloadHash: string,
  signatureBase64: string
): boolean {
  try {
    const publicKey = createPublicKey({
      key: decodeBase64(policy.publicKeySpkiDerBase64),
      format: 'der',
      type: 'spki',
    });
    return verifyDetached(
      null,
      Buffer.from(attestedPayloadHash, 'utf8'),
      publicKey,
      decodeBase64(signatureBase64)
    );
  } catch {
    return false;
  }
}

function decodeBase64(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    fail('SEMANTIC_DISPOSITION_REVIEW_BASE64_INVALID');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 0 || decoded.toString('base64') !== value) {
    fail('SEMANTIC_DISPOSITION_REVIEW_BASE64_INVALID');
  }
  return decoded;
}

function requireText(value: string, code: string): void {
  if (!value?.trim()) {
    fail(code);
  }
}

function requireSha256(value: string, code: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail(code);
  }
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezeDeep(child);
    }
    Object.freeze(value);
  }
  return value;
}

function fail(code: string): never {
  throw new Error(code);
}
