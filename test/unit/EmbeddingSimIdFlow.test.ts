/**
 * U5-Core-3 — embedding 全激活：recipe id 流通到 embeddingSimProvider（U5 #6/#7 收尾）。
 *
 * 经 ConsolidationAdvisor.analyze（public，insufficient 路径暴露 coveredBy[].similarity）验证 t2：
 * ①id 流通：注入「按 id 返值」stub provider + 带 id 的 candidate/sessionRecipe → provider 被以带 id 对象调用，
 *   content 走 max(Jaccard,0.9)、similarity 抬升（证不再恒 undefined）；
 * ②无 id 回退：candidate 无 id → provider 收到 undefined id → 返 undefined → 纯 Jaccard（与无 provider 同值）。
 *
 * ProposalExecutor t1（#toRecipeLike 加 id: e.id）站点位于深私有 #selectMostSimilarReplacement（仅整条
 * supersede 执行可达，沿用 U5 #6 grep+build 验证）；RedundancyAnalyzer:131 live 路径由 u5-core-2 conduit 单测覆盖。
 */
import { describe, expect, it } from 'vitest';
import type { RecipeLike } from '../../src/domain/evolution/RecipeSimilarity.js';
import {
  type CandidateForConsolidation,
  ConsolidationAdvisor,
} from '../../src/service/evolution/ConsolidationAdvisor.js';

type Ctor0 = ConstructorParameters<typeof ConsolidationAdvisor>[0];

// #loadRelatedRecipes try/catch 包裹；stub 三法返空 → dbRelated=[]，related=sessionRecipes。
const knowledgeRepoStub = {
  findAllByLifecyclesAndCategory: async () => [],
  findByLifecyclesAndTriggerPrefix: async () => [],
  findAllByLifecycles: async () => [],
} as unknown as Ctor0;

// 已持久化、带 id、有内容的同域 recipe（RecipeSummary）。
const sessionRecipe = {
  id: 'r-1',
  title: 'Existing recipe with content',
  doClause: 'existing do clause text here for overlap',
  dontClause: 'existing dont clause text',
  coreCode: 'function existing(){ return alpha(beta, gamma); }',
  category: 'Net',
  trigger: '@existing',
  whenClause: 'when something happens',
  guardPattern: null,
  content: { markdown: '```ts\nexisting(alpha, beta, gamma)\n```', pattern: 'p' },
};

// 低实质性候选（substance=0 < 0.3 → insufficient 路径）。
const candidateWithId: CandidateForConsolidation = { id: 'cand-1', title: 'zzz minimal' };
const candidateNoId: CandidateForConsolidation = { title: 'zzz minimal' };

function makeByIdProvider() {
  const seen: Array<{ aId?: string; bId?: string }> = [];
  const provider = (a: RecipeLike, b: RecipeLike): number | undefined => {
    seen.push({ aId: a.id, bId: b.id });
    return a.id && b.id ? 0.9 : undefined; // 仅当两侧均带 id（可查预计算向量）时给 0.9
  };
  return { seen, provider };
}

describe('U5-Core-3 embedding id 流通（ConsolidationAdvisor）', () => {
  it('① id 流通：带 id candidate/recipe → provider 被以带 id 对象调用，similarity 走 max(Jaccard,0.9)', async () => {
    const { seen, provider } = makeByIdProvider();
    const withProvider = new ConsolidationAdvisor(knowledgeRepoStub, provider);
    const withoutProvider = new ConsolidationAdvisor(knowledgeRepoStub);

    const resWith = await withProvider.analyze(candidateWithId, {
      sessionRecipes: [sessionRecipe],
    });
    const resWithout = await withoutProvider.analyze(candidateWithId, {
      sessionRecipes: [sessionRecipe],
    });

    expect(resWith.action).toBe('insufficient');
    // provider 被以「candidate.id + recipe.id」调用（证 id 流通、不再恒 undefined）
    expect(seen.some((s) => s.aId === 'cand-1' && s.bId === 'r-1')).toBe(true);
    // 注入 0.9 抬升 content → 整体 similarity 高于纯 Jaccard
    const simWith = resWith.coveredBy?.[0]?.similarity ?? 0;
    const simWithout = resWithout.coveredBy?.[0]?.similarity ?? 0;
    expect(simWith).toBeGreaterThan(simWithout);
  });

  it('② 无 id 回退：candidate 无 id → provider 收到 undefined id → 返 undefined → 纯 Jaccard', async () => {
    const { seen, provider } = makeByIdProvider();
    const withProvider = new ConsolidationAdvisor(knowledgeRepoStub, provider);
    const withoutProvider = new ConsolidationAdvisor(knowledgeRepoStub);

    const resNoId = await withProvider.analyze(candidateNoId, { sessionRecipes: [sessionRecipe] });
    const resPlain = await withoutProvider.analyze(candidateNoId, {
      sessionRecipes: [sessionRecipe],
    });

    // provider 收到 candidate 无 id（undefined）→ 据此返 undefined（不查向量）
    expect(seen.some((s) => s.aId === undefined)).toBe(true);
    // 无 id → 纯 Jaccard，与无 provider 逐值一致（确定性回退）
    expect(resNoId.coveredBy?.[0]?.similarity).toBe(resPlain.coveredBy?.[0]?.similarity);
  });
});
