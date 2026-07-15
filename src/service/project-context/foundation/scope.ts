import fs from 'node:fs';
import path from 'node:path';
import { hashCanonicalJson, normalizePortableRelativePath } from './canonical.js';
import {
  type AcceptedProjectScopeDeclarationV1,
  PROJECT_SCOPE_MANIFEST_VERSION,
  type ProjectScopeCaptureBindingV1,
  type ProjectScopeManifestV1,
} from './contracts.js';

export function buildProjectScopeManifestV1(input: {
  acceptedScope: AcceptedProjectScopeDeclarationV1;
  /** Runtime-only accepted control root; never enters the manifest or a semantic hash. */
  controlRoot: string;
  sourceRoots: Array<{ repoId: string; sourceRoot: string }>;
}): ProjectScopeCaptureBindingV1 {
  const projectMode = requireOpaqueIdentifier(input.acceptedScope.projectMode, 'projectMode');
  const projectIdentity = {
    projectId: requireOpaqueIdentifier(
      input.acceptedScope.projectIdentity.projectId,
      'projectIdentity.projectId'
    ),
    scopeId: requireOpaqueIdentifier(
      input.acceptedScope.projectIdentity.scopeId,
      'projectIdentity.scopeId'
    ),
  };
  if (input.acceptedScope.repositories.length === 0) {
    throw new TypeError('Accepted project scope must contain at least one repository.');
  }
  const repoIds = new Set<string>();
  const repositories = input.acceptedScope.repositories
    .map((repository) => {
      const repoId = requireOpaqueIdentifier(repository.repoId, 'repoId');
      if (repoIds.has(repoId)) {
        throw new TypeError(`Duplicate accepted scope repository: ${repoId}.`);
      }
      repoIds.add(repoId);
      return {
        scopeId: projectIdentity.scopeId,
        repoId,
        relativeRoot: normalizePortableRelativePath(repository.relativeRoot, 'relativeRoot'),
      };
    })
    .sort(compareRepositories);
  const acceptedDeclaration = {
    projectMode,
    projectIdentity,
    repositories: repositories.map(({ repoId, relativeRoot }) => ({ repoId, relativeRoot })),
  };
  const acceptedDeclarationHash = hashCanonicalJson(acceptedDeclaration);
  const scopeSemantic = {
    kind: 'ProjectScopeManifestV1' as const,
    version: PROJECT_SCOPE_MANIFEST_VERSION,
    projectMode,
    projectIdentity,
    repositories,
    acceptedDeclarationHash,
  };
  const canonicalScopeHash = hashCanonicalJson(scopeSemantic);
  const receiptSemantic = { ...scopeSemantic, canonicalScopeHash };
  const manifest: ProjectScopeManifestV1 = {
    ...receiptSemantic,
    receiptHash: hashCanonicalJson(receiptSemantic),
  };
  verifyProjectScopeManifestV1(manifest);

  const controlRoot = resolveExistingRoot(input.controlRoot, 'controlRoot');
  const roots = new Map<string, string>();
  for (const binding of input.sourceRoots) {
    const repoId = requireOpaqueIdentifier(binding.repoId, 'sourceRoots.repoId');
    if (roots.has(repoId)) {
      throw new TypeError(`Duplicate source-root binding: ${repoId}.`);
    }
    roots.set(repoId, resolveExistingRoot(binding.sourceRoot, `sourceRoot:${repoId}`));
  }
  if (
    roots.size !== repositories.length ||
    repositories.some((repository) => !roots.has(repository.repoId))
  ) {
    throw new TypeError('Source-root bindings must exactly conserve the accepted scope repo set.');
  }
  for (const repository of repositories) {
    const expectedRoot = resolveExistingRoot(
      path.resolve(controlRoot, repository.relativeRoot),
      `controlRoot/relativeRoot:${repository.repoId}`
    );
    if (roots.get(repository.repoId) !== expectedRoot) {
      throw new TypeError(
        `Source-root binding must equal controlRoot/relativeRoot for ${repository.repoId}.`
      );
    }
    if (expectedRoot !== controlRoot && !expectedRoot.startsWith(`${controlRoot}${path.sep}`)) {
      throw new TypeError(
        `Source-root binding escapes the accepted control root: ${repository.repoId}.`
      );
    }
  }
  const binding: ProjectScopeCaptureBindingV1 = {
    manifest,
    controlRoot,
    repositories: repositories.map((repository) => ({
      ...repository,
      sourceRoot: roots.get(repository.repoId)!,
    })),
  };
  verifyProjectScopeCaptureBindingV1(binding);
  return binding;
}

