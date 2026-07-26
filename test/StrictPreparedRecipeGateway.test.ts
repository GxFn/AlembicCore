import { describe, expect, it, vi } from 'vitest';
import {
  createRecipeCandidateFingerprintProjectionV1,
  createStrictAcceptedCorpusInspectionV1,
  createStrictAdmissionReceiptV1,
  createStrictG1ReceiptV1,
  createStrictG2ReceiptV1,
  prepareRecipePersistenceV1,
  STRICT_G1_HARD_AXES_V1,
  STRICT_G2_HARD_AXES_V1,
} from '../src/knowledge.js';
import {
  type CreateRecipeItem,
  createStrictRecipePersistedPayloadV1,
  type PreparedRecipeInspectionV1,
  RecipeProductionGateway,
} from '../src/service/knowledge/RecipeProductionGateway.js';
import { ConsolidationAdvisor } from '../src/service/sustain/ConsolidationAdvisor.js';

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
  category: 'architecture',
  trigger: '@prepared-strict-recipe',
  whenClause: 'When persisting an admitted strict Recipe',
  doText: 'Use the journal-authorized prepared identifier and verify exact readback',
  dontText: 'Do not allocate a second identifier after a crash',
  coreCode: 'persistPreparedReviewedCandidate(item, prepared, context)',
  pattern: '',
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
  persistedPayload: createStrictRecipePersistedPayloadV1(validItem(), 'alembic-agent'),
});

const RUN_ID = 'run-1';
const FIXPOINT_HASH = 'sha256:fixpoint';
const PRIVATE_REVISION = 'revision-1';

const G1 = createStrictG1ReceiptV1({
  candidateFingerprint: REVIEWED.authoredFingerprint,
  retrievalReadinessHash: 'sha256:retrieval-ready',
  rows: STRICT_G1_HARD_AXES_V1.map((axis) => ({
    axis,
    verdict: 'pass' as const,
    reasonCode: 'verified',
    evidenceRefs: [`evidence:${axis}`],
  })),
});

const EMPTY_CORPUS = createStrictAcceptedCorpusInspectionV1({
  runId: RUN_ID,
  analysisFixpointHash: FIXPOINT_HASH,
  privateCorpusRevision: PRIVATE_REVISION,
  revisionRootManifestHash: `sha256:${'9'.repeat(64)}`,
  entries: [],
});

const ADMISSION = createStrictAdmissionReceiptV1({
  g1Receipt: G1,
  corpusInspection: EMPTY_CORPUS,
  inputFingerprint: REVIEWED.authoredFingerprint,
  finalAdmittedFingerprint: REVIEWED.authoredFingerprint,
  exactMatches: [],
  semanticMatches: [],
  consolidation: {
    action: 'create',
    reasonCode: 'strict-test-novel-candidate',
    targetRecipeId: null,
    targetFingerprint: null,
  },
  algorithmVersion: 'gateway-admission-v1',
});

const PREPARED = prepareRecipePersistenceV1({
  runId: RUN_ID,
  analysisFixpointHash: FIXPOINT_HASH,
  privateCorpusRevision: PRIVATE_REVISION,
  admissionId: ADMISSION.admissionId,
  cellId: 'core::architecture',
  authoredFingerprint: REVIEWED.authoredFingerprint,
  causalParentIds: [],
  expectedDbHash: 'sha256:db',
  expectedFileHash: 'sha256:file',
  journalStepHash: 'sha256:journal',
});

const G2 = createStrictG2ReceiptV1({
  g1Receipt: G1,
  admissionReceipt: ADMISSION,
  reviewedFingerprint: REVIEWED.authoredFingerprint,
  producer: {
    identity: 'producer-model',
    method: 'recipe-expression-v1',
    modelHash: 'sha256:producer-model',
    promptHash: 'sha256:producer-prompt',
  },
  reviewer: {
    identity: 'independent-reviewer',
    method: 'value-gate-v1',
    modelHash: 'sha256:reviewer-model',
    promptHash: 'sha256:reviewer-prompt',
  },
  rows: STRICT_G2_HARD_AXES_V1.map((axis) => ({
    axis,
    axisVerdict: 'pass' as const,
    score: 2 as const,
    reasonCode: 'verified',
    evidenceRefs: [`evidence:${axis}`],
    repairable: false,
  })),
  novelty: {
    decision: 'novel-project-specific',
    reasonCode: 'project-specific-mechanism',
    evidenceRefs: ['E-1'],
  },
  duplicate: {
    decision: 'no-match',
    reasonCode: 'complete-corpus-no-match',
    evidenceRefs: ['E-1'],
    admissionAlgorithmVersion: ADMISSION.algorithmVersion,
    comparedPrivateCorpusRevision: ADMISSION.privateCorpusRevision,
    matchedRecipeIds: [],
    matchedFingerprints: [],
    targetRecipeId: null,
    consolidationFingerprint: null,
  },
  repairAttempt: 0,
  calibrationReceiptHash: 'sha256:calibration',
  ruleVersion: 'strict-g2-rule-v1',
  permittedRepairFields: [],
});

