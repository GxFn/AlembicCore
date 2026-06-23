import { DIMENSION_REGISTRY, type UnifiedDimension } from '../../../domain/dimension/index.js';
import type {
  DynamicPlanningSignal,
  DynamicSignalGatewayInput,
  DynamicSignalReport,
  ModuleChange,
  ModuleCoverageQueryInput,
  ModuleCoverageReport,
  ModuleDeltaDetectorInput,
  ModuleDeltaReport,
  ModuleDeltaSnapshot,
  ModuleDimensionCoverage,
  ModuleRenameCandidate,
} from './contracts.js';

export type * from './contracts.js';

const DEFAULT_MODULE_RENAME_SIMILARITY_THRESHOLD = 0.9;
const DEFAULT_MODULE_COVERAGE_TARGET = 2;

export class ModuleDeltaDetector {
  detect(input: ModuleDeltaDetectorInput): ModuleDeltaReport {
    return detectModuleDelta(input);
  }
}

export class DynamicSignalGateway {
  aggregate(input: DynamicSignalGatewayInput): DynamicSignalReport {
    return aggregateDynamicPlanningSignals(input);
  }
}

export function aggregateDynamicPlanningSignals(
  input: DynamicSignalGatewayInput
): DynamicSignalReport {
  const moduleDelta = input.moduleDelta ? detectModuleDelta(input.moduleDelta) : emptyModuleDelta();
  const coverage = input.moduleCoverage
    ? queryPerModuleCoverage(input.moduleCoverage)
    : queryPerModuleCoverage({ records: [] });
  const planSignals: DynamicPlanningSignal[] = [];
  const proposalByStatus = countBy(input.proposals ?? [], (proposal) => proposal.status ?? 'open');
  const proposalByType = countBy(input.proposals ?? [], (proposal) => proposal.type ?? 'unknown');
  const activeProposals = (input.proposals ?? []).filter((proposal) =>
    isActiveStatus(proposal.status)
  );
  for (const proposal of activeProposals) {
    planSignals.push({
      kind: 'proposal',
      priority: Math.round((proposal.confidence ?? 0.5) * 100),
      dimensionIds: inferDimensionIdsFromText(
        `${proposal.type ?? ''} ${proposal.description ?? ''} ${JSON.stringify(
          proposal.evidence ?? []
        )}`
      ),
      moduleIds: [],
      recipeIds: [proposal.targetRecipeId, ...(proposal.relatedRecipeIds ?? [])].filter(isPresent),
      reason: proposal.description ?? `active proposal ${proposal.id}`,
    });
  }

  const openDecaySignals = (input.decaySignals ?? []).filter((signal) =>
    isActiveDecayStatus(signal.status)
  );
  for (const signal of openDecaySignals) {
    planSignals.push({
      kind: 'decay',
      priority: Math.round((signal.confidence ?? 0.5) * 90),
      dimensionIds: inferDimensionIdsFromText(
        `${signal.description ?? ''} ${JSON.stringify(signal.evidence ?? [])}`
      ),
      moduleIds: [],
      recipeIds: [signal.targetRecipeId].filter(isPresent),
      reason: signal.description ?? `open decay signal ${signal.id}`,
    });
  }

  for (const item of input.dimensionCoverage ?? []) {
    const gap = Math.max(0, item.targetCount - item.existingCount);
    if (gap <= 0 && (item.decayingRecipeIds?.length ?? 0) === 0) {
      continue;
    }
    planSignals.push({
      kind: 'coverage-gap',
      priority: 70 + Math.min(20, gap * 4) + (item.decayingRecipeIds?.length ?? 0),
      dimensionIds: [item.dimensionId],
      moduleIds: [],
      recipeIds: [...(item.decayingRecipeIds ?? [])],
      reason: `dimension ${item.dimensionId} coverage ${item.existingCount}/${item.targetCount}`,
    });
  }

  for (const gap of coverage.gaps) {
    planSignals.push({
      kind: 'coverage-gap',
      priority: gap.status === 'missing' ? 80 : 65,
      dimensionIds: [gap.dimensionId],
      moduleIds: [gap.moduleId],
      recipeIds: [],
      reason: `module ${gap.moduleId} has ${gap.status} coverage for ${gap.dimensionId}`,
    });
  }

  for (const change of moduleDelta.added) {
    planSignals.push({
      kind: 'new-module',
      priority: 75,
      dimensionIds: ['architecture'],
      moduleIds: [change.moduleId],
      recipeIds: [],
      reason: `new module ${change.moduleName}`,
    });
  }
  for (const change of moduleDelta.changed) {
    planSignals.push({
      kind: 'changed-module',
      priority: 60 + Math.min(15, change.changedFiles.length * 3),
      dimensionIds: ['architecture'],
      moduleIds: [change.moduleId],
      recipeIds: [],
      reason: `changed module ${change.moduleName}`,
    });
  }

  const hotspotModuleIds =
    input.architectureIntelligence?.complexity.hotspots.map((hotspot) => hotspot.moduleId) ?? [];
  for (const moduleId of hotspotModuleIds) {
    planSignals.push({
      kind: 'hotspot',
      priority: 72,
      dimensionIds: ['architecture', 'performance-optimization'],
      moduleIds: [moduleId],
      recipeIds: [],
      reason: `complexity hotspot ${moduleId}`,
    });
  }

  return Object.freeze({
    proposals: Object.freeze({
      activeCount: activeProposals.length,
      byStatus: Object.freeze(proposalByStatus),
      byType: Object.freeze(proposalByType),
    }),
    decay: Object.freeze({
      openCount: openDecaySignals.length,
      affectedRecipeIds: Object.freeze(
        openDecaySignals.map((signal) => signal.targetRecipeId).filter(isPresent)
      ),
    }),
    coverage,
    moduleDelta,
    hotspotModuleIds: Object.freeze([...hotspotModuleIds].sort()),
    planSignals: Object.freeze(planSignals.sort(comparePlanSignals)),
  });
}

