/**
 * Guard immune system integration
 *
 * 覆盖 Guard 免疫闭环中的 uncertainty、反馈确认和学习器。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GuardCheckEngine } from '../src/service/guard/GuardCheckEngine.js';
import { GuardFeedbackLoop } from '../src/service/guard/GuardFeedbackLoop.js';
import { RuleLearner } from '../src/service/guard/RuleLearner.js';
import { UncertaintyCollector } from '../src/service/guard/UncertaintyCollector.js';

type GuardEngineDb = ConstructorParameters<typeof GuardCheckEngine>[0];
type RuleLearnerSignalBus = NonNullable<
  NonNullable<ConstructorParameters<typeof RuleLearner>[1]>['signalBus']
>;

function createMockDb(): GuardEngineDb {
  return {
    prepare() {
      return {
        all() {
          return [];
        },
        get() {
          return undefined;
        },
        run() {
          return {};
        },
      };
    },
    exec() {},
  } as GuardEngineDb;
}

describe('Guard immune system integration', () => {
  it('wires UncertaintyCollector into GuardCheckEngine batch reports', () => {
    const engine = new GuardCheckEngine(createMockDb());
    const result = engine.auditFiles([
      { path: 'a.js', content: 'console.log("hello");' },
      { path: 'b.swift', content: 'let x = try! something()' },
    ]);

    expect(engine.getUncertaintyCollector()).toBeInstanceOf(UncertaintyCollector);
    expect(result.capabilityReport).toBeDefined();
    expect(result.files.every((file) => Array.isArray(file.uncertainResults))).toBe(true);
    expect(result.summary.totalUncertain).toBeGreaterThanOrEqual(0);
  });

  it('auto-confirms Recipe usage when previous violations disappear', () => {
    const violationsStore = {
      getRunsByFile() {
        return [
          {
            violations: [
              { ruleId: 'no-eval', fixSuggestion: 'recipe:safe-eval-alternative' },
              { ruleId: 'no-console', fixSuggestion: 'recipe:logger-pattern' },
            ],
          },
        ];
      },
    };
    const confirmations: Array<{ action: string; recipeId: string }> = [];
    const feedbackCollector = {
      record(action: string, recipeId: string) {
        confirmations.push({ action, recipeId });
      },
    };

    const loop = new GuardFeedbackLoop(violationsStore, feedbackCollector);
    const fixed = loop.processFixDetection(
      { violations: [{ ruleId: 'no-console' }] },
      'src/utils.js'
    );

    expect(fixed).toHaveLength(1);
    expect(fixed[0]?.fixRecipeId).toBe('safe-eval-alternative');
    expect(confirmations).toEqual([{ action: 'insert', recipeId: 'safe-eval-alternative' }]);
  });

  it('identifies precision drops and emits RuleLearner signals', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'alembic-core-rule-learner-'));
    const signalBus = { send: vi.fn() } as unknown as RuleLearnerSignalBus;

    try {
      const learner = new RuleLearner(tmpRoot, {
        knowledgeBaseDir: 'Alembic',
        signalBus,
      });

      for (let index = 0; index < 10; index++) {
        learner.recordTrigger('bad-rule');
      }
      for (let index = 0; index < 8; index++) {
        learner.recordFeedback('bad-rule', 'falsePositive');
      }

      const drops = learner.checkPrecisionDrop();

      expect(drops[0]?.ruleId).toBe('bad-rule');
      expect(drops[0]?.falsePositiveRate).toBeGreaterThan(0.6);
      expect(signalBus.send).toHaveBeenCalledWith(
        'quality',
        'RuleLearner.precisionDrop',
        expect.any(Number),
        expect.objectContaining({ target: 'bad-rule' })
      );
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
