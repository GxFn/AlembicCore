import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createAgentSemanticDispositionReviewDurableGatewayV4,
  createAgentSemanticDispositionReviewDurableGatewayV5,
  createAstFactQueryBackendV1,
  createAstFactQueryFamilyV1,
  createConfigFactQueryBackendV1,
  createConfigFactQueryFamilyV1,
  createStrictAstFactQueryPackV1,
  createStrictEvidenceLedgerSnapshotV1,
  createStrictFactBackendRegistryV1,
  createStrictFactDirectWitnessBindingV1,
  createStrictFactSubjectBindingV1,
  createStrictFactWitnessAuthorityV1,
  executeStrictFactScheduleV1,
} from '../src/host-agent-workflows.js';
import {
  buildFactQueryCatalogSnapshot,
  type CertifiedPlanningFactsV1,
  type FactHarvestObligationV1,
  type MiningWorkScheduleV1,
} from '../src/plans.js';
import {
  assertSemanticDispositionReviewDurableAttestationV4,
  assertSemanticDispositionReviewDurableAttestationV5,
  canonicalizeObservationPopulationV1,
  createAgentSemanticDispositionReviewRequestV1,
  createAnalysisFixpointReceiptV1,
  createFinalExpandedMiningScheduleReceiptV1,
  createInvestigatedEmptyDecisionV1,
  createProductionActorIdentityV1,
  createStrictProductionAuthorityReceiptV1,
  hashKnowledgeDispositionProposalV1,
  type SemanticDispositionReviewAxisIdV1,
  type SemanticDispositionReviewDecisionV3,
  type SemanticDispositionReviewDecisionV4,
} from '../src/production.js';
import { createProjectContextFileRef } from '../src/project-context.js';
import {
  buildProjectContextRequestMatrixV2,
  buildProjectScopeManifestV1,
  CERTIFIED_PROJECT_FACTS_CONSUMERS,
  captureCertifiedProjectFactsV2,
  createProjectContextRequestAuditPlansV2,
  hashBytes,
  hashCanonicalJson,
  type ProjectContextFoundationCaptureInputV2,
  type ProjectContextFoundationFileDescriptor,
  type ProjectContextFoundationHostPorts,
} from '../src/projectContextFoundation.js';
import {
  createAgentSemanticDispositionReviewRequestV3,
  createAgentSemanticDispositionReviewRequestV4,
  createSemanticDispositionReviewEvidenceAuthorityV3,
  createSemanticDispositionReviewEvidenceAuthorityV4,
} from '../src/service/production/SemanticDispositionReviewExecution.js';
import { readCertifiedProjectFactsFrozenFile } from '../src/service/project-context/foundation/frozen.js';
import {
  consumeCrossHarvestSemanticReviewFixtureV1,
  consumeTwoScaleSharedHarvestSemanticReviewFixtureV1,
} from '../src/test-fixtures.js';

