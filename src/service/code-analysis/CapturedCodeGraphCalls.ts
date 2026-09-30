import path from 'node:path';
import type {
  CodeGraphInputOutcome,
  CodeGraphInputRequest,
} from '../../infrastructure/analysis/CodeGraphProjectContract.js';
import {
  type CodeGraphGitObservation,
  readCodeGraphGitInput,
} from '../../infrastructure/io/CodeGraphGitInput.js';
import { readCodeGraphInputView } from '../../infrastructure/io/CodeGraphInputView.js';
import {
  type ProjectInputPath,
  type ProjectInputSnapshotView,
  readProjectInputSnapshotView,
} from '../../infrastructure/io/ProjectInputSnapshot.js';
import { projectSourceReaderIdentity } from '../../infrastructure/io/ProjectSourceReader.js';
import Logger from '../../infrastructure/logging/Logger.js';
import type {
  ProjectSourceDirectoryEntry,
  ProjectSourceReader,
} from '../../types/projectSourceReader.js';
import type { ProjectCallResolver } from '../project-context/analysis/projectCallResolver.js';
import type {
  ExtractedFileFlowCallSite,
  ExtractedFileFlowImport,
  FileFlowExtractionResult,
} from '../project-context/fileFlow/contracts.js';
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
import { CapturedCodeGraphIndex } from './CapturedCodeGraphIndex.js';
import type { CodeGraphProjectRunner } from './withCodeGraphAnalysis.js';

interface PreparedProject {
  sources: Map<string, SourceSliceFileFacts>;
  index: CapturedCodeGraphIndex;
}
interface CapturedProjectMetadata {
  roots: ProjectInputSnapshotView['roots'];
  sourceFiles: ProjectInputPath[];
}

