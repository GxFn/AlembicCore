import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FOLDER_NAMES,
  resolveFolderNames,
  validateFolderNameSegment,
} from '../src/index.js';
import { ConfigLoader } from '../src/infrastructure/config/index.js';
import { WriteZone } from '../src/infrastructure/io/index.js';

describe('Core package baseline', () => {
  it('rejects folder name segments that would become paths', () => {
    expect(() => validateFolderNameSegment('../bad', 'project.runtime')).toThrow(
      'must be a single folder name'
    );
  });

  it('keeps folder name resolution immutable across calls', () => {
    const first = resolveFolderNames({ project: { recipes: 'recipes-a' } });
    const second = resolveFolderNames();

    expect(first.project.recipes).toBe('recipes-a');
    expect(second.project.recipes).toBe(DEFAULT_FOLDER_NAMES.project.recipes);
  });

  it('exposes stage 2 infrastructure entrypoints', () => {
    expect(ConfigLoader).toBeDefined();
    expect(WriteZone).toBeDefined();
  });
});
