/**
 * RecipeSimilarity embeddingSim 注入 — U5 #6
 *
 * domain 不发起 embed；computeDimensions/compute 接受注入的 embeddingSim，
 * content 维度取 max(tokenJaccard, embeddingSim)：注入时近义改写高于纯 Jaccard，不可用回退 Jaccard（确定）。
 */
import { describe, expect, it } from 'vitest';
import {
  RecipeSimilarity,
  type SimilarityRecipeLike,
} from '../../src/domain/similarity/RecipeSimilarity.js';

const A: SimilarityRecipeLike = {
  title: 'Safe dictionary access',
  doClause: 'Use bd_stringForKey for safe retrieval',
  dontClause: 'Do not use raw objectForKey',
  coreCode: '[dict bd_stringForKey:@"k"]',
  content: { markdown: 'safe dictionary access pattern' },
};
const B: SimilarityRecipeLike = {
  // 近义改写：token 重叠低，但语义相近 → 注入 embedding 应高于纯 Jaccard
  title: 'Protected map value reading',
  doClause: 'Read map entries defensively with helpers',
  dontClause: 'Avoid unguarded key lookups',
  coreCode: '[m guardedValue:@"k"]',
  content: { markdown: 'protected map value reading approach' },
};

describe('RecipeSimilarity embeddingSim injection (U5 #6)', () => {
  it('回退确定性 token Jaccard（不注入 embedding 时）', () => {
    expect(RecipeSimilarity.compute(A, B)).toBe(RecipeSimilarity.compute(A, B)); // 同入同出确定
    const dims = RecipeSimilarity.computeDimensions(A, B);
    expect(dims.content).toBe(RecipeSimilarity.contentTokenSimilarity(A, B));
  });

  it('注入高 embeddingSim 把 content 抬高于纯 Jaccard（近义改写）', () => {
    const tokenContent = RecipeSimilarity.contentTokenSimilarity(A, B);
    const withEmbed = RecipeSimilarity.computeDimensions(A, B, 0.95);
    expect(withEmbed.content).toBe(0.95); // max(token, 0.95)
    expect(withEmbed.content).toBeGreaterThan(tokenContent);
    expect(RecipeSimilarity.compute(A, B, 0.95)).toBeGreaterThan(RecipeSimilarity.compute(A, B));
  });

  it('低 embeddingSim 不退化 content（max 语义，仍回退 Jaccard 下限）', () => {
    const tokenContent = RecipeSimilarity.contentTokenSimilarity(A, B);
    expect(RecipeSimilarity.computeDimensions(A, B, 0).content).toBe(tokenContent);
  });
});
