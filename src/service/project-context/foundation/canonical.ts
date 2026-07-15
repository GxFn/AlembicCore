import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  CanonicalSha256,
  ProjectFactsJson,
  SourceRevisionVectorEntryV1,
  SourceRevisionVectorV1,
} from './contracts.js';
import { SOURCE_REVISION_VECTOR_VERSION } from './contracts.js';

export function toProjectFactsJson(value: unknown): ProjectFactsJson {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON does not accept non-finite numbers.');
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => (entry === undefined ? null : toProjectFactsJson(entry)));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, ProjectFactsJson> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) {
        result[key] = toProjectFactsJson(entry);
      }
    }
    return result;
  }
  throw new TypeError(`Canonical JSON does not accept values of type ${typeof value}.`);
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(toProjectFactsJson(value));
}

export function hashCanonicalJson(value: unknown): CanonicalSha256 {
  return `sha256:${createHash('sha256').update(canonicalJsonStringify(value)).digest('hex')}`;
}

export function hashBytes(value: Uint8Array): CanonicalSha256 {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function canonicalHashDigest(hash: CanonicalSha256): string {
  const match = /^sha256:([a-f0-9]{64})$/.exec(hash);
  if (!match) {
    throw new TypeError(`Invalid canonical SHA-256 value: ${hash}`);
  }
  return match[1];
}

export function normalizePortableRelativePath(value: string, fieldName = 'path'): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized === '~' ||
    normalized.startsWith('~/')
  ) {
    throw new TypeError(`${fieldName} must be a non-empty portable relative path.`);
  }
  const parts = normalized.split('/');
  if (parts.some((part) => part === '..' || part === '')) {
    throw new TypeError(`${fieldName} must not escape its approved source root.`);
  }
  return normalized === '.' ? '.' : parts.filter((part) => part !== '.').join('/');
}

export function buildSourceRevisionVectorV1(
  entries: readonly SourceRevisionVectorEntryV1[]
): SourceRevisionVectorV1 {
  const normalized = entries
    .map((entry) => normalizeSourceRevisionVectorEntry(entry))
    .sort(compareSourceRevisionEntries);
  const keys = new Set<string>();
  for (const entry of normalized) {
    const key = `${entry.scopeId}\u0000${entry.repoId}\u0000${entry.relativeRoot}`;
    if (keys.has(key)) {
      throw new TypeError(`Duplicate SourceRevisionVectorV1 entry: ${entry.repoId}.`);
    }
    keys.add(key);
  }
  const semantic = {
    kind: 'SourceRevisionVectorV1' as const,
    version: SOURCE_REVISION_VECTOR_VERSION,
    entries: normalized,
  };
  return {
    ...semantic,
    sourceVectorHash: hashCanonicalJson(semantic),
  };
}

function normalizeSourceRevisionVectorEntry(
  entry: SourceRevisionVectorEntryV1
): SourceRevisionVectorEntryV1 {
  const scopeId = requireIdentifier(entry.scopeId, 'scopeId');
  const repoId = requireIdentifier(entry.repoId, 'repoId');
  const relativeRoot = normalizePortableRelativePath(entry.relativeRoot, 'relativeRoot');
  canonicalHashDigest(entry.eligibleInventoryHash);
  canonicalHashDigest(entry.includeExcludePolicyHash);
  if (entry.revision.kind === 'git-clean') {
    requireGitObjectId(entry.revision.commitId, 'commitId');
    requireGitObjectId(entry.revision.treeId, 'treeId');
  } else if (entry.revision.kind === 'git-dirty') {
    if (entry.revision.commitId !== null) {
      requireGitObjectId(entry.revision.commitId, 'commitId');
    }
    if (entry.revision.treeId !== null) {
      requireGitObjectId(entry.revision.treeId, 'treeId');
    }
    canonicalHashDigest(entry.revision.workingTreeContentHash);
  } else {
    canonicalHashDigest(entry.revision.workingTreeContentHash);
  }
  return {
    ...entry,
    scopeId,
    repoId,
    relativeRoot,
  };
}

function compareSourceRevisionEntries(
  left: SourceRevisionVectorEntryV1,
  right: SourceRevisionVectorEntryV1
): number {
  return (
    left.scopeId.localeCompare(right.scopeId) ||
    left.repoId.localeCompare(right.repoId) ||
    left.relativeRoot.localeCompare(right.relativeRoot)
  );
}

function requireIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized || /[\\/]/.test(normalized)) {
    throw new TypeError(`${fieldName} must be a stable identifier, not a path.`);
  }
  return normalized;
}

function requireGitObjectId(value: string, fieldName: string): void {
  if (!/^[a-f0-9]{40,64}$/i.test(value)) {
    throw new TypeError(`${fieldName} must be a Git object id.`);
  }
}
