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
  RecipeProductionGateway,
  type RecipeProductionPort,
} from '../src/service/knowledge/RecipeProductionGateway.js';
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

  it('keeps default-only topic, category, and module labels out of retrieval facts', () => {
    const legacy = new KnowledgeEntry(
      recipeSource({
        language: 'en',
        category: 'general',
        topicHint: 'Utility',
        moduleName: 'default',
        tags: [],
      })
    );

    const compatibility = projectCompatibilityRecipeRetrievalProfile(legacy);
    const intent = projectRecipeRetrievalDocumentSet(legacy).documents.find(
      (document) => document.role === 'intent'
    );

    expect(compatibility.concepts.map((concept) => concept.term.toLowerCase())).not.toEqual(
      expect.arrayContaining(['utility', 'general', 'default'])
    );
    expect(intent?.text.split('\n').map((line) => line.toLowerCase())).not.toEqual(
      expect.arrayContaining(['utility', 'general', 'default'])
    );
  });

  it('reports stable hard violations when default-only labels masquerade as native concepts', () => {
    const source = recipeSource({
      category: 'general',
      topicHint: 'Utility',
      moduleName: 'default',
    });
    const profile = nativeProfile(source);
    profile.provenance.sourceFieldRefs.push(
      'field:category',
      'field:topicHint',
      'field:moduleName'
    );
    profile.concepts.push(
      { term: 'Utility', language: 'en', provenanceRefs: ['field:topicHint'] },
      { term: 'general', language: 'en', provenanceRefs: ['field:category'] },
      { term: 'default', language: 'en', provenanceRefs: ['field:moduleName'] }
    );

    const report = evaluateRecipeRetrievalReadiness(
      new KnowledgeEntry({ ...source, retrievalProfile: profile })
    );

    expect(report.ready).toBe(false);
    expect(
      report.violations
        .filter((violation) => violation.code === 'retrieval.profile.concept-default-only')
        .map((violation) => violation.field)
    ).toEqual([
      'retrievalProfile.concepts.2',
      'retrievalProfile.concepts.3',
      'retrievalProfile.concepts.4',
    ]);
  });

  it('reports stable hard violations at raw source indices for blank and placeholder concepts', () => {
    const source = recipeSource();
    const profile = nativeProfile(source);
    const placeholders = [
      '',
      '   \t',
      '-',
      'n/a',
      'na',
      'none',
      'null',
      'undefined',
      'unknown',
      'todo',
      'tbd',
    ];
    profile.concepts.push(
      ...placeholders.map((term) => ({
        term,
        language: 'en',
        provenanceRefs: ['field:description'],
      }))
    );

    const report = evaluateRecipeRetrievalReadiness(
      new KnowledgeEntry({ ...source, retrievalProfile: profile })
    );

    expect(report.ready).toBe(false);
    expect(
      report.violations
        .filter((violation) => violation.code === 'retrieval.profile.concept-placeholder')
        .map((violation) => violation.field)
    ).toEqual(placeholders.map((_, index) => `retrievalProfile.concepts.${index + 2}`).sort());
  });

  it('reports indexed structural violations across every raw fact bucket', () => {
    const source = recipeSource();
    const profile = nativeProfile(source);
    (profile.concepts as unknown[]).splice(1, 0, {
      term: 42,
      language: 'en',
      provenanceRefs: ['field:description'],
    });
    (profile.concepts as unknown[]).push({
      term: 'typed contract',
      language: '   ',
      provenanceRefs: ['field:description'],
    });
    (profile.scenarios as unknown[]).splice(0, 0, {
      text: '  \n ',
      language: 'en',
      provenanceRefs: ['field:whenClause'],
    });
    (profile.scenarios as unknown[]).push(null);
    (profile.exclusions as unknown[])[0] = {
      text: 'Do not publish malformed facts.',
      language: 'en',
      provenanceRefs: 'field:dontClause',
    };

    const report = evaluateRecipeRetrievalReadiness(
      new KnowledgeEntry({ ...source, retrievalProfile: profile })
    );
    const indexed = report.violations.map(({ code, field }) => ({ code, field }));

    expect(report.ready).toBe(false);
    expect(indexed).toEqual(
      expect.arrayContaining([
        {
          code: 'retrieval.profile.fact-value-invalid',
          field: 'retrievalProfile.concepts.1.term',
        },
        {
          code: 'retrieval.profile.fact-language-invalid',
          field: 'retrievalProfile.concepts.3.language',
        },
        {
          code: 'retrieval.profile.fact-value-empty',
          field: 'retrievalProfile.scenarios.0.text',
        },
        {
          code: 'retrieval.profile.fact-structure-invalid',
          field: 'retrievalProfile.scenarios.2',
        },
        {
          code: 'retrieval.profile.fact-provenance-invalid',
          field: 'retrievalProfile.exclusions.0.provenanceRefs',
        },
      ])
    );
  });

  it('rejects non-array raw fact buckets before normalization can erase them', () => {
    const source = recipeSource();
    const profile = nativeProfile(source);
    (profile as unknown as Record<string, unknown>).concepts = { term: 'not-an-array' };
    (profile as unknown as Record<string, unknown>).scenarios = 'not-an-array';
    (profile as unknown as Record<string, unknown>).exclusions = null;

    const report = evaluateRecipeRetrievalReadiness(
      new KnowledgeEntry({ ...source, retrievalProfile: profile })
    );

    expect(report.ready).toBe(false);
    expect(
      report.violations
        .filter((violation) => violation.code === 'retrieval.profile.fact-bucket-invalid')
        .map((violation) => violation.field)
    ).toEqual([
      'retrievalProfile.concepts',
      'retrievalProfile.exclusions',
      'retrievalProfile.scenarios',
    ]);
  });

  it('allows meaningful phrases that merely contain placeholder or default-label words', () => {
    const source = recipeSource({
      tags: [
        'shared utility module',
        'general-purpose retry',
        'default export boundary',
        'unknown enum case handling',
        'TODO comment lifecycle',
      ],
    });
    const profile = nativeProfile(source);
    profile.provenance.sourceFieldRefs.push('field:tags');
    profile.concepts.push(
      { term: 'shared utility module', language: 'en', provenanceRefs: ['field:tags'] },
      { term: 'general-purpose retry', language: 'en', provenanceRefs: ['field:tags'] },
      { term: 'default export boundary', language: 'en', provenanceRefs: ['field:tags'] },
      { term: 'unknown enum case handling', language: 'en', provenanceRefs: ['field:tags'] },
      { term: 'TODO comment lifecycle', language: 'en', provenanceRefs: ['field:tags'] }
    );

    const report = evaluateRecipeRetrievalReadiness(
      new KnowledgeEntry({ ...source, retrievalProfile: profile })
    );

    expect(report.violations.map((violation) => violation.code)).not.toContain(
      'retrieval.profile.concept-default-only'
    );
    expect(report.violations.map((violation) => violation.code)).not.toContain(
      'retrieval.profile.concept-placeholder'
    );
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

  it('accepts the first-generation source hash that included persisted Recipe identity', () => {
    const source = recipeSource();
    const profile = nativeProfile(source);
    profile.provenance.sourceContentHash =
      '0dc4a0c70d0d8c165d5972ca37c3b6ea9ada7363ca3e28a0d71d604dc7915faf';

    const report = evaluateRecipeRetrievalReadiness(
      new KnowledgeEntry({ ...source, retrievalProfile: profile })
    );

    expect(report.ready).toBe(true);
    expect(report.violations).toEqual([]);
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

  it('preserves malformed authored facts but blocks publish and filters them from projection', async () => {
    const source = recipeSource({
      id: 'raw-profile-structural-violations',
      title: 'Raw profile facts are validated before deterministic projection',
    });
    const profile = nativeProfile(source);
    (profile.concepts as unknown[]).push({
      term: 'leaked invalid concept',
      language: '   ',
      provenanceRefs: ['field:description'],
    });
    (profile.scenarios as unknown[]).push({
      text: 'leaked invalid scenario',
      language: 'en',
      provenanceRefs: 'field:whenClause',
    });
    (profile.exclusions as unknown[]).push({
      text: ' \n\t ',
      language: 'en',
      provenanceRefs: ['field:dontClause'],
    });

    const created = await service.create(
      { ...source, retrievalProfile: profile },
      {
        userId: 'producer',
      }
    );
    expect(['pending', 'staging']).toContain(created.lifecycle);
    const fetched = await repository.findById(created.id);
    expect(fetched?.retrievalProfile).toEqual(profile);
    const candidatePath = path.join(tmpDir, fetched?.sourceFile ?? '');
    expect(parseKnowledgeMarkdown(fs.readFileSync(candidatePath, 'utf8')).retrievalProfile).toEqual(
      profile
    );

    const readiness = await service.evaluateRetrievalReadiness(created.id);
    expect(readiness.ready).toBe(false);
    expect(readiness.violations.map(({ code, field }) => ({ code, field }))).toEqual(
      expect.arrayContaining([
        {
          code: 'retrieval.profile.fact-language-invalid',
          field: 'retrievalProfile.concepts.2.language',
        },
        {
          code: 'retrieval.profile.fact-provenance-invalid',
          field: 'retrievalProfile.scenarios.1.provenanceRefs',
        },
        {
          code: 'retrieval.profile.fact-value-empty',
          field: 'retrievalProfile.exclusions.1.text',
        },
      ])
    );
    const projectedText = projectRecipeRetrievalDocumentSet(fetched!)
      .documents.map((document) => document.text)
      .join('\n');
    expect(projectedText).not.toContain('leaked invalid concept');
    expect(projectedText).not.toContain('leaked invalid scenario');

    await expect(service.publish(created.id, { userId: 'reviewer' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { readiness: { ready: false } },
    });
    expect((await repository.findById(created.id))?.lifecycle).toBe(created.lifecycle);
  });

  it('runs the consumer-facing production port through real persistence, projection, and publish', async () => {
    const item = recipeSource({
      title: 'Production ports persist retrieval truth before active publication',
      trigger: '@recipe-production-port',
      topicHint: 'retrieval-production',
      moduleName: 'Knowledge',
      dimensionId: 'architecture',
      headers: [],
      usageGuide:
        '### Usage\nCall createOrStage, inspect the deterministic readiness report, then publish only when ready.',
      coreCode: [
        'const staged = await port.createOrStage(input, context);',
        'const readiness = await port.evaluateReadiness(staged.created[0].id);',
        'await port.publish(staged.created[0].id, context);',
      ].join('\n'),
      content: {
        pattern: 'await port.createOrStage(input, context);',
        markdown: [
          'A producer sends one evidence-grounded Recipe through the shared production port.',
          'The port must use the same Gateway validation and KnowledgeService persistence as every other producer.',
          '```ts',
          'const staged = await port.createOrStage(input, context);',
          'const report = await port.evaluateReadiness(staged.created[0].id);',
          'if (report.ready) await port.publish(staged.created[0].id, context);',
          '```',
          'Source: src/service/knowledge/RecipeProductionGateway.ts:280-360',
        ].join('\n'),
        rationale:
          'One consumer-facing port prevents producers from bypassing persistence or readiness.',
      },
    });
    const profile = nativeProfile(item);
    const port: RecipeProductionPort = new RecipeProductionGateway({
      knowledgeService: service,
      projectRoot: tmpDir,
    });

    const staged = await port.createOrStage(
      {
        items: [{ ...item, retrievalProfile: profile }],
        options: { skipSimilarityCheck: true, skipConsolidation: true },
      },
      { source: 'host-agent', userId: 'producer', capability: 'module-scan' }
    );

    expect(staged.rejected).toEqual([]);
    expect(staged.created).toHaveLength(1);
    expect(staged.production).toEqual({ capability: 'module-scan', source: 'host-agent' });
    const recipeId = staged.created[0].id;
    const persisted = await repository.findById(recipeId);
    expect(persisted?.retrievalProfile).toEqual(profile);
    const candidatePath = path.join(tmpDir, persisted?.sourceFile ?? '');
    expect(fs.existsSync(candidatePath)).toBe(true);
    expect(parseKnowledgeMarkdown(fs.readFileSync(candidatePath, 'utf8')).retrievalProfile).toEqual(
      profile
    );

    const readiness = await port.evaluateReadiness(recipeId);
    expect(readiness.ready).toBe(true);
    expect(readiness.documentSetHash).toBe(
      projectRecipeRetrievalDocumentSet(persisted!).documentSetHash
    );

    const published = await port.publish(recipeId, { userId: 'reviewer' });
    expect(published.lifecycle).toBe('active');
    const active = await repository.findById(recipeId);
    expect(active?.lifecycle).toBe('active');
    expect(active?.sourceFile).toContain('/recipes/');
    expect(fs.existsSync(candidatePath)).toBe(false);
    const activePath = path.join(tmpDir, active?.sourceFile ?? '');
    expect(fs.existsSync(activePath)).toBe(true);
    const activeMarkdown = parseKnowledgeMarkdown(fs.readFileSync(activePath, 'utf8'));
    expect(activeMarkdown.lifecycle).toBe('active');
    expect(activeMarkdown.retrievalProfile).toEqual(profile);
    expect(projectRecipeRetrievalDocumentSet(active!).documentSetHash).toBe(
      readiness.documentSetHash
    );
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
