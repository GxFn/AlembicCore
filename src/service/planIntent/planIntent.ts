import type { PlanIntent } from './contracts.js';

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
