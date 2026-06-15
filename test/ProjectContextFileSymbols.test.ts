import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  FileSymbolContext,
  ProjectContextUnavailableData,
  SourceSliceContext,
} from '../src/domain/project-context/index.js';
import { ProjectContext } from '../src/project-context.js';
import { computeContentHash } from '../src/shared/contentHash.js';

describe('ProjectContext PCQ-2 file-symbols', () => {
  it('returns ordered TypeScript symbols, naming, refs, and source-slice drill-down', async () => {
    const source = [
      'export interface ServicePort {',
      '  run(input: string): Promise<void>;',
      '}',
      'export type ServiceState = "idle" | "running";',
      'export class WorkerService implements ServicePort {',
      '  readonly state: ServiceState = "idle";',
      '  constructor(private readonly repo: Repository) {}',
      '  async run(input: string): Promise<void> {',
      '    this.helper(input);',
      '  }',
      '  private helper(input: string): void {}',
      '}',
      'export function createWorker(): WorkerService {',
      '  return new WorkerService({} as Repository);',
      '}',
      'const localOnly = () => "x";',
      'interface Repository {}',
    ].join('\n');

    await withFixture({ 'src/example.ts': source }, async (projectRoot) => {
      const envelope = await ProjectContext.execute({
        kind: 'file-symbols',
        payload: { filePath: 'src/example.ts' },
        scope: { projectRoot, repoId: 'core' },
      });
      const data = envelope.data as FileSymbolContext;

      expect(envelope.errors).toBeUndefined();
      expect(envelope.queryLevel).toBe('file-symbols');
      expect(data.file).toMatchObject({
        filePath: 'src/example.ts',
        hash: computeContentHash(source),
        language: 'typescript',
        lineCount: 17,
        repoId: 'core',
      });
      expect(
        data.symbols.map((symbol) => [symbol.kind, symbol.qualifiedName ?? symbol.name])
      ).toEqual([
        ['interface', 'ServicePort'],
        ['type', 'ServiceState'],
        ['class', 'WorkerService'],
        ['property', 'WorkerService.state'],
        ['constructor', 'WorkerService.constructor'],
        ['property', 'WorkerService.repo'],
        ['method', 'WorkerService.run'],
        ['method', 'WorkerService.helper'],
        ['function', 'createWorker'],
        ['function', 'localOnly'],
        ['interface', 'Repository'],
      ]);
      expect(data.symbols.find((symbol) => symbol.name === 'WorkerService')).toMatchObject({
        exported: true,
        range: { endLine: 12, startLine: 5 },
      });
      expect(data.symbols.every((symbol) => symbol.ref?.kind === 'file-symbol')).toBe(true);
      expect(data.naming.convention).toBe('typescript symbols: 4 exported / 11 total');
      expect(new Set(data.symbols.map((symbol) => symbol.ref?.id)).size).toBe(data.symbols.length);
      expect(data.nextRefs.every((ref) => ref.kind === 'source-slice')).toBe(true);
      expect(data.nextRefs.length).toBeLessThanOrEqual(data.symbols.length);
      expect(
        data.symbols.every((symbol) =>
          data.nextRefs.some((ref) => ref.id === symbol.ref?.parentRef)
        )
      ).toBe(true);

      const classSourceRef = data.nextRefs.find((ref) => ref.scope.range?.startLine === 5);
      if (!classSourceRef) {
        throw new Error('Expected WorkerService source-slice ref.');
      }
      const drillDown = await ProjectContext.execute({
        kind: 'source-slice',
        payload: { includeText: true, ref: classSourceRef },
        scope: { projectRoot, repoId: 'core' },
      });

      expect(drillDown.errors).toBeUndefined();
      expect((drillDown.data as SourceSliceContext).text).toContain(
        'export class WorkerService implements ServicePort'
      );
      expect(drillDown.refs.map((ref) => ref.kind)).toEqual(['file', 'source-slice']);
    });
  });

  it('stays deterministic for equivalent file-symbol requests', async () => {
    const source = ['export class Alpha {}', 'export function beta() {}'].join('\n');

    await withFixture({ 'src/example.ts': source }, async (projectRoot) => {
      const left = await ProjectContext.execute({
        kind: 'file-symbols',
        payload: { filePath: 'src/example.ts' },
        scope: { projectRoot },
      });
      const fileRef = left.refs.find((ref) => ref.kind === 'file');
      if (!fileRef) {
        throw new Error('Expected file ref from file-symbols result.');
      }
      const right = await ProjectContext.execute({
        kind: 'file-symbols',
        payload: { ref: fileRef },
        scope: { projectRoot },
      });

      expect(left).toStrictEqual(right);
    });
  });

  it('returns ordinary query errors without inventing symbols for unsupported or missing files', async () => {
    await withFixture({ 'README.md': '# Notes\n\nNo parser here.' }, async (projectRoot) => {
      const unsupported = await ProjectContext.execute({
        kind: 'file-symbols',
        payload: { filePath: 'README.md' },
        scope: { projectRoot },
      });
      const missing = await ProjectContext.execute({
        kind: 'file-symbols',
        payload: { filePath: 'src/missing.ts' },
        scope: { projectRoot },
      });

      expect(unsupported.errors?.[0]).toMatchObject({
        code: 'query-unavailable',
        severity: 'warning',
      });
      expect((unsupported.data as FileSymbolContext).symbols).toEqual([]);
      expect((unsupported.data as FileSymbolContext).naming.warnings).toContain(
        'file-symbols parser is unavailable for language markdown.'
      );
      expect(missing.errors?.[0]?.code).toBe('not-found');
      expect((missing.data as ProjectContextUnavailableData).available).toBe(false);
    });
  });
});

async function withFixture(
  files: Record<string, string>,
  callback: (projectRoot: string) => Promise<void>
): Promise<void> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-context-file-symbols-'));
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
