// list handler: metadata-filtered recipe listing (no keyword/vector). Sinks the
// pure metadata-filter capability (category / dimension / scope / tags /
// language / knowledgeType / kind / lifecycle / moduleName) onto
// KnowledgeService.list via the read port.

import type { RecipeContextRef, RecipeListContext } from '../../../domain/recipe-context/index.js';
import type { RecipeContextHandler } from '../interface/contracts.js';
import type { RecipeContextDeps } from '../ports.js';
import { readFilter, readNumber } from './payload.js';

export function makeListHandler(deps: RecipeContextDeps): RecipeContextHandler {
  return async (request) => {
    const filter = readFilter(request.payload) ?? {};
    const page = readNumber(request.payload, 'page');
    const pageSize = readNumber(request.payload, 'pageSize');

    const result = await deps.read.listRecipes(filter, { page, pageSize });
    const refs: RecipeContextRef[] = result.items.map((record) => record.ref);

    const data: RecipeListContext = {
      nextRefs: [],
      page: result.page,
      pageSize: result.pageSize,
      recipes: result.items,
      total: result.total,
    };

    return { data, errors: [], refs };
  };
}
