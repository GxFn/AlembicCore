import type { ProjectContextRef } from '../../../domain/project-context/index.js';

export const PROJECT_CONTEXT_DEFAULT_REF_LIMIT = 50;

export function sortProjectContextRefs(refs: readonly ProjectContextRef[]): ProjectContextRef[] {
  return [...refs].sort((left, right) => {
    const kindOrder = left.kind.localeCompare(right.kind);
    return kindOrder === 0 ? left.id.localeCompare(right.id) : kindOrder;
  });
}

export function selectProjectContextRefs(
  refs: readonly ProjectContextRef[] = [],
  limit = PROJECT_CONTEXT_DEFAULT_REF_LIMIT
): ProjectContextRef[] {
  return sortProjectContextRefs(refs).slice(0, limit);
}
