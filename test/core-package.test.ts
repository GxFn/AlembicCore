import { describe, expect, it } from 'vitest';

import { resolveRecipeDimensionId } from '../src/domain/dimension/index.js';
import { EvolutionPolicy } from '../src/domain/evolution/EvolutionPolicy.js';
import {
  getAgentAdapterFieldSpec,
  getCursorDeliverySpec,
} from '../src/domain/knowledge/FieldSpec.js';
import {
  createExternalWorkflowSession,
  DEFAULT_FOLDER_NAMES,
  KnowledgeRepositoryImpl,
  ProjectIntelligenceCapability,
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

  it('exposes stage 3 domain entrypoints and compatibility aliases', () => {
    expect(resolveRecipeDimensionId({ dimensionId: 'architecture' })).toBe('architecture');
    expect(EvolutionPolicy.assessRisk('update', 0.8)).toBe('low');
    expect(getCursorDeliverySpec).toBe(getAgentAdapterFieldSpec);
    expect(getCursorDeliverySpec()).toStrictEqual(getAgentAdapterFieldSpec());
  });

  it('exposes stage 14 root package entrypoints for outer repository convergence', () => {
    expect(KnowledgeRepositoryImpl).toBeDefined();
    expect(ProjectIntelligenceCapability).toBeDefined();
    expect(createExternalWorkflowSession).toBeDefined();
  });
});
