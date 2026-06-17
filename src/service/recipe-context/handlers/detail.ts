// detail handler: id/ref -> single recipe detail + source refs + content
// expansion + deterministic staleness diagnostics. Sinks the Plugin
// KnowledgeDetailProvider + ContextExpansionProvider read logic into Core.

import type {
  RecipeContextQueryError,
  RecipeContextRef,
  RecipeDetailContext,
  RecipeSourceRefView,
} from '../../../domain/recipe-context/index.js';
import type { RecipeContextHandler } from '../interface/contracts.js';
import {
  invalidPayloadDiagnostic,
  notFoundDiagnostic,
  renamedRefDiagnostic,
  staleRefDiagnostic,
} from '../interface/diagnostics.js';
import { normalizeRecipeRef, relationRef, sourceRefRef } from '../interface/refs.js';
import { createUnavailableRecipeContextData } from '../interface/response.js';
import type { RecipeContextDeps } from '../ports.js';
import { readBoolean, readNumber, readString } from './payload.js';
import { buildContentPreview, failureResult } from './shared.js';

export function makeDetailHandler(deps: RecipeContextDeps): RecipeContextHandler {
  return async (request) => {
    const rawRef = readString(request.payload, 'ref');
    if (!rawRef) {
      return failureResult(
        'detail',
        invalidPayloadDiagnostic('detail requires payload.ref (a recipe id or ref).')
      );
    }

    const recipeId = normalizeRecipeRef(rawRef);
    const includeSourceRefs = readBoolean(request.payload, 'includeSourceRefs') ?? true;
    const includeRelations = readBoolean(request.payload, 'includeRelations') ?? false;
    const contentCharLimit = readNumber(request.payload, 'contentCharLimit');

    const record = await deps.read.getRecipe(recipeId);
    if (!record) {
      return {
        data: createUnavailableRecipeContextData('detail', `Recipe ${recipeId} not found.`),
        errors: [notFoundDiagnostic(recipeId)],
        refs: [],
      };
    }

    const refs: RecipeContextRef[] = [record.ref];
    const errors: RecipeContextQueryError[] = [];
    const sourceRefs: RecipeSourceRefView[] = [];

    if (includeSourceRefs) {
      const rows = await deps.sourceRefs.findByRecipeIds([recipeId]);
      for (const row of rows) {
        const ref = sourceRefRef(row.recipeId, row.sourcePath);
        refs.push(ref);
        if (row.status === 'stale') {
          errors.push(staleRefDiagnostic(row.recipeId, row.sourcePath, ref));
        } else if (row.status === 'renamed') {
          errors.push(renamedRefDiagnostic(row.recipeId, row.sourcePath, row.newPath, ref));
        }
        sourceRefs.push({
          newPath: row.newPath ?? null,
          recipeId: row.recipeId,
          ref,
          sourcePath: row.sourcePath,
          status: row.status,
          verifiedAt: row.verifiedAt,
        });
      }
    }

    const nextRefs: RecipeContextRef[] = [];
    if (includeRelations) {
      for (const edge of record.relations) {
        const targetId = normalizeRecipeRef(edge.target);
        if (!targetId) {
          continue;
        }
        nextRefs.push(relationRef(record.id, targetId, edge.type));
      }
    }

    const data: RecipeDetailContext = {
      contentPreview: buildContentPreview(record.content, contentCharLimit),
      nextRefs,
      recipe: record,
      sourceRefs,
    };

    return { data, errors, refs };
  };
}
