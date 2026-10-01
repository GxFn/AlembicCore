import { readFileSyntaxEvidence } from '../../core/facts/fileSyntaxEvidence.js';
import type {
  CodeGraphProjectBinding,
  CodeGraphProjectResult,
} from '../../infrastructure/analysis/CodeGraphProjectContract.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { hashBytes } from '../../shared/canonicalJson.js';
import { normalizeCodeGraphSymbols } from '../project-context/analysis/codeGraphSymbols.js';
import type { ExtractedFileSymbol } from '../project-context/fileSymbols/contracts.js';
import type { ProjectContextHandlerExecutionContext } from '../project-context/interface/contracts.js';
import type { SourceSliceFileFacts } from '../project-context/sourceSlice/contracts.js';

type ReadyProject = Extract<CodeGraphProjectResult, { status: 'ready' }>;
interface CapturedTarget {
  facts: SourceSliceFileFacts;
  symbol: ExtractedFileSymbol;
  defaultExport: boolean;
}

/** 只索引SDK的实际结果；声明按目标文件懒验证，不在每个调用点遍历整个项目图。 */
export class CapturedCodeGraphIndex {
  readonly #files: Map<string, ReadyProject['files'][number]>;
  readonly #calls = new Map<string, Map<string, CodeGraphProjectBinding[]>>();
  readonly #nodeFiles = new Map<string, string>();
  readonly #targets = new Map<string, Map<string, CapturedTarget>>();

  constructor(
    result: ReadyProject,
    private readonly sources: Map<string, SourceSliceFileFacts>
  ) {
    this.#files = new Map(result.files.map((file) => [file.filePath, file]));
    for (const binding of result.bindings) {
      if (binding.resolvedBy !== 'import') {
        continue;
      }
      let calls = this.#calls.get(binding.filePath);
      if (!calls) {
        calls = new Map();
        this.#calls.set(binding.filePath, calls);
      }
      const key = siteKey(binding.line, binding.column);
      const candidates = calls.get(key) ?? [];
      candidates.push(binding);
      calls.set(key, candidates);
    }
    for (const file of result.files) {
      // SDK同id覆盖的文件已损失声明身份，任何端点都不能被懒加载重新“补成”唯一。
      if (file.ambiguous) {
        continue;
      }
      for (const node of file.nodes) {
        this.#nodeFiles.set(node.id, file.filePath);
      }
    }
  }

  allowsSource(filePath: string): boolean {
    const file = this.#files.get(filePath);
    if (!file || file.ambiguous) {
      Logger.debug('CodeGraph retains unresolved calls for an absent or ambiguous captured file', {
        filePath,
      });
      return false;
    }
    return true;
  }

  candidates(filePath: string, line: number, column: number): readonly CodeGraphProjectBinding[] {
    return this.#calls.get(filePath)?.get(siteKey(line, column)) ?? [];
  }

  target(id: string, context?: ProjectContextHandlerExecutionContext): CapturedTarget | undefined {
    const filePath = this.#nodeFiles.get(id);
    if (!filePath) {
      return undefined;
    }
    let targets = this.#targets.get(filePath);
    if (!targets) {
      targets = this.readTargets(filePath, context);
      this.#targets.set(filePath, targets);
    }
    return targets.get(id);
  }

  private readTargets(
    filePath: string,
    context?: ProjectContextHandlerExecutionContext
  ): Map<string, CapturedTarget> {
    const targets = new Map<string, CapturedTarget>();
    const file = this.#files.get(filePath)!;
    const facts = this.sources.get(filePath);
    if (!facts || file.contentHash !== hashBytes(Buffer.from(facts.text)).slice(7)) {
      Logger.debug('CodeGraph target has no matching captured source bytes', { filePath });
      return targets;
    }
    const evidence =
      context?.analysis?.declarations(facts, context) ?? readFileSyntaxEvidence(facts, false);
    const legacy = evidence.symbols;
    if (legacy.syntaxValid !== true || legacy.syntaxFeatures?.length || legacy.unavailableReason) {
      Logger.debug('CodeGraph target declaration evidence is unavailable', {
        filePath,
        reason: legacy.unavailableReason,
        syntaxValid: legacy.syntaxValid,
        features: legacy.syntaxFeatures,
      });
      return targets;
    }
    // 必须验证整个目标文件的SDK覆盖，不能只抽一个节点掩盖丢失声明或补充语义。
    const extracted = normalizeCodeGraphSymbols(facts, { nodes: file.nodes, errors: [] }, legacy);
    if (extracted.unavailableReason) {
      return targets;
    }
    const declarations = new Map<string, ExtractedFileSymbol[]>();
    for (const symbol of extracted.symbols) {
      const key = declarationKey(symbol.name, symbol.qualifiedName ?? symbol.name);
      const group = declarations.get(key) ?? [];
      group.push(symbol);
      declarations.set(key, group);
    }
    for (const node of file.nodes) {
      const named =
        declarations.get(declarationKey(node.name, node.qualifiedName.replaceAll('::', '.'))) ?? [];
      const located = named.filter(
        (symbol) =>
          (symbol.matchingRange ?? symbol.declarationRange ?? symbol.range).startLine ===
          node.startLine
      );
      const candidates = located.length ? located : named;
      if (candidates.length !== 1) {
        continue;
      }
      targets.set(node.id, {
        facts,
        symbol: candidates[0],
        defaultExport:
          evidence.defaultExportNames.length === 1 &&
          evidence.defaultExportNames[0] === candidates[0].name,
      });
    }
    Logger.debug('CodeGraph verified captured target declarations on demand', {
      filePath,
      targets: targets.size,
    });
    return targets;
  }
}

const siteKey = (line: number, column: number) => `${line}:${column}`;
const declarationKey = (name: string, qualifiedName: string) =>
  JSON.stringify([name, qualifiedName]);
