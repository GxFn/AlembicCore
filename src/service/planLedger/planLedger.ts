import { createHash } from 'node:crypto';
import type { PlanRepositoryImpl } from '../../repository/plan/index.js';
import type {
  BuildPlanDraftInformationPackageInput,
  ConfirmPlanInput,
  PlanCodeRecipeMapping,
  PlanCoverageBucket,
  PlanDraftInformationPackage,
  PlanGenerationState,
  PlanIntent,
  PlanModuleBinding,
  PlanNextAction,
  PlanRecord,
  PlanSignatureComparison,
  PlanStageId,
  PlanView,
  ProjectContextSignatureInput,
  SavePlanDraftInput,
} from './contracts.js';

const COUNTABLE_RECIPE_LIFECYCLES = ['active', 'staging', 'evolving', 'decaying', 'deprecated'];
const STALE_RECIPE_LIFECYCLES = new Set(['decaying', 'deprecated']);

export interface PlanLedgerReadRepositories {
  knowledgeRepository: {
    findAllByLifecycles(lifecycles: readonly string[]): Promise<readonly RecipeLike[]>;
  };
  recipeSourceRefRepository: {
    findAll(): readonly SourceRefLike[];
  };
  proposalRepository?: {
    findActive(): readonly Record<string, unknown>[];
  };
  lifecycleEventRepository?: {
    findRecent(limit?: number): readonly Record<string, unknown>[];
  };
}

export interface PlanLedgerRepositories extends PlanLedgerReadRepositories {
  planRepository: PlanRepositoryImpl;
}

interface RecipeLike {
  id: string;
  title?: string;
  lifecycle?: string;
  dimensionId?: string;
  category?: string;
  sourceFile?: string | null;
  toJSON?: () => Record<string, unknown>;
}

interface SourceRefLike {
  recipeId: string;
  sourcePath: string;
  status: string;
  newPath?: string | null;
}

export class PlanLedgerService {
  readonly #repositories: PlanLedgerRepositories;

  constructor(repositories: PlanLedgerRepositories) {
    this.#repositories = repositories;
  }

  saveDraft(input: SavePlanDraftInput): PlanRecord {
    return this.#repositories.planRepository.saveDraft(input);
  }

  confirmPlan(input: ConfirmPlanInput): PlanRecord {
    return this.#repositories.planRepository.confirm(input);
  }

  async getPlanView(
    planId: string,
    version: number,
    currentSignature?: string
  ): Promise<PlanView | null> {
    const plan = this.#repositories.planRepository.get(planId, version);
    if (!plan) {
      return null;
    }
    return this.#buildView(plan, currentSignature);
  }

  async getActivePlanView(
    projectRoot: string,
    currentSignature?: string
  ): Promise<PlanView | null> {
    const plan = this.#repositories.planRepository.getActiveConfirmed(projectRoot);
    if (!plan) {
      return null;
    }
    return this.#buildView(plan, currentSignature);
  }

  async #buildView(plan: PlanRecord, currentSignature?: string): Promise<PlanView> {
    return {
      intent: plan,
      state: await projectPlanGenerationState({
        plan,
        repositories: this.#repositories,
      }),
      signature: compareProjectContextSignature(
        plan.projectContextSignature,
        currentSignature ?? plan.projectContextSignature
      ),
    };
  }
}