/** 捕获清单而非“查询过的文件”拥有项目图；每个reader/repo单独计算，Replay必定重新运行SDK。 */
export function createCapturedCodeGraphCallResolver(
  run: CodeGraphProjectRunner,
  runtimeRoot: string
): ProjectCallResolver {
  const projects = new WeakMap<ProjectSourceReader, Map<string, Promise<PreparedProject>>>();
  const catalogs = new WeakMap<ProjectSourceReader, CapturedProjectMetadata>();
  return async (facts, flow, context) => {
    const reader = context?.sourceReader;
    if (!reader || flow.unavailableReason) {
      return flow;
    }
    const imports = flow.imports.flatMap((record) => record.bindings ?? []);
    if (!flow.callSites.some((site) => importedBinding(site, imports))) {
      return flow;
    }
    throwIfProjectContextAborted(context);
    reader.assertComplete();
    const identity = projectSourceReaderIdentity(reader);
    let metadata = catalogs.get(identity);
    if (!metadata) {
      const view = await readProjectInputSnapshotView(reader);
      if (!view?.snapshot.sourceFiles) {
        // Recording可在之后首次声明清单，不能永久缓存“无清单”。
        Logger.debug(
          'CodeGraph retains file observations without a declared captured source catalog',
          { filePath: facts.filePath, mode: reader.mode }
        );
        return flow;
      }
      // roots/已声明清单不可变；热查询无需重新base64编码、排序、hash和clone全部字节。
      // 新的支持输入经同一reader按需记录；这里只缓存清单，不把它当作封闭读集。
      metadata = { roots: view.roots, sourceFiles: view.snapshot.sourceFiles };
      catalogs.set(identity, metadata);
    }
    const canonical = await reader.realpath(facts.projectRoot, { signal: context?.signal });
    const roots = metadata.roots.filter(
      (root) => root.path === canonical && (!facts.repoId || root.id === facts.repoId)
    );
    if (roots.length !== 1) {
      return unavailable(flow, facts, 'Captured repository identity is ambiguous.');
    }
    const rootId = roots[0].id;
    let cache = projects.get(identity);
    if (!cache) {
      cache = new Map();
      projects.set(identity, cache);
    }
    let pending = cache.get(rootId);
    if (!pending) {
      pending = prepare(metadata, rootId, reader, facts, context, run, runtimeRoot);
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
      if (!project.index.allowsSource(facts.filePath)) {
        return flow;
      }
      let resolved = 0;
      const callSites = flow.callSites.map((site) => {
        const binding = importedBinding(site, imports);
        if (!binding || !site.matchingRange) {
          return site;
        }
        const candidates = project.index
          .candidates(facts.filePath, site.matchingRange.startLine, site.matchingRange.startColumn!)
          .filter(
            (binding) =>
              (binding.referenceKind === 'instantiates') === (site.syntaxKind === 'new') &&
              [
                site.callee,
                site.calleeExpression,
                site.receiver ? `${site.receiver}.${site.callee}` : undefined,
              ].includes(binding.referenceName)
          );
        const ids = [...new Set(candidates.map((candidate) => candidate.targetNodeId))];
        const target = ids.length === 1 ? project.index.target(ids[0], context) : undefined;
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
          // 公开ref会复用range对象；不能把缓存声明暴露给可变的调用方。
          symbols: [structuredClone(target.symbol)],
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

function importedBinding(
  site: ExtractedFileFlowCallSite,
  imports: NonNullable<ExtractedFileFlowImport['bindings']>
) {
  const range = site.calleeBindingRange;
  if (!range || !site.matchingRange || !['call', 'new'].includes(site.syntaxKind ?? '')) {
    return undefined;
  }
  return imports.find(
    (binding) =>
      !binding.typeOnly &&
      sameRange(binding.range, range) &&
      (site.receiver
        ? binding.imported === '*' && site.receiver === binding.local
        : site.callee === binding.local)
  );
}

async function prepare(
  metadata: CapturedProjectMetadata,
  rootId: string,
  reader: ProjectSourceReader,
  owner: SourceSliceFileFacts,
  context: ProjectContextHandlerExecutionContext | undefined,
  run: CodeGraphProjectRunner,
  runtimeRoot: string
): Promise<PreparedProject> {
  const catalog = metadata.sourceFiles.filter(
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
  const logicalRoot = metadata.roots.find((root) => root.id === rootId)!.path;
  throwIfProjectContextAborted(context);
  const current = await readProjectInputSnapshotView(reader);
  if (!current) {
    throw new Error('Captured input reader lost its snapshot capability.');
  }
  const policy = await readCodeGraphInputView(
    reader,
    current,
    logicalRoot,
    runtimeRoot,
    context?.signal
  );
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
      excludedDirectories: policy.excludedDirectories,
    },
    {
      signal: context?.signal,
      readInput: async (request, signal) => {
        const effective = context?.signal ? AbortSignal.any([context.signal, signal]) : signal;
        const outcome = await readInput(
          request,
          logicalRoot,
          current,
          reader,
          effective,
          runtimeRoot,
          policy.excludedDirectories
        );
        reader.assertComplete();
        throwIfProjectContextAborted({ signal: effective });
        return outcome;
      },
    }
  );
  if (result.status === 'unavailable') {
    throw new Error(result.reason);
  }
  if (result.errors.length) {
    throw new Error(`CodeGraph project extraction failed: ${result.errors[0]}`);
  }
  reader.assertComplete();
  Logger.debug('CodeGraph completed a captured project without rebuilding for missing inputs', {
    repoId: rootId,
    mode: reader.mode,
    files: sources.size,
  });
  return { sources, index: new CapturedCodeGraphIndex(result, sources) };
}

async function readInput(
  request: CodeGraphInputRequest,
  root: string,
  view: ProjectInputSnapshotView,
  reader: ProjectSourceReader,
  signal: AbortSignal,
  runtimeRoot: string,
  excludedDirectories: string[]
): Promise<CodeGraphInputOutcome> {
  throwIfProjectContextAborted({ signal });
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
    const options = { signal };
    switch (request.operation) {
      case 'file':
        return {
          ok: true,
          value: Buffer.from(await reader.readFile(absolute, options)).toString('base64'),
        };
      case 'directory':
        return {
          ok: true,
          value: (await reader.readDirectory(absolute, options)).map((entry) => ({
            name: entry.name,
            kind: entryKind(entry),
          })),
        };
      case 'stat': {
        const value = await reader.stat(absolute, options);
        return { ok: true, value: { kind: entryKind(value), mode: value.mode, size: value.size } };
      }
      case 'realpath':
        return { ok: true, value: await reader.realpath(absolute, options) };
      case 'git':
        return {
          ok: true,
          value: await readCodeGraphGitInput(
            reader,
            {
              cwd: absolute,
              args: (request.args ?? []).map((arg) =>
                typeof arg === 'string' ? arg : path.resolve(absolute, arg.relative)
              ),
              ...(excludedDirectories.length ? { excludedDirectories } : {}),
            },
            options
          ),
        };
    }
  } catch (error) {
    throwIfProjectContextAborted({ signal });
    reader.assertComplete();
    if (
      request.operation === 'git' ||
      !(error instanceof Error) ||
      !('code' in error) ||
      !['ENOENT', 'ENOTDIR'].includes(String(error.code))
    ) {
      throw error;
    }
    // 仅reader实际记录的不存在进入SDK；Replay缺口和Git程序缺失都不能冒充模块不存在。
    Logger.debug('CodeGraph consumed a captured negative input', {
      operation: request.operation,
      relativePath: request.relativePath,
      code: error.code,
    });
    return { ok: false, code: String(error.code) as 'ENOENT' | 'ENOTDIR' };
  }
}

function entryKind(
  value: Pick<ProjectSourceDirectoryEntry, 'isFile' | 'isDirectory' | 'isSymbolicLink'>
): string {
  return value.isFile()
    ? 'file'
    : value.isDirectory()
      ? 'directory'
      : value.isSymbolicLink()
        ? 'symlink'
        : 'other';
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
