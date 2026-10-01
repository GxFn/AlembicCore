/**
 * @module ast/analyzeFile
 * @description 单文件 AST 摘要：类型声明、成员、导入导出、调用点、继承边、模式与指标。
 *
 * 这是语法层唯一的结构化产物。跨文件汇总与关系解析不在这里，由上层的文件事实、链接与索引承担。
 */

import Logger from '../../infrastructure/logging/Logger.js';
import type {
  AstCategoryRecord,
  AstClassRecord,
  AstMethodRecord,
  AstPatternRecord,
  AstPropertyRecord,
  AstProtocolRecord,
  AstReferenceRecord,
  AstWalkerContext,
} from './astTypes.js';
import {
  type CallSiteInfo,
  defaultExtractCallSites,
  getCallSiteExtractor,
} from './extract/CallSiteExtractor.js';
import {
  collectJsDeclarations,
  type SupplementalDeclaration,
} from './extract/JsDeclarationCollector.js';
import { collectModuleSyntax, type ModuleSyntaxFacts } from './extract/ModuleSyntaxCollector.js';
import { hasOnlyTolerableSyntaxErrors } from './extract/SyntaxTolerance.js';
import { getLanguageParser, getLanguagePlugin } from './languageRegistry.js';

interface InheritanceEdge {
  from: string;
  to: string;
  type: string;
}

interface AstMetrics {
  methodCount: number;
  avgBodyLines: number;
  maxComplexity: number;
  maxNestingDepth: number;
  longMethods: AstMethodRecord[];
  complexMethods: AstMethodRecord[];
}

export interface AstFileSummary {
  lang: string;
  classes: AstClassRecord[];
  protocols: AstProtocolRecord[];
  categories: AstCategoryRecord[];
  methods: AstMethodRecord[];
  properties: AstPropertyRecord[];
  patterns: AstPatternRecord[];
  imports: string[];
  exports: string[];
  callSites: CallSiteInfo[];
  references: AstReferenceRecord[];
  inheritanceGraph: InheritanceEdge[];
  metrics: AstMetrics;
}

export interface AnalyzeFileOptions {
  extractCallSites?: boolean;
  /** 独立观察真实语法完整性，保留既有摘要字段与持久化形态。 */
  onSyntaxValidity?: (valid: boolean | undefined, features: readonly string[]) => void;
  /** 树内投影的模块事实，不改变 AstFileSummary 的既有 JSON/持久化形态。 */
  onModuleSyntax?: (facts: ModuleSyntaxFacts) => void;
  /** 摘要没有承载的模块级声明（顶层变量、接口成员）；同样不进入 AstFileSummary。 */
  onDeclarations?: (declarations: SupplementalDeclaration[]) => void;
  /** 与过滤后的 callSites 分离；未执行调用点 pass 时不回调，不能伪装为完整空集。 */
  onCallSiteEvidence?: (facts: { callSites: CallSiteInfo[]; complete: boolean }) => void;
}

/**
 * 分析单个源文件，返回结构化 AST 摘要
 * @param source 源代码文本
 * @param lang 语言标识 'objectivec' | 'swift' | 'typescript' | 'javascript' | 'python' | 'java' | 'kotlin' | 'go' | 'dart' | 'rust' | 'tsx'
 * @param [options.extractCallSites=true] 是否提取调用点 (Phase 5)
 */
