import fs from 'node:fs';
import path from 'node:path';
import {
  type PrivateCorpusRevisionCoordinatesV1,
  WorkspaceResolver,
} from '../../shared/WorkspaceResolver.js';

/** Strict-production implementation detail; no public facade exports this factory. */
export function createPrivateCorpusRevisionResolverInternal(
  base: WorkspaceResolver,
  coordinates: PrivateCorpusRevisionCoordinatesV1
): WorkspaceResolver {
  const runId = validatePrivateRevisionSegment(coordinates.runId, 'runId');
  const revisionId = validatePrivateRevisionSegment(coordinates.revisionId, 'revisionId');
  const dataRoot = path.join(
    base.dataRoot,
    '.asd',
    'context',
    'recipe-runs',
    runId,
    'corpora',
    revisionId
  );
  const confinedParent = path.resolve(base.dataRoot, '.asd', 'context', 'recipe-runs');
  const resolved = path.resolve(dataRoot);
  if (!resolved.startsWith(`${confinedParent}${path.sep}`)) {
    throw new Error('PRIVATE_CORPUS_REVISION_PATH_ESCAPE');
  }
  if (fs.existsSync(resolved)) {
    throw new Error('PRIVATE_CORPUS_REVISION_LEAF_ALREADY_EXISTS');
  }
  const resolver = Object.create(WorkspaceResolver.prototype) as WorkspaceResolver;
  Object.defineProperties(resolver, {
    projectRoot: { value: base.projectRoot, enumerable: true },
    dataRoot: { value: resolved, enumerable: true },
    ghost: { value: true, enumerable: true },
    projectId: { value: base.projectId, enumerable: true },
    projectScope: { value: base.projectScope, enumerable: true },
    currentFolderId: { value: base.currentFolderId, enumerable: true },
    knowledgeBaseDir: { value: base.knowledgeBaseDir, enumerable: true },
    folderNames: { value: base.folderNames, enumerable: true },
  });
  return resolver;
}

function validatePrivateRevisionSegment(value: string, field: string): string {
  const normalized = value.trim();
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(normalized) ||
    normalized === '.' ||
    normalized === '..'
  ) {
    throw new Error(`PRIVATE_CORPUS_REVISION_INVALID_${field.toUpperCase()}`);
  }
  return normalized;
}
