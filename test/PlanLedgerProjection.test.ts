import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../src/database.js';
import { buildDimensionPlanningAids } from '../src/dimensions.js';
import { pathGuard } from '../src/io.js';
import { KnowledgeEntry } from '../src/knowledge.js';
import {
  buildPlanDraftInformationPackage,
  compareProjectContextSignature,
  computeProjectContextSignature,
  type PlanIntent,
  PlanLedgerService,
} from '../src/plans.js';
import { createAlembicRepositories } from '../src/repositories.js';

describe('Plan ledger projection', () => {
  let tmpDir: string;
  let runtime: AlembicDatabaseRuntime;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-plan-ledger-'));
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

  it('persists confirmed Plan intent and projects generation state from existing records', async () => {
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
      planningAids: buildDimensionPlanningAids({
        primaryLanguage: 'swift',
        detectedFrameworks: ['SwiftUI'],
      }),
      hints: { focusModules: ['Sources/BiliDiliApp'], maxBudget: 4 },
    });

    const draft = repositories.planRepository.saveDraft({
      planId: 'plan-bilidili',
      projectRoot: tmpDir,
      projectContextSignature: signature,
      lastUpdatedFromCommit: 'abc123',
      createdBy: 'test',
      planningBrief: draftPackage.planningBrief,
      rationale: ['fixture draft'],
    });
    expect(draft.intent.dimensions).toEqual([]);
    expect(draft.intent.draftSource).toBe('plugin-collected-facts');
    expect(draft.planningBrief).toBeNull();

    const completeIntent = completeBilidiliPlanIntent({
      projectProfile: {
        projectType: 'ios-app',
        primaryLanguage: 'swift',
        frameworks: ['SwiftUI'],
        moduleCount: 1,
        fileCount: 1,
        architectureHints: ['layered'],
      },
    });
    const confirmed = repositories.planRepository.confirm({
      planId: draft.planId,
      version: draft.version,
      confirmedBy: 'test',
      rationale: ['fixture confirmed'],
      intent: completeIntent,
    });

    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.intent).toMatchObject({
      draftSource: 'host-agent',
      dimensions: [
        expect.objectContaining({ dimensionId: 'architecture' }),
        expect.objectContaining({ dimensionId: 'testing-quality' }),
      ],
      moduleBindings: [expect.objectContaining({ modulePath: 'Sources/BiliDiliApp' })],
    });
    expect(repositories.planRepository.getActiveConfirmed(tmpDir)?.planId).toBe('plan-bilidili');

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
        rationale: 'Used by Plan projection fixture.',
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
      description: 'Fixture proposal should project into Plan state.',
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

    const service = new PlanLedgerService(repositories);
    const view = await service.getActivePlanView(tmpDir, signature);

    expect(view?.signature.matches).toBe(true);
    expect(view?.state.codeRecipeMapping).toEqual(
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
    expect(view?.state.coverage.byDimension.architecture).toMatchObject({
      planned: 2,
      generated: 1,
      missing: 1,
    });
    expect(view?.state.coverage.byDimension['testing-quality']).toMatchObject({
      planned: 1,
      generated: 0,
      missing: 1,
    });
    expect(view?.state.pendingProposals).toHaveLength(1);
    expect(view?.state.generationChangeLog).toHaveLength(1);

    const row = runtime.sqlite
      .prepare('SELECT intent_json FROM plans WHERE plan_id = ? AND version = ?')
      .get('plan-bilidili', 1) as { intent_json: string };
    const persistedIntent = JSON.parse(row.intent_json) as Record<string, unknown>;
    expect(persistedIntent).not.toHaveProperty('codeRecipeMapping');
    expect(persistedIntent).not.toHaveProperty('coverage');
    expect(persistedIntent).not.toHaveProperty('pendingProposals');

    const columns = runtime.sqlite
      .prepare("PRAGMA table_info('plans')")
      .all()
      .map((column) => (column as { name: string }).name);
    expect(columns).not.toContain('state_json');
    expect(columns).not.toContain('coverage_json');
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
    const planningAids = buildDimensionPlanningAids({
      primaryLanguage: 'typescript',
      detectedFrameworks: ['react'],
    });
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
      factualDimensionSignals: expect.objectContaining({
        activeDimensionIds: expect.arrayContaining(['architecture']),
      }),
      focusModules: ['src/app'],
    });
    expect(draftPackage.planningBrief).not.toHaveProperty('defaultOrder');
    expect(draftPackage.sourceReports.planningAids).toBe(planningAids);
    expect(draftPackage.sourceReports.planningAids).not.toHaveProperty('recommendedDimensions');
    expect(draftPackage.sourceReports.planningAids).not.toHaveProperty('dimensionOrder');
    expect(draftPackage.sourceReports.planningAids).not.toHaveProperty('subsetHints');
    expect(JSON.stringify(draftPackage)).not.toMatch(
      /recommendedDimensions|dimensionOrder|maxRecommendedDimensions|subsetHints|defaultOrder/
    );
  });

  it('requires a complete Agent-authored Plan payload before confirm', async () => {
    const repositories = createAlembicRepositories(runtime.connection);
    const signature = computeProjectContextSignature({ projectRoot: tmpDir });
    const draft = repositories.planRepository.saveDraft({
      planId: 'plan-complete-required',
      projectRoot: tmpDir,
      projectContextSignature: signature,
      createdBy: 'test',
      rationale: ['draft facts gathered'],
    });

    expect(() =>
      repositories.planRepository.confirm({
        planId: draft.planId,
        version: draft.version,
        confirmedBy: 'test',
        rationale: ['incomplete payload'],
        intent: {
          ...completeBilidiliPlanIntent(),
          plannedNextActions: [],
        },
      })
    ).toThrow(/plannedNextActions are required/);

    const confirmed = repositories.planRepository.confirm({
      planId: draft.planId,
      version: draft.version,
      confirmedBy: 'test',
      rationale: ['complete payload'],
      intent: completeBilidiliPlanIntent(),
    });

    expect(confirmed.intent.draftSource).toBe('host-agent');
    expect(confirmed.intent.plannedNextActions).toHaveLength(2);
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
        stage: 'coldStart',
        targetRecipes: 2,
      },
      {
        dimensionId: 'testing-quality',
        priority: 2,
        rationale: 'Tests are explicit in the fixture scope.',
        stage: 'deepMining',
        targetRecipes: 1,
      },
    ],
    scale: {
      totalRecipeBudget: 3,
      perStage: { coldStart: 2, deepMining: 1, module: 1 },
      depthLevels: ['baseline', 'deepening'],
      budgetLevel: 'focused',
      scale: 'small',
    },
    moduleBindings: [moduleBinding],
    stages: {
      coldStart: { dimensions: ['architecture'], breadthBudget: 2 },
      deepMining: {
        dimensions: ['testing-quality'],
        depthBudget: 1,
        focusModules: ['Sources/BiliDiliApp'],
      },
      moduleMining: {
        perModule: [moduleBinding],
      },
    },
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
