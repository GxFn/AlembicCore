import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Parser } from 'web-tree-sitter';
import { reloadPlugins } from '../src/core/ast/ensureGrammars.js';
import type { ModuleContext } from '../src/domain/project-context/index.js';
import { collectPlanProjectContext } from '../src/service/plan/facts/collectProjectContext.js';

const fixtureRoots: string[] = [];

beforeAll(async () => {
  await reloadPlugins();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const fixtureRoot of fixtureRoots.splice(0)) {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

describe('planFacts ProjectContext error posture', () => {
  it('shares real AST extraction across a collection batch and reads fresh source in the next batch', async () => {
    const source = 'export class BatchOriginal { run() { return 1; } }\n';
    const changedSource = 'export class BatchChanged { run() { return 2; } }\n';
    const fixtureRoot = createNodeFixture('src/index.ts', source);
    // Spy 只计数，实际源码读取、tree-sitter 解析、module/map 组合与投影全部照常执行。
    const parse = vi.spyOn(Parser.prototype, 'parse');
    const first = await collectPlanProjectContext(fixtureRoot, undefined);
    const firstModule = first.envelopes.find((envelope) => envelope.queryLevel === 'module')
      ?.data as ModuleContext;

    expect(first.requestKinds).toEqual(['space', 'repo', 'map', 'module', 'module-layers']);
    expect(firstModule.publicSurfaces.map((symbol) => symbol.name)).toContain('BatchOriginal');
    expect(parse.mock.calls.filter(([input]) => input === source)).toHaveLength(1);

    parse.mockClear();
    writeFileSync(join(fixtureRoot, 'src/index.ts'), changedSource);
    const second = await collectPlanProjectContext(fixtureRoot, undefined);
    const secondModule = second.envelopes.find((envelope) => envelope.queryLevel === 'module')
      ?.data as ModuleContext;

    expect(secondModule.publicSurfaces.map((symbol) => symbol.name)).toContain('BatchChanged');
    expect(secondModule.publicSurfaces.map((symbol) => symbol.name)).not.toContain('BatchOriginal');
    expect(parse.mock.calls.filter(([input]) => input === changedSource)).toHaveLength(1);
    expect(parse.mock.calls.filter(([input]) => input === source)).toHaveLength(0);
    expect(firstModule.publicSurfaces.map((symbol) => symbol.name)).toContain('BatchOriginal');
  });

  it('retains fatal AST query errors and reports required facts as partial', async () => {
    const fixtureRoot = createNodeFixture();
    vi.spyOn(Parser.prototype, 'parse').mockImplementation(() => {
      throw new Error('intentional parser failure');
    });

    const analysis = await collectPlanProjectContext(fixtureRoot, undefined);
    const fatalWarnings = analysis.presenterInput.warnings.filter((warning) =>
      warning.message.includes('parser failed for')
    );

    expect(fatalWarnings.map((warning) => warning.message)).toEqual(
      expect.arrayContaining([
        'file-symbols parser failed for src/index.ts.',
        'file-flow parser failed for src/index.ts.',
      ])
    );
    expect(analysis.contextStatus).toBe('partial');
    expect(analysis.understandingGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          affectedFileCount: 1,
          affectedFiles: ['src/index.ts'],
          code: 'project-context-file-flow-partial',
          omittedFact: 'fileFlow',
        }),
        expect.objectContaining({
          affectedFileCount: 1,
          affectedFiles: ['src/index.ts'],
          code: 'project-context-file-symbols-partial',
          omittedFact: 'fileSymbols',
        }),
      ])
    );
  });

  it('does not classify an unsupported language as a fatal AST fact failure', async () => {
    const fixtureRoot = createNodeFixture('src/notes.md', '# Notes\n');

    const analysis = await collectPlanProjectContext(fixtureRoot, undefined);

    expect(
      analysis.presenterInput.warnings.some((warning) =>
        warning.message.includes('parser is unavailable for language markdown')
      )
    ).toBe(true);
    expect(analysis.contextStatus).toBe('complete');
    expect(
      analysis.understandingGaps.some((gap) => String(gap.code).startsWith('project-context-file-'))
    ).toBe(false);
  });
});

function createNodeFixture(
  relativeSourcePath = 'src/index.ts',
  source = 'export const stable = 1;\n'
): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'plan-facts-errors-'));
  fixtureRoots.push(fixtureRoot);
  mkdirSync(join(fixtureRoot, 'src'), { recursive: true });
  writeFileSync(
    join(fixtureRoot, 'package.json'),
    JSON.stringify({ name: 'plan-facts-errors', version: '1.0.0' })
  );
  writeFileSync(join(fixtureRoot, relativeSourcePath), source);
  return fixtureRoot;
}