const roots: string[] = [];
const REVIEW_AXES = [
  'empty-population-consistency',
  'fixpoint-population-execution-lineage',
  'frozen-semantic-evidence-grounding',
  'negative-evidence-sufficiency',
  'reviewer-independence',
  'sealed-schedule-terminal-denominator',
  'verdict-sufficiency',
] as const satisfies readonly SemanticDispositionReviewAxisIdV1[];

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe('shared-harvest semantic evidence authority', () => {
  it('binds one physical evidence root across the complete canonical harvest-group set', async () => {
    const fixture = await createCrossHarvestFixture();
    const semanticRequest = createSharedHarvestSemanticRequest(fixture);
    const gateway = createCrossHarvestGateway(semanticRequest, fixture, 'cross-harvest');

    const attestation = await gateway.execute(semanticRequest);
    const authority = attestation.execution.request.evidenceAuthorities[0]!;

    expect(new Set(fixture.receipts.map((receipt) => receipt.harvestKey)).size).toBe(2);
    expect(new Set(fixture.receipts.map((receipt) => receipt.harvestReceiptHash)).size).toBe(2);
    expect(
      new Set(fixture.receipts.map((receipt) => receipt.fileExecutions[0]!.executionHash)).size
    ).toBe(2);
    expect(attestation.execution.request.evidenceAuthorities).toHaveLength(1);
    expect(attestation.evidenceLoadReceipts).toHaveLength(1);
    expect(gateway.evidenceLoadCount).toBe(1);
    expect(authority.harvestGroups).toHaveLength(2);
    expect(
      authority.harvestGroups.map((group) => group.executionReceiptBindings.length).sort()
    ).toEqual([1, 2]);
    expect(
      authority.harvestGroups.flatMap((group) =>
        group.executionReceiptBindings.map((binding) => binding.executionReceiptHash)
      )
    ).toEqual(
      expect.arrayContaining(semanticRequest.executionReceipts.map((row) => row.receiptHash))
    );
    expect(() =>
      assertSemanticDispositionReviewDurableAttestationV5({
        attestation: JSON.parse(JSON.stringify(attestation)),
        expectedTrustPolicy: gateway.trustPolicy,
      })
    ).not.toThrow();
    const publicFixtureResult = consumeCrossHarvestSemanticReviewFixtureV1({
      semanticRequest,
      attestation: JSON.parse(JSON.stringify(attestation)),
      trustPolicy: gateway.trustPolicy,
    });
    expect(publicFixtureResult).toMatchObject({
      evidenceRootCount: 1,
      harvestGroupCount: 2,
      executionReceiptCount: 3,
    });
    const context = semanticRequest.context;
    if (context.reviewKind !== 'investigated-empty') {
      throw new Error('cross-harvest investigated-empty fixture required');
    }
    const investigatedEmptyDecision = createInvestigatedEmptyDecisionV1({
      sourceRevisionVectorHash: semanticRequest.sourceRevisionVectorHash,
      finalExpandedScheduleHash: semanticRequest.finalExpandedSchedule.finalExpandedScheduleHash,
      currentAnalysisFixpointHash: context.analysisFixpoint.fixpointHash,
      expectedObligationIds: semanticRequest.executionReceipts.map(
        (receipt) => receipt.obligationId
      ),
      executionReceipts: semanticRequest.executionReceipts,
      dispositionReview: publicFixtureResult.review,
      evidenceEntryIds: [fixture.evidenceEntry.id],
    });
    expect(
      createStrictProductionAuthorityReceiptV1({
        runId: semanticRequest.strictWorkflowRunId,
        sourceRevisionVectorHash: semanticRequest.sourceRevisionVectorHash,
        analysisFixpoint: context.analysisFixpoint,
        privateCorpusRevision: 'private-corpus:cross-harvest',
        factExecution: fixture.executionResult,
        baselineSchedule: fixture.schedule,
        scheduleExpansionReceipts: [],
        finalExpandedSchedule: semanticRequest.finalExpandedSchedule,
        finalFactSchedule: fixture.schedule,
        populations: [context.population],
        clusterSets: [],
        inductions: [],
        falsifications: [],
        investigatedEmptyDecisions: [investigatedEmptyDecision],
        dispositionReviews: [publicFixtureResult.review],
        semanticDispositionReviewAttestations: [attestation],
        semanticDispositionReviewTrustPolicy: gateway.trustPolicy,
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
      })
    ).toMatchObject({
      semanticDispositionReviewExecutionHashes: [attestation.execution.executionHash],
      semanticDispositionReviewAttestationHashes: [attestation.attestationHash],
    });

    const freshProcessRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'alembic-cross-harvest-attestation-')
    );
    roots.push(freshProcessRoot);
    const fixturePath = path.join(freshProcessRoot, 'attestation.json');
    fs.writeFileSync(
      fixturePath,
      JSON.stringify({
        attestation,
        expectedSemanticRequest: semanticRequest,
        expectedTrustPolicy: gateway.trustPolicy,
      }),
      'utf8'
    );
    const freshProcessOutput = execFileSync(
      process.execPath,
      [
        path.join(process.cwd(), 'node_modules/vitest/vitest.mjs'),
        'run',
        'test/DurableSemanticDispositionFreshProcess.test.ts',
        '--reporter=dot',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, ALEMBIC_DURABLE_ATTESTATION_FIXTURE: fixturePath },
      }
    );
    expect(freshProcessOutput).toContain('1 passed');
  });

  it('binds one authenticated file evidence to the exact two-scale receipt set and re-verifies after restart', async () => {
    const fixture = await createSharedHarvestFixture();
    const semanticRequest = createSharedHarvestSemanticRequest(fixture);
    const gateway = createSharedHarvestGateway(semanticRequest, fixture, 'positive');

    const attestation = await gateway.execute(semanticRequest);
    const authority = attestation.execution.request.evidenceAuthorities[0]!;
    const serialized = JSON.parse(JSON.stringify(attestation)) as typeof attestation;

    expect(fixture.receipts).toHaveLength(2);
    expect(new Set(fixture.receipts.map((receipt) => receipt.obligationId)).size).toBe(2);
    expect(new Set(fixture.receipts.map((receipt) => receipt.receiptHash)).size).toBe(2);
    expect(new Set(fixture.receipts.map((receipt) => receipt.harvestKey)).size).toBe(1);
    expect(new Set(fixture.receipts.map((receipt) => receipt.harvestReceiptHash)).size).toBe(1);
    expect(
      new Set(
        fixture.receipts.flatMap((receipt) =>
          receipt.fileExecutions.map((execution) => execution.executionHash)
        )
      ).size
    ).toBe(1);
    expect(
      new Set(
        fixture.receipts.flatMap((receipt) =>
          receipt.fileExecutions.map((execution) => execution.evidenceEntryId)
        )
      ).size
    ).toBe(1);
    expect(authority).toMatchObject({
      schemaVersion: 3,
      evidenceEntry: { id: fixture.evidenceEntry.id },
      executionReceiptBindings: [
        expect.objectContaining({ analysisScale: 'file' }),
        expect.objectContaining({ analysisScale: 'repository' }),
      ],
    });
    expect(
      authority.executionReceiptBindings.map((binding) => binding.executionReceiptHash)
    ).toEqual(semanticRequest.executionReceipts.map((receipt) => receipt.receiptHash));
    expect(() =>
      assertSemanticDispositionReviewDurableAttestationV4({
        attestation: serialized,
        expectedTrustPolicy: gateway.trustPolicy,
      })
    ).not.toThrow();
    const publicFixtureResult = consumeTwoScaleSharedHarvestSemanticReviewFixtureV1({
      semanticRequest,
      attestation: serialized,
      trustPolicy: gateway.trustPolicy,
    });
    expect(publicFixtureResult.review.executionReceiptHashes).toEqual(
      semanticRequest.executionReceipts.map((receipt) => receipt.receiptHash)
    );
    const context = semanticRequest.context;
    if (context.reviewKind !== 'investigated-empty') {
      throw new Error('shared-harvest investigated-empty fixture required');
    }
    const investigatedEmptyDecision = createInvestigatedEmptyDecisionV1({
      sourceRevisionVectorHash: semanticRequest.sourceRevisionVectorHash,
      finalExpandedScheduleHash: semanticRequest.finalExpandedSchedule.finalExpandedScheduleHash,
      currentAnalysisFixpointHash: context.analysisFixpoint.fixpointHash,
      expectedObligationIds: semanticRequest.executionReceipts.map(
        (receipt) => receipt.obligationId
      ),
      executionReceipts: semanticRequest.executionReceipts,
      dispositionReview: publicFixtureResult.review,
      evidenceEntryIds: [fixture.evidenceEntry.id],
    });
    expect(
      createStrictProductionAuthorityReceiptV1({
        runId: semanticRequest.strictWorkflowRunId,
        sourceRevisionVectorHash: semanticRequest.sourceRevisionVectorHash,
        analysisFixpoint: context.analysisFixpoint,
        privateCorpusRevision: 'private-corpus:shared-harvest',
        factExecution: fixture.executionResult,
        baselineSchedule: fixture.schedule,
        scheduleExpansionReceipts: [],
        finalExpandedSchedule: semanticRequest.finalExpandedSchedule,
        finalFactSchedule: fixture.schedule,
        populations: [context.population],
        clusterSets: [],
        inductions: [],
        falsifications: [],
        investigatedEmptyDecisions: [investigatedEmptyDecision],
        dispositionReviews: [publicFixtureResult.review],
        semanticDispositionReviewAttestations: [serialized],
        semanticDispositionReviewTrustPolicy: gateway.trustPolicy,
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
      })
    ).toMatchObject({
      semanticDispositionReviewExecutionHashes: [serialized.execution.executionHash],
      semanticDispositionReviewAttestationHashes: [serialized.attestationHash],
    });

    const freshProcessRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'alembic-shared-harvest-attestation-')
    );
    roots.push(freshProcessRoot);
    const fixturePath = path.join(freshProcessRoot, 'attestation.json');
    fs.writeFileSync(
      fixturePath,
      JSON.stringify({
        attestation: serialized,
        expectedSemanticRequest: semanticRequest,
        expectedTrustPolicy: gateway.trustPolicy,
      }),
      'utf8'
    );
    const freshProcessOutput = execFileSync(
      process.execPath,
      [
        path.join(process.cwd(), 'node_modules/vitest/vitest.mjs'),
        'run',
        'test/DurableSemanticDispositionFreshProcess.test.ts',
        '--reporter=dot',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, ALEMBIC_DURABLE_ATTESTATION_FIXTURE: fixturePath },
      }
    );
    expect(freshProcessOutput).toContain('1 passed');
  });

  it('rejects incomplete, overlapping, mixed-harvest, rebound, and noncanonical binding sets', async () => {
    const fixture = await createSharedHarvestFixture();
    const semanticRequest = createSharedHarvestSemanticRequest(fixture);
    const authorityInput = {
      evidenceEntry: fixture.evidenceEntry,
      evidenceLedgerSnapshot: fixture.evidenceLedgerSnapshot,
      witnessBinding: fixture.witnessBinding,
      executionReceipts: fixture.receipts,
      semanticRole: semanticRequest.evidence[0]!.semanticRole,
    };
    const authority = createSemanticDispositionReviewEvidenceAuthorityV3(authorityInput);

    expect(
      createAgentSemanticDispositionReviewRequestV3({
        semanticRequest,
        evidenceAuthorities: [authority],
      }).evidenceAuthorities[0]?.executionReceiptBindings
    ).toHaveLength(2);

    // 单 receipt authority 本身保持兼容，但完整 request 必须覆盖 receipt universe 的并集。
    const legacySingleAuthority = createSemanticDispositionReviewEvidenceAuthorityV3({
      ...authorityInput,
      executionReceipts: [fixture.receipts[0]!],
    });
    expect(legacySingleAuthority.executionReceiptBindings).toHaveLength(1);
    expect(() =>
      createAgentSemanticDispositionReviewRequestV3({
        semanticRequest,
        evidenceAuthorities: [legacySingleAuthority],
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_MISMATCH');

    // 同一 evidence/receipt atom 不能重复声明；不同 evidence 共享 raw receipt 则由 atom identity 区分。
    expect(() =>
      createAgentSemanticDispositionReviewRequestV3({
        semanticRequest,
        evidenceAuthorities: [authority, authority],
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_MISMATCH');

    const differentHarvestFixture = await createSharedHarvestFixture(
      'typescript-declarations-alternate'
    );
    expect(() =>
      createSemanticDispositionReviewEvidenceAuthorityV3({
        ...authorityInput,
        executionReceipts: [fixture.receipts[0]!, differentHarvestFixture.receipts[0]!],
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_HARVEST_MISMATCH');

    const reboundEvidence = {
      ...fixture.evidenceEntry,
      content: `${fixture.evidenceEntry.content}// rebound\n`,
      contentHash: hashBytes(Buffer.from(`${fixture.evidenceEntry.content}// rebound\n`)),
    };
    expect(() =>
      createSemanticDispositionReviewEvidenceAuthorityV3({
        ...authorityInput,
        evidenceEntry: reboundEvidence,
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_INVALID');
    expect(() =>
      createSemanticDispositionReviewEvidenceAuthorityV3({
        ...authorityInput,
        witnessBinding: {
          ...fixture.witnessBinding,
          blobHash: hashCanonicalJson('rebound-blob'),
        },
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_INVALID');
    const partialReceipt = JSON.parse(JSON.stringify(fixture.receipts[0])) as Mutable<
      (typeof fixture.receipts)[number]
    >;
    partialReceipt.fileExecutions[0]!.truncated = true;
    partialReceipt.fileExecutions[0]!.continuation = 'truncated:next';
    expect(() =>
      createSemanticDispositionReviewEvidenceAuthorityV3({
        ...authorityInput,
        executionReceipts: [partialReceipt],
      })
    ).toThrow();

    const reversedSemantic = {
      ...authority,
      executionReceiptBindings: [...authority.executionReceiptBindings].reverse(),
    };
    const reversedAuthority = {
      ...reversedSemantic,
      authorityHash: hashCanonicalJson(
        Object.fromEntries(
          Object.entries(reversedSemantic).filter(([key]) => key !== 'authorityHash')
        )
      ),
    } as typeof authority;
    expect(() =>
      createAgentSemanticDispositionReviewRequestV3({
        semanticRequest,
        evidenceAuthorities: [reversedAuthority],
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V3_INVALID');

    const gateway = createSharedHarvestGateway(semanticRequest, fixture, 'negative');
    const attestation = await gateway.execute(semanticRequest);
    type MutableAttestation = Mutable<typeof attestation>;
    const tamperProbes: readonly ((candidate: MutableAttestation) => void)[] = [
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].executionReceiptBindings.pop();
      },
      (candidate) => {
        const bindings =
          candidate.execution.request.evidenceAuthorities[0].executionReceiptBindings;
        bindings.push({
          ...bindings[0]!,
          executionReceiptHash: hashCanonicalJson('extra-receipt'),
          bindingHash: hashCanonicalJson('extra-binding'),
        });
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].executionReceiptBindings.reverse();
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].executionReceiptBindings[0].obligationId =
          'fact:rebound-obligation';
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].executionReceiptBindings[0].analysisScale =
          'symbol';
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].executionReceiptBindings[0].executionReceiptHash =
          hashCanonicalJson('extra-receipt');
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].executionReceiptBindings[0].fileExecutionHash =
          hashCanonicalJson('rebound-file-execution');
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].executionReceiptBindings[0].harvestKey =
          hashCanonicalJson('mixed-harvest-key');
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].executionReceiptBindings[0].harvestReceiptHash =
          hashCanonicalJson('mixed-harvest-receipt');
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].executionReceiptBindings[0].sourceRevisionVectorHash =
          hashCanonicalJson('rebound-source');
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].evidenceEntry.content +=
          '// rebound evidence\n';
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].witnessBinding.bindingHash =
          hashCanonicalJson('rebound-witness');
      },
      (candidate) => {
        candidate.evidenceLoadReceipts[0].blobHash = hashCanonicalJson('rebound-load-blob');
      },
    ];
    for (const tamper of tamperProbes) {
      const candidate = JSON.parse(JSON.stringify(attestation)) as MutableAttestation;
      tamper(candidate);
      expect(() =>
        assertSemanticDispositionReviewDurableAttestationV4({
          attestation: candidate as unknown as typeof attestation,
          expectedTrustPolicy: gateway.trustPolicy,
        })
      ).toThrow();
    }
  });

  it('fails closed on cross-harvest group, root, request, load, and attestation tampering', async () => {
    const fixture = await createCrossHarvestFixture();
    const semanticRequest = createSharedHarvestSemanticRequest(fixture);
    const gateway = createCrossHarvestGateway(semanticRequest, fixture, 'negative');
    const attestation = await gateway.execute(semanticRequest);
    const authority = attestation.execution.request.evidenceAuthorities[0]!;

    const partialAuthority = createSemanticDispositionReviewEvidenceAuthorityV4({
      evidenceEntry: fixture.evidenceEntry,
      evidenceLedgerSnapshot: fixture.evidenceLedgerSnapshot,
      witnessBinding: fixture.witnessBinding,
      executionReceipts: [fixture.receipts[0]!],
      semanticRole: semanticRequest.evidence[0]!.semanticRole,
    });
    expect(partialAuthority.harvestGroups).toHaveLength(1);
    expect(() =>
      createAgentSemanticDispositionReviewRequestV4({
        semanticRequest,
        evidenceAuthorities: [partialAuthority],
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V4_MISMATCH');

    const reversedSemantic = {
      ...authority,
      harvestGroups: [...authority.harvestGroups].reverse(),
    };
    const reversedAuthority = {
      ...reversedSemantic,
      authorityHash: hashCanonicalJson(
        Object.fromEntries(
          Object.entries(reversedSemantic).filter(([key]) => key !== 'authorityHash')
        )
      ),
    } as typeof authority;
    expect(() =>
      createAgentSemanticDispositionReviewRequestV4({
        semanticRequest,
        evidenceAuthorities: [reversedAuthority],
      })
    ).toThrow('SEMANTIC_DISPOSITION_REVIEW_EVIDENCE_AUTHORITY_V4_INVALID');

    expect(() =>
      createSemanticDispositionReviewEvidenceAuthorityV4({
        evidenceEntry: fixture.evidenceEntry,
        evidenceLedgerSnapshot: fixture.evidenceLedgerSnapshot,
        witnessBinding: {
          ...fixture.witnessBinding,
          blobHash: hashCanonicalJson('rebound-cross-harvest-blob'),
        },
        executionReceipts: fixture.receipts,
        semanticRole: semanticRequest.evidence[0]!.semanticRole,
      })
    ).toThrow();

    type MutableV5Attestation = Mutable<typeof attestation>;
    const tamperProbes: readonly ((candidate: MutableV5Attestation) => void)[] = [
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].harvestGroups.pop();
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].harvestGroups.reverse();
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].harvestGroups[0].executionReceiptBindings.pop();
      },
      (candidate) => {
        const group = candidate.execution.request.evidenceAuthorities[0].harvestGroups[0];
        group.executionReceiptBindings.push({ ...group.executionReceiptBindings[0]! });
      },
      (candidate) => {
        const groups = candidate.execution.request.evidenceAuthorities[0].harvestGroups;
        groups[0]!.executionReceiptBindings.push({
          ...groups[1]!.executionReceiptBindings[0]!,
        });
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].harvestGroups[0].harvestKey =
          hashCanonicalJson('rebound-harvest-key');
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].harvestGroups[0].fileExecutionHash =
          hashCanonicalJson('rebound-file-execution');
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].harvestGroups[0].executionReceiptBindings[0].harvestReceiptHash =
          hashCanonicalJson('rebound-harvest-receipt');
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].evidenceEntry.content +=
          '// rebound root\n';
      },
      (candidate) => {
        candidate.execution.request.evidenceAuthorities[0].witnessBinding.bindingHash =
          hashCanonicalJson('rebound-witness');
      },
      (candidate) => {
        candidate.execution.request.semanticRequest.executionReceipts.pop();
      },
      (candidate) => {
        candidate.evidenceLoadReceipts[0].harvestGroups.pop();
      },
      (candidate) => {
        candidate.evidenceLoadReceipts[0].relativePath = 'src/rebound.ts';
      },
      (candidate) => {
        candidate.evidenceLoadReceipts[0].witnessBindingHash =
          hashCanonicalJson('rebound-load-witness');
      },
      (candidate) => {
        candidate.signatureBase64 = Buffer.alloc(64).toString('base64');
      },
    ];
    for (const tamper of tamperProbes) {
      const candidate = JSON.parse(JSON.stringify(attestation)) as MutableV5Attestation;
      tamper(candidate);
      expect(() =>
        assertSemanticDispositionReviewDurableAttestationV5({
          attestation: candidate as unknown as typeof attestation,
          expectedTrustPolicy: gateway.trustPolicy,
        })
      ).toThrow();
    }
  });
});

