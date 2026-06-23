import { createHash } from 'node:crypto';
import type { PlanIntent, PlanModuleBinding } from '../planIntent/index.js';
import type {
  BuildPlanDraftInformationPackageInput,
  PlanCodeRecipeMapping,
  PlanCoverageBucket,
  PlanDraftInformationPackage,
  PlanGenerationState,
  PlanSignatureComparison,
  ProjectContextSignatureInput,
  RecipeLike,
  RecipeStatusReadRepositories,
  SourceRefLike,
} from './contracts.js';

const COUNTABLE_RECIPE_LIFECYCLES = ['active', 'staging', 'evolving', 'decaying', 'deprecated'];
const STALE_RECIPE_LIFECYCLES = new Set(['decaying', 'deprecated']);

function isPresent<T>(value: T | null | undefined | false | ''): value is T {
  return Boolean(value);
}

export function buildPlanDraftInformationPackage(
  input: BuildPlanDraftInformationPackageInput
): PlanDraftInformationPackage {
  const focusModules = input.hints?.focusModules ?? [];
  const sourceReportFields = [
    input.planningAids ? 'sourceReports.planningAids' : null,
    input.dynamicSignals ? 'sourceReports.dynamicSignals' : null,
    input.missionBriefing ? 'sourceReports.missionBriefing' : null,
  ].filter(isPresent);

  return {
    draftSource: 'plugin-collected-facts',
    planningBrief: {
      draftSource: 'plugin-collected-facts',
      agentDecisionChecklist: [
        'author a complete Plan intent from sourceReports before confirm',
        'include every relevant dimension id and rationale in the confirm payload',
        'set the single-stage total budget explicitly in the confirm payload',
        'confirm module bindings and planned next actions explicitly',
      ],
      evidenceFields: [
        'projectContextSignature',
        'sourceReports.planningAids',
        'sourceReports.dynamicSignals',
        'sourceReports.missionBriefing',
      ],
      sourceReportFields,
      focusModules,
      sopField: 'planningBrief',
    },
    sourceReports: {
      planningAids: input.planningAids,
      missionBriefing: input.missionBriefing,
      dynamicSignals: input.dynamicSignals,
    },
  };
}

export async function projectPlanGenerationState(input: {
  intent: PlanIntent;
  repositories: RecipeStatusReadRepositories;
}): Promise<PlanGenerationState> {
  const recipes = await input.repositories.knowledgeRepository.findAllByLifecycles(
    COUNTABLE_RECIPE_LIFECYCLES
  );
  const refs = input.repositories.recipeSourceRefRepository.findAll();
  const proposals = input.repositories.proposalRepository?.findActive() ?? [];
  const lifecycleEvents = input.repositories.lifecycleEventRepository?.findRecent(50) ?? [];

  return projectPlanGenerationStateFromRecords({
    intent: input.intent,
    recipes,
    sourceRefs: refs,
    proposals,
    lifecycleEvents,
  });
}

export function projectPlanGenerationStateFromRecords(input: {
  intent: PlanIntent;
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
    const modulePath = resolveModulePath(ref.sourcePath, input.intent.moduleBindings);
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
      status: isStaleRecipe(recipe) ? 'stale' : 'missing',
      dimensionIds: [resolveRecipeDimensionId(recipe)],
      modulePath: sourceFile
        ? resolveModulePath(sourceFile, input.intent.moduleBindings)
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

  for (const binding of input.intent.moduleBindings) {
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
          ref: `planSelection:${binding.modulePath}`,
          detail: 'planned module binding',
        },
      ],
    });
  }

  const codeRecipeMapping = [...mappings.values()].sort((a, b) =>
    a.codeRegion.localeCompare(b.codeRegion)
  );
  const coverage = buildCoverage(input.intent, codeRecipeMapping);

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