export function detectModuleDelta(input: ModuleDeltaDetectorInput): ModuleDeltaReport {
  const previousById = new Map(input.previousModules.map((module) => [module.moduleId, module]));
  const currentById = new Map(input.currentModules.map((module) => [module.moduleId, module]));
  const changedFileSet = new Set(input.changedFiles ?? []);
  const added: ModuleChange[] = [];
  const changed: ModuleChange[] = [];
  const removed: ModuleChange[] = [];

  for (const current of input.currentModules) {
    const previous = previousById.get(current.moduleId);
    if (!previous) {
      added.push(moduleChange('added', current.moduleId, current.moduleName, undefined, current));
      continue;
    }
    const changedFiles = resolveModuleChangedFiles(previous, current, changedFileSet);
    if (changedFiles.length > 0 || previous.fingerprint !== current.fingerprint) {
      changed.push({
        ...moduleChange('changed', current.moduleId, current.moduleName, previous, current),
        changedFiles,
      });
    }
  }

  for (const previous of input.previousModules) {
    if (!currentById.has(previous.moduleId)) {
      removed.push(moduleChange('removed', previous.moduleId, previous.moduleName, previous));
    }
  }

  const threshold = input.renameSimilarityThreshold ?? DEFAULT_MODULE_RENAME_SIMILARITY_THRESHOLD;
  const renameCandidates = removed
    .flatMap((removedChange) =>
      added.map((addedChange) =>
        buildRenameCandidate(removedChange.previous!, addedChange.current!, threshold)
      )
    )
    .filter(isPresent)
    .sort(
      (a, b) => b.similarity - a.similarity || a.previousModuleId.localeCompare(b.previousModuleId)
    );
  const affectedModuleIds = uniqueSorted([
    ...added.map((item) => item.moduleId),
    ...changed.map((item) => item.moduleId),
    ...removed.map((item) => item.moduleId),
  ]);

  return Object.freeze({
    added: Object.freeze(added.sort(compareModuleChange)),
    changed: Object.freeze(changed.sort(compareModuleChange)),
    removed: Object.freeze(removed.sort(compareModuleChange)),
    renameCandidates: Object.freeze(renameCandidates),
    affectedModuleIds: Object.freeze(affectedModuleIds),
  });
}

export function queryPerModuleCoverage(input: ModuleCoverageQueryInput): ModuleCoverageReport {
  const target = input.targetPerModuleDimension ?? DEFAULT_MODULE_COVERAGE_TARGET;
  const moduleFilter = input.moduleIds ? new Set(input.moduleIds) : null;
  const dimensionFilter = input.dimensionIds ? new Set(input.dimensionIds) : null;
  const moduleIds = uniqueSorted([
    ...(input.moduleIds ?? []),
    ...input.records.map((record) => record.moduleId),
  ]).filter((moduleId) => !moduleFilter || moduleFilter.has(moduleId));
  const dimensionIds = uniqueSorted([
    ...(input.dimensionIds ?? []),
    ...input.records.map((record) => record.dimensionId),
  ]).filter((dimensionId) => !dimensionFilter || dimensionFilter.has(dimensionId));
  const records = input.records.filter(
    (record) =>
      (!moduleFilter || moduleFilter.has(record.moduleId)) &&
      (!dimensionFilter || dimensionFilter.has(record.dimensionId))
  );
  const moduleNames = new Map(
    records
      .filter((record) => record.moduleName)
      .map((record) => [record.moduleId, record.moduleName as string])
  );
  const byModule = moduleIds.map(
    (
      moduleId
    ): { moduleId: string; moduleName?: string; dimensions: ModuleDimensionCoverage[] } => {
      const dimensions = dimensionIds.map((dimensionId) => {
        const matching = records.filter(
          (record) => record.moduleId === moduleId && record.dimensionId === dimensionId
        );
        const healthy = matching.filter((record) => isHealthyCoverageStatus(record.status));
        const decaying = matching.filter((record) => record.status === 'decaying');
        const healthyCount = healthy.length;
        const gap = Math.max(0, target - healthyCount);
        const status: ModuleDimensionCoverage['status'] =
          healthyCount === 0 ? 'missing' : gap > 0 ? 'weak' : 'covered';
        return {
          dimensionId,
          healthyCount,
          decayingCount: decaying.length,
          recipeIds: uniqueSorted(matching.map((record) => record.recipeId)),
          sourceRefs: uniqueSorted(matching.flatMap((record) => record.sourceRefs ?? [])),
          gap,
          status,
        };
      });
      return {
        moduleId,
        moduleName: moduleNames.get(moduleId),
        dimensions,
      };
    }
  );
  const gaps = byModule.flatMap((module) =>
    module.dimensions
      .filter((dimension) => dimension.status !== 'covered')
      .map((dimension) => ({
        moduleId: module.moduleId,
        moduleName: module.moduleName,
        dimensionId: dimension.dimensionId,
        gap: dimension.gap,
        status: dimension.status as 'weak' | 'missing',
      }))
  );

  return Object.freeze({
    targetPerModuleDimension: target,
    byModule: Object.freeze(byModule),
    gaps: Object.freeze(gaps.sort((a, b) => b.gap - a.gap || a.moduleId.localeCompare(b.moduleId))),
  });
}

