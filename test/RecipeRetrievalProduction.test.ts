import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KnowledgeEntry } from '../src/domain/knowledge/KnowledgeEntry.js';
import type { RecipeRetrievalProfile } from '../src/domain/knowledge/RecipeRetrievalProfile.js';
import { DatabaseConnection } from '../src/infrastructure/database/DatabaseConnection.js';
import { resetDrizzle } from '../src/infrastructure/database/drizzle/index.js';
import { SignalBus } from '../src/infrastructure/signal/SignalBus.js';
import { LifecycleEventRepository } from '../src/repository/evolution/LifecycleEventRepository.js';
import { ProposalRepository } from '../src/repository/evolution/ProposalRepository.js';
import { KnowledgeRepositoryImpl } from '../src/repository/knowledge/KnowledgeRepositoryImpl.js';
import {
  KnowledgeFileWriter,
  parseKnowledgeMarkdown,
} from '../src/service/knowledge/KnowledgeFileWriter.js';
import { KnowledgeService } from '../src/service/knowledge/KnowledgeService.js';
import {
  computeRecipeSourceContentHash,
  evaluateRecipeRetrievalReadiness,
  projectCompatibilityRecipeRetrievalProfile,
  projectRecipeRetrievalDocumentSet,
  serializeRecipeRetrievalDocumentSetForSparse,
} from '../src/service/knowledge/RecipeRetrieval.js';
import { LifecycleStateMachine } from '../src/service/sustain/LifecycleStateMachine.js';
import { buildRecipeSemanticRegionChunks } from '../src/service/vector/RecipeRegionVectorIndex.js';
import pathGuard from '../src/shared/PathGuard.js';

function recipeSource(overrides: Record<string, unknown> = {}) {
  return {
    id: 'recipe-profile-001',
    title: 'Feature dependencies flow through infrastructure ports',
    description:
      'Feature modules depend on infrastructure protocols while Core remains independent.',
    trigger: 'when adding a feature dependency',
    language: 'typescript',
    category: 'architecture',
    knowledgeType: 'code-pattern',
    kind: 'pattern',
    whenClause: 'When a feature needs a reusable service.',
    doClause: 'Depend on an infrastructure protocol and inject its implementation.',
    dontClause: 'Do not import another feature module directly.',
    content: {
      pattern: 'export interface UserStore { load(id: string): Promise<User>; }',
      markdown:
        'Feature code consumes a stable infrastructure port. The composition root owns concrete implementations.',
      rationale: 'This keeps feature ownership isolated and makes dependencies replaceable.',
    },
    reasoning: {
      whyStandard: 'The source boundary is enforced by the package dependency graph.',
      sources: ['src/features/user/UserService.ts:10-28'],
      confidence: 0.95,
    },
    tags: ['architecture', 'dependency-inversion'],
    ...overrides,
  };
}

function nativeProfile(source: Record<string, unknown>): RecipeRetrievalProfile {
  return {
    schemaVersion: '1',
    primaryLanguage: 'en',
    summary: {
      primary: 'Feature dependencies cross boundaries through infrastructure ports.',
      technicalEnglish:
        'Use dependency inversion so feature modules consume infrastructure protocols instead of other features.',
    },
    concepts: [
      {
        term: 'dependency inversion',
        language: 'en',
        provenanceRefs: ['field:description', 'src/features/user/UserService.ts:10-28'],
      },
      {
        term: 'infrastructure port',
        language: 'en',
        provenanceRefs: ['field:doClause'],
      },
    ],
    scenarios: [
      {
        text: 'A feature needs a reusable service owned outside the feature layer.',
        language: 'en',
        provenanceRefs: ['field:whenClause'],
      },
    ],
    exclusions: [
      {
        text: 'Do not couple one feature module directly to another feature module.',
        language: 'en',
        provenanceRefs: ['field:dontClause'],
      },
    ],
    provenance: {
      evidenceRefs: ['src/features/user/UserService.ts:10-28'],
      sourceFieldRefs: [
        'field:title',
        'field:description',
        'field:whenClause',
        'field:doClause',
        'field:dontClause',
        'field:content.pattern',
        'field:content.markdown',
        'field:content.rationale',
      ],
      sourceContentHash: computeRecipeSourceContentHash(source),
      generator: 'test-evidence-projector',
    },
  };
}