export function buildPlanDraftInformationPackage(
  input: BuildPlanDraftInformationPackageInput
): PlanDraftInformationPackage {
  const dimensionOrder = input.planningAids?.dimensionOrder ?? [];
  const recommended = input.planningAids?.recommendedDimensions ?? [];
  const maxBudget = input.hints?.maxBudget;
  const perDimensionTarget = resolvePerDimensionTarget(input.planningAids, maxBudget);
  const dimensions = recommended.map((item, index) => ({
    dimensionId: item.dimension.id,
    priority: index + 1,
    rationale: item.reasons.join('; ') || 'recommended by planning aids',
    stage: resolveStage(index, recommended.length),
    targetRecipes: perDimensionTarget,
  }));
  const selectedDimensionIds =
    dimensions.length > 0 ? dimensions.map((dimension) => dimension.dimensionId) : dimensionOrder;
  const totalRecipeBudget =
    maxBudget ?? Math.max(selectedDimensionIds.length * perDimensionTarget, perDimensionTarget);
  const focusModules = input.hints?.focusModules ?? [];
  const moduleBindings = focusModules.map(
    (modulePath, index): PlanModuleBinding => ({
      modulePath,
      dimensions: selectedDimensionIds,
      targetRecipes: Math.max(1, Math.ceil(perDimensionTarget / 2)),
      priority: index + 1,
    })
  );
  const plannedNextActions: PlanNextAction[] = (
    input.planningAids?.informationGatheringSteps ?? []
  ).map((step, index) => ({
    tool: step.tool,
    reason: step.reason,
    order: index + 1,
    dimensionIds: step.dimensions,
  }));

  const intent: PlanIntent = {
    projectProfile: input.projectProfile,
    dimensions,
    scale: {
      totalRecipeBudget,
      perStage: {
        coldStart: Math.ceil(totalRecipeBudget * 0.55),
        deepMining: Math.ceil(totalRecipeBudget * 0.3),
        module: Math.max(moduleBindings.length, Math.floor(totalRecipeBudget * 0.15)),
      },
      depthLevels: ['baseline', 'deepening', 'module-scoped'],
      budgetLevel: input.planningAids?.scaleDecision.budgetLevel,
      scale: input.planningAids?.scaleDecision.scale,
    },
    moduleBindings,
    stages: {
      coldStart: {
        dimensions: selectedDimensionIds.filter(
          (_, index) => resolveStage(index, selectedDimensionIds.length) === 'coldStart'
        ),
        breadthBudget: Math.ceil(totalRecipeBudget * 0.55),
      },
      deepMining: {
        dimensions: selectedDimensionIds.filter(
          (_, index) => resolveStage(index, selectedDimensionIds.length) !== 'coldStart'
        ),
        depthBudget: Math.ceil(totalRecipeBudget * 0.3),
        focusModules,
      },
      moduleMining: {
        perModule: moduleBindings,
      },
    },
    plannedNextActions,
    evidenceRefs: [
      {
        kind: 'project-context',
        ref: input.projectContextSignature,
        detail: 'projectContextSignature',
      },
    ],
    draftSource: 'plugin-deterministic',
  };

  return {
    intent,
    planningBrief: {
      defaultOrder: selectedDimensionIds,
      agentDecisionChecklist: [
        'choose dimensions from observed project signals',
        'set scale and per-stage budgets before generation',
        'confirm module bindings before scoped mining',
        'run recipe-context and evolution tools only when evidence requires them',
      ],
      evidenceFields: [
        'projectContextSignature',
        'dimensionOrder',
        'scaleDecision',
        'plannedNextActions',
      ],
      sopField: 'planningBrief',
      toolCapabilityMatrix: plannedNextActions.map((action) => ({
        order: action.order,
        tool: action.tool,
        dimensions: action.dimensionIds ?? [],
        reason: action.reason,
      })),
      scaleDecision: input.planningAids?.scaleDecision ?? null,
      subsetHints: input.planningAids?.subsetHints ?? [],
      crossDimensionConstraints: input.planningAids?.crossDimensionConstraints ?? [],
    },
    sourceReports: {
      planningAids: input.planningAids,
      missionBriefing: input.missionBriefing,
      dynamicSignals: input.dynamicSignals,
    },
  };
}

export async function projectPlanGenerationState(input: {
  plan: PlanRecord;
  repositories: PlanLedgerReadRepositories;
}): Promise<PlanGenerationState> {
  const recipes = await input.repositories.knowledgeRepository.findAllByLifecycles(
    COUNTABLE_RECIPE_LIFECYCLES
  );
  const refs = input.repositories.recipeSourceRefRepository.findAll();
  const proposals = input.repositories.proposalRepository?.findActive() ?? [];
  const lifecycleEvents = input.repositories.lifecycleEventRepository?.findRecent(50) ?? [];

  return projectPlanGenerationStateFromRecords({
    plan: input.plan,
    recipes,
    sourceRefs: refs,
    proposals,
    lifecycleEvents,
  });
}

