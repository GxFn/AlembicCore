// Binds RecipeSourceRefRepository (recipe_source_refs) to RecipeSourceRefPort.
// The repository is referenced structurally and its reads are synchronous; the
// port prefers the repository's complete read, with status queries retained for
// older host adapters that do not yet expose findAll().

import Logger from '../../../infrastructure/logging/Logger.js';
import type { RecipeSourceRefPort, RecipeSourceRefRow } from '../ports.js';

const STATUS_ORDER = new Map(
  ['active', 'stale', 'renamed', 'drifted'].map((status, i) => [status, i])
);

interface RepoRow {
  recipeId: string;
  sourcePath: string;
  status: string;
  newPath?: string | null;
  verifiedAt?: number;
}

/** The RecipeSourceRefRepository read methods this adapter consumes. */
export interface SourceRefRepositoryFacade {
  findAll?(): RepoRow[];
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
      let rows: RepoRow[];
      if (repo.findAll) {
        rows = repo.findAll();
      } else {
        // 兼容旧外层端口，同时覆盖内容漂移状态；保留 active/stale/renamed 的既有分组顺序。
        Logger.getInstance().debug('Recipe source refs use compatibility status queries', {
          reason: 'repository-findAll-unavailable',
          statuses: [...STATUS_ORDER.keys()],
        });
        rows = [
          ...repo.findByStatus('active'),
          ...repo.findStale(),
          ...repo.findRenamed(),
          ...repo.findByStatus('drifted'),
        ];
      }
      return rows
        .map(toRow)
        .sort(
          (left, right) =>
            (STATUS_ORDER.get(left.status) ?? STATUS_ORDER.size) -
            (STATUS_ORDER.get(right.status) ?? STATUS_ORDER.size)
        );
    },
  };
}