function makeNativeEntry(overrides: Record<string, unknown> = {}) {
  const source = recipeSource(overrides);
  return new KnowledgeEntry({
    ...source,
    retrievalProfile: nativeProfile(source),
  });
}

describe('Recipe retrieval profile truth and readiness', () => {
  it('round-trips the additive profile through domain, Markdown and API wire without loss', () => {
    const entry = makeNativeEntry();
    const writer = new KnowledgeFileWriter(process.cwd());

    const domainRoundTrip = KnowledgeEntry.fromJSON(entry.toJSON());
    const markdownRoundTrip = KnowledgeEntry.fromJSON(
      parseKnowledgeMarkdown(writer.serialize(entry))
    );

    expect(domainRoundTrip.retrievalProfile).toEqual(entry.retrievalProfile);
    expect(markdownRoundTrip.retrievalProfile).toEqual(entry.retrievalProfile);
    expect(entry.toJSON().retrievalProfile).toEqual(entry.retrievalProfile);
  });

  it('never invents English facts while projecting a legacy primary-language Recipe', () => {
    const legacy = new KnowledgeEntry({
      title: '模块边界',
      description: '功能模块只能依赖基础设施协议。',
      whenClause: '新增功能依赖时',
      doClause: '通过协议注入实现',
      dontClause: '禁止功能模块互相直接引用',
      content: { markdown: '组合根负责装配具体实现。' },
      reasoning: { sources: ['src/feature/Module.swift:3-12'] },
      language: 'zh',
    });

    const compatibility = projectCompatibilityRecipeRetrievalProfile(legacy);

    expect(compatibility.summary.technicalEnglish).toBe('');
    expect(
      [
        ...compatibility.concepts.map((item) => item.term),
        ...compatibility.scenarios.map((item) => item.text),
        ...compatibility.exclusions.map((item) => item.text),
      ].join(' ')
    ).not.toMatch(/[A-Za-z]{4}/);
  });

  it('keeps readiness deterministic when the provider is offline', () => {
    const entry = makeNativeEntry();
    const online = evaluateRecipeRetrievalReadiness(entry, { providerAvailable: true });
    const offline = evaluateRecipeRetrievalReadiness(entry, {
      providerAvailable: false,
      vectorStoreAvailable: false,
      providerModel: null,
      vectorDimension: null,
      rankingMetricsAvailable: false,
    });

    expect(online.ready).toBe(true);
    expect(offline.ready).toBe(true);
    expect(offline.violations).toEqual(online.violations);
    expect(offline.profileHash).toBe(online.profileHash);
    expect(offline.documentSetHash).toBe(online.documentSetHash);
    expect(offline.warnings.map((warning) => warning.code)).toContain(
      'retrieval.provider.unavailable'
    );
    expect(offline.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'retrieval.vector-store.unavailable',
        'retrieval.provider.model-missing',
        'retrieval.vector.dimension-missing',
        'retrieval.ranking.metrics-missing',
      ])
    );
  });

  it('reports stable hard violations for ungrounded facts and whole-file code evidence', () => {
    const source = recipeSource({
      coreCode: Array.from(
        { length: 180 },
        (_, index) => `export const value${index} = ${index};`
      ).join('\n'),
    });
    const profile = nativeProfile(source);
    profile.concepts[0] = {
      term: 'invented system boundary',
      language: 'en',
      provenanceRefs: [],
    };
    const report = evaluateRecipeRetrievalReadiness(
      new KnowledgeEntry({ ...source, retrievalProfile: profile })
    );

    expect(report.ready).toBe(false);
    expect(report.violations.map((violation) => violation.code)).toEqual(
      expect.arrayContaining(['retrieval.profile.fact-ungrounded', 'retrieval.core-code.unbounded'])
    );
  });

  it('projects one canonical, distinct document set for sparse and dense generation', () => {
    const entry = makeNativeEntry({
      sourceFile: '/private/project/src/features/user/UserService.ts',
    });
    const documentSet = projectRecipeRetrievalDocumentSet(entry);
    const denseChunks = buildRecipeSemanticRegionChunks(entry);
    const sparseText = serializeRecipeRetrievalDocumentSetForSparse(documentSet);

    expect(documentSet.documents.map((document) => document.role)).toEqual([
      'intent',
      'guidance',
      'implementation',
      'rationale',
    ]);
    expect(denseChunks).toHaveLength(documentSet.documents.length);
    expect(denseChunks.map((chunk) => chunk.content)).toEqual(
      documentSet.documents.map((document) => document.text)
    );
    for (const document of documentSet.documents) {
      expect(sparseText).toContain(document.text);
    }
    expect(sparseText).not.toContain('/private/project');
    expect(
      denseChunks.every((chunk) => chunk.metadata.documentSetHash === documentSet.documentSetHash)
    ).toBe(true);
  });
});

