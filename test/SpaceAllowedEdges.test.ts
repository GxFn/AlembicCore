/**
 * P2 AD1 pA1 — space allowed-edge config validity gate.
 *
 * config/space-allowed-edges.json is the canonical space DAG that every
 * repo's boundary gate consumes read-only. This suite pins the verified
 * P0 §2 facts (Core ← Agent ← Alembic; Core ← Plugin; Dashboard
 * zero-package-dependency), the acyclicity of the declared graph, the
 * allowlist field contract, and the toolchain floor's consistency with
 * Core's own manifest (floors record facts, never aspirations).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const config = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../config/space-allowed-edges.json', import.meta.url)),
    'utf8'
  )
);
const corePkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
);

describe('Space allowed-edge config (config/space-allowed-edges.json)', () => {
  test('encodes the verified P0 §2 DAG exactly', () => {
    expect(config.repos.alembicCore.allowedDependencies).toEqual([]);
    expect(config.repos.alembicAgent.allowedDependencies).toEqual(['@alembic/core']);
    expect(config.repos.alembic.allowedDependencies).toEqual(['@alembic/core', '@alembic/agent']);
    expect(config.repos.alembicDashboard.allowedDependencies).toEqual([]);
    expect(config.repos.alembicDashboard.zeroPackageDependency).toBe(true);
    expect(config.repos.alembicPlugin.allowedDependencies).toEqual(['@alembic/core']);
  });

  test('the declared graph is acyclic', () => {
    const packageToRepo = new Map(
      Object.entries(config.repos as Record<string, { packageName: string }>).map(
        ([repo, entry]) => [entry.packageName, repo]
      )
    );
    const visiting = new Set<string>();
    const visited = new Set<string>();
    function visit(repo: string) {
      expect(visiting.has(repo), `cycle through ${repo}`).toBe(false);
      if (visited.has(repo)) {
        return;
      }
      visiting.add(repo);
      for (const dependency of config.repos[repo].allowedDependencies as string[]) {
        const target = packageToRepo.get(dependency);
        expect(target, `unknown package ${dependency}`).toBeTruthy();
        visit(target!);
      }
      visiting.delete(repo);
      visited.add(repo);
    }
    for (const repo of Object.keys(config.repos)) {
      visit(repo);
    }
  });

  test('Core itself honors its empty edge set (manifest fact)', () => {
    const declared = { ...corePkg.dependencies, ...corePkg.devDependencies };
    const spaceDeps = Object.keys(declared).filter(
      (name) => name.startsWith('@alembic/') || name === 'alembic'
    );
    expect(spaceDeps).toEqual([]);
  });

  test('exact-edge allowlist entries carry the full owner contract', () => {
    expect(Array.isArray(config.exactEdgeAllowlist)).toBe(true);
    for (const entry of config.exactEdgeAllowlist) {
      for (const field of ['repo', 'dependency', 'owner', 'reason', 'cleanupTrigger']) {
        expect(entry[field], `allowlist entry missing ${field}`).toBeTruthy();
      }
    }
  });

  test('toolchain floor matches Core manifest facts (no aspirational floors)', () => {
    expect(config.toolchainFloor.node).toBe(corePkg.engines.node);
    expect(corePkg.devDependencies.typescript.replace('^', '')).toMatch(/^5\.9\./);
    expect(config.toolchainFloor.typescript).toBe('5.9.x');
    expect(corePkg.devDependencies['@biomejs/biome']).toBe(config.toolchainFloor.biome);
    expect(
      Number(corePkg.devDependencies.vitest.replace(/[^0-9.]/g, '').split('.')[0])
    ).toBeGreaterThanOrEqual(4);
    // The drift rule is recorded with the floor.
    expect(config.toolchainFloor.description).toMatch(/[Dd]rift note rule/);
  });

  test('every repo entry names a charter and the consumer contract names every stage', () => {
    for (const [repo, entry] of Object.entries(
      config.repos as Record<string, { charter?: string }>
    )) {
      expect(entry.charter, `${repo} charter`).toBeTruthy();
      expect(config.consumerContract.stages[repo], `${repo} stage`).toBeTruthy();
    }
    // Plugin participates as an owner+trigger record only until CKG resumes.
    expect(config.consumerContract.stages.alembicPlugin).toMatch(/owner.*trigger|post-CKG|CKG/i);
  });
});
