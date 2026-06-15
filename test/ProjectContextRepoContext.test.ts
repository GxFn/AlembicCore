import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetDiscovererRegistry } from '../src/core/discovery/index.js';
import type {
  ProjectContextUnavailableData,
  RepoContext,
} from '../src/domain/project-context/index.js';
import { ProjectContext } from '../src/project-context.js';

describe('ProjectContext PCQ-7 repo context', () => {
  beforeEach(() => {
    resetDiscovererRegistry();
  });

  afterEach(() => {
    resetDiscovererRegistry();
  });

  it('returns repo identity, package/build facts, entrypoints, mapRef, and drill-down refs', async () => {
    await withFixture(createRepoFixture(), async (projectRoot) => {
      const envelope = await ProjectContext.execute({
        kind: 'repo',
        payload: {
          moduleSeeds: [createFeatureSeed(), createSharedSeed()],
          repoName: 'fixture-core',
        },
        scope: { projectRoot, repoId: 'fixture' },
      });
      const data = envelope.data as RepoContext;

      expect(envelope.errors).toBeUndefined();
      expect(data.repo).toMatchObject({ id: 'fixture', name: 'fixture-core', root: '.' });
      expect(data.languages).toEqual(
        expect.arrayContaining([expect.objectContaining({ language: 'typescript' })])
      );
      expect(data.packageSystems.map((system) => system.kind)).toContain('node/package-json');
      expect(data.buildSystems.map((system) => system.kind)).toEqual(
        expect.arrayContaining(['node-scripts', 'typescript', 'vitest'])
      );
      expect(data.targets).toEqual([
        expect.objectContaining({
          kind: 'executable',
          name: '@fixture/core',
        }),
      ]);
      expect(data.localPackages).toEqual([
        expect.objectContaining({ name: '@fixture/core', path: '.' }),
      ]);
      expect(data.sourceRoots.map((root) => root.path)).toEqual(
        expect.arrayContaining(['bin', 'src'])
      );
      expect(data.entrypoints.map((entrypoint) => entrypoint.name)).toEqual(
        expect.arrayContaining(['main', 'types', 'bin:fixture', 'exports:.', 'exports:./feature'])
      );
      expect(data.commands.map((command) => command.name)).toEqual(['build', 'test']);
      expect(data.topAreas.map((area) => area.path)).toEqual(expect.arrayContaining(['src']));
      expect(data.configFiles.map((file) => file.path)).toEqual(
        expect.arrayContaining(['package.json', 'tsconfig.json', 'vitest.config.ts'])
      );
      expect(data.mapRef).toMatchObject({ kind: 'map' });
      expect(data.mapSummary).toMatchObject({
        dependencyEdgeCount: 1,
        layerCount: 2,
        moduleCount: 2,
      });
      expect(data.nextRefs.some((ref) => ref.kind === 'map')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'path')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'file')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'module')).toBe(false);
      expect(data.nextRefs.some((ref) => ref.kind === 'file-flow')).toBe(false);
      expect(JSON.stringify(data)).not.toMatch(
        /majorFlows|externalDependencyHotspots|dependencySummary/
      );
    });
  });

  it('keeps repo output deterministic regardless of module seed order', async () => {
    await withFixture(createRepoFixture(), async (projectRoot) => {
      const left = await ProjectContext.execute({
        kind: 'repo',
        payload: {
          moduleSeeds: [createFeatureSeed(), createSharedSeed()],
          repoName: 'fixture-core',
        },
        scope: { projectRoot, repoId: 'fixture' },
      });
      const right = await ProjectContext.execute({
        kind: 'repo',
        payload: {
          moduleSeeds: [createSharedSeed(), createFeatureSeed()],
          repoName: 'fixture-core',
        },
        scope: { projectRoot, repoId: 'fixture' },
      });

      expect(left).toStrictEqual(right);
    });
  });

  it('returns repo facts and an ordinary error when map facts are unavailable', async () => {
    await withFixture(createRepoFixture(), async (projectRoot) => {
      const envelope = await ProjectContext.execute({
        kind: 'repo',
        scope: { projectRoot, repoId: 'fixture' },
      });
      const data = envelope.data as RepoContext;

      expect(data.repo.id).toBe('fixture');
      expect(data.mapRef).toBeUndefined();
      expect(data.packageSystems.map((system) => system.kind)).toContain('node/package-json');
      expect(envelope.errors).toContainEqual(
        expect.objectContaining({
          code: 'query-unavailable',
          message:
            'repo map facts are unavailable because payload.moduleSeeds or payload.modules is missing.',
          severity: 'warning',
        })
      );
    });
  });

  it('reports unreadable manifests without turning repo into a thin unavailable shell', async () => {
    await withFixture(
      {
        'package.json': '{',
        'src/index.ts': 'export const value = 1;',
      },
      async (projectRoot) => {
        const envelope = await ProjectContext.execute({
          kind: 'repo',
          payload: { includeMapSummary: false },
          scope: { projectRoot, repoId: 'fixture' },
        });
        const data = envelope.data as RepoContext;

        expect(data.repo.id).toBe('fixture');
        expect(data.packageSystems.map((system) => system.kind)).toContain('node/package-json');
        expect(envelope.errors).toContainEqual(
          expect.objectContaining({
            code: 'query-unavailable',
            path: 'package.json',
          })
        );
      }
    );
  });

  it('rejects repo roots outside the project scope as ordinary query errors', async () => {
    await withFixture(createRepoFixture(), async (projectRoot) => {
      const envelope = await ProjectContext.execute({
        kind: 'repo',
        payload: { repoRoot: '../outside' },
        scope: { projectRoot },
      });

      expect(envelope.errors?.[0]?.code).toBe('outside-scope');
      expect((envelope.data as ProjectContextUnavailableData).available).toBe(false);
    });
  });
});

function createFeatureSeed(): { moduleName: string; modulePath: string; ownedFiles: string[] } {
  return {
    moduleName: 'feature',
    modulePath: 'src/feature',
    ownedFiles: ['src/feature/index.ts'],
  };
}

function createSharedSeed(): { moduleName: string; modulePath: string; ownedFiles: string[] } {
  return {
    moduleName: 'shared',
    modulePath: 'src/shared',
    ownedFiles: ['src/shared/index.ts'],
  };
}

function createRepoFixture(): Record<string, string> {
  return {
    'bin/fixture.js': '#!/usr/bin/env node\nconsole.log("fixture");\n',
    'package.json': JSON.stringify(
      {
        name: '@fixture/core',
        type: 'module',
        main: 'dist/index.js',
        types: 'dist/index.d.ts',
        bin: { fixture: 'bin/fixture.js' },
        exports: {
          '.': './dist/index.js',
          './feature': './src/feature/index.ts',
        },
        scripts: {
          build: 'tsc -p tsconfig.json',
          test: 'vitest run',
        },
        dependencies: {
          '@fixture/shared': 'workspace:*',
        },
        devDependencies: {
          typescript: '^5.0.0',
          vitest: '^3.0.0',
        },
      },
      null,
      2
    ),
    'src/feature/index.ts': [
      "import { sharedValue } from '../shared/index';",
      '',
      'export function runFeature(): string {',
      '  return sharedValue;',
      '}',
    ].join('\n'),
    'src/shared/index.ts': "export const sharedValue = 'shared';\n",
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }, null, 2),
    'vitest.config.ts': 'export default { test: { globals: true } };\n',
  };
}

async function withFixture(
  files: Record<string, string>,
  callback: (projectRoot: string) => Promise<void>
): Promise<void> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-context-repo-'));
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
