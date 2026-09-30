import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPlugins } from '../src/core/ast/index.js';
import type { FileFlowContext, FileSymbolContext } from '../src/domain/project-context/index.js';
import { CodeGraphProcess } from '../src/infrastructure/analysis/CodeGraphProcess.js';
import { RecordingProjectSourceReader } from '../src/infrastructure/io/ProjectInputSnapshot.js';
import { ProjectContext } from '../src/project-context.js';
import { NodeProjectContextFoundationHostPorts } from '../src/projectContextFoundation.js';
import { normalizeCodeGraphFlow } from '../src/service/code-analysis/CodeGraphFlow.js';
import { withCodeGraphAnalysis } from '../src/service/code-analysis/withCodeGraphAnalysis.js';
import { readProjectContextAst } from '../src/service/project-context/analysis/astFacts.js';
import {
  getCodeGraphProjectContextIdentity,
  withCodeGraphProjectContextSession,
} from '../src/service/project-context/analysis/codeGraphSession.js';
import { extractFileFlowFromSource } from '../src/service/project-context/fileFlow/extract.js';
import { extractFileSymbolsFromSource } from '../src/service/project-context/fileSymbols/extract.js';
import { hashCanonicalJson } from '../src/shared/canonicalJson.js';
import { typeScriptAstPlugin } from '../src/test-fixtures.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(text: string | Record<string, string> = 'export class Input {}') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alembic-codegraph-test-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const dataRoot = path.join(root, 'data');
  await fs.mkdir(projectRoot, { recursive: true });
  const files = typeof text === 'string' ? { 'sample.ts': text } : text;
  for (const [file, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(projectRoot, file)), { recursive: true });
    await fs.writeFile(path.join(projectRoot, file), source);
  }
  return { root, projectRoot, dataRoot };
}

async function captureInputs(
  context: ConstructorParameters<typeof NodeProjectContextFoundationHostPorts>[0],
  projectRoot: string,
  files: Record<string, string>
) {
  const capture = await new NodeProjectContextFoundationHostPorts(context).createInputCapture({
    repositories: [{ repoId: 'repo', scopeId: 'repo', relativeRoot: '.', sourceRoot: projectRoot }],
    files: Object.entries(files).map(([relativePath, source]) => ({
      repoId: 'repo',
      relativePath,
      content: Buffer.from(source),
    })),
  });
  if (!capture) {
    throw new Error('Expected native capture');
  }
  return capture;
}

