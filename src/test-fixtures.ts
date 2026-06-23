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
} from './workflows/capabilities/persistence/FileDiffSnapshotStore.js';

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
