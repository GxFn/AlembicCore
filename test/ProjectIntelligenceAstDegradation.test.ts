import { describe, expect, it, vi } from 'vitest';

import { runPhase1_5_AstAnalysis } from '../src/workflows/capabilities/project-intelligence/ProjectIntelligenceRunner.js';

describe('project intelligence AST degradation', () => {
  it('surfaces analyzer failures as deterministic degraded warnings', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    const result = await runPhase1_5_AstAnalysis(
      [
        {
          content: 'export const value = 1;',
          isTest: false,
          name: 'fixture.ts',
          path: '/tmp/fixture.ts',
          relativePath: 'fixture.ts',
          targetName: 'app',
        },
      ],
      { ts: 1 },
      logger,
      {
        analyzeProject: () => {
          throw new Error('pcvm ast fixture exploded');
        },
        isAstAvailable: () => true,
      }
    );

    expect(result).toMatchObject({
      astContext: '',
      astProjectSummary: null,
      warnings: ['AST analysis partially failed: pcvm ast fixture exploded'],
    });
    expect(logger.warn).toHaveBeenCalledWith(
      '[Bootstrap] AST analysis failed (degraded): pcvm ast fixture exploded'
    );
  });
});
