import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(
  new URL('../scripts/lint-consumer-core-imports.mjs', import.meta.url)
);
const tmpRoots: string[] = [];

async function createConsumerFixture() {
  const root = await mkdtemp(join(tmpdir(), 'alembic-core-consumer-boundary-'));
  tmpRoots.push(root);
  await mkdir(join(root, 'src'), { recursive: true });
  return root;
}

async function writeFixtureFile(root: string, relativePath: string, content: string) {
  const absolutePath = join(root, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

function runBoundaryLint(root: string, args: string[] = []) {
  return execFileAsync(process.execPath, [scriptPath, root, ...args], {
    maxBuffer: 1024 * 1024,
  });
}

async function expectBoundaryFailure(root: string, args: string[] = []) {
  try {
    await runBoundaryLint(root, args);
  } catch (error) {
    return error as Error & { code?: number; stdout?: string };
  }
  throw new Error('Expected consumer core import boundary lint to fail.');
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('consumer core import boundary lint', () => {
  it('allows stable public facade imports without a config file', async () => {
    const root = await createConsumerFixture();
    await writeFixtureFile(
      root,
      'src/app.ts',
      [
        "import { createLocalSearchEngine } from '@alembic/core/search';",
        "const workflows = await import('@alembic/core/host-agent-workflows');",
        'void workflows;',
      ].join('\n')
    );

    const { stdout } = await runBoundaryLint(root);

    expect(stdout).toContain('Core import boundary OK');
    expect(stdout).toContain('2 @alembic/core imports');
  });

  it('rejects new transitional deep imports outside an adapter', async () => {
    const root = await createConsumerFixture();
    const blockedSpecifier = '@alembic/core/workflows/cold-start/' + 'ColdStartIntent';
    await writeFixtureFile(
      root,
      'src/app.ts',
      `import { ColdStartIntent } from '${blockedSpecifier}';\nvoid ColdStartIntent;\n`
    );

    const error = await expectBoundaryFailure(root);

    expect(error.code).toBe(1);
    expect(error.stdout).toContain('Core import boundary violations: 1');
    expect(error.stdout).toContain(blockedSpecifier);
    expect(error.stdout).toContain('[transitional-internal]');
  });

  it('honors existing allowlists and blocks non-stable reference growth', async () => {
    const root = await createConsumerFixture();
    const specifier = '@alembic/core/service/knowledge/KnowledgeService';
    await writeFixtureFile(
      root,
      'src/one.ts',
      `import { KnowledgeService } from '${specifier}';\nvoid KnowledgeService;\n`
    );
    await writeFixtureFile(
      root,
      'config/core-import-boundary.json',
      JSON.stringify(
        {
          allowedSpecifiers: [specifier],
          referenceLimits: {
            [specifier]: 1,
          },
          scanRoots: ['src'],
        },
        null,
        2
      )
    );

    await expect(
      runBoundaryLint(root, ['--config', 'config/core-import-boundary.json'])
    ).resolves.toBeDefined();

    await writeFixtureFile(
      root,
      'src/two.ts',
      `import { KnowledgeService as KnowledgeServiceAgain } from '${specifier}';\nvoid KnowledgeServiceAgain;\n`
    );

    const error = await expectBoundaryFailure(root, [
      '--config',
      'config/core-import-boundary.json',
    ]);

    expect(error.stdout).toContain('Reference limit exceeded: 2 found, baseline allows 1.');
  });

  it('allows non-stable imports inside configured adapter paths only', async () => {
    const root = await createConsumerFixture();
    const specifier = '@alembic/core/infrastructure/database/drizzle/schema';
    await writeFixtureFile(
      root,
      'src/core-adapter/database.ts',
      `import * as schema from '${specifier}';\nvoid schema;\n`
    );
    await writeFixtureFile(
      root,
      'src/feature.ts',
      `import * as schema from '${specifier}';\nvoid schema;\n`
    );
    await writeFixtureFile(
      root,
      'config/core-import-boundary.json',
      JSON.stringify(
        {
          adapterPathGlobs: ['src/core-adapter/**'],
          scanRoots: ['src'],
        },
        null,
        2
      )
    );

    const error = await expectBoundaryFailure(root, [
      '--config',
      'config/core-import-boundary.json',
    ]);

    expect(error.stdout).toContain('src/feature.ts:1:26');
    expect(error.stdout).not.toContain('src/core-adapter/database.ts');
  });
});