function queryIdsForDimension(dimension: UnifiedDimension): readonly string[] {
  return uniqueSorted([dimension.id, ...dimension.matchTopics]);
}

function inferDimensionIdsFromText(text: string): string[] {
  const normalized = text.toLowerCase();
  const result = new Set<string>();
  for (const dimension of DIMENSION_REGISTRY) {
    const ids = queryIdsForDimension(dimension);
    if (ids.some((id) => normalized.includes(normalizeToken(id)))) {
      result.add(dimension.id);
    }
  }
  return [...result].sort();
}

function moduleChange(
  reason: ModuleChange['reason'],
  moduleId: string,
  moduleName: string,
  previous?: ModuleDeltaSnapshot,
  current?: ModuleDeltaSnapshot
): ModuleChange {
  return {
    moduleId,
    moduleName,
    previous,
    current,
    changedFiles: [],
    reason,
  };
}

function resolveModuleChangedFiles(
  previous: ModuleDeltaSnapshot,
  current: ModuleDeltaSnapshot,
  changedFileSet: ReadonlySet<string>
): string[] {
  const previousFiles = new Set(previous.files ?? []);
  const currentFiles = new Set(current.files ?? []);
  if (changedFileSet.size > 0) {
    return uniqueSorted([...currentFiles].filter((file) => changedFileSet.has(file)));
  }
  return uniqueSorted([
    ...[...currentFiles].filter((file) => !previousFiles.has(file)),
    ...[...previousFiles].filter((file) => !currentFiles.has(file)),
  ]);
}

function buildRenameCandidate(
  previous: ModuleDeltaSnapshot,
  current: ModuleDeltaSnapshot,
  threshold: number
): ModuleRenameCandidate | null {
  const previousFiles = new Set(previous.files ?? []);
  const currentFiles = new Set(current.files ?? []);
  const sharedFiles = uniqueSorted([...previousFiles].filter((file) => currentFiles.has(file)));
  const fileScore =
    previousFiles.size + currentFiles.size === 0
      ? 0
      : sharedFiles.length / new Set([...previousFiles, ...currentFiles]).size;
  const nameScore = normalizedSimilarity(previous.moduleName, current.moduleName);
  const similarity = round(Math.max(fileScore, nameScore));
  if (similarity < threshold) {
    return null;
  }
  return {
    previousModuleId: previous.moduleId,
    currentModuleId: current.moduleId,
    previousName: previous.moduleName,
    currentName: current.moduleName,
    similarity,
    sharedFiles,
  };
}

function normalizedSimilarity(a: string, b: string): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (left === right) {
    return 1;
  }
  const maxLength = Math.max(left.length, right.length, 1);
  return 1 - levenshtein(left, right) / maxLength;
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length] ?? 0;
}

function emptyModuleDelta(): ModuleDeltaReport {
  return {
    added: [],
    changed: [],
    removed: [],
    renameCandidates: [],
    affectedModuleIds: [],
  };
}

function isActiveStatus(status: string | undefined): boolean {
  return !status || status === 'pending' || status === 'observing' || status === 'open';
}

function isActiveDecayStatus(status: string | undefined): boolean {
  return !status || status === 'open' || status === 'decaying' || status === 'pending';
}

function isHealthyCoverageStatus(status: string | undefined): boolean {
  return (
    !status ||
    status === 'active' ||
    status === 'evolving' ||
    status === 'staging' ||
    status === 'unknown'
  );
}

function comparePlanSignals(a: DynamicPlanningSignal, b: DynamicPlanningSignal): number {
  return (
    b.priority - a.priority || a.kind.localeCompare(b.kind) || a.reason.localeCompare(b.reason)
  );
}

function compareModuleChange(a: ModuleChange, b: ModuleChange): number {
  return a.moduleId.localeCompare(b.moduleId);
}

function countBy<T>(items: readonly T[], selector: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = selector(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeName(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '').toLowerCase();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function isPresent<T>(value: T | null | undefined | false | ''): value is T {
  return Boolean(value);
}
