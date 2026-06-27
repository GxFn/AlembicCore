import { resolvePlanDimensionDefinitions } from '../../domain/dimension/DimensionRegistry.js';
import type { PlanIntent, PlanSelection, PlanStageId } from './contracts.js';

const VALID_PLAN_STAGES: ReadonlySet<PlanStageId> = new Set([
  'coldStart',
  'deepMining',
  'moduleMining',
]);
const TEST_MODE_DEFAULT_MAX_FILES = 80;
const TEST_MODE_DEFAULT_CONTENT_MAX_LINES = 80;
const DEFAULT_MAX_FILES = 500;
const DEFAULT_CONTENT_MAX_LINES = 120;
const MAX_PLAN_FILES = 20_000;
const MAX_CONTENT_LINES = 2_000;
const MAX_TOTAL_RECIPE_BUDGET = 500;

export interface ApplyPlanSelectionOptions {
  readonly testMode?: boolean;
  readonly moduleScope?: readonly string[];
  readonly scaleOverride?: PlanSelectionScaleOverride;
}

export interface PlanSelectionScaleOverride {
  readonly totalRecipeBudget?: number;
  readonly maxFiles?: number;
  readonly contentMaxLines?: number;
}

export interface PlanSelectionProjection {
  readonly executionDimensions: string[];
  readonly budget: {
    readonly totalRecipeBudget: number;
    readonly maxFiles: number;
    readonly contentMaxLines: number;
  };
  readonly moduleScope: string[];
  readonly unknownDimensionIds?: string[];
}

export function assertPlanSelectionShape(selection: unknown): asserts selection is PlanSelection {
  const issues: string[] = [];
  const record = readRecord(selection);

  if (!VALID_PLAN_STAGES.has(record.generationStage as PlanStageId)) {
    issues.push('generationStage must be coldStart, deepMining, or moduleMining');
  }
  if (!Array.isArray(record.dimensions)) {
    issues.push('dimensions must be an array');
  } else {
    const invalidDimension = record.dimensions.some(
      (dimension) => typeof dimension !== 'string' || dimension.trim().length === 0
    );
    if (record.dimensions.length === 0) {
      issues.push('dimensions must be non-empty');
    }
    if (invalidDimension) {
      issues.push('dimensions must contain only non-empty strings');
    }
  }

  const scale = readRecord(record.scale);
  if (
    typeof scale.totalRecipeBudget !== 'number' ||
    !Number.isFinite(scale.totalRecipeBudget) ||
    scale.totalRecipeBudget <= 0
  ) {
    issues.push('scale.totalRecipeBudget must be > 0');
  }

  if (issues.length > 0) {
    throw new Error(`Invalid PlanSelection: ${unique(issues).join('; ')}`);
  }
}

export function applyPlanSelection(
  selection: PlanSelection,
  options: ApplyPlanSelectionOptions = {}
): PlanSelectionProjection {
  assertPlanSelectionShape(selection);

  const executionDimensions = uniqueStrings(selection.dimensions);
  const resolvedDimensions = resolvePlanDimensionDefinitions(executionDimensions);
  const budget = resolvePlanSelectionBudget({
    dimensionCount: executionDimensions.length,
    scale: selection.scale,
    scaleOverride: options.testMode === true ? options.scaleOverride : undefined,
    testMode: options.testMode === true,
  });
  const moduleScope = selectPlanSelectionModuleScope({
    moduleBindings: readPlanModuleBindings(selection),
    requestedModuleScope: options.moduleScope,
    testMode: options.testMode === true,
  });

  return {
    executionDimensions,
    budget,
    moduleScope,
    ...(resolvedDimensions.missingDimensionIds.length > 0
      ? { unknownDimensionIds: [...resolvedDimensions.missingDimensionIds] }
      : {}),
  };
}

export function normalizeConfirmedPlanIntent(intent: PlanIntent): PlanIntent {
  validateCompletePlanIntent(intent);
  return {
    ...intent,
    dimensions: [...intent.dimensions],
    scale: {
      ...intent.scale,
      depthLevels: [...intent.scale.depthLevels],
    },
    moduleBindings: [...intent.moduleBindings],
    plannedNextActions: [...intent.plannedNextActions],
    evidenceRefs: [...intent.evidenceRefs],
    draftSource: 'host-agent',
  };
}

