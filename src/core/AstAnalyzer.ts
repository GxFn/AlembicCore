/**
 * @module AstAnalyzer
 * @description 基于 Tree-sitter 的多语言 AST 分析器（插件注册制）
 *
 * 提供结构化代码分析能力：
 * - 类/协议/扩展 声明与继承关系
 * - 属性声明与修饰符
 * - 方法签名（类方法/实例方法）
 * - 设计模式检测（Singleton、Delegate、Factory、Observer）
 * - 代码结构指标（圈复杂度、嵌套深度、方法行数）
 *
 * 支持语言：通过插件注册 — ObjC、Swift、TypeScript、JavaScript、Python、Java、Kotlin、Go、Dart、Rust
 * 插件注册入口: lib/core/ast/index.js
 */

// 门面：实现已按职责拆入 core/ast——
//   languageRegistry  语言插件注册表与 parser 生命周期
//   analyzeFile       单文件 AST 摘要
//   guardQueries      Guard 规则用的树查询
// 保留本路径是因为 Guard、向量分块（受祝福导入）、测试夹具都从这里取用；语法层内部不得反向导入本文件。
export { analyzeFile } from './ast/analyzeFile.js';
export {
  checkProtocolConformance,
  findCallExpressions,
  findPatternInContext,
} from './ast/guardQueries.js';
export {
  _resetAstParserCacheForTesting,
  isAvailable,
  parseToTree,
  registerLanguage,
  supportedLanguages,
} from './ast/languageRegistry.js';
