import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha } from '../scripts/contracts.mjs';
import { readReviewRecords, selectFileReview, assertAppendOnly } from '../scripts/reviews.mjs';
const make = (id, hash, supersedesId = null) => ({
  id,
  path: 'src/a.ts',
  sourceSha256: hash,
  readLevel: 'full',
  scope: 'whole-file',
  method: '完整文件阅读并核对调用边界',
  conclusion: '输入输出与失败责任已核对',
  reviewedAt: '2026-10-23T00:00:00Z',
  responsibility: 'fixture契约',
  flow: '值→调用者',
  supersedesId,
});
test('实际字节变化不会继承旧结论，追加当前版本复核保留旧原始字节', () => {
  const root = mkdtempSync(join(tmpdir(), 'core-atlas-review-'));
  try {
    const old = JSON.stringify(make('R1', sha('A')));
    writeFileSync(join(root, 'one.json'), old);
    let index = [{ id: 'R1', path: 'one.json', sha256: sha(old) }];
    let records = readReviewRecords(root, index);
    assert.equal(selectFileReview('src/a.ts', sha('B'), records), null);
    const next = JSON.stringify(make('R2', sha('B'), 'R1'));
    writeFileSync(join(root, 'two.json'), next);
    const extended = [...index, { id: 'R2', path: 'two.json', sha256: sha(next) }];
    assertAppendOnly(index, extended);
    records = readReviewRecords(root, extended);
    assert.equal(selectFileReview('src/a.ts', sha('B'), records).id, 'R2');
    assert.equal(selectFileReview('src/a.ts', sha('C'), records), null);
    assert.equal(selectFileReview('src/renamed.ts', sha('B'), records), null);
    assert.equal(readFileSync(join(root, 'one.json'), 'utf8'), old);
    assert.throws(() => assertAppendOnly(extended, index), /append/);
    assert.throws(() => assertAppendOnly(extended, [extended[1], extended[0]]), /append/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('原记录改写、scope冒充full和同字节无继承冲突均拒绝', () => {
  const root = mkdtempSync(join(tmpdir(), 'core-atlas-review-'));
  try {
    const record = make('R1', sha('A')),
      raw = JSON.stringify(record);
    writeFileSync(join(root, 'one.json'), raw);
    const index = [{ id: 'R1', path: 'one.json', sha256: sha(raw) }];
    writeFileSync(join(root, 'one.json'), raw + ' ');
    assert.throws(() => readReviewRecords(root, index), /digest/);
    writeFileSync(join(root, 'one.json'), JSON.stringify({ ...record, scope: 'selected-symbols' }));
    assert.throws(
      () =>
        readReviewRecords(root, [
          { ...index[0], sha256: sha(readFileSync(join(root, 'one.json'))) },
        ]),
      /scope/,
    );
    assert.throws(
      () => selectFileReview('src/a.ts', sha('A'), [record, make('R2', sha('A'))]),
      /ambiguous/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
import { projectFileReview } from '../scripts/reviews.mjs';
test('文件判断投影绑定本次记录，不能新级别配旧职责或把变动源提升为已审', () => {
  const prior = {
    sha256: sha('A'),
    readLevel: 'partial',
    responsibility: '旧职责',
    flow: '旧流程',
  };
  const records = [make('R1', sha('B'))];
  const fresh = projectFileReview(prior, sha('B'), 'src/a.ts', 'old.json', records);
  assert.equal(fresh.reviewStatus, 'reviewed');
  assert.equal(fresh.reviewRecordId, 'R1');
  assert.equal(fresh.responsibility, 'fixture契约');
  const changed = projectFileReview(prior, sha('C'), 'src/a.ts', 'old.json', records);
  assert.equal(changed.reviewStatus, 'source-changed');
  assert.equal(changed.readLevel, 'partial');
  assert.equal(changed.responsibility, '旧职责');
});