export function analyzeFile(
  source: string,
  lang: string,
  options: AnalyzeFileOptions = {}
): AstFileSummary | null {
  const plugin = getLanguagePlugin(lang);
  if (!plugin) {
    return null; // 无插件 → 优雅降级
  }

  const parser = getLanguageParser(lang);
  if (!parser) {
    return null;
  }

  const tree = parser.parse(source);
  if (!tree) {
    return null;
  }
  try {
    const root = tree.rootNode;
    if (options.onSyntaxValidity) {
      const features: string[] = [];
      // 保留真实AST声明形态，后端自行声明能力；不能用空symbols推断不存在namespace/匿名导出。
      if (
        ['typescript', 'javascript', 'tsx', 'jsx'].includes(lang) &&
        typeof root.descendantsOfType === 'function'
      ) {
        if (root.descendantsOfType(['internal_module', 'module']).length > 0) {
          features.push('namespace');
        }
        if (
          root.descendantsOfType('export_statement').some((declaration) => {
            const value = declaration.childForFieldName('value');
            return (
              value &&
              ['class', 'function_expression', 'generator_function', 'arrow_function'].includes(
                value.type
              ) &&
              !value.childForFieldName('name')
            );
          })
        ) {
          features.push('anonymous-default-declaration');
        }
      }
      const jsFamily = ['typescript', 'javascript', 'tsx', 'jsx'].includes(lang);
      options.onSyntaxValidity(
        typeof root.hasError === 'boolean'
          ? // 语法包不认识的类型层新语法不算语法错误；其余语言保持原判定。
            !root.hasError || (jsFamily && hasOnlyTolerableSyntaxErrors(root))
          : undefined,
        features
      );
    }

    const ctx: AstWalkerContext = {
      classes: [],
      protocols: [],
      categories: [],
      methods: [],
      properties: [],
      patterns: [],
      imports: [],
      exports: [],
      // ─── Phase 5 新增 ───
      callSites: [],
      callSiteEvidence: [],
      references: [],
    };

    plugin.walk(root, ctx);

    if (options.onModuleSyntax && ['typescript', 'javascript', 'tsx', 'jsx'].includes(lang)) {
      options.onModuleSyntax(collectModuleSyntax(root));
    }
    if (options.onDeclarations && ['typescript', 'javascript', 'tsx', 'jsx'].includes(lang)) {
      options.onDeclarations(collectJsDeclarations(root));
    }

    // Phase 5: 可选的 call site 提取 pass (post-walk extraction)
    if (options.extractCallSites !== false) {
      const extractor =
        plugin.extractCallSites || getCallSiteExtractor(lang) || defaultExtractCallSites;
      let complete = extractor !== defaultExtractCallSites;
      if (!complete && options.onCallSiteEvidence) {
        Logger.getInstance().debug('[AstAnalyzer] call-site evidence unavailable', {
          language: lang,
          reason: 'no-language-call-site-producer',
        });
      }
      try {
        extractor(root, ctx, lang);
      } catch (error: unknown) {
        complete = false;
        // 旧摘要仍宽容返回已提取部分；观察者必须知道 calls 未完成，不能把空数组当成覆盖证明。
        Logger.getInstance().warn('[AstAnalyzer] call-site extraction incomplete', {
          language: lang,
          reason: error instanceof Error ? error.message : String(error),
          callSiteCount: ctx.callSites.length,
          evidenceCount: ctx.callSiteEvidence.length,
        });
      }
      options.onCallSiteEvidence?.({
        // observer 拥有独立 plain 观察值，尤其旧语言 fallback 不能把原摘要数组交给回调修改。
        callSites: structuredClone(
          ctx.callSiteEvidence.length > 0 ? ctx.callSiteEvidence : ctx.callSites
        ),
        complete,
      });
    }

    // 构建继承图谱
    const inheritanceGraph = _buildInheritanceGraph(ctx.classes, ctx.protocols, ctx.categories);

    // 检测设计模式（优先使用插件自带的检测器，否则使用通用检测器）
    const detectedPatterns = plugin.detectPatterns
      ? plugin.detectPatterns(root, lang, ctx.methods, ctx.properties, ctx.classes)
      : _detectPatterns(root, lang, ctx.methods, ctx.properties, ctx.classes);
    ctx.patterns.push(...detectedPatterns);

    // 结构指标
    const metrics = _computeMetrics(root, lang, ctx.methods);

    return {
      lang,
      classes: ctx.classes,
      protocols: ctx.protocols,
      categories: ctx.categories,
      methods: ctx.methods,
      properties: ctx.properties,
      patterns: ctx.patterns,
      imports: ctx.imports,
      exports: ctx.exports,
      callSites: ctx.callSites,
      references: ctx.references,
      inheritanceGraph,
      metrics,
    };
  } finally {
    tree.delete();
  }
}

// ──────────────────────────────────────────────────────────────────
// 设计模式检测（通用回退，插件可提供自己的 detectPatterns）
// ──────────────────────────────────────────────────────────────────

