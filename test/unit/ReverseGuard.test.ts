/**
 * ReverseGuard 单元测试
 *
 * 反向验证 Recipe/Rule 是否仍然匹配当前代码事实。
 */
import { describe, expect, it, vi } from 'vitest';
import { ReverseGuard } from '../../src/service/guard/ReverseGuard.js';

type ReverseGuardKnowledgeRepo = ConstructorParameters<typeof ReverseGuard>[0];
type ReverseGuardEntityRepo = ConstructorParameters<typeof ReverseGuard>[1];
type ReverseGuardSourceRefRepo = ConstructorParameters<typeof ReverseGuard>[2];
type ReverseGuardSignalBus = NonNullable<
  NonNullable<ConstructorParameters<typeof ReverseGuard>[3]>['signalBus']
>;

interface MockRecipeRow {
  id: string;
  title: string;
  core_code: string | null;
  guard_pattern: string | null;
  stats: string | null;
}

function createMockRepos(
  options: {
    recipes?: MockRecipeRow[];
    codeEntities?: string[];
    guardHits?: Record<string, number>;
    staleSourceRefs?: Record<string, string[]>;
  } = {}
) {
  const { recipes = [], codeEntities = [], guardHits = {}, staleSourceRefs = {} } = options;
  const entitySet = new Set(codeEntities);

  const knowledgeRepo = {
    findActiveRulesWithContentSync() {
      return recipes.map((r) => ({
        id: r.id,
        title: r.title,
        coreCode: r.core_code,
        guardPattern: r.guard_pattern,
        stats: r.stats,
      }));
    },
    getGuardHitsSync(id: string) {
      return guardHits[id] ?? 0;
    },
  } as unknown as ReverseGuardKnowledgeRepo;

  const entityRepo = {
    existsByName(name: string) {
      return entitySet.has(name);
    },
  } as unknown as ReverseGuardEntityRepo;

  const sourceRefRepo = {
    findByRecipeId(recipeId: string) {
      const paths = staleSourceRefs[recipeId] ?? [];
      return paths.map((sourcePath) => ({ sourcePath, status: 'stale' }));
    },
  } as unknown as ReverseGuardSourceRefRepo;

  return { knowledgeRepo, entityRepo, sourceRefRepo };
}

