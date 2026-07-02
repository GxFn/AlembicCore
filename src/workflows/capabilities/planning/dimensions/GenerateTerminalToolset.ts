import { getTestModeConfig } from '../../../../shared/testMode.js';

export type GenerateTerminalToolset = 'baseline' | 'terminal-run';

export type GenerateTerminalMode = 'run';

export interface GenerateTerminalToolsetConfig {
  enabled: boolean;
  toolset: GenerateTerminalToolset;
  modes: GenerateTerminalMode[];
}

const TOOLSET_MODES: Record<GenerateTerminalToolset, GenerateTerminalMode[]> = {
  baseline: [],
  'terminal-run': ['run'],
};

const ANALYZE_TOOLS: Record<GenerateTerminalMode, string> = {
  run: 'terminal',
};

const EVOLUTION_TOOLS: Record<GenerateTerminalMode, string> = {
  run: 'terminal',
};

export function resolveGenerateTerminalToolset(): GenerateTerminalToolsetConfig {
  const terminalCfg = getTestModeConfig().terminal;
  const envToolset = terminalCfg.toolset;
  const requestedToolset = normalizeToolset(envToolset);

  const toolset = requestedToolset || 'terminal-run';
  const enabled = toolset !== 'baseline';
  const defaultModes = TOOLSET_MODES[toolset];

  return {
    enabled,
    toolset,
    modes: [...defaultModes],
  };
}

export function getGenerateStageTerminalTools(
  stageName: string,
  config: GenerateTerminalToolsetConfig
): string[] {
  if (!config.enabled || config.toolset === 'baseline') {
    return [];
  }

  if (stageName === 'analyze') {
    return config.modes.map((mode) => ANALYZE_TOOLS[mode]).filter(Boolean);
  }

  if (stageName === 'evolve' || stageName === 'evolution') {
    return config.modes.map((mode) => EVOLUTION_TOOLS[mode]).filter(Boolean);
  }

  return [];
}

export function buildGenerateTerminalPolicyHints(config: GenerateTerminalToolsetConfig) {
  return {
    terminalCapability: {
      enabled: config.enabled,
      toolset: config.toolset,
      modes: [...config.modes],
      scriptAllowed: false,
    },
    constraints: [
      'Terminal tools are optional code-analysis evidence tools for analyze/evolve only.',
      'Use terminal({ action: "exec" }) for approved read-only evidence commands.',
      'No installs, network operations, project writes, deletions, chmod/chown, sudo, or daemons.',
    ],
  };
}

function normalizeToolset(value: unknown): GenerateTerminalToolset | null {
  if (value === 'baseline' || value === 'terminal-run') {
    return value;
  }
  if (value === 'terminal-shell' || value === 'terminal-pty') {
    return 'terminal-run';
  }
  return null;
}
