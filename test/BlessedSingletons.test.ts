/**
 * P2 AD4 Core leg — blessed-singleton list drift gate.
 *
 * config/blessed-singletons.json is the EXHAUSTIVE doctrine exception set
 * (AD0: a module-scope singleton not on this list is a violation, never an
 * implicit exception). This suite pins the list's field contract, verifies
 * every blessed module and claimed reset hook actually exists in source,
 * and keeps the design-named doctrine examples honest (Logger, pathGuard,
 * timerRegistry in-repo; ModelRegistry explicitly not).
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const config = JSON.parse(
  readFileSync(fileURLToPath(new URL('../config/blessed-singletons.json', import.meta.url)), 'utf8')
);

function repoPath(relative: string): string {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url));
}

describe('Blessed singletons (config/blessed-singletons.json)', () => {
  test('every entry carries the full doctrine contract', () => {
    expect(config.blessed.length).toBeGreaterThan(0);
    for (const entry of config.blessed) {
      for (const field of ['id', 'module', 'export', 'kind', 'owner', 'reason', 'lifecycle']) {
        expect(entry[field], `${entry.id ?? '?'} missing ${field}`).toBeTruthy();
      }
      expect(entry, `${entry.id} must declare resetHook (value or null)`).toHaveProperty(
        'resetHook'
      );
    }
  });

  test('every blessed single-module entry points at an existing file', () => {
    for (const entry of config.blessed) {
      // Family entries name multiple modules; check the first concrete path.
      const firstModule = entry.module.split(',')[0].trim().split(' ')[0];
      const probe = firstModule.includes('*')
        ? firstModule.slice(0, firstModule.indexOf('*')).replace(/\/$/, '')
        : firstModule;
      expect(existsSync(repoPath(probe)), `${entry.id}: ${probe}`).toBe(true);
    }
  });

  test('claimed reset hooks exist in their source modules', () => {
    const hookProbes: Array<[string, string, string]> = [
      ['path-guard', 'src/shared/PathGuard.ts', '_reset'],
      ['timer-registry', 'src/shared/TimerRegistry.ts', '_resetForTesting'],
      ['drizzle-handle', 'src/infrastructure/database/drizzle/index.ts', 'resetDrizzle'],
      ['discoverer-registry', 'src/core/discovery/index.ts', 'resetDiscovererRegistry'],
      ['ast-analyzer-caches', 'src/core/AstAnalyzer.ts', '_resetAstParserCacheForTesting'],
      ['memo-caches', 'src/shared/isOwnDevRepo.ts', '_resetDevRepoCache'],
      [
        'bootstrap-session-manager',
        'src/workflows/surfaces/host-agent/session/SessionSupport.ts',
        '_resetGenerateSessionManagersForTesting',
      ],
    ];
    for (const [id, module, hook] of hookProbes) {
      const entry = config.blessed.find((candidate: { id: string }) => candidate.id === id);
      expect(entry, id).toBeTruthy();
      expect(entry.resetHook, `${id} resetHook field`).toContain(hook);
      expect(readFileSync(repoPath(module), 'utf8'), `${id}: ${hook} in ${module}`).toContain(hook);
    }
  });

  test('design-named doctrine examples are dispositioned: three blessed, ModelRegistry not ours', () => {
    const ids = config.blessed.map((entry: { id: string }) => entry.id);
    expect(ids).toContain('logger');
    expect(ids).toContain('path-guard');
    expect(ids).toContain('timer-registry');
    // ModelRegistry lives in AlembicAgent — recorded, never silently blessed here.
    expect(config.notInThisRepo['ModelRegistry/getModelRegistry']).toContain('AlembicAgent');
    expect(JSON.stringify(config.blessed)).not.toContain('ModelRegistry');
  });

  test('the parser-cache reset hook works (policy is real, not prose)', async () => {
    const analyzer = await import('../src/core/AstAnalyzer.js');
    expect(typeof analyzer._resetAstParserCacheForTesting).toBe('function');
    expect(() => analyzer._resetAstParserCacheForTesting()).not.toThrow();
  });
});
