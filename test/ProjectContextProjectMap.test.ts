import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  ModuleContext,
  ProjectContextUnavailableData,
  ProjectMap,
} from '../src/domain/project-context/index.js';
import { ProjectContext } from '../src/project-context.js';
import {
  createProjectContextModuleDependencyRollups,
  createProjectContextModuleMapModule,
} from '../src/service/project-context/shared/module-map/index.js';
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

  it.each([
    'file',
    'name',
  ] as const)('preserves ambiguous module %s owners without inventing dependencies, cycles, or ranking evidence', async (matchBy) => {
    const owners = ['alpha', 'beta'].map((name) => ({
      moduleName: matchBy === 'name' ? 'Shared' : name,
      modulePath: `src/${name}`,
      ownedFiles: [`src/${name}/index.ts`, ...(matchBy === 'file' ? ['src/shared.ts'] : [])],
    }));
    const consumer = {
      moduleName: 'consumer',
      modulePath: 'src/consumer',
      ownedFiles: ['src/consumer/index.ts'],
    };
    const seeds = [...owners, consumer];
    await withFixture(
      {
        'src/alpha/index.ts':
          "import { consume } from '../consumer';\nexport const alpha = consume;\n",
        'src/beta/index.ts':
          "import { consume } from '../consumer';\nexport const beta = consume;\n",
        'src/shared.ts': 'export const shared = 1;\n',
        'src/consumer/index.ts': `import { shared } from '${matchBy === 'file' ? '../shared' : 'Shared'}';\nexport function consume() { return shared; }\n`,
      },
      async (projectRoot) => {
        const scope = { projectRoot, repoId: 'core' };
        const query = (moduleSeeds: typeof seeds) =>
          ProjectContext.execute({
            kind: 'map',
            // 关闭外部包展示不能隐藏项目内部的归属歧义。
            payload: { moduleSeeds, includeExternalDeps: false },
            scope,
          });
        const envelope = await query(seeds);
        const data = envelope.data as ProjectMap;
        const candidateIds = data.modules
          .filter((module) => module.name !== 'consumer')
          .map((module) => module.id)
          .sort();
        const ambiguity = envelope.errors?.find((error) => error.code === 'ambiguous');
        expect(ambiguity).toMatchObject({
          severity: 'error',
          retryable: false,
          path: 'src/consumer/index.ts',
          ref: { kind: 'relation-site' },
        });
        for (const candidateId of candidateIds) {
          expect(ambiguity?.message).toContain(candidateId);
          expect(data.nextRefs.some((ref) => ref.id === candidateId)).toBe(true);
        }
        expect(data.dependencySummary).toMatchObject({ edgeCount: 2 });
        expect(data.dependencySummary.notes).toEqual(
          expect.arrayContaining([
            'internal-edges:2',
            'external-dependencies:0',
            'ambiguous-dependencies:1',
          ])
        );
        expect(data.externalDependencyHotspots).toEqual([]);
        expect(data.cycles).toEqual([]);
        expect(data.majorFlows).toHaveLength(2);
        expect(
          data.majorFlows.every((flow) => flow.summary.includes(' -> consumer via imports'))
        ).toBe(true);
        expect(data.hotspots.map((hotspot) => hotspot.score)).toEqual([6, 2, 2]);
        expect(data.layers[0].fileGroups).toEqual(['consumer']);
        expect(await query([...seeds].reverse())).toStrictEqual(envelope);

        // 公开 map 会预先排序种子；直接复核其真实 module 产物的汇总入口，防止换序问题被排序遮蔽。
        const modules = await Promise.all(
          seeds.map(async (seed) => {
            const result = await ProjectContext.execute({ kind: 'module', payload: seed, scope });
            return createProjectContextModuleMapModule({
              moduleContext: result.data as ModuleContext,
            });
          })
        );
        const rollups = createProjectContextModuleDependencyRollups({
          modules,
          scope: { ...scope, includeGenerated: false, includeVendor: false },
        });
        expect(
          createProjectContextModuleDependencyRollups({
            modules: [...modules].reverse(),
            scope: { ...scope, includeGenerated: false, includeVendor: false },
          }).sort((left, right) => left.id.localeCompare(right.id))
        ).toStrictEqual([...rollups].sort((left, right) => left.id.localeCompare(right.id)));
        const ambiguousRollup = rollups.find((rollup) => rollup.from.name === 'consumer');
        expect(ambiguousRollup).toMatchObject({ unresolved: true });
        expect(ambiguousRollup?.to).toBeUndefined();
        expect(ambiguousRollup?.externalName).toBeUndefined();
        expect(
          ambiguousRollup?.targetRefs
            .filter((ref) => ref.kind === 'module')
            .map((ref) => ref.id)
            .sort()
        ).toEqual(candidateIds);
        expect(
          ambiguousRollup?.sourceRefs.some((ref) => ref.scope.filePath === 'src/consumer/index.ts')
        ).toBe(true);
      }
    );
  });

  it('orders distinct ambiguous target sets independently of relation traversal order', async () => {
    await withFixture(
      {
        'src/one.ts': 'export const one = 1;\n',
        'src/two.ts': 'export const two = 2;\n',
        'src/consumer.ts':
          "import { one } from './one';\nimport { two } from './two';\nexport const sum = one + two;\n",
      },
      async (projectRoot) => {
        const scope = {
          projectRoot,
          repoId: 'core',
          includeGenerated: false,
          includeVendor: false,
        };
        const seeds = [
          { moduleName: 'alpha', ownedFiles: ['src/one.ts'] },
          { moduleName: 'beta', ownedFiles: ['src/one.ts', 'src/two.ts'] },
          { moduleName: 'gamma', ownedFiles: ['src/two.ts'] },
          { moduleName: 'consumer', ownedFiles: ['src/consumer.ts'] },
        ];
        const modules = await Promise.all(
          seeds.map(async (seed) => {
            const result = await ProjectContext.execute({ kind: 'module', payload: seed, scope });
            return createProjectContextModuleMapModule({
              moduleContext: result.data as ModuleContext,
            });
          })
        );
        const forward = createProjectContextModuleDependencyRollups({ modules, scope });
        const reversed = createProjectContextModuleDependencyRollups({
          modules: modules.map((module) => ({ ...module, outflow: [...module.outflow].reverse() })),
          scope,
        });
        expect(forward).toHaveLength(2);
        expect(
          forward.every((rollup) => rollup.unresolved && !rollup.to && !rollup.externalName)
        ).toBe(true);
        expect(reversed).toStrictEqual(forward);
      }
    );
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
