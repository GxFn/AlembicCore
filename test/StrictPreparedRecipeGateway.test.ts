import { describe, expect, it, vi } from 'vitest';
import {
  createRecipeCandidateFingerprintProjectionV1,
  prepareRecipePersistenceV1,
} from '../src/knowledge.js';
import {
  type CreateRecipeItem,
  type PreparedRecipeInspectionV1,
  RecipeProductionGateway,
} from '../src/service/knowledge/RecipeProductionGateway.js';

const RETRIEVAL_PROFILE = {
  schemaVersion: '1',
  primaryLanguage: 'en',
  summary: { primary: 'Prepared persistence', technicalEnglish: 'Prepared persistence' },
  concepts: [{ term: 'prepared persistence', language: 'en', provenanceRefs: ['E-1'] }],
  scenarios: [{ text: 'replay after a crash', language: 'en', provenanceRefs: ['E-1'] }],
  exclusions: [{ text: 'random replacement identifier', language: 'en', provenanceRefs: ['E-1'] }],
  provenance: {
    evidenceRefs: ['E-1'],
    sourceFieldRefs: ['doClause', 'dontClause'],
    sourceContentHash: 'sha256:source-content',
    generator: 'strict-test',
  },
};

const REVIEWED = createRecipeCandidateFingerprintProjectionV1({
  title: 'Prepared strict Recipe',
  kind: 'pattern',
  doText: 'Use the journal-authorized prepared identifier and verify exact readback',
  dontText: 'Do not allocate a second identifier after a crash',
  markdown:
    '# Prepared strict Recipe\n\nPersist through the reviewed Gateway path and verify DB/file hashes before marking the journal step consumed.\n\n```ts\nawait gateway.persistPreparedReviewedCandidate(item, prepared, context);\n```\n\nSource: src/service/knowledge/RecipeProductionGateway.ts:420',
  usageGuide: 'Use only after serial admission and before marking PERSIST_CONSUMED.',
  retrievalProfile: RETRIEVAL_PROFILE,
  negativeIntents: ['random replacement identifier'],
  scopeId: 'core',
  moduleId: 'core',
  dimensionId: 'architecture',
  evidenceRefs: ['E-1'],
  lineageHashes: ['sha256:fixpoint'],
});

const PREPARED = prepareRecipePersistenceV1({
  runId: 'run-1',
  analysisFixpointHash: 'sha256:fixpoint',
  privateCorpusRevision: 'revision-1',
  cellId: 'core::architecture',
  authoredFingerprint: REVIEWED.authoredFingerprint,
  causalParentIds: [],
  expectedDbHash: 'sha256:db',
  expectedFileHash: 'sha256:file',
  journalStepHash: 'sha256:journal',
});

