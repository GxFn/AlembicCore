import { canonicalHashDigest, hashBytes, normalizePortableRelativePath } from './canonical.js';
import type { CertifiedProjectFactsArtifactV1 } from './contracts.js';

export function readCertifiedProjectFactsFrozenFile(
  artifact: CertifiedProjectFactsArtifactV1,
  input: { repoId: string; relativePath: string }
): Buffer {
  const relativePath = normalizePortableRelativePath(input.relativePath, 'relativePath');
  const frozen = artifact.facts.detail.frozenFiles?.find(
    (row) => row.repoId === input.repoId && row.relativePath === relativePath
  );
  if (!frozen) {
    throw new TypeError(
      `Frozen file is unavailable in the certified artifact: ${input.repoId}/${relativePath}.`
    );
  }
  if (frozen.fullChunkRefs.length !== 1 || frozen.fullChunkRefs[0] !== frozen.blobHash) {
    throw new TypeError(`Frozen file ref is not canonical: ${input.repoId}/${relativePath}.`);
  }
  const chunk = artifact.chunks.find((row) => row.blobHash === frozen.blobHash);
  if (!chunk) {
    throw new TypeError(`Frozen file blob is missing: ${frozen.blobHash}.`);
  }
  const bytes = Buffer.from(chunk.dataBase64, 'base64');
  if (bytes.byteLength !== frozen.byteLength || hashBytes(bytes) !== frozen.blobHash) {
    throw new TypeError(`Frozen file blob failed readback: ${frozen.blobHash}.`);
  }
  return bytes;
}

export function readCertifiedProjectFactsFrozenPage(
  artifact: CertifiedProjectFactsArtifactV1,
  input: { limit: number; continuation?: string }
): {
  files: Array<{
    repoId: string;
    relativePath: string;
    blobHash: string;
    byteLength: number;
    dataBase64: string;
  }>;
  continuation?: `pcf-frozen-page-v2:${string}`;
} {
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new TypeError('Frozen page limit must be a positive integer.');
  }
  const manifestHash = artifact.facts.detail.frozenFileManifestHash;
  if (!manifestHash) {
    throw new TypeError('Artifact has no strict-v2 frozen-file manifest.');
  }
  const digest = canonicalHashDigest(manifestHash);
  const offset = input.continuation ? parseContinuation(input.continuation, digest) : 0;
  const rows = artifact.facts.detail.frozenFiles ?? [];
  const selected = rows.slice(offset, offset + input.limit);
  const nextOffset = offset + selected.length;
  return {
    files: selected.map((row) => ({
      repoId: row.repoId,
      relativePath: row.relativePath,
      blobHash: row.blobHash,
      byteLength: row.byteLength,
      dataBase64: readCertifiedProjectFactsFrozenFile(artifact, row).toString('base64'),
    })),
    ...(nextOffset < rows.length
      ? { continuation: `pcf-frozen-page-v2:${digest}:${nextOffset}` as const }
      : {}),
  };
}

function parseContinuation(value: string, expectedDigest: string): number {
  const match = /^pcf-frozen-page-v2:([a-f0-9]{64}):(\d+)$/.exec(value);
  if (!match || match[1] !== expectedDigest) {
    throw new TypeError('Frozen page continuation does not match this artifact.');
  }
  const offset = Number(match[2]);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError('Frozen page continuation offset is invalid.');
  }
  return offset;
}