describe('ReverseGuard', () => {
  it('returns healthy for recipe with no drift', () => {
    const { knowledgeRepo, entityRepo, sourceRefRepo } = createMockRepos({
      codeEntities: ['BDNetworkManager', 'URLSession'],
    });
    const guard = new ReverseGuard(knowledgeRepo, entityRepo, sourceRefRepo);

    const result = guard.checkRecipe(
      {
        id: 'r1',
        title: 'Network Rule',
        core_code: 'BDNetworkManager.shared().request()',
        guard_pattern: null,
        stats: null,
      },
      []
    );

    expect(result.recommendation).toBe('healthy');
    expect(result.signals).toHaveLength(0);
  });

  it('detects symbol_missing when coreCode references removed symbols', () => {
    const { knowledgeRepo, entityRepo, sourceRefRepo } = createMockRepos({ codeEntities: [] });
    const guard = new ReverseGuard(knowledgeRepo, entityRepo, sourceRefRepo);

    const result = guard.checkRecipe(
      {
        id: 'r1',
        title: 'Deprecated API Rule',
        core_code: 'BDOldManager.doSomething()',
        guard_pattern: null,
        stats: null,
      },
      []
    );

    expect(result.signals[0]?.type).toBe('symbol_missing');
    expect(result.signals[0]?.severity).toBe('high');
    expect(result.recommendation).toBe('investigate');
  });

  it('detects zero_match when guard pattern matches nothing', () => {
    const { knowledgeRepo, entityRepo, sourceRefRepo } = createMockRepos();
    const guard = new ReverseGuard(knowledgeRepo, entityRepo, sourceRefRepo);

    const result = guard.checkRecipe(
      {
        id: 'r1',
        title: 'Pattern Rule',
        core_code: null,
        guard_pattern: 'dispatch_sync\\s*\\([^)]*main',
        stats: null,
      },
      [
        { path: 'file1.m', content: 'void doSomething() { return; }' },
        { path: 'file2.m', content: 'int main() { return 0; }' },
      ]
    );

    expect(result.signals.some((signal) => signal.type === 'zero_match')).toBe(true);
  });

  it('detects match_rate_drop when historical hits are much higher', () => {
    const { knowledgeRepo, entityRepo, sourceRefRepo } = createMockRepos({
      guardHits: { r1: 100 },
    });
    const guard = new ReverseGuard(knowledgeRepo, entityRepo, sourceRefRepo);

    const result = guard.checkRecipe(
      {
        id: 'r1',
        title: 'Drop Rule',
        core_code: null,
        guard_pattern: 'TODO',
        stats: null,
      },
      [{ path: 'a.m', content: '// TODO: fix this\n// TODO: refactor' }]
    );

    expect(result.signals.some((signal) => signal.type === 'match_rate_drop')).toBe(true);
  });

  it('recommends decay when multiple high-severity signals exist', () => {
    const { knowledgeRepo, entityRepo, sourceRefRepo } = createMockRepos({ codeEntities: [] });
    const guard = new ReverseGuard(knowledgeRepo, entityRepo, sourceRefRepo);

    const result = guard.checkRecipe(
      {
        id: 'r1',
        title: 'Multi Drift',
        core_code: 'BDOldClass.method()\nBDRemovedHelper.run()',
        guard_pattern: 'NEVER_MATCH_THIS_UNIQUE_STRING_12345',
        stats: null,
      },
      [{ path: 'a.swift', content: 'let x = 1' }]
    );

    expect(result.recommendation).toBe('decay');
  });

  it('emits signal to SignalBus on drift', () => {
    const signalBus = { send: vi.fn() } as unknown as ReverseGuardSignalBus;
    const { knowledgeRepo, entityRepo, sourceRefRepo } = createMockRepos({ codeEntities: [] });
    const guard = new ReverseGuard(knowledgeRepo, entityRepo, sourceRefRepo, { signalBus });

    guard.checkRecipe(
      {
        id: 'r1',
        title: 'Signal Test',
        core_code: 'BDMissing.doIt()',
        guard_pattern: null,
        stats: null,
      },
      []
    );

    expect(signalBus.send).toHaveBeenCalledWith(
      'quality',
      'ReverseGuard',
      expect.any(Number),
      expect.objectContaining({ target: 'r1' })
    );
  });

  it('batch audits all active rule recipes', () => {
    const { knowledgeRepo, entityRepo, sourceRefRepo } = createMockRepos({
      recipes: [
        { id: 'r1', title: 'Rule 1', core_code: null, guard_pattern: 'TODO', stats: null },
        { id: 'r2', title: 'Rule 2', core_code: null, guard_pattern: 'FIXME', stats: null },
      ],
    });
    const guard = new ReverseGuard(knowledgeRepo, entityRepo, sourceRefRepo);

    const results = guard.auditAllRules([
      { path: 'a.m', content: '// TODO: fix\n// FIXME: broken' },
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.recommendation === 'healthy')).toBe(true);
  });

  it('detects stale source refs', () => {
    const { knowledgeRepo, entityRepo, sourceRefRepo } = createMockRepos({
      codeEntities: ['BDNetworkManager'],
      staleSourceRefs: {
        r1: ['Sources/Old/Removed.swift', 'Sources/Old/Gone.swift', 'Sources/Old/Missing.swift'],
      },
    });
    const guard = new ReverseGuard(knowledgeRepo, entityRepo, sourceRefRepo);

    const result = guard.checkRecipe(
      {
        id: 'r1',
        title: 'Stale Refs Rule',
        core_code: 'BDNetworkManager.shared()',
        guard_pattern: null,
        stats: null,
      },
      []
    );

    const staleSignal = result.signals.find((signal) => signal.type === 'source_ref_stale');
    expect(staleSignal?.severity).toBe('high');
    expect(staleSignal?.detail).toContain('3 source file(s)');
  });
});
