import path from 'node:path';
import type {
  CodeGraphInputRequest,
  CodeGraphProjectResult,
} from '../../infrastructure/analysis/CodeGraphProjectContract.js';
import {
  type CodeGraphGitObservation,
  readCodeGraphGitInput,
} from '../../infrastructure/io/CodeGraphGitInput.js';
import {
  type ProjectInputSnapshotView,
  readProjectInputSnapshotView,
} from '../../infrastructure/io/ProjectInputSnapshot.js';
import { projectSourceReaderIdentity } from '../../infrastructure/io/ProjectSourceReader.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { hashBytes } from '../../shared/canonicalJson.js';
import type { ProjectSourceReader } from '../../types/projectSourceReader.js';
import { readProjectContextAst } from '../project-context/analysis/astFacts.js';
import { normalizeCodeGraphSymbols } from '../project-context/analysis/codeGraphSymbols.js';
import type { ProjectCallResolver } from '../project-context/analysis/projectCallResolver.js';
import type {
  ExtractedFileFlowCallSite,
  FileFlowExtractionResult,
} from '../project-context/fileFlow/contracts.js';
import type { ExtractedFileSymbol } from '../project-context/fileSymbols/contracts.js';
import { extractFileSymbolsFromSource } from '../project-context/fileSymbols/extract.js';
import { normalizeFileSymbols } from '../project-context/fileSymbols/normalize.js';
import type { ProjectContextHandlerExecutionContext } from '../project-context/interface/contracts.js';
import { throwIfProjectContextAborted } from '../project-context/interface/execution.js';
import {
  JS_FAMILY_LANGUAGES,
  resolveAstParserLanguage,
} from '../project-context/shared/parserLanguage.js';
import { createProjectContextFileRef } from '../project-context/shared/sourceSlice-fileSymbols/index.js';
import type { SourceSliceFileFacts } from '../project-context/sourceSlice/contracts.js';
import { loadSourceSliceFile } from '../project-context/sourceSlice/fileAccess.js';
import type { CodeGraphProjectRunner } from './withCodeGraphAnalysis.js';

interface PreparedProject {
  result: Extract<CodeGraphProjectResult, { status: 'ready' }>;
  sources: Map<string, SourceSliceFileFacts>;
  targets: Map<
    string,
    { facts: SourceSliceFileFacts; symbol: ExtractedFileSymbol; defaultExport: boolean }
  >;
}

/** 捕获清单而非“查询过的文件”拥有项目图；每个reader/repo单独计算，Replay必定重新运行SDK。 */
export function createCapturedCodeGraphCallResolver(
  run: CodeGraphProjectRunner,
  runtimeRoot: string
): ProjectCallResolver {
  const projects = new WeakMap<ProjectSourceReader, Map<string, Promise<PreparedProject>>>();
  return async (facts, flow, context) => {
    const reader = context?.sourceReader;
    if (
      !reader ||
      flow.unavailableReason ||
      !flow.callSites.some((site) => importedBinding(site, flow))
    ) {
      return flow;
    }
    const view = await readProjectInputSnapshotView(reader);
    if (!view?.snapshot.sourceFiles) {
      Logger.debug(
        'CodeGraph retains file observations without a declared captured source catalog',
        { filePath: facts.filePath, mode: reader.mode }
      );
      return flow;
    }
    const canonical = await reader.realpath(facts.projectRoot, { signal: context?.signal });
    const roots = view.roots.filter(
      (root) => root.path === canonical && (!facts.repoId || root.id === facts.repoId)
    );
    if (roots.length !== 1) {
      return unavailable(flow, facts, 'Captured repository identity is ambiguous.');
    }
    const rootId = roots[0].id;
    const identity = projectSourceReaderIdentity(reader);
    let cache = projects.get(identity);
    if (!cache) {
      cache = new Map();
      projects.set(identity, cache);
    }
    let pending = cache.get(rootId);
    if (!pending) {
      pending = prepare(view, rootId, reader, facts, context, run, runtimeRoot);
      cache.set(rootId, pending);
    }
    try {
      const project = await pending;
      throwIfProjectContextAborted(context);
      // 图缓存命中也要向本次认证请求声明实际使用的全部源码版本。
      for (const source of project.sources.values()) {
        context?.onSourceFileVersion?.({
          projectRoot: facts.projectRoot,
          filePath: source.filePath,
          blobSha256: source.blobSha256,
        });
      }
      const sourceRecord = project.result.files.find((file) => file.filePath === facts.filePath);
      if (!sourceRecord || sourceRecord.ambiguous) {
        return flow;
      }
      let resolved = 0;
      const callSites = flow.callSites.map((site) => {
        const binding = importedBinding(site, flow);
        if (!binding || !site.matchingRange) {
          return site;
        }
        const candidates = project.result.bindings.filter(
          (binding) =>
            binding.filePath === facts.filePath &&
            binding.line === site.matchingRange!.startLine &&
            binding.column === site.matchingRange!.startColumn &&
            binding.resolvedBy === 'import' &&
            (binding.referenceKind === 'instantiates') === (site.syntaxKind === 'new') &&
            [
              site.callee,
              site.calleeExpression,
              site.receiver ? `${site.receiver}.${site.callee}` : undefined,
            ].includes(binding.referenceName)
        );
        const ids = [...new Set(candidates.map((candidate) => candidate.targetNodeId))];
        const target = ids.length === 1 ? project.targets.get(ids[0]) : undefined;
        if (!target || target.facts.filePath === facts.filePath) {
          return site;
        }
        // SDK 1.6把文件首个export function/class当作default候选；必须有同文本的default证明。
        // 无法证明的barrel/匿名default仍保留调用点unresolved，不自行重写SDK解析器去猜目标。
        if (
          (binding.imported === 'default' ||
            (binding.imported === '*' && site.callee === 'default')) &&
          !target.defaultExport
        ) {
          Logger.debug('CodeGraph rejected an unproven default import target', {
            filePath: facts.filePath,
            callee: site.callee,
            target: target.facts.filePath,
            symbol: target.symbol.name,
          });
          return site;
        }
        // 图中缓存声明事实；每次查询仍用当前导航/root别名投影，不能串用上次sourceFolder。
        const targetFacts = {
          ...target.facts,
          projectRoot: facts.projectRoot,
          repoId: facts.repoId,
          sourceFolder: facts.sourceFolder,
        };
        const summary = normalizeFileSymbols({
          facts: targetFacts,
          fileRef: createProjectContextFileRef(targetFacts),
          symbols: [target.symbol],
        }).symbols[0];
        if (!summary) {
          return site;
        }
        resolved++;
        return { ...site, resolvedTarget: summary };
      });
      Logger.debug('CodeGraph projected captured import call targets', {
        filePath: facts.filePath,
        repoId: rootId,
        resolved,
        observations: callSites.length,
        reader: reader.mode,
      });
      return { ...flow, callSites };
    } catch (error) {
      if (cache.get(rootId) === pending) {
        cache.delete(rootId);
      }
      throwIfProjectContextAborted(context);
      reader.assertComplete();
      return unavailable(flow, facts, error instanceof Error ? error.message : String(error));
    }
  };
}

