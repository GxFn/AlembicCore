export type {
  CapabilityProbeOptions,
  CapabilityProbeResult,
  CapabilityProbeStatus,
} from './capability.js';
export { CapabilityProbe } from './capability.js';

import type {
  EnsureProjectGrammarResourcesResult,
  GrammarResourceLogger,
} from './core/ast/index.js';
import { ensureProjectGrammarResources } from './core/ast/index.js';
import { plugin as dartAstPlugin } from './core/ast/lang-dart.js';
import { plugin as goAstPlugin } from './core/ast/lang-go.js';
import { plugin as javaAstPlugin } from './core/ast/lang-java.js';
import { plugin as kotlinAstPlugin } from './core/ast/lang-kotlin.js';
import { plugin as rustAstPlugin } from './core/ast/lang-rust.js';
import { plugin as swiftAstPlugin } from './core/ast/lang-swift.js';
import {
  tsxPlugin as tsxAstPlugin,
  plugin as typeScriptAstPlugin,
} from './core/ast/lang-typescript.js';
import { resetDiscovererRegistry } from './core/discovery/index.js';
import {
  consumeMainSemanticDispositionReviewDurableAttestationV4,
  type SemanticDispositionReviewDurableAttestationV4,
  type SemanticDispositionReviewTrustPolicyV3,
} from './service/production/DurableSemanticDispositionReviewAuthority.js';
import type {
  SemanticDispositionReviewEvidenceAuthorityV3,
  SemanticDispositionReviewRequestV1,
} from './service/production/SemanticDispositionReviewExecution.js';
import type { KnowledgeDispositionReviewV1 } from './service/production/StrictAnalysisContracts.js';

export type { ProjectAnalysisResult } from './core/AstAnalyzer.js';
export {
  analyzeFile,
  analyzeProject,
  isAvailable,
  parseToTree,
  supportedLanguages as supportedAstLanguages,
} from './core/AstAnalyzer.js';
export {
  CallEdgeResolver,
  CallGraphAnalyzer,
  DataFlowInferrer,
  ImportPathResolver,
  ImportRecord,
  SymbolTableBuilder,
} from './core/analysis/index.js';
export type {
  CoreGrammarResourceFile,
  EnsureProjectGrammarResourcesResult,
  GrammarResourceLogger,
} from './core/ast/index.js';
export {
  analyzeSourceFile,
  CORE_GRAMMAR_RESOURCE_FILES,
  ensureProjectGrammarResources,
  isParserReady,
  listCoreGrammarResources,
  reloadProjectAstPlugins,
} from './core/ast/index.js';
export { plugin as dartAstPlugin } from './core/ast/lang-dart.js';
export { plugin as goAstPlugin } from './core/ast/lang-go.js';
export { plugin as javaAstPlugin } from './core/ast/lang-java.js';
export { plugin as kotlinAstPlugin } from './core/ast/lang-kotlin.js';
export { plugin as rustAstPlugin } from './core/ast/lang-rust.js';
export { plugin as swiftAstPlugin } from './core/ast/lang-swift.js';
export {
  plugin as typeScriptAstPlugin,
  tsxPlugin as tsxAstPlugin,
} from './core/ast/lang-typescript.js';
export type {
  ConflictResult,
  DetectMatch,
  DiscovererPreferenceData,
} from './core/discovery/index.js';
export {
  CustomConfigDiscoverer,
  detectConflict,
  getDiscovererRegistry,
  inferConventionRole,
  loadPreference,
  parseBoxfile,
  parseCMakeProject,
  parseFlutterPluginsDeps,
  parseGradleProject,
  parseMelosProject,
  parseModuleSpec,
  parseNxWorkspace,
  parseReactNativeProject,
  parseStarlarkBuildFile,
  RULE_TO_LANGUAGE,
  resetDiscovererRegistry,
  savePreference,
} from './core/discovery/index.js';
export {
  default as LanguageService,
  LanguageService as LanguageServiceClass,
} from './shared/LanguageService.js';
export type { DimensionDef } from './types/ProjectSnapshot.js';
export {
  FileDiffSnapshotStore,
  normalizeSnapshotPath,
  reconcileSnapshotHashes,
  type SnapshotData,
} from './workflows/surfaces/persistence/FileDiffSnapshotStore.js';