const AUTHORITY = {
  g1Receipt: G1,
  admissionReceipt: ADMISSION,
  g2Receipt: G2,
};

describe('strict prepared Recipe Gateway path', () => {
  it('admits against a complete accepted corpus without invoking any write path', async () => {
    const knowledgeService = {
      create: vi.fn(),
      update: vi.fn(),
      updateQuality: vi.fn(),
    };
    const proposalCreate = vi.fn(() => null);
    const proposalSubmit = vi.fn(async () => ({
      recipeId: 'unused',
      action: 'valid',
      outcome: 'unused',
    }));
    const gateway = new RecipeProductionGateway({
      projectRoot: '/tmp/project',
      knowledgeService,
      proposalRepository: { create: proposalCreate },
      proposalGateway: { submit: proposalSubmit },
      inspectAcceptedRecipeCorpus: vi.fn(async () => EMPTY_CORPUS),
      consolidationAdvisor: {
        analyzeAgainstAcceptedCorpus: vi.fn(async () => ({
          action: 'create',
          confidence: 1,
          reason: 'complete accepted corpus has no overlap',
        })),
        analyzeBatch: vi.fn(async (candidates) => ({
          items: candidates.map((_candidate, index) => ({
            index,
            advice: {
              action: 'create',
              confidence: 1,
              reason: 'complete accepted corpus has no overlap',
            },
          })),
          internalOverlaps: [],
        })),
      },
    });

    const admitted = await gateway.admitCandidate(validItem(), {
      source: 'alembic-agent',
      g1Receipt: G1,
      reviewedProjection: REVIEWED,
      runId: PREPARED.runId,
      analysisFixpointHash: PREPARED.analysisFixpointHash,
      privateCorpusRevision: PREPARED.privateCorpusRevision,
      revisionRootManifestHash: EMPTY_CORPUS.revisionRootManifestHash,
    });

    expect(admitted.receipt).toMatchObject({
      disposition: 'admit',
      inputFingerprint: REVIEWED.authoredFingerprint,
      finalAdmittedFingerprint: REVIEWED.authoredFingerprint,
      inspectedAcceptedCorpusCount: 0,
      truncated: false,
    });
    expect(admitted.projection).toEqual(REVIEWED);
    expect(knowledgeService.create).not.toHaveBeenCalled();
    expect(knowledgeService.update).not.toHaveBeenCalled();
    expect(knowledgeService.updateQuality).not.toHaveBeenCalled();
    expect(proposalCreate).not.toHaveBeenCalled();
    expect(proposalSubmit).not.toHaveBeenCalled();
  });

  it('runs the real consolidation algorithm only against the inspected complete corpus', async () => {
    const acceptedProjection = createRecipeCandidateFingerprintProjectionV1({
      ...REVIEWED,
      title: 'Accepted durable Recipe',
      trigger: '@accepted-durable-recipe',
      persistedPayload: createStrictRecipePersistedPayloadV1(
        validItem({
          title: 'Accepted durable Recipe',
          trigger: '@accepted-durable-recipe',
        }),
        'alembic-agent'
      ),
      authoredFingerprint: undefined,
    } as never);
    const acceptedCorpus = createStrictAcceptedCorpusInspectionV1({
      runId: RUN_ID,
      analysisFixpointHash: FIXPOINT_HASH,
      privateCorpusRevision: PRIVATE_REVISION,
      revisionRootManifestHash: EMPTY_CORPUS.revisionRootManifestHash,
      entries: [
        {
          recipeId: 'accepted-1',
          projection: acceptedProjection,
          admissionSummary: {
            title: acceptedProjection.title,
            category: acceptedProjection.category,
            trigger: acceptedProjection.trigger,
            whenClause: acceptedProjection.whenClause,
            doClause: acceptedProjection.doText,
            dontClause: acceptedProjection.dontText,
            coreCode: acceptedProjection.coreCode,
            guardPattern: acceptedProjection.pattern || null,
            markdown: acceptedProjection.markdown,
          },
        },
      ],
    });
    const repositoryRead = vi.fn(async () => {
      throw new Error('strict admission must not read the advisor repository');
    });
    const advisor = new ConsolidationAdvisor({
      findAllByLifecyclesAndCategory: repositoryRead,
      findByLifecyclesAndTriggerPrefix: repositoryRead,
      findAllByLifecycles: repositoryRead,
    } as never);
    const knowledgeService = {
      create: vi.fn(),
      update: vi.fn(),
      updateQuality: vi.fn(),
    };
    const gateway = new RecipeProductionGateway({
      projectRoot: '/tmp/project',
      knowledgeService,
      inspectAcceptedRecipeCorpus: vi.fn(async () => acceptedCorpus),
      consolidationAdvisor: advisor,
    });

    const admitted = await gateway.admitCandidate(validItem(), {
      source: 'alembic-agent',
      g1Receipt: G1,
      reviewedProjection: REVIEWED,
      runId: RUN_ID,
      analysisFixpointHash: FIXPOINT_HASH,
      privateCorpusRevision: PRIVATE_REVISION,
      revisionRootManifestHash: EMPTY_CORPUS.revisionRootManifestHash,
    });

    expect(admitted.receipt.disposition).toBe('merge');
    expect(admitted.receipt.inspectedAcceptedCorpusCount).toBe(1);
    expect(repositoryRead).not.toHaveBeenCalled();
    expect(knowledgeService.create).not.toHaveBeenCalled();
  });

  it('returns an immutable duplicate receipt for validator-level exact matches', async () => {
    const exactCorpus = createStrictAcceptedCorpusInspectionV1({
      runId: RUN_ID,
      analysisFixpointHash: FIXPOINT_HASH,
      privateCorpusRevision: PRIVATE_REVISION,
      revisionRootManifestHash: EMPTY_CORPUS.revisionRootManifestHash,
      entries: [
        {
          recipeId: 'accepted-exact',
          projection: REVIEWED,
          admissionSummary: {
            title: REVIEWED.title,
            category: REVIEWED.category,
            trigger: REVIEWED.trigger,
            whenClause: REVIEWED.whenClause,
            doClause: REVIEWED.doText,
            dontClause: REVIEWED.dontText,
            coreCode: REVIEWED.coreCode,
            guardPattern: REVIEWED.pattern || null,
            markdown: REVIEWED.markdown,
          },
        },
      ],
    });
    const create = vi.fn();
    const gateway = new RecipeProductionGateway({
      projectRoot: '/tmp/project',
      knowledgeService: { create, update: vi.fn(), updateQuality: vi.fn() },
      inspectAcceptedRecipeCorpus: vi.fn(async () => exactCorpus),
      consolidationAdvisor: {
        analyzeAgainstAcceptedCorpus: vi.fn(() => ({
          action: 'create',
          confidence: 1,
          reason: 'advisor result is superseded by exact validator evidence',
        })),
        analyzeBatch: vi.fn(),
      },
    });

    const result = await gateway.admitCandidate(validItem(), {
      source: 'alembic-agent',
      g1Receipt: G1,
      reviewedProjection: REVIEWED,
      runId: RUN_ID,
      analysisFixpointHash: FIXPOINT_HASH,
      privateCorpusRevision: PRIVATE_REVISION,
      revisionRootManifestHash: EMPTY_CORPUS.revisionRootManifestHash,
    });

    expect(result.receipt).toMatchObject({
      disposition: 'duplicate',
      exactMatches: [{ recipeId: 'accepted-exact', fingerprint: REVIEWED.authoredFingerprint }],
      consolidation: {
        action: 'insufficient',
        targetRecipeId: 'accepted-exact',
      },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('fails closed when corpus inspection or consolidation authority is unavailable', async () => {
    const knowledgeService = {
      create: vi.fn(),
      update: vi.fn(),
      updateQuality: vi.fn(),
    };
    const missingAdvisor = new RecipeProductionGateway({
      projectRoot: '/tmp/project',
      knowledgeService,
      inspectAcceptedRecipeCorpus: vi.fn(async () => EMPTY_CORPUS),
    });
    await expect(
      missingAdvisor.admitCandidate(validItem(), {
        source: 'alembic-agent',
        g1Receipt: G1,
        reviewedProjection: REVIEWED,
        runId: PREPARED.runId,
        analysisFixpointHash: PREPARED.analysisFixpointHash,
        privateCorpusRevision: PREPARED.privateCorpusRevision,
        revisionRootManifestHash: EMPTY_CORPUS.revisionRootManifestHash,
      })
    ).rejects.toThrow('STRICT_ADMISSION_AUTHORITY_UNAVAILABLE');

    const failedAdvisor = new RecipeProductionGateway({
      projectRoot: '/tmp/project',
      knowledgeService,
      inspectAcceptedRecipeCorpus: vi.fn(async () => EMPTY_CORPUS),
      consolidationAdvisor: {
        analyzeAgainstAcceptedCorpus: vi.fn(async () => {
          throw new Error('advisor unavailable');
        }),
        analyzeBatch: vi.fn(async () => {
          throw new Error('advisor unavailable');
        }),
      },
    });
    await expect(
      failedAdvisor.admitCandidate(validItem(), {
        source: 'alembic-agent',
        g1Receipt: G1,
        reviewedProjection: REVIEWED,
        runId: PREPARED.runId,
        analysisFixpointHash: PREPARED.analysisFixpointHash,
        privateCorpusRevision: PREPARED.privateCorpusRevision,
        revisionRootManifestHash: EMPTY_CORPUS.revisionRootManifestHash,
      })
    ).rejects.toThrow('STRICT_ADMISSION_CONSOLIDATION_FAILED');
    expect(knowledgeService.create).not.toHaveBeenCalled();
  });

  it('rejects an incomplete or truncated accepted-corpus inspection', async () => {
    const gateway = new RecipeProductionGateway({
      projectRoot: '/tmp/project',
      knowledgeService: {
        create: vi.fn(),
        update: vi.fn(),
        updateQuality: vi.fn(),
      },
      inspectAcceptedRecipeCorpus: vi.fn(async () => ({
        ...EMPTY_CORPUS,
        complete: false,
        truncated: true,
      })),
      consolidationAdvisor: {
        analyzeAgainstAcceptedCorpus: vi.fn(),
        analyzeBatch: vi.fn(),
      },
    });

    await expect(
      gateway.admitCandidate(validItem(), {
        source: 'alembic-agent',
        g1Receipt: G1,
        reviewedProjection: REVIEWED,
        runId: PREPARED.runId,
        analysisFixpointHash: PREPARED.analysisFixpointHash,
        privateCorpusRevision: PREPARED.privateCorpusRevision,
        revisionRootManifestHash: EMPTY_CORPUS.revisionRootManifestHash,
      })
    ).rejects.toThrow('STRICT_ADMISSION_CORPUS_INCOMPLETE');
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
      ...AUTHORITY,
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
      ...AUTHORITY,
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
      ...AUTHORITY,
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
        ...AUTHORITY,
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
        ...AUTHORITY,
      })
    ).rejects.toThrow('STRICT_PREPARED_PERSISTENCE_DIVERGENCE');
  });

  it('rejects an item changed after G1 review before journal authorization or write', async () => {
    const create = vi.fn();
    const authorizePreparedRecipe = vi.fn(() => true);
    const inspectPreparedRecipe = vi.fn(async () => null);
    const gateway = new RecipeProductionGateway({
      projectRoot: '/tmp/project',
      knowledgeService: { create, update: vi.fn(), updateQuality: vi.fn() },
      authorizePreparedRecipe,
      inspectPreparedRecipe,
    });

    const base = validItem();
    const changedItems: Array<{
      item: CreateRecipeItem;
      error:
        | 'STRICT_PREPARED_AUTHORING_FINGERPRINT_MISMATCH'
        | 'STRICT_PREPARED_HIDDEN_FALLBACK_FIELDS_PROHIBITED';
    }> = [
      {
        item: validItem({ doClause: 'Changed after review' }),
        error: 'STRICT_PREPARED_AUTHORING_FINGERPRINT_MISMATCH',
      },
      {
        item: validItem({ trigger: '@changed-after-review' }),
        error: 'STRICT_PREPARED_AUTHORING_FINGERPRINT_MISMATCH',
      },
      {
        item: validItem({ whenClause: 'A changed activation condition' }),
        error: 'STRICT_PREPARED_AUTHORING_FINGERPRINT_MISMATCH',
      },
      {
        item: validItem({ category: 'security' }),
        error: 'STRICT_PREPARED_AUTHORING_FINGERPRINT_MISMATCH',
      },
      {
        item: validItem({ coreCode: 'dangerousUnreviewedOperation()' }),
        error: 'STRICT_PREPARED_AUTHORING_FINGERPRINT_MISMATCH',
      },
      {
        item: validItem({
          content: { ...base.content, pattern: 'unreviewed(pattern)' },
        }),
        error: 'STRICT_PREPARED_AUTHORING_FINGERPRINT_MISMATCH',
      },
      ...[
        validItem({ description: 'Unreviewed persistence description' }),
        validItem({
          content: { ...base.content, rationale: 'Unreviewed rationale' },
        }),
        validItem({
          content: { ...base.content, privateExtension: 'unreviewed-content-field' },
        }),
        validItem({ topicHint: 'unreviewed-topic' }),
        validItem({ tags: ['unreviewed-tag'] }),
        validItem({
          reasoning: { ...base.reasoning, confidence: 0.1 },
        }),
        validItem({ headers: ['Unreviewed Header'] }),
        validItem({ headerPaths: ['unreviewed/header'] }),
        validItem({ includeHeaders: true }),
        validItem({ language: 'javascript' }),
        validItem({ knowledgeType: 'unreviewed-type' }),
        validItem({ source: 'unreviewed-source' }),
        validItem({ relations: { related: ['unreviewed-recipe'] } }),
        validItem({ complexity: 'critical' }),
        validItem({ sourceFile: 'unreviewed.md' }),
        validItem({ sourceCandidateId: 'candidate-unreviewed' }),
        validItem({ agentNotes: 'unreviewed notes' }),
        validItem({ aiInsight: 'unreviewed insight' }),
      ].map((item) => ({
        item,
        error: 'STRICT_PREPARED_AUTHORING_FINGERPRINT_MISMATCH' as const,
      })),
      {
        item: validItem({ metadata: { sourceFile: 'covert.md' } }),
        error: 'STRICT_PREPARED_HIDDEN_FALLBACK_FIELDS_PROHIBITED',
      },
    ];
    for (const changed of changedItems) {
      await expect(
        gateway.persistPreparedReviewedCandidate(changed.item, PREPARED, {
          source: 'alembic-agent',
          userId: 'strict-runner',
          journalToken: 'opaque-journal-token',
          reviewedProjection: REVIEWED,
          ...AUTHORITY,
        })
      ).rejects.toThrow(changed.error);
    }
    expect(authorizePreparedRecipe).not.toHaveBeenCalled();
    expect(inspectPreparedRecipe).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a mismatched G1 → Admission → G2 chain before recovery inspection or write', async () => {
    const create = vi.fn();
    const authorizePreparedRecipe = vi.fn(() => true);
    const inspectPreparedRecipe = vi.fn(async () => null);
    const gateway = new RecipeProductionGateway({
      projectRoot: '/tmp/project',
      knowledgeService: { create, update: vi.fn(), updateQuality: vi.fn() },
      authorizePreparedRecipe,
      inspectPreparedRecipe,
    });

    await expect(
      gateway.persistPreparedReviewedCandidate(validItem(), PREPARED, {
        source: 'alembic-agent',
        userId: 'strict-runner',
        journalToken: 'opaque-journal-token',
        reviewedProjection: REVIEWED,
        ...AUTHORITY,
        admissionReceipt: {
          ...ADMISSION,
          finalAdmittedFingerprint: 'sha256:tampered',
        },
      })
    ).rejects.toThrow('STRICT_PERSISTENCE_AUTHORITY_MISMATCH');
    expect(authorizePreparedRecipe).not.toHaveBeenCalled();
    expect(inspectPreparedRecipe).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

function inspection(id: string): PreparedRecipeInspectionV1 {
  return {
    id,
    title: 'Prepared strict Recipe',
    lifecycle: 'pending',
    privateCorpusRevision: PREPARED.privateCorpusRevision,
    preparedHash: PREPARED.preparedHash,
    admissionId: PREPARED.admissionId,
    g1ReceiptHash: G1.receiptHash,
    admissionReceiptHash: ADMISSION.receiptHash,
    g2ReceiptHash: G2.receiptHash,
    authoredFingerprint: PREPARED.authoredFingerprint,
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
    headers: [],
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