export function projectPlanGenerationStateFromRecords(input: {
  plan: PlanRecord;
  recipes: readonly RecipeLike[];
  sourceRefs: readonly SourceRefLike[];
  proposals?: readonly Record<string, unknown>[];
  lifecycleEvents?: readonly Record<string, unknown>[];
}): PlanGenerationState {
  const recipeById = new Map(input.recipes.map((recipe) => [recipe.id, recipe]));
  const refsByRecipe = groupBy(input.sourceRefs, (ref) => ref.recipeId);
  const mappings = new Map<string, PlanCodeRecipeMapping>();

  for (const ref of input.sourceRefs) {
    const recipe = recipeById.get(ref.recipeId);
    const dimensionIds = recipe ? [resolveRecipeDimensionId(recipe)] : [];
    const modulePath = resolveModulePath(ref.sourcePath, input.plan.intent.moduleBindings);
    mergeMapping(mappings, {
      codeRegion: ref.sourcePath,
      recipeIds: [ref.recipeId],
      status: isStaleRecipeRef(ref, recipe) ? 'stale' : 'generated',
      dimensionIds,
      modulePath,
      evidenceRefs: [
        {
          kind: 'recipe-context',
          ref: `recipe_source_refs:${ref.recipeId}:${ref.sourcePath}`,
          detail: ref.status,
        },
      ],
    });
  }

  for (const recipe of input.recipes) {
    if ((refsByRecipe.get(recipe.id)?.length ?? 0) > 0) {
      continue;
    }
    const sourceFile = recipe.sourceFile ?? undefined;
    mergeMapping(mappings, {
      codeRegion: sourceFile || `recipe:${recipe.id}`,
      recipeIds: [recipe.id],
      status: isStaleRecipe(recipe) ? 'stale' : 'generated',
      dimensionIds: [resolveRecipeDimensionId(recipe)],
      modulePath: sourceFile
        ? resolveModulePath(sourceFile, input.plan.intent.moduleBindings)
        : undefined,
      evidenceRefs: [
        {
          kind: 'recipe-context',
          ref: `knowledge_entries:${recipe.id}`,
          detail: recipe.lifecycle ?? 'unknown',
        },
      ],
    });
  }

  for (const binding of input.plan.intent.moduleBindings) {
    const hasGenerated = [...mappings.values()].some(
      (mapping) => mapping.modulePath === binding.modulePath
    );
    if (hasGenerated) {
      continue;
    }
    mergeMapping(mappings, {
      codeRegion: binding.modulePath,
      recipeIds: [],
      status: 'planned',
      dimensionIds: binding.dimensions,
      modulePath: binding.modulePath,
      evidenceRefs: [
        {
          kind: 'human',
          ref: `plans:${input.plan.planId}:${binding.modulePath}`,
          detail: 'planned module binding',
        },
      ],
    });
  }

  const codeRecipeMapping = [...mappings.values()].sort((a, b) =>
    a.codeRegion.localeCompare(b.codeRegion)
  );
  const coverage = buildCoverage(input.plan, codeRecipeMapping);

  return {
    codeRecipeMapping,
    coverage,
    pendingProposals: input.proposals ?? [],
    generationChangeLog: input.lifecycleEvents ?? [],
  };
}