describe('Recipe retrieval profile persistence and active transition', () => {
  let tmpDir: string;
  let connection: DatabaseConnection;
  let repository: KnowledgeRepositoryImpl;
  let service: KnowledgeService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-retrieval-profile-'));
    process.env.ALEMBIC_QUIET = '1';
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    connection = new DatabaseConnection({ path: '.asd/alembic.db' });
    await connection.connect();
    await connection.runMigrations();
    repository = new KnowledgeRepositoryImpl(connection);
    service = new KnowledgeService(repository, { log: async () => {} }, null, null, {
      fileWriter: new KnowledgeFileWriter(tmpDir),
    });
  });

  afterEach(() => {
    connection.close();
    resetDrizzle();
    delete process.env.ALEMBIC_QUIET;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips the profile through real SQLite persistence', async () => {
    const entry = makeNativeEntry();
    const created = await repository.create(entry);
    const fetched = await repository.findById(entry.id);

    expect(created?.retrievalProfile).toEqual(entry.retrievalProfile);
    expect(fetched?.retrievalProfile).toEqual(entry.retrievalProfile);
  });

  it('allows repairable pending truth but blocks every active transition on the same readiness report', async () => {
    const invalid = await service.create(recipeSource({ id: 'pending-invalid' }), {
      userId: 'producer',
    });

    expect(invalid.lifecycle).toBe('pending');
    await expect(service.publish(invalid.id, { userId: 'reviewer' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        readiness: {
          ready: false,
        },
      },
    });
    expect((await repository.findById(invalid.id))?.lifecycle).toBe('pending');

    const validSource = recipeSource({ id: 'pending-valid', title: 'Valid retrieval profile' });
    const valid = await service.create(
      { ...validSource, retrievalProfile: nativeProfile(validSource) },
      { userId: 'producer' }
    );
    const published = await service.publish(valid.id, { userId: 'reviewer' });

    expect(published.lifecycle).toBe('active');
  });

  it('uses the same readiness evaluator on offline lifecycle promotion paths', async () => {
    const invalid = new KnowledgeEntry({
      ...recipeSource({ id: 'offline-invalid' }),
      lifecycle: 'staging',
    });
    await repository.create(invalid);
    const lifecycle = new LifecycleStateMachine(
      repository,
      new LifecycleEventRepository(connection.getDrizzle()),
      new SignalBus(),
      new ProposalRepository(connection.getDrizzle())
    );

    const blocked = await lifecycle.transition({
      recipeId: invalid.id,
      targetState: 'active',
      trigger: 'staging-auto-promote',
    });

    expect(blocked).toMatchObject({
      success: false,
      details: { readiness: { ready: false } },
    });
    expect((await repository.findById(invalid.id))?.lifecycle).toBe('staging');
  });
});
