import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  renameSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha, safeFile, inheritedReview } from './contracts.mjs';
export function assertAppendOnly(previous, current) {
  if (
    current.length < previous.length ||
    previous.some((p, i) => JSON.stringify(p) !== JSON.stringify(current[i]))
  )
    throw Error('review-history-not-append-only');
}
function validateRecord(record, records, expectedId) {
  if (record.id !== expectedId || !/^[A-Za-z0-9-]+$/.test(record.id))
    throw Error('review-record-identity');
  if (
    !record.path ||
    record.path.startsWith('/') ||
    record.path.split('/').includes('..') ||
    !/^[a-f0-9]{64}$/.test(record.sourceSha256)
  )
    throw Error('review-source-identity');
  if (
    !['full', 'partial'].includes(record.readLevel) ||
    !['whole-file', 'selected-symbols'].includes(record.scope) ||
    (record.readLevel === 'full' && record.scope !== 'whole-file')
  )
    throw Error('review-scope');
  for (const k of ['method', 'conclusion', 'responsibility', 'flow'])
    if (typeof record[k] !== 'string' || !record[k].trim()) throw Error(`review-missing:${k}`);
  if (
    typeof record.reviewedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T/.test(record.reviewedAt) ||
    !Number.isFinite(Date.parse(record.reviewedAt)) ||
    Date.parse(record.reviewedAt) > Date.now() + 60000
  )
    throw Error('review-date');
  if (
    record.supersedesId &&
    !records.some((r) => r.id === record.supersedesId && r.path === record.path)
  )
    throw Error('review-supersedes');
}
export function readReviewRecords(root, index) {
  const ids = new Set(),
    records = [];
  for (const ref of index) {
    if (ids.has(ref.id)) throw Error('duplicate-review-id');
    const raw = readFileSync(safeFile(root, ref.path), 'utf8');
    if (sha(raw) !== ref.sha256) throw Error('review-record-digest');
    const record = JSON.parse(raw);
    validateRecord(record, records, ref.id);
    ids.add(record.id);
    records.push({ ...record, rawLedgerRef: ref.path, rawLedgerSha256: ref.sha256 });
  }
  return records;
}
export function selectFileReview(path, currentHash, records) {
  const matching = records.filter((r) => r.path === path && r.sourceSha256 === currentHash);
  if (!matching.length) return null;
  const byId = new Map(records.map((r) => [r.id, r]));
  const descends = (record, id) => {
    const seen = new Set();
    let parent = record.supersedesId;
    while (parent && !seen.has(parent)) {
      if (parent === id) return true;
      seen.add(parent);
      parent = byId.get(parent)?.supersedesId;
    }
    return false;
  };
  const terminal = matching.filter(
    (r) => !matching.some((other) => other.id !== r.id && descends(other, r.id)),
  );
  if (terminal.length !== 1) throw Error(`ambiguous-review:${path}`);
  return terminal[0];
}
export function projectFileReview(prior, currentHash, path, origin, records) {
  const addition = selectFileReview(path, currentHash, records),
    old = inheritedReview(prior, currentHash, origin);
  return {
    readLevel: addition?.readLevel ?? old.readLevel,
    reviewStatus: addition ? 'reviewed' : old.status,
    responsibility: addition?.responsibility ?? prior?.responsibility ?? '待补充阅读记录',
    flow: addition?.flow ?? prior?.flow ?? '尚无继承记录',
    ...(addition
      ? {
          reviewRecordId: addition.id,
          reviewOrigin: addition.rawLedgerRef,
          reviewedAt: addition.reviewedAt,
          reviewMethod: addition.method,
        }
      : {}),
  };
}
// 短时排他锁保护显式追加；遗留锁明确拒绝，调用者先核对原进程而非自动抢占。
export function appendReview(atlas, specPath) {
  const core = resolve(atlas, '..'),
    ledger = resolve(core, '../wakeflow-ledger/AlembicCore');
  const record = JSON.parse(readFileSync(safeFile(atlas, specPath), 'utf8'));
  const indexPath = resolve(atlas, 'reviews/records.json'),
    lockPath = resolve(atlas, 'reviews/.append.lock'),
    temp = indexPath + '.tmp';
  let lock;
  try {
    lock = openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST')
      throw Error('review-append-in-progress: inspect the existing owner before retrying');
    throw error;
  }
  let wroteTemp = false;
  try {
    writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    if (!/^[A-Za-z0-9-]+$/.test(record.id ?? '')) throw Error('review-record-identity');
    if (sha(readFileSync(safeFile(core, record.path))) !== record.sourceSha256)
      throw Error('review-current-source-mismatch');
    const index = JSON.parse(readFileSync(indexPath, 'utf8')),
      previous = readReviewRecords(ledger, index);
    const checkpoint = resolve(atlas, 'data/review-summary.json');
    if (existsSync(checkpoint))
      assertAppendOnly(JSON.parse(readFileSync(checkpoint, 'utf8')).recordHistory ?? [], index);
    validateRecord(record, previous, record.id);
    const raw = JSON.stringify(record, null, 2) + '\n',
      relative = `architecture-atlas/reviews/${record.reviewedAt.slice(0, 10)}/files/${record.id}.json`,
      target = resolve(ledger, relative);
    const ref = { id: record.id, path: relative, sha256: sha(raw) },
      same = index.find((x) => x.id === record.id);
    if (same) {
      if (JSON.stringify(same) !== JSON.stringify(ref)) throw Error('review-id-already-published');
      return { status: 'unchanged', id: record.id };
    }
    // 歧义检查先于任何原始材料发布，失败后仍可修正同一待写ID。
    selectFileReview(record.path, record.sourceSha256, [
      ...previous,
      { ...record, rawLedgerRef: relative, rawLedgerSha256: ref.sha256 },
    ]);
    if (existsSync(target)) {
      if (readFileSync(target, 'utf8') !== raw) throw Error('review-bytes-already-published');
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, raw, { flag: 'wx' });
    }
    const next = [...index, ref];
    readReviewRecords(ledger, next);
    writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' });
    wroteTemp = true;
    renameSync(temp, indexPath);
    wroteTemp = false;
    return { status: 'appended', id: record.id };
  } finally {
    if (wroteTemp && existsSync(temp)) unlinkSync(temp);
    closeSync(lock);
    unlinkSync(lockPath);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const atlas = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const [command, spec] = process.argv.slice(2);
  if (command !== 'append' || !spec)
    throw Error('Usage: reviews.mjs append <Atlas-relative review spec>');
  console.log(JSON.stringify(appendReview(atlas, spec), null, 2));
}
