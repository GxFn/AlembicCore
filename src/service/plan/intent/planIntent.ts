import { resolvePlanDimensionDefinitions } from '../../../domain/dimension/DimensionRegistry.js';
import type { PlanIntent, PlanSelection, PlanStageId } from './contracts.js';

const VALID_PLAN_STAGES: ReadonlySet<PlanStageId> = new Set([
  'coldStart',
  'deepMining',
  'moduleMining',
]);
const MODULE_TARGET_REQUIRED_STAGES: ReadonlySet<PlanStageId> = new Set([
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

export interface PlanSelectionStageRequirementsOptions {
  /**
   * 外层 plan gate 已知的目标阶段。传入时既校验 Agent 返回 stage 一致，也按目标阶段执行阶段约束。
   */
  readonly expectedStage?: PlanStageId;
}

export interface PlanSelectionProjection {
  readonly executionDimensions: string[];
  readonly budget: {
    readonly totalRecipeBudget: number;
    readonly maxFiles: number;
    readonly contentMaxLines: number;
    /** P-2：plan LLM 的 per-dimension 预算（可选透传，宿主折算建议区间优先用它） */
    readonly dimensionBudgets?: Readonly<Record<string, number>>;
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

export function planSelectionRequiresModuleTargets(stage: PlanStageId): boolean {
  return MODULE_TARGET_REQUIRED_STAGES.has(stage);
}

export function assertPlanSelectionStageRequirements(
  selection: unknown,
  options: PlanSelectionStageRequirementsOptions = {}
): asserts selection is PlanSelection {
  assertPlanSelectionShape(selection);

  const issues: string[] = [];
  const stage = options.expectedStage ?? selection.generationStage;
  if (options.expectedStage && selection.generationStage !== options.expectedStage) {
    issues.push(`generationStage must be ${options.expectedStage}`);
  }

  if (planSelectionRequiresModuleTargets(stage)) {
    issues.push(...validatePlanSelectionModuleTargets(selection, stage));
  }

  if (issues.length > 0) {
    throw new Error(`Invalid PlanSelection stage requirements: ${unique(issues).join('; ')}`);
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
  // P-4(2026-07-02)：下限从「每维度 1 条」提高到「每维度 3 条」——真机 plan LLM 被输出示例
  // 数字锚定给出 totalRecipeBudget=6/3 维度(每维度 2 条)，严重低于真实证据面(核心维度 8-12 条)。
  // 最薄的入选维度也有 3+ 条可提炼约定，确定性下限防 LLM 保守；testMode 上限逻辑不变。
  const dimensionLowerBound = Math.max(1, input.dimensionCount * 3);
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

  const dimensionBudgets = input.scale.dimensionBudgets;
  return {
    totalRecipeBudget: clampPositiveInteger(
      input.testMode
        ? Math.min(boundedTotalRecipeBudget, testModeUpperBound)
        : boundedTotalRecipeBudget,
      input.testMode ? 1 : dimensionLowerBound,
      MAX_TOTAL_RECIPE_BUDGET
    ),
    ...(dimensionBudgets && Object.keys(dimensionBudgets).length > 0 ? { dimensionBudgets } : {}),
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

function validatePlanSelectionModuleTargets(
  selection: PlanSelection,
  stage: PlanStageId
): string[] {
  const issues: string[] = [];
  const bindings = readPlanModuleBindingRecords(selection);
  const selectedDimensions = new Set(uniqueStrings(selection.dimensions));
  let moduleDimensionTargetCount = 0;

  if (bindings.length === 0) {
    issues.push(`${stage} requires moduleBindings with module×dimension targets`);
  }

  bindings.forEach((binding, index) => {
    const bindingLabel = `moduleBinding[${index}]`;
    const modulePath = readTrimmedString(binding.modulePath);
    if (!modulePath) {
      issues.push(`${bindingLabel}.modulePath is required for ${stage}`);
    }

    const dimensions = normalizeStringArray(binding.dimensions);
    if (dimensions.length === 0) {
      issues.push(`${bindingLabel}.dimensions must be non-empty for ${stage}`);
    }
    const knownDimensions = dimensions.filter((dimensionId) => selectedDimensions.has(dimensionId));
    for (const dimensionId of dimensions) {
      if (!selectedDimensions.has(dimensionId)) {
        issues.push(`${bindingLabel} references unknown dimension ${dimensionId}`);
      }
    }

    const targetRecipes = readPositiveInteger(binding.targetRecipes);
    if (targetRecipes === null) {
      issues.push(`${bindingLabel}.targetRecipes must be > 0 for ${stage}`);
    }

    if (modulePath && knownDimensions.length > 0 && targetRecipes !== null) {
      moduleDimensionTargetCount += knownDimensions.length;
    }
  });

  if (moduleDimensionTargetCount === 0) {
    issues.push(`${stage} requires at least one module×dimension target`);
  }

  return issues;
}

function readPlanModuleBindingRecords(selection: PlanSelection): Record<string, unknown>[] {
  const record = readRecord(selection);
  return Array.isArray(record.moduleBindings) ? record.moduleBindings.map(readRecord) : [];
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

function readTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
}

function clampPositiveInteger(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.floor(value)));
}
