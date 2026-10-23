import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampObservation, ownershipErrors } from '../scripts/snapshot-state.mjs';
test('无变化刷新保留原checkedAt和baseline，不能伪造新审阅或执行', () => {
  const data = { observationDigest: 'a', sourceDigest: 'b', documents: [{ status: 'matched' }] };
  const first = stampObservation(null, data, 't1');
  const second = stampObservation(first, data, 't2');
  assert.deepEqual(first, second);
  assert.equal(second.checkedAt, 't1');
});
test('连续context-drift仍按实际输入身份改变；缺失恢复与正文变化均新观测', () => {
  const first = stampObservation(
    null,
    { observationDigest: 'c1', documents: [{ status: 'context-drift' }] },
    't1',
  );
  assert.equal(
    stampObservation(
      first,
      { observationDigest: 'c2', documents: [{ status: 'context-drift' }] },
      't2',
    ).checkedAt,
    't2',
  );
  assert.equal(
    stampObservation(
      first,
      { observationDigest: 'missing', documents: [{ status: 'unavailable' }] },
      't3',
    ).checkedAt,
    't3',
  );
});
test('刷新库存不能代替新代码的归属和页面审阅范围', () => {
  const files = ['src/new.ts'];
  assert.ok(ownershipErrors(files, [], []).length);
  assert.ok(
    ownershipErrors(
      files,
      [{ path: 'src/new.ts', topicId: '01' }],
      [{ topicId: '01', sourcePaths: [] }],
    ).length,
  );
  assert.deepEqual(
    ownershipErrors(
      files,
      [{ path: 'src/new.ts', topicId: '01' }],
      [{ topicId: '01', sourcePaths: files }],
    ),
    [],
  );
});
test('原阅读记录必须匹配固定hash，修改或缺失不能被刷新重新绑定', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { readPinnedReview } = await import('../scripts/snapshot-state.mjs');
  const root = mkdtempSync(join(tmpdir(), 'atlas-origin-'));
  try {
    const p = join(root, 'review.json'),
      text = '[{"readLevel":"partial"}]',
      expected = createHash('sha256').update(text).digest('hex');
    writeFileSync(p, text);
    assert.equal(readPinnedReview(p, expected)[0].readLevel, 'partial');
    writeFileSync(p, '[{"readLevel":"full"}]');
    assert.throws(() => readPinnedReview(p, expected), /review-origin-mismatch/);
    assert.throws(() => readPinnedReview(join(root, 'missing'), expected), /original-unavailable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
