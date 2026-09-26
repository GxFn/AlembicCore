import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  FileFlowContext,
  ProjectContextUnavailableData,
  SourceSliceContext,
} from '../src/domain/project-context/index.js';
import { ProjectContext } from '../src/project-context.js';
import { computeContentHash } from '../src/shared/contentHash.js';

describe('ProjectContext PCQ-3 file-flow', () => {
  it('does not bind an unknown receiver to a same-name local function', async () => {
    const source = [
      'function target() {}',
      'export function run(client: { target(): void }) {',
      '  client.target();',
      '  target();',
      '}',
    ].join('\n');
    await withFixture({ 'src/example.ts': source }, async (projectRoot) => {
      const { data } = await ProjectContext.execute({
        kind: 'file-flow',
        payload: { filePath: 'src/example.ts' },
        scope: { projectRoot },
      });
      const calls = (data as FileFlowContext).callees;
      const unknown = calls.find((relation) => relation.range?.startLine === 3);
      expect(unknown).toMatchObject({
        unresolved: true,
        reason: expect.stringContaining('receiver'),
      });
      expect(unknown?.to?.ref).toBeUndefined();
      const local = calls.find((relation) => relation.range?.startLine === 4);
      expect(local).toMatchObject({
        unresolved: false,
        from: { qualifiedName: 'run' },
        to: { qualifiedName: 'target', ref: { scope: { range: { startLine: 1 } } } },
        range: { startLine: 4, endLine: 4 },
      });
      expect(local?.range?.startColumn).toBeUndefined();
      expect(local?.ref?.id).toContain(':L4-L4:');
    });
  });

  it('does not give a nested ordinary function the lexical this binding of an arrow', async () => {
    const source = [
      'export class Worker {',
      '  target() {}',
      '  run() {',
      '    function dynamic() { this.target(); }',
      '    const lexical = () => this.target();',
      '  }',
      '}',
    ].join('\n');
    await withFixture({ 'src/example.ts': source }, async (projectRoot) => {
      const { data } = await ProjectContext.execute({
        kind: 'file-flow',
        payload: { filePath: 'src/example.ts' },
        scope: { projectRoot },
      });
      const calls = (data as FileFlowContext).callees;
      const dynamic = calls.find((relation) => relation.range?.startLine === 4);
      expect(dynamic).toMatchObject({
        unresolved: true,
        reason: expect.stringContaining('receiver'),
      });
      expect(dynamic?.to?.ref).toBeUndefined();
      const lexical = calls.find((relation) => relation.range?.startLine === 5);
      expect(lexical?.to).toMatchObject({
        qualifiedName: 'Worker.target',
        ref: { scope: { range: { startLine: 2 } } },
      });
    });
  });

  it('does not fall back from a missing this member to a global function', async () => {
    await withFixture(
      {
        'src/example.ts': 'function target() {}\nexport class Worker { run() { this.target(); } }',
      },
      async (projectRoot) => {
        const { data } = await ProjectContext.execute({
          kind: 'file-flow',
          payload: { filePath: 'src/example.ts' },
          scope: { projectRoot },
        });
        const call = (data as FileFlowContext).callees.find(
          (relation) => relation.range?.startLine === 2
        );
        expect(call).toMatchObject({ unresolved: true, reason: 'callee-unresolved' });
        expect(call?.to?.ref).toBeUndefined();
      }
    );
  });

  it('does not bind a shadowing parameter to the same-name global function', async () => {
    await withFixture(
      {
        'src/example.ts':
          'function target() {}\nexport function run(target: () => void) {\n  target();\n}',
      },
      async (projectRoot) => {
        const { data } = await ProjectContext.execute({
          kind: 'file-flow',
          payload: { filePath: 'src/example.ts' },
          scope: { projectRoot },
        });
        const call = (data as FileFlowContext).callees.find(
          (relation) => relation.range?.startLine === 3
        );
        expect(call).toMatchObject({ unresolved: true, reason: expect.stringContaining('shadow') });
        expect(call?.to?.ref).toBeUndefined();
      }
    );
  });

  it('uses the real owner range for same-name nested callers', async () => {
    const source = [
      'function left() {',
      '  function same() {',
      '    target();',
      '  }',
      '}',
      'function right() {',
      '  function same() {',
      '    target();',
      '  }',
      '}',
      'function target() {}',
    ].join('\n');
    await withFixture({ 'src/example.ts': source }, async (projectRoot) => {
      const { data } = await ProjectContext.execute({
        kind: 'file-flow',
        payload: { filePath: 'src/example.ts' },
        scope: { projectRoot },
      });
      const calls = (data as FileFlowContext).callers.filter(
        (relation) => relation.to?.label === 'target'
      );
      expect(calls).toHaveLength(2);
      // standard符号表尚无nested声明；真实owner名称可保留，但不能借outer ref冒充。
      expect(calls.find((relation) => relation.range?.startLine === 3)?.from?.label).toBe(
        'left.same'
      );
      expect(calls.find((relation) => relation.range?.startLine === 8)?.from?.label).toBe(
        'right.same'
      );
      for (const call of calls) {
        expect(call).toMatchObject({ unresolved: true, reason: 'caller-unresolved' });
        expect(call.from?.ref).toBeUndefined();
      }
    });
  });

  it('leaves multiple local declaration candidates unresolved instead of selecting the first', async () => {
    await withFixture(
      {
        'src/example.js':
          'function target() { return 1; }\nfunction target() { return 2; }\nfunction run() { target(); }',
      },
      async (projectRoot) => {
        const { data } = await ProjectContext.execute({
          kind: 'file-flow',
          payload: { filePath: 'src/example.js' },
          scope: { projectRoot },
        });
        const call = (data as FileFlowContext).callees.find(
          (relation) => relation.range?.startLine === 3
        );
        expect(call).toMatchObject({
          unresolved: true,
          reason: expect.stringContaining('ambiguous'),
        });
        expect(call?.to?.ref).toBeUndefined();
      }
    );
  });

  it('keeps distinct same-line call sites with their real matching columns', async () => {
    await withFixture(
      {
        'src/example.ts':
          'function target() {}\nexport function run() { target(); target();\n  target();\n}',
      },
      async (projectRoot) => {
        const { data } = await ProjectContext.execute({
          kind: 'file-flow',
          payload: { filePath: 'src/example.ts' },
          scope: { projectRoot },
        });
        const calls = (data as FileFlowContext).callees.filter(
          (relation) => relation.range?.startLine === 2
        );
        expect(calls).toHaveLength(2);
        expect(new Set(calls.map((relation) => relation.ref?.id)).size).toBe(2);
        const columns = calls.map((relation) => relation.range?.startColumn);
        expect(columns.every((column) => typeof column === 'number')).toBe(true);
        expect(columns[0]).toBeLessThan(columns[1]);
        const ordinary = (data as FileFlowContext).callees.find(
          (relation) => relation.range?.startLine === 3
        );
        expect(ordinary?.range).toEqual({ startLine: 3, endLine: 3 });
        expect(ordinary?.ref?.id).toContain(':L3-L3:');
        for (const call of calls) {
          expect(call.sourceRef?.scope.range).toEqual(call.range);
          expect(call.ref?.scope.range).toEqual(call.range);
        }
      }
    );
  });

  it('uses the existing file ref for a proven top-level program caller', async () => {
    await withFixture(
      { 'src/example.ts': 'function target() {}\ntarget();' },
      async (projectRoot) => {
        const { data } = await ProjectContext.execute({
          kind: 'file-flow',
          payload: { filePath: 'src/example.ts' },
          scope: { projectRoot },
        });
        const flow = data as FileFlowContext;
        const call = flow.callees.find((relation) => relation.range?.startLine === 2);
        expect(call).toMatchObject({
          unresolved: false,
          from: { filePath: 'src/example.ts', ref: flow.file.ref },
          to: { qualifiedName: 'target' },
        });
        expect(call?.from?.symbol).toBeUndefined();
      }
    );
  });

  it('does not project block-comment examples as public exports', async () => {
    await withFixture(
      { 'src/example.ts': '/*\nexport const phantom = 1;\n*/\nexport const real = 2;\n' },
      async (projectRoot) => {
        const { data } = await ProjectContext.execute({
          kind: 'file-flow',
          payload: { filePath: 'src/example.ts' },
          scope: { projectRoot },
        });
        expect(
          (data as FileFlowContext).outflow
            .filter((relation) => relation.kind === 'exports')
            .map((relation) => relation.from?.symbol)
        ).toEqual(['real']);
      }
    );
  });

  it('binds a caller to its own class before considering another same-name method', async () => {
    await withFixture(
      {
        'src/example.ts': [
          'export class First { run() { return 1; } }',
          'export class Second {',
          '  run() { this.helper(); }',
          '  helper() {}',
          '}',
        ].join('\n'),
      },
      async (projectRoot) => {
        const { data } = await ProjectContext.execute({
          kind: 'file-flow',
          payload: { filePath: 'src/example.ts' },
          scope: { projectRoot },
        });
        const call = (data as FileFlowContext).callers.find(
          (relation) => relation.to?.label === 'Second.helper'
        );
        expect(call?.from).toMatchObject({
          label: 'Second.run',
          qualifiedName: 'Second.run',
          ref: { scope: { range: { startLine: 3 } } },
        });
      }
    );
  });

  it('returns TypeScript imports, exports, calls, relation refs, and source-slice drill-down', async () => {
    const source = [
      "import type { WorkerPort } from './ports';",
      "import { helper as runHelper } from './helpers';",
      "import './side-effect';",
      "import { nodeNextHelper } from './node-next-helper.js';",
      "import { MissingThing } from './missing';",
      '',
      'export interface ServicePort {',
      '  run(input: string): Promise<void>;',
      '}',
      'export class WorkerService implements ServicePort {',
      '  async run(input: string): Promise<void> {',
      '    runHelper(input);',
      '    this.helper(input);',
      '  }',
      '  private helper(input: string): void {',
      '    runHelper(input);',
      '  }',
      '}',
      'export function createWorker(): WorkerService {',
      '  return new WorkerService({} as WorkerPort);',
      '}',
    ].join('\n');

    await withFixture(
      {
        'src/example.ts': source,
        'src/helpers.ts': 'export function helper(input: string): string { return input; }',
        'src/node-next-helper.ts':
          'export function nodeNextHelper(input: string): string { return input; }',
        'src/ports.ts': 'export interface WorkerPort {}',
        'src/side-effect.ts': 'export const loaded = true;',
      },
      async (projectRoot) => {
        const envelope = await ProjectContext.execute({
          kind: 'file-flow',
          payload: { filePath: 'src/example.ts' },
          scope: { projectRoot, repoId: 'core' },
        });
        const data = envelope.data as FileFlowContext;

        expect(envelope.queryLevel).toBe('file-flow');
        expect(data.file).toMatchObject({
          filePath: 'src/example.ts',
          hash: computeContentHash(source),
          language: 'typescript',
          lineCount: 21,
          repoId: 'core',
        });
        expect(data.imports.map((relation) => relation.to?.label)).toEqual([
          'src/ports.ts',
          'src/helpers.ts',
          'src/side-effect.ts',
          'src/node-next-helper.ts',
          './missing',
        ]);
        expect(
          data.imports.find((relation) => relation.to?.label === 'src/node-next-helper.ts')
        ).toMatchObject({
          kind: 'imports',
          unresolved: false,
        });
        expect(data.imports.find((relation) => relation.to?.label === './missing')).toMatchObject({
          kind: 'imports',
          reason: 'not-found',
          unresolved: true,
        });
        expect(envelope.errors).toContainEqual(
          expect.objectContaining({
            code: 'query-unavailable',
            message: 'file-flow import target was not found: ./missing',
            severity: 'warning',
          })
        );
        expect(envelope.errors).not.toContainEqual(
          expect.objectContaining({
            message: 'file-flow import target was not found: ./node-next-helper.js',
          })
        );

        expect(data.exports.map((symbol) => symbol.qualifiedName ?? symbol.name)).toEqual([
          'ServicePort',
          'WorkerService',
          'createWorker',
        ]);
        expect(data.callers).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              from: expect.objectContaining({ label: 'WorkerService.run' }),
              kind: 'calls',
              to: expect.objectContaining({ label: 'WorkerService.helper' }),
            }),
            expect.objectContaining({
              from: expect.objectContaining({
                label: 'createWorker',
                ref: expect.objectContaining({
                  scope: expect.objectContaining({
                    range: expect.objectContaining({ startLine: 19 }),
                  }),
                }),
              }),
              kind: 'calls',
              to: expect.objectContaining({
                label: 'WorkerService',
                ref: expect.objectContaining({
                  scope: expect.objectContaining({
                    range: expect.objectContaining({ startLine: 10 }),
                  }),
                }),
              }),
            }),
          ])
        );
        expect(data.callees.map((relation) => relation.to?.label)).toContain(
          'WorkerService.helper'
        );
        expect(data.inflow.map((relation) => relation.to?.label)).toContain('WorkerService.helper');
        expect(data.outflow.map((relation) => relation.kind)).toEqual(
          expect.arrayContaining(['imports', 'exports', 'calls'])
        );
        expect(data.nextRefs.some((ref) => ref.kind === 'relation-site')).toBe(true);

        const helperImport = data.imports.find(
          (relation) => relation.to?.label === 'src/helpers.ts'
        );
        if (!helperImport?.ref) {
          throw new Error('Expected helper import relation ref.');
        }

        const drillDown = await ProjectContext.execute({
          kind: 'source-slice',
          payload: { includeText: true, ref: helperImport.ref },
          scope: { projectRoot, repoId: 'core' },
        });

        expect(drillDown.errors).toBeUndefined();
        expect((drillDown.data as SourceSliceContext).text).toBe(
          "import { helper as runHelper } from './helpers';"
        );
      }
    );
  });

  it('stays deterministic for equivalent file-flow requests', async () => {
    const source = [
      "import { helper } from './helpers';",
      'export function run(): string {',
      '  return helper();',
      '}',
    ].join('\n');

    await withFixture(
      {
        'src/example.ts': source,
        'src/helpers.ts': 'export function helper(): string { return "ok"; }',
      },
      async (projectRoot) => {
        const left = await ProjectContext.execute({
          kind: 'file-flow',
          payload: { filePath: 'src/example.ts' },
          scope: { projectRoot },
        });
        const fileRef = left.refs.find((ref) => ref.kind === 'file');
        if (!fileRef) {
          throw new Error('Expected file ref from file-flow result.');
        }
        const right = await ProjectContext.execute({
          kind: 'file-flow',
          payload: { ref: fileRef },
          scope: { projectRoot },
        });

        expect(left).toStrictEqual(right);
      }
    );
  });

  it('ignores comment examples while preserving real dynamic imports', async () => {
    const source = [
      "// Example only: const fake = await import('./commented');",
      "/* Example only: const ignored = require('./blocked'); */",
      'const literal = "import(\'./string-only\')";',
      'export async function loadLazy(): Promise<string> {',
      "  const mod = await import('./lazy');",
      "  return literal + ':' + mod.lazy;",
      '}',
    ].join('\n');

    await withFixture(
      {
        'src/dynamic.ts': source,
        'src/lazy.ts': 'export const lazy = "loaded";',
      },
      async (projectRoot) => {
        const envelope = await ProjectContext.execute({
          kind: 'file-flow',
          payload: { filePath: 'src/dynamic.ts' },
          scope: { projectRoot, repoId: 'core' },
        });
        const data = envelope.data as FileFlowContext;

        expect(data.imports.map((relation) => relation.to?.label)).toEqual(['src/lazy.ts']);
        expect(data.exports.map((symbol) => symbol.qualifiedName ?? symbol.name)).toEqual([
          'loadLazy',
        ]);
        expect(data.outflow.map((relation) => relation.kind)).toEqual(
          expect.arrayContaining(['imports', 'exports'])
        );
        expect(envelope.errors).toBeUndefined();
      }
    );
  });

  it('returns ordinary query errors without inventing flow facts for unsupported or missing files', async () => {
    await withFixture({ 'README.md': '# Notes\n\nNo parser here.' }, async (projectRoot) => {
      const unsupported = await ProjectContext.execute({
        kind: 'file-flow',
        payload: { filePath: 'README.md' },
        scope: { projectRoot },
      });
      const missing = await ProjectContext.execute({
        kind: 'file-flow',
        payload: { filePath: 'src/missing.ts' },
        scope: { projectRoot },
      });

      expect(unsupported.errors?.[0]).toMatchObject({
        code: 'query-unavailable',
        severity: 'warning',
      });
      expect((unsupported.data as FileFlowContext).imports).toEqual([]);
      expect((unsupported.data as FileFlowContext).exports).toEqual([]);
      expect((unsupported.data as FileFlowContext).callers).toEqual([]);
      expect(missing.errors?.[0]?.code).toBe('not-found');
      expect((missing.data as ProjectContextUnavailableData).available).toBe(false);
    });
  });
});

async function withFixture(
  files: Record<string, string>,
  callback: (projectRoot: string) => Promise<void>
): Promise<void> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-context-file-flow-'));
  try {
    for (const [filePath, content] of Object.entries(files)) {
      const absolutePath = path.join(projectRoot, filePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf8');
    }
    await callback(projectRoot);
  } finally {
    await fs.rm(projectRoot, { force: true, recursive: true });
  }
}
