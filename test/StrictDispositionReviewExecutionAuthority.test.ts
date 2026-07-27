import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assertSemanticDispositionReviewExecutionV1,
  assertSemanticDispositionReviewExecutionV2,
  canonicalizeObservationPopulationV1,
  consumeMainSemanticDispositionReviewExecutionV1,
  consumeMainSemanticDispositionReviewExecutionV2,
  createAgentSemanticDispositionReviewExecutionV1,
  createAgentSemanticDispositionReviewHostGatewayV2,
  createAgentSemanticDispositionReviewRequestV1,
  createAgentSemanticDispositionReviewRequestV2,
  createAnalysisFixpointReceiptV1,
  createFinalExpandedMiningScheduleReceiptV1,
  createInvestigatedEmptyDecisionV1,
  createProducerZeroDispositionAdmissionAuthorityV1,
  createProductionActorIdentityV1,
  createSemanticDispositionReviewEvidenceAuthorityV2,
  createStrictAcceptedCorpusInspectionV1,
  createStrictAdmissionReceiptV1,
  createStrictEvidenceLedgerSnapshotV1,
  createStrictG1ReceiptV1,
  createStrictProductionAuthorityReceiptV1,
  type FactQueryExecutionReceiptV1,
  hashKnowledgeDispositionProposalV1,
  type SemanticDispositionReviewAxisIdV1,
  type SemanticDispositionReviewDecisionV1,
  type SemanticDispositionReviewDecisionV2,
  type SemanticDispositionReviewExecutionV2,
  type SemanticDispositionReviewerHostInvocationV1,
  type SemanticDispositionReviewRequestV1,
  type SemanticDispositionReviewRequestV2,
  STRICT_G1_HARD_AXES_V1,
  type StrictAdmissionReceiptV1,
  type StrictG1ReceiptV1,
  validateHypothesisExpressionSetReceiptV1,
} from '../src/production.js';
import { createProjectContextFileRef } from '../src/projectContextFoundation.js';
import { hashCanonicalJson } from '../src/service/project-context/foundation/canonical.js';

const WORKFLOW_RUN = 'strict-workflow:semantic-review';
const EVALUATOR_RUN = 'agent-host-run:semantic-review:1';
const SOURCE_REVISION = shaText('source-revision');
const REVIEW_SOURCE_BLOB = shaText('review-source-blob');
const REVIEW_EVIDENCE_CONTENT =
  'Frozen evidence: the complete source subject and its disposition comparison were inspected.';

const PRODUCER_AXES: readonly SemanticDispositionReviewAxisIdV1[] = [
  'admission-comparison-completeness',
  'fixpoint-population-execution-lineage',
  'frozen-semantic-evidence-grounding',
  'hypothesis-falsification-context',
  'reviewer-independence',
  'target-disposition-consistency',
  'verdict-sufficiency',
];
const INVESTIGATED_EMPTY_AXES: readonly SemanticDispositionReviewAxisIdV1[] = [
  'empty-population-consistency',
  'fixpoint-population-execution-lineage',
  'frozen-semantic-evidence-grounding',
  'negative-evidence-sufficiency',
  'reviewer-independence',
  'sealed-schedule-terminal-denominator',
  'verdict-sufficiency',
];