export function verifyProjectScopeCaptureBindingV1(binding: ProjectScopeCaptureBindingV1): void {
  verifyProjectScopeManifestV1(binding.manifest);
  const controlRoot = resolveExistingRoot(binding.controlRoot, 'controlRoot');
  const actualRows = binding.repositories
    .map(({ sourceRoot, ...repository }) => ({
      ...repository,
      sourceRoot: resolveExistingRoot(sourceRoot, `sourceRoot:${repository.repoId}`),
    }))
    .sort(compareRepositories);
  const expectedRows = binding.manifest.repositories.map((repository) => ({
    ...repository,
    sourceRoot: resolveExistingRoot(
      path.resolve(controlRoot, repository.relativeRoot),
      `controlRoot/relativeRoot:${repository.repoId}`
    ),
  }));
  for (const row of expectedRows) {
    if (row.sourceRoot !== controlRoot && !row.sourceRoot.startsWith(`${controlRoot}${path.sep}`)) {
      throw new TypeError(`Runtime source-root escapes the accepted control root: ${row.repoId}.`);
    }
  }
  if (hashCanonicalJson(actualRows) !== hashCanonicalJson(expectedRows)) {
    throw new TypeError('Runtime source-root bindings do not match the accepted scope receipt.');
  }
  const realRoots = actualRows.map((row) => row.sourceRoot);
  if (new Set(realRoots).size !== realRoots.length) {
    throw new TypeError('Accepted repositories must not alias the same runtime source root.');
  }
}

export function verifyProjectScopeManifestV1(manifest: ProjectScopeManifestV1): void {
  try {
    const rebuilt = buildManifestSemantic(manifest);
    if (
      rebuilt.acceptedDeclarationHash !== manifest.acceptedDeclarationHash ||
      rebuilt.canonicalScopeHash !== manifest.canonicalScopeHash ||
      rebuilt.receiptHash !== manifest.receiptHash
    ) {
      throw new TypeError('hash mismatch');
    }
  } catch (error) {
    throw new TypeError(
      `Project scope manifest is not canonical: ${error instanceof Error ? error.message : String(error)}.`
    );
  }
}

function buildManifestSemantic(manifest: ProjectScopeManifestV1): {
  acceptedDeclarationHash: ProjectScopeManifestV1['acceptedDeclarationHash'];
  canonicalScopeHash: ProjectScopeManifestV1['canonicalScopeHash'];
  receiptHash: ProjectScopeManifestV1['receiptHash'];
} {
  if (manifest.kind !== 'ProjectScopeManifestV1' || manifest.version !== 1) {
    throw new TypeError('unsupported kind/version');
  }
  const projectMode = requireOpaqueIdentifier(manifest.projectMode, 'projectMode');
  const projectIdentity = {
    projectId: requireOpaqueIdentifier(manifest.projectIdentity.projectId, 'projectId'),
    scopeId: requireOpaqueIdentifier(manifest.projectIdentity.scopeId, 'scopeId'),
  };
  const keys = new Set<string>();
  const repoIds = new Set<string>();
  const repositories = manifest.repositories.map((repository) => {
    const normalized = {
      scopeId: requireOpaqueIdentifier(repository.scopeId, 'scopeId'),
      repoId: requireOpaqueIdentifier(repository.repoId, 'repoId'),
      relativeRoot: normalizePortableRelativePath(repository.relativeRoot, 'relativeRoot'),
    };
    if (normalized.scopeId !== projectIdentity.scopeId) {
      throw new TypeError('repository scopeId mismatch');
    }
    const key = `${normalized.scopeId}\u0000${normalized.repoId}\u0000${normalized.relativeRoot}`;
    if (keys.has(key)) {
      throw new TypeError('duplicate repository tuple');
    }
    if (repoIds.has(normalized.repoId)) {
      throw new TypeError('duplicate repository id');
    }
    keys.add(key);
    repoIds.add(normalized.repoId);
    return normalized;
  });
  const ordered = [...repositories].sort(compareRepositories);
  if (hashCanonicalJson(ordered) !== hashCanonicalJson(repositories)) {
    throw new TypeError('repository tuples are not canonically sorted');
  }
  const acceptedDeclarationHash = hashCanonicalJson({
    projectMode,
    projectIdentity,
    repositories: ordered.map(({ repoId, relativeRoot }) => ({ repoId, relativeRoot })),
  });
  const scopeSemantic = {
    kind: 'ProjectScopeManifestV1' as const,
    version: PROJECT_SCOPE_MANIFEST_VERSION,
    projectMode,
    projectIdentity,
    repositories: ordered,
    acceptedDeclarationHash,
  };
  const canonicalScopeHash = hashCanonicalJson(scopeSemantic);
  return {
    acceptedDeclarationHash,
    canonicalScopeHash,
    receiptHash: hashCanonicalJson({ ...scopeSemantic, canonicalScopeHash }),
  };
}

function compareRepositories(
  left: ProjectScopeManifestV1['repositories'][number],
  right: ProjectScopeManifestV1['repositories'][number]
): number {
  return (
    left.scopeId.localeCompare(right.scopeId) ||
    left.repoId.localeCompare(right.repoId) ||
    left.relativeRoot.localeCompare(right.relativeRoot)
  );
}

function requireOpaqueIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized || normalized !== value || /[\\/]/.test(normalized)) {
    throw new TypeError(`${fieldName} must be a canonical opaque identifier.`);
  }
  return normalized;
}

function resolveExistingRoot(value: string, fieldName: string): string {
  if (!path.isAbsolute(value)) {
    throw new TypeError(`${fieldName} must be absolute for host access.`);
  }
  try {
    const resolved = fs.realpathSync.native(path.resolve(value));
    if (!fs.statSync(resolved).isDirectory()) {
      throw new TypeError(`${fieldName} must resolve to a directory.`);
    }
    return resolved;
  } catch (error) {
    throw new TypeError(`${fieldName} must resolve to an existing directory.`, { cause: error });
  }
}
