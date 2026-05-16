import { describe, expect, it } from 'vitest';

import {
  createAlembicRuntime,
  DEFAULT_FOLDER_NAMES,
  resolveFolderNames,
  validateFolderNameSegment,
} from '../src/index.js';

describe('Core package baseline', () => {
  it('exports the initial runtime contract', () => {
    const runtime = createAlembicRuntime({
      projectRoot: '/tmp/project',
      folderNames: {
        project: {
          knowledgeBase: 'Knowledge',
        },
      },
    });

    expect(runtime.projectRoot).toBe('/tmp/project');
    expect(runtime.dataRoot).toBe('/tmp/project');
    expect(runtime.folderNames.project.knowledgeBase).toBe('Knowledge');
    expect(runtime.folderNames.project.runtime).toBe(DEFAULT_FOLDER_NAMES.project.runtime);
  });

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
});