describe('semantic disposition-review execution authority', () => {
  it('conserves full Producer semantics and a real evaluator host run through Agent→Main', () => {
    const request = producerRequest();
    const decision = passingDecision(request, PRODUCER_AXES);
    const execution = createAgentSemanticDispositionReviewExecutionV1({
      request,
      invocation: invocation(request, decision),
      decision,
    });
    const review = consumeMainSemanticDispositionReviewExecutionV1({
      execution,
      expectedRequest: request,
    });

    expect(request.context).toMatchObject({
      reviewKind: 'producer-non-draft',
      admissionReceipt: {
        disposition: 'duplicate',
        inputFingerprint: 'fingerprint:candidate',
        consolidation: {
          targetRecipeId: 'recipe:target',
          targetFingerprint: 'fingerprint:target',
        },
      },
    });
    expect(execution.request.evidence[0]?.content).toContain('disposition comparison');
    expect(execution.invocation.evaluatorRunId).toBe(EVALUATOR_RUN);
    expect(execution.invocation.evaluatorRunId).not.toBe(request.strictWorkflowRunId);
    expect(review.reviewer.runId).toBe(EVALUATOR_RUN);
    expect(review.producer.runId).toBe(WORKFLOW_RUN);
    expect(review.semanticExecutionResultHash).toBe(execution.executionHash);
    expect(review.verdict).toBe('pass');
    expect(() => assertSemanticDispositionReviewExecutionV1(execution)).not.toThrow();
  });

  it('binds investigated-empty to the sealed terminal denominator and negative-evidence semantics', () => {
    const request = investigatedEmptyRequest();
    const decision = passingDecision(request, INVESTIGATED_EMPTY_AXES);
    const execution = createAgentSemanticDispositionReviewExecutionV1({
      request,
      invocation: invocation(request, decision),
      decision,
    });
    const review = consumeMainSemanticDispositionReviewExecutionV1({
      execution,
      expectedRequest: request,
    });

    expect(request.context).toMatchObject({
      reviewKind: 'investigated-empty',
      population: {
        completion: 'complete',
        observations: [],
        conservation: { error: 0, omitted: 0, inspectedNoPattern: 1 },
      },
      negativeEvidenceSufficiency: {
        requiredAbsencePredicates: ['no-project-specific-recurring-mechanism'],
      },
    });
    expect(request.executionReceipts).toHaveLength(1);
    expect(request.executionReceipts[0]?.disposition).toBe('inspected-no-pattern');
    expect(review.semanticExecutionResultHash).toBe(execution.executionHash);
    expect(review.reviewer.runId).toBe(EVALUATOR_RUN);
  });

  it('requires exact-one V2 semantic execution in unified authority and rejects resume reuse', async () => {
    const semanticRequest = investigatedEmptyRequest();
    const { request, execution, gateway } = await executeSemanticRequestV2(
      semanticRequest,
      INVESTIGATED_EMPTY_AXES
    );
    const review = consumeMainSemanticDispositionReviewExecutionV2({
      execution,
      expectedRequest: request,
      hostAuthority: gateway.authority,
    });
    const receipt = semanticRequest.executionReceipts[0]!;
    const context = semanticRequest.context;
    if (context.reviewKind !== 'investigated-empty') {
      throw new Error('investigated-empty fixture required');
    }
    const scheduleLineage = authorityScheduleLineage([receipt]);
    const investigatedEmptyDecision = createInvestigatedEmptyDecisionV1({
      sourceRevisionVectorHash: SOURCE_REVISION,
      finalExpandedScheduleHash: semanticRequest.finalExpandedSchedule.finalExpandedScheduleHash,
      currentAnalysisFixpointHash: context.analysisFixpoint.fixpointHash,
      expectedObligationIds: [receipt.obligationId],
      executionReceipts: [receipt],
      dispositionReview: review,
      evidenceEntryIds: ['E-1'],
    });
    const authorityInput = {
      runId: WORKFLOW_RUN,
      sourceRevisionVectorHash: SOURCE_REVISION,
      analysisFixpoint: context.analysisFixpoint,
      privateCorpusRevision: 'private-corpus:investigated-empty',
      factExecution: factExecutionResult(receipt, scheduleLineage.finalFactSchedule),
      ...scheduleLineage,
      populations: [context.population],
      clusterSets: [],
      inductions: [],
      falsifications: [],
      investigatedEmptyDecisions: [investigatedEmptyDecision],
      dispositionReviews: [review],
      semanticDispositionReviewExecutions: [execution],
      semanticDispositionReviewHostAuthority: gateway.authority,
      expressionSets: [],
      candidateAttemptBatches: [],
      serialAdmissionLedger: null,
      terminalEvidence: {
        g1Receipts: [],
        g1TerminalBindings: [],
        corpusInspections: [],
        admissionReceipts: [],
        g2Receipts: [],
        gateReturns: [],
      },
      resourceCaps: {
        candidateAttemptCap: 1,
        maxAuthoredCandidatesPerCellPass: 1,
      },
    };

    expect(createStrictProductionAuthorityReceiptV1(authorityInput)).toMatchObject({
      semanticDispositionReviewExecutionHashes: [execution.executionHash],
      investigatedEmptyDecisionHashes: [investigatedEmptyDecision.decisionHash],
    });
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        ...authorityInput,
        priorSemanticDispositionReviewExecutionHashes: [execution.executionHash],
      })
    ).toThrow('STRICT_PRODUCTION_DISPOSITION_REVIEW_EXECUTION_REUSED');
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        ...authorityInput,
        semanticDispositionReviewExecutions: [],
      })
    ).toThrow('STRICT_PRODUCTION_DISPOSITION_REVIEW_EXECUTION_MISMATCH');
    const orphanRequest = semanticRequestV2(investigatedEmptyRequest('orphan')).request;
    const orphanExecution = await gateway.execute(orphanRequest);
    expect(() =>
      createStrictProductionAuthorityReceiptV1({
        ...authorityInput,
        semanticDispositionReviewExecutions: [execution, orphanExecution],
      })
    ).toThrow('STRICT_PRODUCTION_DISPOSITION_REVIEW_EXECUTION_ORPHANED');
  });

  it('rejects hash-only pass, unrelated-call stamping, identity mismatch, and self invocation', () => {
    const request = producerRequest();
    const decision = passingDecision(request, PRODUCER_AXES);

    expect(() =>
      createAgentSemanticDispositionReviewExecutionV1({
        request,
        invocation: invocation(request, {
          ...decision,
          axisDecisions: [],
          evidenceFindings: [],
        }),
        decision: { ...decision, axisDecisions: [], evidenceFindings: [] },
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_RESULT_SEMANTICS_REQUIRED');

    expect(() =>
      createAgentSemanticDispositionReviewExecutionV1({
        request,
        invocation: {
          ...invocation(request, decision),
          requestHash: shaText('unrelated-request'),
        },
        decision,
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EXECUTION_REQUEST_MISMATCH');

    expect(() =>
      createAgentSemanticDispositionReviewExecutionV1({
        request,
        invocation: {
          ...invocation(request, decision),
          providerId: 'provider:post-hoc-stamp',
        },
        decision,
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EXECUTION_IDENTITY_MISMATCH');

    expect(() =>
      createAgentSemanticDispositionReviewExecutionV1({
        request,
        invocation: {
          ...invocation(request, decision),
          modelId: 'model:post-hoc-stamp',
        },
        decision,
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EXECUTION_IDENTITY_MISMATCH');

    expect(() =>
      createAgentSemanticDispositionReviewExecutionV1({
        request,
        invocation: {
          ...invocation(request, decision),
          evaluatorRunId: WORKFLOW_RUN,
        },
        decision,
      })
    ).toThrow('KNOWLEDGE_DISPOSITION_REVIEW_NOT_INDEPENDENT');

    expect(() =>
      createAgentSemanticDispositionReviewExecutionV1({
        request,
        invocation: {
          ...invocation(request, decision),
          invocationId: request.producer.invocationId,
        },
        decision,
      })
    ).toThrow('KNOWLEDGE_DISPOSITION_REVIEW_NOT_INDEPENDENT');
  });

  it('rejects output/decision tamper and stale or rebound Admission/fixpoint/population/schedule/target', () => {
    const request = producerRequest();
    const decision = passingDecision(request, PRODUCER_AXES);

    expect(() =>
      createAgentSemanticDispositionReviewExecutionV1({
        request,
        invocation: {
          ...invocation(request, decision),
          responseOutputHash: shaText('unrelated-output'),
        },
        decision,
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_OUTPUT_HASH_MISMATCH');
    const reboundOutput = JSON.stringify({ ...decision, reasonCode: 'REBOUND_OUTPUT' });
    expect(() =>
      createAgentSemanticDispositionReviewExecutionV1({
        request,
        invocation: {
          ...invocation(request, decision),
          responseOutput: reboundOutput,
          responseOutputHash: shaText(reboundOutput),
        },
        decision,
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_OUTPUT_DECISION_MISMATCH');

    const execution = createAgentSemanticDispositionReviewExecutionV1({
      request,
      invocation: invocation(request, decision),
      decision,
    });
    expect(() =>
      assertSemanticDispositionReviewExecutionV1({
        ...execution,
        decisionHash: shaText('tampered-decision'),
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EXECUTION_HASH_MISMATCH');

    const context = request.context;
    if (context.reviewKind !== 'producer-non-draft' || !context.admissionReceipt) {
      throw new Error('producer fixture required');
    }
    expect(() =>
      createAgentSemanticDispositionReviewRequestV1({
        ...requestInputFrom(request),
        context: {
          ...context,
          admissionReceipt: admissionFixture(
            shaText('stale-admission-fixpoint'),
            context.g1Receipt
          ),
        },
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_ADMISSION_CONTEXT_MISMATCH');

    expect(() =>
      createAgentSemanticDispositionReviewRequestV1({
        ...requestInputFrom(request),
        context: {
          ...context,
          target: { ...context.target, targetRecipeId: 'recipe:rebound' },
        },
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_ADMISSION_CONTEXT_MISMATCH');

    expect(() =>
      createAgentSemanticDispositionReviewRequestV1({
        ...requestInputFrom(request),
        context: {
          ...context,
          analysisFixpoint: {
            ...context.analysisFixpoint,
            fixpointHash: shaText('stale-fixpoint'),
          },
        },
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_CONTEXT_MISMATCH');

    expect(() =>
      createAgentSemanticDispositionReviewRequestV1({
        ...requestInputFrom(request),
        context: {
          ...context,
          population: {
            ...context.population,
            populationHash: shaText('stale-population'),
          },
        },
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_CONTEXT_MISMATCH');

    expect(() =>
      createAgentSemanticDispositionReviewRequestV1({
        ...requestInputFrom(request),
        finalExpandedSchedule: createFinalExpandedMiningScheduleReceiptV1({
          baselineScheduleHash: shaText('rebound-schedule'),
          baselineObligationIds: request.finalExpandedSchedule.obligationIds,
          expansionReceipts: [],
        }),
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_CONTEXT_MISMATCH');
  });

  it('rejects missing calibration/load evidence and lets non-pass remain a typed result, not authority', () => {
    const request = producerRequest();
    expect(() =>
      createAgentSemanticDispositionReviewRequestV1({
        ...requestInputFrom(request),
        evidence: [],
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_REQUIRED');
    expect(() =>
      createAgentSemanticDispositionReviewRequestV1({
        ...requestInputFrom(request),
        calibration: {
          ...request.calibration,
          axes: request.calibration.axes.slice(1),
        },
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_CALIBRATION_INVALID');
    expect(() =>
      createAgentSemanticDispositionReviewRequestV1({
        ...requestInputFrom(request),
        calibration: {
          ...request.calibration,
          reviewerModelLoadReceipt: {
            ...request.calibration.reviewerModelLoadReceipt,
            loadReceiptHash: '',
          },
        },
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_LOAD_RECEIPT_INVALID');

    const rejectDecision = {
      ...passingDecision(request, PRODUCER_AXES),
      verdict: 'reject' as const,
      reasonCode: 'TARGET_NOT_EQUIVALENT',
      axisDecisions: passingDecision(request, PRODUCER_AXES).axisDecisions.map((axis, index) =>
        index === 0
          ? { ...axis, verdict: 'reject' as const, score: 0.1, reasonCode: 'AXIS_REJECTED' }
          : axis
      ),
    };
    const execution = createAgentSemanticDispositionReviewExecutionV1({
      request,
      invocation: invocation(request, rejectDecision),
      decision: rejectDecision,
    });
    const review = consumeMainSemanticDispositionReviewExecutionV1({
      execution,
      expectedRequest: request,
    });
    expect(review.verdict).toBe('reject');
    const context = request.context;
    if (context.reviewKind !== 'producer-non-draft' || !context.proposal.expression) {
      throw new Error('producer fixture required');
    }
    expect(() =>
      validateHypothesisExpressionSetReceiptV1({
        schemaVersion: 1,
        receiptId: context.expressionSetReceiptId,
        hypothesisId: context.proposal.hypothesisId,
        analysisFixpointHash: context.analysisFixpoint.fixpointHash,
        privateCorpusRevision: context.privateCorpusRevision,
        version: 1,
        parentReceiptId: null,
        terminalHead: true,
        expressions: [
          {
            ...context.proposal.expression,
            terminalReceiptId: review.reviewReceiptId,
            terminalReceiptHash: review.receiptHash,
            dispositionReview: review,
            matchingRepresentativeId:
              context.proposal.expression.matchingRepresentativeId ?? undefined,
            matchingContentReadyRecipeId:
              context.proposal.expression.matchingContentReadyRecipeId ?? undefined,
          },
        ],
        zeroDisposition: null,
      })
    ).toThrow('EXPRESSION_SET_DISPOSITION_REVIEW_INVALID');
  });

  it('binds V2 to exact compiled prompt bytes, frozen ledger authority, and a live Agent host capability', async () => {
    const capture: { callPrompt?: string } = {};
    const semanticRequest = producerRequest();
    const { request, execution, gateway } = await executeSemanticRequestV2(
      semanticRequest,
      PRODUCER_AXES,
      capture
    );
    const review = consumeMainSemanticDispositionReviewExecutionV2({
      execution,
      expectedRequest: request,
      hostAuthority: gateway.authority,
    });

    expect(capture.callPrompt).toBe(request.compiledPrompt);
    expect(execution.hostExecution.compiledPrompt).toBe(request.compiledPrompt);
    expect(execution.reviewer.promptHash).toBe(request.compiledPromptHash);
    expect(request.evidenceAuthorities[0]).toMatchObject({
      executionReceiptHash: semanticRequest.executionReceipts[0]?.receiptHash,
      canonicalSubjectRef: semanticRequest.executionReceipts[0]?.canonicalSubjectRef,
      evidenceEntry: { id: 'E-1', sessionId: 'session:semantic-review' },
      witnessBinding: {
        sourceRevisionVectorHash: SOURCE_REVISION,
        relativePath: 'src/review.ts',
        blobHash: REVIEW_SOURCE_BLOB,
      },
      emittedFactIds: [],
    });
    expect(review.semanticExecutionResultHash).toBe(execution.executionHash);
    expect(() =>
      assertSemanticDispositionReviewExecutionV2({
        execution,
        hostAuthority: gateway.authority,
      })
    ).not.toThrow();
    expect(() =>
      assertSemanticDispositionReviewExecutionV2({
        execution: {
          ...execution,
          hostExecution: {
            ...execution.hostExecution,
            compiledPrompt: `${execution.hostExecution.compiledPrompt}\n`,
          },
        },
        hostAuthority: gateway.authority,
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EXECUTION_V2_INVALID');
    expect(() =>
      assertSemanticDispositionReviewExecutionV2({
        execution: {
          ...execution,
          hostExecution: {
            ...execution.hostExecution,
            providerId: 'provider:post-hoc-identity',
          },
        },
        hostAuthority: gateway.authority,
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EXECUTION_V2_INVALID');
    expect(() =>
      assertSemanticDispositionReviewExecutionV2({
        execution: {
          ...execution,
          decision: { ...execution.decision, reasonCode: 'POST_HOC_DECISION' },
        },
        hostAuthority: gateway.authority,
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EXECUTION_V2_INVALID');
  });

  it('rejects generic/unrelated execution post-hoc stamping even when every public hash is recomputed', async () => {
    const unrelatedSemanticRequest = investigatedEmptyRequest();
    const unrelated = await executeSemanticRequestV2(
      unrelatedSemanticRequest,
      INVESTIGATED_EMPTY_AXES
    );
    const target = semanticRequestV2(producerRequest()).request;
    const stamped = postHocStampedExecution(unrelated.execution, target, PRODUCER_AXES);

    expect(() =>
      assertSemanticDispositionReviewExecutionV2({
        execution: stamped,
        hostAuthority: unrelated.gateway.authority,
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_HOST_AUTHORITY_REQUIRED');
  });

  it('rejects summary-only and rebound ledger/session/subject/blob authority', () => {
    const semanticRequest = producerRequest();
    const { evidenceAuthority } = semanticRequestV2(semanticRequest);
    expect(() =>
      createAgentSemanticDispositionReviewRequestV2({
        semanticRequest,
        evidenceAuthorities: [],
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_MISMATCH');

    const reboundSummary = createAgentSemanticDispositionReviewRequestV1({
      ...requestInputFrom(semanticRequest),
      evidence: semanticRequest.evidence.map((row) => ({
        ...row,
        evidenceSessionId: 'session:post-hoc-rebound',
        canonicalSubjectRef: 'file:repo:src/rebound.ts',
        relativePath: 'src/rebound.ts',
        blobHash: shaText('rebound-blob'),
      })),
    });
    expect(() =>
      createAgentSemanticDispositionReviewRequestV2({
        semanticRequest: reboundSummary,
        evidenceAuthorities: [evidenceAuthority],
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_MISMATCH');

    const { authorityHash: _authorityHash, ...authoritySemantic } = evidenceAuthority;
    const factReboundSemantic = {
      ...authoritySemantic,
      emittedFactIds: ['fact:post-hoc-rebound'],
    };
    expect(() =>
      createAgentSemanticDispositionReviewRequestV2({
        semanticRequest,
        evidenceAuthorities: [
          {
            ...factReboundSemantic,
            authorityHash: hashCanonicalJson(factReboundSemantic),
          },
        ],
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_INVALID');
  });

  it('requires and conserves mandatory zero/non-draft G1, Admission, and corpus inspection', async () => {
    const request = producerZeroRequest();
    const context = request.context;
    if (context.reviewKind !== 'producer-non-draft') {
      throw new Error('producer zero fixture required');
    }
    const zeroDisposition = context.proposal.zeroDisposition;
    if (!zeroDisposition) {
      throw new Error('producer zero disposition required');
    }
    expect(context).toMatchObject({
      proposal: {
        expression: null,
        zeroDisposition: { terminalFate: 'reviewed-non-draft' },
      },
      g1Receipt: { verdict: 'pass', candidateFingerprint: 'fingerprint:zero-disposition' },
      admissionReceipt: {
        disposition: 'admit',
        inputFingerprint: 'fingerprint:zero-disposition',
        finalAdmittedFingerprint: 'fingerprint:zero-disposition',
        consolidation: { action: 'create', targetRecipeId: null },
      },
      target: {
        expressionId: null,
        authoredFingerprint: 'fingerprint:zero-disposition',
        terminalFate: 'reviewed-non-draft',
      },
    });
    expect(() =>
      createAgentSemanticDispositionReviewRequestV1({
        ...requestInputFrom(request),
        context: { ...context, admissionReceipt: null as never },
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_ADMISSION_REQUIRED');
    expect(() =>
      createAgentSemanticDispositionReviewRequestV1({
        ...requestInputFrom(request),
        context: {
          ...context,
          g1Receipt: g1Fixture('fingerprint:post-hoc-rebound'),
        },
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_ADMISSION_CONTEXT_MISMATCH');

    const v2 = await executeSemanticRequestV2(request, PRODUCER_AXES);
    const review = consumeMainSemanticDispositionReviewExecutionV2({
      execution: v2.execution,
      expectedRequest: v2.request,
      hostAuthority: v2.gateway.authority,
    });
    const expressionSet = validateHypothesisExpressionSetReceiptV1({
      schemaVersion: 1,
      receiptId: context.expressionSetReceiptId,
      hypothesisId: context.proposal.hypothesisId,
      analysisFixpointHash: context.analysisFixpoint.fixpointHash,
      privateCorpusRevision: context.privateCorpusRevision,
      version: 1,
      parentReceiptId: null,
      terminalHead: true,
      expressions: [],
      zeroDisposition: {
        reasonCode: zeroDisposition.reasonCode,
        reviewerReceiptId: review.reviewReceiptId,
        dispositionReview: review,
        terminalFate: 'reviewed-non-draft',
      },
    });
    const corpusInspection = zeroCorpusInspection(context.analysisFixpoint.fixpointHash);
    expect(
      createProducerZeroDispositionAdmissionAuthorityV1({
        execution: v2.execution,
        hostAuthority: v2.gateway.authority,
        expressionSet,
        corpusInspection,
      })
    ).toMatchObject({
      authoredFingerprint: 'fingerprint:zero-disposition',
      g1ReceiptHash: context.g1Receipt.receiptHash,
      admissionReceiptHash: context.admissionReceipt.receiptHash,
      acceptedCorpusInspectionHash: corpusInspection.inspectionHash,
    });
    expect(() =>
      createProducerZeroDispositionAdmissionAuthorityV1({
        execution: v2.execution,
        hostAuthority: v2.gateway.authority,
        expressionSet,
        corpusInspection: createStrictAcceptedCorpusInspectionV1({
          runId: WORKFLOW_RUN,
          analysisFixpointHash: context.analysisFixpoint.fixpointHash,
          privateCorpusRevision: 'private-corpus:rebound',
          revisionRootManifestHash: shaText('zero-revision-root'),
          entries: [],
        }),
      })
    ).toThrow();
  });
});

function producerRequest() {
  const receipt = executionReceipt();
  const finalExpandedSchedule = createFinalExpandedMiningScheduleReceiptV1({
    baselineScheduleHash: shaText('baseline-schedule'),
    baselineObligationIds: [receipt.obligationId],
    expansionReceipts: [],
  });
  const { populationHash, population, induction, falsification, fixpoint } =
    producerAnalysisFixture(receipt, finalExpandedSchedule);
  const proposal = {
    reviewKind: 'producer-non-draft' as const,
    populationHash,
    hypothesisId: 'hypothesis:semantic-review',
    expression: {
      expressionId: 'expression:semantic-review',
      authoredFingerprint: 'fingerprint:candidate',
      terminalFate: 'reviewed-duplicate' as const,
      matchingRepresentativeId: 'recipe:target',
      matchingContentReadyRecipeId: 'recipe:target',
    },
    zeroDisposition: null,
  };
  const proposedDispositionHash = hashKnowledgeDispositionProposalV1(proposal);
  const producer = createProductionActorIdentityV1({
    providerId: 'alembic-agent',
    modelId: 'producer:model',
    modelVersion: 'strict-producer-v1',
    promptHash: shaText('producer-prompt'),
    runId: WORKFLOW_RUN,
    invocationId: 'producer-invocation:semantic-review',
    loadReceiptHash: shaText('producer-load'),
    outputHash: proposedDispositionHash,
  });
  const evidenceContent = REVIEW_EVIDENCE_CONTENT;
  const calibration = calibrationFixture(PRODUCER_AXES);
  const g1Receipt = g1Fixture('fingerprint:candidate');
  return createAgentSemanticDispositionReviewRequestV1({
    strictWorkflowRunId: WORKFLOW_RUN,
    sourceRevisionVectorHash: SOURCE_REVISION,
    currentAnalysisFixpointHash: fixpoint.fixpointHash,
    populationHash,
    proposedDispositionHash,
    finalExpandedSchedule,
    executionReceipts: [receipt],
    evidence: [
      {
        evidenceEntryId: 'E-1',
        evidenceSessionId: 'session:semantic-review',
        sourceRevisionVectorHash: SOURCE_REVISION,
        canonicalSubjectRef: 'file:repo:src/review.ts',
        relativePath: 'src/review.ts',
        blobHash: REVIEW_SOURCE_BLOB,
        content: evidenceContent,
        contentHash: shaText(evidenceContent),
        semanticRole: 'candidate-admission-target-comparison',
      },
    ],
    calibration,
    producer,
    context: {
      reviewKind: 'producer-non-draft',
      privateCorpusRevision: 'private-corpus:semantic-review',
      analysisFixpoint: fixpoint,
      population,
      induction,
      falsification,
      proposal,
      expressionSetReceiptId: 'expression-set:semantic-review',
      g1Receipt,
      admissionReceipt: admissionFixture(fixpoint.fixpointHash, g1Receipt),
      target: {
        expressionId: proposal.expression.expressionId,
        authoredFingerprint: proposal.expression.authoredFingerprint,
        terminalFate: proposal.expression.terminalFate,
        targetRecipeId: 'recipe:target',
        targetFingerprint: 'fingerprint:target',
        targetReadyProofHash: shaText('target-ready-proof'),
      },
    },
  });
}

function producerZeroRequest() {
  const base = producerRequest();
  const context = base.context;
  if (context.reviewKind !== 'producer-non-draft') {
    throw new Error('producer fixture required');
  }
  const authoredFingerprint = 'fingerprint:zero-disposition';
  const proposal = {
    reviewKind: 'producer-non-draft' as const,
    populationHash: base.populationHash,
    hypothesisId: context.proposal.hypothesisId,
    expression: null,
    zeroDisposition: {
      reasonCode: 'NO_ELIGIBLE_EXPRESSION_AFTER_PRODUCER',
      terminalFate: 'reviewed-non-draft' as const,
    },
  };
  const proposedDispositionHash = hashKnowledgeDispositionProposalV1(proposal);
  const g1Receipt = g1Fixture(authoredFingerprint);
  const corpusInspection = zeroCorpusInspection(base.currentAnalysisFixpointHash);
  const admissionReceipt = createStrictAdmissionReceiptV1({
    g1Receipt,
    corpusInspection,
    inputFingerprint: authoredFingerprint,
    finalAdmittedFingerprint: authoredFingerprint,
    exactMatches: [],
    semanticMatches: [],
    consolidation: {
      action: 'create',
      reasonCode: 'NO_ACCEPTED_CORPUS_MATCH',
      targetRecipeId: null,
      targetFingerprint: null,
    },
    algorithmVersion: 'strict-admission-v1',
  });
  return createAgentSemanticDispositionReviewRequestV1({
    ...requestInputFrom(base),
    proposedDispositionHash,
    producer: createProductionActorIdentityV1({
      providerId: 'alembic-agent',
      modelId: 'producer:model',
      modelVersion: 'strict-producer-v1',
      promptHash: shaText('producer-zero-prompt'),
      runId: WORKFLOW_RUN,
      invocationId: 'producer-invocation:semantic-review:zero',
      loadReceiptHash: shaText('producer-load'),
      outputHash: proposedDispositionHash,
    }),
    context: {
      ...context,
      proposal,
      g1Receipt,
      admissionReceipt,
      target: {
        expressionId: null,
        authoredFingerprint,
        terminalFate: 'reviewed-non-draft',
        targetRecipeId: null,
        targetFingerprint: null,
        targetReadyProofHash: null,
      },
    },
  });
}

function zeroCorpusInspection(analysisFixpointHash: string) {
  return createStrictAcceptedCorpusInspectionV1({
    runId: WORKFLOW_RUN,
    analysisFixpointHash,
    privateCorpusRevision: 'private-corpus:semantic-review',
    revisionRootManifestHash: shaText('zero-revision-root'),
    entries: [],
  });
}

function producerAnalysisFixture(
  receipt: FactQueryExecutionReceiptV1,
  finalExpandedSchedule: ReturnType<typeof createFinalExpandedMiningScheduleReceiptV1>
) {
  const populationHash = shaText('producer-population');
  const induction = {
    schemaVersion: 1 as const,
    populationHash,
    clusterHash: shaText('cluster'),
    clusterId: 'cluster:semantic-review',
    observationIds: ['observation:semantic-review'],
    mode: 'bounded-singleton' as const,
    hypotheses: [
      {
        hypothesisId: 'hypothesis:semantic-review',
        statement: 'The candidate duplicates the accepted target under frozen project semantics.',
        premiseFactIds: ['fact:semantic-review'],
      },
    ],
    currentAnalysisFixpointHash: shaText('analysis-review-context'),
    zeroHypothesisReason: null,
    zeroHypothesisReviewReceiptId: null,
    receiptHash: shaText('induction-receipt'),
  };
  const falsification = {
    schemaVersion: 1 as const,
    hypothesisId: 'hypothesis:semantic-review',
    enrolledCounterqueryIds: [receipt.obligationId],
    executions: [
      {
        counterqueryId: receipt.obligationId,
        obligationId: receipt.obligationId,
        executionReceipt: receipt,
        counterexampleFactIds: [],
      },
    ],
    counterqueryApplicability: {
      status: 'required' as const,
      reasonCode: 'duplicate-negative-control',
      reviewerReceiptId: null,
    },
    verdict: 'survived' as const,
    currentAnalysisFixpointHash: shaText('analysis-review-context'),
    dispositionReviewReceiptId: 'knowledge-review:falsification',
    receiptHash: shaText('falsification-receipt'),
  };
  const fixpoint = createAnalysisFixpointReceiptV1({
    finalExpandedSchedule,
    terminalObligations: [
      {
        obligationId: receipt.obligationId,
        disposition: receipt.disposition,
        terminalReceiptId: receipt.terminalReceiptId,
      },
    ],
    populationHashes: [populationHash],
    clusterSets: [],
    inductionReceiptHashes: [induction.receiptHash],
    falsificationReceiptHashes: [falsification.receiptHash],
  });
  return {
    populationHash,
    induction,
    falsification,
    fixpoint,
    population: {
      schemaVersion: 1 as const,
      populationId: 'population:producer-review',
      revision: 1,
      parentPopulationHash: null,
      sourceRevisionVectorHash: SOURCE_REVISION,
      denominator: {
        kind: 'frozen-complete-subjects' as const,
        expectedObservationIds: ['observation:semantic-review'],
        expectedObligationIds: [receipt.obligationId],
        executionReceiptHashes: [receipt.receiptHash],
        outputHashes: [receipt.outputHash],
        denominatorHashes: [receipt.denominatorHash],
        complete: true,
        truncated: false,
        continuation: null,
        omittedObservationIds: [],
      },
      observations: [
        {
          observationId: 'observation:semantic-review',
          factIds: ['fact:semantic-review'],
          obligationIds: [receipt.obligationId],
          canonicalSubjectRefs: [receipt.canonicalSubjectRef],
          parentSubjectRefs: [],
          variantKeys: [],
          outlierReasonCodes: [],
          negativeControl: false,
        },
      ],
      duplicateObservations: [],
      excludedObservations: [],
      errorObservations: [],
      inspectedNoPatternObservations: [],
      completion: 'complete' as const,
      conservation: {
        raw: 1,
        accepted: 1,
        duplicate: 0,
        excluded: 0,
        error: 0,
        inspectedNoPattern: 0,
        omitted: 0,
      },
      populationHash,
    },
  };
}

function investigatedEmptyRequest(suffix = '') {
  const receipt = executionReceipt();
  const { finalExpandedSchedule } = authorityScheduleLineage([receipt]);
  const population = canonicalizeObservationPopulationV1({
    populationId: 'population:investigated-empty',
    revision: 1,
    parentPopulationHash: null,
    sourceRevisionVectorHash: SOURCE_REVISION,
    denominator: {
      kind: 'frozen-complete-subjects',
      expectedObservationIds: ['observation:no-pattern'],
      expectedObligationIds: [receipt.obligationId],
      executionReceiptHashes: [receipt.receiptHash],
      outputHashes: [receipt.outputHash],
      denominatorHashes: [receipt.denominatorHash],
      complete: true,
      truncated: false,
      continuation: null,
      omittedObservationIds: [],
    },
    executionReceipts: [receipt],
    observations: [],
    duplicateObservations: [],
    excludedObservations: [],
    errorObservations: [],
    inspectedNoPatternObservations: [
      {
        observationId: 'observation:no-pattern',
        obligationId: receipt.obligationId,
        canonicalSubjectRef: receipt.canonicalSubjectRef,
        parentSubjectRefs: [],
        executionReceiptHash: receipt.receiptHash,
        outputHash: receipt.outputHash,
        denominatorHash: receipt.denominatorHash,
      },
    ],
  });
  const populationHash = population.populationHash;
  const fixpoint = createAnalysisFixpointReceiptV1({
    finalExpandedSchedule,
    terminalObligations: [
      {
        obligationId: receipt.obligationId,
        disposition: receipt.disposition,
        terminalReceiptId: receipt.terminalReceiptId,
      },
    ],
    populationHashes: [populationHash],
    clusterSets: [],
    inductionReceiptHashes: [],
    falsificationReceiptHashes: [],
  });
  const executionBinding = {
    obligationId: receipt.obligationId,
    executionReceiptHash: receipt.receiptHash,
    executionOutputHash: receipt.outputHash,
    denominatorHash: receipt.denominatorHash,
    disposition: receipt.disposition,
    terminalReceiptId: receipt.terminalReceiptId,
  };
  const proposal = {
    reviewKind: 'investigated-empty' as const,
    populationHash,
    sourceRevisionVectorHash: SOURCE_REVISION,
    finalExpandedScheduleHash: finalExpandedSchedule.finalExpandedScheduleHash,
    currentAnalysisFixpointHash: fixpoint.fixpointHash,
    expectedObligationIds: [receipt.obligationId],
    executionBindings: [executionBinding],
    evidenceEntryIds: ['E-1'],
  };
  const proposedDispositionHash = hashKnowledgeDispositionProposalV1(proposal);
  const evidenceContent = REVIEW_EVIDENCE_CONTENT;
  return createAgentSemanticDispositionReviewRequestV1({
    strictWorkflowRunId: WORKFLOW_RUN,
    sourceRevisionVectorHash: SOURCE_REVISION,
    currentAnalysisFixpointHash: fixpoint.fixpointHash,
    populationHash,
    proposedDispositionHash,
    finalExpandedSchedule,
    executionReceipts: [receipt],
    evidence: [
      {
        evidenceEntryId: 'E-1',
        evidenceSessionId: 'session:semantic-review',
        sourceRevisionVectorHash: SOURCE_REVISION,
        canonicalSubjectRef: receipt.canonicalSubjectRef,
        relativePath: 'src/review.ts',
        blobHash: REVIEW_SOURCE_BLOB,
        content: evidenceContent,
        contentHash: shaText(evidenceContent),
        semanticRole: 'negative-evidence-complete-denominator',
      },
    ],
    calibration: calibrationFixture(INVESTIGATED_EMPTY_AXES),
    producer: createProductionActorIdentityV1({
      providerId: 'alembic-agent',
      modelId: 'producer:model',
      modelVersion: 'strict-producer-v1',
      promptHash: shaText(`investigated-empty-producer-prompt:${suffix}`),
      runId: WORKFLOW_RUN,
      invocationId: `producer-invocation:investigated-empty:${suffix}`,
      loadReceiptHash: shaText('producer-load'),
      outputHash: proposedDispositionHash,
    }),
    context: {
      reviewKind: 'investigated-empty',
      analysisFixpoint: fixpoint,
      population,
      proposal,
      negativeEvidenceSufficiency: {
        claim: 'The sealed denominator was fully inspected without an eligible mechanism.',
        requiredAbsencePredicates: ['no-project-specific-recurring-mechanism'],
        inspectedEvidenceEntryIds: ['E-1'],
        reasonCode: 'COMPLETE_NEGATIVE_EVIDENCE',
      },
    },
  });
}

function calibrationFixture(axisIds: readonly SemanticDispositionReviewAxisIdV1[]) {
  const loadReceiptSemantic = {
    schemaVersion: 1 as const,
    providerId: 'provider:reviewer',
    modelId: 'model:reviewer',
    modelVersion: '2026-07-27',
    methodId: 'semantic-disposition-review',
    methodVersion: 'v1',
    runtimeConfigHash: shaText('reviewer-runtime-config'),
    credentialLocationSymbol: 'runtime-config:reviewer-credentials',
  };
  return {
    providerId: 'provider:reviewer',
    modelId: 'model:reviewer',
    modelVersion: '2026-07-27',
    methodId: 'semantic-disposition-review',
    methodVersion: 'v1',
    reviewerModelLoadReceipt: {
      ...loadReceiptSemantic,
      loadReceiptHash: hashCanonicalJson(loadReceiptSemantic),
    },
    calibrationReceiptHash: shaText('reviewer-calibration'),
    rubricVersion: 'semantic-disposition-rubric-v1',
    axes: axisIds.map((axisId) => ({
      axisId,
      minimumScore: 0.8,
      calibrationEvidenceHash: shaText(`calibration:${axisId}`),
    })),
  };
}

function passingDecision(
  request: SemanticDispositionReviewRequestV1,
  axisIds: readonly SemanticDispositionReviewAxisIdV1[]
): SemanticDispositionReviewDecisionV1 {
  return {
    schemaVersion: 1,
    requestHash: request.requestHash,
    promptHash: request.promptHash,
    contextHash: request.contextHash,
    reviewKind: request.reviewKind,
    proposedDispositionHash: request.proposedDispositionHash,
    verdict: 'pass',
    reasonCode: 'SEMANTIC_DISPOSITION_CONFIRMED',
    axisDecisions: axisIds.map((axisId) => ({
      axisId,
      verdict: 'pass',
      score: 0.95,
      reasonCode: `PASS:${axisId}`,
      evidenceEntryIds: ['E-1'],
    })),
    evidenceFindings: [
      {
        evidenceEntryId: 'E-1',
        axisIds,
        finding: 'The frozen semantic payload supports every calibrated disposition axis.',
        supportsVerdict: true,
      },
    ],
  };
}

function passingDecisionV2(
  request: SemanticDispositionReviewRequestV2,
  axisIds: readonly SemanticDispositionReviewAxisIdV1[]
): SemanticDispositionReviewDecisionV2 {
  const semantic = request.semanticRequest;
  return {
    schemaVersion: 2,
    requestHash: request.requestHash,
    compiledPromptHash: request.compiledPromptHash,
    semanticRequestHash: semantic.requestHash,
    contextHash: semantic.contextHash,
    reviewKind: semantic.reviewKind,
    proposedDispositionHash: semantic.proposedDispositionHash,
    verdict: 'pass',
    reasonCode: 'SEMANTIC_DISPOSITION_CONFIRMED',
    axisDecisions: axisIds.map((axisId) => ({
      axisId,
      verdict: 'pass',
      score: 0.95,
      reasonCode: `PASS:${axisId}`,
      evidenceEntryIds: ['E-1'],
    })),
    evidenceFindings: [
      {
        evidenceEntryId: 'E-1',
        axisIds,
        finding: 'The frozen semantic payload supports every calibrated disposition axis.',
        supportsVerdict: true,
      },
    ],
  };
}

function semanticRequestV2(semanticRequest: SemanticDispositionReviewRequestV1) {
  const evidence = strictEvidenceFixture();
  const executionReceipt = semanticRequest.executionReceipts[0];
  const semanticEvidence = semanticRequest.evidence[0];
  const fileExecution = executionReceipt?.fileExecutions[0];
  if (!executionReceipt || !semanticEvidence || !fileExecution) {
    throw new Error('semantic V2 fixture requires one evidence-bearing execution');
  }
  const authority = createSemanticDispositionReviewEvidenceAuthorityV2({
    evidenceEntry: evidence.evidenceEntry,
    evidenceLedgerSnapshot: evidence.evidenceLedgerSnapshot,
    witnessBinding: evidence.witnessBinding,
    executionReceipt,
    fileExecutionHash: fileExecution.executionHash,
    semanticRole: semanticEvidence.semanticRole,
  });
  return {
    request: createAgentSemanticDispositionReviewRequestV2({
      semanticRequest,
      evidenceAuthorities: [authority],
    }),
    evidenceAuthority: authority,
  };
}

async function executeSemanticRequestV2(
  semanticRequest: SemanticDispositionReviewRequestV1,
  axisIds: readonly SemanticDispositionReviewAxisIdV1[],
  capture?: { callPrompt?: string }
) {
  const { request, evidenceAuthority } = semanticRequestV2(semanticRequest);
  let invocationOrdinal = 0;
  const gateway = createAgentSemanticDispositionReviewHostGatewayV2({
    reviewerModelLoadReceipt: semanticRequest.calibration.reviewerModelLoadReceipt,
    invoke: async (call) => {
      invocationOrdinal += 1;
      if (capture) {
        capture.callPrompt = call.compiledPrompt;
      }
      const decision = passingDecisionV2(call.request, axisIds);
      return {
        evaluatorRunId: EVALUATOR_RUN,
        invocationId: `agent-host-invocation:semantic-review:v2:${invocationOrdinal}`,
        responseOutput: JSON.stringify(decision),
        status: 'success',
        toolCallCount: 0,
      };
    },
  });
  const execution = await gateway.execute(request);
  return { request, evidenceAuthority, gateway, execution };
}

function postHocStampedExecution(
  unrelatedExecution: SemanticDispositionReviewExecutionV2,
  targetRequest: SemanticDispositionReviewRequestV2,
  axisIds: readonly SemanticDispositionReviewAxisIdV1[]
): SemanticDispositionReviewExecutionV2 {
  const decision = passingDecisionV2(targetRequest, axisIds);
  const responseOutput = JSON.stringify(decision);
  const hostSemantic = {
    ...unrelatedExecution.hostExecution,
    requestId: targetRequest.requestId,
    requestHash: targetRequest.requestHash,
    compiledPrompt: targetRequest.compiledPrompt,
    compiledPromptHash: targetRequest.compiledPromptHash,
    responseOutput,
    responseOutputHash: shaText(responseOutput),
  };
  const { recordHash: _oldRecordHash, ...hostWithoutHash } = hostSemantic;
  const hostExecution = {
    ...hostWithoutHash,
    recordHash: hashCanonicalJson(hostWithoutHash),
  };
  const reviewer = createProductionActorIdentityV1({
    providerId: hostExecution.providerId,
    modelId: hostExecution.modelId,
    modelVersion: `${hostExecution.modelVersion}/${hostExecution.methodId}/${hostExecution.methodVersion}`,
    promptHash: hostExecution.compiledPromptHash,
    runId: hostExecution.evaluatorRunId,
    invocationId: hostExecution.invocationId,
    loadReceiptHash: hostExecution.reviewerModelLoadReceipt.loadReceiptHash,
    outputHash: hostExecution.responseOutputHash,
  });
  const semantic = {
    schemaVersion: 2 as const,
    producerRoute: unrelatedExecution.producerRoute,
    consumerRoute: unrelatedExecution.consumerRoute,
    request: targetRequest,
    hostExecution,
    decision,
    decisionHash: hashCanonicalJson(decision),
    reviewer,
    hostAuthorityHash: unrelatedExecution.hostAuthorityHash,
  };
  const executionHash = hashCanonicalJson(semantic);
  return {
    ...semantic,
    executionId: `semantic-review-execution-v2:${executionHash.slice(7, 31)}`,
    executionHash,
  };
}

function invocation(
  request: SemanticDispositionReviewRequestV1,
  decision: SemanticDispositionReviewDecisionV1
): SemanticDispositionReviewerHostInvocationV1 {
  const responseOutput = JSON.stringify(decision);
  return {
    providerId: request.calibration.providerId,
    modelId: request.calibration.modelId,
    modelVersion: request.calibration.modelVersion,
    methodId: request.calibration.methodId,
    methodVersion: request.calibration.methodVersion,
    evaluatorRunId: EVALUATOR_RUN,
    invocationId: 'agent-host-invocation:semantic-review:1',
    reviewerModelLoadReceipt: request.calibration.reviewerModelLoadReceipt,
    requestHash: request.requestHash,
    promptHash: request.promptHash,
    responseOutput,
    responseOutputHash: shaText(responseOutput),
    status: 'success',
    toolCallCount: 0,
  };
}

function requestInputFrom(request: ReturnType<typeof producerRequest>) {
  return {
    strictWorkflowRunId: request.strictWorkflowRunId,
    sourceRevisionVectorHash: request.sourceRevisionVectorHash,
    currentAnalysisFixpointHash: request.currentAnalysisFixpointHash,
    populationHash: request.populationHash,
    proposedDispositionHash: request.proposedDispositionHash,
    finalExpandedSchedule: request.finalExpandedSchedule,
    executionReceipts: request.executionReceipts,
    evidence: request.evidence,
    calibration: request.calibration,
    producer: request.producer,
    context: request.context,
  };
}

function g1Fixture(candidateFingerprint: string): StrictG1ReceiptV1 {
  return createStrictG1ReceiptV1({
    candidateFingerprint,
    retrievalReadinessHash: shaText(`retrieval:${candidateFingerprint}`),
    rows: STRICT_G1_HARD_AXES_V1.map((axis) => ({
      axis,
      verdict: 'pass',
      reasonCode: `PASS:${axis}`,
      evidenceRefs: ['E-1'],
    })),
  });
}

function admissionFixture(
  analysisFixpointHash: string,
  g1Receipt: StrictG1ReceiptV1
): StrictAdmissionReceiptV1 {
  const semantic = {
    schemaVersion: 1 as const,
    runId: WORKFLOW_RUN,
    analysisFixpointHash,
    privateCorpusRevision: 'private-corpus:semantic-review',
    revisionRootManifestHash: shaText('revision-root'),
    g1ReceiptHash: g1Receipt.receiptHash,
    inputFingerprint: 'fingerprint:candidate',
    finalAdmittedFingerprint: 'fingerprint:candidate',
    acceptedCorpusInspectionHash: shaText('accepted-corpus-inspection'),
    acceptedCorpusHash: shaText('accepted-corpus'),
    inspectedAcceptedCorpusCount: 1,
    complete: true as const,
    truncated: false as const,
    continuation: null,
    exactMatches: [{ recipeId: 'recipe:target', fingerprint: 'fingerprint:target' }],
    semanticMatches: [
      { recipeId: 'recipe:target', fingerprint: 'fingerprint:target', similarity: 1 },
    ],
    consolidation: {
      action: 'insufficient' as const,
      reasonCode: 'semantic-duplicate',
      targetRecipeId: 'recipe:target',
      targetFingerprint: 'fingerprint:target',
    },
    algorithmVersion: 'strict-admission-v1',
    disposition: 'duplicate' as const,
  };
  const semanticHash = hashCanonicalJson(semantic);
  const withId = {
    ...semantic,
    admissionId: `admission:${semanticHash.slice('sha256:'.length)}`,
  };
  return { ...withId, receiptHash: hashCanonicalJson(withId) };
}

function strictEvidenceFixture() {
  const evidenceEntry = {
    id: 'E-1',
    sessionId: 'session:semantic-review',
    dimensionId: 'dimension:semantic-review',
    tool: 'code.read' as const,
    callId: 'call:semantic-review-source',
    file: 'src/review.ts',
    content: REVIEW_EVIDENCE_CONTENT,
    contentHash: shaText(REVIEW_EVIDENCE_CONTENT),
    capturedAt: 1,
  };
  const evidenceLedgerSnapshot = createStrictEvidenceLedgerSnapshotV1([evidenceEntry]);
  const projectContextRef = createProjectContextFileRef({
    projectRoot: '/frozen/project',
    repoId: 'repo',
    filePath: 'src/review.ts',
    hash: REVIEW_SOURCE_BLOB,
  });
  const bindingSemantic = {
    schemaVersion: 1 as const,
    sourceArtifactId: 'artifact:semantic-disposition-review',
    sourceRevisionVectorHash: SOURCE_REVISION,
    repoId: 'repo',
    relativePath: 'src/review.ts',
    blobHash: REVIEW_SOURCE_BLOB,
    evidenceEntryId: evidenceEntry.id,
    evidenceSessionId: evidenceEntry.sessionId,
    evidenceContentHash: evidenceEntry.contentHash,
    evidenceEntryHash: hashCanonicalJson(evidenceEntry),
    evidenceEntry,
    evidenceLedgerSnapshotHash: evidenceLedgerSnapshot.snapshotHash,
    projectContextRefId: projectContextRef.id,
    projectContextRefHash: hashCanonicalJson(projectContextRef),
    projectContextRef,
  };
  return {
    evidenceEntry,
    evidenceLedgerSnapshot,
    witnessBinding: {
      ...bindingSemantic,
      bindingHash: hashCanonicalJson(bindingSemantic),
    },
  };
}

function executionReceipt(): FactQueryExecutionReceiptV1 {
  const evidence = strictEvidenceFixture();
  const obligationSemantic = {
    factFamilyId: 'syntax-idiom',
    capabilityId: 'tree-sitter-query',
    canonicalSubjectRef: 'file:repo:src/review.ts',
    analysisScale: 'file' as const,
    denominator: 'complete-frozen-subject' as const,
  };
  const obligationId = `fact:${hashCanonicalJson(obligationSemantic).slice(7, 31)}`;
  const denominatorFileIds = [`repo:src/review.ts@${REVIEW_SOURCE_BLOB}`];
  const fileExecutionSemantic = {
    repoId: 'repo',
    relativePath: 'src/review.ts',
    blobHash: REVIEW_SOURCE_BLOB,
    status: 'complete' as const,
    reasonCode: 'COMPLETE',
    truncated: false,
    continuation: null,
    witnessBindingHash: evidence.witnessBinding.bindingHash,
    evidenceEntryId: 'E-1',
    projectContextRefId: evidence.witnessBinding.projectContextRefId,
    stagedFactIds: [],
    discardedFactIds: [],
    emittedFactIds: [],
  };
  const fileExecution = {
    ...fileExecutionSemantic,
    executionHash: hashCanonicalJson(fileExecutionSemantic),
  };
  const denominatorHash = hashCanonicalJson(denominatorFileIds);
  const outputSemantic = {
    obligationId,
    denominatorHash,
    fileExecutionHashes: [fileExecution.executionHash],
    derivedFactIds: [],
    emittedFactIds: [],
    disposition: 'inspected-no-pattern' as const,
    truncated: false,
    continuation: null,
  };
  const outputHash = hashCanonicalJson(outputSemantic);
  const semantic = {
    schemaVersion: 1 as const,
    obligationId,
    ...obligationSemantic,
    sourceRevisionVectorHash: SOURCE_REVISION,
    backendProducer: 'loaded:test',
    backendManifestHash: shaText('backend-manifest'),
    backendLoadReceiptHash: shaText('backend-load'),
    queryPackHash: shaText('query-pack'),
    harvestKey: shaText('harvest-key'),
    harvestReceiptHash: shaText('harvest-receipt'),
    expectedFileCount: 1,
    inspectedFileCount: 1,
    denominatorFileIds,
    denominatorHash,
    witnessBindingHash: hashCanonicalJson([evidence.witnessBinding.bindingHash]),
    fileExecutions: [fileExecution],
    derivedFactIds: [],
    emittedFactIds: [],
    disposition: 'inspected-no-pattern' as const,
    reasonCode: 'COMPLETE_FROZEN_SUBJECT_INSPECTED',
    truncated: false,
    continuation: null,
    outputHash,
  };
  const receiptHash = hashCanonicalJson(semantic);
  return {
    ...semantic,
    terminalReceiptId: `fact-execution:${receiptHash.slice(7, 31)}`,
    receiptHash,
  };
}

function authorityScheduleLineage(receipts: readonly FactQueryExecutionReceiptV1[]) {
  const factHarvestObligations = receipts
    .map((receipt) => ({
      obligationId: receipt.obligationId,
      factFamilyId: receipt.factFamilyId,
      capabilityId: receipt.capabilityId,
      canonicalSubjectRef: receipt.canonicalSubjectRef,
      analysisScale: receipt.analysisScale,
      denominator: receipt.denominator,
      source: 'required-universe' as const,
    }))
    .sort((left, right) => left.obligationId.localeCompare(right.obligationId));
  const factHarvestScheduleHash = hashCanonicalJson(factHarvestObligations);
  const lensBindings: [] = [];
  const lensBindingsHash = hashCanonicalJson(lensBindings);
  const baselineSchedule = {
    schemaVersion: 1 as const,
    factHarvestObligations,
    lensBindings,
    factHarvestScheduleHash,
    lensBindingsHash,
    baselineScheduleHash: hashCanonicalJson({ factHarvestScheduleHash, lensBindingsHash }),
  };
  return {
    baselineSchedule,
    scheduleExpansionReceipts: [],
    finalExpandedSchedule: createFinalExpandedMiningScheduleReceiptV1({
      baselineScheduleHash: baselineSchedule.baselineScheduleHash,
      baselineObligationIds: factHarvestObligations.map((row) => row.obligationId),
      expansionReceipts: [],
    }),
    finalFactSchedule: baselineSchedule,
  };
}

function factExecutionResult(
  receipt: FactQueryExecutionReceiptV1,
  finalFactSchedule: ReturnType<typeof authorityScheduleLineage>['finalFactSchedule']
) {
  const terminalReceiptHashes = [receipt.receiptHash];
  const harvestReceiptHashes = [receipt.harvestReceiptHash];
  const denominatorHashes = [receipt.denominatorHash];
  const semantic = {
    schemaVersion: 1 as const,
    sourceArtifactId: 'artifact:semantic-disposition-review',
    sourceRevisionVectorHash: SOURCE_REVISION,
    factQueryCatalogHash: shaText('fact-query-catalog'),
    factHarvestScheduleHash: finalFactSchedule.factHarvestScheduleHash,
    backendRegistryHash: shaText('backend-registry'),
    obligationCount: 1,
    terminalReceiptIds: [receipt.terminalReceiptId],
    terminalReceiptHashes,
    terminalReceiptSetHash: hashCanonicalJson(terminalReceiptHashes),
    harvestReceiptHashes,
    harvestCount: 1,
    denominatorHashes,
    witnessBindingSetHash: hashCanonicalJson([receipt.witnessBindingHash]),
    factIds: [],
    factCount: 0,
    unexecutableCatalogFamilyIds: [],
    unregisteredBackendFamilyIds: [],
    failedObligationIds: [],
    unknownObligationIds: [],
    verdict: 'passed' as const,
  };
  return {
    facts: [],
    receipts: [receipt],
    manifest: { ...semantic, manifestHash: hashCanonicalJson(semantic) },
  };
}

function shaText(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
