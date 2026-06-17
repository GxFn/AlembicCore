// Binds RecipeSourceRefRepository (recipe_source_refs) to RecipeSourceRefPort.
// The repository is referenced structurally and its reads are synchronous; the
// port normalizes them to the row shape and synthesizes listAll() from the three
// status partitions (active ∪ stale ∪ renamed) since the table has no list-all.

import type { RecipeSourceRefPort, RecipeSourceRefRow } from '../ports.js';

interface RepoRow {
  recipeId: string;
  sourcePath: string;
  status: string;
  newPath?: string | null;
  verifiedAt?: number;
}

/** The RecipeSourceRefRepository read methods this adapter consumes. */
export interface SourceRefRepositoryFacade {
  findByRecipeId(recipeId: string): RepoRow[];
  findBySourcePath(sourcePath: string): RepoRow[];
  findByStatus(status: string): RepoRow[];
  findStale(): RepoRow[];
  findRenamed(): RepoRow[];
}

function toRow(row: RepoRow): RecipeSourceRefRow {
  return {
    newPath: row.newPath ?? null,
    recipeId: row.recipeId,
    sourcePath: row.sourcePath,
    status: row.status,
    verifiedAt: row.verifiedAt,
  };
}

export function sourceRefPortFromRepository(repo: SourceRefRepositoryFacade): RecipeSourceRefPort {
  return {
    findByRecipeIds(ids: string[]): RecipeSourceRefRow[] {
      return ids.flatMap((id) => repo.findByRecipeId(id).map(toRow));
    },
    findBySourcePath(sourcePath: string): RecipeSourceRefRow[] {
      return repo.findBySourcePath(sourcePath).map(toRow);
    },
    findByStatus(status: string): RecipeSourceRefRow[] {
      return repo.findByStatus(status).map(toRow);
    },
    listAll(): RecipeSourceRefRow[] {
      return [...repo.findByStatus('active'), ...repo.findStale(), ...repo.findRenamed()].map(
        toRow
      );
    },
  };
}