export function computeProjectContextSignature(input: ProjectContextSignatureInput): string {
  const normalized = {
    projectRoot: input.projectRoot ?? '',
    commit: input.commit ?? null,
    primaryLanguage: input.primaryLanguage ?? '',
    frameworks: [...(input.frameworks ?? [])].sort(),
    files: [...(input.files ?? [])]
      .map((file) => ({
        path: file.filePath ?? file.path ?? '',
        contentHash: file.contentHash ?? '',
        language: file.language ?? '',
        lineCount: file.lineCount ?? 0,
        sizeBytes: file.sizeBytes ?? 0,
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    modules: [...(input.modules ?? [])]
      .map((module) => ({
        id: module.moduleId ?? module.id ?? '',
        name: module.name ?? '',
        role: module.role ?? '',
        fingerprint: module.fingerprint ?? '',
        files: [...(module.files ?? [])].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id) || a.name.localeCompare(b.name)),
    metadata: input.metadata ?? {},
  };
  return `pcsig:${createHash('sha256').update(stableStringify(normalized)).digest('hex')}`;
}

export function compareProjectContextSignature(
  expected: string,
  actual: string
): PlanSignatureComparison {
  return {
    matches: expected === actual,
    expected,
    actual,
    reason: expected === actual ? 'match' : 'mismatch',
  };
}

function buildCoverage(
  plan: PlanRecord,
  mappings: readonly PlanCodeRecipeMapping[]
): PlanGenerationState['coverage'] {
  const byDimension: Record<string, PlanCoverageBucket> = {};
  const byModule: Record<string, PlanCoverageBucket & { dimensions: readonly string[] }> = {};
  const uniqueGeneratedRecipes = new Set<string>();

  for (const dimension of plan.intent.dimensions) {
    byDimension[dimension.dimensionId] = {
      planned: dimension.targetRecipes,
      generated: 0,
      stale: 0,
      missing: 0,
    };
  }
  for (const binding of plan.intent.moduleBindings) {
    byModule[binding.modulePath] = {
      planned: binding.targetRecipes,
      generated: 0,
      stale: 0,
      missing: 0,
      dimensions: binding.dimensions,
    };
  }

  for (const mapping of mappings) {
    for (const dimensionId of mapping.dimensionIds) {
      const bucket =
        byDimension[dimensionId] ??
        (byDimension[dimensionId] = { planned: 0, generated: 0, stale: 0, missing: 0 });
      if (mapping.status === 'stale') {
        bucket.stale += mapping.recipeIds.length;
      } else if (mapping.status === 'generated') {
        bucket.generated += mapping.recipeIds.length;
      }
    }
    if (mapping.status === 'generated') {
      for (const recipeId of mapping.recipeIds) {
        uniqueGeneratedRecipes.add(recipeId);
      }
    }
    if (mapping.modulePath) {
      const moduleBucket =
        byModule[mapping.modulePath] ??
        (byModule[mapping.modulePath] = {
          planned: 0,
          generated: 0,
          stale: 0,
          missing: 0,
          dimensions: mapping.dimensionIds,
        });
      if (mapping.status === 'stale') {
        moduleBucket.stale += mapping.recipeIds.length;
      } else if (mapping.status === 'generated') {
        moduleBucket.generated += mapping.recipeIds.length;
      }
    }
  }

  const gaps = [];
  for (const [dimensionId, bucket] of Object.entries(byDimension)) {
    bucket.missing = Math.max(0, bucket.planned - bucket.generated);
    if (bucket.missing > 0) {
      gaps.push({
        dimensionId,
        planned: bucket.planned,
        generated: bucket.generated,
        missing: bucket.missing,
      });
    }
  }
  for (const [modulePath, bucket] of Object.entries(byModule)) {
    bucket.missing = Math.max(0, bucket.planned - bucket.generated);
    if (bucket.missing > 0 && bucket.dimensions.length > 0) {
      gaps.push({
        dimensionId: bucket.dimensions[0],
        modulePath,
        planned: bucket.planned,
        generated: bucket.generated,
        missing: bucket.missing,
      });
    }
  }

  return {
    byDimension,
    byModule,
    generated: uniqueGeneratedRecipes.size,
    planned: plan.intent.scale.totalRecipeBudget,
    gaps: gaps.sort(
      (a, b) =>
        b.missing - a.missing ||
        a.dimensionId.localeCompare(b.dimensionId) ||
        (a.modulePath ?? '').localeCompare(b.modulePath ?? '')
    ),
  };
}

function mergeMapping(
  mappings: Map<string, PlanCodeRecipeMapping>,
  next: PlanCodeRecipeMapping
): void {
  const existing = mappings.get(next.codeRegion);
  if (!existing) {
    mappings.set(next.codeRegion, next);
    return;
  }
  mappings.set(next.codeRegion, {
    codeRegion: next.codeRegion,
    recipeIds: uniqueSorted([...existing.recipeIds, ...next.recipeIds]),
    status: existing.status === 'stale' || next.status === 'stale' ? 'stale' : next.status,
    dimensionIds: uniqueSorted([...existing.dimensionIds, ...next.dimensionIds]),
    modulePath: existing.modulePath ?? next.modulePath,
    evidenceRefs: [...existing.evidenceRefs, ...next.evidenceRefs],
  });
}

function isStaleRecipeRef(ref: SourceRefLike, recipe?: RecipeLike): boolean {
  return (
    ref.status === 'stale' || ref.status === 'renamed' || (recipe ? isStaleRecipe(recipe) : false)
  );
}

function isStaleRecipe(recipe: RecipeLike): boolean {
  return STALE_RECIPE_LIFECYCLES.has(recipe.lifecycle ?? '');
}

function resolveRecipeDimensionId(recipe: RecipeLike): string {
  return recipe.dimensionId || recipe.category || 'unknown';
}

function resolveModulePath(
  sourcePath: string,
  bindings: readonly PlanModuleBinding[]
): string | undefined {
  const normalized = sourcePath.replace(/\\/g, '/');
  return bindings
    .map((binding) => binding.modulePath.replace(/\\/g, '/'))
    .sort((a, b) => b.length - a.length)
    .find((modulePath) => normalized === modulePath || normalized.startsWith(`${modulePath}/`));
}

function resolvePerDimensionTarget(
  planningAids: BuildPlanDraftInformationPackageInput['planningAids'],
  maxBudget?: number
): number {
  const dimensionCount = Math.max(1, planningAids?.dimensionOrder.length ?? 1);
  if (maxBudget) {
    return Math.max(1, Math.floor(maxBudget / dimensionCount));
  }
  const level = planningAids?.scaleDecision.budgetLevel;
  if (level === 'focused') {
    return 3;
  }
  if (level === 'expanded') {
    return 7;
  }
  return 5;
}

function resolveStage(index: number, total: number): PlanStageId {
  if (total <= 2 || index < Math.ceil(total * 0.55)) {
    return 'coldStart';
  }
  return 'deepMining';
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    grouped.set(id, [...(grouped.get(id) ?? []), item]);
  }
  return grouped;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
