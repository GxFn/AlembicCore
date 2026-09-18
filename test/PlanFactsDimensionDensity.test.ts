import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIMENSION_REGISTRY } from '../src/domain/dimension/index.js';
import { buildProjectContextPresenterInput } from '../src/domain/project-context/index.js';
import {
  buildDimensionEvidenceDensity,
  buildPlanFactsProjection,
  buildProjectInfoTree,
  type PlanProjectContextAnalysis,
} from '../src/service/plan/facts/projectInfoTree.js';
import type { DimensionDef } from '../src/types/ProjectSnapshot.js';
import {
  baseDimensions,
  toBaseDimension,
} from '../src/workflows/surfaces/planning/dimensions/BaseDimensions.js';

/**
 * dimensionEvidenceDensity 分型钉子。
 *
 * 背景(2026-07-02 真实 workspace 冒烟证伪 v1)：单一「路径关键词命中」口径对横切维度系统性失真——
 * architecture 的证据在代码内容里而不在文件路径词里(密度只有 2)，而「agent」这类高频路径词
 * 又把个别维度推到失真的 100。v2 按维度 layer 分型：universal 按结构规模、language 按语言文件
 * 占比、framework 按框架信号命中。本文件钉住分型语义与字节纪律，防止回退到单一口径。
 */

function makeAnalysis(overrides: {
  dimensions: DimensionDef[];
  files?: Array<{ filePath: string; language: string }>;
  frameworks?: string[];
  moduleCount?: number;
}): PlanProjectContextAnalysis {
  return {
    contextStatus: 'complete',
    dimensions: overrides.dimensions,
    envelopes: [],
    factSource: 'project-context',
    fileCount: overrides.files?.length ?? 0,
    frameworks: overrides.frameworks ?? [],
    moduleCount: overrides.moduleCount ?? 0,
    moduleSeeds: [],
    presenterInput: { modules: [], files: [], symbols: [], decisions: [] } as never,
    primaryLanguage: 'typescript',
    projectType: 'node',
    requestKinds: [],
    secondaryLanguages: [],
    sourceFileFacts: (overrides.files ?? []).map((file) => ({ ...file, sizeBytes: 1024 })),
    understandingGaps: [],
  };
}

const TS_FILES = Array.from({ length: 100 }, (_, i) => ({
  filePath: `src/service/feature-${i}.ts`,
  language: 'typescript',
}));

describe('dimensionEvidenceDensity layer typing', () => {
  it('scores universal dimensions by structural scale even with zero path-keyword hits', () => {
    // 回归钉：architecture 的证据不写在路径词里，12 模块的 monorepo 必须拿到结构基础分(≥70)。
    const analysis = makeAnalysis({
      dimensions: [
        { id: 'architecture', label: '架构', layer: 'universal', matchTopics: ['zzz-no-hit'] },
      ],
      files: TS_FILES,
      moduleCount: 12,
    });
    const [density] = buildDimensionEvidenceDensity(analysis);
    expect(density.strength).toBeGreaterThanOrEqual(70);
    expect(density.matchedModules).toBe(12);
  });

  it('keeps small single-module projects below large monorepos on universal dimensions', () => {
    const small = makeAnalysis({
      dimensions: [{ id: 'architecture', layer: 'universal', matchTopics: [] }],
      files: TS_FILES.slice(0, 10),
      moduleCount: 1,
    });
    const large = makeAnalysis({
      dimensions: [{ id: 'architecture', layer: 'universal', matchTopics: [] }],
      files: TS_FILES,
      moduleCount: 12,
    });
    const [smallDensity] = buildDimensionEvidenceDensity(small);
    const [largeDensity] = buildDimensionEvidenceDensity(large);
    expect(smallDensity.strength).toBeLessThan(largeDensity.strength);
  });

  it('scores language dimensions by real language-file share, zeroing absent languages', () => {
    // 回归钉：python-structure 在纯 TS 项目必须是 0——路径里出现 "struct" 之类误命中不得抬分。
    const analysis = makeAnalysis({
      dimensions: [
        {
          id: 'python-structure',
          layer: 'language',
          conditions: { languages: ['python'] },
          matchTopics: ['structure'],
        },
        {
          id: 'ts-js-module',
          layer: 'language',
          conditions: { languages: ['typescript', 'javascript'] },
          matchTopics: [],
        },
      ],
      files: [...TS_FILES, { filePath: 'scripts/data-structures.md', language: 'markdown' }],
      moduleCount: 12,
    });
    const [python, tsJs] = buildDimensionEvidenceDensity(analysis);
    expect(python.strength).toBe(0);
    expect(python.matchedFiles).toBe(0);
    expect(tsJs.strength).toBeGreaterThanOrEqual(90);
  });

  it('scores framework dimensions high on framework-signal hit and low otherwise', () => {
    const dimensions: DimensionDef[] = [
      {
        id: 'react-patterns',
        layer: 'framework',
        conditions: { frameworks: ['react'] },
        matchTopics: [],
      },
    ];
    const withReact = makeAnalysis({
      dimensions,
      files: TS_FILES,
      frameworks: ['React'],
      moduleCount: 4,
    });
    const withoutReact = makeAnalysis({ dimensions, files: TS_FILES, moduleCount: 4 });
    const [hit] = buildDimensionEvidenceDensity(withReact);
    const [miss] = buildDimensionEvidenceDensity(withoutReact);
    expect(hit.strength).toBeGreaterThanOrEqual(90);
    expect(hit.matchedFrameworks).toBe(1);
    expect(miss.strength).toBeLessThanOrEqual(20);
  });

  it('keeps sampleHits within byte discipline: at most 2, empty on zero strength', () => {
    const analysis = makeAnalysis({
      dimensions: [
        { id: 'testing-quality', layer: 'universal', matchTopics: ['test'] },
        {
          id: 'go-module',
          layer: 'language',
          conditions: { languages: ['go'] },
          matchTopics: ['module'],
        },
      ],
      files: Array.from({ length: 50 }, (_, i) => ({
        filePath: `test/module-${i}.test.ts`,
        language: 'typescript',
      })),
      moduleCount: 8,
    });
    const [universal, absentLanguage] = buildDimensionEvidenceDensity(analysis);
    expect(universal.sampleHits.length).toBeLessThanOrEqual(2);
    expect(absentLanguage.strength).toBe(0);
    expect(absentLanguage.sampleHits).toEqual([]);
  });
});

