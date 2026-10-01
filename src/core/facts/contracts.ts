/**
 * 文件事实契约：一份源码文本经语法层提取后得到的符号与出现点。
 *
 * 这些是索引、链接与 ProjectContext 协议共用的中间形态，不是任何对外 DTO。
 * 位置类型取自 domain/project-context（仅类型桥接，无运行时依赖）。
 */
import type { SourceRangeSummary, SymbolSummary } from '../../domain/project-context/index.js';

export interface ExtractedFileSymbol {
  name: string;
  kind: string;
  filePath: string;
  range: SourceRangeSummary;
  exported?: boolean;
  qualifiedName?: string;
  signature?: string;
  container?: string;
  /** 声明节点的真实位置（含列），用于调用点归属；公开结果仍使用按行的 range。 */
  matchingRange?: SourceRangeSummary;
  /** 声明的语法种类与真实位置（含列）：索引据此保留绑定种类、区分同一行上的多个声明。 */
  declarationKind?: string;
  declarationRange?: SourceRangeSummary;
  /**
   * 声明来源：没有函数体的方法声明、由构造函数参数或 this 赋值得到的属性。
   * 只进索引的符号元数据，不进入公开 SymbolSummary 或 ref。
   */
  compatibilitySource?:
    | 'method-declaration'
    | 'constructor-parameter-property'
    | 'constructor-this-assignment';
  /**
   * 类型声明写出的父类型名字，原样保留（去掉泛型实参）。extends：父类、被扩展的接口；
   * implements：实现的接口或遵循的协议。名字到声明的解析由链接层完成。
   */
  heritage?: { extends: string[]; implements: string[] };
}

export interface FileSymbolsExtractionResult {
  symbols: ExtractedFileSymbol[];
  unavailableReason?: string;
  /** 仅用于生产方完整性判定，不直接扩展公开符号DTO。 */
  syntaxValid?: boolean;
  syntaxFeatures?: string[];
}

export type FileFlowImportKind = 'named' | 'default' | 'namespace' | 'side-effect' | 'dynamic';

export interface ExtractedFileFlowImport {
  specifier: string;
  kind: FileFlowImportKind;
  range: SourceRangeSummary;
  statement: string;
  symbols: string[];
  alias?: string;
  typeOnly?: boolean;
  bindings?: { local: string; imported: string; range: SourceRangeSummary; typeOnly: boolean }[];
}

export interface ExtractedFileFlowExport {
  name: string;
  kind: string;
  range: SourceRangeSummary;
  statement: string;
  exportedName?: string;
  specifier?: string;
}

export interface ExtractedFileFlowCallSite {
  callee: string;
  /** 导入绑定链接证明的跨文件目标；公开层仍使用原SymbolSummary/ref。 */
  resolvedTarget?: SymbolSummary;
  callerMethod: string;
  callerClass?: string;
  callType: string;
  range: SourceRangeSummary;
  argCount?: number;
  receiver?: string;
  receiverType?: string;
  isAwait?: boolean;
  /** 同文本真实AST证据，仅供后端对应/端点消歧，不直接扩展公开RelationSummary。 */
  matchingRange?: SourceRangeSummary;
  callerRange?: SourceRangeSummary;
  callerQualifiedName?: string;
  calleeExpression?: string;
  receiverSyntax?: string;
  syntaxKind?: 'call' | 'new' | 'jsx';
  omissionReason?: string;
  calleeShadowed?: boolean;
  calleeQualifiedName?: string;
  calleeBindingRange?: SourceRangeSummary;
}

export interface FileFlowExtractionResult {
  imports: ExtractedFileFlowImport[];
  exports: ExtractedFileFlowExport[];
  callSites: ExtractedFileFlowCallSite[];
  unavailableReason?: string;
  /** 含显式策略省略项的完整观察（噪声调用也在内），不作为公开调用列表。 */
  callSiteEvidence?: ExtractedFileFlowCallSite[];
  callSitesComplete?: boolean;
}
