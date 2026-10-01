/**
 * @module ast/astTypes
 * @description 语言插件、注册表与单文件分析共用的 AST 记录类型。只有类型，没有运行时代码。
 */

import type { CallSiteInfo } from './extract/CallSiteExtractor.js';

/** Minimal tree-sitter parser interface */
export interface TreeSitterParser {
  parse(input: string): TreeSitterTree | null;
  setLanguage(language: unknown): void;
  delete(): void;
}

/** Minimal tree-sitter tree interface */
export interface TreeSitterTree {
  rootNode: TreeSitterNode;
  delete(): void;
}

/** Language AST plugin interface */
export interface LangPlugin {
  getGrammar: () => unknown;
  walk: (rootNode: TreeSitterNode, ctx: AstWalkerContext) => void;
  detectPatterns?: (
    root: TreeSitterNode,
    lang: string,
    methods: AstMethodRecord[],
    properties: AstPropertyRecord[],
    classes: AstClassRecord[]
  ) => AstPatternRecord[];
  extractCallSites?: (root: TreeSitterNode, ctx: AstWalkerContext, lang: string) => void;
  extensions?: string[];
}

/** Context object passed to AST walkers */
export interface AstWalkerContext {
  classes: AstClassRecord[];
  protocols: AstProtocolRecord[];
  categories: AstCategoryRecord[];
  methods: AstMethodRecord[];
  properties: AstPropertyRecord[];
  patterns: AstPatternRecord[];
  imports: string[];
  exports: string[];
  callSites: CallSiteInfo[];
  callSiteEvidence: CallSiteInfo[];
  references: AstReferenceRecord[];
  [key: string]: unknown;
}

export interface AstClassRecord {
  name: string;
  superclass?: string;
  protocols?: string[];
  methodCount?: number;
  line?: number;
  file?: string;
  [key: string]: unknown;
}

export interface AstProtocolRecord {
  name: string;
  inherits?: string[];
  file?: string;
  [key: string]: unknown;
}

export interface AstCategoryRecord {
  className?: string;
  categoryName?: string;
  name?: string;
  targetClass?: string;
  methods?: AstMethodRecord[];
  protocols?: string[];
  file?: string;
  [key: string]: unknown;
}

export interface AstMethodRecord {
  name: string;
  className?: string;
  isClassMethod?: boolean;
  kind?: string;
  line?: number;
  bodyLines?: number;
  complexity?: number;
  nestingDepth?: number;
  file?: string;
  [key: string]: unknown;
}

export interface AstPropertyRecord {
  name: string;
  className?: string;
  attributes?: string[];
  line?: number;
  file?: string;
  [key: string]: unknown;
}

export interface AstPatternRecord {
  type: string;
  className?: string;
  methodName?: string;
  propertyName?: string;
  isWeakRef?: boolean;
  line?: number;
  confidence?: number;
  file?: string;
  [key: string]: unknown;
}

export interface AstReferenceRecord {
  [key: string]: unknown;
}
