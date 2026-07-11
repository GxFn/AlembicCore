import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Parser } from 'web-tree-sitter';
import { reloadPlugins } from '../src/core/ast/ensureGrammars.js';
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