export function validateCompletePlanIntent(intent: PlanIntent): void {
  const issues: string[] = [];
  const dimensionIds = new Set(intent.dimensions.map((dimension) => dimension.dimensionId));

  if (!intent.generationStage) {
    issues.push('generationStage is required');
  }
  if (intent.dimensions.length === 0) {
    issues.push('dimensions are required');
  }
  for (const dimension of intent.dimensions) {
    if (!dimension.dimensionId) {
      issues.push('dimension.dimensionId is required');
    }
    if (!dimension.rationale) {
      issues.push(`dimension ${dimension.dimensionId || '<unknown>'} rationale is required`);
    }
    if (dimension.targetRecipes <= 0) {
      issues.push(`dimension ${dimension.dimensionId || '<unknown>'} targetRecipes must be > 0`);
    }
  }
  if (intent.scale.totalRecipeBudget <= 0) {
    issues.push('scale.totalRecipeBudget must be > 0');
  }
  if (intent.scale.depthLevels.length === 0) {
    issues.push('scale.depthLevels are required');
  }
  if (intent.moduleBindings.length === 0) {
    issues.push('moduleBindings are required');
  }
  for (const binding of intent.moduleBindings) {
    if (!binding.modulePath) {
      issues.push('moduleBinding.modulePath is required');
    }
    if (binding.dimensions.length === 0) {
      issues.push(`moduleBinding ${binding.modulePath || '<unknown>'} dimensions are required`);
    }
    if (binding.targetRecipes <= 0) {
      issues.push(`moduleBinding ${binding.modulePath || '<unknown>'} targetRecipes must be > 0`);
    }
    for (const dimensionId of binding.dimensions) {
      if (!dimensionIds.has(dimensionId)) {
        issues.push(
          `moduleBinding ${binding.modulePath} references unknown dimension ${dimensionId}`
        );
      }
    }
  }
  if (intent.plannedNextActions.length === 0) {
    issues.push('plannedNextActions are required');
  }
  if (intent.evidenceRefs.length === 0) {
    issues.push('evidenceRefs are required');
  }
  if (issues.length > 0) {
    throw new Error(`Cannot confirm incomplete Plan intent: ${unique(issues).join('; ')}`);
  }
}

export function hasPositiveStageBudget(
  budgets: Readonly<Record<string, number | undefined>>
): boolean {
  return Object.values(budgets).some((budget) => (budget ?? 0) > 0);
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function resolvePlanSelectionBudget(input: {
  readonly dimensionCount: number;
  readonly scale: PlanSelection['scale'];
  readonly scaleOverride?: PlanSelectionScaleOverride;
  readonly testMode: boolean;
}): PlanSelectionProjection['budget'] {
  const dimensionLowerBound = Math.max(1, input.dimensionCount);
  const totalRecipeBudget =
    input.scaleOverride?.totalRecipeBudget ?? input.scale.totalRecipeBudget ?? dimensionLowerBound;
  const maxFiles =
    input.scaleOverride?.maxFiles ??
    input.scale.maxFiles ??
    (input.testMode ? TEST_MODE_DEFAULT_MAX_FILES : DEFAULT_MAX_FILES);
  const contentMaxLines =
    input.scaleOverride?.contentMaxLines ??
    input.scale.contentMaxLines ??
    (input.testMode ? TEST_MODE_DEFAULT_CONTENT_MAX_LINES : DEFAULT_CONTENT_MAX_LINES);
  const boundedTotalRecipeBudget = Math.max(dimensionLowerBound, totalRecipeBudget);
  const testModeUpperBound = Math.max(1, input.dimensionCount * 2);

  return {
    totalRecipeBudget: clampPositiveInteger(
      input.testMode
        ? Math.min(boundedTotalRecipeBudget, testModeUpperBound)
        : boundedTotalRecipeBudget,
      dimensionLowerBound,
      MAX_TOTAL_RECIPE_BUDGET
    ),
    maxFiles: clampPositiveInteger(maxFiles, DEFAULT_MAX_FILES, MAX_PLAN_FILES),
    contentMaxLines: clampPositiveInteger(
      contentMaxLines,
      DEFAULT_CONTENT_MAX_LINES,
      MAX_CONTENT_LINES
    ),
  };
}

function selectPlanSelectionModuleScope(input: {
  readonly moduleBindings: readonly { readonly modulePath?: string }[];
  readonly requestedModuleScope?: readonly string[];
  readonly testMode: boolean;
}): string[] {
  const plannedModulePaths = uniqueStrings(
    input.moduleBindings.flatMap((binding) =>
      typeof binding.modulePath === 'string' ? [binding.modulePath] : []
    )
  );
  const requestedModuleScope = normalizeStringArray(input.requestedModuleScope);

  if (input.testMode && requestedModuleScope.length > 0) {
    const requested = new Set(requestedModuleScope);
    return plannedModulePaths.filter((modulePath) => requested.has(modulePath));
  }

  return plannedModulePaths;
}

function readPlanModuleBindings(
  selection: PlanSelection
): readonly { readonly modulePath?: string }[] {
  const record = readRecord(selection);
  return Array.isArray(record.moduleBindings)
    ? (record.moduleBindings as readonly { readonly modulePath?: string }[])
    : [];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
    : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clampPositiveInteger(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.floor(value)));
}
