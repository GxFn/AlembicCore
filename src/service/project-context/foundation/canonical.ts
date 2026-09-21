import path from 'node:path';
import { canonicalHashDigest, hashCanonicalJson } from '../../../shared/canonicalJson.js';

export {
  canonicalHashDigest,
  canonicalJsonStringify,
  hashBytes,
  hashCanonicalJson,
  toCanonicalJson as toProjectFactsJson,
} from '../../../shared/canonicalJson.js';

import type {
  CanonicalSha256,
  SourceRevisionVectorEntryV1,
  SourceRevisionVectorV1,
} from './contracts.js';
import { SOURCE_REVISION_VECTOR_VERSION } from './contracts.js';

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
  entries: readonly SourceRevisionVectorEntryV1[],
  inputClosureHash?: CanonicalSha256
): SourceRevisionVectorV1 {
  if (inputClosureHash !== undefined) {
    canonicalHashDigest(inputClosureHash);
  }
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
    ...(inputClosureHash === undefined ? {} : { inputClosureHash }),
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
