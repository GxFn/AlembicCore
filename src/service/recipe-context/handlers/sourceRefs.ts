// source-refs handler: batch recipe_source_refs query by recipeIds / sourcePath
// / pathPrefix / file / module / status. recipe_source_refs is file-path
// granular, so an optional lineRange is echoed (advisory) rather than used to
// drop file-level refs — the recipe_map consumer narrows to anchor ranges with
// ProjectContext. Sinks the Plugin batch source-ref read logic into Core.

import type {
  RecipeContextMetadata,
  RecipeContextQueryError,
  RecipeContextRef,
  RecipeSourceRefContext,
  RecipeSourceRefView,
} from '../../../domain/recipe-context/index.js';
import type { RecipeContextHandler } from '../interface/contracts.js';
import {
  renamedRefDiagnostic,
  staleRefDiagnostic,
  unresolvedDiagnostic,
} from '../interface/diagnostics.js';
import { sourceRefRef } from '../interface/refs.js';
import type { RecipeContextDeps, RecipeSourceRefRow } from '../ports.js';
import { readLineRange, readString, readStringArray } from './payload.js';
import {
  basenameOf,
  dedupeSourceRefRows,
  groupSourceRefsByRecipe,
  pathInModule,
} from './shared.js';

export function makeSourceRefsHandler(deps: RecipeContextDeps): RecipeContextHandler {
  return async (request) => {
    const recipeIds = readStringArray(request.payload, 'recipeIds');
    const sourcePath = readString(request.payload, 'sourcePath');
    const pathPrefix = readString(request.payload, 'pathPrefix');
    const file = readString(request.payload, 'file');
    const moduleName = readString(request.payload, 'module');
    const status = readString(request.payload, 'status');
    const lineRange = readLineRange(request.payload);

    // Pick the narrowest indexed base query, then post-filter the rest.
    let baseRows: RecipeSourceRefRow[];
    if (recipeIds) {
      baseRows = await deps.sourceRefs.findByRecipeIds(recipeIds);
    } else if (sourcePath) {
      baseRows = await deps.sourceRefs.findBySourcePath(sourcePath);
    } else if (status) {
      baseRows = await deps.sourceRefs.findByStatus(status);
    } else {
      baseRows = await deps.sourceRefs.listAll();
    }

    let rows = dedupeSourceRefRows(baseRows);
    if (status) {
      rows = rows.filter((row) => row.status === status);
    }
    if (sourcePath) {
      rows = rows.filter((row) => row.sourcePath === sourcePath);
    }
    if (pathPrefix) {
      rows = rows.filter((row) => row.sourcePath.startsWith(pathPrefix));
    }
    if (file) {
      rows = rows.filter(
        (row) =>
          row.sourcePath === file ||
          basenameOf(row.sourcePath) === file ||
          row.sourcePath.endsWith(`/${file}`)
      );
    }
    if (moduleName) {
      rows = rows.filter((row) => pathInModule(row.sourcePath, moduleName));
    }

    const refs: RecipeContextRef[] = [];
    const errors: RecipeContextQueryError[] = [];
    const views: RecipeSourceRefView[] = rows.map((row) => {
      const ref = sourceRefRef(row.recipeId, row.sourcePath);
      refs.push(ref);
      if (row.status === 'stale') {
        errors.push(staleRefDiagnostic(row.recipeId, row.sourcePath, ref));
      } else if (row.status === 'renamed') {
        errors.push(renamedRefDiagnostic(row.recipeId, row.sourcePath, row.newPath, ref));
      }
      return {
        newPath: row.newPath ?? null,
        recipeId: row.recipeId,
        ref,
        sourcePath: row.sourcePath,
        status: row.status,
        verifiedAt: row.verifiedAt,
      };
    });

    if (views.length === 0) {
      errors.push(
        unresolvedDiagnostic(
          'No source refs matched the query.',
          sourcePath ?? pathPrefix ?? file ?? moduleName
        )
      );
    }

    const data: RecipeSourceRefContext = {
      byRecipe: groupSourceRefsByRecipe(views),
      nextRefs: [],
      query: buildQueryEcho({
        file,
        lineRange,
        moduleName,
        pathPrefix,
        recipeIds,
        sourcePath,
        status,
      }),
      refs: views,
    };

    return { data, errors, refs };
  };
}

function buildQueryEcho(input: {
  recipeIds?: string[];
  sourcePath?: string;
  pathPrefix?: string;
  file?: string;
  moduleName?: string;
  status?: string;
  lineRange?: { start?: number; end?: number };
}): RecipeContextMetadata {
  const echo: RecipeContextMetadata = {};
  if (input.recipeIds) {
    echo.recipeIds = input.recipeIds;
  }
  if (input.sourcePath) {
    echo.sourcePath = input.sourcePath;
  }
  if (input.pathPrefix) {
    echo.pathPrefix = input.pathPrefix;
  }
  if (input.file) {
    echo.file = input.file;
  }
  if (input.moduleName) {
    echo.module = input.moduleName;
  }
  if (input.status) {
    echo.status = input.status;
  }
  if (input.lineRange) {
    echo.lineRange = { end: input.lineRange.end ?? null, start: input.lineRange.start ?? null };
  }
  return echo;
}