export const AST_LANGUAGE_TEST_PLUGINS = Object.freeze({
  dart: dartAstPlugin,
  go: goAstPlugin,
  java: javaAstPlugin,
  kotlin: kotlinAstPlugin,
  rust: rustAstPlugin,
  swift: swiftAstPlugin,
  tsx: tsxAstPlugin,
  typescript: typeScriptAstPlugin,
});

export type AstLanguageTestPluginId = keyof typeof AST_LANGUAGE_TEST_PLUGINS;

export function getAstLanguageTestPlugin(language: AstLanguageTestPluginId) {
  return AST_LANGUAGE_TEST_PLUGINS[language];
}

export interface PrepareProjectAnalysisTestFixturesOptions {
  languages?: readonly string[] | Record<string, number>;
  logger?: GrammarResourceLogger;
  reloadAstPlugins?: boolean;
  resetDiscoveryRegistry?: boolean;
}

export async function prepareProjectAnalysisTestFixtures(
  options: PrepareProjectAnalysisTestFixturesOptions = {}
): Promise<EnsureProjectGrammarResourcesResult> {
  if (options.resetDiscoveryRegistry !== false) {
    resetDiscovererRegistry();
  }

  return ensureProjectGrammarResources(
    options.languages ?? {
      dart: 1,
      go: 1,
      java: 1,
      kotlin: 1,
      rust: 1,
      swift: 1,
      ts: 1,
      tsx: 1,
    },
    {
      logger: options.logger,
      reload: options.reloadAstPlugins,
    }
  );
}

/**
 * Agent 集成测试可复用的两尺度共享收获 consumer。fixture 本身仍必须来自真实 strict fact
 * schedule 与 durable gateway；这里不制造 receipt，也不放宽 production verifier。
 */
export interface TwoScaleSharedHarvestSemanticReviewFixtureV1 {
  readonly semanticRequest: SemanticDispositionReviewRequestV1;
  readonly attestation: SemanticDispositionReviewDurableAttestationV4;
  readonly trustPolicy: SemanticDispositionReviewTrustPolicyV3;
}

export interface TwoScaleSharedHarvestSemanticReviewFixtureResultV1 {
  readonly authority: SemanticDispositionReviewEvidenceAuthorityV3;
  readonly review: KnowledgeDispositionReviewV1;
}

export function consumeTwoScaleSharedHarvestSemanticReviewFixtureV1(
  fixture: TwoScaleSharedHarvestSemanticReviewFixtureV1
): TwoScaleSharedHarvestSemanticReviewFixtureResultV1 {
  const review = consumeMainSemanticDispositionReviewDurableAttestationV4({
    attestation: fixture.attestation,
    expectedSemanticRequest: fixture.semanticRequest,
    expectedTrustPolicy: fixture.trustPolicy,
  });
  const authorities = fixture.attestation.execution.request.evidenceAuthorities;
  const authority = authorities[0];
  if (!authority || authorities.length !== 1) {
    throw new Error('SHARED_HARVEST_FIXTURE_EXACT_ONE_EVIDENCE_AUTHORITY_REQUIRED');
  }
  const bindings = authority.executionReceiptBindings;
  const expectedScales = ['file', 'repository'];
  const actualScales = bindings.map((binding) => binding.analysisScale).sort();
  const expectedReceiptHashes = fixture.semanticRequest.executionReceipts
    .map((receipt) => receipt.receiptHash)
    .sort();
  const actualReceiptHashes = bindings.map((binding) => binding.executionReceiptHash).sort();
  if (
    bindings.length !== 2 ||
    JSON.stringify(actualScales) !== JSON.stringify(expectedScales) ||
    new Set(bindings.map((binding) => binding.obligationId)).size !== 2 ||
    new Set(bindings.map((binding) => binding.executionReceiptHash)).size !== 2 ||
    new Set(bindings.map((binding) => binding.harvestKey)).size !== 1 ||
    new Set(bindings.map((binding) => binding.harvestReceiptHash)).size !== 1 ||
    new Set(bindings.map((binding) => binding.fileExecutionHash)).size !== 1 ||
    JSON.stringify(actualReceiptHashes) !== JSON.stringify(expectedReceiptHashes) ||
    authority.harvestKey !== bindings[0]?.harvestKey ||
    authority.harvestReceiptHash !== bindings[0]?.harvestReceiptHash
  ) {
    throw new Error('SHARED_HARVEST_FIXTURE_CONTRACT_MISMATCH');
  }
  return Object.freeze({ authority, review });
}