function _detectPatterns(
  root: TreeSitterNode,
  lang: string,
  methods: AstMethodRecord[],
  properties: AstPropertyRecord[],
  classes: AstClassRecord[]
) {
  const patterns: AstPatternRecord[] = [];

  // Singleton 检测
  for (const m of methods) {
    if (m.isClassMethod && /^shared|^default|^instance$|^current$/.test(m.name)) {
      patterns.push({
        type: 'singleton',
        className: m.className,
        methodName: m.name,
        line: m.line,
        confidence: 0.9,
      });
    }
  }

  // Delegate 检测（通过属性类型）
  for (const p of properties) {
    if (/delegate/i.test(p.name)) {
      const isWeak = (p.attributes || []).includes('weak');
      patterns.push({
        type: 'delegate',
        className: p.className,
        propertyName: p.name,
        isWeakRef: isWeak,
        line: p.line,
        confidence: 0.95,
      });
    }
  }

  // Factory 检测
  for (const m of methods) {
    if (m.isClassMethod && /^make|^create|^new|^from/.test(m.name) && m.name !== 'new') {
      patterns.push({
        type: 'factory',
        className: m.className,
        methodName: m.name,
        line: m.line,
        confidence: 0.8,
      });
    }
  }

  // Observer/Notification 检测（通过方法名）
  for (const m of methods) {
    if (/^observe|^addObserver|^subscribe/.test(m.name) || /^didChange|^willChange/.test(m.name)) {
      patterns.push({
        type: 'observer',
        className: m.className,
        methodName: m.name,
        line: m.line,
        confidence: 0.7,
      });
    }
  }

  return patterns;
}

// ──────────────────────────────────────────────────────────────────
// 继承图谱
// ──────────────────────────────────────────────────────────────────

function _buildInheritanceGraph(
  classes: AstClassRecord[],
  protocols: AstProtocolRecord[],
  categories: AstCategoryRecord[]
) {
  const edges: InheritanceEdge[] = [];

  for (const cls of classes) {
    if (cls.superclass) {
      edges.push({ from: cls.name, to: cls.superclass, type: 'inherits' });
    }
    if (cls.protocols) {
      for (const proto of cls.protocols) {
        edges.push({ from: cls.name, to: proto, type: 'conforms' });
      }
    }
  }

  for (const proto of protocols) {
    if (proto.inherits) {
      for (const parent of proto.inherits) {
        edges.push({ from: proto.name, to: parent, type: 'inherits' });
      }
    }
  }

  for (const cat of categories) {
    // 兼容 ObjC category (className/categoryName) 和 Dart extension (name/targetClass)
    const catClassName = cat.className || cat.targetClass;
    const catCategoryName = cat.categoryName || cat.name;
    if (!catClassName) {
      continue; // 跳过无法确定目标类的 category
    }
    edges.push({
      from: `${catClassName}(${catCategoryName})`,
      to: catClassName,
      type: 'extends',
    });
    if (cat.protocols) {
      for (const proto of cat.protocols) {
        edges.push({ from: catClassName, to: proto, type: 'conforms' });
      }
    }
  }

  return edges;
}

// ──────────────────────────────────────────────────────────────────
// 代码质量指标
// ──────────────────────────────────────────────────────────────────

// 复杂度/嵌套由各语言插件随方法记录产出；这里只聚合，不维护第二套未调用的遍历算法。
function _computeMetrics(root: TreeSitterNode, lang: string, methods: AstMethodRecord[]) {
  const defs = methods.filter((m) => m.kind === 'definition');
  const totalBodyLines = defs.reduce((sum: number, m) => sum + (m.bodyLines || 0), 0);

  return {
    methodCount: defs.length,
    avgBodyLines: defs.length > 0 ? totalBodyLines / defs.length : 0,
    maxComplexity: defs.length > 0 ? Math.max(...defs.map((m) => m.complexity || 1)) : 0,
    maxNestingDepth: defs.length > 0 ? Math.max(...defs.map((m) => m.nestingDepth || 0)) : 0,
    longMethods: defs.filter((m) => (m.bodyLines || 0) > 50),
    complexMethods: defs.filter((m) => (m.complexity || 1) > 10),
  };
}
