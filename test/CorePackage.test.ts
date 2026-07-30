import { describe, expect, it } from 'vitest';

import { resolveRecipeDimensionId } from '../src/domain/dimension/index.js';
import { EvolutionPolicy } from '../src/domain/evolution/EvolutionPolicy.js';
import {
  getAgentAdapterFieldSpec,
  getCursorDeliverySpec,
} from '../src/domain/knowledge/FieldSpec.js';
import {
  createHostAgentWorkflowSession,
  DEFAULT_FOLDER_NAMES,
  KnowledgeRepositoryImpl,
  resolveFolderNames,
  validateFolderNameSegment,
} from '../src/index.js';
import { ConfigLoader } from '../src/infrastructure/config/index.js';
import { WriteZone } from '../src/infrastructure/io/index.js';
import { ProjectContext } from '../src/project-context.js';

describe('Core package baseline', () => {
  it('rejects folder name segments that would become paths', () => {
    expect(() => validateFolderNameSegment('../bad', 'project.runtime')).toThrow(
      'must be a single folder name'
    );
  });

  it('keeps folder name resolution immutable across calls', () => {
    const first = resolveFolderNames({ project: { recipes: 'recipes-a' } });
    const second = resolveFolderNames();

    expect(first.project.recipes).toBe('recipes-a');
    expect(second.project.recipes).toBe(DEFAULT_FOLDER_NAMES.project.recipes);
  });

  it('keeps package skills under the neutral internalSkills schema only', () => {
    const legacyPackageSkillsKey = ['injectable', 'Skills'].join('');

    expect(DEFAULT_FOLDER_NAMES.package.internalSkills).toBe('skills');
    expect(Object.hasOwn(DEFAULT_FOLDER_NAMES.package, legacyPackageSkillsKey)).toBe(false);
    expect(Object.hasOwn(resolveFolderNames().package, legacyPackageSkillsKey)).toBe(false);
  });

  it('exposes stage 2 infrastructure entrypoints', () => {
    expect(ConfigLoader).toBeDefined();
    expect(WriteZone).toBeDefined();
  });

  it('exposes stage 3 domain entrypoints and compatibility aliases', () => {
    expect(resolveRecipeDimensionId({ dimensionId: 'architecture' })).toBe('architecture');
    expect(EvolutionPolicy.assessRisk('update', 0.8)).toBe('low');
    expect(getCursorDeliverySpec).toBe(getAgentAdapterFieldSpec);
    expect(getCursorDeliverySpec()).toStrictEqual(getAgentAdapterFieldSpec());
  });

  it('exposes stage 14 root package entrypoints for outer repository convergence', async () => {
    const rootModule = await import('../src/index.js');

    expect(KnowledgeRepositoryImpl).toBeDefined();
    expect(createHostAgentWorkflowSession).toBeDefined();
    expect(Object.hasOwn(rootModule, 'ProjectIntelligenceCapability')).toBe(false);
  });

  it('routes public project information through ProjectContext instead of root source graph aggregation', async () => {
    const rootModule = await import('../src/index.js');

    expect(ProjectContext.execute).toBeInstanceOf(Function);
    expect(Object.hasOwn(rootModule, 'createSourceGraphSnapshot')).toBe(false);
    expect(Object.hasOwn(rootModule, 'createSourceGraphValidationPlanResult')).toBe(false);
    expect(Object.hasOwn(rootModule, 'SourceGraphService')).toBe(false);
    expect(Object.hasOwn(rootModule, 'SourceGraphQueryService')).toBe(false);
  });

  it('exports strict fact execution, admission authority, and snapshot identity from stable facades', async () => {
    const hostAgentWorkflows = await import('../src/host-agent-workflows.js');
    const knowledge = await import('../src/knowledge.js');
    const production = await import('../src/production.js');
    const workspace = await import('../src/workspace.js');

    expect(hostAgentWorkflows.executeStrictFactScheduleV1).toBeInstanceOf(Function);
    expect(hostAgentWorkflows.createAstFactQueryBackendV1).toBeInstanceOf(Function);
    expect(hostAgentWorkflows.createAstFactQueryFamilyV1).toBeInstanceOf(Function);
    expect(hostAgentWorkflows.createStrictAstFactQueryPackV1).toBeInstanceOf(Function);
    expect(hostAgentWorkflows.createStrictFactWitnessAuthorityV1).toBeInstanceOf(Function);
    expect(hostAgentWorkflows.createStrictEvidenceLedgerSnapshotV1).toBeInstanceOf(Function);
    expect(knowledge.createStrictAcceptedCorpusInspectionV1).toBeInstanceOf(Function);
    expect(knowledge.createStrictAdmissionReceiptV1).toBeInstanceOf(Function);
    expect(knowledge.createStrictG2ReceiptV1).toBeInstanceOf(Function);
    expect(knowledge.createStrictRecipePersistedPayloadV1).toBeInstanceOf(Function);
    expect(knowledge.parseStrictPublicationSnapshotIdV1).toBeInstanceOf(Function);
    expect(production.createStrictProductionAuthorityReceiptV1).toBeInstanceOf(Function);
    expect(production.createAgentSemanticDispositionReviewRequestV1).toBeInstanceOf(Function);
    expect(production.createAgentSemanticDispositionReviewExecutionV1).toBeInstanceOf(Function);
    expect(production.consumeMainSemanticDispositionReviewExecutionV1).toBeInstanceOf(Function);
    expect(production.assertSemanticDispositionReviewExecutionV1).toBeInstanceOf(Function);
    expect(production.createStrictExpressionTerminalReturnReceiptV1).toBeInstanceOf(Function);
    expect(production.createStrictG1TerminalBindingReceiptV1).toBeInstanceOf(Function);
    expect(production.assertMiningWorkScheduleV1).toBeInstanceOf(Function);
    expect(production.createKnowledgeDispositionReviewV1).toBeInstanceOf(Function);
    expect(production.createInvestigatedEmptyDecisionV1).toBeInstanceOf(Function);
    expect(production.createKnowledgeClusterSemanticTransitionV1).toBeInstanceOf(Function);
    expect(production.hashKnowledgeDispositionProposalV1).toBeInstanceOf(Function);
    expect(production.hashKnowledgeClusterSetProposalV1).toBeInstanceOf(Function);
    expect(production.buildFactQueryCatalogSnapshot).toBeInstanceOf(Function);
    expect(production.createStrictTestAutomaticSelectionReceiptV1).toBeInstanceOf(Function);
    expect(production.assertStrictTestAutomaticSelectionReceiptV1).toBeInstanceOf(Function);
    expect(Object.hasOwn(production, 'createStrictTestSelectionConfirmationV1')).toBe(false);
    expect(Object.hasOwn(production, 'assertStrictTestSelectionConfirmationV1')).toBe(false);
    const projectContext = await import('../src/project-context.js');
    const projectContextFoundation = await import('../src/projectContextFoundation.js');
    expect(projectContext.createProjectContextFileRef).toBeInstanceOf(Function);
    expect(Object.hasOwn(projectContextFoundation, 'createProjectContextFileRef')).toBe(false);
    expect(workspace.validatePrivateCorpusRevisionInitReceiptV1).toBeInstanceOf(Function);
    expect(workspace.validatePrivateCorpusRevisionCheckpointV1).toBeInstanceOf(Function);
  });

  it('keeps semantic-review minting outside the Main production facade', async () => {
    const hostAgentWorkflows = await import('../src/host-agent-workflows.js');
    const production = await import('../src/production.js');
    const testFixtures = await import('../src/test-fixtures.js');

    expect(hostAgentWorkflows.createAgentSemanticDispositionReviewDurableGatewayV3).toBeInstanceOf(
      Function
    );
    expect(hostAgentWorkflows.createAgentSemanticDispositionReviewDurableGatewayV4).toBeInstanceOf(
      Function
    );
    expect(hostAgentWorkflows.createAgentSemanticDispositionReviewDurableGatewayV5).toBeInstanceOf(
      Function
    );
    expect(production.assertSemanticDispositionReviewDurableAttestationV3).toBeInstanceOf(Function);
    expect(production.assertSemanticDispositionReviewDurableAttestationV4).toBeInstanceOf(Function);
    expect(production.assertSemanticDispositionReviewDurableAttestationV5).toBeInstanceOf(Function);
    expect(production.consumeMainSemanticDispositionReviewDurableAttestationV4).toBeInstanceOf(
      Function
    );
    expect(production.consumeMainSemanticDispositionReviewDurableAttestationV5).toBeInstanceOf(
      Function
    );
    expect(testFixtures.consumeTwoScaleSharedHarvestSemanticReviewFixtureV1).toBeInstanceOf(
      Function
    );
    expect(testFixtures.consumeCrossHarvestSemanticReviewFixtureV1).toBeInstanceOf(Function);
    expect(Object.hasOwn(production, 'createAgentSemanticDispositionReviewHostGatewayV2')).toBe(
      false
    );
    expect(Object.hasOwn(production, 'createSemanticDispositionReviewEvidenceAuthorityV2')).toBe(
      false
    );
    expect(Object.hasOwn(production, 'createAgentSemanticDispositionReviewRequestV2')).toBe(false);
    expect(Object.hasOwn(production, 'createAgentSemanticDispositionReviewDurableGatewayV3')).toBe(
      false
    );
    expect(Object.hasOwn(production, 'createAgentSemanticDispositionReviewDurableGatewayV4')).toBe(
      false
    );
    expect(Object.hasOwn(production, 'createAgentSemanticDispositionReviewDurableGatewayV5')).toBe(
      false
    );
    expect(Object.hasOwn(production, 'createSemanticDispositionReviewEvidenceAuthorityV3')).toBe(
      false
    );
    expect(Object.hasOwn(production, 'createSemanticDispositionReviewEvidenceAuthorityV4')).toBe(
      false
    );
    expect(Object.hasOwn(production, 'assertSemanticDispositionReviewExecutionV2')).toBe(false);
    expect(Object.hasOwn(production, 'consumeMainSemanticDispositionReviewExecutionV2')).toBe(
      false
    );
    expect(
      Object.hasOwn(hostAgentWorkflows, 'createAgentSemanticDispositionReviewHostGatewayV2')
    ).toBe(false);
  });
});