describe('strict prepared Recipe Gateway path', () => {
  it('rejects public caller ID injection on the ordinary create path', async () => {
    const create = vi.fn(async (data: Record<string, unknown>) => ({
      ...data,
      id: 'service-allocated-id',
      title: data.title as string,
      lifecycle: 'pending',
    }));
    const gateway = new RecipeProductionGateway({
      projectRoot: '/tmp/project',
      knowledgeService: {
        create,
        update: vi.fn(),
        updateQuality: vi.fn(),
      },
    });
    const item = validItem({
      id: PREPARED.preparedRecipeId,
      preparedRecipeId: PREPARED.preparedRecipeId,
      metadata: { id: PREPARED.preparedRecipeId, preparedRecipeId: PREPARED.preparedRecipeId },
    });

    const result = await gateway.create({
      source: 'host-agent',
      items: [item],
      options: { skipConsolidation: true },
    });
    expect(result.created).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('authorizes the internal prepared ID, reads it back, and reports zero UUID allocation', async () => {
    let stored: PreparedRecipeInspectionV1 | null = null;
    const create = vi.fn(async (data: Record<string, unknown>) => {
      stored = inspection(data.id as string);
      return { id: data.id as string, title: data.title as string, lifecycle: 'pending' };
    });
    const gateway = new RecipeProductionGateway({
      projectRoot: '/tmp/project',
      knowledgeService: { create, update: vi.fn(), updateQuality: vi.fn() },
      authorizePreparedRecipe: vi.fn(() => true),
      inspectPreparedRecipe: vi.fn(async () => stored),
    });

    const result = await gateway.persistPreparedReviewedCandidate(validItem(), PREPARED, {
      source: 'alembic-agent',
      userId: 'strict-runner',
      journalToken: 'opaque-journal-token',
      reviewedProjection: REVIEWED,
    });
    expect(result.status).toBe('created');
    expect(result.recipe.id).toBe(PREPARED.preparedRecipeId);
    expect(result.strictUuidAllocations).toBe(0);
    expect(create.mock.calls[0]?.[0].id).toBe(PREPARED.preparedRecipeId);
  });

  it('recovers an exact persist-before-consumed row without creating a duplicate', async () => {
    const create = vi.fn();
    const gateway = new RecipeProductionGateway({
      projectRoot: '/tmp/project',
      knowledgeService: { create, update: vi.fn(), updateQuality: vi.fn() },
      authorizePreparedRecipe: vi.fn(() => true),
      inspectPreparedRecipe: vi.fn(async () => inspection(PREPARED.preparedRecipeId)),
    });

    const result = await gateway.persistPreparedReviewedCandidate(validItem(), PREPARED, {
      source: 'alembic-agent',
      userId: 'strict-runner',
      journalToken: 'opaque-journal-token',
      reviewedProjection: REVIEWED,
    });
    expect(result.status).toBe('recovered');
    expect(result.strictUuidAllocations).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('replays a persist-before-journal-consumed crash without a second Recipe', async () => {
    let stored: PreparedRecipeInspectionV1 | null = null;
    const create = vi.fn(async (data: Record<string, unknown>) => {
      stored = inspection(data.id as string);
      throw new Error('injected-after-persist-before-consumed-crash');
    });
    const gateway = new RecipeProductionGateway({
      projectRoot: '/tmp/project',
      knowledgeService: { create, update: vi.fn(), updateQuality: vi.fn() },
      authorizePreparedRecipe: vi.fn(() => true),
      inspectPreparedRecipe: vi.fn(async () => stored),
    });
    const context = {
      source: 'alembic-agent' as const,
      userId: 'strict-runner',
      journalToken: 'opaque-journal-token',
      reviewedProjection: REVIEWED,
    };

    await expect(
      gateway.persistPreparedReviewedCandidate(validItem(), PREPARED, context)
    ).rejects.toThrow('injected-after-persist-before-consumed-crash');
    const recovered = await gateway.persistPreparedReviewedCandidate(
      validItem(),
      PREPARED,
      context
    );
    expect(recovered.status).toBe('recovered');
    expect(recovered.recipe.id).toBe(PREPARED.preparedRecipeId);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('fails closed for unauthorized or mismatched revision readback', async () => {
    const create = vi.fn();
    const unauthorized = new RecipeProductionGateway({
      projectRoot: '/tmp/project',
      knowledgeService: { create, update: vi.fn(), updateQuality: vi.fn() },
      authorizePreparedRecipe: vi.fn(() => false),
      inspectPreparedRecipe: vi.fn(async () => null),
    });
    await expect(
      unauthorized.persistPreparedReviewedCandidate(validItem(), PREPARED, {
        source: 'alembic-agent',
        userId: 'strict-runner',
        journalToken: 'bad-token',
        reviewedProjection: REVIEWED,
      })
    ).rejects.toThrow('STRICT_PREPARED_PERSISTENCE_UNAUTHORIZED');

    const mismatch = new RecipeProductionGateway({
      projectRoot: '/tmp/project',
      knowledgeService: { create, update: vi.fn(), updateQuality: vi.fn() },
      authorizePreparedRecipe: vi.fn(() => true),
      inspectPreparedRecipe: vi.fn(async () => ({
        ...inspection(PREPARED.preparedRecipeId),
        privateCorpusRevision: 'revision-old',
      })),
    });
    await expect(
      mismatch.persistPreparedReviewedCandidate(validItem(), PREPARED, {
        source: 'alembic-agent',
        userId: 'strict-runner',
        journalToken: 'opaque-journal-token',
        reviewedProjection: REVIEWED,
      })
    ).rejects.toThrow('STRICT_PREPARED_PERSISTENCE_DIVERGENCE');
  });

  it('rejects an item changed after G1 review before journal authorization or write', async () => {
    const create = vi.fn();
    const authorizePreparedRecipe = vi.fn(() => true);
    const gateway = new RecipeProductionGateway({
      projectRoot: '/tmp/project',
      knowledgeService: { create, update: vi.fn(), updateQuality: vi.fn() },
      authorizePreparedRecipe,
      inspectPreparedRecipe: vi.fn(async () => null),
    });

    await expect(
      gateway.persistPreparedReviewedCandidate(
        validItem({ doClause: 'Changed after review' }),
        PREPARED,
        {
          source: 'alembic-agent',
          userId: 'strict-runner',
          journalToken: 'opaque-journal-token',
          reviewedProjection: REVIEWED,
        }
      )
    ).rejects.toThrow('STRICT_PREPARED_AUTHORING_FINGERPRINT_MISMATCH');
    expect(authorizePreparedRecipe).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

function inspection(id: string): PreparedRecipeInspectionV1 {
  return {
    id,
    title: 'Prepared strict Recipe',
    lifecycle: 'pending',
    privateCorpusRevision: PREPARED.privateCorpusRevision,
    dbHash: PREPARED.expectedDbHash,
    fileHash: PREPARED.expectedFileHash,
  };
}

function validItem(overrides: Partial<CreateRecipeItem> = {}): CreateRecipeItem {
  return {
    title: 'Prepared strict Recipe',
    description: 'Durable journal-bound creation with evidence and recovery semantics',
    trigger: '@prepared-strict-recipe',
    kind: 'pattern',
    topicHint: 'persistence',
    whenClause: 'When persisting an admitted strict Recipe',
    doClause: 'Use the journal-authorized prepared identifier and verify exact readback',
    dontClause: 'Do not allocate a second identifier after a crash',
    coreCode: 'persistPreparedReviewedCandidate(item, prepared, context)',
    content: {
      markdown:
        '# Prepared strict Recipe\n\nPersist through the reviewed Gateway path and verify DB/file hashes before marking the journal step consumed.\n\n```ts\nawait gateway.persistPreparedReviewedCandidate(item, prepared, context);\n```\n\nSource: src/service/knowledge/RecipeProductionGateway.ts:420',
      rationale: 'Exact prepared IDs make persist-before-consumed recovery idempotent.',
    },
    reasoning: {
      whyStandard: 'One journal-authorized identity prevents duplicate Recipes.',
      sources: ['src/service/knowledge/RecipeProductionGateway.ts'],
      confidence: 0.95,
    },
    tags: ['persistence', 'idempotency'],
    language: 'typescript',
    category: 'architecture',
    knowledgeType: 'code-pattern',
    usageGuide: 'Use only after serial admission and before marking PERSIST_CONSUMED.',
    retrievalProfile: RETRIEVAL_PROFILE,
    scope: 'core',
    moduleName: 'core',
    dimensionId: 'architecture',
    sourceRefs: ['E-1'],
    ...overrides,
  };
}
