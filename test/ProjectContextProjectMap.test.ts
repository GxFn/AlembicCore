import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  ProjectContextUnavailableData,
  ProjectMap,
} from '../src/domain/project-context/index.js';
import { ProjectContext } from '../src/project-context.js';
import { buildCoverageLedgerModuleAxisFromSummaries } from '../src/workflows/surfaces/coverage/index.js';

describe('ProjectContext PCQ-6 project map', () => {
  it('returns project-level module graph facts, cycles, hotspots, flows, and drill-down refs', async () => {
    await withFixture(createMapFixture(), async (projectRoot) => {
      const envelope = await ProjectContext.execute({
        kind: 'map',
        payload: {
          moduleSeeds: [createFeatureSeed(), createSharedSeed()],
        },
        scope: { projectRoot, repoId: 'core' },
      });
      const data = envelope.data as ProjectMap;

      expect(envelope.errors).toBeUndefined();
      expect(data.repo).toMatchObject({ id: 'core', name: 'core', root: '.' });
      expect(data.modules.map((module) => module.name)).toEqual(['feature', 'shared']);
      expect(data.dependencySummary).toMatchObject({ edgeCount: 2 });
      expect(data.dependencySummary.notes).toEqual(
        expect.arrayContaining(['modules:2', 'internal-edges:2', 'external-dependencies:0'])
      );
      expect(data.cycles).toHaveLength(1);
      expect(data.cycles[0].summary).toContain('feature');
      expect(data.cycles[0].summary).toContain('shared');
      expect(data.layers[0]).toMatchObject({
        fileGroups: ['feature', 'shared'],
        name: 'base',
        uncertain: true,
      });
      expect(data.hotspots.map((hotspot) => hotspot.ref.kind)).toContain('module');
      expect(data.majorFlows.map((flow) => flow.summary)).toEqual(
        expect.arrayContaining([
          'feature -> shared via imports (1 relation)',
          'shared -> feature via imports (1 relation)',
        ])
      );
      expect(data.externalDependencyHotspots).toEqual([]);
      expect(data.nextRefs.some((ref) => ref.kind === 'module')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'module-layer')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'file-flow')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'relation-site')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'source-slice')).toBe(true);
    });
  });

  it('keeps map output deterministic regardless of module seed order', async () => {
    await withFixture(createMapFixture(), async (projectRoot) => {
      const left = await ProjectContext.execute({
        kind: 'map',
        payload: {
          moduleSeeds: [createFeatureSeed(), createSharedSeed()],
        },
        scope: { projectRoot },
      });
      const right = await ProjectContext.execute({
        kind: 'map',
        payload: {
          moduleSeeds: [createSharedSeed(), createFeatureSeed()],
        },
        scope: { projectRoot },
      });

      expect(left).toStrictEqual(right);
    });
  });

  it('characterizes ProjectMap module ids against coverage ledger module axis ids', async () => {
    await withFixture(createMapFixture(), async (projectRoot) => {
      const envelope = await ProjectContext.execute({
        kind: 'map',
        payload: {
          moduleSeeds: [createFeatureSeed(), createSharedSeed()],
        },
        scope: { projectRoot, repoId: 'core' },
      });
      const data = envelope.data as ProjectMap;
      const coverageAxis = buildCoverageLedgerModuleAxisFromSummaries({
        modules: data.modules.map((module) => ({
          id: module.id,
          moduleName: module.name,
          modulePath: readStringMetadata(module.ref.metadata?.modulePath),
          ownedFiles: readStringArrayMetadata(module.ref.metadata?.ownedFiles),
        })),
      });

      const projectMapModuleIds = data.modules.map((module) => module.id).sort();
      const coverageLedgerModuleIds = coverageAxis.map((module) => module.moduleId).sort();

      expect(projectMapModuleIds).toEqual([
        'module:core:feature:src/feature',
        'module:core:shared:src/shared',
      ]);
      expect(coverageLedgerModuleIds).toEqual([
        'target:feature:src/feature',
        'target:shared:src/shared',
      ]);
      expect(coverageLedgerModuleIds).not.toEqual(projectMapModuleIds);
      expect(coverageAxis.map((module) => module.ownedPaths)).toEqual([
        ['src/feature/api/index.ts', 'src/feature/domain/model.ts', 'src/feature/service/run.ts'],
        ['src/shared/format.ts'],
      ]);
    });
  });

  it('reports ordinary query errors when module ownership is missing', async () => {
    await withFixture(createMapFixture(), async (projectRoot) => {
      const missingSeeds = await ProjectContext.execute({
        kind: 'map',
        payload: {},
        scope: { projectRoot },
      });
      const missingModule = await ProjectContext.execute({
        kind: 'map',
        payload: {
          moduleSeeds: [{ moduleName: 'missing', ownedFiles: ['src/missing.ts'] }],
        },
        scope: { projectRoot },
      });

      expect(missingSeeds.errors?.[0]?.code).toBe('invalid-scope');
      expect((missingSeeds.data as ProjectContextUnavailableData).available).toBe(false);
      expect(missingModule.errors?.some((error) => error.code === 'not-found')).toBe(true);
      expect((missingModule.data as ProjectContextUnavailableData).available).toBe(false);
    });
  });

  it('summarizes external dependencies without treating them as repo package facts', async () => {
    await withFixture(createExternalDependencyFixture(), async (projectRoot) => {
      const envelope = await ProjectContext.execute({
        kind: 'map',
        payload: {
          moduleSeeds: [
            { moduleName: 'api', modulePath: 'src/api', ownedFiles: ['src/api/index.ts'] },
          ],
        },
        scope: { projectRoot, repoId: 'core' },
      });
      const data = envelope.data as ProjectMap;

      expect(data.externalDependencyHotspots).toEqual([
        expect.objectContaining({ category: 'package', name: 'zod' }),
      ]);
      expect(envelope.errors).toContainEqual(
        expect.objectContaining({
          code: 'query-unavailable',
          message: 'map external dependency is not owned by module seeds: zod',
          severity: 'warning',
        })
      );
      expect(JSON.stringify(data)).not.toMatch(/packageSystems|buildSystems|entrypoints/);
    });
  });
});

