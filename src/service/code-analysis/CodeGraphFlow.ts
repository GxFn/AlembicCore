import type { FileAstInput } from '../../core/facts/fileAst.js';
import type {
  CodeGraphCallReference,
  CodeGraphExtraction,
} from '../../infrastructure/analysis/CodeGraphProcess.js';
import Logger from '../../infrastructure/logging/Logger.js';
import type {
  ExtractedFileFlowCallSite,
  FileFlowExtractionResult,
} from '../project-context/fileFlow/contracts.js';

// SDK 1.6刻意不发literal receiver的调用ref，避免按裸名连到项目符号。
// Alembic保留这些既有文件观察，但只依据真实AST形态补充且目标继续未解析。
const SDK_LITERAL_RECEIVERS = new Set([
  'string',
  'template_string',
  'number',
  'regex',
  'true',
  'false',
  'null',
  'undefined',
  'array',
  'object',
]);

/**
 * SDK证明调用存在与重数，AST补足同一位置的真实语义；二者都不证明跨文件callee目标。
 * 不使用SDK node id推断caller：同行节点可共用id，匿名回调也可能只归到SDK外层节点。
 */
export function normalizeCodeGraphFlow(
  input: FileAstInput,
  extraction: CodeGraphExtraction,
  legacy: FileFlowExtractionResult
): FileFlowExtractionResult {
  if (legacy.unavailableReason) {
    return legacy;
  }
  const unavailable = (reason: string): FileFlowExtractionResult => {
    Logger.warn('CodeGraph call coverage is unavailable', { filePath: input.filePath, reason });
    return {
      ...legacy,
      callSites: [],
      unavailableReason: `CodeGraph call coverage unavailable for ${input.filePath}: ${reason}.`,
    };
  };
  if (
    !extraction.references ||
    extraction.errors.length > 0 ||
    legacy.callSitesComplete !== true ||
    !legacy.callSiteEvidence
  ) {
    return unavailable('complete SDK and AST observations are required');
  }
  const lines = input.text.split(/\r\n|\n|\r/);
  const knownNodes = new Set(extraction.nodes.map((node) => node.id));
  const evidence = legacy.callSiteEvidence;
  const byPosition = new Map<string, ExtractedFileFlowCallSite[]>();
  for (const site of evidence) {
    if (site.matchingRange && (site.syntaxKind === 'call' || site.syntaxKind === 'new')) {
      const key = `${site.syntaxKind}:${site.matchingRange.startLine}:${site.matchingRange.startColumn}`;
      const sites = byPosition.get(key) ?? [];
      sites.push(site);
      byPosition.set(key, sites);
    }
  }
  const groups = new Map<
    string,
    { reference: CodeGraphCallReference; count: number; matches: ExtractedFileFlowCallSite[] }
  >();
  for (const reference of extraction.references) {
    if (
      !knownNodes.has(reference.fromNodeId) ||
      reference.line > lines.length ||
      reference.column > (lines[reference.line - 1]?.length ?? -1)
    ) {
      return unavailable('SDK reference has no source node or valid position');
    }
    // 完整SDK记录hash包含未投影的候选信息；只有真正等价的ref才能合成多重集证明。
    const key = JSON.stringify([
      reference.fromNodeId,
      reference.referenceKind,
      reference.referenceName,
      reference.line,
      reference.column,
      reference.evidenceHash,
    ]);
    const current = groups.get(key);
    if (current) {
      current.count += 1;
    } else {
      groups.set(key, {
        reference,
        count: 1,
        // 按真实点位检索，避免每个SDK引用反复扫描整文件的调用证据。
        matches: (
          byPosition.get(
            `${reference.referenceKind === 'instantiates' ? 'new' : 'call'}:${reference.line}:${reference.column}`
          ) ?? []
        ).filter((site) => matchesReferenceName(reference, site)),
      });
    }
  }
  const used = new Set<ExtractedFileFlowCallSite>();
  const calls: ExtractedFileFlowCallSite[] = [];
  let omitted = 0;
  let equivalentGroups = 0;
  for (const group of groups.values()) {
    if (group.matches.length !== group.count || group.matches.some((site) => used.has(site))) {
      return unavailable(
        `call candidate could not be matched uniquely at ${group.reference.line}:${group.reference.column}`
      );
    }
    if (group.count > 1) {
      equivalentGroups += 1;
    }
    for (const site of group.matches) {
      used.add(site);
      if (site.omissionReason) {
        omitted += 1;
      } else {
        calls.push(site);
      }
    }
  }
  let jsxSupplements = 0;
  let literalSupplements = 0;
  for (const site of evidence) {
    if (used.has(site) || site.omissionReason) {
      continue;
    }
    // SDK 1.6不把JSX标签作为调用；只补这个真实AST形态，不能用全量旧结果掩盖漏提取。
    if (site.syntaxKind === 'jsx') {
      calls.push(site);
      jsxSupplements += 1;
    } else if (
      site.syntaxKind === 'call' &&
      site.receiverSyntax &&
      SDK_LITERAL_RECEIVERS.has(site.receiverSyntax)
    ) {
      calls.push(site);
      literalSupplements += 1;
    } else {
      return unavailable(
        `SDK omitted a verified call at ${site.matchingRange?.startLine ?? site.range.startLine}`
      );
    }
  }
  Logger.debug('CodeGraph calls projected from SDK candidates and source syntax', {
    filePath: input.filePath,
    sdkReferences: extraction.references.length,
    calls: calls.length,
    omitted,
    equivalentGroups,
    jsxSupplements,
    literalSupplements,
    targetResolution: 'file-scoped-observation',
  });
  return { ...legacy, callSites: calls.map((site) => structuredClone(site)) };
}

function matchesReferenceName(
  reference: CodeGraphCallReference,
  site: ExtractedFileFlowCallSite
): boolean {
  const name = reference.referenceName;
  if (
    name === site.calleeExpression ||
    name === site.callee ||
    (site.receiver && name === `${site.receiver}.${site.callee}`)
  ) {
    return true;
  }
  // 构造器的qualified type在SDK中可缩为最后一段；位置/AST语法形态仍须同时成立。
  return reference.referenceKind === 'instantiates' && name === site.callee.split('.').at(-1);
}
