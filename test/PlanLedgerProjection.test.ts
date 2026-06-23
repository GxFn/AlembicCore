import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import { pathGuard } from '../src/io.js';
import { KnowledgeEntry } from '../src/knowledge.js';
import {
  buildPlanDraftInformationPackage,
  compareProjectContextSignature,
  computeProjectContextSignature,
  type PlanIntent,
  projectPlanGenerationState,
  validateCompletePlanIntent,
} from '../src/plans.js';
import { createAlembicRepositories } from '../src/repositories.js';

describe('Recipe status projection from stateless Plan intent', () => {
  let tmpDir: string;
  let runtime: AlembicDatabaseRuntime;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-recipe-status-'));
    oldQuiet = process.env.ALEMBIC_QUIET;
    process.env.ALEMBIC_QUIET = '1';
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    runtime = await openAlembicDatabase({ path: '.asd/alembic.db' });
  });

  afterEach(() => {
    runtime.close();
    if (oldQuiet === undefined) {
      delete process.env.ALEMBIC_QUIET;
    } else {
      process.env.ALEMBIC_QUIET = oldQuiet;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('projects generation state from existing recipe records without plan persistence', async () => {
    const repositories = createAlembicRepositories(runtime.connection);
    const signature = computeProjectContextSignature({
      projectRoot: tmpDir,
      commit: 'abc123',
      primaryLanguage: 'swift',
      frameworks: ['SwiftUI'],
      files: [
        {
          filePath: 'Sources/BiliDiliApp/App.swift',
          contentHash: 'app-hash',
          language: 'swift',
          lineCount: 120,
        },
      ],
      modules: [{ id: 'app', name: 'App', files: ['Sources/BiliDiliApp/App.swift'] }],
    });
    const draftPackage = buildPlanDraftInformationPackage({
      projectProfile: {
        projectType: 'ios-app',
        primaryLanguage: 'swift',
        frameworks: ['SwiftUI'],
        moduleCount: 1,
        fileCount: 1,
        architectureHints: ['layered'],
      },
      projectContextSignature: signature,
      planningAids: {
        collectedFacts: {
          primaryLanguage: 'swift',
          detectedFrameworks: ['SwiftUI'],
        },
      },
      hints: { focusModules: ['Sources/BiliDiliApp'], maxBudget: 4 },
    });
    expect(draftPackage.draftSource).toBe('plugin-collected-facts');

    const intent = completeBilidiliPlanIntent({
      projectProfile: {
        projectType: 'ios-app',
        primaryLanguage: 'swift',
        frameworks: ['SwiftUI'],
        moduleCount: 1,
        fileCount: 1,
        architectureHints: ['layered'],
      },
    });
    expect(() => validateCompletePlanIntent(intent)).not.toThrow();

    const recipe = new KnowledgeEntry({
      id: 'recipe-architecture',
      title: 'SwiftUI application entrypoint',
      description: 'Architecture recipe anchored to app source.',
      lifecycle: 'active',
      language: 'swift',
      dimensionId: 'architecture',
      category: 'architecture',
      knowledgeType: 'code-pattern',
      sourceFile: 'Sources/BiliDiliApp/App.swift',
      content: {
        pattern: 'App entrypoint composes the SwiftUI scene graph.',
        rationale: 'Used by recipe status fixture.',
      },
      reasoning: {
        confidence: 0.9,
        sources: ['Sources/BiliDiliApp/App.swift'],
        whyStandard: 'The app entrypoint owns scene composition.',
      },
    });
    await repositories.knowledgeRepository.create(recipe);
    repositories.recipeSourceRefRepository.upsert({
      recipeId: recipe.id,
      sourcePath: 'Sources/BiliDiliApp/App.swift',
      status: 'active',
      verifiedAt: 100,
    });
    repositories.proposalRepository.create({
      type: 'update',
      targetRecipeId: recipe.id,
      confidence: 0.8,
      source: 'host-agent',
      description: 'Fixture proposal should project into recipe status.',
      evidence: [{ source: 'test' }],
      status: 'pending',
    });
    repositories.lifecycleEventRepository.record({
      id: 'lte-plan-fixture',
      recipeId: recipe.id,
      fromState: 'pending',
      toState: 'active',
      trigger: 'publish',
      operatorId: 'test',
      evidence: { reason: 'fixture' },
      proposalId: null,
      createdAt: 200,
    });

    const state = await projectPlanGenerationState({ intent, repositories });

    expect(state.codeRecipeMapping).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codeRegion: 'Sources/BiliDiliApp/App.swift',
          recipeIds: ['recipe-architecture'],
          status: 'generated',
          dimensionIds: ['architecture'],
          modulePath: 'Sources/BiliDiliApp',
        }),
      ])
    );
    expect(state.coverage.byDimension.architecture).toMatchObject({
      planned: 2,
      generated: 1,
      missing: 1,
    });
    expect(state.coverage.byDimension['testing-quality']).toMatchObject({
      planned: 1,
      generated: 0,
      missing: 1,
    });
    expect(state.coverage.byModuleDimension['Sources/BiliDiliApp']?.architecture).toMatchObject({
      planned: 2,
      generated: 1,
      missing: 1,
    });
    expect(
      state.coverage.byModuleDimension['Sources/BiliDiliApp']?.['testing-quality']
    ).toMatchObject({
      planned: 1,
      generated: 0,
      missing: 1,
    });
    expect(state.coverage.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimensionId: 'architecture',
          missing: 1,
          modulePath: 'Sources/BiliDiliApp',
        }),
        expect.objectContaining({
          dimensionId: 'testing-quality',
          missing: 1,
          modulePath: 'Sources/BiliDiliApp',
        }),
      ])
    );
    expect(state.pendingProposals).toHaveLength(1);
    expect(state.generationChangeLog).toHaveLength(1);

    const tables = runtime.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).not.toContain('plans');
  });

  it('projects recipes without source refs as missing instead of generated from sourceFile', async () => {
    const repositories = createAlembicRepositories(runtime.connection);
    const intent = completeBilidiliPlanIntent();

    const recipe = new KnowledgeEntry({
      id: 'recipe-without-source-refs',
      title: 'SwiftUI app recipe without reconciled refs',
      description: 'Recipe still carries legacy sourceFile but no source_refs row.',
      lifecycle: 'active',
      language: 'swift',
      dimensionId: 'architecture',
      category: 'architecture',
      knowledgeType: 'code-pattern',
      sourceFile: 'Sources/BiliDiliApp/App.swift',
      content: { pattern: 'App entrypoint composes scenes.' },
      reasoning: {
        confidence: 0.9,
        whyStandard: 'Fixture intentionally omits reasoning.sources.',
      },
    });
    await repositories.knowledgeRepository.create(recipe);

    const state = await projectPlanGenerationState({ intent, repositories });

    expect(state.codeRecipeMapping).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codeRegion: 'Sources/BiliDiliApp/App.swift',
          dimensionIds: ['architecture'],
          modulePath: 'Sources/BiliDiliApp',
          recipeIds: ['recipe-without-source-refs'],
          status: 'missing',
        }),
      ])
    );
    expect(state.coverage).toMatchObject({
      generated: 0,
      planned: 3,
    });
    expect(state.coverage.byDimension.architecture).toMatchObject({
      generated: 0,
      missing: 2,
      planned: 2,
    });
    expect(state.coverage.byModuleDimension['Sources/BiliDiliApp']?.architecture).toMatchObject({
      generated: 0,
      missing: 2,
      planned: 2,
    });
  });

  it('computes stable ProjectContext signatures and exposes mismatch detection', () => {
    const first = computeProjectContextSignature({
      projectRoot: tmpDir,
      frameworks: ['SwiftUI', 'Combine'],
      files: [
        { filePath: 'Sources/B.swift', contentHash: 'b' },
        { filePath: 'Sources/A.swift', contentHash: 'a' },
      ],
    });
    const second = computeProjectContextSignature({
      projectRoot: tmpDir,
      frameworks: ['Combine', 'SwiftUI'],
      files: [
        { filePath: 'Sources/A.swift', contentHash: 'a' },
        { filePath: 'Sources/B.swift', contentHash: 'b' },
      ],
    });
    const changed = computeProjectContextSignature({
      projectRoot: tmpDir,
      frameworks: ['Combine', 'SwiftUI'],
      files: [
        { filePath: 'Sources/A.swift', contentHash: 'a' },
        { filePath: 'Sources/B.swift', contentHash: 'changed' },
      ],
    });

    expect(first).toBe(second);
    expect(compareProjectContextSignature(first, second)).toMatchObject({
      matches: true,
      reason: 'match',
    });
    expect(compareProjectContextSignature(first, changed)).toMatchObject({
      matches: false,
      reason: 'mismatch',
    });
  });

  it('builds a facts-only draft information package without authoritative Plan intent', () => {
    const planningAids = {
      collectedFacts: {
        primaryLanguage: 'typescript',
        detectedFrameworks: ['react'],
      },
    };
    const signature = computeProjectContextSignature({
      projectRoot: tmpDir,
      primaryLanguage: 'typescript',
      frameworks: ['react'],
    });
    const draftPackage = buildPlanDraftInformationPackage({
      projectProfile: {
        projectType: 'frontend',
        primaryLanguage: 'typescript',
        frameworks: ['react'],
        moduleCount: 2,
        fileCount: 10,
      },
      projectContextSignature: signature,
      planningAids,
      hints: { focusModules: ['src/app'], maxBudget: 6 },
    });

    expect('intent' in draftPackage).toBe(false);
    expect(draftPackage.draftSource).toBe('plugin-collected-facts');
    expect(draftPackage.planningBrief).toMatchObject({
      draftSource: 'plugin-collected-facts',
      sourceReportFields: ['sourceReports.planningAids'],
      focusModules: ['src/app'],
    });
    expect(draftPackage.planningBrief).not.toHaveProperty('defaultOrder');
    expect(draftPackage.planningBrief).not.toHaveProperty('factualDimensionSignals');
    expect(draftPackage.planningBrief).not.toHaveProperty('toolCapabilityMatrix');
    expect(draftPackage.sourceReports.planningAids).toBe(planningAids);
    expect(draftPackage.sourceReports.planningAids).not.toHaveProperty('recommendedDimensions');
    expect(draftPackage.sourceReports.planningAids).not.toHaveProperty('dimensionOrder');
    expect(draftPackage.sourceReports.planningAids).not.toHaveProperty('subsetHints');
    expect(draftPackage.sourceReports.planningAids).not.toHaveProperty('crossDimensionConstraints');
    expect(JSON.stringify(draftPackage)).not.toMatch(
      /recommendedDimensions|dimensionOrder|maxRecommendedDimensions|subsetHints|defaultOrder|crossDimensionConstraints|CrossDimensionConstraint|buildCrossDimensionConstraints/
    );
  });

  it('requires a complete single-stage Agent-authored Plan payload before confirm', () => {
    expect(() =>
      validateCompletePlanIntent({
        ...completeBilidiliPlanIntent(),
        plannedNextActions: [],
      })
    ).toThrow(/plannedNextActions are required/);

    expect(() =>
      validateCompletePlanIntent({
        ...completeBilidiliPlanIntent(),
        scale: {
          ...completeBilidiliPlanIntent().scale,
          totalRecipeBudget: 0,
        },
      })
    ).toThrow(/scale.totalRecipeBudget must be > 0/);

    expect(() => validateCompletePlanIntent(completeBilidiliPlanIntent())).not.toThrow();
  });
});

