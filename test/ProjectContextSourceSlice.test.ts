import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type {
  ProjectContextUnavailableData,
  SourceSliceContext,
} from '../src/domain/project-context/index.js';
import { ProjectContext } from '../src/project-context.js';
import { createProjectContext } from '../src/service/project-context/interface/projectContext.js';
import { computeContentHash } from '../src/shared/contentHash.js';

describe('ProjectContext PCQ-1 source-slice', () => {
  it('returns exact file identity, range, text, hash, line count, and refs', async () => {
    const source = [
      'export const alpha = 1;',
      'export const beta = 2;',
      'export const gamma = beta + 1;',
      'export const omega = gamma + alpha;',
    ].join('\n');

    await withFixture({ 'src/example.ts': source }, async (projectRoot) => {
      const envelope = await ProjectContext.execute({
        kind: 'source-slice',
        payload: {
          filePath: 'src/example.ts',
          includeText: true,
          range: { endLine: 3, startLine: 2 },
        },
        scope: { projectRoot, repoId: 'core' },
      });
      const data = envelope.data as SourceSliceContext;
      const sourceRef = envelope.refs.find((ref) => ref.kind === 'source-slice');

      expect(envelope.errors).toBeUndefined();
      expect(envelope.queryLevel).toBe('source-slice');
      expect(data).toMatchObject({
        file: {
          filePath: 'src/example.ts',
          hash: computeContentHash(source),
          language: 'typescript',
          lineCount: 4,
          repoId: 'core',
        },
        hash: computeContentHash(source),
        nextRefs: [],
        range: { endLine: 3, startLine: 2 },
        text: ['export const beta = 2;', 'export const gamma = beta + 1;'].join('\n'),
      });
      expect(data.file.mtimeMs).toEqual(expect.any(Number));
      expect(data.file.ref).toMatchObject({
        kind: 'file',
        scope: { filePath: 'src/example.ts', repoId: 'core' },
      });
      expect(envelope.refs.map((ref) => ref.kind)).toEqual(['file', 'source-slice']);
      expect(sourceRef).toMatchObject({
        parentRef: data.file.ref?.id,
        scope: {
          filePath: 'src/example.ts',
          range: { endLine: 3, startLine: 2 },
          repoId: 'core',
        },
      });
    });
  });

  it('reuses a returned source-slice ref as the next source-slice selector', async () => {
    const source = [
      'export const alpha = 1;',
      'export const beta = 2;',
      'export const gamma = beta + 1;',
    ].join('\n');

    await withFixture({ 'src/example.ts': source }, async (projectRoot) => {
      const first = await ProjectContext.execute({
        kind: 'source-slice',
        payload: {
          filePath: 'src/example.ts',
          includeText: true,
          range: { endLine: 2, startLine: 2 },
        },
        scope: { projectRoot, repoId: 'core' },
      });
      const sourceRef = first.refs.find((ref) => ref.kind === 'source-slice');
      if (!sourceRef) {
        throw new Error('Expected first source-slice query to return a source-slice ref.');
      }

      const second = await ProjectContext.execute({
        kind: 'source-slice',
        payload: {
          includeText: true,
          ref: sourceRef,
        },
        scope: { projectRoot, repoId: 'core' },
      });

      expect(second.errors).toBeUndefined();
      expect(second.refs.map((ref) => ref.kind)).toEqual(['file', 'source-slice']);
      expect(second.data).toMatchObject({
        file: {
          filePath: 'src/example.ts',
          hash: computeContentHash(source),
          language: 'typescript',
          lineCount: 3,
          repoId: 'core',
        },
        hash: computeContentHash(source),
        nextRefs: [],
        range: { endLine: 2, startLine: 2 },
        text: 'export const beta = 2;',
      });
    });
  });

  it('omits text when requested and stays deterministic for identical file and request', async () => {
    const source = ['line one', 'line two', 'line three'].join('\n');

    await withFixture({ 'src/example.ts': source }, async (projectRoot) => {
      const left = await ProjectContext.execute({
        kind: 'source-slice',
        payload: {
          filePath: 'src/example.ts',
          includeText: false,
          range: { endLine: 2, startLine: 1 },
        },
        scope: { projectRoot },
      });
      const right = await ProjectContext.execute({
        kind: 'source-slice',
        payload: {
          range: { startLine: 1, endLine: 2 },
          includeText: false,
          filePath: 'src/example.ts',
        },
        scope: { projectRoot },
      });

      expect((left.data as SourceSliceContext).text).toBeUndefined();
      expect(left).toStrictEqual(right);
    });
  });

  it('returns ordinary query errors for invalid ranges, missing files, and traversal', async () => {
    await withFixture({ 'src/example.ts': 'one\ntwo\nthree' }, async (projectRoot) => {
      const invalidRange = await ProjectContext.execute({
        kind: 'source-slice',
        payload: { filePath: 'src/example.ts', range: { endLine: 2, startLine: 4 } },
        scope: { projectRoot },
      });
      const missingFile = await ProjectContext.execute({
        kind: 'source-slice',
        payload: { filePath: 'src/missing.ts', range: { endLine: 1, startLine: 1 } },
        scope: { projectRoot },
      });
      const traversal = await ProjectContext.execute({
        kind: 'source-slice',
        payload: { filePath: '../outside.ts', range: { endLine: 1, startLine: 1 } },
        scope: { projectRoot },
      });

      expect(invalidRange.errors?.[0]?.code).toBe('invalid-scope');
      expect(missingFile.errors?.[0]?.code).toBe('not-found');
      expect(traversal.errors?.[0]?.code).toBe('outside-scope');
      expect((invalidRange.data as ProjectContextUnavailableData).available).toBe(false);
      expect((missingFile.data as ProjectContextUnavailableData).available).toBe(false);
      expect((traversal.data as ProjectContextUnavailableData).available).toBe(false);
    });
  });

  it('blocks absolute paths outside project root', async () => {
    await withFixture({ 'src/example.ts': 'inside' }, async (projectRoot) => {
      const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-context-outside-'));
      try {
        const outsideFile = path.join(outsideRoot, 'outside.ts');
        await fs.writeFile(outsideFile, 'outside', 'utf8');

        const envelope = await ProjectContext.execute({
          kind: 'source-slice',
          payload: { filePath: outsideFile, range: { endLine: 1, startLine: 1 } },
          scope: { projectRoot },
        });

        expect(envelope.errors?.[0]?.code).toBe('outside-scope');
        expect((envelope.data as ProjectContextUnavailableData).available).toBe(false);
      } finally {
        await fs.rm(outsideRoot, { force: true, recursive: true });
      }
    });
  });

  it('leaves final redaction and projection outside sourceSlice ownership', async () => {
    const projectContext = createProjectContext({
      'source-slice': () => ({
        data: {
          apiKey: 'secret-value',
          file: { filePath: 'src/secret.ts' },
          hash: 'hash',
          nextRefs: [],
          range: { endLine: 1, startLine: 1 },
        } as SourceSliceContext & { apiKey: string },
        refs: [],
      }),
    });

    const envelope = await projectContext.execute({
      kind: 'source-slice',
      scope: { projectRoot: '/tmp/project-context-source-slice-redaction' },
    });
    const sourceSliceDir = fileURLToPath(
      new URL('../src/service/project-context/sourceSlice', import.meta.url)
    );
    const source = (
      await Promise.all(
        (
          await fs.readdir(sourceSliceDir)
        )
          .filter((fileName) => fileName.endsWith('.ts'))
          .map((fileName) => fs.readFile(path.join(sourceSliceDir, fileName), 'utf8'))
      )
    ).join('\n');

    expect((envelope.data as SourceSliceContext & { apiKey: string }).apiKey).toBe('[redacted]');
    expect(source).not.toMatch(
      /interface\/(?:redaction|projection|pruning)|redactProjectContextData|selectProjectContextRefs|projectCompactProjectContextData/
    );
  });
});

async function withFixture(
  files: Record<string, string>,
  callback: (projectRoot: string) => Promise<void>
): Promise<void> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-context-source-slice-'));
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