async function createSharedHarvestFixture(queryId = 'typescript-declarations') {
  const artifact = await createStrictArtifact();
  const familyId =
    queryId === 'typescript-declarations' ? 'syntax-idiom' : 'syntax-idiom-alternate';
  const evidenceEntry = {
    id: 'E-1',
    sessionId: 'session:shared-harvest',
    dimensionId: 'strict-fact-execution',
    tool: 'code.read' as const,
    callId: 'call:shared-harvest',
    file: 'src/review.ts',
    content: '// complete frozen subject with no matching declaration\n',
    contentHash: hashBytes(
      Buffer.from('// complete frozen subject with no matching declaration\n')
    ),
    capturedAt: 1,
  };
  const evidenceLedgerSnapshot = createStrictEvidenceLedgerSnapshotV1([evidenceEntry]);
  const projectContextRef = createProjectContextFileRef({
    projectRoot: '/certified/shared-harvest-test',
    repoId: 'core',
    filePath: evidenceEntry.file,
    hash: artifact.facts.inventory.files[0]!.blobSha256,
  });
  const witnessBinding = createStrictFactDirectWitnessBindingV1({
    artifact,
    repoId: 'core',
    relativePath: evidenceEntry.file,
    evidenceEntry,
    evidenceLedgerSnapshot,
    projectContextRef,
  });
  const family = createAstFactQueryFamilyV1({
    queryPack: createStrictAstFactQueryPackV1({
      familyId,
      queryId,
      queryVersion: '1',
      extractorId: 'declarations-v1',
    }),
    supportedScales: ['file', 'repository'],
  });
  const schedule = scheduleForScales(family, ['file', 'repository']);
  const result = await executeStrictFactScheduleV1({
    artifact,
    planningFacts: planningFacts(artifact),
    catalog: buildFactQueryCatalogSnapshot([family]),
    schedule,
    subjectBindings: [
      createStrictFactSubjectBindingV1({
        artifact,
        planningFacts: planningFacts(artifact),
        selector: { kind: 'repository', repoId: 'core' },
      }),
    ],
    witnessBindings: [witnessBinding],
    witnessAuthority: createStrictFactWitnessAuthorityV1({
      artifact,
      evidenceLedgerSnapshot,
      projectContextRefs: [projectContextRef],
    }),
    registry: createStrictFactBackendRegistryV1([
      createAstFactQueryBackendV1({
        family,
        queryPack: createStrictAstFactQueryPackV1({
          familyId,
          queryId,
          queryVersion: '1',
          extractorId: 'declarations-v1',
        }),
      }),
    ]),
  });
  return {
    artifact,
    evidenceEntry,
    evidenceLedgerSnapshot,
    witnessBinding,
    schedule,
    executionResult: result,
    receipts: result.receipts,
  };
}

