import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getDiscovererRegistry,
  ProjectDiscoverer,
  resetDiscovererRegistry,
} from '../src/core/discovery/index.js';
import { createProjectDescriptor } from '../src/shared/index.js';
import { runPhase1_FileCollection } from '../src/workflows/capabilities/project-intelligence/ProjectIntelligenceRunner.js';

class WarningFixtureDiscoverer extends ProjectDiscoverer {
  #projectRoot = '';

  override get id() {
    return 'pcvm-warning-fixture';
  }

  override get displayName() {
    return 'PCVM Warning Fixture';
  }

  override async detect() {
    return { match: true, confidence: 999, reason: 'test fixture' };
  }

  override async load(projectRoot: string) {
    this.#projectRoot = projectRoot;
  }

  override async listTargets() {
    return [
      { name: 'app', path: this.#projectRoot, type: 'application' },
      { name: 'broken', path: this.#projectRoot, type: 'application' },
    ];
  }

  override async getTargetFiles(target: { name: string }) {
    if (target.name === 'broken') {
      throw new Error('target exploded');
    }
    return [
      {
        name: 'ok.ts',
        path: path.join(this.#projectRoot, 'ok.ts'),
        relativePath: 'ok.ts',
        language: 'typescript',
      },
      {
        name: 'unreadable.ts',
        path: path.join(this.#projectRoot, 'unreadable.ts'),
        relativePath: 'unreadable.ts',
        language: 'typescript',
      },
    ];
  }

  override async getDependencyGraph() {
    return { nodes: [], edges: [] };
  }
}

afterEach(() => {
  resetDiscovererRegistry();
});

describe('project intelligence file collection warnings', () => {
  it('surfaces unreadable files and target collection failures as warnings', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pcvm-file-warnings-'));
    await fs.writeFile(path.join(projectRoot, 'ok.ts'), 'export const ok = 1;');
    await fs.mkdir(path.join(projectRoot, 'unreadable.ts'));
    getDiscovererRegistry().register(new WarningFixtureDiscoverer());

    try {
      const result = await runPhase1_FileCollection(
        projectRoot,
        {
          info() {},
          warn() {},
        },
        { maxFiles: 10 }
      );

      expect(result.allFiles.map((file) => file.relativePath)).toEqual(['ok.ts']);
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('skipped unreadable file'),
          expect.stringContaining('skipped target broken'),
        ])
      );
    } finally {
      await fs.rm(projectRoot, { force: true, recursive: true });
    }
  });

  it('collects only ProjectScope source folders and excludes vendor snapshots', async () => {
    const controlRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pcv-project-scope-'));
    const coreRoot = path.join(controlRoot, 'AlembicCore');
    const pluginRoot = path.join(controlRoot, 'AlembicPlugin');
    await fs.mkdir(path.join(coreRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(coreRoot, 'vendor', 'Snapshot', 'src'), { recursive: true });
    await fs.mkdir(path.join(pluginRoot, 'lib'), { recursive: true });
    await fs.writeFile(path.join(coreRoot, 'package.json'), '{"name":"core"}');
    await fs.writeFile(path.join(pluginRoot, 'package.json'), '{"name":"plugin"}');
    await fs.writeFile(path.join(coreRoot, 'src', 'index.ts'), 'export const core = 1;');
    await fs.writeFile(
      path.join(coreRoot, 'vendor', 'Snapshot', 'src', 'index.ts'),
      'export const snapshot = 1;'
    );
    await fs.writeFile(path.join(pluginRoot, 'lib', 'index.ts'), 'export const plugin = 1;');

    const scope = createProjectDescriptor({
      controlRoot,
      dataRoot: path.join(controlRoot, '.ghost'),
      folders: [
        { id: 'folder-core', displayName: 'AlembicCore', path: coreRoot },
        { id: 'folder-plugin', displayName: 'AlembicPlugin', path: pluginRoot },
      ],
      projectScopeId: 'scope-fixture',
    });

    try {
      const result = await runPhase1_FileCollection(
        controlRoot,
        {
          info() {},
          warn() {},
        },
        { maxFiles: 20, projectScope: scope }
      );

      expect(result.allFiles.map((file) => file.sourceIdentity?.qualifiedPath).sort()).toEqual([
        'AlembicCore/src/index.ts',
        'AlembicPlugin/lib/index.ts',
      ]);
      expect(result.allFiles.map((file) => file.path).join('\n')).not.toContain('/vendor/');
    } finally {
      await fs.rm(controlRoot, { force: true, recursive: true });
    }
  });
});
