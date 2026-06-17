// Shared pure helpers for the RecipeContext handlers.

import type {
  RecipeContextQueryError,
  RecipeRelationScoreImpact,
  RecipeSourceRefGroup,
  RecipeSourceRefView,
} from '../../../domain/recipe-context/index.js';
import type { RecipeContextHandlerResult } from '../interface/contracts.js';
import { createUnavailableRecipeContextData } from '../interface/response.js';
import type { RecipeSourceRefRow } from '../ports.js';

/** Relation types whose presence is a caution signal rather than a recommendation. */
const CAUTION_RELATION_TYPES = new Set([
  'conflicts',
  'conflict',
  'deprecated_by',
  'deprecated',
  'alternative',
  'replaced_by',
  'replaces',
]);

export function relationScoreImpact(relationType: string): RecipeRelationScoreImpact {
  return CAUTION_RELATION_TYPES.has(relationType) ? 'neutral-or-caution' : 'positive';
}

export function failureResult(
  kind: string,
  error: RecipeContextQueryError
): RecipeContextHandlerResult {
  return {
    data: createUnavailableRecipeContextData(kind, error.message),
    errors: [error],
    refs: [],
  };
}

export function buildContentPreview(
  content: string | undefined,
  charLimit: number | undefined
): string | undefined {
  if (!content) {
    return undefined;
  }
  if (charLimit !== undefined && charLimit > 0 && content.length > charLimit) {
    return content.slice(0, charLimit);
  }
  return content;
}

export function basenameOf(sourcePath: string): string {
  const segments = sourcePath.split('/');
  return segments[segments.length - 1] ?? sourcePath;
}

export function pathInModule(sourcePath: string, moduleName: string): boolean {
  if (sourcePath === moduleName) {
    return true;
  }
  if (sourcePath.startsWith(`${moduleName}/`) || sourcePath.includes(`/${moduleName}/`)) {
    return true;
  }
  return sourcePath.split('/').includes(moduleName);
}

export function dedupeSourceRefRows(rows: readonly RecipeSourceRefRow[]): RecipeSourceRefRow[] {
  const seen = new Set<string>();
  const deduped: RecipeSourceRefRow[] = [];
  for (const row of rows) {
    const key = `${row.recipeId}::${row.sourcePath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

export function groupSourceRefsByRecipe(
  views: readonly RecipeSourceRefView[]
): RecipeSourceRefGroup[] {
  const order: string[] = [];
  const groups = new Map<string, RecipeSourceRefView[]>();
  for (const view of views) {
    const existing = groups.get(view.recipeId);
    if (existing) {
      existing.push(view);
    } else {
      groups.set(view.recipeId, [view]);
      order.push(view.recipeId);
    }
  }
  return order.map((recipeId) => ({ recipeId, refs: groups.get(recipeId) ?? [] }));
}