async function createCrossHarvestFixture() {
  const artifact = await createStrictArtifact();
  const evidenceEntry = {
    id: 'E-1',
    sessionId: 'session:shared-harvest',
    dimensionId: 'strict-fact-execution',
    tool: 'code.read' as const,
    callId: 'call:shared-harvest',
    file: 'src/review.ts',
    content: '// complete frozen subject with no matching declaration\n',
    contentHash: hashBytes(
      Buffer.from('// complete frozen subject with no matching declaration\n')
    ),
    capturedAt: 1,
  };
  const evidenceLedgerSnapshot = createStrictEvidenceLedgerSnapshotV1([evidenceEntry]);
  const projectContextRef = createProjectContextFileRef({
    projectRoot: '/certified/shared-harvest-test',
    repoId: 'core',
    filePath: evidenceEntry.file,
    hash: artifact.facts.inventory.files[0]!.blobSha256,
  });
  const witnessBinding = createStrictFactDirectWitnessBindingV1({
    artifact,
    repoId: 'core',
    relativePath: evidenceEntry.file,
    evidenceEntry,
    evidenceLedgerSnapshot,
    projectContextRef,
  });
  const primaryPack = createStrictAstFactQueryPackV1({
    familyId: 'syntax-idiom',
    queryId: 'typescript-declarations',
    queryVersion: '1',
    extractorId: 'declarations-v1',
  });
  const primaryFamily = createAstFactQueryFamilyV1({
    queryPack: primaryPack,
    supportedScales: ['file', 'repository'],
  });
  const alternateFamily = createConfigFactQueryFamilyV1({
    familyId: 'workspace-config',
    supportedScales: ['file'],
    parser: 'nx-project-json',
  });
  const schedule = scheduleForFamilyScales([
    { family: primaryFamily, analysisScales: ['file', 'repository'] },
    { family: alternateFamily, analysisScales: ['file'] },
  ]);
  const result = await executeStrictFactScheduleV1({
    artifact,
    planningFacts: planningFacts(artifact),
    catalog: buildFactQueryCatalogSnapshot([primaryFamily, alternateFamily]),
    schedule,
    subjectBindings: [
      createStrictFactSubjectBindingV1({
        artifact,
        planningFacts: planningFacts(artifact),
        selector: { kind: 'repository', repoId: 'core' },
      }),
    ],
    witnessBindings: [witnessBinding],
    witnessAuthority: createStrictFactWitnessAuthorityV1({
      artifact,
      evidenceLedgerSnapshot,
      projectContextRefs: [projectContextRef],
    }),
    registry: createStrictFactBackendRegistryV1([
      createAstFactQueryBackendV1({
        family: primaryFamily,
        queryPack: primaryPack,
      }),
      createConfigFactQueryBackendV1({
        family: alternateFamily,
        parser: 'nx-project-json',
      }),
    ]),
  });
  return {
    artifact,
    evidenceEntry,
    evidenceLedgerSnapshot,
    witnessBinding,
    schedule,
    executionResult: result,
    receipts: result.receipts,
  };
}

