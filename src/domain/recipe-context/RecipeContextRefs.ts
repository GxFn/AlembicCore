// RecipeContext reference + metadata primitives (GMAP-2).
// Mirrors the ProjectContext ref shape so recipe_map / search / prime can carry
// stable, dereferenceable handles between Plugin tools and the Core read facade.

export type RecipeContextScalar = string | number | boolean | null;

export type RecipeContextJson =
  | RecipeContextScalar
  | RecipeContextJson[]
  | { readonly [key: string]: RecipeContextJson };

export type RecipeContextMetadata = Record<string, RecipeContextJson>;

export type RecipeContextRefKind =
  | 'recipe'
  | 'recipe-detail'
  | 'source-ref'
  | 'semantic-region'
  | 'relation'
  | 'module'
  | 'path';

/**
 * Where a recipe attaches in the codebase. recipe_source_refs is file-path
 * granular (no line columns), so startLine/endLine are advisory echoes the
 * recipe_map consumer can later narrow against ProjectContext anchor ranges.
 */
export interface RecipeSourceLocation {
  sourcePath?: string;
  module?: string;
  startLine?: number;
  endLine?: number;
}

export interface RecipeContextRef {
  id: string;
  kind: RecipeContextRefKind;
  label?: string;
  recipeId?: string;
  location?: RecipeSourceLocation;
  parentRef?: string;
  metadata?: RecipeContextMetadata;
}