export function buildCoverage(
  intent: PlanIntent,
  mappings: readonly PlanCodeRecipeMapping[]
): PlanGenerationState['coverage'] {
  const byDimension: Record<string, PlanCoverageBucket> = {};
  const byModule: Record<string, PlanCoverageBucket & { dimensions: readonly string[] }> = {};
  const byModuleDimension: Record<string, Record<string, PlanCoverageBucket>> = {};
  const uniqueGeneratedRecipes = new Set<string>();

  for (const dimension of intent.dimensions) {
    byDimension[dimension.dimensionId] = {
      planned: dimension.targetRecipes,
      generated: 0,
      stale: 0,
      missing: 0,
    };
  }
  for (const binding of intent.moduleBindings) {
    byModule[binding.modulePath] = {
      planned: binding.targetRecipes,
      generated: 0,
      stale: 0,
      missing: 0,
      dimensions: binding.dimensions,
    };
    byModuleDimension[binding.modulePath] = {};
    for (const dimensionId of binding.dimensions) {
      byModuleDimension[binding.modulePath][dimensionId] = {
        planned: resolveModuleDimensionTarget(intent, binding, dimensionId),
        generated: 0,
        stale: 0,
        missing: 0,
      };
    }
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
      const moduleDimensions =
        byModuleDimension[mapping.modulePath] ?? (byModuleDimension[mapping.modulePath] = {});
      for (const dimensionId of mapping.dimensionIds) {
        const moduleDimensionBucket =
          moduleDimensions[dimensionId] ??
          (moduleDimensions[dimensionId] = {
            planned: 0,
            generated: 0,
            stale: 0,
            missing: 0,
          });
        if (mapping.status === 'stale') {
          moduleDimensionBucket.stale += mapping.recipeIds.length;
        } else if (mapping.status === 'generated') {
          moduleDimensionBucket.generated += mapping.recipeIds.length;
        }
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
  for (const bucket of Object.values(byModule)) {
    bucket.missing = Math.max(0, bucket.planned - bucket.generated);
  }
  for (const [modulePath, dimensions] of Object.entries(byModuleDimension)) {
    for (const [dimensionId, bucket] of Object.entries(dimensions)) {
      bucket.missing = Math.max(0, bucket.planned - bucket.generated);
      if (bucket.missing > 0) {
        gaps.push({
          dimensionId,
          modulePath,
          planned: bucket.planned,
          generated: bucket.generated,
          missing: bucket.missing,
        });
      }
    }
  }

  return {
    byDimension,
    byModule,
    byModuleDimension,
    generated: uniqueGeneratedRecipes.size,
    planned: intent.scale.totalRecipeBudget,
    gaps: gaps.sort(
      (a, b) =>
        b.missing - a.missing ||
        a.dimensionId.localeCompare(b.dimensionId) ||
        (a.modulePath ?? '').localeCompare(b.modulePath ?? '')
    ),
  };
}

function resolveModuleDimensionTarget(
  intent: PlanIntent,
  binding: PlanModuleBinding,
  dimensionId: string
): number {
  const dimensionTarget = intent.dimensions.find(
    (dimension) => dimension.dimensionId === dimensionId
  )?.targetRecipes;
  return Math.min(binding.targetRecipes, dimensionTarget ?? binding.targetRecipes);
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
    status: mergeMappingStatus(existing.status, next.status),
    dimensionIds: uniqueSorted([...existing.dimensionIds, ...next.dimensionIds]),
    modulePath: existing.modulePath ?? next.modulePath,
    evidenceRefs: [...existing.evidenceRefs, ...next.evidenceRefs],
  });
}

function mergeMappingStatus(
  existing: PlanCodeRecipeMapping['status'],
  next: PlanCodeRecipeMapping['status']
): PlanCodeRecipeMapping['status'] {
  const rank: Record<PlanCodeRecipeMapping['status'], number> = {
    planned: 0,
    missing: 1,
    generated: 2,
    stale: 3,
  };
  return rank[next] > rank[existing] ? next : existing;
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