function createSharedHarvestSemanticRequest(
  fixture: Awaited<ReturnType<typeof createSharedHarvestFixture>>
) {
  const receipts = [...fixture.receipts].sort((left, right) =>
    left.obligationId.localeCompare(right.obligationId)
  );
  const finalExpandedSchedule = createFinalExpandedMiningScheduleReceiptV1({
    baselineScheduleHash: fixture.schedule.baselineScheduleHash,
    baselineObligationIds: fixture.schedule.factHarvestObligations.map(
      (obligation) => obligation.obligationId
    ),
    expansionReceipts: [],
  });
  const population = createSharedHarvestPopulation(fixture, receipts);
  const fixpoint = createAnalysisFixpointReceiptV1({
    finalExpandedSchedule,
    terminalObligations: receipts.map((receipt) => ({
      obligationId: receipt.obligationId,
      disposition: receipt.disposition,
      terminalReceiptId: receipt.terminalReceiptId,
    })),
    populationHashes: [population.populationHash],
    clusterSets: [],
    inductionReceiptHashes: [],
    falsificationReceiptHashes: [],
  });
  const proposal = {
    reviewKind: 'investigated-empty' as const,
    populationHash: population.populationHash,
    sourceRevisionVectorHash: fixture.artifact.sourceVectorHash,
    finalExpandedScheduleHash: finalExpandedSchedule.finalExpandedScheduleHash,
    currentAnalysisFixpointHash: fixpoint.fixpointHash,
    expectedObligationIds: receipts.map((receipt) => receipt.obligationId),
    executionBindings: receipts.map((receipt) => ({
      obligationId: receipt.obligationId,
      executionReceiptHash: receipt.receiptHash,
      executionOutputHash: receipt.outputHash,
      denominatorHash: receipt.denominatorHash,
      disposition: receipt.disposition,
      terminalReceiptId: receipt.terminalReceiptId,
    })),
    evidenceEntryIds: [fixture.evidenceEntry.id],
  };
  const proposedDispositionHash = hashKnowledgeDispositionProposalV1(proposal);
  const calibration = calibrationFixture();
  return createAgentSemanticDispositionReviewRequestV1({
    strictWorkflowRunId: 'strict-workflow:shared-harvest',
    sourceRevisionVectorHash: fixture.artifact.sourceVectorHash,
    currentAnalysisFixpointHash: fixpoint.fixpointHash,
    populationHash: population.populationHash,
    proposedDispositionHash,
    finalExpandedSchedule,
    executionReceipts: receipts,
    evidence: [
      {
        evidenceEntryId: fixture.evidenceEntry.id,
        evidenceSessionId: fixture.evidenceEntry.sessionId,
        sourceRevisionVectorHash: fixture.artifact.sourceVectorHash,
        canonicalSubjectRef: receipts[0]!.canonicalSubjectRef,
        relativePath: fixture.evidenceEntry.file,
        blobHash: fixture.artifact.facts.inventory.files[0]!.blobSha256,
        content: fixture.evidenceEntry.content,
        contentHash: fixture.evidenceEntry.contentHash,
        semanticRole: 'negative-evidence-complete-denominator',
      },
    ],
    calibration,
    producer: createProductionActorIdentityV1({
      providerId: 'alembic-agent',
      modelId: 'producer:model',
      modelVersion: 'strict-producer-v1',
      promptHash: hashCanonicalJson('producer-shared-harvest-prompt'),
      runId: 'strict-workflow:shared-harvest',
      invocationId: 'producer-invocation:shared-harvest',
      loadReceiptHash: hashCanonicalJson('producer-shared-harvest-load'),
      outputHash: proposedDispositionHash,
    }),
    context: {
      reviewKind: 'investigated-empty',
      analysisFixpoint: fixpoint,
      population,
      proposal,
      negativeEvidenceSufficiency: {
        claim: 'One complete frozen file harvest was inspected for both required scales.',
        requiredAbsencePredicates: ['no-matching-declaration-at-file-or-repository-scale'],
        inspectedEvidenceEntryIds: [fixture.evidenceEntry.id],
        reasonCode: 'COMPLETE_SHARED_HARVEST_NEGATIVE_EVIDENCE',
      },
    },
  });
}

