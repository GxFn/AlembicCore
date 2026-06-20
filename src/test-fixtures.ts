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
export {
  CustomConfigDiscoverer,
  getDiscovererRegistry,
  inferConventionRole,
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
} from './core/discovery/index.js';
export {
  dartAstPlugin,
  goAstPlugin,
  javaAstPlugin,
  kotlinAstPlugin,
  rustAstPlugin,
  swiftAstPlugin,
  typeScriptAstPlugin,
  tsxAstPlugin,
};
export { CouplingAnalyzer } from './service/panorama/CouplingAnalyzer.js';
export type { ConfigLayer } from './service/panorama/LayerInferrer.js';
export { LayerInferrer } from './service/panorama/LayerInferrer.js';
export { ModuleDiscoverer } from './service/panorama/ModuleDiscoverer.js';
export { PanoramaAggregator } from './service/panorama/PanoramaAggregator.js';
export { PanoramaScanner } from './service/panorama/PanoramaScanner.js';
export { PanoramaService } from './service/panorama/PanoramaService.js';
export type { CyclicDependency, Edge } from './service/panorama/PanoramaTypes.js';
export { type ModuleCandidate, RoleRefiner } from './service/panorama/RoleRefiner.js';
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
} from './workflows/capabilities/project-intelligence/FileDiffSnapshotStore.js';
export { evaluateProjectAnalysisIncrementalPlan } from './workflows/capabilities/project-intelligence/ProjectIntelligenceIncrementalPlanner.js';

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