function completeBilidiliPlanIntent(
  overrides: Partial<Pick<PlanIntent, 'projectProfile'>> = {}
): PlanIntent {
  const moduleBinding = {
    modulePath: 'Sources/BiliDiliApp',
    dimensions: ['architecture', 'testing-quality'],
    targetRecipes: 2,
    priority: 1,
  };
  return {
    generationStage: 'coldStart',
    projectProfile: overrides.projectProfile ?? {
      projectType: 'ios-app',
      primaryLanguage: 'swift',
      frameworks: ['SwiftUI'],
      moduleCount: 1,
      fileCount: 1,
    },
    dimensions: [
      {
        dimensionId: 'architecture',
        priority: 1,
        rationale: 'Architecture is foundational for the fixture.',
        targetRecipes: 2,
      },
      {
        dimensionId: 'testing-quality',
        priority: 2,
        rationale: 'Tests are explicit in the fixture scope.',
        targetRecipes: 1,
      },
    ],
    scale: {
      totalRecipeBudget: 3,
      depthLevels: ['baseline', 'deepening'],
      budgetLevel: 'focused',
      scale: 'small',
    },
    moduleBindings: [moduleBinding],
    plannedNextActions: [
      {
        tool: 'project-context.map',
        reason: 'Collect architecture evidence.',
        order: 1,
        dimensionIds: ['architecture'],
      },
      {
        tool: 'recipe-context.coverage',
        reason: 'Check testing coverage.',
        order: 2,
        dimensionIds: ['testing-quality'],
        modulePaths: ['Sources/BiliDiliApp'],
      },
    ],
    evidenceRefs: [
      {
        kind: 'project-context',
        ref: 'pcsig:fixture',
        detail: 'projectContextSignature',
      },
    ],
    draftSource: 'host-agent',
  };
}