function createSharedHarvestPopulation(
  fixture: Awaited<ReturnType<typeof createSharedHarvestFixture>>,
  receipts: Awaited<ReturnType<typeof createSharedHarvestFixture>>['receipts']
) {
  const observations = receipts.map((receipt) => ({
    observationId: `observation:no-pattern:${receipt.obligationId}`,
    obligationId: receipt.obligationId,
    canonicalSubjectRef: receipt.canonicalSubjectRef,
    parentSubjectRefs: [],
    executionReceiptHash: receipt.receiptHash,
    outputHash: receipt.outputHash,
    denominatorHash: receipt.denominatorHash,
  }));
  return canonicalizeObservationPopulationV1({
    populationId: 'population:shared-harvest',
    revision: 1,
    parentPopulationHash: null,
    sourceRevisionVectorHash: fixture.artifact.sourceVectorHash,
    denominator: {
      kind: 'frozen-complete-subjects',
      expectedObservationIds: observations.map((row) => row.observationId),
      expectedObligationIds: receipts.map((receipt) => receipt.obligationId),
      executionReceiptHashes: receipts.map((receipt) => receipt.receiptHash),
      outputHashes: receipts.map((receipt) => receipt.outputHash),
      denominatorHashes: [...new Set(receipts.map((receipt) => receipt.denominatorHash))],
      complete: true,
      truncated: false,
      continuation: null,
      omittedObservationIds: [],
    },
    executionReceipts: receipts,
    observations: [],
    duplicateObservations: [],
    excludedObservations: [],
    errorObservations: [],
    inspectedNoPatternObservations: observations,
  });
}

function createSharedHarvestGateway(
  semanticRequest: ReturnType<typeof createSharedHarvestSemanticRequest>,
  fixture: Awaited<ReturnType<typeof createSharedHarvestFixture>>,
  suffix: string
) {
  const { privateKey } = generateKeyPairSync('ed25519');
  return createAgentSemanticDispositionReviewDurableGatewayV4({
    trustRootId: `semantic-review-trust:shared-harvest:${suffix}`,
    keyId: `semantic-review-key:shared-harvest:${suffix}`,
    privateKey,
    reviewerHost: {
      reviewerModelLoadReceipt: semanticRequest.calibration.reviewerModelLoadReceipt,
      invoke: async (call) => ({
        evaluatorRunId: `agent-host-run:shared-harvest-review:${suffix}`,
        invocationId: `agent-host-invocation:shared-harvest-review:${suffix}`,
        responseOutput: JSON.stringify(passingDecision(call.request)),
        status: 'success',
        toolCallCount: 0,
      }),
    },
    evidenceStore: {
      evidenceStoreId: `evidence-store:shared-harvest:${suffix}`,
      evidenceStoreConfigHash: hashCanonicalJson(`shared-harvest-store-config:${suffix}`),
      load: async (call) => ({
        loadOperationId: `evidence-load:shared-harvest:${suffix}:1`,
        evidenceEntry: fixture.evidenceEntry,
        evidenceLedgerSnapshot: fixture.evidenceLedgerSnapshot,
        witnessBinding: fixture.witnessBinding,
        semanticRole: call.evidence.semanticRole,
      }),
    },
  });
}

