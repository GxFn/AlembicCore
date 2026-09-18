import type { ProjectContextRef } from '../../../domain/project-context/index.js';

/**
 * 各层 ProjectContext 共享相同的引用收敛语义：按 id 保留首项，再按 kind/id 排序。
 * 不复用 RecipeContext 的首见顺序规则，也不从公共 barrel 暴露这个内部实现。
 */
export function dedupeProjectContextRefs(
  refs: readonly (ProjectContextRef | undefined)[]
): ProjectContextRef[] {
  const byId = new Map<string, ProjectContextRef>();
  for (const ref of refs) {
    if (ref !== undefined && !byId.has(ref.id)) {
      byId.set(ref.id, ref);
    }
  }
  return [...byId.values()].sort((left, right) => {
    const kindOrder = left.kind.localeCompare(right.kind);
    return kindOrder || left.id.localeCompare(right.id);
  });
}
