export const HOST_AGENT_SOURCE = 'host-agent';
export const ALEMBIC_AGENT_SOURCE = 'alembic-agent';
export const LEGACY_IDE_AGENT_SOURCE = 'ide-agent';
export const HOST_EDIT_SOURCE = 'host-edit';
export const LEGACY_IDE_EDIT_SOURCE = 'ide-edit';

export type LegacyAgentSource = typeof LEGACY_IDE_AGENT_SOURCE;
export type HostAgentSource = typeof HOST_AGENT_SOURCE;
export type AlembicAgentSource = typeof ALEMBIC_AGENT_SOURCE;
export type CanonicalProposalSource =
  | HostAgentSource
  | AlembicAgentSource
  | 'metabolism'
  | 'decay-scan'
  | 'consolidation'
  | 'relevance-audit'
  | 'file-change'
  | 'rescan-evolution';
export type ProposalSource = CanonicalProposalSource | LegacyAgentSource;

export type GatewaySource =
  | 'agent-tool'
  | 'mcp-external'
  | HostAgentSource
  | AlembicAgentSource
  | LegacyAgentSource
  | 'batch-import';
export type CanonicalGatewaySource = Exclude<GatewaySource, LegacyAgentSource>;

export type LegacyFileChangeEventSource = typeof LEGACY_IDE_EDIT_SOURCE;
export type HostEditSource = typeof HOST_EDIT_SOURCE;
export type CanonicalFileChangeEventSource = HostEditSource | 'git-head' | 'git-worktree';
export type FileChangeEventSource = CanonicalFileChangeEventSource | LegacyFileChangeEventSource;

export function isLegacyAgentSource(source: string): source is LegacyAgentSource {
  return source === LEGACY_IDE_AGENT_SOURCE;
}

export function normalizeProposalSource(source: ProposalSource): CanonicalProposalSource {
  return source === LEGACY_IDE_AGENT_SOURCE ? HOST_AGENT_SOURCE : source;
}

export function proposalSourceStorageValues(source: ProposalSource): ProposalSource[] {
  const canonical = normalizeProposalSource(source);
  if (canonical === HOST_AGENT_SOURCE) {
    return [HOST_AGENT_SOURCE, LEGACY_IDE_AGENT_SOURCE];
  }
  return [canonical];
}

export function getProposalSourceLabel(source: ProposalSource): string {
  return normalizeProposalSource(source);
}

export function normalizeGatewaySource(source: GatewaySource): CanonicalGatewaySource {
  return source === LEGACY_IDE_AGENT_SOURCE ? HOST_AGENT_SOURCE : source;
}

export function getGatewaySourceUserId(source: GatewaySource): string {
  switch (normalizeGatewaySource(source)) {
    case 'agent-tool':
      return 'agent';
    case 'mcp-external':
      return 'mcp';
    case HOST_AGENT_SOURCE:
      return HOST_AGENT_SOURCE;
    case ALEMBIC_AGENT_SOURCE:
      return ALEMBIC_AGENT_SOURCE;
    case 'batch-import':
      return 'batch-import';
  }
}

export function getGatewaySourceLabel(source: GatewaySource): string {
  switch (normalizeGatewaySource(source)) {
    case 'agent-tool':
      return 'agent';
    case 'mcp-external':
      return 'mcp';
    case HOST_AGENT_SOURCE:
      return HOST_AGENT_SOURCE;
    case ALEMBIC_AGENT_SOURCE:
      return ALEMBIC_AGENT_SOURCE;
    case 'batch-import':
      return 'batch-import';
  }
}

export function isLegacyFileChangeEventSource(
  source: string
): source is LegacyFileChangeEventSource {
  return source === LEGACY_IDE_EDIT_SOURCE;
}

export function normalizeFileChangeEventSource(
  source: FileChangeEventSource | null | undefined
): CanonicalFileChangeEventSource {
  return !source || source === LEGACY_IDE_EDIT_SOURCE ? HOST_EDIT_SOURCE : source;
}

export function getFileChangeEventSourceLabel(source: FileChangeEventSource): string {
  return normalizeFileChangeEventSource(source);
}
