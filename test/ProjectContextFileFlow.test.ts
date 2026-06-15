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
              from: expect.objectContaining({ label: 'createWorker' }),
              kind: 'calls',
              to: expect.objectContaining({ label: 'WorkerService' }),
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
