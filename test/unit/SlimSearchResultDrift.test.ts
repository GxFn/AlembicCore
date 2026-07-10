/**
 * D5(2026-07-11,prime 面 drift 对称):slimSearchResult 瘦身投影的 drift 标注透传回归。
 * G-C P1 给 SearchResultItem 挂了 sourceRefStatus/driftedSourceRefs,但瘦身投影
 * 丢弃了它们——prime 全链(经 SlimSearchResult)因此漂移盲:同一 Recipe 走 search
 * 带 drifted 标注,走 prime 则以无标记 trusted 证据交付 file:line。
 */
import { describe, expect, it } from 'vitest';
import type { SearchResultItem } from '../../src/service/search/SearchTypes.js';
import { slimSearchResult } from '../../src/service/search/SearchTypes.js';

function baseItem(overrides: Partial<SearchResultItem>): SearchResultItem {
  return {
    id: 'r-1',
    title: 'Recipe 标题',
    trigger: '触发词',
    kind: 'pattern',
    language: 'typescript',
    score: 0.8,
    description: '描述',
    ...overrides,
  } as SearchResultItem;
}

describe('slimSearchResult drift 标注透传(D5)', () => {
  it('drifted item:sourceRefStatus 与 driftedSourceRefs 原样过投影', () => {
    const slim = slimSearchResult(
      baseItem({
        sourceRefs: ['lib/a.ts:10-20', 'lib/b.ts:5'],
        driftedSourceRefs: ['lib/a.ts:10-20'],
        sourceRefStatus: 'drifted',
      })
    );
    expect(slim.sourceRefStatus).toBe('drifted');
    expect(slim.driftedSourceRefs).toStrictEqual(['lib/a.ts:10-20']);
    expect(slim.sourceRefs).toStrictEqual(['lib/a.ts:10-20', 'lib/b.ts:5']);
  });

  it('active item:status 透传,不携带空 drifted 子集', () => {
    const slim = slimSearchResult(
      baseItem({ sourceRefs: ['lib/a.ts:1'], sourceRefStatus: 'active' })
    );
    expect(slim.sourceRefStatus).toBe('active');
    expect(slim.driftedSourceRefs).toBeUndefined();
  });

  it('无 refs item:两字段均缺省(不制造假 active)', () => {
    const slim = slimSearchResult(baseItem({}));
    expect(slim.sourceRefStatus).toBeUndefined();
    expect(slim.driftedSourceRefs).toBeUndefined();
  });
});
