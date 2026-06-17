// RecipeContextService — the Core read facade for recipe data, peer to
// ProjectContextService. Unlike ProjectContext (filesystem-backed, zero-dep
// singleton), RecipeContext is database-backed, so it is constructed with
// injected read ports via createRecipeContextService(deps). Lifecycle/create
// stays in KnowledgeService; this facade is read-only by construction.

import type {
  RecipeContext as RecipeContextContract,
  RecipeContextEnvelope,
  RecipeContextRequest,
  RecipeContextResult,
} from '../../domain/recipe-context/index.js';
import { createRecipeContextHandlers } from './handlers/index.js';
import type { RecipeContextHandlerRegistry } from './interface/contracts.js';
import { createRecipeContext } from './interface/recipeContext.js';
import type { RecipeContextDeps } from './ports.js';

export class RecipeContextService implements RecipeContextContract {
  private readonly recipeContext: RecipeContextContract;

  constructor(handlers: RecipeContextHandlerRegistry = {}) {
    this.recipeContext = createRecipeContext(handlers);
  }

  execute(input: RecipeContextRequest): Promise<RecipeContextEnvelope<RecipeContextResult>> {
    return this.recipeContext.execute(input);
  }
}

/** Build a RecipeContextService wired to read ports. */
export function createRecipeContextService(deps: RecipeContextDeps): RecipeContextService {
  return new RecipeContextService(createRecipeContextHandlers(deps));
}
