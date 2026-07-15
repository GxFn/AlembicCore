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
  const repositoryRows = new Map(
    artifact.facts.inventory.repositories.map((repository) => [repository.repoId, repository])
  );
  const projectPathOwners = new Map<string, string>();
  for (const file of artifact.facts.inventory.files) {
    const repository = repositoryRows.get(file.repoId);
    if (!repository) {
      continue;
    }
    const projectRelativePath =
      repository.relativeRoot === '.'
        ? file.relativePath
        : `${repository.relativeRoot}/${file.relativePath}`;
    const key = `${repository.scopeId}\u0000${projectRelativePath}`;
    const existingOwner = projectPathOwners.get(key);
    if (existingOwner && existingOwner !== file.repoId) {
      errors.push(
        `Cross-repository inventory overlap for ${repository.scopeId}:${projectRelativePath}: ${[
          existingOwner,
          file.repoId,
        ]
          .sort()
          .join(',')}.`
      );
    } else {
      projectPathOwners.set(key, file.repoId);
    }
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
    const expectedOwnership = buildExpectedModuleOwnership(
      artifact.facts.inventory.files.filter((file) => file.repoId === repoId)
    );
    const expectedOwnerIds = new Set(Object.keys(expectedOwnership));
    for (const kind of PROJECT_CONTEXT_REQUEST_KIND_VALUES) {
      const rows = artifact.facts.requestOutcomes.filter(
        (row) => row.repoId === repoId && row.kind === kind
      );
      if (rows.length === 0) {
        errors.push(`Expected at least one request audit row for ${repoId}/${kind}.`);
        continue;
      }
      if (!['module', 'module-layers'].includes(kind) && rows.length !== 1) {
        errors.push(`Expected exactly one request audit row for ${repoId}/${kind}.`);
      }
      if (['module', 'module-layers'].includes(kind) && expectedOwnerIds.size > 0) {
        const actualOwnerIds = rows
          .map((row) => readDirectOwnerModuleId(row.selector))
          .filter((owner): owner is string => Boolean(owner));
        if (
          actualOwnerIds.length !== rows.length ||
          JSON.stringify([...new Set(actualOwnerIds)].sort()) !==
            JSON.stringify([...expectedOwnerIds].sort()) ||
          JSON.stringify(collectModuleOwnership(rows.map((row) => row.selector))) !==
            JSON.stringify(expectedOwnership)
        ) {
          errors.push(`Module owner coverage mismatch for ${repoId}/${kind}.`);
        }
      }
      for (const row of rows) {
        if (['repo', 'map'].includes(kind) && expectedOwnerIds.size > 0) {
          if (
            JSON.stringify(collectOwnerModuleIds(row.selector)) !==
              JSON.stringify([...expectedOwnerIds].sort()) ||
            JSON.stringify(collectModuleOwnership(row.selector)) !==
              JSON.stringify(expectedOwnership)
          ) {
            errors.push(`Module owner coverage mismatch for ${repoId}/${kind}.`);
          }
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
        for (const diagnostic of row.errors) {
          if (!isTypedRequestDiagnostic(diagnostic)) {
            errors.push(`Unclassified request diagnostic for ${repoId}/${kind}.`);
          } else if (diagnostic.classification === 'confirmed-defect') {
            errors.push(
              `Confirmed request defect for ${repoId}/${kind}: ${diagnostic.code}:${diagnostic.message}`
            );
          }
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

function isTypedRequestDiagnostic(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const diagnostic = value as Record<string, unknown>;
  return (
    typeof diagnostic.code === 'string' &&
    Boolean(diagnostic.code.trim()) &&
    typeof diagnostic.message === 'string' &&
    Boolean(diagnostic.message.trim()) &&
    typeof diagnostic.typedReason === 'string' &&
    Boolean(diagnostic.typedReason.trim()) &&
    typeof diagnostic.retryable === 'boolean' &&
    ['error', 'warning'].includes(String(diagnostic.severity)) &&
    ['expected-external', 'advisory', 'confirmed-defect'].includes(
      String(diagnostic.classification)
    )
  );
}

function readDirectOwnerModuleId(value: unknown): string | undefined {
  return value && !Array.isArray(value) && typeof value === 'object'
    ? typeof (value as Record<string, unknown>).ownerModuleId === 'string'
      ? ((value as Record<string, unknown>).ownerModuleId as string)
      : undefined
    : undefined;
}

function collectOwnerModuleIds(value: unknown): string[] {
  const ownerIds = new Set<string>();
  const visit = (entry: unknown, key?: string): void => {
    if (key === 'ownerModuleId' && typeof entry === 'string') {
      ownerIds.add(entry);
    }
    if (Array.isArray(entry)) {
      for (const item of entry) {
        visit(item);
      }
    } else if (entry && typeof entry === 'object') {
      for (const [entryKey, item] of Object.entries(entry)) {
        visit(item, entryKey);
      }
    }
  };
  visit(value);
  return [...ownerIds].sort();
}

function buildExpectedModuleOwnership(
  files: CertifiedProjectFactsArtifactV1['facts']['inventory']['files']
): Record<string, string[]> {
  const ownership = new Map<string, Set<string>>();
  for (const file of files) {
    for (const ownerModuleId of file.ownerModuleIds) {
      const ownedFiles = ownership.get(ownerModuleId) ?? new Set<string>();
      ownedFiles.add(file.relativePath);
      ownership.set(ownerModuleId, ownedFiles);
    }
  }
  return serializeModuleOwnership(ownership);
}

function collectModuleOwnership(value: unknown): Record<string, string[]> {
  const ownership = new Map<string, Set<string>>();
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      for (const item of entry) {
        visit(item);
      }
      return;
    }
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.ownerModuleId === 'string' && Array.isArray(record.ownedFiles)) {
      const ownedFiles = ownership.get(record.ownerModuleId) ?? new Set<string>();
      for (const file of record.ownedFiles) {
        if (typeof file === 'string') {
          ownedFiles.add(file);
        }
      }
      ownership.set(record.ownerModuleId, ownedFiles);
    }
    for (const nested of Object.values(record)) {
      visit(nested);
    }
  };
  visit(value);
  return serializeModuleOwnership(ownership);
}

function serializeModuleOwnership(
  ownership: ReadonlyMap<string, ReadonlySet<string>>
): Record<string, string[]> {
  return Object.fromEntries(
    [...ownership.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([ownerModuleId, ownedFiles]) => [ownerModuleId, [...ownedFiles].sort()])
  );
}
