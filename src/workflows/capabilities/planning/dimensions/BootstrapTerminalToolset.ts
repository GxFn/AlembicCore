import { getTestModeConfig } from '../../../../shared/testMode.js';

export type BootstrapTerminalToolset = 'baseline' | 'terminal-run';

export type BootstrapTerminalMode = 'run';

export interface BootstrapTerminalToolsetConfig {
  enabled: boolean;
  toolset: BootstrapTerminalToolset;
  modes: BootstrapTerminalMode[];
}

const TOOLSET_MODES: Record<BootstrapTerminalToolset, BootstrapTerminalMode[]> = {
  baseline: [],
  'terminal-run': ['run'],
};

const ANALYZE_TOOLS: Record<BootstrapTerminalMode, string> = {
  run: 'terminal',
};

const EVOLUTION_TOOLS: Record<BootstrapTerminalMode, string> = {
  run: 'terminal',
};

export function resolveBootstrapTerminalToolset(): BootstrapTerminalToolsetConfig {
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

export function getBootstrapStageTerminalTools(
  stageName: string,
  config: BootstrapTerminalToolsetConfig
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

export function buildBootstrapTerminalPolicyHints(config: BootstrapTerminalToolsetConfig) {
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

function normalizeToolset(value: unknown): BootstrapTerminalToolset | null {
  if (value === 'baseline' || value === 'terminal-run') {
    return value;
  }
  if (value === 'terminal-shell' || value === 'terminal-pty') {
    return 'terminal-run';
  }
  return null;
}
