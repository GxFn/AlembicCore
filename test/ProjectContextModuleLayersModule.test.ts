import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  ModuleContext,
  ModuleLayerContext,
  ProjectContextUnavailableData,
} from '../src/domain/project-context/index.js';
import { ProjectContext } from '../src/project-context.js';

describe('ProjectContext PCQ-5 module-layers and module', () => {
  it('returns local module layers, file groups, boundary crossings, and drill-down refs', async () => {
    await withFixture(createModuleFixture(), async (projectRoot) => {
      const envelope = await ProjectContext.execute({
        kind: 'module-layers',
        payload: createFeaturePayload(),
        scope: { projectRoot, repoId: 'core' },
      });
      const data = envelope.data as ModuleLayerContext;

      expect(envelope.errors).toBeUndefined();
      expect(data.module).toMatchObject({
        kind: 'source-module',
        name: 'feature',
        ownedFileCount: 3,
        role: 'interface',
      });
      expect(data.fileGroups.map((group) => group.name)).toEqual(['api', 'domain', 'service']);
      expect(data.layers.map((layer) => layer.fileGroups)).toEqual([
        ['domain'],
        ['service'],
        ['api'],
      ]);
      expect(data.boundaryCrossings).toContainEqual(
        expect.objectContaining({
          kind: 'imports',
          to: expect.objectContaining({ label: 'src/shared/format.ts' }),
        })
      );
      expect(data.nextRefs.some((ref) => ref.kind === 'module')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'module-layer')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'relation-site')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'source-slice')).toBe(true);
    });
  });

  it('returns one-module context from owned files and file-level facts', async () => {
    await withFixture(createModuleFixture(), async (projectRoot) => {
      const envelope = await ProjectContext.execute({
        kind: 'module',
        payload: createFeaturePayload(),
        scope: { projectRoot, repoId: 'core' },
      });
      const data = envelope.data as ModuleContext;

      expect(envelope.errors).toBeUndefined();
      expect(data.module).toMatchObject({
        name: 'feature',
        ownedFileCount: 3,
        role: 'interface',
      });
      expect(data.ownedFiles.map((file) => file.filePath)).toEqual([
        'src/feature/api/index.ts',
        'src/feature/domain/model.ts',
        'src/feature/service/run.ts',
      ]);
      expect(data.publicSurfaces.map((surface) => surface.qualifiedName ?? surface.name)).toEqual(
        expect.arrayContaining(['FeatureInput', 'FeatureService', 'createFeature'])
      );
      expect(data.outflow).toContainEqual(
        expect.objectContaining({
          kind: 'imports',
          to: expect.objectContaining({ label: 'src/shared/format.ts' }),
        })
      );
      expect(data.inflow).toEqual([]);
      expect(data.nextRefs.some((ref) => ref.kind === 'module-layer')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'file-symbol')).toBe(true);
      expect(data.nextRefs.some((ref) => ref.kind === 'relation-site')).toBe(true);
    });
  });

  it('stays deterministic and reports ordinary errors for missing module seeds', async () => {
    await withFixture(createModuleFixture(), async (projectRoot) => {
      const left = await ProjectContext.execute({
        kind: 'module-layers',
        payload: createFeaturePayload(),
        scope: { projectRoot },
      });
      const right = await ProjectContext.execute({
        kind: 'module-layers',
        payload: {
          moduleName: 'feature',
          modulePath: 'src/feature',
          ownedFiles: [
            'src/feature/service/run.ts',
            'src/feature/api/index.ts',
            'src/feature/domain/model.ts',
          ],
        },
        scope: { projectRoot },
      });
      const missing = await ProjectContext.execute({
        kind: 'module',
        payload: {
          moduleName: 'missing',
          ownedFiles: ['src/feature/missing.ts'],
        },
        scope: { projectRoot },
      });

      expect(left).toStrictEqual(right);
      expect(missing.errors?.[0]?.code).toBe('not-found');
      expect((missing.data as ProjectContextUnavailableData).available).toBe(false);
    });
  });
});

function createFeaturePayload(): {
  moduleName: string;
  modulePath: string;
  ownedFiles: string[];
} {
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

function createModuleFixture(): Record<string, string> {
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
      'export function formatFeature(name: string): string {',
      '  return name.trim();',
      '}',
    ].join('\n'),
  };
}

async function withFixture(
  files: Record<string, string>,
  callback: (projectRoot: string) => Promise<void>
): Promise<void> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-context-module-'));
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
