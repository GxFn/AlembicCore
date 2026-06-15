/**
 * @module discovery/index
 * @description ProjectDiscoverer 系统入口 - 初始化 Registry 并注册所有 Discoverer
 */

import { CustomConfigDiscoverer } from './CustomConfigDiscoverer.js';
import { DartDiscoverer } from './DartDiscoverer.js';
import { DiscovererRegistry } from './DiscovererRegistry.js';
import { GenericDiscoverer } from './GenericDiscoverer.js';
import { GoDiscoverer } from './GoDiscoverer.js';
import { JvmDiscoverer } from './JvmDiscoverer.js';
import { NodeDiscoverer } from './NodeDiscoverer.js';
import { PythonDiscoverer } from './PythonDiscoverer.js';
import { RustDiscoverer } from './RustDiscoverer.js';
import { SpmDiscoverer } from './SpmDiscoverer.js';

let _registry: DiscovererRegistry | null = null;

/** 获取全局 DiscovererRegistry 单例 */
export function getDiscovererRegistry() {
  if (!_registry) {
    _registry = new DiscovererRegistry();
    _registry
      .register(new SpmDiscoverer())
      .register(new NodeDiscoverer())
      .register(new PythonDiscoverer())
      .register(new JvmDiscoverer())
      .register(new GoDiscoverer())
      .register(new DartDiscoverer())
      .register(new RustDiscoverer())
      .register(new CustomConfigDiscoverer())
      .register(new GenericDiscoverer());
  }
  return _registry;
}

/** 重置 Registry（仅用于测试） */
export function resetDiscovererRegistry() {
  _registry = null;
}

export { CustomConfigDiscoverer } from './CustomConfigDiscoverer.js';
export { DartDiscoverer } from './DartDiscoverer.js';
export {
  type ConflictResult,
  type DetectMatch,
  type DiscovererPreferenceData,
  detectConflict,
  loadPreference,
  savePreference,
} from './DiscovererPreference.js';
export { DiscovererRegistry } from './DiscovererRegistry.js';
export { GenericDiscoverer } from './GenericDiscoverer.js';
export { GoDiscoverer } from './GoDiscoverer.js';
export { JvmDiscoverer } from './JvmDiscoverer.js';
export { NodeDiscoverer } from './NodeDiscoverer.js';
// Re-exports
export { ProjectDiscoverer } from './ProjectDiscoverer.js';
export { PythonDiscoverer } from './PythonDiscoverer.js';
export type {
  CMakeLinkDep,
  CMakeTarget,
  ParsedCMakeProject,
} from './parsers/CMakeParser.js';
export { parseCMakeProject } from './parsers/CMakeParser.js';
export type {
  GradleDep,
  GradleModule,
  ParsedGradleProject,
} from './parsers/GradleDslParser.js';
export {
  inferConventionRole,
  isKmpBuildFile,
  parseGradleProject,
} from './parsers/GradleDslParser.js';
export type {
  FlutterPlugin,
  NxProject,
  ParsedFlutterPluginsDeps,
  ParsedNxWorkspace,
  ParsedReactNativeProject,
} from './parsers/JsonConfigParser.js';
export {
  parseFlutterPluginsDeps,
  parseNxWorkspace,
  parseReactNativeProject,
} from './parsers/JsonConfigParser.js';
export type {
  ParsedLayer,
  ParsedModule,
  ParsedModuleSpec,
  ParsedProjectConfig,
} from './parsers/RubyDslParser.js';
export {
  parseBoxfile,
  parseModuleSpec,
} from './parsers/RubyDslParser.js';
export type {
  LoadStatement,
  ParsedBuildFile,
  StarlarkTarget,
} from './parsers/StarlarkParser.js';
export {
  parseStarlarkBuildFile,
  RULE_TO_LANGUAGE,
} from './parsers/StarlarkParser.js';
export {
  extractXcodeGenDependencyEdges,
  parseMelosProject,
  parseXcodeGenProject,
  parseXcodeGenTarget,
} from './parsers/YamlConfigParser.js';
export { RustDiscoverer } from './RustDiscoverer.js';
export {
  COMMON_SOURCE_SCAN_EXCLUDE_DIRS,
  createSourceScanExcludeDirs,
  isSourceScanExcludedDir,
} from './SourceScanExclusions.js';
export { SpmDiscoverer } from './SpmDiscoverer.js';
