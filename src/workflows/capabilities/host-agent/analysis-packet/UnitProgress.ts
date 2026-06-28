import { normalizeComparablePath, sortUnique, stableHash } from './StableIdentity.js';
import type {
  HostAgentAnalysisProgressSeed,
  HostAgentAnalysisUnit,
  HostAgentAnalysisUnitProgress,
  HostAgentStableUnitKey,
  HostAgentStableUnitKeyInput,
} from './Types.js';

export const STABLE_HOST_AGENT_ANALYSIS_UNIT_KEY_FORMAT =
  'qualifiedSourceRef/folder identity + fqn + entityType + optional line/symbol';

export function createHostAgentAnalysisUnitKey(
  input: HostAgentStableUnitKeyInput
): HostAgentStableUnitKey {
  const sourceRef = normalizeComparablePath(input.sourceRef);
  const qualifiedPath = input.qualifiedPath
    ? normalizeComparablePath(input.qualifiedPath)
    : undefined;
  const symbol = input.symbol?.trim() || undefined;
  const fqn = input.fqn?.trim() || undefined;
  const shortAlias = createShortAlias({ fqn, symbol, sourceRef });
  return {
    sourceRef,
    ...(input.projectScopeId ? { projectScopeId: input.projectScopeId } : {}),
    ...(input.folderId ? { folderId: input.folderId } : {}),
    ...(qualifiedPath ? { qualifiedPath } : {}),
    ...(fqn ? { fqn } : {}),
    entityType: input.entityType,
    ...(typeof input.line === 'number' ? { line: input.line } : {}),
    ...(symbol ? { symbol } : {}),
    key: `ide_unit_${stableHash({
      sourceRef: qualifiedPath ?? sourceRef,
      projectScopeId: input.projectScopeId,
      folderId: input.folderId,
      fqn,
      entityType: input.entityType,
      line: input.line,
      symbol,
    })}`,
    ...(shortAlias ? { shortAlias } : {}),
  };
}

export function createHostAgentAnalysisUnitProgress(
  unit: Pick<HostAgentAnalysisUnit, 'unitId' | 'dimensionId'>,
  overrides: Partial<Omit<HostAgentAnalysisUnitProgress, 'unitId'>> = {}
): HostAgentAnalysisUnitProgress {
  return {
    unitId: unit.unitId,
    status: overrides.status ?? 'pending',
    ...(overrides.claimedAt ? { claimedAt: overrides.claimedAt } : {}),
    ...(overrides.completedAt ? { completedAt: overrides.completedAt } : {}),
    submittedRecipeIds: [...(overrides.submittedRecipeIds ?? [])],
    referencedFiles: sortUnique(overrides.referencedFiles ?? []),
    rejectedReasons: [...(overrides.rejectedReasons ?? [])],
    ...(overrides.deviationReason ? { deviationReason: overrides.deviationReason } : {}),
    checkpoint: overrides.checkpoint ?? {
      dimensionId: unit.dimensionId,
      checkpointKind: 'dimension-checkpoint',
    },
  };
}

export function createHostAgentAnalysisProgressSeed({
  packetId,
  units,
}: {
  packetId: string;
  units: readonly HostAgentAnalysisUnit[];
}): HostAgentAnalysisProgressSeed {
  const unitProgress = units.map((unit) => createHostAgentAnalysisUnitProgress(unit));
  return {
    packetId,
    checkpointKind: 'ide-agent-analysis-unit-progress',
    totalUnits: units.length,
    remainingUnitIds: units.map((unit) => unit.unitId),
    unitProgress,
  };
}

export const createIDEAgentAnalysisUnitKey = createHostAgentAnalysisUnitKey;
export const createIDEAgentAnalysisUnitProgress = createHostAgentAnalysisUnitProgress;
export const createIDEAgentAnalysisProgressSeed = createHostAgentAnalysisProgressSeed;

function createShortAlias({
  fqn,
  symbol,
  sourceRef,
}: {
  fqn?: string;
  symbol?: string;
  sourceRef: string;
}): string | undefined {
  if (symbol) {
    return symbol.split('.').filter(Boolean).pop();
  }
  if (fqn) {
    return fqn.split('::').pop()?.split('.').filter(Boolean).pop();
  }
  return sourceRef.split('/').filter(Boolean).pop();
}
