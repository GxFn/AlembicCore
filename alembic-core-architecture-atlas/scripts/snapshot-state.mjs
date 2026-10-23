import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
export function writeIfChanged(path, text) {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return false;
  writeFileSync(path, text);
  return true;
}
export function stampObservation(previous, next, checkedAt = new Date().toISOString()) {
  const { checkedAt: oldTime, ...old } = previous ?? {};
  return { ...next, checkedAt: JSON.stringify(old) === JSON.stringify(next) ? oldTime : checkedAt };
}
export function ownershipErrors(paths, assignments, documents) {
  const errors = [],
    owners = new Map();
  for (const a of assignments) {
    if (owners.has(a.path)) errors.push(`duplicate-owner:${a.path}`);
    owners.set(a.path, a.topicId);
    if (!paths.includes(a.path)) errors.push(`missing-owned-file:${a.path}`);
    const doc = documents.find(
      (d) => d.topicId === a.topicId && !['historical', 'target-design'].includes(d.truthKind),
    );
    if (!doc?.sourcePaths.includes(a.path)) errors.push(`owner-outside-reviewed-inputs:${a.path}`);
  }
  for (const path of paths.filter(
    (p) =>
      p.startsWith('src/') ||
      (p.startsWith('scripts/') && p.endsWith('.mjs')) ||
      p === 'resources/codegraph/native-worker.mjs',
  ))
    if (!owners.has(path)) errors.push(`missing-owner:${path}`);
  return errors;
}
export function readPinnedReview(path, expected) {
  if (!expected) throw Error('review-origin-unpinned');
  if (!existsSync(path)) throw Error('review-origin-original-unavailable');
  const text = readFileSync(path, 'utf8');
  if (createHash('sha256').update(text).digest('hex') !== expected)
    throw Error('review-origin-mismatch');
  return JSON.parse(text);
}
