import type { RecipeContextHandlerRegistry } from '../interface/contracts.js';
import type { RecipeContextDeps } from '../ports.js';
import { makeDetailHandler } from './detail.js';
import { makeListHandler } from './list.js';
import { makePrimeHandler } from './prime.js';
import { makeRelationsHandler } from './relations.js';
import { makeSearchHandler } from './search.js';
import { makeSourceRefsHandler } from './sourceRefs.js';

export { makeDetailHandler } from './detail.js';
export { makeListHandler } from './list.js';
export { makePrimeHandler } from './prime.js';
export { makeRelationsHandler } from './relations.js';
export { makeSearchHandler } from './search.js';
export { makeSourceRefsHandler } from './sourceRefs.js';

/** Build the per-kind handler registry, each handler closing over deps. */
export function createRecipeContextHandlers(deps: RecipeContextDeps): RecipeContextHandlerRegistry {
  return {
    detail: makeDetailHandler(deps),
    list: makeListHandler(deps),
    prime: makePrimeHandler(deps),
    relations: makeRelationsHandler(deps),
    search: makeSearchHandler(deps),
    'source-refs': makeSourceRefsHandler(deps),
  };
}