function createCrossHarvestGateway(
  semanticRequest: ReturnType<typeof createSharedHarvestSemanticRequest>,
  fixture: Awaited<ReturnType<typeof createCrossHarvestFixture>>,
  suffix: string
) {
  const { privateKey } = generateKeyPairSync('ed25519');
  let evidenceLoadCount = 0;
  const gateway = createAgentSemanticDispositionReviewDurableGatewayV5({
    trustRootId: `semantic-review-trust:cross-harvest:${suffix}`,
    keyId: `semantic-review-key:cross-harvest:${suffix}`,
    privateKey,
    reviewerHost: {
      reviewerModelLoadReceipt: semanticRequest.calibration.reviewerModelLoadReceipt,
      invoke: async (call) => ({
        evaluatorRunId: `agent-host-run:cross-harvest-review:${suffix}`,
        invocationId: `agent-host-invocation:cross-harvest-review:${suffix}`,
        responseOutput: JSON.stringify(passingDecisionV4(call.request)),
        status: 'success',
        toolCallCount: 0,
      }),
    },
    evidenceStore: {
      evidenceStoreId: `evidence-store:cross-harvest:${suffix}`,
      evidenceStoreConfigHash: hashCanonicalJson(`cross-harvest-store-config:${suffix}`),
      load: async (call) => {
        evidenceLoadCount += 1;
        return {
          loadOperationId: `evidence-load:cross-harvest:${suffix}:1`,
          evidenceEntry: fixture.evidenceEntry,
          evidenceLedgerSnapshot: fixture.evidenceLedgerSnapshot,
          witnessBinding: fixture.witnessBinding,
          semanticRole: call.evidence.semanticRole,
        };
      },
    },
  });
  return {
    ...gateway,
    get evidenceLoadCount() {
      return evidenceLoadCount;
    },
  };
}

function passingDecision(
  request: Parameters<
    Parameters<
      typeof createAgentSemanticDispositionReviewDurableGatewayV4
    >[0]['reviewerHost']['invoke']
  >[0]['request']
): SemanticDispositionReviewDecisionV3 {
  const semantic = request.semanticRequest;
  return {
    schemaVersion: 3,
    requestHash: request.requestHash,
    compiledPromptHash: request.compiledPromptHash,
    semanticRequestHash: semantic.requestHash,
    contextHash: semantic.contextHash,
    reviewKind: semantic.reviewKind,
    proposedDispositionHash: semantic.proposedDispositionHash,
    verdict: 'pass',
    reasonCode: 'SEMANTIC_DISPOSITION_CONFIRMED',
    axisDecisions: REVIEW_AXES.map((axisId) => ({
      axisId,
      verdict: 'pass',
      score: 0.95,
      reasonCode: `PASS:${axisId}`,
      evidenceEntryIds: ['E-1'],
    })),
    evidenceFindings: [
      {
        evidenceEntryId: 'E-1',
        axisIds: REVIEW_AXES,
        finding: 'The authenticated shared harvest covers both exact scale receipts.',
        supportsVerdict: true,
      },
    ],
  };
}

function passingDecisionV4(
  request: Parameters<
    Parameters<
      typeof createAgentSemanticDispositionReviewDurableGatewayV5
    >[0]['reviewerHost']['invoke']
  >[0]['request']
): SemanticDispositionReviewDecisionV4 {
  const semantic = request.semanticRequest;
  return {
    schemaVersion: 4,
    requestHash: request.requestHash,
    compiledPromptHash: request.compiledPromptHash,
    semanticRequestHash: semantic.requestHash,
    contextHash: semantic.contextHash,
    reviewKind: semantic.reviewKind,
    proposedDispositionHash: semantic.proposedDispositionHash,
    verdict: 'pass',
    reasonCode: 'SEMANTIC_DISPOSITION_CONFIRMED',
    axisDecisions: REVIEW_AXES.map((axisId) => ({
      axisId,
      verdict: 'pass',
      score: 0.95,
      reasonCode: `PASS:${axisId}`,
      evidenceEntryIds: ['E-1'],
    })),
    evidenceFindings: [
      {
        evidenceEntryId: 'E-1',
        axisIds: REVIEW_AXES,
        finding: 'The authenticated evidence root covers the exact canonical harvest groups.',
        supportsVerdict: true,
      },
    ],
  };
}

function calibrationFixture() {
  const loadSemantic = {
    schemaVersion: 1 as const,
    providerId: 'provider:reviewer',
    modelId: 'model:reviewer',
    modelVersion: '2026-07-29',
    methodId: 'semantic-disposition-review',
    methodVersion: 'v1',
    runtimeConfigHash: hashCanonicalJson('shared-harvest-reviewer-runtime'),
    credentialLocationSymbol: 'runtime-config:reviewer-credentials',
  };
  return {
    providerId: loadSemantic.providerId,
    modelId: loadSemantic.modelId,
    modelVersion: loadSemantic.modelVersion,
    methodId: loadSemantic.methodId,
    methodVersion: loadSemantic.methodVersion,
    reviewerModelLoadReceipt: {
      ...loadSemantic,
      loadReceiptHash: hashCanonicalJson(loadSemantic),
    },
    calibrationReceiptHash: hashCanonicalJson('shared-harvest-calibration'),
    rubricVersion: 'semantic-disposition-rubric-v1',
    axes: REVIEW_AXES.map((axisId) => ({
      axisId,
      minimumScore: 0.8,
      calibrationEvidenceHash: hashCanonicalJson(`calibration:${axisId}`),
    })),
  };
}

function planningFacts(
  artifact: Awaited<ReturnType<typeof createStrictArtifact>>
): CertifiedPlanningFactsV1 {
  return {
    schemaVersion: 1,
    factsHash: artifact.factsContentHash,
    sourceRevisionVectorHash: artifact.sourceVectorHash,
    sourceArtifactHash: artifact.certificationBindingHash,
    modules: [
      {
        moduleId: 'core',
        scopeId: 'repo:core',
        relativePath: '.',
        moduleClass: 'production-library',
        ownedProductionFileCount: 1,
        languages: ['typescript'],
        frameworks: [],
        roles: ['library'],
        entrypointRefs: [],
        publicSurfaceRefs: [],
        crossRepoEdgeRefs: [],
        boundaryRefs: [],
        ownership: {
          origin: 'certified-project-facts',
          confidence: 1,
          evidenceRefs: ['artifact:inventory'],
        },
      },
    ],
  };
}

