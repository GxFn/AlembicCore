import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  AnchorRangeContext,
  FileFlowContext,
  FileSymbolContext,
  ProjectContextUnavailableData,
  SourceSliceContext,
} from '../src/domain/project-context/index.js';
import { ProjectContext } from '../src/project-context.js';
import { computeContentHash } from '../src/shared/contentHash.js';

describe('ProjectContext PCQ-4 anchor-range', () => {
  it('returns bounded local context for a file-line anchor', async () => {
    const source = createFixtureSource();

    await withFixture(createFixtureFiles(source), async (projectRoot) => {
      const envelope = await ProjectContext.execute({
        kind: 'anchor-range',
        payload: {
          afterLines: 2,
          beforeLines: 1,
          filePath: 'src/example.ts',
          line: 10,
          relationHops: 1,
        },
        scope: { projectRoot, repoId: 'core' },
      });
      const data = envelope.data as AnchorRangeContext;

      expect(envelope.errors).toBeUndefined();
      expect(data.anchor).toMatchObject({
        filePath: 'src/example.ts',
        kind: 'file-line',
        line: 10,
        range: { endLine: 10, startLine: 10 },
      });
      expect(data.file).toMatchObject({
        filePath: 'src/example.ts',
        hash: computeContentHash(source),
        language: 'typescript',
        lineCount: 18,
        repoId: 'core',
      });
      expect(data.radius).toEqual({ afterLines: 2, beforeLines: 1, relationHops: 1 });
      expect(data.range).toEqual({ endLine: 12, startLine: 9 });
      expect(data.symbols.map((symbol) => symbol.qualifiedName ?? symbol.name)).toEqual(
        expect.arrayContaining(['WorkerService', 'WorkerService.run'])
      );
      expect(data.relationSites.map((relation) => relation.to?.label)).toEqual(
        expect.arrayContaining(['runHelper', 'WorkerService.helper'])
      );
      expectOnlySourceSliceRefs(data);
      expect(data.relatedRefs.some((ref) => ref.kind === 'file-symbol')).toBe(true);
      expect(data.containingRefs.some((ref) => ref.kind === 'file')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'source-slice')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'file-symbol')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'relation-site')).toBe(true);
    });
  });

  it('resolves source range, symbol ref, relation-site ref, and source-slice ref anchors', async () => {
    const source = createFixtureSource();

    await withFixture(createFixtureFiles(source), async (projectRoot) => {
      const sourceRange = await ProjectContext.execute({
        kind: 'anchor-range',
        payload: {
          filePath: 'src/example.ts',
          radius: { afterLines: 1, beforeLines: 1, relationHops: 0 },
          range: { endLine: 14, startLine: 14 },
        },
        scope: { projectRoot, repoId: 'core' },
      });
      const sourceRangeData = sourceRange.data as AnchorRangeContext;
      expect(sourceRangeData.range).toEqual({
        endLine: 15,
        startLine: 13,
      });
      expectOnlySourceSliceRefs(sourceRangeData);

      const fileSymbols = await ProjectContext.execute({
        kind: 'file-symbols',
        payload: { filePath: 'src/example.ts' },
        scope: { projectRoot, repoId: 'core' },
      });
      const helperSymbolRef = (fileSymbols.data as FileSymbolContext).symbols.find(
        (symbol) => symbol.qualifiedName === 'WorkerService.helper'
      )?.ref;
      if (!helperSymbolRef) {
        throw new Error('Expected WorkerService.helper symbol ref.');
      }
      const fromSymbol = await ProjectContext.execute({
        kind: 'anchor-range',
        payload: { radius: { afterLines: 0, beforeLines: 0 }, ref: helperSymbolRef },
        scope: { projectRoot, repoId: 'core' },
      });
      const fromSymbolData = fromSymbol.data as AnchorRangeContext;
      expect(fromSymbol.errors).toBeUndefined();
      expect(fromSymbolData.anchor.kind).toBe('symbol-ref');
      expect(fromSymbolData.symbols.map((symbol) => symbol.name)).toContain('helper');
      expectOnlySourceSliceRefs(fromSymbolData);
      expect(fromSymbolData.nextRefs.some((ref) => ref.kind === 'file-symbol')).toBe(true);

      const fileFlow = await ProjectContext.execute({
        kind: 'file-flow',
        payload: { filePath: 'src/example.ts' },
        scope: { projectRoot, repoId: 'core' },
      });
      const helperImportRef = (fileFlow.data as FileFlowContext).imports.find(
        (relation) => relation.to?.label === 'src/helpers.ts'
      )?.ref;
      if (!helperImportRef) {
        throw new Error('Expected helper import relation-site ref.');
      }
      const fromRelation = await ProjectContext.execute({
        kind: 'anchor-range',
        payload: { afterLines: 0, beforeLines: 0, ref: helperImportRef },
        scope: { projectRoot, repoId: 'core' },
      });
      const fromRelationData = fromRelation.data as AnchorRangeContext;
      expect(fromRelationData.anchor.kind).toBe('relation-site-ref');
      expect(fromRelationData.relationSites).toContainEqual(
        expect.objectContaining({
          kind: 'imports',
          to: expect.objectContaining({ label: 'src/helpers.ts' }),
        })
      );
      expectOnlySourceSliceRefs(fromRelationData);
      expect(fromRelationData.nextRefs.some((ref) => ref.kind === 'relation-site')).toBe(true);

      const sourceSlice = await ProjectContext.execute({
        kind: 'source-slice',
        payload: {
          filePath: 'src/example.ts',
          range: { endLine: 18, startLine: 18 },
        },
        scope: { projectRoot, repoId: 'core' },
      });
      const sourceSliceRef = sourceSlice.refs.find((ref) => ref.kind === 'source-slice');
      if (!sourceSliceRef) {
        throw new Error('Expected source-slice ref.');
      }
      const fromSourceSlice = await ProjectContext.execute({
        kind: 'anchor-range',
        payload: { ref: sourceSliceRef },
        scope: { projectRoot, repoId: 'core' },
      });
      const fromSourceSliceData = fromSourceSlice.data as AnchorRangeContext;
      expect(fromSourceSliceData.anchor.kind).toBe('source-slice-ref');
      expect(fromSourceSliceData.symbols.map((symbol) => symbol.name)).toContain('createWorker');
      expectOnlySourceSliceRefs(fromSourceSliceData);
    });
  });

  it('returns drill-down refs and stays deterministic for equivalent requests', async () => {
    const source = createFixtureSource();

    await withFixture(createFixtureFiles(source), async (projectRoot) => {
      const left = await ProjectContext.execute({
        kind: 'anchor-range',
        payload: {
          filePath: 'src/example.ts',
          line: 10,
          radius: { afterLines: 2, beforeLines: 1, relationHops: 1 },
        },
        scope: { projectRoot },
      });
      const right = await ProjectContext.execute({
        kind: 'anchor-range',
        payload: {
          radius: { relationHops: 1, beforeLines: 1, afterLines: 2 },
          line: 10,
          filePath: 'src/example.ts',
        },
        scope: { projectRoot },
      });

      expect(left).toStrictEqual(right);

      const nextSourceRef = (left.data as AnchorRangeContext).nextRefs.find(
        (ref) => ref.kind === 'source-slice' && ref.scope.range?.startLine === 9
      );
      if (!nextSourceRef) {
        throw new Error('Expected expanded source-slice next ref.');
      }
      const drillDown = await ProjectContext.execute({
        kind: 'source-slice',
        payload: { includeText: true, ref: nextSourceRef },
        scope: { projectRoot },
      });

      expect(drillDown.errors).toBeUndefined();
      expect((drillDown.data as SourceSliceContext).text).toContain('runHelper(input);');
    });
  });

  it('handles file refs, unsupported parser facts, missing files, and outside-scope anchors', async () => {
    await withFixture(
      {
        'README.md': '# Notes\n\nNo parser here.',
        'src/example.ts': 'export const ok = true;',
      },
      async (projectRoot) => {
        const sourceSlice = await ProjectContext.execute({
          kind: 'source-slice',
          payload: {
            filePath: 'src/example.ts',
            range: { endLine: 1, startLine: 1 },
          },
          scope: { projectRoot },
        });
        const fileRef = sourceSlice.refs.find((ref) => ref.kind === 'file');
        if (!fileRef) {
          throw new Error('Expected file ref.');
        }
        const fromFileRef = await ProjectContext.execute({
          kind: 'anchor-range',
          payload: { ref: fileRef },
          scope: { projectRoot },
        });
        expect(fromFileRef.errors).toBeUndefined();
        expect((fromFileRef.data as AnchorRangeContext).range).toEqual({
          endLine: 1,
          startLine: 1,
        });

        const unsupported = await ProjectContext.execute({
          kind: 'anchor-range',
          payload: { filePath: 'README.md', line: 1 },
          scope: { projectRoot },
        });
        expect(unsupported.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: 'query-unavailable', severity: 'warning' }),
          ])
        );
        expect((unsupported.data as AnchorRangeContext).symbols).toEqual([]);
        expect((unsupported.data as AnchorRangeContext).relationSites).toEqual([]);

        const missing = await ProjectContext.execute({
          kind: 'anchor-range',
          payload: { filePath: 'src/missing.ts', line: 1 },
          scope: { projectRoot },
        });
        const traversal = await ProjectContext.execute({
          kind: 'anchor-range',
          payload: { filePath: '../outside.ts', line: 1 },
          scope: { projectRoot },
        });

        expect(missing.errors?.[0]?.code).toBe('not-found');
        expect((missing.data as ProjectContextUnavailableData).available).toBe(false);
        expect(traversal.errors?.[0]?.code).toBe('outside-scope');
        expect((traversal.data as ProjectContextUnavailableData).available).toBe(false);
      }
    );
  });
});

function expectOnlySourceSliceRefs(data: AnchorRangeContext): void {
  expect(data.sourceSlices.length).toBeGreaterThan(0);
  expect(data.sourceSlices.every((ref) => ref.kind === 'source-slice')).toBe(true);
}

function createFixtureSource(): string {
  return [
    "import type { WorkerPort } from './ports';",
    "import { helper as runHelper } from './helpers';",
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
}

function createFixtureFiles(source: string): Record<string, string> {
  return {
    'src/example.ts': source,
    'src/helpers.ts': 'export function helper(input: string): string { return input; }',
    'src/ports.ts': 'export interface WorkerPort {}',
  };
}

async function withFixture(
  files: Record<string, string>,
  callback: (projectRoot: string) => Promise<void>
): Promise<void> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-context-anchor-range-'));
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