function createFeatureSeed(): { moduleName: string; modulePath: string; ownedFiles: string[] } {
  return {
    moduleName: 'feature',
    modulePath: 'src/feature',
    ownedFiles: [
      'src/feature/api/index.ts',
      'src/feature/domain/model.ts',
      'src/feature/service/run.ts',
    ],
  };
}

function createSharedSeed(): { moduleName: string; modulePath: string; ownedFiles: string[] } {
  return {
    moduleName: 'shared',
    modulePath: 'src/shared',
    ownedFiles: ['src/shared/format.ts'],
  };
}

function createMapFixture(): Record<string, string> {
  return {
    'src/feature/api/index.ts': [
      "import { FeatureService } from '../service/run';",
      "import type { FeatureInput } from '../domain/model';",
      '',
      'export function createFeature(input: FeatureInput): FeatureService {',
      '  return new FeatureService(input.name);',
      '}',
    ].join('\n'),
    'src/feature/domain/model.ts': ['export interface FeatureInput {', '  name: string;', '}'].join(
      '\n'
    ),
    'src/feature/service/run.ts': [
      "import type { FeatureInput } from '../domain/model';",
      "import { formatFeature } from '../../shared/format';",
      '',
      'export class FeatureService {',
      '  constructor(private readonly name: string) {}',
      '  run(input: FeatureInput): string {',
      '    return formatFeature(input.name || this.name);',
      '  }',
      '}',
    ].join('\n'),
    'src/shared/format.ts': [
      "import type { FeatureInput } from '../feature/domain/model';",
      '',
      'export function formatFeature(name: FeatureInput["name"]): string {',
      '  return name.trim();',
      '}',
    ].join('\n'),
  };
}

function createExternalDependencyFixture(): Record<string, string> {
  return {
    'src/api/index.ts': [
      "import { z } from 'zod';",
      '',
      'export const schema = z.object({ name: z.string() });',
    ].join('\n'),
  };
}

function readStringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringArrayMetadata(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

async function withFixture(
  files: Record<string, string>,
  callback: (projectRoot: string) => Promise<void>
): Promise<void> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-context-map-'));
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
