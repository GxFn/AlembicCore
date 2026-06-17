// Convenience wiring: build a RecipeContextService from concrete Core services.
// Each part is referenced structurally (no concrete class import), so a consumer
// (AlembicPlugin or a Core bootstrap) constructs KnowledgeService /
// RecipeSourceRefRepository / SearchEngine / VectorService and passes the
// instances; this factory binds them to the read-only ports. searchEngine and
// vectorService are optional.

import type { RecipeContextService } from '../RecipeContextService.js';
import { createRecipeContextService } from '../RecipeContextService.js';
import { type KnowledgeReadFacade, knowledgeReadPortFromService } from './knowledgeReadPort.js';
import { type SearchEngineFacade, searchPortFromEngine } from './searchPort.js';
import { type SourceRefRepositoryFacade, sourceRefPortFromRepository } from './sourceRefPort.js';
import { type VectorServiceFacade, vectorPortFromService } from './vectorPort.js';

export interface RecipeContextCoreParts {
  knowledge: KnowledgeReadFacade;
  sourceRefRepository: SourceRefRepositoryFacade;
  searchEngine?: SearchEngineFacade | null;
  vectorService?: VectorServiceFacade | null;
}

export function createRecipeContextServiceFromCore(
  parts: RecipeContextCoreParts
): RecipeContextService {
  return createRecipeContextService({
    read: knowledgeReadPortFromService(parts.knowledge),
    search: parts.searchEngine ? searchPortFromEngine(parts.searchEngine) : null,
    sourceRefs: sourceRefPortFromRepository(parts.sourceRefRepository),
    vector: parts.vectorService ? vectorPortFromService(parts.vectorService) : null,
  });
}
