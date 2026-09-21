import path from 'node:path';
import {
  type ProjectInputSnapshot,
  ReplayProjectSourceReader,
} from '../../../infrastructure/io/ProjectInputSnapshot.js';
import { canonicalHashDigest } from '../../../shared/canonicalJson.js';
import type {
  CanonicalSha256,
  CertifiedProjectFactsChunkV1,
  ProjectContextInputClosureV1,
} from './contracts.js';

/** 只冻结支持输入的引用；完整字节按 hash 进入已有 chunk 池，不再复制到 facts 中。 */
export function freezeProjectContextInputClosure(
  snapshot: ProjectInputSnapshot,
  replayOutputHash: CanonicalSha256
): { closure: ProjectContextInputClosureV1; chunks: CertifiedProjectFactsChunkV1[] } {
  const { blobs, ...metadata } = structuredClone(snapshot);
  const closure: ProjectContextInputClosureV1 = {
    version: 1,
    snapshot: {
      ...metadata,
      blobs: blobs.map(({ hash, byteLength }) => ({ hash, byteLength })),
    },
    replayOutputHash,
  };
  const chunks = blobs
    .map(({ hash, byteLength, dataBase64 }) => ({ blobHash: hash, byteLength, dataBase64 }))
    .sort((left, right) => left.blobHash.localeCompare(right.blobHash));
  // 冻结与恢复走同一校验入口，不能让两套 snapshot 格式规则分叉。
  hydrateProjectContextInputClosure(closure, chunks);
  return { closure, chunks };
}

/**
 * 从已有 chunk 池恢复并校验完整 snapshot；也是 artifact verifier 的闭包校验入口。
 * 池中允许存在 detail/source 的其他 chunks；这里只连接并校验该闭包实际引用的字节。
 */
export function hydrateProjectContextInputClosure(
  closure: ProjectContextInputClosureV1,
  chunks: readonly CertifiedProjectFactsChunkV1[]
): ProjectInputSnapshot {
  if (closure?.version !== 1) {
    throw new TypeError('Unsupported project context input closure version.');
  }
  canonicalHashDigest(closure.replayOutputHash);
  const references = closure.snapshot?.blobs;
  if (!Array.isArray(references)) {
    throw new TypeError('Project context input closure requires a blob reference table.');
  }
  const lengths = new Map<CanonicalSha256, number>();
  for (const reference of references) {
    canonicalHashDigest(reference.hash);
    if (!Number.isSafeInteger(reference.byteLength) || reference.byteLength < 0) {
      throw new TypeError('Project context input closure has an invalid blob length.');
    }
    if ('dataBase64' in reference) {
      throw new TypeError('Project context input closure must reference chunks, not inline bytes.');
    }
    if (lengths.has(reference.hash)) {
      throw new TypeError(`Duplicate project context input blob reference: ${reference.hash}.`);
    }
    lengths.set(reference.hash, reference.byteLength);
  }
  const byHash = new Map<CanonicalSha256, CertifiedProjectFactsChunkV1>();
  for (const chunk of chunks) {
    if (!lengths.has(chunk.blobHash)) {
      continue;
    }
    if (typeof chunk.dataBase64 !== 'string' || chunk.byteLength !== lengths.get(chunk.blobHash)) {
      throw new TypeError(
        `Project context input chunk metadata does not match: ${chunk.blobHash}.`
      );
    }
    const previous = byHash.get(chunk.blobHash);
    if (
      previous &&
      !Buffer.from(previous.dataBase64, 'base64').equals(Buffer.from(chunk.dataBase64, 'base64'))
    ) {
      throw new TypeError(`Project context input chunk has conflicting bytes: ${chunk.blobHash}.`);
    }
    byHash.set(chunk.blobHash, chunk);
  }
  const snapshot: ProjectInputSnapshot = {
    ...structuredClone(closure.snapshot),
    blobs: references.map(({ hash, byteLength }) => {
      const chunk = byHash.get(hash);
      if (!chunk) {
        throw new TypeError(`Project context input chunk is missing: ${hash}.`);
      }
      return { hash, byteLength, dataBase64: chunk.dataBase64 };
    }),
  };
  // Replay 构造只解码内存记录并校验 hash/引用/结构；虚拟 roots 永远不物化，也不查 FS。
  const padding = 'scope/'.repeat(maxParentSegments(snapshot) + 1);
  new ReplayProjectSourceReader(
    snapshot,
    snapshot.roots.map((root, index) => ({
      id: root.id,
      path: path.resolve('/__alembic_input_closure_validation__', String(index), padding),
    }))
  ).assertComplete();
  return snapshot;
}

/** 辅助输入可在源码 root 之外；给每个虚拟 root 独立祖先，避免合法 ../ 引用被误判重叠。 */
function maxParentSegments(snapshot: ProjectInputSnapshot): number {
  let depth = 0;
  const pending: unknown[] = [snapshot];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) {
      continue;
    }
    seen.add(value);
    if ('relativePath' in value && typeof value.relativePath === 'string') {
      depth = Math.max(depth, value.relativePath.split('/').filter((part) => part === '..').length);
    }
    for (const child of Object.values(value)) {
      pending.push(child);
    }
  }
  return depth;
}
