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
  /** 真实AST位置仅用于不同生产方的对应；兼容输出仍使用原range。 */
  matchingRange?: SourceRangeSummary;
  nameIsPlaceholder?: boolean;
  /** 内部声明证据：SourceGraph可保留变量绑定种类；不改变公开SymbolSummary或ref。 */
  declarationKind?: string;
  declarationRange?: SourceRangeSummary;
  /** 内部兼容证据，由真实AST节点生产，不进入公开SymbolSummary或ref。 */
  compatibilitySource?:
    | 'method-declaration'
    | 'constructor-parameter-property'
    | 'constructor-this-assignment';
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
  /** 同次冻结输入与实际SDK解析证明的跨文件目标，公开层仍使用原SymbolSummary/ref。 */
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
  /** 含显式策略省略项的完整观察，用于证明SDK候选，不作为公开调用列表。 */
  callSiteEvidence?: ExtractedFileFlowCallSite[];
  callSitesComplete?: boolean;
}