describe('CodeGraph ProjectContext production backend', () => {
  it.each([
    'cancel',
    'terminate',
  ] as const)('cleans up a project waiting for input and ignores its late response (%s)', async (action) => {
    const files = {
      'sample.ts': "import { target } from '@dep'; export function run() { target(); }",
      'dep.ts': 'export function target() {}',
    };
    const { projectRoot, dataRoot } = await fixture(files);
    await fs.writeFile(
      path.join(projectRoot, 'tsconfig.json'),
      '{"compilerOptions":{"baseUrl":".","paths":{"@dep":["dep.ts"]}}}'
    );
    const entered = Promise.withResolvers<CodeGraphProcess>();
    const release = Promise.withResolvers<void>();
    const late = Promise.withResolvers<void>();
    const original = CodeGraphProcess.prototype.analyzeProject;
    let held = false;
    vi.spyOn(CodeGraphProcess.prototype, 'analyzeProject').mockImplementation(function (
      this: CodeGraphProcess,
      input,
      signal,
      readInput
    ) {
      return original.call(this, input, signal, async (request, bridgeSignal) => {
        const outcome = await readInput!(request, bridgeSignal);
        if (!held && request.operation === 'file' && request.relativePath === 'tsconfig.json') {
          held = true;
          entered.resolve(this);
          // 故意忽略取消、延迟一个已取得的合法outcome，模拟无法及时停止的宿主读取。
          await release.promise;
          late.resolve();
        }
        return outcome;
      });
    });
    try {
      await withCodeGraphProjectContextSession({ dataRoot }, async (context) => {
        const capture = await captureInputs(context, projectRoot, files);
        const query = {
          kind: 'file-flow' as const,
          scope: { projectRoot, repoId: 'repo' },
          payload: { filePath: 'sample.ts' },
        };
        const controller = new AbortController();
        const pending = context.execute(query, {
          sourceReader: capture.reader,
          signal: controller.signal,
        });
        const worker = await entered.promise;
        if (action === 'cancel') {
          controller.abort();
          await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        } else {
          process.kill(worker.pid!, 'SIGKILL');
          expect((await pending).errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ code: 'query-unavailable' })])
          );
        }
        expect(() => process.kill(worker.pid!, 0)).toThrow();
        const healthy = await context.execute(query, { sourceReader: capture.reader });
        expect(healthy.errors ?? []).toEqual([]);
        expect((healthy.data as FileFlowContext).callers[0]).toMatchObject({
          unresolved: false,
          to: { filePath: 'dep.ts', symbol: 'target' },
        });
        release.resolve();
        await late.promise;
        expect(await context.execute(query, { sourceReader: capture.reader })).toEqual(healthy);
        await capture.verify();
      });
    } finally {
      release.resolve();
    }
    expect(await fs.readdir(path.join(dataRoot, '.asd/codegraph-sessions'))).toEqual([]);
  }, 30_000);

  it('reuses prepared input metadata without exporting blobs again while preserving source receipts', async () => {
    const files = {
      'sample.ts': "import { target } from './dep'; export function run() { target(); }",
      'dep.ts': 'export function target() {}',
      'unused.ts': 'export const unused = 1;',
    };
    const { projectRoot, dataRoot } = await fixture(files);
    const snapshots = vi.spyOn(RecordingProjectSourceReader.prototype, 'snapshot');
    await withCodeGraphProjectContextSession({ dataRoot }, async (context) => {
      const capture = await captureInputs(context, projectRoot, files);
      const query = {
        kind: 'file-flow' as const,
        scope: { projectRoot, repoId: 'repo' },
        payload: { filePath: 'sample.ts' },
      };
      const first = await context.execute(query, { sourceReader: capture.reader });
      expect(first.errors ?? []).toEqual([]);
      snapshots.mockClear();
      const used = new Set<string>();
      expect(
        await context.execute(query, {
          sourceReader: capture.reader,
          onSourceFileVersion: (version) => used.add(version.filePath),
        })
      ).toEqual(first);
      expect(used).toEqual(new Set(Object.keys(files)));
      expect(snapshots).not.toHaveBeenCalled();
    });
  });

  it('accepts a later declared catalog and still rejects invalidated cached inputs', async () => {
    const files = {
      'sample.ts': "import { target } from './dep'; export function run() { target(); }",
      'dep.ts': 'export function target() {}',
    };
    const fixtureRoots = await fixture(files);
    const projectRoot = await fs.realpath(fixtureRoots.projectRoot);
    const reader = new RecordingProjectSourceReader([{ id: 'repo', path: projectRoot }]);
    await expect(
      withCodeGraphProjectContextSession({ dataRoot: fixtureRoots.dataRoot }, async (context) => {
        const query = {
          kind: 'file-flow' as const,
          scope: { projectRoot, repoId: 'repo' },
          payload: { filePath: 'sample.ts' },
        };
        const before = await context.execute(query, { sourceReader: reader });
        expect((before.data as FileFlowContext).callers[0].unresolved).toBe(true);
        for (const [file, source] of Object.entries(files)) {
          await reader.seedFile(path.join(projectRoot, file), Buffer.from(source));
        }
        reader.declareSourceFiles(
          Object.keys(files).map((relativePath) => ({ rootId: 'repo', relativePath }))
        );
        const captured = await context.execute(query, { sourceReader: reader });
        expect(captured.errors ?? []).toEqual([]);
        expect((captured.data as FileFlowContext).callers[0].unresolved).toBe(false);
        expect(() => reader.declareSourceFiles([])).toThrow(
          expect.objectContaining({ code: 'PROJECT_SOURCE_INPUT_DRIFT' })
        );
        await expect(context.execute(query, { sourceReader: reader })).rejects.toMatchObject({
          code: 'PROJECT_SOURCE_INPUT_DRIFT',
        });
      })
    ).rejects.toMatchObject({ code: 'PROJECT_SOURCE_INPUT_DRIFT' });
  });

  it.each([
    'symbols-first',
    'calls-first',
  ] as const)('reuses only required declaration evidence in each captured view (%s)', async (order) => {
    const files: Record<string, string> = {
      'sample.ts': "import { target } from './dep'; export function run() { target(); target(); }",
      'dep.ts': 'export function target() {}',
      ...Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [
          `unused-${index}.ts`,
          `export function unused${index}() {}`,
        ])
      ),
    };
    const { projectRoot, dataRoot } = await fixture(files);
    const walk = vi.spyOn(typeScriptAstPlugin, 'walk');
    await withCodeGraphProjectContextSession({ dataRoot }, async (context) => {
      const capture = await captureInputs(context, projectRoot, files);
      const symbols = {
        kind: 'file-symbols' as const,
        scope: { projectRoot, repoId: 'repo' },
        payload: { filePath: 'dep.ts' },
      };
      const flow = { ...symbols, kind: 'file-flow' as const, payload: { filePath: 'sample.ts' } };
      const query = order === 'symbols-first' ? [symbols, flow] : [flow, symbols];
      const recorded = [];
      for (const request of query) {
        const result = await context.execute(request, { sourceReader: capture.reader });
        expect(result.errors ?? []).toEqual([]);
        recorded.push(result);
      }
      expect(walk).toHaveBeenCalledTimes(2);
      const snapshot = await capture.snapshot();
      await fs.rm(projectRoot, { recursive: true });
      const replay = capture.createReplay(snapshot);
      for (let index = 0; index < query.length; index++) {
        expect(await context.execute(query[index], { sourceReader: replay })).toEqual(
          recorded[index]
        );
      }
      expect(walk).toHaveBeenCalledTimes(4);
    });
  });

  it('keeps captured target ranges independent from publicly mutable refs', async () => {
    const files = {
      'sample.ts': "import { target } from './dep'; export function run() { target(); }",
      'dep.ts': 'export function target() {}',
    };
    const { projectRoot, dataRoot } = await fixture(files);
    await withCodeGraphProjectContextSession({ dataRoot }, async (context) => {
      const capture = await captureInputs(context, projectRoot, files);
      const query = {
        kind: 'file-flow' as const,
        scope: { projectRoot, repoId: 'repo' },
        payload: { filePath: 'sample.ts' },
      };
      const first = await context.execute(query, { sourceReader: capture.reader });
      expect(first.errors ?? []).toEqual([]);
      const pristine = structuredClone(first);
      const target = first.refs.find(
        (ref) => ref.kind === 'file-symbol' && ref.scope.filePath === 'dep.ts'
      );
      expect(target?.scope.range).toBeDefined();
      target!.scope.range!.startLine = 99;
      expect(await context.execute(query, { sourceReader: capture.reader })).toEqual(pristine);
    });
  });

  it('requires captured lexical import evidence and rejects collided SDK target identities', async () => {
    const files = {
      'sample.ts': [
        "import { target as alias } from './dep';",
        "import * as ns from './dep';",
        "import type { target as typeOnly } from './dep';",
        "import { type target as inlineType } from './dep';",
        "import { A } from './collision';",
        'export function real() { alias(); ns.target(); typeOnly(); inlineType(); new A(); }',
        'export function shadow(alias: Function, ns: { target(): void }) { alias(); ns.target(); }',
      ].join('\n'),
      'dep.ts': 'export function target() {}',
      'collision.ts': 'export class A { run() {} } export class B { run() {} }',
    };
    const { projectRoot, dataRoot } = await fixture(files);
    await withCodeGraphProjectContextSession({ dataRoot }, async (context) => {
      const capture = await captureInputs(context, projectRoot, files);
      const result = await context.execute(
        {
          kind: 'file-flow',
          scope: { projectRoot, repoId: 'repo' },
          payload: { filePath: 'sample.ts' },
        },
        { sourceReader: capture.reader }
      );
      expect(result.errors ?? []).toEqual([]);
      const calls = (result.data as FileFlowContext).callers;
      expect(calls).toHaveLength(7);
      expect(calls.filter((call) => !call.unresolved)).toHaveLength(2);
      expect(
        calls
          .filter((call) => !call.unresolved)
          .every((call) => call.to?.filePath === 'dep.ts' && call.to.symbol === 'target')
      ).toBe(true);
      expect(
        calls.filter((call) => call.from?.symbol === 'shadow').every((call) => call.unresolved)
      ).toBe(true);
    });
  }, 60_000);

  it('cancels captured project work and lets the healthy session retry from the same frozen reader', async () => {
    const files = {
      'sample.ts': "import { target } from './dep'; export function run() { target(); }",
      'dep.ts': 'export function target() {}',
    };
    const { projectRoot, dataRoot } = await fixture(files);
    const entered = Promise.withResolvers<CodeGraphProcess>();
    const original = CodeGraphProcess.prototype.analyzeProject;
    vi.spyOn(CodeGraphProcess.prototype, 'analyzeProject').mockImplementation(function (
      this: CodeGraphProcess,
      ...args
    ) {
      const pending = original.apply(this, args);
      entered.resolve(this);
      return pending;
    });
    await withCodeGraphProjectContextSession({ dataRoot }, async (context) => {
      const capture = await captureInputs(context, projectRoot, files);
      const query = {
        kind: 'file-flow' as const,
        scope: { projectRoot, repoId: 'repo' },
        payload: { filePath: 'sample.ts' },
      };
      const request = new AbortController();
      const pending = context.execute(query, {
        sourceReader: capture.reader,
        signal: request.signal,
      });
      const worker = await entered.promise;
      request.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(() => process.kill(worker.pid!, 0)).toThrow();
      const result = await context.execute(query, { sourceReader: capture.reader });
      expect(result.errors ?? []).toEqual([]);
      expect((result.data as FileFlowContext).callers[0]).toMatchObject({
        unresolved: false,
        to: { symbol: 'target', filePath: 'dep.ts' },
      });
    });
    expect(await fs.readdir(path.join(dataRoot, '.asd/codegraph-sessions'))).toEqual([]);
  }, 60_000);

  it('rejects the SDK default-import decoy while retaining proven default and named import targets', async () => {
    const files = {
      'sample.ts':
        "import invoke, { decoy as named } from './dep';\nimport valid from './valid';\nexport function run() { invoke(); named(); valid(); }",
      'dep.ts': 'export function decoy() {}\nexport default function actual() {}',
      'valid.ts': 'export default function valid() {}',
    };
    const { projectRoot, dataRoot } = await fixture(files);
    await withCodeGraphProjectContextSession({ dataRoot }, async (context) => {
      const capture = await captureInputs(context, projectRoot, files);
      const result = await context.execute(
        {
          kind: 'file-flow',
          scope: { projectRoot, repoId: 'repo' },
          payload: { filePath: 'sample.ts' },
        },
        { sourceReader: capture.reader }
      );
      expect(result.errors ?? []).toEqual([]);
      const calls = (result.data as FileFlowContext).callers;
      expect(calls.find((call) => call.to?.symbol === 'invoke')?.unresolved).toBe(true);
      expect(
        calls
          .filter((call) => !call.unresolved)
          .map((call) => call.to?.symbol)
          .sort()
      ).toEqual(['decoy', 'valid']);
    });
  }, 60_000);

  it('binds captured import aliases through the real SDK and recomputes them offline without changing call site refs', async () => {
    const text = "import { target as alias } from '@barrel';\nexport function run() { alias(); }";
    const files = {
      'sample.ts': text,
      'barrel.ts': "export { target } from './dep';",
      'dep.ts': 'export function target() { return 1; }',
    };
    const { projectRoot, dataRoot } = await fixture(files);
    await fs.mkdir(path.join(projectRoot, 'config'));
    await fs.writeFile(
      path.join(projectRoot, 'tsconfig.json'),
      '{"extends":["./missing-base.json","./config/base.json"]}'
    );
    await fs.writeFile(
      path.join(projectRoot, 'config/base.json'),
      JSON.stringify({
        compilerOptions: { baseUrl: '..', paths: { '@barrel': ['barrel.ts'] } },
        padding: '界'.repeat(800_000),
      })
    );
    execFileSync('git', ['init', '-q'], { cwd: projectRoot });
    const project = vi.spyOn(CodeGraphProcess.prototype, 'analyzeProject');
    await withCodeGraphProjectContextSession({ dataRoot }, async (context) => {
      const request = {
        kind: 'file-flow' as const,
        scope: { projectRoot, repoId: 'repo' },
        payload: { filePath: 'sample.ts' },
      };
      const live = await context.execute(request);
      const liveCall = (live.data as FileFlowContext).callers[0];
      expect(liveCall.unresolved).toBe(true);
      const capture = await captureInputs(context, projectRoot, files);
      const recorded = await context.execute(request, { sourceReader: capture.reader });
      expect(recorded.errors ?? []).toEqual([]);
      const call = (recorded.data as FileFlowContext).callers[0];
      expect(call).toMatchObject({
        unresolved: false,
        to: { filePath: 'dep.ts', symbol: 'target', ref: { kind: 'file-symbol' } },
      });
      expect(call.ref?.id).toBe(liveCall.ref?.id);
      const count = project.mock.calls.length;
      expect(count).toBe(1);
      const snapshot = await capture.snapshot();
      expect(snapshot.observations.some((row) => row.operation === 'codegraph-git')).toBe(true);
      const negatives = snapshot.observations.filter(
        (row) => row.path.relativePath === 'missing-base.json'
      );
      expect(negatives.length).toBeGreaterThan(0);
      expect(negatives.every((row) => !row.outcome.ok)).toBe(true);
      await capture.verify();
      await fs.rm(projectRoot, { recursive: true });
      const replay = capture.createReplay(snapshot);
      expect(await context.execute(request, { sourceReader: replay })).toEqual(recorded);
      replay.assertComplete();
      expect(project.mock.calls.length).toBe(count + 1);
      // SDK会吞掉不存在的extends；移除其负向事实后，外层仍必须锁存未捕获错误。
      const incomplete = structuredClone(snapshot);
      incomplete.observations = incomplete.observations.filter(
        (row) =>
          !negatives.some(
            (negative) =>
              negative.operation === row.operation &&
              negative.path.relativePath === row.path.relativePath
          )
      );
      const { snapshotHash: _hash, ...semantic } = incomplete;
      incomplete.snapshotHash = hashCanonicalJson({
        ...semantic,
        blobs: incomplete.blobs.map(({ hash, byteLength }) => ({ hash, byteLength })),
      });
      const missing = capture.createReplay(incomplete);
      await expect(
        withCodeGraphProjectContextSession({ dataRoot }, (offline) =>
          offline.execute(request, { sourceReader: missing })
        )
      ).rejects.toMatchObject({ code: 'PROJECT_SOURCE_INPUT_UNCAPTURED' });
      expect(() => missing.assertComplete()).toThrow();
    });
  }, 60_000);

  it('shares one actual SDK extraction across symbol and flow requests while preserving source call evidence', async () => {
    const input = [
      'function helper(value?: number) { return value; }',
      'export async function run(client: any) {',
      '  helper();',
      '  await (helper(/* comment */ 2));',
      '  client.send(1, "x");',
      '  const instance = new Client(/* comment */ 1);',
      '}',
    ].join('\n');
    const { projectRoot, dataRoot } = await fixture(input);
    const extract = vi.spyOn(CodeGraphProcess.prototype, 'extract');
    await withCodeGraphProjectContextSession({ dataRoot }, async (context) => {
      await context.execute({
        kind: 'file-symbols',
        scope: { projectRoot },
        payload: { filePath: 'sample.ts' },
      });
      const flow = await context.execute({
        kind: 'file-flow',
        scope: { projectRoot },
        payload: { filePath: 'sample.ts' },
      });
      expect(flow.errors ?? []).toEqual([]);
      expect((flow.data as FileFlowContext).callers).toHaveLength(4);
      expect(extract).toHaveBeenCalledTimes(1);
    });
    const result = await flowEvidence(input);
    expect(result.flow?.unavailableReason).toBeUndefined();
    expect(result.flow?.callSites.find((site) => site.range.startLine === 3)?.argCount).toBe(0);
    expect(result.flow?.callSites.find((site) => site.range.startLine === 4)).toMatchObject({
      argCount: 1,
      isAwait: true,
    });
    expect(result.flow?.callSites.find((site) => site.callee === 'send')).toMatchObject({
      receiver: 'client',
      argCount: 2,
    });
  });

  it('uses equivalent SDK reference multiplicity for nested chains and keeps distinct same-line occurrences', async () => {
    const input =
      'export function run() { factory().send(); foo().foo(); repeat(1); repeat(2, 3); }';
    const result = await flowEvidence(input);
    expect(result.flow?.unavailableReason).toBeUndefined();
    expect(result.flow?.callSites).toHaveLength(6);
    const nested = result.flow?.callSites.filter((site) => site.callee === 'foo');
    expect(nested).toHaveLength(2);
    expect(new Set(nested?.map((site) => site.matchingRange?.endColumn)).size).toBe(2);
    expect(
      result.flow?.callSites.filter((site) => site.callee === 'repeat').map((site) => site.argCount)
    ).toEqual([1, 2]);
  });

  it('keeps JSX as explicit syntax-backed compatibility and attributes callback calls to their own scope', async () => {
    const input = 'export function View() { return <Widget onClick={() => submit()} />; }';
    const result = await flowEvidence(input, 'sample.tsx');
    expect(result.flow?.unavailableReason).toBeUndefined();
    expect(result.flow?.callSites.find((site) => site.callee === 'Widget')).toMatchObject({
      syntaxKind: 'jsx',
    });
    expect(result.flow?.callSites.find((site) => site.callee === 'submit')?.callerMethod).not.toBe(
      'View'
    );
  });

  it('connects nested callers only when actual SDK symbols prove their own declaration ranges', async () => {
    const { projectRoot, dataRoot } = await fixture(
      [
        'function target() {}',
        'export function outer() {',
        '  function inner() { target(); }',
        '  (inner)();',
        '}',
      ].join('\n')
    );
    await withCodeGraphProjectContextSession({ dataRoot }, async (context) => {
      const result = await context.execute({
        kind: 'file-flow',
        scope: { projectRoot },
        payload: { filePath: 'sample.ts' },
      });
      expect(result.errors ?? []).toEqual([]);
      const calls = (result.data as FileFlowContext).callers;
      const inner = calls.find((call) => call.to?.symbol === 'target');
      expect(inner?.from).toMatchObject({
        qualifiedName: 'outer.inner',
        ref: { kind: 'file-symbol' },
      });
      expect(inner?.unresolved).toBe(false);
      const outer = calls.find((call) => call.to?.symbol === 'inner');
      expect(outer?.from).toMatchObject({ qualifiedName: 'outer', ref: { kind: 'file-symbol' } });
      expect(outer?.to?.ref).toEqual(inner?.from?.ref);
    });
  });

  it('refuses non-equivalent same-point SDK candidates rather than assigning by traversal order', async () => {
    const text = 'function run() { foo().foo(); }';
    const { dataRoot } = await fixture(text);
    const worker = await CodeGraphProcess.open({ dataRoot });
    try {
      const input = { text, filePath: 'sample.ts', lineCount: 1 };
      const ast = readProjectContextAst(input, true);
      const legacy = extractFileFlowFromSource(input, ast);
      const extracted = await worker.extract(input.filePath, text);
      if (!extracted.references?.[0]) {
        throw new Error('Missing real SDK call evidence');
      }
      extracted.references[0].evidenceHash = `sha256:${'0'.repeat(64)}`;
      const result = normalizeCodeGraphFlow(input, extracted, legacy);
      expect(result.callSites).toEqual([]);
      expect(result.unavailableReason).toContain('could not be matched');
    } finally {
      await worker.close();
    }
  });

  it('preserves syntax-proven literal receiver observations that the SDK deliberately omits', async () => {
    const input = [
      'function includes() {}',
      'export function run(values: string[]) {',
      "  ['x'].includes('x');",
      "  /x/.test('x');",
      "  'x'.trim();",
      '  `x`.trim();',
      "  values.includes('x');",
      '}',
    ].join('\n');
    const result = await flowEvidence(input);
    expect(result.flow?.unavailableReason).toBeUndefined();
    expect(result.flow?.callSites).toHaveLength(5);
    const { projectRoot, dataRoot } = await fixture(input);
    await withCodeGraphProjectContextSession({ dataRoot }, async (context) => {
      const flow = await context.execute({
        kind: 'file-flow',
        scope: { projectRoot },
        payload: { filePath: 'sample.ts' },
      });
      expect(flow.errors ?? []).toEqual([]);
      const calls = (flow.data as FileFlowContext).callers;
      expect(calls).toHaveLength(5);
      expect(calls.every((call) => call.unresolved && !call.to?.ref)).toBe(true);
    });
  });
  it('transports real call candidates, including repeated points, without converting them to resolved edges', async () => {
    const input = 'function run() { foo(1); foo(2, 3); foo().foo(); }';
    const { dataRoot } = await fixture(input);
    const worker = await CodeGraphProcess.open({ dataRoot });
    try {
      const result = await worker.extract('sample.ts', input);
      expect(result.references).toHaveLength(4);
      expect(result.references?.map((ref) => ref.referenceKind)).toEqual([
        'calls',
        'calls',
        'calls',
        'calls',
      ]);
      const repeated = result.references?.filter(
        (ref) => ref.column === input.indexOf('foo().foo')
      );
      expect(repeated).toHaveLength(2);
      expect(new Set(repeated?.map((ref) => ref.evidenceHash)).size).toBe(1);
      expect(result.references?.every((ref) => ref.evidenceHash.startsWith('sha256:'))).toBe(true);
    } finally {
      await worker.close();
    }
  });
  it.each([
    ['ts', 'const'],
    ['ts', 'let'],
    ['ts', 'var'],
    ['js', 'const'],
    ['js', 'let'],
    ['js', 'var'],
  ])(
    'retains actual %s %s arrow binding evidence apart from the compatible display range',
    async (extension, keyword) => {
      const declaration = `/* 汉😀 */ export ${keyword} handler =`;
      const initializer = '  (value) => value;';
      const text = `${declaration}\r\n${initializer}\r\n`;
      const result = await declarationEvidence(text, `binding.${extension}`);
      expect(result.unavailableReason).toBeUndefined();
      expect(result.symbols).toEqual([
        expect.objectContaining({
          name: 'handler',
          kind: 'function',
          declarationKind: keyword,
          range: { startLine: 1, endLine: 1 },
          matchingRange: {
            startLine: 2,
            startColumn: 2,
            endLine: 2,
            endColumn: initializer.length - 1,
          },
          declarationRange: {
            startLine: 1,
            startColumn: declaration.indexOf('handler'),
            endLine: 2,
            endColumn: initializer.length - 1,
          },
        }),
      ]);
    },
    30_000
  );

  it('retains SDK-only variable and type declaration evidence without guessing let versus var', async () => {
    const result = await declarationEvidence(
      [
        'const fixed = 1;',
        'let mutable = 2;',
        'var classic = 3;',
        'export enum State { Ready }',
        'export interface Shape { value: string }',
      ].join('\r\n'),
      'declarations.ts'
    );
    expect(result.unavailableReason).toBeUndefined();
    for (const [name, declarationKind, line, column, endColumn] of [
      ['fixed', 'constant', 1, 6, 15],
      ['mutable', 'variable', 2, 4, 15],
      ['classic', 'variable', 3, 4, 15],
      ['State', 'enum', 4, 7, 27],
      ['Shape', 'interface', 5, 7, 40],
    ] as const) {
      expect(result.symbols.find((symbol) => symbol.name === name)).toMatchObject({
        declarationKind,
        declarationRange: { startLine: line, endLine: line, startColumn: column, endColumn },
      });
    }
  }, 30_000);

  it('carries true declaration ranges for proven SDK compatibility supplements', async () => {
    const declaration = 'export declare class Ambient { run(value: string): void; }';
    const constructorText = 'export class Service { constructor(public name: string) {} }';
    const result = await declarationEvidence(
      `${declaration}\n${constructorText}`,
      'supplements.ts'
    );
    expect(result.unavailableReason).toBeUndefined();
    expect(result.symbols.find((symbol) => symbol.qualifiedName === 'Ambient.run')).toMatchObject({
      declarationKind: 'method',
      // method_signature的真实grammar节点不包含尾部分号。
      declarationRange: {
        startLine: 1,
        endLine: 1,
        startColumn: declaration.indexOf('run('),
        endColumn: declaration.indexOf(';'),
      },
    });
    expect(result.symbols.find((symbol) => symbol.qualifiedName === 'Service.name')).toMatchObject({
      declarationKind: 'property',
      declarationRange: {
        startLine: 2,
        endLine: 2,
        startColumn: constructorText.indexOf('public name'),
        endColumn: constructorText.indexOf(')'),
      },
    });
    const javascript = 'class Example { constructor() { this.state = 1; } }';
    const jsResult = await declarationEvidence(javascript, 'supplement.js');
    expect(
      jsResult.symbols.find((symbol) => symbol.qualifiedName === 'Example.state')
    ).toMatchObject({
      declarationKind: 'property',
      declarationRange: {
        startLine: 1,
        endLine: 1,
        startColumn: javascript.indexOf('this.state'),
        endColumn: javascript.indexOf(';') + 1,
      },
    });
  }, 30_000);

  it('extracts supplied text repeatedly and closes the actual SDK process and scratch', async () => {
    const input = await fixture('export class DiskOnly {}');
    const process = await CodeGraphProcess.open({ dataRoot: input.dataRoot });
    const pid = process.pid;
    try {
      const first = await process.extract('sample.ts', 'export class InputB {}');
      const second = await process.extract('sample.ts', 'export class InputC {}');
      expect(first.nodes.some((node) => node.name === 'InputB')).toBe(true);
      expect(second.nodes.some((node) => node.name === 'InputC')).toBe(true);
      expect(second.nodes.some((node) => node.name === 'InputB' || node.name === 'DiskOnly')).toBe(
        false
      );
      expect(process.identity).toEqual(await getCodeGraphProjectContextIdentity());
      expect(await fs.readFile(path.join(input.projectRoot, 'sample.ts'), 'utf8')).toContain(
        'DiskOnly'
      );
      expect(await fs.readdir(input.projectRoot)).toEqual(['sample.ts']);
    } finally {
      await process.close();
      await process.close();
    }
    expect(await fs.readdir(process.runtimeRoot)).toEqual([]);
    expect(() => globalThis.process.kill(pid!, 0)).toThrow();
  }, 30_000);

  it('keeps colliding SDK node ids distinct and supplements actual missing declarations', async () => {
    const input = await fixture(
      [
        'export class A { run() {} } export class B { run() {} }',
        'export declare class Ambient { run(value: string): void; }',
        'export class Service { constructor(public name: string) {} field = () => 1; }',
        'function internal() {}',
        'export { internal as published };',
      ].join('\n')
    );
    let runtimeRoot = '';
    await withCodeGraphProjectContextSession(
      { dataRoot: input.dataRoot },
      async (context, runtime) => {
        runtimeRoot = runtime.runtimeRoot;
        const result = await context.execute({
          kind: 'file-symbols',
          scope: { projectRoot: input.projectRoot },
          payload: { filePath: 'sample.ts' },
        });
        expect(result.errors).toBeUndefined();
        const symbols = (result.data as FileSymbolContext).symbols;
        expect(
          symbols.filter((symbol) => symbol.name === 'run').map((symbol) => symbol.qualifiedName)
        ).toEqual(['A.run', 'B.run', 'Ambient.run']);
        expect(
          new Set(symbols.filter((symbol) => symbol.name === 'run').map((symbol) => symbol.ref!.id))
            .size
        ).toBe(3);
        expect(symbols).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ qualifiedName: 'Service.name', kind: 'property' }),
            expect.objectContaining({ qualifiedName: 'Service.field', kind: 'property' }),
            expect.objectContaining({ qualifiedName: 'Service.constructor', kind: 'constructor' }),
            expect.objectContaining({ name: 'internal', exported: true }),
          ])
        );
        const ports = new NodeProjectContextFoundationHostPorts(context);
        const capture = await ports.createInputCapture({
          repositories: [
            { repoId: 'test', scopeId: 'test', relativeRoot: '.', sourceRoot: input.projectRoot },
          ],
          files: [],
        });
        expect(capture).toBeDefined();
      }
    );
    expect(await fs.readdir(runtimeRoot)).toEqual([]);
  }, 30_000);

  it('does not certify malformed source as a successful empty symbol result', async () => {
    const input = await fixture('export function broken( {\nconst survivor = 1;');
    await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
      const result = await context.execute({
        kind: 'file-symbols',
        scope: { projectRoot: input.projectRoot },
        payload: { filePath: 'sample.ts' },
      });
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'query-unavailable',
            message: expect.stringContaining('syntax'),
          }),
        ])
      );
    });
  }, 30_000);

  it.each([
    ['anonymous default class', 'export default class { run() {} }'],
    ['anonymous default function', 'export default function (value: string) { return value; }'],
    ['namespace', 'export namespace Models { export class Box {} }'],
  ])(
    'reports explicit coverage unavailability for %s',
    async (_shape, text) => {
      const input = await fixture(text);
      await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
        const result = await context.execute({
          kind: 'file-symbols',
          scope: { projectRoot: input.projectRoot },
          payload: { filePath: 'sample.ts' },
        });
        expect(result.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: 'query-unavailable',
              message: expect.stringContaining('coverage unavailable'),
            }),
          ])
        );
      });
    },
    30_000
  );

  it('keeps same-line accessors distinct with UTF16 columns and stable non-colliding refs', async () => {
    const text =
      '/* 汉😀 */ export class Box { get value() { return 1; } set value(input: number) {} ordinary() {} }\r\n';
    const input = await fixture(text);
    await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
      const request = {
        kind: 'file-symbols' as const,
        scope: { projectRoot: input.projectRoot },
        payload: { filePath: 'sample.ts' },
      };
      const legacy = await ProjectContext.execute(request);
      const result = await context.execute(request);
      expect(result.errors).toBeUndefined();
      const symbols = (result.data as FileSymbolContext).symbols;
      const accessors = symbols.filter((symbol) => symbol.qualifiedName === 'Box.value');
      expect(accessors).toHaveLength(2);
      expect(accessors.map((symbol) => symbol.range)).toEqual([
        {
          startLine: 1,
          endLine: 1,
          startColumn: text.indexOf('get value'),
          endColumn: text.indexOf('} set') + 1,
        },
        {
          startLine: 1,
          endLine: 1,
          startColumn: text.indexOf('set value'),
          endColumn: text.indexOf('{} ordinary') + 2,
        },
      ]);
      expect(new Set(accessors.map((symbol) => symbol.ref!.id)).size).toBe(2);
      expect(new Set(accessors.map((symbol) => symbol.ref!.parentRef)).size).toBe(2);
      for (const qualifiedName of ['Box', 'Box.ordinary']) {
        const symbol = symbols.find((symbol) => symbol.qualifiedName === qualifiedName)!;
        const previous = (legacy.data as FileSymbolContext).symbols.find(
          (symbol) => symbol.qualifiedName === qualifiedName
        )!;
        expect(symbol.ref!.id).toBe(previous.ref!.id);
        expect(symbol.range).toEqual(previous.range);
        expect(symbol.range!.startColumn).toBeUndefined();
      }
      const repeated = await context.execute(request);
      expect((repeated.data as FileSymbolContext).symbols.map((symbol) => symbol.ref!.id)).toEqual(
        symbols.map((symbol) => symbol.ref!.id)
      );
    });
  }, 30_000);

  it.each([
    'ts',
    'js',
  ])('maps a multiline %s arrow declaration once without changing its existing ref', async (extension) => {
    const input = await fixture();
    const filePath = `arrow.${extension}`;
    await fs.writeFile(
      path.join(input.projectRoot, filePath),
      'export const handler =\r\n  (\r\n    value\r\n  ) => value;\r\n'
    );
    await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
      const request = {
        kind: 'file-symbols' as const,
        scope: { projectRoot: input.projectRoot },
        payload: { filePath },
      };
      const previous = await ProjectContext.execute(request);
      const result = await context.execute(request);
      expect(result.errors).toBeUndefined();
      const symbols = (result.data as FileSymbolContext).symbols.filter(
        (symbol) => symbol.name === 'handler'
      );
      expect(symbols).toHaveLength(1);
      expect(symbols[0].ref!.id).toBe(
        (previous.data as FileSymbolContext).symbols.find((symbol) => symbol.name === 'handler')
          ?.ref?.id
      );
    });
  }, 30_000);

  it('uses the real SDK for all NodeNext TS and JS suffixes', async () => {
    const input = await fixture();
    const suffixes = ['mts', 'cts', 'mjs', 'cjs'];
    for (const suffix of suffixes) {
      await fs.writeFile(
        path.join(input.projectRoot, `module.${suffix}`),
        '/* 汉😀 */ const sdkConstant = 1;\r\n'
      );
    }
    await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
      for (const suffix of suffixes) {
        const result = await context.execute({
          kind: 'file-symbols',
          scope: { projectRoot: input.projectRoot },
          payload: { filePath: `module.${suffix}` },
        });
        expect(result.errors, suffix).toBeUndefined();
        expect((result.data as FileSymbolContext).symbols, suffix).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'sdkConstant',
              kind: 'variable',
              filePath: `module.${suffix}`,
              range: { startLine: 1, endLine: 1 },
            }),
          ])
        );
      }
    });
  }, 30_000);

  it('matches a multiline arrow with complex generic type annotations to its existing declaration', async () => {
    const input = await fixture(
      'export const project: <T extends { value: string; nested?: { count: number } }>(input: T) => T =\r\n  (input) => input;\r\n'
    );
    await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
      const request = {
        kind: 'file-symbols' as const,
        scope: { projectRoot: input.projectRoot },
        payload: { filePath: 'sample.ts' },
      };
      const previous = await ProjectContext.execute(request);
      const result = await context.execute(request);
      expect(result.errors).toBeUndefined();
      const symbols = (result.data as FileSymbolContext).symbols.filter(
        (symbol) => symbol.name === 'project'
      );
      expect(symbols).toHaveLength(1);
      expect(symbols[0].ref!.id).toBe((previous.data as FileSymbolContext).symbols[0].ref!.id);
    });
  }, 30_000);

  it('replaces a private-method placeholder without consuming a real method named unknown', async () => {
    const input = await fixture(
      'export class Cache { #read() { return 1; } unknown() { return this.#read(); } }'
    );
    await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
      const result = await context.execute({
        kind: 'file-symbols',
        scope: { projectRoot: input.projectRoot },
        payload: { filePath: 'sample.ts' },
      });
      expect(result.errors).toBeUndefined();
      const symbols = (result.data as FileSymbolContext).symbols;
      expect(
        symbols.filter((symbol) => symbol.kind === 'method').map((symbol) => symbol.qualifiedName)
      ).toEqual(['Cache.#read', 'Cache.unknown']);
      expect(JSON.stringify(result)).not.toContain('nameIsPlaceholder');
      expect(JSON.stringify(result)).not.toContain('matchingRange');
      expect(JSON.stringify(result)).not.toContain('declarationKind');
      expect(JSON.stringify(result)).not.toContain('declarationRange');
    });
  }, 30_000);

  it('reports a coverage gap if a real SDK response loses ordinary declarations', async () => {
    const input = await fixture('export class MustComeFromSdk {}');
    const original = CodeGraphProcess.prototype.extract;
    const extract = vi
      .spyOn(CodeGraphProcess.prototype, 'extract')
      .mockImplementation(async function (this: CodeGraphProcess, ...args) {
        const result = await original.apply(this, args);
        expect(result.nodes.some((node) => node.name === 'MustComeFromSdk')).toBe(true);
        // 真SDK调用后的显式故障注入：不能以全量legacy补回掩盖后端丢失主声明。
        return { ...result, nodes: result.nodes.filter((node) => node.kind === 'file') };
      });
    await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
      const result = await context.execute({
        kind: 'file-symbols',
        scope: { projectRoot: input.projectRoot },
        payload: { filePath: 'sample.ts' },
      });
      expect(extract).toHaveBeenCalledTimes(1);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'query-unavailable',
            message: expect.stringContaining('coverage'),
          }),
        ])
      );
    });
  }, 30_000);

  it('cleans a real process initialization that exceeds its one-millisecond deadline', async () => {
    const input = await fixture();
    await expect(
      CodeGraphProcess.open({ dataRoot: input.dataRoot, timeoutMs: 1 })
    ).rejects.toMatchObject({ code: 'CODEGRAPH_TIMEOUT' });
    expect(await fs.readdir(path.join(input.dataRoot, '.asd', 'codegraph-sessions'))).toEqual([]);
  }, 30_000);

  it('preserves a JavaScript constructor assignment with explicit legacy provenance', async () => {
    const input = await fixture();
    await fs.writeFile(
      path.join(input.projectRoot, 'assignment.js'),
      'class Example { constructor() { this.state = 1; } }'
    );
    await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
      const result = await context.execute({
        kind: 'file-symbols',
        scope: { projectRoot: input.projectRoot },
        payload: { filePath: 'assignment.js' },
      });
      expect(result.errors).toBeUndefined();
      const symbols = (result.data as FileSymbolContext).symbols;
      expect(symbols).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ qualifiedName: 'Example.state', kind: 'property' }),
        ])
      );
      expect(JSON.stringify(result)).not.toContain('compatibilitySource');
    });
  }, 30_000);

  it('rejects an owner cancellation inside an otherwise successful callback without a query', async () => {
    const input = await fixture();
    const controller = new AbortController();
    let runtimeRoot = '';
    await expect(
      withCodeGraphProjectContextSession(
        { dataRoot: input.dataRoot, signal: controller.signal },
        async (_context, runtime) => {
          runtimeRoot = runtime.runtimeRoot;
          controller.abort(new Error('owner stopped an empty collection'));
          return 'must not become success';
        }
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(runtimeRoot).not.toBe('');
    expect(await fs.readdir(runtimeRoot)).toEqual([]);
  }, 30_000);

  it('closes the actual worker when the owning session callback throws', async () => {
    const input = await fixture();
    let worker: CodeGraphProcess | undefined;
    const original = CodeGraphProcess.prototype.extract;
    vi.spyOn(CodeGraphProcess.prototype, 'extract').mockImplementation(function (
      this: CodeGraphProcess,
      ...args
    ) {
      worker = this;
      return original.apply(this, args);
    });
    const failure = new Error('collection callback failed');
    await expect(
      withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
        await context.execute({
          kind: 'file-symbols',
          scope: { projectRoot: input.projectRoot },
          payload: { filePath: 'sample.ts' },
        });
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(worker).toBeDefined();
    expect(() => globalThis.process.kill(worker!.pid!, 0)).toThrow();
    expect(await fs.readdir(worker!.runtimeRoot)).toEqual([]);
  }, 30_000);

  it('cancels an in-flight query signal and waits for actual worker cleanup', async () => {
    const input = await fixture();
    const entered = Promise.withResolvers<CodeGraphProcess>();
    const original = CodeGraphProcess.prototype.extract;
    vi.spyOn(CodeGraphProcess.prototype, 'extract').mockImplementation(function (
      this: CodeGraphProcess,
      ...args
    ) {
      const result = original.apply(this, args);
      entered.resolve(this);
      return result;
    });
    let worker: CodeGraphProcess | undefined;
    await withCodeGraphProjectContextSession({ dataRoot: input.dataRoot }, async (context) => {
      const controller = new AbortController();
      const pending = context.execute(
        {
          kind: 'file-symbols',
          scope: { projectRoot: input.projectRoot },
          payload: { filePath: 'sample.ts' },
        },
        { signal: controller.signal }
      );
      worker = await entered.promise;
      controller.abort(new Error('query cancelled'));
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });
    expect(() => globalThis.process.kill(worker!.pid!, 0)).toThrow();
    expect(await fs.readdir(worker!.runtimeRoot)).toEqual([]);
  }, 30_000);

  it('cancels its real process, waits for exit, and cleans scratch when the owner aborts', async () => {
    const input = await fixture();
    const controller = new AbortController();
    const process = await CodeGraphProcess.open({
      dataRoot: input.dataRoot,
      signal: controller.signal,
    });
    const pid = process.pid;
    controller.abort(new Error('owner cancelled'));
    await expect(process.extract('sample.ts', 'export class Cancelled {}')).rejects.toMatchObject({
      name: 'AbortError',
    });
    await process.close();
    expect(() => globalThis.process.kill(pid!, 0)).toThrow();
    expect(await fs.readdir(process.runtimeRoot)).toEqual([]);
  }, 30_000);

  it.skipIf(process.platform === 'win32')(
    'reopens after a request cancellation without poisoning the healthy owner or next file',
    async () => {
      const input = await fixture('export class First {}');
      await fs.writeFile(path.join(input.projectRoot, 'healthy.ts'), 'export class Second {}');
      const owner = new AbortController();
      const request = new AbortController();
      const entered = Promise.withResolvers<void>();
      const workers: CodeGraphProcess[] = [];
      const originalOpen = CodeGraphProcess.open.bind(CodeGraphProcess);
      const originalExtract = CodeGraphProcess.prototype.extract;
      vi.spyOn(CodeGraphProcess, 'open').mockImplementation(async (options) => {
        const worker = await originalOpen(options);
        workers.push(worker);
        return worker;
      });
      vi.spyOn(CodeGraphProcess.prototype, 'extract').mockImplementation(function (
        this: CodeGraphProcess,
        filePath,
        source,
        signal
      ) {
        if (filePath === 'sample.ts') {
          // 暂停真实进程保证首个IPC仍在途；不替换SDK结果或取消/退出实现。
          globalThis.process.kill(this.pid!, 'SIGSTOP');
          const pending = originalExtract.call(this, filePath, source, signal);
          entered.resolve();
          return pending;
        }
        return originalExtract.call(this, filePath, source, signal);
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await withCodeGraphProjectContextSession(
          { dataRoot: input.dataRoot, signal: owner.signal },
          async (context, runtime) => {
            const first = context.execute(
              {
                kind: 'file-symbols',
                scope: { projectRoot: input.projectRoot },
                payload: { filePath: 'sample.ts' },
              },
              { signal: request.signal }
            );
            await Promise.race([
              entered.promise,
              new Promise<never>((_resolve, reject) => {
                timer = setTimeout(
                  () => reject(new Error('The first SDK request did not start.')),
                  5000
                );
              }),
            ]);
            clearTimeout(timer);
            request.abort(new Error('one repo deadline elapsed'));
            await expect(first).rejects.toMatchObject({ name: 'AbortError' });
            expect(owner.signal.aborted).toBe(false);
            const second = await context.execute({
              kind: 'file-symbols',
              scope: { projectRoot: input.projectRoot },
              payload: { filePath: 'healthy.ts' },
            });
            expect(second.errors).toBeUndefined();
            expect((second.data as FileSymbolContext).symbols).toContainEqual(
              expect.objectContaining({ name: 'Second' })
            );
            expect(workers).toHaveLength(2);
            expect(workers[1].identity.engineHash).toBe(runtime.engineHash);
            expect(workers[1].pid).not.toBe(workers[0].pid);
            expect(() => globalThis.process.kill(workers[0].pid!, 0)).toThrow();
          }
        );
        for (const worker of workers) {
          expect(() => globalThis.process.kill(worker.pid!, 0)).toThrow();
        }
        expect(await fs.readdir(path.join(input.dataRoot, '.asd', 'codegraph-sessions'))).toEqual(
          []
        );
      } finally {
        clearTimeout(timer);
        await Promise.all(workers.map((worker) => worker.close(true)));
      }
    },
    30_000
  );

  it('does not publish success when the owner cancels during final worker close', async () => {
    const input = await fixture();
    const owner = new AbortController();
    const originalClose = CodeGraphProcess.prototype.close;
    let closingWorker: CodeGraphProcess | undefined;
    let callbackReturned = false;
    vi.spyOn(CodeGraphProcess.prototype, 'close').mockImplementation(function (
      this: CodeGraphProcess,
      force
    ) {
      const firstClose = closingWorker === undefined;
      closingWorker = this;
      const pending = originalClose.call(this, force);
      if (firstClose) {
        expect(callbackReturned).toBe(true);
        owner.abort(new Error('owner cancelled during worker cleanup'));
      }
      return pending;
    });
    await expect(
      withCodeGraphProjectContextSession(
        { dataRoot: input.dataRoot, signal: owner.signal },
        async () => {
          callbackReturned = true;
          return 'not a completed owner scope';
        }
      )
    ).rejects.toMatchObject({
      name: 'AbortError',
      message: 'owner cancelled during worker cleanup',
    });
    expect(closingWorker).toBeDefined();
    expect(() => globalThis.process.kill(closingWorker!.pid!, 0)).toThrow();
    expect(await fs.readdir(closingWorker!.runtimeRoot)).toEqual([]);
  }, 30_000);

  it('rejects a terminated worker instead of hanging or silently falling back', async () => {
    const input = await fixture();
    const process = await CodeGraphProcess.open({ dataRoot: input.dataRoot });
    globalThis.process.kill(process.pid!, 'SIGKILL');
    try {
      await expect(
        process.extract('sample.ts', 'export class MissingWorker {}')
      ).rejects.toMatchObject({ code: expect.stringMatching(/^CODEGRAPH_/) });
    } finally {
      await process.close();
    }
    expect(await fs.readdir(process.runtimeRoot)).toEqual([]);
  }, 30_000);
});

async function declarationEvidence(text: string, filePath: string) {
  const { dataRoot } = await fixture();
  await loadPlugins();
  const input = { text, filePath, lineCount: text.split(/\r\n|\n|\r/).length };
  const ast = readProjectContextAst(input, false);
  const legacy = extractFileSymbolsFromSource(input, ast);
  return withCodeGraphAnalysis({ dataRoot }, (extractor) =>
    extractor.extractSymbols(input, legacy)
  );
}

async function flowEvidence(text: string, filePath = 'sample.ts') {
  await loadPlugins();
  const { dataRoot } = await fixture(text);
  return withCodeGraphAnalysis({ dataRoot }, async (backend) => {
    const input = { text, filePath, lineCount: text.split(/\r\n|\n|\r/).length };
    const ast = readProjectContextAst(input, true);
    if (!backend.analyzeFile) {
      throw new Error('CodeGraph must provide complete file analysis');
    }
    return backend.analyzeFile(input, {
      symbols: extractFileSymbolsFromSource(input, ast),
      flow: extractFileFlowFromSource(input, ast),
    });
  });
}