describe('BaseDimension adapter keeps layer and matchTopics', () => {
  it('maps layer and matchTopics from UnifiedDimension for every registry entry', () => {
    // 根因钉：v1 失真的直接原因是 toBaseDimension 丢弃了 layer——密度函数拿不到分型依据，
    // 全部维度退化成同一口径。适配层必须保持这两个字段透传。
    for (const unified of DIMENSION_REGISTRY) {
      const base = toBaseDimension(unified);
      expect(base.layer).toBe(unified.layer);
      expect(base.matchTopics).toEqual([...unified.matchTopics]);
    }
    expect(baseDimensions.every((dimension) => dimension.layer !== undefined)).toBe(true);
  });
});

describe('plan facts tree budget metadata', () => {
  it('reports omitted symbols before and after attaching the real full-tree artifact', async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'plan-tree-budget-'));
    try {
      const file = { filePath: 'src/main.ts', language: 'typescript', lineCount: 1 };
      const signature = 'veryLongType'.repeat(500);
      const analysis = makeAnalysis({ dimensions: [], files: [file], moduleCount: 1 });
      analysis.moduleSeeds = [
        { moduleName: 'source', modulePath: 'src', ownedFiles: [file.filePath] },
      ];
      analysis.presenterInput = buildProjectContextPresenterInput([]);
      analysis.presenterInput.files = [file];
      analysis.presenterInput.fileSymbols = [
        {
          file,
          symbols: [
            { filePath: file.filePath, name: 'largeSignature', kind: 'function', signature },
          ],
          naming: { warnings: [] },
          nextRefs: [],
        },
      ];

      // 大 symbol 一开始就放不下；附加 ref 本身仍有余量，不会触发第二次 prune。
      const budgetBytes = 2_000;
      const beforeAttachment = buildProjectInfoTree(analysis, budgetBytes);
      const { projectInfoTree } = await buildPlanFactsProjection(analysis, {
        budgetBytes,
        scope: { projectRoot },
      });
      const fullTreeRef = projectInfoTree.meta.fullTreeRef;
      expect(fullTreeRef).not.toBeNull();
      const fullTreeText = readFileSync(fullTreeRef!.path, 'utf8');
      expect(Buffer.byteLength(fullTreeText)).toBe(fullTreeRef!.bytes);
      expect(JSON.parse(fullTreeText).children[0].children[0].children[0].signature).toBe(
        signature
      );
      expect(Buffer.byteLength(JSON.stringify(projectInfoTree))).toBeLessThanOrEqual(budgetBytes);
      expect([beforeAttachment.meta, projectInfoTree.meta]).toEqual([
        expect.objectContaining({ omitted: { symbols: 1 }, truncated: true, fullTreeRef: null }),
        expect.objectContaining({ omitted: { symbols: 1 }, truncated: true, fullTreeRef }),
      ]);

      const complete = await buildPlanFactsProjection(analysis, {
        budgetBytes: 20_000,
        scope: { projectRoot },
      });
      expect(complete.projectInfoTree.meta).toMatchObject({
        omitted: {},
        truncated: false,
        fullTreeRef: null,
      });
    } finally {
      rmSync(projectRoot, { force: true, recursive: true });
    }
  });
});