function importedBinding(site: ExtractedFileFlowCallSite, flow: FileFlowExtractionResult) {
  const range = site.calleeBindingRange;
  if (!range || !site.matchingRange || !['call', 'new'].includes(site.syntaxKind ?? '')) {
    return undefined;
  }
  return flow.imports
    .flatMap((record) => record.bindings ?? [])
    .find(
      (binding) =>
        !binding.typeOnly &&
        sameRange(binding.range, range) &&
        (site.receiver
          ? binding.imported === '*' && site.receiver === binding.local
          : site.callee === binding.local)
    );
}

async function prepare(
  view: ProjectInputSnapshotView,
  rootId: string,
  reader: ProjectSourceReader,
  owner: SourceSliceFileFacts,
  context: ProjectContextHandlerExecutionContext | undefined,
  run: CodeGraphProjectRunner,
  runtimeRoot: string
): Promise<PreparedProject> {
  const catalog = view.snapshot.sourceFiles!.filter(
    (file) =>
      file.rootId === rootId &&
      JS_FAMILY_LANGUAGES.has(resolveAstParserLanguage(file.relativePath) ?? '')
  );
  if (catalog.length > 2000) {
    throw new Error('Captured CodeGraph input exceeds 2000 source files.');
  }
  const sources = new Map<string, SourceSliceFileFacts>();
  let bytes = 0;
  for (const file of catalog) {
    const result = await loadSourceSliceFile({
      filePath: file.relativePath,
      projectRoot: owner.projectRoot,
      repoId: owner.repoId,
      sourceFolder: owner.sourceFolder,
      sourceReader: reader,
      signal: context?.signal,
      analysis: context?.analysis,
      onSourceFileVersion: context?.onSourceFileVersion,
      onSourceFileRead: context?.onSourceFileRead,
    });
    if (!result.ok) {
      throw new Error(result.failure.message);
    }
    bytes += Buffer.byteLength(result.facts.text);
    if (bytes > 32 * 1024 * 1024) {
      throw new Error('Captured CodeGraph input exceeds 32 MiB.');
    }
    sources.set(file.relativePath, result.facts);
  }
  const logicalRoot = view.roots.find((root) => root.id === rootId)!.path;
  for (let round = 0; round < 64; round++) {
    throwIfProjectContextAborted(context);
    const current = await readProjectInputSnapshotView(reader);
    if (!current) {
      throw new Error('Captured input reader lost its snapshot capability.');
    }
    const git: CodeGraphGitObservation[] = [];
    for (const row of current.snapshot.observations.filter(
      (row) => row.operation === 'codegraph-git'
    )) {
      const absolute = path.resolve(
        current.roots.find((root) => root.id === row.path.rootId)!.path,
        row.path.relativePath
      );
      git.push(
        await reader.readConfiguration<CodeGraphGitObservation>('codegraph-git', absolute, () => {
          throw new Error('Captured Git input is unavailable');
        })
      );
    }
    const result = await run(
      {
        logicalRoot,
        roots: current.roots,
        snapshot: current.snapshot,
        files: [...sources.keys()],
        git,
      },
      { signal: context?.signal }
    );
    if (result.status === 'unavailable') {
      throw new Error(result.reason);
    }
    if (result.status === 'needs-input') {
      if (result.requests.length > 4096) {
        throw new Error('CodeGraph requested too many support inputs.');
      }
      Logger.debug('CodeGraph completes a captured input read set before publishing bindings', {
        repoId: rootId,
        round,
        requests: result.requests.length,
        mode: reader.mode,
      });
      for (const request of result.requests) {
        await fulfill(request, logicalRoot, current, reader, context, runtimeRoot);
      }
      continue;
    }
    if (result.errors.length) {
      throw new Error(`CodeGraph project extraction failed: ${result.errors[0]}`);
    }
    return { result, sources, targets: buildTargets(result, sources) };
  }
  throw new Error('CodeGraph input closure did not converge within 64 rounds.');
}

