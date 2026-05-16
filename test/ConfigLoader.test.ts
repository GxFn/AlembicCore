import path from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import ConfigLoader from '../src/infrastructure/config/ConfigLoader.js';

describe('ConfigLoader', () => {
  beforeEach(() => {
    ConfigLoader.config = null;
    ConfigLoader.instance = null;
  });

  test('finds the @alembic/core package root', () => {
    expect(ConfigLoader._findPackageRoot()).toBe(path.resolve(import.meta.dirname, '..'));
  });

  test('loads a minimal config when bundled config files are absent', () => {
    const config = ConfigLoader.load('test');

    expect(config).toMatchObject({ env: 'test' });
    expect(ConfigLoader.get('env')).toBe('test');
    expect(ConfigLoader.has('env')).toBe(true);
    expect(ConfigLoader.has('database')).toBe(false);
  });

  test('deep merges nested config objects without merging arrays', () => {
    const merged = ConfigLoader._deepMerge(
      {
        database: { path: '.asd/alembic.db', pool: { min: 1, max: 4 } },
        features: ['core'],
      },
      {
        database: { pool: { max: 8 }, timeoutMs: 3000 },
        features: ['override'],
      }
    );

    expect(merged).toEqual({
      database: { path: '.asd/alembic.db', pool: { min: 1, max: 8 }, timeoutMs: 3000 },
      features: ['override'],
    });
  });

  test('sets and reads nested values with dot notation', () => {
    ConfigLoader.load('test');
    ConfigLoader.set('workspace.mode', 'ghost');

    expect(ConfigLoader.get('workspace.mode')).toBe('ghost');
  });

  test('throws on missing keys', () => {
    ConfigLoader.load('test');

    expect(() => ConfigLoader.get('this.does.not.exist')).toThrow('Config key not found');
  });
});
