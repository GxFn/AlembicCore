// RecipeContext ref construction + selection helpers.

import type {
  RecipeContextMetadata,
  RecipeContextRef,
  RecipeSourceLocation,
} from '../../../domain/recipe-context/index.js';

const REF_PREFIXES = ['recipe:', 'knowledge:', 'detail:'];

/**
 * Normalize an inbound recipe reference to a bare id. KnowledgeDetailProvider /
 * relation refs use knowledge: / detail: / recipe: prefixes; strip them so the
 * read port always receives a plain id.
 */
export function normalizeRecipeRef(reference: string): string {
  const trimmed = reference.trim();
  for (const prefix of REF_PREFIXES) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return trimmed;
}

export function recipeRef(
  recipeId: string,
  options: {
    label?: string;
    location?: RecipeSourceLocation;
    metadata?: RecipeContextMetadata;
  } = {}
): RecipeContextRef {
  return {
    id: `recipe:${recipeId}`,
    kind: 'recipe',
    label: options.label,
    location: options.location,
    metadata: options.metadata,
    recipeId,
  };
}

export function sourceRefRef(recipeId: string, sourcePath: string): RecipeContextRef {
  return {
    id: `source-ref:${recipeId}:${sourcePath}`,
    kind: 'source-ref',
    label: sourcePath,
    location: { sourcePath },
    parentRef: `recipe:${recipeId}`,
    recipeId,
  };
}

export function semanticRegionRef(
  recipeId: string,
  regionClass: string,
  vectorId: string
): RecipeContextRef {
  return {
    id: `semantic-region:${vectorId}`,
    kind: 'semantic-region',
    label: regionClass,
    metadata: { regionClass },
    parentRef: `recipe:${recipeId}`,
    recipeId,
  };
}

export function relationRef(
  fromRecipeId: string,
  toRecipeId: string,
  relationType: string
): RecipeContextRef {
  return {
    id: `relation:${fromRecipeId}->${toRecipeId}:${relationType}`,
    kind: 'relation',
    label: relationType,
    metadata: { relationType },
    parentRef: `recipe:${fromRecipeId}`,
    recipeId: toRecipeId,
  };
}

/** Stable de-duplication by ref id, preserving first-seen order. */
export function selectRecipeContextRefs(
  refs: readonly RecipeContextRef[] = []
): RecipeContextRef[] {
  const seen = new Set<string>();
  const selected: RecipeContextRef[] = [];
  for (const ref of refs) {
    if (!ref || seen.has(ref.id)) {
      continue;
    }
    seen.add(ref.id);
    selected.push(ref);
  }
  return selected;
}