async function fulfill(
  request: CodeGraphInputRequest,
  root: string,
  view: ProjectInputSnapshotView,
  reader: ProjectSourceReader,
  context: ProjectContextHandlerExecutionContext | undefined,
  runtimeRoot: string
): Promise<void> {
  const absolute = path.resolve(root, request.relativePath);
  if (
    !view.roots.some((binding) => inside(absolute, binding.path)) ||
    inside(absolute, runtimeRoot)
  ) {
    throw new Error(
      'CodeGraph support input is outside the captured roots or belongs to its runtime.'
    );
  }
  try {
    const options = { signal: context?.signal };
    switch (request.operation) {
      case 'file':
        await reader.readFile(absolute, options);
        break;
      case 'directory':
        await reader.readDirectory(absolute, options);
        break;
      case 'stat':
        await reader.stat(absolute, options);
        break;
      case 'realpath':
        await reader.realpath(absolute, options);
        break;
      case 'git':
        await readCodeGraphGitInput(
          reader,
          {
            cwd: absolute,
            args: (request.args ?? []).map((arg) =>
              typeof arg === 'string' ? arg : path.resolve(absolute, arg.relative)
            ),
          },
          options
        );
        break;
    }
  } catch (error) {
    throwIfProjectContextAborted(context);
    reader.assertComplete();
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      !['ENOENT', 'ENOTDIR'].includes(String(error.code))
    ) {
      throw error;
    }
    // reader已记录真实不存在；下一轮Replay可以消费，未捕获错误绝不能走这个分支。
  }
}

function buildTargets(
  result: Extract<CodeGraphProjectResult, { status: 'ready' }>,
  sources: Map<string, SourceSliceFileFacts>
): PreparedProject['targets'] {
  const targets: PreparedProject['targets'] = new Map();
  for (const file of result.files) {
    const facts = sources.get(file.filePath);
    if (
      !facts ||
      file.ambiguous ||
      file.contentHash !== hashBytes(Buffer.from(facts.text)).slice(7)
    ) {
      continue;
    }
    const ast = readProjectContextAst(facts, false);
    const legacy = extractFileSymbolsFromSource(facts, ast);
    if (legacy.syntaxValid !== true || legacy.syntaxFeatures?.length || legacy.unavailableReason) {
      continue;
    }
    const extracted = normalizeCodeGraphSymbols(facts, { nodes: file.nodes, errors: [] }, legacy);
    if (extracted.unavailableReason) {
      continue;
    }
    for (const node of file.nodes) {
      const named = extracted.symbols.filter(
        (symbol) =>
          symbol.name === node.name &&
          (symbol.qualifiedName ?? symbol.name) === node.qualifiedName.replaceAll('::', '.')
      );
      const located = named.filter(
        (symbol) =>
          (symbol.matchingRange ?? symbol.declarationRange ?? symbol.range).startLine ===
          node.startLine
      );
      const candidates = located.length ? located : named;
      if (candidates.length !== 1) {
        continue;
      }
      const defaultExports =
        ast.status === 'ready'
          ? (ast.moduleSyntax?.exports.filter(
              (item) =>
                !item.specifier && (item.defaultDeclaration || item.exportedName === 'default')
            ) ?? [])
          : [];
      targets.set(node.id, {
        facts,
        symbol: candidates[0],
        defaultExport: defaultExports.length === 1 && defaultExports[0].name === candidates[0].name,
      });
    }
  }
  return targets;
}
function sameRange(
  a: { startLine: number; endLine: number; startColumn?: number; endColumn?: number },
  b: typeof a
): boolean {
  return (
    a.startLine === b.startLine &&
    a.endLine === b.endLine &&
    a.startColumn === b.startColumn &&
    a.endColumn === b.endColumn
  );
}
function inside(file: string, root: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}
function unavailable(
  flow: FileFlowExtractionResult,
  facts: SourceSliceFileFacts,
  reason: string
): FileFlowExtractionResult {
  Logger.warn('Captured CodeGraph call resolution is unavailable', {
    filePath: facts.filePath,
    reason,
  });
  return { ...flow, unavailableReason: `Captured CodeGraph calls unavailable: ${reason}` };
}
