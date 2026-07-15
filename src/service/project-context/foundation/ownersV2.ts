import {
  canonicalHashDigest,
  hashCanonicalJson,
  normalizePortableRelativePath,
} from './canonical.js';
import type {
  ProjectContextFoundationFileDescriptor,
  ProjectContextInventoryOwnerV2,
  ProjectFactsInventoryFileV1,
} from './contracts.js';

export function normalizeProjectContextInventoryOwnersV2(
  descriptor: ProjectContextFoundationFileDescriptor
): ProjectContextInventoryOwnerV2[] {
  const owners =
    descriptor.ownersV2 ??
    (descriptor.ownerModuleIds ?? []).map((ownerModuleId) => ({
      ownerModuleId,
      origin: 'host-declared' as const,
      confidence: 'medium' as const,
      disposition: 'exclusive' as const,
      typedReason: 'legacy-host-owner-promoted-to-typed-v2-evidence',
      evidence: [{ kind: 'host-port-declaration' as const }],
    }));
  const normalized = owners
    .map((owner) => normalizeOwner(owner))
    .sort((left, right) => hashCanonicalJson(left).localeCompare(hashCanonicalJson(right)));
  const validation = validateOwnerRows(normalized, descriptor.ownerModuleIds ?? []);
  if (!validation.ok) {
    throw new TypeError(`Invalid inventory owner evidence: ${validation.errors.join(',')}.`);
  }
  return normalized;
}

export function validateProjectContextInventoryOwnersV2(
  files: readonly ProjectFactsInventoryFileV1[]
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const inventoryByKey = new Map(
    files.map((file) => [`${file.repoId}\u0000${file.relativePath}`, file])
  );
  for (const file of files) {
    const prefix = `${file.repoId}/${file.relativePath}`;
    if (!file.ownersV2) {
      errors.push(`owner-evidence-missing:${prefix}`);
      continue;
    }
    const validation = validateOwnerRows(
      file.ownersV2,
      file.ownerModuleIds,
      inventoryByKey,
      file.repoId
    );
    errors.push(...validation.errors.map((error) => `${error}:${prefix}`));
  }
  return { ok: errors.length === 0, errors: uniqueStrings(errors) };
}

function validateOwnerRows(
  owners: readonly ProjectContextInventoryOwnerV2[],
  compatibilityOwnerIds: readonly string[],
  inventoryByKey?: ReadonlyMap<string, ProjectFactsInventoryFileV1>,
  repoId?: string
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = owners.map((owner) => owner.ownerModuleId);
  if (new Set(ids).size !== ids.length) {
    errors.push('owner-row-duplicate');
  }
  if (
    hashCanonicalJson(uniqueStrings(ids)) !==
    hashCanonicalJson(uniqueStrings(compatibilityOwnerIds))
  ) {
    errors.push('owner-compatibility-projection-mismatch');
  }
  if (owners.length > 1 && owners.some((owner) => owner.disposition === 'exclusive')) {
    errors.push('multi-owner-disposition-untyped');
  }
  for (const owner of owners) {
    if (!['package-build-declaration', 'host-declared', 'path-heuristic'].includes(owner.origin)) {
      errors.push(`owner-origin-invalid:${owner.ownerModuleId}`);
    }
    if (!['high', 'medium', 'low'].includes(owner.confidence)) {
      errors.push(`owner-confidence-invalid:${owner.ownerModuleId}`);
    }
    if (!['exclusive', 'shared', 'ambiguous'].includes(owner.disposition)) {
      errors.push(`owner-disposition-invalid:${owner.ownerModuleId}`);
    }
    if (!owner.typedReason.trim() || owner.evidence.length === 0) {
      errors.push(`owner-evidence-empty:${owner.ownerModuleId}`);
    }
    if (owner.origin === 'path-heuristic' && owner.disposition === 'exclusive') {
      errors.push(`path-heuristic-cannot-authorize-coverage:${owner.ownerModuleId}`);
    }
    if (owner.origin === 'path-heuristic' && owner.confidence !== 'low') {
      errors.push(`path-heuristic-confidence-invalid:${owner.ownerModuleId}`);
    }
    for (const evidence of owner.evidence) {
      if (
        !['package-build-declaration', 'host-port-declaration', 'relative-path-shape'].includes(
          evidence.kind
        )
      ) {
        errors.push(`owner-evidence-kind-invalid:${owner.ownerModuleId}`);
        continue;
      }
      if (evidence.relativePath) {
        try {
          normalizePortableRelativePath(evidence.relativePath, 'ownerEvidence.relativePath');
        } catch {
          errors.push(`owner-evidence-path-invalid:${owner.ownerModuleId}`);
        }
      }
      if (evidence.contentHash) {
        try {
          canonicalHashDigest(evidence.contentHash);
        } catch {
          errors.push(`owner-evidence-hash-invalid:${owner.ownerModuleId}`);
        }
      }
      if (evidence.kind === 'package-build-declaration') {
        if (!evidence.relativePath || !evidence.contentHash) {
          errors.push(`owner-build-evidence-incomplete:${owner.ownerModuleId}`);
          continue;
        }
        if (inventoryByKey && repoId) {
          const evidenceFile = inventoryByKey.get(`${repoId}\u0000${evidence.relativePath}`);
          if (!evidenceFile || evidenceFile.blobSha256 !== evidence.contentHash) {
            errors.push(`owner-build-evidence-not-in-inventory:${owner.ownerModuleId}`);
          }
        }
      }
    }
    if (
      owner.origin === 'package-build-declaration' &&
      owner.evidence.some((evidence) => evidence.kind !== 'package-build-declaration')
    ) {
      errors.push(`owner-build-origin-evidence-mismatch:${owner.ownerModuleId}`);
    }
    if (
      owner.origin === 'path-heuristic' &&
      owner.evidence.some((evidence) => evidence.kind !== 'relative-path-shape')
    ) {
      errors.push(`owner-heuristic-origin-evidence-mismatch:${owner.ownerModuleId}`);
    }
    if (
      owner.origin === 'host-declared' &&
      owner.evidence.some((evidence) => evidence.kind !== 'host-port-declaration')
    ) {
      errors.push(`owner-host-origin-evidence-mismatch:${owner.ownerModuleId}`);
    }
  }
  return { ok: errors.length === 0, errors: uniqueStrings(errors) };
}

function normalizeOwner(owner: ProjectContextInventoryOwnerV2): ProjectContextInventoryOwnerV2 {
  const ownerModuleId = owner.ownerModuleId.trim();
  const typedReason = owner.typedReason.trim();
  if (!ownerModuleId || !typedReason) {
    throw new TypeError('Owner module id and typed reason are required.');
  }
  const evidence = owner.evidence
    .map((row) => ({
      kind: row.kind,
      ...(row.relativePath
        ? { relativePath: normalizePortableRelativePath(row.relativePath, 'owner evidence path') }
        : {}),
      ...(row.contentHash ? { contentHash: row.contentHash } : {}),
    }))
    .sort((left, right) => hashCanonicalJson(left).localeCompare(hashCanonicalJson(right)));
  return { ...owner, ownerModuleId, typedReason, evidence };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
