import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestModeConfig } from '../src/shared/testMode.js';
import { buildWorkflowReport } from '../src/workflows/capabilities/persistence/WorkflowReportWriter.js';
import {
  buildGenerateTerminalPolicyHints,
  getGenerateStageTerminalTools,
  resolveGenerateTerminalToolset,
} from '../src/workflows/capabilities/planning/dimensions/GenerateTerminalToolset.js';

describe('GenerateTerminalToolset phantom terminal cleanup', () => {
  let oldToolset: string | undefined;

  beforeEach(() => {
    oldToolset = process.env.ALEMBIC_TERMINAL_TOOLSET;
  });

  afterEach(() => {
    if (oldToolset === undefined) {
      delete process.env.ALEMBIC_TERMINAL_TOOLSET;
    } else {
      process.env.ALEMBIC_TERMINAL_TOOLSET = oldToolset;
    }
  });

  it.each([
    'terminal-shell',
    'terminal-pty',
  ])('collapses legacy %s requests to live terminal run', (toolset) => {
    process.env.ALEMBIC_TERMINAL_TOOLSET = toolset;

    const config = resolveGenerateTerminalToolset();
    const hints = buildGenerateTerminalPolicyHints(config);

    expect(getTestModeConfig().terminal).toEqual({ enabled: true, toolset: 'terminal-run' });
    expect(config).toEqual({ enabled: true, toolset: 'terminal-run', modes: ['run'] });
    expect(getGenerateStageTerminalTools('analyze', config)).toEqual(['terminal']);
    expect(getGenerateStageTerminalTools('evolution', config)).toEqual(['terminal']);
    expect(JSON.stringify(hints)).not.toContain('terminal_shell');
    expect(JSON.stringify(hints)).not.toContain('terminal_pty');
  });

  it('keeps baseline as the only no-terminal bootstrap toolset', () => {
    process.env.ALEMBIC_TERMINAL_TOOLSET = 'baseline';

    const config = resolveGenerateTerminalToolset();

    expect(config).toEqual({ enabled: false, toolset: 'baseline', modes: [] });
    expect(getGenerateStageTerminalTools('analyze', config)).toEqual([]);
    expect(getGenerateStageTerminalTools('evolution', config)).toEqual([]);
  });

  it('does not project retired terminal ids as report terminal capability', () => {
    const report = buildWorkflowReport({
      sessionId: 'session-terminal-cleanup',
      projectInfo: { name: 'fixture', fileCount: 1, lang: 'ts' },
      dimensionStats: {
        architecture: {
          diagnostics: {
            stageToolsets: [
              {
                stage: 'analyze',
                source: 'bootstrap',
                allowedToolIds: ['terminal', 'terminal_shell', 'terminal_pty', 'code.read'],
              },
            ],
            toolCalls: [
              { tool: 'terminal_shell', status: 'success', ok: true, durationMs: 5 },
              { tool: 'terminal_pty', status: 'success', ok: true, durationMs: 5 },
              { tool: 'terminal', status: 'success', ok: true, durationMs: 5 },
            ],
          },
        },
      },
      candidateResults: { created: 0, failed: 0, errors: [] },
      skillResults: { created: 0, failed: 0, errors: [] },
      consolidationResult: null,
      skippedDims: [],
      incrementalSkippedDims: [],
      isIncremental: false,
      incrementalPlan: null,
      totalTimeMs: 1_000,
      totalTokenUsage: { input: 0, output: 0 },
      totalToolCalls: 3,
    });

    const stageToolsets = report.stageToolsets as Array<{ allowedToolIds: string[] }>;
    const terminal = report.terminal as { commands: Array<{ tool: string }> };

    expect(report.session?.terminalCapability).toBe('terminal-run');
    expect(stageToolsets[0]?.allowedToolIds).toEqual(['terminal', 'code.read']);
    expect(terminal.commands.map((command) => command.tool)).toEqual(['terminal']);
    expect(JSON.stringify(stageToolsets)).not.toContain('terminal_shell');
    expect(JSON.stringify(stageToolsets)).not.toContain('terminal_pty');
    expect(JSON.stringify(terminal)).not.toContain('terminal_shell');
    expect(JSON.stringify(terminal)).not.toContain('terminal_pty');
  });
});