function scheduleForScales(
  family: ReturnType<typeof createAstFactQueryFamilyV1>,
  analysisScales: readonly FactHarvestObligationV1['analysisScale'][]
): MiningWorkScheduleV1 {
  return scheduleForFamilyScales([{ family, analysisScales }]);
}

function scheduleForFamilyScales(
  groups: readonly {
    readonly family: ReturnType<typeof createAstFactQueryFamilyV1>;
    readonly analysisScales: readonly FactHarvestObligationV1['analysisScale'][];
  }[]
): MiningWorkScheduleV1 {
  const obligations = groups.flatMap(({ family, analysisScales }) =>
    analysisScales.map((analysisScale) => {
      const semantic = {
        factFamilyId: family.id,
        capabilityId: family.capabilityId,
        canonicalSubjectRef: 'repo:core',
        analysisScale,
        denominator: 'complete-frozen-subject' as const,
      };
      return {
        obligationId: `fact:${hashCanonicalJson(semantic).slice(7, 31)}`,
        ...semantic,
        source: 'required-universe' as const,
      };
    })
  );
  const factHarvestScheduleHash = hashCanonicalJson(obligations);
  const lensBindings: MiningWorkScheduleV1['lensBindings'] = [];
  const lensBindingsHash = hashCanonicalJson(lensBindings);
  return {
    schemaVersion: 1,
    factHarvestObligations: obligations,
    lensBindings,
    factHarvestScheduleHash,
    lensBindingsHash,
    baselineScheduleHash: hashCanonicalJson({ factHarvestScheduleHash, lensBindingsHash }),
  };
}

async function createStrictArtifact() {
  const controlRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'shared-harvest-fact-execution-'))
  );
  roots.push(controlRoot);
  const sourceFiles = [
    {
      language: 'typescript',
      relativePath: 'src/review.ts',
      content: '// complete frozen subject with no matching declaration\n',
    },
  ];
  const files: ProjectContextFoundationFileDescriptor[] = sourceFiles.map((file) => ({
    language: file.language,
    mode: '100644',
    ownerModuleIds: [],
    ownersV2: [],
    relativePath: file.relativePath,
  }));
  const contents = new Map(
    sourceFiles.map((file) => [file.relativePath, Buffer.from(file.content)] as const)
  );
  const repository = {
    relativeRoot: '.',
    repoId: 'core',
    scopeId: 'repo:core',
    sourceRoot: controlRoot,
  };
  const projectScope = buildProjectScopeManifestV1({
    acceptedScope: {
      projectIdentity: { projectId: 'shared-harvest-project', scopeId: 'repo:core' },
      projectMode: 'SINGLE',
      repositories: [{ relativeRoot: '.', repoId: 'core' }],
    },
    controlRoot,
    sourceRoots: [{ repoId: 'core', sourceRoot: controlRoot }],
  });
  const requestMatrix = buildProjectContextRequestMatrixV2(
    projectScope.manifest,
    createProjectContextRequestAuditPlansV2({
      repository,
      eligibleFiles: files,
      projectScopeManifest: projectScope.manifest,
    })
  );
  const input: ProjectContextFoundationCaptureInputV2 = {
    projectMode: 'SINGLE',
    repositories: [repository],
    inventoryPolicy: {
      excludeDirectories: ['node_modules', '.git'],
      includeExtensions: ['.ts'],
      version: 'shared-harvest-test-policy-v1',
    },
    detailPolicy: {
      chunkBytes: 128,
      maxPreviewBytes: 128,
      maxSelectedFiles: 1,
    },
    requestPlans: requestMatrix.plans,
    legacyEntries: [],
    projections: Object.fromEntries(
      CERTIFIED_PROJECT_FACTS_CONSUMERS.map((consumer) => [consumer, { consumer }])
    ) as ProjectContextFoundationCaptureInputV2['projections'],
    certification: {
      acceptedConfigHash: hashCanonicalJson({ config: 1 }),
      acceptedRuntimeHash: hashCanonicalJson({ runtime: 1 }),
      capabilityHash: hashCanonicalJson({ capability: 1 }),
      parserHash: hashCanonicalJson({ parser: 1 }),
      scopeIdentityHash: projectScope.manifest.canonicalScopeHash,
    },
    projectScope,
    requestMatrix,
  };
  const artifact = await captureCertifiedProjectFactsV2(
    input,
    createProjectContextFoundationPorts(files, contents)
  );
  // 保持 fixture 与产品读路径一致，避免 capture 成功但冻结文件不可读的假绿。
  readCertifiedProjectFactsFrozenFile(artifact, artifact.facts.inventory.files[0]!);
  return artifact;
}

function createProjectContextFoundationPorts(
  files: readonly ProjectContextFoundationFileDescriptor[],
  contents: ReadonlyMap<string, Buffer>
): ProjectContextFoundationHostPorts {
  return {
    enumerateEligibleFiles: async () => files,
    executeRequest: async ({ plan }) => {
      const selector = plan.selector as { filePath?: string };
      return {
        detectedLanguage: selector.filePath ? 'typescript' : undefined,
        output: { kind: plan.kind, selector: plan.selector },
        parserRuntime: selector.filePath ? 'ready' : 'not-required',
        queryInitialization: selector.filePath ? 'ready' : 'not-required',
        sourceRanges: selector.filePath
          ? [
              {
                repoId: plan.repoId,
                relativePath: selector.filePath,
                startLine: 1,
                endLine: 1,
              },
            ]
          : [],
        terminalStatus: 'completed',
      };
    },
    observeRevision: async () => ({
      kind: 'git',
      dirty: false,
      commitId: 'a'.repeat(40),
      treeId: 'b'.repeat(40),
    }),
    readFile: async ({ relativePath }) => {
      const content = contents.get(relativePath);
      if (!content) {
        throw new Error(`Unexpected file read: ${relativePath}`);
      }
      return content;
    },
    verifySnapshot: async ({ candidate }) => ({
      version: 1,
      verified: true,
      binding: 'git-tree',
      finalRevision: candidate.postRevision,
      eligibleInventoryHash: candidate.eligibleInventoryHash,
      workingTreeContentHash: candidate.workingTreeContentHash,
      treeId:
        candidate.postRevision.kind === 'git'
          ? (candidate.postRevision.treeId ?? undefined)
          : undefined,
      typedReason: 'shared-harvest-test-snapshot-binding',
    }),
  };
}
