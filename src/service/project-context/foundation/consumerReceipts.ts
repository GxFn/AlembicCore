import { canonicalHashDigest, hashCanonicalJson } from './canonical.js';
import { verifyCertifiedProjectFactsArtifact } from './capture.js';
import {
  CERTIFIED_PROJECT_FACTS_CONSUMERS,
  type CertifiedProjectFactsArtifactV1,
  PROJECT_CONTEXT_CONSUMER_LINEAGE_VERSION,
  type ProjectContextConsumerLineageReceiptV2,
  type ProjectContextConsumerLineageRowInputV2,
  type ProjectContextConsumerProjectionReceiptV2,
} from './contracts.js';

export function createProjectContextConsumerLineageReceiptV2(
  artifact: CertifiedProjectFactsArtifactV1,
  rows: readonly ProjectContextConsumerLineageRowInputV2[]
): ProjectContextConsumerLineageReceiptV2 {
  verifyCertifiedProjectFactsArtifact(artifact);
  const projectScope = artifact.manifest.projectScopeManifest;
  if (!projectScope) {
    throw new TypeError('Strict-v2 consumer lineage requires an embedded project scope receipt.');
  }
  const orderedRows = CERTIFIED_PROJECT_FACTS_CONSUMERS.map((consumer) => {
    const matches = rows.filter((row) => row.projectionReceipt.consumer === consumer);
    if (matches.length !== 1) {
      throw new TypeError(`Expected exactly one strict-v2 projection receipt for ${consumer}.`);
    }
    const row = matches[0]!;
    verifyProjectionReceipt(row.projectionReceipt);
    if (
      row.projectionReceipt.artifactId !== artifact.artifactId ||
      row.projectionReceipt.sourceVectorHash !== artifact.sourceVectorHash ||
      row.projectionReceipt.factsContentHash !== artifact.factsContentHash ||
      row.projectionReceipt.certificationBindingHash !== artifact.certificationBindingHash
    ) {
      throw new TypeError(`Strict-v2 projection receipt base identity mismatch for ${consumer}.`);
    }
    if (row.canonicalScopeHash !== projectScope.canonicalScopeHash) {
      throw new TypeError(`Strict-v2 consumer scope identity mismatch for ${consumer}.`);
    }
    if (
      row.directProjectContextCallCount !== 0 ||
      row.rawFilesystemFallbackCount !== 0 ||
      row.synthesizedProjectScopeFactCount !== 0
    ) {
      throw new TypeError(`Strict-v2 consumer fallback counters must be zero for ${consumer}.`);
    }
    if (!['passed', 'not-applicable'].includes(row.sessionPersistReloadStatus)) {
      throw new TypeError(
        `Strict-v2 consumer has an invalid session reload status for ${consumer}.`
      );
    }
    return { ...row, consumer };
  });
  const semantic = {
    kind: 'ProjectContextConsumerLineageReceiptV2' as const,
    version: PROJECT_CONTEXT_CONSUMER_LINEAGE_VERSION,
    artifactId: artifact.artifactId,
    sourceVectorHash: artifact.sourceVectorHash,
    factsContentHash: artifact.factsContentHash,
    certificationBindingHash: artifact.certificationBindingHash,
    rows: orderedRows,
  };
  return { ...semantic, receiptHash: hashCanonicalJson(semantic) };
}

export function verifyProjectContextConsumerProjectionReceiptV2(
  receipt: ProjectContextConsumerProjectionReceiptV2
): void {
  verifyProjectionReceipt(receipt);
}

function verifyProjectionReceipt(receipt: ProjectContextConsumerProjectionReceiptV2): void {
  const { receiptHash, ...semantic } = receipt;
  if (
    receipt.kind !== 'ProjectContextConsumerProjectionReceiptV2' ||
    receipt.version !== 2 ||
    hashCanonicalJson(semantic) !== receiptHash
  ) {
    throw new TypeError('ProjectContextConsumerProjectionReceiptV2 is not canonical.');
  }
  if (!receipt.adapterVersion.trim() || !receipt.entrypoint.trim() || !receipt.runId.trim()) {
    throw new TypeError('Strict-v2 projection receipt is missing adapter/load identity.');
  }
  canonicalHashDigest(receipt.payloadSchemaHash);
  canonicalHashDigest(receipt.loadEvidenceHash);
  if (/audit|placeholder/i.test(receipt.entrypoint)) {
    throw new TypeError('Audit/placeholder projections cannot satisfy actual consumer evidence.');
  }
}
