import { PROJECT_CONTEXT_REQUEST_KIND_VALUES } from '../../../domain/project-context/index.js';
import { hashCanonicalJson } from './canonical.js';
import { verifyCertifiedProjectFactsArtifact } from './capture.js';
import {
  CERTIFIED_PROJECT_FACTS_CONSUMERS,
  CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION,
  type CertifiedProjectFactsArtifactV1,
  type CertifiedProjectFactsReadinessResult,
  type ProjectContextConsumerLineageReceiptV1,
  type ProjectContextConsumerLineageRowInputV1,
} from './contracts.js';

export function evaluateCertifiedProjectFactsReadiness(
  artifact: CertifiedProjectFactsArtifactV1,
  options: { expectedRepoIds: string[]; requiredLegacyEntryIds?: string[] }
): CertifiedProjectFactsReadinessResult {
  const errors: string[] = [];
  try {
    verifyCertifiedProjectFactsArtifact(artifact);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const expectedRepoIds = uniqueStrings(options.expectedRepoIds);
  const vectorRepoIds = artifact.manifest.sourceRevisionVector.entries
    .map((entry) => entry.repoId)
    .sort();
  if (JSON.stringify(vectorRepoIds) !== JSON.stringify(expectedRepoIds)) {
    errors.push(
      `SourceRevisionVectorV1 repo set mismatch: expected ${expectedRepoIds.join(',')}, got ${vectorRepoIds.join(',')}.`
    );
  }
  const inventoryRepoIds = artifact.facts.inventory.repositories.map((row) => row.repoId).sort();
  if (JSON.stringify(inventoryRepoIds) !== JSON.stringify(expectedRepoIds)) {
    errors.push('Inventory repository set does not conserve the expected source vector repo set.');
  }
  const inventoryFileKeys = new Set(
    artifact.facts.inventory.files.map((file) => `${file.repoId}\u0000${file.relativePath}`)
  );
  if (artifact.facts.inventory.fileCount !== inventoryFileKeys.size) {
    errors.push('Inventory fileCount does not equal the complete unique file inventory.');
  }
  const decisions = artifact.facts.detail.decisions;
  if (decisions.length !== inventoryFileKeys.size) {
    errors.push('Detail selected+omitted decisions do not conserve the inventory plane.');
  }
  for (const decision of decisions) {
    if (!inventoryFileKeys.has(`${decision.repoId}\u0000${decision.relativePath}`)) {
      errors.push(`Detail decision references a file outside inventory: ${decision.relativePath}.`);
    }
  }
  for (const selection of artifact.facts.detail.selections) {
    if (!inventoryFileKeys.has(`${selection.repoId}\u0000${selection.relativePath}`)) {
      errors.push(
        `Detail selection references a file outside inventory: ${selection.relativePath}.`
      );
    }
    for (const chunkRef of selection.fullChunkRefs) {
      if (!artifact.chunks.some((chunk) => chunk.blobHash === chunkRef)) {
        errors.push(`Detail selection is missing full chunk ${chunkRef}.`);
      }
    }
  }
  for (const repoId of expectedRepoIds) {
    for (const kind of PROJECT_CONTEXT_REQUEST_KIND_VALUES) {
      const rows = artifact.facts.requestOutcomes.filter(
        (row) => row.repoId === repoId && row.kind === kind
      );
      if (rows.length !== 1) {
        errors.push(`Expected exactly one request audit row for ${repoId}/${kind}.`);
        continue;
      }
      const row = rows[0];
      if (!row) {
        continue;
      }
      if (row.applicability === 'not-applicable') {
        if (!row.typedReason || row.terminalStatus !== 'not-applicable') {
          errors.push(`Typed N/A row is incomplete for ${repoId}/${kind}.`);
        }
      } else if (row.terminalStatus !== 'completed') {
        errors.push(`Applicable request did not complete for ${repoId}/${kind}.`);
      }
      if (row.parserRuntime === 'unavailable' || row.queryInitialization === 'unavailable') {
        errors.push(`Required parser/query readiness is unavailable for ${repoId}/${kind}.`);
      }
      for (const range of row.sourceRanges) {
        if (!inventoryFileKeys.has(`${range.repoId}\u0000${range.relativePath}`)) {
          errors.push(
            `Request source range is outside inventory: ${range.repoId}/${range.relativePath}.`
          );
        }
      }
    }
  }
  for (const entryId of options.requiredLegacyEntryIds ?? []) {
    const entry = artifact.facts.legacyEntries.find((row) => row.entryId === entryId);
    if (!entry) {
      errors.push(`Required legacy entry is missing: ${entryId}.`);
      continue;
    }
    if (
      entry.directProjectContextCallCount !== 0 ||
      entry.rawFilesystemFallbackCount !== 0 ||
      entry.synthesizedProjectScopeFactCount !== 0
    ) {
      errors.push(`Strict legacy entry has a non-zero direct/fallback counter: ${entryId}.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function createProjectContextConsumerLineageReceipt(
  artifact: CertifiedProjectFactsArtifactV1,
  rows: ProjectContextConsumerLineageRowInputV1[]
): ProjectContextConsumerLineageReceiptV1 {
  const orderedRows = CERTIFIED_PROJECT_FACTS_CONSUMERS.map((consumer) => {
    const matches = rows.filter((row) => row.consumer === consumer);
    if (matches.length !== 1) {
      throw new TypeError(`Expected exactly one lineage row for ${consumer}.`);
    }
    const row = matches[0];
    if (!row || row.projectionContentHash !== artifact.manifest.projectionContentHashes[consumer]) {
      throw new TypeError(`Lineage projection hash mismatch for ${consumer}.`);
    }
    if (
      row.directProjectContextCallCount !== 0 ||
      row.rawFilesystemFallbackCount !== 0 ||
      row.synthesizedProjectScopeFactCount !== 0
    ) {
      throw new TypeError(`Strict lineage counters must be zero for ${consumer}.`);
    }
    return {
      ...row,
      artifactId: artifact.artifactId,
      sourceVectorHash: artifact.sourceVectorHash,
    };
  });
  const semantic = {
    kind: 'ProjectContextConsumerLineageReceipt' as const,
    schemaVersion: CERTIFIED_PROJECT_FACTS_SCHEMA_VERSION,
    artifactId: artifact.artifactId,
    sourceVectorHash: artifact.sourceVectorHash,
    rows: orderedRows,
  };
  return { ...semantic, receiptHash: hashCanonicalJson(semantic) };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
