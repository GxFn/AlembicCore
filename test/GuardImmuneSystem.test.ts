/**
 * Guard immune system integration
 *
 * 覆盖 Guard 免疫闭环中的 uncertainty、反馈确认、反向验证、覆盖率、学习器和合规报告。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ComplianceReporter } from '../src/service/guard/ComplianceReporter.js';
import { CoverageAnalyzer } from '../src/service/guard/CoverageAnalyzer.js';
import { GuardCheckEngine } from '../src/service/guard/GuardCheckEngine.js';
import { GuardFeedbackLoop } from '../src/service/guard/GuardFeedbackLoop.js';
import { ReverseGuard } from '../src/service/guard/ReverseGuard.js';
import { RuleLearner } from '../src/service/guard/RuleLearner.js';
import { UncertaintyCollector } from '../src/service/guard/UncertaintyCollector.js';

type GuardEngineDb = ConstructorParameters<typeof GuardCheckEngine>[0];
type ReverseGuardKnowledgeRepo = ConstructorParameters<typeof ReverseGuard>[0];
type ReverseGuardEntityRepo = ConstructorParameters<typeof ReverseGuard>[1];
type ReverseGuardSourceRefRepo = ConstructorParameters<typeof ReverseGuard>[2];
type CoverageKnowledgeRepo = ConstructorParameters<typeof CoverageAnalyzer>[0];
type CoverageViolationRepo = ConstructorParameters<typeof CoverageAnalyzer>[1];
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

  it('runs ReverseGuard end-to-end over active rule recipes', () => {
    const knowledgeRepo = {
      findActiveRulesWithContentSync() {
        return [
          {
            id: 'r-old',
            title: 'Old API Rule',
            coreCode: 'BDLegacyManager.fetchData()',
            guardPattern: 'BDLegacyManager',
            stats: null,
          },
        ];
      },
      getGuardHitsSync() {
        return 0;
      },
    } as unknown as ReverseGuardKnowledgeRepo;
    const entityRepo = {
      existsByName() {
        return false;
      },
    } as unknown as ReverseGuardEntityRepo;
    const sourceRefRepo = {
      findByRecipeId() {
        return [];
      },
    } as unknown as ReverseGuardSourceRefRepo;

    const reverseGuard = new ReverseGuard(knowledgeRepo, entityRepo, sourceRefRepo);
    const results = reverseGuard.auditAllRules([
      { path: 'a.swift', content: 'let x = BDNewManager.fetchData()' },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]?.recipeId).toBe('r-old');
    expect(results[0]?.recommendation).toBe('decay');
  });

  it('produces coverage matrix from module files and rule languages', () => {
    const knowledgeRepo = {
      findActiveRuleIdsSync() {
        return [
          { id: 'r1', language: 'swift' },
          { id: 'r2', language: 'objectivec' },
          { id: 'r3', language: 'swift' },
        ];
      },
    } as unknown as CoverageKnowledgeRepo;
    const guardViolationRepo = {
      findRecentViolationsJson() {
        return [];
      },
    } as unknown as CoverageViolationRepo;

    const analyzer = new CoverageAnalyzer(knowledgeRepo, guardViolationRepo);
    const result = analyzer.analyze(
      new Map([
        ['BDUIKit', ['BDUIKit/A.swift', 'BDUIKit/B.swift']],
        ['BDNet', ['BDNet/C.m', 'BDNet/D.h']],
        ['BDAuth', []],
      ])
    );

    expect(result.modules).toHaveLength(3);
    expect(result.zeroModules).toContain('BDAuth');
    expect(result.modules.find((module) => module.module === 'BDUIKit')?.coverage).toBe(100);
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

  it('generates three-dimensional compliance scores from collected project files', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'alembic-core-compliance-'));
    writeFileSync(join(tmpRoot, 'a.swift'), 'let x = try! something()\n');

    const mockEngine = {
      auditFiles() {
        return {
          files: [
            {
              filePath: join(tmpRoot, 'a.swift'),
              violations: [{ ruleId: 'swift-force-try', severity: 'warning', message: 'try!' }],
              uncertainResults: [
                {
                  ruleId: 'ast-gap',
                  message: 'AST unavailable',
                  layer: 'ast',
                  reason: 'ast_unavailable',
                  detail: 'No tree-sitter',
                },
              ],
              summary: { total: 1, errors: 0, warnings: 1, infos: 0, uncertain: 1 },
            },
          ],
          crossFileViolations: [],
          capabilityReport: {
            checkCoverage: 75,
            uncertainResults: [
              {
                ruleId: 'ast-gap',
                message: 'AST unavailable',
                layer: 'ast',
                reason: 'ast_unavailable',
                detail: 'No tree-sitter',
              },
            ],
            boundaries: [
              {
                type: 'ast_language_gap',
                description: 'AST skipped',
                affectedRules: ['ast-gap'],
                suggestedAction: 'Install tree-sitter',
              },
            ],
          },
        };
      },
    } as unknown as ConstructorParameters<typeof ComplianceReporter>[0];

    try {
      const reporter = new ComplianceReporter(mockEngine, null, null, null);
      const report = await reporter.generate(tmpRoot);

      expect(report.complianceScore).toBeDefined();
      expect(report.coverageScore).toBe(75);
      expect(report.confidenceScore).toBeLessThan(100);
      expect(report.uncertainSummary.total).toBe(1);
      expect(report.uncertainSummary.byLayer.ast).toBe(1);
      expect(report.boundaries).toHaveLength(1);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
